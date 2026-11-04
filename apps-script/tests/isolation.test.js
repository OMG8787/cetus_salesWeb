const assert = require('assert');
const path = require('path');
const { makeEnv } = require('./gasmock');
const base = path.join(__dirname, '..') + '/';
const { ctx, props } = makeEnv({ files: [path.join(__dirname, '..', 'Code.gs')], fetch: () => ({ code: 404, body: '' }) });
let pass = 0;
const ok = (c, m) => {
  assert.ok(c, m);
  pass++;
};
const mk = (u, role, perms) => ctx.appendObjectRow('Users', { Username: u, PasswordHash: 'x', Role: role, DisplayName: u, Perms: perms ? JSON.stringify(perms) : '' });
mk('admin1', 'admin');
mk('ed', 'editor');
mk('prodonly', 'limited', { products: 'edit' });
const call = (fn, body, u) => ctx[fn](Object.assign({ _user: { username: u || 'admin1', displayName: u || 'admin1' } }, body));

// ---------- 金鑰分開 ----------
let csKey = call('handleBotGenKey', { role: 'cs' }).key;
let stKey = call('handleBotGenKey', { role: 'staff' }).key;
ok(csKey && stKey && csKey !== stKey, '兩把金鑰不同');
const U = 'U' + 'a'.repeat(32), V = 'V' + 'b'.repeat(32), W = 'W' + 'c'.repeat(32), T = 'T' + 'd'.repeat(32);
const api = (key, op, id, extra) => ctx.handleBotApi(Object.assign({ secret: key, op, lineUserId: id }, extra || {}));
ok(api(csKey, 'csStart', U).success && api(csKey, 'csKnowledge').success, '客服金鑰可做客服操作');
for (const op of ['start', 'call', 'stage', 'commit', 'memory', 'remember']) {
  const r = api(csKey, op, U, { call: 'customers' });
  ok(!r.success && r.code === 'BOT_AUTH' && r.message.includes('員工助理'), '客服金鑰不能呼叫員工助理的 ' + op);
}
ok(api(csKey, 'pushTargets').code === 'BOT_AUTH', '客服金鑰不能取早報名單');
for (const op of ['csStart', 'csKnowledge', 'csWidget', 'csThread', 'csHandoff']) {
  const r = api(stKey, op, V);
  ok(!r.success && r.code === 'BOT_AUTH' && r.message.includes('客服機器人'), '員工金鑰不能呼叫客服的 ' + op);
}
ok(api(stKey, 'start', U).success, '員工金鑰可做員工助理操作');
ok(!api(csKey, 'csStart', W).success && !api(csKey, 'csStart', 'x').success, '客服操作不接受 W 編號');
ok(api(csKey, 'csStart', T).success && api(csKey, 'csStart', V).success, '客服接受 U / V / T');
ok(!api(stKey, 'start', V).success && !api(stKey, 'start', T).success && api(stKey, 'start', W).success === true, '員工助理接受 U / W，不接受 V / T');
ok(api('wrong', 'csStart', U).code === 'BOT_AUTH', '錯誤金鑰');
let st = call('handleBotGetSettings', {});
ok(st.keys.cs.has && st.keys.staff.has && !st.keys.cs.shared && !st.keys.staff.shared && st.keys.cs.hint !== st.keys.staff.hint, '設定頁回報兩把金鑰');
ok(call('handleBotRevealKey', { role: 'staff' }).key === stKey && call('handleBotRevealKey', {}).key === csKey, '各自顯示自己的金鑰');
const t = call('handleBotTestToken', {});
ok(!t.success, '測試聊天需要機器人網址（簽章用客服金鑰）');

// ---------- 舊版共用金鑰 ----------
props['BOT_CS_SECRET'] = undefined; delete props['BOT_CS_SECRET']; delete props['BOT_STAFF_SECRET'];
props['BOT_SECRET'] = 'legacy-shared-key';
ok(api('legacy-shared-key', 'csStart', U).success && api('legacy-shared-key', 'start', U).success, '舊版共用金鑰兩邊都能用（相容）');
st = call('handleBotGetSettings', {});
ok(st.keys.cs.shared && st.keys.staff.shared, '提示舊版共用金鑰');
const newCs = call('handleBotGenKey', { role: 'cs' }).key;
ok(api(newCs, 'csStart', U).success && !api(newCs, 'start', U).success, '重新產生客服金鑰後：新金鑰只能客服');
ok(!api('legacy-shared-key', 'csStart', U).success && api('legacy-shared-key', 'start', U).success, '舊金鑰變成只剩員工助理可用');
ok(!props['BOT_SECRET'], '舊版金鑰已拆開移除');
// 同一把金鑰不會同時存在兩個角色（重新產生員工金鑰）
const newSt = call('handleBotGenKey', { role: 'staff' }).key; csKey = newCs; stKey = newSt;
ok(!api('legacy-shared-key', 'start', U).success && api(newSt, 'start', U).success, '員工金鑰換新');

// ---------- 客服可見資料 ----------
ctx.appendObjectRow('Products', { InternalModel: 'ACA2440', SupplierModel: 'Basler ace', Supplier: '秘密供應商X', Category: '相機', Brand: 'Basler', Resolution: '5MP', Interface: 'GigE', RefPrice: 15000, Notes: '內部備註：毛利很高' });
ctx.appendObjectRow('Products', { InternalModel: 'LENS25', SupplierModel: 'Computar', Supplier: '秘密供應商Y', Category: '鏡頭', Brand: 'Computar', FocalLength: '25', RefPrice: 3000, Notes: '內部備註2' });
ctx.appendObjectRow('Customers', { CompanyName: '機密客戶公司', Contact: '機密聯絡人', Phone: '0912345678' });
ctx.appendObjectRow('Cases', { CaseID: 'SECRET-CASE', CustomerName: '機密客戶公司', Status: '需求單已發出' });
ctx.appendObjectRow('BotKnowledge', { ID: 1, Type: 'qa', Title: '光源', Question: '有光源嗎', Content: '有', IsActive: true });
ctx.appendObjectRow('BotKnowledge', { ID: 2, Type: 'doc', Title: '簡介', Content: '公司簡介內容', IsActive: true });
const form = call('handleBotGetSettings', {}).cs;
form.sources.products = true;
call('handleBotSaveSettings', { cs: form });
const all = JSON.stringify(api(csKey, 'csKnowledge').data);
ok(all.includes('ACA2440') && all.includes('5MP') && all.includes('Basler ace'), '預設：產品型號與規格可見');
for (const secret of ['秘密供應商', '15000', '3000', '內部備註', '毛利', '機密客戶', '機密聯絡人', '0912345678', 'SECRET-CASE']) ok(!all.includes(secret), '客服知識庫不含：' + secret);

// 勾選欄位
form.sources.productFields = ['Category', 'Resolution', 'RefPrice', 'Supplier', 'Notes', 'Phone'];
call('handleBotSaveSettings', { cs: form });
let s2 = call('handleBotGetSettings', {}).cs.sources;
ok(JSON.stringify(s2.productFields) === JSON.stringify(['Category', 'Resolution']), '欄位白名單：RefPrice / Supplier / Notes 等無法被勾選：' + JSON.stringify(s2.productFields));
let k2 = JSON.stringify(api(csKey, 'csKnowledge').data);
ok(k2.includes('5MP') && k2.includes('類別：相機') && !k2.includes('品牌：') && !k2.includes('Basler ace') && !k2.includes('GigE'), '只顯示勾選的欄位');
// 類別篩選
form.sources.productFields = ['Category'];
form.sources.productCategories = '鏡頭、周邊';
call('handleBotSaveSettings', { cs: form });
k2 = JSON.stringify(api(csKey, 'csKnowledge').data);
ok(k2.includes('LENS25') && !k2.includes('ACA2440'), '只開放指定類別');
// 文件 / 常見問題分開
form.sources.docs = false;
call('handleBotSaveSettings', { cs: form });
k2 = JSON.stringify(api(csKey, 'csKnowledge').data);
ok(k2.includes('有光源嗎') && !k2.includes('公司簡介內容'), '文件可單獨關閉');
form.sources.qa = false; form.sources.docs = true;
call('handleBotSaveSettings', { cs: form });
k2 = JSON.stringify(api(csKey, 'csKnowledge').data);
ok(!k2.includes('有光源嗎') && k2.includes('公司簡介內容'), '常見問題可單獨關閉');
// 預覽
const pv = call('handleBotCsPreview', {});
ok(pv.success && pv.total >= 2 && pv.counts['產品'] === 1 && pv.sampleProducts.length === 1 && pv.blocked.some((b) => b.includes('底價')) && pv.blocked.some((b) => b.includes('客戶')), '預覽');
ok(!JSON.stringify(pv).includes('秘密供應商') && !JSON.stringify(pv).includes('15000'), '預覽也不含內部資料');
ok(ctx.botPerms_().botCsPreview[1] === 'r', '預覽權限');

// ---------- 員工助理的上限 ----------
call('handleBotSaveStaff', { config: { enabled: true, webEnabled: true } });
ok(call('handleBotMemberSave', { lineUserId: U, status: '已開通', role: 'editor' }).success, '開通員工');
const call1 = (c, p) => api(stKey = newSt, 'call', U, { call: c, params: p || {} });
const stage = (ops) => api(newSt, 'stage', U, { ops });
ok(call1('customers').success && call1('products', { keyword: 'aca' }).success, '上限預設不限制');
let pr = call1('products', { keyword: 'aca' }).data.items[0];
ok(pr.RefPrice == 15000 && pr.Supplier, '預設助理看得到底價（有權限者）');
call('handleBotSaveStaff', { config: { hidePrice: true } });
pr = call1('products', { keyword: 'aca' }).data.items[0];
ok(pr.RefPrice === undefined && pr.Supplier === undefined, '隱藏底價與供應商');
call('handleBotSaveStaff', { config: { ceiling: { customers: 'none', cases: 'view', products: 'edit', bogus: 'edit' } } });
ok(call('handleBotGetStaff', {}).config.ceiling.customers === 'none' && call('handleBotGetStaff', {}).config.ceiling.bogus === undefined, '上限儲存並整理');
ok(!call1('customers').success && call1('customers').message.includes('沒有「客戶'), '上限 none：不能查客戶');
ok(!call1('customer', { companyName: '機密客戶公司' }).success && !call1('followups').success, '上限 none：追蹤也不能查');
ok(call1('cases').success, '案件仍可查看');
const w1 = stage([{ action: 'updateCaseStatus', data: { caseId: 'SECRET-CASE', status: '已結案' } }]);
ok(!w1.success && w1.message.includes('編輯權限'), '上限 view：不能改案件');
const ov = call1('overview').data;
ok(!ov.followups && ov.openCases, '總覽依上限省略');
ok(api(newSt, 'start', U).data.blocks.customers === 'none' && api(newSt, 'start', U).data.writable.indexOf('logFollowUp') < 0, 'start 帶回的權限已套用上限');
// 行事曆：兩個都 none 才擋
call('handleBotSaveStaff', { config: { ceiling: { customers: 'none', cases: 'none', products: 'edit' } } });
ok(!call1('calendar').success && call1('calendar').message.includes('行事曆'), '客戶、案件都沒權限 → 不能看行事曆');
ok(!call1('overview').data.events && !call1('overview').data.followups, '總覽沒有行程');
call('handleBotSaveStaff', { config: { ceiling: { customers: 'edit', cases: 'edit', products: 'edit' } } });
// 寫入動作白名單
call('handleBotSaveStaff', { config: { writes: ['addMemo'] } });
ok(api(newSt, 'start', U).data.writable.join() === 'addMemo', '只開放備忘錄');
const w2 = stage([{ action: 'addCustomer', data: { companyName: '新客戶' } }]);
ok(!w2.success && w2.message.includes('沒有開放'), '未開放的寫入動作被擋');
ok(stage([{ action: 'addMemo', data: { title: 'x' } }]).success, '開放的可以');
// stage 之後管理員關掉 → commit 當下再擋
call('handleBotSaveStaff', { config: { writes: [] } });
ok(!api(newSt, 'commit', U, {}).success, '管理員中途關閉 → 確認時再次被擋');
call('handleBotSaveStaff', { config: { writes: Object.keys(ctx.BOT_STAFF_WRITES) } });
// 成員只有產品權限 → 行事曆擋
ctx.appendObjectRow('BotMembers', { LineUserId: 'U' + '9'.repeat(32), DisplayName: '產品員', Status: '已開通', Role: 'limited', Perms: JSON.stringify({ products: 'edit' }), IsFollowing: true });
const P = 'U' + '9'.repeat(32);
ok(!api(newSt, 'call', P, { call: 'calendar', params: {} }).success, '只有產品權限的成員看不到行事曆');
console.log('isolation checks passed:', pass);
