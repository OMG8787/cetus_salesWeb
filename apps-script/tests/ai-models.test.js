const assert = require('assert');
const path = require('path');
const { makeEnv } = require('./gasmock');
const { ctx, props } = makeEnv({ files: [path.join(__dirname, '..', 'Code.gs')], fetch: () => ({ code: 404, body: '' }) });
let pass = 0;
const ok = (c, m) => {
  assert.ok(c, m);
  pass++;
};
ctx.appendObjectRow('Users', { Username: 'admin1', PasswordHash: 'x', Role: 'admin', DisplayName: 'admin1' });
const call = (fn, body) => ctx[fn](Object.assign({ _user: { username: 'admin1', displayName: 'admin1' } }, body));
const M = (provider, key, extra) => Object.assign({ provider, apiKey: key, model: '', endpoint: '' }, extra || {});
const names = (l) => l.map((m) => m.name || m.provider + ':' + m.apiKey.slice(-1)).join(',');
const first = (f) => ctx.botAiList_(f)[0];

// ---- 沒設定 ----
ok(ctx.botAiList_('cs').length === 0 && ctx.botAiList_().length === 0, '沒有任何 AI');
ok(call('handleBotGetSettings', {}).aiRounds === 6 && call('handleBotGetSettings', {}).aiAssign.cs === null, '預設輪數 6、沒有指派');

// ---- 舊設定（沒有指定功能）：第一組 = 整個系統 ----
ctx.botCfgSet_('ai', { models: [{ provider: 'gemini', apiKey: 'SECRET-AAA-1234' }, { provider: 'openai', apiKey: 'BBB2' }] });
ok(names(ctx.botAiList_('cs')) === 'gemini:4,openai:2' && names(ctx.botAiList_('copy')) === 'gemini:4,openai:2', '舊設定：第一組用在全部功能');
const st = call('handleBotGetSettings', {});
ok(JSON.stringify(st.ai[0].uses) === '["all"]' && st.ai[1].uses.length === 0 && JSON.stringify(st).indexOf('SECRET-AAA') < 0, '設定畫面：舊設定第一組顯示為「整個系統」，金鑰不外流');

// ---- 儲存：指定功能 + 名稱；每個功能只會用一組 ----
let r = call('handleBotSaveAi', {
  models: [
    M('gemini', 'KEY-A', { name: '預設', uses: ['all', 'staff', 'bogus'] }),
    M('gemini', 'KEY-B', { name: '爬蟲', model: 'gemini-x', uses: ['cs', 'staff'] }),
    M('claude', 'KEY-C', { name: 'Claude', uses: ['copy'] }),
    M('openai', 'KEY-D', { name: '向量用', uses: ['vector'] }),
  ],
  maxRounds: 8,
});
ok(r.success && r.ai.length === 4 && r.aiRounds === 8, '儲存成功');
ok(JSON.stringify(r.ai[0].uses) === '["all","staff"]' && JSON.stringify(r.ai[1].uses) === '["cs"]', '同一功能重複勾選：排前面的保留，不合法的功能被濾掉：' + JSON.stringify(r.ai.map((m) => m.uses)));
ok(r.ai[1].name === '爬蟲' && r.ai[1].keyHint === '••••EY-B' && JSON.stringify(r).indexOf('KEY-A') < 0, '名稱保留、金鑰遮蔽');
ok(first('cs').apiKey === 'KEY-B' && first('cs').model === 'gemini-x', 'LINE 機器人 → 爬蟲');
ok(first('staff').apiKey === 'KEY-A', '小助理 → 預設');
ok(first('copy').apiKey === 'KEY-C', 'AI 文案 → Claude');
ok(first('all').apiKey === 'KEY-A' && first(undefined).apiKey === 'KEY-A', '整個系統 → 預設');
ok(names(ctx.botAiList_('cs')) === '爬蟲,預設,Claude,向量用', '主要之後依清單順序備援：' + names(ctx.botAiList_('cs')));
ok(ctx.botAiList_('cs').every((m) => m.maxRounds === 8), '每個 AI 帶著輪數上限');
// 沒被指定的功能 → 整個系統那組
ctx.botCfgSet_('ai', { models: [{ provider: 'gemini', apiKey: 'K1', uses: ['all'] }, { provider: 'openai', apiKey: 'K2', uses: ['cs'] }] });
ok(first('copy').apiKey === 'K1' && first('staff').apiKey === 'K1' && first('cs').apiKey === 'K2', '沒指定的功能用「整個系統」那組');
// 沒有「整個系統」也沒指定 → 清單第一組
ctx.botCfgSet_('ai', { models: [{ provider: 'gemini', apiKey: 'K1', uses: ['cs'] }, { provider: 'openai', apiKey: 'K2', uses: ['copy'] }] });
ok(first('staff').apiKey === 'K1', '都沒有 → 清單第一組');

// ---- 向量：優先用指定給「向量」的那組；Claude 不能算向量 ----
call('handleBotSaveAi', { models: [M('gemini', 'G1', { uses: ['all'] }), M('openai', 'O1', { uses: ['vector'] })] });
let e = ctx.botEmbedCfg_();
ok(e && e.provider === 'openai' && e.apiKey === 'O1', '向量指定給 OpenAI 那組就用它');
call('handleBotSaveAi', { models: [M('gemini', 'G1', { uses: ['all'] }), M('claude', 'C1', { uses: ['vector'] })] });
e = ctx.botEmbedCfg_();
ok(e && e.provider === 'gemini' && e.apiKey === 'G1', '向量指定給 Claude（沒有 embedding）→ 改用其他可算向量的組');
call('handleBotSaveAi', { models: [M('claude', 'C1', { uses: ['all'] })] });
ok(ctx.botEmbedCfg_() === null && call('handleBotGetSettings', {}).aiAssign.vector === null, '只有 Claude → 沒有向量');
call('handleBotSaveAi', { models: [M('gemini', 'G1', { uses: ['all'] }), M('openai', 'O1', { uses: ['vector'] })] });
call('handleBotSaveSettings', { search: { embedProvider: 'gemini' } });
ok(ctx.botEmbedCfg_().provider === 'gemini', '搜尋設定指定 Gemini → 優先照搜尋設定');
call('handleBotSaveSettings', { search: { embedProvider: 'auto' } });

// ---- 各功能實際拿到的 AI ----
call('handleBotSaveAi', { models: [M('gemini', 'G1', { name: '預設', uses: ['all', 'staff'] }), M('openai', 'O1', { name: '客服', uses: ['cs'] }), M('claude', 'C1', { name: '文案', uses: ['copy'] })], maxRounds: 3 });
const csKey = call('handleBotGenKey', { role: 'cs' }).key;
const stKey = call('handleBotGenKey', { role: 'staff' }).key;
const csAi = ctx.handleBotApi({ secret: csKey, op: 'csStart', lineUserId: 'U' + 'a'.repeat(32) }).data;
ok(csAi.ai.apiKey === 'O1' && csAi.ai.maxRounds === 3 && csAi.aiFallback.map((m) => m.apiKey).join() === 'G1,C1', '客服：主要 = 客服那組，其餘備援，帶輪數上限');
call('handleBotSaveStaff', { config: { enabled: true, webEnabled: true } });
const SID = 'U' + 'b'.repeat(32);
ctx.handleBotApi({ secret: stKey, op: 'start', lineUserId: SID });
call('handleBotMemberSave', { lineUserId: SID, status: '已開通', role: 'editor' });
const stAi = ctx.handleBotApi({ secret: stKey, op: 'start', lineUserId: SID }).data;
ok(stAi.allowed && stAi.ai.apiKey === 'G1' && stAi.ai.maxRounds === 3, '員工助理：用「小助理」那組');
ok(ctx.copyAiList_()[0].apiKey === 'C1', 'AI 文案：沒有文案專用清單時用指定給文案的那組');
const asg = call('handleBotGetSettings', {}).aiAssign;
ok(asg.cs.name === '客服' && asg.staff.name === '預設' && asg.copy.name === '文案' && asg.all.name === '預設' && asg.vector.provider === 'gemini', '設定畫面的「目前：…」摘要');

// ---- 輪數與數量限制 ----
call('handleBotSaveAi', { models: [M('gemini', 'G1', { uses: ['all'] })], maxRounds: 99 });
ok(ctx.botAiRounds_() === 12, '輪數上限 12');
call('handleBotSaveAi', { models: [M('gemini', 'G1', { uses: ['all'] })], maxRounds: 0 });
ok(ctx.botAiRounds_() === 1, '輪數下限 1');
call('handleBotSaveAi', { models: [M('gemini', 'G1', { uses: ['all'] })] });
ok(ctx.botAiRounds_() === 1, '沒帶輪數 → 沿用原本的');
const many = [];
for (let i = 0; i < 12; i++) many.push(M('gemini', 'K' + i));
ok(call('handleBotSaveAi', { models: many }).ai.length === 8, '最多 8 組');
// 金鑰留空沿用
call('handleBotSaveAi', { models: [M('gemini', 'KEEP-ME', { uses: ['all'] })] });
r = call('handleBotSaveAi', { models: [M('gemini', '', { name: '改名', uses: ['all', 'cs'] })] });
ok(r.ai.length === 1 && ctx.botAiList_('cs')[0].apiKey === 'KEEP-ME' && r.ai[0].name === '改名', '金鑰留空沿用');
let threw = false;
try {
  call('handleBotSaveAi', { models: [M('gemini', 'x', { endpoint: 'http://insecure' })] });
} catch (err) {
  threw = err.message.includes('https');
}
ok(threw, 'Endpoint 一定要 https');

// ---- 系統共用 Gemini（Script Properties）當最後備援 ----
call('handleBotSaveAi', { models: [M('gemini', 'KEEP-ME', { uses: ['all'] })] });
props.GEMINI_API_KEY = 'SYS-KEY';
const l = ctx.botAiList_('cs');
ok(l[l.length - 1].apiKey === 'SYS-KEY' && l[0].apiKey === 'KEEP-ME', '系統共用的 Gemini 金鑰排在最後備援');
ctx.botCfgSet_('ai', { models: [] });
ok(ctx.botAiList_('cs').length === 1 && ctx.botAiList_('cs')[0].source === 'system', '沒有任何設定 → 只用系統共用的');
console.log('ai model checks passed:', pass);
