// 知識庫存取：員工助理可以查全部啟用中的知識庫（含向量）；對外客服只能看到被勾選的知識庫來源，其餘一概看不到
const assert = require('assert');
const path = require('path');
const { makeEnv } = require('./gasmock');
const { ctx } = makeEnv({ files: [path.join(__dirname, '..', 'Code.gs')], fetch: () => ({ code: 404, body: '' }) });
let pass = 0;
const ok = (c, m) => {
  assert.ok(c, m);
  pass++;
};
const mk = (u, role) => ctx.appendObjectRow('Users', { Username: u, PasswordHash: 'x', Role: role, DisplayName: u });
mk('admin1', 'admin');
mk('vw', 'viewer');
const call = (fn, body) => ctx[fn](Object.assign({ _user: { username: 'admin1', displayName: 'admin1' } }, body));
const csKey = call('handleBotGenKey', { role: 'cs' }).key;
const stKey = call('handleBotGenKey', { role: 'staff' }).key;
const cs = (op, extra) => ctx.handleBotApi(Object.assign({ secret: csKey, op, lineUserId: 'U' + 'a'.repeat(32) }, extra || {}));
const st = (op, id, extra) => ctx.handleBotApi(Object.assign({ secret: stKey, op, lineUserId: id }, extra || {}));

// 資料
call('handleBotSaveAi', { models: [{ provider: 'gemini', apiKey: 'GEMINI-KEY-1234', uses: ['all'] }] });
ctx.appendObjectRow('BotKnowledge', { ID: 1, Type: 'qa', Title: '光源', Question: '有光源嗎', Content: '有環形光源', BigCategory: '光源', Topic: '環形', Notes: '內部提示', IsActive: true });
ctx.appendObjectRow('BotKnowledge', { ID: 2, Type: 'doc', Title: '簡介', Content: '公司簡介內容', IsActive: true });
ctx.appendObjectRow('BotKnowledge', { ID: 3, Type: 'qa', Title: '停用的', Question: '停用', Content: '不該出現', IsActive: false });
ctx.appendObjectRow('Products', { InternalModel: 'ACA2440', Category: '相機', Supplier: '秘密供應商', RefPrice: 15000, Notes: '內部備註' });
ctx.appendObjectRow('Customers', { CompanyName: '機密客戶公司', Phone: '0912345678' });
const form = call('handleBotGetSettings', {}).cs;
form.brandInfo = '鑫堡是一家 AOI 公司。';
form.sources.qa = false;
form.sources.docs = false;
form.sources.brand = false;
form.sources.products = false;
call('handleBotSaveSettings', { cs: form });
const embed = ctx.botEmbedCfg_();
ctx.botVecUpsert_([{ id: 1, model: embed.key, vec: [0.5, 0.5] }, { id: 2, model: embed.key, vec: [1, 0] }, { id: 3, model: embed.key, vec: [0, 1] }]);

// ---- 對外客服：沒勾的來源一律看不到 ----
let r = cs('csKnowledge');
ok(r.success && r.data.length === 0, '客服來源全部沒勾 → 什麼都看不到');
form.sources.qa = true;
call('handleBotSaveSettings', { cs: form });
r = cs('csKnowledge');
const dump = JSON.stringify(r.data);
ok(r.data.length === 1 && r.data[0].title === '光源', '只勾常見問答 → 只有常見問答（沒有文件 / 公司資訊 / 產品）：' + r.data.length);
for (const secret of ['公司簡介內容', '不該出現', '鑫堡是一家', 'ACA2440', '秘密供應商', '15000', '內部備註', '機密客戶', '0912345678']) ok(!dump.includes(secret), '客服看不到：' + secret);
ok(!cs('call', { call: 'kbChunks', params: {} }).success && cs('call', { call: 'kbChunks', params: {} }).code === 'BOT_AUTH', '客服金鑰不能用員工助理的知識庫查詢');
ok(!cs('call', { call: 'customers', params: {} }).success && !cs('kbChunks').success, '客服金鑰也不能查客戶或呼叫其他操作');

// ---- 員工助理：全部啟用中的知識庫（不受客服勾選限制）----
st('start', 'U' + 'b'.repeat(32));
call('handleBotSaveStaff', { config: { enabled: true, webEnabled: true } });
const S1 = 'U' + 'b'.repeat(32);
const S2 = 'U' + 'c'.repeat(32);
st('start', S2);
call('handleBotMemberSave', { lineUserId: S1, status: '已開通', role: 'viewer' });
call('handleBotMemberSave', { lineUserId: S2, status: '待開通', role: 'viewer' });
r = st('call', S1, { call: 'kbChunks', params: {} });
const titles = r.success ? r.data.map((c) => c.title) : [];
ok(r.success && titles.includes('光源') && titles.includes('簡介') && r.data.some((c) => c.source === '公司資訊' && c.text.includes('鑫堡')), '員工助理看得到常見問答、文件、公司資訊（客服沒勾也一樣）');
ok(!JSON.stringify(r.data).includes('不該出現') && !titles.includes('停用的'), '停用的項目不會出現');
ok(r.data.find((c) => c.title === '光源').category === '光源' && r.data.find((c) => c.title === '光源').notes === '內部提示', '含大分類 / 主題 / 備註（助理看得到分流資訊）');
ok(!JSON.stringify(r.data).match(/ACA2440|秘密供應商|15000|機密客戶/), '知識庫工具不含產品底價、供應商或客戶資料');
r = st('call', S1, { call: 'kbVectors', params: { after: 0, limit: 300 } });
ok(r.success && r.data.total === 2 && r.data.items.map((x) => x.id).sort().join() === 'k1,k2', '向量：只回傳啟用中項目的向量（停用的不回傳）：' + JSON.stringify(r.data && r.data.items && r.data.items.map((x) => x.id)));
ok(r.data.items.every((x) => Array.isArray(x.v) && x.v.length === 2), '向量內容可取得');
r = st('call', S1, { call: 'kbVectors', params: { after: 1, limit: 1 } });
ok(r.success && r.data.items.length === 1 && r.data.next === 2, '向量分頁');
ok(!st('call', S2, { call: 'kbChunks', params: {} }).success, '還沒開通的帳號不能查知識庫');
ok(!st('call', 'U' + 'd'.repeat(32), { call: 'kbChunks', params: {} }).success, '沒登記的帳號不能查知識庫');
const start = st('start', S1).data;
ok(start.search && start.search.mode === 'vector' && start.embedAi && start.embedAi.provider === 'gemini', '員工助理 start 帶搜尋設定與向量模型（跟客服同一套檢索）');
// 查看者、只有部分權限的人也能查知識庫（知識庫是客人本來就看得到的內容）
ctx.appendObjectRow('BotMembers', { LineUserId: 'U' + 'e'.repeat(32), DisplayName: '產品員', Status: '已開通', Role: 'limited', Perms: JSON.stringify({ products: 'view' }), IsFollowing: true });
ok(st('call', 'U' + 'e'.repeat(32), { call: 'kbChunks', params: {} }).success, '只有產品權限的成員也能查知識庫');
console.log('kb access checks passed:', pass);
