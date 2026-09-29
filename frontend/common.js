/**
 * ============================================================
 * common.js - 每一頁都會載入的共用邏輯
 * ------------------------------------------------------------
 * 內容：呼叫後端的 callApi()、載入遮罩、登入狀態檢查、登出、
 * 文件預覽彈窗、Enter鍵送出小工具。
 *
 * 頁面專屬的邏輯（產品/案件/報價/客戶/日報）分別放在
 * products.js / cases.js / quote.js / customers.js / report.js，
 * 每個頁面只載入自己需要的那一支，不用把整個系統的程式碼都載進來。
 * ============================================================
 */

let currentToken = sessionStorage.getItem('token') || null;
let currentUsername = sessionStorage.getItem('username') || null;
let loadingCount = 0;

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
async function callApi(action, params) {
  showLoading();
  try {
    if (typeof DEMO_MODE !== 'undefined' && DEMO_MODE) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      return handleDemoApi(action, params || {});
    }
    const payload = Object.assign({ action: action, token: currentToken }, params || {});
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
    });
    return await res.json();
  } finally {
    hideLoading();
  }
}

// ------------------------------------------------------------
// 登入狀態
// ------------------------------------------------------------
/** 每個需要登入才能看的頁面，一開始就呼叫這個；沒登入會導回 index.html。 */
function requireLogin() {
  if (!currentToken) {
    location.href = 'index.html';
  }
}

function renderHeaderUser() {
  const el = document.getElementById('current-user');
  if (el) el.textContent = currentUsername + (typeof DEMO_MODE !== 'undefined' && DEMO_MODE ? '（示範模式，資料只存在這台瀏覽器）' : '');
}

function logout() {
  sessionStorage.clear();
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

function setCached(key, data) {
  try {
    sessionStorage.setItem('cache_' + key, JSON.stringify(data));
  } catch (e) {
    // sessionStorage 滿了或不可用就算了，不影響功能，只是少了這個加速
  }
}

function clearCached(key) {
  sessionStorage.removeItem('cache_' + key);
}
