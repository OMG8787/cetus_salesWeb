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
const TAB_LOADERS = { kb: () => loadKb(), talk: () => loadTalk(), conn: () => fillConn(), web: () => fillWeb(), ai: () => fillAi() };

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
function renderOverview() {
  const d = botData;
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

function renderKb() {
  if (!kbItems) return;
  const kw = val('kb-keyword').trim().toLowerCase();
  const type = val('kb-type');
  const match = (k) => !kw || [k.Title, k.Question, k.Content, k.Tags, k.Source].join(' ').toLowerCase().includes(kw);
  const faqs = kbItems.filter((k) => k.Type === 'qa' && (!type || type === 'qa') && match(k));
  const docs = {};
  kbItems
    .filter((k) => k.Type === 'doc' && (!type || type === 'doc') && match(k))
    .forEach((k) => {
      const key = k.Source || k.Title || '（未命名文件）';
      (docs[key] = docs[key] || []).push(k);
    });
  $('kb-count').textContent = `（常見問題 ${kbItems.filter((k) => k.Type === 'qa').length}、文件段落 ${kbItems.filter((k) => k.Type === 'doc').length}）`;
  const argOf = (v) => `decodeURIComponent('${encodeURIComponent(v)}')`;
  let html = '';
  if (faqs.length) {
    html += '<table class="bot-table"><thead><tr><th>常見問題</th><th>答案</th><th>分類 / 主題</th><th>向量</th><th>啟用</th><th></th></tr></thead><tbody>';
    faqs.forEach((k) => {
      html += `<tr class="${k.IsActive ? '' : 'off'}"><td><b>${htmlEsc(k.Question || k.Title)}</b></td><td>${htmlEsc(kbSnippet(k.Content, 120))}${k.Notes ? `<div class="calc-hint">📝 ${htmlEsc(kbSnippet(k.Notes, 60))}</div>` : ''}</td><td>${htmlEsc([k.BigCategory, k.Topic].filter(Boolean).join(' / '))}${k.Tags ? `<div class="calc-hint">${htmlEsc(k.Tags)}</div>` : ''}</td><td>${k.HasVector ? '✓' : kbEmbed ? '<span style="color:#c0392b;">—</span>' : ''}</td>
        <td><input type="checkbox" class="bot-write" ${k.IsActive ? 'checked' : ''} ${readOnly() ? 'disabled' : ''} onchange="toggleKbActive(${k.ID}, this.checked)" /></td>
        <td class="nowrap"><button type="button" class="btn-mini bot-write" onclick="openFaqModal(${k.ID})">編輯</button> <button type="button" class="btn-mini" onclick="deleteBotItem(${k.ID})">刪除</button></td></tr>`;
    });
    html += '</tbody></table>';
  }
  Object.keys(docs).forEach((name) => {
    const list = docs[name];
    html += `<details class="bot-doc"><summary>📄 <b>${htmlEsc(name)}</b> <span class="calc-hint">${list.length} 段</span>
      <button type="button" class="btn-mini" onclick="event.preventDefault();deleteBotDoc(${argOf(name)}, ${list.length})">刪除整份文件</button></summary>
      <table class="bot-table"><tbody>${list
        .map(
          (k) => `<tr class="${k.IsActive ? '' : 'off'}"><td style="width:28%;">${htmlEsc(k.Title)}</td><td>${htmlEsc(kbSnippet(k.Content, 160))}</td>
          <td><input type="checkbox" class="bot-write" ${k.IsActive ? 'checked' : ''} ${readOnly() ? 'disabled' : ''} onchange="toggleKbActive(${k.ID}, this.checked)" /></td>
          <td class="nowrap"><button type="button" class="btn-mini bot-write" onclick="openFaqModal(${k.ID})">編輯</button> <button type="button" class="btn-mini" onclick="deleteBotItem(${k.ID})">刪除</button></td></tr>`
        )
        .join('')}</tbody></table></details>`;
  });
  $('kb-list').innerHTML = html || '<div class="calc-hint" style="padding:10px 0;">還沒有資料。按「＋ 常見問題」新增第一筆，例如：問「你們有賣光源嗎？」答「有，環形、條形、同軸光源都有…」。</div>';
}

async function toggleKbActive(id, on) {
  const k = kbItems.find((x) => x.ID === id);
  if (!k) return;
  const r = await callApi('botKbSave', { rowIndex: k.RowIndex, id: k.ID, type: k.Type, title: k.Title, question: k.Question, content: k.Content, tags: k.Tags, source: k.Source, isActive: on });
  if (!r.success) alert(r.message);
  loadKb();
}

function openFaqModal(id) {
  const k = id ? kbItems.find((x) => x.ID === id) : null;
  const isDoc = k && k.Type === 'doc';
  $('faq-modal').dataset.id = k ? k.ID : '';
  $('faq-title').textContent = k ? (isDoc ? '編輯文件段落' : '編輯常見問題') : '新增常見問題';
  $('faq-q-wrap').style.display = isDoc ? 'none' : '';
  $('faq-a-label').textContent = isDoc ? '內容' : '答案';
  setVal('faq-question', k ? k.Question : '');
  setVal('faq-content', k ? k.Content : '');
  setVal('faq-tags', k ? k.Tags : '');
  setVal('faq-cat', k ? k.BigCategory : '');
  setVal('faq-topic', k ? k.Topic : '');
  setVal('faq-notes', k ? k.Notes : '');
  $('faq-active').checked = k ? k.IsActive : true;
  $('faq-modal').style.display = 'flex';
}

function closeModal(id) {
  $(id).style.display = 'none';
}

async function saveFaq() {
  const id = Number($('faq-modal').dataset.id) || 0;
  const k = id ? kbItems.find((x) => x.ID === id) : null;
  const isDoc = k && k.Type === 'doc';
  const body = { type: isDoc ? 'doc' : 'qa', question: val('faq-question').trim(), content: val('faq-content').trim(), tags: val('faq-tags').trim(), bigCategory: val('faq-cat').trim(), topic: val('faq-topic').trim(), notes: val('faq-notes').trim(), isActive: $('faq-active').checked };
  if (!isDoc && !body.question) return alert('請填問題');
  if (!body.content) return alert('請填答案 / 內容');
  if (k) Object.assign(body, { rowIndex: k.RowIndex, id: k.ID, title: k.Title, source: k.Source });
  const r = await callApi('botKbSave', body);
  if (!r.success) return alert(r.message);
  if (r.embedError) alert('已儲存，但向量計算失敗：' + r.embedError + '\n之後可以按「補算還沒有向量的」重試。');
  closeModal('faq-modal');
  loadKb();
}

async function deleteBotItem(id) {
  const k = kbItems.find((x) => x.ID === id);
  if (!k || !confirm('確定要刪除這筆嗎？\n\n' + kbSnippet(k.Question || k.Title, 40))) return;
  const r = await callApi('botKbDelete', { ids: [id] });
  if (!r.success) return alert(r.message);
  loadKb();
}

async function deleteBotDoc(name, n) {
  if (!confirm(`確定要刪除整份文件「${name}」（${n} 段）嗎？`)) return;
  const r = await callApi('botKbDelete', { source: name });
  if (!r.success) return alert(r.message);
  loadKb();
}

// ---- 文件匯入：切段 + 檔案解析 ----
function chunkText(text, size) {
  const paras = String(text || '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const out = [];
  let cur = '';
  paras.forEach((p0) => {
    let p = p0;
    while (p.length > size) {
      if (cur) {
        out.push(cur);
        cur = '';
      }
      out.push(p.slice(0, size));
      p = p.slice(size);
    }
    if ((cur + '\n' + p).length > size && cur) {
      out.push(cur);
      cur = p;
    } else cur = cur ? cur + '\n' + p : p;
  });
  if (cur) out.push(cur);
  return out;
}

function openDocModal() {
  setVal('doc-name', '');
  setVal('doc-text', '');
  setVal('doc-file', '');
  updateDocPreview();
  $('doc-modal').style.display = 'flex';
}

function updateDocPreview() {
  const n = chunkText(val('doc-text'), Number(val('doc-size')) || 500).length;
  $('doc-preview').textContent = n ? `會切成 ${n} 段` : '';
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

async function onDocFile(input) {
  const f = input.files && input.files[0];
  if (!f) return;
  if (!val('doc-name')) setVal('doc-name', f.name.replace(/\.[^.]+$/, ''));
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
    setVal('doc-text', String(text).trim());
    updateDocPreview();
    if (!String(text).trim()) alert('這個檔案讀不到文字內容（掃描的 PDF 是圖片，需要先轉成文字）');
  } catch (e) {
    alert('讀取檔案失敗：' + (e.message || e));
  }
}

async function importDoc() {
  const name = val('doc-name').trim();
  const text = val('doc-text').trim();
  if (!name) return alert('請填文件名稱');
  if (!text) return alert('沒有內容可以匯入');
  const chunks = chunkText(text, Number(val('doc-size')) || 500);
  if (!chunks.length) return alert('沒有內容可以匯入');
  if (chunks.length > 1000) return alert('這份文件太大了（超過 1000 段），請拆成幾份再匯入');
  if (!confirm(`要把「${name}」匯入知識庫嗎？會切成 ${chunks.length} 段。`)) return;
  let done = 0;
  for (let i = 0; i < chunks.length; i += 200) {
    const part = chunks.slice(i, i + 200).map((c, j) => ({ title: `${name}（${i + j + 1}/${chunks.length}）`, content: c, source: name }));
    const r = await callApi('botKbImport', { rows: part, bigCategory: val('doc-cat').trim(), topic: val('doc-topic').trim(), notes: val('doc-notes').trim() });
    if (!r.success) return alert(`匯入到第 ${done} 段時失敗：${r.message}`);
    done += r.count;
  }
  closeModal('doc-modal');
  alert(`已匯入 ${done} 段` + (kbEmbed ? '，接著計算向量…' : ''));
  await loadKb();
  if (kbEmbed) embedAll(false);
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
  $('talk-total').textContent = `共 ${r.total} 筆對話紀錄（上限 ${r.max}，超過會自動刪掉最舊的）`;
  $('talk-list').innerHTML = list.length
    ? list
        .map(
          (c) => `<div class="bot-conv ${selectedConv === c.id ? 'sel' : ''}" onclick="openThread('${htmlEsc(c.id)}')">
        <div><b>${htmlEsc(c.name || (c.channel === 'web' ? '網站訪客' : 'LINE 客人'))}</b> <span class="bot-badge">${c.channel === 'web' ? '網站' : 'LINE'}</span>${c.paused ? ' <span class="bot-badge warn">待專人</span>' : ''}</div>
        <div class="calc-hint">${htmlEsc(String(c.lastAt).slice(5, 16))}・${c.count} 則${c.topic ? '・' + htmlEsc(c.topic) : ''}</div>
        <div class="calc-hint bot-snip">${c.lastRole === 'user' ? '客人：' : c.lastRole === 'human' ? '專人：' : '機器人：'}${htmlEsc(c.lastText)}</div>
      </div>`
        )
        .join('')
    : '<div class="calc-hint" style="padding:8px 0;">還沒有對話紀錄。</div>';
  if (selectedConv && !silent) return;
  if (selectedConv) openThread(selectedConv, true);
}

async function openThread(id, keepScroll) {
  selectedConv = id;
  document.querySelectorAll('.bot-conv').forEach((el) => el.classList.toggle('sel', el.getAttribute('onclick') === `openThread('${id}')`));
  const r = await callApi('botThread', { userId: id }, { silent: true });
  if (!r.success) return alert(r.message);
  const info = (talkCache && talkCache.conversations.find((c) => c.id === id)) || {};
  $('thread-title').textContent = (info.name || (id.charAt(0) === 'V' ? '網站訪客' : 'LINE 客人')) + (r.paused ? '（小編接手中）' : '');
  const box = $('thread-box');
  const bottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  box.innerHTML = r.messages
    .map((m) =>
      m.role === 'reset'
        ? `<div class="bot-note">${htmlEsc(m.text)}・${htmlEsc(m.time.slice(5, 16))}</div>`
        : `<div class="bot-msg ${m.role}"><div class="bot-who">${m.role === 'user' ? '客人' : m.role === 'human' ? '專人' : '機器人'}・${htmlEsc(m.time.slice(5, 16))}${m.topic ? '・' + htmlEsc(m.topic) : ''}</div><div class="bot-bub">${htmlEsc(m.text)}</div></div>`
    )
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
const AI_FEATURE_ORDER = ['all', 'cs', 'copy', 'staff', 'vector'];
const AI_FEATURE_SHORT = { all: '整個系統', cs: 'LINE 機器人', copy: 'AI 文案', staff: '小助理', vector: '向量' };
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
    (r.sampleProducts.length ? '<div class="calc-hint" style="margin-top:6px;">產品範例（客人實際問得到的內容）：</div>' + r.sampleProducts.map((t) => `<pre class="bot-pre">${htmlEsc(t)}</pre>`).join('') : '') +
    `<div class="calc-hint" style="margin-top:6px;color:#1e8e3e;">🔒 永遠看不到：${r.blocked.map(htmlEsc).join('、')}</div>`;
}

async function saveGeneral() {
  if (readOnly()) return;
  const r = await callApi('botSaveSettings', {
    general: { brand: val('gen-brand'), replyDelay: val('gen-delay'), botUrl: val('conn-boturl'), memory: { turns: val('gen-mem-turns'), hours: val('gen-mem-hours'), chars: val('gen-mem-chars') } },
  });
  if (!r.success) return alert(r.message);
  $('gen-msg').textContent = '✓ 已儲存';
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
  const first = (location.hash || '').replace('#', '');
  if (first && document.querySelector(`.bot-tab[data-tab="${first}"]`)) showTab(first);
});

window.refreshPageData = async () => {
  await loadAll(true);
  kbLoaded = false;
  if (TAB_LOADERS[curTab]) TAB_LOADERS[curTab]();
};
