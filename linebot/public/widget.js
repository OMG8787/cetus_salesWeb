/*!
 * AOI 客服視窗 —— 嵌入到任何網站（貼在 </body> 前面）：
 *   <script src="https://你的網域/widget.js" defer></script>
 *
 * 選用屬性：
 *   data-api   API 網址（預設是這支 script 所在的網域）
 *   data-open  "true" 載入後直接展開
 *
 * 網頁上也可以用 window.AoiChat.open() / close() / toggle() / ask("問題") 控制。
 * 外觀、歡迎詞、按鈕、允許嵌入的網站，都在網站「BOT 設定 → 網站客服視窗」設定。
 */
(function () {
  "use strict";
  var script = document.currentScript;
  if (!script) return;
  if (window.AoiChat) return; // 同一頁只載入一次

  var BOT = "aoi";
  var API = (script.dataset.api || new URL(script.src, location.href).origin).replace(/\/$/, "") + "/api/widget";
  var POLL_MS = 5000;
  var POLL_MAX_MS = 30 * 60 * 1000;

  /* ───────── 訪客編號與狀態（存在瀏覽器；無痕模式等拿不到 storage 時退回記憶體） ───────── */
  var mem = {};
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return mem[k] || null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { mem[k] = v; } },
  };
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var a = new Uint8Array(16); (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach(function (_, i) { a[i] = Math.random() * 256; });
    return Array.prototype.map.call(a, function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
  }
  var vkey = "aoi_visitor_" + BOT;
  var visitor = store.get(vkey);
  if (!visitor || !/^[A-Za-z0-9_-]{16,64}$/.test(visitor)) { visitor = uuid(); store.set(vkey, visitor); }

  function api(path, opts) {
    return fetch(API + path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) { var e = new Error(d.error || "系統忙碌中，請稍後再試"); e.status = r.status; throw e; }
        return d;
      });
    });
  }

  /* ───────── 畫面 ───────── */
  var CSS = [
    ":host{all:initial}",
    "*{box-sizing:border-box}",
    ".w{all:initial;--c:#1d6fd8;--ci:#fff;--bg:#fff;--soft:#f3f6fa;--line:#e3e9f0;--tx:#1b2733;--mu:#6b7a89;--bot:#fff;--cl:var(--c);font:14px/1.55 system-ui,-apple-system,'Segoe UI','Noto Sans TC','Microsoft JhengHei',sans-serif;color:var(--tx)}",
    "@media(prefers-color-scheme:dark){.w{--bg:#1b2229;--soft:#141a20;--line:#2b3641;--tx:#e8eef4;--mu:#93a1af;--bot:#232d37;--cl:color-mix(in srgb,var(--c) 50%,#fff)}}",
    ".launch{position:fixed;bottom:20px;width:56px;height:56px;border-radius:50%;border:0;background:var(--c);color:var(--ci);font-size:26px;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.28);z-index:2147483000;display:flex;align-items:center;justify-content:center;transition:transform .15s}",
    ".launch:hover{transform:scale(1.06)}",
    ".launch:focus-visible,.hd button:focus-visible,.send:focus-visible,.chips button:focus-visible{outline:3px solid rgba(80,140,255,.7);outline-offset:2px}",
    ".w.right .launch,.w.right .panel{right:20px}.w.left .launch,.w.left .panel{left:20px}",
    ".badge{position:absolute;top:-2px;right:-2px;min-width:18px;height:18px;border-radius:9px;background:#e5484d;color:#fff;font-size:11px;line-height:18px;text-align:center;padding:0 4px;display:none}",
    ".badge.on{display:block}",
    ".panel{position:fixed;bottom:88px;width:380px;max-width:calc(100vw - 24px);height:min(620px,calc(100vh - 110px));background:var(--bg);border-radius:16px;box-shadow:0 18px 50px rgba(0,0,0,.28);display:flex;flex-direction:column;overflow:hidden;z-index:2147483000;opacity:0;transform:translateY(12px) scale(.98);pointer-events:none;transition:opacity .18s,transform .18s}",
    ".panel.open{opacity:1;transform:none;pointer-events:auto}",
    ".hd{display:flex;align-items:center;gap:10px;padding:12px 10px 12px 14px;background:var(--c);color:var(--ci)}",
    ".av{width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,.22);display:flex;align-items:center;justify-content:center;font-size:19px;flex:none}",
    ".ti{flex:1;min-width:0}.ti b{display:block;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ti span{font-size:12px;opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block}",
    ".hd button{border:0;background:transparent;color:inherit;width:34px;height:34px;border-radius:10px;cursor:pointer;font-size:17px;opacity:.9}.hd button:hover{background:rgba(255,255,255,.2);opacity:1}",
    ".body{flex:1;overflow-y:auto;padding:14px 12px 6px;display:flex;flex-direction:column;gap:8px;background:var(--soft)}",
    ".row{display:flex;max-width:100%}.row.me{justify-content:flex-end}",
    ".col{display:flex;flex-direction:column;max-width:84%;min-width:0}.row.me .col{align-items:flex-end}.row.ai .col,.row.err .col{align-items:flex-start}",
    ".bub{padding:8px 12px;border-radius:14px;white-space:pre-wrap;word-break:break-word;max-width:100%;background:var(--bot);border:1px solid var(--line);border-bottom-left-radius:5px}",
    ".row.me .bub{background:var(--c);color:var(--ci);border-color:transparent;border-bottom-left-radius:14px;border-bottom-right-radius:5px}",
    ".row.err .bub{background:#fdecec;border-color:#f3c2c2;color:#8a1f1f}",
    ".bub a{color:inherit;text-decoration:underline}",
    ".who{font-size:11px;color:var(--mu);margin:0 0 2px 4px}",
    ".note{align-self:center;font-size:12px;color:var(--mu);background:var(--bg);border:1px solid var(--line);border-radius:999px;padding:2px 12px}",
    ".chips{display:flex;flex-wrap:wrap;gap:6px}",
    ".chips button{border:1px solid var(--cl);background:var(--bg);color:var(--cl);border-radius:999px;padding:4px 12px;font:inherit;font-size:13px;cursor:pointer}",
    ".chips button:hover:not(:disabled){background:var(--c);border-color:var(--c);color:var(--ci)}.chips button:disabled{opacity:.4;cursor:default}",
    ".typing{display:inline-flex;gap:4px;padding:11px 14px}.typing i{width:7px;height:7px;border-radius:50%;background:var(--mu);animation:b 1.2s infinite}.typing i:nth-child(2){animation-delay:.15s}.typing i:nth-child(3){animation-delay:.3s}",
    "@keyframes b{0%,60%,100%{transform:none;opacity:.5}30%{transform:translateY(-4px);opacity:1}}",
    ".ft{border-top:1px solid var(--line);padding:10px 10px 8px;background:var(--bg)}",
    ".in{display:flex;align-items:flex-end;gap:8px;background:var(--soft);border:1px solid var(--line);border-radius:14px;padding:5px 5px 5px 12px}",
    ".in:focus-within{border-color:var(--c)}",
    ".in textarea{flex:1;border:0;background:transparent;color:var(--tx);resize:none;outline:none;font:inherit;max-height:110px;padding:5px 0}",
    ".send{width:36px;height:36px;border:0;border-radius:10px;background:var(--c);color:var(--ci);font-size:17px;cursor:pointer;flex:none}.send:disabled{opacity:.4;cursor:default}",
    ".hint{font-size:11px;color:var(--mu);text-align:center;margin-top:5px}",
    "@media(max-width:575px){.panel{inset:0;width:100%;max-width:none;height:100dvh;border-radius:0}.w.open-m .launch{display:none}}",
    "@media(prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}",
  ].join("");

  var host = document.createElement("div");
  host.setAttribute("data-aoi-chat", "");
  var root = host.attachShadow({ mode: "open" });
  root.innerHTML =
    "<style>" + CSS + "</style>" +
    '<div class="w right">' +
    '<button class="launch" aria-label="開啟客服視窗" aria-expanded="false"><span class="ico">💬</span><span class="badge"></span></button>' +
    '<section class="panel" role="dialog" aria-label="客服視窗" aria-hidden="true">' +
    '<div class="hd"><div class="av"></div><div class="ti"><b></b><span></span></div>' +
    '<button class="reset" title="開始新對話" aria-label="開始新對話">↻</button><button class="x" title="關閉" aria-label="關閉">✕</button></div>' +
    '<div class="body" aria-live="polite"></div>' +
    '<div class="ft"><div class="in"><textarea rows="1" maxlength="1000"></textarea><button class="send" aria-label="送出" disabled>➤</button></div>' +
    '<div class="hint">Enter 送出・Shift + Enter 換行</div></div>' +
    "</section></div>";

  var $ = function (s) { return root.querySelector(s); };
  var wrap = $(".w"), launch = $(".launch"), panel = $(".panel"), body = $(".body"), input = $("textarea"), sendBtn = $(".send"), badge = $(".badge");

  var cfg = null, busy = false, lastId = 0, unread = 0, pollTimer = null, pollSince = 0, welcomed = false, loaded = false;

  /* ───────── 訊息顯示（一律用 textContent / DOM，不用 innerHTML 塞使用者或 AI 的文字） ───────── */
  function linkify(el, text) {
    var re = /https?:\/\/[^\s<>"']+/g, last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) el.appendChild(document.createTextNode(text.slice(last, m.index)));
      var url = m[0].replace(/[),.;!?。，；！？）]+$/, "");
      var a = document.createElement("a");
      a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer"; a.textContent = url;
      el.appendChild(a);
      last = m.index + url.length; re.lastIndex = last;
    }
    if (last < text.length) el.appendChild(document.createTextNode(text.slice(last)));
  }

  function scrollDown() { body.scrollTop = body.scrollHeight; }
  function disableChips() { body.querySelectorAll(".chips button").forEach(function (b) { b.disabled = true; }); }

  function add(kind, text, opts) {
    opts = opts || {};
    disableChips(); // 只有最新一則的按鈕能按
    var row = document.createElement("div");
    row.className = "row " + (kind === "me" ? "me" : kind === "err" ? "err" : "ai");
    var col = document.createElement("div");
    col.className = "col";
    if (opts.who) { var w = document.createElement("div"); w.className = "who"; w.textContent = opts.who; col.appendChild(w); }
    var b = document.createElement("div");
    b.className = "bub";
    linkify(b, text);
    col.appendChild(b);
    row.appendChild(col);
    body.appendChild(row);
    if (opts.choices && opts.choices.length) chips(opts.choices, col);
    scrollDown();
    return row;
  }

  function chips(choices, after) {
    var box = document.createElement("div");
    box.className = "chips";
    box.style.marginTop = "6px";
    choices.forEach(function (c) {
      var b = document.createElement("button");
      b.type = "button"; b.textContent = c;
      b.onclick = function () { send(c); };
      box.appendChild(b);
    });
    (after || body).appendChild(box);
  }

  function note(text) {
    var n = document.createElement("div");
    n.className = "note"; n.textContent = text;
    body.appendChild(n); scrollDown();
  }

  function typing() {
    var row = document.createElement("div");
    row.className = "row ai";
    row.innerHTML = '<div class="bub typing" aria-label="客服正在輸入"><i></i><i></i><i></i></div>';
    body.appendChild(row); scrollDown();
    return row;
  }

  function setBusy(on) {
    busy = on;
    sendBtn.disabled = on || !input.value.trim();
    input.placeholder = on ? "客服回覆中…" : (cfg && cfg.placeholder) || "輸入訊息…";
  }

  /* ───────── 載入設定、還原對話 ───────── */
  function applyConfig(c) {
    cfg = c;
    wrap.className = "w " + (c.position === "left" ? "left" : "right");
    wrap.style.setProperty("--c", c.color);
    // 依背景亮度挑文字顏色
    var n = parseInt(c.color.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    wrap.style.setProperty("--ci", (0.299 * r + 0.587 * g + 0.114 * b) > 170 ? "#111" : "#fff");
    $(".av").textContent = c.avatar || "💬";
    $(".ti b").textContent = c.title;
    $(".ti span").textContent = c.subtitle || "";
    $(".ico").textContent = c.avatar || "💬";
    input.placeholder = c.placeholder || "輸入訊息…";
    panel.setAttribute("aria-label", c.title);
  }

  function welcome() {
    if (welcomed || !cfg || !cfg.welcome) return;
    welcomed = true;
    add("ai", cfg.welcome.text, { choices: cfg.welcome.choices });
  }

  function restore() {
    if (loaded) return Promise.resolve();
    loaded = true;
    return api("/messages?visitorId=" + encodeURIComponent(visitor)).then(function (d) {
      (d.messages || []).forEach(show);
      if (!d.messages || !d.messages.length) welcome(); else welcomed = true;
      if (d.paused) startPolling();
    }).catch(function () { loaded = false; welcome(); });
  }

  function show(m) {
    if (m.id && m.id <= lastId) return;
    if (m.id) lastId = m.id;
    if (m.role === "user") add("me", m.text);
    else add("ai", m.text, { who: m.role === "human" ? "客服人員" : "", choices: m.choices });
  }

  /* ───────── 送出 ───────── */
  function send(text) {
    if (busy) return;
    text = (text == null ? input.value : text).trim();
    if (!text) return;
    input.value = ""; resize();
    add("me", text);
    ask(text);
  }

  function ask(text, silent) {
    setBusy(true);
    var t = silent ? null : typing();
    return api("/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ visitorId: visitor, text: text }) })
      .then(function (d) {
        if (t) t.remove();
        if (d.reply) add("ai", d.reply.text, { choices: d.reply.choices });
        else if (d.paused) note("客服人員處理中，請稍候，回覆會顯示在這裡");
        if (d.paused) startPolling();
      })
      .catch(function (e) {
        if (t) t.remove();
        var row = add("err", e.message || "系統忙碌中，請稍後再試");
        if (e.status !== 429 && e.status !== 403) {
          var box = document.createElement("div");
          box.className = "chips"; box.style.marginTop = "6px";
          var retry = document.createElement("button");
          retry.type = "button"; retry.textContent = "↻ 再試一次";
          retry.onclick = function () { row.remove(); ask(text); };
          box.appendChild(retry);
          row.firstChild.appendChild(box);
        }
      })
      .then(function () { setBusy(false); if (isOpen()) input.focus(); });
  }

  /* ───────── 小編接手後，輪詢小編的回覆 ───────── */
  function startPolling() {
    if (pollTimer) return;
    pollSince = Date.now();
    pollTimer = setInterval(function () {
      if (Date.now() - pollSince > POLL_MAX_MS) return stopPolling();
      if (document.hidden) return;
      api("/messages?visitorId=" + encodeURIComponent(visitor) + "&after=" + lastId).then(function (d) {
        var fresh = (d.messages || []).filter(function (m) { return m.role === "human" && m.id > lastId; }); // 只顯示專人的回覆（機器人的回覆已經在畫面上了）
        fresh.forEach(function (m) { show(m); if (!isOpen()) { unread++; badge.textContent = unread; badge.classList.add("on"); } });
        if (!d.paused && !fresh.length) stopPolling();
      }).catch(function () { /* 下次再試 */ });
    }, POLL_MS);
  }
  function stopPolling() { clearInterval(pollTimer); pollTimer = null; }

  /* ───────── 開關 ───────── */
  function isOpen() { return panel.classList.contains("open"); }
  function open() {
    panel.classList.add("open"); wrap.classList.add("open-m");
    panel.setAttribute("aria-hidden", "false"); launch.setAttribute("aria-expanded", "true");
    unread = 0; badge.classList.remove("on");
    restore().then(function () { setTimeout(function () { input.focus(); }, 120); scrollDown(); });
  }
  function close() {
    panel.classList.remove("open"); wrap.classList.remove("open-m");
    panel.setAttribute("aria-hidden", "true"); launch.setAttribute("aria-expanded", "false");
  }
  function toggle() { isOpen() ? close() : open(); }

  function resize() { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 110) + "px"; }

  function newChat() {
    if (busy) return;
    stopPolling();
    body.innerHTML = ""; lastId = 0; welcomed = false;
    ask("重新開始", true).then(function () { body.innerHTML = ""; lastId = 0; welcomed = false; welcome(); });
  }

  launch.onclick = toggle;
  $(".x").onclick = close;
  $(".reset").onclick = newChat;
  sendBtn.onclick = function () { send(); };
  input.addEventListener("input", function () { resize(); sendBtn.disabled = busy || !input.value.trim(); });
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
  });
  root.addEventListener("keydown", function (e) { if (e.key === "Escape" && isOpen()) close(); });

  window.AoiChat = { open: open, close: close, toggle: toggle, ask: function (t) { open(); restore().then(function () { add("me", t); ask(t); }); } };

  /* ───────── 啟動 ───────── */
  api("/config").then(function (c) {
    applyConfig(c);
    (document.body || document.documentElement).appendChild(host);
    if (script.dataset.open === "true") open();
    else if (c.autoOpen && !store.get("aoi_auto_" + BOT)) {
      setTimeout(function () { if (!isOpen()) { open(); store.set("aoi_auto_" + BOT, "1"); } }, 3000);
    }
  }).catch(function (e) { console.warn("[AOI] 客服視窗未啟用：" + e.message); });
})();
