/**
 * customers.js - 客戶管理 頁面專屬邏輯
 */

let allCustomers = [];
let allCasesForLog = []; // 目前選的公司底下的案件清單（給聯繫紀錄的「所屬案件」下拉選單用）
let allContactsForLog = []; // 目前選的公司底下的聯絡人清單（給聯繫紀錄的「聯絡人」下拉建議用）
let currentContactsCompany = null; // 聯絡窗口彈窗目前是哪間公司

async function addCustomer() {
  const result = await callApi('addCustomer', {
    companyName: document.getElementById('cust-company').value,
    contact: document.getElementById('cust-contact').value,
    phone: document.getElementById('cust-phone').value,
    email: document.getElementById('cust-email').value,
    nextFollowUpDate: document.getElementById('cust-followup').value,
    nextFollowUpNote: document.getElementById('cust-followup-note').value,
    category: document.getElementById('cust-category').value,
    urgency: document.getElementById('cust-urgency').value,
    hasTransacted: document.getElementById('cust-has-transacted').checked,
    lastTransactionDate: document.getElementById('cust-last-transaction').value,
  });
  if (result.success) {
    clearCached('customers');
    clearCached('casesPageData');
    alert('已新增客戶');
    ['cust-company', 'cust-contact', 'cust-phone', 'cust-email', 'cust-followup', 'cust-followup-note', 'cust-last-transaction'].forEach((id) => (document.getElementById(id).value = ''));
    document.getElementById('cust-has-transacted').checked = false;
    loadCustomers();
  } else {
    alert(result.message);
  }
}

async function loadCustomers() {
  const cached = await getCachedAsync('customers');
  if (cached) {
    allCustomers = cached;
    renderCustomerTable();
    updateCustomerDatalist();
  }

  const result = await callApi('getCustomers', {}, { silent: !!cached });
  if (!result.success) return;
  allCustomers = result.customers;
  setCached('customers', allCustomers);
  renderCustomerTable();
  updateCustomerDatalist();
}

function updateCustomerDatalist() {
  const names = [...new Set(allCustomers.map((c) => c.CompanyName).filter(Boolean))];
  const list = document.getElementById('customer-company-list');
  list.innerHTML = '';
  names.forEach((name) => {
    const opt = document.createElement('option');
    opt.value = name;
    list.appendChild(opt);
  });

  const filterSelect = document.getElementById('log-filter-company');
  const keepValue = filterSelect.value;
  filterSelect.innerHTML = '<option value="">全部公司</option>';
  names.forEach((name) => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    filterSelect.appendChild(opt);
  });
  if (names.includes(keepValue)) filterSelect.value = keepValue;
}

function renderCustomerTable() {
  const categoryFilter = document.getElementById('cust-filter-category').value;
  const urgencyFilter = document.getElementById('cust-filter-urgency').value;

  let rows = allCustomers.slice();
  const kw = (document.getElementById('cust-search').value || '').trim().toLowerCase();
  if (kw) rows = rows.filter((c) => ['CompanyName', 'Contact', 'Phone', 'Email', 'Notes'].some((f) => String(c[f] || '').toLowerCase().includes(kw)));
  if (categoryFilter) rows = rows.filter((c) => c.Category === categoryFilter);
  if (urgencyFilter) rows = rows.filter((c) => c.Urgency === urgencyFilter);

  rows.sort((a, b) => {
    if (!a.NextFollowUpDate) return 1;
    if (!b.NextFollowUpDate) return -1;
    return new Date(a.NextFollowUpDate) - new Date(b.NextFollowUpDate);
  });

  const tbody = document.querySelector('#customer-table tbody');
  tbody.innerHTML = '';
  rows.forEach((c) => {
    const tr = document.createElement('tr');
    const transactedText = c.HasTransacted === '是' ? `已交易${c.LastTransactionDate ? '（' + c.LastTransactionDate + '）' : ''}` : '未交易';
    tr.innerHTML = `<td>${c.CompanyName}</td><td>${c.Contact}</td><td>${c.Phone}</td><td>${c.Category || ''}</td><td>${c.Urgency || ''}</td><td>${customerFollowUpHtml(c.NextFollowUpDate, c.NextFollowUpNote)}</td><td>${transactedText}</td>
      <td>
        <button onclick="openCustomerContactsModal('${escapeAttr(c.CompanyName)}')">聯絡窗口</button>
        <button onclick="viewCasesForCompany('${escapeAttr(c.CompanyName)}')">相關案件</button>
        <button style="background:#8e44ad;" onclick="createCaseForCompany('${escapeAttr(c.CompanyName)}')">建立案件</button>
        <button onclick="openCustomerEditModal(${c.RowIndex})">編輯</button>
        <button style="background:#27ae60;" onclick="doneCustomerFollowUp(${c.RowIndex})">追蹤完畢</button>
        <button onclick="editCustomerFollowUp(${c.RowIndex})">編輯追蹤日</button>
        <button onclick="editCustomerTransaction(${c.RowIndex}, '${c.LastTransactionDate || ''}')">編輯交易狀態</button>
        <button onclick="deleteCustomerRow(${c.RowIndex})">刪除</button>
      </td>`;
    tbody.appendChild(tr);
  });
}

function escapeAttr(str) {
  return String(str == null ? '' : str).replace(/'/g, "\\'");
}

/** 追蹤日欄位：逾期紅字、今天橘字、3 天內黃字，一眼看出誰該追蹤了。 */
function customerFollowUpHtml(dateStr, note) {
  if (!normalizeDateStr(dateStr)) return '（未設定）' + followNoteHtml(note);
  const f = followUpInfo(dateStr);
  return `<span style="color:${f.color};${f.note && f.color !== '#333' ? 'font-weight:bold;' : ''}">${f.text}</span>${f.note ? `<br><small style="color:${f.color};">${f.note}</small>` : ''}${followNoteHtml(note)}`;
}

function doneCustomerFollowUp(rowIndex) {
  const c = allCustomers.find((x) => x.RowIndex === rowIndex);
  if (!c) return;
  openFollowUpDialog({
    companyName: c.CompanyName,
    rowIndex,
    contact: c.Contact || '',
    currentDate: c.NextFollowUpDate,
    currentNote: c.NextFollowUpNote,
    onDone: () => {
      loadCustomers();
      if (typeof loadContactLogs === 'function') loadContactLogs();
    },
  });
}

function editCustomerFollowUp(rowIndex) {
  const c = allCustomers.find((x) => x.RowIndex === rowIndex);
  if (!c) return;
  openFollowUpDialog({
    companyName: c.CompanyName,
    rowIndex,
    currentDate: c.NextFollowUpDate,
    currentNote: c.NextFollowUpNote,
    editOnly: true,
    onDone: () => loadCustomers(),
  });
}

let editingCustomerRow = null;

function openCustomerEditModal(rowIndex) {
  const c = allCustomers.find((x) => x.RowIndex === rowIndex);
  if (!c) return;
  editingCustomerRow = rowIndex;
  const set = (id, v) => (document.getElementById(id).value = v || '');
  set('ce-company', c.CompanyName); set('ce-contact', c.Contact); set('ce-phone', c.Phone); set('ce-email', c.Email);
  set('ce-category', c.Category || '一般客戶'); set('ce-urgency', c.Urgency || '中'); set('ce-followup', c.NextFollowUpDate); set('ce-followup-note', c.NextFollowUpNote);
  document.getElementById('ce-has-transacted').checked = c.HasTransacted === '是';
  set('ce-last-transaction', c.LastTransactionDate); set('ce-notes', c.Notes);
  document.getElementById('customer-edit-modal').style.display = 'flex';
}

function closeCustomerEditModal() {
  document.getElementById('customer-edit-modal').style.display = 'none';
  editingCustomerRow = null;
}

async function saveCustomerEdit() {
  const val = (id) => document.getElementById(id).value;
  if (!val('ce-company').trim()) return alert('公司名稱不能空白');
  const last = val('ce-last-transaction');
  const hasTx = document.getElementById('ce-has-transacted').checked || !!last;
  const result = await callApi('updateCustomer', {
    rowIndex: editingCustomerRow,
    fields: {
      CompanyName: val('ce-company').trim(), Contact: val('ce-contact'), Phone: val('ce-phone'), Email: val('ce-email'),
      Category: val('ce-category'), Urgency: val('ce-urgency'), NextFollowUpDate: val('ce-followup'), NextFollowUpNote: val('ce-followup-note'),
      HasTransacted: hasTx ? '是' : '', LastTransactionDate: last, Notes: val('ce-notes'),
    },
  });
  if (!result.success) return alert(result.message);
  clearCached('customers');
  clearCached('casesPageData');
  closeCustomerEditModal();
  loadCustomers();
}

async function editCustomerTransaction(rowIndex, currentDate) {
  const date = prompt('上次交易日期 (格式 YYYY-MM-DD，留空表示尚未交易過)：', currentDate || '');
  if (date === null) return;
  const result = await callApi('updateCustomer', { rowIndex, fields: { HasTransacted: date ? '是' : '', LastTransactionDate: date } });
  if (result.success) {
    clearCached('customers');
    loadCustomers();
  } else {
    alert(result.message);
  }
}

async function deleteCustomerRow(rowIndex) {
  if (!confirm('確定要刪除這位客戶嗎？此動作無法復原。')) return;
  const result = await callApi('deleteCustomer', { rowIndex });
  if (result.success) {
    clearCached('customers');
    clearCached('casesPageData');
    loadCustomers();
  } else {
    alert(result.message);
  }
}

/** 客戶列表按「建立案件」：跳到案件管理的「建立新案件」，客戶名稱、聯絡人、電話、業務先帶好，只要再填案件內容。 */
function createCaseForCompany(companyName) {
  location.href = `cases.html?newCaseFor=${encodeURIComponent(companyName)}`;
}

/** 客戶列表按「相關案件」：直接跳去案件管理，帶著公司名稱只顯示跟這間公司有關的案件。 */
function viewCasesForCompany(companyName) {
  location.href = `cases.html?company=${encodeURIComponent(companyName)}`;
}

// ------------------------------------------------------------
// 聯絡窗口（一間公司可以有多個，跟客戶列表上的「主要聯絡人」分開管理）
// ------------------------------------------------------------
async function openCustomerContactsModal(companyName) {
  currentContactsCompany = companyName;
  document.getElementById('cc-modal-company').textContent = companyName;
  document.getElementById('customer-contacts-modal').style.display = 'flex';
  await loadCustomerContacts();
}

function closeCustomerContactsModal() {
  document.getElementById('customer-contacts-modal').style.display = 'none';
  currentContactsCompany = null;
}

async function loadCustomerContacts() {
  const result = await callApi('getCustomerContacts', { companyName: currentContactsCompany });
  const tbody = document.querySelector('#customer-contacts-table tbody');
  tbody.innerHTML = '';
  if (!result.success) return alert(result.message);
  result.contacts.forEach((c) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${c.ContactName}</td><td>${c.Title || ''}</td><td>${c.Phone || ''}</td><td>${c.Email || ''}</td><td>${c.Notes || ''}</td>
      <td><button onclick="editCustomerContact(${c.RowIndex}, '${escapeAttr(c.ContactName)}', '${escapeAttr(c.Phone)}', '${escapeAttr(c.Email)}')">編輯</button> <button onclick="deleteCustomerContact(${c.RowIndex})">刪除</button></td>`;
    tbody.appendChild(tr);
  });
}

async function addCustomerContact() {
  const contactName = document.getElementById('cc-name').value.trim();
  if (!contactName) return alert('請輸入聯絡人姓名');
  const result = await callApi('addCustomerContact', {
    companyName: currentContactsCompany,
    contactName,
    title: document.getElementById('cc-title').value,
    phone: document.getElementById('cc-phone').value,
    email: document.getElementById('cc-email').value,
    notes: document.getElementById('cc-notes').value,
  });
  if (!result.success) return alert(result.message);
  ['cc-name', 'cc-title', 'cc-phone', 'cc-email', 'cc-notes'].forEach((id) => (document.getElementById(id).value = ''));
  loadCustomerContacts();
}

async function editCustomerContact(rowIndex, name, phone, email) {
  const n = prompt('姓名：', name);
  if (n === null) return;
  const p = prompt('電話：', phone);
  if (p === null) return;
  const e = prompt('Email：', email);
  if (e === null) return;
  const result = await callApi('updateCustomerContact', { rowIndex, fields: { ContactName: n, Phone: p, Email: e } });
  if (!result.success) return alert(result.message);
  loadCustomerContacts();
}

async function deleteCustomerContact(rowIndex) {
  if (!confirm('確定要刪除這個聯絡窗口嗎？')) return;
  const result = await callApi('deleteCustomerContact', { rowIndex });
  if (!result.success) return alert(result.message);
  loadCustomerContacts();
}

// ------------------------------------------------------------
// 客戶聯繫紀錄：新增時可以指定「所屬案件」（同客戶有多個案件時分開查），
// 公司名稱一填好就會抓這間公司的案件清單跟聯絡人清單
// ------------------------------------------------------------
async function onLogCompanyChange() {
  const companyName = document.getElementById('log-company').value.trim();
  const caseSelect = document.getElementById('log-case');
  const contactList = document.getElementById('log-contact-datalist');
  caseSelect.innerHTML = '<option value="">（不指定案件）</option>';
  contactList.innerHTML = '';
  allCasesForLog = [];
  allContactsForLog = [];
  if (!companyName) return;

  const [casesResult, contactsResult] = await Promise.all([
    callApi('getCases', { companyName }),
    callApi('getCustomerContacts', { companyName }),
  ]);
  if (casesResult.success) {
    allCasesForLog = casesResult.cases;
    allCasesForLog.forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c.CaseID;
      opt.textContent = `${c.CaseID}（${c.Status}）`;
      caseSelect.appendChild(opt);
    });
  }
  if (contactsResult.success) {
    allContactsForLog = contactsResult.contacts;
    allContactsForLog.forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c.ContactName;
      contactList.appendChild(opt);
    });
  }
}

async function addContactLog() {
  const result = await callApi('addContactLog', {
    companyName: document.getElementById('log-company').value,
    contact: document.getElementById('log-contact').value,
    method: document.getElementById('log-method').value,
    summary: document.getElementById('log-summary').value,
    salesperson: currentUsername || '',
    caseId: document.getElementById('log-case').value,
  });
  if (result.success) {
    alert('已新增聯繫紀錄');
    ['log-contact', 'log-summary'].forEach((id) => (document.getElementById(id).value = ''));
    document.getElementById('log-case').value = '';
    loadContactLogs();
  } else {
    alert(result.message);
  }
}

async function loadContactLogs() {
  const companyName = document.getElementById('log-filter-company').value;
  const result = await callApi('getContactLogs', { companyName });
  const tbody = document.querySelector('#contact-log-table tbody');
  tbody.innerHTML = '';
  if (!result.success) return;
  result.logs.forEach((l) => {
    const tr = document.createElement('tr');
    const caseCell = l.CaseID ? `<a href="cases.html?caseId=${encodeURIComponent(l.CaseID)}">${l.CaseID}</a>` : '';
    tr.innerHTML = `<td>${l.Date}</td><td>${l.CompanyName}</td><td>${l.Contact || ''}</td><td>${l.Method || ''}</td><td>${l.Summary || ''}</td><td>${l.Salesperson || ''}</td><td>${caseCell}</td>
      <td><button onclick="editContactLog(${l.RowIndex}, '${escapeAttr((l.Summary || '').replace(/\n/g, ' '))}')">編輯摘要</button> <button onclick="deleteContactLog(${l.RowIndex})">刪除</button></td>`;
    tbody.appendChild(tr);
  });
}

async function editContactLog(rowIndex, summary) {
  const v = prompt('修改聯繫內容摘要：', summary);
  if (v === null) return;
  const result = await callApi('updateContactLog', { rowIndex, fields: { Summary: v } });
  if (!result.success) return alert(result.message);
  loadContactLogs();
}

async function deleteContactLog(rowIndex) {
  if (!confirm('確定要刪除這筆聯繫紀錄嗎？')) return;
  const result = await callApi('deleteContactLog', { rowIndex });
  if (!result.success) return alert(result.message);
  loadContactLogs();
}

/** 從案件管理頁的「客戶聯繫紀錄」連結過來時，直接帶出這間公司、篩選列表。 */
function applyCompanyFromQuery() {
  const company = new URL(location.href).searchParams.get('company');
  if (!company) return;
  document.getElementById('log-company').value = company;
  document.getElementById('log-filter-company').value = company;
  onLogCompanyChange();
  const hint = document.getElementById('contact-log-filter-hint');
  hint.style.display = '';
  hint.textContent = `目前只顯示「${company}」的聯繫紀錄，上面篩選改回「全部公司」可以看全部。`;
}

window.addEventListener('DOMContentLoaded', async () => {
  if (!(await ensureAuth())) return;
  renderHeaderUser();
  applyAdminOnlyVisibility();
  await loadCustomers();
  applyCompanyFromQuery();
  loadContactLogs();
  bindEnterSubmit('#customer-add-panel', addCustomer);
  bindEnterSubmit('#contact-log-panel', addContactLog);
  bindEnterSubmit('#customer-contact-add-panel', addCustomerContact);
});

// 導覽列「↻ 重撈資料」
window.refreshPageData = () => loadCustomers();
