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
let mailFail = false;
ctx.GmailApp = { sendEmail: (to, subject, body) => { if (mailFail) throw new Error('quota'); mails.push({ to, subject, body }); } };
const cache = ctx.CacheService.getScriptCache();
const add = (u, role, email, pw) => ctx.appendObjectRow('Users', { Username: u, PasswordHash: ctx.sha256(pw), Role: role, DisplayName: u + '名', Email: email });
add('boss', 'admin', 'boss@example.com', 'bosspw1');
add('boss2', 'admin', 'boss2@example.com', 'bosspw2');
add('amy', 'editor', 'amy@example.com', 'amypass1');
add('noMail', 'editor', '', 'nomail1');
const login = (u, p) => ctx.handleLogin({ username: u, password: p, deviceId: 'D1', deviceLabel: 't' });
const reset = (u) => ctx.handleRequestPasswordReset({ username: u });
const rowOf = (u) => ctx.findUserRow_(u);
const tempFrom = (m) => m.body.match(/\n\n    (\S+)\n\n/)[1];
const clearThrottle = (u) => ['pwr_cool_' + u, 'pwr_hr_' + u, 'pwr_all'].forEach((k) => cache.remove(k));

// ① 有 Email：寄臨時密碼
let r = reset('amy');
ok(r.success && mails.length === 1 && mails[0].to === 'amy@example.com', '臨時密碼寄到帳號登記的 Email');
const temp = tempFrom(mails[0]);
ok(temp.length === 10 && /30 分鐘/.test(mails[0].body), '10 碼臨時密碼，信裡說明 30 分鐘有效');
ok(rowOf('amy').ResetHash && rowOf('amy').ResetHash !== temp, '資料庫只存雜湊，不存明碼');
ok(login('amy', 'amypass1').success, '臨時密碼還沒用之前，原本的密碼仍然可以登入');
ok(!rowOf('amy').ResetHash, '想起密碼登入了 → 臨時密碼作廢');
ok(!login('amy', temp).success, '作廢的臨時密碼不能用');

// ② 臨時密碼登入 → 強制改密碼
clearThrottle('amy');
reset('amy');
const temp2 = tempFrom(mails[mails.length - 1]);
ok(!login('amy', temp2 + 'x').success, '臨時密碼打錯不行');
const lg = login('amy', temp2);
ok(lg.success && lg.mustChange === true, '臨時密碼登入成功，並要求立即改密碼');
let blocked = '';
try { ctx.requirePermission_('getCustomers', { username: 'amy' }); } catch (e) { blocked = e.message; }
ok(/請先更新密碼/.test(blocked), '改密碼之前，伺服器擋掉其他所有動作：' + blocked);
['changePassword', 'getProfile', 'logoutDevice'].forEach((a) => ctx.requirePermission_(a, { username: 'amy' }));
ok(ctx.handleGetProfile({ _user: { username: 'amy' } }).mustChange === true, '個人資料回報必須改密碼');
ok(!ctx.handleChangePassword({ _user: { username: 'amy' }, oldPassword: temp2, newPassword: temp2 }).success, '新密碼不能和臨時密碼一樣');
ok(!ctx.handleChangePassword({ _user: { username: 'amy' }, oldPassword: temp2, newPassword: '123' }).success, '新密碼太短不行');
ok(ctx.handleChangePassword({ _user: { username: 'amy' }, oldPassword: temp2, newPassword: 'MyNewPass9' }).success, '改成自己的密碼');
ctx.requirePermission_('getCustomers', { username: 'amy' });
ok(!login('amy', temp2).success && !login('amy', 'amypass1').success && login('amy', 'MyNewPass9').success && login('amy', 'MyNewPass9').mustChange === false, '臨時密碼只能用一次，舊密碼失效，新密碼可用且不再被要求改');

// ③ 過期的臨時密碼
clearThrottle('amy');
reset('amy');
const temp3 = tempFrom(mails[mails.length - 1]);
ctx.updateRowFields('Users', ctx.findUserRowIndex_('amy'), { ResetExpires: Date.now() - 1000 });
ok(!login('amy', temp3).success, '過期的臨時密碼不能用');

// ④ 沒登記 Email：不寄密碼，通知管理員
const before = mails.length;
r = reset('noMail');
const sent = mails.slice(before);
ok(r.success && sent.length === 2 && sent.map((m) => m.to).sort().join() === 'boss2@example.com,boss@example.com', '沒有 Email → 通知所有有 Email 的管理員');
ok(sent.every((m) => /重設密碼/.test(m.body) && !/臨時密碼是/.test(m.body)), '通知信請管理員驗證身分後重設，信裡沒有任何密碼');
ok(!rowOf('noMail').ResetHash, '沒有產生臨時密碼');
const users = ctx.handleGetUsers({ _user: { username: 'boss' } }).users;
ok(users.find((u) => u.Username === 'noMail').ResetPending === true, '帳號管理看得到「申請重設中」');
ok(users.every((u) => u.ResetHash === undefined && u.PasswordHash === undefined && u.ResetExpires === undefined), '前端拿不到任何雜湊');

// ⑤ 管理員驗證後重設 → 本人登入後強制改密碼
const rs = ctx.handleResetUserPassword({ _user: { username: 'boss' }, rowIndex: ctx.findUserRowIndex_('noMail') });
ok(rs.success && rs.mustChange === true && rs.password, '管理員重設，拿到新密碼親自告知');
ok(!rowOf('noMail').ResetRequestedAt, '申請標記清掉');
ok(login('noMail', rs.password).mustChange === true, '本人用新密碼登入 → 必須改密碼');
ok(ctx.handleChangePassword({ _user: { username: 'noMail' }, oldPassword: rs.password, newPassword: 'noMailNew7' }).success && !rowOf('noMail').MustChange, '改完密碼後解除');
const selfRs = ctx.handleResetUserPassword({ _user: { username: 'boss' }, rowIndex: ctx.findUserRowIndex_('boss'), password: 'bossNew88' });
ok(selfRs.mustChange === false && login('boss', 'bossNew88').mustChange === false, '管理員重設自己的不用再被強制');

// ⑥ 通知對象可以指定
ctx.handleSaveResetSettings({ usernames: ['boss2', 'amy', 'ghost'] });
ok(ctx.handleGetResetSettings({}).selected.join() === 'boss2', '只收管理員、不存在的帳號忽略');
clearThrottle('noMail');
const b2 = mails.length;
reset('noMail');
ok(mails.slice(b2).length === 1 && mails[mails.length - 1].to === 'boss2@example.com', '只通知指定的管理員');

// ⑦ 寄信失敗 → 改走管理員處理，不留臨時密碼
clearThrottle('amy');
mailFail = true;
const f0 = mails.length;
reset('amy');
mailFail = false;
ok(!rowOf('amy').ResetHash && !!rowOf('amy').ResetRequestedAt && mails.length === f0, '寄不出去 → 不留臨時密碼，標記等管理員處理');

// ⑧ 不洩漏帳號是否存在、頻率限制
clearThrottle('x');
const m0 = mails.length;
const g1 = reset('ghost');
ok(g1.success && mails.length === m0, '不存在的帳號不寄信');
clearThrottle('amy');
const g2 = reset('amy');
ok(g1.message === g2.message, '回應和真的帳號一模一樣');
ok(!reset('ghost').success, '1 分鐘內重複申請被擋');
['pwr_cool_z'].forEach((k) => cache.remove(k));
let n = 0;
for (let i = 0; i < 5; i++) {
  cache.remove('pwr_cool_z');
  if (reset('z').success) n++;
}
ok(n === 3, '同一帳號每小時最多 3 次：' + n);
cache.put('pwr_all', '30', 3600);
ok(!reset('someone').success, '全系統每小時上限');
ok(!reset('').success, '沒輸入帳號');

// ⑨ 新增帳號可填 Email
ok(!ctx.handleAddUser({ username: 'bad', email: 'not-an-email', role: 'editor' }).success, 'Email 格式不對不能新增');
ok(ctx.handleAddUser({ username: 'newbie', email: 'n@example.com', role: 'editor' }).success && rowOf('newbie').Email === 'n@example.com', '新增帳號時填的 Email 存起來');
console.log('reset password checks passed:', pass);
