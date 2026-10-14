// ------------------------------------------------------------
// dbadmin.js - 帳號管理頁的「資料庫管理」區塊：容量檢視、釋放空白儲存格（僅 admin）
// ------------------------------------------------------------
const DB_LIMIT_FALLBACK = 10000000;

function dbFmt(n) {
  return Number(n || 0).toLocaleString('en-US');
}

function dbEsc(t) {
  return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

function renderDbStatus(r) {
  const pct = Number(r.percent) || 0;
  const fill = document.getElementById('db-bar-fill');
  fill.style.width = Math.min(100, pct) + '%';
  fill.style.background = pct > 80 ? '#e74c3c' : pct >= 50 ? '#f1c40f' : '#2ecc71';
  document.getElementById('db-summary').innerHTML =
    `已配置 <b>${dbFmt(r.totalCells)}</b> / ${dbFmt(r.limit || DB_LIMIT_FALLBACK)} 格（<b>${pct}%</b>），共 ${r.sheets.length} 個工作表；` +
    `可釋放 <b>${dbFmt(r.releasable)}</b> 格空白` +
    (pct > 80 ? ' <span style="color:#c0392b;">⚠ 快滿了，請盡快整理</span>' : pct >= 50 ? ' <span style="color:#b9770e;">已超過一半，建議規劃封存</span>' : '');
  const tb = document.querySelector('#db-table tbody');
  tb.innerHTML = '';
  r.sheets.slice(0, 12).forEach((s) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${dbEsc(s.name)}</td><td>${dbFmt(s.dataRows)}</td><td>${dbFmt(s.maxRows)} × ${s.maxCols}</td><td>${dbFmt(s.cells)}</td><td>${s.releasable ? dbFmt(s.releasable) : '—'}</td>`;
    tb.appendChild(tr);
  });
  document.getElementById('db-note').textContent = r.sheets.length > 12 ? `只列出前 12 大，其餘 ${r.sheets.length - 12} 個工作表未顯示。` : '';
  document.getElementById('db-trim-btn').textContent = `釋放空白儲存格（約 ${dbFmt(r.releasable)} 個）`;
  document.getElementById('db-trim-btn').disabled = !r.releasable;
}

async function loadDbStatus() {
  const r = await callApi('dbStatus', {}, { silent: true });
  if (!r || !r.success) {
    document.getElementById('db-summary').textContent = (r && r.message) || '讀取失敗（需要 admin 權限，且後端要部署最新版）';
    return;
  }
  renderDbStatus(r);
}

async function trimDb() {
  if (!confirm('要釋放空白儲存格嗎？\n\n只會刪除「每個工作表最後一筆資料後面」多出來的空白列（保留 20 列緩衝、至少 21 列），不會動任何資料或欄位；之後新增資料時系統會自動補列。')) return;
  const r = await callApi('dbTrim', {});
  if (!r || !r.success) return alert((r && r.message) || '釋放失敗');
  renderDbStatus(r);
  alert(`已釋放約 ${dbFmt(r.released)} 個儲存格（處理 ${r.trimmedSheets} 個工作表）。`);
}

document.getElementById('db-admin').addEventListener('toggle', function () {
  if (this.open) loadDbStatus();
});
