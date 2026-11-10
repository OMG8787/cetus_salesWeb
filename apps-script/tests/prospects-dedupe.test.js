// 開發名單：匯入前檢查重複（新的 / 相同 / 不同 / 已是客戶 / 同批重複）、逐列選更新、標出已是客戶（不是陌生開發）
const assert = require('assert');
const path = require('path');
const { makeEnv } = require('./gasmock');
const { ctx } = makeEnv({ files: [path.join(__dirname, '..', 'Code.gs')] });
let pass = 0;
const ok = (c, m) => {
  assert.ok(c, m);
  pass++;
};
const me = { username: 'amy' };
const call = (fn, body) => ctx[fn](Object.assign({ _user: me }, body || {}));

// 客戶資料裡已經有的公司
ctx.appendObjectRow('Customers', { CompanyName: '老客戶精密股份有限公司', TaxId: '11112222' });
ctx.appendObjectRow('Customers', { CompanyName: '台灣名稱客戶有限公司' });

// 先匯入第一份名單
call('handleProspectImport', { source: '第一份', rows: [
  { Name: '均豪精密工業股份有限公司', TaxId: '12345678', Website: 'https://www.gpmcorp.com.tw', Phone: '03-5639999', Email: 'sales@gpmcorp.com.tw' },
  { Name: '福泰益自動化設備股份有限公司', Website: 'https://www.futaiyi.com/tw', Phone: '06-6521616' },
  { Name: '沒有統編工業社', Phone: '04-1234567' },
] });

// ---- 檢查 ----
const second = [
  { Name: '新公司股份有限公司', TaxId: '99998888' }, // 0 新的
  { Name: '均豪精密工業股份有限公司', TaxId: '12345678', Website: 'http://gpmcorp.com.tw/', Phone: '(03)563-9999', Email: 'SALES@gpmcorp.com.tw' }, // 1 相同（網址 / 電話 / 大小寫寫法不同但其實一樣）
  { Name: '福泰益自動化設備股份有限公司', Phone: '06-6520000', Email: 'new@futaiyi.com' }, // 2 不同：電話不同、Email 原本空
  { Name: '老客戶精密股份有限公司', TaxId: '11112222' }, // 3 已是客戶（統編）
  { Name: '臺灣名稱客戶有限公司' }, // 4 已是客戶（名稱：台 / 臺）
  { Name: '新公司股份有限公司', TaxId: '99998888' }, // 5 同批重複
  { Name: '' }, // 6 沒有名稱
  { Name: '沒有統編工業社' }, // 7 相同（用名稱比對，新資料沒填的欄位不算差異）
];
let r = call('handleProspectImportCheck', { rows: second });
const st = r.results.map((x) => x.status);
ok(r.success && st.join() === 'new,same,diff,customer,customer,dup,invalid,same', '每列的狀態：' + st.join());
ok(r.count.new === 1 && r.count.same === 2 && r.count.diff === 1 && r.count.customer === 2 && r.count.dup === 1 && r.count.invalid === 1, '統計數字');
const d = r.results[2];
ok(d.name === '福泰益自動化設備股份有限公司' && d.diffs.length === 2, '不同的那家列出 2 個差異欄位');
const phone = d.diffs.find((x) => x.field === 'Phone');
const mail = d.diffs.find((x) => x.field === 'Email');
ok(phone.label === '電話' && phone.old === '06-6521616' && phone.now === '06-6520000', '差異：電話 舊 → 新');
ok(mail.old === '' && mail.now === 'new@futaiyi.com', '差異：原本空白的 Email');
ok(r.results[3].customer === '老客戶精密股份有限公司' && r.results[4].customer === '台灣名稱客戶有限公司', '已是客戶：附上客戶管理裡的名稱');
ok(r.results[5].of === 0, '同批重複：指出跟第幾列重複');
ok(call('handleProspectQuery', {}).total === 3, '檢查不會寫入任何資料');
ok(call('handleProspectImportCheck', { rows: [] }).success === false, '沒有資料 → 拒絕');

// ---- 依使用者的選擇匯入：相同的不送、不同的選「更新」、已是客戶的略過 ----
r = call('handleProspectImport', { source: '第二份', rows: [second[0], Object.assign({ _update: true }, second[2])] });
ok(r.added === 1 && r.merged === 1, '新增 1 家、更新 1 家');
let f = call('handleProspectQuery', { q: '福泰益' }).rows[0];
ok(f.Phone === '06-6520000' && f.Email === 'new@futaiyi.com', '選了「更新」：有差異的欄位改成新的');
ok(call('handleProspectQuery', {}).total === 4, '總數 4（相同的、已是客戶的都沒新增）');
// 沒選更新（保留原本）時只補空白欄位，不改電話
call('handleProspectImport', { source: '第三份', rows: [{ Name: '福泰益自動化設備股份有限公司', Phone: '06-0000000', Contact: '王經理' }] });
f = call('handleProspectQuery', { q: '福泰益' }).rows[0];
ok(f.Phone === '06-6520000' && f.Contact === '王經理', '沒選更新：電話不動，只補原本空白的聯絡人');

// 沒有統編的資料：匯入也用名稱比對，不會多一筆
r = call('handleProspectImport', { source: '第四份', rows: [{ Name: '沒有統編工業社', Email: 'a@nostax.com.tw' }] });
ok(r.added === 0 && r.merged === 1 && call('handleProspectQuery', {}).total === 4, '同名（沒有統編）→ 併到原本那家');

// ---- 已是客戶的仍加入名單 → 查詢時標出來 ----
call('handleProspectImport', { source: '第二份', rows: [second[3]] });
const q = call('handleProspectQuery', { q: '老客戶' });
ok(q.rows[0].IsCustomer === '老客戶精密股份有限公司', '名單裡已是客戶的公司：IsCustomer 標出客戶名稱');
ok(call('handleProspectQuery', { q: '均豪' }).rows[0].IsCustomer === '', '陌生公司：IsCustomer 空白');
// 工作台的開發名單也有標記
call('handleProspectLogAdd', { key: q.rows[0].Key, row: q.rows[0].RowIndex, method: '電話', content: 'x', nextFollowUp: ctx.todayStr() });
const w = call('handleWorkAgenda', {});
ok(w.prospects.length === 1 && w.prospects[0].IsCustomer === '老客戶精密股份有限公司', '工作台：已是客戶的會標出來（不是陌生開發）');

// 名稱比對鍵
ok(ctx.psNameKey_('台灣 名稱客戶有限公司') === ctx.psNameKey_('臺灣名稱客戶(股)公司') || ctx.psNameKey_('臺灣名稱客戶有限公司') === ctx.psNameKey_('台灣名稱客戶有限公司'), '名稱比對：台 / 臺、空白、字尾');
ok(ctx.permFor_('prospectImportCheck')[1] === 'w', '權限：需要編輯權');

console.log('prospects-dedupe checks passed:', pass);
