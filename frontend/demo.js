/**
 * ============================================================
 * demo.js - 示範模式(DEMO_MODE = true)用的假後端
 * ------------------------------------------------------------
 * 所有資料都存在瀏覽器的 localStorage，不會真的連 Google 試算表。
 * 每一頁都會載入這支檔案，因為每一頁的 callApi() 都可能在示範模式下
 * 呼叫到這裡。正式串接後端後(DEMO_MODE = false)，這支檔案完全不會被用到。
 * ============================================================
 */

const DEMO_DB_KEY = 'aoi_demo_db';

function loadDemoDB() {
  const saved = localStorage.getItem(DEMO_DB_KEY);
  if (saved) {
    const parsed = JSON.parse(saved);
    if (!parsed.staff) parsed.staff = []; // 相容舊版本存的示範資料庫
    if (!parsed.devices) parsed.devices = [];
    if (!parsed.customerContacts) parsed.customerContacts = [];
    if (!parsed.users) parsed.users = [];
    return parsed;
  }

  const initial = {
    products: [
      { InternalModel: 'AOI-CAM-001', SupplierModel: 'SUP-XA100', Supplier: '供應商A', SupplierContact: '王小姐', SupplierContactEmail: 'demo@example.com', Origin: '台灣', Category: '相機', CompatibleGroup: 'G1', RefPrice: 15000, Notes: '' },
      { InternalModel: 'AOI-LENS-001', SupplierModel: 'SUP-XA100-LENS', Supplier: '供應商A', SupplierContact: '王小姐', SupplierContactEmail: 'demo@example.com', Origin: '日本', Category: '光源', CompatibleGroup: 'G1', RefPrice: 5000, Notes: '需搭配 AOI-CAM-001' },
      { InternalModel: 'AOI-LIGHT-010', SupplierModel: 'SUP-LB50', Supplier: '供應商B', SupplierContact: '陳先生', SupplierContactEmail: 'demo2@example.com', Origin: '台灣', Category: '調光器', CompatibleGroup: 'G2', RefPrice: 8000, Notes: '' },
    ],
    priceHistory: [
      { Date: '2026-08-20', ProductInternalModel: 'AOI-CAM-001', Supplier: '供應商A', Price: 14500, Currency: 'TWD', CaseID: '', Notes: '上次詢價' },
    ],
    cases: [],
    customers: [],
    contactLogs: [],
    staff: [],
    devices: [],
    customerContacts: [],
    users: [],
  };
  localStorage.setItem(DEMO_DB_KEY, JSON.stringify(initial));
  return initial;
}

function demoUsers() {
  return [{ username: 'demo', name: '示範使用者' }, { username: 'amy', name: '艾咪' }, { username: 'bob', name: '鮑勃' }, { username: 'cat', name: '凱特' }];
}

function demoShareLabel(db, mode, list) {
  if (mode === 'all') return '全部同事（只能看）';
  if (mode === 'users') return '指定 ' + (list || []).length + ' 人';
  if (mode === 'groups') return '群組：' + (list || []).map((id) => ((db.groups || []).find((g) => g.id === Number(id)) || { name: '（已刪除）' }).name).join('、');
  return '只有自己';
}

/** 第一次用時放幾筆示範資料（自己的 + 艾咪分享的），之後的新增 / 修改都存在瀏覽器。 */
function demoWsSeed(db) {
  if (db.cal && db.todos) return;
  const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  db.cal = [
    { id: 1, title: '（示範）拜訪客戶', startDate: day(0), startTime: '14:00', endDate: day(0), endTime: '15:00', allDay: false, location: '新竹', notes: '', shareMode: 'self', shareWith: [], source: 'manual', refKey: '', owner: 'demo' },
    { id: 2, title: '（示範）艾咪分享：展覽布展', startDate: day(1), startTime: '', endDate: day(2), endTime: '', allDay: true, location: '', notes: '被分享的人只能查看', shareMode: 'all', shareWith: [], source: 'manual', refKey: '', owner: 'amy' },
  ];
  db.todos = [
    { id: 1, title: '（示範）寄樣品給甲公司', notes: '', dueDate: day(1), priority: '高', status: 'todo', shareMode: 'self', shareWith: [], owner: 'demo', createdAt: day(0), doneAt: '' },
    { id: 2, title: '（示範）艾咪分享：整理報價單', notes: '', dueDate: day(3), priority: '中', status: 'todo', shareMode: 'all', shareWith: [], owner: 'amy', createdAt: day(0), doneAt: '' },
  ];
  db.groups = db.groups || [];
}

function demoEventOut(db, e) {
  const mine = e.owner === 'demo';
  return Object.assign({}, e, { endDate: e.endDate || e.startDate, shareLabel: demoShareLabel(db, e.shareMode, e.shareWith), ownerName: mine ? '我' : demoUsers().find((u) => u.username === e.owner).name, isMine: mine, canEdit: mine });
}

function demoTodoOut(db, t) {
  const mine = t.owner === 'demo';
  return Object.assign({}, t, { shareLabel: demoShareLabel(db, t.shareMode, t.shareWith), ownerName: mine ? '我' : demoUsers().find((u) => u.username === t.owner).name, isMine: mine, canEdit: mine });
}

function saveDemoDB(db) {
  localStorage.setItem(DEMO_DB_KEY, JSON.stringify(db));
}

function demoCaseId() {
  return 'C' + Date.now();
}

/** 示範模式的「產生文件」：html 格式回傳真的 HTML；pdf/docx 格式回傳純文字說明取代。 */
function demoDocResult(filenamePrefix, format, textSummary) {
  if (format === 'html') {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${filenamePrefix}</title></head><body><pre>${textSummary}</pre></body></html>`;
    return { success: true, filename: filenamePrefix + '.html', mimeType: 'text/html', base64: btoa(unescape(encodeURIComponent(html))) };
  }
  const ext = format === 'docx' ? '_demo.txt（示範模式不產生真的docx）' : '_demo.txt（示範模式不產生真的pdf）';
  return { success: true, filename: filenamePrefix + ext, mimeType: 'text/plain', base64: btoa(unescape(encodeURIComponent(textSummary))) };
}

const DEMO_FIELD_LABELS = {
  CompanyName: '公司名稱', Contact: '聯絡人', Phone: '聯繫人電話', Email: 'Email', CompanyPhone: '公司電話', TaxId: '統一編號', Address: '地址',
  Category: '分類', Urgency: '急迫性', Notes: '客戶備註', HasTransacted: '交易狀態', LastTransactionDate: '最近交易日',
  NextFollowUpDate: '下次追蹤日', NextFollowUpTime: '預約時間', NextFollowUpNote: '下次洽談內容',
};

function demoNow() {
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  return { date: `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`, stamp: `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}` };
}

/** 示範模式：找客戶（先看公司名稱，找不到再看列號），回傳陣列索引或 -1。 */
function demoFindCustomer(db, rowIndex, companyName) {
  if (companyName) {
    const i = db.customers.findIndex((c) => c.CompanyName === companyName);
    if (i > -1) return i;
    return -1;
  }
  return db.customers[rowIndex] ? Number(rowIndex) : -1;
}

/** 示範模式：改客戶資料 + 記修改紀錄 + 公司改名連動，等同後端 applyCustomerUpdate_ / handleSaveFollowUp。 */
function demoSaveCustomer(db, params) {
  const idx = demoFindCustomer(db, params.rowIndex, params.companyName);
  if (idx < 0) return { success: false, message: '找不到這間客戶（可能已被刪除或改名），請按「↻ 重撈資料」後再試' };
  const cust = db.customers[idx];
  const fields = Object.assign({}, params.fields || {});
  if (fields.CompanyName !== undefined) {
    fields.CompanyName = String(fields.CompanyName).trim();
    if (!fields.CompanyName) return { success: false, message: '公司名稱不能空白' };
    const key = (v) => String(v).replace(/\s+/g, '').toLowerCase();
    if (db.customers.some((c, i) => i !== idx && key(c.CompanyName) === key(fields.CompanyName))) return { success: false, message: '已經有「' + fields.CompanyName + '」這間客戶了，不能改成重複的名稱。' };
  }
  if (fields.NextFollowUpDate === '') fields.NextFollowUpTime = '';
  const changed = Object.keys(fields).filter((k) => String(cust[k] == null ? '' : cust[k]).trim() !== String(fields[k] == null ? '' : fields[k]).trim());
  const oldObj = Object.assign({}, cust);
  const lines = changed.map((k) => `${DEMO_FIELD_LABELS[k] || k}：${oldObj[k] ? String(oldObj[k]).slice(0, 40) : '（空白）'} → ${fields[k] ? String(fields[k]).slice(0, 40) : '（空白）'}`);
  let keptOld = false;
  changed.forEach((k) => (cust[k] = fields[k]));
  if (changed.indexOf('CompanyName') > -1) {
    db.cases.forEach((c) => {
      if (c.CustomerName === oldObj.CompanyName) c.CustomerName = cust.CompanyName;
      if (c.EndCustomerName === oldObj.CompanyName) c.EndCustomerName = cust.CompanyName;
    });
    (db.customerContacts || []).forEach((c) => c.CompanyName === oldObj.CompanyName && (c.CompanyName = cust.CompanyName));
    db.contactLogs.forEach((l) => l.CompanyName === oldObj.CompanyName && (l.CompanyName = cust.CompanyName));
  }
  if (params.keepOldContact && changed.indexOf('Contact') > -1 && oldObj.Contact) {
    db.customerContacts = db.customerContacts || [];
    if (!db.customerContacts.some((c) => c.CompanyName === cust.CompanyName && c.ContactName === oldObj.Contact)) {
      db.customerContacts.push({ CompanyName: cust.CompanyName, ContactName: oldObj.Contact, Phone: oldObj.Phone || '', Email: oldObj.Email || '', Title: '', Notes: '原主要聯絡人（' + demoNow().date + ' 更換）' });
      keptOld = true;
    }
  }
  const now = demoNow();
  const follow = ['NextFollowUpDate', 'NextFollowUpTime', 'NextFollowUpNote'];
  const method = changed.length && changed.every((k) => follow.indexOf(k) > -1) ? '改期' : '資料修改';
  let log = null;
  const mk = (o) => {
    const row = Object.assign({ Date: now.date, CreatedAt: now.stamp, CompanyName: cust.CompanyName, Contact: '', Method: '', Summary: '', Salesperson: typeof currentUsername !== 'undefined' ? currentUsername : '', CaseID: '', Changes: '' }, o);
    db.contactLogs.push(row);
    return Object.assign({ RowIndex: db.contactLogs.length - 1 }, row);
  };
  if (params.log) {
    if (!String(params.log.summary || '').trim()) return { success: false, message: '請填寫這次追蹤的結果 / 聯繫內容' };
    log = mk({ Contact: params.log.contact || '', Method: params.log.method || '', Summary: String(params.log.summary).trim(), CaseID: params.log.caseId || '', Changes: lines.join('\n') });
  } else if (lines.length && !params.noLog) {
    log = mk({ Method: params.logMethod || method, Summary: params.logSummary || (method === '改期' ? '修改下次追蹤' : '修改客戶資料'), CaseID: params.caseId || '', Changes: lines.join('\n') });
  }
  saveDemoDB(db);
  return { success: true, customer: Object.assign({ RowIndex: idx }, cust), log, changes: lines, keptOldContact: keptOld };
}

// ---- 示範模式的 BOT 設定（資料存在本機）----
const DEMO_BOT_TOPICS = [
  { key: 'price', name: '價格 / 報價', words: '多少錢 價格 價錢 售價 報價 費用 幾元 優惠 折扣 特價 便宜 預算', ask: '為了加快報價，請先留下以下資料：\n・公司名稱與聯絡人\n・電話或 Email\n・需要的產品型號 / 數量，或應用說明' },
  { key: 'order', name: '訂購 / 下單', words: '訂購 下單 訂貨 我要買 怎麼買 想買 購買 採購', ask: '為了加快處理，請先留下以下資料：\n・公司名稱與聯絡人\n・電話\n・想訂購的品項與數量\n・希望交期' },
  { key: 'sample', name: '樣品測試 / 專案評估', words: '樣品 打樣 測試 評估 專案 客製 驗證 試用 借測', ask: '請先留下您的需求，FAE 會更快回覆您：\n・公司名稱與聯絡人、電話\n・產品應用與待測物件\n・檢測需求（要抓什麼缺陷、精度、速度）' },
  { key: 'shipping', name: '運費 / 交期', words: '運費 配送 寄送 出貨 物流 到貨 交期 現貨 缺貨', ask: '' },
  { key: 'complaint', name: '客訴 / 退換貨 / 維修', words: '退貨 退款 換貨 客訴 投訴 故障 維修 壞掉 保固 RMA 不良', ask: '' },
];

const DEMO_CS_FIELDS = [['SupplierModel', '原廠型號'], ['Category', '類別'], ['Brand', '品牌'], ['Interface', '介面'], ['Resolution', '解析度'], ['PixelSize', '像元尺寸 µm'], ['SensorSize', '靶面'], ['FPS', '影格率 fps'], ['Mount', '接口'], ['FocalLength', '焦距 mm'], ['Magnification', '放大倍率'], ['WD', '工作距離 WD'], ['DOF', '景深 DOF'], ['FocusWD', '最近對焦距離']];

function demoBotState(db) {
  if (!db.bot) {
    db.bot = {
      cs: { enabled: false, welcome: '', prompt: '', handoffText: '', sources: { qa: true, docs: true, products: false, brand: true, productLimit: 1500, productCategories: '', productFields: DEMO_CS_FIELDS.map((f) => f[0]) }, brandInfo: '', replyWhen: 'always', hours: { enabled: false, days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00', offText: '' }, handoffWords: '真人 客服人員 小編 專人 人工 業務', pauseMinutes: 30, topics: {}, customWords: '', customAsk: '', customAskPos: 'after', topicText: '', unsure: 'ask', style: { tone: 'friendly', address: '您', emoji: 'some', maxLines: 5 }, buttons: '', buttonsAlways: false, web: { enabled: false, title: '線上客服', subtitle: '有任何問題都可以問我', color: '#2c5aa0', position: 'right', autoOpen: false, allowedOrigins: '' } },
      general: { replyDelay: 2, botUrl: '', brand: '鑫堡股份有限公司', memory: { turns: 10, hours: 6, chars: 600 } },
      ai: [], kb: [], messages: [], pauses: [], key: '',
    };
  }
  return db.bot;
}

function demoBotCs(b) {
  const cs = JSON.parse(JSON.stringify(b.cs));
  const stored = cs.topics || {};
  cs.topics = DEMO_BOT_TOPICS.map((t) => {
    const v = stored[t.key] || {};
    return { key: t.key, name: t.name, on: v.on === true, words: String(v.words || '').trim() || t.words, defaultWords: t.words, ask: v.ask === undefined ? t.ask : v.ask, defaultAsk: t.ask, askPos: v.askPos === 'before' ? 'before' : 'after' };
  });
  return cs;
}

function demoBotApi(action, params, db) {
  const b = demoBotState(db);
  const save = () => saveDemoDB(db);
  const nowStr = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
  const masked = () => b.ai.map((m, i) => ({ provider: m.provider, model: m.model, endpoint: m.endpoint, name: m.name || '', uses: m.uses || (i === 0 ? ['all'] : []), hasKey: !!m.apiKey, keyHint: '••••' + String(m.apiKey).slice(-4), defaultModel: '' }));
  switch (action) {
    case 'botGetSettings':
      return {
        success: true, cs: demoBotCs(b), general: b.general, ai: masked(),
        aiProviders: { gemini: { name: 'Gemini', endpoint: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.5-flash' }, claude: { name: 'Claude', endpoint: 'https://api.anthropic.com/v1', model: 'claude-sonnet-5-5' }, openai: { name: 'OpenAI 相容', endpoint: 'https://api.openai.com/v1', model: 'gpt-4o-mini' } },
        aiFeatures: { all: '整個系統', cs: 'LINE 機器人（含網站客服視窗）', copy: 'AI 文案', staff: '小助理（員工助理）', vector: '向量' }, aiRounds: b.aiRounds || 6,
        aiUsing: b.ai.length ? { source: 'bot', name: b.ai[0].provider, model: b.ai[0].model || 'default', count: b.ai.length } : null,
        search: b.search || { mode: 'vector', threshold: 0.6, topK: 6, embedProvider: 'auto' }, keys: { cs: { has: !!b.key, hint: b.key ? '••••' + b.key.slice(-4) : '', shared: false }, staff: { has: !!b.staffKey, hint: b.staffKey ? '••••' + b.staffKey.slice(-4) : '', shared: false } }, csProductFields: DEMO_CS_FIELDS, gasUrl: '', kbCount: b.kb.length, pauses: b.pauses, topicDefaults: DEMO_BOT_TOPICS,
      };
    case 'botSaveSettings': {
      if (params.cs) {
        const t = {};
        (params.cs.topics || []).forEach((x) => (t[x.key] = { on: x.on === true, words: x.words, ask: x.ask, askPos: x.askPos }));
        b.cs = Object.assign({}, b.cs, params.cs, { topics: t });
      }
      if (params.general) b.general = Object.assign({}, b.general, params.general);
      if (params.search) b.search = Object.assign({ mode: 'vector', threshold: 0.6, topK: 6, embedProvider: 'auto' }, b.search, params.search);
      save();
      return { success: true };
    }
    case 'botSaveAi': {
      const taken = {};
      b.ai = (params.models || []).slice(0, 8).map((m, i) => ({ provider: m.provider, model: m.model, endpoint: m.endpoint, name: m.name || '', uses: (m.uses || []).filter((u) => !taken[u] && (taken[u] = true)), apiKey: m.apiKey || (b.ai[i] && b.ai[i].apiKey) || '' })).filter((m) => m.apiKey);
      if (params.maxRounds) b.aiRounds = Math.min(12, Math.max(1, Number(params.maxRounds) || 6));
      save();
      return { success: true, ai: masked() };
    }
    case 'botTestAi':
      return b.ai[params.index || 0] ? { success: true, reply: '成功', ms: 321, model: b.ai[params.index || 0].model || 'default', provider: b.ai[params.index || 0].provider } : { success: false, message: '沒有這個模型' };
    case 'botKbList':
      return { success: true, items: b.kb.map((k, i) => Object.assign({ RowIndex: i + 2, BigCategory: '', Topic: '', Notes: '', HasVector: false }, k)), embed: b.ai.some((m) => m.provider !== 'claude') ? { provider: 'gemini', model: 'gemini-embedding-001', dim: 256 } : null, categories: [...new Set(b.kb.map((k) => k.BigCategory).filter(Boolean))], pendingVectors: b.kb.filter((k) => !k.HasVector).length };
    case 'botKbEmbed':
      b.kb.forEach((k) => (k.HasVector = true));
      save();
      return { success: true, embedded: 0, next: 0, total: 0, remaining: 0, done: true };
    case 'botKbSave': {
      const row = { BigCategory: params.bigCategory || '', Topic: params.topic || '', Notes: params.notes || '', HasVector: false, ID: params.id || (b.kb.reduce((m, k) => Math.max(m, k.ID), 0) + 1), Type: params.type, Title: params.title || String(params.question || params.content).slice(0, 40), Question: params.question || '', Content: params.content, Tags: params.tags || '', Source: params.source || '', IsActive: params.isActive !== false, UpdatedAt: nowStr() };
      const idx = b.kb.findIndex((k) => k.ID === params.id);
      if (idx > -1) b.kb[idx] = row;
      else b.kb.push(row);
      save();
      return { success: true };
    }
    case 'botKbImport': {
      let id = b.kb.reduce((m, k) => Math.max(m, k.ID), 0);
      (params.rows || []).forEach((r) => b.kb.push({ ID: ++id, Type: 'doc', Title: r.title, Question: '', Content: r.content, Tags: '', Source: r.source || '', IsActive: true, UpdatedAt: nowStr() }));
      save();
      return { success: true, count: (params.rows || []).length };
    }
    case 'botKbDelete': {
      const before = b.kb.length;
      b.kb = b.kb.filter((k) => !(params.ids || []).includes(k.ID) && !(params.source && k.Source === params.source));
      save();
      return { success: true, deleted: before - b.kb.length };
    }
    case 'botGenKey': {
      const field = params.role === 'staff' ? 'staffKey' : 'key';
      b[field] = Array.from({ length: 64 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
      save();
      return { success: true, key: b[field], keyHint: '••••' + b[field].slice(-4), role: params.role === 'staff' ? 'staff' : 'cs' };
    }
    case 'botRevealKey': {
      const k = params.role === 'staff' ? b.staffKey : b.key;
      return k ? { success: true, key: k } : { success: false, message: '還沒有產生這把金鑰' };
    }
    case 'botCsPreview': {
      const s = b.cs.sources || {};
      const counts = {};
      b.kb.forEach((k) => {
        const name = k.Type === 'doc' ? '文件' : '常見問題';
        if (k.IsActive !== false && (k.Type === 'doc' ? s.docs !== false : s.qa !== false)) counts[name] = (counts[name] || 0) + 1;
      });
      return { success: true, total: Object.values(counts).reduce((a, c) => a + c, 0), counts, sampleProducts: [], productFields: s.productFields || [], blocked: ['產品底價、供應商、產品備註', '客戶資料、聯絡窗口、聯繫紀錄與追蹤', '案件與評估、報價', '員工、帳號與權限', '員工助理的記憶與對話', '其他試算表分頁'] };
    }
    case 'botConversations': {
      const groups = {};
      b.messages.forEach((m) => {
        const g = (groups[m.UserId] = groups[m.UserId] || { id: m.UserId, name: m.Name, channel: m.Channel, count: 0, lastAt: '', lastText: '', lastRole: '', topic: '' });
        g.count++;
        g.lastAt = m.Time;
        g.lastText = m.Text.slice(0, 80);
        g.lastRole = m.Role;
        if (m.Name) g.name = m.Name;
      });
      const paused = {};
      b.pauses.forEach((p) => (paused[p.id] = true));
      const list = Object.values(groups).map((g) => Object.assign(g, { paused: !!paused[g.id] })).sort((x, y) => String(y.lastAt).localeCompare(String(x.lastAt)));
      return { success: true, conversations: list, pauses: b.pauses, total: b.messages.length, max: 4000 };
    }
    case 'botThread':
      return { success: true, messages: b.messages.filter((m) => m.UserId === params.userId).map((m) => ({ id: m.ID, time: m.Time, channel: m.Channel, name: m.Name, role: m.Role, text: m.Text, topic: '' })), paused: b.pauses.some((p) => p.id === params.userId) };
    case 'botHumanReply':
      if (params.userId.charAt(0) !== 'V') return { success: false, message: 'LINE 客人請到 LINE 官方帳號後台回覆' };
      b.messages.push({ ID: b.messages.length + 1, Time: nowStr(), Channel: 'web', UserId: params.userId, Name: '', Role: 'human', Text: params.text });
      save();
      return { success: true };
    case 'botResume':
      b.pauses = b.pauses.filter((p) => p.id !== params.userId);
      save();
      return { success: true, pauses: b.pauses };
    case 'botTestToken':
      return { success: false, message: '示範模式沒有機器人伺服器，無法測試聊天' };
    case 'botClear': {
      const o = params.options || {};
      const counts = { messages: o.messages ? b.messages.length : 0, memos: 0, pauses: b.pauses.length };
      if (!params.dryRun) {
        if (o.messages) b.messages = [];
        if (o.pauses) b.pauses = [];
        save();
      }
      return { success: true, dryRun: !!params.dryRun, counts };
    }
  }
  return null;
}

// ---- 示範模式的員工助理（資料存在本機）----
const DEMO_STAFF_CATS = ['稱呼與職務', '負責的工作', '工作習慣', '回覆偏好', '客戶與專案', '產品與規格', '公司規定', '其他'];
const DEMO_BLOCKS = [
  { key: 'products', label: '產品與詢價（產品搜尋、選型計算、報價系統）' },
  { key: 'cases', label: '案件管理' },
  { key: 'customers', label: '客戶與行事曆（客戶、聯絡人、聯繫紀錄）' },
  { key: 'files', label: '檔案製作（評估報告、行銷宣傳）' },
  { key: 'copy', label: '文案製作' },
  { key: 'bot', label: 'BOT 設定（客服機器人、員工助理）' },
];

function demoStaffState(db) {
  const b = demoBotState(db);
  if (!b.staff) {
    b.staff = {
      config: { enabled: false, welcome: '', pendingText: '', prompt: '', webEnabled: true, hidePrice: false, ceiling: { products: 'edit', cases: 'edit', customers: 'edit' }, writes: ['addMemo', 'logFollowUp', 'updateCustomer', 'addCustomer', 'createCase', 'updateCaseStatus', 'updateCase', 'addContact', 'addPriceRecord', 'addProduct', 'updateProduct', 'createInquiryDraft', 'saveCopyPost', 'addEvent', 'addTodo', 'completeTodo', 'remember'], push: { enabled: false, hour: 8, last: '' }, memory: { enabled: true, maxItems: 30, confirm: true, canShared: false, auto: false, autoEvery: 6 } },
      members: [
        { LineUserId: 'U' + 'a'.repeat(32), DisplayName: '王小明', PictureUrl: '', Status: '待開通', Role: 'viewer', PermsObj: {}, LinkedUsername: '', LinkedName: '', Note: '', PushDaily: false, IsFollowing: true, FollowedAt: '2026-11-04 09:00:00', LastSeenAt: '2026-11-04 09:00:00', ApprovedBy: '' },
        { LineUserId: 'U' + 'b'.repeat(32), DisplayName: '李小華', PictureUrl: '', Status: '已開通', Role: 'limited', PermsObj: { cases: 'edit', customers: 'view' }, LinkedUsername: 'a', LinkedName: 'A', Note: 'FAE', PushDaily: true, IsFollowing: true, FollowedAt: '2026-10-20 10:00:00', LastSeenAt: '2026-11-03 17:20:00', ApprovedBy: 'Admin' },
      ],
      memory: [{ id: 1, scope: 'all', owner: '', category: '公司規定', content: '公司上班時間是 9:00–18:00', importance: 5, updatedAt: '2026-11-01 10:00:00' }],
    };
  }
  return b.staff;
}

function demoStaffApi(action, params, db) {
  const st = demoStaffState(db);
  const save = () => saveDemoDB(db);
  const nowStr = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
  switch (action) {
    case 'botGetStaff':
      return {
        success: true, config: st.config, members: st.members, accounts: (db.users || []).map((u) => ({ username: u.Username, name: u.DisplayName || u.Username })),
        me: '0000', canLinkOthers: true, memory: st.memory, memoryCategories: DEMO_STAFF_CATS, blocks: DEMO_BLOCKS,
        writes: [{ key: 'addMemo', label: '新增備忘錄' }, { key: 'logFollowUp', label: '記錄追蹤 / 改下次追蹤' }, { key: 'updateCustomer', label: '修改客戶資料' }, { key: 'addCustomer', label: '新增客戶' }, { key: 'createCase', label: '建立案件' }, { key: 'updateCaseStatus', label: '修改案件狀態 / 緊急程度' }, { key: 'updateCase', label: '修改案件內容（聯絡人 / 需求說明 / 評估結果…）' }, { key: 'addContact', label: '新增客戶聯絡窗口' }, { key: 'addPriceRecord', label: '記錄報價（價格紀錄）' }, { key: 'addProduct', label: '新增產品' }, { key: 'updateProduct', label: '修改產品資料' }, { key: 'createInquiryDraft', label: '建立詢價信 Gmail 草稿（不會寄出）' }, { key: 'saveCopyPost', label: '儲存文案草稿' }, { key: 'addEvent', label: '新增行事曆行程（自己的）' }, { key: 'addTodo', label: '新增工作清單項目（自己的）' }, { key: 'completeTodo', label: '完成 / 重開工作清單項目（自己的）' }, { key: 'remember', label: '記住（長期記憶）' }],
      };
    case 'botSaveStaff': {
      const c = params.config || {};
      st.config = Object.assign({}, st.config, c, { push: Object.assign({}, st.config.push, c.push || {}), memory: Object.assign({}, st.config.memory, c.memory || {}) });
      save();
      return { success: true, config: st.config };
    }
    case 'botMemberSave': {
      const m = st.members.find((x) => x.LineUserId === params.lineUserId);
      if (!m) return { success: false, message: '找不到這位成員' };
      if (params.role === 'limited' && !Object.keys(params.perms || {}).length) return { success: false, message: '「特定」至少要開放一個功能區塊' };
      if (params.status !== undefined) m.Status = params.status;
      if (params.role !== undefined) {
        m.Role = params.role;
        m.PermsObj = params.role === 'limited' ? params.perms : {};
      }
      if (params.linkedUsername !== undefined) m.LinkedUsername = params.linkedUsername;
      if (params.pushDaily !== undefined) m.PushDaily = params.pushDaily;
      if (params.note !== undefined) m.Note = params.note;
      save();
      return { success: true };
    }
    case 'botMemberRemove':
      st.members = st.members.filter((x) => x.LineUserId !== params.lineUserId);
      save();
      return { success: true };
    case 'botMemorySave': {
      const d = params.data || {};
      if (!String(d.content || '').trim()) return { success: false, message: '記憶內容不能空白' };
      if (st.memory.some((m) => m.content === d.content && m.scope === d.scope)) return { success: true, result: { duplicate: true } };
      st.memory.push({ id: st.memory.reduce((n, m) => Math.max(n, m.id), 0) + 1, scope: d.scope === 'all' ? 'all' : 'user', owner: '0000', category: d.category || '其他', content: d.content, importance: d.importance || 3, updatedAt: nowStr() });
      save();
      return { success: true, result: { id: 1 } };
    }
    case 'botMemoryDelete':
      st.memory = st.memory.filter((m) => !(params.ids || []).includes(m.id));
      save();
      return { success: true, deleted: 1 };
    case 'botPushNow':
      return { success: false, message: '示範模式沒有機器人伺服器' };
    case 'botAssistInfo':
      return { success: true, enabled: st.config.enabled && st.config.webEnabled, reason: !st.config.enabled ? '員工助理還沒有啟用' : !st.config.webEnabled ? '網站智能助理沒有開放' : '' };
    case 'botAssist': {
      // 示範模式沒有 AI：只示範畫面流程（提出修改 → 確認）
      if (params.reset) return { success: true, reply: '', choices: [], pending: null };
      if (params.confirm === true) return { success: true, reply: '✅ 已寫入（1 項）\n📝 新增備忘錄：示範', choices: [], pending: null };
      if (params.confirm === false) return { success: true, reply: '好的，已取消，沒有寫入任何資料。', choices: [], pending: null };
      if (/記/.test(params.text || '')) return { success: true, reply: '已整理好，請確認：\n\n📝 等你確認後才會寫入：\n📝 新增備忘錄：示範', choices: [], pending: { token: 'demo123456', summary: '📝 新增備忘錄：示範' } };
      return { success: true, reply: '（示範模式，沒有接 AI）你說：' + params.text, choices: ['今天要追蹤誰', '進行中案件'], pending: null };
    }
  }
  return null;
}

// ---- 示範模式的文案製作（資料存在本機）----
function demoCopyApi(action, params, db) {
  if (!db.copy) db.copy = { posts: [], library: [], style: { profile: '', enabled: true, updatedAt: '' }, models: [] };
  const c = db.copy;
  const save = () => saveDemoDB(db);
  const nowStr = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
  const nextId = (list) => list.reduce((n, x) => Math.max(n, x.id), 0) + 1;
  const providers = { gemini: { name: 'Gemini', endpoint: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.5-flash' }, claude: { name: 'Claude', endpoint: 'https://api.anthropic.com/v1', model: 'claude-sonnet-5-5' }, openai: { name: 'OpenAI 相容', endpoint: 'https://api.openai.com/v1', model: 'gpt-4o-mini' } };
  const masked = () => c.models.map((m) => ({ provider: m.provider, model: m.model, endpoint: m.endpoint, hasKey: !!m.apiKey, keyHint: '••••' + String(m.apiKey).slice(-4), defaultModel: '' }));
  switch (action) {
    case 'copyGetData':
      return {
        success: true, posts: c.posts.slice().sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))), total: c.posts.length, library: c.library, style: c.style,
        models: masked(), providers, aiReady: c.models.length > 0, usingBotModels: false, botAvailable: true, today: new Date().toISOString().slice(0, 10),
      };
    case 'copySavePost': {
      const p = params.post || {};
      if (!String(p.content || '').trim() && !String(p.topic || '').trim()) return { success: false, message: '主題與內文都是空的' };
      const row = Object.assign({ liked: false, created_by: '示範', created_at: nowStr() }, p, { updated_at: nowStr() });
      const i = c.posts.findIndex((x) => x.id === params.id);
      if (params.id && i < 0) return { success: false, message: '找不到這篇文案（可能已被刪除）' };
      if (i > -1) c.posts[i] = Object.assign({}, c.posts[i], row, { id: params.id });
      else {
        row.id = nextId(c.posts);
        c.posts.push(row);
      }
      save();
      return { success: true, id: i > -1 ? params.id : row.id };
    }
    case 'copySetLiked': {
      const x = c.posts.find((q) => q.id === params.id);
      if (!x) return { success: false, message: '找不到這篇文案' };
      x.liked = params.liked === true;
      x.updated_at = nowStr();
      save();
      return { success: true };
    }
    case 'copyDeletePost':
      c.posts = c.posts.filter((x) => x.id !== params.id);
      save();
      return { success: true };
    case 'copySaveLib': {
      const it = params.item || {};
      if (!it.name || !it.text) return { success: false, message: '名稱與內容不能空白' };
      const i = c.library.findIndex((x) => x.id === params.id);
      if (i > -1) c.library[i] = Object.assign({}, c.library[i], it);
      else c.library.push(Object.assign({ id: nextId(c.library) }, it));
      save();
      return { success: true };
    }
    case 'copyToggleLib': {
      const x = c.library.find((q) => q.id === params.id);
      if (x) x.enabled = params.enabled === true;
      save();
      return { success: true };
    }
    case 'copyDeleteLib':
      c.library = c.library.filter((x) => x.id !== params.id);
      save();
      return { success: true };
    case 'copyImport': {
      let data;
      try {
        data = JSON.parse(params.json);
      } catch (e) {
        return { success: false, message: '檔案不是正確的 JSON' };
      }
      let n = 0;
      if (Array.isArray(data)) {
        data.filter((p) => p && (p.content || p.topic)).forEach((p) => {
          c.posts.push({ id: nextId(c.posts), platform: p.platform || 'Threads', topic: p.topic || '', keywords: p.keywords || '', tone: p.tone || '', marketing: p.marketing || [], event: { schedule: [{ date: '', time: '' }] }, content: p.content || '', note: p.note || '', status: p.status || 'draft', scheduled_for: p.when || '', liked: false, created_by: '示範', created_at: nowStr(), updated_at: nowStr() });
          n++;
        });
        save();
        return n ? { success: true, message: '已匯入 ' + n + ' 篇文案', count: n } : { success: false, message: '檔案裡沒有可匯入的文案' };
      }
      [['prompts', 'prompt'], ['styles', 'style'], ['endings', 'ending']].forEach(([k, kind]) => {
        (data[k] || []).forEach((it) => {
          if (!it || !it.name || !it.text || c.library.some((l) => l.kind === kind && l.name === it.name)) return;
          c.library.push({ id: nextId(c.library), kind, name: it.name, text: it.text, platform: it.platform || '', enabled: true });
          n++;
        });
      });
      save();
      return n ? { success: true, message: '已匯入 ' + n + ' 個素材', count: n } : { success: false, message: '沒有新的素材可匯入（名稱相同的會略過）' };
    }
    case 'copySaveStyle':
      if (params.profile !== undefined) c.style.profile = params.profile;
      if (params.enabled !== undefined) c.style.enabled = params.enabled;
      c.style.updatedAt = nowStr();
      save();
      return { success: true, style: c.style };
    case 'copySaveModels':
      c.models = (params.models || []).map((m, i) => ({ provider: m.provider, model: m.model, endpoint: m.endpoint, apiKey: m.apiKey || (c.models[i] && c.models[i].apiKey) || '' })).filter((m) => m.apiKey);
      save();
      return { success: true, models: masked() };
    case 'copyTestModel':
      return c.models[params.index || 0] ? { success: true, reply: '成功', ms: 321, model: 'demo', provider: 'Gemini' } : { success: false, message: '沒有這個模型' };
    case 'copyGenerate':
      if (!c.models.length) return { success: false, message: '還沒有設定 AI 模型' };
      // 示範模式沒有 AI：回傳固定的假內容，只示範畫面流程
      return { success: true, text: '（示範）版本一\n=====\n（示範）版本二\n=====\n（示範）版本三', model: 'Demo／demo', failures: [] };
  }
  return null;
}

function demoAdminAccess() {
  const blocks = {};
  ['products', 'cases', 'customers', 'files', 'copy', 'bot'].forEach((b) => (blocks[b] = 'edit'));
  return { role: 'admin', roleLabel: '系統管理員', blocks, canDelete: true, isAdmin: true };
}

function handleDemoApi(action, params) {
  const db = loadDemoDB();

  switch (action) {
    case 'login': {
      if (params.username === '0000' && params.password === '0000') {
        // 示範模式也模擬「記住這台裝置」，方便測試免密碼自動登入的畫面效果（裝置清單存在本機瀏覽器）
        if (params.deviceId) {
          db.devices = db.devices || [];
          const exist = db.devices.find((d) => d.DeviceId === params.deviceId);
          if (exist) exist.DeviceLabel = params.deviceLabel || exist.DeviceLabel;
          else db.devices.push({ DeviceId: params.deviceId, Username: '0000', DeviceLabel: params.deviceLabel || '', TokenHash: 'demo-device-token', CreatedDate: new Date().toISOString().slice(0, 10), LastSeenDate: new Date().toISOString().slice(0, 10) });
          saveDemoDB(db);
        }
        return { success: true, token: 'demo-token', username: '0000', displayName: '0000（示範帳號）', role: 'admin', access: demoAdminAccess(), deviceToken: params.deviceId ? 'demo-device-token' : undefined };
      }
      return { success: false, message: '示範模式僅接受帳密 0000 / 0000' };
    }

    case 'resumeSession': {
      const device = (db.devices || []).find((d) => d.DeviceId === params.deviceId && d.TokenHash === params.deviceToken);
      if (!device) return { success: false, message: '這台裝置的登入紀錄已被移除，請重新輸入帳密登入' };
      return { success: true, token: 'demo-token', username: '0000', displayName: '0000（示範帳號）', role: 'admin' };
    }

    case 'logoutDevice': {
      db.devices = (db.devices || []).filter((d) => d.DeviceId !== params.deviceId);
      saveDemoDB(db);
      return { success: true };
    }

    case 'getLoginOverview':
      return {
        success: true,
        devices: (db.devices || []).map((x, i) => ({ RowIndex: i, Username: x.Username, DisplayName: '示範帳號', DeviceLabel: x.DeviceLabel, LoginTime: x.CreatedDate, LastSeenTime: x.LastSeenDate, IsCurrent: i === 0 })),
        keep: 20,
        logCount: 0,
      };

    case 'dbStatus':
    case 'dbTrim': {
      const sheets = [['Products', 1800, 25, 1990], ['Customers', 120, 16, 1000], ['ContactLogs', 400, 7, 1000], ['Cases', 40, 20, 1000], ['Users', 3, 7, 1000]].map(([name, d, cols, maxRows]) => ({ name, dataRows: d, maxRows, maxCols: cols, cells: maxRows * cols, releasable: Math.max(0, maxRows - (d + 21)) * cols }));
      const total = sheets.reduce((a, s) => a + s.cells, 0);
      return { success: true, sheets, totalCells: total, limit: 10000000, percent: Math.round(total / 100) / 100, releasable: sheets.reduce((a, s) => a + s.releasable, 0), released: 0, trimmedSheets: 0 };
    }

    case 'getLoginLogs':
      return { success: true, logs: [], summary: [] };

    case 'forceLogout':
    case 'clearLoginLogs':
    case 'setLoginKeep':
      return { success: true, count: 0, deleted: 0, keep: params.keep || 20, logCount: 0 };

    case 'getProfile':
      return { success: true, profile: Object.assign({ Username: '0000', DisplayName: '0000（示範帳號）', Role: 'admin', Phone: '', Email: '', Birthday: '' }, db.profile || {}) };

    case 'updateProfile':
      db.profile = { DisplayName: params.displayName, Phone: params.phone || '', Email: params.email || '', Birthday: params.birthday || '' };
      saveDemoDB(db);
      return { success: true, displayName: params.displayName };

    case 'changePassword':
      return { success: true };

    case 'getDevices':
      return { success: true, devices: (db.devices || []).map((d, i) => Object.assign({ RowIndex: i }, d)) };

    case 'removeDevice': {
      db.devices = (db.devices || []).filter((_, i) => i !== params.rowIndex);
      saveDemoDB(db);
      return { success: true };
    }

    // ---------------- 產品 CRUD ----------------
    case 'searchProducts': {
      const keyword = (params.keyword || '').toLowerCase();
      const products = db.products
        .filter((p) => !keyword || Object.values(p).join(' ').toLowerCase().includes(keyword))
        .map((p) => Object.assign({}, p, { InquiryCount: db.priceHistory.filter((h) => h.ProductInternalModel === p.InternalModel).length }));
      return { success: true, products };
    }

    case 'getProduct': {
      const product = db.products.find((p) => p.InternalModel === params.internalModel);
      if (!product) return { success: false, message: '查無此產品' };
      const compatibleProducts = db.products.filter((p) => p.CompatibleGroup === product.CompatibleGroup && p.InternalModel !== product.InternalModel);
      const history = db.priceHistory
        .map((h, i) => Object.assign({ RowIndex: i }, h))
        .filter((h) => h.ProductInternalModel === params.internalModel)
        .sort((a, b) => new Date(b.Date) - new Date(a.Date));
      return { success: true, product, compatibleProducts, priceHistory: history, lastPrice: history[0] || null };
    }

    case 'addProduct': {
      if (db.products.some((p) => p.InternalModel === params.internalModel)) {
        return { success: false, message: '此內部型號已存在，如要修改請用「修改」功能' };
      }
      db.products.push({
        InternalModel: params.internalModel,
        SupplierModel: params.supplierModel || '',
        Supplier: params.supplier || '',
        SupplierContact: params.supplierContact || '',
        SupplierContactEmail: params.supplierContactEmail || '',
        Origin: params.origin || '',
        Category: params.category || '',
        CompatibleGroup: params.compatibleGroup || '',
        RefPrice: params.refPrice || '',
        Notes: params.notes || '',
      });
      saveDemoDB(db);
      return { success: true };
    }

    case 'updateProduct': {
      const p = db.products.find((p) => p.InternalModel === params.internalModel);
      if (!p) return { success: false, message: '查無此產品' };
      Object.assign(p, params.fields || {});
      saveDemoDB(db);
      return { success: true };
    }

    case 'getSoftware':
      return { success: true, software: (db.software || []).map((x, i) => ({ RowIndex: i, Name: x.Name })) };

    case 'addSoftware': {
      db.software = db.software || [];
      const n = String(params.name || '').trim();
      if (!n) return { success: false, message: '軟體名稱不能空白' };
      const exists = db.software.some((x) => x.Name.toLowerCase() === n.toLowerCase());
      if (!exists) db.software.push({ Name: n });
      saveDemoDB(db);
      return { success: true, added: !exists };
    }

    case 'deleteSoftware':
      (db.software || []).splice(params.rowIndex, 1);
      saveDemoDB(db);
      return { success: true };

    // ---------------- 個人化：常用型號 / 常用網站 / 備忘錄 / 行事曆 ----------------
    case 'getFavorites':
      return { success: true, favorites: db.favorites || [] };

    case 'toggleFavorite': {
      db.favorites = db.favorites || [];
      const i = db.favorites.indexOf(params.internalModel);
      if (i > -1) db.favorites.splice(i, 1);
      else db.favorites.push(params.internalModel);
      saveDemoDB(db);
      return { success: true, favorite: i === -1 };
    }

    case 'getShortcuts':
      return { success: true, shortcuts: db.shortcuts || [] };

    case 'saveShortcuts': {
      db.shortcuts = (params.shortcuts || [])
        .filter((s) => s.Url)
        .map((s) => ({ Title: s.Title || s.Url, Url: /^https?:\/\//i.test(s.Url) ? s.Url : 'https://' + s.Url, OpenOnStart: !!s.OpenOnStart }));
      saveDemoDB(db);
      return { success: true, count: db.shortcuts.length };
    }

    case 'getMemos': {
      const mine = (db.memos || []).map((m, i) => {
        const mode = m.ShareMode || (m.Shared ? 'all' : 'self');
        return Object.assign({ RowIndex: i, IsMine: true, CanManage: true, OwnerName: '我' }, m, { Shared: mode === 'all', ShareMode: mode, ShareWith: m.ShareWith || [], ShareLabel: demoShareLabel(db, mode, m.ShareWith) });
      });
      const others = [{ RowIndex: 9001, Title: '（示範）艾咪分享的備忘', Content: '被分享的人只能查看，不能修改。', Shared: false, ShareMode: 'users', ShareWith: [], ShareLabel: '指定的人', IsMine: false, CanManage: false, OwnerName: '艾咪', LastUpdated: new Date().toISOString().slice(0, 10) }];
      return { success: true, memos: mine.concat(others) };
    }

    case 'addMemo': {
      db.memos = db.memos || [];
      const t = new Date().toISOString().slice(0, 10);
      const mode = params.shareMode !== undefined ? params.shareMode : params.shared ? 'all' : 'self';
      db.memos.push({ Title: params.title || '', Content: params.content || '', Shared: mode === 'all', ShareMode: mode, ShareWith: params.shareWith || [], CreatedDate: t, LastUpdated: t });
      saveDemoDB(db);
      return { success: true };
    }

    case 'updateMemo': {
      const m = (db.memos || [])[params.rowIndex];
      if (!m) return { success: false, message: '查無此備忘錄' };
      const f = Object.assign({}, params.fields || {});
      if (f.Shared !== undefined && f.ShareMode === undefined) f.ShareMode = f.Shared ? 'all' : 'self';
      if (f.ShareMode !== undefined) f.Shared = f.ShareMode === 'all';
      Object.assign(m, f, { LastUpdated: new Date().toISOString().slice(0, 10) });
      saveDemoDB(db);
      return { success: true };
    }

    case 'deleteMemo':
      (db.memos || []).splice(params.rowIndex, 1);
      saveDemoDB(db);
      return { success: true };

    case 'getCalendarEvents':
      return { success: true, events: [{ Id: 'demo1', Title: '（示範）拜訪客戶', Start: new Date().toISOString().slice(0, 10) + 'T14:00', End: '', AllDay: false, Location: '' }] };

    // ---------------- 個人工作區：行事曆 / 工作清單 / 群組 ----------------
    case 'getShareTargets':
      return { success: true, me: 'demo', users: demoUsers(), groups: (db.groups || []).map((g) => ({ id: g.id, name: g.name, count: g.members.length, isMember: g.members.includes('demo'), members: g.members })) };

    case 'calGetEvents': {
      demoWsSeed(db);
      const from = params.from || '0000-00-00';
      const to = params.to || '9999-99-99';
      const scope = params.scope || 'all';
      const out = db.cal
        .filter((e) => (scope === 'mine' ? e.owner === 'demo' : scope === 'shared' ? e.owner !== 'demo' : true))
        .filter((e) => e.startDate <= to && (e.endDate || e.startDate) >= from)
        .map((e) => demoEventOut(db, e))
        .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.startTime.localeCompare(b.startTime));
      return { success: true, from, to, today: new Date().toISOString().slice(0, 10), events: out };
    }

    case 'calSaveEvent': {
      demoWsSeed(db);
      if (!String(params.title || '').trim()) return { success: false, message: '行程標題不能空白' };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(params.startDate || '')) return { success: false, message: '日期要是 YYYY-MM-DD' };
      const allDay = !!params.allDay || !params.startTime;
      const ev = {
        title: String(params.title).trim(), startDate: params.startDate, startTime: allDay ? '' : params.startTime, endDate: params.endDate || params.startDate,
        endTime: allDay ? '' : params.endTime || params.startTime, allDay, location: params.location || '', notes: params.notes || '',
        shareMode: params.shareMode || 'self', shareWith: params.shareWith || [], source: 'manual', refKey: '', owner: 'demo',
      };
      if (params.id) {
        const old = db.cal.find((x) => x.id === Number(params.id));
        if (!old) return { success: false, message: '找不到這個行程（可能已被刪除）' };
        if (old.owner !== 'demo') return { success: false, message: '這是別人的行程，只有擁有者可以修改' };
        Object.assign(old, ev);
      } else {
        ev.id = Math.max(0, ...db.cal.map((x) => x.id)) + 1;
        db.cal.push(ev);
      }
      saveDemoDB(db);
      return { success: true, id: params.id || ev.id };
    }

    case 'calDeleteEvent': {
      demoWsSeed(db);
      const i = db.cal.findIndex((x) => x.id === Number(params.id));
      if (i < 0) return { success: false, message: '找不到這個行程（可能已被刪除）' };
      if (db.cal[i].owner !== 'demo') return { success: false, message: '這是別人的行程，只有擁有者可以刪除' };
      db.cal.splice(i, 1);
      saveDemoDB(db);
      return { success: true };
    }

    case 'todoGet': {
      demoWsSeed(db);
      const scope = params.scope || 'all';
      const status = params.status || 'open';
      const rank = { 高: 0, 中: 1, 低: 2 };
      const out = db.todos
        .filter((t) => (scope === 'mine' ? t.owner === 'demo' : scope === 'shared' ? t.owner !== 'demo' : true))
        .filter((t) => (status === 'open' ? t.status !== 'done' : status === 'done' ? t.status === 'done' : true))
        .map((t) => demoTodoOut(db, t))
        .sort((a, b) => (a.status === 'done') - (b.status === 'done') || (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || rank[a.priority] - rank[b.priority] || a.id - b.id);
      return { success: true, today: new Date().toISOString().slice(0, 10), todos: out };
    }

    case 'todoSave': {
      demoWsSeed(db);
      if (!String(params.title || '').trim()) return { success: false, message: '工作標題不能空白' };
      const t = { title: String(params.title).trim(), notes: params.notes || '', dueDate: params.dueDate || '', priority: ['高', '中', '低'].includes(params.priority) ? params.priority : '中', shareMode: params.shareMode || 'self', shareWith: params.shareWith || [] };
      if (params.id) {
        const old = db.todos.find((x) => x.id === Number(params.id));
        if (!old) return { success: false, message: '找不到這個工作（可能已被刪除）' };
        if (old.owner !== 'demo') return { success: false, message: '這是別人的工作，只有擁有者可以修改' };
        Object.assign(old, t);
      } else {
        t.id = Math.max(0, ...db.todos.map((x) => x.id)) + 1;
        t.owner = 'demo';
        t.status = 'todo';
        t.createdAt = new Date().toISOString().slice(0, 10);
        db.todos.push(t);
      }
      saveDemoDB(db);
      return { success: true, id: params.id || t.id };
    }

    case 'todoSetStatus': {
      demoWsSeed(db);
      const t = db.todos.find((x) => x.id === Number(params.id));
      if (!t) return { success: false, message: '找不到這個工作（可能已被刪除）' };
      if (t.owner !== 'demo') return { success: false, message: '這是別人的工作，只有擁有者可以更改狀態' };
      t.status = params.status;
      t.doneAt = params.status === 'done' ? new Date().toISOString().slice(0, 10) : '';
      saveDemoDB(db);
      return { success: true };
    }

    case 'todoDelete': {
      demoWsSeed(db);
      const i = db.todos.findIndex((x) => x.id === Number(params.id));
      if (i < 0) return { success: false, message: '找不到這個工作（可能已被刪除）' };
      if (db.todos[i].owner !== 'demo') return { success: false, message: '這是別人的工作，只有擁有者可以刪除' };
      db.todos.splice(i, 1);
      saveDemoDB(db);
      return { success: true };
    }

    case 'groupGetAll':
      return { success: true, groups: (db.groups || []).map((g) => ({ id: g.id, name: g.name, members: g.members })), users: demoUsers() };

    case 'groupSave': {
      db.groups = db.groups || [];
      const name = String(params.name || '').trim();
      if (!name) return { success: false, message: '群組名稱不能空白' };
      if (db.groups.some((g) => g.id !== Number(params.id) && g.name.toLowerCase() === name.toLowerCase())) return { success: false, message: '已經有叫「' + name + '」的群組了' };
      const have = demoUsers().map((u) => u.username);
      const members = [...new Set((params.members || []).filter((u) => have.includes(u)))];
      if (params.id) {
        const g = db.groups.find((x) => x.id === Number(params.id));
        if (!g) return { success: false, message: '找不到這個群組' };
        Object.assign(g, { name, members });
        saveDemoDB(db);
        return { success: true, id: g.id };
      }
      const ng = { id: Math.max(0, ...db.groups.map((x) => x.id)) + 1, name, members };
      db.groups.push(ng);
      saveDemoDB(db);
      return { success: true, id: ng.id };
    }

    case 'groupDelete':
      db.groups = (db.groups || []).filter((g) => g.id !== Number(params.id));
      saveDemoDB(db);
      return { success: true };

    case 'wsGetSettings':
      return { success: true, googleCalSync: !!db.googleCalSync };

    case 'wsSaveSettings':
      db.googleCalSync = !!params.googleCalSync;
      saveDemoDB(db);
      return { success: true, googleCalSync: db.googleCalSync };

    case 'getCalcCatalog':
      return { success: true, catalog: {} };

    case 'syncCalcCatalog':
      return { success: true, message: '示範模式不會同步型錄。' };

    case 'dedupeData':
      return { success: true, apply: !!params.apply, report: [], removed: 0, customerSuspects: [] };

    case 'importDehongProducts':
      return { success: true, added: 0, enriched: 0, message: '示範模式不會真的抓取官網，正式模式才會匯入。' };

    case 'importFlirProducts':
      return { success: true, added: 0, enriched: 0, camAdded: 0, done: true, message: '示範模式不會真的抓取官網，正式模式才會匯入。' };

    case 'importBaslerProducts':
      return { success: true, added: 0, enriched: 0, camAdded: 0, done: true, message: '示範模式不會真的抓取官網，正式模式才會匯入。' };

    case 'importMyutronProducts':
    case 'importMindvisionProducts':
      return { success: true, added: 0, enriched: 0, camAdded: 0, done: true, message: '示範模式不會真的抓取官網，正式模式才會匯入。' };

    case 'deleteProducts': {
      const set = new Set((params.rowIndexes || []).map(Number));
      return { success: true, deleted: set.size, message: '示範模式不會真的刪除。' };
    }

    case 'importCatalogProducts':
      return { success: true, added: 0, missingInternal: 0, message: '示範模式不會真的讀取型錄，正式模式才會匯入。' };

    case 'deleteProduct': {
      db.products = db.products.filter((p) => p.InternalModel !== params.internalModel);
      saveDemoDB(db);
      return { success: true };
    }

    // ---------------- 價格紀錄 CRUD ----------------
    case 'getPriceHistory': {
      const history = db.priceHistory
        .map((h, i) => Object.assign({ RowIndex: i }, h))
        .filter((h) => h.ProductInternalModel === params.internalModel);
      return { success: true, history };
    }

    case 'addPriceRecord': {
      db.priceHistory.push({
        Date: new Date().toISOString().slice(0, 10),
        ProductInternalModel: params.internalModel,
        Supplier: params.supplier || '',
        Price: params.price || '',
        Currency: 'TWD',
        CaseID: params.caseId || '',
        Notes: params.notes || '',
      });
      saveDemoDB(db);
      return { success: true };
    }

    case 'updatePriceRecord': {
      const rec = db.priceHistory[params.rowIndex];
      if (!rec) return { success: false, message: '查無此紀錄' };
      Object.assign(rec, params.fields || {});
      saveDemoDB(db);
      return { success: true };
    }

    case 'deletePriceRecord': {
      db.priceHistory.splice(params.rowIndex, 1);
      saveDemoDB(db);
      return { success: true };
    }

    // ---------------- 詢價信 ----------------
    case 'generateInquiryDraft': {
      const productResult = handleDemoApi('getProduct', { internalModel: params.internalModel });
      if (!productResult.success) return productResult;
      const p = productResult.product;
      const lastPrice = productResult.lastPrice;
      const subject = `詢價 - ${p.InternalModel} / ${p.SupplierModel}`;
      const body =
        (p.SupplierContact ? p.SupplierContact + ' 您好，\n\n' : '您好，\n\n') +
        `想請教以下產品報價：\n供應商型號: ${p.SupplierModel}\n對應內部型號: ${p.InternalModel}\n` +
        (lastPrice ? `上次報價紀錄: ${lastPrice.Price} ${lastPrice.Currency}（${lastPrice.Date}）\n` : '') +
        `需求數量: ${params.quantity || '請提供'}\n\n麻煩協助報價，謝謝！`;
      return { success: true, subject, body, draftUrl: null };
    }

    case 'createGmailDraft':
      return { success: true, message: '示範模式不會真的建立 Gmail 草稿', draftUrl: null };

    // ---------------- 案件 CRUD ----------------
    case 'createCase': {
      if (!params.customerName) return { success: false, message: '請先選擇客戶（客戶名稱為必填）' };
      if (!db.customers.some((c) => c.CompanyName === params.customerName)) {
        return { success: false, message: `「${params.customerName}」不在客戶資料表中，請先在「客戶管理」建立這間客戶，或用畫面上的建議清單挑選` };
      }
      const caseId = demoCaseId();
      db.cases.push({
        CaseID: caseId,
        CustomerName: params.customerName || '',
        EndCustomerName: params.endCustomerName || '',
        ProjectContact: params.projectContact || '',
        ContactPhone: params.contactPhone || '',
        Salesperson: params.salesperson || '',
        FAE: params.fae || '',
        ProductApplication: params.productApplication || '',
        TestObject: params.testObject || '',
        SoftwareName: params.softwareName || '',
        SoftwareCustomization: params.softwareCustomization || '',
        SoftwareCustomizationNote: params.softwareCustomizationNote || '',
        Status: '需求單已發出',
        Urgency: params.urgency || '中',
        CreatedDate: new Date().toISOString().slice(0, 10),
        RequirementDetails: params.requirementDetails || '',
        CcdRequirements: params.ccdRequirements || [],
        RelatedCompanies: params.relatedCompanies || [],
        AttachmentLinksJson: '[]',
        EvaluationResult: '',
        EvaluationReportHtml: '',
        LastUpdated: new Date().toISOString().slice(0, 10),
      });
      saveDemoDB(db);
      return { success: true, caseId };
    }

    case 'getCases': {
      let cases = db.cases.slice().sort((a, b) => new Date(b.CreatedDate) - new Date(a.CreatedDate));
      if (params.status) cases = cases.filter((c) => c.Status === params.status);
      if (params.keyword) {
        const kw = params.keyword.toLowerCase();
        cases = cases.filter((c) => ['CaseID', 'CustomerName', 'Salesperson', 'FAE'].some((f) => String(c[f] || '').toLowerCase().includes(kw)));
      }
      if (params.companyName) {
        cases = cases.filter((c) => c.CustomerName === params.companyName || (c.RelatedCompanies || []).some((rc) => rc.CompanyName === params.companyName));
      }
      return { success: true, cases };
    }

    case 'getCasesPageData': {
      const casesResult = handleDemoApi('getCases', {});
      const customersResult = handleDemoApi('getCustomers', {});
      const staffResult = handleDemoApi('getStaff', {});
      return { success: true, cases: casesResult.cases, customers: customersResult.customers, staff: staffResult.staff, software: (db.software || []).map((x) => x.Name) };
    }

    case 'getCase': {
      const c = db.cases.find((c) => c.CaseID === params.caseId);
      if (!c) return { success: false, message: '查無此案件' };
      return { success: true, caseData: c };
    }

    case 'updateCase': {
      const c = db.cases.find((c) => c.CaseID === params.caseId);
      if (!c) return { success: false, message: '查無此案件' };
      if (params.fields && params.fields.CustomerName && !db.customers.some((cust) => cust.CompanyName === params.fields.CustomerName)) {
        return { success: false, message: `「${params.fields.CustomerName}」不在客戶資料表中，請先在「客戶管理」建立這間客戶，或用畫面上的建議清單挑選` };
      }
      Object.assign(c, params.fields || {});
      if (params.ccdRequirements) c.CcdRequirements = params.ccdRequirements;
      if (params.relatedCompanies) c.RelatedCompanies = params.relatedCompanies;
      c.LastUpdated = new Date().toISOString().slice(0, 10);
      saveDemoDB(db);
      return { success: true };
    }

    case 'renameCase': {
      const cs = db.cases.find((x) => x.CaseID === params.caseId);
      if (!cs) return { success: false, message: '查無此案件' };
      const nid = String(params.newCaseId || '').trim();
      if (!nid) return { success: false, message: '缺少新的專案名稱' };
      if (db.cases.some((x) => x.CaseID === nid)) return { success: false, message: '已經有一個案件叫「' + nid + '」，請換一個名稱' };
      cs.CaseID = nid;
      saveDemoDB(db);
      return { success: true, caseId: nid, oldCaseId: params.caseId, counts: {} };
    }

    case 'deleteCase': {
      db.cases = db.cases.filter((c) => c.CaseID !== params.caseId);
      saveDemoDB(db);
      return { success: true };
    }

    // ---------------- 人員 (業務/FAE 自動完成，含 CRUD) ----------------
    case 'getStaff': {
      let staff = (db.staff || []).map((s, i) => Object.assign({ RowIndex: i }, s));
      if (params.role) staff = staff.filter((s) => s.Role === params.role);
      return { success: true, staff };
    }

    case 'addStaff': {
      if (!params.name) return { success: false, message: '姓名為必填' };
      db.staff.push({ Name: params.name, Role: params.role || '' });
      saveDemoDB(db);
      return { success: true };
    }

    case 'updateStaff': {
      const s = (db.staff || [])[params.rowIndex];
      if (!s) return { success: false, message: '查無此人員' };
      Object.assign(s, params.fields || {});
      saveDemoDB(db);
      return { success: true };
    }

    case 'deleteStaff': {
      (db.staff || []).splice(params.rowIndex, 1);
      saveDemoDB(db);
      return { success: true };
    }

    // ---------------- 帳號管理（示範模式：0000 帳號視同 admin，其他帳號存在本機） ----------------
    case 'botGetSettings':
    case 'botSaveSettings':
    case 'botSaveAi':
    case 'botTestAi':
    case 'botKbList':
    case 'botKbSave':
    case 'botKbImport':
    case 'botKbDelete':
    case 'botGenKey':
    case 'botRevealKey':
    case 'botKbEmbed':
    case 'botCsPreview':
    case 'botConversations':
    case 'botThread':
    case 'botHumanReply':
    case 'botResume':
    case 'botTestToken':
    case 'botClear':
      return demoBotApi(action, params, db);

    case 'copyGetData':
    case 'copySavePost':
    case 'copySetLiked':
    case 'copyDeletePost':
    case 'copySaveLib':
    case 'copyToggleLib':
    case 'copyDeleteLib':
    case 'copyImport':
    case 'copySaveStyle':
    case 'copySaveModels':
    case 'copyTestModel':
    case 'copyGenerate':
      return demoCopyApi(action, params, db);

    case 'botGetStaff':
    case 'botSaveStaff':
    case 'botMemberSave':
    case 'botMemberRemove':
    case 'botMemorySave':
    case 'botMemoryDelete':
    case 'botPushNow':
    case 'botAssistInfo':
    case 'botAssist':
      return demoStaffApi(action, params, db);

    case 'getUsers': {
      db.users = db.users || [];
      const labels = { admin: '系統管理員', editor: '編輯者', viewer: '查看', limited: '特定', sales: '業務（舊角色）', fae: '工程（舊角色）' };
      const users = db.users.map((u, i) => Object.assign({ RowIndex: i, Perms: '', IsSelf: false, RoleLabel: labels[u.Role] || u.Role, PermsObj: u.Perms ? JSON.parse(u.Perms) : {} }, u));
      return {
        success: true,
        users,
        roles: ['admin', 'editor', 'viewer', 'limited'],
        roleLabels: labels,
        legacyCount: users.filter((u) => u.Role === 'sales' || u.Role === 'fae').length,
        blocks: [
          { key: 'products', label: '產品與詢價（產品搜尋、選型計算、報價系統）' },
          { key: 'cases', label: '案件管理' },
          { key: 'customers', label: '客戶與行事曆（客戶、聯絡人、聯繫紀錄）' },
          { key: 'files', label: '檔案製作（評估報告、行銷宣傳）' },
          { key: 'copy', label: '文案製作' },
          { key: 'bot', label: 'BOT 設定（客服機器人、員工助理）' },
        ],
      };
    }

    case 'migrateRoles': {
      const changed = { sales: 0, fae: 0 };
      (db.users || []).forEach((u) => {
        if (u.Role === 'sales' || u.Role === 'fae') {
          changed[u.Role]++;
          u.Role = 'editor';
        }
      });
      saveDemoDB(db);
      return { success: true, changed };
    }

    case 'addUser': {
      db.users = db.users || [];
      if (!params.username) return { success: false, message: '帳號為必填' };
      if (db.users.some((u) => u.Username === params.username)) return { success: false, message: '此帳號已存在' };
      const password = params.password || Math.random().toString(36).slice(2, 10);
      db.users.push({ Username: params.username, Role: params.role || 'editor', DisplayName: params.displayName || params.username, Perms: params.role === 'limited' ? JSON.stringify(params.perms || {}) : '' });
      saveDemoDB(db);
      return { success: true, password: params.password ? undefined : password };
    }

    case 'updateUser': {
      const u = (db.users || [])[params.rowIndex];
      if (!u) return { success: false, message: '查無此帳號' };
      const f = Object.assign({}, params.fields || {});
      if (f.Perms && typeof f.Perms === 'object') f.Perms = JSON.stringify(f.Perms);
      if (f.Role && f.Role !== 'limited') f.Perms = '';
      Object.assign(u, f);
      saveDemoDB(db);
      return { success: true };
    }

    case 'deleteUser': {
      (db.users || []).splice(params.rowIndex, 1);
      saveDemoDB(db);
      return { success: true };
    }

    case 'resetUserPassword': {
      const password = params.password || Math.random().toString(36).slice(2, 10);
      return { success: true, password };
    }

    // ---------------- 案件附件 ----------------
    case 'uploadCaseAttachment': {
      const c = db.cases.find((c) => c.CaseID === params.caseId);
      if (!c) return { success: false, message: '查無此案件' };
      let attachments = [];
      try {
        attachments = JSON.parse(c.AttachmentLinksJson || '[]');
      } catch (e) {}
      attachments.push({ name: params.filename, url: `data:${params.mimeType};base64,${params.base64}`, fileId: 'demo-' + Date.now() });
      c.AttachmentLinksJson = JSON.stringify(attachments);
      saveDemoDB(db);
      return { success: true, attachments };
    }

    case 'deleteCaseAttachment': {
      const c = db.cases.find((c) => c.CaseID === params.caseId);
      if (!c) return { success: false, message: '查無此案件' };
      let attachments = [];
      try {
        attachments = JSON.parse(c.AttachmentLinksJson || '[]');
      } catch (e) {}
      attachments = attachments.filter((a) => a.fileId !== params.fileId);
      c.AttachmentLinksJson = JSON.stringify(attachments);
      saveDemoDB(db);
      return { success: true, attachments };
    }

    case 'getCaseImages': {
      const c = db.cases.find((c) => c.CaseID === params.caseId);
      if (!c) return { success: false, message: '查無此案件' };
      let attachments = [];
      try {
        attachments = JSON.parse(c.AttachmentLinksJson || '[]');
      } catch (e) {}
      const images = attachments
        .map((a) => ({ a, m: /^data:(image\/[\w.+-]+);base64,(.+)$/.exec(a.url || '') }))
        .filter((x) => x.m)
        .map((x) => ({ name: x.a.name, fileId: x.a.fileId, mimeType: x.m[1], base64: x.m[2] }));
      return { success: true, images, skipped: [] };
    }

    // ---------------- 文件產生（示範模式：html格式給真的html，pdf/docx用文字說明取代） ----------------
    case 'generateRequirementDoc': {
      const c = db.cases.find((c) => c.CaseID === params.caseId);
      if (!c) return { success: false, message: '查無此案件' };
      const text = `需求單\n案件編號: ${c.CaseID}\n客戶: ${c.CustomerName}\n業務: ${c.Salesperson}\nFAE: ${c.FAE}\n需求細節:\n${c.RequirementDetails}`;
      return demoDocResult(`需求單_${c.CaseID}`, params.format || 'pdf', text);
    }

    case 'generateEvaluationDoc': {
      const c = db.cases.find((c) => c.CaseID === params.caseId);
      if (!c) return { success: false, message: '查無此案件' };
      const ev = params.evaluationData || {};
      Object.assign(c, { EvaluationResult: ev.TestResult || '', Status: '評估單已發出' });
      saveDemoDB(db);
      const text = `評估單\n案件編號: ${c.CaseID}\n客戶: ${c.CustomerName}\nFAE: ${c.FAE}\n測試人員: ${ev.Tester || ''}\n建議搭配產品: ${ev.RecommendedProduct || ''}\n測試結果: ${ev.TestResult || ''}\n備註: ${ev.Notes || ''}`;
      return demoDocResult(`評估單_${c.CaseID}`, params.format || 'docx', text);
    }

    case 'generateQuoteDoc': {
      const lines = [`報價單`, `客戶: ${params.customerName || ''}`, `客戶類型: ${params.quoteType || ''}`, '', '品名 / 底價 / 牌價 / 報價 / 數量 / 小計'];
      (params.items || []).forEach((it) => lines.push(`${it.name} / ${it.basePrice} / ${it.listPrice} / ${it.unitPrice} / ${it.quantity} / ${it.subtotal}`));
      lines.push('', `總計: ${params.total}`);
      return demoDocResult(`報價單_${params.customerName || 'demo'}`, params.format || 'pdf', lines.join('\n'));
    }

    // ---------------- 客戶 CRUD ----------------
    case 'getCustomers':
      return { success: true, customers: db.customers.map((c, i) => Object.assign({ RowIndex: i }, c)) };

    case 'addCustomer': {
      if (!String(params.companyName || '').trim()) return { success: false, message: '公司名稱不能空白' };
      if (db.customers.some((c) => String(c.CompanyName).replace(/\s+/g, '').toLowerCase() === String(params.companyName).replace(/\s+/g, '').toLowerCase())) return { success: false, message: '已經有「' + params.companyName.trim() + '」這間客戶了，不能重複新增。' };
      db.customers.push({
        CompanyName: params.companyName || '',
        Contact: params.contact || '',
        Phone: params.phone || '',
        Email: params.email || '',
        NextFollowUpDate: params.nextFollowUpDate || '',
        Category: params.category || '',
        Urgency: params.urgency || '',
        Notes: params.notes || '',
        HasTransacted: params.hasTransacted ? '是' : '',
        LastTransactionDate: params.lastTransactionDate || '',
      });
      saveDemoDB(db);
      return { success: true };
    }

    case 'updateCustomer':
    case 'saveFollowUp':
      return demoSaveCustomer(db, params);

    case 'deleteCustomer': {
      const idx = demoFindCustomer(db, params.rowIndex, params.companyName);
      if (idx < 0) return { success: false, message: '找不到這間客戶（可能已被刪除），請重新整理' };
      const name = db.customers[idx].CompanyName;
      const n = db.cases.filter((c) => c.CustomerName === name).length;
      if (n && !params.force) return { success: false, needConfirm: true, caseCount: n, message: '「' + name + '」底下還有 ' + n + ' 個案件，刪除客戶後這些案件會找不到客戶資料。' };
      db.customers.splice(idx, 1);
      saveDemoDB(db);
      return { success: true };
    }

    // ---------------- 客戶聯絡人（一間公司可以有多個聯絡窗口）----------------
    case 'getCustomerContacts': {
      db.customerContacts = db.customerContacts || [];
      let contacts = db.customerContacts.map((c, i) => Object.assign({ RowIndex: i }, c));
      if (params.companyName) contacts = contacts.filter((c) => c.CompanyName === params.companyName);
      return { success: true, contacts };
    }

    case 'addCustomerContact': {
      if (!params.companyName || !params.contactName) return { success: false, message: '公司名稱與聯絡人姓名為必填' };
      db.customerContacts = db.customerContacts || [];
      db.customerContacts.push({
        CompanyName: params.companyName,
        ContactName: params.contactName,
        Phone: params.phone || '',
        Email: params.email || '',
        Title: params.title || '',
        Notes: params.notes || '',
      });
      saveDemoDB(db);
      return { success: true };
    }

    case 'updateCustomerContact': {
      const c = (db.customerContacts || [])[params.rowIndex];
      if (!c) return { success: false, message: '查無此聯絡人' };
      Object.assign(c, params.fields || {});
      saveDemoDB(db);
      return { success: true };
    }

    case 'deleteCustomerContact': {
      (db.customerContacts || []).splice(params.rowIndex, 1);
      saveDemoDB(db);
      return { success: true };
    }

    // ---------------- 客戶聯繫紀錄 ----------------
    case 'addContactLog': {
      if (!String(params.companyName || '').trim()) return { success: false, message: '請填公司名稱' };
      const now = demoNow();
      const row = {
        Date: now.date,
        CreatedAt: now.stamp,
        CompanyName: String(params.companyName).trim(),
        Contact: params.contact || '',
        Method: params.method || '',
        Summary: params.summary || '',
        Salesperson: params.salesperson || (typeof currentUsername !== 'undefined' ? currentUsername : ''),
        CaseID: params.caseId || '',
        Changes: '',
      };
      db.contactLogs.push(row);
      saveDemoDB(db);
      return { success: true, log: Object.assign({ RowIndex: db.contactLogs.length - 1 }, row) };
    }

    case 'getContactLogs': {
      let logs = db.contactLogs.map((l, i) => Object.assign({ RowIndex: i, CreatedAt: '', Changes: '' }, l));
      if (params.date) logs = logs.filter((l) => l.Date === params.date);
      if (params.companyName) logs = logs.filter((l) => l.CompanyName === params.companyName);
      logs.sort((a, b) => String(b.Date).localeCompare(String(a.Date)) || String(b.CreatedAt).localeCompare(String(a.CreatedAt)) || b.RowIndex - a.RowIndex);
      return { success: true, logs };
    }

    case 'updateContactLog': {
      const l = db.contactLogs[params.rowIndex];
      if (!l) return { success: false, message: '查無此紀錄' };
      Object.assign(l, params.fields || {});
      saveDemoDB(db);
      return { success: true };
    }

    case 'deleteContactLog': {
      db.contactLogs.splice(params.rowIndex, 1);
      saveDemoDB(db);
      return { success: true };
    }

    default:
      return { success: false, message: '示範模式尚未支援此操作: ' + action };
  }
}
