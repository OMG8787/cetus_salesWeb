/**
 * users.js - 帳號管理頁專屬邏輯（僅 admin 角色可用，見後端 PERMISSIONS）
 */
let allUsers = [];
let allRoles = ['admin', 'sales', 'fae'];

async function loadUsers() {
  const result = await callApi('getUsers', {});
  const msg = document.getElementById('users-message');
  const table = document.getElementById('users-table');
  if (!result.success) {
    msg.textContent = result.message || '權限不足，只有管理員可以使用這個功能';
    table.style.display = 'none';
    return;
  }
  msg.textContent = '';
  table.style.display = '';
  allUsers = result.users;
  if (result.roles && result.roles.length) allRoles = result.roles;
  renderUsersTable();
}

function renderUsersTable() {
  const tbody = document.querySelector('#users-table tbody');
  tbody.innerHTML = '';
  allUsers.forEach((u) => {
    const tr = document.createElement('tr');
    const roleOptions = allRoles.map((r) => `<option value="${r}" ${r === u.Role ? 'selected' : ''}>${r}</option>`).join('');
    tr.innerHTML = `<td>${u.Username}</td><td>${u.DisplayName || ''}</td>
      <td><select onchange="changeUserRole(${u.RowIndex}, this.value)">${roleOptions}</select></td>
      <td>
        <button onclick="resetPassword(${u.RowIndex}, '${u.Username}')">重設密碼</button>
        <button onclick="deleteUserRow(${u.RowIndex}, '${u.Username}')">刪除</button>
      </td>`;
    tbody.appendChild(tr);
  });
}

async function addUser() {
  const username = document.getElementById('user-username').value.trim();
  if (!username) return alert('請輸入帳號');
  const password = document.getElementById('user-password').value.trim();
  const result = await callApi('addUser', {
    username,
    displayName: document.getElementById('user-displayname').value.trim(),
    role: document.getElementById('user-role').value,
    password: password || undefined,
  });
  const resultBox = document.getElementById('user-add-result');
  if (!result.success) {
    resultBox.textContent = result.message || '新增失敗';
    return;
  }
  resultBox.textContent = result.password
    ? `已新增帳號「${username}」，自動產生的密碼是：${result.password}（請截圖或抄下來，系統之後不會再顯示一次）`
    : `已新增帳號「${username}」`;
  ['user-username', 'user-displayname', 'user-password'].forEach((id) => (document.getElementById(id).value = ''));
  loadUsers();
}

async function changeUserRole(rowIndex, role) {
  const result = await callApi('updateUser', { rowIndex, fields: { Role: role } });
  if (!result.success) {
    alert(result.message);
    loadUsers();
  }
}

async function resetPassword(rowIndex, username) {
  const password = prompt(`重設「${username}」的密碼（留空自動產生亂數密碼）：`, '');
  if (password === null) return;
  const result = await callApi('resetUserPassword', { rowIndex, password: password.trim() || undefined });
  if (!result.success) return alert(result.message);
  alert(`「${username}」的新密碼是：${result.password}（請截圖或抄下來交給當事人，系統之後不會再顯示一次）`);
}

async function deleteUserRow(rowIndex, username) {
  if (!confirm(`確定要刪除帳號「${username}」嗎？這個帳號將無法再登入。`)) return;
  const result = await callApi('deleteUser', { rowIndex });
  if (!result.success) return alert(result.message);
  loadUsers();
}

window.addEventListener('DOMContentLoaded', async () => {
  if (!(await ensureAuth())) return;
  renderHeaderUser();
  applyAdminOnlyVisibility();
  await loadUsers();
  bindEnterSubmit('#user-add-panel', addUser);
});
