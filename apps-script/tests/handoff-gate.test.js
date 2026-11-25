// 轉真人前先留資料（BOT 設定 → 客服設定 → 客人要找真人）：設定的預設值與儲存、留資料表單的必填檢查、
// 等留資料的狀態、轉真人通知附上客人留的資料
const assert = require('assert');
const path = require('path');
const { makeEnv } = require('./gasmock');
const { ctx } = makeEnv({ files: [path.join(__dirname, '..', 'Code.gs')], fetch: () => ({ code: 404, body: '' }) });
let pass = 0;
const ok = (c, m) => {
  assert.ok(c, m);
  pass++;
};
const admin = { username: 'admin1', displayName: 'admin1' };
ctx.appendObjectRow('Users', { Username: 'admin1', PasswordHash: 'x', Role: 'admin', DisplayName: 'admin1' });
const V1 = 'V' + '1'.repeat(32), V2 = 'V' + '2'.repeat(32), V3 = 'V' + '3'.repeat(32);

// 預設：每次轉真人都要先留；需求、姓名必填，公司選填；說明文字有預設
let g = ctx.handleBotGetSettings({ _user: admin }).cs.gate;
ok(g.mode === 'always' && g.need === true && g.name === true && g.company === false, '預設：每次都擋、需求與姓名必填');
ok(/表單/.test(g.text) && /電話或 Email/.test(g.lineText), '預設說明文字（網站 / LINE）');

// 儲存設定：改成「只有一開始」、公司必填、自訂文字；亂填的模式回到預設
let r = ctx.handleBotSaveSettings({ _user: admin, cs: Object.assign({}, ctx.handleBotGetSettings({ _user: admin }).cs, { gate: { mode: 'first', need: false, name: false, company: true, text: '請填表', lineText: '請回覆' } }) });
ok(r.success, '儲存成功');
g = ctx.handleBotGetSettings({ _user: admin }).cs.gate;
ok(g.mode === 'first' && g.need === false && g.name === false && g.company === true && g.text === '請填表' && g.lineText === '請回覆', '設定存得進去也讀得回來');
ok(ctx.botCsGate_({ mode: 'xx' }).mode === 'always' && ctx.botCsGate_({ text: '  ' }).text.length > 10, '亂填的模式 → 每次都擋；文字清空 → 用預設');

// 機器人每則訊息拿到的設定有 gate
const KEY = ctx.handleBotGenKey({ _user: admin }).key;
const bot = (op, extra) => ctx.handleBotApi(Object.assign({ secret: KEY, op }, extra || {}));
ok(bot('csStart', { lineUserId: V1 }).data.gate.mode === 'first', 'csStart 帶上轉真人前留資料的設定');

// 等留資料：csRemember 帶 gate → leadState = gate；留過資料（done）不會被蓋回 gate
bot('csRemember', { lineUserId: V1, turns: [{ u: true, t: '真人' }, { u: false, t: '請填表' }], gate: true });
ok(bot('csStart', { lineUserId: V1 }).data.leadState === 'gate', '記下正在等客人留資料');

// 表單必填照設定（gate:true 才檢查；一般留資料表單不受影響）
ok(!bot('csLead', { lineUserId: V1, name: '王', phone: '0912345678', gate: true }).success, '公司必填：沒填 → 擋');
r = bot('csLead', { lineUserId: V1, name: '王', phone: '0912345678', gate: true });
ok(/公司/.test(r.message || ''), '錯誤訊息說明缺公司');
ok(bot('csLead', { lineUserId: V2, phone: '0912345678' }).success, '一般留資料表單：不檢查需求 / 姓名 / 公司');
ctx.handleBotSaveSettings({ _user: admin, cs: Object.assign({}, ctx.handleBotGetSettings({ _user: admin }).cs, { gate: { mode: 'always', need: true, name: true, company: false } }) });
ok(/需求/.test(bot('csLead', { lineUserId: V3, name: '王', phone: '0912345678', gate: true }).message || ''), '需求必填：沒填 → 擋');
ok(/姓名/.test(bot('csLead', { lineUserId: V3, note: '想問 AOI', phone: '0912345678', gate: true }).message || ''), '姓名必填：沒填 → 擋');
ok(/電話或 Email/.test(bot('csLead', { lineUserId: V3, name: '王', note: '想問 AOI', gate: true }).message || ''), '電話或 Email 一定要有');

// 留好資料 → leadState done；接著轉真人，通知裡附上客人留的資料
r = bot('csLead', { lineUserId: V1, name: '王小明', company: '甲公司', phone: '0912345678', note: '想詢問 PCB 外觀檢測', gate: true });
ok(r.success && bot('csStart', { lineUserId: V1 }).data.leadState === 'done', '留好資料 → 已留');
bot('csRemember', { lineUserId: V1, turns: [{ u: true, t: '真人' }], gate: true });
ok(bot('csStart', { lineUserId: V1 }).data.leadState === 'done', '已留過資料不會被蓋回「等留資料」');
bot('csHandoff', { lineUserId: V1, displayName: '網站訪客', text: '🙋 轉真人' });
const memo = ctx.sheetToObjects('Memos').rows.find((m) => m.LinkType === 'csHandoff' && m.LinkId === V1);
ok(memo && /客人留的資料/.test(memo.Content) && /PCB 外觀檢測/.test(memo.Content) && /0912345678/.test(memo.Content), '轉真人通知附上客人留的需求與電話');

// LINE 在聊天中留下（source chat）→ 聯繫名單通知標示來源
const U1 = 'U' + 'a'.repeat(32);
bot('csLead', { lineUserId: U1, phone: '0912345678', note: '想問報價 0912345678', source: 'chat' });
const leadMemo = ctx.sheetToObjects('Memos').rows.find((m) => m.LinkType === 'csLead' && m.LinkId === U1);
ok(leadMemo && /轉真人前在聊天中留下/.test(leadMemo.Content), 'LINE 聊天中留下的資料：通知標示來源');
ok(ctx.sheetToObjects('BotLeads').rows.some((x) => x.UserId === U1 && x.Source === 'chat'), '聯繫名單記下來源 chat');

console.log('handoff-gate checks passed: ' + pass);
