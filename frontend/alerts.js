/**
 * alerts.js - 每頁右下角的「客人待回覆」提醒
 * 客人要找真人、或留下新的聯繫名單時，所有已登入、有「BOT 設定」查看權限的同事，不管停在哪一頁，右下角都會跳出提醒；
 * 一直到有人處理為止：網站訪客 = 小編在「BOT 設定」回覆或按「恢復機器人」就自動消失；LINE 客人（在 LINE 官方帳號後台回覆，系統看不到）= 按「我已處理」。
 * 提醒可以先縮小，但每 60 秒會自動展開再提醒一次（有聲音 / 分頁標題閃爍；允許桌面通知的話，分頁在背景也會跳通知）。
 * 資料來源：後端 botAlerts（有 20 秒快取，新通知出現與有人處理時立刻更新）；多個分頁共用同一次查詢，不會重複打後端。
 */
(function () {
  const POLL_VISIBLE = 30000; // 分頁在前景：30 秒查一次
  const POLL_HIDDEN = 90000; // 分頁在背景：90 秒查一次（仍會閃標題 / 桌面通知）
  const REMIND_MS = 60000; // 縮小後，每隔多久自動展開再提醒
  const SHARED_KEY = 'aoi_alerts_data';
  const MUTE_KEY = 'aoi_alerts_mute';
  const URGENT_MIN = 5; // 等超過幾分鐘顯示紅色

  let alerts = [];
  let canAck = false;
  let skew = 0; // 伺服器時間 - 本機時間
  let collapsed = false;
  let lastRemind = 0;
  let known = {};
  let timer = null;
  let titleTimer = null;
  let baseTitle = '';
  let box = null;
  let audio = null;
  let busy = false;

  const keyOf = (a) => a.type + ':' + a.id;
  const nowMs = () => Date.now() + skew;
  const store = {
    get(k) {
      try {
        return JSON.parse(localStorage.getItem(k) || 'null');
      } catch (e) {
        return null;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, JSON.stringify(v));
      } catch (e) {}
    },
  };
  const isMuted = () => store.get(MUTE_KEY) === true;
  // 換頁後這個分頁還記得：哪些通知已經提醒過（不會每換一頁就響一次）、提醒是不是縮小著
  const SESSION_KEY = 'aoi_alerts_state';
  function saveState() {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ known, collapsed, lastRemind }));
    } catch (e) {}
  }
  function loadState() {
    try {
      const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
      if (s) {
        known = s.known || {};
        collapsed = !!s.collapsed;
        lastRemind = s.lastRemind || 0;
      }
    } catch (e) {}
  }

  function esc(t) {
    return typeof htmlEsc === 'function' ? htmlEsc(t) : String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  function waited(a) {
    const min = Math.max(0, Math.floor((nowMs() - a.at) / 60000));
    return min < 1 ? '剛剛' : min < 60 ? `已等 ${min} 分鐘` : `已等 ${Math.floor(min / 60)} 小時 ${min % 60} 分`;
  }

  /** 通知內文只留客人說的那一句，卡片上看得到重點就好 */
  function snippet(a) {
    if (a.type === 'csLead') return a.content.split('\n').filter((l) => /^(姓名|公司|電話|Email)：/.test(l)).join('　').slice(0, 120);
    const m = a.content.match(/客人說：([^\n]*)/);
    return (m ? m[1] : a.content).slice(0, 120);
  }

  function goUrl(a) {
    if (a.type === 'csLimit') return 'bot.html';
    return a.type === 'csLead' ? 'bot.html#leads' : a.channel === 'web' ? 'bot.html#talk:' + a.id : 'https://manager.line.biz/';
  }

  function goLabel(a) {
    if (a.type === 'csLimit') return '前往 BOT 設定';
    return a.type === 'csLead' ? '看聯繫名單' : a.channel === 'web' ? '前往回覆' : '開啟 LINE 後台';
  }

  function hint(a) {
    if (a.type === 'csLead') return '聯繫完請按「我已處理」';
    if (a.type === 'csLimit') return '調整「防濫用」上限後，按「我已處理」';
    if (a.type === 'csChat') return '機器人正在回覆；要親自回請到後台按「轉真人（接手）」';
    return a.channel === 'web' ? '在「BOT 設定」回覆後會自動消失' : '在 LINE 後台回覆完，請按「我已處理」';
  }

  // ---------------- 聲音 / 標題 / 桌面通知 ----------------
  function beep() {
    if (isMuted()) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
      [0, 0.22].forEach((delay) => {
        const o = audio.createOscillator();
        const g = audio.createGain();
        o.type = 'sine';
        o.frequency.value = 880;
        g.gain.setValueAtTime(0.0001, audio.currentTime + delay);
        g.gain.exponentialRampToValueAtTime(0.25, audio.currentTime + delay + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + delay + 0.18);
        o.connect(g);
        g.connect(audio.destination);
        o.start(audio.currentTime + delay);
        o.stop(audio.currentTime + delay + 0.2);
      });
    } catch (e) {}
  }

  function flashTitle(on) {
    if (on && !titleTimer) {
      baseTitle = document.title;
      let flip = false;
      titleTimer = setInterval(() => {
        flip = !flip;
        document.title = flip ? `🛎️ (${alerts.length}) 客人等待回覆` : baseTitle;
      }, 1000);
    } else if (!on && titleTimer) {
      clearInterval(titleTimer);
      titleTimer = null;
      document.title = baseTitle;
    }
  }

  function desktopNotify(list) {
    try {
      if (!('Notification' in window) || Notification.permission !== 'granted' || !document.hidden || !list.length) return;
      const n = new Notification(`🛎️ ${list.length} 位客人等待回覆`, { body: list.map((a) => a.title.replace(/^\S+\s/, '')).join('\n').slice(0, 200), tag: 'aoi-alerts', requireInteraction: true });
      n.onclick = () => {
        window.focus();
        n.close();
      };
    } catch (e) {}
  }

  // ---------------- 畫面 ----------------
  function ensureBox() {
    if (box) return box;
    box = document.createElement('div');
    box.id = 'aoi-alerts';
    box.className = 'al-dock';
    document.body.appendChild(box);
    box.addEventListener('click', onClick);
    return box;
  }

  function render(shake) {
    ensureBox();
    if (!alerts.length) {
      box.style.display = 'none';
      box.innerHTML = '';
      flashTitle(false);
      return;
    }
    box.style.display = '';
    flashTitle(true);
    const urgent = alerts.some((a) => nowMs() - a.at > URGENT_MIN * 60000);
    if (collapsed) {
      box.innerHTML = `<button type="button" class="al-badge ${urgent ? 'urgent' : ''} ${shake ? 'shake' : ''}" data-act="expand">🛎️ ${alerts.length} 位客人等待回覆</button>`;
      return;
    }
    const canNotify = 'Notification' in window && Notification.permission === 'default';
    box.innerHTML =
      `<div class="al-head"><span>🛎️ ${alerts.length} 位客人等待回覆</span><span>` +
      (canNotify ? '<button type="button" data-act="perm" title="分頁在背景時也會跳通知">🖥️ 桌面通知</button>' : '') +
      `<button type="button" data-act="mute" title="提醒聲音">${isMuted() ? '🔕' : '🔔'}</button><button type="button" data-act="collapse" title="先縮小，1 分鐘後會再提醒">－</button></span></div>` +
      alerts
        .slice()
        .reverse()
        .map((a) => {
          const late = nowMs() - a.at > URGENT_MIN * 60000;
          const link = goUrl(a);
          const ext = /^https?:/.test(link);
          return `<div class="al-card ${late ? 'urgent' : ''} ${shake ? 'shake' : ''}" data-key="${esc(keyOf(a))}">
            <div class="al-title">${esc(a.title)}</div>
            <div class="al-wait">${esc(waited(a))}・${a.channel === 'web' ? '網站訪客' : 'LINE'}</div>
            <div class="al-text">${esc(snippet(a))}</div>
            <div class="al-hint">${esc(hint(a))}</div>
            <div class="al-btns"><a class="al-go" href="${esc(link)}" ${ext ? 'target="_blank" rel="noopener"' : ''}>${esc(goLabel(a))}</a>${canAck ? '<button type="button" data-act="ack">我已處理</button>' : ''}</div>
          </div>`;
        })
        .join('');
  }

  async function onClick(e) {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'collapse') {
      collapsed = true;
      lastRemind = Date.now();
      saveState();
      render();
    } else if (act === 'expand') {
      collapsed = false;
      saveState();
      render();
    } else if (act === 'mute') {
      store.set(MUTE_KEY, !isMuted());
      if (!isMuted()) beep();
      render();
    } else if (act === 'perm') {
      try {
        await Notification.requestPermission();
      } catch (err) {}
      render();
    } else if (act === 'ack') {
      const card = btn.closest('.al-card');
      const a = alerts.find((x) => keyOf(x) === card.dataset.key);
      if (!a) return;
      btn.disabled = true;
      const r = await callApi('botAlertAck', { type: a.type, id: a.id }, { silent: true });
      if (r && r.success) apply(r, true);
      else {
        btn.disabled = false;
        alert((r && r.message) || '送出失敗，請再試一次');
      }
    }
  }

  // ---------------- 資料 ----------------
  function apply(r, fromAck, fromOtherTab) {
    skew = (r.now || Date.now()) - Date.now();
    canAck = !!r.canAck;
    const list = r.alerts || [];
    const fresh = list.filter((a) => !known[keyOf(a)] || known[keyOf(a)] < a.at);
    known = {};
    list.forEach((a) => (known[keyOf(a)] = a.at));
    alerts = list;
    if (fresh.length) {
      collapsed = false;
      lastRemind = Date.now();
      // 開了好幾個分頁時，只有查詢的那個分頁出聲 / 跳桌面通知，其他分頁只在前景時出聲
      if (!fromOtherTab) {
        beep();
        desktopNotify(list);
      } else if (!document.hidden) beep();
    }
    render(fresh.length > 0);
    saveState();
    if (fromAck) store.set(SHARED_KEY, { at: Date.now(), data: r });
  }

  async function poll() {
    clearTimeout(timer);
    try {
      const shared = store.get(SHARED_KEY);
      if (shared && Date.now() - shared.at < 12000) apply(shared.data, false, true); // 別的分頁剛查過，直接用
      else if (!busy) {
        busy = true;
        const r = await callApi('botAlerts', {}, { silent: true });
        busy = false;
        if (r && r.success) {
          store.set(SHARED_KEY, { at: Date.now(), data: r });
          apply(r);
        }
      }
    } catch (e) {
      busy = false;
    }
    timer = setTimeout(poll, document.hidden ? POLL_HIDDEN : POLL_VISIBLE);
  }

  function tick() {
    // 每 10 秒：更新「已等幾分鐘」，縮小太久就自動展開再提醒一次
    if (!alerts.length) return;
    if (collapsed && Date.now() - lastRemind >= REMIND_MS) {
      collapsed = false;
      lastRemind = Date.now();
      saveState();
      beep();
      desktopNotify(alerts);
      render(true);
    } else {
      render();
    }
  }

  window.addEventListener('load', () => {
    if (typeof currentToken === 'undefined' || !currentToken) return;
    if (typeof blockLevel === 'function' && blockLevel('bot') === 'none') return; // 沒有 BOT 設定權限的人看不到客人通知
    loadState();
    window.addEventListener('storage', (e) => {
      if (e.key === SHARED_KEY && e.newValue) {
        try {
          apply(JSON.parse(e.newValue).data, false, true);
        } catch (err) {}
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) poll();
    });
    ['click', 'keydown'].forEach((ev) => document.addEventListener(ev, () => audio && audio.state === 'suspended' && audio.resume(), { once: true }));
    setInterval(tick, 10000);
    poll();
  });
})();
