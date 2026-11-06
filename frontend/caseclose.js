/**
 * caseclose.js - 案件「結案」：取消 / 完成訂單
 * 完成訂單：填成交金額；也可以先選訂購的產品與數量，單價會依產品底價 × 報價倍數自動帶入，金額自動加總（都可以手動改）。
 * 存檔後案件狀態變「已結案」，客戶自動標成已交易，並留一筆聯繫紀錄。
 */

let closeCaseId = '';
let closeCaseCustomer = '';
let closeItems = []; // { id, name, quantity, unitPrice }
let closeItemSeq = 0;
let closeAmountManual = false; // 金額被手動改過，就不再自動加總
let closeProducts = {}; // 型號（大寫）→ 產品
let closeProductsLoaded = false;

function ccFmt(n) {
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/** 列表狀態欄、案件詳情用：結案結果的小字（沒結案就是空字串）。 */
function closeInfoHtml(c) {
  if (!c || c.Status !== '已結案' || !c.CloseResult) return '';
  const won = c.CloseResult === '完成訂單';
  const amt = won && Number(c.CloseAmount) > 0 ? ' NT$ ' + ccFmt(c.CloseAmount) : '';
  const color = won ? '#27ae60' : '#7f8c8d';
  return `<div style="font-size:12px;color:${color};font-weight:bold;">${htmlEsc(c.CloseResult)}${htmlEsc(amt)}${c.CloseDate ? '（' + htmlEsc(c.CloseDate) + '）' : ''}</div>`;
}

function closeDetailText(c) {
  if (!c || c.Status !== '已結案' || !c.CloseResult) return '';
  let items = [];
  try {
    items = JSON.parse(c.OrderItems || '[]');
  } catch (e) {
    items = [];
  }
  const parts = [`結案結果：${c.CloseResult}`];
  if (c.CloseResult === '完成訂單' && Number(c.CloseAmount) > 0) parts.push(`成交金額 NT$ ${ccFmt(c.CloseAmount)}`);
  if (c.CloseDate) parts.push(c.CloseDate);
  let text = parts.join('　');
  if (items.length) text += '\n訂購：' + items.map((it) => `${it.name} × ${it.quantity}（單價 ${ccFmt(it.unitPrice)}）`).join('、');
  if (c.CloseNote) text += '\n備註：' + c.CloseNote;
  return text;
}

async function loadCloseProducts() {
  if (closeProductsLoaded) return;
  closeProductsLoaded = true;
  try {
    let list = await getCachedAsync('products_all');
    if (!list) {
      const r = await callApi('searchProducts', { keyword: '' }, { silent: true });
      if (r && r.success) {
        list = r.products;
        setCached('products_all', list);
      }
    }
    closeProducts = {};
    const dl = document.getElementById('cc-product-list');
    dl.innerHTML = '';
    (list || []).forEach((p) => {
      const key = String(p.InternalModel || p.SupplierModel || '').trim();
      if (!key) return;
      closeProducts[key.toUpperCase()] = p;
      const opt = document.createElement('option');
      opt.value = key;
      if (p.SupplierModel && p.SupplierModel !== key) opt.label = p.SupplierModel;
      dl.appendChild(opt);
    });
  } catch (e) {
    // 沒有產品權限或讀取失敗：照樣可以手動輸入品名與單價
  }
}

function closeMultiplier() {
  const sel = document.getElementById('cc-multiplier').value;
  if (sel === 'custom') {
    const v = parseFloat(document.getElementById('cc-multiplier-custom').value);
    return isNaN(v) || v <= 0 ? 0 : v;
  }
  return parseFloat(sel);
}

function onCloseMultiplierChange() {
  document.getElementById('cc-multiplier-custom').style.display = document.getElementById('cc-multiplier').value === 'custom' ? '' : 'none';
  // 倍數換了：還沒被手動改過單價的品項重新帶入
  closeItems.forEach((it) => {
    if (!it.priceManual) autoPriceItem(it);
  });
  renderCloseItems();
}

function autoPriceItem(it) {
  const p = closeProducts[String(it.name || '').trim().toUpperCase()];
  const base = p ? parseFloat(p.RefPrice) : NaN;
  const m = closeMultiplier();
  if (p && base > 0 && m > 0) it.unitPrice = Math.round(base * m * 100) / 100;
}

function openCloseCase(caseId) {
  const c = (typeof renderedCases !== 'undefined' ? renderedCases : []).find((x) => x.CaseID === caseId);
  closeCaseId = caseId;
  closeCaseCustomer = c ? c.CustomerName : document.getElementById('cd-customer') ? document.getElementById('cd-customer').value : '';
  document.getElementById('cc-case').textContent = caseId;
  document.querySelector('input[name="cc-result"][value="won"]').checked = true;
  document.getElementById('cc-amount').value = '';
  document.getElementById('cc-note').value = '';
  closeAmountManual = false;
  closeItems = [];
  // 報價倍數預設：設備商 1.3、其他 1.5（跟報價系統一樣）
  const cust = (typeof allCustomersForCase !== 'undefined' ? allCustomersForCase : []).find((x) => x.CompanyName === closeCaseCustomer);
  document.getElementById('cc-multiplier').value = cust && cust.Category === '機構合作設備商' ? '1.3' : '1.5';
  document.getElementById('cc-multiplier-custom').style.display = 'none';
  onCloseResultChange();
  renderCloseItems();
  document.getElementById('case-close-modal').style.display = 'flex';
  loadCloseProducts();
}

function closeCloseModal() {
  document.getElementById('case-close-modal').style.display = 'none';
}

function onCloseResultChange() {
  const won = document.querySelector('input[name="cc-result"]:checked').value === 'won';
  document.getElementById('cc-won-box').style.display = won ? '' : 'none';
  document.getElementById('cc-save-btn').textContent = won ? '確認結案（完成訂單）' : '確認結案（取消）';
}

function addCloseItem() {
  closeItems.push({ id: ++closeItemSeq, name: '', quantity: 1, unitPrice: '', priceManual: false });
  renderCloseItems();
}

function removeCloseItem(id) {
  closeItems = closeItems.filter((it) => it.id !== id);
  renderCloseItems();
}

function onCloseItemName(id, v) {
  const it = closeItems.find((x) => x.id === id);
  if (!it) return;
  it.name = v;
  it.priceManual = false;
  autoPriceItem(it);
  renderCloseItems();
}

function onCloseItemQty(id, v) {
  const it = closeItems.find((x) => x.id === id);
  if (!it) return;
  it.quantity = v;
  syncCloseAmount();
  updateCloseSubtotal(id);
}

function onCloseItemPrice(id, v) {
  const it = closeItems.find((x) => x.id === id);
  if (!it) return;
  it.unitPrice = v;
  it.priceManual = true;
  syncCloseAmount();
  updateCloseSubtotal(id);
}

function closeItemSubtotal(it) {
  const q = parseFloat(it.quantity);
  const p = parseFloat(it.unitPrice);
  return q > 0 && p >= 0 ? Math.round(q * p * 100) / 100 : 0;
}

function updateCloseSubtotal(id) {
  const it = closeItems.find((x) => x.id === id);
  const el = document.getElementById('cc-sub-' + id);
  if (it && el) el.textContent = ccFmt(closeItemSubtotal(it));
}

/** 品項有變、金額又沒被手動改過 → 金額自動 = 各品項小計加總。 */
function syncCloseAmount() {
  const sum = closeItems.reduce((s, it) => s + closeItemSubtotal(it), 0);
  const box = document.getElementById('cc-items-total');
  box.textContent = closeItems.length ? '品項合計 NT$ ' + ccFmt(sum) : '';
  if (!closeAmountManual && sum > 0) document.getElementById('cc-amount').value = String(Math.round(sum * 100) / 100);
}

function onCloseAmountInput() {
  closeAmountManual = document.getElementById('cc-amount').value.trim() !== '';
}

function renderCloseItems() {
  const box = document.getElementById('cc-items');
  box.innerHTML = closeItems
    .map((it) => {
      const miss = it.name && !closeProducts[String(it.name).trim().toUpperCase()] && closeProductsLoaded && Object.keys(closeProducts).length ? '<div class="calc-hint" style="margin:0;">產品庫沒有這個型號，請手動填單價</div>' : '';
      return `<div class="cc-item">
        <input list="cc-product-list" placeholder="產品型號（可直接選）" value="${htmlEsc(it.name)}" onchange="onCloseItemName(${it.id}, this.value)" style="flex:3;min-width:140px;" />
        <input type="number" min="1" step="1" value="${htmlEsc(it.quantity)}" oninput="onCloseItemQty(${it.id}, this.value)" style="width:70px;" title="數量" />
        <input type="number" min="0" step="0.01" placeholder="單價" value="${htmlEsc(it.unitPrice)}" oninput="onCloseItemPrice(${it.id}, this.value)" style="width:110px;" title="單價（依底價 × 倍數自動帶入，可改）" />
        <span class="cc-sub">小計 <b id="cc-sub-${it.id}">${ccFmt(closeItemSubtotal(it))}</b></span>
        <button type="button" class="btn-mini" onclick="removeCloseItem(${it.id})">移除</button>
        ${miss}
      </div>`;
    })
    .join('');
  syncCloseAmount();
}

async function saveCloseCase() {
  const won = document.querySelector('input[name="cc-result"]:checked').value === 'won';
  const note = document.getElementById('cc-note').value.trim();
  const body = { caseId: closeCaseId, result: won ? 'won' : 'cancelled', note };
  if (won) {
    const amount = parseFloat(String(document.getElementById('cc-amount').value).replace(/,/g, ''));
    if (!(amount > 0)) return alert('完成訂單請填成交金額（大於 0）');
    body.amount = amount;
    body.items = closeItems
      .filter((it) => String(it.name).trim())
      .map((it) => ({ name: String(it.name).trim(), quantity: parseFloat(it.quantity) || 1, unitPrice: parseFloat(it.unitPrice) || 0 }));
  }
  const label = won ? `完成訂單，成交金額 NT$ ${ccFmt(body.amount)}` : '取消';
  if (!confirm(`確定要把案件「${closeCaseId}」結案嗎？\n結果：${label}${won ? '\n客戶「' + closeCaseCustomer + '」會自動標成已交易。' : ''}`)) return;
  const r = await callApi('closeCase', body);
  if (!r.success) return alert(r.message);
  closeCloseModal();
  clearCached('casesPageData');
  clearCached('customers');
  alert(won ? '已結案：完成訂單' + (r.markedTransacted ? '，客戶已標成已交易' : '') : '已結案：取消');
  await loadCases();
  if (typeof currentCaseId !== 'undefined' && currentCaseId === closeCaseId && typeof viewCase === 'function') viewCase(closeCaseId);
}
