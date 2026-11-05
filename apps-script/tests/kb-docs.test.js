// 知識庫文件：整份儲存（切段由前端做，一般切段或 AI 切段）、編輯時整份重建、讓 AI 來切
const assert = require('assert');
const path = require('path');
const { makeEnv } = require('./gasmock');
let aiReply = '';
const calls = [];
const { ctx } = makeEnv({
  files: [path.join(__dirname, '..', 'Code.gs')],
  fetch: (url, o) => {
    calls.push({ url, o });
    if (/batchEmbedContents/.test(url)) {
      const n = JSON.parse(o.payload).requests.length;
      return { code: 200, body: { embeddings: new Array(n).fill(0).map(() => ({ values: new Array(256).fill(0).map((_, i) => (i === 0 ? 1 : 0)) })) } };
    }
    if (/generateContent/.test(url)) return { code: 200, body: { candidates: [{ content: { parts: [{ text: aiReply }] } }] } };
    return { code: 404, body: '' };
  },
});
let pass = 0;
const ok = (c, m) => {
  assert.ok(c, m);
  pass++;
};
const mk = (u, role) => ctx.appendObjectRow('Users', { Username: u, PasswordHash: 'x', Role: role, DisplayName: u });
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
const docRows = (key) => call('handleBotKbList', {}).items.filter((x) => x.Type === 'doc' && (x.FileName === key || x.Source === key));
ok(can('admin1', 'botKbDocSave') && can('admin1', 'botKbAiSplit') && !can('vw', 'botKbDocSave') && !can('vw', 'botKbAiSplit'), '需要 BOT 設定編輯權限');
call('handleBotSaveAi', { models: [{ provider: 'gemini', apiKey: 'KEY-A-1111', name: '預設', uses: ['all'] }, { provider: 'gemini', apiKey: 'KEY-B-2222', name: '爬蟲', model: 'gemini-x' }] });

// ---- 整份儲存 ----
let r = call('handleBotKbDocSave', { title: '保存說明', chunks: [{ content: '第一段內容', overlap: 0, title: '保存方式' }, { content: '一段內容第二段', overlap: 3, title: '' }, { content: '第三段', overlap: 0 }], chunkSize: 500, tags: '保存 冷凍', bigCategory: '產品', topic: '保存', notes: '給 AI 的提示', audience: ['staff'] });
ok(r.success && r.count === 3 && r.embedded === 3 && /^doc-/.test(r.key), '新文件：3 段、向量一起算好');
let rows = docRows(r.key);
const key = r.key;
ok(rows.map((x) => x.SortOrder).join() === '1,2,3' && rows.every((x) => x.FileName === key && x.Source === '保存說明' && x.ChunkSize === 500 && x.BigCategory === '產品' && x.Tags === '保存 冷凍' && JSON.stringify(x.audience) === '["staff"]'), '欄位：排序、文件代號、切段設定、分類、可見對象');
ok(rows[0].Title === '保存說明（1/3）｜保存方式' && rows[1].Title === '保存說明（2/3）' && rows[1].Overlap === 3, '段落標題（含 AI 小標）與重疊字數');
const idsBefore = rows.map((x) => x.ID);
ok(call('handleBotKbList', {}).items.filter((x) => x.FileName === key).every((x) => x.HasVector), '每段都有向量');

// ---- 編輯 = 整份重建（同一個 key）----
r = call('handleBotKbDocSave', { key, title: '保存說明（改）', chunks: [{ content: '改過的全文', overlap: 0 }], chunkSize: 300, audience: ['cs', 'staff'] });
rows = docRows(key);
ok(r.success && r.key === key && rows.length === 1 && rows[0].Title === '保存說明（改）' && rows[0].ChunkSize === 300, '同一個 key：舊段落整份換掉');
ok(ctx.botVecRows_().length === 1 && ctx.botVecRows_()[0].id === rows[0].ID && idsBefore.length === 3, '舊段落的向量一起刪掉，只剩新段落的向量（編號可能重用，所以先刪再寫）');
ok(call('handleBotKbList', {}).items.filter((x) => x.Type === 'doc').length === 1, '不會變成兩份');

// ---- 舊版匯入的文件（沒有 FileName，用 Source 串起來）也能整份重建 ----
ctx.appendObjectRow('BotKnowledge', { ID: 500, Type: 'doc', Title: '舊文件（1/2）', Content: 'a', Source: '舊文件', IsActive: true });
ctx.appendObjectRow('BotKnowledge', { ID: 501, Type: 'doc', Title: '舊文件（2/2）', Content: 'b', Source: '舊文件', IsActive: true });
r = call('handleBotKbDocSave', { key: '舊文件', title: '舊文件', chunks: [{ content: '新內容', overlap: 0 }] });
ok(r.success && call('handleBotKbList', {}).items.filter((x) => x.Source === '舊文件').length === 1 && !call('handleBotKbList', {}).items.some((x) => x.ID === 500), '舊匯入的文件：用文件名稱當 key 整份重建');
ok(JSON.stringify(call('handleBotKbList', {}).items.find((x) => x.Source === '舊文件').audience) === '["cs","staff"]', '沒指定可見對象 = 都開放');

// ---- 驗證 ----
ok(!call('handleBotKbDocSave', { title: '', chunks: [{ content: 'x' }] }).success, '文件名稱必填');
ok(!call('handleBotKbDocSave', { title: 't', chunks: [] }).success && !call('handleBotKbDocSave', { title: 't', chunks: [{ content: '   ' }] }).success, '沒有內容不能儲存');
ok(!call('handleBotKbDocSave', { title: 't', chunks: new Array(1001).fill({ content: 'x' }) }).success, '最多 1000 段');
r = call('handleBotKbDocSave', { title: '停用的', chunks: [{ content: 'x' }], isActive: false });
ok(r.success && docRows(r.key)[0].IsActive === false, '可以存成停用');
call('handleBotKbDelete', { ids: docRows(r.key).map((x) => x.ID) });
ok(docRows(r.key).length === 0, '刪除整份（用段落編號）');

// ---- 讓 AI 來切 ----
const text = '第一句。第二句。第三句。\n第四句。第五句。第六句。';
aiReply = '好的：{"chunks":[{"start":1,"title":"前半"},{"start":4,"title":"後半"}]}';
r = call('handleBotKbAiSplit', { text, target: 100 });
ok(r.success && r.chunks.length === 2 && r.chunks.map((c) => c.text).join('') === text && r.chunks[0].title === '前半' && r.chunks[1].title === '後半', 'AI 切段：段落接起來 = 原文，帶小標');
ok(r.name === '預設' && r.model.length > 0 && r.units >= 6, '預設用「整個系統」那組');
let last = calls[calls.length - 1];
ok(String(JSON.stringify(last.o.headers)).includes('KEY-A-1111'), '用到的是預設那組金鑰');
r = call('handleBotKbAiSplit', { text, target: 100, profile: 1, model: 'gemini-3.8-flash' });
last = calls[calls.length - 1];
ok(r.success && r.name === '爬蟲' && r.model === 'gemini-3.8-flash' && String(JSON.stringify(last.o.headers)).includes('KEY-B-2222') && /gemini-3\.8-flash:generateContent/.test(last.url), '指定第 2 組與模型：費用記在那組金鑰，不備援');
aiReply = '{"chunks":[{"start":3,"title":"從三開始"},{"start":2,"title":"亂序"},{"start":99,"title":"超出"},{"start":5,"title":"五"}]}';
r = call('handleBotKbAiSplit', { text, target: 100 });
ok(r.success && r.chunks.length === 3 && r.chunks[0].title === '' && r.chunks.map((c) => c.text).join('') === text, '起點整理：第一段強制從 1 開始，亂序 / 超出的丟掉，內容不會漏');
aiReply = '我不知道';
ok(!call('handleBotKbAiSplit', { text }).success && call('handleBotKbAiSplit', { text }).message.includes('格式不對'), 'AI 回非 JSON → 友善錯誤');
aiReply = '{"chunks":[{"start":0},{"start":"x"}]}';
ok(call('handleBotKbAiSplit', { text }).message.includes('編號不對'), '編號全部不合法 → 錯誤');
ok(!call('handleBotKbAiSplit', { text: '' }).success && !call('handleBotKbAiSplit', { text: 'x'.repeat(120001) }).success, '空內容 / 太長會擋');
ok(call('handleBotKbAiSplit', { text, profile: 9 }).message.includes('找不到這組 AI'), '不存在的 AI');
ok(call('handleBotKbAiSplit', { text, model: 'bad model!' }).message.includes('模型名稱'), '模型名稱格式');
ok(call('handleBotKbAiSplit', { text, profile: 'sys' }).message.includes('找不到'), '沒設系統共用 Gemini 時選 sys → 擋');
ctx.botCfgSet_('ai', { models: [] });
ok(!call('handleBotKbAiSplit', { text }).success, '完全沒有 AI → 擋');
ok(call('handleBotGetSettings', {}).aiSystem === false, '設定畫面可知道有沒有系統共用 Gemini');
console.log('kb docs checks passed:', pass);
