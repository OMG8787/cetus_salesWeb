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
const V1 = 'V' + '1'.repeat(32), V2 = 'V' + '2'.repeat(32);
const count = () => ctx.getSheet('BotMessages').getLastRow() - 1;

// 預設上限 4000，可以自己改（最小 50、最大 20000）
ok(ctx.botGeneral_().logMax === 4000, '預設上限 4000');
ctx.botCfgSet_('general', { logMax: 100 });
ok(ctx.botGeneral_().logMax === 100, '上限可以設成 100');
ctx.botCfgSet_('general', { logMax: 5 });
ok(ctx.botGeneral_().logMax === 50, '太小的值最少 50');
ctx.botCfgSet_('general', { logMax: 999999 });
ok(ctx.botGeneral_().logMax === 20000, '太大的值最多 20000');

// 寫入時超過上限（加緩衝）會自動刪最舊的
ctx.botCfgSet_('general', { logMax: 100 });
for (let i = 0; i < 160; i++) ctx.botLogTurns_('web', i % 2 ? V1 : V2, '', [{ role: 'user', text: 'msg ' + i }], '');
ok(count() <= 110 && count() >= 100, '寫了 160 筆後只剩上限 + 緩衝內：' + count());
const firstId = Number(ctx.getSheet('BotMessages').getRange(2, 1).getValue());
ok(firstId > 1, '最舊的已經被刪掉');

// 上限改小：儲存設定時立刻刪到剛好
const before = count();
let r = ctx.handleBotSaveSettings({ _user: admin, general: { logMax: 50 } });
ok(r.success && r.trimmed === before - 50 && count() === 50, '改成 50 → 立刻刪掉 ' + r.trimmed + ' 筆，剩 ' + count());
r = ctx.handleBotSaveSettings({ _user: admin, general: { logMax: 500 } });
ok(r.success && r.trimmed === 0 && count() === 50, '改大不會刪');
ok(ctx.handleBotGetSettings({ _user: admin }).general.logMax === 500, '設定畫面讀得到上限');
ok(ctx.handleBotConversations({ _user: admin }).max === 500, '對話列表回報目前上限');

// 客人留聯繫資料後：對話列表帶上他的資料，網站訪客改顯示他的姓名
let list = ctx.handleBotConversations({ _user: admin }).conversations;
ok(list.length === 2 && list.every((c) => c.lead === null), '還沒留資料：lead 是空的');
ctx.csLead_(V1, { name: '王小明', company: '甲公司', phone: '0912345678', email: '' , note: '' });
list = ctx.handleBotConversations({ _user: admin }).conversations;
const c1 = list.find((c) => c.id === V1);
ok(c1.lead && c1.lead.name === '王小明' && c1.lead.company === '甲公司' && c1.lead.phone === '0912345678', '留過資料的客人：lead 有姓名公司電話');
ok(list.find((c) => c.id === V2).lead === null, '沒留資料的客人不受影響');
ok(ctx.handleBotThread({ _user: admin, userId: V1 }).lead.name === '王小明', '單一對話也帶 lead');

// 刪除某位客人的對話：只刪他的，聯繫名單留著
const v1Count = list.find((c) => c.id === V1).count;
const total0 = count();
r = ctx.handleBotClear({ _user: admin, options: { messages: true, history: true, pauses: true, memos: true, target: V1 } });
ok(r.success && r.counts.messages === v1Count && count() === total0 - v1Count, '刪掉 V1 的 ' + v1Count + ' 筆對話');
ok(ctx.handleBotThread({ _user: admin, userId: V1 }).messages.length === 0, 'V1 對話清空');
ok(ctx.handleBotThread({ _user: admin, userId: V2 }).messages.length > 0, 'V2 對話還在');
ok(ctx.handleBotLeads({ _user: admin }).leads.length === 1, '聯繫名單的資料不會被刪');

console.log('bot talk checks passed:', pass);
