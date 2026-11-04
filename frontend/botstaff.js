/**
 * botstaff.js - BOT 設定頁的「員工助理」分頁：設定、成員開通與權限、長期記憶（後端：BotStaff.gs）
 * 依附 bot.js（共用 $、val、setVal、readOnly、closeModal、TAB_LOADERS）。
 */
let staffData = null;
let permTarget = null; // 正在編輯權限的成員 LineUserId

const ST_STATUS = ['待開通', '已開通', '停用'];
const ST_ROLES = [
  { v: 'viewer', t: '查看' },
  { v: 'editor', t: '編輯者' },
  { v: 'limited', t: '特定（逐區塊）' },
];

TAB_LOADERS.staff = () => loadStaff();

async function loadStaff(silent) {
  const r = await callApi('botGetStaff', {}, { silent: !!silent });
  if (!r.success) {
    $('st-members').innerHTML = `<div class="calc-hint" style="color:#c0392b;">讀取失敗：${htmlEsc(r.message || '')}<br>（要先把最新的 Code.gs、Bot.gs 與 <b>BotStaff.gs</b> 貼到 Apps Script、執行 setup 並重新部署）</div>`;
    return;
  }
  staffData = r;
  fillStaffConfig(r.config);
  renderMembers();
  renderMemory();
  applyStaffReadOnly();
}

function applyStaffReadOnly() {
  const ro = readOnly();
  document.querySelectorAll('.bot-panel[data-panel="staff"] input, .bot-panel[data-panel="staff"] textarea, .bot-panel[data-panel="staff"] select').forEach((el) => (el.disabled = ro));
  document.querySelectorAll('.bot-panel[data-panel="staff"] .bot-write, .bot-panel[data-panel="staff"] .st-write').forEach((b) => (b.disabled = ro));
}

// ------------------------------------------------------------
// 設定
// ------------------------------------------------------------
function fillStaffConfig(c) {
  $('st-enabled').checked = c.enabled;
  $('st-web').checked = c.webEnabled;
  setVal('st-welcome', c.welcome);
  setVal('st-pending', c.pendingText);
  setVal('st-prompt', c.prompt);
  $('st-push').checked = c.push.enabled;
  setVal('st-push-hour', c.push.hour);
  $('st-mem').checked = c.memory.enabled;
  setVal('st-mem-max', c.memory.maxItems);
  $('st-mem-confirm').checked = c.memory.confirm;
  $('st-mem-shared').checked = c.memory.canShared;
}

async function saveStaff() {
  const config = {
    enabled: $('st-enabled').checked,
    webEnabled: $('st-web').checked,
    welcome: val('st-welcome'),
    pendingText: val('st-pending'),
    prompt: val('st-prompt'),
    push: { enabled: $('st-push').checked, hour: Number(val('st-push-hour')) },
    memory: { enabled: $('st-mem').checked, maxItems: Number(val('st-mem-max')), confirm: $('st-mem-confirm').checked, canShared: $('st-mem-shared').checked },
  };
  const r = await callApi('botSaveStaff', { config });
  $('st-msg').textContent = r.success ? '已儲存 ✓' : '儲存失敗：' + (r.message || '');
  if (r.success) {
    staffData.config = r.config;
    fillStaffConfig(r.config);
    // 網站助理的開關有改：清掉各頁快取，下次進頁面才會更新浮窗
    try {
      sessionStorage.removeItem('aoi_assist_info');
    } catch (e) {}
  }
}

async function pushNow() {
  $('st-push-msg').textContent = '推播中…';
  const r = await callApi('botPushNow', {});
  $('st-push-msg').textContent = r.success ? '已通知機器人伺服器：' + (r.message || '') : '失敗：' + (r.message || '');
}

// ------------------------------------------------------------
// 成員
// ------------------------------------------------------------
function permSummary(m) {
  if (m.Role === 'editor') return '全部區塊可編輯（不含刪除）';
  if (m.Role === 'viewer') return '全部區塊只能查看';
  const lab = {};
  (staffData.blocks || []).forEach((b) => (lab[b.key] = b.label.replace(/（.*$/, '')));
  const parts = Object.entries(m.PermsObj || {}).map(([k, v]) => `${lab[k] || k}${v === 'edit' ? '（編輯）' : '（查看）'}`);
  return parts.length ? parts.join('、') : '⚠️ 還沒有開放任何區塊';
}

function accountOptions(m) {
  const list = staffData.canLinkOthers ? staffData.accounts : staffData.accounts.filter((a) => a.username === staffData.me || a.username === m.LinkedUsername);
  const opts = ['<option value="">（不綁定）</option>'].concat(list.map((a) => `<option value="${htmlEsc(a.username)}" ${a.username === m.LinkedUsername ? 'selected' : ''}>${htmlEsc(a.name)}（${htmlEsc(a.username)}）</option>`));
  if (m.LinkedUsername && !list.some((a) => a.username === m.LinkedUsername)) opts.push(`<option value="${htmlEsc(m.LinkedUsername)}" selected>${htmlEsc(m.LinkedName || m.LinkedUsername)}</option>`);
  return opts.join('');
}

function renderMembers() {
  const ms = staffData.members;
  if (!ms.length) {
    $('st-members').innerHTML = '<div class="calc-hint" style="margin-top:8px;">還沒有成員：員工加員工助理的 LINE 官方帳號為好友後，會出現在這裡（待開通）。</div>';
    return;
  }
  const rows = ms
    .map((m) => {
      const id = htmlEsc(m.LineUserId);
      const pending = m.Status === '待開通';
      return `<tr data-id="${id}" class="${m.Status === '停用' ? 'off' : ''}">
        <td>${m.PictureUrl ? `<img src="${htmlEsc(m.PictureUrl)}" class="st-avatar" alt="" />` : '👤'}</td>
        <td><b>${htmlEsc(m.DisplayName || '（未取得名稱）')}</b>${m.IsFollowing ? '' : ' <span class="bot-badge warn">已封鎖/退出</span>'}<div class="calc-hint">${htmlEsc(m.LineUserId.slice(0, 8))}… 最近使用 ${htmlEsc(m.LastSeenAt || '—')}</div></td>
        <td><select class="st-status st-write">${ST_STATUS.map((s) => `<option ${s === m.Status ? 'selected' : ''}>${s}</option>`).join('')}</select>${pending ? '<div class="calc-hint" style="color:#c0392b;">等待開通</div>' : m.ApprovedBy ? `<div class="calc-hint">${htmlEsc(m.ApprovedBy)} 開通</div>` : ''}</td>
        <td><select class="st-role st-write" onchange="onMemberRole('${id}', this.value)">${ST_ROLES.map((r) => `<option value="${r.v}" ${r.v === m.Role ? 'selected' : ''}>${r.t}</option>`).join('')}</select>
          <div class="calc-hint">${htmlEsc(permSummary(m))}</div>
          <button type="button" class="btn-mini st-write st-permbtn" style="${m.Role === 'limited' ? '' : 'display:none;'}" onclick="openPerm('${id}')">設定區塊權限</button></td>
        <td><select class="st-link st-write">${accountOptions(m)}</select></td>
        <td><label class="bot-check" style="margin:0;"><input type="checkbox" class="st-push st-write" ${m.PushDaily ? 'checked' : ''} /> 早報</label></td>
        <td><input class="st-note st-write" value="${htmlEsc(m.Note)}" maxlength="300" placeholder="備註" /></td>
        <td class="nowrap"><button type="button" class="btn-mini st-write" onclick="saveMember('${id}')">儲存</button>
          <button type="button" class="btn-mini btn-danger" onclick="deleteBotItem('member', '${id}')">移除</button></td>
      </tr>`;
    })
    .join('');
  $('st-members').innerHTML = `<table class="bot-table"><thead><tr><th></th><th>成員</th><th>狀態</th><th>角色與權限</th><th>綁定網站帳號</th><th>早報</th><th>備註</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
}

function memberOf(id) {
  return staffData.members.find((m) => m.LineUserId === id);
}

function onMemberRole(id, role) {
  const m = memberOf(id);
  const row = document.querySelector(`#st-members tr[data-id="${id}"]`);
  if (row) row.querySelector('.st-permbtn').style.display = role === 'limited' ? '' : 'none';
  if (role === 'limited' && !Object.keys(m.PermsObj || {}).length) openPerm(id, true);
}

function openPerm(id) {
  const m = memberOf(id);
  permTarget = id;
  $('perm-title').textContent = '功能權限：' + (m.DisplayName || id.slice(0, 8));
  const lv = m.PermsObj || {};
  $('perm-body').innerHTML =
    '<div class="calc-hint">員工助理沒有刪除功能，所以只分「查看」與「編輯」。</div>' +
    staffData.blocks
      .map((b) => {
        const v = lv[b.key] || '';
        const radio = (val, label) => `<label class="u-perm-opt"><input type="radio" name="pm-${b.key}" value="${val}" ${v === val ? 'checked' : ''} /> ${label}</label>`;
        return `<div class="u-perm-row"><span class="u-perm-name">${htmlEsc(b.label)}</span>${radio('', '不開放')}${radio('view', '查看')}${radio('edit', '編輯')}</div>`;
      })
      .join('');
  $('perm-modal').style.display = '';
}

function savePerm() {
  const m = memberOf(permTarget);
  const perms = {};
  staffData.blocks.forEach((b) => {
    const el = document.querySelector(`input[name="pm-${b.key}"]:checked`);
    if (el && el.value) perms[b.key] = el.value;
  });
  m.PermsObj = perms; // 先存在畫面上，按該列「儲存」才寫入
  closeModal('perm-modal');
  renderMembers();
  const row = document.querySelector(`#st-members tr[data-id="${permTarget}"]`);
  if (row) row.querySelector('.st-role').value = 'limited';
}

async function saveMember(id) {
  const m = memberOf(id);
  const row = document.querySelector(`#st-members tr[data-id="${id}"]`);
  const role = row.querySelector('.st-role').value;
  const body = {
    lineUserId: id,
    status: row.querySelector('.st-status').value,
    role,
    linkedUsername: row.querySelector('.st-link').value,
    pushDaily: row.querySelector('.st-push').checked,
    note: row.querySelector('.st-note').value,
  };
  if (role === 'limited') body.perms = m.PermsObj || {};
  const r = await callApi('botMemberSave', body);
  if (!r.success) return alert(r.message || '儲存失敗');
  await loadStaff(true);
}

async function deleteBotItem(kind, id) {
  if (kind === 'member') {
    if (!confirm('移除這位成員？他之後再傳訊息會重新變成「待開通」。')) return;
    const r = await callApi('botMemberRemove', { lineUserId: id });
    if (!r.success) return alert(r.message || '移除失敗');
  } else {
    if (!confirm('刪除這筆記憶？')) return;
    const r = await callApi('botMemoryDelete', { ids: [Number(id)] });
    if (!r.success) return alert(r.message || '刪除失敗');
  }
  loadStaff(true);
}

// ------------------------------------------------------------
// 長期記憶
// ------------------------------------------------------------
function renderMemory() {
  $('mem-cat').innerHTML = staffData.memoryCategories.map((c) => `<option>${htmlEsc(c)}</option>`).join('');
  const items = staffData.memory.slice().sort((a, b) => (a.scope === b.scope ? b.importance - a.importance : a.scope === 'all' ? -1 : 1));
  if (!items.length) {
    $('st-memory').innerHTML = '<div class="calc-hint" style="margin-top:8px;">還沒有記憶。</div>';
    return;
  }
  const nameOf = (u) => (staffData.accounts.find((a) => a.username === u) || {}).name || (u.length > 20 ? u.slice(0, 8) + '…' : u);
  $('st-memory').innerHTML =
    '<table class="bot-table"><thead><tr><th>範圍</th><th>分類</th><th>內容</th><th>重要度</th><th>更新</th><th></th></tr></thead><tbody>' +
    items
      .map(
        (m) => `<tr><td>${m.scope === 'all' ? '🏢 全公司' : '👤 ' + htmlEsc(nameOf(m.owner))}</td><td>${htmlEsc(m.category)}</td><td>${htmlEsc(m.content)}</td><td>${m.importance}</td><td class="nowrap">${htmlEsc(String(m.updatedAt).slice(0, 10))}</td>
        <td><button type="button" class="btn-mini btn-danger" onclick="deleteBotItem('memory', ${m.id})">刪除</button></td></tr>`
      )
      .join('') +
    '</tbody></table>';
}

async function addMemory() {
  const content = val('mem-content').trim();
  if (!content) return ($('mem-msg').textContent = '請輸入內容');
  const r = await callApi('botMemorySave', { data: { mode: 'add', scope: val('mem-scope'), category: val('mem-cat'), importance: Number(val('mem-imp')), content } });
  if (!r.success) return ($('mem-msg').textContent = '失敗：' + (r.message || ''));
  $('mem-msg').textContent = r.result && r.result.duplicate ? '已經有一樣的了' : '已新增 ✓';
  setVal('mem-content', '');
  loadStaff(true);
}

// 從導覽列「員工助理」連到 bot.html#staff（同一頁時只有網址 # 改變）
window.addEventListener('hashchange', () => {
  const t = (location.hash || '').replace('#', '');
  if (t && document.querySelector(`.bot-tab[data-tab="${t}"]`)) showTab(t);
});
