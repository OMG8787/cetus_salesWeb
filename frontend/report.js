/**
 * report.js - 日報 頁面專屬邏輯
 */
async function loadDailyReportPreview() {
  const result = await callApi('getDailyReportData', {});
  const box = document.getElementById('daily-report-preview');
  if (!result.success) {
    box.textContent = result.message || '讀取失敗';
    return;
  }
  box.textContent = result.text;
}

async function sendDailyReport() {
  const manualNotes = document.getElementById('daily-report-notes').value;
  const result = await callApi('sendDailyReportNow', { manualNotes });
  alert(result.message || (result.success ? '已送出' : '失敗'));
}

window.addEventListener('DOMContentLoaded', () => {
  requireLogin();
  renderHeaderUser();
  loadDailyReportPreview();
});
