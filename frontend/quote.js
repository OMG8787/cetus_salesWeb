/**
 * quote.js - 報價系統 頁面專屬邏輯
 *  - 進入頁面時一次載入整份產品資料庫（有暫存先用暫存，背景再更新），搜尋型號全部在本機完成，不用每打一個字等一次伺服器；
 *  - 品名旁可以展開規格資料；
 *  - 報價單產生成可編輯文件（編輯 / 輸出見 quotedoc.js）。
 */
let quoteItems = []; // { id, name, basePrice, quantity, key, product }
let quoteItemSeq = 0;
let allProducts = [];
let productByKey = {};
let productsLoaded = false;
let pendingProduct = null; // 「新增品項」目前帶入的產品
let expandedItems = new Set();
const fullSpecCache = {}; // 型號 → 官網完整規格物件（沒有則 null），展開時才向後端要
const QUOTE_STORE_KEY = 'aoi_quote_state';

function qEsc(v) {
  return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function qFmt(n) {
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function productKeyOf(p) {
  return String(p.InternalModel || p.SupplierModel || '').trim();
}

// ------------------------------------------------------------
// 報價設定
// ------------------------------------------------------------
function onQuoteTypeChange() {
  const type = document.getElementById('quote-customer-type').value;
  document.getElementById('quote-custom-multiplier').style.display = type === 'custom' ? 'block' : 'none';
  updateQuoteItemPreview();
  renderQuoteTable();
}

function getCurrentMultiplier() {
  const type = document.getElementById('quote-customer-type').value;
  if (type === 'custom') {
    const v = parseFloat(document.getElementById('quote-custom-multiplier').value);
    return isNaN(v) ? 0 : v;
  }
  return parseFloat(type);
}

function getQuoteTypeLabel() {
  const type = document.getElementById('quote-customer-type').value;
  if (type === '1.3') return '設備商';
  if (type === '1.5') return '一般用戶';
  return '自訂義（×' + getCurrentMultiplier() + '）';
}

function syncFromBasePrice() {
  const base = parseFloat(document.getElementById('qi-base-price').value);
  if (!isNaN(base)) document.getElementById('qi-list-price').value = (base * 2).toFixed(2);
  updateQuoteItemPreview();
}

function syncFromListPrice() {
  const list = parseFloat(document.getElementById('qi-list-price').value);
  if (!isNaN(list)) document.getElementById('qi-base-price').value = (list / 2).toFixed(2);
  updateQuoteItemPreview();
}

function updateQuoteItemPreview() {
  const base = parseFloat(document.getElementById('qi-base-price').value);
  const multiplier = getCurrentMultiplier();
  document.getElementById('qi-preview-price').textContent = isNaN(base) || !multiplier ? '-' : (base * multiplier).toFixed(2);
}

// ------------------------------------------------------------
// 產品資料庫：進頁面一次載入，之後搜尋全在本機
// ------------------------------------------------------------
function applyProducts(list) {
  allProducts = list || [];
  productByKey = {};
  allProducts.forEach((p) => {
    [p.InternalModel, p.SupplierModel].forEach((m) => {
      if (m) productByKey[String(m).trim().toUpperCase()] = p;
    });
  });
  productsLoaded = true;
  // 之前存下來的品項重新連回產品資料（才有規格可以展開）
  quoteItems.forEach((it) => {
    if (it.key) it.product = productByKey[it.key.toUpperCase()] || null;
  });
  updateProductStatus();
  renderQuoteTable();
  if (document.activeElement === document.getElementById('qi-internal-model')) onQuoteModelInput();
}

function updateProductStatus(msg) {
  const el = document.getElementById('q-product-status');
  if (!el) return;
  el.innerHTML = msg || (productsLoaded ? `產品資料庫：已載入 <b>${allProducts.length}</b> 筆（搜尋型號不用再等）　<button type="button" class="btn-mini" onclick="loadQuoteProducts(true)">↻ 重新載入</button>` : '產品資料庫載入中…');
}

async function loadQuoteProducts(force) {
  const cached = force ? null : await getCachedAsync('products_all');
  if (cached) applyProducts(cached);
  else updateProductStatus('產品資料庫載入中…（第一次要把所有型號抓下來，之後會存在這台電腦，下次進來就是瞬間）');
  if (force) updateProductStatus('重新載入中…');
  // 有暫存就先用暫存，背景更新不擋畫面；沒有暫存才顯示載入遮罩
  const result = await callApi('searchProducts', { keyword: '' }, { silent: !!cached });
  if (!result.success) {
    if (!cached) updateProductStatus('<span style="color:#c0392b;">產品資料庫載入失敗：' + qEsc(result.message || '') + '</span>　<button type="button" class="btn-mini" onclick="loadQuoteProducts(true)">重試</button>');
    return;
  }
  setCached('products_all', result.products);
  applyProducts(result.products);
}

/** 相符程度分數，越小越前面：0 型號完全相同、1 型號開頭相符、2 型號包含、3 其他欄位包含；多個關鍵字必須全部對到。 */
function quoteMatchScore(p, keywords) {
  const models = [p.InternalModel, p.SupplierModel].map((v) => String(v || '').toLowerCase());
  const others = [p.Supplier, p.Category, p.Brand, p.Origin, p.CompatibleGroup, p.Notes].map((v) => String(v || '').toLowerCase());
  let worst = 0;
  for (const kw of keywords) {
    let s;
    if (models.some((m) => m === kw)) s = 0;
    else if (models.some((m) => m.startsWith(kw))) s = 1;
    else if (models.some((m) => m.includes(kw))) s = 2;
    else if (others.some((o) => o.includes(kw))) s = 3;
    else return -1;
    worst = Math.max(worst, s);
  }
  return worst;
}

let quoteSuggestions = [];
let quoteSuggestionIdx = -1;

function onQuoteModelInput() {
  pendingProduct = null;
  renderSpecBox();
  const box = document.getElementById('qi-model-suggestions');
  const keyword = document.getElementById('qi-internal-model').value.trim().toLowerCase();
  if (!keyword) {
    box.style.display = 'none';
    box.innerHTML = '';
    quoteSuggestions = [];
    return;
  }
  if (!productsLoaded) {
    box.innerHTML = '<div class="suggestion-item" style="color:#888;">產品資料庫還在載入中…</div>';
    box.style.display = 'block';
    return;
  }
  const kws = keyword.split(/\s+/).filter(Boolean);
  quoteSuggestions = allProducts
    .map((p) => ({ p, s: quoteMatchScore(p, kws) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => a.s - b.s || productKeyOf(a.p).length - productKeyOf(b.p).length)
    .slice(0, 12)
    .map((x) => x.p);
  quoteSuggestionIdx = quoteSuggestions.length ? 0 : -1;
  renderSuggestions();
}

function renderSuggestions() {
  const box = document.getElementById('qi-model-suggestions');
  if (!quoteSuggestions.length) {
    box.innerHTML = '<div class="suggestion-item" style="color:#888;">找不到符合的產品（可以直接在下面手動輸入品名與底價）</div>';
    box.style.display = 'block';
    return;
  }
  box.innerHTML = '';
  quoteSuggestions.forEach((p, i) => {
    const div = document.createElement('div');
    div.className = 'suggestion-item';
    if (i === quoteSuggestionIdx) div.style.background = '#eef2f7';
    const price = p.RefPrice ? `　底價 ${qEsc(p.RefPrice)}` : '　<span style="color:#c0392b;">無底價</span>';
    div.innerHTML = `<b>${qEsc(p.InternalModel || '（缺內部型號）')}</b>｜${qEsc(p.SupplierModel || '')}｜${qEsc(p.Supplier || '')}｜${qEsc(p.Category || '')}${price}`;
    div.addEventListener('mousedown', (e) => {
      e.preventDefault();
      pickQuoteProduct(p);
    });
    box.appendChild(div);
  });
  box.style.display = 'block';
}

function onQuoteModelKey(e) {
  if (!quoteSuggestions.length) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    quoteSuggestionIdx = (quoteSuggestionIdx + (e.key === 'ArrowDown' ? 1 : -1) + quoteSuggestions.length) % quoteSuggestions.length;
    renderSuggestions();
  } else if (e.key === 'Enter' && document.getElementById('qi-model-suggestions').style.display === 'block' && quoteSuggestionIdx > -1) {
    e.preventDefault();
    pickQuoteProduct(quoteSuggestions[quoteSuggestionIdx]);
  } else if (e.key === 'Escape') {
    document.getElementById('qi-model-suggestions').style.display = 'none';
  }
}

function pickQuoteProduct(p) {
  document.getElementById('qi-model-suggestions').style.display = 'none';
  document.getElementById('qi-internal-model').value = productKeyOf(p);
  pendingProduct = p;
  document.getElementById('qi-name').value = (p.InternalModel || p.SupplierModel || '') + (p.InternalModel && p.SupplierModel ? '（' + p.SupplierModel + '）' : '');
  document.getElementById('qi-base-price').value = p.RefPrice || '';
  syncFromBasePrice();
  if (!p.RefPrice) document.getElementById('qi-list-price').value = '';
  renderSpecBox();
  document.getElementById(p.RefPrice ? 'qi-quantity' : 'qi-base-price').focus();
}

document.addEventListener('click', (e) => {
  if (!e.target.closest || !e.target.closest('.autocomplete-wrap')) {
    const box = document.getElementById('qi-model-suggestions');
    if (box) box.style.display = 'none';
  }
});

// ------------------------------------------------------------
// 規格資料（品名旁邊可展開）
// ------------------------------------------------------------
/** 這個產品的規格欄位 [[名稱, 值]]：鏡頭不顯示相機專用欄位，相機不顯示鏡頭專用欄位，空的略過。 */
function specPairs(p) {
  const isLens = p.Category === '鏡頭';
  const sel = [
    ['品牌', p.Brand], ['供應商型號', p.SupplierModel], ['類別', p.Category], ['介面', p.Interface], ['解析度', p.Resolution],
    ['像元尺寸 µm', p.PixelSize], ['靶面', p.SensorSize], ['影格率 fps', p.FPS], ['接口', p.Mount], ['焦距 mm', p.FocalLength],
    ['放大倍率', p.Magnification], ['工作距離 WD', p.WD], ['景深 DOF', p.DOF], ['最近對焦距離', p.FocusWD], ['產地', p.Origin],
  ];
  return sel.filter(([k, v]) => v !== '' && v != null && (isLens ? !/像元|影格|介面/.test(k) : !/焦距|倍率|WD|DOF|最近/.test(k)));
}

function gridHtml(pairs) {
  return `<div class="pd-grid">${pairs.map(([k, v]) => `<div><span>${qEsc(k)}</span><span>${qEsc(v)}</span></div>`).join('')}</div>`;
}

function specHtml(p) {
  const pairs = specPairs(p);
  let html = pairs.length ? gridHtml(pairs) : '<div class="calc-hint">這個產品的選型規格欄位還沒填。</div>';
  const notes = String(p.Notes || '').trim();
  if (notes) html += `<div class="calc-hint" style="margin:4px 0;">備註：${qEsc(notes.length > 400 ? notes.slice(0, 400) + '…' : notes)}</div>`;
  const key = productKeyOf(p);
  if (key in fullSpecCache) {
    const full = fullSpecCache[key];
    const ks = full ? Object.keys(full).filter((k) => full[k] !== '' && full[k] != null) : [];
    html += ks.length ? `<div class="pd-section-title">官網完整規格（${ks.length} 項）</div>` + gridHtml(ks.map((k) => [k, full[k]])) : '<div class="calc-hint">沒有官網完整規格（手動新增的產品，或尚未從官網匯入）。</div>';
  } else {
    html += '<div class="calc-hint">官網完整規格載入中…</div>';
  }
  return html;
}

/** 向後端要這個產品的官網完整規格（Specs 欄位很大，列表不帶，展開時才抓一次）。silent = 不顯示載入遮罩。 */
async function loadFullSpecs(p, silent) {
  const key = productKeyOf(p);
  if (!key) return null;
  if (key in fullSpecCache) return fullSpecCache[key];
  const r = await callApi('getProduct', p.InternalModel ? { internalModel: p.InternalModel } : { rowIndex: p.RowIndex }, { silent: silent !== false });
  let specs = null;
  if (r && r.success && r.product && r.product.Specs) {
    try {
      specs = JSON.parse(r.product.Specs);
    } catch (e) {
      specs = null;
    }
  }
  if (r && (r.success || /查無/.test(r.message || ''))) fullSpecCache[key] = specs; // 網路錯誤不快取，下次再試
  return specs;
}

function renderSpecBox() {
  const box = document.getElementById('qi-spec-box');
  if (!pendingProduct) {
    box.style.display = 'none';
    box.open = false;
    return;
  }
  box.style.display = '';
  const body = document.getElementById('qi-spec-body');
  body.innerHTML = specHtml(pendingProduct);
  if (box.open) loadSpecForBox();
}

async function loadSpecForBox() {
  const p = pendingProduct;
  if (!p) return;
  await loadFullSpecs(p);
  if (pendingProduct === p) document.getElementById('qi-spec-body').innerHTML = specHtml(p);
}

document.addEventListener('DOMContentLoaded', () => {
  const box = document.getElementById('qi-spec-box');
  if (box) box.addEventListener('toggle', () => box.open && loadSpecForBox());
});

async function toggleItemSpec(id) {
  if (expandedItems.has(id)) expandedItems.delete(id);
  else expandedItems.add(id);
  renderQuoteTable();
  const it = quoteItems.find((x) => x.id === id);
  if (it && it.product && expandedItems.has(id)) {
    await loadFullSpecs(it.product);
    if (expandedItems.has(id)) renderQuoteTable();
  }
}

// ------------------------------------------------------------
// 品項清單
// ------------------------------------------------------------
function saveQuoteState() {
  try {
    localStorage.setItem(
      QUOTE_STORE_KEY,
      JSON.stringify({
        customer: document.getElementById('quote-customer-name').value,
        type: document.getElementById('quote-customer-type').value,
        custom: document.getElementById('quote-custom-multiplier').value,
        items: quoteItems.map((it) => ({ name: it.name, basePrice: it.basePrice, quantity: it.quantity, key: it.key })),
      })
    );
  } catch (e) {
    // 瀏覽器不讓存就算了，只是重新整理後品項不會保留
  }
}

function restoreQuoteState() {
  try {
    const s = JSON.parse(localStorage.getItem(QUOTE_STORE_KEY) || 'null');
    if (!s) return;
    document.getElementById('quote-customer-name').value = s.customer || '';
    if (s.type) document.getElementById('quote-customer-type').value = s.type;
    document.getElementById('quote-custom-multiplier').value = s.custom || '';
    onQuoteTypeChange();
    quoteItems = (s.items || []).map((it) => ({ id: ++quoteItemSeq, name: it.name, basePrice: Number(it.basePrice) || 0, quantity: Number(it.quantity) || 1, key: it.key || '', product: null }));
  } catch (e) {
    quoteItems = [];
  }
}

function addQuoteItem() {
  const name = document.getElementById('qi-name').value.trim();
  const basePrice = parseFloat(document.getElementById('qi-base-price').value);
  const quantity = parseFloat(document.getElementById('qi-quantity').value) || 1;
  if (!name || isNaN(basePrice)) return alert('請輸入品名與底價');

  const typedKey = document.getElementById('qi-internal-model').value.trim();
  const product = pendingProduct || (typedKey ? productByKey[typedKey.toUpperCase()] || null : null);
  quoteItems.push({ id: ++quoteItemSeq, name, basePrice, quantity, key: product ? productKeyOf(product) : '', product });
  ['qi-internal-model', 'qi-name', 'qi-base-price', 'qi-list-price'].forEach((id) => (document.getElementById(id).value = ''));
  document.getElementById('qi-quantity').value = '1';
  document.getElementById('qi-preview-price').textContent = '-';
  pendingProduct = null;
  renderSpecBox();
  renderQuoteTable();
  document.getElementById('qi-internal-model').focus();
}

function removeQuoteItem(id) {
  quoteItems = quoteItems.filter((it) => it.id !== id);
  expandedItems.delete(id);
  renderQuoteTable();
}

function setQuoteQty(id, v) {
  const it = quoteItems.find((x) => x.id === id);
  const n = parseFloat(v);
  if (it) it.quantity = !isNaN(n) && n > 0 ? n : 1;
  renderQuoteTable();
}

function clearQuote() {
  if (quoteItems.length && !confirm('確定要清空目前的報價品項嗎？')) return;
  quoteItems = [];
  expandedItems.clear();
  renderQuoteTable();
}

function computeQuoteRows() {
  const multiplier = getCurrentMultiplier();
  return quoteItems.map((it) => {
    const listPrice = it.basePrice * 2;
    const unitPrice = it.basePrice * multiplier;
    const subtotal = unitPrice * it.quantity;
    return Object.assign({}, it, { listPrice, unitPrice, subtotal });
  });
}

function renderQuoteTable() {
  updateQuoteItemPreview();
  const fieldMode = document.getElementById('quote-field-mode').checked;
  const rows = computeQuoteRows();
  const head = document.getElementById('quote-table-head');
  const tbody = document.querySelector('#quote-table tbody');
  const cols = fieldMode ? 6 : 8;

  head.innerHTML = fieldMode
    ? '<tr><th>品名</th><th>報價</th><th>數量</th><th>小計</th><th></th></tr>'
    : '<tr><th>品名</th><th>底價</th><th>牌價</th><th>報價</th><th>數量</th><th>小計</th><th></th></tr>';

  tbody.innerHTML = '';
  let total = 0;
  rows.forEach((r) => {
    total += r.subtotal;
    const open = expandedItems.has(r.id);
    const toggle = r.product
      ? `<button type="button" class="q-toggle" title="展開 / 收合規格資料" onclick="toggleItemSpec(${r.id})">${open ? '▾' : '▸'}</button>`
      : '<span class="q-toggle-gap" title="手動輸入的品項沒有規格資料" style="display:inline-block;width:30px;"></span>';
    const qty = `<input class="q-qty" type="number" min="0" step="any" value="${qEsc(r.quantity)}" onchange="setQuoteQty(${r.id}, this.value)" />`;
    const del = `<button onclick="removeQuoteItem(${r.id})">刪除</button>`;
    const tr = document.createElement('tr');
    tr.innerHTML = fieldMode
      ? `<td>${toggle}${qEsc(r.name)}</td><td>${qFmt(r.unitPrice)}</td><td>${qty}</td><td>${qFmt(r.subtotal)}</td><td>${del}</td>`
      : `<td>${toggle}${qEsc(r.name)}</td><td>${qFmt(r.basePrice)}</td><td>${qFmt(r.listPrice)}</td><td>${qFmt(r.unitPrice)}</td><td>${qty}</td><td>${qFmt(r.subtotal)}</td><td>${del}</td>`;
    tbody.appendChild(tr);
    if (open && r.product) {
      const sr = document.createElement('tr');
      sr.className = 'q-spec-row';
      sr.innerHTML = `<td colspan="${fieldMode ? 5 : 7}">${specHtml(r.product)}</td>`;
      tbody.appendChild(sr);
    }
  });
  if (!rows.length) tbody.innerHTML = `<tr><td colspan="${cols}" class="calc-hint">還沒有品項，從上面搜尋型號加入。</td></tr>`;

  document.getElementById('quote-total').textContent = qFmt(total);
  saveQuoteState();
}

// ------------------------------------------------------------
// 產生報價單：先產生成可編輯的文件，再到編輯器裡手動調整 / 輸出
// ------------------------------------------------------------
let quoteLogoDataUrl = null;

async function loadQuoteLogo() {
  if (quoteLogoDataUrl !== null) return quoteLogoDataUrl;
  try {
    const res = await fetch('img/logo.png');
    if (!res.ok) throw new Error('no logo');
    const blob = await res.blob();
    quoteLogoDataUrl = await new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => resolve('');
      fr.readAsDataURL(blob);
    });
  } catch (e) {
    quoteLogoDataUrl = ''; // 用 file:// 開啟時讀不到，就不放 Logo
  }
  return quoteLogoDataUrl;
}

function specLinesFor(p, level, full) {
  if (!p || level === 'none') return [];
  const lines = specPairs(p).map(([k, v]) => `${k}：${v}`);
  if (level === 'full' && full) {
    Object.keys(full).forEach((k) => {
      const v = full[k];
      if (v === '' || v == null) return;
      const t = String(v).replace(/\s+/g, ' ');
      lines.push(`${k}：${t.length > 80 ? t.slice(0, 80) + '…' : t}`);
    });
  }
  return lines;
}

function buildQuoteHtml(o) {
  const cols = o.cols;
  const th = (t, w) => `<th style="${w ? 'width:' + w + ';' : ''}">${t}</th>`;
  const head =
    '<tr>' +
    (cols.no ? th('編號', '9mm') : '') +
    th('品名 / 規格') +
    th('數量', '14mm') +
    (cols.base ? th('底價', '24mm') : '') +
    (cols.list ? th('牌價', '24mm') : '') +
    th('單價', '26mm') +
    th('小計', '28mm') +
    '</tr>';
  const rowsHtml = o.rows
    .map((r, i) => {
      const spec = r.lines.length ? `<ul class="q-spec">${r.lines.map((l) => `<li>${qEsc(l)}</li>`).join('')}</ul>` : '';
      return (
        '<tr data-qd-item="1">' +
        (cols.no ? `<td class="q-no c">${i + 1}</td>` : '') +
        `<td><div class="q-name">${qEsc(r.name)}</div>${spec}</td>` +
        `<td class="q-qty c">${qFmt(r.quantity)}</td>` +
        (cols.base ? `<td class="q-base r">${qFmt(r.basePrice)}</td>` : '') +
        (cols.list ? `<td class="q-list r">${qFmt(r.listPrice)}</td>` : '') +
        `<td class="q-unit r">${qFmt(r.unitPrice)}</td>` +
        `<td class="q-sub r">${qFmt(r.subtotal)}</td>` +
        '</tr>'
      );
    })
    .join('');
  const lead = (cols.no ? 1 : 0) + 2 + (cols.base ? 1 : 0) + (cols.list ? 1 : 0); // 「單價」欄之前有幾格
  const totalRow = '<tr class="q-totalrow">' + '<td></td>'.repeat(lead) + '<td class="r"><b>合計</b></td>' + `<td class="q-total r"><b>${qFmt(o.total)}</b></td></tr>`;
  const valid = new Date(Date.now() + 30 * 86400000);
  const validStr = `${valid.getFullYear()}-${String(valid.getMonth() + 1).padStart(2, '0')}-${String(valid.getDate()).padStart(2, '0')}`;
  const terms = o.terms
    ? `<div class="q-terms"><div>報價有效期限：30 天（至 ${validStr}）</div><div>備註：</div></div>`
    : '';
  const logo = o.logo ? `<img src="${o.logo}" alt="logo" style="height:42px;" />` : '';
  return `<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="UTF-8"><title>報價單${o.customer ? '_' + qEsc(o.customer) : ''}</title><style>
body{font-family:"Microsoft JhengHei","PingFang TC",sans-serif;color:#222;margin:0;padding:0;font-size:14px;line-height:1.5;}
.q-head{width:100%;border-collapse:collapse;border-bottom:3px solid #2c5aa0;margin-bottom:12px;}
.q-head td{padding:6px 0;border:0;vertical-align:middle;}
.q-title{font-size:26px;font-weight:bold;color:#2c5aa0;text-align:right;}
.q-company{font-size:16px;font-weight:bold;}
.q-info{width:100%;border-collapse:collapse;margin-bottom:12px;}
.q-info td{padding:3px 6px;border:0;font-size:14px;}
.q-info td.k{color:#666;width:22mm;}
.q-items{width:100%;border-collapse:collapse;margin:8px 0;}
.q-items th,.q-items td{border:1px solid #bbb;padding:6px 8px;vertical-align:top;font-size:13px;}
.q-items th{background:#eef2f7;text-align:center;}
.q-items td.c{text-align:center;}
.q-items td.r{text-align:right;white-space:nowrap;}
.q-items tr{page-break-inside:avoid;}
.q-name{font-weight:bold;}
.q-spec{margin:4px 0 0;padding:0;list-style:none;font-size:12px;color:#555;}
.q-spec li{display:inline-block;margin:0 14px 2px 0;}
.q-totalrow td{border:1px solid #bbb;background:#fafbfc;font-size:14px;}
.q-terms{margin-top:14px;font-size:13px;color:#444;}
.q-terms div{margin:3px 0;}
</style></head><body>
<table class="q-head"><tr><td>${logo}<div class="q-company">鑫堡股份有限公司</div></td><td class="q-title">報 價 單</td></tr></table>
<table class="q-info">
<tr><td class="k">客戶</td><td>${qEsc(o.customer) || '&nbsp;'}</td><td class="k">報價日期</td><td>${qEsc(o.date)}</td></tr>
<tr><td class="k">報價人</td><td>${qEsc(o.preparer) || '&nbsp;'}</td><td class="k"></td><td></td></tr>
</table>
<table class="q-items">${head}${rowsHtml}${totalRow}</table>
${terms}
</body></html>`;
}

async function generateQuoteDocument() {
  const rows = computeQuoteRows();
  if (!rows.length) return alert('報價單目前沒有任何品項');
  if (!getCurrentMultiplier()) return alert('請先設定報價倍數（客戶類型選「自訂義」時要輸入倍數）');
  const level = document.getElementById('qg-spec').value;
  const cols = { no: document.getElementById('qg-no').checked, base: document.getElementById('qg-base').checked, list: document.getElementById('qg-list').checked };
  if (cols.base && !confirm('「底價」是內部資料，勾選後報價單裡會出現底價。\n\n如果這份報價單是要給客戶的，請不要放底價。\n\n確定要放底價嗎？')) return;

  // 完整規格：每個品項各抓一次（已經抓過的有暫存）
  if (level === 'full') await Promise.all(rows.filter((r) => r.product).map((r) => loadFullSpecs(r.product, false)));
  const logo = await loadQuoteLogo();
  const outRows = rows.map((r) => Object.assign({}, r, { lines: specLinesFor(r.product, level, r.product ? fullSpecCache[productKeyOf(r.product)] : null) }));
  const total = rows.reduce((s, r) => s + r.subtotal, 0);
  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const customer = document.getElementById('quote-customer-name').value.trim();
  const html = buildQuoteHtml({
    customer,
    date: dateStr,
    preparer: typeof currentUsername !== 'undefined' ? currentUsername || '' : '',
    rows: outRows,
    total,
    cols,
    terms: document.getElementById('qg-terms').checked,
    logo,
  });
  qdOpen(html, '報價單' + (customer ? '_' + customer : ''));
}

window.addEventListener('DOMContentLoaded', async () => {
  if (!(await ensureAuth())) return;
  renderHeaderUser();
  applyAdminOnlyVisibility();
  restoreQuoteState();
  renderQuoteTable();
  ['quote-customer-name', 'quote-custom-multiplier'].forEach((id) => document.getElementById(id).addEventListener('input', saveQuoteState));
  document.getElementById('quote-customer-type').addEventListener('change', saveQuoteState);
  // 型號欄的 Enter 是「帶入選到的建議」（onQuoteModelKey 處理），其他欄位按 Enter 才是「加入報價單」
  ['qi-name', 'qi-base-price', 'qi-list-price', 'qi-quantity'].forEach((id) =>
    document.getElementById(id).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addQuoteItem();
      }
    })
  );
  loadQuoteProducts();
});

// 導覽列「↻ 重撈資料」
window.refreshPageData = () => loadQuoteProducts(true);
