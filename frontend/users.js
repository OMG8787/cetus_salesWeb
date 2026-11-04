/**
 * users.js - 帳號管理頁專屬邏輯（僅系統管理員可用）
 * 四種角色：admin 系統管理員 / editor 編輯者 / viewer 查看 / limited 特定（各功能區塊各自選查看或編輯）。
 */
let allUsers = [];
let allRoles = ['admin', 'editor', 'viewer', 'limited'];
let permBlocks = [
  { key: 'products', label: '產品與詢價（產品搜尋、選型計算、報價系統）' },
  { key: 'cases', label: '案件管理' },
  { key: 'customers', label: '客戶與行事曆（客戶、聯絡人、聯繫紀錄）' },
  { key: 'files', label: '檔案製作（評估報告、行銷宣傳）' },
  { key: 'copy', label: '文案製作' },
  { key: 'bot', label: 'BOT 設定（客服機器人、員工助理）' },
];
let roleLabels = ROLE_LABELS;

// 「特定」角色的快速套用範本
const PERM_TEMPLATES = [
  { name: '業務助理', perms: { products: 'view', cases: 'edit', customers: 'edit', files: 'edit' } },
  { name: '報價專員', perms: { products: 'edit', customers: 'view', cases: 'view', files: 'edit' } },
  { name: '客服小編', perms: { bot: 'edit', customers: 'view' } },
  { name: '文案小編', perms: { copy: 'edit', files: 'view' } },
  { name: '全部只查看', perms: { products: 'view', cases: 'view', customers: 'view', files: 'view', copy: 'view', bot: 'view' } },
];

async function loadUsers() {
  const result = await callApi('getUsers', {});
  const msg = document.getElementById('users-message');
  const table = document.getElementById('users-table');
  if (!result.success) {
    msg.textContent = result.message || '權限不足，只有系統管理員可以使用這個功能';
    table.style.display = 'none';
    return;
  }
  msg.textContent = '';
  table.style.display = '';
  allUsers = result.users;
  if (result.roles && result.roles.length) allRoles = result.roles;
  if (result.blocks && result.blocks.length) permBlocks = result.blocks;
  if (result.roleLabels) roleLabels = result.roleLabels;
  document.getElementById('u-legacy').style.display = result.legacyCount ? '' : 'none';
  document.getElementById('u-legacy-count').textContent = result.legacyCount || 0;
  fillNewRoleSelect();
  renderUsersTable();
}

function fillNewRoleSelect() {
  const sel = document.getElementById('user-role');
  if (sel.options.length) return;
  sel.innerHTML = allRoles.map((r) => `<option value="${htmlEsc(r)}"${r === 'editor' ? ' selected' : ''}>${htmlEsc(roleLabels[r] || r)}</option>`).join('');
  onNewRoleChange();
}

/** 功能權限勾選區：每個區塊 不開放 / 查看 / 編輯；idPrefix 區分「新增帳號」與「編輯權限」視窗。 */
function permsEditorHtml(idPrefix, perms) {
  const rows = permBlocks
    .map((b) => {
      const v = perms[b.key] || '';
      const radio = (val, label) => `<label class="u-perm-opt"><input type="radio" name="${idPrefix}-${b.key}" value="${val}" ${v === val ? 'checked' : ''} /> ${label}</label>`;
      return `<div class="u-perm-row"><span class="u-perm-name">${htmlEsc(b.label)}</span>${radio('', '不開放')}${radio('view', '查看')}${radio('edit', '編輯')}</div>`;
    })
    .join('');
  const tpl = PERM_TEMPLATES.map((t, i) => `<button type="button" class="btn-mini" onclick="applyPermTemplate('${idPrefix}', ${i})">${htmlEsc(t.name)}</button>`).join(' ');
  return `<div class="u-perms"><div class="calc-hint" style="margin-bottom:4px;">快速套用：${tpl}</div>${rows}</div>`;
}

function readPermsFrom(idPrefix) {
  const perms = {};
  permBlocks.forEach((b) => {
    const el = document.querySelector(`input[name="${idPrefix}-${b.key}"]:checked`);
    if (el && el.value) perms[b.key] = el.value;
  });
  return perms;
}

function applyPermTemplate(idPrefix, i) {
  const t = PERM_TEMPLATES[i];
  permBlocks.forEach((b) => {
    const v = t.perms[b.key] || '';
    const el = document.querySelector(`input[name="${idPrefix}-${b.key}"][value="${v}"]`);
    if (el) el.checked = true;
  });
}

function onNewRoleChange() {
  const role = document.getElementById('user-role').value;
  const box = document.getElementById('user-perms-box');
  if (role === 'limited') {
    if (!box.innerHTML) box.innerHTML = permsEditorHtml('np', {});
    box.style.display = '';
  } else {
    box.style.display = 'none';
  }
}

function permSummary(u) {
  if (u.Role === 'admin') return '全部功能（可刪除）';
  if (u.Role === 'editor') return '全部功能（可新增修改，不能刪除）';
  if (u.Role === 'viewer') return '全部功能（只能查看）';
  if (u.Role === 'sales') return '舊角色：業務（可刪除客戶 / 案件等；不能用 BOT 設定、文案製作）';
  if (u.Role === 'fae') return '舊角色：工程（不能刪除；不能用 BOT 設定、文案製作）';
  const p = u.PermsObj || {};
  const parts = permBlocks.filter((b) => p[b.key]).map((b) => `${b.label.replace(/（.*$/, '')}：${p[b.key] === 'edit' ? '編輯' : '查看'}`);
  return parts.length ? parts.join('、') : '<span style="color:#c0392b;">沒有開放任何功能</span>';
}

function renderUsersTable() {
  const tbody = document.querySelector('#users-table tbody');
  tbody.innerHTML = '';
  allUsers.forEach((u) => {
    const tr = document.createElement('tr');
    const isLegacy = u.Role === 'sales' || u.Role === 'fae';
    const roles = isLegacy ? [u.Role].concat(allRoles) : allRoles;
    const roleOptions = roles.map((r) => `<option value="${htmlEsc(r)}" ${r === u.Role ? 'selected' : ''}>${htmlEsc(roleLabels[r] || r)}</option>`).join('');
    const nameArg = `decodeURIComponent('${encodeURIComponent(u.Username || '')}')`;
    const selfNote = u.IsSelf ? ' <span class="memo-tag">你自己</span>' : '';
    tr.innerHTML = `<td>${htmlEsc(u.Username)}${selfNote}</td><td>${htmlEsc(u.DisplayName || '')}</td>
      <td><select onchange="changeUserRole(${u.RowIndex}, this.value, ${nameArg})">${roleOptions}</select></td>
      <td class="u-perm-sum">${permSummary(u)}${u.Role === 'limited' ? ` <button class="btn-mini" onclick="openPermModal(${u.RowIndex})">編輯權限</button>` : ''}</td>
      <td>
        <button onclick="resetPassword(${u.RowIndex}, ${nameArg})">重設密碼</button>
        <button onclick="deleteUserRow(${u.RowIndex}, ${nameArg})">刪除</button>
      </td>`;
    tbody.appendChild(tr);
  });
}

async function addUser() {
  const username = document.getElementById('user-username').value.trim();
  if (!username) return alert('請輸入帳號');
  const password = document.getElementById('user-password').value.trim();
  const role = document.getElementById('user-role').value;
  const perms = role === 'limited' ? readPermsFrom('np') : undefined;
  if (role === 'limited' && !Object.keys(perms).length) return alert('「特定」角色至少要開放一個功能（選「查看」或「編輯」）');
  const result = await callApi('addUser', {
    username,
    displayName: document.getElementById('user-displayname').value.trim(),
    role,
    perms,
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

async function changeUserRole(rowIndex, role, username) {
  const u = allUsers.find((x) => x.RowIndex === rowIndex);
  if (role === 'limited') {
    // 改成「特定」要先選功能權限
    await loadUsers();
    return openPermModal(rowIndex, true);
  }
  if (u && u.IsSelf && u.Role === 'admin' && role !== 'admin') {
    alert('不能把自己降級，以免沒人能管理系統。請先指定另一位系統管理員，再由他來調整你的角色。');
    return loadUsers();
  }
  if (role === 'admin' && !confirm(`確定要讓「${username}」成為系統管理員嗎？\n\n系統管理員擁有全部功能，包含刪除資料與管理帳號。`)) return loadUsers();
  const result = await callApi('updateUser', { rowIndex, fields: { Role: role } });
  if (!result.success) alert(result.message);
  loadUsers();
}

let permModalRow = null;
let permModalFromRoleChange = false;

function openPermModal(rowIndex, fromRoleChange) {
  const u = allUsers.find((x) => x.RowIndex === rowIndex);
  if (!u) return;
  permModalRow = rowIndex;
  permModalFromRoleChange = !!fromRoleChange;
  document.getElementById('perm-modal-user').textContent = `${u.Username}${u.DisplayName ? '（' + u.DisplayName + '）' : ''}`;
  document.getElementById('perm-modal-box').innerHTML = permsEditorHtml('pm', u.PermsObj || {});
  document.getElementById('perm-modal').style.display = 'flex';
}

function closePermModal() {
  document.getElementById('perm-modal').style.display = 'none';
  permModalRow = null;
  loadUsers();
}

async function savePermModal() {
  const perms = readPermsFrom('pm');
  if (!Object.keys(perms).length) return alert('「特定」角色至少要開放一個功能（選「查看」或「編輯」）');
  const result = await callApi('updateUser', { rowIndex: permModalRow, fields: { Role: 'limited', Perms: perms } });
  if (!result.success) return alert(result.message);
  document.getElementById('perm-modal').style.display = 'none';
  permModalRow = null;
  loadUsers();
}

async function migrateRoles() {
  if (!confirm('把所有舊角色（業務 sales、工程 fae）遷移成「編輯者」嗎？\n\n編輯者可以新增、修改，但不能刪除。原本業務可以刪除客戶、案件、產品等資料的權限會沒有，之後只有系統管理員能刪除。\n\n確定要遷移嗎？')) return;
  const r = await callApi('migrateRoles', {});
  if (!r.success) return alert(r.message);
  alert(`已遷移：業務 ${r.changed.sales} 個、工程 ${r.changed.fae} 個，現在都是編輯者。`);
  loadUsers();
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

// ---------- 群組與行事曆設定 ----------
let groupData = [];
let groupUsers = [];

async function loadGroups() {
  const r = await callApi('groupGetAll', {}, { silent: true });
  const box = document.getElementById('grp-list');
  if (!r.success) {
    box.innerHTML = `<span class="calc-hint">${htmlEsc(r.message || '')}</span>`;
    return;
  }
  groupData = r.groups || [];
  groupUsers = r.users || [];
  if (!groupData.length) {
    box.innerHTML = '<div class="calc-hint">還沒有群組。</div>';
    return;
  }
  box.innerHTML = groupData
    .map((g) => {
      const names = g.members.map((u) => (groupUsers.find((x) => x.username === u) || { name: u }).name);
      return `<div class="u-group-row"><b>${htmlEsc(g.name)}</b> <span class="calc-hint">${g.members.length} 人${names.length ? '：' + htmlEsc(names.slice(0, 8).join('、')) + (names.length > 8 ? '…' : '') : ''}</span>
        <button type="button" class="btn-secondary" onclick="editGroup(${g.id})">設定成員 / 改名</button>
        <button type="button" class="btn-secondary" onclick="deleteGroup(${g.id})">刪除</button></div>`;
    })
    .join('');
}

async function newGroup() {
  const name = document.getElementById('grp-name').value.trim();
  if (!name) return alert('請輸入群組名稱');
  const r = await callApi('groupSave', { name, members: [] });
  if (!r.success) return alert(r.message);
  document.getElementById('grp-name').value = '';
  await loadGroups();
  editGroup(r.id);
}

function editGroup(id) {
  const g = groupData.find((x) => x.id === id);
  if (!g) return;
  const modal = document.getElementById('grp-modal');
  document.getElementById('grp-edit-id').value = id;
  document.getElementById('grp-edit-name').value = g.name;
  document.getElementById('grp-edit-members').innerHTML = groupUsers
    .map((u) => `<label><input type="checkbox" value="${htmlEsc(u.username)}" ${g.members.includes(u.username) ? 'checked' : ''} /> ${htmlEsc(u.name)} <span class="calc-hint">${htmlEsc(u.username)}</span></label>`)
    .join('');
  modal.style.display = 'flex';
}

async function saveGroupEdit() {
  const id = Number(document.getElementById('grp-edit-id').value);
  const members = [...document.querySelectorAll('#grp-edit-members input:checked')].map((c) => c.value);
  const r = await callApi('groupSave', { id, name: document.getElementById('grp-edit-name').value.trim(), members });
  if (!r.success) return alert(r.message);
  document.getElementById('grp-modal').style.display = 'none';
  loadGroups();
}

async function deleteGroup(id) {
  const g = groupData.find((x) => x.id === id);
  if (!g || !confirm(`確定要刪除群組「${g.name}」嗎？\n分享給這個群組的行事曆 / 工作 / 備忘錄不會被刪除，但會沒有人看得到（改分享對象即可恢復）。`)) return;
  const r = await callApi('groupDelete', { id });
  if (!r.success) return alert(r.message);
  loadGroups();
}

async function loadWsSettings() {
  const r = await callApi('wsGetSettings', {}, { silent: true });
  if (r.success) document.getElementById('ws-gcal').checked = !!r.googleCalSync;
}

async function saveWsSettings() {
  const on = document.getElementById('ws-gcal').checked;
  const r = await callApi('wsSaveSettings', { googleCalSync: on });
  document.getElementById('ws-msg').textContent = r.success ? (on ? '已開啟：之後客戶追蹤也會同步到 Google 日曆。' : '已關閉。') : r.message;
}

window.addEventListener('DOMContentLoaded', async () => {
  if (!(await ensureAuth())) return;
  renderHeaderUser();
  applyAdminOnlyVisibility();
  loadGroups();
  loadWsSettings();
  await loadUsers();
  bindEnterSubmit('#user-add-panel', addUser);
});
