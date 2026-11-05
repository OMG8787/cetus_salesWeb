// 知識庫版本號（機器人比對版本就能馬上更新快取）、回覆前檢查的設定與「回覆檢查」AI
const assert = require('assert');
const path = require('path');
const { makeEnv } = require('./gasmock');
const { ctx, props } = makeEnv({
  files: [path.join(__dirname, '..', 'Code.gs')],
  fetch: (url, o) => {
    if (/batchEmbedContents/.test(url)) return { code: 200, body: { embeddings: JSON.parse(o.payload).requests.map(() => ({ values: new Array(256).fill(0).map((_, i) => (i === 0 ? 1 : 0)) })) } };
    return { code: 404, body: '' };
  },
});
let pass = 0;
const ok = (c, m) => {
  assert.ok(c, m);
  pass++;
};
ctx.appendObjectRow('Users', { Username: 'admin1', PasswordHash: 'x', Role: 'admin', DisplayName: 'admin1' });
const call = (fn, body) => ctx[fn](Object.assign({ _user: { username: 'admin1', displayName: 'admin1' } }, body));
const M = (provider, key, extra) => Object.assign({ provider, apiKey: key, model: '', endpoint: '' }, extra || {});
call('handleBotSaveAi', { models: [M('gemini', 'KEY-A-1111', { name: '主要', uses: ['all'] })] });
const csKey = call('handleBotGenKey', { role: 'cs' }).key;
const stKey = call('handleBotGenKey', { role: 'staff' }).key;
const cs = () => ctx.handleBotApi({ secret: csKey, op: 'csStart', lineUserId: 'U' + 'a'.repeat(32) }).data;

// ---- 版本號：任何會改變機器人看到的知識的操作都會換 ----
ok(ctx.botKbVer_() !== undefined && typeof ctx.botKbVer_() === 'string', '有版本號');
const changed = (label, fn) => {
  props.BOT_KB_VER = 'old';
  fn();
  ok(props.BOT_KB_VER !== 'old' && ctx.botKbVer_() === props.BOT_KB_VER, label + ' 會換版本號');
};
let id;
changed('新增常見問題', () => {
  id = call('handleBotKbSave', { type: 'qa', question: '問', content: '答' }).id;
});
changed('修改常見問題', () => {
  const row = call('handleBotKbList', {}).items.find((x) => x.ID === id);
  call('handleBotKbSave', { type: 'qa', id, rowIndex: row.RowIndex, question: '問', content: '答2' });
});
let key;
changed('儲存文件', () => {
  key = call('handleBotKbDocSave', { title: '文件', chunks: [{ content: 'x' }, { content: 'y' }] }).key;
});
changed('匯入文件', () => call('handleBotKbImport', { rows: [{ title: 't', content: 'c' }] }));
changed('批次設定可見對象', () => call('handleBotKbSetAudience', { ids: [id], audience: ['staff'] }));
changed('算向量', () => call('handleBotKbEmbed', { force: true }));
changed('儲存客服設定（可用來源有變）', () => call('handleBotSaveSettings', { cs: call('handleBotGetSettings', {}).cs }));
changed('儲存 AI 設定（向量用哪組可能變）', () => call('handleBotSaveAi', { models: [M('gemini', '', { name: '主要', uses: ['all'] })] }));
changed('刪除知識', () => call('handleBotKbDelete', { ids: [id] }));
// 沒有改變知識的查詢不會換
props.BOT_KB_VER = 'keep';
call('handleBotKbList', {});
call('handleBotGetSettings', {});
cs();
ok(props.BOT_KB_VER === 'keep', '只是讀取不會換版本號');

// ---- 機器人拿得到版本號 ----
props.BOT_KB_VER = 'v-777';
ok(cs().kbVer === 'v-777', '客服 start 帶回版本號');
const S = 'U' + 'b'.repeat(32);
call('handleBotSaveStaff', { config: { enabled: true, webEnabled: true } });
ctx.handleBotApi({ secret: stKey, op: 'start', lineUserId: S });
call('handleBotMemberSave', { lineUserId: S, status: '已開通', role: 'viewer' });
props.BOT_KB_VER = 'v-888';
ok(ctx.handleBotApi({ secret: stKey, op: 'start', lineUserId: S }).data.kbVer === 'v-888', '員工助理 start 也帶回版本號');

// ---- 回覆前檢查：預設關閉、可從總覽開關、其他設定存檔不會洗掉 ----
ok(cs().groundCheck === false && call('handleBotGetSettings', {}).cs.groundCheck === false, '預設關閉');
call('handleBotSaveSettings', { groundCheck: true });
ok(cs().groundCheck === true && call('handleBotGetSettings', {}).cs.groundCheck === true, '總覽開關打開（只送這個欄位，不會洗掉其他客服設定）');
const form = call('handleBotGetSettings', {}).cs;
form.welcome = '歡迎光臨';
delete form.groundCheck;
call('handleBotSaveSettings', { cs: form });
ok(cs().groundCheck === true && cs().welcome === '歡迎光臨', '客服設定表單存檔（沒帶 groundCheck）不會把它關掉');
call('handleBotSaveSettings', { groundCheck: true, cs: Object.assign({}, form, { groundCheck: false }) });
ok(cs().groundCheck === false, '整份表單明確帶 false 才會關');
call('handleBotSaveSettings', { groundCheck: true });
ok(cs().groundCheck === true && cs().welcome === '歡迎光臨', '只改開關，原本的設定（歡迎詞）保留');
call('handleBotSaveSettings', { groundCheck: false });
ok(cs().groundCheck === false, '關閉');

// ---- 「回覆檢查」AI：沒指定 = 用客服那一組（checkAi 為 null）----
ok(cs().checkAi === null, '沒指定回覆檢查用的 AI → checkAi = null（機器人用客服那一組）');
ok(Object.keys(call('handleBotGetSettings', {}).aiFeatures).includes('check'), 'AI 功能清單含「回覆檢查」');
call('handleBotSaveAi', { models: [M('gemini', 'KEY-A-1111', { name: '主要', uses: ['all', 'cs'] }), M('openai', 'KEY-B-2222', { name: '便宜', model: 'cheap-mini', uses: ['check'] })] });
const info = cs();
ok(info.checkAi && info.checkAi.apiKey === 'KEY-B-2222' && info.checkAi.model === 'cheap-mini' && info.ai.apiKey === 'KEY-A-1111', '指定了回覆檢查用的 AI：檢查用「便宜」、回答仍用客服那一組');
ok(call('handleBotGetSettings', {}).aiAssign.check.name === '便宜', '設定畫面的「目前：…」摘要含回覆檢查');
console.log('kb version checks passed:', pass);
