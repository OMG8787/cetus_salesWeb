/**
 * profile.js - 個人資料頁：修改密碼、修改自己的姓名/電話/信箱/生日（每個登入的人都能用，只能改自己的）
 */
async function loadProfile() {
  const r = await callApi('getProfile', {});
  if (!r.success) {
    document.getElementById('pf-message').textContent = r.message || '讀取失敗';
    return;
  }
  const p = r.profile;
  if (r.mustChange) sessionStorage.setItem('mustChange', '1');
  document.getElementById('pf-username').value = p.Username;
  document.getElementById('pf-role').value = p.Role || '';
  document.getElementById('pf-name').value = p.DisplayName || '';
  document.getElementById('pf-phone').value = p.Phone || '';
  document.getElementById('pf-email').value = p.Email || '';
  document.getElementById('pf-birthday').value = p.Birthday || '';
}

async function saveProfile() {
  const msg = document.getElementById('pf-message');
  const name = document.getElementById('pf-name').value.trim();
  if (!name) {
    msg.textContent = '姓名不能空白';
    return;
  }
  const r = await callApi('updateProfile', {
    displayName: name,
    phone: document.getElementById('pf-phone').value,
    email: document.getElementById('pf-email').value,
    birthday: document.getElementById('pf-birthday').value,
  });
  if (!r.success) {
    msg.textContent = r.message || '儲存失敗';
    return;
  }
  currentUsername = r.displayName;
  sessionStorage.setItem('username', currentUsername);
  renderHeaderUser();
  msg.textContent = '已儲存';
}

async function changePassword() {
  const msg = document.getElementById('pw-message');
  const oldPw = document.getElementById('pw-old').value;
  const n1 = document.getElementById('pw-new').value;
  const n2 = document.getElementById('pw-new2').value;
  if (!oldPw || !n1) {
    msg.textContent = '請輸入目前的密碼與新密碼';
    return;
  }
  if (n1 !== n2) {
    msg.textContent = '兩次輸入的新密碼不一樣';
    return;
  }
  const r = await callApi('changePassword', { oldPassword: oldPw, newPassword: n1 });
  if (!r.success) {
    msg.textContent = r.message || '修改失敗';
    return;
  }
  ['pw-old', 'pw-new', 'pw-new2'].forEach((id) => (document.getElementById(id).value = ''));
  if (sessionStorage.getItem('mustChange') === '1') {
    sessionStorage.removeItem('mustChange');
    msg.textContent = '密碼已更新，正在帶你進入系統...';
    setTimeout(() => (location.href = 'home.html'), 800);
    return;
  }
  msg.textContent = '密碼已更新，下次登入請使用新密碼';
}

function showForceMode() {
  document.getElementById('force-banner').style.display = '';
  document.getElementById('pw-old').placeholder = '臨時密碼（剛剛登入用的那組）';
  document.querySelectorAll('nav .tab-btn, nav .nav-group-btn').forEach((b) => (b.disabled = true));
}

window.addEventListener('DOMContentLoaded', async () => {
  if (!(await ensureAuth())) return;
  renderHeaderUser();
  applyAdminOnlyVisibility();
  await loadProfile();
  if (sessionStorage.getItem('mustChange') === '1') showForceMode();
});
