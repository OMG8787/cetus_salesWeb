/**
 * robot-widget.js
 * 放在 GitHub 上、會常常修改的檔案。
 * 功能：在官網右下角固定顯示小機器人，滑鼠移上去（手機為點擊）會展開選單。
 * 使用 Shadow DOM，不會被官網原有的 CSS 影響，也不會污染官網樣式。
 */
(function () {
  'use strict';

  // =====================================================
  //  常改設定區：只要改這裡就好
  // =====================================================
  var CONFIG = {
    // 位置（距離視窗邊緣的距離，單位 px）
    position: { right: 80, bottom: 24 },

    // 主題色
    color: '#2563eb',

    // 機器人上方的小提示氣泡（設為 '' 則不顯示）
    banner: '歡迎詢問、選配等', // 機器人頭上一直閃爍的醒目文字（空字串 = 不顯示）
    greeting: '需要協助嗎？',
    greetingDurationMs: 5000, // 氣泡顯示多久後自動消失（0 = 不自動消失）

    // 智能客服（機器人伺服器）：填你的 Vercel 網址（不是 LINE 的 Webhook，不要加 /api/cs）。
    // 後台「BOT 設定 → 客服設定 → 網站客服視窗」要開啟，並把這個官網網址加進「允許嵌入的網站」。
    // 留空 '' = 不使用線上客服，選單只會用下面的 url / fallbackUrl
    chatUrl: 'https://aoi-linebot.vercel.app',

    // 選單項目：由上到下顯示
    //   action: 'chat'    開啟智能客服視窗
    //           'contact' 開啟客服視窗並跳出「留下聯繫資料」表單（資料會進後台「BOT 設定 → 聯繫名單」）
    //           'human'   直接呼叫專員（轉真人，後台會收到通知）
    //   fallbackUrl：客服視窗載不到 / 沒啟用時改去的網址（沒有填就會自動隱藏這個項目）
    //   url：不用客服視窗，直接前往的網址；target：_blank（新分頁）或 _self（同頁）
    //   若想執行自訂動作，可改用 onClick: function () { ... }
    items: [
      { icon: '💬', label: '專屬智能客服', action: 'chat' },
      { icon: '✉️', label: '聯繫我', action: 'contact', fallbackUrl: 'mailto:YOUR_MAIL@example.com' },
      //{ icon: '🎧', label: '專員客服', action: 'human', fallbackUrl: 'https://line.me/R/ti/p/@your_line_id', target: '_blank' },
      { icon: '🧭', label: '選型工具', url: 'https://austincetus-maker.github.io/cetustool/', target: '_self' }
    ],

    // 不想顯示的頁面（網址路徑包含以下任一字串就不顯示）
    hideOnPaths: [] // 例如 ['/checkout', '/admin']
  };

  // ===== 智能客服視窗（載入機器人伺服器上的 widget.js；沒有用到時不影響官網）=====
  var chatPromise = null;
  var chatOk = null; // null = 還在載入 / true = 可用 / false = 不可用
  function loadChat() {
    if (chatPromise) return chatPromise;
    chatPromise = new Promise(function (resolve) {
      var base = String(CONFIG.chatUrl || '').replace(/\/+$/, '');
      if (!base || /YOUR_BOT/.test(base)) return resolve(false);
      function done() { window.AoiChat ? window.AoiChat.ready.then(resolve) : resolve(false); }
      if (window.AoiChat) return done();
      var sc = document.createElement('script');
      sc.src = base + '/widget.js';
      sc.async = true;
      sc.setAttribute('data-launcher', 'false'); // 不要另外一顆圓形按鈕，由這個小機器人的選單開啟
      sc.setAttribute('data-bottom', String((Number(CONFIG.position.bottom) || 0) + (Number(CONFIG.size) || 96) + 14)); // 客服視窗抬到機器人上方，不要被蓋住
      sc.onload = done;
      sc.onerror = function () { resolve(false); };
      document.head.appendChild(sc);
    }).then(function (ok) { chatOk = !!ok; return chatOk; });
    return chatPromise;
  }
  // =====================================================

  // ===== 後台設定（BOT 設定 → 🌐 網站客服視窗 → 🤖 官網小機器人）=====
  // 先用上面的預設值，再用後台設定蓋過去；後台讀不到（沒網路 / 沒啟用 / 網站沒在允許清單）就維持預設值
  var REMOTE_KEY = 'aoi_robot_cfg';
  function applyRemote(r) {
    if (!r || typeof r !== 'object') return;
    if (r.enabled === false) CONFIG.disabled = true;
    if (r.size) CONFIG.size = r.size;
    if (r.color) CONFIG.color = r.color;
    if (typeof r.right === 'number') CONFIG.position.right = r.right;
    if (typeof r.bottom === 'number') CONFIG.position.bottom = r.bottom;
    if (typeof r.banner === 'string') CONFIG.banner = r.banner;
    if (typeof r.greeting === 'string') CONFIG.greeting = r.greeting;
    if (typeof r.greetingSeconds === 'number') CONFIG.greetingDurationMs = r.greetingSeconds * 1000;
    if (Array.isArray(r.items)) {
      CONFIG.items = r.items.filter(function (it) { return it && it.on !== false && it.label; }).map(function (it) {
        var o = { icon: it.icon || '', label: it.label };
        if (it.type === 'url') { o.url = it.url; o.target = it.target || '_self'; } else o.action = it.type;
        return o;
      });
    }
  }
  function loadRemote() {
    return new Promise(function (resolve) {
      var base = String(CONFIG.chatUrl || '').replace(/\/+$/, '');
      var cached = null;
      try { cached = JSON.parse(localStorage.getItem(REMOTE_KEY) || 'null'); } catch (e) { cached = null; }
      if (!base || !window.fetch) { applyRemote(cached); return resolve(); }
      var finished = false;
      var finish = function (r) { if (finished) return; finished = true; applyRemote(r || cached); resolve(); };
      var timer = setTimeout(function () { finish(null); }, 2000); // 讀不到就用上次的設定（或預設值），不讓官網機器人等太久
      fetch(base + '/api/widget/config').then(function (res) { return res.ok ? res.json() : null; }).then(function (d) {
        clearTimeout(timer);
        var r = d && d.robot;
        if (r) { try { localStorage.setItem(REMOTE_KEY, JSON.stringify(r)); } catch (e) { /* 略過 */ } }
        finish(r);
      }).catch(function () { clearTimeout(timer); finish(null); });
    });
  }

  var HOST_ID = 'robot-widget-host';

  // 避免重複建立
  if (document.getElementById(HOST_ID)) return;

  // 指定頁面不顯示
  for (var i = 0; i < CONFIG.hideOnPaths.length; i++) {
    if (location.pathname.indexOf(CONFIG.hideOnPaths[i]) !== -1) return;
  }

  function init() {
    if (CONFIG.disabled) return;
    var S = Math.max(56, Math.min(160, Number(CONFIG.size) || 96)); // 機器人大小（px）
    var host = document.createElement('div');
    host.id = HOST_ID;
    // 用極高的 z-index 確保浮在官網最上方
    host.style.cssText =
      'position:fixed;right:0;bottom:0;width:0;height:0;z-index:2147483647;';
    document.body.appendChild(host);

    var root = host.attachShadow({ mode: 'open' });

    var robotSvg =
      '<svg viewBox="0 0 64 64" width="' + Math.round(S * 0.59) + '" height="' + Math.round(S * 0.59) + '" aria-hidden="true">' +
      '<line x1="32" y1="6" x2="32" y2="14" stroke="#fff" stroke-width="3" stroke-linecap="round"/>' +
      '<circle cx="32" cy="5" r="3.5" fill="#fde047"/>' +
      '<rect x="10" y="14" width="44" height="34" rx="12" fill="#fff"/>' +
      '<rect x="4" y="26" width="6" height="12" rx="3" fill="#fff" opacity=".85"/>' +
      '<rect x="54" y="26" width="6" height="12" rx="3" fill="#fff" opacity=".85"/>' +
      '<g class="eyes"><circle cx="23" cy="31" r="4.5" fill="' + CONFIG.color + '"/>' +
      '<circle cx="41" cy="31" r="4.5" fill="' + CONFIG.color + '"/></g>' +
      '<path d="M24 40 Q32 46 40 40" stroke="' + CONFIG.color +
      '" stroke-width="3" fill="none" stroke-linecap="round"/>' +
      '<rect x="22" y="50" width="20" height="8" rx="4" fill="#fff" opacity=".85"/>' +
      '</svg>';

    var css =
      ':host{all:initial}' +
      '*{box-sizing:border-box}' +
      '.wrap{position:fixed;right:' + CONFIG.position.right + 'px;bottom:' + CONFIG.position.bottom + 'px;' +
      'display:flex;flex-direction:column;align-items:flex-end;gap:12px;' +
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans TC","Microsoft JhengHei",sans-serif;}' +

      /* 選單 */
      '.menu{display:flex;flex-direction:column;align-items:flex-end;gap:8px;' +
      'opacity:0;transform:translateY(10px) scale(.96);pointer-events:none;' +
      'transition:opacity .2s ease,transform .2s ease;}' +
      '.wrap.open .menu{opacity:1;transform:none;pointer-events:auto;}' +
      '.item{display:flex;align-items:center;gap:8px;padding:10px 18px;background:#fff;color:#1f2937;' +
      'border:none;border-radius:999px;font-size:15px;line-height:1;white-space:nowrap;cursor:pointer;' +
      'text-decoration:none;box-shadow:0 4px 14px rgba(0,0,0,.15);transition:transform .15s,background .15s,color .15s;}' +
      '.item:hover,.item:focus-visible{background:' + CONFIG.color + ';color:#fff;transform:translateX(-4px);outline:none;}' +
      '.item .ic{font-size:18px;}' +

      /* 氣泡 */
      '.tip{position:absolute;right:' + (S + 12) + 'px;bottom:' + Math.round(S * 0.35) + 'px;background:#fff;color:#1f2937;padding:8px 14px;' +
      'border-radius:14px 14px 4px 14px;font-size:14px;white-space:nowrap;box-shadow:0 4px 14px rgba(0,0,0,.15);' +
      'opacity:0;transform:translateX(8px);pointer-events:none;transition:opacity .25s,transform .25s;}' +
      '.wrap.tip-on:not(.open) .tip{opacity:1;transform:none;}' +

      /* 頭上閃爍的醒目文字 */
      '.banner{position:absolute;right:0;bottom:' + (S + 8) + 'px;background:' + CONFIG.color + ';color:#fff;padding:7px 14px;' +
      'border-radius:999px;font-size:15px;font-weight:700;white-space:nowrap;letter-spacing:1px;' +
      'box-shadow:0 4px 14px rgba(0,0,0,.28);animation:flash 1.4s ease-in-out infinite;pointer-events:none;transition:opacity .2s;}' +
      '.banner:after{content:"";position:absolute;right:38px;bottom:-6px;border:7px solid transparent;border-top-color:' + CONFIG.color + ';border-bottom:0;}' +
      '.wrap.open .banner,.wrap.chat-open .banner,.wrap.chat-open .tip,.wrap.chat-open .menu{opacity:0;animation:none;pointer-events:none;}' +
      '@keyframes flash{0%,100%{opacity:1;box-shadow:0 0 0 0 rgba(255,255,255,.0),0 4px 14px rgba(0,0,0,.28)}50%{opacity:.55;box-shadow:0 0 14px 4px ' + CONFIG.color + ',0 4px 14px rgba(0,0,0,.28)}}' +

      /* 機器人按鈕 */
      '.bot{position:relative;width:' + S + 'px;height:' + S + 'px;border:none;border-radius:50%;padding:0;cursor:pointer;' +
      'display:flex;align-items:center;justify-content:center;' +
      'background:linear-gradient(145deg,' + CONFIG.color + ',#1e3a8a);' +
      'box-shadow:0 8px 26px rgba(0,0,0,.32);animation:float 3s ease-in-out infinite;transition:transform .2s;}' +
      '.bot:hover,.bot:focus-visible{transform:scale(1.08);outline:none;}' +
      '.wrap.open .bot{animation-play-state:paused;}' +
      '.eyes{transform-origin:32px 31px;animation:blink 4s infinite;}' +

      '@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}' +
      '@keyframes blink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}' +
      '@media (prefers-reduced-motion:reduce){.bot,.eyes,.banner{animation:none}}';

    var style = document.createElement('style');
    style.textContent = css;
    root.appendChild(style);

    var wrap = document.createElement('div');
    wrap.className = 'wrap';

    // 選單
    var menu = document.createElement('div');
    menu.className = 'menu';
    menu.setAttribute('role', 'menu');

    var chatEls = [];

    // 備用網址還是範例（YOUR_…）= 還沒設定，視同沒有
    var hasFallback = function (it) { return !!it.fallbackUrl && !/YOUR_/.test(it.fallbackUrl); };

    function gotoFallback(it) {
      if (!hasFallback(it)) return;
      if (it.target === '_blank') window.open(it.fallbackUrl, '_blank', 'noopener');
      else location.href = it.fallbackUrl;
    }

    CONFIG.items.forEach(function (it) {
      var el;
      if (it.action && !it.onClick) {
        // 客服視窗的動作：可用就開視窗，不能用就改去 fallbackUrl
        it.onClick = function () {
          function run(ok) {
            if (ok) { var c = window.AoiChat; (c[it.action] || c.open)(); }
            else gotoFallback(it);
          }
          if (chatOk === null) loadChat().then(run); else run(chatOk);
        };
      }
      if (it.url) {
        el = document.createElement('a');
        el.href = it.url;
        el.target = it.target || '_self';
        if (el.target === '_blank') el.rel = 'noopener noreferrer';
      } else {
        el = document.createElement('button');
        el.type = 'button';
      }
      el.className = 'item';
      el.setAttribute('role', 'menuitem');

      var ic = document.createElement('span');
      ic.className = 'ic';
      ic.textContent = it.icon || '';
      var tx = document.createElement('span');
      tx.textContent = it.label;
      el.appendChild(ic);
      el.appendChild(tx);

      if (typeof it.onClick === 'function') {
        el.addEventListener('click', function (e) {
          if (!it.url) e.preventDefault();
          it.onClick(e);
          setOpen(false);
        });
      }
      if (it.action) chatEls.push({ el: el, it: it });
      menu.appendChild(el);
    });

    // 先在背景載入客服視窗；不能用的項目，有備用網址就保留（點了改去備用網址），沒有就隱藏
    function settle() {
      loadChat().then(function (ok) {
        if (!ok) chatEls.forEach(function (x) { if (!hasFallback(x.it)) x.el.style.display = 'none'; });
      });
    }
    if (window.requestIdleCallback) requestIdleCallback(settle, { timeout: 3000 });
    else setTimeout(settle, 1500);

    // 客服視窗開啟時機器人讓位，關閉後再出現
    var chatIsOpen = false;
    window.addEventListener('aoichat:open', function () {
      chatIsOpen = true;
      wrap.classList.add('chat-open'); // 視窗開著：收起頭上文字、泡泡與選單，機器人留著，再按一下就關閉
      setOpen(false);
      if (window.innerWidth < 576) host.style.display = 'none'; // 手機視窗是全螢幕，機器人讓位（視窗自己有關閉鈕）
    });
    window.addEventListener('aoichat:close', function () { chatIsOpen = false; wrap.classList.remove('chat-open'); host.style.display = ''; });

    // 氣泡
    var tip = document.createElement('div');
    tip.className = 'tip';
    tip.textContent = CONFIG.greeting;

    // 機器人按鈕
    var bot = document.createElement('button');
    bot.className = 'bot';
    bot.type = 'button';
    bot.setAttribute('aria-label', '開啟客服選單');
    bot.setAttribute('aria-haspopup', 'true');
    bot.setAttribute('aria-expanded', 'false');
    bot.innerHTML = robotSvg;

    wrap.appendChild(menu);
    if (CONFIG.greeting) wrap.appendChild(tip);
    if (CONFIG.banner) {
      var banner = document.createElement('div');
      banner.className = 'banner';
      banner.textContent = CONFIG.banner;
      wrap.appendChild(banner);
    }
    wrap.appendChild(bot);
    root.appendChild(wrap);

    // ===== 開關邏輯 =====
    var closeTimer = null;

    function setOpen(open) {
      clearTimeout(closeTimer);
      wrap.classList.toggle('open', open);
      bot.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) wrap.classList.remove('tip-on');
    }

    // 訪客進入官網後，1 秒自動展開機器人選單
    setTimeout(function () {
      setOpen(true);
    }, 1000);

    // 桌機：滑鼠移入展開，移出稍微延遲再收合（避免手滑一下就消失）
    wrap.addEventListener('mouseenter', function () {
      clearTimeout(closeTimer);
      setOpen(true);
    });
    wrap.addEventListener('mouseleave', function () {
      closeTimer = setTimeout(function () { setOpen(false); }, 250);
    });

    // 按下機器人圖像：直接開啟智能客服（滑鼠移上去仍會出現選單）。選單裡沒有智能客服項目時，才改成切換選單
    bot.addEventListener('click', function () {
      var chat = CONFIG.items.filter(function (it) { return it.action === 'chat' && typeof it.onClick === 'function'; })[0];
      if (chat) {
        if (chatIsOpen && window.AoiChat) window.AoiChat.close(); // 視窗開著：再按一下關閉
        else chat.onClick(); // 視窗關著：按一下打開
        setOpen(false);
        return;
      }
      setOpen(!wrap.classList.contains('open'));
    });

    // 點擊其他地方收合
    document.addEventListener('click', function (e) {
      if (e.composedPath().indexOf(host) === -1) setOpen(false);
    });

    // Esc 收合
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') setOpen(false);
    });

    // 開場提示氣泡
    if (CONFIG.greeting) {
      setTimeout(function () { wrap.classList.add('tip-on'); }, 800);
      if (CONFIG.greetingDurationMs > 0) {
        setTimeout(function () {
          wrap.classList.remove('tip-on');
        }, 800 + CONFIG.greetingDurationMs);
      }
    }

    // 提供簡單的外部控制介面
    window.RobotWidget = {
      open: function () { setOpen(true); },
      close: function () { setOpen(false); },
      destroy: function () { host.remove(); delete window.RobotWidget; }
    };
  }

  function start() { loadRemote().then(init); }
  if (document.body) {
    start();
  } else {
    document.addEventListener('DOMContentLoaded', start);
  }
})();
