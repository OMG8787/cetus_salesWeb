/**
 * devices.js - 登入紀錄頁（僅 admin）：目前登入中、強制登出、紀錄保留、歷程查詢、各帳號使用時間
 */
function esc(str) {
  return String(str == null ? '' : str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtMinutes(m) {
  if (!m) return '0 分';
  const h = Math.floor(m / 60);
  return h ? `${h} 小時 ${m % 60} 分` : `${m} 分`;
}

function ymd(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function setRange(kind) {
  const now = new Date();
  const from = kind === 'month' ? new Date(now.getFullYear(), now.getMonth(), 1) : now;
  document.getElementById('lg-from').value = ymd(from);
  document.getElementById('lg-to').value = ymd(now);
  loadLogs();
}

// ------------------------------------------------------------
// 目前登入中
// ------------------------------------------------------------
async function loadOverview() {
  const result = await callApi('getLoginOverview', {});
  const msg = document.getElementById('lg-message');
  const table = document.getElementById('lg-devices-table');
  if (!result.success) {
    msg.textContent = result.message || '權限不足，只有管理員可以使用這個功能';
    table.style.display = 'none';
    return false;
  }
  msg.textContent = '';
  table.style.display = '';
  document.getElementById('lg-active-count').textContent = result.devices.length;
  document.getElementById('lg-keep').value = result.keep;
  document.getElementById('lg-keep-info').textContent = `目前共 ${result.logCount} 筆紀錄`;

  const counts = {};
  result.devices.forEach((d) => (counts[d.Username] = (counts[d.Username] || 0) + 1));
  const tbody = table.querySelector('tbody');
  tbody.innerHTML = '';
  result.devices.forEach((d) => {
    const tr = document.createElement('tr');
    const actions = d.IsCurrent
      ? ''
      : `<button class="btn-outline-danger" onclick="forceLogoutDevice(${d.RowIndex})">登出此裝置</button>
         <button class="btn-danger" onclick="forceLogoutUser('${esc(d.Username).replace(/'/g, '')}', ${counts[d.Username]})">登出此帳號（${counts[d.Username]} 台）</button>`;
    tr.innerHTML = `<td>${esc(d.DisplayName)}${d.IsCurrent ? ' <span class="memo-tag">目前裝置</span>' : ''}</td><td>${esc(d.Username)}</td><td>${esc(d.DeviceLabel)}</td><td>${esc(d.LoginTime)}</td><td>${esc(d.LastSeenTime)}</td><td>${actions}</td>`;
    tbody.appendChild(tr);
  });
  return true;
}

async function forceLogoutDevice(rowIndex) {
  if (!confirm('確定要登出這台裝置嗎？對方下次操作就會被要求重新登入。')) return;
  const r = await callApi('forceLogout', { scope: 'device', rowIndex });
  if (!r.success) return alert(r.message);
  refreshAll();
}

async function forceLogoutUser(username, n) {
  if (!confirm(`確定要登出帳號「${username}」的 ${n} 台裝置嗎？`)) return;
  const r = await callApi('forceLogout', { scope: 'user', username });
  if (!r.success) return alert(r.message);
  refreshAll();
}

async function forceLogoutAll() {
  if (!confirm('確定要登出所有人（不含你目前這台裝置）嗎？')) return;
  const r = await callApi('forceLogout', { scope: 'all' });
  if (!r.success) return alert(r.message);
  alert(`已登出 ${r.count} 台裝置`);
  refreshAll();
}

// ------------------------------------------------------------
// 紀錄保留 / 歷程
// ------------------------------------------------------------
async function saveKeep() {
  const keep = Number(document.getElementById('lg-keep').value);
  if (!keep || keep < 1) return alert('請輸入大於 0 的筆數');
  const r = await callApi('setLoginKeep', { keep });
  if (!r.success) return alert(r.message);
  refreshAll();
}

async function loadLogs() {
  const result = await callApi('getLoginLogs', {
    from: document.getElementById('lg-from').value,
    to: document.getElementById('lg-to').value,
    keyword: document.getElementById('lg-keyword').value.trim(),
    result: document.getElementById('lg-result').value,
  });
  if (!result.success) return;

  const sb = document.querySelector('#lg-summary-table tbody');
  sb.innerHTML = '';
  if (!result.summary.length) sb.innerHTML = '<tr><td colspan="7" class="calc-hint">查無紀錄</td></tr>';
  result.summary.forEach((s) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${esc(s.DisplayName)}</td><td>${esc(s.Username)}</td><td>${s.Logins}</td><td>${s.Fails}</td><td>${fmtMinutes(s.Minutes)}</td><td>${esc(s.LastLogin)}</td><td>${esc(s.LastDevice)}</td>`;
    sb.appendChild(tr);
  });

  document.getElementById('lg-log-count').textContent = `共 ${result.logs.length} 筆`;
  const lb = document.querySelector('#lg-logs-table tbody');
  lb.innerHTML = '';
  result.logs.forEach((l) => {
    const tr = document.createElement('tr');
    const state = l.Active ? '<span class="memo-tag">登入中</span>' : esc(l.EndReason);
    tr.innerHTML = `<td>${esc(l.LoginTime)}</td><td>${esc(l.DisplayName)}</td><td>${esc(l.Username)}</td><td>${l.Result === '成功' ? '成功' : '<span class="badge-warn">失敗</span>'}</td><td>${esc(l.DeviceLabel)}</td><td>${esc(l.LastActive)}</td><td>${esc(l.EndTime)}</td><td>${state}</td><td>${l.Result === '成功' ? fmtMinutes(l.Minutes) : ''}</td>`;
    lb.appendChild(tr);
  });
}

async function clearLogs() {
  if (!confirm('確定要清除歷程嗎？已結束的紀錄與失敗紀錄會被刪除（登入中的保留），無法復原。')) return;
  const r = await callApi('clearLoginLogs', {});
  if (!r.success) return alert(r.message);
  refreshAll();
}

async function refreshAll() {
  if (await loadOverview()) loadLogs();
}

window.addEventListener('DOMContentLoaded', async () => {
  if (!(await ensureAuth())) return;
  renderHeaderUser();
  applyAdminOnlyVisibility();
  setRange('today');
  refreshAll();
});
