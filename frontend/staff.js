/**
 * staff.js - 人員管理頁專屬邏輯（業務/FAE 快速新增清單，僅 admin 可操作）
 */
let allStaff = [];

async function loadStaff() {
  const result = await callApi('getStaff', {});
  const msg = document.getElementById('staff-message');
  const table = document.getElementById('staff-table');
  if (!result.success) {
    msg.textContent = result.message || '權限不足，只有管理員可以使用這個功能';
    table.style.display = 'none';
    return;
  }
  msg.textContent = '';
  table.style.display = '';
  allStaff = result.staff;
  renderStaffTable();
}

function renderStaffTable() {
  const tbody = document.querySelector('#staff-table tbody');
  tbody.innerHTML = '';
  allStaff.forEach((s) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${s.Name}</td><td>${s.Role || ''}</td>
      <td>
        <button onclick="editStaffRole(${s.RowIndex}, '${(s.Role || '').replace(/'/g, "\\'")}')">修改角色</button>
        <button onclick="deleteStaffRow(${s.RowIndex})">刪除</button>
      </td>`;
    tbody.appendChild(tr);
  });
}

async function addStaff() {
  const name = document.getElementById('staff-name').value.trim();
  if (!name) return alert('請輸入姓名');
  const result = await callApi('addStaff', { name, role: document.getElementById('staff-role').value });
  if (!result.success) return alert(result.message);
  document.getElementById('staff-name').value = '';
  loadStaff();
}

async function editStaffRole(rowIndex, currentRole) {
  const role = prompt('修改角色（業務／FAE／其他）：', currentRole || '');
  if (role === null) return;
  const result = await callApi('updateStaff', { rowIndex, fields: { Role: role } });
  if (!result.success) return alert(result.message);
  loadStaff();
}

async function deleteStaffRow(rowIndex) {
  if (!confirm('確定要刪除這位人員嗎？')) return;
  const result = await callApi('deleteStaff', { rowIndex });
  if (!result.success) return alert(result.message);
  loadStaff();
}

async function loadSoftware() {
  const result = await callApi('getSoftware', {});
  const table = document.getElementById('software-table');
  if (!result.success) return;
  table.style.display = '';
  const tbody = table.querySelector('tbody');
  tbody.innerHTML = '';
  result.software.forEach((s) => {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.textContent = s.Name;
    const td2 = document.createElement('td');
    const btn = document.createElement('button');
    btn.textContent = '刪除';
    btn.onclick = () => deleteSoftwareName(s.RowIndex, s.Name);
    td2.appendChild(btn);
    tr.append(td, td2);
    tbody.appendChild(tr);
  });
}

async function addSoftwareName() {
  const name = document.getElementById('software-name').value.trim();
  if (!name) return alert('請輸入軟體名稱');
  const result = await callApi('addSoftware', { name });
  if (!result.success) return alert(result.message);
  clearCached('casesPageData');
  document.getElementById('software-name').value = '';
  loadSoftware();
}

async function deleteSoftwareName(rowIndex, name) {
  if (!confirm(`確定要從清單刪除「${name}」嗎？（已建立的案件不受影響）`)) return;
  const result = await callApi('deleteSoftware', { rowIndex });
  if (!result.success) return alert(result.message);
  clearCached('casesPageData');
  loadSoftware();
}

window.addEventListener('DOMContentLoaded', async () => {
  if (!(await ensureAuth())) return;
  renderHeaderUser();
  applyAdminOnlyVisibility();
  await loadStaff();
  loadSoftware();
  bindEnterSubmit('#staff-add-panel', addStaff);
});
