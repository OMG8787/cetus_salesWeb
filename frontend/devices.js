/**
 * devices.js - 裝置管理 頁面專屬邏輯
 * 只有 Users 分頁 Role 是 admin 的帳號能看到完整清單，後端 handleGetDevices/handleRemoveDevice 也會擋非管理員。
 */

const myDeviceId = getCookie(DEVICE_ID_COOKIE);

async function loadDevices() {
  const msg = document.getElementById('devices-message');
  const table = document.getElementById('devices-table');
  msg.textContent = '';
  table.style.display = 'none';

  const result = await callApi('getDevices', {});
  if (!result.success) {
    msg.textContent = result.message || '讀取失敗';
    return;
  }
  if (!result.devices.length) {
    msg.textContent = '目前沒有任何裝置紀錄';
    return;
  }

  const tbody = table.querySelector('tbody');
  tbody.innerHTML = '';
  result.devices.forEach((d) => {
    const isThisDevice = d.DeviceId === myDeviceId;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${d.Username || ''}</td>
      <td>${d.DeviceLabel || '（未知裝置）'}${isThisDevice ? '　<strong>（這台裝置）</strong>' : ''}</td>
      <td>${d.CreatedDate || ''}</td>
      <td>${d.LastSeenDate || ''}</td>
      <td><button onclick="removeDevice(${d.RowIndex}, '${(d.Username || '').replace(/'/g, "\\'")}')">移除</button></td>`;
    tbody.appendChild(tr);
  });
  table.style.display = '';
}

async function removeDevice(rowIndex, username) {
  if (!confirm(`確定要移除「${username}」的這台裝置嗎？移除後那台裝置下次打開網頁需要重新輸入密碼。`)) return;
  const result = await callApi('removeDevice', { rowIndex });
  if (!result.success) return alert(result.message);
  loadDevices();
}

window.addEventListener('DOMContentLoaded', async () => {
  if (!(await ensureAuth())) return;
  renderHeaderUser();
  applyAdminOnlyVisibility();
  loadDevices();
});
