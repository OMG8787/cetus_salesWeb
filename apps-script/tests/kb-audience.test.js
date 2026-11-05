// 知識庫每一筆可以設定「誰看得到」：對外客服 / 員工助理（可複選，預設都開放）
const assert = require('assert');
const path = require('path');
const { makeEnv } = require('./gasmock');
const { ctx } = makeEnv({ files: [path.join(__dirname, '..', 'Code.gs')], fetch: () => ({ code: 404, body: '' }) });
let pass = 0;
const ok = (c, m) => {
  assert.ok(c, m);
  pass++;
};
const mk = (u, role, perms) => ctx.appendObjectRow('Users', { Username: u, PasswordHash: 'x', Role: role, DisplayName: u, Perms: perms ? JSON.stringify(perms) : '' });
mk('admin1', 'admin');
mk('vw', 'viewer');
mk('botonly', 'limited', { bot: 'edit' });
const call = (fn, body, u) => ctx[fn](Object.assign({ _user: { username: u || 'admin1', displayName: u || 'admin1' } }, body));
const can = (u, a) => {
  try {
    ctx.requirePermission_(a, { username: u });
    return true;
  } catch (e) {
    return false;
  }
};
call('handleBotSaveAi', { models: [{ provider: 'gemini', apiKey: 'GEMINI-KEY-1234', uses: ['all'] }] });
const csKey = call('handleBotGenKey', { role: 'cs' }).key;
const stKey = call('handleBotGenKey', { role: 'staff' }).key;
const cs = (op, extra) => ctx.handleBotApi(Object.assign({ secret: csKey, op, lineUserId: 'U' + 'a'.repeat(32) }, extra || {}));
const S = 'U' + 'b'.repeat(32);
const st = (op, extra) => ctx.handleBotApi(Object.assign({ secret: stKey, op, lineUserId: S }, extra || {}));
call('handleBotSaveStaff', { config: { enabled: true, webEnabled: true } });
st('start');
call('handleBotMemberSave', { lineUserId: S, status: '已開通', role: 'viewer' });
const form = call('handleBotGetSettings', {}).cs;
form.sources.qa = true;
form.sources.docs = true;
call('handleBotSaveSettings', { cs: form });
const embed = ctx.botEmbedCfg_();
const titlesCs = () => cs('csKnowledge').data.map((c) => c.title).sort().join();
const titlesSt = () => st('call', { call: 'kbChunks', params: {} }).data.map((c) => c.title).sort().join();
const vecCs = () => cs('csVectors', { after: 0, limit: 100 }).data.items.map((v) => v.id).sort().join();
const vecSt = () => st('call', { call: 'kbVectors', params: { after: 0, limit: 100 } }).data.items.map((v) => v.id).sort().join();

ok(can('admin1', 'botKbSetAudience') && can('botonly', 'botKbSetAudience') && !can('vw', 'botKbSetAudience'), '設定可見對象需要 BOT 設定的編輯權限');

// ---- 預設：都開放 ----
let r = call('handleBotKbSave', { type: 'qa', question: '都開放', content: 'A' });
ok(r.success, '新增（沒帶 audience）');
ctx.appendObjectRow('BotKnowledge', { ID: 90, Type: 'qa', Title: '舊資料', Question: '舊資料', Content: 'B', IsActive: true }); // 舊資料：沒有 Audience 欄位值
ok(titlesCs() === '舊資料,都開放' && titlesSt() === '舊資料,都開放', '預設：客服與助理都看得到（舊資料也是）');
let list = call('handleBotKbList', {}).items;
ok(JSON.stringify(list.find((x) => x.Title === '都開放').audience) === '["cs","staff"]' && JSON.stringify(list.find((x) => x.ID === 90).audience) === '["cs","staff"]', '列表顯示 audience');

// ---- 複選 ----
const id1 = list.find((x) => x.Title === '都開放').ID;
r = call('handleBotKbSave', { type: 'qa', question: '只給助理', content: 'C', audience: ['staff'] });
const idStaff = r.id;
r = call('handleBotKbSave', { type: 'qa', question: '只給客服', content: 'D', audience: ['cs'] });
const idCs = r.id;
r = call('handleBotKbSave', { type: 'qa', question: '都不開放', content: 'E', audience: [] });
const idNone = r.id;
ok(titlesCs() === '只給客服,舊資料,都開放', '客服：看不到「只給助理」與「都不開放」：' + titlesCs());
ok(titlesSt() === '只給助理,舊資料,都開放', '助理：看不到「只給客服」與「都不開放」：' + titlesSt());
const csDump = JSON.stringify(cs('csKnowledge').data);
ok(!csDump.includes('只給助理') && !csDump.includes('都不開放') && !csDump.includes('"C"'), '客服的回應裡完全沒有不開放的內容');
ok(JSON.stringify(call('handleBotKbList', {}).items.find((x) => x.ID === idStaff).audience) === '["staff"]' && JSON.stringify(call('handleBotKbList', {}).items.find((x) => x.ID === idNone).audience) === '[]', '列表：只助理 / 都不開放');

// ---- 向量也依對象過濾 ----
ctx.botVecUpsert_([id1, 90, idStaff, idCs, idNone].map((i) => ({ id: i, model: embed.key, vec: [1, 0] })));
ok(vecCs() === ['k' + id1, 'k90', 'k' + idCs].sort().join(), '客服只拿得到開放給客服的向量：' + vecCs());
ok(vecSt() === ['k' + id1, 'k90', 'k' + idStaff].sort().join(), '助理只拿得到開放給助理的向量：' + vecSt());

// ---- 修改時沒帶 audience = 不動；帶了才改 ----
const row = call('handleBotKbList', {}).items.find((x) => x.ID === idStaff);
r = call('handleBotKbSave', { type: 'qa', id: idStaff, rowIndex: row.RowIndex, question: '只給助理（改）', content: 'C2' });
ok(r.success && titlesSt().includes('只給助理（改）') && !titlesCs().includes('只給助理'), '修改內容不會改掉可見對象');
r = call('handleBotKbSave', { type: 'qa', id: idStaff, rowIndex: row.RowIndex, question: '只給助理（改）', content: 'C2', audience: ['cs', 'staff'] });
ok(r.success && titlesCs().includes('只給助理（改）'), '改成都開放');

// ---- 批次設定 ----
r = call('handleBotKbSetAudience', { ids: [idStaff, idCs, idNone], audience: ['staff'] });
ok(r.success && r.count === 3 && JSON.stringify(r.audience) === '["staff"]', '批次設定');
ok(!titlesCs().includes('只給客服') && titlesSt().includes('只給客服'), '批次設定後生效');
ok(!call('handleBotKbSetAudience', { ids: [], audience: ['cs'] }).success, '沒選項目會擋');
r = call('handleBotKbSetAudience', { ids: [idStaff], audience: [] });
ok(r.success && !titlesCs().includes('只給助理') && !titlesSt().includes('只給助理'), '批次設成都不開放');
r = call('handleBotKbSetAudience', { ids: [idStaff], audience: ['cs', 'staff', 'hacker'] });
ok(JSON.stringify(r.audience) === '["cs","staff"]', '不合法的對象被濾掉');

// ---- 匯入文件 ----
r = call('handleBotKbImport', { rows: [{ title: '文件段一', content: 'X' }, { title: '文件段二', content: 'Y' }], audience: ['staff'] });
ok(r.success && r.count === 2 && titlesSt().includes('文件段一') && !titlesCs().includes('文件段一'), '匯入文件可以指定可見對象（整份共用）');
r = call('handleBotKbImport', { rows: [{ title: '文件段三', content: 'Z' }] });
ok(titlesCs().includes('文件段三') && titlesSt().includes('文件段三'), '匯入沒指定 = 都開放');

// ---- 預覽 ----
const pv = call('handleBotCsPreview', {});
ok(pv.success && !JSON.stringify(pv).includes('文件段一'), '「預覽客服看得到的資料」也依可見對象');
// 停用仍然優先
const r2 = call('handleBotKbList', {}).items.find((x) => x.ID === id1);
call('handleBotKbSave', { type: 'qa', id: id1, rowIndex: r2.RowIndex, question: '都開放', content: 'A', isActive: false });
ok(!titlesCs().includes('都開放') && !titlesSt().includes('都開放') && !vecCs().includes('k' + id1) && !vecSt().includes('k' + id1), '停用的項目兩邊都看不到');
console.log('kb audience checks passed:', pass);
