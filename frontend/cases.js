/**
 * cases.js - 案件管理 頁面專屬邏輯
 * 這一頁自己抓客戶清單(給客戶名稱自動完成用)跟人員清單(給業務/FAE自動完成用)，
 * 不依賴 customers.js 的全域變數，讓每個頁面都能獨立運作、互不影響。
 */

let currentCaseId = null;
let allCustomersForCase = [];
let allStaff = [];
let companyFilterForCases = null; // 從客戶管理頁「相關案件」連結過來時，只顯示這間公司相關的案件

// ---- 相關公司：一個案件可能牽涉多間公司（設備商/終端客戶/其他協力廠一起做同一台機台）----
let createRelatedCompanies = [];
let detailRelatedCompanies = [];
const RELATED_COMPANY_ROLE_OPTIONS = ['設備商', '代理商', '終端客戶', '其他'];

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

// ---- 相關公司區塊（跟 CCD 區塊同一種模式：可新增/刪除多筆）----
function addRelatedCompanyBlock(context) {
  const list = context === 'create' ? createRelatedCompanies : detailRelatedCompanies;
  list.push({ CompanyName: '', Role: RELATED_COMPANY_ROLE_OPTIONS[0] });
  renderRelatedCompanyBlocks(context);
}

function removeRelatedCompanyBlock(context, idx) {
  const list = context === 'create' ? createRelatedCompanies : detailRelatedCompanies;
  list.splice(idx, 1);
  renderRelatedCompanyBlocks(context);
}

function updateRelatedCompanyField(context, idx, field, value) {
  const list = context === 'create' ? createRelatedCompanies : detailRelatedCompanies;
  list[idx][field] = value;
}

function renderRelatedCompanyBlocks(context) {
  const list = context === 'create' ? createRelatedCompanies : detailRelatedCompanies;
  const container = document.getElementById(context === 'create' ? 'related-companies-create' : 'related-companies-detail');
  if (!container) return;

  container.innerHTML = '';
  list.forEach((rc, idx) => {
    const div = document.createElement('div');
    div.className = 'er-row';
    const options = RELATED_COMPANY_ROLE_OPTIONS.map((r) => `<option value="${r}" ${rc.Role === r ? 'selected' : ''}>${r}</option>`).join('');
    div.innerHTML = `
      <input placeholder="公司名稱" list="case-customer-datalist" value="${rc.CompanyName || ''}"
        oninput="updateRelatedCompanyField('${context}', ${idx}, 'CompanyName', this.value)"
        onblur="onCaseCustomerBlur(this)" />
      <select onchange="updateRelatedCompanyField('${context}', ${idx}, 'Role', this.value)">${options}</select>
      <button type="button" onclick="removeRelatedCompanyBlock('${context}', ${idx})">刪除</button>`;
    container.appendChild(div);
  });
}

function toggleSwCustomizationNote(prefix) {
  const val = document.getElementById(prefix + '-sw-customization').value;
  document.getElementById(prefix + '-sw-customization-note').style.display = val === '是' ? 'block' : 'none';
}

// ---- 客戶/業務/FAE 自動完成 + 快速建立 ----
function applyCasesPageData(data) {
  softwareList = data.software || softwareList;
  updateSoftwareDatalist();
  allCustomersForCase = data.customers; // 要先有客戶資料，案件列表才能帶出「下次追蹤」
  renderCaseTable(data.cases);

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
  const cached = await getCachedAsync('casesPageData');
  if (cached) applyCasesPageData(cached);

  const result = await callApi('getCasesPageData', {}, { silent: !!cached });
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

let softwareList = []; // 軟體名稱清單（Software 分頁）

function updateSoftwareDatalist() {
  const list = document.getElementById('case-software-datalist');
  const names = softwareList;
  list.innerHTML = '';
  names.forEach((name) => {
    const opt = document.createElement('option');
    opt.value = name;
    list.appendChild(opt);
  });
}

/** target 可以是輸入框的 id（原本的客戶名稱欄位），也可以直接傳輸入框本身（相關公司區塊沒有固定 id）。 */
function onCaseCustomerBlur(target) {
  const input = typeof target === 'string' ? document.getElementById(target) : target;
  const val = input.value.trim();
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
/** 案件一定要掛在已存在的客戶底下：名稱要完全對到客戶清單裡的一筆，對不到就擋下來、引導去建立客戶。 */
function findExactCustomer(name) {
  return allCustomersForCase.find((c) => c.CompanyName === (name || '').trim());
}

function blockIfCustomerMissing(name) {
  if (findExactCustomer(name)) return false;
  if (!name || !name.trim()) {
    alert('請先選擇客戶名稱（必填），案件一定要屬於一個客戶');
  } else {
    alert(`「${name}」不在客戶清單中，請先按 Tab／點其他地方離開欄位，跳出視窗建立這間客戶後再建立案件`);
  }
  return true;
}

/** 軟體名稱要在清單內；不在的話詢問是否新增，不新增就不往下。回傳 true 才可以繼續存檔。 */
async function ensureSoftwareKnown(inputId) {
  const input = document.getElementById(inputId);
  const name = input.value.trim();
  input.value = name;
  if (!name) return true;
  if (softwareList.some((n) => n.toLowerCase() === name.toLowerCase())) {
    input.value = softwareList.find((n) => n.toLowerCase() === name.toLowerCase());
    return true;
  }
  if (!confirm(`「${name}」不在軟體名稱資料庫內，是否新增？`)) return false;
  const result = await callApi('addSoftware', { name });
  if (!result.success) {
    alert(result.message);
    return false;
  }
  softwareList.push(name);
  updateSoftwareDatalist();
  clearCached('casesPageData');
  return true;
}

/** 案件編號（專案名稱）預覽：跟後端 generateCaseId 同一套規則（軟體-待測物件-產品應用-客戶，去特殊符號、每段最多 20 字、空白變 NA）。 */
function caseIdPart(str) {
  const s = String(str || '').trim().replace(/[^\w\u4e00-\u9fa5]+/g, '').slice(0, 20);
  return s || 'NA';
}

function updateCaseIdPreview() {
  const el = document.getElementById('case-id-preview');
  if (!el) return;
  const v = (id) => document.getElementById(id).value;
  const id = [v('case-software-name'), v('case-test-object'), v('case-product-application'), v('case-customer')].map(caseIdPart).join('-');
  const missing = id.split('-').includes('NA');
  el.innerHTML = `案件編號（專案名稱）預覽：<b>${id}</b>${missing ? ' <span style="color:#c0392b;">（有 NA 代表還有欄位沒填）</span>' : ''}`;
}

/** 建立案件前檢查：軟體名稱、待測物件、產品應用會組成專案名稱，一定要填。 */
function requireCaseIdFields() {
  const fields = [
    ['case-software-name', '使用軟體名稱'],
    ['case-test-object', '待測物件'],
    ['case-product-application', '產品應用'],
  ];
  const missing = fields.filter(([id]) => !document.getElementById(id).value.trim());
  if (!missing.length) return true;
  alert('這幾個欄位會組成案件編號（專案名稱），請先填寫：\n\n' + missing.map(([, n]) => '．' + n).join('\n') + '\n\n案件編號建立後再改要特別小心，所以請先確認填對。');
  document.getElementById(missing[0][0]).focus();
  return false;
}

async function createCase() {
  const customerName = document.getElementById('case-customer').value;
  if (blockIfCustomerMissing(customerName)) return;
  if (!requireCaseIdFields()) return;
  if (!(await ensureSoftwareKnown('case-software-name'))) return;

  const swCustomization = document.getElementById('case-sw-customization').value;
  const fields = {
    customerName,
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
    urgency: document.getElementById('case-urgency').value,
    ccdRequirements: createCcdList,
    relatedCompanies: createRelatedCompanies,
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
    document.getElementById('case-urgency').value = '中';
    document.getElementById('case-sw-customization-note').style.display = 'none';
    createCcdList = [];
    renderCcdBlocks('create');
    createRelatedCompanies = [];
    renderRelatedCompanyBlocks('create');
    loadCases();
  } else {
    alert(result.message);
  }
}

/** companyFilterForCases 有設定的話（從客戶管理「相關案件」點過來），只顯示跟那間公司有關的案件。 */
async function loadCases() {
  const keyword = document.getElementById('case-search-keyword').value;
  const status = document.getElementById('case-search-status').value;
  const result = await callApi('getCases', { keyword, status, companyName: companyFilterForCases || '' });
  if (!result.success) return;
  updateSoftwareDatalist(result.cases);
  renderCaseTable(result.cases);
}

function clearCompanyFilter() {
  companyFilterForCases = null;
  document.getElementById('case-filter-hint').style.display = 'none';
  loadCases();
}

function renderCaseTable(cases) {
  const tbody = document.querySelector('#case-table tbody');
  tbody.innerHTML = '';
  cases.forEach((c) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${c.CaseID}</td><td>${c.CustomerName}</td><td>${caseUrgencyBadge(c.Urgency)}</td><td>${c.Status}</td><td>${followUpCellHtml(c.CustomerName, c.CaseID)}</td><td>${c.CreatedDate}</td>
      <td>
        <button onclick="viewCase('${c.CaseID}')">查看</button>
        <button onclick="deleteCase('${c.CaseID}')">刪除</button>
      </td>`;
    tbody.appendChild(tr);
  });
}

// ---- 案件連動客戶的「下次追蹤日」：看案件就知道下次什麼時候要追蹤，也可以直接改 ----
function caseUrgencyBadge(u) {
  const t = u || '中';
  const style = { 高: 'background:#c0392b;color:#fff;', 中: 'background:#e67e22;color:#fff;', 低: 'background:#7f8c8d;color:#fff;' }[t] || '';
  return `<span style="${style}padding:1px 8px;border-radius:10px;font-size:12px;font-weight:bold;">${t}</span>`;
}

function followUpCellHtml(customerName, caseId) {
  const cust = findExactCustomer(customerName);
  if (!cust) return '<span style="color:#999;">（客戶資料中沒有這間公司）</span>';
  const f = followUpInfo(cust.NextFollowUpDate);
  return `<span style="color:${f.color};font-weight:${f.note && f.color !== '#333' ? 'bold' : 'normal'};">${f.text}</span>${f.note ? `<br><small style="color:${f.color};">${f.note}</small>` : ''}${followNoteHtml(cust.NextFollowUpNote)}
    <button class="btn-mini" onclick="editCaseFollowUp(decodeURIComponent('${encodeURIComponent(customerName || '')}'))">改</button>
    <button class="btn-mini" style="background:#27ae60;" onclick="doneCaseFollowUp(decodeURIComponent('${encodeURIComponent(customerName || '')}'), decodeURIComponent('${encodeURIComponent(caseId || '')}'))">追蹤完畢</button>`;
}

/** 追蹤完畢：一次記下這次聯繫的結果（寫進客戶聯繫紀錄）並設定下次追蹤日。 */
function doneCaseFollowUp(customerName, caseId) {
  const cust = findExactCustomer(customerName);
  if (!cust) return alert('客戶資料裡找不到「' + customerName + '」，請先到客戶管理建立');
  openFollowUpDialog({
    companyName: customerName,
    rowIndex: cust.RowIndex,
    contact: cust.Contact || '',
    currentDate: cust.NextFollowUpDate,
    currentNote: cust.NextFollowUpNote,
    caseId: caseId || '',
    onDone: async () => {
      await reloadCustomersForCase();
      loadCases();
      if (currentCaseId) showCaseFollowUp(document.getElementById('cd-customer').value);
    },
  });
}

function editCaseFollowUp(customerName) {
  const cust = findExactCustomer(customerName);
  if (!cust) return alert('客戶資料裡找不到「' + customerName + '」，請先到客戶管理建立');
  openFollowUpDialog({
    companyName: customerName,
    rowIndex: cust.RowIndex,
    currentDate: cust.NextFollowUpDate,
    currentNote: cust.NextFollowUpNote,
    editOnly: true,
    onDone: async () => {
      await reloadCustomersForCase();
      loadCases();
      if (currentCaseId) showCaseFollowUp(document.getElementById('cd-customer').value);
    },
  });
}

function showCaseFollowUp(customerName) {
  const el = document.getElementById('cd-followup');
  if (!el) return;
  const cust = findExactCustomer(customerName);
  if (!cust) {
    el.textContent = '';
    return;
  }
  const f = followUpInfo(cust.NextFollowUpDate);
  el.innerHTML = `｜下次追蹤：<b style="color:${f.color};">${f.text}</b>${f.note ? `（${f.note}）` : ''}${followNoteHtml(cust.NextFollowUpNote)}`;
}

/** 修改專案名稱（案件編號）：改了會影響公司內部對這個案件的登記，所以要確認兩次。 */
async function renameCasePrompt() {
  if (!currentCaseId) return;
  const oldId = currentCaseId;
  const input = prompt('請輸入新的專案名稱（案件編號）：\n\n目前：' + oldId, oldId);
  if (input === null) return;
  const newId = input.trim();
  if (!newId || newId === oldId) return alert('專案名稱沒有變更');
  if (/['"<>\\\/?#%]/.test(newId)) return alert('專案名稱不能包含 \' " < > \\ / ? # % 這些符號');
  if (!confirm('⚠ 修改專案名稱要特別小心\n\n專案名稱就是案件編號，公司內部（需求單、評估單、報價、紙本或其他系統的登記、同事口頭稱呼）可能已經用舊名稱登記。改掉之後，對不上舊名稱的資料就要自己同步修改。\n\n確定要繼續嗎？')) return;
  if (!confirm('請再次確認：\n\n舊名稱：' + oldId + '\n新名稱：' + newId + '\n\n按「確定」就會改掉這個案件，以及它的 CCD 需求、相關公司、聯繫紀錄與價格紀錄裡的案件編號。')) return;
  const r = await callApi('renameCase', { caseId: oldId, newCaseId: newId });
  if (!r.success) return alert(r.message);
  clearCached('casesPageData');
  currentCaseId = r.caseId;
  document.getElementById('cd-case-id').textContent = r.caseId;
  alert('已修改專案名稱：\n' + oldId + '\n→ ' + r.caseId);
  await loadCases();
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
  showCaseFollowUp(c.CustomerName);
  document.getElementById('cd-end-customer').value = c.EndCustomerName || '';
  document.getElementById('cd-project-contact').value = c.ProjectContact || '';
  document.getElementById('cd-contact-phone').value = c.ContactPhone || '';
  document.getElementById('cd-salesperson').value = c.Salesperson || '';
  document.getElementById('cd-fae').value = c.FAE || '';
  document.getElementById('cd-product-application').value = c.ProductApplication || '';
  document.getElementById('cd-test-object').value = c.TestObject || '';
  document.getElementById('cd-urgency').value = c.Urgency || '中';
  document.getElementById('cd-software-name').value = c.SoftwareName || '';
  document.getElementById('cd-sw-customization').value = c.SoftwareCustomization || '';
  document.getElementById('cd-sw-customization-note').value = c.SoftwareCustomizationNote || '';
  toggleSwCustomizationNote('cd');
  document.getElementById('cd-status').value = c.Status || '需求單已發出';
  document.getElementById('cd-requirement').value = c.RequirementDetails || '';

  detailCcdList = c.CcdRequirements || [];
  renderCcdBlocks('detail');

  detailRelatedCompanies = (c.RelatedCompanies || []).map((rc) => ({ CompanyName: rc.CompanyName, Role: rc.Role }));
  renderRelatedCompanyBlocks('detail');

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
  if (blockIfCustomerMissing(document.getElementById('cd-customer').value)) return;
  if (!(await ensureSoftwareKnown('cd-software-name'))) return;

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
    Urgency: document.getElementById('cd-urgency').value,
  };
  const result = await callApi('updateCase', { caseId: currentCaseId, fields, ccdRequirements: detailCcdList, relatedCompanies: detailRelatedCompanies });
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

/** 案件詳情裡「📇 客戶聯繫紀錄」：跳去客戶管理頁，直接篩選這間公司的聯繫紀錄。 */
function viewCustomerContactLogs() {
  const customerName = document.getElementById('cd-customer').value;
  if (!customerName) return alert('這個案件還沒有客戶名稱');
  location.href = `customers.html?company=${encodeURIComponent(customerName)}`;
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
/** 從客戶管理「建立案件」連過來：把這間客戶的資料套進「建立新案件」，使用者只要再填案件內容。 */
function prefillNewCaseFromCustomer(companyName) {
  const cust = findExactCustomer(companyName);
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el && v) el.value = v;
  };
  set('case-customer', cust ? cust.CompanyName : companyName);
  if (cust) {
    set('case-project-contact', cust.Contact);
    set('case-contact-phone', cust.Phone);
  }
  set('case-salesperson', currentUsername);
  const panel = document.getElementById('case-create-panel');
  const hint = document.createElement('div');
  hint.className = 'calc-hint';
  hint.style.cssText = 'background:#eaf6ee;border:1px solid #b7e1c4;border-radius:6px;padding:8px 10px;margin-bottom:8px;';
  hint.textContent = cust
    ? `已帶入「${cust.CompanyName}」的客戶、聯絡人、電話與業務，請接著填寫案件內容（產品應用、待測物件、軟體、需求細節、CCD…）後按「建立案件」。`
    : `客戶資料裡找不到「${companyName}」，請確認客戶名稱後再填寫案件內容。`;
  panel.insertBefore(hint, panel.firstChild);
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const next = document.getElementById('case-product-application');
  if (next) setTimeout(() => next.focus({ preventScroll: true }), 400);
}

/** 支援從別的頁面連過來：?caseId=X 直接開啟該案件詳情；?company=X 只顯示那間公司相關的案件。 */
async function applyCaseQueryParams() {
  const params = new URL(location.href).searchParams;
  const company = params.get('company');
  if (company) {
    companyFilterForCases = company;
    const hint = document.getElementById('case-filter-hint');
    hint.style.display = '';
    hint.innerHTML = `目前只顯示「${company}」相關的案件（含主要客戶與相關公司）。<button type="button" onclick="clearCompanyFilter()">顯示全部案件</button>`;
    await loadCases();
  }
  const newFor = params.get('newCaseFor');
  if (newFor) prefillNewCaseFromCustomer(newFor);
  const caseId = params.get('caseId');
  if (caseId) {
    await viewCase(caseId);
    document.getElementById('case-detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  if (!(await ensureAuth())) return;
  renderHeaderUser();
  applyAdminOnlyVisibility();
  await loadCasesPageInit();
  applyCaseQueryParams();

  bindEnterSubmit('#case-search-panel', loadCases);
  bindEnterSubmit('#case-edit-panel', saveCaseEdit);
});

// 導覽列「↻ 重撈資料」
window.refreshPageData = () => loadCasesPageInit();
