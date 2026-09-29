/**
 * quote.js - 報價系統 頁面專屬邏輯
 */

let quoteItems = [];

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

let quoteModelSearchTimer = null;
function onQuoteModelInput() {
  clearTimeout(quoteModelSearchTimer);
  const keyword = document.getElementById('qi-internal-model').value.trim();
  const box = document.getElementById('qi-model-suggestions');

  if (!keyword) {
    box.style.display = 'none';
    box.innerHTML = '';
    return;
  }

  quoteModelSearchTimer = setTimeout(async () => {
    const result = await callApi('searchProducts', { keyword });
    if (!result.success || !result.products.length) {
      box.style.display = 'none';
      return;
    }
    box.innerHTML = '';
    result.products.slice(0, 8).forEach((p) => {
      const div = document.createElement('div');
      div.className = 'suggestion-item';
      div.textContent = `${p.InternalModel}｜${p.SupplierModel || ''}｜${p.Supplier || ''}`;
      div.onclick = () => selectQuoteModelSuggestion(p.InternalModel);
      box.appendChild(div);
    });
    box.style.display = 'block';
  }, 300);
}

async function selectQuoteModelSuggestion(internalModel) {
  document.getElementById('qi-internal-model').value = internalModel;
  document.getElementById('qi-model-suggestions').style.display = 'none';
  await fillQuoteItemFromProduct();
}

async function fillQuoteItemFromProduct() {
  const internalModel = document.getElementById('qi-internal-model').value.trim();
  if (!internalModel) return;
  const result = await callApi('getProduct', { internalModel });
  if (!result.success) return alert(result.message);
  document.getElementById('qi-name').value = result.product.InternalModel + '（' + (result.product.SupplierModel || '') + '）';
  document.getElementById('qi-base-price').value = result.product.RefPrice || '';
  syncFromBasePrice();
}

function addQuoteItem() {
  const name = document.getElementById('qi-name').value.trim();
  const basePrice = parseFloat(document.getElementById('qi-base-price').value);
  const quantity = parseFloat(document.getElementById('qi-quantity').value) || 1;
  if (!name || isNaN(basePrice)) return alert('請輸入品名與底價');

  quoteItems.push({ name, basePrice, quantity });
  ['qi-internal-model', 'qi-name', 'qi-base-price', 'qi-list-price'].forEach((id) => (document.getElementById(id).value = ''));
  document.getElementById('qi-quantity').value = '1';
  document.getElementById('qi-preview-price').textContent = '-';
  renderQuoteTable();
}

function removeQuoteItem(index) {
  quoteItems.splice(index, 1);
  renderQuoteTable();
}

function clearQuote() {
  quoteItems = [];
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

  head.innerHTML = fieldMode
    ? '<tr><th>品名</th><th>報價</th><th>數量</th><th>小計</th><th></th></tr>'
    : '<tr><th>品名</th><th>底價</th><th>牌價</th><th>報價</th><th>數量</th><th>小計</th><th></th></tr>';

  tbody.innerHTML = '';
  let total = 0;
  rows.forEach((r, i) => {
    total += r.subtotal;
    const tr = document.createElement('tr');
    tr.innerHTML = fieldMode
      ? `<td>${r.name}</td><td>${r.unitPrice.toFixed(2)}</td><td>${r.quantity}</td><td>${r.subtotal.toFixed(2)}</td><td><button onclick="removeQuoteItem(${i})">刪除</button></td>`
      : `<td>${r.name}</td><td>${r.basePrice.toFixed(2)}</td><td>${r.listPrice.toFixed(2)}</td><td>${r.unitPrice.toFixed(2)}</td><td>${r.quantity}</td><td>${r.subtotal.toFixed(2)}</td><td><button onclick="removeQuoteItem(${i})">刪除</button></td>`;
    tbody.appendChild(tr);
  });

  document.getElementById('quote-total').textContent = total.toFixed(2);
}

async function generateQuoteDoc() {
  const customerName = document.getElementById('quote-customer-name').value;
  const format = document.getElementById('quote-format').value;
  const rows = computeQuoteRows();
  if (!rows.length) return alert('報價單目前沒有任何品項');

  const total = rows.reduce((sum, r) => sum + r.subtotal, 0);
  const result = await callApi('generateQuoteDoc', {
    customerName,
    quoteType: getQuoteTypeLabel(),
    format,
    items: rows.map((r) => ({
      name: r.name,
      basePrice: r.basePrice.toFixed(2),
      listPrice: r.listPrice.toFixed(2),
      unitPrice: r.unitPrice.toFixed(2),
      quantity: r.quantity,
      subtotal: r.subtotal.toFixed(2),
    })),
    total: total.toFixed(2),
  });

  if (!result.success) return alert(result.message);
  openPreviewModal([Object.assign({}, result, { label: '報價單' })]);
}

window.addEventListener('DOMContentLoaded', () => {
  requireLogin();
  renderHeaderUser();
  renderQuoteTable();
  bindEnterSubmit('#quote-item-panel', addQuoteItem);
});
