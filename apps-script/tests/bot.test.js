const assert = require('assert');
const path = require('path');
const { makeEnv } = require('./gasmock');
const files = [path.join(__dirname, '..', 'Code.gs')];
let aiCalls = [];
const { ctx, sheets, fetchLog } = makeEnv({
  files,
  fetch: (url, o) => {
    aiCalls.push({ url, body: JSON.parse(o.payload) });
    if (/generativelanguage/.test(url)) return { code: 200, body: { candidates: [{ content: { parts: [{ text: '成功' }] } }] } };
    return { code: 401, body: { error: { message: 'bad key sk-secret-1234' } } };
  },
});
let pass = 0;
const ok = (c, m) => {
  assert.ok(c, m);
  pass++;
};

// 帳號
const mk = (u, role, perms) => ctx.appendObjectRow('Users', { Username: u, PasswordHash: 'x', Role: role, DisplayName: u, Perms: perms ? JSON.stringify(perms) : '' });
mk('admin1', 'admin');
mk('ed', 'editor');
mk('vw', 'viewer');
mk('botlim', 'limited', { bot: 'edit' });
mk('botview', 'limited', { bot: 'view' });
mk('sal', 'sales');
const can = (u, a) => {
  try {
    ctx.requirePermission_(a, { username: u });
    return true;
  } catch (e) {
    return false;
  }
};
const call = (fn, body, u) => ctx[fn](Object.assign({ _user: { username: u || 'admin1' } }, body));

// 權限
ok(can('ed', 'botSaveSettings') && can('ed', 'botGetSettings') && !can('ed', 'botKbDelete') && !can('ed', 'botClear'), 'editor 可編輯、不可刪除');
ok(can('vw', 'botGetSettings') && !can('vw', 'botSaveSettings') && !can('vw', 'botGenKey'), 'viewer 只能看');
ok(can('botlim', 'botKbSave') && !can('botlim', 'botKbDelete') && can('botview', 'botConversations') && !can('botview', 'botHumanReply'), 'limited bot');
ok(!can('sal', 'botGetSettings'), '舊角色 sales 不能用 BOT 設定');
const noperm = Object.keys(ctx.botRoutes_()).filter((a) => ctx.botRoutes_()[a].auth && !ctx.botPerms_()[a]);
ok(noperm.length === 0, '沒登記權限：' + noperm.join(','));

// 預設狀態
let st = call('handleBotGetSettings', {});
ok(st.success && st.cs.enabled === false && st.cs.topics.length === 5 && !st.hasKey && st.ai.length === 0, '預設設定');
ok(st.cs.handoffWords.indexOf('真人') > -1 && st.cs.style.tone === 'friendly' && st.cs.sources.products === false && st.cs.hours.days.join() === '1,2,3,4,5', '預設值');

// Bot 金鑰
let r = call('handleBotGenKey', {});
ok(r.success && r.key.length === 64, '產生金鑰');
const KEY = r.key;
const bot = (op, extra) => ctx.handleBotApi(Object.assign({ secret: KEY, op }, extra || {}));
const U1 = 'U' + 'a'.repeat(32);
const U2 = 'U' + 'b'.repeat(32);
const V1 = 'V' + 'c'.repeat(32);
ok(!ctx.handleBotApi({ secret: 'wrong', op: 'csStart', lineUserId: U1 }).success && ctx.handleBotApi({ secret: 'wrong', op: 'csStart', lineUserId: U1 }).code === 'BOT_AUTH', '錯誤金鑰被拒');
ok(!bot('csStart', { lineUserId: 'not-an-id' }).success, '編號格式錯誤');
ok(!bot('nonsense', { lineUserId: U1 }).success, '未知操作');

// 設定儲存
const csForm = st.cs;
csForm.enabled = true;
csForm.welcome = '歡迎光臨';
csForm.prompt = '不要承諾交期';
csForm.hours = { enabled: true, days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00', offText: '' };
csForm.topics.find((t) => t.key === 'price').on = true;
csForm.topics.find((t) => t.key === 'sample').words = '樣品 打樣';
csForm.buttons = '產品介紹\n怎麼報價\n找真人\n產品介紹';
csForm.web = { enabled: true, title: '線上客服', color: 'red', position: 'left', autoOpen: false, allowedOrigins: 'https://www.cetus.tw\nhttps://cetus.tw/' };
csForm.sources.products = true;
r = call('handleBotSaveSettings', { cs: csForm, general: { replyDelay: 3, botUrl: 'https://aoi-bot.vercel.app/', brand: '鑫堡' } });
ok(r.success, '儲存設定');
st = call('handleBotGetSettings', {});
ok(st.cs.enabled && st.cs.welcome === '歡迎光臨' && st.cs.topics.find((t) => t.key === 'price').on && st.cs.topics.find((t) => t.key === 'sample').words === '樣品 打樣' && st.cs.topics.find((t) => t.key === 'order').words === ctx.BOT_CS_TOPICS[1].words, '設定讀回來（預設關鍵字不存）');
ok(st.cs.web.color === '#2c5aa0' && st.cs.web.position === 'left' && st.general.botUrl === 'https://aoi-bot.vercel.app' && st.general.replyDelay === 3 && st.general.brand === '鑫堡', '網站視窗與一般設定清理');
let bad;
try {
  bad = call('handleBotSaveSettings', { general: { botUrl: 'ftp://x' } });
} catch (e) {
  bad = { success: false };
}
ok(!bad.success, '機器人網址格式檢查');

// AI 設定
r = call('handleBotSaveAi', { models: [{ provider: 'gemini', apiKey: 'AIzaSecretKey1234', model: '' }, { provider: 'openai', apiKey: 'sk-secret-1234', model: 'gpt-x', endpoint: 'https://api.example.com/v1' }, { provider: 'claude', apiKey: '' }] });
ok(r.success && r.ai.length === 2 && r.ai[0].keyHint === '••••1234' && JSON.stringify(r).indexOf('AIzaSecretKey') < 0, 'AI 儲存且金鑰遮蔽');
r = call('handleBotSaveAi', { models: [{ provider: 'gemini', apiKey: '', model: 'gemini-x' }, { provider: 'openai', apiKey: '', model: 'gpt-x', endpoint: 'https://api.example.com/v1' }] });
ok(r.success && r.ai.length === 2 && ctx.botAiList_()[0].apiKey === 'AIzaSecretKey1234' && ctx.botAiList_()[0].model === 'gemini-x', '金鑰留空沿用');
r = call('handleBotTestAi', { index: 0 });
ok(r.success && r.reply === '成功' && /generativelanguage/.test(aiCalls.at(-1).url) && aiCalls.at(-1).body.systemInstruction, 'Gemini 測試呼叫');
r = call('handleBotTestAi', { index: 1 });
ok(!r.success && /AI 服務錯誤/.test(r.message) && r.message.indexOf('sk-secret-1234') < 0, '錯誤訊息不含金鑰：' + r.message);
ok(!call('handleBotTestAi', { index: 5 }).success, 'index 超出');

// 知識庫
r = call('handleBotKbSave', { type: 'qa', question: '你們有賣光源嗎？', content: '有，環形光源與條形光源都有。', tags: '光源' });
ok(r.success, '新增常見問題');
ok(!call('handleBotKbSave', { type: 'qa', question: '', content: 'x' }).success, '缺問題');
r = call('handleBotKbImport', { rows: [{ title: '公司簡介（1/2）', content: '鑫堡股份有限公司專營機器視覺。', source: 'intro.txt' }, { title: '公司簡介（2/2）', content: '提供 AOI 檢測方案。', source: 'intro.txt' }] });
ok(r.success && r.count === 2, '匯入文件');
let kb = call('handleBotKbList', {});
ok(kb.items.length === 3 && kb.items.filter((x) => x.Type === 'doc').length === 2 && kb.items.every((x) => x.IsActive), '知識庫清單');
const qaId = kb.items.find((x) => x.Type === 'qa');
r = call('handleBotKbSave', { rowIndex: qaId.RowIndex, id: qaId.ID, type: 'qa', question: '你們有賣光源嗎？', content: '有，環形、條形、同軸光源。', isActive: true });
ok(r.success && call('handleBotKbList', {}).items.find((x) => x.ID === qaId.ID).Content.indexOf('同軸') > -1, '修改常見問題');
ok(!call('handleBotKbSave', { rowIndex: qaId.RowIndex, id: 999, type: 'qa', question: 'q', content: 'c' }).success, '列號對不上不改');
// 產品放進知識庫：不含底價 / 供應商
ctx.appendObjectRow('Products', { InternalModel: 'ACA2440', SupplierModel: 'ace', Supplier: '祕密供應商', SupplierContact: '陳小姐', Category: '相機', Brand: 'Basler', Interface: 'GigE', Resolution: '2448X2048', RefPrice: '15000', Notes: '內部備註 德鴻官網' });
let ks = bot('csKnowledge');
ok(ks.success && ks.data.length === 3 + 1 + 0, '知識庫段落（FAQ+2 文件+產品；公司資訊空白不放）：' + ks.data.length);
const prod = ks.data.find((c) => c.source === '產品');
ok(prod && prod.text.indexOf('Basler') > -1 && prod.text.indexOf('2448X2048') > -1 && prod.text.indexOf('15000') < 0 && prod.text.indexOf('祕密') < 0 && prod.text.indexOf('陳小姐') < 0 && prod.text.indexOf('內部備註') < 0, '產品段落不含底價與供應商：' + (prod && prod.text));
const brandCfg = call('handleBotGetSettings', {}).cs;
brandCfg.brandInfo = '公司位於新竹。\n\n營業時間週一到週五。';
call('handleBotSaveSettings', { cs: brandCfg });
ks = bot('csKnowledge');
ok(ks.data.filter((c) => c.source === '公司資訊').length === 1, '公司資訊段落');
call('handleBotKbDelete', { source: 'intro.txt' }, 'admin1');
ok(call('handleBotKbList', {}).items.length === 1, '依來源刪整份文件');

// csStart
r = bot('csStart', { lineUserId: U1, botUrl: 'https://other.vercel.app' });
ok(r.success && r.data.enabled && r.data.channel === 'line' && r.data.ai.provider === 'gemini' && r.data.aiFallback.length === 1 && r.data.aiFallback[0].provider === 'openai', 'csStart 基本');
ok(r.data.brand === '鑫堡' && r.data.welcome === '歡迎光臨' && r.data.replyDelay === 3 && r.data.handoffWords.indexOf('真人') > -1, 'csStart 設定帶入');
ok(r.data.topics.length === 1 && r.data.topics[0].name === '價格 / 報價' && r.data.topics[0].words.indexOf('報價') > -1 && r.data.topics[0].ask.indexOf('公司名稱') > -1, 'topics 只帶勾選的');
ok(r.data.buttons.join() === '產品介紹,怎麼報價,找真人' && typeof r.data.inHours === 'boolean' && /週一、二、三、四、五|週/.test(r.data.hoursText), '按鈕去重、服務時間');
ok(call('handleBotGetSettings', {}).general.botUrl === 'https://aoi-bot.vercel.app', '已填機器人網址就不被自動覆蓋');
ok(bot('csStart', { lineUserId: V1 }).data.channel === 'web' && bot('csStart', { lineUserId: V1 }).data.enabled, 'web 通道');

// 短期記憶 + 對話紀錄
r = bot('csRemember', { lineUserId: U1, displayName: '王小明', turns: [{ u: true, t: '你好' }, { u: false, t: '您好，請問需要什麼？' }] });
ok(r.success && r.data === 2, 'csRemember');
r = bot('csStart', { lineUserId: U1 });
ok(r.data.history.length === 2 && r.data.history[0].u === true && r.data.known === true, '記得對話與姓名');
bot('csRemember', { lineUserId: U1, turns: [{ u: true, t: 'x'.repeat(2000) }] });
ok(bot('csStart', { lineUserId: U1 }).data.history.at(-1).t.length === 600, '每則字數上限');
for (let i = 0; i < 15; i++) bot('csRemember', { lineUserId: U1, turns: [{ u: true, t: 'm' + i }] });
ok(bot('csStart', { lineUserId: U1 }).data.history.length === 10, '記憶則數上限');
let convs = call('handleBotConversations', {});
ok(convs.success && convs.conversations.length === 1 && convs.conversations[0].name === '王小明' && convs.conversations[0].count >= 18, '對話列表');
let th = call('handleBotThread', { userId: U1 });
ok(th.messages[0].text === '你好' && th.messages[0].role === 'user' && th.messages[1].role === 'bot', '單一客人對話');
// 測試通道不留紀錄
bot('csRemember', { lineUserId: 'T' + 'd'.repeat(32), turns: [{ u: true, t: 'test msg' }] });
ok(call('handleBotConversations', {}).conversations.length === 1, '測試對話不寫紀錄');

// 轉真人
r = bot('csHandoff', { lineUserId: U1, displayName: '王小明', text: '我要找真人', topic: '價格 / 報價' });
ok(r.success && r.data === true, '轉真人');
let memos = ctx.sheetToObjects('Memos').rows.filter((m) => m.LinkType === 'csHandoff'); // csChat（有人使用機器人）通知另外測
ok(memos.length === 1 && memos[0].Owner === 'SYSTEM' && memos[0].NeedBlock === 'bot' && memos[0].LinkType === 'csHandoff' && memos[0].LinkId === U1 && /價格/.test(memos[0].Title) && memos[0].Content.indexOf('之前的對話') > -1, '備忘錄通知');
ok(bot('csStart', { lineUserId: U1 }).data.paused === true && call('handleBotGetSettings', {}).pauses.length === 1, '暫停中');
ok(bot('csHandoff', { lineUserId: U1, displayName: '王小明', text: '再說一次' }).data === false && ctx.sheetToObjects('Memos').rows.filter((m) => m.LinkType === 'csHandoff').length === 1, '30 分鐘內不重複通知');
// 有人使用機器人 → 通知；後台直接轉真人（接手）
{
  const V9 = 'V' + '9'.repeat(32);
  bot('csRemember', { lineUserId: V9, turns: [{ u: true, t: '請問相機規格' }, { u: false, t: '好的' }] });
  const chat = () => ctx.sheetToObjects('Memos').rows.filter((m) => m.LinkType === 'csChat' && m.LinkId === V9);
  ok(chat().length === 1, '有人使用機器人 → 產生通知');
  bot('csRemember', { lineUserId: V9, turns: [{ u: true, t: '再問一題' }] });
  ok(chat().length === 1, '30 分鐘內同一位不重複通知');
  const tk = call('handleBotTakeover', { userId: V9 }, 'botlim');
  ok(tk.success && bot('csStart', { lineUserId: V9 }).data.paused === true, '後台轉真人 → 機器人暫停');
  ok(chat()[0].AckAt, '轉真人後通知算已處理');
  ctx.sheetToObjects('Memos').rows.map((m, i) => (m.LinkId === V9 ? i + 2 : 0)).filter(Boolean).reverse().forEach((r) => ctx.getSheet('Memos').deleteRow(r)); // 清掉，不影響後面的備忘錄筆數檢查
  ctx.botCache_().remove('cspause:' + V9);
}
// 備忘錄可見度
ok(call('handleGetMemos', {}, 'botlim').memos.length === 2 && call('handleGetMemos', {}, 'admin1').memos.length === 2, '有 BOT 權限的人看得到通知');
ok(call('handleGetMemos', {}, 'ed').memos.length === 2 && call('handleGetMemos', {}, 'sal').memos.length === 0 && call('handleGetMemos', {}, 'vw').memos.length === 2, '編輯者 / 查看看得到，舊角色看不到（沒有 BOT 區塊）');
const memoRow = call('handleGetMemos', {}, 'botlim').memos.find((m) => m.LinkType === 'csHandoff');
ok(memoRow.CanManage === true && call('handleGetMemos', {}, 'vw').memos[0].CanManage === false, 'CanManage');
let denied = false;
try {
  call('handleDeleteMemo', { rowIndex: memoRow.RowIndex }, 'vw');
} catch (e) {
  denied = true;
}
ok(denied, '查看角色不能處理通知');
r = call('handleDeleteMemo', { rowIndex: memoRow.RowIndex }, 'botlim');
ok(r.success && ctx.sheetToObjects('Memos').rows.filter((m) => m.LinkType === 'csHandoff').length === 0 && bot('csStart', { lineUserId: U1 }).data.paused === false, '刪除通知 = 恢復機器人');
// 重新開始 = csForget
bot('csHandoff', { lineUserId: U2, displayName: 'B', text: '真人' });
ok(bot('csStart', { lineUserId: U2 }).data.paused, 'U2 暫停');
bot('csForget', { lineUserId: U2 });
ok(!bot('csStart', { lineUserId: U2 }).data.paused && bot('csStart', { lineUserId: U2 }).data.history.length === 0, '重新開始：恢復並清短期記憶');

// 網站訪客：小編回覆與輪詢
bot('csRemember', { lineUserId: V1, turns: [{ u: true, t: '請問報價？' }, { u: false, t: '請稍候' }] });
ok(!call('handleBotHumanReply', { userId: U1, text: 'hi' }).success, 'LINE 客人不能在這裡回覆');
r = call('handleBotHumanReply', { userId: V1, text: '您好，我是業務小王' });
ok(r.success, '小編回覆網站訪客');
let poll = bot('csMessages', { lineUserId: V1, after: 0 });
ok(poll.data.messages.length === 1 && poll.data.messages[0].text === '您好，我是業務小王', '訪客視窗輪詢到小編回覆');
ok(bot('csMessages', { lineUserId: V1, after: poll.data.messages[0].id }).data.messages.length === 0, '只回傳新的');
ok(bot('csStart', { lineUserId: V1 }).data.history.at(-1).t.indexOf('（小編）') === 0, '小編說的話進短期記憶');
// 網站訪客頻率限制
let limited = false;
for (let i = 0; i < 15; i++) limited = bot('csStart', { lineUserId: 'V' + 'e'.repeat(32) }).data.rateLimited;
ok(limited === true, '頻率限制');

// 網站訪客視窗：還原對話、重新開始後不再顯示之前的對話
let thr = bot('csThread', { lineUserId: V1 });
ok(thr.success && thr.data.messages.map((m) => m.role).join() === 'user,bot,human' && thr.data.paused === false, '還原對話（含小編回覆）');
ok(bot('csThread', { lineUserId: V1, after: thr.data.messages[2].id }).data.messages.length === 0, '輪詢只回新的');
bot('csForget', { lineUserId: V1 });
bot('csRemember', { lineUserId: V1, turns: [{ u: true, t: '新的問題' }, { u: false, t: '新的回答' }] });
thr = bot('csThread', { lineUserId: V1 });
ok(thr.data.messages.length === 2 && thr.data.messages[0].text === '新的問題', '重新開始後只看得到之後的對話');
ok(call('handleBotThread', { userId: V1 }).messages.some((m) => m.role === 'reset'), '後台對話紀錄看得到「重新開始」');

// 網站視窗設定
const w = bot('csWidget');
ok(w.success && w.data.enabled && w.data.title === '線上客服' && w.data.position === 'left' && w.data.allowedOrigins.indexOf('cetus.tw') > -1 && w.data.buttons.length === 3 && !('prompt' in w.data) && JSON.stringify(w.data).indexOf('AIza') < 0, '公開設定不含金鑰');

// 測試權杖
r = call('handleBotTestToken', {});
ok(r.success && r.url === 'https://aoi-bot.vercel.app' && r.sig.length === 64 && /^T[0-9a-f]{32}$/.test(r.testId), '測試權杖');

// 清除
let dry = call('handleBotClear', { dryRun: true, options: { messages: true, memos: true, pauses: true, history: true } });
ok(dry.success && dry.dryRun && dry.counts.messages > 10, '清除前先報筆數');
r = call('handleBotClear', { options: { messages: true, history: true } });
ok(r.success && call('handleBotConversations', {}).conversations.length === 0 && bot('csStart', { lineUserId: U1 }).data.history.length === 0, '清除對話資料與短期記憶');

// 金鑰
ok(call('handleBotRevealKey', {}).key === KEY, '顯示金鑰');
const KEY2 = call('handleBotGenKey', {}).key;
ok(KEY2 !== KEY && !bot('csStart', { lineUserId: U1 }).success && ctx.handleBotApi({ secret: KEY2, op: 'csStart', lineUserId: U1 }).success, '重新產生後舊金鑰失效');

// setup 表單
const all = ctx.allSchemas_();
ok(all.schema.BotKnowledge && all.schema.BotMessages && all.schema.BotConfig && all.text.BotMessages.indexOf('UserId') > -1, 'allSchemas_ 含模組');
console.log('通過 ' + pass + ' 項');

// 官網小機器人設定
{
  const d0 = ctx.csWidgetConfig_().robot;
  ok(d0.enabled === true && d0.size === 96 && d0.items.length === 3 && d0.banner === '歡迎詢問、選配等', '小機器人預設值');
  const r = call('handleBotSaveSettings', { robot: { size: 999, color: 'red', banner: '你好', greeting: '', greetingSeconds: 8, items: [
    { icon: '💬', label: '客服', type: 'chat' },
    { icon: '💚', label: 'LINE', type: 'url', url: 'https://line.me/R/ti/p/@abc', target: '_blank' },
    { icon: 'x', label: '壞連結', type: 'url', url: 'javascript:alert(1)' },
    { icon: 'x', label: '', type: 'chat' },
  ] } }, 'botlim');
  ok(r.success, '儲存小機器人設定');
  const g = ctx.csWidgetConfig_().robot;
  ok(g.size === 160 && g.color === '#2563eb' && g.banner === '你好' && g.greeting === '' && g.greetingSeconds === 8, '大小夾在範圍內、顏色不合法用預設、文字可清空');
  ok(g.items.length === 2 && g.items[1].url === 'https://line.me/R/ti/p/@abc' && g.items[1].target === '_blank', 'javascript: 網址與沒有名稱的項目被丟掉，LINE 連結保留');
  ok(call('handleBotGetSettings', {}, 'botlim').robot.items.length === 2, '後台讀得到');
}
