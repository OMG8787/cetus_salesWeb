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
const say = (id, q, a) => ctx.botLogTurns_('web', id, '', [{ role: 'user', text: q }, { role: 'bot', text: a }], '');
const conv = (id) => ctx.handleBotConversations({ _user: admin }).conversations.find((c) => c.id === id);
const thread = (id) => ctx.handleBotThread({ _user: admin, userId: id }).messages;

say(V1, '保固多久', '一年');
ok(conv(V1).count === 2 && conv(V1).sessions === 1 && conv(V1).closed === false, '聊天中：1 段、未關閉');

// 客人關閉聊天室：記一筆標記、之後的記憶清掉，但紀錄都還在
ctx.botCachePut_(ctx.csHistKey_(V1), [{ u: true, t: 'x' }], 600);
ok(ctx.csEnd_(V1) === true, '有進行中的對話 → 記錄關閉');
ok(ctx.botCacheGet_(ctx.csHistKey_(V1)) === null, '機器人的短期記憶清掉');
let t = thread(V1);
ok(t.length === 3 && t[2].role === 'reset' && t[2].text.indexOf('關閉聊天室') > -1, '後台看得到「客人關閉聊天室」標記，前面的紀錄還在');
ok(conv(V1).closed === true && conv(V1).count === 2 && conv(V1).lastText === '一年', '列表：已關閉，最後一句仍是客人看過的內容');

// 重複關閉、沒聊過就關閉 → 不重複記
ok(ctx.csEnd_(V1) === false && thread(V1).length === 3, '已經關閉了不重複記錄');
ok(ctx.csEnd_(V2) === false && !conv(V2), '沒聊過的訪客關閉視窗：什麼都不記');

// 再次開啟、再問：第二段；之前的紀錄用標記隔開
say(V1, '運費呢', '請洽專人');
ok(conv(V1).sessions === 2 && conv(V1).closed === false && conv(V1).count === 4, '第二段對話：共 2 段、已重新開始');
t = thread(V1);
ok(t.map((m) => m.role).join() === 'user,bot,reset,user,bot', '同一位訪客的紀錄依序排列，中間隔著關閉標記');

// 網站視窗還原對話：關閉後重新開是空的，只看到新的一段
let msgs = ctx.csThread_(V1, {}).messages;
ok(msgs.length === 2 && msgs[0].text === '運費呢', '視窗還原只有最新一段');
ctx.csEnd_(V1);
ok(ctx.csThread_(V1, {}).messages.length === 0, '關閉後再開是全新的一段');

// 測試聊天不記
ok(ctx.csEnd_('T' + '3'.repeat(32)) === true, '後台測試聊天不記錄');
console.log('chat close checks passed:', pass);
