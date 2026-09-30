/**
 * login.js - 只有 index.html（登入頁）會載入這支檔案
 */
async function doLogin() {
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const msg = document.getElementById('login-message');
  msg.textContent = '登入中...';

  try {
    const deviceId = getOrCreateDeviceId();
    const result = await callApi('login', { username, password, deviceId, deviceLabel: getDeviceLabel() });
    if (result.success) {
      sessionStorage.setItem('token', result.token);
      sessionStorage.setItem('username', result.displayName || result.username);
      sessionStorage.setItem('role', result.role || '');
      // 記住這台裝置：下次打開網頁會自動用這組權杖換新的登入，不用再打密碼，除非管理員從「裝置管理」移除
      if (result.deviceToken) setCookie(DEVICE_TOKEN_COOKIE, result.deviceToken, DEVICE_YEARS);
      location.href = 'home.html';
    } else {
      msg.textContent = result.message || '登入失敗';
    }
  } catch (e) {
    msg.textContent = '連線失敗，請確認 config.js 的 API_URL 是否正確';
  }
}

/** 這台裝置有記住登入的話，不用使用者按任何按鈕，直接悄悄換一個新登入並跳轉。 */
async function tryAutoLogin() {
  const deviceId = getCookie(DEVICE_ID_COOKIE);
  const deviceToken = getCookie(DEVICE_TOKEN_COOKIE);
  if (!deviceId || !deviceToken) return false;

  document.getElementById('login-message').textContent = '這台裝置已記住登入，正在自動登入...';
  const result = await callApi('resumeSession', { deviceId, deviceToken });
  if (result.success) {
    sessionStorage.setItem('token', result.token);
    sessionStorage.setItem('username', result.displayName || result.username);
    sessionStorage.setItem('role', result.role || '');
    location.href = 'home.html';
    return true;
  }
  // 權杖失效（例如被管理員移除），清掉本機記住的資訊，留在登入頁讓使用者重新輸入密碼
  clearDeviceCookies();
  document.getElementById('login-message').textContent = '這台裝置的登入紀錄已被移除，請重新輸入帳密';
  return false;
}

window.addEventListener('DOMContentLoaded', async () => {
  if (typeof DEMO_MODE !== 'undefined' && DEMO_MODE) {
    document.getElementById('login-message').textContent = '示範模式：帳號 0000 / 密碼 0000';
  }
  // 如果這個分頁本來就有登入，直接跳過登入頁
  if (sessionStorage.getItem('token')) {
    location.href = 'home.html';
    return;
  }
  await tryAutoLogin();
  bindEnterSubmit('#login-screen', doLogin);
});
