// 結案（取消 / 完成訂單）與客戶公司網址
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
ctx.appendObjectRow('Users', { Username: 'vw', PasswordHash: 'x', Role: 'viewer', DisplayName: '查看' });
const as = (u) => (fn, body) => ctx[fn](Object.assign({ _user: { username: u, displayName: u } }, body));
const admin = as('admin1');
const vw = as('vw');

// ---- 客戶公司網址 ----
let r = admin('handleAddCustomer', { companyName: '甲科技', website: 'www.jia.com.tw' });
ok(r.success, '新增客戶帶網址');
let c = ctx.sheetToObjects('Customers').rows.find((x) => x.CompanyName === '甲科技');
ok(c.Website === 'https://www.jia.com.tw', '沒寫 http 自動補 https://');
ok(!admin('handleAddCustomer', { companyName: '壞網址', website: 'javascript:alert(1)' }).success, '不接受 javascript: 之類的網址');
ok(!admin('handleAddCustomer', { companyName: '壞網址2', website: 'abc' }).success, '不像網址的字串被擋');
ok(admin('handleAddCustomer', { companyName: '沒網址' }).success && ctx.sheetToObjects('Customers').rows.find((x) => x.CompanyName === '沒網址').Website === '', '網址可以不填');
const row = ctx.sheetToObjects('Customers').rows.findIndex((x) => x.CompanyName === '甲科技') + 2;
r = admin('handleUpdateCustomer', { rowIndex: row, companyName: '甲科技', fields: { Website: 'http://old.example.com/about' } });
ok(r.success && r.customer.Website === 'http://old.example.com/about', '編輯網址');
ok(r.changes.some((x) => x.indexOf('公司網址') > -1), '修改紀錄有寫「公司網址」');
ok(!admin('handleUpdateCustomer', { rowIndex: row, companyName: '甲科技', fields: { Website: 'ftp://x.com/a' } }).success, '編輯時也擋掉非 http(s)');

// ---- 結案 ----
function newCase(name, customer) {
  return ctx.handleCreateCase({ _user: { username: 'admin1' }, customerName: customer, softwareName: 'SW', testObject: name, productApplication: 'AOI' }).caseId;
}
const caseA = newCase('A', '甲科技');
const caseB = newCase('B', '甲科技');
const caseC = newCase('C', '甲科技');
const caseOf = (id) => ctx.sheetToObjects('Cases').rows.find((x) => x.CaseID === id);

ok(!admin('handleCloseCase', { caseId: caseA, result: 'won' }).success, '完成訂單沒填金額 → 不行');
ok(!admin('handleCloseCase', { caseId: caseA, result: 'maybe' }).success, '結果只能是取消或完成訂單');
ok(!admin('handleCloseCase', { caseId: 'nope', result: 'cancelled' }).success, '查無案件');
ok(caseOf(caseA).Status !== '已結案', '失敗時案件不會被改');

r = admin('handleCloseCase', { caseId: caseA, result: 'cancelled', note: '客戶預算被砍' });
ok(r.success && caseOf(caseA).Status === '已結案' && caseOf(caseA).CloseResult === '取消' && caseOf(caseA).CloseNote === '客戶預算被砍', '取消結案');
ok(ctx.sheetToObjects('Customers').rows.find((x) => x.CompanyName === '甲科技').HasTransacted !== '是', '取消不會標成已交易');

r = admin('handleCloseCase', { caseId: caseB, result: 'won', amount: '120,000', items: [{ name: 'MV-CA050', quantity: 2, unitPrice: 50000 }, { name: 'LENS-1', quantity: 1, unitPrice: 20000 }] });
ok(r.success && r.amount === 120000 && r.markedTransacted === true, '完成訂單：填金額');
ok(caseOf(caseB).CloseResult === '完成訂單' && Number(caseOf(caseB).CloseAmount) === 120000 && JSON.parse(caseOf(caseB).OrderItems).length === 2, '金額與品項有存');
c = ctx.sheetToObjects('Customers').rows.find((x) => x.CompanyName === '甲科技');
ok(c.HasTransacted === '是' && c.LastTransactionDate === ctx.todayStr(), '客戶自動標成已交易、最近交易日 = 今天');
const logs = ctx.sheetToObjects('ContactLogs').rows.filter((x) => x.CaseID === caseB);
ok(logs.length === 1 && /完成訂單/.test(logs[0].Summary) && /MV-CA050×2/.test(logs[0].Summary), '留下聯繫紀錄（含品項）');

r = admin('handleCloseCase', { caseId: caseC, result: 'won', items: [{ name: 'X', quantity: 3, unitPrice: 1000.5 }] });
ok(r.success && r.amount === 3001.5, '沒填金額但有品項 → 用數量 × 單價加總');

// ---- 權限 ----
ok(ctx.permFor_('closeCase').join() === 'cases,w', '結案權限：案件區塊「編輯」');
let denied = false;
try {
  ctx.requirePermission_('closeCase', { username: 'vw' });
} catch (e) {
  denied = true;
}
ok(denied, '只有查看權限的人不能結案');

console.log('closecase.test.js：' + pass + ' 項通過');
