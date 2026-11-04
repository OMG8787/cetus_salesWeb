const assert = require('assert');
const path = require('path');
const { makeEnv } = require('./gasmock');
const calls = [];
let failEmbed = false;
const { ctx, sheets } = makeEnv({
  files: [path.join(__dirname, '..', 'Code.gs')],
  fetch: (url, o) => {
    const body = JSON.parse(o.payload);
    calls.push({ url, body, headers: o.headers });
    if (failEmbed) return { code: 400, body: { error: { message: 'bad key AIzaKEY123' } } };
    const vec = (t) => {
      const v = new Array(256).fill(0);
      v[/光源/.test(t) ? 0 : /相機/.test(t) ? 1 : 2] = 3;
      v[3] = 0.4;
      return v;
    };
    if (/batchEmbedContents/.test(url)) return { code: 200, body: { embeddings: body.requests.map((r) => ({ values: vec(r.content.parts[0].text) })) } };
    if (/\/embeddings$/.test(url)) return { code: 200, body: { data: body.input.map((t) => ({ embedding: vec(t) })) } };
    return { code: 404, body: '' };
  },
});
let pass = 0;
const ok = (c, m) => {
  assert.ok(c, m);
  pass++;
};
const mk = (u, role, perms) => ctx.appendObjectRow('Users', { Username: u, PasswordHash: 'x', Role: role, DisplayName: u, Perms: perms ? JSON.stringify(perms) : '' });
mk('admin1', 'admin');
mk('vw', 'viewer');
const call = (fn, body, u) => ctx[fn](Object.assign({ _user: { username: u || 'admin1', displayName: u || 'admin1' } }, body));
const can = (u, a) => {
  try {
    ctx.requirePermission_(a, { username: u });
    return true;
  } catch (e) {
    return false;
  }
};

ok(can('admin1', 'botKbEmbed') && !can('vw', 'botKbEmbed') && !!ctx.botPerms_().botKbEmbed, '重新計算向量需要編輯權限');
ok(Object.keys(ctx.allSchemas_().schema).includes('BotVectors'), 'BotVectors 資料表');
const KEY = call('handleBotGenKey', { role: 'cs' }).key;
const csApi = (op, id, extra) => ctx.handleBotApi(Object.assign({ secret: KEY, op, lineUserId: id }, extra || {}));

// 搜尋設定
let st = call('handleBotGetSettings', {});
ok(st.search.mode === 'vector' && st.search.threshold === 0.6 && st.search.topK === 6 && st.search.embedProvider === 'auto' && st.embed === null, '預設：直接向量、閥值 0.6、沒有 AI 就沒有 embedding');
call('handleBotSaveSettings', { search: { mode: 'both', threshold: 0.75, topK: 99, embedProvider: 'weird' } });
st = call('handleBotGetSettings', {});
ok(st.search.mode === 'both' && st.search.threshold === 0.75 && st.search.topK === 15 && st.search.embedProvider === 'auto', '搜尋設定整理（topK 上限 15、不合法的 provider 回到 auto）');
call('handleBotSaveSettings', { search: { mode: 'nonsense', threshold: 5 } });
ok(call('handleBotGetSettings', {}).search.mode === 'vector' && call('handleBotGetSettings', {}).search.threshold === 1, '不合法的模式回預設、閥值夾在 0~1');
call('handleBotSaveSettings', { search: { mode: 'vector', threshold: 0.6, topK: 6 } });

// 沒有 embedding 金鑰
let r = call('handleBotKbSave', { type: 'qa', question: '有光源嗎', content: '有環形光源', bigCategory: '光源', topic: '環形光源', notes: '客人問打光、照明、LED 時用' });
ok(r.success && r.embedded === false && r.id === 1, '沒有 AI 金鑰：儲存成功但沒有向量');
r = call('handleBotKbEmbed', {});
ok(!r.success && r.message.includes('embedding'), '沒有可用模型時提示');
// 只有 Claude
call('handleBotSaveAi', { models: [{ provider: 'claude', apiKey: 'sk-ant-1' }] });
ok(call('handleBotKbEmbed', {}).success === false && call('handleBotGetSettings', {}).embed === null, 'Claude 沒有 embedding');

// Gemini
call('handleBotSaveAi', { models: [{ provider: 'claude', apiKey: 'sk-ant-1' }, { provider: 'gemini', apiKey: 'AIzaKEY123' }] });
st = call('handleBotGetSettings', {});
ok(st.embed && st.embed.provider === 'gemini' && st.embed.model === 'gemini-embedding-001' && st.embed.dim === 256, '自動選到 Gemini');
let list = call('handleBotKbList', {});
ok(list.items[0].BigCategory === '光源' && list.items[0].Topic === '環形光源' && list.items[0].Notes.includes('LED') && list.items[0].HasVector === false && list.pendingVectors === 1 && list.categories.join() === '光源', '列表帶新欄位、待算向量 1 筆');
r = call('handleBotKbSave', { type: 'qa', question: '相機怎麼選', content: '看檢測範圍與精度', bigCategory: '相機', topic: '選型', notes: '' });
ok(r.success && r.embedded === true, '有 Gemini：儲存時順便算向量');
const gem = calls.filter((c) => /batchEmbedContents/.test(c.url)).pop();
ok(gem.headers['x-goog-api-key'] === 'AIzaKEY123' && gem.body.requests[0].outputDimensionality === 256 && gem.body.requests[0].taskType === 'RETRIEVAL_DOCUMENT', 'Gemini 請求格式');
ok(gem.body.requests[0].content.parts[0].text.includes('相機') && gem.body.requests[0].content.parts[0].text.includes('選型'), '送去算向量的文字含大分類、主題、內容');
const vecRows = ctx.sheetToObjects('BotVectors').rows;
ok(vecRows.length === 1 && JSON.parse(vecRows[0].Vec).length === 256 && vecRows[0].Model === 'gemini:gemini-embedding-001:256', '向量存進 BotVectors');
const norm = Math.sqrt(JSON.parse(vecRows[0].Vec).reduce((a, x) => a + x * x, 0));
ok(Math.abs(norm - 1) < 0.01, '向量已正規化');

// 補算
list = call('handleBotKbList', {});
ok(list.pendingVectors === 1, '還有一筆沒向量');
r = call('handleBotKbEmbed', {});
ok(r.success && r.embedded === 1 && r.done && r.remaining === 0, '補算向量');
ok(call('handleBotKbList', {}).pendingVectors === 0 && ctx.sheetToObjects('BotVectors').rows.length === 2, '全部都有向量');
r = call('handleBotKbEmbed', {});
ok(r.success && r.embedded === 0 && r.done, '沒有要補的就直接完成');
// 全部重算（分批）
for (let i = 0; i < 45; i++) call('handleBotKbSave', { type: 'doc', title: '文件' + i, content: '段落內容' + i, bigCategory: '文件' });
ok(call('handleBotKbList', {}).pendingVectors === 0, '存的時候都有算');
r = call('handleBotKbEmbed', { force: true, offset: 0 });
ok(r.embedded === 40 && !r.done && r.total === 47 && r.remaining === 7, '全部重算：每次 40 筆');
r = call('handleBotKbEmbed', { force: true, offset: r.next });
ok(r.embedded === 7 && r.done, '全部重算：第二批完成');

// 失敗時錯誤訊息遮掉金鑰
failEmbed = true;
r = call('handleBotKbSave', { type: 'qa', question: '失敗測試', content: '內容' });
ok(r.success && r.embedded === false && !r.embedError.includes('AIzaKEY123') && r.embedError.includes('••••'), '算向量失敗不影響儲存，錯誤訊息遮掉金鑰');
failEmbed = false;
ok(call('handleBotKbEmbed', {}).embedded === 1, '補算失敗的那筆');

// 給機器人的資料
const know = csApi('csKnowledge').data;
const k1 = know.find((k) => k.id === 'k1');
ok(k1.category === '光源' && k1.topic === '環形光源' && k1.notes.includes('打光') && k1.tags === '', '知識庫段落帶大分類 / 主題 / 備註');
let v = csApi('csVectors', 'U' + 'a'.repeat(32), {}).data;
ok(v.model === 'gemini:gemini-embedding-001:256' && v.total === 48 && v.items.length === 48 && v.items.some((i) => i.id === 'k1') && v.items[0].v.length === 256 && v.next === 48, 'csVectors 第一頁');
v = csApi('csVectors', 'U' + 'a'.repeat(32), { after: 40, limit: 5 }).data;
ok(v.items.length === 5 && v.next === 45 && v.total === 48, 'csVectors 分頁');
ok(!csApi('csVectors', 'U' + 'a'.repeat(32), {}).message && true, 'csVectors 用客服金鑰');
const stKey = call('handleBotGenKey', { role: 'staff' }).key;
ok(!ctx.handleBotApi({ secret: stKey, op: 'csVectors', lineUserId: 'U' + 'a'.repeat(32) }).success, '員工金鑰不能拿向量');
const cs = csApi('csStart', 'U' + 'a'.repeat(32)).data;
ok(cs.search.mode === 'vector' && cs.embedAi.provider === 'gemini' && cs.embedAi.apiKey === 'AIzaKEY123', 'csStart 帶搜尋設定與 embedding 金鑰（只給客服金鑰）');

// 停用的項目不給向量；刪除連向量一起刪
call('handleBotKbSave', { rowIndex: 2, id: 1, type: 'qa', question: '有光源嗎', content: '有環形光源', isActive: false, bigCategory: '光源' });
ok(csApi('csVectors', 'U' + 'a'.repeat(32), {}).data.total === 47, '停用的項目不在向量清單');
const before = ctx.sheetToObjects('BotVectors').rows.length;
r = call('handleBotKbDelete', { ids: [2, 3] });
ok(r.deleted === 2 && ctx.sheetToObjects('BotVectors').rows.length === before - 2, '刪除知識庫項目時一併刪向量');

// 改掉 AI 設定的模型 → 舊向量視為過期
call('handleBotSaveSettings', { search: { embedProvider: 'openai' } });
ok(call('handleBotGetSettings', {}).embed === null, '指定 OpenAI 但沒金鑰 → 沒有 embedding');
call('handleBotSaveAi', { models: [{ provider: 'openai', apiKey: 'sk-openai-1', endpoint: 'https://api.openai.com/v1' }] });
ok(call('handleBotGetSettings', {}).embed.provider === 'openai', '改用 OpenAI');
ok(call('handleBotKbList', {}).pendingVectors > 40, '換 embedding 模型後舊向量過期，全部重算');
r = call('handleBotKbEmbed', {});
ok(r.success && r.embedded === 40 && calls.filter((c) => /\/embeddings$/.test(c.url)).pop().body.dimensions === 256, 'OpenAI 請求格式');

// 匯入文件帶分類
r = call('handleBotKbImport', { rows: [{ title: '簡介', content: '段落', source: '簡介.txt' }], bigCategory: '公司', topic: '簡介', notes: '公司資訊' });
const imp = call('handleBotKbList', {}).items.find((x) => x.Title === '簡介');
ok(r.success && imp.BigCategory === '公司' && imp.Topic === '簡介' && imp.Notes === '公司資訊', '匯入文件可帶大分類 / 主題 / 備註');
console.log('vector checks passed:', pass);
