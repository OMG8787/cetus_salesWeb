/**
 * ============================================================
 * Copy.gs - 文案製作（選用模組）
 * ------------------------------------------------------------
 * 社群 / 長文文案：選平台與主題 → 確認提示詞 → AI 產生 → 套用、改寫、儲存。
 * 提示詞在瀏覽器組好（讓使用者看過、可微調才送出），這裡只負責：
 *   - 存文案（CopyPosts）、素材庫（CopyLibrary：人設 / 發文風格 / 固定結尾）、AI 學習風格與文案專用 AI 模型（CopyConfig）
 *   - 呼叫 AI（文案專用模型依序備援；沒設定就沿用「BOT 設定 → AI 模型」）
 *   - 匯入 CetusSalesAgent 發文助手的 settings.json / data.json
 * AI 的呼叫函式在 Bot.gs（botCallAi_），所以要跟 Bot.gs 一起貼上。
 * 權限區塊 copy：查看 = 看文案 / 素材（可複製）；編輯 = 產生、儲存、改素材；刪除只有系統管理員。
 * ============================================================
 */

var SHEET_COPY_POSTS = 'CopyPosts';
var SHEET_COPY_LIB = 'CopyLibrary';
var SHEET_COPY_CFG = 'CopyConfig';

var COPY_PLATFORMS = ['Threads', 'Instagram', 'Facebook', 'X', 'LINE', 'YouTube', '方格子'];
var COPY_STATUS = ['draft', 'scheduled', 'posted'];
var COPY_KINDS = ['prompt', 'style', 'ending'];
var COPY_EVENT_FIELDS = ['theme', 'host', 'cohost', 'address', 'landmark', 'promo'];
var COPY_MAX_PROMPT = 40000;
var COPY_CELL_MAX = 49000;

function copySchema_() {
  return {
    schema: {
      CopyPosts: ['ID', 'Platform', 'Topic', 'Keywords', 'Tone', 'Marketing', 'EventJson', 'Content', 'Note', 'Status', 'ScheduledFor', 'Liked', 'CreatedBy', 'CreatedAt', 'UpdatedAt'],
      CopyLibrary: ['ID', 'Kind', 'Name', 'Text', 'Platform', 'Enabled'],
      CopyConfig: ['Key', 'Value'],
    },
    text: { CopyPosts: ['ScheduledFor'], CopyLibrary: [], CopyConfig: [] },
  };
}

function copyPerms_() {
  return {
    copyGetData: ['copy', 'r'],
    copySavePost: ['copy', 'w'], copySetLiked: ['copy', 'w'], copyGenerate: ['copy', 'w'], copySaveLib: ['copy', 'w'], copyToggleLib: ['copy', 'w'],
    copyImport: ['copy', 'w'], copySaveStyle: ['copy', 'w'], copySaveModels: ['copy', 'w'], copyTestModel: ['copy', 'w'],
    copyDeletePost: ['copy', 'd'], copyDeleteLib: ['copy', 'd'],
  };
}

function copyRoutes_() {
  return {
    copyGetData: { auth: true, fn: handleCopyGetData },
    copySavePost: { auth: true, fn: handleCopySavePost },
    copySetLiked: { auth: true, fn: handleCopySetLiked },
    copyDeletePost: { auth: true, fn: handleCopyDeletePost },
    copyGenerate: { auth: true, fn: handleCopyGenerate },
    copySaveLib: { auth: true, fn: handleCopySaveLib },
    copyToggleLib: { auth: true, fn: handleCopyToggleLib },
    copyDeleteLib: { auth: true, fn: handleCopyDeleteLib },
    copyImport: { auth: true, fn: handleCopyImport },
    copySaveStyle: { auth: true, fn: handleCopySaveStyle },
    copySaveModels: { auth: true, fn: handleCopySaveModels },
    copyTestModel: { auth: true, fn: handleCopyTestModel },
  };
}

// ------------------------------------------------------------
// 小工具
// ------------------------------------------------------------
function copyNow_() {
  return Utilities.formatDate(new Date(), 'GMT+8', 'yyyy-MM-dd HH:mm:ss');
}

function copyClip_(v, n) {
  var t = String(v == null ? '' : v);
  return t.length > n ? t.slice(0, n) : t;
}

function copyIsTrue_(v) {
  return v === true || String(v).toUpperCase() === 'TRUE';
}

function copyCfgGet_(key, def) {
  var rows = sheetToObjects(SHEET_COPY_CFG).rows;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i]['Key'] === key) {
      try {
        var v = JSON.parse(String(rows[i]['Value'] || 'null'));
        return v === null || v === undefined ? def : v;
      } catch (e) {
        return def;
      }
    }
  }
  return def;
}

function copyCfgSet_(key, value) {
  withLock_(function () {
    var sheet = getSheet(SHEET_COPY_CFG);
    var data = sheet.getDataRange().getValues();
    var json = JSON.stringify(value);
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === key) {
        sheet.getRange(i + 1, 2).setValue(json);
        return;
      }
    }
    appendObjectRow(SHEET_COPY_CFG, { Key: key, Value: json });
  });
}

function copyNextId_(sheetName) {
  var max = 0;
  sheetToObjects(sheetName).rows.forEach(function (r) {
    max = Math.max(max, Number(r['ID']) || 0);
  });
  return max + 1;
}

// ------------------------------------------------------------
// 文案
// ------------------------------------------------------------
function copyCleanEvent_(input) {
  var raw = input && typeof input === 'object' ? input : {};
  var schedule = (Array.isArray(raw.schedule) ? raw.schedule : [])
    .map(function (r) { return { date: copyClip_((r || {}).date, 40), time: copyClip_((r || {}).time, 40) }; })
    .slice(0, 31);
  var out = { schedule: schedule.length ? schedule : [{ date: '', time: '' }] };
  COPY_EVENT_FIELDS.forEach(function (k) { out[k] = copyClip_(raw[k], 200); });
  return out;
}

/** 整理一篇文案的輸入；回傳要寫進試算表的欄位。 */
function copyCleanPost_(p) {
  p = p || {};
  var platform = COPY_PLATFORMS.indexOf(p.platform) > -1 ? p.platform : 'Threads';
  var status = COPY_STATUS.indexOf(p.status) > -1 ? p.status : 'draft';
  var when = String(p.scheduled_for || '').slice(0, 10);
  var marketing = (Array.isArray(p.marketing) ? p.marketing : []).map(String).filter(function (k) { return /^[a-z]{2,12}$/.test(k); }).slice(0, 20);
  return {
    Platform: platform,
    Topic: copyClip_(p.topic, 2000),
    Keywords: copyClip_(p.keywords, 300),
    Tone: copyClip_(p.tone, 40),
    Marketing: marketing.join(','),
    EventJson: JSON.stringify(copyCleanEvent_(p.event)),
    Content: copyClip_(p.content, COPY_CELL_MAX),
    Note: copyClip_(p.note, 300),
    Status: status,
    ScheduledFor: /^\d{4}-\d{2}-\d{2}$/.test(when) ? when : '',
  };
}

function copyPostOut_(r) {
  var ev;
  try {
    ev = copyCleanEvent_(JSON.parse(String(r['EventJson'] || '{}')));
  } catch (e) {
    ev = copyCleanEvent_({});
  }
  return {
    id: Number(r['ID']) || 0,
    platform: String(r['Platform'] || 'Threads'),
    topic: String(r['Topic'] || ''),
    keywords: String(r['Keywords'] || ''),
    tone: String(r['Tone'] || ''),
    marketing: String(r['Marketing'] || '').split(',').filter(Boolean),
    event: ev,
    content: String(r['Content'] || ''),
    note: String(r['Note'] || ''),
    status: COPY_STATUS.indexOf(r['Status']) > -1 ? r['Status'] : 'draft',
    scheduled_for: String(r['ScheduledFor'] || '').slice(0, 10),
    liked: copyIsTrue_(r['Liked']),
    created_by: String(r['CreatedBy'] || ''),
    created_at: String(r['CreatedAt'] || ''),
    updated_at: String(r['UpdatedAt'] || ''),
  };
}

function copyFindRow_(sheetName, id) {
  var rows = sheetToObjects(sheetName).rows;
  for (var i = 0; i < rows.length; i++) if (Number(rows[i]['ID']) === Number(id)) return { rowIndex: i + 2, row: rows[i] };
  return null;
}

function copyLibOut_(r) {
  return {
    id: Number(r['ID']) || 0,
    kind: COPY_KINDS.indexOf(r['Kind']) > -1 ? r['Kind'] : 'prompt',
    name: String(r['Name'] || ''),
    text: String(r['Text'] || ''),
    platform: String(r['Platform'] || ''),
    enabled: !(r['Enabled'] === false || String(r['Enabled']).toUpperCase() === 'FALSE'),
  };
}

function copyStyle_() {
  var s = copyCfgGet_('style', {}) || {};
  return { profile: String(s.profile || ''), enabled: s.enabled !== false, updatedAt: String(s.updatedAt || '') };
}

function handleCopyGetData(body) {
  var posts = sheetToObjects(SHEET_COPY_POSTS).rows.map(copyPostOut_);
  posts.sort(function (a, b) { return String(b.updated_at).localeCompare(String(a.updated_at)); });
  var models = copyMaskedModels_();
  var botAvailable = typeof botAiList_ === 'function';
  var botUsing = botAvailable ? botAiList_().length : 0;
  return {
    success: true,
    posts: posts.slice(0, 300),
    total: posts.length,
    library: sheetToObjects(SHEET_COPY_LIB).rows.map(copyLibOut_),
    style: copyStyle_(),
    models: models,
    providers: typeof BOT_AI_PROVIDERS !== 'undefined' ? BOT_AI_PROVIDERS : {},
    aiReady: copyAiList_().length > 0,
    usingBotModels: models.length === 0 && botUsing > 0,
    botAvailable: botAvailable,
    today: todayStr(),
  };
}

function handleCopySavePost(body) {
  return withLock_(function () {
    var clean = copyCleanPost_(body.post);
    if (!clean.Content.trim() && !clean.Topic.trim()) return { success: false, message: '主題與內文都是空的' };
    var now = copyNow_();
    var id = Number(body.id) || 0;
    if (id) {
      var found = copyFindRow_(SHEET_COPY_POSTS, id);
      if (!found) return { success: false, message: '找不到這篇文案（可能已被刪除）' };
      clean.UpdatedAt = now;
      updateRowFields(SHEET_COPY_POSTS, found.rowIndex, clean);
      return { success: true, id: id };
    }
    id = copyNextId_(SHEET_COPY_POSTS);
    appendObjectRow(SHEET_COPY_POSTS, Object.assign({ ID: id, Liked: false, CreatedBy: body._user.username, CreatedAt: now, UpdatedAt: now }, clean));
    return { success: true, id: id };
  });
}

function handleCopySetLiked(body) {
  return withLock_(function () {
    var found = copyFindRow_(SHEET_COPY_POSTS, body.id);
    if (!found) return { success: false, message: '找不到這篇文案' };
    var liked = body.liked === true;
    if (liked && !String(found.row['Content'] || '').trim()) return { success: false, message: '內文是空的' };
    updateRowFields(SHEET_COPY_POSTS, found.rowIndex, { Liked: liked, UpdatedAt: copyNow_() });
    return { success: true, liked: liked };
  });
}

function handleCopyDeletePost(body) {
  return withLock_(function () {
    var found = copyFindRow_(SHEET_COPY_POSTS, body.id);
    if (!found) return { success: false, message: '找不到這篇文案' };
    getSheet(SHEET_COPY_POSTS).deleteRow(found.rowIndex);
    return { success: true };
  });
}

// ------------------------------------------------------------
// 素材庫
// ------------------------------------------------------------
function copyCleanLib_(it) {
  it = it || {};
  var kind = COPY_KINDS.indexOf(it.kind) > -1 ? it.kind : '';
  var name = copyClip_(String(it.name || '').trim(), 60);
  var text = copyClip_(String(it.text || '').trim(), 6000);
  if (!kind) throw new Error('素材類型不正確');
  if (!name) throw new Error('請輸入名稱');
  if (!text) throw new Error('內容不能空白');
  var platform = String(it.platform || '').trim();
  if (platform && platform !== '@social' && COPY_PLATFORMS.indexOf(platform) < 0) platform = '';
  return { Kind: kind, Name: name, Text: text, Platform: platform, Enabled: it.enabled !== false };
}

function handleCopySaveLib(body) {
  return withLock_(function () {
    var clean;
    try {
      clean = copyCleanLib_(body.item);
    } catch (e) {
      return { success: false, message: e.message };
    }
    var id = Number(body.id) || 0;
    if (id) {
      var found = copyFindRow_(SHEET_COPY_LIB, id);
      if (!found) return { success: false, message: '找不到這個素材' };
      updateRowFields(SHEET_COPY_LIB, found.rowIndex, clean);
      return { success: true, id: id };
    }
    id = copyNextId_(SHEET_COPY_LIB);
    appendObjectRow(SHEET_COPY_LIB, Object.assign({ ID: id }, clean));
    return { success: true, id: id };
  });
}

function handleCopyToggleLib(body) {
  return withLock_(function () {
    var found = copyFindRow_(SHEET_COPY_LIB, body.id);
    if (!found) return { success: false, message: '找不到這個素材' };
    updateRowFields(SHEET_COPY_LIB, found.rowIndex, { Enabled: body.enabled === true });
    return { success: true };
  });
}

function handleCopyDeleteLib(body) {
  return withLock_(function () {
    var found = copyFindRow_(SHEET_COPY_LIB, body.id);
    if (!found) return { success: false, message: '找不到這個素材' };
    getSheet(SHEET_COPY_LIB).deleteRow(found.rowIndex);
    return { success: true };
  });
}

/** 匯入發文助手的檔案：settings.json（prompts / styles / endings）或 data.json（文案陣列） */
function handleCopyImport(body) {
  return withLock_(function () {
    var text = String(body.json || '');
    if (!text) return { success: false, message: '沒有內容' };
    if (text.length > 5000000) return { success: false, message: '檔案太大（上限 5MB）' };
    var data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return { success: false, message: '檔案不是正確的 JSON' };
    }
    var now = copyNow_();
    if (Array.isArray(data)) {
      var rows = data.filter(function (p) { return p && typeof p === 'object' && (String(p.content || '').trim() || String(p.topic || '').trim()); }).slice(0, 500);
      if (!rows.length) return { success: false, message: '檔案裡沒有可匯入的文案' };
      var id = copyNextId_(SHEET_COPY_POSTS);
      rows.forEach(function (p) {
        var when = String(p.when || '').slice(0, 10);
        var clean = copyCleanPost_({ platform: p.platform, topic: p.topic, keywords: p.keywords, tone: p.tone, marketing: p.marketing, event: p.event, content: p.content, note: p.note, status: p.status, scheduled_for: when });
        appendObjectRow(SHEET_COPY_POSTS, Object.assign({ ID: id++, Liked: false, CreatedBy: body._user.username, CreatedAt: now, UpdatedAt: now }, clean));
      });
      return { success: true, message: '已匯入 ' + rows.length + ' 篇文案', count: rows.length };
    }
    if (!data || typeof data !== 'object' || (!data.prompts && !data.styles && !data.endings)) {
      return { success: false, message: '看不出這是發文助手的檔案（要有 prompts／styles／endings，或是文案陣列）' };
    }
    var have = {};
    sheetToObjects(SHEET_COPY_LIB).rows.forEach(function (r) { have[r['Kind'] + '|' + r['Name']] = true; });
    var nid = copyNextId_(SHEET_COPY_LIB);
    var added = 0;
    [['prompts', 'prompt'], ['styles', 'style'], ['endings', 'ending']].forEach(function (pair) {
      (Array.isArray(data[pair[0]]) ? data[pair[0]] : []).forEach(function (it) {
        if (added >= 200) return;
        var c;
        try {
          c = copyCleanLib_({ kind: pair[1], name: it && it.name, text: it && it.text, platform: it && it.platform, enabled: true });
        } catch (e) {
          return; // 格式不對的項目略過
        }
        if (have[c.Kind + '|' + c.Name]) return;
        have[c.Kind + '|' + c.Name] = true;
        appendObjectRow(SHEET_COPY_LIB, Object.assign({ ID: nid++ }, c));
        added++;
      });
    });
    if (!added) return { success: false, message: '沒有新的素材可匯入（名稱相同的會略過）' };
    return { success: true, message: '已匯入 ' + added + ' 個素材', count: added };
  });
}

// ------------------------------------------------------------
// AI 學習風格 / AI 模型
// ------------------------------------------------------------
function handleCopySaveStyle(body) {
  var s = copyStyle_();
  if (body.profile !== undefined) s.profile = copyClip_(body.profile, 3000);
  if (body.enabled !== undefined) s.enabled = body.enabled === true;
  s.updatedAt = copyNow_();
  copyCfgSet_('style', s);
  return { success: true, style: s };
}

function copyStoredModels_() {
  var m = copyCfgGet_('models', []);
  return Array.isArray(m) ? m : [];
}

function copyMaskedModels_() {
  var providers = typeof BOT_AI_PROVIDERS !== 'undefined' ? BOT_AI_PROVIDERS : {};
  return copyStoredModels_().map(function (m) {
    var def = providers[m.provider] || providers.gemini || { model: '' };
    return { provider: providers[m.provider] ? m.provider : 'gemini', model: String(m.model || ''), endpoint: String(m.endpoint || ''), hasKey: !!m.apiKey, keyHint: m.apiKey ? '••••' + String(m.apiKey).slice(-4) : '', defaultModel: def.model };
  });
}

/** 文案專用 AI 清單（含金鑰，只在伺服器內部用）；沒設定就沿用 BOT 設定的 AI。 */
function copyAiList_() {
  if (typeof BOT_AI_PROVIDERS === 'undefined') return [];
  var out = [];
  copyStoredModels_().forEach(function (m) {
    if (!m || !m.apiKey) return;
    var provider = BOT_AI_PROVIDERS[m.provider] ? m.provider : 'gemini';
    var def = BOT_AI_PROVIDERS[provider];
    out.push({ source: 'copy', provider: provider, apiKey: String(m.apiKey), model: String(m.model || '').trim() || def.model, endpoint: String(m.endpoint || '').trim() || def.endpoint });
  });
  if (!out.length && typeof botAiList_ === 'function') return botAiList_();
  return out;
}

function handleCopySaveModels(body) {
  if (typeof BOT_AI_PROVIDERS === 'undefined') return { success: false, message: '需要同時貼上 Bot.gs（AI 呼叫在那裡）' };
  return withLock_(function () {
    var old = copyStoredModels_();
    var models = [];
    (Array.isArray(body.models) ? body.models : []).slice(0, 5).forEach(function (m, i) {
      if (!m) return;
      var provider = BOT_AI_PROVIDERS[m.provider] ? m.provider : 'gemini';
      var key = String(m.apiKey || '').trim();
      if (!key && old[i] && old[i].provider === provider) key = old[i].apiKey || '';
      if (!key) return;
      var endpoint = String(m.endpoint || '').trim();
      if (endpoint && !/^https:\/\//i.test(endpoint)) throw new Error('Endpoint 要用 https:// 開頭');
      models.push({ provider: provider, apiKey: key, model: String(m.model || '').trim(), endpoint: endpoint });
    });
    copyCfgSet_('models', models);
    return { success: true, models: copyMaskedModels_() };
  });
}

function handleCopyTestModel(body) {
  var list = copyAiList_();
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

/** 送出瀏覽器組好（使用者確認過）的提示詞給 AI；依序備援，回傳文字與用到的模型。 */
function handleCopyGenerate(body) {
  var prompt = String(body.prompt || '').trim();
  if (!prompt) return { success: false, message: '缺少提示詞' };
  if (prompt.length > COPY_MAX_PROMPT) return { success: false, message: '提示詞太長（上限 ' + COPY_MAX_PROMPT + ' 字）' };
  if (typeof botCallAi_ !== 'function') return { success: false, message: '需要同時貼上 Bot.gs（AI 呼叫在那裡）' };
  var list = copyAiList_();
  if (!list.length) return { success: false, message: '還沒有設定 AI 模型：請到「文案製作 → AI 模型」（或「BOT 設定 → AI 模型」）填入 API Key' };
  var system = '你是專業的文案寫手。嚴格依照使用者提示詞的格式與限制輸出，使用繁體中文。';
  var failures = [];
  for (var i = 0; i < list.length; i++) {
    try {
      var text = botCallAi_(list[i], system, [{ role: 'user', text: prompt }], { maxTokens: 8000 });
      return { success: true, text: text, model: BOT_AI_PROVIDERS[list[i].provider].name + '／' + list[i].model, failures: failures };
    } catch (e) {
      failures.push(e.message);
    }
  }
  return { success: false, message: 'AI 都失敗了：' + failures.join('；').slice(0, 500) };
}
