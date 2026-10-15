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
    companyPhone: document.getElementById('cust-company-phone').value,
    taxId: document.getElementById('cust-taxid').value.trim(),
    address: document.getElementById('cust-address').value.trim(),
    email: document.getElementById('cust-email').value,
    nextFollowUpDate: document.getElementById('cust-followup').value,
    nextFollowUpTime: document.getElementById('cust-followup-time').value,
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
    ['cust-company', 'cust-contact', 'cust-phone', 'cust-company-phone', 'cust-taxid', 'cust-address', 'cust-email', 'cust-followup', 'cust-followup-time', 'cust-followup-note', 'cust-last-transaction'].forEach((id) => (document.getElementById(id).value = ''));
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
  if (kw) rows = rows.filter((c) => ['CompanyName', 'Contact', 'Phone', 'CompanyPhone', 'TaxId', 'Address', 'Email', 'Notes'].some((f) => String(c[f] || '').toLowerCase().includes(kw)));
  if (categoryFilter) rows = rows.filter((c) => c.Category === categoryFilter);
  if (urgencyFilter) rows = rows.filter((c) => c.Urgency === urgencyFilter);

  rows.sort((a, b) => {
    if (!a.NextFollowUpDate) return 1;
    if (!b.NextFollowUpDate) return -1;
    return new Date(a.NextFollowUpDate) - new Date(b.NextFollowUpDate) || timeMinutes(a.NextFollowUpTime) - timeMinutes(b.NextFollowUpTime);
  });

  const tbody = document.querySelector('#customer-table tbody');
  tbody.innerHTML = '';
  rows.forEach((c) => {
    const tr = document.createElement('tr');
    const transactedText = c.HasTransacted === '是' ? `已交易${c.LastTransactionDate ? '（' + c.LastTransactionDate + '）' : ''}` : '未交易';
    const nameArg = encodeURIComponent(c.CompanyName || '');
    const nm = `decodeURIComponent('${nameArg}')`;
    tr.innerHTML = `<td>${htmlEsc(c.CompanyName)}${[c.TaxId && '統編 ' + c.TaxId, c.CompanyPhone && '公司電話 ' + c.CompanyPhone, c.Address].filter(Boolean).map((x) => '<div class="calc-hint" style="margin:0;">' + htmlEsc(x) + '</div>').join('')}</td><td>${htmlEsc(c.Contact)}</td><td>${htmlEsc(c.Phone)}</td><td>${htmlEsc(c.Category || '')}</td><td>${htmlEsc(c.Urgency || '')}</td><td>${customerFollowUpHtml(c.NextFollowUpDate, c.NextFollowUpNote, c.NextFollowUpTime)}</td><td>${htmlEsc(transactedText)}</td>
      <td>
        <button onclick="openCustomerContactsModal(${nm})">聯絡窗口</button>
        <button onclick="viewCasesForCompany(${nm})">相關案件</button>
        <button style="background:#8e44ad;" onclick="createCaseForCompany(${nm})">建立案件</button>
        <button onclick="openCustomerEditModal(${nm})">編輯</button>
        <button style="background:#27ae60;" onclick="doneCustomerFollowUp(${nm})">追蹤完畢</button>
        <button onclick="editCustomerFollowUp(${nm})">編輯追蹤日</button>
        <button onclick="editCustomerTransaction(${nm})">編輯交易狀態</button>
        <button onclick="deleteCustomerRow(${nm})">刪除</button>
      </td>`;
    tbody.appendChild(tr);
  });
}

function escapeAttr(str) {
  return String(str == null ? '' : str).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** 用公司名稱找客戶（列號在別人新增 / 刪除後會位移，名稱才是穩定的鍵）。 */
function findCustomerByName(name) {
  return allCustomers.find((x) => x.CompanyName === name) || null;
}

/** 存檔後把後端回傳的客戶資料直接套進清單與暫存，畫面馬上更新，不用等重新載入。 */
function applyCustomerSaved(r, oldName) {
  if (r && r.customer) {
    patchCustomerList(allCustomers, r.customer, oldName);
    setCached('customers', allCustomers);
    clearCached('casesPageData');
    if (oldName && r.customer.CompanyName !== oldName) {
      ContactLogStore.rename(oldName, r.customer.CompanyName);
      updateCustomerDatalist();
    }
    renderCustomerTable();
  }
}

/** 追蹤日欄位：逾期紅字、今天橘字、3 天內黃字，一眼看出誰該追蹤了。 */
function customerFollowUpHtml(dateStr, note, timeStr) {
  if (!normalizeDateStr(dateStr)) return '（未設定）' + followNoteHtml(note);
  const f = followUpInfo(dateStr, timeStr);
  return `<span style="color:${f.color};${f.note && f.color !== '#333' ? 'font-weight:bold;' : ''}">${htmlEsc(f.text)}</span>${f.note ? `<br><small style="color:${f.color};">${f.note}</small>` : ''}${followNoteHtml(note)}`;
}

function doneCustomerFollowUp(name) {
  const c = findCustomerByName(name);
  if (!c) return alert('找不到「' + name + '」，請按「重新整理」後再試');
  openFollowUpDialog({
    companyName: c.CompanyName,
    rowIndex: c.RowIndex,
    contact: c.Contact || '',
    customer: c,
    onSaved: applyCustomerSaved,
    onDone: () => loadContactLogs(),
  });
}

function editCustomerFollowUp(name) {
  const c = findCustomerByName(name);
  if (!c) return alert('找不到「' + name + '」，請按「重新整理」後再試');
  openFollowUpDialog({
    companyName: c.CompanyName,
    rowIndex: c.RowIndex,
    customer: c,
    editOnly: true,
    onSaved: applyCustomerSaved,
    onDone: () => loadContactLogs(),
  });
}

let editingCustomerRow = null;
let editingCustomerName = null; // 打開編輯視窗當下的公司名稱（儲存時用來確認改的是同一間）

function openCustomerEditModal(name) {
  const c = findCustomerByName(name);
  if (!c) return alert('找不到「' + name + '」，請按「重新整理」後再試');
  editingCustomerRow = c.RowIndex;
  editingCustomerName = c.CompanyName;
  const set = (id, v) => (document.getElementById(id).value = v || '');
  set('ce-company', c.CompanyName); set('ce-contact', c.Contact); set('ce-phone', c.Phone); set('ce-company-phone', c.CompanyPhone); set('ce-taxid', c.TaxId); set('ce-address', c.Address); set('ce-email', c.Email);
  set('ce-category', c.Category || '一般客戶'); set('ce-urgency', c.Urgency || '中'); set('ce-followup', c.NextFollowUpDate); set('ce-followup-time', c.NextFollowUpTime); set('ce-followup-note', c.NextFollowUpNote);
  document.getElementById('ce-has-transacted').checked = c.HasTransacted === '是';
  set('ce-last-transaction', c.LastTransactionDate); set('ce-notes', c.Notes);
  document.getElementById('customer-edit-modal').style.display = 'flex';
}

function closeCustomerEditModal() {
  document.getElementById('customer-edit-modal').style.display = 'none';
  editingCustomerRow = null;
  editingCustomerName = null;
}

async function saveCustomerEdit() {
  const val = (id) => document.getElementById(id).value;
  if (!val('ce-company').trim()) return alert('公司名稱不能空白');
  const last = val('ce-last-transaction');
  const hasTx = document.getElementById('ce-has-transacted').checked || !!last;
  const result = await callApi('updateCustomer', {
    rowIndex: editingCustomerRow,
    companyName: editingCustomerName,
    fields: {
      CompanyName: val('ce-company').trim(), Contact: val('ce-contact'), Phone: val('ce-phone'), CompanyPhone: val('ce-company-phone'), TaxId: val('ce-taxid').trim(), Address: val('ce-address').trim(), Email: val('ce-email'),
      Category: val('ce-category'), Urgency: val('ce-urgency'), NextFollowUpDate: val('ce-followup'), NextFollowUpTime: val('ce-followup-time'), NextFollowUpNote: val('ce-followup-note'),
      HasTransacted: hasTx ? '是' : '', LastTransactionDate: last, Notes: val('ce-notes'),
    },
  });
  if (!result.success) return alert(result.message);
  const oldName = editingCustomerName;
  closeCustomerEditModal();
  applyCustomerSaved(result, oldName);
  if (result.log) ContactLogStore.add(result.log);
  loadContactLogs();
  loadCustomers(); // 背景跟資料庫同步
}

async function editCustomerTransaction(name) {
  const c = findCustomerByName(name);
  if (!c) return alert('找不到「' + name + '」，請按「重新整理」後再試');
  const date = prompt('上次交易日期 (格式 YYYY-MM-DD，留空表示尚未交易過)：', c.LastTransactionDate || '');
  if (date === null) return;
  const d = date.trim();
  if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) return alert('日期格式要是 YYYY-MM-DD，例如 2026-10-15');
  const result = await callApi('updateCustomer', { rowIndex: c.RowIndex, companyName: c.CompanyName, fields: { HasTransacted: d ? '是' : '', LastTransactionDate: d } });
  if (!result.success) return alert(result.message);
  applyCustomerSaved(result, c.CompanyName);
  if (result.log) ContactLogStore.add(result.log);
  loadContactLogs();
}

async function deleteCustomerRow(name) {
  const c = findCustomerByName(name);
  if (!c) return alert('找不到「' + name + '」，請按「重新整理」後再試');
  if (!confirm('確定要刪除「' + c.CompanyName + '」嗎？此動作無法復原。\n\n（這間客戶的聯繫紀錄與聯絡窗口會保留在試算表裡，不會一起刪除。）')) return;
  let result = await callApi('deleteCustomer', { rowIndex: c.RowIndex, companyName: c.CompanyName });
  if (!result.success && result.needConfirm) {
    if (!confirm(result.message + '\n\n確定還是要刪除這間客戶嗎？')) return;
    result = await callApi('deleteCustomer', { rowIndex: c.RowIndex, companyName: c.CompanyName, force: true });
  }
  if (!result.success) return alert(result.message);
  clearCached('customers');
  clearCached('casesPageData');
  loadCustomers();
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
    const enc = (v) => encodeURIComponent(v == null ? '' : v);
    tr.innerHTML = `<td>${htmlEsc(c.ContactName)}</td><td>${htmlEsc(c.Title || '')}</td><td>${htmlEsc(c.Phone || '')}</td><td>${htmlEsc(c.Email || '')}</td><td>${htmlEsc(c.Notes || '')}</td>
      <td><button onclick="editCustomerContact(${c.RowIndex}, decodeURIComponent('${enc(c.ContactName)}'), decodeURIComponent('${enc(c.Phone)}'), decodeURIComponent('${enc(c.Email)}'))">編輯</button> <button onclick="deleteCustomerContact(${c.RowIndex}, decodeURIComponent('${enc(c.ContactName)}'))">刪除</button></td>`;
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
  const result = await callApi('updateCustomerContact', { rowIndex, expect: { CompanyName: currentContactsCompany, ContactName: name }, fields: { ContactName: n, Phone: p, Email: e } });
  if (!result.success) {
    alert(result.message);
    return loadCustomerContacts();
  }
  loadCustomerContacts();
}

async function deleteCustomerContact(rowIndex, name) {
  if (!confirm('確定要刪除聯絡窗口「' + name + '」嗎？')) return;
  const result = await callApi('deleteCustomerContact', { rowIndex, expect: { CompanyName: currentContactsCompany, ContactName: name } });
  if (!result.success) alert(result.message);
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
  if (!document.getElementById('log-company').value.trim()) return alert('請先填公司名稱');
  if (!document.getElementById('log-summary').value.trim() && !confirm('聯繫內容摘要是空的，確定要新增嗎？')) return;
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
    if (result.log) ContactLogStore.add(result.log);
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
  currentLogRows = {};
  if (companyName) ContactLogStore.byCompany[companyName] = result.logs.slice().sort(compareLogsDesc);
  else ContactLogStore.setAll(result.logs);
  result.logs.forEach((l) => {
    currentLogRows[l.RowIndex] = l;
    const tr = document.createElement('tr');
    const caseCell = l.CaseID ? `<a href="cases.html?caseId=${encodeURIComponent(l.CaseID)}">${htmlEsc(l.CaseID)}</a>` : '';
    const change = isChangeLog(l);
    const summary = `${change && (l.Summary === '修改客戶資料' || l.Summary === '修改下次追蹤') ? '' : htmlEsc(l.Summary || '')}${l.Changes ? `<div class="fu-hist-changes">${htmlEsc(l.Changes)}</div>` : ''}`;
    tr.innerHTML = `<td>${htmlEsc(l.Date)}${l.CreatedAt && String(l.CreatedAt).slice(0, 10) === l.Date ? '<br><small class="calc-hint">' + htmlEsc(String(l.CreatedAt).slice(11, 16)) + '</small>' : ''}</td><td>${htmlEsc(l.CompanyName)}</td><td>${htmlEsc(l.Contact || '')}</td><td>${change ? '✏️ ' : ''}${htmlEsc(l.Method || '')}</td><td style="white-space:pre-wrap;">${summary}</td><td>${htmlEsc(l.Salesperson || '')}</td><td>${caseCell}</td>
      <td>${change ? '' : `<button onclick="editContactLog(${l.RowIndex})">編輯摘要</button> `}<button onclick="deleteContactLog(${l.RowIndex})">刪除</button></td>`;
    tbody.appendChild(tr);
  });
}

let currentLogRows = {}; // 列號 → 目前列表上的聯繫紀錄（編輯 / 刪除時用來確認還是同一筆）

function logExpect(l) {
  return { CompanyName: l.CompanyName, Date: l.Date, Summary: l.Summary };
}

async function editContactLog(rowIndex) {
  const l = currentLogRows[rowIndex];
  if (!l) return;
  const v = prompt('修改聯繫內容摘要：', l.Summary || '');
  if (v === null) return;
  const result = await callApi('updateContactLog', { rowIndex, expect: logExpect(l), fields: { Summary: v } });
  if (!result.success) alert(result.message);
  loadContactLogs();
}

async function deleteContactLog(rowIndex) {
  const l = currentLogRows[rowIndex];
  if (!l) return;
  if (!confirm('確定要刪除這筆聯繫紀錄嗎？\n\n' + l.Date + '　' + l.CompanyName + '\n' + String(l.Summary || l.Changes || '').slice(0, 60))) return;
  const result = await callApi('deleteContactLog', { rowIndex, expect: logExpect(l) });
  if (!result.success) alert(result.message);
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
window.refreshPageData = async () => {
  await loadCustomers();
  await loadContactLogs();
};

// ------------------------------------------------------------
// 從客戶直接建立案件（編輯客戶視窗的「建立案件」）
// ------------------------------------------------------------
let ncCustomer = null;
let ncSoftware = [];

function ncCasePart(str) {
  const t = String(str || '').trim().replace(/[^\w\u4e00-\u9fa5]+/g, '').slice(0, 20);
  return t || 'NA';
}

/** 案件編號（專案名稱）預覽：跟後端同一套規則。 */
function updateNewCasePreview() {
  const el = document.getElementById('nc-preview');
  if (!el) return;
  const v = (id) => document.getElementById(id).value;
  const id = [v('nc-software'), v('nc-obj'), v('nc-app'), v('nc-customer')].map(ncCasePart).join('-');
  el.innerHTML = `案件編號（專案名稱）預覽：<b>${id}</b>${id.split('-').includes('NA') ? ' <span style="color:#c0392b;">（有 NA 代表還有欄位沒填）</span>' : ''}`;
}

async function loadNewCaseLists() {
  const fill = (id, names) => {
    const dl = document.getElementById(id);
    dl.innerHTML = '';
    [...new Set(names.filter(Boolean))].forEach((n) => {
      const o = document.createElement('option');
      o.value = n;
      dl.appendChild(o);
    });
  };
  const apply = (d) => {
    ncSoftware = d.software || [];
    fill('nc-software-list', ncSoftware);
    fill('nc-sales-list', (d.staff || []).filter((x) => x.Role === '業務').map((x) => x.Name));
    fill('nc-fae-list', (d.staff || []).filter((x) => x.Role === 'FAE').map((x) => x.Name));
  };
  const cached = await getCachedAsync('casesPageData');
  if (cached) apply(cached);
  const r = await callApi('getCasesPageData', {}, { silent: true });
  if (r && r.success) {
    setCached('casesPageData', r);
    apply(r);
  }
}

function openNewCaseModal() {
  const c = findCustomerByName(editingCustomerName);
  if (!c) return;
  if (document.getElementById('ce-company').value.trim() !== String(c.CompanyName).trim()) {
    return alert('公司名稱已經被修改但還沒儲存，請先按「儲存」再建立案件。');
  }
  ncCustomer = c;
  const set = (id, v) => (document.getElementById(id).value = v || '');
  document.getElementById('nc-title').textContent = c.CompanyName;
  set('nc-customer', c.CompanyName);
  set('nc-end-customer', '');
  set('nc-contact', document.getElementById('ce-contact').value || c.Contact);
  set('nc-phone', document.getElementById('ce-phone').value || c.Phone);
  set('nc-sales', typeof currentUsername !== 'undefined' ? currentUsername : '');
  ['nc-fae', 'nc-app', 'nc-obj', 'nc-software', 'nc-requirement', 'nc-followup-note'].forEach((id) => set(id, ''));
  document.getElementById('nc-urgency').value = c.Urgency || '中';
  document.getElementById('nc-open-case').checked = false;
  const addDays = (n) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  set('nc-followup', addDays(3));
  set('nc-followup-time', '');
  const quick = document.getElementById('nc-quick');
  quick.innerHTML = '';
  [['明天', 1], ['3 天後', 3], ['1 週後', 7], ['2 週後', 14]].forEach(([label, n]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn-mini';
    b.textContent = label;
    b.onclick = () => (document.getElementById('nc-followup').value = addDays(n));
    quick.appendChild(b);
  });
  updateNewCasePreview();
  document.getElementById('customer-edit-modal').style.display = 'none';
  document.getElementById('newcase-modal').style.display = 'flex';
  loadNewCaseLists();
}

function closeNewCaseModal() {
  document.getElementById('newcase-modal').style.display = 'none';
}

async function submitNewCase() {
  if (!ncCustomer) return;
  const v = (id) => document.getElementById(id).value.trim();
  const missing = [['nc-software', '使用軟體名稱'], ['nc-obj', '待測物件'], ['nc-app', '產品應用']].filter(([id]) => !v(id));
  if (missing.length) {
    alert('這幾個欄位會組成案件編號（專案名稱），請先填寫：\n\n' + missing.map(([, n]) => '．' + n).join('\n'));
    document.getElementById(missing[0][0]).focus();
    return;
  }
  // 軟體名稱不在資料庫時，問要不要新增（跟案件頁一樣）
  const sw = v('nc-software');
  const known = ncSoftware.find((n) => n.toLowerCase() === sw.toLowerCase());
  if (!known) {
    if (!confirm(`「${sw}」不在軟體名稱資料庫內，是否新增？`)) return;
    const a = await callApi('addSoftware', { name: sw });
    if (!a.success) return alert(a.message);
    ncSoftware.push(sw);
    clearCached('casesPageData');
  } else {
    document.getElementById('nc-software').value = known;
  }
  const followup = document.getElementById('nc-followup').value;
  const r = await callApi('createCase', {
    customerName: ncCustomer.CompanyName,
    endCustomerName: v('nc-end-customer'),
    projectContact: v('nc-contact'),
    contactPhone: v('nc-phone'),
    salesperson: v('nc-sales'),
    fae: v('nc-fae'),
    productApplication: v('nc-app'),
    testObject: v('nc-obj'),
    softwareName: known || sw,
    requirementDetails: document.getElementById('nc-requirement').value,
    urgency: document.getElementById('nc-urgency').value,
    ccdRequirements: [],
    relatedCompanies: [],
  });
  if (!r.success) return alert(r.message);
  let msg = '案件已建立：' + r.caseId;
  if (followup) {
    const u = await callApi('updateCustomer', { rowIndex: ncCustomer.RowIndex, companyName: ncCustomer.CompanyName, logMethod: '改期', logSummary: '建立案件「' + r.caseId + '」並設定下次追蹤', caseId: r.caseId, fields: { NextFollowUpDate: followup, NextFollowUpTime: document.getElementById('nc-followup-time').value, NextFollowUpNote: document.getElementById('nc-followup-note').value.trim() } });
    msg += u.success ? '\n下次追蹤日已設定為 ' + followup : '\n（案件已建立，但追蹤日設定失敗：' + u.message + '）';
  }
  clearCached('customers');
  clearCached('casesPageData');
  closeNewCaseModal();
  alert(msg);
  if (document.getElementById('nc-open-case').checked) {
    location.href = 'cases.html?caseId=' + encodeURIComponent(r.caseId);
    return;
  }
  loadCustomers();
}
