/**
 * assistant.js - 網站右下角的「智能助理」（員工私人助理，後端 BotStaff.gs → linebot /api/web）
 * 每個頁面都載入；沒登入或管理員沒開放時不顯示。權限 = 登入帳號本人的權限；
 * 新增 / 修改只有 AI「提出」，要按「確認寫入」才會真的寫入，助理不能刪除任何資料。
 */
(function () {
  const INFO_KEY = 'aoi_assist_info';
  const LOG_KEY = 'aoi_assist_log';
  let log = [];
  let busy = false;
  let box = null;

  function store(k, v) {
    try {
      if (v === undefined) return JSON.parse(sessionStorage.getItem(k) || 'null');
      if (v === null) sessionStorage.removeItem(k);
      else sessionStorage.setItem(k, JSON.stringify(v));
    } catch (e) {}
    return null;
  }

  async function enabled() {
    const cached = store(INFO_KEY);
    if (cached && Date.now() - cached.at < 10 * 60000) return cached.enabled;
    const r = await callApi('botAssistInfo', {}, { silent: true });
    const on = !!(r && r.success && r.enabled);
    store(INFO_KEY, { at: Date.now(), enabled: on });
    return on;
  }

  function esc(t) {
    return htmlEsc(t).replace(/\n/g, '<br>');
  }

  function render() {
    const list = box.querySelector('.as-log');
    list.innerHTML = log
      .map((m, i) => {
        let html = `<div class="as-msg ${m.role}"><div class="as-bub">${esc(m.text)}</div>`;
        if (m.pending && i === log.length - 1 && !m.done) {
          html += `<div class="as-actions"><button type="button" onclick="assistConfirm(true)">✅ 確認寫入</button><button type="button" class="as-no" onclick="assistConfirm(false)">❌ 取消</button></div>`;
        }
        if (m.choices && m.choices.length && i === log.length - 1) {
          html += `<div class="as-actions">${m.choices.map((c) => `<button type="button" class="as-choice" data-c="${htmlEsc(c)}">${htmlEsc(c)}</button>`).join('')}</div>`;
        }
        return html + '</div>';
      })
      .join('');
    if (busy) list.insertAdjacentHTML('beforeend', '<div class="as-msg bot"><div class="as-bub as-typing">輸入中…</div></div>');
    list.querySelectorAll('.as-choice').forEach((b) => b.addEventListener('click', () => send(b.dataset.c)));
    list.scrollTop = list.scrollHeight;
    store(LOG_KEY, log.slice(-30));
  }

  async function call(body) {
    busy = true;
    render();
    const r = await callApi('botAssist', body, { silent: true });
    busy = false;
    return r;
  }

  async function send(text) {
    text = String(text || '').trim();
    if (!text || busy) return;
    log.push({ role: 'user', text });
    box.querySelector('.as-input').value = '';
    const r = await call({ text });
    if (!r.success) log.push({ role: 'bot', text: '⚠️ ' + (r.message || '助理暫時無法使用') });
    else log.push({ role: 'bot', text: r.reply || '……', choices: r.choices, pending: r.pending });
    render();
  }

  window.assistConfirm = async function (ok) {
    if (busy) return;
    const last = log[log.length - 1];
    if (!last || !last.pending) return;
    last.done = true;
    log.push({ role: 'user', text: ok ? '確認' : '取消' });
    const r = await call({ confirm: ok, token: last.pending.token });
    log.push({ role: 'bot', text: r.success ? r.reply : '⚠️ ' + (r.message || '失敗') });
    render();
    if (ok && r.success && /已寫入/.test(r.reply || '') && typeof window.refreshPageData === 'function') window.refreshPageData();
  };

  async function reset() {
    log = [];
    store(LOG_KEY, null);
    render();
    await callApi('botAssist', { reset: true }, { silent: true });
    log.push({ role: 'bot', text: '好的，我們重新開始 😊 有什麼需要幫忙的？' });
    render();
  }

  function build() {
    box = document.createElement('div');
    box.className = 'as-dock';
    box.innerHTML = `<button type="button" class="as-fab" title="智能助理">🤖</button>
      <div class="as-panel" style="display:none;">
        <div class="as-head"><b>🤖 智能助理</b><span><button type="button" class="as-reset" title="重新開始">↺</button><button type="button" class="as-close">✕</button></span></div>
        <div class="as-log"></div>
        <div class="as-hint">可以問客戶、案件、今天要追蹤誰；要新增 / 修改我會先請你確認。</div>
        <form class="as-form"><input class="as-input" maxlength="1000" placeholder="例如：今天要追蹤哪些客戶？" autocomplete="off" /><button type="submit">送出</button></form>
      </div>`;
    document.body.appendChild(box);
    const panel = box.querySelector('.as-panel');
    box.querySelector('.as-fab').addEventListener('click', () => {
      panel.style.display = panel.style.display === 'none' ? '' : 'none';
      if (panel.style.display !== 'none') {
        if (!log.length) log.push({ role: 'bot', text: '您好，我是你的員工助理 😊 想查客戶、案件、行程，或記錄追蹤，直接說就可以。' });
        render();
        box.querySelector('.as-input').focus();
      }
    });
    box.querySelector('.as-close').addEventListener('click', () => (panel.style.display = 'none'));
    box.querySelector('.as-reset').addEventListener('click', reset);
    box.querySelector('.as-form').addEventListener('submit', (e) => {
      e.preventDefault();
      send(box.querySelector('.as-input').value);
    });
    log = store(LOG_KEY) || [];
  }

  window.addEventListener('load', async () => {
    if (typeof currentToken === 'undefined' || !currentToken) return;
    try {
      if (await enabled()) build();
    } catch (e) {}
  });
})();
