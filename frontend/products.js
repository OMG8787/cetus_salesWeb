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
    brand: document.getElementById('np-brand').value,
    interface: document.getElementById('np-interface').value,
    resolution: document.getElementById('np-resolution').value,
    pixelSize: document.getElementById('np-pixel').value,
    sensorSize: document.getElementById('np-sensor').value,
    fps: document.getElementById('np-fps').value,
    mount: document.getElementById('np-mount').value,
    focalLength: document.getElementById('np-focal').value,
    magnification: document.getElementById('np-mag').value,
    wd: document.getElementById('np-wd').value,
    dof: document.getElementById('np-dof').value,
    focusWd: document.getElementById('np-focuswd').value,
  });
  if (!result.success) return alert(result.message);
  clearCached('products_all');
  alert('已新增產品');
  document.getElementById('new-product-form').style.display = 'none';
  ['np-internal-model', 'np-supplier-model', 'np-supplier', 'np-supplier-contact', 'np-supplier-email', 'np-origin', 'np-compatible-group', 'np-ref-price', 'np-list-price', 'np-notes', 'np-brand', 'np-interface', 'np-resolution', 'np-pixel', 'np-sensor', 'np-fps', 'np-mount', 'np-focal', 'np-mag', 'np-wd', 'np-dof', 'np-focuswd'].forEach(
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

/** 類別 / 供應商下拉選項：依目前所有產品裡實際有的值產生（不重複、附筆數），保留原本的選擇。 */
function rebuildProductFilterOptions() {
  const build = (id, firstLabel, field) => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const keep = sel.value;
    const counts = new Map();
    allProducts.forEach((p) => {
      const v = String(p[field] || '').trim();
      if (v) counts.set(v, (counts.get(v) || 0) + 1);
    });
    const sig = [...counts.entries()].map(([k, n]) => k + n).join('|');
    if (sel.dataset.sig === sig) return;
    sel.dataset.sig = sig;
    sel.innerHTML = '<option value="">' + firstLabel + '</option>';
    [...counts.keys()].sort((a, b) => a.localeCompare(b)).forEach((v) => {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v + '（' + counts.get(v) + '）';
      sel.appendChild(opt);
    });
    if (counts.has(keep)) sel.value = keep;
  };
  build('product-cat-filter', '全部類別', 'Category');
  build('product-supplier-filter', '全部供應商', 'Supplier');
}

/** keepPage = true：背景資料更新時保留目前頁碼（超出範圍會自動拉回最後一頁）。 */
function applyProductFilter(keepPage) {
  rebuildProductFilterOptions();
  const keywords = document.getElementById('product-search-input').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const byModel = (a, b) => String(a.InternalModel || '').localeCompare(String(b.InternalModel || ''));

  const onlyIncomplete = document.getElementById('product-only-incomplete').checked;
  const onlyFav = document.getElementById('product-only-fav').checked;
  let pool = onlyIncomplete ? allProducts.filter((p) => productIssues(p).length) : allProducts;
  if (onlyFav) pool = pool.filter((p) => favoriteSet.has(String(p.InternalModel)));
  const catFilter = document.getElementById('product-cat-filter').value;
  const supFilter = document.getElementById('product-supplier-filter').value;
  if (catFilter) pool = pool.filter((p) => String(p.Category || '').trim() === catFilter);
  if (supFilter) pool = pool.filter((p) => String(p.Supplier || '').trim() === supFilter);
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

// ---- 批次刪除：用列號記住勾選，換頁/重新篩選也保留 ----
const selectedRows = new Set();

function updateBulkInfo() {
  const n = selectedRows.size;
  const info = document.getElementById('bulk-info');
  if (info) info.textContent = n ? '已選取 ' + n + ' 筆（目前篩選結果共 ' + filteredProducts.length + ' 筆）' : '批次刪除：勾選下方列左邊的方框，或按「全選目前篩選結果」（先用上面的搜尋把錯誤資料篩出來，例如輸入「尺寸图」）。';
  const btn = document.getElementById('bulk-delete-btn');
  if (btn) btn.textContent = n ? '刪除所選（' + n + '）' : '刪除所選';
}

function toggleRowSelect(rowIndex, checked) {
  if (checked) selectedRows.add(rowIndex);
  else selectedRows.delete(rowIndex);
  updateBulkInfo();
}

function bulkSelectFiltered() {
  filteredProducts.forEach((p) => selectedRows.add(p.RowIndex));
  updateBulkInfo();
  renderCurrentPage();
}

function bulkSelectPage() {
  document.querySelectorAll('#product-table tbody input[type=checkbox]').forEach((cb) => (cb.checked = true));
  const size = getProductPageSize();
  filteredProducts.slice((productPage - 1) * size, productPage * size).forEach((p) => selectedRows.add(p.RowIndex));
  updateBulkInfo();
}

function bulkClear() {
  selectedRows.clear();
  updateBulkInfo();
  renderCurrentPage();
}

function renderCurrentPage() {
  renderProductPage();
}

async function bulkDelete() {
  const n = selectedRows.size;
  if (!n) return alert('還沒有勾選任何產品');
  const byRow = new Map(allProducts.map((p) => [p.RowIndex, p]));
  const sample = [...selectedRows].slice(0, 12).map((r) => (byRow.get(r) ? byRow.get(r).InternalModel || byRow.get(r).SupplierModel : '#' + r));
  const NL = String.fromCharCode(10);
  if (!confirm('確定要刪除這 ' + n + ' 筆產品嗎？刪除後無法復原。' + NL + NL + '例如：' + NL + sample.join(NL) + (n > 12 ? NL + '…另外 ' + (n - 12) + ' 筆' : ''))) return;
  const r = await callApi('deleteProducts', { rowIndexes: [...selectedRows] });
  if (!r.success) return alert(r.message);
  selectedRows.clear();
  clearCached('products_all');
  clearCached('visionCatalog_v5');
  alert('已刪除 ' + r.deleted + ' 筆');
  await searchProducts();
}

function renderProductTable(products) {
  const tbody = document.querySelector('#product-table tbody');
  tbody.innerHTML = '';
  products.forEach((p) => {
    const tr = document.createElement('tr');
    const isFav = favoriteSet.has(String(p.InternalModel));
    tr.innerHTML = `<td><input type="checkbox" ${selectedRows.has(p.RowIndex) ? 'checked' : ''} onchange="toggleRowSelect(${p.RowIndex}, this.checked)" /></td><td>${p.InternalModel ? `<button class="fav-star ${isFav ? '' : 'off'}" title="${isFav ? '取消常用' : '加入常用'}" onclick="toggleFavorite('${String(p.InternalModel).replace(/'/g, "\\'")}')">${isFav ? '★' : '☆'}</button>` : ''}</td><td>${p.InternalModel || '<span class="badge-warn">（缺內部型號）</span>'}</td><td>${p.SupplierModel || ''}</td><td>${p.Supplier || ''}</td><td>${p.Category || ''}</td><td>${p.RefPrice || '<span class="badge-warn">無</span>'}</td><td>${p.InquiryCount || 0}</td><td>${productAlertHtml(p)}</td><td><div class="pt-notes" title="${pdEsc(p.Notes || '')}">${pdEsc(p.Notes || '')}</div></td>
      <td><button onclick="viewProduct('${String(p.InternalModel || '').replace(/'/g, "\\'")}', ${p.RowIndex})">查看/詢價</button></td>`;
    tbody.appendChild(tr);
  });
  updateBulkInfo();
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

  renderProductFields(result.product);
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
  document.getElementById('ep-brand').value = result.product.Brand || '';
  document.getElementById('ep-interface').value = result.product.Interface || '';
  document.getElementById('ep-resolution').value = result.product.Resolution || '';
  document.getElementById('ep-pixel').value = result.product.PixelSize || '';
  document.getElementById('ep-sensor').value = result.product.SensorSize || '';
  document.getElementById('ep-fps').value = result.product.FPS || '';
  document.getElementById('ep-mount').value = result.product.Mount || '';
  document.getElementById('ep-focal').value = result.product.FocalLength || '';
  document.getElementById('ep-mag').value = result.product.Magnification || '';
  document.getElementById('ep-wd').value = result.product.WD || '';
  document.getElementById('ep-dof').value = result.product.DOF || '';
  document.getElementById('ep-focuswd').value = result.product.FocusWD || '';

  renderPriceHistoryTable(result.priceHistory || []);
}

function pdEsc(v) {
  return String(v == null ? '' : v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

/** 產品詳情直接列出全部資料：基本資料、選型規格、官網抓到的完整規格（不用按「編輯」才看得到）。 */
function renderProductFields(p) {
  const grid = (rows) =>
    '<div class="pd-grid">' +
    rows
      .map(([k, v]) => '<div><span>' + pdEsc(k) + '</span><span' + (v === '' || v == null ? ' class="pd-empty">—' : '>' + pdEsc(v)) + '</span></div>')
      .join('') +
    '</div>';
  const basic = [
    ['內部型號', p.InternalModel], ['供應商型號', p.SupplierModel], ['供應商', p.Supplier], ['供應商窗口', p.SupplierContact],
    ['詢價信箱', p.SupplierContactEmail], ['產地', p.Origin], ['類別', p.Category], ['可搭配群組', p.CompatibleGroup],
    ['底價', p.RefPrice], ['上次修改', String(p.LastUpdated || '').slice(0, 10)],
  ];
  const isLens = p.Category === '鏡頭';
  const sel = [
    ['品牌', p.Brand], ['介面', p.Interface], ['解析度', p.Resolution], ['像元尺寸 µm', p.PixelSize], ['靶面', p.SensorSize],
    ['影格率 fps', p.FPS], ['接口', p.Mount], ['焦距 mm', p.FocalLength], ['放大倍率', p.Magnification],
    ['工作距離 WD', p.WD], ['景深 DOF', p.DOF], ['最近對焦距離', p.FocusWD],
  ].filter(([k, v]) => v || (isLens ? !/像元|影格|介面/.test(k) : !/焦距|倍率|WD|DOF|最近/.test(k)));
  let html = '<div class="pd-section-title">基本資料</div>' + grid(basic);
  html += '<div class="pd-section-title">選型規格（選型計算用）</div>' + grid(sel);
  let specs = null;
  try {
    specs = p.Specs ? JSON.parse(p.Specs) : null;
  } catch (e) {
    specs = null;
  }
  const keys = specs ? Object.keys(specs).filter((k) => specs[k] !== '' && specs[k] != null) : [];
  html += '<div class="pd-section-title">官網完整規格' + (keys.length ? '（' + keys.length + ' 項）' : '') + '</div>';
  html += keys.length ? grid(keys.map((k) => [k, specs[k]])) : '<div class="calc-hint">沒有官網完整規格（手動新增的產品，或尚未從官網匯入）。</div>';
  document.getElementById('pd-fields').innerHTML = html;
  document.getElementById('pd-specs').innerHTML = '';
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
    Brand: document.getElementById('ep-brand').value,
    Interface: document.getElementById('ep-interface').value,
    Resolution: document.getElementById('ep-resolution').value,
    PixelSize: document.getElementById('ep-pixel').value,
    SensorSize: document.getElementById('ep-sensor').value,
    FPS: document.getElementById('ep-fps').value,
    Mount: document.getElementById('ep-mount').value,
    FocalLength: document.getElementById('ep-focal').value,
    Magnification: document.getElementById('ep-mag').value,
    WD: document.getElementById('ep-wd').value,
    DOF: document.getElementById('ep-dof').value,
    FocusWD: document.getElementById('ep-focuswd').value,
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
/** 相機 / 鏡頭的選型規格有沒有填完整（沒填完整的，選型計算不會推薦它）。 */
function specIssue(p) {
  if (p.Category !== '相機' && p.Category !== '鏡頭') return '';
  const iface = String(p.Interface || '');
  const isNum = (v) => parseFloat(v) > 0;
  if (p.Category === '相機') {
    if (!iface) return '缺選型規格（介面）：選型不會推薦';
    if (!/gige|usb/i.test(iface) || (/usb\s*2/i.test(iface) && !/3/.test(iface))) return ''; // 不在選型範圍
    if (!p.Resolution || !isNum(p.PixelSize)) return '缺解析度/像元尺寸：選型不會推薦';
    return '';
  }
  if (isNum(p.Magnification) || isNum(p.FocalLength)) return '';
  return iface ? '' : '缺焦距/倍率：選型不會推薦';
}

function productIssues(p) {
  const issues = [];
  if (!p.InternalModel) issues.push('缺內部型號');
  if (!p.RefPrice) issues.push('缺底價');
  if (!p.Supplier) issues.push('缺供應商');
  if (!p.SupplierContactEmail) issues.push('缺詢價信箱');
  const spec = specIssue(p);
  if (spec) issues.push(spec);
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

function setLoadingText(text) {
  const el = document.querySelector('#loading-overlay .loading-box div:last-child');
  if (el) el.textContent = text;
}

/** 分段匯入：每次呼叫後端只處理一部分（避免單次執行太久被中斷），這裡自動接著呼叫到完成，並顯示進度。 */
async function importDehong() {
  if (!confirm('要從德鴻視覺官網（twdehong.com）抓遠心鏡頭、光源、控制器、相機等型號與規格嗎？只會新增還沒有的型號（約 2000 筆，分段執行共需 3～6 分鐘，請不要關閉頁面），不含價格，底價請自己詢價後填入。')) return;
  const NL = String.fromCharCode(10);
  let offset = 0;
  let added = 0;
  let tele = 0;
  let enriched = 0;
  let total = 0;
  let step = 0;
  const notes = [];
  try {
    while (true) {
      step++;
      setLoadingText(`匯入德鴻官網：第 ${step} 段讀取中（已新增 ${added} 筆）...`);
      const r = await callApi('importDehongProducts', { stage: 'lists', offset });
      if (!r.success) throw new Error(r.message || '匯入失敗');
      added += r.added;
      tele += r.teleAdded || 0;
      enriched += r.enriched || 0;
      total = r.totalCats || total;
      if (r.errors && r.errors.length) notes.push(...r.errors);
      if (r.done || step > 60) break;
      offset = r.nextOffset;
      setLoadingText(`匯入德鴻官網：已讀 ${offset} / ${total} 個分類，新增 ${added} 筆...`);
    }
    setLoadingText('匯入德鴻官網：讀取相機、FA 鏡頭、液態鏡頭...');
    const ex = await callApi('importDehongProducts', { stage: 'extras' });
    if (!ex.success) throw new Error(ex.message || '匯入相機資料失敗');
    added += ex.added;
    enriched += ex.enriched || 0;
    if (ex.errors && ex.errors.length) notes.push(...ex.errors);
    const lines = [`匯入完成：新增 ${added} 筆產品、替既有產品補上 ${enriched} 筆規格。`, `選型計算分頁：遠心鏡頭 +${tele}、相機 +${ex.camAdded || 0}。`];
    if (ex.skippedNoPixel) lines.push(`${ex.skippedNoPixel} 款相機缺像元尺寸，已寫進相機分頁但選型計算會略過，請補上像元尺寸。`);
    if (notes.length) lines.push('部分頁面讀取失敗：' + notes.join('、') + '（可以再按一次匯入補抓）');
    alert(lines.join(NL));
  } catch (e) {
    alert('匯入中斷：' + (e.message || e) + NL + '已經匯入的資料會保留，再按一次「匯入德鴻官網」會接著補。');
  } finally {
    setLoadingText('處理中，請稍候...');
  }
  clearCached('products_all');
  clearCached('visionCatalog_v5');
  searchProducts();
}

async function importFlir() {
  if (!confirm('要從 FLIR 官網抓相機與鏡頭的型號、規格嗎？包含 flir.com 的熱像/研發相機與研發鏡頭，以及 FLIR 可見光工業相機（Blackfly S、Oryx、Chameleon3 等，這些已改由 Teledyne 官網販售，會從那邊抓並寫進選型計算的 GigE/USB3 分頁）。FLIR 沒有光源類產品。只會新增還沒有的型號，分段執行約需 3～8 分鐘，請不要關閉頁面，不含價格。')) return;
  const NL = String.fromCharCode(10);
  let added = 0;
  let enriched = 0;
  let camAdded = 0;
  let skipped = 0;
  let step = 0;
  let offset = 0;
  const notes = [];
  try {
    setLoadingText('匯入 FLIR：讀取熱像/研發相機與鏡頭...');
    const t = await callApi('importFlirProducts', { stage: 'thermal' });
    if (!t.success) throw new Error(t.message || '匯入失敗');
    added += t.added;
    enriched += t.enriched || 0;
    if (t.errors && t.errors.length) notes.push(...t.errors);
    while (true) {
      step++;
      setLoadingText('匯入 FLIR 工業相機：第 ' + step + ' 段（已新增 ' + (added + camAdded) + ' 筆）...');
      const r = await callApi('importFlirProducts', { stage: 'visible', offset });
      if (!r.success) throw new Error(r.message || '匯入失敗');
      added += r.added;
      enriched += r.enriched || 0;
      camAdded += r.camAdded || 0;
      skipped += r.skippedNoPixel || 0;
      if (r.errors && r.errors.length) notes.push(...r.errors);
      if (r.done || step > 60) break;
      offset = r.nextOffset;
      setLoadingText('匯入 FLIR 工業相機：已讀 ' + offset + ' / ' + r.total + ' 款...');
    }
    const lines = ['匯入完成：新增 ' + added + ' 筆產品、替既有產品補上 ' + enriched + ' 筆規格。', '選型計算相機分頁 +' + camAdded + '。'];
    if (skipped) lines.push(skipped + ' 款相機缺像元尺寸，選型計算會略過。');
    if (notes.length) lines.push('部分頁面讀取失敗：' + notes.slice(0, 6).join('、') + '（可以再按一次匯入補抓）');
    alert(lines.join(NL));
  } catch (e) {
    alert('匯入中斷：' + (e.message || e) + NL + '已經匯入的資料會保留，再按一次「匯入 FLIR 官網」會接著補。');
  } finally {
    setLoadingText('處理中，請稍候...');
  }
  clearCached('products_all');
  clearCached('visionCatalog_v5');
  searchProducts();
}

async function importBasler() {
  if (!confirm('要從 Basler 官方文件站（docs.baslerweb.com）抓相機的型號與規格嗎？約 430 款（ace / ace 2 / dart / boost / pulse 等），同時寫進選型計算的 GigE / USB3 分頁。baslerweb.com 主站有防爬蟲，鏡頭與光源抓不到，且不含價格。只會新增還沒有的型號，分段執行約需 3～6 分鐘，請不要關閉頁面。')) return;
  const NL = String.fromCharCode(10);
  let added = 0;
  let enriched = 0;
  let camAdded = 0;
  let skipped = 0;
  let step = 0;
  let offset = 0;
  const notes = [];
  try {
    while (true) {
      step++;
      setLoadingText('匯入 Basler：第 ' + step + ' 段（已新增 ' + added + ' 筆）...');
      const r = await callApi('importBaslerProducts', { offset });
      if (!r.success) throw new Error(r.message || '匯入失敗');
      added += r.added;
      enriched += r.enriched || 0;
      camAdded += r.camAdded || 0;
      skipped += r.skippedNoPixel || 0;
      if (r.errors && r.errors.length) notes.push(...r.errors);
      if (r.done || step > 60) break;
      offset = r.nextOffset;
      setLoadingText('匯入 Basler：已讀 ' + offset + ' / ' + r.total + ' 頁...');
    }
    const lines = ['匯入完成：新增 ' + added + ' 筆產品、替既有產品補上 ' + enriched + ' 筆規格。', '選型計算相機分頁 +' + camAdded + '。'];
    if (skipped) lines.push(skipped + ' 款相機缺像元尺寸，選型計算會略過。');
    if (notes.length) lines.push('部分頁面讀取失敗：' + notes.slice(0, 6).join('、') + '（可以再按一次匯入補抓）');
    alert(lines.join(NL));
  } catch (e) {
    alert('匯入中斷：' + (e.message || e) + NL + '已經匯入的資料會保留，再按一次「匯入 Basler 官網」會接著補。');
  } finally {
    setLoadingText('處理中，請稍候...');
  }
  clearCached('products_all');
  clearCached('visionCatalog_v5');
  searchProducts();
}

async function importMindvision() {
  if (!confirm('要從邁德威視官網（mindvision.com.cn）抓全系列產品嗎？約 665 筆（面陣/線陣/智能/3D 相機、鏡頭、光源、光源控制器、圖像採集卡），面陣相機會同時寫進選型規格。只會新增還沒有的型號，分段執行約需 5～10 分鐘，請不要關閉頁面，不含價格。')) return;
  const NL = String.fromCharCode(10);
  let added = 0;
  let enriched = 0;
  let camAdded = 0;
  let skipped = 0;
  let step = 0;
  let offset = 0;
  const notes = [];
  try {
    while (true) {
      step++;
      setLoadingText('匯入邁德威視：第 ' + step + ' 段（已新增 ' + added + ' 筆）...');
      const r = await callApi('importMindvisionProducts', { offset });
      if (!r.success) throw new Error(r.message || '匯入失敗');
      added += r.added;
      enriched += r.enriched || 0;
      camAdded += r.camAdded || 0;
      skipped += r.skippedNoPixel || 0;
      if (r.errors && r.errors.length) notes.push(...r.errors);
      if (r.done || step > 60) break;
      offset = r.nextOffset;
      setLoadingText('匯入邁德威視：已讀 ' + offset + ' / ' + r.total + ' 頁...');
    }
    const lines = ['匯入完成：新增 ' + added + ' 筆產品、替既有產品補上 ' + enriched + ' 筆規格。', '面陣相機選型規格 +' + camAdded + '。'];
    if (skipped) lines.push(skipped + ' 款相機缺像元尺寸，選型計算會略過，請到產品頁補上。');
    if (notes.length) lines.push('部分頁面讀取失敗：' + notes.slice(0, 6).join('、') + '（可以再按一次匯入補抓）');
    alert(lines.join(NL));
  } catch (e) {
    alert('匯入中斷：' + (e.message || e) + NL + '已經匯入的資料會保留，再按一次「匯入邁德威視官網」會接著補。');
  } finally {
    setLoadingText('處理中，請稍候...');
  }
  clearCached('products_all');
  clearCached('visionCatalog_v5');
  searchProducts();
}

/** 一次跑完全部官網匯入：每家各自分段執行，失敗的不影響其他家，最後整理各家新增多少。 */
async function importAllMissing() {
  if (!confirm('要一次匯入全部官網的硬體嗎？依序跑：公開型錄 → 德鴻 → FLIR → Basler → 邁德威視。只會新增還沒有的型號、補空白規格，不含價格。全部約需 10～25 分鐘，請不要關閉頁面。')) return;
  const NL = String.fromCharCode(10);
  const results = [];
  const failNote = (r) => (r && r.errors && r.errors.length ? r.errors.length + ' 個頁面失敗' : '');

  // 通用：反覆呼叫 action 直到 done，累計各項數字
  const loop = async (label, action, base, stage) => {
    const sum = { added: 0, enriched: 0, camAdded: 0, notes: [] };
    let offset = 0;
    let step = 0;
    while (true) {
      step++;
      setLoadingText('匯入 ' + label + '：第 ' + step + ' 段（已新增 ' + sum.added + ' 筆）...');
      // 網路偶爾斷線(Failed to fetch)時，同一段最多重試 3 次，已寫入的資料不會重複
      let r;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          r = await callApi(action, Object.assign({}, base, stage ? { stage } : {}, { offset }));
          break;
        } catch (e) {
          if (attempt === 3) throw e;
          setLoadingText('匯入 ' + label + '：連線中斷，重試第 ' + attempt + ' 次...');
          await new Promise((res) => setTimeout(res, 4000));
        }
      }
      if (!r.success) throw new Error(r.message || '失敗');
      sum.added += r.added || 0;
      sum.enriched += r.enriched || 0;
      sum.camAdded += r.camAdded || r.teleAdded || 0;
      if (r.errors && r.errors.length) sum.notes.push(...r.errors);
      if (r.done || step > 80) break;
      offset = r.nextOffset;
    }
    return sum;
  };
  const run = async (label, fn) => {
    try {
      const sum = await fn();
      results.push({ label, ok: true, sum });
    } catch (e) {
      results.push({ label, ok: false, error: e.message || String(e) });
    }
  };

  await run('公開型錄', async () => {
    setLoadingText('匯入公開型錄...');
    const r = await callApi('importCatalogProducts', {});
    if (!r.success) throw new Error(r.message);
    return { added: r.added, enriched: 0, camAdded: 0, notes: [] };
  });
  await run('德鴻', async () => {
    const a = await loop('德鴻', 'importDehongProducts', {}, 'lists');
    setLoadingText('匯入德鴻：讀取相機、FA 鏡頭、液態鏡頭...');
    const b = await callApi('importDehongProducts', { stage: 'extras' });
    if (!b.success) throw new Error(b.message);
    a.added += b.added || 0;
    a.enriched += b.enriched || 0;
    a.camAdded += b.camAdded || 0;
    if (b.errors && b.errors.length) a.notes.push(...b.errors);
    return a;
  });
  await run('FLIR', async () => {
    setLoadingText('匯入 FLIR：熱像/研發相機與鏡頭...');
    const t = await callApi('importFlirProducts', { stage: 'thermal' });
    if (!t.success) throw new Error(t.message);
    const v = await loop('FLIR 工業相機', 'importFlirProducts', {}, 'visible');
    return { added: (t.added || 0) + v.added, enriched: (t.enriched || 0) + v.enriched, camAdded: v.camAdded, notes: [...(t.errors || []), ...v.notes] };
  });
  await run('Basler', () => loop('Basler', 'importBaslerProducts', {}));
  await run('邁德威視', () => loop('邁德威視', 'importMindvisionProducts', {}));

  setLoadingText('處理中，請稍候...');
  let total = 0;
  const lines = ['全部匯入完成，各家結果：'];
  results.forEach((r) => {
    if (!r.ok) {
      lines.push('✗ ' + r.label + '：失敗（' + r.error + '）');
      return;
    }
    total += r.sum.added;
    const blocked = r.sum.notes.filter((n) => /HTTP 403|HTTP 429/.test(n)).length;
    let line = '✓ ' + r.label + '：新增 ' + r.sum.added + ' 筆、補規格 ' + r.sum.enriched + ' 筆、選型規格 +' + r.sum.camAdded;
    if (blocked) line += '（' + blocked + ' 個頁面被官網擋下 403，這家官網擋 Google 伺服器，無法抓取）';
    else if (r.sum.notes.length) line += '（' + r.sum.notes.length + ' 個頁面讀取失敗，可再按一次補抓）';
    lines.push(line);
  });
  lines.push('合計新增 ' + total + ' 筆產品。');
  alert(lines.join(NL));
  clearCached('products_all');
  clearCached('visionCatalog_v5');
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
  clearCached('visionCatalog_v5');
  searchProducts();
}
