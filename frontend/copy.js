/**
 * copy.js - 文案製作頁：文案編輯、我的文案、素材庫（含 AI 學習風格與匯入）、文案專用 AI 模型
 * 後端 Code.gs 的文案製作章節（需要「文案製作」權限，只有「查看」時唯讀）；提示詞在這裡組好、讓使用者確認後才送出。
 */
const CP = window.CopyPrompts;
let D = null; // copyGetData 的回傳
let curId = 0; // 正在編輯的文案編號（0 = 新文案）
let curPlatform = 'Threads';
let curLiked = false;
let marketing = [];
let eventInfo = CP.blankEvent();
let off = new Set(); // 本次不帶入的素材編號
let useAi = true;
let pendingJob = null;
let previous = null;
let busy = false;
let editingLib = 0;
let aiRows = [];
let curTab = 'edit';

const $ = (id) => document.getElementById(id);
const val = (id) => $(id).value;
const setVal = (id, v) => ($(id).value = v == null ? '' : v);
const readOnly = () => !canWrite('copy');
const notify = (text, bad) => {
  $('cp-msg').innerHTML = text ? `<span style="color:${bad ? '#c0392b' : '#1e8e3e'};">${htmlEsc(text)}</span>` : '';
};

function closeModal(id) {
  $(id).style.display = 'none';
}

// ------------------------------------------------------------
// 載入與分頁
// ------------------------------------------------------------
async function loadData(silent) {
  const r = await callApi('copyGetData', {}, { silent: !!silent });
  if (!r.success) {
    notify('讀取失敗：' + (r.message || '') + '（要先請把最新的 Code.gs 整份貼到 Apps Script（專案裡只留這一個檔案）、執行 setup 並重新部署新版本）', true);
    return false;
  }
  D = r;
  off = new Set(D.library.filter((l) => !l.enabled).map((l) => l.id));
  renderMaterials();
  renderList();
  renderLib();
  fillStyle();
  fillAi();
  applyRo();
  return true;
}

function showTab(tab) {
  curTab = tab;
  document.querySelectorAll('.bot-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.bot-panel').forEach((p) => (p.style.display = p.dataset.panel === tab ? '' : 'none'));
  try {
    history.replaceState(null, '', '#' + tab);
  } catch (e) {}
}

function applyRo() {
  const ro = readOnly();
  $('cp-ro').style.display = ro ? '' : 'none';
  document.querySelectorAll('.cp-write').forEach((el) => (el.disabled = ro));
  document.querySelectorAll('#cp-topic,#cp-keywords,#cp-tone,#cp-status,#cp-when,#cp-note,#cp-marketing input,#cp-schedule input,#cp-event-fields input,#cp-materials input,#st-profile,#st-enabled,#ai-rows input,#ai-rows select').forEach((el) => (el.disabled = ro));
  $('cp-content').readOnly = ro;
  $('cp-del-btn').style.display = curId && canDelete() ? '' : 'none';
}

// ------------------------------------------------------------
// 編輯器
// ------------------------------------------------------------
function initEditor() {
  $('cp-tones').innerHTML = CP.TONES.map((t) => `<option value="${htmlEsc(t)}"></option>`).join('');
  $('cp-status').innerHTML = Object.keys(CP.STATUS_LABEL).map((k) => `<option value="${k}">${CP.STATUS_LABEL[k]}</option>`).join('');
  $('cp-quick').innerHTML = CP.QUICK.map((q, i) => `<button type="button" class="btn-mini cp-write" onclick="openRewrite(${i})">${htmlEsc(q.label)}</button>`).join(' ');
  $('cp-marketing').innerHTML = CP.MARKETING.map(
    ([group, items]) => `<div style="margin:6px 0;"><b class="calc-hint">${htmlEsc(group)}</b><div class="bot-days">${items
      .map(([key, label, desc]) => `<label class="bot-day" title="${htmlEsc(desc)}"><input type="checkbox" value="${key}" onchange="onMarketing()" /> ${htmlEsc(label)}</label>`)
      .join('')}</div></div>`
  ).join('');
  $('cp-event-fields').innerHTML = CP.EVENT_FIELDS.map((f) => `<div><label>${htmlEsc(f.label)}</label><input data-ev="${f.key}" maxlength="200" placeholder="${htmlEsc(f.placeholder)}" /></div>`).join('');
  $('lib-kind').innerHTML = Object.keys(CP.KIND_LABEL).map((k) => `<option value="${k}">${htmlEsc(CP.KIND_LABEL[k])}</option>`).join('');
  $('lib-platform').innerHTML = `<option value="">全部平台</option><option value="${CP.SCOPE_SOCIAL}">一般社群貼文（Threads／IG／FB／X／LINE）</option>` + CP.PLATFORM_NAMES.map((n) => `<option>${htmlEsc(n)}</option>`).join('');
  $('ls-status').innerHTML += Object.keys(CP.STATUS_LABEL).map((k) => `<option value="${k}">${CP.STATUS_LABEL[k]}</option>`).join('');
  $('ls-platform').innerHTML += CP.PLATFORM_NAMES.map((n) => `<option>${htmlEsc(n)}</option>`).join('');
  fillEditor(blankPost());
}

function blankPost() {
  return { id: 0, platform: 'Threads', topic: '', keywords: '', tone: CP.TONES[0], marketing: [], event: CP.blankEvent(), content: '', note: '', status: 'draft', scheduled_for: '', liked: false };
}

function fillEditor(p) {
  curId = p.id || 0;
  curPlatform = CP.PLATFORMS[p.platform] ? p.platform : 'Threads';
  curLiked = !!p.liked;
  marketing = (p.marketing || []).slice();
  eventInfo = JSON.parse(JSON.stringify(p.event || CP.blankEvent()));
  if (!eventInfo.schedule || !eventInfo.schedule.length) eventInfo.schedule = [{ date: '', time: '' }];
  setVal('cp-topic', p.topic);
  setVal('cp-keywords', p.keywords);
  setVal('cp-tone', p.tone || CP.TONES[0]);
  setVal('cp-content', p.content);
  setVal('cp-status', p.status);
  setVal('cp-when', p.scheduled_for);
  setVal('cp-note', p.note);
  previous = null;
  $('cp-undo').style.display = 'none';
  $('cp-variants').style.display = 'none';
  closePending();
  $('cp-title').textContent = curId ? '編輯文案 #' + curId : '新文案';
  renderPlatforms();
  renderEventFields();
  syncMarketingBoxes();
  renderMaterials();
  updateCount();
  renderLiked();
  applyRo();
}

function renderLiked() {
  $('cp-liked').style.display = curLiked ? '' : 'none';
  $('cp-like-btn').textContent = curLiked ? '💖 已喜愛（再按取消）' : '🤍 我喜歡這篇（讓 AI 學習）';
}

function renderPlatforms() {
  $('cp-plats').innerHTML = CP.PLATFORM_NAMES.map((n) => `<button type="button" class="cp-plat ${n === curPlatform ? 'active' : ''}" onclick="setPlatform('${n}')">${htmlEsc(n)}</button>`).join('');
  $('cp-open-btn').textContent = '複製並開啟 ' + curPlatform;
  const opts = CP.PLATFORM_NAMES.filter((n) => n !== curPlatform);
  $('cp-convert').innerHTML = '<option value="">轉成其他平台…</option>' + opts.map((n) => `<option>${htmlEsc(n)}</option>`).join('');
}

function setPlatform(name) {
  if (readOnly()) return;
  curPlatform = name;
  renderPlatforms();
  renderMaterials();
  updateCount();
}

function syncMarketingBoxes() {
  document.querySelectorAll('#cp-marketing input').forEach((el) => (el.checked = marketing.includes(el.value)));
  $('cp-mk-count').textContent = marketing.length ? `（已選 ${marketing.length}）` : '';
}

function onMarketing() {
  marketing = [...document.querySelectorAll('#cp-marketing input:checked')].map((el) => el.value);
  $('cp-mk-count').textContent = marketing.length ? `（已選 ${marketing.length}）` : '';
}

function renderEventFields() {
  $('cp-schedule').innerHTML = eventInfo.schedule
    .map(
      (r, i) => `<div class="bot-row"><label>日期${eventInfo.schedule.length > 1 ? ' ' + (i + 1) : ''} <input value="${htmlEsc(r.date)}" maxlength="40" placeholder="例：2026/11/20（五）" oninput="setSchedule(${i}, 'date', this.value)" /></label>
        <label>時間 <input value="${htmlEsc(r.time)}" maxlength="40" placeholder="例：10:00–17:00" oninput="setSchedule(${i}, 'time', this.value)" /></label>
        ${eventInfo.schedule.length > 1 ? `<button type="button" class="btn-mini cp-write" onclick="removeScheduleRow(${i})">刪除</button>` : ''}</div>`
    )
    .join('');
  document.querySelectorAll('#cp-event-fields input').forEach((el) => {
    el.value = eventInfo[el.dataset.ev] || '';
    el.oninput = () => (eventInfo[el.dataset.ev] = el.value);
  });
}

function setSchedule(i, key, v) {
  eventInfo.schedule[i][key] = v;
}

function addScheduleRow() {
  const last = eventInfo.schedule[eventInfo.schedule.length - 1];
  eventInfo.schedule.push({ date: '', time: last ? last.time : '' });
  renderEventFields();
  applyRo();
}

function removeScheduleRow(i) {
  eventInfo.schedule.splice(i, 1);
  renderEventFields();
  applyRo();
}

function clearEvent() {
  eventInfo = CP.blankEvent();
  renderEventFields();
  applyRo();
}

function applicableLib() {
  return D ? D.library.filter((l) => CP.itemApplies(l, curPlatform)) : [];
}

function renderMaterials() {
  if (!D) return;
  const list = applicableLib();
  const ai = D.style.enabled && D.style.profile;
  let html = '';
  if (!list.length && !ai) html = `<div class="calc-hint">素材庫裡沒有適用「${htmlEsc(curPlatform)}」的素材，會使用預設的社群小編人設。到「🎨 素材庫」新增或匯入。</div>`;
  if (ai) html += `<label class="bot-check"><input type="checkbox" ${useAi ? 'checked' : ''} onchange="useAi = this.checked" /> 🤖 AI 學習風格 <span class="calc-hint">（從你喜歡的文案整理）</span></label>`;
  html += list
    .map((l) => `<label class="bot-check" title="${htmlEsc(l.text)}"><input type="checkbox" ${off.has(l.id) ? '' : 'checked'} onchange="toggleOff(${l.id}, this.checked)" /> <span class="bot-badge">${l.kind === 'prompt' ? '人設' : l.kind === 'style' ? '風格' : '結尾'}</span> ${htmlEsc(l.name)}</label>`)
    .join('');
  $('cp-materials').innerHTML = html;
  applyRoMaterials();
}

function applyRoMaterials() {
  document.querySelectorAll('#cp-materials input').forEach((el) => (el.disabled = readOnly()));
}

function toggleOff(id, checked) {
  if (checked) off.delete(id);
  else off.add(id);
}

function picked() {
  const on = applicableLib().filter((l) => !off.has(l.id));
  const styles = on.filter((l) => l.kind === 'style');
  const liked = D.posts.filter((p) => p.liked && p.content).slice(0, 3);
  const aiText = useAi && D.style.enabled ? CP.aiStyleText(D.style.profile, liked) : '';
  return {
    prompts: on.filter((l) => l.kind === 'prompt'),
    styles: aiText ? [{ name: '🤖 AI 學習風格', text: aiText }].concat(styles) : styles,
    endings: on.filter((l) => l.kind === 'ending'),
  };
}

function draft() {
  return { platform: curPlatform, topic: val('cp-topic'), keywords: val('cp-keywords'), tone: val('cp-tone') || CP.TONES[0], marketing, event: eventInfo };
}

function updateCount() {
  const def = CP.PLATFORMS[curPlatform];
  const n = [...val('cp-content')].length;
  $('cp-count').innerHTML = `<span style="color:${n > def.limit ? '#c0392b' : '#667'};">${n} / ${def.limit} 字</span>`;
  $('cp-content').rows = def.long ? 18 : 10;
  $('cp-longtitle').textContent = def.long && val('cp-content') ? '標題：' + (CP.pickBlock(val('cp-content'), '標題') || '（內文裡沒有【標題】區塊）') : '';
}

const tags = (items) => (items.length ? items.join('、') : '無');

function openGenerate() {
  if (readOnly()) return;
  if (!val('cp-topic').trim()) return notify('請先填寫主題', true);
  if (!D.aiReady) return notify('還沒有設定 AI 模型：到「🧠 AI 模型」（或 BOT 設定）填入 API Key', true);
  const p = picked();
  const d = draft();
  const def = CP.PLATFORMS[curPlatform];
  showPending({
    title: '請確認本次生成設定',
    mode: 'generate',
    rows: [
      ['發佈平台', `${curPlatform}（上限 ${def.limit} 字）`],
      ['主題', d.topic],
      ['語氣', d.tone],
      ['活動資訊', tags(CP.eventSummary(d.event))],
      ['目標關鍵字', d.keywords.trim() || '未填'],
      ['啟用人設', tags(p.prompts.map((x) => x.name))],
      ['啟用發文風格', tags(p.styles.map((x) => x.name))],
      ['啟用結尾', tags(p.endings.map((x) => x.name))],
      ['行銷目標', tags(d.marketing.map((k) => (CP.MARKETING_BY_KEY[k] || {}).label || k))],
    ],
    prompt: CP.buildGeneratePrompt(d, p),
  });
}

function openRewrite(i) {
  const q = CP.QUICK[i];
  rewriteJob(q.instruction, q.label, curPlatform, 'rewrite');
}

function onConvert(sel) {
  const to = sel.value;
  sel.value = '';
  if (to) rewriteJob(CP.convertInstruction(to), `轉成 ${to} 版本`, to, 'convert');
}

function rewriteJob(instruction, label, target, mode) {
  if (readOnly()) return;
  if (!val('cp-content').trim()) return notify('內文是空的', true);
  if (!D.aiReady) return notify('還沒有設定 AI 模型', true);
  const p = picked();
  showPending({
    title: '請確認本次改寫設定',
    mode,
    target,
    rows: [['動作', label], ['目標平台', target], ['啟用人設', tags(p.prompts.map((x) => x.name))], ['啟用發文風格', tags(p.styles.map((x) => x.name))], ['啟用結尾', tags(p.endings.map((x) => x.name))]],
    prompt: CP.buildRewritePrompt(val('cp-content'), instruction, target, p),
  });
}

function showPending(job) {
  pendingJob = job;
  $('cp-pending-title').textContent = job.title;
  $('cp-pending-rows').innerHTML = job.rows.map(([k, v]) => `<dt>${htmlEsc(k)}</dt><dd>${htmlEsc(v)}</dd>`).join('');
  setVal('cp-pending-prompt', job.prompt);
  $('cp-pending').style.display = '';
  $('cp-pending').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closePending() {
  pendingJob = null;
  $('cp-pending').style.display = 'none';
}

async function runPending() {
  if (!pendingJob || busy) return;
  const job = pendingJob;
  job.prompt = val('cp-pending-prompt');
  closePending();
  busy = true;
  $('cp-busy').textContent = job.mode === 'generate' ? '生成中…（約 10~30 秒）' : 'AI 改寫中…（約 10~30 秒）';
  notify('');
  const r = await callApi('copyGenerate', { prompt: job.prompt }, { silent: true });
  busy = false;
  $('cp-busy').textContent = '';
  if (!r.success) return notify('失敗：' + (r.message || ''), true);
  if (job.mode === 'generate') {
    showVariants(CP.splitVariants(r.text));
    notify(`已產生（${r.model}）。挑一版按「使用這版」`);
  } else {
    previous = val('cp-content');
    setVal('cp-content', r.text.trim());
    if (job.mode === 'convert' && job.target) {
      curPlatform = job.target;
      renderPlatforms();
      renderMaterials();
    }
    $('cp-undo').style.display = '';
    updateCount();
    notify('已改寫完成（可按「復原」回到原內文）');
  }
}

let variants = [];
function showVariants(list) {
  variants = list;
  const box = $('cp-variants');
  box.style.display = '';
  box.innerHTML =
    '<h3>產生的版本</h3>' +
    list
      .map(
        (v, i) => `<div class="cp-var"><div style="white-space:pre-wrap;word-break:break-word;">${htmlEsc(v)}</div>
        <div class="bot-row"><button type="button" class="btn-mini cp-write" onclick="useVariant(${i})">使用這版</button><button type="button" class="btn-mini" onclick="copyText(variants[${i}])">複製</button></div></div>`
      )
      .join('') +
    '<div class="bot-row"><button type="button" class="btn-mini" onclick="$(\'cp-variants\').style.display=\'none\'">收起</button></div>';
  applyRo();
}

function useVariant(i) {
  previous = val('cp-content');
  setVal('cp-content', variants[i]);
  $('cp-undo').style.display = '';
  updateCount();
  notify('已套用（可按「復原」回到原內文）');
}

function undoContent() {
  if (previous === null) return;
  setVal('cp-content', previous);
  previous = null;
  $('cp-undo').style.display = 'none';
  updateCount();
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    notify('已複製');
    return true;
  } catch (e) {
    notify('瀏覽器不允許複製，請手動選取內文', true);
    return false;
  }
}

async function copyContent(open) {
  if (!val('cp-content').trim()) return notify('內文是空的', true);
  if (await copyText(val('cp-content'))) {
    notify(open ? `已複製，正在開啟 ${curPlatform}…` : '已複製文案');
    if (open) window.open(CP.PLATFORMS[curPlatform].url, '_blank', 'noopener');
  }
}

function collectPost() {
  return { platform: curPlatform, topic: val('cp-topic'), keywords: val('cp-keywords'), tone: val('cp-tone'), marketing, event: eventInfo, content: val('cp-content'), note: val('cp-note'), status: val('cp-status'), scheduled_for: val('cp-when') };
}

async function savePost() {
  if (readOnly()) return null;
  if (!val('cp-content').trim() && !val('cp-topic').trim()) {
    notify('主題與內文都是空的', true);
    return null;
  }
  const r = await callApi('copySavePost', { id: curId, post: collectPost() });
  if (!r.success) {
    notify(r.message || '儲存失敗', true);
    return null;
  }
  curId = r.id;
  $('cp-title').textContent = '編輯文案 #' + curId;
  notify('已儲存');
  await loadData(true);
  applyRo();
  return r.id;
}

async function toggleLike() {
  if (readOnly()) return;
  if (!val('cp-content').trim()) return notify('內文是空的', true);
  const id = curId || (await savePost());
  if (!id) return;
  const next = !curLiked;
  const r = await callApi('copySetLiked', { id, liked: next });
  if (!r.success) return notify(r.message || '失敗', true);
  curLiked = next;
  renderLiked();
  notify(next ? '已加入喜愛清單，到「素材庫」可以讓 AI 整理你的風格' : '已取消喜愛');
  loadData(true);
}

function newPost() {
  fillEditor(blankPost());
  showTab('edit');
}

function editPost(id) {
  const p = D.posts.find((x) => x.id === id);
  if (!p) return;
  fillEditor(p);
  showTab('edit');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function deletePost(id) {
  if (!id || !confirm('刪除這篇文案？')) return;
  const r = await callApi('copyDeletePost', { id });
  if (!r.success) return notify(r.message || '刪除失敗', true);
  if (id === curId) fillEditor(blankPost());
  notify('已刪除');
  loadData(true);
}

// ------------------------------------------------------------
// 我的文案
// ------------------------------------------------------------
function renderList() {
  if (!D) return;
  const kw = val('ls-keyword').trim().toLowerCase();
  const st = val('ls-status');
  const pf = val('ls-platform');
  const liked = $('ls-liked').checked;
  const rows = D.posts.filter((p) => (!st || p.status === st) && (!pf || p.platform === pf) && (!liked || p.liked) && (!kw || (p.topic + p.content + p.note + p.keywords).toLowerCase().includes(kw)));
  $('ls-count').textContent = `${rows.length} 篇${D.total > D.posts.length ? `（共 ${D.total} 篇，只列最近 ${D.posts.length} 篇）` : ''}`;
  if (!rows.length) {
    $('ls-table').innerHTML = '<div class="calc-hint" style="margin-top:8px;">沒有符合的文案。</div>';
    return;
  }
  const colors = { draft: '#889', scheduled: '#b36b00', posted: '#1e8e3e' };
  $('ls-table').innerHTML =
    '<table class="bot-table"><thead><tr><th>更新</th><th>平台</th><th>主題 / 內文</th><th>狀態</th><th>預計發佈</th><th></th></tr></thead><tbody>' +
    rows
      .map(
        (p) => `<tr><td class="nowrap">${htmlEsc(p.updated_at.slice(0, 10))}</td><td>${htmlEsc(p.platform)}</td>
        <td><b>${p.liked ? '💖 ' : ''}${htmlEsc(p.topic || '（無主題）')}</b><div class="calc-hint bot-snip" style="max-width:520px;">${htmlEsc(p.content.replace(/\s+/g, ' ').slice(0, 120))}</div>${p.note ? `<div class="calc-hint">📝 ${htmlEsc(p.note)}</div>` : ''}</td>
        <td><span style="color:${colors[p.status]};font-weight:bold;">${CP.STATUS_LABEL[p.status]}</span></td><td class="nowrap">${htmlEsc(p.scheduled_for)}</td>
        <td class="nowrap"><button type="button" class="btn-mini" onclick="editPost(${p.id})">${readOnly() ? '查看' : '編輯'}</button>
        <button type="button" class="btn-mini" onclick="copyText(D.posts.find((x) => x.id === ${p.id}).content)">複製</button>
        <button type="button" class="btn-mini btn-danger" onclick="deletePost(${p.id})">刪除</button></td></tr>`
      )
      .join('') +
    '</tbody></table>';
}

// ------------------------------------------------------------
// 素材庫
// ------------------------------------------------------------
function renderLib() {
  if (!D) return;
  const groups = Object.keys(CP.KIND_LABEL);
  $('lib-list').innerHTML = groups
    .map((kind) => {
      const items = D.library.filter((l) => l.kind === kind);
      return `<h4 style="margin:14px 0 4px;">${htmlEsc(CP.KIND_LABEL[kind])}（${items.length}）</h4>` +
        (items.length
          ? '<table class="bot-table"><tbody>' +
            items
              .map(
                (l) => `<tr class="${l.enabled ? '' : 'off'}"><td style="width:28%;"><b>${htmlEsc(l.name)}</b><div class="calc-hint">${htmlEsc(CP.scopeLabel(l.platform))}</div></td>
              <td><div class="bot-snip" style="max-width:520px;" title="${htmlEsc(l.text)}">${htmlEsc(l.text.replace(/\s+/g, ' ').slice(0, 100))}</div></td>
              <td class="nowrap"><label class="bot-check" style="margin:0;"><input type="checkbox" class="cp-write" ${l.enabled ? 'checked' : ''} onchange="toggleLib(${l.id}, this.checked)" /> 預設帶入</label></td>
              <td class="nowrap"><button type="button" class="btn-mini cp-write" onclick="openLib(${l.id})">編輯</button> <button type="button" class="btn-mini btn-danger" onclick="deleteLibItem(${l.id})">刪除</button></td></tr>`
              )
              .join('') +
            '</tbody></table>'
          : '<div class="calc-hint">還沒有。</div>');
    })
    .join('');
}

function openLib(id) {
  if (readOnly()) return;
  editingLib = id || 0;
  const l = id ? D.library.find((x) => x.id === id) : { kind: 'prompt', name: '', text: '', platform: '', enabled: true };
  $('lib-title').textContent = id ? '編輯素材' : '新增素材';
  setVal('lib-kind', l.kind);
  setVal('lib-name', l.name);
  setVal('lib-platform', l.platform);
  setVal('lib-text', l.text);
  $('lib-enabled').checked = l.enabled;
  $('lib-modal').style.display = '';
}

async function saveLib() {
  const item = { kind: val('lib-kind'), name: val('lib-name'), text: val('lib-text'), platform: val('lib-platform'), enabled: $('lib-enabled').checked };
  const r = await callApi('copySaveLib', { id: editingLib, item });
  if (!r.success) return alert(r.message || '儲存失敗');
  closeModal('lib-modal');
  await loadData(true);
}

async function toggleLib(id, enabled) {
  const r = await callApi('copyToggleLib', { id, enabled }, { silent: true });
  if (!r.success) alert(r.message || '失敗');
  await loadData(true);
}

async function deleteLibItem(id) {
  if (!confirm('刪除這個素材？')) return;
  const r = await callApi('copyDeleteLib', { id });
  if (!r.success) return alert(r.message || '刪除失敗');
  await loadData(true);
}

async function importFile() {
  const f = $('imp-file').files[0];
  if (!f) return ($('imp-msg').textContent = '請選擇檔案');
  if (f.size > 5000000) return ($('imp-msg').textContent = '檔案太大（上限 5MB）');
  const json = await f.text();
  const r = await callApi('copyImport', { json });
  $('imp-msg').textContent = r.success ? '✓ ' + r.message : '失敗：' + (r.message || '');
  if (r.success) {
    $('imp-file').value = '';
    await loadData(true);
  }
}

function fillStyle() {
  $('st-enabled').checked = D.style.enabled;
  setVal('st-profile', D.style.profile);
  $('st-msg').textContent = D.style.updatedAt ? '上次整理：' + D.style.updatedAt : '';
}

async function saveStyle() {
  const r = await callApi('copySaveStyle', { profile: val('st-profile'), enabled: $('st-enabled').checked });
  $('st-msg').textContent = r.success ? '已儲存 ✓' : '失敗：' + (r.message || '');
  if (r.success) await loadData(true);
}

async function learnStyle() {
  if (readOnly()) return;
  const liked = D.posts.filter((p) => p.liked && p.content).slice(0, 3);
  if (!liked.length) return ($('st-msg').textContent = '還沒有「喜歡」的文案。到文案編輯頁按「🤍 我喜歡這篇」就會收集在這裡');
  if (!D.aiReady) return ($('st-msg').textContent = '還沒有設定 AI 模型');
  $('st-msg').textContent = '整理中…（約 10~30 秒）';
  const prompt = CP.buildLearnPrompt(liked, val('st-profile').trim());
  const r = await callApi('copyGenerate', { prompt }, { silent: true });
  if (!r.success) return ($('st-msg').textContent = '失敗：' + (r.message || ''));
  const save = await callApi('copySaveStyle', { profile: r.text.trim().slice(0, 3000), enabled: $('st-enabled').checked }, { silent: true });
  await loadData(true);
  $('st-msg').textContent = save.success ? `已用最近 ${liked.length} 篇喜愛的文案整理出新版風格指南 ✓` : '儲存失敗：' + (save.message || '');
}

// ------------------------------------------------------------
// AI 模型
// ------------------------------------------------------------
function fillAi() {
  aiRows = D.models.map((m) => Object.assign({ apiKey: '' }, m));
  $('ai-using').textContent = aiRows.length
    ? '使用這裡設定的模型。'
    : D.usingBotModels
    ? '目前沒有文案專用模型，沿用「BOT 設定 → AI 模型」。'
    : D.botAvailable
    ? '還沒有任何 AI 模型：請在下面新增，或到「BOT 設定 → AI 模型」設定。'
    : '還沒有任何 AI 模型（Code.gs 版本太舊，請更新）。';
  renderAi();
}

function renderAi() {
  const P = D.providers || {};
  const keys = Object.keys(P);
  $('ai-rows').innerHTML = aiRows
    .map((m, i) => {
      const def = P[m.provider] || P.gemini || { model: '', endpoint: '' };
      return `<div class="bot-ai-row">
        <div class="bot-ai-no">${i === 0 ? '主要' : '備援 ' + i}</div>
        <select onchange="aiField(${i}, 'provider', this.value)">${keys.map((k) => `<option value="${k}" ${k === m.provider ? 'selected' : ''}>${htmlEsc(P[k].name)}</option>`).join('')}</select>
        <input placeholder="模型（預設 ${htmlEsc(def.model)}）" value="${htmlEsc(m.model)}" oninput="aiField(${i}, 'model', this.value)" />
        <input placeholder="Endpoint（預設 ${htmlEsc(def.endpoint)}）" value="${htmlEsc(m.endpoint)}" oninput="aiField(${i}, 'endpoint', this.value)" />
        <input type="password" autocomplete="new-password" placeholder="${m.hasKey ? htmlEsc(m.keyHint) + '（留空沿用）' : 'API Key'}" oninput="aiField(${i}, 'apiKey', this.value)" />
        <span class="nowrap">
          <button type="button" class="btn-mini" ${m.hasKey && !m.apiKey ? '' : 'disabled'} onclick="testModel(${i})">測試</button>
          <button type="button" class="btn-mini cp-write" onclick="moveAi(${i}, -1)">↑</button>
          <button type="button" class="btn-mini cp-write" onclick="moveAi(${i}, 1)">↓</button>
          <button type="button" class="btn-mini cp-write" onclick="removeAi(${i})">✕</button>
        </span>
        <div class="calc-hint" id="ai-test-${i}"></div>
      </div>`;
    })
    .join('');
  applyRo();
}

function aiField(i, k, v) {
  aiRows[i][k] = v;
  if (k === 'provider') renderAi();
}

function addAiRow() {
  if (aiRows.length >= 5) return alert('最多 5 個模型');
  aiRows.push({ provider: 'gemini', model: '', endpoint: '', hasKey: false, keyHint: '', apiKey: '' });
  renderAi();
}

function moveAi(i, d) {
  const j = i + d;
  if (j < 0 || j >= aiRows.length) return;
  [aiRows[i], aiRows[j]] = [aiRows[j], aiRows[i]];
  renderAi();
}

function removeAi(i) {
  aiRows.splice(i, 1);
  renderAi();
}

async function saveModels() {
  const models = aiRows.map((m) => ({ provider: m.provider, model: m.model, endpoint: m.endpoint, apiKey: m.apiKey || '' }));
  const r = await callApi('copySaveModels', { models });
  if (!r.success) return alert(r.message || '儲存失敗');
  $('ai-msg').textContent = '✓ 已儲存';
  setTimeout(() => ($('ai-msg').textContent = ''), 3000);
  await loadData(true);
}

async function testModel(i) {
  const el = $('ai-test-' + i);
  el.textContent = '測試中…';
  const r = await callApi('copyTestModel', { index: i }, { silent: true });
  el.innerHTML = r.success ? `<span style="color:#1e8e3e;">✓ 成功（${htmlEsc(r.provider)} ${htmlEsc(r.model)}，${r.ms} ms）</span>` : `<span style="color:#c0392b;">✗ ${htmlEsc(r.message || '失敗')}</span>`;
}

// ------------------------------------------------------------
// 啟動
// ------------------------------------------------------------
window.addEventListener('DOMContentLoaded', async () => {
  if (!(await ensureAuth())) return;
  renderHeaderUser();
  applyAdminOnlyVisibility();
  document.querySelectorAll('.bot-tab').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  initEditor();
  await loadData();
  const first = (location.hash || '').replace('#', '');
  if (first && document.querySelector(`.bot-tab[data-tab="${first}"]`)) showTab(first);
});

window.refreshPageData = async () => {
  await loadData(true);
};
