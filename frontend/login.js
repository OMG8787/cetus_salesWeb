/**
 * login.js - 只有 index.html（登入頁）會載入這支檔案
 */
async function doLogin() {
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const msg = document.getElementById('login-message');
  msg.textContent = '登入中...';

  try {
    const result = await callApi('login', { username, password });
    if (result.success) {
      sessionStorage.setItem('token', result.token);
      sessionStorage.setItem('username', result.username);
      location.href = 'products.html';
    } else {
      msg.textContent = result.message || '登入失敗';
    }
  } catch (e) {
    msg.textContent = '連線失敗，請確認 config.js 的 API_URL 是否正確';
  }
}

window.addEventListener('DOMContentLoaded', () => {
  if (typeof DEMO_MODE !== 'undefined' && DEMO_MODE) {
    document.getElementById('login-message').textContent = '示範模式：帳號 0000 / 密碼 0000';
  }
  // 如果已經登入過，直接跳過登入頁
  if (sessionStorage.getItem('token')) {
    location.href = 'products.html';
  }
  bindEnterSubmit('#login-screen', doLogin);
});
