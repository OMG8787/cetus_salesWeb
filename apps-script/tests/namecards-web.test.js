// 名片客戶專區（網頁）：列表 / 編輯 / 登入成客戶 / 刪除
const assert = require('assert');
const path = require('path');
const { makeEnv } = require('./gasmock');
const { ctx } = makeEnv({ files: [path.join(__dirname, '..', 'Code.gs')], fetch: () => ({ code: 404, body: '' }) });
let pass = 0;
const ok = (c, m) => {
  assert.ok(c, m);
  pass++;
};
ctx.appendObjectRow('Users', { Username: 'admin1', PasswordHash: 'x', Role: 'admin', DisplayName: 'admin1' });
ctx.appendObjectRow('Users', { Username: 'ed', PasswordHash: 'x', Role: 'editor', DisplayName: '編輯' });
ctx.appendObjectRow('Users', { Username: 'vw', PasswordHash: 'x', Role: 'viewer', DisplayName: '查看' });
const as = (u) => (fn, body) => ctx[fn](Object.assign({ _user: { username: u, displayName: u } }, body));
const admin = as('admin1');
const ed = as('ed');
const vw = as('vw');
const stKey = admin('handleBotGenKey', { role: 'staff' }).key;
const api = (op, id, extra) => ctx.handleBotApi(Object.assign({ secret: stKey, op, lineUserId: id }, extra || {}));
admin('handleBotSaveStaff', { config: { enabled: true, webEnabled: true } });
const A = 'U' + 'a'.repeat(32);
api('start', A);
admin('handleBotMemberSave', { lineUserId: A, status: '已開通', role: 'editor', linkedUsername: 'ed' });
ctx.appendObjectRow('Customers', { CompanyName: '既有科技股份有限公司', Contact: '老王', Category: '一般客戶' });

api('cards', A, { cards: [
  { name: '王小明', title: '經理', company: '新星科技股份有限公司', phone: '0912-345-678', email: 'ming@star.com', taxId: '12345678' },
  { name: '李大華', company: '既有科技股份有限公司', phone: '0922-111-222' },
  { name: '無公司', phone: '0933-000-111' },
  { name: '要刪的', company: '刪除公司' },
] });

// ---- 列表 ----
let r = ed('handleGetNameCards', {});
ok(r.success && r.pending === 4 && r.cards.length === 4, '列出自己的 4 張待處理名片');
const byName = (n) => r.cards.find((c) => c.name === n);
ok(byName('王小明').title === '經理' && byName('王小明').email === 'ming@star.com' && byName('王小明').taxId === '12345678', '欄位完整');
ok(byName('李大華').existingCustomer === '既有科技股份有限公司' && !byName('王小明').existingCustomer, '公司已是客戶會標出來');
ok(admin('handleGetNameCards', {}).cards.length === 0, '別人的帳號看不到');

// ---- 編輯 ----
const wang = byName('王小明').id;
let e = ed('handleCardUpdate', { id: wang, fields: { name: '王小民', phone: '0912-000-111', email: 'Min@Star.com' } });
ok(e.success, '編輯成功');
r = ed('handleGetNameCards', {});
ok(byName('王小明') === undefined && r.cards.find((c) => c.id === wang).name === '王小民' && r.cards.find((c) => c.id === wang).email === 'min@star.com', '姓名 / 電話修正、Email 轉小寫');
ok(!admin('handleCardUpdate', { id: wang, fields: { name: 'x' } }).success, '不能改別人的名片');
ok(!ed('handleCardUpdate', { id: wang, fields: { name: '', company: '', phone: '', email: '' } }).success, '不能把四項重要資料全清空');
ok(ed('handleCardUpdate', { id: wang, fields: { name: 'y'.repeat(500) } }).success && ed('handleGetNameCards', {}).cards.find((c) => c.id === wang).name.length === 80, '欄位長度被限制');
ed('handleCardUpdate', { id: wang, fields: { name: '王小民' } });

// ---- 登入成客戶 ----
let t = ed('handleCardToCustomer', { id: wang });
ok(t.success && t.kind === 'newCustomer' && t.company === '新星科技股份有限公司', '公司不存在 → 新增客戶');
const cust = ctx.sheetToObjects('Customers').rows.find((c) => c.CompanyName === '新星科技股份有限公司');
ok(cust && cust.Contact === '王小民' && cust.Phone === '0912-000-111' && cust.TaxId === '12345678', '客戶資料帶的是修正後的名片內容');
ok(!ed('handleCardToCustomer', { id: wang }).success, '同一張不能重複登入');
r = ed('handleGetNameCards', {});
ok(r.saved === 1 && r.cards.find((c) => c.id === wang).status === 'saved', '已登入的仍留在專區，標示已登入');

const li = r.cards.find((c) => c.name === '李大華').id;
t = ed('handleCardToCustomer', { id: li });
ok(t.success && t.kind === 'addContact', '公司已是客戶 → 新增聯絡窗口');
ok(ctx.sheetToObjects('CustomerContacts').rows.some((c) => c.CompanyName === '既有科技股份有限公司' && c.ContactName === '李大華'), '聯絡窗口有寫入');

const noco = r.cards.find((c) => c.name === '無公司').id;
t = ed('handleCardToCustomer', { id: noco });
ok(!t.success && t.needCompany === true, '沒有公司名稱 → 要求補公司');
t = ed('handleCardToCustomer', { id: noco, company: '補名科技有限公司' });
ok(t.success && t.kind === 'newCustomer' && t.company === '補名科技有限公司', '補上公司名稱後可登入');

// ---- 刪除 ----
const del = r.cards.find((c) => c.name === '要刪的').id;
ok(!admin('handleCardDelete', { id: del }).success, '不能刪別人的');
ok(ed('handleCardDelete', { id: del }).success && !ed('handleGetNameCards', {}).cards.some((c) => c.id === del), '刪除後不在專區');
ok(!ed('handleCardDelete', { id: del }).success, '重複刪除會說找不到');

// ---- 權限 ----
ok(ctx.permFor_('getNameCards').join() === 'customers,r' && ctx.permFor_('cardUpdate').join() === 'customers,w' && ctx.permFor_('cardToCustomer').join() === 'customers,w' && ctx.permFor_('cardDelete').join() === 'customers,w', '權限登記');
ok(ctx.botRoutes_().cardToCustomer && ctx.botRoutes_().getNameCards, '路由登記');

// ---- 依公司彙整（全公司的名片，看誰接觸過）----
const B = 'U' + 'b'.repeat(32);
const C = 'U' + 'c'.repeat(32);
api('start', B, { displayName: '管理員LINE' });
admin('handleBotMemberSave', { lineUserId: B, status: '已開通', role: 'editor', linkedUsername: 'admin1' });
api('start', C, { displayName: '小美' });
admin('handleBotMemberSave', { lineUserId: C, status: '已開通', role: 'editor' });
api('cards', B, { cards: [{ name: '張副總', title: '副總', company: '新星科技公司', email: 'chang@star.com' }, { name: '丟掉的', company: '新星科技股份有限公司' }] });
api('cards', C, { cards: [{ name: '王小明', company: '新星科技', phone: '0912-345-678' }] });
const adminCards = admin('handleGetNameCards', {}).cards;
admin('handleCardDelete', { id: adminCards.find((c) => c.name === '丟掉的').id });
ok(ctx.permFor_('cardCompanies').join() === 'customers,r' && ctx.botRoutes_().cardCompanies, '彙整：權限與路由');
r = ed('handleCardCompanies', {});
const star = r.companies.find((g) => g.key === ctx.psNameKey_('新星科技'));
ok(r.success && star && star.count === 3, '「新星科技股份有限公司 / 新星科技公司 / 新星科技」併成同一家，共 3 張（刪掉的不算）');
ok(star.company === '新星科技股份有限公司' && star.names.length === 3, '顯示最常出現的寫法，也列出所有寫法');
ok(star.collectors.length === 3 && star.collectors.some((x) => x.name === '編輯' && x.mine) && star.collectors.some((x) => x.name === 'admin1') && star.collectors.some((x) => x.name === '小美（LINE）'), '列出是哪些同事收到名片（沒綁網站帳號的顯示 LINE 名稱）');
ok(star.people.find((x) => x.name === '張副總').ownerName === 'admin1' && !star.people.find((x) => x.name === '張副總').mine && star.people.find((x) => x.owner === 'ed').mine && star.people.find((x) => x.owner === C).ownerName === '小美（LINE）', '每位聯絡人標出收到的同事、是不是自己的');
ok(!r.companies.some((g) => /無公司/.test(g.company)), '沒有公司名稱的名片不列入');
const exist = r.companies.find((g) => g.company === '既有科技股份有限公司');
ok(exist && exist.customer === '既有科技股份有限公司', '已是客戶的公司會標出來');
r = vw('handleCardCompanies', { company: '新星科技有限公司' });
ok(r.companies.length === 1 && r.companies[0].count === 3, '用公司名稱查一家（寫法不同也找得到）；查看權限也能看');
ok(ed('handleCardCompanies', { q: '張副總' }).companies.length === 1 && ed('handleCardCompanies', { q: '查無此人' }).companies.length === 0, '關鍵字搜尋（姓名 / 同事 / 展會）');
ctx.handleProspectImport({ _user: { username: 'ed' }, source: 't', rows: [{ Name: '新星科技股份有限公司', TaxId: '12345678' }] });
ok(ed('handleCardCompanies', { company: '新星科技' }).companies[0].prospect === '新星科技股份有限公司', '在開發名單裡的公司會標出來');

console.log('namecards-web.test.js：' + pass + ' 項通過');
