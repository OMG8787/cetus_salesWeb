/**
 * ============================================================
 * Bot.gs - BOT 設定模組：客服機器人（對外 LINE 官方帳號 + 網站右下角客服視窗）的設定、知識庫、對話與小編接手
 * ------------------------------------------------------------
 * 選用模組：跟 Code.gs 貼在同一個 Apps Script 專案（沒貼就沒有 BOT 設定功能，其他功能不受影響）。
 * 架構（跟瘋菓的 BOT 管理一樣）：
 *   LINE 官方帳號 / 網站客服視窗 ──► linebot/（Vercel，驗簽、檢索知識庫、呼叫 AI）──► 這裡（設定、知識庫、對話紀錄都存在試算表）
 *   網站「BOT 設定」頁 ──► 這裡的 bot* 動作（用網站登入權杖，需要「BOT 設定」權限）
 *   linebot ──► 這裡的 { action:'bot', secret, op } （用「Bot 金鑰」，不是登入權杖）
 * 資料表：BotConfig（設定，每個區塊一列 JSON）、BotKnowledge（常見問題 / 文件段落）、BotMessages（對話紀錄）。
 * 機器人只看得到知識庫（常見問答、文件、產品名稱與規格、公司簡介），看不到任何內部資料；產品「底價」「供應商」永遠不會給機器人。
 * ============================================================
 */

var SHEET_BOT_CONFIG = 'BotConfig';
var SHEET_BOT_KB = 'BotKnowledge';
var SHEET_BOT_MSG = 'BotMessages';

var BOT_SECRET_PROP = 'BOT_SECRET';
var BOT_GEN_PROP = 'BOT_HIST_GEN';
var BOT_LOG_MAX = 4000; // 對話紀錄最多留幾筆（超過會自動刪最舊的）

var BOT_AI_PROVIDERS = {
  gemini: { name: 'Gemini', endpoint: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.5-flash' },
  claude: { name: 'Claude', endpoint: 'https://api.anthropic.com/v1', model: 'claude-sonnet-5-5' },
  openai: { name: 'OpenAI 相容', endpoint: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
};

/**
 * 客服可以「交給真人回答」的問題類型（預設全部不勾，BOT 設定頁自己勾；關鍵字可改）。
 * ask = 轉給小編時請客人先留下的資料（BOT 設定可改，清空 = 不請客人留資料）。
 */
var BOT_CS_TOPICS = [
  { key: 'price', name: '價格 / 報價', words: '多少錢 價格 價錢 售價 報價 費用 幾元 優惠 折扣 特價 便宜 預算',
    ask: '為了加快報價，請先留下以下資料：\n・公司名稱與聯絡人\n・電話或 Email\n・需要的產品型號 / 數量，或應用說明' },
  { key: 'order', name: '訂購 / 下單', words: '訂購 下單 訂貨 我要買 怎麼買 想買 購買 採購',
    ask: '為了加快處理，請先留下以下資料：\n・公司名稱與聯絡人\n・電話\n・想訂購的品項與數量\n・希望交期' },
  { key: 'sample', name: '樣品測試 / 專案評估', words: '樣品 打樣 測試 評估 專案 客製 驗證 試用 借測',
    ask: '請先留下您的需求，FAE 會更快回覆您：\n・公司名稱與聯絡人、電話\n・產品應用與待測物件\n・檢測需求（要抓什麼缺陷、精度、速度）' },
  { key: 'shipping', name: '運費 / 交期', words: '運費 配送 寄送 出貨 物流 到貨 交期 現貨 缺貨' },
  { key: 'complaint', name: '客訴 / 退換貨 / 維修', words: '退貨 退款 換貨 客訴 投訴 故障 維修 壞掉 保固 RMA 不良' },
];
var BOT_HANDOFF_WORDS = '真人 客服人員 小編 專人 人工 業務';
var BOT_TONES = ['friendly', 'formal', 'concise'];
var BOT_EMOJI = ['many', 'some', 'none'];

function botSchema_() {
  return {
    schema: {
      BotConfig: ['Key', 'Value'],
      BotKnowledge: ['ID', 'Type', 'Title', 'Question', 'Content', 'Tags', 'Source', 'IsActive', 'UpdatedAt'],
      BotMessages: ['ID', 'Time', 'Channel', 'UserId', 'Name', 'Role', 'Text', 'Topic'],
    },
    text: { BotMessages: ['Time', 'UserId'], BotKnowledge: [] },
  };
}

/** 動作 → [區塊, 等級]。BOT 設定是可以獨立指定查看 / 編輯的功能區塊；刪除只有系統管理員。 */
function botPerms_() {
  return {
    botGetSettings: ['bot', 'r'], botKbList: ['bot', 'r'], botConversations: ['bot', 'r'], botThread: ['bot', 'r'],
    botSaveSettings: ['bot', 'w'], botSaveAi: ['bot', 'w'], botTestAi: ['bot', 'w'], botKbSave: ['bot', 'w'], botKbImport: ['bot', 'w'],
    botGenKey: ['bot', 'w'], botRevealKey: ['bot', 'w'], botHumanReply: ['bot', 'w'], botResume: ['bot', 'w'], botTestToken: ['bot', 'w'],
    botKbDelete: ['bot', 'd'], botClear: ['bot', 'd'],
  };
}

function botRoutes_() {
  return {
    bot: { auth: false, fn: handleBotApi },
    botGetSettings: { auth: true, fn: handleBotGetSettings },
    botSaveSettings: { auth: true, fn: handleBotSaveSettings },
    botSaveAi: { auth: true, fn: handleBotSaveAi },
    botTestAi: { auth: true, fn: handleBotTestAi },
    botKbList: { auth: true, fn: handleBotKbList },
    botKbSave: { auth: true, fn: handleBotKbSave },
    botKbImport: { auth: true, fn: handleBotKbImport },
    botKbDelete: { auth: true, fn: handleBotKbDelete },
    botGenKey: { auth: true, fn: handleBotGenKey },
    botRevealKey: { auth: true, fn: handleBotRevealKey },
    botConversations: { auth: true, fn: handleBotConversations },
    botThread: { auth: true, fn: handleBotThread },
    botHumanReply: { auth: true, fn: handleBotHumanReply },
    botResume: { auth: true, fn: handleBotResume },
    botTestToken: { auth: true, fn: handleBotTestToken },
    botClear: { auth: true, fn: handleBotClear },
  };
}

// ------------------------------------------------------------
// 小工具
// ------------------------------------------------------------
function botInt_(v, min, max, def) {
  var n = Number(v);
  if (v === '' || v === null || v === undefined || isNaN(n)) return def;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function botClip_(v, n) {
  var t = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) : t;
}

function botNow_() {
  return Utilities.formatDate(new Date(), 'GMT+8', 'yyyy-MM-dd HH:mm:ss');
}

function botCache_() {
  return CacheService.getScriptCache();
}

function botCacheGet_(key) {
  try {
    var v = botCache_().get(key);
    return v ? JSON.parse(v) : null;
  } catch (e) {
    return null;
  }
}

function botCachePut_(key, value, seconds) {
  try {
    botCache_().put(key, JSON.stringify(value), Math.min(21600, Math.max(1, Math.floor(seconds))));
  } catch (e) {
    // 超過快取大小上限或快取暫時不可用：略過（功能不受影響，只是少了加速）
  }
}

function botCacheRemove_(keys) {
  try {
    botCache_().removeAll(keys);
  } catch (e) {
    // ignore
  }
}

/** 關鍵字：以空白、逗號、頓號分隔 */
function botWords_(text) {
  var list = String(text || '').split(/[\s,，、;；]+/).map(function (w) { return w.trim(); }).filter(Boolean);
  return list.filter(function (w, i) { return list.indexOf(w) === i; }).slice(0, 100);
}

/** 常用按鈕：一行一個（LINE 最多 13 個、每個 20 字） */
function botButtons_(text) {
  var list = String(text || '').split(/\n/).map(function (w) { return w.trim(); }).filter(Boolean);
  return list.filter(function (w, i) { return list.indexOf(w) === i; }).slice(0, 13).map(function (w) { return w.slice(0, 20); });
}

function botRandomKey_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}

// ------------------------------------------------------------
// 設定（BotConfig 分頁：每個區塊一列 JSON；快取 2 分鐘，儲存時清掉）
// ------------------------------------------------------------
function botCfgAll_() {
  var cached = botCacheGet_('botcfg');
  if (cached) return cached;
  var out = {};
  sheetToObjects(SHEET_BOT_CONFIG).rows.forEach(function (r) {
    if (!r['Key']) return;
    try {
      out[r['Key']] = JSON.parse(String(r['Value'] || 'null'));
    } catch (e) {
      out[r['Key']] = null;
    }
  });
  botCachePut_('botcfg', out, 120);
  return out;
}

function botCfg_(key, def) {
  var v = botCfgAll_()[key];
  return v === null || v === undefined ? def : v;
}

function botCfgSet_(key, value) {
  withLock_(function () {
    var sheet = getSheet(SHEET_BOT_CONFIG);
    var data = sheet.getDataRange().getValues();
    var json = JSON.stringify(value);
    var found = 0;
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === key) {
        found = i + 1;
        break;
      }
    }
    if (found) sheet.getRange(found, 2).setValue(json);
    else appendObjectRow(SHEET_BOT_CONFIG, { Key: key, Value: json });
    botCacheRemove_(['botcfg']);
  });
}

/** 客服機器人設定：沒設定的用預設值。topics 每類 { on, words, ask, askPos }；關鍵字留空 = 預設關鍵字。 */
function botCsConfig_(cs) {
  cs = cs || {};
  var src = cs.sources || {}, st = cs.style || {}, h = cs.hours || {}, tp = cs.topics || {}, web = cs.web || {};
  var on = function (v) { return v !== false; };
  var hm = function (v, d) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || '')) ? String(v) : d; };
  var days = Array.isArray(h.days) ? h.days.map(Number).filter(function (d, i, a) { return d >= 0 && d <= 6 && Math.floor(d) === d && a.indexOf(d) === i; }) : [1, 2, 3, 4, 5];
  var color = /^#[0-9a-fA-F]{6}$/.test(String(web.color || '')) ? String(web.color) : '#2c5aa0';
  return {
    enabled: cs.enabled === true,
    welcome: String(cs.welcome || ''),
    prompt: String(cs.prompt || ''),
    handoffText: String(cs.handoffText || ''),
    sources: {
      qa: on(src.qa),
      products: src.products === true,
      brand: on(src.brand),
      productLimit: botInt_(src.productLimit, 50, 3000, 1500),
    },
    brandInfo: String(cs.brandInfo || ''),
    replyWhen: cs.replyWhen === 'offHours' ? 'offHours' : 'always',
    hours: { enabled: h.enabled === true, days: days, start: hm(h.start, '09:00'), end: hm(h.end, '18:00'), offText: String(h.offText || '') },
    handoffWords: cs.handoffWords === undefined || cs.handoffWords === null ? BOT_HANDOFF_WORDS : String(cs.handoffWords),
    pauseMinutes: botInt_(cs.pauseMinutes, 0, 360, 30),
    topics: BOT_CS_TOPICS.map(function (t) {
      var v = tp[t.key] || {};
      return {
        key: t.key,
        name: t.name,
        on: v.on === true,
        words: String(v.words || '').trim() || t.words,
        defaultWords: t.words,
        ask: v.ask === undefined || v.ask === null ? t.ask || '' : String(v.ask),
        defaultAsk: t.ask || '',
        askPos: v.askPos === 'before' ? 'before' : 'after',
      };
    }),
    customWords: String(cs.customWords || ''),
    customAsk: String(cs.customAsk || ''),
    customAskPos: cs.customAskPos === 'before' ? 'before' : 'after',
    topicText: String(cs.topicText || ''),
    unsure: cs.unsure === 'handoff' ? 'handoff' : 'ask',
    style: {
      tone: BOT_TONES.indexOf(st.tone) >= 0 ? st.tone : 'friendly',
      address: String(st.address || '').trim() || '您',
      emoji: BOT_EMOJI.indexOf(st.emoji) >= 0 ? st.emoji : 'some',
      maxLines: botInt_(st.maxLines, 2, 15, 5),
    },
    buttons: String(cs.buttons || ''),
    buttonsAlways: cs.buttonsAlways === true,
    web: {
      enabled: web.enabled === true,
      title: String(web.title || '').trim() || '線上客服',
      subtitle: String(web.subtitle || '').trim() || '有任何問題都可以問我',
      color: color,
      position: web.position === 'left' ? 'left' : 'right',
      autoOpen: web.autoOpen === true,
      allowedOrigins: String(web.allowedOrigins || ''),
    },
  };
}

/** 存進試算表的格式：topics 存成 { key: { on, words, ask, askPos } }（關鍵字跟預設一樣就不存） */
function botCsStored_(cs) {
  var out = Object.assign({}, cs);
  if (Array.isArray(cs.topics)) {
    out.topics = {};
    cs.topics.forEach(function (t) {
      out.topics[t.key] = { on: t.on, words: t.words === t.defaultWords ? '' : t.words, ask: t.ask, askPos: t.askPos };
    });
  }
  return out;
}

function botGeneral_() {
  var g = botCfg_('general', {}) || {};
  return {
    replyDelay: botInt_(g.replyDelay, 0, 10, 2), // 回覆最少等待秒數（像真人打字）
    botUrl: String(g.botUrl || ''),
    memory: { turns: botInt_((g.memory || {}).turns, 2, 40, 10), hours: botInt_((g.memory || {}).hours, 1, 6, 6), chars: botInt_((g.memory || {}).chars, 50, 2000, 600) },
  };
}

function botSettings_() {
  return botCsConfig_(botCfg_('cs', {}));
}

// ------------------------------------------------------------
// AI（依順序備援：第一個失敗就換下一個）
// ------------------------------------------------------------
/** 設定的 AI 清單（含金鑰，只給伺服器內部與 Bot 金鑰的呼叫用）。 */
function botAiList_() {
  var cfg = botCfg_('ai', {}) || {};
  var list = Array.isArray(cfg.models) ? cfg.models : [];
  var out = [];
  list.forEach(function (m) {
    if (!m || !m.apiKey) return;
    var def = BOT_AI_PROVIDERS[m.provider] || BOT_AI_PROVIDERS.gemini;
    var provider = BOT_AI_PROVIDERS[m.provider] ? m.provider : 'gemini';
    out.push({ source: 'bot', provider: provider, apiKey: String(m.apiKey), model: String(m.model || '').trim() || def.model, endpoint: String(m.endpoint || '').trim() || def.endpoint });
  });
  if (!out.length) {
    var key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
    if (key) out.push({ source: 'system', provider: 'gemini', apiKey: key, model: PropertiesService.getScriptProperties().getProperty('GEMINI_MODEL') || BOT_AI_PROVIDERS.gemini.model, endpoint: BOT_AI_PROVIDERS.gemini.endpoint });
  }
  return out;
}

/** 呼叫一個 AI（純文字，沒有工具）。messages：[{role:'user'|'assistant', text}]。失敗丟出錯誤。 */
function botCallAi_(cfg, system, messages) {
  var msgs = [];
  (messages || []).forEach(function (m) {
    var last = msgs[msgs.length - 1];
    if (!msgs.length && m.role !== 'user') return;
    if (last && last.role === m.role) last.text += '\n\n' + m.text;
    else msgs.push({ role: m.role, text: String(m.text || '') });
  });
  if (!msgs.length) throw new Error('沒有要送給 AI 的內容');
  var base = String(cfg.endpoint).replace(/\/+$/, '');
  var url, headers, payload, pick;
  if (cfg.provider === 'claude') {
    url = base + '/messages';
    headers = { 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' };
    payload = { model: cfg.model, max_tokens: 4096, system: system, messages: msgs.map(function (m) { return { role: m.role, content: m.text }; }) };
    pick = function (b) { return (b.content || []).filter(function (c) { return c.type === 'text'; }).map(function (c) { return c.text; }).join(''); };
  } else if (cfg.provider === 'openai') {
    url = base + '/chat/completions';
    headers = { Authorization: 'Bearer ' + cfg.apiKey };
    payload = { model: cfg.model, messages: [{ role: 'system', content: system }].concat(msgs.map(function (m) { return { role: m.role, content: m.text }; })) };
    pick = function (b) { return (((b.choices || [])[0] || {}).message || {}).content || ''; };
  } else {
    url = base + '/models/' + encodeURIComponent(cfg.model) + ':generateContent';
    headers = { 'x-goog-api-key': cfg.apiKey };
    payload = {
      systemInstruction: { parts: [{ text: system }] },
      contents: msgs.map(function (m) { return { role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.text }] }; }),
    };
    pick = function (b) { return (((((b.candidates || [])[0] || {}).content || {}).parts) || []).filter(function (p) { return !p.thought; }).map(function (p) { return p.text || ''; }).join(''); };
  }
  var res;
  try {
    res = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', headers: headers, muteHttpExceptions: true, payload: JSON.stringify(payload) });
  } catch (e) {
    throw new Error('無法連線到 AI 服務（' + (BOT_AI_PROVIDERS[cfg.provider] || {}).name + '），請確認 Endpoint 是否正確');
  }
  var body = {};
  try {
    body = JSON.parse(res.getContentText() || '{}');
  } catch (e) {
    // 非 JSON
  }
  var code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    var err = body.error;
    var msg = (err && (err.message || (typeof err === 'string' ? err : ''))) || 'HTTP ' + code;
    throw new Error('AI 服務錯誤（' + (BOT_AI_PROVIDERS[cfg.provider] || {}).name + ' ' + cfg.model + '）：' + String(msg).split(cfg.apiKey).join('••••').slice(0, 300));
  }
  return String(pick(body) || '').trim() || '（AI 沒有回應內容）';
}

/** 依順序試設定的 AI，第一個成功就回傳；全部失敗丟出最後一個錯誤。 */
function botGenerate_(system, messages) {
  var list = botAiList_();
  if (!list.length) throw new Error('尚未設定 AI：請到「BOT 設定 → AI 模型」填入 API Key');
  var lastErr = null;
  for (var i = 0; i < list.length; i++) {
    try {
      return botCallAi_(list[i], system, messages);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

// ------------------------------------------------------------
// Bot 金鑰：linebot（Vercel）用來呼叫這裡
// ------------------------------------------------------------
function botSecret_() {
  return PropertiesService.getScriptProperties().getProperty(BOT_SECRET_PROP) || '';
}

function handleBotApi(body) {
  var secret = botSecret_();
  var fail = function (msg, code) {
    return { success: false, message: msg, code: code };
  };
  if (!secret) return fail('機器人尚未啟用：請到「BOT 設定」產生 Bot 金鑰', 'BOT_OFF');
  // 比對雜湊值：長度固定，不會因為比對到第幾個字才不同而洩漏金鑰
  if (sha256('bot:' + String(body.secret || '')) !== sha256('bot:' + secret)) return fail('Bot 金鑰錯誤', 'BOT_AUTH');

  var op = String(body.op || '');
  if (body.botUrl) botLearnUrl_(body.botUrl);
  try {
    var data;
    if (op === 'csKnowledge') data = csKnowledge_();
    else if (op === 'csWidget') data = csWidgetConfig_();
    else {
      var id = String(body.lineUserId || '');
      if (!/^[UWV][0-9a-f]{32}$/.test(id) && !/^T[0-9a-f]{32}$/.test(id)) return fail('使用者編號格式錯誤');
      if (op === 'csStart') data = csStart_(id, body);
      else if (op === 'csRemember') data = csRemember_(id, body);
      else if (op === 'csForget') data = csForget_(id);
      else if (op === 'csHandoff') data = csHandoff_(id, body);
      else if (op === 'csMessages') data = csMessages_(id, body);
      else if (op === 'csThread') data = csThread_(id, body);
      else return fail('未知的 Bot 操作：' + op);
    }
    return { success: true, data: data };
  } catch (e) {
    return fail(e.message);
  }
}

/** 機器人回報自己的網址：BOT 設定還沒填「機器人網址」就自動記下。 */
function botLearnUrl_(url) {
  url = String(url || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(url) || url.length > 300 || botGeneral_().botUrl) return;
  var g = botCfg_('general', {}) || {};
  g.botUrl = url;
  botCfgSet_('general', g);
}

// ------------------------------------------------------------
// 客服機器人：給 linebot 的操作
// ------------------------------------------------------------
function botHistGen_() {
  try {
    return Number(PropertiesService.getScriptProperties().getProperty(BOT_GEN_PROP) || 0) || 0;
  } catch (e) {
    return 0;
  }
}

function csHistKey_(id) {
  var gen = botHistGen_();
  return 'csh:' + (gen ? gen + ':' : '') + id;
}

/** 現在是不是小編服務時間（跨夜的時段也可以，例如 22:00 ~ 02:00） */
function csInHours_(h, at) {
  var d = at || new Date();
  var hm = Utilities.formatDate(d, 'GMT+8', 'HH:mm');
  var u = Number(Utilities.formatDate(d, 'GMT+8', 'u')); // 1 = 週一 … 7 = 週日
  var day = u % 7; // 0 = 週日
  if (h.start <= h.end) return h.days.indexOf(day) >= 0 && hm >= h.start && hm < h.end;
  return (h.days.indexOf(day) >= 0 && hm >= h.start) || (h.days.indexOf((day + 6) % 7) >= 0 && hm < h.end);
}

function csHoursText_(h) {
  var names = '日一二三四五六';
  var days = h.days.slice().sort(function (a, b) { return ((a + 6) % 7) - ((b + 6) % 7); });
  var text = days.length === 7 ? '每天' : '週' + days.map(function (d) { return names[d]; }).join('、');
  return text + ' ' + h.start + '–' + h.end;
}

function csBrand_() {
  var g = botCfg_('general', {}) || {};
  return String(g.brand || '').trim() || '鑫堡股份有限公司';
}

function csStart_(id, req) {
  var channel = id.charAt(0) === 'V' ? 'web' : id.charAt(0) === 'T' ? 'test' : 'line';
  var cs = botSettings_();
  var gen = botGeneral_();
  var topics = cs.topics.filter(function (t) { return t.on; }).map(function (t) { return { name: t.name, words: botWords_(t.words), ask: t.ask, askPos: t.askPos }; });
  var custom = botWords_(cs.customWords);
  if (custom.length) topics.push({ name: '其他指定問題', words: custom, ask: cs.customAsk, askPos: cs.customAskPos });

  var ais = botAiList_();
  var enabled = channel === 'line' ? cs.enabled : channel === 'web' ? cs.enabled && cs.web.enabled : true;
  var rateLimited = false;
  if (channel === 'web') {
    var rk = 'csrate:' + id;
    var n = Number(botCache_().get(rk) || 0) + 1;
    botCachePut_(rk, n, 60);
    rateLimited = n > 12; // 每個訪客每分鐘最多 12 則
  }
  return {
    enabled: enabled,
    channel: channel,
    appName: csBrand_(),
    brand: csBrand_(),
    welcome: cs.welcome,
    replyDelay: gen.replyDelay,
    prompt: cs.prompt,
    handoffText: cs.handoffText,
    ai: ais.length ? ais[0] : null,
    aiFallback: ais.slice(1),
    history: botCacheGet_(csHistKey_(id)) || [],
    known: !!botCache_().get('csname:' + id),
    paused: !!botCache_().get('cspause:' + id),
    rateLimited: rateLimited,
    replyWhen: cs.replyWhen,
    inHours: cs.hours.enabled ? csInHours_(cs.hours) : null,
    hoursText: cs.hours.enabled ? csHoursText_(cs.hours) : '',
    offText: cs.hours.offText,
    handoffWords: botWords_(cs.handoffWords),
    topics: topics,
    topicText: cs.topicText,
    unsure: cs.unsure,
    style: cs.style,
    buttons: botButtons_(cs.buttons),
    buttonsAlways: cs.buttonsAlways,
  };
}

/** 記錄這一輪對話：短期記憶（快取）+ 對話紀錄（BotMessages）。turns：[{u:true, t:客人說的}, {u:false, t:機器人回的}] */
function csRemember_(id, req) {
  var channel = id.charAt(0) === 'V' ? 'web' : id.charAt(0) === 'T' ? 'test' : 'line';
  var name = botClip_(req.displayName, 40);
  if (name) botCachePut_('csname:' + id, name, 21600);
  var m = botGeneral_().memory;
  var add = (Array.isArray(req.turns) ? req.turns : [])
    .map(function (x) { return { u: !!(x && x.u === true), t: String((x && x.t) || '').trim().slice(0, m.chars) }; })
    .filter(function (x) { return x.t; });
  var list = (botCacheGet_(csHistKey_(id)) || []).concat(add).slice(-m.turns);
  botCachePut_(csHistKey_(id), list, m.hours * 3600);
  if (channel !== 'test') botLogTurns_(channel, id, name || String(botCacheGet_('csname:' + id) || ''), add.map(function (x) { return { role: x.u ? 'user' : 'bot', text: String(x.t) }; }), String(req.topic || ''));
  return list.length;
}

function csForget_(id) {
  botCacheRemove_([csHistKey_(id)]);
  // 對話紀錄裡記一筆「重新開始」：網站視窗重新整理後不再顯示這之前的對話
  if (id.charAt(0) !== 'T') botLogTurns_(id.charAt(0) === 'V' ? 'web' : 'line', id, '', [{ role: 'reset', text: '（客人重新開始對話）' }], '');
  return csResume_(id);
}

// ---- 對話紀錄（BotMessages） ----
function botNextMsgId_() {
  var sheet = getSheet(SHEET_BOT_MSG);
  var last = sheet.getLastRow();
  if (last < 2) return 1;
  return (Number(sheet.getRange(last, 1).getValue()) || 0) + 1;
}

/** 一次寫入多筆對話紀錄；超過上限就刪最舊的。 */
function botLogTurns_(channel, userId, name, items, topic) {
  if (!items.length) return;
  withLock_(function () {
    var sheet = getSheet(SHEET_BOT_MSG);
    var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var id = botNextMsgId_();
    var t = botNow_();
    var rows = items.map(function (x, i) {
      var o = { ID: id + i, Time: t, Channel: channel, UserId: userId, Name: name, Role: x.role, Text: String(x.text).slice(0, 3000), Topic: x.role === 'user' ? '' : topic };
      return header.map(function (h) { return o.hasOwnProperty(h) ? o[h] : ''; });
    });
    var start = sheet.getLastRow() + 1;
    ensureRows_(sheet, start + rows.length - 1);
    var range = sheet.getRange(start, 1, rows.length, header.length);
    range.setNumberFormat('@');
    range.setValues(rows);
    var total = sheet.getLastRow() - 1;
    if (total > BOT_LOG_MAX + 300) sheet.deleteRows(2, total - BOT_LOG_MAX);
  });
}

// ---- 轉真人 / 小編接手 ----
function csPauseList_() {
  return (botCacheGet_('cspauses') || []).filter(function (p) { return p.until > Date.now(); });
}

function csPause_(id, name, minutes) {
  botCachePut_('cspause:' + id, 1, minutes * 60);
  withLock_(function () {
    var list = csPauseList_().filter(function (p) { return p.id !== id; });
    list.push({ id: id, name: name || '客人', at: botNow_(), until: Date.now() + minutes * 60000 });
    botCachePut_('cspauses', list.slice(-200), 21600);
  });
}

/** 恢復機器人：解除暫停；下次再找真人會重新通知。 */
function csResume_(id) {
  botCacheRemove_(['cspause:' + id, 'csho:' + id]);
  withLock_(function () {
    botCachePut_('cspauses', csPauseList_().filter(function (p) { return p.id !== id; }), 21600);
  });
  return true;
}

/**
 * 客人要找真人：首頁備忘錄通知（只有有「BOT 設定」權限的人看得到，附上最近的對話；同一位客人 30 分鐘內只通知一次）；
 * 設定「轉真人後暫停」時，這段時間機器人不回這位客人。提早恢復：備忘錄刪除、BOT 設定按「恢復機器人」、客人說「重新開始」。
 */
function csHandoff_(id, req) {
  var pause = botSettings_().pauseMinutes;
  var name = botClip_(req.displayName, 40) || String(botCacheGet_('csname:' + id) || '');
  if (pause > 0) csPause_(id, name, pause);
  if (botCache_().get('csho:' + id)) return false;
  botCachePut_('csho:' + id, 1, 1800);

  var topic = botClip_(req.topic, 40);
  var recent = (botCacheGet_(csHistKey_(id)) || []).slice(-6).map(function (x) { return (x.u ? '客人：' : '機器人：') + String(x.t || '').slice(0, 150); });
  var channelText = id.charAt(0) === 'V' ? '網站訪客' : 'LINE 客人';
  var today = todayStr();
  appendObjectRow(SHEET_MEMOS, {
    Owner: 'SYSTEM',
    OwnerName: '客服機器人',
    Title: '🛎️ 客人找真人：' + (name || channelText) + (topic ? '（' + topic + '）' : ''),
    Content:
      '客人說：' + String(req.text || '').slice(0, 300) +
      (recent.length ? '\n\n【之前的對話】\n' + recent.join('\n') : '') +
      '\n\n' + (id.charAt(0) === 'V' ? '請到「BOT 設定 → 對話與小編接手」回覆這位網站訪客' : '請到 LINE 官方帳號後台（LINE Official Account Manager）回覆') +
      (pause > 0 ? '；機器人 ' + pause + ' 分鐘內不會回這位客人' : '') +
      '\n處理完了把這則備忘錄刪除，機器人就會恢復回覆這位客人。',
    Shared: '是',
    CreatedDate: today,
    LastUpdated: today,
    LinkType: 'csHandoff',
    LinkId: id,
    NeedBlock: 'bot',
  });
  return true;
}

/**
 * 網站訪客視窗用：這位訪客的對話（只算最後一次「重新開始」之後的）。
 * after = 最後一則的編號：只回比它新的（輪詢小編的回覆）；不帶 = 最近 40 則（重新整理後還原）。
 */
function csThread_(id, req) {
  var after = Number(req.after) || 0;
  var sheet = getSheet(SHEET_BOT_MSG);
  var last = sheet.getLastRow();
  var rows = [];
  if (last >= 2) {
    var from = Math.max(2, last - 400);
    sheet.getRange(from, 1, last - from + 1, 8).getValues().forEach(function (r) {
      if (String(r[3]) !== id) return;
      if (r[5] === 'reset') rows = [];
      else rows.push({ id: Number(r[0]), role: String(r[5]) === 'human' ? 'human' : String(r[5]) === 'bot' ? 'bot' : 'user', text: String(r[6]) });
    });
  }
  if (after > 0) rows = rows.filter(function (m) { return m.id > after; });
  else rows = rows.slice(-40);
  return { messages: rows, paused: !!botCache_().get('cspause:' + id) };
}

/** 網站訪客視窗輪詢：小編（真人）在後台回覆的訊息，以及現在是不是小編接手中。 */
function csMessages_(id, req) {
  var after = Number(req.after) || 0;
  var sheet = getSheet(SHEET_BOT_MSG);
  var last = sheet.getLastRow();
  var out = [];
  if (last >= 2) {
    var from = Math.max(2, last - 150);
    sheet.getRange(from, 1, last - from + 1, 8).getValues().forEach(function (r) {
      if (String(r[3]) === id && r[5] === 'human' && Number(r[0]) > after) out.push({ id: Number(r[0]), text: String(r[6]) });
    });
  }
  return { messages: out, paused: !!botCache_().get('cspause:' + id) };
}

// ---- 知識庫（RAG 的資料來源；機器人端再做檢索） ----
function botChunkText_(text, size) {
  var paras = String(text || '').split(/\n{2,}/).map(function (p) { return p.trim(); }).filter(Boolean);
  var out = [];
  var cur = '';
  paras.forEach(function (p) {
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
    } else {
      cur = cur ? cur + '\n' + p : p;
    }
  });
  if (cur) out.push(cur);
  return out;
}

/** 產品放進知識庫的文字：型號、品牌、類別與選型規格（不含底價、供應商與任何內部資料）。 */
function botProductText_(p) {
  var t = function (v) { return String(v === null || v === undefined ? '' : v).trim(); };
  var model = t(p['InternalModel']) || t(p['SupplierModel']);
  var lines = ['產品型號：' + model + (t(p['SupplierModel']) && t(p['SupplierModel']) !== model ? '（原廠型號 ' + t(p['SupplierModel']) + '）' : '')];
  [['類別', 'Category'], ['品牌', 'Brand'], ['介面', 'Interface'], ['解析度', 'Resolution'], ['像元尺寸 µm', 'PixelSize'], ['靶面', 'SensorSize'], ['影格率 fps', 'FPS'], ['接口', 'Mount'], ['焦距 mm', 'FocalLength'], ['放大倍率', 'Magnification'], ['工作距離 WD', 'WD'], ['景深 DOF', 'DOF'], ['最近對焦距離', 'FocusWD']].forEach(function (f) {
    var v = t(p[f[1]]);
    if (v && v.indexOf('不納入選型') < 0) lines.push(f[0] + '：' + v);
  });
  return lines.join('\n');
}

function csKnowledge_() {
  var cs = botSettings_();
  var out = [];
  var text = function (v) { return String(v === null || v === undefined ? '' : v).trim(); };
  if (cs.sources.qa) {
    sheetToObjects(SHEET_BOT_KB).rows.forEach(function (k) {
      if (k['IsActive'] === false || String(k['IsActive']).toUpperCase() === 'FALSE') return;
      out.push({
        id: 'k' + k['ID'],
        source: k['Type'] === 'doc' ? '文件' : '常見問題',
        title: text(k['Title']) || text(k['Question']),
        text: [k['Question'] ? '問：' + text(k['Question']) : '', k['Question'] ? '答：' + text(k['Content']) : text(k['Content']), k['Tags'] ? '關鍵字：' + text(k['Tags']) : ''].filter(Boolean).join('\n'),
      });
    });
  }
  if (cs.sources.brand && text(cs.brandInfo)) {
    botChunkText_(cs.brandInfo, 500).forEach(function (c, i) {
      out.push({ id: 'b' + i, source: '公司資訊', title: '公司資訊', text: c });
    });
  }
  if (cs.sources.products) {
    var n = 0;
    readProductsLite_().rows.forEach(function (p) {
      if (n >= cs.sources.productLimit) return;
      var model = text(p['InternalModel']) || text(p['SupplierModel']);
      if (!model) return;
      n++;
      out.push({ id: 'p' + n, source: '產品', title: model, text: botProductText_(p) });
    });
  }
  return out;
}

/** 網站嵌入視窗的公開設定（外觀、歡迎詞、按鈕、允許嵌入的網站）；沒有任何金鑰。 */
function csWidgetConfig_() {
  var cs = botSettings_();
  return {
    enabled: cs.enabled && cs.web.enabled,
    title: cs.web.title,
    subtitle: cs.web.subtitle,
    color: cs.web.color,
    position: cs.web.position,
    autoOpen: cs.web.autoOpen,
    allowedOrigins: cs.web.allowedOrigins,
    welcome: cs.welcome || '👋 您好，我是' + csBrand_() + '的線上客服，有任何問題都可以直接問我；需要專人協助請輸入「' + (botWords_(cs.handoffWords)[0] || '真人') + '」。',
    buttons: botButtons_(cs.buttons),
    replyDelay: botGeneral_().replyDelay,
  };
}

// ------------------------------------------------------------
// BOT 設定頁（需要「BOT 設定」權限）
// ------------------------------------------------------------
function botKeyHint_() {
  var s = botSecret_();
  return s ? '••••' + s.slice(-4) : '';
}

function botMaskedAi_() {
  var cfg = botCfg_('ai', {}) || {};
  var list = Array.isArray(cfg.models) ? cfg.models : [];
  return list.map(function (m) {
    var def = BOT_AI_PROVIDERS[m.provider] || BOT_AI_PROVIDERS.gemini;
    return { provider: BOT_AI_PROVIDERS[m.provider] ? m.provider : 'gemini', model: String(m.model || ''), endpoint: String(m.endpoint || ''), hasKey: !!m.apiKey, keyHint: m.apiKey ? '••••' + String(m.apiKey).slice(-4) : '', defaultModel: def.model };
  });
}

function handleBotGetSettings(body) {
  var cs = botSettings_();
  var gen = botGeneral_();
  var url = '';
  try {
    url = ScriptApp.getService().getUrl() || '';
  } catch (e) {
    url = '';
  }
  var ais = botAiList_();
  var kbCount = Math.max(0, getSheet(SHEET_BOT_KB).getLastRow() - 1);
  return {
    success: true,
    cs: cs,
    general: { replyDelay: gen.replyDelay, botUrl: gen.botUrl, brand: csBrand_(), memory: gen.memory },
    ai: botMaskedAi_(),
    aiProviders: BOT_AI_PROVIDERS,
    aiUsing: ais.length ? { source: ais[0].source, name: BOT_AI_PROVIDERS[ais[0].provider].name, model: ais[0].model, count: ais.length } : null,
    keyHint: botKeyHint_(),
    hasKey: !!botSecret_(),
    gasUrl: url,
    kbCount: kbCount,
    pauses: csPauseList_(),
    topicDefaults: BOT_CS_TOPICS,
  };
}

function handleBotSaveSettings(body) {
  return withLock_(function () {
    if (body.cs) {
      var cs = body.cs;
      // 表單送上來的 topics 是陣列 [{key,on,words,ask,askPos}]：轉成存檔格式再整理
      var stored = Object.assign({}, cs);
      if (Array.isArray(cs.topics)) {
        stored.topics = {};
        cs.topics.forEach(function (t) {
          stored.topics[t.key] = { on: t.on === true, words: t.words, ask: t.ask, askPos: t.askPos };
        });
      }
      var clean = botCsConfig_(stored);
      botCfgSet_('cs', botCsStored_(clean));
    }
    if (body.general) {
      var g = botCfg_('general', {}) || {};
      var gg = body.general;
      if (gg.replyDelay !== undefined) g.replyDelay = botInt_(gg.replyDelay, 0, 10, 2);
      if (gg.botUrl !== undefined) {
        var u = String(gg.botUrl || '').trim().replace(/\/+$/, '');
        if (u && !/^https:\/\/[a-z0-9.-]+(:\d+)?(\/[^\s]*)?$/i.test(u)) throw new Error('機器人網址格式不對（要是 https://你的專案.vercel.app）');
        g.botUrl = u;
      }
      if (gg.brand !== undefined) g.brand = botClip_(gg.brand, 60);
      if (gg.memory) g.memory = { turns: botInt_(gg.memory.turns, 2, 40, 10), hours: botInt_(gg.memory.hours, 1, 6, 6), chars: botInt_(gg.memory.chars, 50, 2000, 600) };
      botCfgSet_('general', g);
    }
    return { success: true };
  });
}

/** 儲存 AI 模型清單（依順序備援）。每一筆金鑰留空 = 沿用原本同一位置、同一服務的金鑰。 */
function handleBotSaveAi(body) {
  return withLock_(function () {
    var old = (botCfg_('ai', {}) || {}).models || [];
    var models = [];
    (Array.isArray(body.models) ? body.models : []).slice(0, 5).forEach(function (m, i) {
      if (!m) return;
      var provider = BOT_AI_PROVIDERS[m.provider] ? m.provider : 'gemini';
      var key = String(m.apiKey || '').trim();
      if (!key && old[i] && old[i].provider === provider) key = old[i].apiKey || '';
      if (!key) return; // 沒有金鑰的列略過
      var endpoint = String(m.endpoint || '').trim();
      if (endpoint && !/^https:\/\//i.test(endpoint)) throw new Error('Endpoint 要用 https:// 開頭');
      models.push({ provider: provider, apiKey: key, model: String(m.model || '').trim(), endpoint: endpoint });
    });
    botCfgSet_('ai', { models: models });
    return { success: true, ai: botMaskedAi_() };
  });
}

/** 用目前存的第 index 個 AI 發一句話測試（金鑰不會出現在回傳）。 */
function handleBotTestAi(body) {
  var list = botAiList_();
  var i = Number(body.index) || 0;
  if (!list.length) return { success: false, message: '還沒有設定 AI（或金鑰是空的）' };
  if (!list[i]) return { success: false, message: '沒有第 ' + (i + 1) + ' 個 AI 模型' };
  try {
    var t0 = Date.now();
    var text = botCallAi_(list[i], '你是測試助理，請用繁體中文只回覆兩個字：成功。', [{ role: 'user', text: '測試' }]);
    return { success: true, reply: text.slice(0, 100), ms: Date.now() - t0, model: list[i].model, provider: BOT_AI_PROVIDERS[list[i].provider].name };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

function botKbRows_() {
  return sheetToObjects(SHEET_BOT_KB).rows.map(function (r, i) {
    return {
      RowIndex: i + 2,
      ID: Number(r['ID']) || 0,
      Type: r['Type'] === 'doc' ? 'doc' : 'qa',
      Title: String(r['Title'] || ''),
      Question: String(r['Question'] || ''),
      Content: String(r['Content'] || ''),
      Tags: String(r['Tags'] || ''),
      Source: String(r['Source'] || ''),
      IsActive: !(r['IsActive'] === false || String(r['IsActive']).toUpperCase() === 'FALSE'),
      UpdatedAt: String(r['UpdatedAt'] || ''),
    };
  });
}

function handleBotKbList(body) {
  return { success: true, items: botKbRows_() };
}

function botNextKbId_() {
  var max = 0;
  sheetToObjects(SHEET_BOT_KB).rows.forEach(function (r) {
    max = Math.max(max, Number(r['ID']) || 0);
  });
  return max + 1;
}

function handleBotKbSave(body) {
  var type = body.type === 'doc' ? 'doc' : 'qa';
  var content = String(body.content || '').trim();
  var question = String(body.question || '').trim();
  var title = String(body.title || '').trim();
  if (type === 'qa' && !question) return { success: false, message: '請填問題' };
  if (!content) return { success: false, message: '請填內容 / 答案' };
  if (content.length > 20000) return { success: false, message: '內容太長了（上限 20000 字），長文件請用「文件」匯入，會自動切成小段' };
  return withLock_(function () {
    var fields = { Type: type, Title: title || (type === 'qa' ? question.slice(0, 40) : content.slice(0, 20)), Question: type === 'qa' ? question : '', Content: content, Tags: String(body.tags || '').trim(), Source: String(body.source || ''), IsActive: body.isActive === false ? false : true, UpdatedAt: botNow_() };
    if (body.rowIndex) {
      var sheet = getSheet(SHEET_BOT_KB);
      var rowNum = Number(body.rowIndex);
      if (!(rowNum >= 2 && rowNum <= sheet.getLastRow()) || Number(sheet.getRange(rowNum, 1).getValue()) !== Number(body.id)) return { success: false, message: '這筆資料已經被修改或刪除，請重新整理後再試' };
      updateRowFields(SHEET_BOT_KB, rowNum, fields);
    } else {
      appendObjectRow(SHEET_BOT_KB, Object.assign({ ID: botNextKbId_() }, fields));
    }
    return { success: true };
  });
}

/** 匯入文件：rows = [{ title, content, source, tags }]（前端已經切好段），一次寫入。 */
function handleBotKbImport(body) {
  var rows = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length) return { success: false, message: '沒有要匯入的內容' };
  if (rows.length > 400) return { success: false, message: '一次最多匯入 400 段，請分批匯入' };
  return withLock_(function () {
    var sheet = getSheet(SHEET_BOT_KB);
    var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var id = botNextKbId_();
    var t = botNow_();
    var values = [];
    rows.forEach(function (r) {
      var content = String(r.content || '').trim().slice(0, 20000);
      if (!content) return;
      var o = { ID: id++, Type: 'doc', Title: String(r.title || '').trim().slice(0, 120) || content.slice(0, 20), Question: '', Content: content, Tags: String(r.tags || ''), Source: String(r.source || '').slice(0, 120), IsActive: true, UpdatedAt: t };
      values.push(header.map(function (h) { return o.hasOwnProperty(h) ? o[h] : ''; }));
    });
    if (!values.length) return { success: false, message: '沒有可匯入的內容' };
    var start = sheet.getLastRow() + 1;
    ensureRows_(sheet, start + values.length - 1);
    sheet.getRange(start, 1, values.length, header.length).setValues(values);
    return { success: true, count: values.length };
  });
}

/** 刪除知識庫項目：ids = ID 陣列；或 source = 整份文件（同一個來源名稱的全部段落）。 */
function handleBotKbDelete(body) {
  return withLock_(function () {
    var sheet = getSheet(SHEET_BOT_KB);
    var data = sheet.getDataRange().getValues();
    var h = data[0];
    var idCol = h.indexOf('ID');
    var srcCol = h.indexOf('Source');
    var ids = {};
    (body.ids || []).forEach(function (x) { ids[String(x)] = true; });
    var source = body.source ? String(body.source) : '';
    var n = 0;
    for (var i = data.length - 1; i >= 1; i--) {
      if (ids[String(data[i][idCol])] || (source && String(data[i][srcCol]) === source)) {
        sheet.deleteRow(i + 1);
        n++;
      }
    }
    return { success: true, deleted: n };
  });
}

function handleBotGenKey(body) {
  var key = botRandomKey_();
  PropertiesService.getScriptProperties().setProperty(BOT_SECRET_PROP, key);
  return { success: true, key: key, keyHint: botKeyHint_() };
}

function handleBotRevealKey(body) {
  var s = botSecret_();
  if (!s) return { success: false, message: '還沒有產生 Bot 金鑰' };
  return { success: true, key: s };
}

/** 對話列表：依客人分組（最近 N 筆紀錄），含最後一句、是否小編接手中。 */
function handleBotConversations(body) {
  var sheet = getSheet(SHEET_BOT_MSG);
  var last = sheet.getLastRow();
  var groups = {};
  var order = [];
  if (last >= 2) {
    var from = Math.max(2, last - 799);
    sheet.getRange(from, 1, last - from + 1, 8).getValues().forEach(function (r) {
      var id = String(r[3]);
      if (!id) return;
      if (!groups[id]) {
        groups[id] = { id: id, name: '', channel: String(r[2]), count: 0, lastAt: '', lastText: '', lastRole: '', topic: '' };
        order.push(id);
      }
      var g = groups[id];
      g.count++;
      if (r[4]) g.name = String(r[4]);
      g.lastAt = String(r[1]);
      g.lastText = String(r[6]).slice(0, 80);
      g.lastRole = String(r[5]);
      if (r[7]) g.topic = String(r[7]);
    });
  }
  var paused = {};
  csPauseList_().forEach(function (p) { paused[p.id] = p; });
  var list = order.map(function (id) { return Object.assign(groups[id], { paused: !!paused[id] }); });
  list.sort(function (a, b) { return String(b.lastAt).localeCompare(String(a.lastAt)); });
  return { success: true, conversations: list.slice(0, 100), pauses: csPauseList_(), total: Math.max(0, last - 1), max: BOT_LOG_MAX };
}

function handleBotThread(body) {
  var id = String(body.userId || '');
  if (!id) return { success: false, message: '缺少客人編號' };
  var sheet = getSheet(SHEET_BOT_MSG);
  var last = sheet.getLastRow();
  var out = [];
  if (last >= 2) {
    sheet.getRange(2, 1, last - 1, 8).getValues().forEach(function (r) {
      if (String(r[3]) === id) out.push({ id: Number(r[0]), time: String(r[1]), channel: String(r[2]), name: String(r[4]), role: String(r[5]), text: String(r[6]), topic: String(r[7]) });
    });
  }
  return { success: true, messages: out.slice(-150), paused: !!botCache_().get('cspause:' + id) };
}

/** 小編在後台回覆網站訪客：存成「真人」訊息，訪客視窗輪詢時會看到；LINE 客人請到官方帳號後台回覆。 */
function handleBotHumanReply(body) {
  var id = String(body.userId || '');
  var text = String(body.text || '').trim();
  if (id.charAt(0) !== 'V') return { success: false, message: 'LINE 客人請到 LINE 官方帳號後台（Official Account Manager）回覆；這裡只能回覆網站訪客' };
  if (!text) return { success: false, message: '請輸入回覆內容' };
  botLogTurns_('web', id, '', [{ role: 'human', text: text.slice(0, 1500) }], '');
  // 機器人之後接手時，看得到小編說過什麼
  var m = botGeneral_().memory;
  var list = (botCacheGet_(csHistKey_(id)) || []).concat([{ u: false, t: '（小編）' + text.slice(0, m.chars) }]).slice(-m.turns);
  botCachePut_(csHistKey_(id), list, m.hours * 3600);
  return { success: true };
}

function handleBotResume(body) {
  csResume_(String(body.userId || ''));
  return { success: true, pauses: csPauseList_() };
}

/** 後台「測試聊天」用：簽一個 5 分鐘有效的權杖給 linebot（用 Bot 金鑰簽，瀏覽器看不到金鑰）。 */
function handleBotTestToken(body) {
  var secret = botSecret_();
  if (!secret) return { success: false, message: '請先產生 Bot 金鑰' };
  var url = botGeneral_().botUrl;
  if (!url) return { success: false, message: '請先填「機器人網址」（Vercel 專案網址）' };
  var ts = String(Date.now());
  var sig = Utilities.computeHmacSha256Signature(ts, secret).map(function (b) { return ('0' + (b < 0 ? b + 256 : b).toString(16)).slice(-2); }).join('');
  return { success: true, url: url, ts: ts, sig: sig, testId: 'T' + sha256('t:' + body._user.username).slice(0, 32) };
}

/**
 * 清除對話資料（只有系統管理員）：
 *   history 所有客人的短期記憶（最近對話）、pauses 小編接手中全部恢復、memos 首頁「客人找真人」通知（none / done / all，這裡 done = all）、
 *   messages 對話紀錄（all 全部 / 指定客人編號）。先回報筆數（dryRun）再真的清除。
 */
function handleBotClear(body) {
  var opts = body.options || {};
  var result = { messages: 0, memos: 0, pauses: csPauseList_().length };
  var sheet = getSheet(SHEET_BOT_MSG);
  var data = sheet.getDataRange().getValues();
  var target = String(opts.target || '');
  var delRows = [];
  if (opts.messages) {
    for (var i = 1; i < data.length; i++) if (!target || String(data[i][3]) === target) delRows.push(i + 1);
  }
  result.messages = delRows.length;
  var memoSheet = getSheet(SHEET_MEMOS);
  var memoRows = [];
  if (opts.memos) {
    var md = memoSheet.getDataRange().getValues();
    var lt = md[0].indexOf('LinkType');
    var li = md[0].indexOf('LinkId');
    for (var j = 1; j < md.length; j++) if (lt > -1 && md[j][lt] === 'csHandoff' && (!target || String(md[j][li]) === target)) memoRows.push(j + 1);
  }
  result.memos = memoRows.length;
  if (body.dryRun) return { success: true, dryRun: true, counts: result };
  return withLock_(function () {
    for (var a = delRows.length - 1; a >= 0; a--) sheet.deleteRow(delRows[a]);
    for (var b = memoRows.length - 1; b >= 0; b--) memoSheet.deleteRow(memoRows[b]);
    if (opts.history) {
      if (target) botCacheRemove_([csHistKey_(target)]);
      else PropertiesService.getScriptProperties().setProperty(BOT_GEN_PROP, String(botHistGen_() + 1));
    }
    if (opts.pauses) {
      if (target) csResume_(target);
      else {
        csPauseList_().forEach(function (p) { csResume_(p.id); });
      }
    }
    return { success: true, counts: result };
  });
}

/** setup 時順便做的事：BotConfig 預設的公司名稱。 */
function botSetup_(log) {
  var g = botCfg_('general', null);
  if (!g) {
    botCfgSet_('general', { replyDelay: 2, botUrl: '', brand: '鑫堡股份有限公司' });
    if (log) log.push('BOT 設定：已建立預設設定（請到「BOT 設定」頁完成 AI、知識庫與 LINE 設定）');
  }
}
