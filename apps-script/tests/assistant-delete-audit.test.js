// 員工助理：依使用者權限新增 / 修改 / 刪除（刪除要有刪除權限，本人確認才執行），做的任何事都記在備忘錄（稽核）
const assert = require('assert');
const path = require('path');
const { makeEnv } = require('./gasmock');
const { ctx } = makeEnv({ files: [path.join(__dirname, '..', 'Code.gs')], fetch: () => ({ code: 404, body: '' }) });
let pass = 0;
const ok = (c, m) => {
  assert.ok(c, m);
  pass++;
};
const mk = (u, role, perms, name) => ctx.appendObjectRow('Users', { Username: u, PasswordHash: 'x', Role: role, DisplayName: name || u, Perms: perms ? JSON.stringify(perms) : '' });
mk('admin1', 'admin', null, '管理員');
mk('ed', 'editor', null, '編輯小明');
mk('botman', 'limited', { bot: 'edit' }, '機器人管理');
mk('nobot', 'limited', { products: 'view' }, '沒權限');
const call = (fn, body, u) => ctx[fn](Object.assign({ _user: { username: u || 'admin1', displayName: u || 'admin1' } }, body));
const stKey = call('handleBotGenKey', { role: 'staff' }).key;
call('handleBotSaveStaff', { config: { enabled: true, webEnabled: true } });
const bot = (op, id, extra) => ctx.handleBotApi(Object.assign({ secret: stKey, op, lineUserId: id }, extra || {}));
const member = (n, user, role) => {
  const id = 'U' + String(n).repeat(32);
  bot('start', id, { displayName: 'LINE-' + n });
  call('handleBotMemberSave', Object.assign({ lineUserId: id, status: '已開通', role }, user ? { linkedUsername: user } : {}));
  return id;
};
const AD = member(1, 'admin1', 'editor'); // 綁定系統管理員的帳號
const ED = member(2, 'ed', 'editor'); // 綁定編輯者
const NL = member(3, '', 'editor'); // 沒綁定網站帳號
const callTool = (id, c, p) => bot('call', id, { call: c, params: p || {} });
const stage = (id, ops) => bot('stage', id, { ops });
const commit = (id, ops) => {
  const s = stage(id, ops);
  return s.success ? bot('commit', id, { token: s.data.token }) : s;
};
const rows = (sheet) => ctx.sheetToObjects(sheet).rows;
const writable = (id) => bot('start', id).data.writable;

// ---------- 資料 ----------
ctx.appendObjectRow('Customers', { CompanyName: '甲公司', Contact: '王' });
ctx.appendObjectRow('Customers', { CompanyName: '乙公司', Contact: '李' });
ctx.appendObjectRow('Customers', { CompanyName: '丙公司', Contact: '趙' });
ctx.appendObjectRow('CustomerContacts', { CompanyName: '乙公司', ContactName: '李經理', Phone: '1' });
ctx.appendObjectRow('Cases', { CaseID: 'C-1', CustomerName: '甲公司', Status: '需求單已發出' });
ctx.appendObjectRow('Cases', { CaseID: 'C-2', CustomerName: '丙公司', Status: '需求單已發出' });
ctx.appendObjectRow('Products', { InternalModel: 'P-1', SupplierModel: 'S-1', Supplier: '供應商' });
ctx.appendObjectRow('Products', { InternalModel: 'P-2', SupplierModel: 'S-2' });
ctx.appendObjectRow('PriceHistory', { Date: '2026-09-01', ProductInternalModel: 'P-1', Supplier: '供應商', Price: 100, Currency: 'TWD' });
ctx.appendObjectRow('PriceHistory', { Date: '2026-10-01', ProductInternalModel: 'P-1', Supplier: '供應商', Price: 120, Currency: 'TWD' });
ctx.appendObjectRow('PriceHistory', { Date: '2026-10-01', ProductInternalModel: 'P-1', Supplier: '供應商B', Price: 120, Currency: 'TWD' });
ctx.appendObjectRow('CopyPosts', { ID: 1, Platform: 'Threads', Topic: '舊文案', Content: 'x', Status: 'draft', CreatedBy: 'ed' });

// ---------- 誰能刪除 ----------
const wAd = writable(AD);
const wEd = writable(ED);
const wNl = writable(NL);
const dels = ['deleteCustomer', 'deleteContact', 'deleteCase', 'deleteProduct', 'deletePriceRecord', 'deleteCopyPost'];
ok(dels.every((k) => wAd.includes(k)), '綁定系統管理員的助理：可以提出刪除（本人確認才執行）');
ok(dels.every((k) => !wEd.includes(k)) && !wNl.includes('deleteCustomer'), '綁定編輯者 / 沒綁定的：不能刪除系統資料（跟網站一樣只有系統管理員能刪）');
ok(['deleteEvent', 'deleteTodo', 'deleteMemo'].every((k) => wAd.includes(k) && wEd.includes(k)), '自己的行事曆 / 工作 / 備忘錄：綁定帳號的人都能刪');
ok(!wNl.includes('deleteEvent') && !wNl.includes('deleteTodo'), '沒綁定網站帳號：連自己的也不能刪（沒有「自己的」）');
let r = stage(ED, [{ action: 'deleteCustomer', data: { company: '乙公司' } }]);
ok(!r.success && r.message.includes('刪除需要網站帳號有刪除權限'), '編輯者提出刪除客戶 → 被擋：' + r.message);
r = stage(NL, [{ action: 'deleteCase', data: { caseId: 'C-1' } }]);
ok(!r.success, '沒綁定帳號提出刪除案件 → 被擋');

// ---------- 刪除（系統管理員）----------
r = stage(AD, [{ action: 'deleteCustomer', data: { company: '甲公司' } }]);
ok(!r.success && r.message.includes('底下還有 1 個案件'), '客戶底下還有案件 → 要明確確認（force）：' + r.message);
r = stage(AD, [{ action: 'deleteCustomer', data: { company: '乙公司' } }]);
ok(r.success && r.data.summary.includes('🗑️') && r.data.summary.includes('無法復原'), '提出刪除：摘要標示無法復原');
ok(rows('Customers').some((c) => c.CompanyName === '乙公司'), '還沒確認 → 資料還在');
r = bot('commit', AD, { token: r.data.token });
ok(r.success && !rows('Customers').some((c) => c.CompanyName === '乙公司'), '確認後才刪除');
r = commit(AD, [{ action: 'deleteCustomer', data: { company: '甲公司', force: true } }]);
ok(r.success && !rows('Customers').some((c) => c.CompanyName === '甲公司'), '底下有案件，明確 force 後可以刪');
r = stage(AD, [{ action: 'deleteCustomer', data: { company: '不存在' } }]);
ok(!r.success && r.message.includes('找不到客戶'), '找不到客戶');
ctx.appendObjectRow('CustomerContacts', { CompanyName: '丙公司', ContactName: '趙經理', Phone: '2' });
ok(!stage(AD, [{ action: 'deleteContact', data: { company: '丙公司', contactName: '沒這個人' } }]).success, '找不到聯絡窗口');
r = commit(AD, [{ action: 'deleteContact', data: { company: '丙公司', contactName: '趙經理' } }]);
ok(r.success && !rows('CustomerContacts').some((c) => c.ContactName === '趙經理'), '刪聯絡窗口');
r = commit(AD, [{ action: 'deleteCase', data: { caseId: 'C-2' } }]);
ok(r.success && !rows('Cases').some((c) => c.CaseID === 'C-2') && rows('Cases').some((c) => c.CaseID === 'C-1'), '刪案件（只刪指定的）');
r = commit(AD, [{ action: 'deleteProduct', data: { internalModel: 'p-2' } }]);
ok(r.success && !rows('Products').some((c) => c.InternalModel === 'P-2') && rows('Products').some((c) => c.InternalModel === 'P-1'), '刪產品（型號不分大小寫）');
r = stage(AD, [{ action: 'deletePriceRecord', data: { internalModel: 'P-1', date: '2026-10-01', price: 120 } }]);
ok(!r.success && r.message.includes('2 筆'), '同日同價有兩筆 → 不猜，擋下：' + r.message);
ok(!stage(AD, [{ action: 'deletePriceRecord', data: { internalModel: 'P-1', price: 100 } }]).success, '沒給日期 → 擋');
r = commit(AD, [{ action: 'deletePriceRecord', data: { internalModel: 'P-1', date: '2026-09-01', price: 100 } }]);
ok(r.success && rows('PriceHistory').length === 2 && !rows('PriceHistory').some((h) => Number(h.Price) === 100), '刪一筆報價紀錄');
r = commit(AD, [{ action: 'deleteCopyPost', data: { id: 1 } }]);
ok(r.success && rows('CopyPosts').length === 0, '刪文案');
call('handleBotSaveStaff', { config: { hidePrice: true } });
ok(!writable(AD).includes('deletePriceRecord') && !stage(AD, [{ action: 'deletePriceRecord', data: { internalModel: 'P-1', date: '2026-10-01', price: 120 } }]).success, '隱藏價格時不能刪報價紀錄');
call('handleBotSaveStaff', { config: { hidePrice: false } });
call('handleBotSaveStaff', { config: { ceiling: { products: 'view' } } });
ok(!writable(AD).includes('deleteProduct') && !stage(AD, [{ action: 'deleteProduct', data: { internalModel: 'P-1' } }]).success, '管理員設的上限壓低到只能查看 → 連系統管理員的助理也不能刪');
call('handleBotSaveStaff', { config: { ceiling: { products: 'edit' } } });
call('handleBotSaveStaff', { config: { writes: ['addMemo', 'deleteMemo'] } });
r = stage(AD, [{ action: 'deleteProduct', data: { internalModel: 'P-1' } }]);
ok(!r.success && r.message.includes('沒有開放'), '管理員沒開放該項目 → 不能刪');
call('handleBotSaveStaff', { config: { writes: Object.keys(call('handleBotGetStaff', {}).writes.reduce((o, w) => ((o[w.key] = 1), o), {})) } });

// ---------- 自己的行事曆 / 工作 / 備忘錄 ----------
call('handleCalSaveEvent', { title: '我的行程', startDate: '2026-12-01' }, 'ed');
call('handleCalSaveEvent', { title: '別人的行程', startDate: '2026-12-02', shareMode: 'all' }, 'admin1');
call('handleTodoSave', { title: '我的工作' }, 'ed');
call('handleTodoSave', { title: '別人的工作', shareMode: 'all' }, 'admin1');
call('handleAddMemo', { title: '我的備忘', content: '私人' }, 'ed');
const evMine = rows('CalEvents').find((e) => e.Title === '我的行程');
const evOther = rows('CalEvents').find((e) => e.Title === '別人的行程');
ok(!stage(ED, [{ action: 'deleteEvent', data: { id: Number(evOther.ID) } }]).success && stage(ED, [{ action: 'deleteEvent', data: { id: Number(evOther.ID) } }]).message.includes('不是你的'), '不能刪別人的行程');
ok(commit(ED, [{ action: 'deleteEvent', data: { id: Number(evMine.ID) } }]).success && !rows('CalEvents').some((e) => e.Title === '我的行程'), '刪自己的行程');
const tdOther = rows('Todos').find((t) => t.Title === '別人的工作');
ok(!stage(ED, [{ action: 'deleteTodo', data: { id: Number(tdOther.ID) } }]).success, '不能刪別人的工作');
ok(commit(ED, [{ action: 'deleteTodo', data: { id: Number(rows('Todos').find((t) => t.Title === '我的工作').ID) } }]).success && !rows('Todos').some((t) => t.Title === '我的工作'), '刪自己的工作');
const memos = callTool(ED, 'memos', {}).data.items;
const myMemo = memos.find((m) => m.Title === '我的備忘');
ok(myMemo && myMemo.ref >= 2 && memos.every((m) => m.Mine || m.ref === undefined), '備忘錄查詢帶編號（只有自己的一般備忘錄才有）');
ok(!stage(ED, [{ action: 'deleteMemo', data: { rowIndex: myMemo.ref, title: '標題不對' } }]).success, '標題對不上就不刪（避免列號位移刪錯）');
ok(commit(ED, [{ action: 'deleteMemo', data: { rowIndex: myMemo.ref, title: '我的備忘' } }]).success && !rows('Memos').some((m) => m.Title === '我的備忘'), '刪自己的備忘錄');
const sysMemo = rows('Memos').findIndex((m) => m.LinkType === 'staffAudit') + 2;
ok(sysMemo >= 2 && !stage(ED, [{ action: 'deleteMemo', data: { rowIndex: sysMemo } }]).success, '助理紀錄 / 系統通知備忘錄不能被助理刪除');

// ---------- 助理紀錄（備忘錄）----------
const audit = () => rows('Memos').filter((m) => m.LinkType === 'staffAudit');
const mineAudit = (key) => audit().filter((m) => String(m.LinkId).indexOf(key + '|') === 0);
ok(mineAudit('ed').length === 1 && mineAudit('admin1').length === 1, '每位成員每天一則助理紀錄（用綁定的帳號歸戶）：' + audit().map((m) => m.Title).join(' / '));
const adLog = mineAudit('admin1')[0];
ok(adLog.Title.includes('admin1') && adLog.Title.includes('（LINE）') && adLog.NeedBlock === 'bot' && adLog.OwnerName === '員工助理' && adLog.Owner === 'SYSTEM', '標題、歸屬、只給有 BOT 設定權限的人');
for (const frag of ['📝 提出修改，等本人確認：🗑️ ⚠️ 刪除客戶「乙公司」', '🗑️ 已執行：🗑️ ⚠️ 刪除客戶「乙公司」', '🗑️ 已執行：🗑️ ⚠️ 刪除案件「C-2」', '⛔ 提出修改被擋：']) ok(adLog.Content.includes(frag), '紀錄含：' + frag);
callTool(AD, 'customers', { keyword: '丙' });
callTool(AD, 'case', { caseId: 'C-1' });
bot('stage', AD, { ops: [{ action: 'addMemo', data: { title: 't', content: 'c' } }] });
bot('cancel', AD);
callTool(NL, 'customers', {});
const adContent = mineAudit('admin1')[0].Content;
ok(/🔎 查詢 客戶（keyword=丙）/.test(adContent) && /🔎 查詢 案件詳情（caseId=C-1）/.test(adContent), '查詢也記錄（含條件）');
ok(/↩️ 取消待確認的修改：.*新增備忘錄/.test(adContent), '取消也記錄');
ok(/^\d\d:\d\d /m.test(adContent), '每行有時間');
const edContent = mineAudit('ed')[0].Content;
ok(/⛔ 提出修改被擋：刪除需要網站帳號有刪除權限/.test(edContent), '被擋下的嘗試也記錄（誰想刪什麼）');
ok(/✅ 已執行：.*刪除行程|🗑️ 已執行：🗑️ 刪除行程/.test(edContent), '刪自己的行程有記錄');
ok(mineAudit('U' + '3'.repeat(32)).length === 1 && /客戶/.test(mineAudit('U' + '3'.repeat(32))[0].Content), '沒綁定帳號的成員用 LINE 編號歸戶');
// 機器人伺服器回報自己做的事（搜尋知識庫、選型計算）
ok(bot('audit', AD, { kind: 'read', text: '搜尋知識庫：環形光源' }).success, 'audit op');
ok(mineAudit('admin1')[0].Content.includes('🔎 搜尋知識庫：環形光源'), '機器人伺服器回報的動作也記錄');
ok(!bot('audit', 'U' + '9'.repeat(32), { kind: 'read', text: 'x' }).data, '沒登記的人不能寫紀錄');
const csKey = call('handleBotGenKey', { role: 'cs' }).key;
ok(!ctx.handleBotApi({ secret: csKey, op: 'audit', lineUserId: AD, kind: 'read', text: 'x' }).success, '客服金鑰不能寫助理紀錄');

// 誰看得到 / 誰能改
const rowOf = (m) => rows('Memos').findIndex((x) => x.LinkId === m.LinkId) + 2;
ok(call('handleGetMemos', {}, 'botman').memos.some((m) => m.LinkType === 'staffAudit'), '有 BOT 設定權限的人看得到助理紀錄');
ok(!call('handleGetMemos', {}, 'nobot').memos.some((m) => m.LinkType === 'staffAudit'), '沒有 BOT 設定權限的人看不到');
let threw = '';
try {
  call('handleDeleteMemo', { rowIndex: rowOf(adLog) }, 'botman');
} catch (e) {
  threw = e.message;
}
ok(threw.includes('只有系統管理員'), 'BOT 設定的編輯者也不能刪助理紀錄：' + threw);
threw = '';
try {
  call('handleUpdateMemo', { rowIndex: rowOf(adLog), fields: { Content: '竄改' } }, 'botman');
} catch (e) {
  threw = e.message;
}
ok(threw.includes('只有系統管理員'), '也不能改');
ok(rows('Memos').find((m) => m.LinkId === adLog.LinkId).Content.includes('刪除客戶'), '內容沒被動到');

// ---------- 設定：關閉 / 只記寫入 ----------
const before = mineAudit('admin1')[0].Content.length;
call('handleBotSaveStaff', { config: { audit: { enabled: true, reads: false } } });
callTool(AD, 'customers', { keyword: '不記查詢' });
ok(mineAudit('admin1')[0].Content.length === before && !mineAudit('admin1')[0].Content.includes('不記查詢'), '只記修改、不記查詢');
commit(AD, [{ action: 'addMemo', data: { title: '寫入仍記錄', content: 'c' } }]);
ok(mineAudit('admin1')[0].Content.includes('寫入仍記錄'), '寫入仍然記錄');
call('handleBotSaveStaff', { config: { audit: { enabled: false } } });
const b2 = mineAudit('admin1')[0].Content.length;
commit(AD, [{ action: 'addMemo', data: { title: '關閉後不記', content: 'c' } }]);
ok(mineAudit('admin1')[0].Content.length === b2, '整個關掉就不記');
ok(call('handleBotGetStaff', {}).config.audit.enabled === false, '設定頁讀得到稽核設定');
call('handleBotSaveStaff', { config: { audit: { enabled: true, reads: true } } });

// ---------- 內容太長會續寫新的一則 ----------
ctx.BOT_AUDIT_MAX = 600;
for (let i = 0; i < 8; i++) callTool(AD, 'customers', { keyword: '很長的查詢條件' + i });
const parts = mineAudit('admin1');
ok(parts.length >= 2 && parts.some((m) => m.Title.includes('（續）')) && parts.slice(1).every((m) => String(m.Content).length <= 700), '超過上限就續寫新的一則：' + parts.length + ' 則');
console.log('assistant delete/audit checks passed:', pass);
