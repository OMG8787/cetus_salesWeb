// 名片收件匣：傳名片照片（單張 / 多張）→ 收件匣 → 整批存成客戶與聯絡窗口
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
const call = (fn, body) => ctx[fn](Object.assign({ _user: { username: 'admin1', displayName: 'admin1' } }, body));
const stKey = call('handleBotGenKey', { role: 'staff' }).key;
const api = (op, id, extra) => ctx.handleBotApi(Object.assign({ secret: stKey, op, lineUserId: id }, extra || {}));
call('handleBotSaveStaff', { config: { enabled: true, webEnabled: true } });
const A = 'U' + 'a'.repeat(32), B = 'U' + 'b'.repeat(32), V = 'U' + 'c'.repeat(32);
[A, B, V].forEach((id) => api('start', id));
call('handleBotMemberSave', { lineUserId: A, status: '已開通', role: 'editor', linkedUsername: 'ed' });
call('handleBotMemberSave', { lineUserId: B, status: '已開通', role: 'editor' });
call('handleBotMemberSave', { lineUserId: V, status: '已開通', role: 'viewer' });
const cards = (id, params) => api('call', id, { call: 'cards', params: params || {} });
const stage = (id, ops) => api('stage', id, { ops });
const commit = (id) => api('commit', id, {});

ctx.appendObjectRow('Customers', { CompanyName: '既有科技股份有限公司', Contact: '老王', Category: '一般客戶' });

// ---- 收件匣 ----
let r = api('cards', A, { cards: [
  { name: '王小明', title: '業務經理', company: '甲公司', phone: '0912-345-678', companyPhone: '03-1234567', email: 'ming@a.com', address: '新竹市', taxId: '12345678', website: 'www.a.com', confidence: 'high' },
  { name: '李美麗', title: '工程師', company: '甲公司', phone: '0922-111-222', email: 'li@a.com' },
  { name: '陳大文', company: '既有科技股份有限公司', phone: '0933-000-111', email: 'chen@exist.com' },
  { name: '無公司', phone: '0955-555-555' },
  {},
] });
ok(r.success && r.data.added.length === 4 && r.data.pending === 4, '收下 4 張（空白的那張被丟掉）：' + JSON.stringify(r.data).slice(0, 120));
ok(r.data.added[2].existingCustomer === '既有科技股份有限公司', '提醒：陳大文的公司已經是客戶');
r = api('cards', A, { cards: [{ name: '王小明', company: '甲公司', email: 'ming@a.com' }] });
ok(r.data.added[0].duplicateOf === 1, '收件匣裡重複的名片會提醒是第幾張重複');
// 電話開頭 0 不能掉
ok(ctx.sheetToObjects('BotCards').rows[0].Phone === '0912-345-678', '電話原樣保存');
// 每個人的收件匣各自獨立
ok(cards(B).data.total === 0 && cards(A).data.total === 5, 'B 看不到 A 的收件匣');
// 權限：只能查看的人不能收名片
r = api('cards', V, { cards: [{ name: 'x', company: 'y' }] });
ok(!r.success && /編輯權限/.test(r.message), '查看權限不能登入名片：' + r.message);
ok(cards(V).success === false || cards(V).data.total === 0, '查看權限看不到別人的名片');
// 批次註記
let list = cards(A, { note: '2026 台北自動化展' });
ok(list.data.batchNote === '2026 台北自動化展' && list.data.items.every((c) => c.batch === '2026 台北自動化展'), '設定註記後，收件匣裡待整理的名片都帶上');
r = api('cards', A, { cards: [{ name: '新人', company: '丙公司', email: 'n@c.com' }] });
ok(ctx.sheetToObjects('BotCards').rows.slice(-1)[0].Batch === '2026 台北自動化展', '之後傳的名片也帶註記');
ok(cards(V, { note: 'x' }).success === false, '沒編輯權限不能設註記');

// ---- 丟棄 ----
let st = stage(A, [{ action: 'discardCards', data: { ids: [5] } }]);
ok(st.success && /丟棄 1 張/.test(st.data.summary), '丟棄也要確認：' + (st.data && st.data.summary));
ok(commit(A).success && cards(A, { status: 'discarded' }).data.items.length === 1, '丟棄後狀態是 discarded');

// ---- 整批存入 ----
st = stage(A, [{ action: 'saveCards', data: {} }]);
ok(st.success, '提出整批存入：' + JSON.stringify(st));
const sum = st.data.summary;
ok(/新增客戶 2 間/.test(sum) && /補聯絡窗口 2 位/.test(sum) && /略過 1 張/.test(sum), '摘要：新增 2 間（甲公司、丙公司）、補 2 位（李美麗、陳大文）、略過 1 張：' + sum);
ok(/甲公司/.test(sum) && /李美麗/.test(sum) && /已是客戶/.test(sum) && /沒有公司名稱/.test(sum), '摘要逐張列出');
// 還沒確認 → 不寫入
ok(!ctx.sheetToObjects('Customers').rows.some((c) => c.CompanyName === '甲公司'), '確認前不會寫入客戶');
ok(commit(A).success, '確認');
const cust = ctx.sheetToObjects('Customers').rows.find((c) => c.CompanyName === '甲公司');
ok(cust && cust.Contact === '王小明' && cust.Phone === '0912-345-678' && cust.Email === 'ming@a.com' && cust.CompanyPhone === '03-1234567' && cust.TaxId === '12345678' && cust.Address === '新竹市', '新客戶欄位對應：聯絡人 / 手機 / 公司電話 / 統編 / 地址');
ok(/職稱：業務經理/.test(cust.Notes) && /網站：www\.a\.com/.test(cust.Notes) && /2026 台北自動化展/.test(cust.Notes), '職稱 / 網站 / 展會註記放在備註');
ok(cust.Category === '一般客戶', '預設分類');
const contacts = ctx.sheetToObjects('CustomerContacts').rows;
ok(contacts.some((c) => c.CompanyName === '甲公司' && c.ContactName === '李美麗' && c.Title === '工程師' && c.Email === 'li@a.com'), '同一間公司的第二張名片 → 聯絡窗口');
ok(contacts.some((c) => c.CompanyName === '既有科技股份有限公司' && c.ContactName === '陳大文'), '既有客戶 → 補聯絡窗口，不重複建立客戶');
ok(ctx.sheetToObjects('Customers').rows.filter((c) => /既有科技/.test(c.CompanyName)).length === 1, '沒有重複客戶');
// 收件匣狀態
const left = cards(A, { status: 'pending' }).data.items;
ok(left.length === 1 && left[0].name === '無公司', '略過的還在待整理');
ok(!left.some((c) => c.name === '王小明' && c.status === 'pending' && c.id === 1), '已存入的不在待整理');
const saved = cards(A, { status: 'saved' }).data.items;
ok(saved.length === 4 && /新增客戶/.test(saved[0].result), '已存入的記下結果');
// 再存一次：已存入的不會重複建立（只剩略過的那張）
st = stage(A, [{ action: 'saveCards', data: {} }]);
ok(st.success && /新增客戶 0 間/.test(st.data.summary) && /略過 1 張/.test(st.data.summary), '再提出一次：不會重複建立客戶：' + st.data.summary);
api('cancel', A);

// ---- 修正 OCR 錯誤 / 補公司名稱 ----
const noCo = cards(A).data.items.find((c) => c.name === '無公司').id;
st = stage(A, [{ action: 'saveCards', data: { ids: [noCo], overrides: { [noCo]: { company: '丁公司', name: '無公司先生' } }, category: '機構合作設備商' } }]);
ok(st.success && /新增客戶 丁公司/.test(st.data.summary), '補上公司名稱後可以存入：' + st.data.summary);
ok(commit(A).success, '確認');
const d = ctx.sheetToObjects('Customers').rows.find((c) => c.CompanyName === '丁公司');
ok(d && d.Contact === '無公司先生' && d.Category === '機構合作設備商', '覆寫的欄位與分類生效');
// 只存指定的名片
api('cards', A, { cards: [{ name: '甲', company: '戊公司' }, { name: '乙', company: '己公司' }] });
const only = cards(A).data.items.find((c) => c.name === '甲').id;
st = stage(A, [{ action: 'saveCards', data: { ids: [only] } }]);
ok(commit(A).success && ctx.sheetToObjects('Customers').rows.some((c) => c.CompanyName === '戊公司') && !ctx.sheetToObjects('Customers').rows.some((c) => c.CompanyName === '己公司'), '指定編號只存那一張');
st = stage(A, [{ action: 'discardCards', data: {} }]);
ok(commit(A).success && cards(A).data.total === 0, '收件匣清空');
st = stage(A, [{ action: 'saveCards', data: {} }]);
ok(!st.success && /沒有符合的待整理名片/.test(st.message), '沒有待整理名片 → 提示：' + st.message);

// ---- 權限 / 管理員設定 ----
st = stage(V, [{ action: 'saveCards', data: {} }]);
ok(!st.success, '沒有客戶編輯權限不能存入');
call('handleBotSaveStaff', { config: { writes: ['addMemo'] } });
api('cards', A, { cards: [{ name: 'Z', company: 'Z公司', phone: '0900000000' }] });
st = stage(A, [{ action: 'saveCards', data: {} }]);
ok(!st.success && /沒有開放/.test(st.message), '管理員沒開放這個動作 → 擋下：' + st.message);
call('handleBotSaveStaff', { config: { writes: Object.keys(ctx.BOT_STAFF_WRITES) } });
ok(api('start', A).data.writable.includes('saveCards') && !api('start', V).data.writable.includes('saveCards'), 'writable 清單：編輯者有、查看者沒有');
// 助理紀錄有記
const audit = ctx.sheetToObjects('Memos').rows.filter((m) => m.LinkType === 'staffAudit').map((m) => m.Content).join('\n');
ok(/名片收件匣收下/.test(audit) && /已執行：.*名片整批存入/.test(audit.replace(/\n/g, ' ')), '助理紀錄記下收名片與存入');
console.log('cards checks passed:', pass);
