// 客人待回覆提醒：轉真人 / 留名單 → 提醒清單；有人回覆、按「我已處理」、刪除通知 → 提醒消失
const assert = require('assert');
const path = require('path');
const { makeEnv } = require('./gasmock');
const { ctx } = makeEnv({ files: [path.join(__dirname, '..', 'Code.gs')], fetch: () => ({ code: 404, body: '' }) });
let pass = 0;
const ok = (c, m) => {
  assert.ok(c, m);
  pass++;
};
ctx.appendObjectRow('Users', { Username: 'admin1', PasswordHash: 'x', Role: 'admin', DisplayName: '管理員' });
ctx.appendObjectRow('Users', { Username: 'lim', PasswordHash: 'x', Role: 'limited', DisplayName: 'lim', Perms: JSON.stringify({ products: 'edit' }) });
const as = (u) => (fn, body) => ctx[fn](Object.assign({ _user: { username: u, displayName: u === 'admin1' ? '管理員' : u } }, body));
const call = as('admin1');
const csKey = call('handleBotGenKey', { role: 'cs' }).key;
const api = (op, id, extra) => ctx.handleBotApi(Object.assign({ secret: csKey, op, lineUserId: id }, extra || {}));
const V = 'V' + 'a'.repeat(32), U = 'U' + 'b'.repeat(32);

ok(call('handleBotAlerts', {}).alerts.length === 0, '一開始沒有待回覆');

// ---- 客人找真人 → 出現提醒 ----
api('csHandoff', V, { text: '我要找真人', displayName: '訪客甲' });
api('csHandoff', U, { text: '請專人聯絡我', displayName: 'Amy' });
let r = call('handleBotAlerts', {});
ok(r.alerts.length === 2 && r.canAck === true, '兩位客人在等');
const web = r.alerts.find((a) => a.id === V);
ok(web.type === 'csHandoff' && web.channel === 'web' && web.at > 0 && /我要找真人/.test(web.content), '網站訪客：有類型 / 管道 / 時間 / 客人說的話');
ok(r.alerts.find((a) => a.id === U).channel === 'line', 'LINE 客人');

// ---- 網站訪客：小編回覆 → 自動停止；LINE 客人不受影響 ----
call('handleBotHumanReply', { userId: V, text: '您好，我是專員' });
r = call('handleBotAlerts', {});
ok(r.alerts.length === 1 && r.alerts[0].id === U, '小編回覆網站訪客後，只剩 LINE 客人');
const m = ctx.sheetToObjects('Memos').rows.find((x) => x.LinkId === V);
ok(m.AckBy === '管理員' && Number(m.AckAt) > 0, '記下是誰回覆的');

// ---- LINE 客人：按「我已處理」 ----
const ack = call('handleBotAlertAck', { type: 'csHandoff', id: U });
ok(ack.success && ack.alerts.length === 0, '按「我已處理」後清單立刻更新');

// ---- 新的聯繫名單 ----
api('csLead', V, { name: '王小明', phone: '0912-345-678' });
r = call('handleBotAlerts', {});
ok(r.alerts.length === 1 && r.alerts[0].type === 'csLead' && /王小明/.test(r.alerts[0].title), '新的聯繫名單也會提醒');
// 小編回覆訪客不會消掉「聯繫名單」提醒（那是要回電的）
call('handleBotHumanReply', { userId: V, text: '收到' });
ok(call('handleBotAlerts', {}).alerts.length === 1, '回覆聊天不影響聯繫名單提醒');
call('handleBotAlertAck', { type: 'csLead', id: V });
ok(call('handleBotAlerts', {}).alerts.length === 0, '處理聯繫名單後消失');

// ---- 恢復機器人 = 已處理 ----
const U2 = 'U' + 'c'.repeat(32);
api('csHandoff', U2, { text: '找人', displayName: 'Bob' });
ok(call('handleBotAlerts', {}).alerts.length === 1, 'Bob 在等');
call('handleBotResume', { userId: U2 });
ok(call('handleBotAlerts', {}).alerts.length === 0, '按「恢復機器人」→ 提醒停止');

// ---- 刪除備忘錄通知 → 提醒消失 ----
const U3 = 'U' + 'd'.repeat(32);
api('csHandoff', U3, { text: '找人', displayName: 'Cat' });
const row = ctx.sheetToObjects('Memos').rows.findIndex((x) => x.LinkId === U3) + 2;
ok(call('handleBotAlerts', {}).alerts.length === 1, 'Cat 在等');
call('handleDeleteMemo', { rowIndex: row });
ok(call('handleBotAlerts', {}).alerts.length === 0, '刪掉通知 → 提醒消失');

// ---- 沒有建立時間的舊通知不提醒（避免上線當天一次跳出一堆）----
ctx.appendObjectRow('Memos', { Owner: 'SYSTEM', OwnerName: '客服機器人', Title: '🛎️ 舊的', Content: '客人說：舊', LinkType: 'csHandoff', LinkId: U3, NeedBlock: 'bot' });
ok(call('handleBotAlerts', {}).alerts.length === 0, '舊通知（沒有 CreatedAt）不提醒');

// ---- 同一位客人同類通知只留一則 ----
const U4 = 'U' + 'e'.repeat(32);
api('csHandoff', U4, { text: '第一次', displayName: 'Dan' });
ctx.appendObjectRow('Memos', { Owner: 'SYSTEM', Title: '🛎️ 客人找真人：Dan', Content: '客人說：第二次', LinkType: 'csHandoff', LinkId: U4, NeedBlock: 'bot', CreatedAt: Date.now() + 1000 });
ctx.botAlertsBust_();
r = call('handleBotAlerts', {});
ok(r.alerts.length === 1 && /第二次/.test(r.alerts[0].content), '只留最新一則');
call('handleBotAlertAck', { type: 'csHandoff', id: U4 });
ok(call('handleBotAlerts', {}).alerts.length === 0, '一次處理同一位客人的全部通知');

// ---- 權限 ----
ok(ctx.permFor_('botAlerts').join() === 'bot,r' && ctx.permFor_('botAlertAck').join() === 'bot,w', '權限登記：查看 bot,r / 處理 bot,w');
ok(call('handleBotAlerts', {}).success, '管理員可查看');

console.log('alerts.test.js：' + pass + ' 項通過');
