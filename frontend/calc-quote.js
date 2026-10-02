/**
 * calc-quote.js - 選型計算頁的「光源 / 主機 / 價格試算」
 * 光源與主機不需要計算，直接從產品資料庫挑（受「客戶需求」的指定品牌/產地影響）；
 * 相機、鏡頭沿用上面計算採用的型號；再加選配件（線材、螢幕滑鼠、IO 卡…）後試算金額、輸出報價單。
 * 價格規則同報價系統：牌價 = 底價 × 2；報價 = 底價 × 客戶類型倍數（設備商 1.3 / 一般用戶 1.5 / 自訂）。
 */
const QUOTE_STATE_KEY = 'aoi_calc_quote';
const LIGHT_CATS = ['光源'];
const CONTROLLER_CATS = ['調光器'];
const HOST_CATS = ['工業主機'];

let calcProducts = []; // 產品資料庫（含底價），由 calc.js 的 loadProductOrigins 載入
let productIndex = {};
let savedHw = {}; // 重新整理前選的光源/主機（產品載入前下拉還是空的）
let quoteState = { qty: {}, price: {}, addons: [] };

function productKey(p) {
  return String(p.InternalModel || p.SupplierModel || '').trim();
}

function productBrand(p) {
  return String(p.Brand || p.Supplier || '').trim();
}

function productOrigin(p) {
  return originOf({ name: productKey(p), brand: productBrand(p) }) || String(p.Origin || '');
}

function indexProducts() {
  productIndex = {};
  calcProducts.forEach((p) => {
    [p.InternalModel, p.SupplierModel].forEach((m) => {
      if (m) productIndex[String(m).trim().toUpperCase()] = p;
    });
  });
}

function findProduct(name) {
  return productIndex[String(name || '').trim().toUpperCase()] || null;
}

function loadQuoteState() {
  try {
    const s = JSON.parse(localStorage.getItem(QUOTE_STATE_KEY) || '{}');
    quoteState = { qty: s.qty || {}, price: s.price || {}, addons: s.addons || [] };
  } catch (e) {
    quoteState = { qty: {}, price: {}, addons: [] };
  }
}

function saveQuoteState() {
  try {
    localStorage.setItem(QUOTE_STATE_KEY, JSON.stringify(quoteState));
  } catch (e) {}
}

// ------------------------------------------------------------
// 光源 / 光源控制器 / 主機：直接挑，不計算
// ------------------------------------------------------------
function populateHwSelect(id, cats) {
  const sel = document.getElementById(id);
  if (!sel) return;
  const f = effectiveFilter('other');
  const all = calcProducts.filter((p) => cats.includes(p.Category) && productKey(p));
  const list = all.filter((p) => (!f.brand || productBrand(p) === f.brand) && (!f.origin || productOrigin(p) === f.origin));
  const key = `${all.length}|${list.length}|${f.brand}|${f.origin}`;
  const hint = document.getElementById(id + '-hint');
  if (sel.dataset.key !== key) {
    const keep = sel.value || savedHw[id] || '';
    sel.innerHTML = '<option value="">（不選）</option>';
    list
      .slice()
      .sort((a, b) => productKey(a).localeCompare(productKey(b)))
      .forEach((p) => {
        const opt = document.createElement('option');
        opt.value = productKey(p);
        const price = parseFloat(p.RefPrice) > 0 ? `底價 ${p.RefPrice}` : '未填底價';
        opt.textContent = `${productKey(p)}｜${productBrand(p) || '-'}｜${productOrigin(p) || '-'}｜${price}`;
        sel.appendChild(opt);
      });
    if (keep && list.some((p) => productKey(p) === keep)) {
      sel.value = keep;
      delete savedHw[id];
    }
    sel.dataset.key = key;
  }
  if (hint) {
    hint.textContent = !all.length
      ? calcProducts.length
        ? '產品資料庫還沒有這個類別的產品，請先到「產品搜尋」新增（類別選對）'
        : '產品載入中...'
      : !list.length
        ? `沒有符合「客戶需求」指定品牌 / 產地的產品（資料庫共 ${all.length} 筆），可放寬指定條件`
        : `符合條件 ${list.length} 筆${list.length < all.length ? `（資料庫共 ${all.length} 筆）` : ''}`;
  }
}

// ------------------------------------------------------------
// 價格試算
// ------------------------------------------------------------
function quoteMultiplier() {
  const type = val('q-type');
  if (type === 'custom') {
    const v = parseFloat(val('q-mult'));
    return isNaN(v) ? 0 : v;
  }
  return parseFloat(type) || 1.5;
}

function quoteTypeLabel() {
  const type = val('q-type');
  if (type === '1.3') return '設備商';
  if (type === '1.5') return '一般用戶';
  return '自訂義（×' + quoteMultiplier() + '）';
}

/** 目前選到的品項（相機、鏡頭、光源、控制器、主機）+ 自己加選的配件。 */
function quoteLines() {
  const lines = [];
  const push = (key, label, name, product, defaultQty) => {
    lines.push({ key, label, name, product, qty: quoteState.qty[key] != null ? quoteState.qty[key] : defaultQty, addonId: null });
  };
  const c = typeof lastCalc !== 'undefined' ? lastCalc : null;
  if (c && c.cam && c.cam.name) {
    const p = findProduct(c.cam.name);
    if (p) push('cam:' + c.cam.name, '相機', c.cam.name, p, 1);
  }
  if (c && c.lens && c.lens.used && !c.lens.used.virtual && c.lens.used.name) {
    const p = findProduct(c.lens.used.name);
    if (p) push('lens:' + c.lens.used.name, '鏡頭', c.lens.used.name, p, 1);
  }
  [
    ['c-light-model', '光源'],
    ['c-ctl-model', '光源控制器'],
    ['c-host-model', '主機'],
  ].forEach(([id, label]) => {
    const name = val(id);
    if (name) push(id + ':' + name, label, name, findProduct(name), 1);
  });
  quoteState.addons.forEach((a) => {
    lines.push({ key: 'addon:' + a.id, label: '配件', name: a.name, product: a.product ? findProduct(a.name) : null, qty: a.qty, addonId: a.id, manualBase: a.base });
  });
  return lines;
}

function lineBase(l) {
  if (l.addonId != null) {
    if (quoteState.price[l.key] !== undefined) return quoteState.price[l.key];
    if (l.manualBase !== '' && l.manualBase != null) return Number(l.manualBase);
  } else if (quoteState.price[l.key] !== undefined) {
    return quoteState.price[l.key];
  }
  const v = l.product ? parseFloat(l.product.RefPrice) : NaN;
  return isNaN(v) ? NaN : v;
}

function renderQuotePanel() {
  if (!document.getElementById('q-table')) return;
  populateHwSelect('c-light-model', LIGHT_CATS);
  populateHwSelect('c-ctl-model', CONTROLLER_CATS);
  populateHwSelect('c-host-model', HOST_CATS);
  document.getElementById('q-mult').style.display = val('q-type') === 'custom' ? '' : 'none';

  const mult = quoteMultiplier();
  const tbody = document.querySelector('#q-table tbody');
  tbody.innerHTML = '';
  let total = 0;
  let missing = 0;
  const lines = quoteLines();
  lines.forEach((l) => {
    const base = lineBase(l);
    const hasBase = !isNaN(base) && base > 0;
    const unit = hasBase ? base * mult : 0;
    const sub = unit * (Number(l.qty) || 0);
    if (hasBase) total += sub;
    else missing++;
    const tr = document.createElement('tr');
    const safeKey = l.key.replace(/'/g, "\\'");
    tr.innerHTML = `<td>${l.label}</td><td>${escapeQ(l.name)}</td>
      <td><input type="number" step="any" min="0" value="${hasBase ? base : ''}" placeholder="缺底價" style="width:96px;${hasBase ? '' : 'border-color:#d9534f;'}" onchange="setQuotePrice('${safeKey}', this.value)" /></td>
      <td>${hasBase ? (base * 2).toFixed(2) : '-'}</td>
      <td>${hasBase ? unit.toFixed(2) : '-'}</td>
      <td><input type="number" min="0" step="1" value="${l.qty}" style="width:64px;" onchange="setQuoteQty('${safeKey}', this.value)" /></td>
      <td>${hasBase ? sub.toFixed(2) : '-'}</td>
      <td>${l.addonId != null ? `<button class="btn-mini" onclick="removeQuoteAddon(${l.addonId})">刪除</button>` : ''}</td>`;
    tbody.appendChild(tr);
  });
  if (!lines.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="8" class="calc-hint">上方還沒有選任何品項：相機 / 鏡頭會帶入計算採用的型號，光源、主機請在上方挑選，配件在下方加選。</td>';
    tbody.appendChild(tr);
  }
  document.getElementById('q-total').textContent = total.toFixed(2);
  document.getElementById('q-warn').textContent = missing ? `有 ${missing} 項沒有底價，未計入總計；可直接在表格填底價（只影響這次試算，要長期保存請到產品頁補底價）` : '';
}

function escapeQ(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

function setQuoteQty(key, v) {
  quoteState.qty[key] = Math.max(0, parseFloat(v) || 0);
  const a = quoteState.addons.find((x) => 'addon:' + x.id === key);
  if (a) a.qty = quoteState.qty[key];
  saveQuoteState();
  renderQuotePanel();
}

function setQuotePrice(key, v) {
  if (v === '' || isNaN(parseFloat(v))) delete quoteState.price[key];
  else quoteState.price[key] = parseFloat(v);
  saveQuoteState();
  renderQuotePanel();
}

function removeQuoteAddon(id) {
  quoteState.addons = quoteState.addons.filter((a) => a.id !== id);
  delete quoteState.price['addon:' + id];
  saveQuoteState();
  renderQuotePanel();
}

/** 配件挑選清單：依類別 + 關鍵字找產品資料庫，最多列 60 筆。 */
function refreshAddonPick() {
  const cat = val('q-addon-cat');
  const kw = val('q-addon-kw').trim().toLowerCase();
  const sel = document.getElementById('q-addon-pick');
  const list = calcProducts
    .filter((p) => productKey(p))
    .filter((p) => (cat ? p.Category === cat : p.Category !== '相機' && p.Category !== '鏡頭'))
    .filter((p) => !kw || [p.InternalModel, p.SupplierModel, p.Supplier, p.Notes, p.Category].join(' ').toLowerCase().includes(kw))
    .slice(0, 60);
  sel.innerHTML = '';
  list.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = productKey(p);
    const price = parseFloat(p.RefPrice) > 0 ? `底價 ${p.RefPrice}` : '未填底價';
    opt.textContent = `${productKey(p)}｜${p.Category || '-'}｜${price}`;
    sel.appendChild(opt);
  });
  document.getElementById('q-addon-count').textContent = list.length ? `列出 ${list.length} 筆${list.length === 60 ? '（最多 60 筆，請輸入關鍵字縮小範圍）' : ''}` : '找不到符合的產品；可用下方「手動新增」';
}

function addQuoteAddonFromProduct() {
  const name = val('q-addon-pick');
  if (!name) return alert('請先在清單選一個產品（可輸入關鍵字搜尋）');
  quoteState.addons.push({ id: Date.now(), name, base: '', qty: 1, product: true });
  saveQuoteState();
  renderQuotePanel();
}

function addQuoteAddonManual() {
  const name = val('q-man-name').trim();
  if (!name) return alert('請輸入品名');
  const base = parseFloat(val('q-man-price'));
  quoteState.addons.push({ id: Date.now(), name, base: isNaN(base) ? '' : base, qty: parseFloat(val('q-man-qty')) || 1, product: false });
  ['q-man-name', 'q-man-price'].forEach((id) => (document.getElementById(id).value = ''));
  document.getElementById('q-man-qty').value = '1';
  saveQuoteState();
  renderQuotePanel();
}

function clearQuoteState() {
  quoteState = { qty: {}, price: {}, addons: [] };
  saveQuoteState();
  renderQuotePanel();
}

function quoteRows() {
  const mult = quoteMultiplier();
  return quoteLines()
    .map((l) => {
      const base = lineBase(l);
      const hasBase = !isNaN(base) && base > 0;
      const unit = hasBase ? base * mult : 0;
      return { name: `${l.label}：${l.name}`, base: hasBase ? base : 0, list: hasBase ? base * 2 : 0, unit, qty: Number(l.qty) || 0, sub: unit * (Number(l.qty) || 0), hasBase };
    })
    .filter((r) => r.qty > 0);
}

async function copyQuoteText() {
  const rows = quoteRows();
  if (!rows.length) return alert('目前沒有任何品項');
  const total = rows.reduce((s, r) => s + r.sub, 0);
  const lines = [`【價格試算】${val('q-customer') || ''}（${quoteTypeLabel()}）`];
  rows.forEach((r) => lines.push(`${r.name}　${r.hasBase ? r.unit.toFixed(2) : '缺底價'} × ${r.qty} = ${r.hasBase ? r.sub.toFixed(2) : '-'}`));
  lines.push(`總計：${total.toFixed(2)}`);
  try {
    await navigator.clipboard.writeText(lines.join('\n'));
    alert('已複製報價明細');
  } catch (e) {
    prompt('請手動複製：', lines.join('\n'));
  }
}

async function generateCalcQuote() {
  const rows = quoteRows();
  if (!rows.length) return alert('目前沒有任何品項');
  const missing = rows.filter((r) => !r.hasBase).length;
  if (missing && !confirm(`有 ${missing} 項沒有底價（金額會是 0），確定要輸出嗎？`)) return;
  const total = rows.reduce((s, r) => s + r.sub, 0);
  const result = await callApi('generateQuoteDoc', {
    customerName: val('q-customer'),
    quoteType: quoteTypeLabel(),
    format: val('q-format') || 'html',
    items: rows.map((r) => ({ name: r.name, basePrice: r.base.toFixed(2), listPrice: r.list.toFixed(2), unitPrice: r.unit.toFixed(2), quantity: r.qty, subtotal: r.sub.toFixed(2) })),
    total: total.toFixed(2),
  });
  if (!result.success) return alert(result.message);
  openPreviewModal([Object.assign({}, result, { label: '報價單' })]);
}

window.addEventListener('DOMContentLoaded', () => {
  loadQuoteState();
  refreshAddonPick();
  renderQuotePanel();
});
