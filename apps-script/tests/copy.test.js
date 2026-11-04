const assert = require('assert');
const path = require('path');
const { makeEnv } = require('./gasmock');
const base = path.join(__dirname, '..') + '/';
const aiLog = [];
const { ctx } = makeEnv({
  files: [path.join(__dirname, '..', 'Code.gs')],
  fetch: (url, o) => {
    const body = JSON.parse(o.payload);
    aiLog.push({ url, body });
    if (/bad\.example/.test(url)) return { code: 401, body: { error: { message: 'bad key sk-bad-key-9999' } } };
    if (/generativelanguage/.test(url)) return { code: 200, body: { candidates: [{ content: { parts: [{ text: '版本一\n=====\n版本二\n=====\n版本三' }] } }] } };
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
mk('ed', 'editor');
mk('vw', 'viewer');
mk('cplim', 'limited', { copy: 'edit' });
mk('cpview', 'limited', { copy: 'view' });
mk('sal', 'sales');
mk('none', 'limited', { cases: 'edit' });
const can = (u, a) => {
  try {
    ctx.requirePermission_(a, { username: u });
    return true;
  } catch (e) {
    return false;
  }
};
const call = (fn, body, u) => ctx[fn](Object.assign({ _user: { username: u || 'admin1' } }, body));

// 權限
const noperm = Object.keys(ctx.copyRoutes_()).filter((a) => !ctx.copyPerms_()[a]);
ok(noperm.length === 0, '沒登記權限：' + noperm.join());
ok(can('ed', 'copyGenerate') && !can('ed', 'copyDeletePost') && !can('ed', 'copyDeleteLib'), 'editor 可編輯不可刪');
ok(can('vw', 'copyGetData') && !can('vw', 'copySavePost') && !can('vw', 'copyGenerate') && !can('vw', 'copyImport'), 'viewer 只能看');
ok(can('cplim', 'copySavePost') && can('cpview', 'copyGetData') && !can('cpview', 'copySavePost') && !can('none', 'copyGetData'), 'limited');
ok(!can('sal', 'copyGetData'), '舊角色不能用文案製作');
ok(can('admin1', 'copyDeletePost'), 'admin 可刪');

// 預設
let d = call('handleCopyGetData', {});
ok(d.success && d.posts.length === 0 && d.library.length === 0 && d.models.length === 0 && d.aiReady === false && d.style.enabled === true, '預設資料');

// 存文案
let r = call('handleCopySavePost', { post: { platform: 'Instagram', topic: '展覽預告', keywords: 'AOI', tone: '親切自然', marketing: ['seo', 'cta', 'bad key!', 'x'], event: { schedule: [{ date: '2026/11/20', time: '10:00' }], theme: '大展', evil: 'x' }, content: '內文一', note: '週五發', status: 'scheduled', scheduled_for: '2026-11-20' } });
ok(r.success && r.id === 1, '新增文案');
r = call('handleCopySavePost', { post: { topic: '', content: '' } });
ok(!r.success, '主題與內文都空白');
r = call('handleCopySavePost', { post: { platform: 'Weird', status: 'zzz', topic: 't', scheduled_for: 'tomorrow' } });
ok(r.success && r.id === 2, '不合法的值被整理');
d = call('handleCopyGetData', {});
const p1 = d.posts.find((p) => p.id === 1);
const p2 = d.posts.find((p) => p.id === 2);
ok(p1.platform === 'Instagram' && p1.status === 'scheduled' && p1.scheduled_for === '2026-11-20' && p1.marketing.join() === 'seo,cta' && p1.event.theme === '大展' && p1.event.evil === undefined && p1.event.schedule[0].time === '10:00' && p1.created_by === 'admin1', '文案讀回');
ok(p2.platform === 'Threads' && p2.status === 'draft' && p2.scheduled_for === '', '預設平台 / 狀態');
r = call('handleCopySavePost', { id: 1, post: { platform: 'Instagram', topic: '展覽預告', content: '內文二' } });
ok(r.success && call('handleCopyGetData', {}).posts.find((p) => p.id === 1).content === '內文二', '修改文案');
ok(!call('handleCopySavePost', { id: 99, post: { topic: 'x' } }).success, '修改不存在');

// 長文
const long = '字'.repeat(60000);
call('handleCopySavePost', { post: { platform: '方格子', topic: 't', content: long } });
ok(call('handleCopyGetData', {}).posts.find((p) => p.platform === '方格子').content.length === 49000, '內文超過儲存格上限被截斷');

// 喜愛
ok(call('handleCopySetLiked', { id: 1, liked: true }).success && call('handleCopyGetData', {}).posts.find((p) => p.id === 1).liked === true, '喜愛');
ok(!call('handleCopySetLiked', { id: 2, liked: true }).success, '空內文不能喜愛');

// 刪除
ok(call('handleCopyDeletePost', { id: 2 }).success && call('handleCopyGetData', {}).posts.length === 2, '刪除文案');

// 素材庫
r = call('handleCopySaveLib', { item: { kind: 'prompt', name: '品牌人設', text: '你是鑫堡的小編', platform: '', enabled: true } });
ok(r.success && r.id === 1, '新增人設');
ok(call('handleCopySaveLib', { item: { kind: 'style', name: '風格A', text: '短句多換行', platform: '@social' } }).success, '新增風格（一般社群）');
ok(call('handleCopySaveLib', { item: { kind: 'ending', name: '結尾', text: '歡迎私訊', platform: 'Mars' } }).success, '平台不合法 → 全部平台');
ok(!call('handleCopySaveLib', { item: { kind: 'bad', name: 'x', text: 'y' } }).success && !call('handleCopySaveLib', { item: { kind: 'style', name: '', text: 'y' } }).success && !call('handleCopySaveLib', { item: { kind: 'style', name: 'x', text: '' } }).success, '驗證');
d = call('handleCopyGetData', {});
ok(d.library.length === 3 && d.library[1].platform === '@social' && d.library[2].platform === '' && d.library[0].enabled === true, '素材讀回');
ok(call('handleCopyToggleLib', { id: 1, enabled: false }).success && call('handleCopyGetData', {}).library[0].enabled === false, '預設帶入開關');
ok(call('handleCopySaveLib', { id: 1, item: { kind: 'prompt', name: '品牌人設2', text: 'x' } }).success && call('handleCopyGetData', {}).library[0].name === '品牌人設2', '修改素材');
ok(call('handleCopyDeleteLib', { id: 3 }).success && call('handleCopyGetData', {}).library.length === 2, '刪除素材');

// 匯入
r = call('handleCopyImport', { json: JSON.stringify({ prompts: [{ name: '品牌人設2', text: '重複' }, { name: '新人設', text: '你好', platform: 'Threads' }], styles: [{ name: '風格B', text: 'x', platform: '@social' }, { text: '沒名稱' }], endings: [{ name: '結尾2', text: '追蹤我們' }] }) });
ok(r.success && r.count === 3, '匯入素材（略過重複與壞資料）：' + r.message);
r = call('handleCopyImport', { json: JSON.stringify({ prompts: [{ name: '新人設', text: '你好' }] }) });
ok(!r.success && r.message.includes('沒有新的'), '全部重複');
r = call('handleCopyImport', { json: JSON.stringify([{ platform: 'Threads', topic: '舊文', keywords: 'a', tone: '專業可信', marketing: ['seo'], content: '內容', status: 'posted', when: '2026-10-01', note: 'n' }, { platform: 'X', content: '' }, null]) });
ok(r.success && r.count === 1, '匯入文案：' + r.message);
const imported = call('handleCopyGetData', {}).posts.find((p) => p.topic === '舊文');
ok(imported.status === 'posted' && imported.scheduled_for === '2026-10-01' && imported.marketing[0] === 'seo', '匯入文案欄位');
ok(!call('handleCopyImport', { json: '{壞掉' }).success && !call('handleCopyImport', { json: '{"x":1}' }).success && !call('handleCopyImport', { json: '[]' }).success, '匯入驗證');

// AI 學習風格
r = call('handleCopySaveStyle', { profile: '・短句\n・多用問句', enabled: true });
ok(r.success && call('handleCopyGetData', {}).style.profile.startsWith('・短句'), '儲存風格指南');
ok(call('handleCopySaveStyle', { enabled: false }).style.enabled === false && call('handleCopyGetData', {}).style.profile.length > 0, '只改開關不清掉指南');

// 沒設定 AI
r = call('handleCopyGenerate', { prompt: '寫一篇' });
ok(!r.success && r.message.includes('還沒有設定 AI'), '沒有 AI');
ok(!call('handleCopyGenerate', { prompt: '' }).success && !call('handleCopyGenerate', { prompt: 'x'.repeat(40001) }).success, '提示詞驗證');

// 文案專用模型（備援）
r = call('handleCopySaveModels', { models: [{ provider: 'openai', apiKey: 'sk-bad-key-9999', endpoint: 'https://bad.example/v1', model: 'm' }, { provider: 'gemini', apiKey: 'AIzaGood1234', model: '' }, { provider: 'gemini', apiKey: '' }] });
ok(r.success && r.models.length === 2 && r.models[0].keyHint === '••••9999' && !JSON.stringify(r).includes('sk-bad'), '儲存模型（金鑰只回傳末四碼）');
let thrown = false;
try {
  call('handleCopySaveModels', { models: [{ provider: 'gemini', apiKey: 'k', endpoint: 'http://x' }] });
} catch (e) {
  thrown = /https/.test(e.message);
}
ok(thrown, 'endpoint 必須 https');
d = call('handleCopyGetData', {});
ok(d.aiReady && !d.usingBotModels && d.models.length === 2, 'aiReady');
r = call('handleCopyGenerate', { prompt: '寫三個版本' });
ok(r.success && r.text.includes('=====') && r.failures.length === 1 && r.failures[0].includes('••••') && !r.failures[0].includes('sk-bad-key-9999') && r.model.includes('Gemini'), '第一個失敗 → 備援第二個成功，錯誤訊息隱藏金鑰：' + JSON.stringify(r));
const gem = aiLog.filter((x) => /generativelanguage/.test(x.url)).pop();
ok(gem.body.generationConfig.maxOutputTokens === 8000 && gem.body.contents[0].parts[0].text === '寫三個版本', '長文用 8000 tokens、提示詞原樣送出');
// 沿用空金鑰
r = call('handleCopySaveModels', { models: [{ provider: 'openai', apiKey: '', endpoint: 'https://bad.example/v1', model: 'm2' }] });
ok(r.success && r.models.length === 1 && r.models[0].keyHint === '••••9999', '金鑰留空沿用原本的');
r = call('handleCopyTestModel', { index: 0 });
ok(!r.success && r.message.includes('••••'), '測試模型失敗訊息隱藏金鑰');
r = call('handleCopySaveModels', { models: [] });
ok(r.success && r.models.length === 0, '清空文案專用模型');

// 沿用 BOT 設定的 AI
call('handleBotSaveAi', { models: [{ provider: 'gemini', apiKey: 'AIzaBot5678' }] });
d = call('handleCopyGetData', {});
ok(d.aiReady && d.usingBotModels && d.models.length === 0, '沒有文案專用模型就沿用 BOT 設定');
ok(call('handleCopyGenerate', { prompt: '寫一篇' }).success, '用 BOT 設定的 AI 產生');
ok(call('handleCopyTestModel', { index: 0 }).success, '測試沿用的模型');
console.log('copy checks passed:', pass);
