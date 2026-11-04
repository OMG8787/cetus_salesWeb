/**
 * ============================================================
 * BotStaff.gs - BOT 設定：員工助理（選用模組，需要 Bot.gs 一起貼上）
 * ------------------------------------------------------------
 * 員工在 LINE（員工助理官方帳號）或網站右下角的「智能助理」用聊天查資料、交代事情：
 *   「今天要追蹤哪些客戶？」「甲公司的聯絡人電話」「進行中的案件」「記一筆：今天電話聯繫乙公司，下週三再追蹤」
 * - 員工加官方帳號好友 → BotMembers 新增一列（待開通、沒有任何權限），首頁備忘錄通知有「BOT 設定」權限的人；
 *   在「BOT 設定 → 員工助理」開通並設定權限（跟網站帳號同一套：編輯者 / 查看 / 特定各功能區塊查看或編輯），可綁定網站帳號。
 * - 查詢只能用 BOT_STAFF_CALLS 這些動作，資料依這個人的權限過濾；
 *   新增 / 修改只能用 BOT_STAFF_WRITES 這些（白名單），AI 只能「提出」→ 暫存 15 分鐘 → 本人按「確認」才寫入；不能刪除。
 * - 網站智能助理（右下角）：同一個機器人，用登入帳號本人的權限（W 開頭的暫時編號，登入驗證過的 10 分鐘內有效）。
 * ============================================================
 */

var SHEET_BOT_MEMBERS = 'BotMembers';
var SHEET_BOT_MEMORY = 'BotMemory';

var BOT_STAFF_CALLS = ['me', 'overview', 'customers', 'customer', 'followups', 'cases', 'case', 'products', 'logs', 'memos', 'calendar'];
var BOT_STAFF_STATUS = { PENDING: '待開通', ACTIVE: '已開通', OFF: '停用' };
var BOT_PENDING_SECONDS = 900;
var BOT_CASE_STATUSES = ['需求單已發出', '評估單已發出', '已結案'];
var BOT_MEMORY_CATEGORIES = ['稱呼與職務', '負責的工作', '工作習慣', '回覆偏好', '客戶與專案', '產品與規格', '公司規定', '其他'];

function botStaffSchema_() {
  return {
    schema: {
      BotMembers: ['LineUserId', 'DisplayName', 'PictureUrl', 'Status', 'Role', 'Perms', 'LinkedUsername', 'Note', 'PushDaily', 'IsFollowing', 'FollowedAt', 'LastSeenAt', 'ApprovedBy', 'ApprovedAt'],
      BotMemory: ['ID', 'Scope', 'Owner', 'Category', 'Content', 'Importance', 'UpdatedAt'],
    },
    text: { BotMembers: ['LineUserId'], BotMemory: ['Owner'] },
  };
}

function botStaffPerms_() {
  return {
    botGetStaff: ['bot', 'r'], botMemoryList: ['bot', 'r'],
    botSaveStaff: ['bot', 'w'], botMemberSave: ['bot', 'w'], botMemorySave: ['bot', 'w'], botPushNow: ['bot', 'w'],
    botMemberRemove: ['bot', 'd'], botMemoryDelete: ['bot', 'd'],
    botAssistInfo: ['*', 'r'], botAssist: ['*', 'w'],
  };
}

function botStaffRoutes_() {
  return {
    botGetStaff: { auth: true, fn: handleBotGetStaff },
    botSaveStaff: { auth: true, fn: handleBotSaveStaff },
    botMemberSave: { auth: true, fn: handleBotMemberSave },
    botMemberRemove: { auth: true, fn: handleBotMemberRemove },
    botMemorySave: { auth: true, fn: handleBotMemorySave },
    botMemoryDelete: { auth: true, fn: handleBotMemoryDelete },
    botPushNow: { auth: true, fn: handleBotPushNow },
    botAssistInfo: { auth: true, fn: handleBotAssistInfo },
    botAssist: { auth: true, fn: handleBotAssist },
  };
}

// ------------------------------------------------------------
// 設定
// ------------------------------------------------------------
function botStaffCfg_() {
  var c = botCfg_('staff', {}) || {};
  var m = c.memory || {};
  var push = c.push || {};
  return {
    enabled: c.enabled === true,
    welcome: String(c.welcome || ''),
    pendingText: String(c.pendingText || ''),
    prompt: String(c.prompt || ''),
    webEnabled: c.webEnabled !== false,
    push: { enabled: push.enabled === true, hour: botInt_(push.hour, 0, 23, 8), last: String(push.last || '') },
    // 助理能存取資料的上限：實際權限 = 成員（帳號）權限與這裡的上限取較小者
    ceiling: botStaffCeiling_(c.ceiling),
    // 助理可以提出的寫入動作（沒設定 = 全部）
    writes: botStaffWrites_(c.writes),
    // 助理永遠看不到產品底價與供應商（就算成員有產品權限）
    hidePrice: c.hidePrice === true,
    memory: {
      enabled: m.enabled !== false,
      maxItems: botInt_(m.maxItems, 5, 100, 30),
      confirm: m.confirm !== false, // 在 LINE 說「記住」要先按確認
      canShared: m.canShared === true, // 一般員工也可以新增 / 修改全公司的記憶
      auto: m.auto === true,
      autoEvery: botInt_(m.autoEvery, 2, 30, 6),
    },
  };
}

var BOT_STAFF_CEILING_BLOCKS = ['products', 'cases', 'customers'];

function botStaffCeiling_(c) {
  c = c || {};
  var out = {};
  BOT_STAFF_CEILING_BLOCKS.forEach(function (b) {
    out[b] = c[b] === 'none' || c[b] === 'view' ? c[b] : 'edit';
  });
  return out;
}

function botStaffWrites_(list) {
  var all = Object.keys(BOT_STAFF_WRITES);
  if (!Array.isArray(list)) return all;
  return all.filter(function (k) { return list.indexOf(k) > -1; });
}

/** 把帳號權限壓到管理員設定的上限以下（none < view < edit）。 */
function botCapAccess_(access) {
  var rank = { none: 0, view: 1, edit: 2 };
  var ceiling = botStaffCfg_().ceiling;
  BOT_STAFF_CEILING_BLOCKS.forEach(function (b) {
    if ((rank[access.blocks[b]] || 0) > rank[ceiling[b]]) access.blocks[b] = ceiling[b];
  });
  return access;
}

// ------------------------------------------------------------
// 成員與權限
// ------------------------------------------------------------
function botWebId_(username) {
  return 'W' + sha256('web:' + username).slice(0, 32);
}

function botMemberRows_() {
  return sheetToObjects(SHEET_BOT_MEMBERS).rows.map(function (r, i) {
    return Object.assign({ RowIndex: i + 2 }, r);
  });
}

function botMemberFind_(id) {
  var rows = botMemberRows_();
  for (var i = 0; i < rows.length; i++) if (String(rows[i]['LineUserId']) === id) return rows[i];
  return null;
}

/** 成員的權限（等級同網站帳號）：editor / viewer / limited；機器人沒有刪除功能，所以沒有系統管理員。 */
function botMemberAccess_(m) {
  var role = String(m['Role'] || '');
  if (role === 'admin') role = 'editor';
  if (role !== 'editor' && role !== 'viewer' && role !== 'limited') role = 'viewer';
  var a = accessOf_({ Role: role, Perms: m['Perms'] });
  a.canDelete = false;
  a.isAdmin = false;
  return botCapAccess_(a);
}

/** 這個編號（U 開頭 = LINE 成員；W 開頭 = 網站登入帳號）能做什麼；ok = 已開通可以用。 */
function botStaffCtx_(id) {
  var cfg = botStaffCfg_();
  if (id.charAt(0) === 'W') {
    var uname = botCacheGet_('webid:' + id);
    var u = uname ? findUserRow_(uname) : null;
    if (!u) return { ok: false, status: '未登入', problem: '網站登入已逾期，請重新整理頁面再試', id: id, web: true };
    var a = botCapAccess_(accessOf_(u));
    a.canDelete = false;
    a.isAdmin = false;
    return { ok: cfg.enabled && cfg.webEnabled, status: '已開通', problem: !cfg.enabled ? '員工助理還沒啟用' : !cfg.webEnabled ? '網站智能助理沒有開放' : '', id: id, web: true, name: String(u['DisplayName'] || u['Username']), username: String(u['Username']), access: a, ownerKey: String(u['Username']) };
  }
  var m = botMemberFind_(id);
  if (!m) return { ok: false, status: '未登記', problem: '', id: id, web: false };
  var linked = String(m['LinkedUsername'] || '');
  var lu = linked ? findUserRow_(linked) : null;
  var access = botMemberAccess_(m);
  return {
    ok: cfg.enabled && m['Status'] === BOT_STAFF_STATUS.ACTIVE,
    status: String(m['Status'] || BOT_STAFF_STATUS.PENDING),
    problem: !cfg.enabled ? '員工助理還沒啟用' : '',
    id: id,
    web: false,
    name: String(m['DisplayName'] || (lu && lu['DisplayName']) || ''),
    username: lu ? String(lu['Username']) : '',
    access: access,
    ownerKey: lu ? String(lu['Username']) : id,
    member: m,
  };
}

function botLevel_(ctx, block) {
  return (ctx.access && ctx.access.blocks[block]) || 'none';
}

function botNeed_(ctx, block, level) {
  var lv = botLevel_(ctx, block);
  var label = (PERM_BLOCKS.filter(function (b) { return b.key === block; })[0] || {}).label || block;
  label = label.replace(/（.*$/, '');
  if (lv === 'none' || (level === 'edit' && lv !== 'edit')) throw new Error(level === 'edit' ? '你沒有「' + label + '」的編輯權限' : '你沒有「' + label + '」的查看權限');
}

/** 員工在 LINE 加好友 / 傳訊息：登記成員（待開通），第一次出現時用備忘錄通知有「BOT 設定」權限的人。 */
function botMemberTouch_(id, profile) {
  var m = botMemberFind_(id);
  var now = botNow_();
  if (m) {
    var patch = {};
    if (profile.displayName && profile.displayName !== m['DisplayName']) patch.DisplayName = botClip_(profile.displayName, 60);
    if (profile.pictureUrl && profile.pictureUrl !== m['PictureUrl']) patch.PictureUrl = String(profile.pictureUrl).slice(0, 300);
    var last = String(m['LastSeenAt'] || '');
    // 最後使用時間約 10 分鐘更新一次，避免每則訊息都寫試算表
    if (!last || Date.now() - new Date(last.replace(' ', 'T') + '+08:00').getTime() > 600000) patch.LastSeenAt = now;
    if (m['IsFollowing'] === false) patch.IsFollowing = true;
    if (Object.keys(patch).length) updateRowFields(SHEET_BOT_MEMBERS, m.RowIndex, patch);
    return { row: m, isNew: false };
  }
  appendObjectRow(SHEET_BOT_MEMBERS, { LineUserId: id, DisplayName: botClip_(profile.displayName, 60), PictureUrl: String(profile.pictureUrl || '').slice(0, 300), Status: BOT_STAFF_STATUS.PENDING, Role: 'viewer', Perms: '', LinkedUsername: '', Note: '', PushDaily: false, IsFollowing: true, FollowedAt: now, LastSeenAt: now });
  var today = todayStr();
  appendObjectRow(SHEET_MEMOS, {
    Owner: 'SYSTEM',
    OwnerName: '員工助理',
    Title: '🤖 新的 LINE 員工助理成員等待開通：' + (profile.displayName || id.slice(0, 8)),
    Content: '有人加了員工助理官方帳號（' + (profile.displayName || '名稱未知') + '）。到「BOT 設定 → 員工助理」確認是同事後開通並設定權限；不認識的人設為「停用」或移除。',
    Shared: '是',
    CreatedDate: today,
    LastUpdated: today,
    LinkType: 'botMember',
    LinkId: id,
    NeedBlock: 'bot',
  });
  return { row: botMemberFind_(id), isNew: true };
}

// ------------------------------------------------------------
// 短期記憶 / 待確認
// ------------------------------------------------------------
function botStaffHistKey_(id) {
  var gen = botHistGen_();
  return 'lineh:' + (gen ? gen + ':' : '') + id;
}

function botStaffRemember_(id, turns) {
  var m = botGeneral_().memory;
  var add = (Array.isArray(turns) ? turns : [])
    .map(function (x) { return { u: !!(x && x.u === true), t: String((x && x.t) || '').trim().slice(0, m.chars) }; })
    .filter(function (x) { return x.t; });
  var list = (botCacheGet_(botStaffHistKey_(id)) || []).concat(add).slice(-m.turns);
  botCachePut_(botStaffHistKey_(id), list, m.hours * 3600);
  return list.length;
}

function botPendingGet_(id) {
  var p = botCacheGet_('linep:' + id);
  return p && p.ops ? p : null;
}

// ------------------------------------------------------------
// 給 linebot 的操作（Bot 金鑰）
// ------------------------------------------------------------
function botStaffOp_(op, id, body) {
  if (id.charAt(0) !== 'U' && id.charAt(0) !== 'W') throw new Error('使用者編號格式錯誤');
  if (op === 'start') return botStaffStart_(id, body);
  if (op === 'call') return botStaffCall_(botStaffCtx_(id), String(body.call || ''), body.params || {});
  if (op === 'stage') return botStage_(id, body);
  if (op === 'commit') return botCommit_(id, body);
  if (op === 'cancel') {
    botCacheRemove_(['linep:' + id]);
    return true;
  }
  if (op === 'remember') return botStaffRemember_(id, body.turns);
  if (op === 'forget') {
    botCacheRemove_([botStaffHistKey_(id)]);
    return true;
  }
  if (op === 'unfollow') {
    var m = id.charAt(0) === 'U' ? botMemberFind_(id) : null;
    if (m) updateRowFields(SHEET_BOT_MEMBERS, m.RowIndex, { IsFollowing: false });
    return true;
  }
  if (op === 'memory') {
    var ctx = botStaffCtx_(id);
    if (!botStaffCfg_().memory.enabled) throw new Error('長期記憶沒有開啟');
    return withLock_(function () { return botMemoryWrite_(ctx, body.data || {}); });
  }
  throw new Error('未知的 Bot 操作：' + op);
}

function botStaffStart_(id, body) {
  var cfg = botStaffCfg_();
  var prof = { displayName: botClip_(body.displayName, 60), pictureUrl: String(body.pictureUrl || '') };
  var isNew = false;
  if (id.charAt(0) === 'U') isNew = botMemberTouch_(id, prof).isNew;
  var ctx = botStaffCtx_(id);
  var ais = botAiList_();
  var base = {
    status: ctx.status,
    allowed: !!ctx.ok,
    problem: ctx.problem || '',
    isNew: isNew,
    name: ctx.name || prof.displayName || '',
    appName: csBrand_(),
    channel: id.charAt(0) === 'W' ? 'web' : 'line',
    replyDelay: botGeneral_().replyDelay,
    texts: {
      welcome: cfg.welcome || '👋 您好，我是' + csBrand_() + '的員工助理。',
      pending: cfg.pendingText || '👋 您好！你的帳號還在等待管理員開通，開通後就可以用我查詢客戶、案件與行程囉。',
    },
  };
  if (!ctx.ok) return base;
  var blocks = ctx.access.blocks;
  var mem = cfg.memory;
  var pending = botPendingGet_(id);
  return Object.assign(base, {
    userId: id,
    linked: !!ctx.username,
    username: ctx.username || '',
    blocks: blocks,
    prompt: cfg.prompt,
    ai: ais.length ? ais[0] : null,
    aiFallback: ais.slice(1),
    history: botCacheGet_(botStaffHistKey_(id)) || [],
    writable: botWritableOps_(ctx),
    pending: pending ? pending.summary : '',
    today: todayStr(),
    memory: {
      enabled: mem.enabled,
      maxItems: mem.maxItems,
      confirm: mem.confirm,
      canShared: mem.canShared || blocksCanShare_(ctx),
      categories: BOT_MEMORY_CATEGORIES,
      items: mem.enabled ? botMemoryFor_(ctx) : [],
    },
  });
}

function blocksCanShare_(ctx) {
  return botLevel_(ctx, 'bot') === 'edit';
}

// ------------------------------------------------------------
// 查詢（依權限過濾）
// ------------------------------------------------------------
function botTrimRow_(obj, keys, noteLimit) {
  var out = {};
  keys.forEach(function (k) {
    var v = obj[k];
    if (v === '' || v === null || v === undefined) return;
    out[k] = typeof v === 'string' && v.length > noteLimit ? v.slice(0, noteLimit) + '…' : v;
  });
  return out;
}

var BOT_CUSTOMER_KEYS = ['CompanyName', 'Contact', 'Phone', 'CompanyPhone', 'Email', 'Address', 'TaxId', 'Category', 'Urgency', 'NextFollowUpDate', 'NextFollowUpTime', 'NextFollowUpNote', 'Notes', 'HasTransacted', 'LastTransactionDate'];
var BOT_CASE_KEYS = ['CaseID', 'CustomerName', 'EndCustomerName', 'ProjectContact', 'ContactPhone', 'Status', 'Urgency', 'Salesperson', 'FAE', 'ProductApplication', 'TestObject', 'SoftwareName', 'CreatedDate', 'RequirementDetails', 'EvaluationResult'];
var BOT_PRODUCT_KEYS = ['InternalModel', 'SupplierModel', 'Brand', 'Category', 'Interface', 'Resolution', 'PixelSize', 'SensorSize', 'FPS', 'Mount', 'FocalLength', 'Magnification', 'WD', 'DOF', 'FocusWD', 'Notes'];

function botMatch_(row, fields, kws) {
  var hay = fields.map(function (f) { return String(row[f] || ''); }).join(' ').toLowerCase().replace(/\s+/g, '');
  return kws.every(function (k) { return hay.indexOf(k) > -1; });
}

function botKws_(keyword) {
  return String(keyword || '').toLowerCase().split(/\s+/).filter(Boolean);
}

function botStaffCall_(ctx, action, params) {
  if (BOT_STAFF_CALLS.indexOf(action) < 0) throw new Error('員工助理不能使用：' + action);
  if (!ctx.ok) throw new Error(ctx.problem || '這個帳號還沒開通');
  var limit = botInt_(params.limit, 1, 30, 10);
  var today = todayStr();

  if (action === 'me') return { name: ctx.name, username: ctx.username, role: ctx.access.roleLabel, blocks: ctx.access.blocks, today: today };

  if (action === 'customers') {
    botNeed_(ctx, 'customers', 'view');
    var kws = botKws_(params.keyword);
    var rows = sheetToObjects(SHEET_CUSTOMERS).rows.filter(function (r) { return !kws.length || botMatch_(r, ['CompanyName', 'Contact', 'Phone', 'CompanyPhone', 'Email', 'Address', 'TaxId', 'Notes'], kws); });
    return { total: rows.length, items: rows.slice(0, limit).map(function (r) { var o = botTrimRow_(r, BOT_CUSTOMER_KEYS, 200); o.NextFollowUpTime = normTimeStr_(r['NextFollowUpTime']) || undefined; return o; }) };
  }

  if (action === 'customer') {
    botNeed_(ctx, 'customers', 'view');
    var name = String(params.companyName || '').trim();
    var key = normCompanyName_(name);
    var found = null;
    sheetToObjects(SHEET_CUSTOMERS).rows.forEach(function (r) {
      if (!found && normCompanyName_(r['CompanyName']) === key) found = r;
    });
    if (!found) {
      var near = sheetToObjects(SHEET_CUSTOMERS).rows.filter(function (r) { return normCompanyName_(r['CompanyName']).indexOf(key) > -1; }).slice(0, 5).map(function (r) { return r['CompanyName']; });
      throw new Error('找不到客戶「' + name + '」' + (near.length ? '，你是不是要找：' + near.join('、') : ''));
    }
    var cname = String(found['CompanyName']);
    var out = { customer: botTrimRow_(found, BOT_CUSTOMER_KEYS, 600) };
    out.contacts = sheetToObjects(SHEET_CUSTOMER_CONTACTS).rows.filter(function (r) { return String(r['CompanyName']) === cname; }).map(function (r) { return botTrimRow_(r, ['ContactName', 'Title', 'Phone', 'Email', 'Notes'], 100); });
    out.logs = sheetToObjects(SHEET_CONTACT_LOGS).rows
      .filter(function (r) { return String(r['CompanyName']) === cname; })
      .map(function (r) { return { Date: dateKey_(r['Date']), Method: r['Method'], Contact: r['Contact'], Summary: String(r['Summary'] || '').slice(0, 200), Changes: String(r['Changes'] || '').slice(0, 150) }; })
      .slice(-5)
      .reverse();
    if (botLevel_(ctx, 'cases') !== 'none') out.cases = sheetToObjects(SHEET_CASES).rows.filter(function (r) { return String(r['CustomerName']) === cname; }).slice(0, 10).map(function (r) { return botTrimRow_(r, ['CaseID', 'Status', 'Urgency', 'ProductApplication', 'CreatedDate'], 80); });
    return out;
  }

  if (action === 'followups') {
    botNeed_(ctx, 'customers', 'view');
    var days = botInt_(params.days, 0, 60, 0);
    var until = addDaysStr(today, days);
    var list = sheetToObjects(SHEET_CUSTOMERS).rows
      .map(function (r) { return { r: r, d: dateKey_(r['NextFollowUpDate']) }; })
      .filter(function (x) { return x.d && x.d <= until; })
      .sort(function (a, b) { return a.d.localeCompare(b.d) || normTimeStr_(a.r['NextFollowUpTime']).localeCompare(normTimeStr_(b.r['NextFollowUpTime'])); });
    return {
      today: today,
      total: list.length,
      items: list.slice(0, limit * 2).map(function (x) {
        var o = botTrimRow_(x.r, ['CompanyName', 'Contact', 'Phone', 'Urgency', 'NextFollowUpNote'], 200);
        o.NextFollowUpDate = x.d;
        var t = normTimeStr_(x.r['NextFollowUpTime']);
        if (t) o.NextFollowUpTime = t;
        o.status = x.d < today ? '已逾期' : x.d === today ? '今天' : '之後';
        return o;
      }),
    };
  }

  if (action === 'cases') {
    botNeed_(ctx, 'cases', 'view');
    var ckws = botKws_(params.keyword);
    var status = String(params.status || '');
    var crows = sheetToObjects(SHEET_CASES).rows.filter(function (r) {
      if (status === '進行中' ? r['Status'] === '已結案' : status && r['Status'] !== status) return false;
      return !ckws.length || botMatch_(r, ['CaseID', 'CustomerName', 'Salesperson', 'FAE', 'ProductApplication', 'TestObject'], ckws);
    });
    return { total: crows.length, items: crows.slice(0, limit).map(function (r) { return botTrimRow_(r, ['CaseID', 'CustomerName', 'Status', 'Urgency', 'Salesperson', 'FAE', 'ProductApplication', 'TestObject', 'CreatedDate'], 80); }) };
  }

  if (action === 'case') {
    botNeed_(ctx, 'cases', 'view');
    var cid = String(params.caseId || '').trim();
    var c = findCase(cid);
    if (!c) {
      var like = sheetToObjects(SHEET_CASES).rows.filter(function (r) { return String(r['CaseID']).toLowerCase().indexOf(cid.toLowerCase()) > -1; }).slice(0, 5).map(function (r) { return r['CaseID']; });
      throw new Error('找不到案件「' + cid + '」' + (like.length ? '，你是不是要找：' + like.join('、') : ''));
    }
    var co = botTrimRow_(c, BOT_CASE_KEYS, 600);
    co.CCD = getCcdRequirementsForCase(String(c['CaseID'])).map(function (x) { return botTrimRow_(x, ['CcdIndex', 'Description', 'FovLengthMm', 'FovWidthMm', 'WdMm', 'AccuracyUm', 'FlyingSpeedMmS', 'InspectionSpeedPs', 'LightingNote'], 120); });
    return co;
  }

  if (action === 'products') {
    botNeed_(ctx, 'products', 'view');
    var pkws = botKws_(params.keyword);
    var prows = readProductsLite_().rows.filter(function (r) { return !pkws.length || botMatch_(r, ['InternalModel', 'SupplierModel', 'Brand', 'Category', 'Supplier', 'Notes'], pkws); });
    return {
      total: prows.length,
      items: prows.slice(0, Math.min(limit, 15)).map(function (r) {
        var o = botTrimRow_(r, BOT_PRODUCT_KEYS, 120);
        if (!botStaffCfg_().hidePrice) {
          o.Supplier = r['Supplier'] || undefined;
          o.RefPrice = r['RefPrice'] || undefined; // 底價：有「產品與詢價」查看權限的人才看得到（跟網站一樣），管理員也可以全部隱藏
        }
        return o;
      }),
    };
  }

  if (action === 'logs') {
    botNeed_(ctx, 'customers', 'view');
    var cn = String(params.companyName || '').trim();
    var lrows = sheetToObjects(SHEET_CONTACT_LOGS).rows.filter(function (r) { return !cn || normCompanyName_(r['CompanyName']).indexOf(normCompanyName_(cn)) > -1; });
    return {
      total: lrows.length,
      items: lrows.slice(-limit).reverse().map(function (r) { return { Date: dateKey_(r['Date']), Company: r['CompanyName'], Method: r['Method'], Contact: r['Contact'], Summary: String(r['Summary'] || '').slice(0, 200), Salesperson: r['Salesperson'] }; }),
    };
  }

  if (action === 'memos') {
    var me = ctx.username;
    var mrows = sheetToObjects(SHEET_MEMOS).rows.filter(function (r) {
      var need = String(r['NeedBlock'] || '');
      if (need && botLevel_(ctx, need) === 'none') return false;
      return (me && r['Owner'] === me) || r['Shared'] === '是';
    });
    return { total: mrows.length, items: mrows.slice(-limit).reverse().map(function (r) { return { Title: r['Title'], Content: String(r['Content'] || '').slice(0, 200), Shared: r['Shared'] === '是', Date: dateKey_(r['LastUpdated']) }; }) };
  }

  if (action === 'calendar') {
    if (botLevel_(ctx, 'customers') === 'none' && botLevel_(ctx, 'cases') === 'none') throw new Error('你沒有「行事曆」的查看權限（需要客戶或案件的查看權限）');
    var r2 = handleGetCalendarEvents({ days: botInt_(params.days, 1, 30, 7) });
    if (!r2.success) throw new Error(r2.message);
    return { items: r2.events.filter(function (e) { return String(e.Title).indexOf('[AOI客戶追蹤]') !== 0; }).slice(0, 30) };
  }

  if (action === 'overview') {
    var ov = { today: today, weekday: '日一二三四五六'.charAt(new Date(today + 'T12:00:00+08:00').getDay()) };
    if (botLevel_(ctx, 'customers') !== 'none') {
      var fu = botStaffCall_(ctx, 'followups', { days: 3, limit: 10 });
      ov.followups = { total: fu.total, items: fu.items.slice(0, 15) };
    }
    if (botLevel_(ctx, 'cases') !== 'none') {
      var open = sheetToObjects(SHEET_CASES).rows.filter(function (r) { return r['Status'] !== '已結案'; });
      var byStatus = {};
      open.forEach(function (r) { byStatus[r['Status']] = (byStatus[r['Status']] || 0) + 1; });
      ov.openCases = { total: open.length, byStatus: byStatus, high: open.filter(function (r) { return r['Urgency'] === '高'; }).slice(0, 5).map(function (r) { return botTrimRow_(r, ['CaseID', 'CustomerName', 'Status'], 60); }) };
    }
    try {
      var ev = botLevel_(ctx, 'customers') === 'none' && botLevel_(ctx, 'cases') === 'none' ? { success: false } : handleGetCalendarEvents({ days: 2 });
      if (ev.success) ov.events = ev.events.filter(function (e) { return String(e.Title).indexOf('[AOI客戶追蹤]') !== 0; }).slice(0, 10);
    } catch (e) {
      // 沒有日曆權限就略過
    }
    return ov;
  }
  throw new Error('未知的查詢：' + action);
}

// ------------------------------------------------------------
// 新增 / 修改（白名單；AI 只能提出，本人確認才寫入）
// ------------------------------------------------------------
var BOT_STAFF_WRITES = {
  addMemo: { block: '', label: '新增備忘錄' },
  logFollowUp: { block: 'customers', label: '記錄追蹤 / 改下次追蹤' },
  updateCustomer: { block: 'customers', label: '修改客戶資料' },
  addCustomer: { block: 'customers', label: '新增客戶' },
  createCase: { block: 'cases', label: '建立案件' },
  updateCaseStatus: { block: 'cases', label: '修改案件狀態 / 緊急程度' },
  remember: { block: '', label: '記住（長期記憶）' },
};
var BOT_CUSTOMER_EDITABLE = { Contact: '聯絡人', Phone: '聯繫人電話', Email: 'Email', CompanyPhone: '公司電話', Address: '地址', TaxId: '統一編號', Category: '分類', Urgency: '急迫性', Notes: '客戶備註' };

function botWritableOps_(ctx) {
  var allowed = botStaffCfg_().writes;
  return Object.keys(BOT_STAFF_WRITES).filter(function (k) {
    if (allowed.indexOf(k) < 0) return false;
    if (k === 'remember') return botStaffCfg_().memory.enabled;
    var b = BOT_STAFF_WRITES[k].block;
    return !b || botLevel_(ctx, b) === 'edit';
  });
}

function botFindCustomerRow_(name) {
  var key = normCompanyName_(name);
  var rows = sheetToObjects(SHEET_CUSTOMERS).rows;
  for (var i = 0; i < rows.length; i++) if (normCompanyName_(rows[i]['CompanyName']) === key) return { row: i + 2, obj: rows[i] };
  return null;
}

/** 檢查一筆要寫入的操作並產生給本人確認的說明（不寫入）。回傳 { line }。 */
function botWriteCheck_(ctx, w) {
  var spec = BOT_STAFF_WRITES[w.action];
  if (!spec) throw new Error('不能執行：' + w.action);
  if (botStaffCfg_().writes.indexOf(w.action) < 0) throw new Error('管理員沒有開放「' + spec.label + '」給助理使用');
  if (spec.block) botNeed_(ctx, spec.block, 'edit');
  var d = w.data || {};
  var s = function (k) { return String(d[k] == null ? '' : d[k]).trim(); };
  if (w.action === 'remember') {
    if (!botStaffCfg_().memory.enabled) throw new Error('長期記憶沒有開啟');
    if (!s('content')) throw new Error('要記住的內容不能空白');
    if (d.scope === 'all' && !(botStaffCfg_().memory.canShared || blocksCanShare_(ctx))) throw new Error('你不能新增全公司的記憶');
    return { line: '🧠 記住' + (d.scope === 'all' ? '（全公司）' : '') + '：' + s('content').slice(0, 80) };
  }
  if (w.action === 'addMemo') {
    if (!s('title') && !s('content')) throw new Error('備忘錄標題或內容至少要填一個');
    return { line: '📝 新增備忘錄：' + (s('title') || s('content').slice(0, 30)) + (s('content') && s('title') ? '（' + s('content').slice(0, 60) + '）' : '') };
  }
  if (w.action === 'logFollowUp') {
    var c = botFindCustomerRow_(s('company'));
    if (!c) throw new Error('找不到客戶「' + s('company') + '」，請先確認公司名稱（或先新增客戶）');
    if (!s('summary') && !s('nextDate') && !s('nextNote') && d.stop !== true) throw new Error('請提供這次聯繫的內容，或要改的下次追蹤日 / 洽談內容');
    if (s('nextDate') && !isDateStr(s('nextDate'))) throw new Error('下次追蹤日要是 YYYY-MM-DD');
    if (s('nextTime') && !normTimeStr_(s('nextTime'))) throw new Error('預約時間要是 HH:mm');
    if (s('caseId') && !findCase(s('caseId'))) throw new Error('找不到案件「' + s('caseId') + '」');
    var parts = [];
    if (s('summary')) parts.push('聯繫（' + (s('method') || '其他') + '）：' + s('summary').slice(0, 80));
    if (d.stop === true) parts.push('不再追蹤');
    else if (s('nextDate')) parts.push('下次追蹤 ' + s('nextDate') + (s('nextTime') ? ' ' + normTimeStr_(s('nextTime')) : '') + (s('nextNote') ? '：' + s('nextNote').slice(0, 60) : ''));
    return { line: '📞 ' + c.obj['CompanyName'] + ' → ' + parts.join('；') };
  }
  if (w.action === 'updateCustomer') {
    var cu = botFindCustomerRow_(s('company'));
    if (!cu) throw new Error('找不到客戶「' + s('company') + '」');
    var ch = [];
    Object.keys(d.fields || {}).forEach(function (k) {
      if (!BOT_CUSTOMER_EDITABLE[k]) throw new Error('不能用助理修改這個欄位：' + k + '（只能改 ' + Object.keys(BOT_CUSTOMER_EDITABLE).join('、') + '；公司名稱請到網站改）');
      ch.push(BOT_CUSTOMER_EDITABLE[k] + '：' + String(d.fields[k]).slice(0, 60));
    });
    if (!ch.length) throw new Error('沒有要修改的欄位');
    return { line: '✏️ 修改客戶「' + cu.obj['CompanyName'] + '」：' + ch.join('、') };
  }
  if (w.action === 'addCustomer') {
    if (!s('companyName')) throw new Error('公司名稱不能空白');
    var dup = findDuplicateCustomerRow_(s('companyName'), 0);
    if (dup) throw new Error('已經有「' + s('companyName') + '」這間客戶了');
    return { line: '🏢 新增客戶：' + s('companyName') + (s('contact') ? '（聯絡人 ' + s('contact') + (s('phone') ? ' ' + s('phone') : '') + '）' : '') };
  }
  if (w.action === 'createCase') {
    if (!botFindCustomerRow_(s('customerName'))) throw new Error('案件要掛在已存在的客戶底下，找不到客戶「' + s('customerName') + '」');
    var miss = [];
    if (!s('softwareName')) miss.push('使用軟體名稱');
    if (!s('testObject')) miss.push('待測物件');
    if (!s('productApplication')) miss.push('產品應用');
    if (miss.length) throw new Error('建立案件還缺：' + miss.join('、') + '（這三項會組成案件編號）');
    return { line: '📁 建立案件：' + s('customerName') + '｜' + s('softwareName') + '｜' + s('testObject') + '｜' + s('productApplication') };
  }
  if (w.action === 'updateCaseStatus') {
    var cs = findCase(s('caseId'));
    if (!cs) throw new Error('找不到案件「' + s('caseId') + '」');
    var ps = [];
    if (s('status')) {
      if (BOT_CASE_STATUSES.indexOf(s('status')) < 0) throw new Error('案件狀態只能是：' + BOT_CASE_STATUSES.join('、'));
      ps.push('狀態：' + cs['Status'] + ' → ' + s('status'));
    }
    if (s('urgency')) {
      if (['高', '中', '低'].indexOf(s('urgency')) < 0) throw new Error('緊急程度只能是 高 / 中 / 低');
      ps.push('緊急程度：' + (cs['Urgency'] || '中') + ' → ' + s('urgency'));
    }
    if (!ps.length) throw new Error('請提供要改的狀態或緊急程度');
    return { line: '📁 案件「' + cs['CaseID'] + '」' + ps.join('；') };
  }
  throw new Error('不能執行：' + w.action);
}

function botStage_(id, body) {
  var ctx = botStaffCtx_(id);
  if (!ctx.ok) throw new Error(ctx.problem || '這個帳號還沒開通');
  var ops = Array.isArray(body.ops) ? body.ops : [];
  if (!ops.length) throw new Error('沒有要寫入的內容');
  if (ops.length > 10) throw new Error('一次最多 10 項修改');
  var lines = ops.map(function (w) { return botWriteCheck_(ctx, w).line; });
  var token = Utilities.getUuid().replace(/-/g, '').slice(0, 10);
  var summary = lines.join('\n');
  botCachePut_('linep:' + id, { token: token, ops: ops, summary: summary, at: botNow_() }, BOT_PENDING_SECONDS);
  return { token: token, summary: summary };
}

function botCommit_(id, body) {
  var ctx = botStaffCtx_(id);
  if (!ctx.ok) throw new Error(ctx.problem || '這個帳號還沒開通');
  var p = botPendingGet_(id);
  if (!p) throw new Error('沒有等待確認的修改（可能已經超過 15 分鐘，請重新說一次）');
  if (body.token && String(body.token) !== p.token) throw new Error('這不是最新一筆等待確認的修改，請用最新的確認按鈕');
  var results = [];
  botCacheRemove_(['linep:' + id]); // 先清掉，避免按兩次寫兩次
  withLock_(function () {
    p.ops.forEach(function (w) {
      botWriteCheck_(ctx, w); // 確認當下再檢查一次權限與資料
      results.push(botWriteRun_(ctx, w));
    });
  });
  return { summary: p.summary, count: results.length, results: results };
}

function botUserFor_(ctx) {
  return { username: ctx.username || ctx.name || 'LINE', displayName: ctx.name || ctx.username || 'LINE' };
}

function botWriteRun_(ctx, w) {
  var d = w.data || {};
  var s = function (k) { return String(d[k] == null ? '' : d[k]).trim(); };
  var user = botUserFor_(ctx);
  if (w.action === 'remember') {
    botMemoryWrite_(ctx, { mode: 'add', scope: d.scope === 'all' ? 'all' : 'user', category: s('category'), content: s('content'), importance: d.importance });
    return { action: w.action, ok: true };
  }
  if (w.action === 'addMemo') {
    var today = todayStr();
    appendObjectRow(SHEET_MEMOS, { Owner: ctx.username || user.username, OwnerName: user.displayName, Title: s('title'), Content: s('content'), Shared: d.shared === true ? '是' : '', CreatedDate: today, LastUpdated: today });
    return { action: w.action, ok: true };
  }
  if (w.action === 'logFollowUp') {
    var c = botFindCustomerRow_(s('company'));
    var fields = {};
    if (d.stop === true) {
      fields.NextFollowUpDate = '';
      fields.NextFollowUpNote = '';
    } else {
      if (s('nextDate')) fields.NextFollowUpDate = s('nextDate');
      if (s('nextTime')) fields.NextFollowUpTime = s('nextTime');
      if (s('nextNote')) fields.NextFollowUpNote = s('nextNote');
    }
    var res = handleSaveFollowUp({
      _user: user,
      rowIndex: c.row,
      companyName: c.obj['CompanyName'],
      fields: fields,
      caseId: s('caseId'),
      log: s('summary') ? { method: s('method') || '其他', contact: s('contact'), summary: s('summary'), caseId: s('caseId') } : undefined,
    });
    if (!res.success) throw new Error(res.message);
    return { action: w.action, ok: true, company: c.obj['CompanyName'] };
  }
  if (w.action === 'updateCustomer') {
    var cu = botFindCustomerRow_(s('company'));
    var r2 = handleUpdateCustomer({ _user: user, rowIndex: cu.row, companyName: cu.obj['CompanyName'], fields: d.fields });
    if (!r2.success) throw new Error(r2.message);
    return { action: w.action, ok: true };
  }
  if (w.action === 'addCustomer') {
    var r3 = handleAddCustomer({ _user: user, companyName: s('companyName'), contact: s('contact'), phone: s('phone'), email: s('email'), category: s('category') || '一般客戶', urgency: s('urgency') || '中', notes: s('notes') });
    if (!r3.success) throw new Error(r3.message);
    return { action: w.action, ok: true };
  }
  if (w.action === 'createCase') {
    var r4 = handleCreateCase({ _user: user, customerName: botFindCustomerRow_(s('customerName')).obj['CompanyName'], projectContact: s('projectContact'), contactPhone: s('contactPhone'), salesperson: s('salesperson') || ctx.name, productApplication: s('productApplication'), testObject: s('testObject'), softwareName: s('softwareName'), requirementDetails: s('requirementDetails'), urgency: s('urgency') });
    if (!r4.success) throw new Error(r4.message);
    return { action: w.action, ok: true, caseId: r4.caseId };
  }
  if (w.action === 'updateCaseStatus') {
    var f = {};
    if (s('status')) f.Status = s('status');
    if (s('urgency')) f.Urgency = s('urgency');
    var r5 = handleUpdateCase({ _user: user, caseId: s('caseId'), fields: f });
    if (!r5.success) throw new Error(r5.message);
    return { action: w.action, ok: true };
  }
  throw new Error('不能執行：' + w.action);
}

// ------------------------------------------------------------
// 長期記憶：個人的（只有本人的助理知道）與全公司的（每個人的助理都知道）
// ------------------------------------------------------------
function botMemoryAll_() {
  return sheetToObjects(SHEET_BOT_MEMORY).rows.map(function (r, i) {
    return { RowIndex: i + 2, id: Number(r['ID']) || 0, scope: r['Scope'] === 'all' ? 'all' : 'user', owner: String(r['Owner'] || ''), category: String(r['Category'] || ''), content: String(r['Content'] || ''), importance: botInt_(r['Importance'], 1, 5, 3), updatedAt: String(r['UpdatedAt'] || '') };
  });
}

/** 這個人的助理帶著的記憶：全公司 + 自己的，依重要度、最近修改排序（上限 maxItems）。 */
function botMemoryFor_(ctx) {
  var max = botStaffCfg_().memory.maxItems;
  var items = botMemoryAll_().filter(function (m) { return m.scope === 'all' || m.owner === ctx.ownerKey; });
  items.sort(function (a, b) { return b.importance - a.importance || String(b.updatedAt).localeCompare(String(a.updatedAt)); });
  return items.slice(0, Math.max(max, 1) * 3 > 300 ? 300 : max * 3).map(function (m) { return { id: m.id, scope: m.scope, category: m.category, content: m.content, importance: m.importance, updatedAt: m.updatedAt }; });
}

function botMemoryNextId_() {
  var max = 0;
  botMemoryAll_().forEach(function (m) { max = Math.max(max, m.id); });
  return max + 1;
}

/** 新增 / 修改 / 刪除一筆記憶（個人的只能動自己的；全公司的要有權限）。 */
function botMemoryWrite_(ctx, op) {
  var mode = String(op.mode || 'add');
  var scope = op.scope === 'all' ? 'all' : 'user';
  var cfg = botStaffCfg_().memory;
  if (scope === 'all' && !(cfg.canShared || blocksCanShare_(ctx))) throw new Error('只有有「BOT 設定」編輯權限的人（或管理員開放後）可以新增 / 修改全公司的記憶');
  var content = botClip_(op.content, 300);
  var category = BOT_MEMORY_CATEGORIES.indexOf(op.category) > -1 ? op.category : '其他';
  var importance = botInt_(op.importance, 1, 5, 3);
  if (mode === 'add') {
    if (!content) throw new Error('記憶內容不能空白');
    var mine = botMemoryAll_().filter(function (m) { return m.scope === scope && (scope === 'all' || m.owner === ctx.ownerKey); });
    if (mine.some(function (m) { return m.content === content; })) return { id: 0, duplicate: true };
    if (mine.length >= 200) throw new Error('記憶太多了（上限 200 筆），請先刪掉不需要的');
    var id = botMemoryNextId_();
    appendObjectRow(SHEET_BOT_MEMORY, { ID: id, Scope: scope, Owner: scope === 'all' ? '' : ctx.ownerKey, Category: category, Content: content, Importance: importance, UpdatedAt: botNow_() });
    return { id: id, content: content };
  }
  var target = botMemoryAll_().filter(function (m) { return m.id === Number(op.id); })[0];
  if (!target) throw new Error('找不到這筆記憶');
  if (target.scope === 'user' && target.owner !== ctx.ownerKey) throw new Error('這是別人的個人記憶');
  if (target.scope === 'all' && !(cfg.canShared || blocksCanShare_(ctx))) throw new Error('沒有權限修改全公司的記憶');
  if (mode === 'delete') {
    getSheet(SHEET_BOT_MEMORY).deleteRow(target.RowIndex);
    return { id: target.id, deleted: true };
  }
  if (!content) throw new Error('記憶內容不能空白');
  updateRowFields(SHEET_BOT_MEMORY, target.RowIndex, { Category: category, Content: content, Importance: importance, UpdatedAt: botNow_() });
  return { id: target.id, content: content };
}

// ------------------------------------------------------------
// BOT 設定頁（員工助理）
// ------------------------------------------------------------
function handleBotGetStaff(body) {
  var cfg = botStaffCfg_();
  var accounts = sheetToObjects(SHEET_USERS).rows.map(function (u) { return { username: String(u['Username']), name: String(u['DisplayName'] || u['Username']) }; });
  var names = {};
  accounts.forEach(function (a) { names[a.username] = a.name; });
  var members = botMemberRows_().map(function (m) {
    return {
      LineUserId: String(m['LineUserId']),
      DisplayName: String(m['DisplayName'] || ''),
      PictureUrl: String(m['PictureUrl'] || ''),
      Status: String(m['Status'] || BOT_STAFF_STATUS.PENDING),
      Role: String(m['Role'] || 'viewer'),
      PermsObj: cleanPerms_(m['Perms']),
      LinkedUsername: String(m['LinkedUsername'] || ''),
      LinkedName: m['LinkedUsername'] ? names[m['LinkedUsername']] || '（帳號已不存在）' : '',
      Note: String(m['Note'] || ''),
      PushDaily: m['PushDaily'] === true || String(m['PushDaily']).toUpperCase() === 'TRUE',
      IsFollowing: !(m['IsFollowing'] === false || String(m['IsFollowing']).toUpperCase() === 'FALSE'),
      FollowedAt: String(m['FollowedAt'] || ''),
      LastSeenAt: String(m['LastSeenAt'] || ''),
      ApprovedBy: String(m['ApprovedBy'] || ''),
    };
  });
  return {
    success: true,
    config: cfg,
    members: members,
    accounts: accounts,
    me: body._user.username,
    canLinkOthers: accessOf_(findUserRow_(body._user.username)).isAdmin,
    memory: botMemoryAll_(),
    memoryCategories: BOT_MEMORY_CATEGORIES,
    blocks: PERM_BLOCKS,
    writes: Object.keys(BOT_STAFF_WRITES).map(function (k) { return { key: k, label: BOT_STAFF_WRITES[k].label, block: BOT_STAFF_WRITES[k].block }; }),
  };
}

function handleBotSaveStaff(body) {
  return withLock_(function () {
    var cur = botCfg_('staff', {}) || {};
    var c = body.config || {};
    var next = Object.assign({}, cur);
    ['enabled', 'webEnabled'].forEach(function (k) { if (c[k] !== undefined) next[k] = c[k] === true; });
    ['welcome', 'pendingText', 'prompt'].forEach(function (k) { if (c[k] !== undefined) next[k] = String(c[k]).slice(0, 4000); });
    if (c.ceiling) next.ceiling = botStaffCeiling_(c.ceiling);
    if (Array.isArray(c.writes)) next.writes = botStaffWrites_(c.writes);
    if (c.hidePrice !== undefined) next.hidePrice = c.hidePrice === true;
    if (c.push) next.push = Object.assign({}, cur.push || {}, { enabled: c.push.enabled === true, hour: botInt_(c.push.hour, 0, 23, 8) });
    if (c.memory) {
      var m = c.memory;
      next.memory = { enabled: m.enabled !== false, maxItems: botInt_(m.maxItems, 5, 100, 30), confirm: m.confirm !== false, canShared: m.canShared === true, auto: m.auto === true, autoEvery: botInt_(m.autoEvery, 2, 30, 6) };
    }
    botCfgSet_('staff', next);
    if (next.push && next.push.enabled) botInstallPushTrigger_();
    return { success: true, config: botStaffCfg_() };
  });
}

/** 儲存成員設定：{ lineUserId, status, role, perms, linkedUsername, note, pushDaily }（沒帶的欄位不改）。 */
function handleBotMemberSave(body) {
  return withLock_(function () {
    var m = botMemberFind_(String(body.lineUserId || ''));
    if (!m) return { success: false, message: '找不到這位成員' };
    var patch = {};
    if (body.status !== undefined) {
      var statuses = Object.keys(BOT_STAFF_STATUS).map(function (k) { return BOT_STAFF_STATUS[k]; });
      if (statuses.indexOf(body.status) < 0) return { success: false, message: '狀態不正確' };
      patch.Status = body.status;
      if (body.status === BOT_STAFF_STATUS.ACTIVE && m['Status'] !== BOT_STAFF_STATUS.ACTIVE) {
        patch.ApprovedBy = body._user.displayName || body._user.username;
        patch.ApprovedAt = botNow_();
      }
    }
    if (body.role !== undefined) {
      if (['editor', 'viewer', 'limited'].indexOf(body.role) < 0) return { success: false, message: '角色要是 編輯者 / 查看 / 特定' };
      patch.Role = body.role;
      var perms = body.role === 'limited' ? cleanPerms_(body.perms !== undefined ? body.perms : m['Perms']) : {};
      if (body.role === 'limited' && !Object.keys(perms).length) return { success: false, message: '「特定」至少要開放一個功能區塊' };
      patch.Perms = body.role === 'limited' ? JSON.stringify(perms) : '';
    }
    if (body.linkedUsername !== undefined) {
      var link = String(body.linkedUsername || '');
      if (link !== String(m['LinkedUsername'] || '')) {
        if (link && !findUserRow_(link)) return { success: false, message: '找不到網站帳號' };
        // 綁定別人的帳號 = 看得到那個人的個人備忘錄：只有系統管理員可以；其他人只能綁定自己的
        if (link && link !== body._user.username && !accessOf_(findUserRow_(body._user.username)).isAdmin) return { success: false, message: '🔐 只有系統管理員可以綁定其他人的網站帳號（你只能綁定自己的）' };
        patch.LinkedUsername = link;
      }
    }
    if (body.note !== undefined) patch.Note = botClip_(body.note, 300);
    if (body.pushDaily !== undefined) patch.PushDaily = body.pushDaily === true;
    updateRowFields(SHEET_BOT_MEMBERS, m.RowIndex, patch);
    // 開通 / 停用後，「新成員」通知就算處理完了
    if (patch.Status && patch.Status !== BOT_STAFF_STATUS.PENDING) botMemoDone_('botMember', m['LineUserId']);
    return { success: true };
  });
}

function botMemoDone_(linkType, linkId) {
  var sheet = getSheet(SHEET_MEMOS);
  var data = sheet.getDataRange().getValues();
  var h = data[0];
  var lt = h.indexOf('LinkType');
  var li = h.indexOf('LinkId');
  if (lt < 0 || li < 0) return;
  for (var i = data.length - 1; i >= 1; i--) if (data[i][lt] === linkType && String(data[i][li]) === String(linkId)) sheet.deleteRow(i + 1);
}

function handleBotMemberRemove(body) {
  return withLock_(function () {
    var m = botMemberFind_(String(body.lineUserId || ''));
    if (!m) return { success: false, message: '找不到這位成員' };
    getSheet(SHEET_BOT_MEMBERS).deleteRow(m.RowIndex);
    botMemoDone_('botMember', m['LineUserId']);
    botCacheRemove_([botStaffHistKey_(String(m['LineUserId'])), 'linep:' + m['LineUserId']]);
    return { success: true };
  });
}

function handleBotMemorySave(body) {
  var ctx = { ownerKey: body._user.username, access: accessOf_(findUserRow_(body._user.username)) };
  var d = body.data || {};
  try {
    // 後台新增的個人記憶歸「這個帳號」；全公司的不限
    var res = withLock_(function () { return botMemoryWrite_(ctx, d); });
    return { success: true, result: res };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

function handleBotMemoryDelete(body) {
  var all = botMemoryAll_();
  var ids = {};
  (body.ids || []).forEach(function (x) { ids[Number(x)] = true; });
  return withLock_(function () {
    var n = 0;
    all.slice().sort(function (a, b) { return b.RowIndex - a.RowIndex; }).forEach(function (m) {
      if (ids[m.id]) {
        getSheet(SHEET_BOT_MEMORY).deleteRow(m.RowIndex);
        n++;
      }
    });
    return { success: true, deleted: n };
  });
}

// ------------------------------------------------------------
// 每日早報：每小時檢查一次，到設定的時間（台灣時間）通知機器人伺服器推播給勾了「每天推播早報」的成員
// ------------------------------------------------------------
function botInstallPushTrigger_() {
  var exists = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'botPushTick'; });
  if (!exists) ScriptApp.newTrigger('botPushTick').timeBased().everyHours(1).create();
}

function botPushTick() {
  var cfg = botStaffCfg_();
  if (!cfg.enabled || !cfg.push.enabled) return;
  var now = new Date();
  var hour = Number(Utilities.formatDate(now, 'GMT+8', 'H'));
  var today = todayStr();
  if (hour !== cfg.push.hour || cfg.push.last === today) return;
  var c = botCfg_('staff', {}) || {};
  c.push = Object.assign({}, c.push || {}, { last: today });
  botCfgSet_('staff', c);
  botPushRequest_();
}

function botPushRequest_() {
  var url = botGeneral_().botUrl;
  var secret = botKey_('staff');
  if (!url || !secret) throw new Error('還沒有設定機器人網址或 Bot 金鑰');
  var res = UrlFetchApp.fetch(url.replace(/\/+$/, '') + '/api/push', { method: 'post', contentType: 'application/json', headers: { 'x-bot-secret': secret }, muteHttpExceptions: true, payload: '{}' });
  return { code: res.getResponseCode(), body: String(res.getContentText()).slice(0, 300) };
}

/** 按「立即推播一次」：馬上請機器人伺服器推播早報給勾選的成員（測試用）。 */
function handleBotPushNow(body) {
  try {
    var r = botPushRequest_();
    if (r.code < 200 || r.code >= 300) return { success: false, message: '機器人伺服器回應 ' + r.code + '：' + r.body };
    return { success: true, message: r.body };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

/** linebot 的 pushTargets：要推早報的成員編號。 */
function botPushTargets_() {
  return botMemberRows_()
    .filter(function (m) { return m['Status'] === BOT_STAFF_STATUS.ACTIVE && (m['PushDaily'] === true || String(m['PushDaily']).toUpperCase() === 'TRUE') && !(m['IsFollowing'] === false || String(m['IsFollowing']).toUpperCase() === 'FALSE'); })
    .map(function (m) { return String(m['LineUserId']); });
}

// ------------------------------------------------------------
// 網站智能助理（右下角）：同一個機器人，用登入帳號本人的權限
//   網站 → 這裡驗證登入、記下「W 編號 → 帳號」10 分鐘 → 轉給機器人伺服器 /api/web；機器人拿不到登入權杖，
//   只能用 W 編號回頭查詢（權限 = 這個網站帳號）。
// ------------------------------------------------------------
function handleBotAssistInfo(body) {
  var cfg = botStaffCfg_();
  var reason = '';
  if (!cfg.enabled) reason = '員工助理還沒有啟用';
  else if (!cfg.webEnabled) reason = '網站智能助理沒有開放';
  else if (!botGeneral_().botUrl) reason = '機器人伺服器（Vercel）還沒有連線';
  else if (!botKey_('staff')) reason = '還沒有產生員工助理金鑰';
  return { success: true, enabled: !reason, reason: reason };
}

function handleBotAssist(body) {
  var cfg = botStaffCfg_();
  if (!cfg.enabled || !cfg.webEnabled) return { success: false, message: '網站智能助理沒有開放' };
  var url = botGeneral_().botUrl;
  var secret = botKey_('staff');
  if (!url || !secret) return { success: false, message: '機器人還沒連線：請系統管理員到「BOT 設定 → 連線與設定」完成設定' };
  var id = botWebId_(body._user.username);
  botCachePut_('webid:' + id, body._user.username, 600);
  var payload = { secret: secret, id: id, text: String(body.text || '').slice(0, 1500), confirm: body.confirm === true ? true : body.confirm === false ? false : undefined, token: body.token || '', reset: body.reset === true, displayName: body._user.displayName || body._user.username };
  var res;
  try {
    res = UrlFetchApp.fetch(url.replace(/\/+$/, '') + '/api/web', { method: 'post', contentType: 'application/json', muteHttpExceptions: true, payload: JSON.stringify(payload) });
  } catch (e) {
    return { success: false, message: '連不上機器人伺服器，請稍後再試' };
  }
  var json = {};
  try {
    json = JSON.parse(res.getContentText() || '{}');
  } catch (e) {
    return { success: false, message: '機器人伺服器回應格式錯誤（' + res.getResponseCode() + '）' };
  }
  if (res.getResponseCode() !== 200) return { success: false, message: json.error || '機器人伺服器錯誤（' + res.getResponseCode() + '）' };
  return { success: true, reply: json.reply || '', choices: json.choices || [], pending: json.pending || null };
}
