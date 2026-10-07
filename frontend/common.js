/**
 * ============================================================
 * common.js - 每一頁都會載入的共用邏輯
 * ------------------------------------------------------------
 * 內容：呼叫後端的 callApi()、載入遮罩、登入狀態檢查（含「記住這台裝置」
 * 免密碼自動登入）、登出、文件預覽彈窗、Enter鍵送出小工具。
 *
 * 頁面專屬的邏輯（產品/案件/報價/客戶）分別放在
 * products.js / cases.js / quote.js / customers.js，
 * 每個頁面只載入自己需要的那一支，不用把整個系統的程式碼都載進來。
 * ============================================================
 */

let currentToken = sessionStorage.getItem('token') || null;
let currentUsername = sessionStorage.getItem('username') || null;
let currentRole = sessionStorage.getItem('role') || null;
let loadingCount = 0;

// ------------------------------------------------------------
// Cookie 小工具（「記住這台裝置」用，存在瀏覽器本機，網站看不到密碼本身）
// ------------------------------------------------------------
function getCookie(name) {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}

/** days 給很大的數字（例如 3650 = 10 年）模擬「無期限」；瀏覽器本身對 cookie 有效期有上限(約 400 天)，
 * 到期後就需要重新輸入密碼，但正常使用期間（沒被瀏覽器清除資料）不會主動過期。 */
function setCookie(name, value, days) {
  const expires = new Date(Date.now() + days * 86400000).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
}

function deleteCookie(name) {
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
}

const DEVICE_ID_COOKIE = 'aoi_device_id';
const DEVICE_TOKEN_COOKIE = 'aoi_device_token';
const DEVICE_YEARS = 3650;

const AUTH_ERROR_PATTERN = /登入已逾期|尚未登入|已被登出/;
let refreshPromise = null;

/** 用瀏覽器記住的裝置權杖換一組新的工作階段；同時多個請求失敗時只換一次。 */
function refreshSession() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const deviceId = getCookie(DEVICE_ID_COOKIE);
    const deviceToken = getCookie(DEVICE_TOKEN_COOKIE);
    if (!deviceId || !deviceToken) return false;
    const r = await callApi('resumeSession', { deviceId, deviceToken });
    if (!r.success) return false;
    currentToken = r.token;
    currentRole = r.role || '';
    sessionStorage.setItem('token', currentToken);
    sessionStorage.setItem('role', currentRole);
    return true;
  })().finally(() => {
    setTimeout(() => (refreshPromise = null), 1000);
  });
  return refreshPromise;
}

function goToLogin() {
  clearDeviceCookies();
  sessionStorage.clear();
  clearAllCached();
  location.href = 'index.html';
}

/** 這台瀏覽器的裝置 ID，第一次使用時產生一組並記住，之後同一台裝置永遠是同一個 ID。 */
function getOrCreateDeviceId() {
  let id = getCookie(DEVICE_ID_COOKIE);
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    setCookie(DEVICE_ID_COOKIE, id, DEVICE_YEARS);
  }
  return id;
}

/** 給後端看的裝置說明文字（作業系統 + 瀏覽器），方便管理員在「裝置管理」分辨是哪一台。 */
function getDeviceLabel() {
  const ua = navigator.userAgent || '';
  const mobile = /iPhone|iPad|Android|Mobile/.test(ua);
  const os = /Windows/.test(ua) ? 'Windows' : /iPhone|iPad/.test(ua) ? (/iPad/.test(ua) ? 'iPad' : 'iPhone') : /Android/.test(ua) ? 'Android' : /Mac OS/.test(ua) ? 'Mac' : '其他系統';
  const browser = /Line\//i.test(ua) ? 'LINE' : /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) || /CriOS/.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '瀏覽器';
  const screenSize = typeof screen !== 'undefined' && screen.width ? `${screen.width}x${screen.height}` : '';
  return [mobile ? '手機' : '電腦', os, browser, screenSize].filter(Boolean).join(' · ');
}

function clearDeviceCookies() {
  deleteCookie(DEVICE_ID_COOKIE);
  deleteCookie(DEVICE_TOKEN_COOKIE);
}

// ------------------------------------------------------------
// 載入遮罩
// ------------------------------------------------------------
function showLoading() {
  loadingCount++;
  const el = document.getElementById('loading-overlay');
  if (el) el.style.display = 'flex';
}

function hideLoading() {
  loadingCount = Math.max(0, loadingCount - 1);
  if (loadingCount === 0) {
    const el = document.getElementById('loading-overlay');
    if (el) el.style.display = 'none';
  }
}

// ------------------------------------------------------------
// 呼叫 API（示範模式 = 走 demo.js 的本機假資料；正式模式 = 呼叫 Apps Script）
// ------------------------------------------------------------
async function callApi(action, params, opts) {
  // opts.silent：背景更新用（畫面已經先用暫存資料畫出來了），不顯示載入遮罩，使用者可以直接繼續操作
  const silent = !!(opts && opts.silent);
  if (!silent) showLoading();
  try {
    if (typeof DEMO_MODE !== 'undefined' && DEMO_MODE) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      return handleDemoApi(action, params || {});
    }
    const send = async () => {
      const payload = Object.assign({ action: action, token: currentToken }, params || {});
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
      });
      return await res.json();
    };
    let result = await send();
    // 登入逾期（快取的工作階段最多 6 小時）或被登出：先悄悄用「記住的裝置」換新的登入再重送一次，
    // 使用者完全無感；換不到（例如被管理員強制登出）才回登入頁。
    if (result && result.success === false && AUTH_ERROR_PATTERN.test(result.message || '') && action !== 'login' && action !== 'resumeSession') {
      if (await refreshSession()) result = await send();
      else goToLogin();
    }
    return result;
  } finally {
    if (!silent) hideLoading();
  }
}

// ------------------------------------------------------------
// 登入狀態
// ------------------------------------------------------------
/**
 * 每個需要登入才能看的頁面，一開始就呼叫這個（改成 async，記得用 await）：
 *   1. 這個分頁本來就有登入(sessionStorage)→ 直接放行
 *   2. 沒有的話，但瀏覽器記得這台裝置(cookie) → 悄悄用裝置權杖換一個新的登入，不用重打密碼
 *   3. 都沒有 → 導回 index.html
 * 回傳 true 才可以繼續往下執行頁面自己的初始化，回傳 false 時該次呼叫的頁面應該直接 return。
 */
async function ensureAuth() {
  if (currentToken) return true;

  const deviceId = getCookie(DEVICE_ID_COOKIE);
  const deviceToken = getCookie(DEVICE_TOKEN_COOKIE);
  if (deviceId && deviceToken) {
    const result = await callApi('resumeSession', { deviceId, deviceToken });
    if (result.success) {
      currentToken = result.token;
      currentUsername = result.displayName || result.username;
      currentRole = result.role || '';
      sessionStorage.setItem('token', currentToken);
      sessionStorage.setItem('username', currentUsername);
      sessionStorage.setItem('role', currentRole);
      return true;
    }
    // 裝置權杖失效(通常是管理員移除了這台裝置)，清掉本機記住的資訊，回登入頁重打密碼
    clearDeviceCookies();
  }

  location.href = 'index.html';
  return false;
}

function renderHeaderUser() {
  const el = document.getElementById('current-user');
  if (el) el.textContent = currentUsername + (typeof DEMO_MODE !== 'undefined' && DEMO_MODE ? '（示範模式，資料只存在這台瀏覽器）' : '');
  // 在「登出」前面放一個「個人資料」按鈕（每一頁共用）
  const logoutBtn = document.querySelector('header button[onclick^="logout"]');
  if (logoutBtn && !document.getElementById('header-profile-btn')) {
    const b = document.createElement('button');
    b.id = 'header-profile-btn';
    b.textContent = '個人資料';
    b.onclick = () => (location.href = 'profile.html');
    logoutBtn.parentNode.insertBefore(b, logoutBtn);
  }
}

/**
 * 把畫面上標了 class="admin-only" 的導覽列按鈕，非 admin 角色時隱藏起來（純 UI 層級的引導，
 * 真正的權限限制在後端 PERMISSIONS 已經擋好了，就算有人手動打開頁面或改網址也不會真的能操作）。
 */
function applyAdminOnlyVisibility() {
  if (currentRole === 'admin') return;
  document.querySelectorAll('.admin-only').forEach((el) => {
    el.style.display = 'none';
  });
}

/** 登出：連同「記住這台裝置」的紀錄一起清掉，下次要重新輸入密碼。 */
async function logout() {
  const deviceId = getCookie(DEVICE_ID_COOKIE);
  if (deviceId && currentToken) {
    try {
      await callApi('logoutDevice', { deviceId });
    } catch (e) {
      // 網路有問題就算了，本機的登入狀態還是照樣清掉
    }
  }
  clearDeviceCookies();
  sessionStorage.clear();
  await clearAllCached();
  location.href = 'index.html';
}

// ------------------------------------------------------------
// Enter 鍵送出：讓某容器裡所有 <input> 按 Enter 直接觸發指定函式
// ------------------------------------------------------------
function bindEnterSubmit(containerSelector, submitFn) {
  const container = document.querySelector(containerSelector);
  if (!container) return;
  container.querySelectorAll('input').forEach((input) => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitFn();
      }
    });
  });
}

// ------------------------------------------------------------
// 通用文件預覽彈窗（需求單/評估單/報價單都先進這裡，確認再下載）
// files: [{ base64, filename, mimeType, label }, ...]
// 支援 mimeType: application/pdf（內嵌預覽）、text/html（內嵌預覽）、
// text/plain（純文字顯示）、其他（docx等，顯示提示文字）
// ------------------------------------------------------------
let previewFiles = [];

function openPreviewModal(files) {
  previewFiles = files;
  const list = document.getElementById('preview-modal-list');
  if (!list) return;
  list.innerHTML = '';

  files.forEach((f, idx) => {
    const item = document.createElement('div');
    item.className = 'preview-item';
    item.innerHTML = `
      <div class="preview-item-header">
        <strong>${f.label || f.filename}</strong>
        <span>
          <button onclick="togglePreviewContent(${idx})">預覽</button>
          <button onclick="downloadBase64File(previewFiles[${idx}].base64, previewFiles[${idx}].filename, previewFiles[${idx}].mimeType)">確認下載</button>
        </span>
      </div>
      <div id="preview-content-${idx}" class="preview-content" style="display:none;"></div>
    `;
    list.appendChild(item);
  });

  document.getElementById('preview-modal').style.display = 'flex';
}

function togglePreviewContent(idx) {
  const container = document.getElementById('preview-content-' + idx);
  const f = previewFiles[idx];
  if (container.style.display === 'block') {
    container.style.display = 'none';
    return;
  }

  container.innerHTML = '';
  if (f.mimeType === 'application/pdf') {
    const iframe = document.createElement('iframe');
    iframe.src = `data:application/pdf;base64,${f.base64}`;
    iframe.style.cssText = 'width:100%; height:450px; border:1px solid #ccc;';
    container.appendChild(iframe);
  } else if (f.mimeType === 'text/html') {
    const iframe = document.createElement('iframe');
    iframe.srcdoc = decodeURIComponent(escape(atob(f.base64)));
    iframe.style.cssText = 'width:100%; height:450px; border:1px solid #ccc; background:white;';
    container.appendChild(iframe);
  } else if (f.mimeType === 'text/plain') {
    const pre = document.createElement('pre');
    pre.textContent = decodeURIComponent(escape(atob(f.base64)));
    container.appendChild(pre);
  } else {
    const p = document.createElement('p');
    p.textContent = '這是 Word 文件，瀏覽器無法直接預覽完整排版，請按「確認下載」後用 Word 開啟查看內容。';
    container.appendChild(p);
  }
  container.style.display = 'block';
}

function closePreviewModal() {
  document.getElementById('preview-modal').style.display = 'none';
  previewFiles = [];
}

function downloadBase64File(base64, filename, mimeType) {
  const byteChars = atob(base64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
  const byteArray = new Uint8Array(byteNumbers);
  const blob = new Blob([byteArray], { type: mimeType });

  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// ------------------------------------------------------------
// 輕量暫存（sessionStorage）：資料變動不頻繁的清單（客戶、人員、案件列表...）
// 換頁時先用暫存的資料立刻畫出畫面，同時背景重新打一次 API 拿最新資料再補上，
// 讓「換頁」的第一眼感覺是瞬間的，不用每次都乾等 Apps Script 的固定啟動延遲。
// 寫入資料的動作（新增/修改/刪除）之後要記得呼叫 clearCached() 把相關的暫存清掉，
// 不然可能會看到剛改之前的舊資料閃一下。
// ------------------------------------------------------------
function getCached(key) {
  try {
    const raw = sessionStorage.getItem('cache_' + key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

// 大量資料（全部產品、型錄…幾千筆）超過 sessionStorage 的容量，而且關掉分頁就沒了，
// 所以另外存一份在瀏覽器的 IndexedDB：離開頁面再回來、甚至重開瀏覽器，第一眼都是上次的資料，
// 背景再悄悄更新（不擋畫面）。要強迫重抓時按導覽列右邊的「↻ 重撈資料」。
const BIGCACHE_MAX_AGE_MS = 7 * 24 * 3600 * 1000;
const BigCache = (() => {
  let dbPromise = null;
  const open = () => {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open('aoi_cache', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('kv');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
    return dbPromise;
  };
  const run = async (mode, fn) => {
    const db = await open();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction('kv', mode);
        const req = fn(tx.objectStore('kv'));
        tx.oncomplete = () => resolve(req ? req.result : null);
        tx.onerror = tx.onabort = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
  };
  return {
    get: async (key) => {
      const rec = await run('readonly', (st) => st.get(key));
      return rec && rec.t && Date.now() - rec.t < BIGCACHE_MAX_AGE_MS ? rec.d : null;
    },
    set: (key, data) => run('readwrite', (st) => st.put({ t: Date.now(), d: data }, key)),
    del: (key) => run('readwrite', (st) => st.delete(key)),
    clear: () => run('readwrite', (st) => st.clear()),
  };
})();

function setCached(key, data) {
  try {
    sessionStorage.setItem('cache_' + key, JSON.stringify(data));
  } catch (e) {
    // sessionStorage 滿了或不可用就算了，下面的 IndexedDB 還是會存
  }
  BigCache.set(key, data);
}

/** 先看 sessionStorage，沒有再看 IndexedDB（離開頁面回來、重開瀏覽器都還在）。 */
async function getCachedAsync(key) {
  const quick = getCached(key);
  if (quick) return quick;
  return await BigCache.get(key);
}

function clearCached(key) {
  sessionStorage.removeItem('cache_' + key);
  BigCache.del(key);
}

/** 清掉所有暫存資料（登出、或按「重撈資料」時用）。 */
function clearAllCached() {
  Object.keys(sessionStorage)
    .filter((k) => k.indexOf('cache_') === 0)
    .forEach((k) => sessionStorage.removeItem(k));
  return BigCache.clear();
}

// 導覽列右邊的「↻ 重撈資料」：清掉暫存、重新向資料庫要最新資料。
// 各頁可以定義 window.refreshPageData（只重載該頁的資料，不會清掉你正在填的欄位）；沒定義的頁面就整頁重新載入。
document.addEventListener('DOMContentLoaded', () => {
  const nav = document.querySelector('nav.tabs');
  if (!nav || nav.querySelector('.nav-refresh')) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'tab-btn nav-refresh';
  btn.textContent = '↻ 重撈資料';
  btn.title = '清除這台電腦暫存的資料，重新從資料庫抓最新的（資料量大時會花一點時間）';
  btn.addEventListener('click', async () => {
    await clearAllCached();
    if (typeof window.refreshPageData === 'function') {
      try {
        await window.refreshPageData();
      } catch (e) {
        alert('重撈失敗：' + (e.message || e));
      }
    } else {
      location.reload();
    }
  });
  nav.appendChild(btn);
});
