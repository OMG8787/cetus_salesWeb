/**
 * home.js - 首頁：常用網站（一鍵開啟）、行事曆行程、常用型號、備忘錄
 */
let sites = [];
let siteDraft = [];
let memos = [];

function esc(str) {
  return String(str == null ? '' : str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ------------------------------------------------------------
// 常用網站
// ------------------------------------------------------------
async function loadSites() {
  const result = await callApi('getShortcuts', {});
  if (!result.success) return;
  sites = result.shortcuts;
  renderSites();
}

function renderSites() {
  const box = document.getElementById('site-list');
  box.innerHTML = '';
  if (!sites.length) {
    box.innerHTML = '<span class="calc-hint">還沒有常用網站，按右上角「編輯」加入。</span>';
    return;
  }
  sites.forEach((s) => {
    const a = document.createElement('a');
    a.className = 'site-chip';
    a.href = s.Url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.innerHTML = `${esc(s.Title)}${s.OpenOnStart ? ' <span class="auto" title="預設開啟">★</span>' : ''}`;
    box.appendChild(a);
  });
}

/**
 * 一次開啟所有「預設開啟」的網站。瀏覽器規定「一次點擊只能開一個分頁」，多開的會被當成廣告彈窗擋掉，
 * 網頁本身無法繞過。解法有兩種：① 在網址列允許本網站的彈出式視窗（設一次就永久有效）；
 * ② 按「下載啟動檔」，下載一個 .bat，之後雙擊它就能一次開好全部（Windows）。
 */
function openAllSites() {
  const targets = sites.filter((s) => s.OpenOnStart);
  const hint = document.getElementById('site-hint');
  if (!targets.length) {
    hint.textContent = '沒有標「預設開啟」的網站，按「編輯」勾選。';
    return;
  }
  const blocked = [];
  targets.forEach((s) => {
    const w = window.open(s.Url, '_blank');
    if (w) w.opener = null;
    else blocked.push(s);
  });
  if (!blocked.length) {
    hint.textContent = `已開啟 ${targets.length} 個網站。`;
    return;
  }
  hint.innerHTML = `瀏覽器一次點擊只讓開一個分頁，另外 ${blocked.length} 個被擋住了。<br>
    <strong>方法一（設一次永久有效）</strong>：點網址列右側的「已封鎖彈出式視窗」圖示 → 選「一律允許 ${esc(location.host)} 顯示彈出式視窗」→ 再按一次「一鍵開啟」。<br>
    <strong>方法二</strong>：<a href="#" onclick="downloadLauncher(); return false;">下載啟動檔（.bat）</a>，之後雙擊它就會一次開好全部預設網站。<br>
    或直接點下面被擋的網站：`;
  blocked.forEach((s) => {
    const a = document.createElement('a');
    a.href = s.Url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = ' ' + s.Title + ' ';
    hint.appendChild(a);
  });
}

/** 產生 Windows 批次檔：雙擊就用預設瀏覽器開啟所有預設網站，不受瀏覽器彈窗限制。 */
function downloadLauncher() {
  const targets = sites.filter((s) => s.OpenOnStart);
  if (!targets.length) return alert('沒有標「預設開啟」的網站');
  const lines = ['@echo off', 'chcp 65001 >nul'].concat(targets.map((s) => `start "" "${s.Url.replace(/"/g, '').replace(/%/g, '%%')}"`));
  const crlf = String.fromCharCode(13, 10);
  const blob = new Blob([String.fromCharCode(0xfeff) + lines.join(crlf) + crlf], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '上班一鍵開啟網站.bat';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function toggleSiteEdit() {
  const box = document.getElementById('site-edit');
  const show = box.style.display === 'none';
  box.style.display = show ? '' : 'none';
  if (show) {
    siteDraft = sites.map((s) => Object.assign({}, s));
    if (!siteDraft.length) siteDraft.push({ Title: '', Url: '', OpenOnStart: true });
    renderSiteRows();
  }
}

function renderSiteRows() {
  const box = document.getElementById('site-edit-rows');
  box.innerHTML = '';
  siteDraft.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'site-edit-row';
    row.innerHTML = `
      <input placeholder="名稱" value="${esc(s.Title)}" oninput="siteDraft[${i}].Title = this.value" />
      <input placeholder="網址，例如 mail.google.com" value="${esc(s.Url)}" oninput="siteDraft[${i}].Url = this.value" />
      <label class="inline-check"><input type="checkbox" ${s.OpenOnStart ? 'checked' : ''} onchange="siteDraft[${i}].OpenOnStart = this.checked" /> 預設開啟</label>
      <button class="btn-secondary" onclick="removeSiteRow(${i})">刪除</button>`;
    box.appendChild(row);
  });
}

function addSiteRow() {
  siteDraft.push({ Title: '', Url: '', OpenOnStart: true });
  renderSiteRows();
}

function removeSiteRow(i) {
  siteDraft.splice(i, 1);
  renderSiteRows();
}

async function saveSites() {
  const result = await callApi('saveShortcuts', { shortcuts: siteDraft });
  if (!result.success) return alert(result.message);
  document.getElementById('site-edit').style.display = 'none';
  await loadSites();
}

// ------------------------------------------------------------
// 行事曆
// ------------------------------------------------------------
async function loadEvents() {
  const days = document.getElementById('cal-days').value;
  const box = document.getElementById('event-list');
  box.innerHTML = '<span class="calc-hint">讀取中...</span>';
  const result = await callApi('getCalendarEvents', { days: Number(days) });
  if (!result.success) {
    box.innerHTML = `<span class="calc-hint">${esc(result.message)}</span>`;
    return;
  }
  if (!result.events.length) {
    box.innerHTML = '<span class="calc-hint">這段期間沒有行程。</span>';
    return;
  }
  box.innerHTML = '';
  result.events.forEach((ev) => {
    const time = ev.AllDay ? `${ev.Start}（全天）` : ev.Start.replace('T', ' ');
    const row = document.createElement('div');
    row.className = 'event-row';
    row.innerHTML = `<span class="event-time">${esc(time)}</span><span style="flex:1">${esc(ev.Title)}${ev.Location ? ' <span class="calc-hint">@' + esc(ev.Location) + '</span>' : ''}</span>`;
    const btn = document.createElement('button');
    btn.className = 'btn-secondary';
    btn.textContent = '存成備忘';
    btn.onclick = () => saveEventAsMemo(ev, time);
    row.appendChild(btn);
    box.appendChild(row);
  });
}

async function saveEventAsMemo(ev, time) {
  const result = await callApi('addMemo', { title: ev.Title, content: `行程時間：${time}${ev.Location ? '\n地點：' + ev.Location : ''}`, shared: false });
  if (!result.success) return alert(result.message);
  loadMemos();
}

// ------------------------------------------------------------
// 常用型號
// ------------------------------------------------------------
async function loadFavorites() {
  const result = await callApi('getFavorites', {});
  const box = document.getElementById('fav-list');
  box.innerHTML = '';
  if (!result.success || !result.favorites.length) {
    box.innerHTML = '<span class="calc-hint">還沒有常用型號。</span>';
    return;
  }
  result.favorites.forEach((m) => {
    const a = document.createElement('a');
    a.className = 'site-chip';
    a.href = 'products.html?fav=1';
    a.textContent = m;
    box.appendChild(a);
  });
}

// ------------------------------------------------------------
// 備忘錄（預設只有自己看，勾「分享」全站都看得到；只有建立者能改/刪）
// ------------------------------------------------------------
async function loadMemos() {
  const result = await callApi('getMemos', {});
  if (!result.success) return;
  memos = result.memos;
  renderMemos();
}

function renderMemos() {
  const filter = document.getElementById('memo-filter').value;
  const box = document.getElementById('memo-list');
  box.innerHTML = '';
  const list = memos.filter((m) => (filter === 'mine' ? m.IsMine : filter === 'shared' ? !m.IsMine : true));
  if (!list.length) {
    box.innerHTML = '<span class="calc-hint">沒有備忘錄。</span>';
    return;
  }
  list.forEach((m) => {
    const div = document.createElement('div');
    div.className = 'memo-item' + (m.Shared ? ' shared' : '');
    const tag = m.IsMine ? (m.Shared ? '我的・已分享' : '我的・僅自己') : `${esc(m.OwnerName)} 分享`;
    div.innerHTML = `
      <div class="memo-head"><span><strong>${esc(m.Title || '（無標題）')}</strong> <span class="memo-tag">${tag}</span></span><span>${esc(m.LastUpdated || '')}</span></div>
      <div class="memo-body">${esc(m.Content)}</div>`;
    if (m.IsMine) {
      const actions = document.createElement('div');
      actions.className = 'toolbar';
      actions.innerHTML = `
        <button class="btn-secondary" onclick="editMemo(${m.RowIndex})">編輯</button>
        <button class="btn-secondary" onclick="toggleMemoShared(${m.RowIndex}, ${!m.Shared})">${m.Shared ? '改為僅自己看' : '分享給所有人'}</button>
        <button class="btn-secondary" onclick="deleteMemo(${m.RowIndex})">刪除</button>`;
      div.appendChild(actions);
    }
    box.appendChild(div);
  });
}

async function addMemo() {
  const title = document.getElementById('memo-title').value.trim();
  const content = document.getElementById('memo-content').value.trim();
  if (!title && !content) return alert('標題或內容至少要填一個');
  const result = await callApi('addMemo', { title, content, shared: document.getElementById('memo-shared').checked });
  if (!result.success) return alert(result.message);
  ['memo-title', 'memo-content'].forEach((id) => (document.getElementById(id).value = ''));
  document.getElementById('memo-shared').checked = false;
  loadMemos();
}

async function editMemo(rowIndex) {
  const m = memos.find((x) => x.RowIndex === rowIndex);
  if (!m) return;
  const title = prompt('標題：', m.Title);
  if (title === null) return;
  const content = prompt('內容：', m.Content);
  if (content === null) return;
  const result = await callApi('updateMemo', { rowIndex, fields: { Title: title, Content: content } });
  if (!result.success) return alert(result.message);
  loadMemos();
}

async function toggleMemoShared(rowIndex, shared) {
  if (shared && !confirm('分享後，系統裡所有登入的人都看得到這則備忘錄，確定嗎？')) return;
  const result = await callApi('updateMemo', { rowIndex, fields: { Shared: shared } });
  if (!result.success) return alert(result.message);
  loadMemos();
}

async function deleteMemo(rowIndex) {
  if (!confirm('確定要刪除這則備忘錄嗎？')) return;
  const result = await callApi('deleteMemo', { rowIndex });
  if (!result.success) return alert(result.message);
  loadMemos();
}

window.addEventListener('DOMContentLoaded', async () => {
  if (!(await ensureAuth())) return;
  renderHeaderUser();
  applyAdminOnlyVisibility();
  const h = new Date().getHours();
  document.getElementById('home-greeting').textContent = `${h < 12 ? '早安' : h < 18 ? '午安' : '晚安'}，${currentUsername || ''}`;
  loadSites();
  loadEvents();
  loadFavorites();
  loadMemos();
});
