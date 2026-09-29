/**
 * cases.js - 案件管理 頁面專屬邏輯
 * 這一頁自己抓客戶清單(給客戶名稱自動完成用)跟人員清單(給業務/FAE自動完成用)，
 * 不依賴 customers.js 的全域變數，讓每個頁面都能獨立運作、互不影響。
 */

let currentCaseId = null;
let allCustomersForCase = [];
let allStaff = [];

// ---- CCD 檢測需求：可新增/刪除多組 ----
let createCcdList = [];
let detailCcdList = [];
const CCD_FIELDS = [
  { key: 'Description', label: '檢測需求說明', type: 'textarea' },
  { key: 'FovLengthMm', label: 'FOV長(mm)' },
  { key: 'FovWidthMm', label: 'FOV寬(mm)' },
  { key: 'WdMm', label: 'WD(mm)' },
  { key: 'AccuracyUm', label: '要求檢測精度(µm，可加方向：±2 正負 / +2 只能多 / -2 只能少)' },
  { key: 'FlyingSpeedMmS', label: '飛拍速度(mm/s)' },
  { key: 'InspectionSpeedPs', label: '檢測速度(p/s)' },
  { key: 'LightingNote', label: '打光限制說明' },
];

function addCcdBlock(context) {
  const list = context === 'create' ? createCcdList : detailCcdList;
  const blank = {};
  CCD_FIELDS.forEach((f) => (blank[f.key] = ''));
  list.push(blank);
  renderCcdBlocks(context);
}

function removeCcdBlock(context, idx) {
  const list = context === 'create' ? createCcdList : detailCcdList;
  list.splice(idx, 1);
  renderCcdBlocks(context);
}

function updateCcdField(context, idx, field, value) {
  const list = context === 'create' ? createCcdList : detailCcdList;
  list[idx][field] = value;
}

function renderCcdBlocks(context) {
  const list = context === 'create' ? createCcdList : detailCcdList;
  const container = document.getElementById(context === 'create' ? 'ccd-blocks-create' : 'ccd-blocks-detail');
  if (!container) return;

  container.innerHTML = '';
  list.forEach((ccd, idx) => {
    const div = document.createElement('div');
    div.className = 'panel';
    let fieldsHtml = `<h4>CCD ${idx + 1} <button onclick="removeCcdBlock('${context}', ${idx})">刪除此CCD</button></h4>`;
    CCD_FIELDS.forEach((f) => {
      const val = ccd[f.key] || '';
      if (f.type === 'textarea') {
        fieldsHtml += `<textarea placeholder="${f.label}" oninput="updateCcdField('${context}', ${idx}, '${f.key}', this.value)">${val}</textarea>`;
      } else {
        fieldsHtml += `<input placeholder="${f.label}" value="${val}" oninput="updateCcdField('${context}', ${idx}, '${f.key}', this.value)" />`;
      }
    });
    div.innerHTML = fieldsHtml;
    container.appendChild(div);
  });
}

function toggleSwCustomizationNote(prefix) {
  const val = document.getElementById(prefix + '-sw-customization').value;
  document.getElementById(prefix + '-sw-customization-note').style.display = val === '是' ? 'block' : 'none';
}

// ---- 客戶/業務/FAE 自動完成 + 快速建立 ----
function applyCasesPageData(data) {
  updateSoftwareDatalist(data.cases);
  renderCaseTable(data.cases);

  allCustomersForCase = data.customers;
  const custList = document.getElementById('case-customer-datalist');
  custList.innerHTML = '';
  [...new Set(allCustomersForCase.map((c) => c.CompanyName).filter(Boolean))].forEach((name) => {
    const opt = document.createElement('option');
    opt.value = name;
    custList.appendChild(opt);
  });

  allStaff = data.staff;
  updateStaffDatalistsFromAllStaff();
}

async function loadCasesPageInit() {
  // 先用上次的暫存資料立刻畫出畫面（如果有的話），不用整頁乾等
  const cached = getCached('casesPageData');
  if (cached) applyCasesPageData(cached);

  const result = await callApi('getCasesPageData', {});
  if (!result.success) return;
  setCached('casesPageData', result);
  applyCasesPageData(result);
}

async function reloadCustomersForCase() {
  const result = await callApi('getCustomers', {});
  if (!result.success) return;
  allCustomersForCase = result.customers;
  const list = document.getElementById('case-customer-datalist');
  list.innerHTML = '';
  [...new Set(allCustomersForCase.map((c) => c.CompanyName).filter(Boolean))].forEach((name) => {
    const opt = document.createElement('option');
    opt.value = name;
    list.appendChild(opt);
  });
}

async function reloadStaffForCase() {
  const result = await callApi('getStaff', {});
  if (!result.success) return;
  allStaff = result.staff;
  updateStaffDatalistsFromAllStaff();
}

function updateStaffDatalistsFromAllStaff() {
  const salesList = document.getElementById('case-salesperson-datalist');
  const faeList = document.getElementById('case-fae-datalist');
  salesList.innerHTML = '';
  faeList.innerHTML = '';
  allStaff
    .filter((s) => s.Role === '業務')
    .forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s.Name;
      salesList.appendChild(opt);
    });
  allStaff
    .filter((s) => s.Role === 'FAE')
    .forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s.Name;
      faeList.appendChild(opt);
    });
}

function updateSoftwareDatalist(cases) {
  const list = document.getElementById('case-software-datalist');
  const names = [...new Set(cases.map((c) => c.SoftwareName).filter(Boolean))];
  list.innerHTML = '';
  names.forEach((name) => {
    const opt = document.createElement('option');
    opt.value = name;
    list.appendChild(opt);
  });
}

function onCaseCustomerBlur(inputId) {
  const val = document.getElementById(inputId).value.trim();
  if (!val) return;
  const exists = allCustomersForCase.some((c) => c.CompanyName === val);
  if (!exists) {
    document.getElementById('quick-customer-name').value = val;
    document.getElementById('quick-customer-modal').style.display = 'flex';
  }
}

function onCaseStaffBlur(role, inputId) {
  const val = document.getElementById(inputId).value.trim();
  if (!val) return;
  const exists = allStaff.some((s) => s.Name === val && s.Role === role);
  if (!exists) {
    document.getElementById('quick-staff-name').value = val;
    document.getElementById('quick-staff-role').value = role;
    document.getElementById('quick-staff-modal').style.display = 'flex';
  }
}

function closeQuickCustomerModal() {
  document.getElementById('quick-customer-modal').style.display = 'none';
}
function closeQuickStaffModal() {
  document.getElementById('quick-staff-modal').style.display = 'none';
}

async function submitQuickCustomer() {
  const result = await callApi('addCustomer', {
    companyName: document.getElementById('quick-customer-name').value,
    contact: document.getElementById('quick-customer-contact').value,
    phone: document.getElementById('quick-customer-phone').value,
    email: document.getElementById('quick-customer-email').value,
    category: document.getElementById('quick-customer-category').value,
    urgency: document.getElementById('quick-customer-urgency').value,
  });
  if (!result.success) return alert(result.message);
  closeQuickCustomerModal();
  await reloadCustomersForCase();
  clearCached('casesPageData');
  alert('已建立客戶資料');
}

async function submitQuickStaff() {
  const result = await callApi('addStaff', {
    name: document.getElementById('quick-staff-name').value,
    role: document.getElementById('quick-staff-role').value,
  });
  if (!result.success) return alert(result.message);
  closeQuickStaffModal();
  await reloadStaffForCase();
  clearCached('casesPageData');
  alert('已建立人員資料');
}

// ---- 案件 CRUD ----
async function createCase() {
  const swCustomization = document.getElementById('case-sw-customization').value;
  const fields = {
    customerName: document.getElementById('case-customer').value,
    endCustomerName: document.getElementById('case-end-customer').value,
    projectContact: document.getElementById('case-project-contact').value,
    contactPhone: document.getElementById('case-contact-phone').value,
    salesperson: document.getElementById('case-salesperson').value,
    fae: document.getElementById('case-fae').value,
    productApplication: document.getElementById('case-product-application').value,
    testObject: document.getElementById('case-test-object').value,
    softwareName: document.getElementById('case-software-name').value,
    softwareCustomization: swCustomization,
    softwareCustomizationNote: swCustomization === '是' ? document.getElementById('case-sw-customization-note').value : '',
    requirementDetails: document.getElementById('case-requirement').value,
    ccdRequirements: createCcdList,
  };

  const result = await callApi('createCase', fields);
  if (result.success) {
    clearCached('casesPageData');
    alert('案件已建立：' + result.caseId);
    [
      'case-customer', 'case-end-customer', 'case-project-contact', 'case-contact-phone',
      'case-salesperson', 'case-fae', 'case-product-application', 'case-test-object',
      'case-software-name', 'case-requirement', 'case-sw-customization-note',
    ].forEach((id) => (document.getElementById(id).value = ''));
    document.getElementById('case-sw-customization').value = '';
    document.getElementById('case-sw-customization-note').style.display = 'none';
    createCcdList = [];
    renderCcdBlocks('create');
    loadCases();
  } else {
    alert(result.message);
  }
}

async function loadCases() {
  const keyword = document.getElementById('case-search-keyword').value;
  const status = document.getElementById('case-search-status').value;
  const result = await callApi('getCases', { keyword, status });
  if (!result.success) return;
  updateSoftwareDatalist(result.cases);
  renderCaseTable(result.cases);
}

function renderCaseTable(cases) {
  const tbody = document.querySelector('#case-table tbody');
  tbody.innerHTML = '';
  cases.forEach((c) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${c.CaseID}</td><td>${c.CustomerName}</td><td>${c.Status}</td><td>${c.CreatedDate}</td>
      <td>
        <button onclick="viewCase('${c.CaseID}')">查看</button>
        <button onclick="deleteCase('${c.CaseID}')">刪除</button>
      </td>`;
    tbody.appendChild(tr);
  });
}

async function deleteCase(caseId) {
  if (!confirm(`確定要刪除案件「${caseId}」嗎？此動作無法復原。`)) return;
  const result = await callApi('deleteCase', { caseId });
  if (result.success) {
    clearCached('casesPageData');
    if (currentCaseId === caseId) document.getElementById('case-detail').style.display = 'none';
    loadCases();
  } else {
    alert(result.message);
  }
}

async function viewCase(caseId) {
  currentCaseId = caseId;
  const result = await callApi('getCase', { caseId });
  if (!result.success) return alert(result.message);
  const c = result.caseData;

  document.getElementById('case-detail').style.display = 'block';
  document.getElementById('cd-case-id').textContent = caseId;
  document.getElementById('cd-customer').value = c.CustomerName || '';
  document.getElementById('cd-end-customer').value = c.EndCustomerName || '';
  document.getElementById('cd-project-contact').value = c.ProjectContact || '';
  document.getElementById('cd-contact-phone').value = c.ContactPhone || '';
  document.getElementById('cd-salesperson').value = c.Salesperson || '';
  document.getElementById('cd-fae').value = c.FAE || '';
  document.getElementById('cd-product-application').value = c.ProductApplication || '';
  document.getElementById('cd-test-object').value = c.TestObject || '';
  document.getElementById('cd-software-name').value = c.SoftwareName || '';
  document.getElementById('cd-sw-customization').value = c.SoftwareCustomization || '';
  document.getElementById('cd-sw-customization-note').value = c.SoftwareCustomizationNote || '';
  toggleSwCustomizationNote('cd');
  document.getElementById('cd-status').value = c.Status || '需求單已發出';
  document.getElementById('cd-requirement').value = c.RequirementDetails || '';

  detailCcdList = c.CcdRequirements || [];
  renderCcdBlocks('detail');

  try {
    currentAttachments = JSON.parse(c.AttachmentLinksJson || '[]');
  } catch (e) {
    currentAttachments = [];
  }
  renderAttachmentsList();

  document.getElementById('manual-report-editor').innerHTML =
    c.EvaluationReportHtml || '在這裡輸入評估報告內容，可以用上面的工具列調整粗體/顏色/字級/對齊...';
}

async function saveCaseEdit() {
  const swCustomization = document.getElementById('cd-sw-customization').value;
  const fields = {
    CustomerName: document.getElementById('cd-customer').value,
    EndCustomerName: document.getElementById('cd-end-customer').value,
    ProjectContact: document.getElementById('cd-project-contact').value,
    ContactPhone: document.getElementById('cd-contact-phone').value,
    Salesperson: document.getElementById('cd-salesperson').value,
    FAE: document.getElementById('cd-fae').value,
    ProductApplication: document.getElementById('cd-product-application').value,
    TestObject: document.getElementById('cd-test-object').value,
    SoftwareName: document.getElementById('cd-software-name').value,
    SoftwareCustomization: swCustomization,
    SoftwareCustomizationNote: swCustomization === '是' ? document.getElementById('cd-sw-customization-note').value : '',
    Status: document.getElementById('cd-status').value,
    RequirementDetails: document.getElementById('cd-requirement').value,
  };
  const result = await callApi('updateCase', { caseId: currentCaseId, fields, ccdRequirements: detailCcdList });
  if (result.success) {
    clearCached('casesPageData');
    alert('已儲存修改');
    loadCases();
  } else {
    alert(result.message);
  }
}

// ---- 附件 ----
let currentAttachments = [];

function renderAttachmentsList() {
  const box = document.getElementById('attachments-list');
  box.innerHTML = '';
  currentAttachments.forEach((a) => {
    const div = document.createElement('div');
    div.className = 'preview-item-header';
    div.innerHTML = `<a href="${a.url}" target="_blank" rel="noopener">${a.name}</a> <button onclick="deleteAttachment('${a.fileId}')">刪除</button>`;
    box.appendChild(div);
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function uploadAttachment() {
  const fileInput = document.getElementById('attachment-file-input');
  const file = fileInput.files[0];
  if (!file) return alert('請先選擇檔案');

  const base64 = await fileToBase64(file);
  const result = await callApi('uploadCaseAttachment', { caseId: currentCaseId, filename: file.name, mimeType: file.type, base64 });
  if (!result.success) return alert(result.message);
  currentAttachments = result.attachments;
  renderAttachmentsList();
  fileInput.value = '';
  alert('已上傳附件');
}

async function deleteAttachment(fileId) {
  if (!confirm('確定要刪除這個附件嗎？')) return;
  const result = await callApi('deleteCaseAttachment', { caseId: currentCaseId, fileId });
  if (!result.success) return alert(result.message);
  currentAttachments = result.attachments;
  renderAttachmentsList();
}

// ---- 需求單 / 評估單(自動) / 搭配報價單 ----
async function generateRequirementDoc() {
  const format = document.getElementById('requirement-format').value;
  const result = await callApi('generateRequirementDoc', { caseId: currentCaseId, format });
  if (!result.success) return alert(result.message);
  openPreviewModal([Object.assign({}, result, { label: '需求單' })]);
}

function getEvaluationQuoteMultiplier() {
  const type = document.getElementById('evaluation-quote-type').value;
  if (type === 'custom') {
    const v = parseFloat(document.getElementById('evaluation-quote-custom-multiplier').value);
    return isNaN(v) ? 0 : v;
  }
  return parseFloat(type);
}

function getEvaluationQuoteTypeLabel() {
  const type = document.getElementById('evaluation-quote-type').value;
  if (type === '1.3') return '設備商';
  if (type === '1.5') return '一般用戶';
  return '自訂義（×' + getEvaluationQuoteMultiplier() + '）';
}

document.addEventListener('change', (e) => {
  if (e.target && e.target.id === 'evaluation-quote-type') {
    document.getElementById('evaluation-quote-custom-multiplier').style.display = e.target.value === 'custom' ? 'block' : 'none';
  }
});

async function generateEvaluationDoc() {
  const format = document.getElementById('evaluation-format').value;
  const evaluationData = {
    Tester: document.getElementById('ev-tester').value,
    RecommendedProduct: document.getElementById('ev-recommend').value,
    TestResult: document.getElementById('ev-result').value,
    Notes: document.getElementById('ev-notes').value,
  };

  // 評估單本身，跟「依建議產品組出搭配報價單」這兩件事互不依賴彼此的結果，
  // 原本是一個等完才等下一個，改成同時發出去，總等待時間等於「比較慢的那個」而不是兩個加起來。
  const evalPromise = callApi('generateEvaluationDoc', { caseId: currentCaseId, evaluationData, format });
  const quotePromise = evaluationData.RecommendedProduct
    ? buildQuoteFromRecommendedProduct(evaluationData.RecommendedProduct)
    : Promise.resolve(null);

  const [result, quoteFile] = await Promise.all([evalPromise, quotePromise]);
  if (!result.success) return alert(result.message);

  const files = [Object.assign({}, result, { label: '評估單（自動生成）' })];
  if (quoteFile) files.push(quoteFile);

  loadCases();
  openPreviewModal(files);
}

async function buildQuoteFromRecommendedProduct(recommendedText) {
  const models = recommendedText.split(/[,，\s]+/).filter(Boolean);
  const multiplier = getEvaluationQuoteMultiplier() || 1.5;

  // 建議產品可能填好幾個型號，原本是一個查完才查下一個，改成一次全部同時查詢。
  const productResults = await Promise.all(models.map((model) => callApi('getProduct', { internalModel: model })));

  const items = [];
  productResults.forEach((productResult) => {
    if (!productResult.success) return;
    const basePrice = parseFloat(productResult.product.RefPrice) || 0;
    const unitPrice = basePrice * multiplier;
    items.push({
      name: productResult.product.InternalModel,
      basePrice: basePrice.toFixed(2),
      listPrice: (basePrice * 2).toFixed(2),
      unitPrice: unitPrice.toFixed(2),
      quantity: 1,
      subtotal: unitPrice.toFixed(2),
    });
  });
  if (!items.length) return null;

  const total = items.reduce((sum, it) => sum + parseFloat(it.subtotal), 0);
  const quoteFormat = document.getElementById('evaluation-quote-format').value;
  const result = await callApi('generateQuoteDoc', {
    customerName: document.getElementById('cd-customer').value || '',
    quoteType: getEvaluationQuoteTypeLabel(),
    items,
    total: total.toFixed(2),
    format: quoteFormat,
  });
  if (!result.success) return null;
  return Object.assign({}, result, { label: '搭配報價單（依評估建議自動產生）' });
}

// ---- 手動撰寫評估報告 ----
/** 開啟專業評估報告編輯器（另一個頁面，帶目前案件編號過去）。 */
function openEvalReportEditor() {
  if (!currentCaseId) return alert('請先選擇案件');
  location.href = `evalreport.html?caseId=${encodeURIComponent(currentCaseId)}`;
}

function formatDoc(command, value) {
  document.getElementById('manual-report-editor').focus();
  document.execCommand(command, false, value || null);
}

async function saveManualReportDraft() {
  const html = document.getElementById('manual-report-editor').innerHTML;
  const result = await callApi('updateCase', { caseId: currentCaseId, fields: { EvaluationReportHtml: html } });
  if (result.success) {
    alert('草稿已儲存');
  } else {
    alert(result.message);
  }
}

function previewManualReport() {
  const format = document.getElementById('manual-report-format').value;
  const editor = document.getElementById('manual-report-editor');

  if (format === 'html') {
    const html = `<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="UTF-8"><title>評估報告_${currentCaseId}</title></head><body>${editor.innerHTML}</body></html>`;
    openPreviewModal([
      { base64: btoa(unescape(encodeURIComponent(html))), filename: `評估報告_${currentCaseId}_手動.html`, mimeType: 'text/html', label: '評估報告（手動撰寫）' },
    ]);
    return;
  }

  if (typeof html2pdf === 'undefined') {
    alert('PDF 轉換元件載入失敗，請確認網路連線後重新整理頁面再試一次');
    return;
  }
  showLoading();
  html2pdf()
    .set({ margin: 10, filename: `評估報告_${currentCaseId}_手動.pdf`, html2canvas: { scale: 2 } })
    .from(editor)
    .outputPdf('datauristring')
    .then((dataUri) => {
      hideLoading();
      const base64 = dataUri.split(',')[1];
      openPreviewModal([{ base64, filename: `評估報告_${currentCaseId}_手動.pdf`, mimeType: 'application/pdf', label: '評估報告（手動撰寫）' }]);
    })
    .catch(() => hideLoading());
}

// ------------------------------------------------------------
// 初始化
// ------------------------------------------------------------
window.addEventListener('DOMContentLoaded', () => {
  requireLogin();
  renderHeaderUser();
  loadCasesPageInit();

  bindEnterSubmit('#case-search-panel', loadCases);
  bindEnterSubmit('#case-edit-panel', saveCaseEdit);
});
