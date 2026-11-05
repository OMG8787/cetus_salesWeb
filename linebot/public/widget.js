/*!
 * AOI 客服視窗 —— 嵌入到任何網站（貼在 </body> 前面）：
 *   <script src="https://你的網域/widget.js" defer></script>
 *
 * 選用屬性：
 *   data-api   API 網址（預設是這支 script 所在的網域）
 *   data-open  "true" 載入後直接展開
 *   data-launcher  "false" 不顯示右下角的圓形按鈕（由官網的小機器人選單來開啟客服）
 *
 * 網頁上也可以用 window.AoiChat.open() / close() / toggle() / ask("問題") / contact()（開啟並跳出留資料表單）/ human()（直接轉真人）控制；
 * window.AoiChat.ready 是 Promise，客服設定載入完成回傳 true（客服沒啟用 / 載入失敗回傳 false）。
 * 外觀、歡迎詞、按鈕、允許嵌入的網站，都在網站「BOT 設定 → 網站客服視窗」設定。
 */
(function () {
  "use strict";
  var script = document.currentScript;
  if (!script) return;
  if (window.AoiChat) return; // 同一頁只載入一次

  var BOT = "aoi";
  var NO_LAUNCHER = script.dataset.launcher === "false";
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
    ".bub img{display:block;max-width:100%;border-radius:10px;margin-top:6px;cursor:zoom-in;background:var(--soft)}.bub img:first-child{margin-top:0}",
    ".cap{font-size:11px;color:var(--mu);margin-top:2px}",
    ".hand{margin-top:3px}.hand button{border:0;background:transparent;color:var(--mu);cursor:pointer;font:inherit;font-size:12px;padding:2px 6px;border-radius:8px}.hand button:hover:not(:disabled){color:var(--cl);background:var(--bg)}.hand button:disabled{opacity:.4;cursor:default}",
    ".card{background:var(--bot);border:1px solid var(--line);border-radius:14px;padding:10px 12px;width:100%;display:flex;flex-direction:column;gap:6px}",
    ".card b{font-size:13px}.card p{margin:0;font-size:12px;color:var(--mu)}",
    ".card input,.card textarea{width:100%;border:1px solid var(--line);border-radius:8px;background:var(--soft);color:var(--tx);font:inherit;padding:6px 9px;outline:none;resize:none}.card input:focus,.card textarea:focus{border-color:var(--c)}",
    ".card .acts{display:flex;gap:8px;margin-top:2px}.card .acts button{border:1px solid var(--cl);background:var(--bg);color:var(--cl);border-radius:999px;padding:5px 14px;font:inherit;font-size:13px;cursor:pointer}.card .acts .go{background:var(--c);border-color:var(--c);color:var(--ci)}.card .acts button:disabled{opacity:.5;cursor:default}",
    ".card .cerr{font-size:12px;color:#c0392b}",
    ".w.nolaunch .launch{display:none}.w.nolaunch .panel{bottom:100px}",
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

  var readyDone, ready = new Promise(function (r) { readyDone = r; });
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

  /* 回覆裡的圖片標記 [[img:網址|說明]]（還原對話時用）→ 圖片清單；只接受 https 網址 */
  function extractImages(text) {
    var imgs = [];
    var clean = String(text).replace(/\[\[img:([^|\]]+)\|?([^\]]*)\]\]/g, function (_, u, c) {
      if (/^https:\/\//.test(u)) imgs.push({ url: u, caption: c });
      return "";
    }).replace(/\n{3,}/g, "\n\n").trim();
    return { text: clean, images: imgs };
  }

  function addImages(bubble, images) {
    var seen = {};
    (images || []).forEach(function (im) {
      if (!im || !/^https:\/\//.test(im.url) || seen[im.url]) return;
      seen[im.url] = 1;
      var img = document.createElement("img");
      img.src = im.url; img.alt = im.caption || "圖片"; img.loading = "lazy";
      img.onclick = function () { window.open(im.url, "_blank", "noopener"); };
      img.onload = scrollDown;
      bubble.appendChild(img);
      if (im.caption) { var cp = document.createElement("div"); cp.className = "cap"; cp.textContent = im.caption; bubble.appendChild(cp); }
    });
  }

  function add(kind, text, opts) {
    opts = opts || {};
    var pics = opts.images || [];
    if (kind === "ai") { var ex = extractImages(text); text = ex.text; pics = pics.concat(ex.images); }
    disableChips(); // 只有最新一則的按鈕能按
    var row = document.createElement("div");
    row.className = "row " + (kind === "me" ? "me" : kind === "err" ? "err" : "ai");
    var col = document.createElement("div");
    col.className = "col";
    if (opts.who) { var w = document.createElement("div"); w.className = "who"; w.textContent = opts.who; col.appendChild(w); }
    var b = document.createElement("div");
    b.className = "bub";
    linkify(b, text);
    addImages(b, pics);
    if (!b.firstChild) b.textContent = "……";
    col.appendChild(b);
    // 每則客服回覆下方都有「轉真人」按鈕（專人的回覆、錯誤訊息、已經轉真人的那則不用）
    if (kind === "ai" && !opts.who && !opts.noHand && cfg && cfg.handoffButton !== false) {
      var hd = document.createElement("div"); hd.className = "hand";
      var hb = document.createElement("button"); hb.type = "button"; hb.textContent = cfg.handoffLabel || "🙋 轉真人";
      hb.onclick = function () { human(); };
      hd.appendChild(hb); col.appendChild(hd);
    }
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
    wrap.className = "w " + (c.position === "left" ? "left" : "right") + (NO_LAUNCHER ? " nolaunch" : "");
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

  function ask(text, silent, isHuman) {
    setBusy(true);
    var t = silent ? null : typing();
    return api("/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ visitorId: visitor, text: text, human: isHuman === true }) })
      .then(function (d) {
        if (t) t.remove();
        if (d.reply) add("ai", d.reply.text, { choices: d.reply.choices, images: d.reply.images, noHand: d.reply.handoffButton === false });
        else if (d.paused) note("客服人員處理中，請稍候，回覆會顯示在這裡");
        if (d.paused) startPolling();
        if (d.askContact && !silent && !store.get(leadKey())) contactCard();
      })
      .catch(function (e) {
        if (t) t.remove();
        var row = add("err", e.message || "系統忙碌中，請稍後再試");
        if (e.status !== 429 && e.status !== 403) {
          var box = document.createElement("div");
          box.className = "chips"; box.style.marginTop = "6px";
          var retry = document.createElement("button");
          retry.type = "button"; retry.textContent = "↻ 再試一次";
          retry.onclick = function () { row.remove(); ask(text, false, isHuman); };
          box.appendChild(retry);
          row.firstChild.appendChild(box);
        }
      })
      .then(function () { setBusy(false); if (isOpen()) input.focus(); });
  }

  /* ───────── 轉真人（回覆下方的按鈕）───────── */
  function human() {
    if (busy) return;
    add("me", (cfg && cfg.handoffLabel) || "🙋 轉真人");
    ask("", false, true);
  }

  /* ───────── 聊了幾段後，請訪客留下聯繫資料（段數在後台「客服設定」；0 = 不問）───────── */
  function leadKey() { return "aoi_lead_" + BOT + "_" + visitor; }
  var cardOpen = false;
  function contactCard() {
    if (cardOpen) return;
    cardOpen = true;
    disableChips();
    var row = document.createElement("div");
    row.className = "row ai";
    var col = document.createElement("div");
    col.className = "col"; col.style.maxWidth = "92%"; col.style.width = "100%";
    var card = document.createElement("form");
    card.className = "card";
    card.innerHTML =
      "<b>📇 方便留下聯繫資料嗎？</b><p>之後有新的資訊或需要進一步討論，專人可以主動聯繫您。</p>" +
      '<input name="name" placeholder="姓名" maxlength="40" autocomplete="name">' +
      '<input name="company" placeholder="公司" maxlength="60" autocomplete="organization">' +
      '<input name="phone" placeholder="電話（電話或 Email 擇一必填）" maxlength="30" autocomplete="tel" inputmode="tel">' +
      '<input name="email" placeholder="Email" maxlength="80" autocomplete="email" inputmode="email">' +
      '<textarea name="note" rows="2" maxlength="300" placeholder="想了解什麼（選填）"></textarea>' +
      '<div class="cerr" role="alert"></div>' +
      '<div class="acts"><button type="submit" class="go">送出</button><button type="button" class="skip">稍後再說</button></div>';
    col.appendChild(card); row.appendChild(col); body.appendChild(row); scrollDown();
    var err = card.querySelector(".cerr"), go = card.querySelector(".go");
    card.querySelector(".skip").onclick = function () { row.remove(); cardOpen = false; };
    card.onsubmit = function (e) {
      e.preventDefault();
      var f = function (n) { return card.elements[n].value.trim(); };
      if (!f("phone") && !f("email")) { err.textContent = "請至少留下電話或 Email，專人才能聯繫您"; return; }
      err.textContent = ""; go.disabled = true;
      api("/lead", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ visitorId: visitor, name: f("name"), company: f("company"), phone: f("phone"), email: f("email"), note: f("note") }) })
        .then(function () { store.set(leadKey(), "1"); row.remove(); cardOpen = false; add("ai", "謝謝您！已收到您的聯繫資料，專人會盡快與您聯繫 🙏", { noHand: true }); })
        .catch(function (e2) { go.disabled = false; err.textContent = e2.message || "送出失敗，請稍後再試"; });
    };
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
    try { window.dispatchEvent(new CustomEvent("aoichat:open")); } catch (e) { /* 舊瀏覽器略過 */ }
    restore().then(function () { setTimeout(function () { input.focus(); }, 120); scrollDown(); });
  }
  function close() {
    panel.classList.remove("open"); wrap.classList.remove("open-m");
    panel.setAttribute("aria-hidden", "true"); launch.setAttribute("aria-expanded", "false");
    try { window.dispatchEvent(new CustomEvent("aoichat:close")); } catch (e) { /* 舊瀏覽器略過 */ }
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

  function afterReady(fn) { ready.then(function (ok) { if (ok) fn(); }); }
  window.AoiChat = {
    ready: ready,
    open: function () { afterReady(open); },
    close: close,
    toggle: function () { afterReady(toggle); },
    ask: function (t) { afterReady(function () { open(); restore().then(function () { add("me", t); ask(t); }); }); },
    contact: function () { afterReady(function () { open(); restore().then(function () { contactCard(); }); }); },
    human: function () { afterReady(function () { open(); restore().then(human); }); },
  };

  /* ───────── 啟動 ───────── */
  api("/config").then(function (c) {
    applyConfig(c);
    (document.body || document.documentElement).appendChild(host);
    readyDone(true);
    if (script.dataset.open === "true") open();
    else if (c.autoOpen && !store.get("aoi_auto_" + BOT)) {
      setTimeout(function () { if (!isOpen()) { open(); store.set("aoi_auto_" + BOT, "1"); } }, 3000);
    }
  }).catch(function (e) { readyDone(false); console.warn("[AOI] 客服視窗未啟用：" + e.message); });
})();
