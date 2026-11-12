// 防濫用：網站視窗的流量上限（每訪客 / 每 IP / 全站）、後台可設定、全站用完寄信、留資料與客人輸入的安全處理
const assert = require('assert');
const path = require('path');
const { makeEnv } = require('./gasmock');
const { ctx } = makeEnv({ files: [path.join(__dirname, '..', 'Code.gs')], fetch: () => ({ code: 404, body: '' }) });
let pass = 0;
const ok = (c, m) => {
  assert.ok(c, m);
  pass++;
};
const mails = [];
ctx.GmailApp = { sendEmail: (to, subject, body) => mails.push({ to, subject, body }) };
const admin = { username: 'admin1', displayName: 'admin1' };
ctx.appendObjectRow('Users', { Username: 'admin1', PasswordHash: 'x', Role: 'admin', DisplayName: 'admin1', Email: 'boss@example.com' });
const V = (n) => 'V' + String(n).padStart(32, '0');
const start = (n, ip) => ctx.csStart_(V(n), ip ? { ip } : {});

// 預設值
let g = ctx.botSettings_().guard;
ok(g.visitorPerMin === 12 && g.ipPerMin === 20 && g.ipPerHour === 120 && g.reqPerMin === 120 && g.globalPerHour === 600 && g.globalPerDay === 3000 && g.leadPerHour === 10, '預設上限');
ok(g.requireOrigin === true && g.alert === true && /人比較多/.test(g.overText), '預設：沒帶來源一律拒絕、全站用完寄信、有預設的話');
ok(ctx.csWidgetConfig_().guard.ipPerMin === 20, '視窗設定帶著上限給機器人');
ok(start(1, '1.1.1.1').guard.globalPerDay === 3000, 'csStart 也帶著，機器人第一道檢查用同一份');

// 後台儲存：範圍限制、0 = 不限
let r = ctx.handleBotSaveSettings({ _user: admin, cs: { guard: { visitorPerMin: 999, ipPerMin: 3, ipPerHour: -5, globalPerHour: 5, globalPerDay: 'abc', leadPerHour: 2, requireOrigin: false, alert: false, overText: '客滿了' } } });
ok(r.success, '儲存成功');
g = ctx.botSettings_().guard;
ok(g.visitorPerMin === 120 && g.ipPerMin === 3 && g.ipPerHour === 0 && g.globalPerHour === 5 && g.globalPerDay === 3000 && g.leadPerHour === 2, '超出範圍被夾住、亂填用預設、負數變 0（不限）');
ok(g.requireOrigin === false && g.alert === false && g.overText === '客滿了', '開關與文字照存');
ok(ctx.handleBotGetSettings({ _user: admin }).cs.guard.ipPerMin === 3, '設定頁讀得到');

// 同一個 IP 換訪客編號也算同一個
ctx.handleBotSaveSettings({ _user: admin, cs: { guard: { ipPerMin: 3, ipPerHour: 0, globalPerHour: 0, globalPerDay: 0, visitorPerMin: 50 } } });
let reasons = [];
for (let i = 1; i <= 6; i++) reasons.push(start(100 + i, '9.9.9.9').limitReason);
ok(reasons.join() === ',,,ip,ip,ip', '前 3 則通過，之後被 IP 擋下：' + reasons.join('|'));
ok(start(200, '8.8.8.8').rateLimited === false, '別的 IP 不受影響');
ok(start(201).rateLimited === false, '沒有 IP（LINE 以外的舊呼叫）不套用 IP 上限');

// 同一個訪客傳太快
ctx.handleBotSaveSettings({ _user: admin, cs: { guard: { visitorPerMin: 2, ipPerMin: 0, ipPerHour: 0, globalPerHour: 0, globalPerDay: 0 } } });
reasons = [];
for (let i = 0; i < 4; i++) reasons.push(start(300, '7.7.7.7').limitReason);
ok(reasons.join() === ',,visitor,visitor', '同一個訪客超過每分鐘上限：' + reasons.join('|'));

// 全站每小時 / 每天；被別的上限擋下的不吃全站額度
ctx.handleBotSaveSettings({ _user: admin, cs: { guard: { visitorPerMin: 50, ipPerMin: 1, ipPerHour: 0, globalPerHour: 3, globalPerDay: 0, alert: false } } });
ctx.botCache_().remove('csg:gh:' + Math.floor(Date.now() / 3600000)); // 前面的測試已經算過全站次數，先歸零
start(400, '5.5.5.5');
for (let i = 0; i < 10; i++) start(401 + i, '5.5.5.5'); // 狂灌的被 IP 擋下，不算全站
ok(start(420, '5.5.5.6').rateLimited === false && start(421, '5.5.5.7').rateLimited === false, '全站才用了 3 次，還沒滿');
let full = start(422, '5.5.5.8');
ok(full.rateLimited && full.limitReason === 'global', '第 4 則：全站每小時上限用完');
ok(mails.length === 0, '後台取消了「寄信通知」，不寄');
ctx.handleBotSaveSettings({ _user: admin, cs: { guard: { alert: true, globalPerHour: 3 } } });
start(430, '4.4.4.1');
start(431, '4.4.4.2');
ok(mails.length === 1 && mails[0].to === 'boss@example.com' && /流量已達上限/.test(mails[0].subject), '全站用完 → 寄信給管理員');
start(432, '4.4.4.3');
ok(mails.length === 1, '同一小時不重複寄');

ctx.handleBotSaveSettings({ _user: admin, cs: { guard: { globalPerHour: 0, globalPerDay: 2, ipPerMin: 0, visitorPerMin: 50 } } });
ctx.PropertiesService.getScriptProperties().deleteProperty('CS_GUARD_DAY'); // 每日計數先歸零
ctx.botCache_().remove('csg:gd:' + ctx.botNow_().slice(0, 10));
reasons = [];
for (let i = 0; i < 4; i++) reasons.push(start(500 + i, '3.3.3.' + i).limitReason);
ok(reasons.join() === ',,global,global', '全站每天上限：' + reasons.join('|'));

// 測試聊天與 LINE 不套用
ok(ctx.csStart_('T' + '1'.repeat(32), { ip: '1.1.1.1' }).rateLimited === false, '後台測試聊天不受限');
ok(ctx.csStart_('U' + '1'.repeat(32), { ip: '1.1.1.1' }).rateLimited === false, 'LINE 客人不套用網站視窗的上限');

// 亂寫的 IP 不採用
ok(ctx.botGuardIp_('<script>') === '' && ctx.botGuardIp_('1.2.3.4') === '1.2.3.4' && ctx.botGuardIp_('2001:db8::1') === '2001:db8::1', 'IP 格式檢查');

// 留聯繫資料：同一個 IP 每小時次數；客人輸入存成純文字（開頭是 = 不會變公式）
ctx.handleBotSaveSettings({ _user: admin, cs: { guard: { leadPerHour: 2 } } });
const lead = (n, extra) => ctx.csLead_(V(600 + n), Object.assign({ phone: '0912345678', ip: '2.2.2.2' }, extra || {}));
ok(lead(1, { name: '=HYPERLINK("http://evil.example","x")', note: '+cmd' }) === true && lead(2) === true, '前 2 次可以');
let blocked = '';
try { lead(3); } catch (e) { blocked = e.message; }
ok(/太頻繁/.test(blocked), '第 3 次（換了訪客編號）被同一個 IP 擋下');
ok(lead(4, { ip: '2.2.2.3' }) === true, '別的 IP 不受影響');
ok(Array.isArray(ctx.TEXT_COLUMNS.BotLeads) && ctx.TEXT_COLUMNS.BotLeads.indexOf('Name') > -1 && ctx.TEXT_COLUMNS.BotLeads.indexOf('Note') > -1, '名單的姓名 / 備註等欄位是純文字欄位，不會被當成公式');
const saved = ctx.sheetToObjects('BotLeads').rows[0];
ok(String(saved.Name).indexOf('=HYPERLINK') === 0, '內容照存（顯示時由後台跳脫）');

console.log('guard checks passed:', pass);
