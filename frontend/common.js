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
    let result;
    try {
      result = await send();
    } catch (e) {
      // 網路斷線、Apps Script 回傳錯誤頁（不是 JSON）時，回傳失敗物件讓畫面顯示原因，而不是整個流程默默中斷
      return { success: false, networkError: true, message: '連線失敗，請檢查網路後再試一次（' + (e && e.message ? e.message : e) + '）' };
    }
    // 登入逾期（快取的工作階段最多 6 小時）或被登出：先悄悄用「記住的裝置」換新的登入再重送一次，
    // 使用者完全無感；換不到（例如被管理員強制登出）才回登入頁。
    if (result && result.success === false && AUTH_ERROR_PATTERN.test(result.message || '') && action !== 'login' && action !== 'resumeSession') {
      if (await refreshSession()) {
        try {
          result = await send();
        } catch (e) {
          return { success: false, networkError: true, message: '連線失敗，請檢查網路後再試一次（' + (e && e.message ? e.message : e) + '）' };
        }
      } else goToLogin();
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
const BIGCACHE_MAX_AGE_MS = 4 * 3600 * 1000; // 暫存最多留 4 小時，過期的每次開頁面時都會真的刪掉
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
    /** 把過期的暫存真的刪掉（不只是不讀取），避免越存越多。 */
    purgeExpired: () =>
      run('readwrite', (st) => {
        const cur = st.openCursor();
        cur.onsuccess = () => {
          const c = cur.result;
          if (!c) return;
          if (!c.value || !c.value.t || Date.now() - c.value.t >= BIGCACHE_MAX_AGE_MS) c.delete();
          c.continue();
        };
        return cur;
      }),
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

// 預約時間快速分鐘：時間欄位旁加 :00 / :15 / :30 / :45 按鈕（沒選小時時預設 09 點），要精確到幾分就直接點進時間欄位改。
function enhanceTimeInputs(root) {
  (root || document).querySelectorAll('input[type="time"]:not([data-quick])').forEach((inp) => {
    inp.dataset.quick = '1';
    const box = document.createElement('span');
    box.className = 'time-quick';
    ['00', '15', '30', '45'].forEach((mm) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn-mini';
      b.textContent = ':' + mm;
      b.onclick = () => {
        if (inp.disabled) return;
        const hh = /^\d{2}:/.test(inp.value) ? inp.value.slice(0, 2) : '09';
        inp.value = hh + ':' + mm;
      };
      box.appendChild(b);
    });
    const anchor = inp.closest('label') || inp;
    anchor.after(box);
  });
}
document.addEventListener('DOMContentLoaded', () => enhanceTimeInputs());

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

  const clr = document.createElement('button');
  clr.type = 'button';
  clr.className = 'tab-btn nav-clear-cache';
  clr.textContent = '🗑 清空暫存';
  clr.title = '把這台電腦上暫存的資料全部刪掉（不重新載入、不影響資料庫）';
  clr.addEventListener('click', async () => {
    await clearAllCached();
    alert('已清空這台電腦暫存的資料。下次進入頁面會重新向資料庫抓。');
  });
  nav.appendChild(clr);
  BigCache.purgeExpired();
});

// ------------------------------------------------------------
// 追蹤進度（案件頁、客戶頁共用）
// ------------------------------------------------------------
function localTodayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function normalizeDateStr(v) {
  const s = String(v || '').trim();
  const m = s.match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : s;
}

/** 追蹤日的狀態：逾期（紅）、今天（橘）、3 天內（黃）、之後（一般）、沒設定。 */
function followUpInfo(dateStr, timeStr) {
  const d = normalizeDateStr(dateStr);
  if (!d) return { text: '未設定', color: '#999', note: '' };
  const today = localTodayStr();
  const days = Math.round((new Date(d + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000);
  if (isNaN(days)) return { text: d + (timeStr ? ' ' + timeStr : ''), color: '#333', note: '' };
  if (days < 0) return { text: d + (timeStr ? ' ' + timeStr : ''), color: '#c0392b', note: `已逾期 ${-days} 天` };
  if (days === 0) return { text: d + (timeStr ? ' ' + timeStr : ''), color: '#d35400', note: '今天要追蹤' };
  if (days <= 3) return { text: d + (timeStr ? ' ' + timeStr : ''), color: '#b7950b', note: `${days} 天後` };
  return { text: d + (timeStr ? ' ' + timeStr : ''), color: '#333', note: `${days} 天後` };
}

/** 這次要洽談的內容：先用上次寫的「下次追蹤說明」；還沒寫過就退回客戶備註最後面的一段（舊資料都記在備註）。 */
function discussText(cust) {
  const note = String((cust && cust.NextFollowUpNote) || '').trim();
  if (note) return { text: note, fromNotes: false };
  const notes = String((cust && cust.Notes) || '').trim();
  if (!notes) return { text: '', fromNotes: false };
  const tail = notes.length > 200 ? '…' + notes.slice(-200) : notes;
  return { text: tail, fromNotes: true };
}

/** 日期 + 預約時間的顯示字串，例如「2026-10-13 09:30」；沒有預約時間就只有日期。 */
function followWhenText(dateStr, timeStr) {
  const d = normalizeDateStr(dateStr);
  const t = String(timeStr || '').trim();
  return d ? (t ? d + ' ' + t : d) : '';
}

/** 同一天內排序用的分鐘數：有預約時間照時間排，沒有的排在後面。 */
function timeMinutes(timeStr) {
  const m = String(timeStr || '').match(/^(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 24 * 60;
}

/** 下次追蹤說明的小標籤（沒有說明回傳空字串；滑過可看全文）。 */
function followNoteHtml(note) {
  const t = String(note == null ? '' : note).trim();
  if (!t) return '';
  const esc = t.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<div class="fu-note" title="${esc}">📝 ${esc}</div>`;
}

// ------------------------------------------------------------
// 聯繫紀錄暫存：追蹤視窗的「歷史紀錄」用。頁面一打開就先在背景載入，按「展開」時馬上有資料，不擋畫面。
// ------------------------------------------------------------
/** Method 是這兩種的，是系統自動記下的修改紀錄（改了客戶資料 / 下次追蹤），不是實際聯繫，工作日報與「上次聯繫」都會略過。 */
const CHANGE_LOG_METHODS = ['資料修改', '改期'];

function isChangeLog(l) {
  return !!l && CHANGE_LOG_METHODS.indexOf(l.Method) > -1;
}

function htmlEsc(v) {
  return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 紀錄排序：日期新的在前，同一天看記錄時間，再看寫入順序（列號）。 */
function compareLogsDesc(a, b) {
  return (
    String(b.Date || '').localeCompare(String(a.Date || '')) ||
    String(b.CreatedAt || '').localeCompare(String(a.CreatedAt || '')) ||
    (Number(b.RowIndex) || 0) - (Number(a.RowIndex) || 0)
  );
}

const ContactLogStore = {
  all: null, // 全部紀錄（頁面有整批載入過才有）
  byCompany: {}, // 公司名稱 → 紀錄（新的在前）
  pending: {},
  allPromise: null,
  listeners: [],
  setAll(logs) {
    this.all = (logs || []).slice().sort(compareLogsDesc);
    this.byCompany = {};
    this.all.forEach((l) => (this.byCompany[l.CompanyName] = this.byCompany[l.CompanyName] || []).push(l));
    this.notify(null);
  },
  /** 某間公司的紀錄（新的在前）；還沒載入過回傳 null。 */
  get(company) {
    if (this.byCompany[company]) return this.byCompany[company];
    return this.all ? [] : null;
  },
  /** 背景整批載入全部紀錄（不顯示遮罩）；同時多處呼叫只打一次 API。 */
  loadAll(force) {
    if (this.allPromise && !force) return this.allPromise;
    const p = callApi('getContactLogs', {}, { silent: true }).then((r) => {
      if (r && r.success) this.setAll(r.logs);
      else if (this.allPromise === p) this.allPromise = null; // 失敗的話下次可以重試
      return this.all || [];
    });
    this.allPromise = p;
    return p;
  },
  /** 背景重新載入某間公司的紀錄。 */
  loadCompany(company) {
    if (!company) return Promise.resolve([]);
    if (this.pending[company]) return this.pending[company];
    const p = callApi('getContactLogs', { companyName: company }, { silent: true }).then((r) => {
      delete this.pending[company];
      if (r && r.success) {
        this.byCompany[company] = (r.logs || []).slice().sort(compareLogsDesc);
        if (this.all) this.all = this.all.filter((l) => l.CompanyName !== company).concat(this.byCompany[company]).sort(compareLogsDesc);
        this.notify(company);
      }
      return this.get(company) || [];
    });
    this.pending[company] = p;
    return p;
  },
  /** 剛存好的紀錄直接放進暫存，不用等重新載入。 */
  add(log) {
    if (!log || !log.CompanyName) return;
    const list = (this.byCompany[log.CompanyName] = this.byCompany[log.CompanyName] || []);
    if (!list.some((l) => l.RowIndex === log.RowIndex && l.CreatedAt === log.CreatedAt)) list.unshift(log);
    list.sort(compareLogsDesc);
    if (this.all && this.all.indexOf(log) < 0) {
      this.all.unshift(log);
      this.all.sort(compareLogsDesc);
    }
    this.notify(log.CompanyName);
  },
  /** 公司改名：暫存裡的紀錄一起換成新名稱。 */
  rename(oldName, newName) {
    if (!oldName || !newName || oldName === newName) return;
    const moved = this.byCompany[oldName] || [];
    moved.forEach((l) => (l.CompanyName = newName));
    if (this.all) this.all.forEach((l) => l.CompanyName === oldName && (l.CompanyName = newName));
    delete this.byCompany[oldName];
    this.byCompany[newName] = (this.byCompany[newName] || []).concat(moved).sort(compareLogsDesc);
    this.notify(newName);
  },
  /** 訂閱資料更新，回傳取消訂閱的函式。 */
  onChange(fn) {
    this.listeners.push(fn);
    return () => (this.listeners = this.listeners.filter((x) => x !== fn));
  },
  notify(company) {
    this.listeners.slice().forEach((fn) => {
      try {
        fn(company);
      } catch (e) {
        // 單一畫面更新失敗不影響其他
      }
    });
  },
};

/** 最近一筆「真正的聯繫」（略過系統記的修改紀錄）。caseId 有給時優先找同案件的。 */
function lastRealContact(logs, caseId) {
  const real = (logs || []).filter((l) => !isChangeLog(l));
  return (caseId && real.find((l) => l.CaseID === caseId)) || real[0] || null;
}

/** 把存檔後的客戶資料套回頁面上的客戶清單（用列號或舊名稱找到同一筆），找不到就加進去。 */
function patchCustomerList(list, customer, oldName) {
  if (!Array.isArray(list) || !customer) return;
  let i = list.findIndex((c) => c.CompanyName === (oldName || customer.CompanyName));
  if (i < 0) i = list.findIndex((c) => c.RowIndex === customer.RowIndex && c.CompanyName === customer.CompanyName);
  if (i < 0) list.push(customer);
  else list[i] = Object.assign({}, list[i], customer);
}

// ------------------------------------------------------------
// 追蹤視窗（業務行事曆、案件管理、客戶管理共用）
// ------------------------------------------------------------
const CUSTOMER_CATEGORY_OPTIONS = ['AOI同業資料', '器材原廠', '機構合作設備商', '一般客戶'];
// 視窗裡「修改客戶資料」可以改的欄位：[欄位, 輸入框 id]
const FU_EDIT_FIELDS = [
  ['CompanyName', 'fe-company'],
  ['Category', 'fe-category'],
  ['Urgency', 'fe-urgency'],
  ['Contact', 'fe-contact'],
  ['Phone', 'fe-phone'],
  ['Email', 'fe-email'],
  ['CompanyPhone', 'fe-company-phone'],
  ['TaxId', 'fe-taxid'],
  ['Address', 'fe-address'],
  ['Notes', 'fe-notes'],
];

function fuAddDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fuPhoneLink(p) {
  const t = String(p || '').trim();
  return t ? `<a href="tel:${htmlEsc(t.replace(/[^\d+#,]/g, ''))}">${htmlEsc(t)}</a>` : '—';
}

/** 視窗上方的「本案資料」：客戶與案件的聯絡人、電話、Email、案件重點，打電話前一眼看到。 */
function followInfoHtml(st) {
  const cust = st.customer || {};
  const cs = st.caseData || {};
  const row = (label, html) => `<tr><th style="white-space:nowrap;width:1%;text-align:left;font-weight:normal;color:#667;">${label}</th><td>${html}</td></tr>`;
  const rows = [];
  const planned = String(cust.NextFollowUpNote || '').trim();
  if (planned) {
    rows.push(row('本次需要洽談', `<div style="background:#fffbe6;border-left:3px solid #f1c40f;padding:4px 8px;white-space:pre-wrap;font-weight:600;">${htmlEsc(planned)}</div>`));
  } else {
    const dis = discussText(cust);
    if (dis.text) rows.push(row('客戶備註', `<div style="white-space:pre-wrap;color:#555;max-height:110px;overflow:auto;">${htmlEsc(dis.text)}</div><div class="calc-hint">（還沒寫「本次需要洽談」，這是客戶備註最後的內容，僅供參考）</div>`));
  }
  if (cs.CaseID) {
    rows.push(row('案件', `<b>${htmlEsc(cs.CaseID)}</b>${cs.Status ? '　<span class="calc-hint">' + htmlEsc(cs.Status) + '</span>' : ''}${cs.Urgency ? '　緊急：' + htmlEsc(cs.Urgency) : ''}`));
    const what = [cs.ProductApplication && '應用：' + cs.ProductApplication, cs.TestObject && '待測物：' + cs.TestObject, cs.SoftwareName && '軟體：' + cs.SoftwareName].filter(Boolean);
    if (what.length) rows.push(row('內容', htmlEsc(what.join('　'))));
    if (cs.ProjectContact || cs.ContactPhone) rows.push(row('案件聯絡人', `${htmlEsc(cs.ProjectContact) || '—'}　${fuPhoneLink(cs.ContactPhone)}`));
    if (cs.EndCustomerName) rows.push(row('終端客戶', htmlEsc(cs.EndCustomerName)));
    if (cs.Salesperson || cs.FAE) rows.push(row('業務 / FAE', htmlEsc([cs.Salesperson, cs.FAE].filter(Boolean).join(' / '))));
  }
  rows.push(
    row(
      '客戶',
      `<b>${htmlEsc(st.companyName)}</b>${cust.Category ? '　<span class="calc-hint">' + htmlEsc(cust.Category) + '</span>' : ''}${cust.TaxId ? '　<span class="calc-hint">統編 ' + htmlEsc(cust.TaxId) + '</span>' : ''}
      <button type="button" class="btn-mini fu-edit-btn" id="fu-edit-open" title="換聯絡人、改電話、公司名稱打錯…直接在這裡改">✏️ 修改客戶資料</button>`
    )
  );
  rows.push(row('聯絡人', `${htmlEsc(cust.Contact) || '—'}　${fuPhoneLink(cust.Phone)}`));
  if (cust.CompanyPhone) rows.push(row('公司電話', fuPhoneLink(cust.CompanyPhone)));
  if (cust.Email) rows.push(row('Email', `<a href="mailto:${htmlEsc(cust.Email)}">${htmlEsc(cust.Email)}</a>`));
  if (cust.Address) rows.push(row('地址', htmlEsc(cust.Address)));
  return `<table class="fu-info"><tbody>${rows.join('')}</tbody></table>`;
}

/** 修改客戶資料的表單（預設收起來）。 */
function followEditHtml(st) {
  const c = st.customer || {};
  const cats = CUSTOMER_CATEGORY_OPTIONS.indexOf(c.Category) < 0 && c.Category ? [c.Category].concat(CUSTOMER_CATEGORY_OPTIONS) : CUSTOMER_CATEGORY_OPTIONS;
  const opt = (list, cur) => list.map((v) => `<option value="${htmlEsc(v)}"${v === cur ? ' selected' : ''}>${htmlEsc(v)}</option>`).join('');
  const val = (v) => htmlEsc(v == null ? '' : v);
  return `<div class="fu-edit-title"><b>修改客戶資料</b><span class="calc-hint">換聯絡人、改電話、公司名稱打錯都可以直接在這裡改，修改內容會留在歷史紀錄。</span></div>
    <div class="fu-edit-grid">
      <label class="wide">公司名稱<input id="fe-company" value="${val(c.CompanyName)}" /></label>
      <label>分類<select id="fe-category">${opt(cats, c.Category || '一般客戶')}</select></label>
      <label>急迫性<select id="fe-urgency">${opt(['高', '中', '低'], c.Urgency || '中')}</select></label>
      <label>主要聯絡人<input id="fe-contact" list="fe-contact-list" value="${val(c.Contact)}" /></label>
      <label>聯繫人電話<input id="fe-phone" value="${val(c.Phone)}" /></label>
      <label>Email<input id="fe-email" value="${val(c.Email)}" /></label>
      <label>公司電話<input id="fe-company-phone" value="${val(c.CompanyPhone)}" /></label>
      <label>統一編號<input id="fe-taxid" maxlength="8" value="${val(c.TaxId)}" /></label>
      <label>地址<input id="fe-address" value="${val(c.Address)}" /></label>
      <label class="wide">客戶備註<textarea id="fe-notes" rows="3">${val(c.Notes)}</textarea></label>
    </div>
    <datalist id="fe-contact-list"></datalist>
    <div id="fe-other-contacts" class="fu-other-contacts"></div>
    <label id="fe-keep-wrap" class="fu-keep" style="display:none;"><input type="checkbox" id="fe-keep-old" checked /> 把原本的主要聯絡人「<span id="fe-old-contact"></span>」保留到「其他聯絡窗口」</label>
    <div id="fe-rename-hint" class="calc-hint" style="display:none;color:#b9770e;">改公司名稱會一併更新這間公司的案件、聯絡窗口、聯繫紀錄（案件編號 / 專案名稱不會自動改）。</div>
    <div class="fu-edit-actions"><button type="button" id="fe-save">儲存客戶資料</button> <button type="button" class="btn-secondary" id="fe-cancel">取消</button> <span id="fe-msg" class="calc-hint"></span></div>`;
}

/** 一筆歷史紀錄。 */
function followHistItemHtml(l) {
  const change = isChangeLog(l);
  const time = String(l.CreatedAt || '').slice(0, 10) === String(l.Date || '') ? String(l.CreatedAt).slice(11, 16) : '';
  const autoSummary = change && (l.Summary === '修改客戶資料' || l.Summary === '修改下次追蹤');
  const meta = [
    `<b>${htmlEsc(l.Date)}</b>${time ? ' ' + htmlEsc(time) : ''}`,
    `<span class="fu-hist-tag">${change ? '✏️ ' : ''}${htmlEsc(l.Method || '—')}</span>`,
    l.Contact ? '聯絡人：' + htmlEsc(l.Contact) : '',
    l.Salesperson ? htmlEsc(l.Salesperson) : '',
    l.CaseID ? `<span class="fu-hist-case" title="${htmlEsc(l.CaseID)}">${htmlEsc(l.CaseID)}</span>` : '',
  ].filter(Boolean);
  return `<div class="fu-hist-item${change ? ' is-change' : ''}">
    <div class="fu-hist-meta">${meta.join('<span class="fu-hist-dot">·</span>')}</div>
    ${l.Summary && !autoSummary ? `<div class="fu-hist-sum">${htmlEsc(l.Summary)}</div>` : ''}
    ${l.Changes ? `<div class="fu-hist-changes">${htmlEsc(l.Changes)}</div>` : ''}
  </div>`;
}

/**
 * 「追蹤完畢 / 改日」小視窗：
 *   - 上方「本案資料」可直接「✏️ 修改客戶資料」（換聯絡人、改電話、公司名稱打錯…），存檔後會留下修改紀錄；
 *   - 「上次聯繫」可展開看這間公司全部的歷史紀錄（聯繫了什麼、改了哪些資料），開視窗時就先在背景載入；
 *   - 追蹤完畢：記下這次聯繫的結果（寫進客戶聯繫紀錄）+ 設定下次追蹤日與洽談內容（或不再追蹤），一次完成。
 * opts: { companyName, rowIndex, customer, contact, caseData, caseId, currentDate, currentNote, editOnly, onSaved(result, oldName), onDone(result) }
 * editOnly = true：只改下次追蹤（不記聯繫紀錄）。
 */
function openFollowUpDialog(opts) {
  const old = document.getElementById('followup-dialog');
  if (old && typeof old._cleanup === 'function') old._cleanup();
  else if (old) old.remove();

  const st = {
    companyName: opts.companyName,
    rowIndex: opts.rowIndex,
    customer: Object.assign(
      { CompanyName: opts.companyName, RowIndex: opts.rowIndex, Contact: opts.contact || '', NextFollowUpDate: opts.currentDate || '', NextFollowUpNote: opts.currentNote || '' },
      opts.customer || {}
    ),
    caseData: opts.caseData || null,
    caseId: opts.caseId || '',
    contacts: null, // 其他聯絡窗口（背景載入）
    histOpen: false,
    histFilter: 'all',
    editOpen: false,
    editInitial: {}, // 打開「修改客戶資料」當下各欄位的值，用來判斷哪些欄位真的有改
  };
  const currentNote = st.customer.NextFollowUpNote || '';
  const currentDate = st.customer.NextFollowUpDate || '';
  const defaultContact = (st.caseData && st.caseData.ProjectContact) || st.customer.Contact || opts.contact || '';

  const wrap = document.createElement('div');
  wrap.id = 'followup-dialog';
  wrap.className = 'modal-overlay';
  wrap.innerHTML = `
    <div class="modal-box fu-box">
      <div class="modal-header"><h3 style="margin:0;">${opts.editOnly ? '修改下次追蹤' : '追蹤完畢'}：<span id="fu-title"></span></h3><button type="button" id="fu-close">關閉</button></div>
      <div id="fu-info"></div>
      <div id="fu-edit" class="fu-edit" style="display:none;"></div>
      <div id="fu-hist" class="fu-hist"></div>
      <div class="calc-hint" style="margin-bottom:8px;">${opts.editOnly ? '只修改下次追蹤日與洽談內容，不會新增聯繫紀錄（修改內容會記在歷史紀錄）。' : '這次追蹤的結果會記進「客戶聯繫紀錄」，並更新客戶的下次追蹤日與洽談內容（也會同步到行事曆）。'}</div>
      ${
        opts.editOnly
          ? ''
          : `<div class="fu-row">
        <label>聯繫方式：<select id="fu-method"><option>電話</option><option>Email</option><option>LINE</option><option>拜訪</option><option>其他</option></select></label>
        <label>聯絡人：<input id="fu-contact" list="fu-contact-list" value="${htmlEsc(defaultContact)}" /></label>
        <datalist id="fu-contact-list"></datalist>
      </div>
      <label class="fu-block">追蹤結果 / 聯繫內容（這次做了什麼、談到哪）：</label>
      <textarea id="fu-summary" rows="4" placeholder="例如：已電話聯繫，客戶說下週會議後再回覆；需補寄報價單"></textarea>`
      }
      <div class="fu-row">
        <label>下次追蹤日：<input id="fu-date" type="date" value="${htmlEsc(normalizeDateStr(currentDate)) || fuAddDays(7)}" /></label>
        <span id="fu-quick" class="fu-quick"></span>
      </div>
      <div class="fu-row">
        <label>預約時間：<input id="fu-time" type="time" value="${htmlEsc(st.customer.NextFollowUpTime || '')}" title="跟客戶約的時間點；沒約時間就留空（日曆會是整天行程）" /></label>
        <button type="button" class="btn-mini" id="fu-time-clear">清除時間</button>
      </div>
      <label class="fu-block">${opts.editOnly ? '下次洽談內容（下次追蹤時要談什麼）：' : '下次洽談內容（下次追蹤時要談什麼、準備什麼；上面「本次需要洽談」是這次的）：'}
        ${!opts.editOnly && currentNote ? '<button type="button" class="btn-mini" id="fu-reuse">沿用本次內容</button>' : ''}</label>
      <textarea id="fu-note" rows="3" placeholder="例如：等客戶主管確認預算後，回覆報價；先備好 500 萬相機 + 2 倍鏡頭的報價單">${opts.editOnly ? htmlEsc(currentNote) : ''}</textarea>
      <label class="fu-block"><input type="checkbox" id="fu-stop" /> 不再追蹤（清除下次追蹤日，例如已結案、客戶表示不需要）</label>
      <div style="margin-top:12px;"><button type="button" id="fu-save">儲存</button></div>
    </div>`;
  document.body.appendChild(wrap);
  const $ = (id) => document.getElementById(id);
  let unsubscribe = null;
  const close = () => {
    if (unsubscribe) unsubscribe();
    wrap.remove();
  };
  wrap._cleanup = close;
  enhanceTimeInputs(wrap);

  // ---- 本案資料 + 修改客戶資料 ----
  const renderInfo = () => {
    $('fu-title').textContent = st.companyName;
    $('fu-info').innerHTML = followInfoHtml(st);
    $('fu-edit-open').onclick = () => (st.editOpen ? closeEdit() : openEdit());
  };
  const renderContactChoices = () => {
    const others = (st.contacts || []).filter((c) => c.ContactName);
    const names = [...new Set([st.customer.Contact].concat(others.map((c) => c.ContactName)).filter(Boolean))];
    ['fu-contact-list', 'fe-contact-list'].forEach((id) => {
      const dl = $(id);
      if (dl) dl.innerHTML = names.map((n) => `<option value="${htmlEsc(n)}"></option>`).join('');
    });
    const box = $('fe-other-contacts');
    if (!box) return;
    if (st.contacts == null) {
      box.innerHTML = '<span class="calc-hint">其他聯絡窗口載入中…</span>';
      return;
    }
    box.innerHTML = others.length
      ? '<span class="calc-hint">換成其他聯絡窗口（點一下帶入）：</span>' +
        others.map((c, i) => `<button type="button" class="fu-chip" data-i="${i}" title="${htmlEsc([c.Title, c.Phone, c.Email].filter(Boolean).join(' / '))}">${htmlEsc(c.ContactName)}${c.Phone ? ' ' + htmlEsc(c.Phone) : ''}</button>`).join('')
      : '<span class="calc-hint">這間公司還沒有其他聯絡窗口（換聯絡人時可勾選把原聯絡人留下來）。</span>';
    box.querySelectorAll('.fu-chip').forEach((b) => {
      b.onclick = () => {
        const c = others[Number(b.dataset.i)];
        $('fe-contact').value = c.ContactName || '';
        $('fe-phone').value = c.Phone || '';
        $('fe-email').value = c.Email || '';
        updateEditHints();
      };
    });
  };
  const editValue = (id) => {
    const el = $(id);
    if (!el) return '';
    return id === 'fe-notes' ? el.value.replace(/\s+$/, '') : el.value.trim();
  };
  /** 修改客戶資料表單中「使用者有改過」的欄位（跟打開表單當下比，沒動過的欄位不送，避免蓋掉別人剛改的資料）。 */
  const editChanged = () => {
    const out = {};
    if (!st.editOpen) return out;
    FU_EDIT_FIELDS.forEach(([field, id]) => {
      const v = editValue(id);
      if (v !== st.editInitial[id]) out[field] = v;
    });
    return out;
  };
  const updateEditHints = () => {
    if (!st.editOpen) return;
    const oldContact = String(st.customer.Contact || '').trim();
    const contactChanged = editValue('fe-contact') !== st.editInitial['fe-contact'] && editValue('fe-contact') !== oldContact;
    $('fe-keep-wrap').style.display = contactChanged && oldContact ? '' : 'none';
    $('fe-old-contact').textContent = oldContact;
    $('fe-rename-hint').style.display = editValue('fe-company') !== st.editInitial['fe-company'] ? '' : 'none';
  };
  const openEdit = () => {
    st.editOpen = true;
    const box = $('fu-edit');
    box.innerHTML = followEditHtml(st);
    box.style.display = '';
    st.editInitial = {};
    FU_EDIT_FIELDS.forEach(([, id]) => (st.editInitial[id] = editValue(id)));
    renderContactChoices();
    box.querySelectorAll('input,select,textarea').forEach((el) => el.addEventListener('input', updateEditHints));
    $('fe-save').onclick = saveEdit;
    $('fe-cancel').onclick = () => {
      if (Object.keys(editChanged()).length && !confirm('修改的客戶資料還沒儲存，確定要取消嗎？')) return;
      closeEdit();
    };
    updateEditHints();
    $('fe-contact').focus();
  };
  const closeEdit = () => {
    st.editOpen = false;
    $('fu-edit').style.display = 'none';
    $('fu-edit').innerHTML = '';
  };
  const keepOldChecked = () => !!($('fe-keep-old') && $('fe-keep-wrap').style.display !== 'none' && $('fe-keep-old').checked);
  const checkEditFields = (fields) => {
    if (fields.CompanyName !== undefined) {
      if (!fields.CompanyName) {
        alert('公司名稱不能空白');
        return false;
      }
      if (!confirm(`要把公司名稱「${st.companyName}」改成「${fields.CompanyName}」嗎？\n\n這間公司的案件、聯絡窗口、聯繫紀錄會一起改成新名稱（案件編號 / 專案名稱不會自動改）。`)) return false;
    }
    if (fields.TaxId && !/^\d{8}$/.test(fields.TaxId) && !confirm(`統一編號「${fields.TaxId}」不是 8 位數字，確定要這樣存嗎？`)) return false;
    return true;
  };

  /** 存檔成功後：更新視窗內容、暫存的紀錄，並通知頁面更新清單。 */
  const applySaved = (r) => {
    const oldName = st.companyName;
    if (r.customer) {
      st.customer = Object.assign({}, st.customer, r.customer);
      st.companyName = r.customer.CompanyName || st.companyName;
      if (r.customer.RowIndex != null) st.rowIndex = r.customer.RowIndex;
    }
    if (oldName !== st.companyName) {
      ContactLogStore.rename(oldName, st.companyName);
      if (st.caseData && st.caseData.CustomerName === oldName) st.caseData = Object.assign({}, st.caseData, { CustomerName: st.companyName });
    }
    if (r.log) ContactLogStore.add(r.log);
    clearCached('customers');
    clearCached('casesPageData');
    if (typeof opts.onSaved === 'function') {
      try {
        opts.onSaved(r, oldName);
      } catch (e) {
        console.error(e);
      }
    }
    return oldName;
  };

  /** 後端還沒部署新版（沒有 saveFollowUp）時，退回舊的作法：先記聯繫紀錄、再改客戶。 */
  const legacySave = async (body) => {
    if (body.log) {
      const log = await callApi('addContactLog', Object.assign({ companyName: body.companyName, salesperson: typeof currentUsername !== 'undefined' ? currentUsername : '' }, body.log));
      if (!log.success) return log;
    }
    const upd = await callApi('updateCustomer', { rowIndex: body.rowIndex, companyName: body.companyName, fields: body.fields });
    if (!upd.success) return upd;
    if (!followUpLegacyWarned) {
      followUpLegacyWarned = true;
      alert('已儲存。\n\n提醒：後端程式還是舊版，修改紀錄、公司改名連動等新功能要等管理員把最新的 Code.gs 部署成新版本後才會生效。');
    }
    return { success: true, customer: Object.assign({}, st.customer, body.fields), log: null };
  };
  const saveFollowUp = async (body) => {
    const r = await callApi('saveFollowUp', body);
    if (r && !r.success && /未知的操作/.test(r.message || '')) return legacySave(body);
    return r;
  };

  const saveEdit = async () => {
    const fields = editChanged();
    if (!Object.keys(fields).length) return closeEdit();
    if (!checkEditFields(fields)) return;
    const r = await saveFollowUp({ rowIndex: st.rowIndex, companyName: st.companyName, fields, keepOldContact: keepOldChecked(), caseId: st.caseId });
    if (!r.success) return alert(r.message);
    const oldContact = st.customer.Contact;
    applySaved(r);
    if ($('fu-contact') && $('fu-contact').value.trim() === String(oldContact || '').trim()) $('fu-contact').value = st.customer.Contact || '';
    if (r.keptOldContact) st.contacts = null; // 其他聯絡窗口有變，重新載入
    closeEdit();
    renderInfo();
    renderHistory();
    loadContacts();
    flash('✓ 客戶資料已儲存' + (r.keptOldContact ? '，原聯絡人已留在其他聯絡窗口' : ''));
  };

  const flash = (text) => {
    let el = $('fu-flash');
    if (!el) {
      el = document.createElement('div');
      el.id = 'fu-flash';
      el.className = 'fu-flash';
      $('fu-info').before(el);
    }
    el.textContent = text;
    clearTimeout(el._t);
    el._t = setTimeout(() => el.remove(), 4000);
  };

  // ---- 上次聯繫 / 歷史紀錄 ----
  const renderHistory = () => {
    const box = $('fu-hist');
    if (!box) return;
    const logs = ContactLogStore.get(st.companyName);
    const loading = logs == null;
    const list = logs || [];
    const last = lastRealContact(list, st.caseId);
    const lastHtml = loading
      ? '<span class="calc-hint">載入中…</span>'
      : last
        ? `${htmlEsc(last.Date)} ${htmlEsc(last.Method || '')}${last.Contact ? '（' + htmlEsc(last.Contact) + '）' : ''}：${htmlEsc(String(last.Summary || '').replace(/\s*\n\s*/g, ' ').slice(0, 90))}${String(last.Summary || '').length > 90 ? '…' : ''}`
        : '<span class="calc-hint">（還沒有聯繫紀錄）</span>';
    const nContact = list.filter((l) => !isChangeLog(l)).length;
    const nChange = list.length - nContact;
    const nCase = st.caseId ? list.filter((l) => l.CaseID === st.caseId).length : 0;
    let html = `<div class="fu-hist-head"><div><b>上次聯繫：</b>${lastHtml}</div>
      <button type="button" class="btn-mini" data-act="toggle">${st.histOpen ? '▾ 收合' : '▸ 展開歷史紀錄'}${loading ? '' : `（${list.length}）`}</button></div>`;
    if (st.histOpen) {
      const filters = [['all', '全部', list.length], ['contact', '聯繫', nContact], ['change', '修改', nChange]];
      if (st.caseId) filters.push(['case', '此案件', nCase]);
      const shown = list.filter((l) => (st.histFilter === 'contact' ? !isChangeLog(l) : st.histFilter === 'change' ? isChangeLog(l) : st.histFilter === 'case' ? l.CaseID === st.caseId : true));
      html += `<div class="fu-hist-filters">${filters.map(([k, label, n]) => `<button type="button" class="btn-mini${st.histFilter === k ? ' active' : ''}" data-filter="${k}">${label} ${n}</button>`).join('')}</div>`;
      html += loading
        ? '<div class="calc-hint" style="padding:6px 0;">歷史紀錄載入中…（不影響下面填寫，可以先繼續操作）</div>'
        : shown.length
          ? `<div class="fu-hist-list">${shown.map(followHistItemHtml).join('')}</div>`
          : '<div class="calc-hint" style="padding:6px 0;">沒有符合的紀錄。</div>';
    }
    box.innerHTML = html;
  };
  $('fu-hist').addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.act === 'toggle') st.histOpen = !st.histOpen;
    else if (t.dataset.filter) st.histFilter = t.dataset.filter;
    else return;
    renderHistory();
  });
  unsubscribe = ContactLogStore.onChange((company) => {
    if (!company || company === st.companyName) renderHistory();
  });

  // ---- 其他聯絡窗口（背景載入，給聯絡人下拉與「換成其他聯絡窗口」用）----
  const loadContacts = () => {
    const name = st.companyName;
    callApi('getCustomerContacts', { companyName: name }, { silent: true }).then((r) => {
      if (!document.body.contains(wrap) || name !== st.companyName) return;
      st.contacts = r && r.success ? r.contacts || [] : [];
      renderContactChoices();
    });
  };

  renderInfo();
  renderHistory();
  renderContactChoices();
  ContactLogStore.loadCompany(st.companyName); // 一打開就先在背景載入歷史紀錄，按「展開」時已經有資料
  loadContacts();

  // ---- 下次追蹤 ----
  [['明天', 1], ['3 天後', 3], ['1 週後', 7], ['2 週後', 14], ['1 個月後', 30]].forEach(([label, n]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn-mini';
    b.textContent = label;
    b.onclick = () => {
      $('fu-date').value = fuAddDays(n);
      $('fu-stop').checked = false;
      $('fu-date').disabled = false;
      $('fu-time').disabled = false;
    };
    $('fu-quick').appendChild(b);
  });
  $('fu-time-clear').onclick = () => ($('fu-time').value = '');
  $('fu-stop').onchange = () => {
    $('fu-date').disabled = $('fu-stop').checked;
    $('fu-time').disabled = $('fu-stop').checked;
  };
  if ($('fu-reuse')) $('fu-reuse').onclick = () => ($('fu-note').value = String(currentNote || ''));
  $('fu-close').onclick = () => {
    if (st.editOpen && Object.keys(editChanged()).length && !confirm('修改的客戶資料還沒儲存，確定要關閉嗎？')) return;
    close();
  };

  $('fu-save').onclick = async () => {
    const summary = opts.editOnly ? '' : $('fu-summary').value.trim();
    if (!opts.editOnly && !summary) return alert('請填寫這次追蹤的結果 / 聯繫內容');
    const stop = $('fu-stop').checked;
    const date = stop ? '' : $('fu-date').value;
    if (!stop && !date) return alert('請選擇下次追蹤日，或勾選「不再追蹤」');
    const note = stop ? '' : $('fu-note').value.trim();
    const time = stop ? '' : $('fu-time').value;
    if (!stop && !note && !confirm('還沒有填「下次洽談內容」，之後可能會忘記下次要談什麼。\n\n還是要儲存嗎？')) return;
    const editFields = editChanged();
    if (Object.keys(editFields).length && !checkEditFields(editFields)) return;
    const body = {
      rowIndex: st.rowIndex,
      companyName: st.companyName,
      fields: Object.assign({}, editFields, { NextFollowUpDate: date, NextFollowUpNote: note, NextFollowUpTime: time }),
      keepOldContact: keepOldChecked(),
      caseId: st.caseId,
    };
    if (!opts.editOnly) body.log = { method: $('fu-method').value, contact: $('fu-contact').value.trim(), summary, caseId: st.caseId };
    const btn = $('fu-save');
    btn.disabled = true;
    try {
      const r = await saveFollowUp(body);
      if (!r.success) return alert(r.message);
      applySaved(r);
      close();
      if (typeof opts.onDone === 'function') opts.onDone(r);
    } finally {
      btn.disabled = false;
    }
  };
}
let followUpLegacyWarned = false;
