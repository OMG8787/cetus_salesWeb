/**
 * customers.js - 客戶管理 頁面專屬邏輯
 */

let allCustomers = [];

async function addCustomer() {
  const result = await callApi('addCustomer', {
    companyName: document.getElementById('cust-company').value,
    contact: document.getElementById('cust-contact').value,
    phone: document.getElementById('cust-phone').value,
    email: document.getElementById('cust-email').value,
    nextFollowUpDate: document.getElementById('cust-followup').value,
    category: document.getElementById('cust-category').value,
    urgency: document.getElementById('cust-urgency').value,
  });
  if (result.success) {
    clearCached('customers');
    clearCached('casesPageData');
    alert('已新增客戶');
    ['cust-company', 'cust-contact', 'cust-phone', 'cust-email', 'cust-followup'].forEach((id) => (document.getElementById(id).value = ''));
    loadCustomers();
  } else {
    alert(result.message);
  }
}

async function loadCustomers() {
  const cached = getCached('customers');
  if (cached) {
    allCustomers = cached;
    renderCustomerTable();
    updateCustomerDatalist();
  }

  const result = await callApi('getCustomers', {});
  if (!result.success) return;
  allCustomers = result.customers;
  setCached('customers', allCustomers);
  renderCustomerTable();
  updateCustomerDatalist();
}

function updateCustomerDatalist() {
  const list = document.getElementById('customer-company-list');
  list.innerHTML = '';
  [...new Set(allCustomers.map((c) => c.CompanyName).filter(Boolean))].forEach((name) => {
    const opt = document.createElement('option');
    opt.value = name;
    list.appendChild(opt);
  });
}

function renderCustomerTable() {
  const categoryFilter = document.getElementById('cust-filter-category').value;
  const urgencyFilter = document.getElementById('cust-filter-urgency').value;

  let rows = allCustomers.slice();
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
    tr.innerHTML = `<td>${c.CompanyName}</td><td>${c.Contact}</td><td>${c.Phone}</td><td>${c.Category || ''}</td><td>${c.Urgency || ''}</td><td>${c.NextFollowUpDate || '（未設定）'}</td>
      <td>
        <button onclick="editCustomerFollowUp(${c.RowIndex}, '${c.NextFollowUpDate || ''}')">編輯追蹤日</button>
        <button onclick="deleteCustomerRow(${c.RowIndex})">刪除</button>
      </td>`;
    tbody.appendChild(tr);
  });
}

async function editCustomerFollowUp(rowIndex, currentDate) {
  const newDate = prompt('設定下次追蹤日 (格式 YYYY-MM-DD)：', currentDate || '');
  if (newDate === null) return;
  const result = await callApi('updateCustomer', { rowIndex, fields: { NextFollowUpDate: newDate } });
  if (result.success) {
    clearCached('customers');
    clearCached('casesPageData');
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

async function addContactLog() {
  const result = await callApi('addContactLog', {
    companyName: document.getElementById('log-company').value,
    contact: document.getElementById('log-contact').value,
    method: document.getElementById('log-method').value,
    summary: document.getElementById('log-summary').value,
    salesperson: currentUsername || '',
  });
  if (result.success) {
    alert('已新增聯繫紀錄');
    ['log-company', 'log-contact', 'log-summary'].forEach((id) => (document.getElementById(id).value = ''));
  } else {
    alert(result.message);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  requireLogin();
  renderHeaderUser();
  loadCustomers();
  bindEnterSubmit('#customer-add-panel', addCustomer);
  bindEnterSubmit('#contact-log-panel', addContactLog);
});
