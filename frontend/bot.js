/**
 * bot.js - BOT 設定頁（客服機器人）：設定、知識庫、網站客服視窗、對話與小編接手、測試聊天、AI 模型、連線
 * 資料都存在試算表（Code.gs 的 BOT 設定章節），機器人伺服器是 linebot/（Vercel）。需要「BOT 設定」權限，只有「查看」時唯讀。
 */
let botData = null; // botGetSettings 的回傳
let kbItems = null;
let kbLoaded = false;
let kbEmbed = null;
let kbPending = 0;
let curTab = 'overview';
let selectedConv = null; // 後台對話列表選到的客人
let talkTimer = null;
let keyShown = {};
let revealedKey = '';

const DAY_NAMES = '日一二三四五六';
const TAB_LOADERS = { kb: () => loadKb(), leads: () => loadLeads(), talk: () => loadTalk(), conn: () => fillConn(), web: () => fillWeb(), ai: () => fillAi() };

function $(id) {
  return document.getElementById(id);
}

function val(id) {
  return $(id).value;
}

function setVal(id, v) {
  $(id).value = v == null ? '' : v;
}

function readOnly() {
  return !canWrite('bot');
}

// ------------------------------------------------------------
// 分頁
// ------------------------------------------------------------
function showTab(tab) {
  curTab = tab;
  document.querySelectorAll('.bot-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.bot-panel').forEach((p) => (p.style.display = p.dataset.panel === tab ? '' : 'none'));
  try {
    history.replaceState(null, '', '#' + tab);
  } catch (e) {}
  if (TAB_LOADERS[tab]) TAB_LOADERS[tab]();
  clearInterval(talkTimer);
  if (tab === 'talk') talkTimer = setInterval(() => !document.hidden && loadTalk(true), 20000);
}

function applyReadOnly() {
  const ro = readOnly();
  $('bot-ro').style.display = ro ? '' : 'none';
  document.querySelectorAll('.bot-write').forEach((b) => (b.disabled = ro));
  ['cs', 'web', 'ai', 'conn'].forEach((p) => {
    document.querySelectorAll(`.bot-panel[data-panel="${p}"] input, .bot-panel[data-panel="${p}"] textarea, .bot-panel[data-panel="${p}"] select`).forEach((el) => {
      if (el.id !== 'web-embed' && el.id !== 'conn-gas' && el.id !== 'conn-key') el.disabled = ro;
    });
  });
  if ($('cs-save-bar')) $('cs-save-bar').style.display = ro ? 'none' : '';
  if ($('cs-save-bar2')) $('cs-save-bar2').style.display = ro ? 'none' : '';
}

async function loadAll(silent) {
  const r = await callApi('botGetSettings', {}, { silent: !!silent });
  if (!r.success) {
    $('ov-steps').innerHTML = `<div class="calc-hint" style="color:#c0392b;">讀取失敗：${htmlEsc(r.message || '')}<br>（要先請把最新的 Code.gs 整份貼到 Apps Script（專案裡只留這一個檔案）、執行 setup 並重新部署新版本）</div>`;
    return false;
  }
  botData = r;
  fillCs(r.cs);
  fillWeb();
  renderOverview();
  applyReadOnly();
  return true;
}

// ------------------------------------------------------------
// 總覽
// ------------------------------------------------------------
async function saveGroundCheck() {
  if (readOnly()) return;
  const on = $('ov-ground').checked;
  const r = await callApi('botSaveSettings', { groundCheck: on });
  $('ov-ground-msg').textContent = r.success ? (on ? '　✓ 已開啟（最多 5 分鐘生效）' : '　✓ 已關閉') : '　儲存失敗：' + (r.message || '');
  if (r.success && botData) botData.cs.groundCheck = on;
  setTimeout(() => ($('ov-ground-msg').textContent = ''), 4000);
}

function renderOverview() {
  const d = botData;
  if ($('ov-ground')) $('ov-ground').checked = d.cs.groundCheck === true;
  const g = d.general || {};
  const steps = [
    { ok: !!d.aiUsing, title: 'AI 模型', text: d.aiUsing ? `使用 ${d.aiUsing.name} ${d.aiUsing.model}${d.aiUsing.count > 1 ? `（共 ${d.aiUsing.count} 個，依序備援）` : ''}` : '還沒有設定 AI 的 API Key', tab: 'ai' },
    { ok: d.keys.cs.has, title: '客服機器人金鑰', text: d.keys.cs.has ? '已產生（' + d.keys.cs.hint + '）' + (d.keys.cs.shared ? '，目前與員工助理共用舊版金鑰，建議重新產生以分開' : '') : '還沒有產生，客服機器人伺服器需要它才能連到這個系統', tab: 'conn' },
    { ok: !!g.botUrl, title: '機器人伺服器（Vercel）', text: g.botUrl ? g.botUrl + '（機器人第一次連線時會自動記下）' : '還沒有連線：部署 linebot 到 Vercel 並填好環境變數，或手動填「機器人網址」', tab: 'conn' },
    { ok: d.kbCount > 0 || (d.cs.sources.brand && d.cs.brandInfo) || d.cs.sources.products, title: '知識庫', text: d.kbCount > 0 ? `${d.kbCount} 筆常見問題 / 文件段落` : '還沒有資料：到「📚 知識庫」新增常見問題，或匯入文件', tab: 'kb' },
    { ok: d.cs.enabled, title: '客服機器人', text: d.cs.enabled ? '已啟用' : '還沒啟用：到「🛎️ 客服設定」勾選「啟用」並儲存', tab: 'cs' },
    { ok: d.cs.web.enabled, title: '網站客服視窗', text: d.cs.web.enabled ? '已開啟' : '（選用）到「🌐 網站客服視窗」開啟並複製嵌入碼', tab: 'web', optional: true },
  ];
  $('ov-steps').innerHTML = steps
    .map((s) => `<div class="bot-step ${s.ok ? 'ok' : s.optional ? 'opt' : 'todo'}"><span class="bot-step-mark">${s.ok ? '✓' : s.optional ? '—' : '✗'}</span><div><b>${htmlEsc(s.title)}</b><div class="calc-hint">${htmlEsc(s.text)}</div></div><button type="button" class="btn-mini" onclick="showTab('${s.tab}')">${s.ok ? '查看' : '去設定'}</button></div>`)
    .join('');
  if (g.botUrl) {
    $('ov-steps').insertAdjacentHTML('beforeend', `<div class="calc-hint" style="margin-top:8px;">LINE 設定檢查：<a href="${htmlEsc(g.botUrl)}/api/cs" target="_blank" rel="noopener">${htmlEsc(g.botUrl)}/api/cs</a>（看到 <code>{"ok":true}</code> 就是 Vercel 的 LINE 環境變數都設好了）</div>`);
  }
  if (d.pauses && d.pauses.length) {
    $('ov-steps').insertAdjacentHTML('beforeend', `<div class="bot-step todo" style="margin-top:8px;"><span class="bot-step-mark">🛎️</span><div><b>${d.pauses.length} 位客人在等專人回覆</b><div class="calc-hint">機器人暫停中，處理完刪除首頁備忘錄或到「對話與小編接手」恢復</div></div><button type="button" class="btn-mini" onclick="showTab('talk')">去處理</button></div>`);
  }
}

// ------------------------------------------------------------
// 客服設定
// ------------------------------------------------------------
function fillCs(cs) {
  $('cs-enabled').checked = cs.enabled;
  setVal('cs-welcome', cs.welcome);
  setVal('cs-buttons', cs.buttons);
  $('cs-buttons-always').checked = cs.buttonsAlways;
  setVal('cs-reply-when', cs.replyWhen);
  $('cs-hours-enabled').checked = cs.hours.enabled;
  $('cs-days').innerHTML = [1, 2, 3, 4, 5, 6, 0].map((d) => `<label class="bot-day"><input type="checkbox" value="${d}" ${cs.hours.days.includes(d) ? 'checked' : ''} /> 週${DAY_NAMES[d]}</label>`).join('');
  setVal('cs-hours-start', cs.hours.start);
  setVal('cs-hours-end', cs.hours.end);
  setVal('cs-off-text', cs.hours.offText);
  setVal('cs-handoff-words', cs.handoffWords);
  setVal('cs-handoff-text', cs.handoffText);
  setVal('cs-pause', cs.pauseMinutes);
  setVal('cs-tone', cs.style.tone);
  setVal('cs-address', cs.style.address);
  setVal('cs-emoji', cs.style.emoji);
  setVal('cs-max-lines', cs.style.maxLines);
  setVal('cs-prompt', cs.prompt);
  $('cs-topics').innerHTML = cs.topics
    .map(
      (t, i) => `<div class="bot-topic" data-key="${htmlEsc(t.key)}">
        <label class="bot-check"><input type="checkbox" class="tp-on" ${t.on ? 'checked' : ''} /> <b>${htmlEsc(t.name)}</b></label>
        <label>關鍵字（以空白或逗號分隔）<button type="button" class="btn-mini" onclick="resetTopicWords(${i})">還原預設</button></label>
        <input class="tp-words" value="${htmlEsc(t.words)}" maxlength="500" />
        <label>轉給專人時，請客人先留下的資料（清空 = 不請客人留資料）</label>
        <textarea class="tp-ask" rows="2" maxlength="500">${htmlEsc(t.ask)}</textarea>
        <select class="tp-pos"><option value="after" ${t.askPos === 'after' ? 'selected' : ''}>放在回覆後面</option><option value="before" ${t.askPos === 'before' ? 'selected' : ''}>放在回覆前面</option></select>
      </div>`
    )
    .join('');
  setVal('cs-custom-words', cs.customWords);
  setVal('cs-custom-ask', cs.customAsk);
  setVal('cs-custom-ask-pos', cs.customAskPos);
  setVal('cs-topic-text', cs.topicText);
  setVal('cs-unsure', cs.unsure);
  $('cs-src-qa').checked = cs.sources.qa;
  $('cs-src-docs').checked = cs.sources.docs;
  $('cs-src-brand').checked = cs.sources.brand;
  setVal('cs-brand-info', cs.brandInfo);
  $('cs-src-products').checked = cs.sources.products;
  $('cs-src-calc').checked = cs.sources.calc !== false;
  $('cs-handoff-button').checked = cs.handoffButton !== false;
  setVal('cs-contact-after', cs.contactAfter === undefined ? 3 : cs.contactAfter);
  $('cs-send-images').checked = cs.sendImages !== false;
  const calc = cs.calc || {};
  $('cs-calc-brief').checked = calc.brief !== false;
  setVal('cs-calc-cameras', calc.cameras || 1);
  setVal('cs-calc-lenses', calc.lenses || 1);
  setVal('cs-calc-base', calc.base === 'l' ? 'l' : 's');
  setVal('cs-product-limit', cs.sources.productLimit);
  setVal('cs-product-cats', cs.sources.productCategories);
  renderProductFields(cs.sources.productFields);
  toggleHoursBox();
}

function toggleHoursBox() {
  $('cs-hours-box').style.opacity = $('cs-hours-enabled').checked ? '1' : '.5';
}

function resetTopicWords(i) {
  const t = botData.cs.topics[i];
  document.querySelectorAll('#cs-topics .bot-topic')[i].querySelector('.tp-words').value = t.defaultWords;
}

function readCs() {
  const old = botData.cs;
  return {
    enabled: $('cs-enabled').checked,
    welcome: val('cs-welcome'),
    prompt: val('cs-prompt'),
    handoffText: val('cs-handoff-text'),
    sources: {
      qa: $('cs-src-qa').checked,
      docs: $('cs-src-docs').checked,
      brand: $('cs-src-brand').checked,
      products: $('cs-src-products').checked,
      calc: $('cs-src-calc').checked,
      productLimit: val('cs-product-limit'),
      productCategories: val('cs-product-cats'),
      productFields: [...document.querySelectorAll('#cs-product-fields input:checked')].map((e) => e.value),
    },
    brandInfo: val('cs-brand-info'),
    replyWhen: val('cs-reply-when'),
    hours: {
      enabled: $('cs-hours-enabled').checked,
      days: [...document.querySelectorAll('#cs-days input:checked')].map((e) => Number(e.value)),
      start: val('cs-hours-start'),
      end: val('cs-hours-end'),
      offText: val('cs-off-text'),
    },
    handoffWords: val('cs-handoff-words'),
    pauseMinutes: val('cs-pause'),
    topics: [...document.querySelectorAll('#cs-topics .bot-topic')].map((el) => ({
      key: el.dataset.key,
      on: el.querySelector('.tp-on').checked,
      words: el.querySelector('.tp-words').value,
      ask: el.querySelector('.tp-ask').value,
      askPos: el.querySelector('.tp-pos').value,
    })),
    customWords: val('cs-custom-words'),
    customAsk: val('cs-custom-ask'),
    customAskPos: val('cs-custom-ask-pos'),
    topicText: val('cs-topic-text'),
    unsure: val('cs-unsure'),
    handoffButton: $('cs-handoff-button').checked,
    contactAfter: val('cs-contact-after'),
    sendImages: $('cs-send-images').checked,
    calc: { brief: $('cs-calc-brief').checked, cameras: val('cs-calc-cameras'), lenses: val('cs-calc-lenses'), base: val('cs-calc-base') },
    style: { tone: val('cs-tone'), address: val('cs-address'), emoji: val('cs-emoji'), maxLines: val('cs-max-lines') },
    buttons: val('cs-buttons'),
    buttonsAlways: $('cs-buttons-always').checked,
    web: readWeb(old.web),
  };
}

async function saveCs() {
  if (readOnly()) return;
  const cs = readCs();
  if (cs.enabled && !botData.aiUsing && !confirm('還沒有設定 AI 的 API Key，啟用後機器人沒辦法回答。\n\n還是要儲存嗎？（可以稍後到「🧠 AI 模型」設定）')) return;
  const r = await callApi('botSaveSettings', { cs });
  if (!r.success) return alert(r.message);
  await loadAll(true);
  ['cs-save-msg', 'web-save-msg'].forEach((id) => {
    $(id).textContent = '✓ 已儲存（最多 5 分鐘後套用到機器人）';
    setTimeout(() => ($(id).textContent = ''), 4000);
  });
}

// ------------------------------------------------------------
// 網站客服視窗
// ------------------------------------------------------------
function fillWeb() {
  if (!botData) return;
  const w = botData.cs.web;
  $('web-enabled').checked = w.enabled;
  setVal('web-title', w.title);
  setVal('web-subtitle', w.subtitle);
  setVal('web-color', w.color);
  setVal('web-position', w.position);
  $('web-auto-open').checked = w.autoOpen;
  $('web-reset-reload').checked = w.resetOnReload !== false;
  setVal('web-origins', w.allowedOrigins);
  $('web-self-origin').textContent = location.origin;
  const url = (botData.general || {}).botUrl;
  setVal('web-embed', url ? `<script src="${url}/widget.js" defer></script>` : '（先到「🔌 連線與設定」填好機器人網址，這裡就會出現嵌入碼）');
}

function readWeb(old) {
  return {
    enabled: $('web-enabled').checked,
    title: val('web-title'),
    subtitle: val('web-subtitle'),
    color: val('web-color'),
    position: val('web-position'),
    autoOpen: $('web-auto-open').checked,
    resetOnReload: $('web-reset-reload').checked,
    allowedOrigins: val('web-origins'),
  };
}

function previewWidget() {
  const url = (botData.general || {}).botUrl;
  if (!url) return alert('請先到「🔌 連線與設定」填好機器人網址（並部署 linebot）');
  if (window.AoiChat) return window.AoiChat.open();
  const s = document.createElement('script');
  s.src = url + '/widget.js';
  s.dataset.open = 'true';
  s.onerror = () => alert('載入失敗：確認機器人網址正確、linebot 已部署');
  document.body.appendChild(s);
  setTimeout(() => !window.AoiChat && alert('視窗沒有出現：可能是「客服機器人 / 網站客服視窗」還沒啟用並儲存，或這個後台網站（' + location.origin + '）不在「允許嵌入的網站」裡。'), 4000);
}

async function copyText(id) {
  const el = $(id);
  try {
    await navigator.clipboard.writeText(el.value);
  } catch (e) {
    el.select();
    document.execCommand('copy');
  }
  const old = document.activeElement;
  if (old && old.tagName === 'BUTTON') {
    const t = old.textContent;
    old.textContent = '已複製 ✓';
    setTimeout(() => (old.textContent = t), 1200);
  }
}

// ------------------------------------------------------------
// 知識庫
// ------------------------------------------------------------
async function loadKb() {
  if (!kbLoaded) $('kb-list').innerHTML = '<div class="calc-hint">讀取中…</div>';
  const r = await callApi('botKbList', {}, { silent: kbLoaded });
  if (!r.success) {
    $('kb-list').innerHTML = `<div class="calc-hint" style="color:#c0392b;">${htmlEsc(r.message || '讀取失敗')}</div>`;
    return;
  }
  kbItems = r.items;
  kbEmbed = r.embed;
  kbPending = r.pendingVectors || 0;
  kbLoaded = true;
  $('kb-cats').innerHTML = (r.categories || []).map((c) => `<option value="${htmlEsc(c)}"></option>`).join('');
  renderKb();
  renderVecStatus();
  fillSearch();
}

function kbSnippet(t, n) {
  const s = String(t || '').replace(/\s+/g, ' ');
  return s.length > n ? s.slice(0, n) + '…' : s;
}

/** 知識庫每一筆「誰看得到」：對外客服 / 員工助理（兩個都可以 = 預設） */
const audOf = (k) => (Array.isArray(k.audience) ? k.audience : ['cs', 'staff']);
function audBadge(a) {
  if (a.length === 2) return '';
  return ` <span class="bot-badge ${a.length ? 'aud-part' : 'warn'}" title="給誰看">${!a.length ? '🚫 都不給看' : a[0] === 'cs' ? '🛎️ 只給對外客服' : '🧑‍💼 只給小助手'}</span>`;
}

const DOC_CHUNK = 500;
const DOC_OVERLAP = 100;
let kbEditing = null; // { type:'qa', row } / { type:'doc', key, rows }

const kbDocTitle = (r) => String(r.Title || '').replace(/（\d+\/\d+）(｜.*)?$/, '');
const kbPartTitle = (r) => (String(r.Title || '').match(/（\d+\/\d+）｜(.+)$/) || [])[1] || '';

/** 文件依文件代號（舊資料用文件名稱）合併成一份；常見問題一筆一張卡 */
function kbCards() {
  const docs = new Map();
  const cards = [];
  kbItems
    .slice()
    .sort((a, b) => (a.SortOrder || 0) - (b.SortOrder || 0) || a.ID - b.ID)
    .forEach((r) => {
      if (r.Type !== 'doc') return cards.push({ type: 'qa', row: r });
      const key = r.FileName || r.Source || 'id' + r.ID;
      if (!docs.has(key)) {
        docs.set(key, { type: 'doc', key, rows: [] });
        cards.push(docs.get(key));
      }
      docs.get(key).rows.push(r);
    });
  return cards;
}

function renderKb() {
  if (!kbItems) return;
  const kw = val('kb-keyword').trim().toLowerCase();
  const type = val('kb-type');
  const all = kbCards();
  const cards = all
    .filter((x) => !type || x.type === type)
    .filter((x) => !kw || (x.type === 'qa' ? [x.row.Question, x.row.Content, x.row.Tags, x.row.Title] : x.rows.flatMap((r) => [r.Title, r.Content, r.Tags])).some((v) => String(v || '').toLowerCase().includes(kw)));
  $('kb-count').textContent = `（${all.length} 筆）`;
  $('kb-list').innerHTML =
    cards
      .map((x, i) => {
        if (x.type === 'qa') {
          const r = x.row;
          return `<div class="kb-card ${r.IsActive ? '' : 'off'}" onclick="openKb(kbCards()[${all.indexOf(x)}])">
            <div class="kb-card-head"><b>❓ ${htmlEsc(r.Question || r.Title || '（沒有問題）')}</b><span class="nowrap">${r.HasVector ? '<span class="bot-badge" title="已有向量">🧬</span>' : kbEmbed ? '<span class="bot-badge warn" title="還沒有向量">無向量</span>' : ''}${audBadge(audOf(r))}${r.IsActive ? '' : ' <span class="bot-badge warn">停用</span>'}</span></div>
            <div class="calc-hint">${htmlEsc(kbSnippet(r.Content, 160))}</div>
            ${r.BigCategory || r.Topic ? `<div class="calc-hint">📂 ${htmlEsc([r.BigCategory, r.Topic].filter(Boolean).join(' / '))}${r.Notes ? ` ・ 💡 ${htmlEsc(kbSnippet(r.Notes, 80))}` : ''}</div>` : ''}
            ${r.Tags ? `<div class="calc-hint">🏷️ ${htmlEsc(r.Tags)}</div>` : ''}
          </div>`;
        }
        const first = x.rows[0];
        const len = x.rows.reduce((t, r) => t + String(r.Content || '').length - (Number(r.Overlap) || 0), 0);
        const noVec = x.rows.filter((r) => !r.HasVector).length;
        return `<div class="kb-card ${first.IsActive ? '' : 'off'}" onclick="openKb(kbCards()[${all.indexOf(x)}])">
          <div class="kb-card-head"><b>📄 ${htmlEsc(kbDocTitle(first) || '未命名文件')}</b><span class="calc-hint nowrap">${x.rows.length} 段、${len.toLocaleString()} 字${kbEmbed && noVec ? ` <span class="bot-badge warn" title="還沒有向量的段落">${noVec} 段無向量</span>` : ''}${audBadge(audOf(first))}${first.IsActive ? '' : ' <span class="bot-badge warn">停用</span>'}</span></div>
          <div class="calc-hint">${htmlEsc(kbSnippet(first.Content, 120))}</div>
          ${first.BigCategory || first.Topic ? `<div class="calc-hint">📂 ${htmlEsc([first.BigCategory, first.Topic].filter(Boolean).join(' / '))}</div>` : ''}
        </div>`;
      })
      .join('') || `<div class="calc-hint" style="padding:10px 0;">${kbItems.length ? '沒有符合的資料' : '還沒有資料。按「＋ 常見問題」新增第一筆，例如：問「你們有賣光源嗎？」答「有，環形、條形、同軸光源都有…」。'}</div>`;
}

/** 文件的段落接回原文：新版用每段記的重疊字數去掉；舊匯入的段落之間空一行 */
function kbJoinDoc(rows) {
  if (rows.length && rows.every((r) => r.ChunkSize !== '' && r.ChunkSize != null)) return rows.map((r) => String(r.Content || '').slice(Number(r.Overlap) || 0)).join('');
  return rows.map((r) => r.Content || '').join('\n\n');
}

function openKb(item) {
  kbEditing = item;
  const isDoc = item.type === 'doc';
  const editing = !!(item.row || item.rows);
  $('kb-title').textContent = (editing ? '編輯' : '新增') + (isDoc ? '文件' : '常見問題');
  $('kb-qa-box').style.display = isDoc ? 'none' : '';
  $('kb-doc-box').style.display = isDoc ? '' : 'none';
  $('kb-file').value = '';
  $('kb-file-info').textContent = '';
  $('kb-chunk-preview').style.display = 'none';
  $('kb-ai-msg').textContent = '';
  aiSplit = null;
  let r = {};
  if (isDoc) {
    const rows = item.rows || [];
    r = rows[0] || {};
    setVal('kb-doc-title', rows.length ? kbDocTitle(rows[0]) : '');
    setVal('kb-doc-text', kbJoinDoc(rows));
    setVal('kb-chunk-size', (rows[0] && rows[0].ChunkSize) || DOC_CHUNK);
    setVal('kb-overlap', rows.length > 1 && rows[0] && rows[0].ChunkSize ? Math.max(0, ...rows.map((x) => Number(x.Overlap) || 0)) : DOC_OVERLAP);
    $('kb-ai-split').checked = rows.some((x) => kbPartTitle(x));
    if ($('kb-ai-split').checked) aiSplit = { key: aiKey(kbJoinDoc(rows), val('kb-chunk-size')), chunks: rows.map((x) => ({ text: String(x.Content || '').slice(Number(x.Overlap) || 0), title: kbPartTitle(x) })) };
    fillAiProfiles();
    renderAiBox();
    renderChunkInfo();
  } else {
    r = item.row || {};
    setVal('kb-question', r.Question || '');
    setVal('kb-answer', r.Content || '');
  }
  setVal('kb-tags', r.Tags || '');
  setVal('kb-cat', r.BigCategory || '');
  setVal('kb-topic', r.Topic || '');
  setVal('kb-notes', r.Notes || '');
  kbImages = (r.images || []).map((x) => ({ id: x.id, caption: x.caption || '' }));
  renderKbImages();
  $('kb-img-file').value = '';
  $('kb-img-info').textContent = '';
  $('kb-active').checked = editing ? r.IsActive !== false : true;
  const aud = editing ? audOf(r) : ['cs', 'staff'];
  $('kb-vis-cs').checked = aud.includes('cs');
  $('kb-vis-staff').checked = aud.includes('staff');
  $('kb-delete').style.display = editing ? '' : 'none';
  $('kb-modal').style.display = 'flex';
}

function closeModal(id) {
  $(id).style.display = 'none';
}

/** 長文件切段：每段約 size 字，盡量在段落 / 句號切開；每段開頭重複上一段結尾 ov 個字。回傳 [{ content, overlap }]；去掉每段開頭的 overlap 字再接起來 = 原文 */
function splitDoc(text, size, ov) {
  text = String(text || '').replace(/\r/g, '').trim();
  size = Math.max(100, Math.round(Number(size) || DOC_CHUNK));
  ov = Math.min(Math.floor(size / 2), Math.max(0, Math.round(Number(ov) || 0)));
  const out = [];
  let a = 0;
  while (a < text.length) {
    let b = Math.min(text.length, a + size);
    if (b < text.length) {
      const from = a + Math.floor(size * 0.6);
      const win = text.slice(from, b);
      const last = (re) => {
        let m;
        let k = -1;
        while ((m = re.exec(win))) k = m.index + m[0].length;
        return k;
      };
      let cut = last(/\n\s*\n/g);
      if (cut <= 0) cut = last(/[。！？!?；;\n]/g);
      if (cut <= 0) cut = last(/[，,、\s]/g);
      if (cut > 0) b = from + cut;
    }
    const prev = out.length ? text.slice(Math.max(0, a - ov), a) : '';
    out.push({ content: prev + text.slice(a, b), overlap: prev.length });
    a = b;
  }
  return out;
}

const chunkOpts = () => ({ size: Number(val('kb-chunk-size')) || DOC_CHUNK, ov: val('kb-overlap') === '' ? DOC_OVERLAP : Number(val('kb-overlap')) });

/** 切段資訊：會切成幾段；預覽每段的開頭（重疊的部分標灰） */
function renderChunkInfo() {
  const o = chunkOpts();
  const len = val('kb-doc-text').trim().length;
  const ai = $('kb-ai-split').checked;
  const ready = ai && aiReady();
  const parts = ai ? (ready ? withOverlap(aiSplit.chunks, o.ov) : []) : splitDoc(val('kb-doc-text'), o.size, o.ov);
  $('kb-chunk-info').textContent = !len ? '' : ai ? (ready ? `共 ${len.toLocaleString()} 字 → 🤖 AI 切成 ${parts.length} 段` : '🤖 按下方「讓 AI 切段並預覽」，或儲存時自動切') : `共 ${len.toLocaleString()} 字 → 切成 ${parts.length} 段`;
  if (ai) renderAiBox();
  if ($('kb-chunk-preview').style.display !== 'none') {
    $('kb-chunk-preview').innerHTML =
      parts
        .map(
          (p, i) => `<div class="kb-prev-row"><b>第 ${i + 1} 段${p.title ? '｜' + htmlEsc(p.title) : ''}</b>（${p.content.length} 字${p.overlap ? `，重疊 ${p.overlap} 字` : ''}）<br>${p.overlap ? `<span class="calc-hint">${htmlEsc(p.content.slice(0, p.overlap))}</span>` : ''}${htmlEsc(p.content.slice(p.overlap, p.overlap + 160))}${p.content.length > p.overlap + 160 ? '…' : ''}</div>`
        )
        .join('') || '<span class="calc-hint">還沒有內容</span>';
  }
}

function toggleChunkPreview() {
  const el = $('kb-chunk-preview');
  el.style.display = el.style.display === 'none' ? '' : 'none';
  renderChunkInfo();
}

// ---- 🤖 讓 AI 來切：AI 讀過整份文件，只回傳每段從第幾句開始與小標（不改寫內容）；費用記在選的那組 API Key ----
const AI_SPLIT_MODELS = [
  { id: 'gemini-3.8-flash', label: '⭐ Gemini 3.8 Flash（首推）', desc: '速度與效能平衡的主力模型。切段只需要讀懂每一段在講什麼，Flash 就夠準，而且最快、最省費用。<b>一般文件建議用它。</b>' },
  { id: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro', desc: '適合專業文件、條列和表格很多的說明書；準確度比 Flash 高，費用介於 Flash 與旗艦之間。' },
  { id: 'gemini-3-pro', label: 'Gemini 3 Pro', desc: '上一代 Pro，能力接近 3.1 Pro；3.1 Pro 不能用時的替代選擇。' },
  { id: 'custom', label: '自訂模型名稱…', desc: '填你的 API 可以用的模型名稱（例如新出的模型）。' },
];
let aiSplit = null; // { key, chunks: [{ text, title }], model }
const aiKey = (text, size) => String(text || '').replace(/\r/g, '').trim() + '|' + Number(size || DOC_CHUNK);
const aiReady = () => !!aiSplit && aiSplit.key === aiKey(val('kb-doc-text'), val('kb-chunk-size'));

/** 段落加上重疊：每段開頭重複上一段結尾 ov 個字 */
function withOverlap(chunks, ov) {
  const all = chunks.map((c) => c.text).join('');
  let pos = 0;
  return chunks.map((c, i) => {
    const prev = i ? all.slice(Math.max(0, pos - ov), pos) : '';
    pos += c.text.length;
    return { content: prev + c.text, overlap: prev.length, title: c.title || '' };
  });
}

/** 可以用的 AI：預設 = 整個系統那組；清單裡有金鑰的每一組；系統共用 Gemini */
function fillAiProfiles() {
  const P = (botData && botData.aiProviders) || {};
  const opts = ['<option value="" data-provider="">預設（整個系統那組）</option>'];
  ((botData && botData.ai) || []).forEach((m, i) => {
    if (m.hasKey) opts.push(`<option value="${i}" data-provider="${htmlEsc(m.provider)}" data-model="${htmlEsc(m.model || '')}">${htmlEsc(m.name || '未命名')}（${htmlEsc((P[m.provider] || {}).name || m.provider)}${m.model ? ' ' + htmlEsc(m.model) : ''}）</option>`);
  });
  if (botData && botData.aiSystem) opts.push('<option value="sys" data-provider="gemini">系統共用 Gemini</option>');
  $('kb-ai-profile').innerHTML = opts.join('');
  renderAiModels();
}

/** 模型：Gemini 可以選（預設首推 Flash）；其他服務用那組設定的模型；預設那組不確定是誰，就用那組設定的模型 */
function renderAiModels() {
  const o = $('kb-ai-profile').selectedOptions[0];
  const gemini = o && o.dataset.provider === 'gemini';
  $('kb-ai-model').innerHTML = gemini ? AI_SPLIT_MODELS.map((m) => `<option value="${m.id}">${htmlEsc(m.label)}</option>`).join('') : `<option value="">使用這一組設定的模型${o && o.dataset.model ? '（' + htmlEsc(o.dataset.model) + '）' : ''}</option>`;
  $('kb-ai-model').value = gemini ? AI_SPLIT_MODELS[0].id : '';
}

const aiModelId = () => ($('kb-ai-model').value === 'custom' ? val('kb-ai-model-custom').trim() : $('kb-ai-model').value);

/** 預估 token：中文大約 1 個字 ≈ 1 token；讀入 = 整份文件＋句子編號與說明，回覆只有段落編號和小標 */
function aiCost() {
  const len = val('kb-doc-text').trim().length;
  const size = Number(val('kb-chunk-size')) || DOC_CHUNK;
  const units = Math.ceil(len / Math.max(30, size / 4));
  const input = Math.round(len * 1.1 + units * 4 + 400);
  const output = Math.ceil(len / size) * 25 + 30;
  return { input, output, total: input + output };
}

function renderAiBox() {
  const on = $('kb-ai-split').checked;
  $('kb-ai-box').style.display = on ? '' : 'none';
  if (!on) return;
  $('kb-ai-model-custom').style.display = $('kb-ai-model').value === 'custom' ? '' : 'none';
  const m = AI_SPLIT_MODELS.find((x) => x.id === $('kb-ai-model').value);
  $('kb-ai-model-info').innerHTML = m ? m.desc : '會用這一組 AI 原本設定的模型。';
  const c = aiCost();
  const who = ($('kb-ai-profile').selectedOptions[0] || {}).textContent || '選的那組';
  $('kb-ai-cost').innerHTML = val('kb-doc-text').trim()
    ? `💰 <b>會消耗 token</b>：這份文件預估約 <b>${c.total.toLocaleString()}</b> tokens（讀入約 ${c.input.toLocaleString()}、回覆約 ${c.output.toLocaleString()}），費用依模型計價，記在「${htmlEsc(who)}」的 API Key。AI 只回傳「從第幾句切開」和小標，不會改寫你的內容；內容沒改就不會重切。`
    : '💰 會消耗 token：大約等於文件字數（中文 1 個字約 1 token），費用記在選的那組 API Key。';
}

async function runAiSplit() {
  const text = val('kb-doc-text').replace(/\r/g, '').trim();
  if (!text) return alert('請先貼上或上傳文件內容');
  if ($('kb-ai-model').value === 'custom' && !aiModelId()) return alert('請輸入模型名稱');
  const size = Number(val('kb-chunk-size')) || DOC_CHUNK;
  $('kb-ai-run').disabled = true;
  $('kb-ai-msg').textContent = '🤖 AI 讀文件中…（長文件可能要一分鐘）';
  try {
    const r = await callApi('botKbAiSplit', { text, target: size, profile: val('kb-ai-profile'), model: aiModelId() });
    if (!r.success) throw new Error(r.message || 'AI 切段失敗');
    if (r.chunks.map((c) => c.text).join('') !== text) throw new Error('AI 切出來的段落接不回原文，請再試一次');
    aiSplit = { key: aiKey(text, size), chunks: r.chunks, model: r.model };
    $('kb-ai-msg').textContent = `✅ ${r.name ? r.name + '・' : ''}${r.model} 切成 ${r.chunks.length} 段`;
    $('kb-chunk-preview').style.display = '';
    renderChunkInfo();
    return true;
  } catch (e) {
    $('kb-ai-msg').textContent = '';
    alert(e.message || String(e));
    return false;
  } finally {
    $('kb-ai-run').disabled = false;
  }
}

async function saveKb() {
  const item = kbEditing;
  syncKbImageCaptions();
  const common = { images: kbImages.map((x) => ({ id: x.id, caption: x.caption })), tags: val('kb-tags').trim(), bigCategory: val('kb-cat').trim(), topic: val('kb-topic').trim(), notes: val('kb-notes').trim(), isActive: $('kb-active').checked, audience: ['staff', 'cs'].filter((x) => $('kb-vis-' + x).checked) };
  if (!common.audience.length && !confirm('小助手和對外客服都沒有勾，這筆資料不會被任何機器人用到。確定嗎？')) return;
  if (item.type === 'qa') {
    const q = val('kb-question').trim();
    const a = val('kb-answer').trim();
    if (!q || !a) return alert('請輸入問題與回答');
    const body = Object.assign({ type: 'qa', question: q, content: a }, common);
    if (item.row) Object.assign(body, { rowIndex: item.row.RowIndex, id: item.row.ID, title: item.row.Title, source: item.row.Source });
    const r = await callApi('botKbSave', body);
    if (!r.success) return alert(r.message);
    if (r.embedError) alert('已儲存，但向量計算失敗：' + r.embedError + '\n之後可以按「補算還沒有向量的」重試。');
  } else {
    const title = val('kb-doc-title').trim();
    const o = chunkOpts();
    if (!(o.size >= 100 && o.size <= 3000)) return alert('每段字數請輸入 100 ~ 3000');
    if (!(o.ov >= 0 && o.ov <= o.size / 2)) return alert('重疊字數請輸入 0 ~ 每段字數的一半');
    if (!title || !val('kb-doc-text').trim()) return alert('請輸入文件名稱與內容');
    if ($('kb-ai-split').checked && !aiReady()) {
      if (!confirm(`要讓 AI 切段，預估約 ${aiCost().total.toLocaleString()} tokens（記在選的那組 API Key）。確定嗎？\n（不想花 token 可以按取消，再取消勾選「讓 AI 來切」）`)) return;
      if (!(await runAiSplit())) return;
    }
    const chunks = $('kb-ai-split').checked ? withOverlap(aiSplit.chunks, o.ov) : splitDoc(val('kb-doc-text'), o.size, o.ov);
    if (!chunks.length) return alert('沒有可儲存的內容');
    const r = await callApi('botKbDocSave', Object.assign({ key: item.key || '', title, chunks, chunkSize: o.size }, common));
    if (!r.success) return alert(r.message);
    if (r.embedError) alert('已儲存，但向量計算失敗：' + r.embedError + '\n之後可以按「補算還沒有向量的」重試。');
  }
  closeModal('kb-modal');
  await loadKb();
  if (kbEmbed && kbPending) embedAll(false);
}

// ------------------------------------------------------------
// 知識庫圖片（架構圖、示意圖）：先在瀏覽器縮小，再上傳到公司的 Google 雲端硬碟
// ------------------------------------------------------------
let kbImages = [];
const KB_IMG_MAX = 6;
const kbImgUrl = (x) => (x.preview ? x.preview : `https://lh3.googleusercontent.com/d/${encodeURIComponent(x.id)}=w240`);

function syncKbImageCaptions() {
  document.querySelectorAll('#kb-images .kb-img').forEach((el, i) => {
    if (kbImages[i]) kbImages[i].caption = el.querySelector('input').value.trim().slice(0, 60);
  });
}

function renderKbImages() {
  $('kb-images').innerHTML = kbImages
    .map(
      (x, i) => `<div class="kb-img"><img src="${htmlEsc(kbImgUrl(x))}" alt="" loading="lazy" onerror="this.style.opacity=.3" />
      <input maxlength="60" placeholder="這張圖是什麼？（必填，例如：系統架構圖）" value="${htmlEsc(x.caption || '')}" />
      <button type="button" class="btn-secondary bot-write" title="移除這張圖片（雲端硬碟裡的檔案不會刪）" onclick="removeKbImage(${i})">✕</button></div>`
    )
    .join('');
  $('kb-img-btn').disabled = readOnly() || kbImages.length >= KB_IMG_MAX;
}

function removeKbImage(i) {
  syncKbImageCaptions();
  kbImages.splice(i, 1);
  renderKbImages();
}

/** 圖片縮到長邊 1600 以內（JPEG 0.88）；小檔案（1.5MB 內的 JPG / PNG / WebP）直接上傳原檔 */
function prepareImage(file) {
  return new Promise((resolve, reject) => {
    const asIs = file.size <= 1.5 * 1024 * 1024 && /^image\/(jpeg|png|webp|gif)$/.test(file.type);
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('讀不到這個檔案'));
    reader.onload = () => {
      const url = reader.result;
      if (asIs) return resolve({ mimeType: file.type, base64: String(url).split(',')[1], preview: url });
      if (file.type === 'image/gif') return reject(new Error('GIF 超過 1.5MB，請先縮小'));
      const img = new Image();
      img.onerror = () => reject(new Error('這不是圖片檔'));
      img.onload = () => {
        const k = Math.min(1, 1600 / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * k));
        c.height = Math.max(1, Math.round(img.height * k));
        const g = c.getContext('2d');
        g.fillStyle = '#fff';
        g.fillRect(0, 0, c.width, c.height);
        g.drawImage(img, 0, 0, c.width, c.height);
        const out = c.toDataURL('image/jpeg', 0.88);
        resolve({ mimeType: 'image/jpeg', base64: out.split(',')[1], preview: out });
      };
      img.src = url;
    };
    reader.readAsDataURL(file);
  });
}

async function onKbImages() {
  const files = [...$('kb-img-file').files];
  $('kb-img-file').value = '';
  if (!files.length) return;
  syncKbImageCaptions();
  const room = KB_IMG_MAX - kbImages.length;
  if (files.length > room) alert(`每個項目最多 ${KB_IMG_MAX} 張圖片，只會上傳前 ${Math.max(0, room)} 張。`);
  let n = 0;
  for (const f of files.slice(0, Math.max(0, room))) {
    $('kb-img-info').textContent = `上傳中…（${n + 1}/${Math.min(files.length, room)}）`;
    try {
      const img = await prepareImage(f);
      const r = await callApi('botKbImageUpload', { mimeType: img.mimeType, base64: img.base64, filename: f.name });
      if (!r.success) throw new Error(r.message);
      kbImages.push({ id: r.id, caption: f.name.replace(/\.[^.]+$/, '').slice(0, 60), preview: img.preview });
      n++;
      renderKbImages();
    } catch (e) {
      alert(`「${f.name}」上傳失敗：${e.message}`);
    }
  }
  $('kb-img-info').textContent = n ? `✓ 已上傳 ${n} 張，請填圖片說明後按儲存` : '';
}

// ------------------------------------------------------------
// 聯繫名單
// ------------------------------------------------------------
let leadsCache = [];
async function loadLeads() {
  const r = await callApi('botLeads', {}, { silent: true });
  if (!r.success) {
    $('leads-list').innerHTML = `<div class="calc-hint" style="color:#c0392b;">${htmlEsc(r.message || '讀取失敗')}</div>`;
    return;
  }
  leadsCache = r.leads;
  $('leads-count').textContent = r.total ? `共 ${r.total} 筆` : '';
  $('leads-list').innerHTML = r.leads.length
    ? `<div class="bot-table-wrap"><table class="bot-table"><thead><tr><th>時間</th><th>姓名</th><th>公司</th><th>電話</th><th>Email</th><th>需求 / 備註</th><th>來源</th><th></th></tr></thead><tbody>${r.leads
        .map(
          (l) => `<tr><td>${htmlEsc(String(l.time).slice(5, 16))}</td><td>${htmlEsc(l.name)}</td><td>${htmlEsc(l.company)}</td><td>${l.phone ? `<a href="tel:${htmlEsc(l.phone)}">${htmlEsc(l.phone)}</a>` : ''}</td><td>${l.email ? `<a href="mailto:${htmlEsc(l.email)}">${htmlEsc(l.email)}</a>` : ''}</td><td>${htmlEsc(l.note)}</td><td>${l.channel === 'web' ? '網站' : 'LINE'}${l.source === 'ai' ? '（聊天中留下）' : ''}</td><td><button type="button" class="btn-secondary bot-write" onclick="deleteLead(${l.id})">🗑</button></td></tr>`
        )
        .join('')}</tbody></table></div>`
    : '<div class="calc-hint" style="padding:8px 0;">還沒有人留下聯繫資料。</div>';
  applyReadOnly();
}

async function deleteLead(id) {
  if (!confirm('刪除這筆聯繫資料？')) return;
  const r = await callApi('botLeadDelete', { ids: [id] });
  if (!r.success) return alert(r.message);
  loadLeads();
}

function exportLeads() {
  if (!leadsCache.length) return alert('目前沒有資料可以匯出');
  const q = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const rows = [['時間', '姓名', '公司', '電話', 'Email', '需求 / 備註', '來源']].concat(leadsCache.map((l) => [l.time, l.name, l.company, l.phone, l.email, l.note, (l.channel === 'web' ? '網站' : 'LINE') + (l.source === 'ai' ? '（聊天中留下）' : '')]));
  // 電話開頭的 0 在 Excel 會被吃掉：加上 = "…" 讓它當文字
  const csv = '\ufeff' + rows.map((r, i) => r.map((v, c) => (i && c === 3 && v ? `="${String(v).replace(/"/g, '')}"` : q(v))).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `聯繫名單_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function deleteKb() {
  const item = kbEditing;
  const rows = item.rows || (item.row ? [item.row] : []);
  if (!rows.length || !confirm(`刪除這筆${item.type === 'doc' ? '文件（' + rows.length + ' 段）' : '常見問題'}？`)) return;
  const r = await callApi('botKbDelete', { ids: rows.map((x) => x.ID) });
  if (!r.success) return alert(r.message);
  closeModal('kb-modal');
  loadKb();
}

/** 上傳文件：文字檔直接讀；PDF 用 pdf.js 取出文字（掃描的圖片 PDF 讀不到字） */
async function onKbFile() {
  const f = $('kb-file').files[0];
  if (!f) return;
  $('kb-file-info').textContent = '讀取中…';
  try {
    let text;
    if (/\.pdf$/i.test(f.name)) text = await readPdfText(f);
    else {
      text = await f.text();
      if (/\.html?$/i.test(f.name)) {
        const d = new DOMParser().parseFromString(text, 'text/html');
        d.querySelectorAll('script,style,noscript').forEach((e) => e.remove());
        text = (d.body ? d.body.innerText || d.body.textContent : text).replace(/\n{3,}/g, '\n\n');
      } else if (/\.json$/i.test(f.name)) {
        try {
          text = JSON.stringify(JSON.parse(text), null, 2);
        } catch (e) {}
      }
    }
    text = String(text).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!text) {
      $('kb-file-info').textContent = '⚠️ 這個檔案讀不到文字（可能是掃描的圖片，需要先轉成文字）';
      return;
    }
    setVal('kb-doc-text', (val('kb-doc-text').trim() ? val('kb-doc-text').trim() + '\n\n' : '') + text);
    if (!val('kb-doc-title').trim()) setVal('kb-doc-title', f.name.replace(/\.[^.]+$/, ''));
    $('kb-file-info').textContent = `✅ ${f.name}：${text.length.toLocaleString()} 字`;
    renderChunkInfo();
  } catch (e) {
    $('kb-file-info').textContent = '⚠️ 讀取失敗：' + (e.message || e);
  }
}

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('載入失敗：' + src));
    document.head.appendChild(s);
  });
}

async function readPdfText(file) {
  await loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const content = await (await pdf.getPage(i)).getTextContent();
    pages.push(content.items.map((it) => it.str).join(' ').replace(/[ \t]+/g, ' ').trim());
  }
  return pages.filter(Boolean).join('\n\n');
}

// ------------------------------------------------------------
// 對話與小編接手
// ------------------------------------------------------------
let talkCache = null;

async function loadTalk(silent) {
  const r = await callApi('botConversations', {}, { silent: true });
  if (!r.success) {
    $('talk-list').innerHTML = `<div class="calc-hint" style="color:#c0392b;">${htmlEsc(r.message || '讀取失敗')}</div>`;
    return;
  }
  talkCache = r;
  const list = r.conversations;
  $('talk-pauses').textContent = r.pauses.length ? `🛎️ 小編接手中：${r.pauses.map((p) => p.name || '客人').join('、')}` : '目前沒有客人在等專人回覆';
  $('talk-total').textContent = `共 ${r.total} 筆對話紀錄（上限 ${r.max}，超過會自動刪掉最舊的；上限可到「🔌 連線與設定」調整）`;
  $('talk-list').innerHTML = list.length
    ? list
        .map(
          (c) => `<div class="bot-conv ${c.lead ? 'lead' : ''} ${selectedConv === c.id ? 'sel' : ''}" onclick="openThread('${htmlEsc(c.id)}')">
        <div class="bot-conv-top"><span><b>${htmlEsc(convLabel(c))}</b> <span class="bot-badge">${c.channel === 'web' ? '網站' : 'LINE'}</span>${c.lead ? ' <span class="bot-badge ok">📇 已留資料</span>' : ''}${c.paused ? ' <span class="bot-badge warn">待專人</span>' : ''}${c.closed ? ' <span class="bot-badge closed" title="客人已關閉聊天室，目前沒有進行中的對話">🔒 已關閉</span>' : ''}${c.sessions > 1 ? ` <span class="bot-badge" title="這位客人之前還有 ${c.sessions - 1} 段已結束的對話">📜 ${c.sessions} 段</span>` : ''}</span>${isAdminUser() ? `<button type="button" class="bot-conv-del" title="刪除這位客人的對話紀錄" onclick="event.stopPropagation();deleteConversation('${htmlEsc(c.id)}')">🗑</button>` : ''}</div>
        <div class="calc-hint">${htmlEsc(String(c.lastAt).slice(5, 16))}・${c.count} 則${c.topic ? '・' + htmlEsc(c.topic) : ''}</div>
        <div class="calc-hint bot-snip">${c.lastRole === 'user' ? '客人：' : c.lastRole === 'human' ? '專人：' : '機器人：'}${htmlEsc(c.lastText)}</div>
      </div>`
        )
        .join('')
    : '<div class="calc-hint" style="padding:8px 0;">還沒有對話紀錄。</div>';
  if (selectedConv && !silent) return;
  if (selectedConv) openThread(selectedConv, true);
}

/** 客人在列表上顯示的名字：留過聯繫資料的用他填的姓名（公司），沒有就用機器人記到的名字 / 網站訪客。 */
function leadLabel(lead) {
  if (!lead) return '';
  const who = lead.name || lead.company || lead.phone || lead.email || '';
  return lead.name && lead.company ? `${lead.name}（${lead.company}）` : who;
}

function convLabel(c) {
  return leadLabel(c.lead) || c.name || (c.channel === 'web' ? '網站訪客' : 'LINE 客人');
}

/** 刪除某位客人的對話紀錄（連同短期記憶、小編接手狀態、「客人找真人」通知）；聯繫名單裡留下的資料不會刪。 */
async function deleteConversation(id) {
  if (!id) return;
  const info = (talkCache && talkCache.conversations.find((c) => c.id === id)) || {};
  const NL = String.fromCharCode(10);
  if (!confirm('刪除「' + (info.id ? convLabel(info) : '這位客人') + '」的 ' + (info.count || '') + ' 則對話紀錄？' + NL + '（只刪對話；他在「🧾 聯繫名單」留下的資料不會刪。刪了無法復原）')) return;
  const r = await callApi('botClear', { options: { messages: true, history: true, pauses: true, memos: true, target: id } });
  if (!r.success) return alert(r.message);
  if (selectedConv === id) {
    selectedConv = null;
    $('thread-title').textContent = '選一位客人查看對話';
    $('thread-box').innerHTML = '';
    $('thread-lead').style.display = 'none';
    $('thread-resume').style.display = 'none';
    $('thread-delete').style.display = 'none';
  }
  await loadTalk(true);
}

async function openThread(id, keepScroll) {
  selectedConv = id;
  document.querySelectorAll('.bot-conv').forEach((el) => el.classList.toggle('sel', el.getAttribute('onclick') === `openThread('${id}')`));
  const r = await callApi('botThread', { userId: id }, { silent: true });
  if (!r.success) return alert(r.message);
  const info = (talkCache && talkCache.conversations.find((c) => c.id === id)) || {};
  const lead = r.lead || info.lead || null;
  $('thread-title').textContent = (leadLabel(lead) || info.name || (id.charAt(0) === 'V' ? '網站訪客' : 'LINE 客人')) + (r.paused ? '（小編接手中）' : '');
  const card = $('thread-lead');
  card.style.display = lead ? '' : 'none';
  if (lead) {
    card.innerHTML = '📇 客人留下的聯繫資料：' + [lead.name && '姓名 ' + htmlEsc(lead.name), lead.company && '公司 ' + htmlEsc(lead.company), lead.phone && `電話 <a href="tel:${htmlEsc(lead.phone)}">${htmlEsc(lead.phone)}</a>`, lead.email && `Email <a href="mailto:${htmlEsc(lead.email)}">${htmlEsc(lead.email)}</a>`].filter(Boolean).join('　');
  }
  $('thread-delete').style.display = isAdminUser() ? '' : 'none';
  const box = $('thread-box');
  const bottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  // 客人關閉聊天室 / 重新開始 = 一段對話結束：最後一個標記之前的都是「之前的對話」，用灰色區分；之後（進行中）的維持原本顏色
  const lastReset = r.messages.map((m) => m.role).lastIndexOf('reset');
  let seg = 1;
  const segs = r.messages.filter((m) => m.role === 'reset').length + 1;
  const stateText = lastReset === r.messages.length - 1 && lastReset >= 0 ? (/關閉聊天室/.test(r.messages[lastReset].text) ? '目前：客人已關閉聊天室' : '目前：客人剛重新開始') : '目前：對話進行中';
  const banner = segs > 1 ? `<div class="bot-note bot-sessions">📜 這位客人共 ${segs} 段對話（${htmlEsc(stateText)}）；<span class="bot-old-key">灰底</span> = 之前已結束的對話</div>` : '';
  box.innerHTML = banner + r.messages
    .map((m, i) => {
      if (m.role === 'reset') {
        const closed = /關閉聊天室/.test(m.text);
        const html = `<div class="bot-note bot-divider ${closed ? 'closed' : ''}">${closed ? '🔒 客人關閉聊天室' : '🔄 客人重新開始對話'}・${htmlEsc(m.time.slice(5, 16))}（第 ${seg} 段結束）</div>`;
        seg++;
        return html;
      }
      return `<div class="bot-msg ${m.role} ${i < lastReset ? 'old' : ''}"><div class="bot-who">${m.role === 'user' ? '客人' : m.role === 'human' ? '專人' : '機器人'}・${htmlEsc(m.time.slice(5, 16))}${m.topic ? '・' + htmlEsc(m.topic) : ''}</div><div class="bot-bub">${htmlEsc(String(m.text).replace(/\[\[img:([^|\]]*)\|?([^\]]*)\]\]/g, (_, u, c) => '🖼️ 附圖：' + (c || '圖片')))}</div></div>`;
    })
    .join('');
  if (!keepScroll || bottom) box.scrollTop = box.scrollHeight;
  $('thread-resume').style.display = r.paused ? '' : 'none';
  $('thread-reply').style.display = id.charAt(0) === 'V' ? '' : 'none';
  $('thread-line-hint').style.display = id.charAt(0) === 'U' ? '' : 'none';
  applyReadOnly();
}

async function resumeSelected() {
  if (!selectedConv) return;
  const r = await callApi('botResume', { userId: selectedConv });
  if (!r.success) return alert(r.message);
  await loadTalk(true);
  openThread(selectedConv);
}

async function sendHumanReply() {
  const text = val('thread-text').trim();
  if (!selectedConv || !text) return;
  const r = await callApi('botHumanReply', { userId: selectedConv, text });
  if (!r.success) return alert(r.message);
  setVal('thread-text', '');
  await loadTalk(true);
  openThread(selectedConv);
}

// ------------------------------------------------------------
// 測試聊天（走 linebot 的 /api/test，用管理系統簽的權杖）
// ------------------------------------------------------------
let testToken = null;

async function getTestToken() {
  if (testToken && Date.now() - Number(testToken.ts) < 4 * 60000) return testToken;
  const r = await callApi('botTestToken', {}, { silent: true });
  if (!r.success) throw new Error(r.message);
  testToken = r;
  return r;
}

function addTestMsg(role, text) {
  const box = $('test-box');
  box.insertAdjacentHTML('beforeend', `<div class="bot-msg ${role}"><div class="bot-bub">${htmlEsc(text)}</div></div>`);
  box.scrollTop = box.scrollHeight;
}

async function testCall(body) {
  const t = await getTestToken();
  const res = await fetch(t.url + '/api/test', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(Object.assign({ ts: t.ts, sig: t.sig, testId: t.testId }, body)) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || '機器人伺服器回應錯誤（' + res.status + '）');
  return j;
}

// ------------------------------------------------------------
// 搜尋流程、向量與搜尋測試
// ------------------------------------------------------------
function renderVecStatus() {
  if (!botData) return;
  const total = kbItems ? kbItems.length : 0;
  $('vec-status').innerHTML = kbEmbed
    ? `向量模型：<b>${htmlEsc(kbEmbed.provider)} / ${htmlEsc(kbEmbed.model)}</b>（${kbEmbed.dim} 維）。已有向量 ${total - kbPending} / ${total} 筆${kbPending ? `，<span style="color:#c0392b;">還有 ${kbPending} 筆沒有向量</span>` : ' ✓'}。`
    : '<span style="color:#c0392b;">⚠️ 還沒有可用的 embedding 模型</span>：到「🧠 AI 模型」新增 Gemini 或 OpenAI 相容的 API Key 後，這裡才能計算向量；目前機器人用關鍵字檢索。';
}

function fillSearch() {
  const s = (botData && botData.search) || { mode: 'vector', threshold: 0.6, topK: 6, embedProvider: 'auto' };
  setVal('sr-mode', s.mode);
  setVal('sr-threshold', s.threshold);
  $('sr-th-val').textContent = Number(s.threshold).toFixed(2);
  setVal('sr-topk', s.topK);
  setVal('sr-provider', s.embedProvider || 'auto');
}

async function saveSearch() {
  if (readOnly()) return;
  const r = await callApi('botSaveSettings', { search: { mode: val('sr-mode'), threshold: Number(val('sr-threshold')), topK: Number(val('sr-topk')), embedProvider: val('sr-provider') } });
  $('sr-msg').textContent = r.success ? '✓ 已儲存（最多 5 分鐘後生效）' : '失敗：' + (r.message || '');
  if (r.success) {
    await loadAll(true);
    await loadKb();
  }
}

/** 計算向量：一次 40 筆，一直呼叫到完成。force = 全部重算。 */
async function embedAll(force) {
  if (readOnly()) return;
  if (force && !confirm('全部重新計算向量？知識庫很大時需要一點時間，過程中機器人仍會照常運作。')) return;
  let offset = 0;
  let done = false;
  let count = 0;
  while (!done) {
    $('vec-msg').textContent = count ? `計算中…已完成 ${count} 筆` : '計算中…';
    const r = await callApi('botKbEmbed', { force: !!force, offset }, { silent: true });
    if (!r.success) {
      $('vec-msg').innerHTML = `<span style="color:#c0392b;">${htmlEsc(r.message || '失敗')}</span>`;
      return;
    }
    count += r.embedded;
    offset = r.next;
    done = r.done;
  }
  $('vec-msg').textContent = `✓ 完成（本次計算 ${count} 筆）`;
  await loadKb();
}

async function searchCall(body) {
  const t = await getTestToken();
  const res = await fetch(t.url + '/api/search', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(Object.assign({ ts: t.ts, sig: t.sig, testId: t.testId }, body)) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || '機器人伺服器回應錯誤（' + res.status + '）');
  return j;
}

async function searchTest() {
  const q = val('sr-q').trim();
  if (!q) return;
  $('sr-result').innerHTML = '<div class="calc-hint">搜尋中…</div>';
  try {
    const j = await searchCall({ q, threshold: Number(val('sr-threshold')), topK: Number(val('sr-topk')) });
    const names = { vector: '直接向量', meta_vector: '先中繼再向量', meta: '只用中繼資料', both: '兩種一致' };
    $('sr-result').innerHTML =
      `<div class="calc-hint" style="margin:6px 0;">知識庫 ${j.chunks} 段（有向量 ${j.withVectors} 段）${j.hasEmbedding ? '' : '；<span style="color:#c0392b;">沒有 embedding 模型</span>'}；測試用閥值 ${j.threshold}。目前設定的流程：<b>${htmlEsc(names[j.current])}</b></div>` +
      Object.keys(j.modes)
        .map((m) => {
          const x = j.modes[m];
          const rows = x.hits.length
            ? x.hits.map((h) => `<tr><td class="nowrap">${h.score}</td><td>${htmlEsc(h.by)}</td><td><b>${htmlEsc(h.title)}</b><div class="calc-hint">${htmlEsc([h.source, h.category, h.topic].filter(Boolean).join(' / '))}</div></td><td>${htmlEsc(h.preview)}</td></tr>`).join('')
            : '<tr><td colspan="4" class="calc-hint">沒有找到（客人會被請去轉真人，或依「不確定時」處理）</td></tr>';
          return `<details class="bot-doc" ${m === j.current ? 'open' : ''}><summary><b>${htmlEsc(names[m])}</b>${m === j.current ? ' ✓目前設定' : ''} <span class="calc-hint">找到 ${x.hits.length} 段${x.used !== m ? '（實際用了：' + htmlEsc(x.used) + '）' : ''}</span></summary>
            <div class="calc-hint">${x.trace.map(htmlEsc).join('<br>')}</div>
            <table class="bot-table"><thead><tr><th>分數</th><th>方式</th><th>段落</th><th>內容</th></tr></thead><tbody>${rows}</tbody></table></details>`;
        })
        .join('');
  } catch (e) {
    $('sr-result').innerHTML = `<span style="color:#c0392b;">${htmlEsc(e.message || e)}</span>`;
  }
}

async function sendTest(textArg) {
  const text = (textArg == null ? val('test-input') : textArg).trim();
  if (!text) return;
  setVal('test-input', '');
  $('test-choices').innerHTML = '';
  $('test-msg').textContent = '';
  addTestMsg('user', text);
  $('test-msg').textContent = '機器人回覆中…';
  try {
    const j = await testCall({ text });
    $('test-msg').textContent = '';
    if (j.reply) addTestMsg('bot', j.reply);
    else addTestMsg('note', '（機器人沒有回覆）');
    if (j.handoff !== null && j.handoff !== undefined) $('test-msg').textContent = '→ 這句會轉給專人' + (j.handoff ? '（' + j.handoff + '）' : '') + '；測試聊天不會真的通知同事。';
    $('test-choices').innerHTML = (j.choices || []).map((c) => `<button type="button" class="btn-mini" onclick="sendTest(decodeURIComponent('${encodeURIComponent(c)}'))">${htmlEsc(c)}</button>`).join('');
  } catch (e) {
    $('test-msg').innerHTML = `<span style="color:#c0392b;">${htmlEsc(e.message || e)}</span>`;
  }
}

async function resetTest() {
  $('test-box').innerHTML = '';
  $('test-choices').innerHTML = '';
  try {
    await testCall({ reset: true });
    $('test-msg').textContent = '已重新開始';
  } catch (e) {
    $('test-msg').innerHTML = `<span style="color:#c0392b;">${htmlEsc(e.message || e)}</span>`;
  }
}

// ------------------------------------------------------------
// AI 模型
// ------------------------------------------------------------
let aiRows = [];
const AI_FEATURE_ORDER = ['all', 'cs', 'copy', 'staff', 'vector', 'check'];
const AI_FEATURE_SHORT = { all: '整個系統', cs: 'LINE 機器人', copy: 'AI 文案', staff: '小助理', vector: '向量', check: '回覆檢查' };
const blankAi = () => ({ provider: 'gemini', model: '', endpoint: '', name: '', uses: [], hasKey: false, keyHint: '', _edit: true });

function fillAi() {
  if (!botData) return;
  aiRows = botData.ai.map((m) => Object.assign({ name: '', uses: [] }, m, { uses: (m.uses || []).slice() }));
  if (!aiRows.length) aiRows.push(Object.assign(blankAi(), { uses: ['all'] }));
  setVal('ai-rounds', botData.aiRounds || 6);
  renderAi();
}

/** 每個功能目前實際用哪一組（跟後端同一套規則：指定給它的 → 整個系統 → 第一組）。 */
function aiResolve(f) {
  const rows = aiRows.filter((m) => m.hasKey || m.apiKey);
  if (!rows.length) return null;
  const order = (feature) => {
    const i = rows.findIndex((m) => feature !== 'all' && m.uses.includes(feature));
    const j = i >= 0 ? i : rows.findIndex((m) => m.uses.includes('all'));
    const k = j >= 0 ? j : 0;
    return [rows[k]].concat(rows.filter((_, x) => x !== k));
  };
  if (f === 'vector') return order('vector').find((m) => m.provider === 'gemini' || m.provider === 'openai') || null;
  return order(f)[0];
}

function aiLabel(m) {
  const P = botData.aiProviders || {};
  return (m.name ? m.name + '（' : '') + ((P[m.provider] || {}).name || m.provider) + ' ' + (m.model || ((P[m.provider] || {}).model || '')) + (m.name ? '）' : '');
}

function renderAi() {
  const P = botData.aiProviders;
  const feats = botData.aiFeatures || {};
  $('ai-rows').innerHTML = aiRows
    .map((m, i) => {
      const def = P[m.provider] || P.gemini;
      const keyText = m.apiKey ? '（新金鑰，儲存後生效）' : m.hasKey ? '金鑰 ' + m.keyHint : '尚未填金鑰';
      return `<div class="bot-ai-card">
        <div class="bot-ai-head">
          <span class="bot-ai-title"><b>${htmlEsc(m.name || '未命名')}</b> <span class="calc-hint">${htmlEsc(def.name)}・${htmlEsc(m.model || def.model)}・${htmlEsc(keyText)}</span></span>
          <span class="nowrap">
            <span class="bot-ai-no">${i + 1}</span>
            <button type="button" class="btn-mini bot-write" onclick="moveAi(${i}, -1)" title="往前（備援順序）">↑</button>
            <button type="button" class="btn-mini bot-write" onclick="moveAi(${i}, 1)" title="往後">↓</button>
            <button type="button" class="btn-mini" ${m.hasKey && !m.apiKey ? '' : 'disabled'} onclick="testAi(${i})" title="用已儲存的金鑰發一句話測試">測試</button>
            <button type="button" class="btn-mini bot-write" onclick="toggleAiEdit(${i})" title="編輯名稱 / 模型 / 金鑰">✏️</button>
            <button type="button" class="btn-mini bot-write" onclick="removeAi(${i})" title="刪除">🗑</button>
          </span>
        </div>
        <div class="bot-ai-uses">${AI_FEATURE_ORDER.map((f) => `<label class="bot-check"><input type="checkbox" class="bot-write" ${m.uses.includes(f) ? 'checked' : ''} onchange="aiUse(${i}, '${f}', this.checked)" /> ${htmlEsc(f === 'all' ? '用在整個系統' : feats[f] ? AI_FEATURE_SHORT[f] : f)}</label>`).join('')}</div>
        <div class="bot-ai-edit" style="${m._edit ? '' : 'display:none;'}">
          <div class="bot-grid">
            <div><label>名稱（自己看的，例如：預設、爬蟲）</label><input maxlength="30" value="${htmlEsc(m.name)}" oninput="aiField(${i}, 'name', this.value)" /></div>
            <div><label>服務</label><select onchange="aiField(${i}, 'provider', this.value)">${Object.keys(P).map((k) => `<option value="${k}" ${k === m.provider ? 'selected' : ''}>${htmlEsc(P[k].name)}</option>`).join('')}</select></div>
            <div><label>模型</label><input placeholder="預設 ${htmlEsc(def.model)}" value="${htmlEsc(m.model)}" oninput="aiField(${i}, 'model', this.value)" /></div>
            <div><label>API Key</label><input type="password" autocomplete="new-password" placeholder="${m.hasKey ? htmlEsc(m.keyHint) + '（留空沿用）' : 'API Key'}" oninput="aiField(${i}, 'apiKey', this.value)" /></div>
          </div>
          <label>Endpoint（選填，預設 ${htmlEsc(def.endpoint)}）</label>
          <input value="${htmlEsc(m.endpoint)}" oninput="aiField(${i}, 'endpoint', this.value)" />
        </div>
        <div class="calc-hint" id="ai-test-${i}"></div>
      </div>`;
    })
    .join('');
  renderAiSummary();
  applyReadOnly();
}

function renderAiSummary() {
  const parts = AI_FEATURE_ORDER.map((f) => {
    const m = aiResolve(f);
    const label = f === 'all' ? '整個系統' : AI_FEATURE_SHORT[f];
    if (f === 'vector') return `${label} → ${m ? htmlEsc(aiLabel(m)) + '（embedding）' : '<span style="color:#c0392b;">沒有可用的（需要 Gemini 或 OpenAI 相容）</span>'}`;
    return `${label} → ${m ? htmlEsc(aiLabel(m)) : '<span style="color:#c0392b;">沒有 AI</span>'}`;
  });
  $('ai-summary').innerHTML = '目前：' + parts.join('　|　');
}

function aiField(i, k, v) {
  aiRows[i][k] = v;
  if (k === 'provider') renderAi();
  else if (k === 'name' || k === 'model') renderAiSummary();
}

/** 每個功能只會用一組：勾在這組，就會從別組移掉。 */
function aiUse(i, f, on) {
  aiRows.forEach((m, x) => {
    m.uses = m.uses.filter((u) => u !== f);
    if (x === i && on) m.uses.push(f);
  });
  renderAi();
}

function toggleAiEdit(i) {
  aiRows[i]._edit = !aiRows[i]._edit;
  renderAi();
}

function addAiRow() {
  if (aiRows.length >= 8) return alert('最多 8 組模型');
  aiRows.push(blankAi());
  renderAi();
}

function removeAi(i) {
  if (!confirm('確定要刪除這組 AI 嗎？（按「儲存 AI 設定」才會生效）')) return;
  aiRows.splice(i, 1);
  if (!aiRows.length) aiRows.push(Object.assign(blankAi(), { uses: ['all'] }));
  renderAi();
}

function moveAi(i, d) {
  const j = i + d;
  if (j < 0 || j >= aiRows.length) return;
  [aiRows[i], aiRows[j]] = [aiRows[j], aiRows[i]];
  renderAi();
}

async function saveAi() {
  if (readOnly()) return;
  const models = aiRows.map((m) => ({ provider: m.provider, model: m.model, endpoint: m.endpoint, name: m.name, uses: m.uses, apiKey: m.apiKey || '' }));
  if (!models.some((m, i) => m.apiKey || aiRows[i].hasKey)) return alert('至少要填一個 API Key');
  const r = await callApi('botSaveAi', { models, maxRounds: Number($('ai-rounds').value) || 6 });
  if (!r.success) return alert(r.message);
  $('ai-msg').textContent = '✓ 已儲存';
  setTimeout(() => ($('ai-msg').textContent = ''), 3000);
  await loadAll(true);
  fillAi();
}

async function testAi(i) {
  const el = $('ai-test-' + i);
  el.textContent = '測試中…';
  const r = await callApi('botTestAi', { index: i }, { silent: true });
  el.innerHTML = r.success ? `<span style="color:#1e8e3e;">✓ 成功（${htmlEsc(r.provider)} ${htmlEsc(r.model)}，${r.ms} ms）</span>` : `<span style="color:#c0392b;">✗ ${htmlEsc(r.message || '失敗')}</span>`;
}

// ------------------------------------------------------------
// 連線與設定
// ------------------------------------------------------------
function fillConn() {
  if (!botData) return;
  const gas = botData.gasUrl || (typeof API_URL !== 'undefined' ? API_URL : '');
  setVal('conn-gas', gas);
  $('conn-gas-hint').textContent = botData.gasUrl ? '' : '（Apps Script 沒回報網址，這裡顯示的是網站 config.js 設定的 API_URL，通常就是同一個）';
  keyShown = {};
  ['cs', 'staff'].forEach((role) => {
    $('conn-key-' + role).type = 'password';
    setVal('conn-key-' + role, botData.keys[role].has ? botData.keys[role].hint : '');
  });
  $('conn-shared').style.display = botData.keys.cs.shared || botData.keys.staff.shared ? '' : 'none';
  const g = botData.general || {};
  setVal('conn-boturl', g.botUrl);
  setVal('gen-brand', g.brand);
  setVal('gen-delay', g.replyDelay);
  setVal('gen-logmax', g.logMax);
  setVal('gen-mem-turns', g.memory.turns);
  setVal('gen-mem-hours', g.memory.hours);
  setVal('gen-mem-chars', g.memory.chars);
  $('clear-panel').style.display = isAdminUser() ? '' : 'none';
  applyReadOnly();
}

async function toggleKey(role) {
  if (!botData.keys[role].has) return;
  if (!keyShown[role]) {
    const r = await callApi('botRevealKey', { role });
    if (!r.success) return alert(r.message);
    setVal('conn-key-' + role, r.key);
    $('conn-key-' + role).type = 'text';
    keyShown[role] = true;
  } else fillConn();
}

async function copyKey(role) {
  if (!botData.keys[role].has) return alert('還沒有產生這把金鑰');
  const r = await callApi('botRevealKey', { role }, { silent: true });
  if (!r.success) return alert(r.message);
  try {
    await navigator.clipboard.writeText(r.key);
    alert('已複製金鑰');
  } catch (e) {
    prompt('請手動複製：', r.key);
  }
}

async function genKey(role) {
  const name = role === 'staff' ? '員工助理' : '客服機器人';
  const env = role === 'staff' ? 'BOT_STAFF_SECRET' : 'BOT_CS_SECRET';
  if (botData.keys[role].has && !confirm(`重新產生後，舊的${name}金鑰立即失效，${name}會暫停服務，直到你到 Vercel 更新 ${env} 並 Redeploy。\n\n確定要重新產生嗎？`)) return;
  const r = await callApi('botGenKey', { role });
  if (!r.success) return alert(r.message);
  await loadAll(true);
  fillConn();
  setVal('conn-key-' + role, r.key);
  $('conn-key-' + role).type = 'text';
  keyShown[role] = true;
  alert(`已產生新的${name}金鑰（上方欄位顯示的就是）。請複製到 Vercel 的 ${env}。`);
}

/** 客服可以問到的產品欄位勾選 */
function renderProductFields(selected) {
  const fields = botData.csProductFields || [];
  $('cs-product-fields').innerHTML = fields
    .map(([key, label]) => `<label class="bot-day"><input type="checkbox" value="${htmlEsc(key)}" ${selected.includes(key) ? 'checked' : ''} /> ${htmlEsc(label)}</label>`)
    .join('');
}

async function previewCs() {
  const r = await callApi('botCsPreview', {}, { silent: true });
  if (!r.success) return ($('cs-preview').innerHTML = `<div class="calc-hint" style="color:#c0392b;">${htmlEsc(r.message || '失敗')}</div>`);
  const counts = Object.entries(r.counts).map(([k, v]) => `${htmlEsc(k)} ${v} 筆`).join('、') || '（目前沒有任何資料，機器人只會請客人找真人）';
  $('cs-preview').innerHTML = `<div class="calc-hint" style="margin-top:6px;">目前（以<b>已儲存</b>的設定為準）客服機器人可用的資料：<b>${counts}</b>，共 ${r.total} 段。</div>` +
    (r.productTotal > r.productShown ? `<div class="calc-hint" style="margin-top:6px;color:#c0392b;">⚠ 產品資料庫共有 ${r.productTotal} 筆符合的產品，但「最多 ${r.productLimit} 筆」限制讓機器人只看得到前 ${r.productShown} 筆（相機、鏡頭排在最前面）。要讓機器人看到全部，請把上面的上限調高（最多 10000）並儲存。</div>` : r.productTotal ? `<div class="calc-hint" style="margin-top:6px;">產品資料庫 ${r.productTotal} 筆符合的產品，機器人全部看得到。</div>` : '') +
    (r.sampleProducts.length ? '<div class="calc-hint" style="margin-top:6px;">產品範例（客人實際問得到的內容）：</div>' + r.sampleProducts.map((t) => `<pre class="bot-pre">${htmlEsc(t)}</pre>`).join('') : '') +
    `<div class="calc-hint" style="margin-top:6px;color:#1e8e3e;">🔒 永遠看不到：${r.blocked.map(htmlEsc).join('、')}</div>`;
}

async function saveGeneral() {
  if (readOnly()) return;
  // 對話紀錄上限改小會立刻刪掉最舊的多餘紀錄：先問清楚
  const wantMax = Number(val('gen-logmax'));
  if (wantMax > 0) {
    const cur = await callApi('botConversations', {}, { silent: true });
    if (cur.success && wantMax < cur.total && !confirm('目前有 ' + cur.total + ' 筆對話紀錄，上限改成 ' + wantMax + ' 筆會立刻刪掉最舊的 ' + (cur.total - wantMax) + ' 筆（無法復原）。確定要儲存嗎？')) return;
  }
  const r = await callApi('botSaveSettings', {
    general: { brand: val('gen-brand'), replyDelay: val('gen-delay'), logMax: val('gen-logmax'), botUrl: val('conn-boturl'), memory: { turns: val('gen-mem-turns'), hours: val('gen-mem-hours'), chars: val('gen-mem-chars') } },
  });
  if (!r.success) return alert(r.message);
  $('gen-msg').textContent = r.trimmed ? '✓ 已儲存，並刪除了最舊的 ' + r.trimmed + ' 筆對話紀錄' : '✓ 已儲存';
  setTimeout(() => ($('gen-msg').textContent = ''), 3000);
  await loadAll(true);
  fillConn();
}

async function clearData(dryRun) {
  const options = { messages: $('clr-messages').checked, history: $('clr-history').checked, pauses: $('clr-pauses').checked, memos: $('clr-memos').checked };
  if (!Object.values(options).some(Boolean)) return alert('請先勾選要清除的項目');
  const r = await callApi('botClear', { dryRun, options });
  if (!r.success) return alert(r.message);
  const c = r.counts;
  const text = `對話紀錄 ${options.messages ? c.messages : 0} 筆、「客人找真人」備忘錄 ${options.memos ? c.memos : 0} 則、小編接手中 ${options.pauses ? c.pauses : 0} 位` + (options.history ? '、全部客人的短期記憶' : '');
  if (dryRun) {
    $('clr-msg').textContent = '將清除：' + text;
    return;
  }
  $('clr-msg').textContent = '已清除：' + text;
  loadAll(true);
}

// ------------------------------------------------------------
// 啟動
// ------------------------------------------------------------
window.addEventListener('DOMContentLoaded', async () => {
  if (!(await ensureAuth())) return;
  renderHeaderUser();
  applyAdminOnlyVisibility();
  document.querySelectorAll('.bot-tab').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $('cs-hours-enabled').addEventListener('change', toggleHoursBox);
  await loadAll();
  gotoHash();
  window.addEventListener('hashchange', gotoHash);
});

/** 網址 #talk、#leads 切到該分頁；#talk:客人編號 = 右下角「客人等待回覆」提醒的「前往回覆」，直接打開那位客人的對話。 */
function gotoHash() {
  const [first, convId] = (location.hash || '').replace('#', '').split(':');
  if (!first || !document.querySelector(`.bot-tab[data-tab="${first}"]`)) return;
  showTab(first);
  if (first === 'talk' && /^[A-Za-z0-9_-]{6,80}$/.test(convId || '')) openThread(convId);
}

window.refreshPageData = async () => {
  await loadAll(true);
  kbLoaded = false;
  if (TAB_LOADERS[curTab]) TAB_LOADERS[curTab]();
};
