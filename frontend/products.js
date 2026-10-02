/**
 * products.js - 產品搜尋 / 詢價 頁面專屬邏輯
 * 依賴 common.js 的 callApi() / 預覽彈窗 / Enter送出小工具，記得那支檔案要先載入。
 */

let currentInternalModel = null;
let favoriteSet = new Set(); // 我的常用型號
let currentProductRow = null; // 內部型號還沒填的產品用列號辨識
const STALE_DAYS = 90; // 超過這天數沒更新/詢價，就提醒可以考慮重新向原廠詢價

function toggleNewProductForm() {
  const form = document.getElementById('new-product-form');
  form.style.display = form.style.display === 'block' ? 'none' : 'block';
}

function syncProductPriceFromBase(prefix) {
  const base = parseFloat(document.getElementById(prefix + '-ref-price').value);
  if (!isNaN(base)) document.getElementById(prefix + '-list-price').value = (base * 2).toFixed(2);
}

function syncProductPriceFromList(prefix) {
  const list = parseFloat(document.getElementById(prefix + '-list-price').value);
  if (!isNaN(list)) document.getElementById(prefix + '-ref-price').value = (list / 2).toFixed(2);
}

async function addProduct() {
  const result = await callApi('addProduct', {
    internalModel: document.getElementById('np-internal-model').value.trim(),
    supplierModel: document.getElementById('np-supplier-model').value,
    supplier: document.getElementById('np-supplier').value,
    supplierContact: document.getElementById('np-supplier-contact').value,
    supplierContactEmail: document.getElementById('np-supplier-email').value,
    origin: document.getElementById('np-origin').value,
    category: document.getElementById('np-category').value,
    compatibleGroup: document.getElementById('np-compatible-group').value,
    refPrice: document.getElementById('np-ref-price').value,
    notes: document.getElementById('np-notes').value,
  });
  if (!result.success) return alert(result.message);
  clearCached('products_all');
  alert('已新增產品');
  document.getElementById('new-product-form').style.display = 'none';
  ['np-internal-model', 'np-supplier-model', 'np-supplier', 'np-supplier-contact', 'np-supplier-email', 'np-origin', 'np-compatible-group', 'np-ref-price', 'np-list-price', 'np-notes'].forEach(
    (id) => (document.getElementById(id).value = '')
  );
  searchProducts();
}

// ------------------------------------------------------------
// 產品搜尋：一進頁面把全部產品抓回來，之後打字都在瀏覽器本機即時篩選（不用每打一個字就打一次後端），
// 結果依相符程度排序，並分頁顯示（每頁 10/20/30 筆，選擇會記住）
// ------------------------------------------------------------
const PAGE_SIZE_KEY = 'aoi_product_page_size';
let allProducts = [];
let filteredProducts = [];
let productPage = 1;

/** 從後端重新抓全部產品（新增/修改/刪除產品後也呼叫這個）。 */
async function searchProducts() {
  const cached = getCached('products_all');
  if (cached) {
    allProducts = cached;
    applyProductFilter();
  }

  const result = await callApi('searchProducts', { keyword: '' });
  if (!result.success) return alert(result.message);
  allProducts = result.products;
  setCached('products_all', allProducts);
  applyProductFilter(true);
}

function onProductSearchInput() {
  productPage = 1;
  applyProductFilter();
}

/**
 * 相符程度分數，越小越前面：
 * 0 = 內部/供應商型號完全相同、1 = 型號開頭相符、2 = 型號包含關鍵字、3 = 其他欄位包含
 * 多個關鍵字用空白隔開，必須全部都有對到（AND），分數取最差的那個。
 */
function productMatchScore(p, keywords) {
  const models = [p.InternalModel, p.SupplierModel].map((v) => String(v || '').toLowerCase());
  const others = [p.Supplier, p.Category, p.Origin, p.CompatibleGroup, p.SupplierContact, p.Notes].map((v) => String(v || '').toLowerCase());
  let worst = 0;
  for (const kw of keywords) {
    let score;
    if (models.some((m) => m === kw)) score = 0;
    else if (models.some((m) => m.startsWith(kw))) score = 1;
    else if (models.some((m) => m.includes(kw))) score = 2;
    else if (others.some((o) => o.includes(kw))) score = 3;
    else return -1;
    worst = Math.max(worst, score);
  }
  return worst;
}

/** keepPage = true：背景資料更新時保留目前頁碼（超出範圍會自動拉回最後一頁）。 */
function applyProductFilter(keepPage) {
  const keywords = document.getElementById('product-search-input').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const byModel = (a, b) => String(a.InternalModel || '').localeCompare(String(b.InternalModel || ''));

  const onlyIncomplete = document.getElementById('product-only-incomplete').checked;
  const onlyFav = document.getElementById('product-only-fav').checked;
  let pool = onlyIncomplete ? allProducts.filter((p) => productIssues(p).length) : allProducts;
  if (onlyFav) pool = pool.filter((p) => favoriteSet.has(String(p.InternalModel)));
  if (!keywords.length) {
    filteredProducts = pool.slice().sort(byModel);
  } else {
    filteredProducts = pool
      .map((p) => ({ p, score: productMatchScore(p, keywords) }))
      .filter((x) => x.score > -1)
      .sort((a, b) => a.score - b.score || byModel(a.p, b.p))
      .map((x) => x.p);
  }
  // 有點欄位標題排序的話，照該欄位排（同值時維持上面的相符程度順序）
  if (productSort.key) {
    const dir = productSort.dir === 'desc' ? -1 : 1;
    filteredProducts.sort((a, b) => dir * compareProductField(a, b, productSort.key));
  }
  if (!keepPage) productPage = 1;
  renderProductPage();
}

// ------------------------------------------------------------
// 點表頭排序：第一次點 → 文字欄位由小到大、數字欄位(底價/詢價次數)由大到小；
// 再點一次反過來；第三次點取消，回到「相符程度」排序。選擇會記住。
// ------------------------------------------------------------
const PRODUCT_SORT_KEY = 'aoi_product_sort';
const NUMERIC_SORT_FIELDS = ['RefPrice', 'InquiryCount'];
let productSort = { key: null, dir: 'asc' };

function compareProductField(a, b, key) {
  if (NUMERIC_SORT_FIELDS.includes(key)) {
    const x = parseFloat(a[key]);
    const y = parseFloat(b[key]);
    // 沒填的一律排最後
    if (isNaN(x) && isNaN(y)) return 0;
    if (isNaN(x)) return productSort.dir === 'desc' ? -1 : 1;
    if (isNaN(y)) return productSort.dir === 'desc' ? 1 : -1;
    return x - y;
  }
  return String(a[key] || '').localeCompare(String(b[key] || ''), 'zh-Hant');
}

function onProductSortClick(key) {
  const firstDir = NUMERIC_SORT_FIELDS.includes(key) ? 'desc' : 'asc';
  if (productSort.key !== key) {
    productSort = { key, dir: firstDir };
  } else if (productSort.dir === firstDir) {
    productSort.dir = firstDir === 'asc' ? 'desc' : 'asc';
  } else {
    productSort = { key: null, dir: 'asc' };
  }
  try {
    localStorage.setItem(PRODUCT_SORT_KEY, JSON.stringify(productSort));
  } catch (e) {}
  renderSortIndicators();
  applyProductFilter();
}

function renderSortIndicators() {
  document.querySelectorAll('#product-table th.sortable').forEach((th) => {
    th.classList.remove('asc', 'desc');
    if (th.dataset.sort === productSort.key) th.classList.add(productSort.dir);
  });
}

function getProductPageSize() {
  return parseInt(document.getElementById('product-page-size').value, 10) || 10;
}

function onProductPageSizeChange() {
  try {
    localStorage.setItem(PAGE_SIZE_KEY, document.getElementById('product-page-size').value);
  } catch (e) {}
  productPage = 1;
  renderProductPage();
}

function goProductPage(page) {
  productPage = page;
  renderProductPage();
}

function renderProductPage() {
  const size = getProductPageSize();
  const total = filteredProducts.length;
  const totalPages = Math.max(1, Math.ceil(total / size));
  productPage = Math.min(Math.max(1, productPage), totalPages);

  const start = (productPage - 1) * size;
  renderProductTable(filteredProducts.slice(start, start + size));

  const incompleteCount = allProducts.filter((p) => productIssues(p).length).length;
  document.getElementById('product-alert').textContent = incompleteCount ? `⚠ 有 ${incompleteCount} 筆產品資料不完整（缺內部型號/底價/供應商/詢價信箱），請補齊；勾「只看資料不完整的」可以只看這些` : '';
  document.getElementById('product-page-info').textContent = total
    ? `共 ${total} 筆，顯示第 ${start + 1}–${Math.min(start + size, total)} 筆`
    : '查無符合的產品';
  document.getElementById('product-page-label').textContent = `${productPage} / ${totalPages}`;
  document.getElementById('product-page-first').disabled = productPage <= 1;
  document.getElementById('product-page-prev').disabled = productPage <= 1;
  document.getElementById('product-page-next').disabled = productPage >= totalPages;
  document.getElementById('product-page-last').disabled = productPage >= totalPages;
  document.getElementById('product-page-last').dataset.page = totalPages;
}

function renderProductTable(products) {
  const tbody = document.querySelector('#product-table tbody');
  tbody.innerHTML = '';
  products.forEach((p) => {
    const tr = document.createElement('tr');
    const isFav = favoriteSet.has(String(p.InternalModel));
    tr.innerHTML = `<td>${p.InternalModel ? `<button class="fav-star ${isFav ? '' : 'off'}" title="${isFav ? '取消常用' : '加入常用'}" onclick="toggleFavorite('${String(p.InternalModel).replace(/'/g, "\\'")}')">${isFav ? '★' : '☆'}</button>` : ''}</td><td>${p.InternalModel || '<span class="badge-warn">（缺內部型號）</span>'}</td><td>${p.SupplierModel || ''}</td><td>${p.Supplier || ''}</td><td>${p.Category || ''}</td><td>${p.RefPrice || '<span class="badge-warn">無</span>'}</td><td>${p.InquiryCount || 0}</td><td>${productAlertHtml(p)}</td><td>${p.Notes || ''}</td>
      <td><button onclick="viewProduct('${String(p.InternalModel || '').replace(/'/g, "\\'")}', ${p.RowIndex})">查看/詢價</button></td>`;
    tbody.appendChild(tr);
  });
}

async function viewProduct(internalModel, rowIndex) {
  const result = await callApi('getProduct', rowIndex ? { rowIndex } : { internalModel });
  if (!result.success) return alert(result.message);
  internalModel = result.product.InternalModel || '';
  currentInternalModel = internalModel;
  currentProductRow = result.product.RowIndex;

  document.getElementById('product-detail').style.display = 'block';
  document.getElementById('edit-product-form').style.display = 'none';
  document.getElementById('pd-internal-model').textContent = internalModel || '（缺內部型號，請按「編輯此產品」補上）';
  document.getElementById('pd-alerts').innerHTML = productAlertHtml(result.product, true);
  document.getElementById('ep-internal-model').value = internalModel;

  document.getElementById('pd-last-price').innerHTML = result.lastPrice
    ? `上次報價：${result.lastPrice.Price} ${result.lastPrice.Currency || ''}（供應商：${result.lastPrice.Supplier}，日期：${result.lastPrice.Date}）`
    : '尚無詢價紀錄';

  document.getElementById('pd-compatible').innerHTML =
    '可搭配產品：' + (result.compatibleProducts.length ? result.compatibleProducts.map((p) => p.InternalModel).join('、') : '無');

  document.getElementById('pd-notes').innerHTML = '備註：' + (result.product.Notes || '（無）') + (result.product.Origin ? '｜產地：' + result.product.Origin : '');
  if (result.product.SourceUrl) {
    const link = document.createElement('a');
    link.href = result.product.SourceUrl;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = '官網規格頁';
    document.getElementById('pd-notes').append('｜資料來源：', link);
  }

  document.getElementById('inquiry-result').textContent = '';

  document.getElementById('ep-supplier-model').value = result.product.SupplierModel || '';
  document.getElementById('ep-supplier').value = result.product.Supplier || '';
  document.getElementById('ep-supplier-contact').value = result.product.SupplierContact || '';
  document.getElementById('ep-supplier-email').value = result.product.SupplierContactEmail || '';
  document.getElementById('ep-origin').value = result.product.Origin || '';
  document.getElementById('ep-category').value = result.product.Category || '相機';
  document.getElementById('ep-compatible-group').value = result.product.CompatibleGroup || '';
  document.getElementById('ep-ref-price').value = result.product.RefPrice || '';
  document.getElementById('ep-list-price').value = result.product.RefPrice ? (parseFloat(result.product.RefPrice) * 2).toFixed(2) : '';
  document.getElementById('ep-notes').value = result.product.Notes || '';

  renderPriceHistoryTable(result.priceHistory || []);
}

function renderPriceHistoryTable(history) {
  const tbody = document.querySelector('#price-history-table tbody');
  tbody.innerHTML = '';
  history.forEach((h) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${h.Date}</td><td>${h.Supplier}</td><td>${h.Price}</td><td>${h.Currency || ''}</td><td>${h.Notes || ''}</td>
      <td>
        <button onclick="editPriceRecord(${h.RowIndex})">編輯</button>
        <button onclick="deletePriceRecord(${h.RowIndex})">刪除</button>
      </td>`;
    tbody.appendChild(tr);
  });
}

async function editPriceRecord(rowIndex) {
  const newPrice = prompt('輸入新的價格：');
  if (newPrice === null) return;
  const result = await callApi('updatePriceRecord', { rowIndex, fields: { Price: newPrice } });
  if (result.success) {
    viewProduct(currentInternalModel, currentProductRow);
  } else {
    alert(result.message);
  }
}

async function deletePriceRecord(rowIndex) {
  if (!confirm('確定要刪除這筆價格紀錄嗎？')) return;
  const result = await callApi('deletePriceRecord', { rowIndex });
  if (result.success) {
    viewProduct(currentInternalModel, currentProductRow);
    searchProducts(); // 詢價次數跟著更新
  } else {
    alert(result.message);
  }
}

function toggleEditProductForm() {
  const form = document.getElementById('edit-product-form');
  form.style.display = form.style.display === 'block' ? 'none' : 'block';
}

async function saveProductEdit() {
  const newModel = document.getElementById('ep-internal-model').value.trim();
  if (!newModel) return alert('內部型號不能空白，請補上（或用別的欄位確認後再補）');
  const fields = {
    InternalModel: newModel,
    SupplierModel: document.getElementById('ep-supplier-model').value,
    Supplier: document.getElementById('ep-supplier').value,
    SupplierContact: document.getElementById('ep-supplier-contact').value,
    SupplierContactEmail: document.getElementById('ep-supplier-email').value,
    Origin: document.getElementById('ep-origin').value,
    Category: document.getElementById('ep-category').value,
    CompatibleGroup: document.getElementById('ep-compatible-group').value,
    RefPrice: document.getElementById('ep-ref-price').value,
    Notes: document.getElementById('ep-notes').value,
  };
  const result = await callApi('updateProduct', { rowIndex: currentProductRow, internalModel: currentInternalModel, fields });
  if (result.success) {
    clearCached('products_all');
    alert('已儲存修改');
    currentInternalModel = newModel;
    viewProduct(currentInternalModel, currentProductRow);
    searchProducts();
  } else {
    alert(result.message);
  }
}

async function deleteCurrentProduct() {
  if (!confirm(`確定要刪除產品「${currentInternalModel}」嗎？此動作無法復原。`)) return;
  const result = await callApi('deleteProduct', { rowIndex: currentProductRow, internalModel: currentInternalModel });
  if (result.success) {
    clearCached('products_all');
    document.getElementById('product-detail').style.display = 'none';
    searchProducts();
  } else {
    alert(result.message);
  }
}

async function addPriceRecord() {
  if (!currentInternalModel) return alert('這個產品還沒有內部型號，請先按「編輯此產品」補上內部型號才能存價格紀錄');
  const supplier = document.getElementById('pd-supplier').value;
  const price = document.getElementById('pd-price').value;
  const caseId = document.getElementById('pd-case').value;
  const result = await callApi('addPriceRecord', { internalModel: currentInternalModel, supplier, price, caseId });
  if (result.success) {
    alert('已存入價格紀錄');
    viewProduct(currentInternalModel, currentProductRow);
    searchProducts(); // 詢價次數跟著更新
  } else {
    alert(result.message);
  }
}

async function generateInquiry() {
  if (!currentInternalModel) return alert('這個產品還沒有內部型號，請先補上內部型號');
  const quantity = document.getElementById('pd-quantity').value;
  const result = await callApi('generateInquiryDraft', { internalModel: currentInternalModel, quantity });
  if (!result.success) return alert(result.message);

  let text = `【主旨】${result.subject}\n\n${result.body}`;
  if (result.draftUrl) text += `\n\n(已自動建立 Gmail 草稿，點此開啟：${result.draftUrl})`;
  document.getElementById('inquiry-result').textContent = text;
}

// ---- 詢價暫存清單：可以累積多個產品，最後一次合併成一封詢價信；48小時後自動清空 ----
const INQUIRY_CART_KEY = 'aoi_inquiry_cart';
const CART_DURATION_MS = 48 * 60 * 60 * 1000;

function loadInquiryCart() {
  const raw = localStorage.getItem(INQUIRY_CART_KEY);
  if (!raw) return { items: [], expiresAt: null };
  const cart = JSON.parse(raw);
  if (cart.expiresAt && Date.now() > cart.expiresAt) {
    localStorage.removeItem(INQUIRY_CART_KEY);
    return { items: [], expiresAt: null };
  }
  return cart;
}

function saveInquiryCart(cart) {
  localStorage.setItem(INQUIRY_CART_KEY, JSON.stringify(cart));
}

async function addToInquiryCart() {
  if (!currentInternalModel) return alert('這個產品還沒有內部型號，請先按「編輯此產品」補上');
  const quantity = document.getElementById('pd-quantity').value || '1';
  const result = await callApi('getProduct', { internalModel: currentInternalModel });
  if (!result.success) return alert(result.message);

  const cart = loadInquiryCart();
  if (!cart.expiresAt) cart.expiresAt = Date.now() + CART_DURATION_MS;
  cart.items.push({
    internalModel: result.product.InternalModel,
    supplierModel: result.product.SupplierModel || '',
    supplierContactEmail: result.product.SupplierContactEmail || '',
    quantity,
  });
  saveInquiryCart(cart);
  renderInquiryCart();
  alert('已加入詢價暫存清單');
}

function renderInquiryCart() {
  const cart = loadInquiryCart();
  const box = document.getElementById('inquiry-cart-list');
  const status = document.getElementById('inquiry-cart-status');
  if (!box || !status) return;

  box.innerHTML = '';
  cart.items.forEach((it, idx) => {
    const div = document.createElement('div');
    div.className = 'preview-item';
    div.innerHTML = `<div class="preview-item-header"><span>${it.internalModel}（${it.supplierModel}）｜數量：${it.quantity}</span>
      <button onclick="removeFromInquiryCart(${idx})">移除</button></div>`;
    box.appendChild(div);
  });

  if (cart.expiresAt && cart.items.length) {
    const hoursLeft = Math.max(0, Math.round((cart.expiresAt - Date.now()) / 3600000));
    status.textContent = `目前 ${cart.items.length} 項，將於約 ${hoursLeft} 小時後自動清空（可手動延長或清空）`;
  } else {
    status.textContent = '目前沒有暫存的詢價項目';
  }
}

function removeFromInquiryCart(idx) {
  const cart = loadInquiryCart();
  cart.items.splice(idx, 1);
  if (!cart.items.length) cart.expiresAt = null;
  saveInquiryCart(cart);
  renderInquiryCart();
}

function extendInquiryCart() {
  const cart = loadInquiryCart();
  if (!cart.items.length) return alert('目前沒有項目可以延長');
  cart.expiresAt = Date.now() + CART_DURATION_MS;
  saveInquiryCart(cart);
  renderInquiryCart();
  alert('已延長 48 小時');
}

function clearInquiryCart() {
  if (!confirm('確定要清空詢價暫存清單嗎？')) return;
  localStorage.removeItem(INQUIRY_CART_KEY);
  renderInquiryCart();
  document.getElementById('inquiry-cart-result').textContent = '';
}

async function generateCombinedInquiryText() {
  const cart = loadInquiryCart();
  if (!cart.items.length) return alert('詢價清單是空的，請先在產品詳情頁按「加入詢價暫存清單」');

  const blocks = cart.items.map((it) => `供應商型號: ${it.supplierModel}\n對應內部型號: ${it.internalModel}\n需求數量: ${it.quantity}`);
  const text = '您好，\n\n想請教以下產品報價：\n' + blocks.join('\n---\n') + '\n\n麻煩協助報價，謝謝！';

  document.getElementById('inquiry-cart-result').textContent = text;

  const emails = [...new Set(cart.items.map((it) => it.supplierContactEmail).filter(Boolean))];
  if (emails.length === 1) {
    const result = await callApi('createGmailDraft', { to: emails[0], subject: '詢價（多項產品）', body: text });
    if (result.success && result.draftUrl) {
      document.getElementById('inquiry-cart-result').textContent += `\n\n(已自動建立 Gmail 草稿，點此開啟：${result.draftUrl})`;
    }
  }
}

// ------------------------------------------------------------
// 初始化
// ------------------------------------------------------------
window.addEventListener('DOMContentLoaded', async () => {
  if (!(await ensureAuth())) return;
  renderHeaderUser();
  applyAdminOnlyVisibility();
  try {
    const savedSize = localStorage.getItem(PAGE_SIZE_KEY);
    if (['10', '20', '30'].includes(savedSize)) document.getElementById('product-page-size').value = savedSize;
    const savedSort = JSON.parse(localStorage.getItem(PRODUCT_SORT_KEY) || 'null');
    if (savedSort && savedSort.key) productSort = savedSort;
  } catch (e) {}
  document.querySelectorAll('#product-table th.sortable').forEach((th) => {
    th.addEventListener('click', () => onProductSortClick(th.dataset.sort));
  });
  renderSortIndicators();
  if (new URL(location.href).searchParams.get('fav')) document.getElementById('product-only-fav').checked = true;
  await loadFavorites();
  searchProducts();
  renderInquiryCart();
  bindEnterSubmit('#new-product-form', addProduct);
  bindEnterSubmit('#edit-product-form', saveProductEdit);

  const searchInput = document.getElementById('product-search-input');
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onProductSearchInput();
    }
  });
});

// ------------------------------------------------------------
// 資料完整度提醒 + 上次修改日期（讓人自己判斷要不要再回原廠詢價）
// ------------------------------------------------------------
function productIssues(p) {
  const issues = [];
  if (!p.InternalModel) issues.push('缺內部型號');
  if (!p.RefPrice) issues.push('缺底價');
  if (!p.Supplier) issues.push('缺供應商');
  if (!p.SupplierContactEmail) issues.push('缺詢價信箱');
  return issues;
}

function daysSince(dateStr) {
  if (!dateStr) return null;
  const d = new Date(String(dateStr).slice(0, 10) + 'T00:00:00');
  if (isNaN(d)) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

/** 上次修改 / 上次詢價 的文字，超過 STALE_DAYS 天會標示建議重新詢價。 */
function productFreshness(p) {
  const upd = daysSince(p.LastUpdated);
  const inq = daysSince(p.LastInquiryDate);
  const updText = p.LastUpdated ? `上次修改 ${String(p.LastUpdated).slice(0, 10)}（${upd} 天前）` : '上次修改：未記錄';
  const inqText = p.LastInquiryDate ? `上次詢價 ${p.LastInquiryDate}（${inq} 天前）` : '尚未詢過價';
  const ages = [upd, inq].filter((x) => x !== null);
  const newest = ages.length ? Math.min(...ages) : null;
  const stale = newest === null || newest > STALE_DAYS;
  return { updText, inqText, stale, newest };
}

function productAlertHtml(p, detail) {
  const issues = productIssues(p);
  const f = productFreshness(p);
  let html = '';
  if (issues.length) html += `<span class="badge-warn">⚠ ${issues.join('、')}</span> `;
  html += `<span class="calc-hint">${f.updText}${detail ? '；' + f.inqText : ''}</span>`;
  if (f.stale) html += ` <span class="badge-warn">${f.newest === null ? '沒有任何更新/詢價紀錄' : `已超過 ${STALE_DAYS} 天沒更新`}，建議重新向原廠詢價</span>`;
  return html;
}

async function importCatalog() {
  if (!confirm('要把「選型計算」型錄（相機 / FA鏡頭 / 遠心鏡頭）讀進產品資料表嗎？\n只會新增還沒有的型號，已經有的不會動。型錄沒有價格，匯入後請補底價。')) return;
  const result = await callApi('importCatalogProducts', {});
  if (!result.success) return alert(result.message);
  alert(result.message);
  clearCached('products_all');
  searchProducts();
}

async function loadFavorites() {
  const result = await callApi('getFavorites', {});
  if (result.success) favoriteSet = new Set(result.favorites);
}

async function toggleFavorite(model) {
  const result = await callApi('toggleFavorite', { internalModel: model });
  if (!result.success) return alert(result.message);
  if (result.favorite) favoriteSet.add(String(model));
  else favoriteSet.delete(String(model));
  applyProductFilter(true);
}

async function importDehong() {
  if (!confirm('要從德鴻視覺官網（twdehong.com）抓遠心鏡頭、機器視覺鏡頭、光源、光源控制器的型號與規格嗎？只會新增還沒有的型號（約 1400 筆，需要 1～2 分鐘），不含價格，底價請自己詢價後填入。')) return;
  const result = await callApi('importDehongProducts', {});
  if (!result.success) return alert(result.message);
  alert(result.message);
  clearCached('products_all');
  clearCached('visionCatalog_v3');
  searchProducts();
}

async function dedupeData() {
  const NL = String.fromCharCode(10);
  const preview = await callApi('dedupeData', { apply: false });
  if (!preview.success) return alert(preview.message);
  const lines = preview.report.map((r) => `${r.sheet}：${r.groups} 組重複、可刪除 ${r.extra} 筆（例：${r.examples.join('、')}）`);
  if (preview.customerSuspects.length) {
    lines.push(NL + `客戶資料有 ${preview.customerSuspects.length} 組疑似重複（案件用公司名稱關聯，不自動合併，請到客戶管理自行確認）：` + NL + preview.customerSuspects.slice(0, 8).join(NL));
  }
  if (!preview.report.length) return alert(lines.length ? lines.join(NL) : '沒有發現重複的產品或型錄資料。');
  if (!confirm(lines.join(NL) + NL + NL + '要合併嗎？會保留資料最完整的那一筆，並把其他重複筆有填、而保留筆沒填的欄位補進去，其餘刪除。')) return;
  const done = await callApi('dedupeData', { apply: true });
  if (!done.success) return alert(done.message);
  alert(`已合併，刪除 ${done.removed} 筆重複資料。`);
  clearCached('products_all');
  clearCached('visionCatalog_v3');
  searchProducts();
}
