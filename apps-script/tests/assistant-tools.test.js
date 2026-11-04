const assert = require('assert');
const path = require('path');
const { makeEnv } = require('./gasmock');
const { ctx } = makeEnv({ files: [path.join(__dirname, '..', 'Code.gs')], fetch: () => ({ code: 404, body: '' }) });
const drafts = [];
ctx.GmailApp = { createDraft: (to, subject, body) => (drafts.push({ to, subject, body }), { getId: () => 'D' + drafts.length }) };
let pass = 0;
const ok = (c, m) => {
  assert.ok(c, m);
  pass++;
};
const mk = (u, role, perms) => ctx.appendObjectRow('Users', { Username: u, PasswordHash: 'x', Role: role, DisplayName: u, Perms: perms ? JSON.stringify(perms) : '' });
mk('admin1', 'admin');
mk('ed', 'editor');
mk('vw', 'viewer');
mk('prod', 'limited', { products: 'edit' });
const call = (fn, body) => ctx[fn](Object.assign({ _user: { username: 'admin1', displayName: 'admin1' } }, body));
const stKey = call('handleBotGenKey', { role: 'staff' }).key;
const bot = (op, id, extra) => ctx.handleBotApi(Object.assign({ secret: stKey, op, lineUserId: id }, extra || {}));
const callTool = (id, c, p) => bot('call', id, { call: c, params: p || {} });

call('handleBotSaveStaff', { config: { enabled: true, webEnabled: true } });
const member = (n, user, role, perms) => {
  const id = 'U' + String(n).repeat(32);
  bot('start', id);
  call('handleBotMemberSave', Object.assign({ lineUserId: id, status: '已開通', role, linkedUsername: user }, perms ? { perms } : {}));
  return id;
};
const ED = member(1, 'ed', 'editor');
const VW = member(2, 'vw', 'viewer');
const PR = member(3, 'prod', 'limited', { products: 'edit' });

ctx.appendObjectRow('Customers', { CompanyName: '甲公司', Contact: '王先生', Phone: '02-1111' });
ctx.appendObjectRow('Cases', { CaseID: 'C-1', CustomerName: '甲公司', Status: '需求單已發出', Urgency: '中', CreatedDate: '2026-11-01' });
ctx.appendObjectRow('Products', { InternalModel: 'ACA2440', SupplierModel: 'Basler ace', Supplier: '供應商X', SupplierContact: '陳小姐', SupplierContactEmail: 'x@sup.com', Category: '相機', Brand: 'Basler', Resolution: '2448x2048', Interface: 'GigE', RefPrice: 15000, CompatibleGroup: 'G1', Notes: '舊備註' });
ctx.appendObjectRow('Products', { InternalModel: 'ACA2500', SupplierModel: 'Basler ace2', Category: '相機', CompatibleGroup: 'G1' });
ctx.appendObjectRow('Products', { InternalModel: 'NOMAIL', SupplierModel: 'No mail', Supplier: '供應商Z' });
ctx.appendObjectRow('PriceHistory', { Date: '2026-09-01', ProductInternalModel: 'ACA2440', Supplier: '供應商X', Price: 14000, Currency: 'TWD' });
ctx.appendObjectRow('PriceHistory', { Date: '2026-10-15', ProductInternalModel: 'ACA2440', Supplier: '供應商X', Price: 14500, Currency: 'TWD', CaseID: 'C-1' });
ctx.appendObjectRow('CopyPosts', { ID: 1, Platform: 'Threads', Topic: '環形光源', Keywords: '光源', Tone: '親切', Content: '光源很重要，這是第一篇內文', Status: 'draft', CreatedBy: 'ed', CreatedAt: '2026-11-01', UpdatedAt: '2026-11-02' });
ctx.appendObjectRow('CopyLibrary', { ID: 1, Kind: 'style', Name: '品牌口吻', Text: '專業但不說教', Platform: '', Enabled: true });
ctx.appendObjectRow('CopyLibrary', { ID: 2, Kind: 'prompt', Name: '停用的', Text: '不該出現', Platform: '', Enabled: false });

// ---------- 讀取 ----------
let r = callTool(ED, 'product', { internalModel: 'aca2440' });
ok(r.success && r.data.product.InternalModel === 'ACA2440' && r.data.product.RefPrice == 15000 && r.data.product.Supplier === '供應商X', '產品詳情（不分大小寫，有權限含底價 / 供應商）');
ok(r.data.compatible.length === 1 && r.data.compatible[0].InternalModel === 'ACA2500', '相容產品');
ok(r.data.priceCount === 2 && r.data.priceHistory[0].Price === 14500 && r.data.priceHistory[0].CaseID === 'C-1', '最近報價在前面');
r = callTool(ED, 'product', { internalModel: 'ACA24' });
ok(!r.success && r.message.includes('ACA2440'), '找不到時提示相近型號：' + r.message);
r = callTool(ED, 'product', { internalModel: 'Basler ace' });
ok(r.success && r.data.product.InternalModel === 'ACA2440', '用供應商型號也找得到');
r = callTool(ED, 'priceHistory', { internalModel: 'ACA2440' });
ok(r.success && r.data.total === 2 && r.data.items[1].Price === 14000, '價格紀錄');
r = callTool(ED, 'inquiryDraft', { internalModel: 'ACA2440', quantity: '10' });
ok(r.success && r.data.to === 'x@sup.com' && r.data.body.includes('需求數量: 10') && r.data.body.includes('14500') && r.data.body.includes('陳小姐'), '詢價信文字草稿');
ok(drafts.length === 0, '產生文字草稿不會建立 Gmail 草稿');
r = callTool(PR, 'copyPosts', {});
ok(!r.success && r.message.includes('文案'), '只有產品權限沒有文案權限：' + r.message);
ok(callTool(VW, 'copyPosts', {}).success, '查看者可以看文案');
r = bot('stage', VW, { ops: [{ action: 'saveCopyPost', data: { content: 'x' } }] });
ok(!r.success && r.message.includes('編輯權限'), '查看者不能存文案');
r = callTool(ED, 'copyPosts', { keyword: '光源' });
ok(r.success && r.data.total === 1 && r.data.items[0].content.includes('第一篇'), '查文案');
r = callTool(ED, 'copyStyle', {});
ok(r.success && r.data.library.length === 1 && r.data.library[0].name === '品牌口吻' && r.data.platforms.includes('Threads') && !JSON.stringify(r.data).includes('不該出現'), '文案風格只含啟用中的');
ok(!callTool(PR, 'copyPosts', {}).success, '只有產品權限 → 看不到文案');
ok(!callTool(PR, 'customers', {}).success && callTool(PR, 'product', { internalModel: 'ACA2440' }).success, '只有產品權限 → 看得到產品');

// 隱藏價格
call('handleBotSaveStaff', { config: { hidePrice: true } });
r = callTool(ED, 'product', { internalModel: 'ACA2440' });
ok(r.success && r.data.product.RefPrice === undefined && r.data.product.Supplier === undefined && r.data.product.SupplierContactEmail === undefined && r.data.priceHistory === undefined, '隱藏價格：詳情不含底價 / 供應商 / 報價');
ok(!callTool(ED, 'priceHistory', { internalModel: 'ACA2440' }).success && !callTool(ED, 'inquiryDraft', { internalModel: 'ACA2440' }).success, '隱藏價格：不能查價格紀錄 / 詢價信');
ok(!JSON.stringify(callTool(ED, 'product', { internalModel: 'ACA2440' })).includes('15000'), '隱藏價格：回應完全沒有底價');
let w = bot('start', ED).data.writable;
ok(!w.includes('addPriceRecord') && !w.includes('createInquiryDraft') && w.includes('updateProduct'), '隱藏價格：價格類寫入不開放');
r = bot('stage', ED, { ops: [{ action: 'updateProduct', data: { internalModel: 'ACA2440', fields: { RefPrice: '1' } } }] });
ok(!r.success && r.message.includes('不處理價格'), '隱藏價格：不能改底價：' + r.message);
r = bot('stage', ED, { ops: [{ action: 'addPriceRecord', data: { internalModel: 'ACA2440', price: 1 } }] });
ok(!r.success, '隱藏價格：不能記報價');
call('handleBotSaveStaff', { config: { hidePrice: false } });

// ---------- 寫入 ----------
const run = (who, ops) => {
  const s = bot('stage', who, { ops });
  if (!s.success) return s;
  return bot('commit', who, { token: s.data.token });
};
// 報價紀錄
r = bot('stage', ED, { ops: [{ action: 'addPriceRecord', data: { internalModel: 'aca2440', price: 'abc' } }] });
ok(!r.success && r.message.includes('大於 0'), '價格必須是數字');
r = bot('stage', ED, { ops: [{ action: 'addPriceRecord', data: { internalModel: 'NOPE', price: 100 } }] });
ok(!r.success && r.message.includes('找不到產品'), '產品要存在');
r = bot('stage', ED, { ops: [{ action: 'addPriceRecord', data: { internalModel: 'ACA2440', price: 100, currency: 'dollars' } }] });
ok(!r.success && r.message.includes('3 碼'), '幣別格式');
r = bot('stage', ED, { ops: [{ action: 'addPriceRecord', data: { internalModel: 'ACA2440', price: 100, caseId: 'NOPE' } }] });
ok(!r.success && r.message.includes('找不到案件'), '案件要存在');
r = run(ED, [{ action: 'addPriceRecord', data: { internalModel: 'aca2440', price: '14,800', currency: 'usd', caseId: 'C-1', notes: 'LINE 報的' } }]);
ok(r.success && r.data.count === 1, '記報價');
r = callTool(ED, 'priceHistory', { internalModel: 'ACA2440' });
const newest = r.data.items.find((x) => x.Price === 14800);
ok(r.data.total === 3 && newest && newest.Currency === 'USD' && newest.Supplier === '供應商X' && newest.CaseID === 'C-1', '報價寫入：供應商預設用產品的、幣別轉大寫');

// 新增 / 修改產品
r = bot('stage', ED, { ops: [{ action: 'addProduct', data: { internalModel: 'ACA2440', fields: {} } }] });
ok(!r.success && r.message.includes('已經存在'), '內部型號不能重複');
r = bot('stage', ED, { ops: [{ action: 'addProduct', data: { internalModel: 'NEW1', fields: { Hacker: 'x' } } }] });
ok(!r.success && r.message.includes('不能設定這個欄位'), '欄位白名單');
r = run(ED, [{ action: 'addProduct', data: { internalModel: 'NEW1', fields: { SupplierModel: 'S-1', Brand: 'Computar', Category: '鏡頭', FocalLength: '25', FocusWD: '100', FPS: '30', WD: '110', Supplier: '供應商Q', RefPrice: '3000' } } }]);
ok(r.success, '新增產品');
const np = ctx.sheetToObjects('Products').rows.find((x) => x.InternalModel === 'NEW1');
ok(np && np.Brand === 'Computar' && np.FocalLength == 25 && np.FocusWD == 100 && np.FPS == 30 && np.WD == 110 && np.Supplier === '供應商Q' && np.RefPrice == 3000 && np.LastUpdated, '產品欄位對應（FPS / WD / FocusWD 大小寫特例）');
r = bot('stage', ED, { ops: [{ action: 'updateProduct', data: { internalModel: 'ACA2440', fields: { InternalModel: 'X' } } }] });
ok(!r.success && r.message.includes('不能用助理修改'), '不能改內部型號');
r = run(ED, [{ action: 'updateProduct', data: { internalModel: 'aca2440', fields: { Notes: '新備註', Resolution: '5MP' } } }]);
ok(r.success, '修改產品');
const up = ctx.sheetToObjects('Products').rows.find((x) => x.InternalModel === 'ACA2440');
ok(up.Notes === '新備註' && up.Resolution === '5MP' && up.Brand === 'Basler', '只改指定欄位');
// 只有查看
r = bot('stage', VW, { ops: [{ action: 'addPriceRecord', data: { internalModel: 'ACA2440', price: 1 } }] });
ok(!r.success && r.message.includes('編輯權限'), '查看者不能記報價：' + r.message);
r = bot('stage', PR, { ops: [{ action: 'addContact', data: { company: '甲公司', contactName: '李' } }] });
ok(!r.success && r.message.includes('編輯權限'), '只有產品權限不能加聯絡人');
ok(bot('start', PR).data.writable.includes('updateProduct') && !bot('start', PR).data.writable.includes('saveCopyPost'), '只有產品權限的 writable');

// 詢價信草稿
r = bot('stage', ED, { ops: [{ action: 'createInquiryDraft', data: { internalModel: 'NOMAIL' } }] });
ok(!r.success && r.message.includes('沒有填供應商 Email'), '沒有供應商信箱不能建立草稿');
r = bot('stage', ED, { ops: [{ action: 'createInquiryDraft', data: { internalModel: 'ACA2440', quantity: '20' } }] });
ok(r.success && r.data.summary.includes('不寄出') && drafts.length === 0, 'stage 階段不建立草稿');
r = bot('commit', ED, { token: r.data.token });
ok(r.success && drafts.length === 1 && drafts[0].to === 'x@sup.com' && drafts[0].body.includes('需求數量: 20') && drafts[0].subject.includes('ACA2440'), '確認後才建立 Gmail 草稿');
ok(r.data.results[0].draftUrl && r.data.results[0].draftUrl.includes('compose='), '回傳草稿連結');

// 聯絡窗口
r = bot('stage', ED, { ops: [{ action: 'addContact', data: { company: '不存在公司', contactName: '李' } }] });
ok(!r.success && r.message.includes('找不到客戶'), '客戶要存在');
r = run(ED, [{ action: 'addContact', data: { company: '甲公司', contactName: '李經理', title: '採購', phone: '0911', email: 'li@a.com' } }]);
ok(r.success, '新增聯絡窗口');
r = bot('stage', ED, { ops: [{ action: 'addContact', data: { company: '甲公司', contactName: '李經理' } }] });
ok(!r.success && r.message.includes('已經有聯絡人'), '同名聯絡人不重複');
r = callTool(ED, 'customer', { companyName: '甲公司' });
ok(r.data.contacts.some((c) => c.ContactName === '李經理' && c.Title === '採購'), '查得到新窗口');

// 案件內容
r = bot('stage', ED, { ops: [{ action: 'updateCase', data: { caseId: 'C-1', fields: { Status: '已結案' } } }] });
ok(!r.success && r.message.includes('不能用助理修改這個欄位'), '狀態不能走 updateCase（走專用的）');
r = bot('stage', ED, { ops: [{ action: 'updateCase', data: { caseId: 'C-1', fields: { CustomerName: '乙公司' } } }] });
ok(!r.success, '不能改案件客戶');
r = run(ED, [{ action: 'updateCase', data: { caseId: 'C-1', fields: { RequirementDetails: '需要 5MP 以上', ProjectContact: '張工', EvaluationResult: '可行' } } }]);
ok(r.success, '修改案件內容');
r = callTool(ED, 'case', { caseId: 'C-1' });
ok(r.data.RequirementDetails === '需要 5MP 以上' && r.data.ProjectContact === '張工' && r.data.EvaluationResult === '可行' && r.data.Status === '需求單已發出', '案件內容更新、狀態不變');

// 文案
r = bot('stage', ED, { ops: [{ action: 'saveCopyPost', data: { platform: 'Tiktok', content: 'x' } }] });
ok(!r.success && r.message.includes('平台只能是'), '平台驗證');
r = bot('stage', ED, { ops: [{ action: 'saveCopyPost', data: { content: 'x', scheduledFor: '明天' } }] });
ok(!r.success && r.message.includes('YYYY-MM-DD'), '預排日期格式');
r = run(ED, [{ action: 'saveCopyPost', data: { platform: 'Instagram', topic: '新品', keywords: '相機', tone: '專業', content: '新品上市！', scheduledFor: '2026-11-20' } }]);
ok(r.success, '存文案');
let posts = ctx.sheetToObjects('CopyPosts').rows;
const np2 = posts.find((x) => x.Topic === '新品');
ok(np2 && np2.Platform === 'Instagram' && np2.Status === 'scheduled' && String(np2.ScheduledFor).slice(0, 10) === '2026-11-20' && np2.CreatedBy === 'ed', '新文案：預排、記錄建立者');
r = run(ED, [{ action: 'saveCopyPost', data: { id: 1, content: '改過的內文' } }]);
ok(r.success, '修改既有文案');
posts = ctx.sheetToObjects('CopyPosts').rows;
const p1 = posts.find((x) => Number(x.ID) === 1);
ok(p1.Content === '改過的內文' && p1.Topic === '環形光源' && p1.Platform === 'Threads' && p1.Status === 'draft', '只改內文，其他保留，狀態不變成預排');
r = bot('stage', ED, { ops: [{ action: 'saveCopyPost', data: { id: 99, content: 'x' } }] });
ok(!r.success && r.message.includes('找不到這篇文案'), '修改不存在的文案');
r = bot('stage', ED, { ops: [{ action: 'deleteProduct', data: { internalModel: 'ACA2440' } }] });
ok(!r.success, '仍然沒有任何刪除');

// 管理員可以關掉個別寫入
call('handleBotSaveStaff', { config: { writes: ['addMemo'] } });
r = bot('stage', ED, { ops: [{ action: 'addPriceRecord', data: { internalModel: 'ACA2440', price: 1 } }] });
ok(!r.success && r.message.includes('沒有開放'), '管理員沒開放就不能提出：' + r.message);
ok(bot('start', ED).data.writable.join() === 'addMemo', 'writable 只剩管理員開放的');
ok(call('handleBotGetStaff', {}).writes.map((x) => x.key).includes('saveCopyPost'), '設定頁看得到新寫入項目');
console.log('assistant tool checks passed:', pass);
