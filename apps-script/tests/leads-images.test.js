// 轉真人按鈕 / 聊幾段後請訪客留聯繫資料 / 聯繫名單 / 知識庫圖片
const assert = require('assert');
const path = require('path');
const { makeEnv } = require('./gasmock');
const { ctx, cache, drive } = makeEnv({ files: [path.join(__dirname, '..', 'Code.gs')], fetch: () => ({ code: 404, body: '' }) });
let pass = 0;
const ok = (c, m) => {
  assert.ok(c, m);
  pass++;
};
ctx.appendObjectRow('Users', { Username: 'admin1', PasswordHash: 'x', Role: 'admin', DisplayName: 'admin1' });
ctx.appendObjectRow('Users', { Username: 'ed', PasswordHash: 'x', Role: 'editor', DisplayName: 'ed' });
ctx.appendObjectRow('Users', { Username: 'lim', PasswordHash: 'x', Role: 'limited', DisplayName: 'lim', Perms: JSON.stringify({ products: 'edit' }) });
const as = (u) => (fn, body) => ctx[fn](Object.assign({ _user: { username: u, displayName: u } }, body));
const call = as('admin1');
const csKey = call('handleBotGenKey', { role: 'cs' }).key;
const api = (op, id, extra) => ctx.handleBotApi(Object.assign({ secret: csKey, op, lineUserId: id }, extra || {}));
const V = 'V' + 'a'.repeat(32), U = 'U' + 'b'.repeat(32);

// ---- 設定預設值 ----
const form = call('handleBotGetSettings', {}).cs;
ok(form.handoffButton === true && form.contactAfter === 3 && form.sendImages === true, '預設：轉真人按鈕開、聊 3 段後請留資料、可附圖');
let info = api('csStart', V).data;
ok(info.handoffButton === true && info.contactAfter === 3 && info.sendImages === true && info.turnCount === 0 && info.leadState === '', 'csStart 帶回按鈕 / 段數 / 圖片設定');

// ---- 段數計數 ----
api('csRemember', V, { turns: [{ u: true, t: '問1' }, { u: false, t: '答1' }] });
api('csRemember', V, { turns: [{ u: true, t: '問2' }, { u: false, t: '答2' }] });
ok(api('csStart', V).data.turnCount === 2, '聊了 2 段');
ok(api('csStart', U).data.turnCount === 0, '另一位客人各自計算');
api('csRemember', V, { turns: [{ u: true, t: '問3' }, { u: false, t: '答3' }], askedContact: true });
info = api('csStart', V).data;
ok(info.turnCount === 3 && info.leadState === 'asked', '第 3 段後標記「已問過聯繫資料」，不會每則都問');
api('csForget', V);
info = api('csStart', V).data;
ok(info.turnCount === 0 && info.leadState === '', '重新開始 → 段數歸零、可以再問');

// ---- 可從後端修改 ----
form.contactAfter = 5;
form.handoffButton = false;
form.sendImages = false;
call('handleBotSaveSettings', { cs: form });
info = api('csStart', V).data;
ok(info.contactAfter === 5 && info.handoffButton === false && info.sendImages === false, '後台改成 5 段、關閉按鈕與圖片');
form.contactAfter = 0;
call('handleBotSaveSettings', { cs: form });
ok(api('csStart', V).data.contactAfter === 0, '0 = 不問');
form.contactAfter = 999;
call('handleBotSaveSettings', { cs: form });
ok(api('csStart', V).data.contactAfter === 50, '上限 50');
form.contactAfter = 3; form.handoffButton = true; form.sendImages = true;
call('handleBotSaveSettings', { cs: form });

// ---- 留聯繫資料 ----
let r = api('csLead', V, { name: '王小明', company: '甲公司' });
ok(!r.success && /電話或 Email/.test(r.message), '沒有電話也沒有 Email → 不收：' + r.message);
r = api('csLead', V, { name: '王', phone: '12' });
ok(!r.success && /電話/.test(r.message), '電話太短');
r = api('csLead', V, { name: '王', email: 'abc' });
ok(!r.success && /Email/.test(r.message), 'Email 格式錯');
r = api('csLead', V, { name: '王小明', company: '甲公司', phone: '0912-345-678', email: 'a@b.com', note: '想了解相機' });
ok(r.success, '留資料成功');
ok(api('csStart', V).data.leadState === 'done', '留過資料 → 不會再問');
let leads = call('handleBotLeads', {});
ok(leads.leads.length === 1 && leads.leads[0].name === '王小明' && leads.leads[0].phone === '0912-345-678' && leads.leads[0].channel === 'web' && leads.leads[0].source === 'form', '名單有這一筆');
const memos = ctx.sheetToObjects('Memos').rows.filter((m) => m.LinkType === 'csLead');
ok(memos.length === 1 && /王小明/.test(memos[0].Title) && memos[0].NeedBlock === 'bot' && /0912-345-678/.test(memos[0].Content), '首頁備忘錄通知有 BOT 權限的人');
// AI 在 LINE 聽到客人主動留資料
ctx.appendObjectRow('BotMessages', { ID: 1, Time: 't', Channel: 'line', UserId: U, Name: 'Amy', Role: 'user', Text: 'hi' });
api('csRemember', U, { turns: [{ u: true, t: 'hi' }, { u: false, t: 'yo' }], displayName: 'Amy' });
r = api('csLead', U, { phone: '02-1234-5678', source: 'ai' });
leads = call('handleBotLeads', {});
ok(r.success && leads.leads[0].channel === 'line' && leads.leads[0].source === 'ai' && leads.leads[0].name === 'Amy', 'LINE：AI 記下的名單，姓名沿用 LINE 名稱');
// 欄位長度被限制
api('csLead', V, { name: 'x'.repeat(500), phone: '0912345678' });
ok(call('handleBotLeads', {}).leads[0].name.length === 40, '姓名最多 40 字');
// 權限
const lid = leads.leads[0].id;
ok(call('handleBotLeadDelete', { ids: [lid] }).deleted === 1 && call('handleBotLeads', {}).total === 2, '刪除一筆');
ok(ctx.permFor_('botLeads').join() === 'bot,r' && ctx.permFor_('botLeadDelete').join() === 'bot,d' && ctx.permFor_('botKbImageUpload').join() === 'bot,w', '權限登記：查看 / 刪除 / 上傳');
ok(!ctx.handleBotApi({ secret: 'wrong', op: 'csLead', lineUserId: V, phone: '0912345678' }).success, '金鑰錯誤不能寫入名單');

// ---- 圖片上傳 ----
const png = Buffer.from('iVBORw0KGgo=', 'base64').toString('base64');
r = call('handleBotKbImageUpload', { mimeType: 'application/pdf', base64: png });
ok(!r.success && /JPG/.test(r.message), '只收圖片');
r = call('handleBotKbImageUpload', { mimeType: 'image/png', base64: png, filename: '系統 架構圖.png' });
ok(r.success && /^file/.test(r.id), '上傳成功，回傳雲端硬碟檔案代號');
const folder = Object.values(drive)[0];
ok(folder.name === 'AOI機器人圖片' && folder.files.length === 1 && folder.files[0].shared === true && folder.files[0].blob.name === '系統_架構圖.png', '存進資料夾並設成知道連結可檢視、檔名去掉特殊字元');
const imgId = r.id;
const r2 = call('handleBotKbImageUpload', { mimeType: 'image/jpeg', base64: png });
ok(r2.success && Object.values(drive).length === 1 && folder.files.length === 2, '第二張沿用同一個資料夾');
ok(!call('handleBotKbImageUpload', { mimeType: 'image/png', base64: Buffer.alloc(9 * 1024 * 1024).toString('base64') }).success, '超過 8MB 不收');

// ---- 圖片掛在知識庫項目 ----
const saved = call('handleBotKbSave', { type: 'qa', question: '系統架構是什麼', content: '如圖', images: [{ id: imgId, caption: '系統架構圖' }, { id: '../bad', caption: 'x' }, { id: imgId, caption: '重複' }] });
ok(saved.success, '儲存問答');
let item = call('handleBotKbList', {}).items.find((x) => x.ID === saved.id);
ok(item.images.length === 1 && item.images[0].id === imgId && item.images[0].caption === '系統架構圖', '圖片代號格式不對 / 重複的被丟掉');
// 修改時沒帶 images → 不動
call('handleBotKbSave', { type: 'qa', id: saved.id, rowIndex: item.RowIndex, question: '系統架構是什麼', content: '如圖二' });
item = call('handleBotKbList', {}).items.find((x) => x.ID === saved.id);
ok(item.images.length === 1 && item.Content === '如圖二', '改文字但沒帶圖片 → 圖片保留');
call('handleBotKbSave', { type: 'qa', id: saved.id, rowIndex: item.RowIndex, question: '系統架構是什麼', content: '如圖二', images: [] });
ok(call('handleBotKbList', {}).items.find((x) => x.ID === saved.id).images.length === 0, '帶空陣列 = 移除全部圖片');
call('handleBotKbSave', { type: 'qa', id: saved.id, rowIndex: item.RowIndex, question: '系統架構是什麼', content: '如圖二', images: [{ id: imgId, caption: '系統架構圖' }] });
// 文件：整份的圖片掛在每一段
const doc = call('handleBotKbDocSave', { title: '安裝手冊', chunks: [{ content: 'a' }, { content: 'b' }], images: [{ id: imgId, caption: '接線圖' }] });
ok(doc.success && call('handleBotKbList', {}).items.filter((x) => x.FileName === doc.key).every((x) => x.images.length === 1 && x.images[0].caption === '接線圖'), '文件每一段都掛上圖片');

// ---- 客服看到的知識：有圖片資訊；關掉「附圖」就沒有 ----
call('handleBotSaveSettings', { cs: Object.assign(form, { sendImages: true }) });
let kb = api('csKnowledge', V).data;
const qa = kb.find((c) => c.id === 'k' + saved.id);
ok(qa && qa.images.length === 1 && qa.images[0].id === imgId && qa.images[0].caption === '系統架構圖', '客服知識帶圖片代號與說明');
call('handleBotSaveSettings', { cs: Object.assign(form, { sendImages: false }) });
kb = api('csKnowledge', V).data;
ok(kb.find((c) => c.id === 'k' + saved.id).images.length === 0, '關閉附圖 → 知識裡沒有圖片');
call('handleBotSaveSettings', { cs: Object.assign(form, { sendImages: true }) });

// ---- 對話紀錄：附圖的回覆記下圖片標記 ----
api('csRemember', V, { turns: [{ u: true, t: '架構圖？' }, { u: false, t: '如下圖' }], images: [{ url: 'https://x.vercel.app/api/img?id=abc', caption: '系統架構圖' }] });
const thread = api('csThread', V, {}).data.messages;
const last = thread[thread.length - 1];
ok(last.role === 'bot' && /如下圖\n\[\[img:https:\/\/x\.vercel\.app\/api\/img\?id=abc\|系統架構圖\]\]/.test(last.text), '對話紀錄在回覆後面記下圖片標記：' + JSON.stringify(last.text));
ok(!ctx.sheetToObjects('BotMessages').rows.some((m) => m.Role === 'user' && /\[\[img:/.test(m.Text)), '客人的話不會被加標記');
console.log('leads & images checks passed:', pass);
