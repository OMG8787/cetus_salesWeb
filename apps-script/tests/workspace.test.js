const assert = require('assert');
const path = require('path');
const { makeEnv } = require('./gasmock');
const { ctx } = makeEnv({ files: [path.join(__dirname, '..', 'Code.gs')], fetch: () => ({ code: 404, body: '' }) });
let gcalCalls = 0;
ctx.CalendarApp = { getDefaultCalendar: () => (gcalCalls++, { getEventById: () => null, createEvent: () => ({ getId: () => 'G1' }), createAllDayEvent: () => ({ getId: () => 'G2' }), getEvents: () => [] }) };
let pass = 0;
const ok = (c, m) => {
  assert.ok(c, m);
  pass++;
};
const mk = (u, role, perms, name) => ctx.appendObjectRow('Users', { Username: u, PasswordHash: 'x', Role: role, DisplayName: name || u, Perms: perms ? JSON.stringify(perms) : '' });
mk('admin1', 'admin', null, '管理員');
mk('amy', 'editor', null, '艾咪');
mk('bob', 'viewer', null, '鮑勃');
mk('cat', 'limited', { products: 'view' }, '凱特');
mk('dan', 'editor', null, '丹');
const U = (u) => ({ username: u, displayName: u });
const run = (fn, u, body) => ctx[fn](Object.assign({ _user: U(u) }, body || {}));
const can = (u, a) => {
  try {
    ctx.requirePermission_(a, { username: u });
    return true;
  } catch (e) {
    return false;
  }
};

// ---------- 權限與資料表 ----------
const schemas = Object.keys(ctx.allSchemas_().schema);
ok(['CalEvents', 'Todos', 'UserGroups'].every((n) => schemas.includes(n)), '新資料表');
ok(ctx.allSchemas_().schema.Memos.includes('ShareMode') && ctx.allSchemas_().schema.Memos.includes('ShareWith'), '備忘錄新增分享欄位');
for (const a of ['calGetEvents', 'calSaveEvent', 'calDeleteEvent', 'todoGet', 'todoSave', 'todoSetStatus', 'todoDelete', 'getShareTargets', 'addMemo', 'getMemos'])
  ok(['admin1', 'amy', 'bob', 'cat'].every((u) => can(u, a)), '登入就能用自己的 ' + a + '（包含查看者與特定權限）');
for (const a of ['groupGetAll', 'groupSave', 'groupDelete', 'wsGetSettings', 'wsSaveSettings']) ok(can('admin1', a) && !can('amy', a) && !can('bob', a), a + ' 只有管理員');
ok(['calGetEvents', 'todoSave', 'groupSave'].every((a) => !!ctx.getRoute_(a)), '路由');

// ---------- 群組（管理員） ----------
let r = run('handleGroupSave', 'admin1', { name: '業務組', members: ['amy', 'bob', 'ghost', 'amy'] });
ok(r.success && r.id === 1, '建立群組');
let gs = run('handleGroupGetAll', 'admin1', {}).groups;
ok(gs[0].members.join() === 'amy,bob', '成員只留存在的帳號、去重');
ok(!run('handleGroupSave', 'admin1', { name: '業務組' }).success, '群組名稱不能重複');
ok(!run('handleGroupSave', 'admin1', { name: '' }).success, '名稱不能空白');
ok(run('handleGroupSave', 'admin1', { name: 'FAE 組', members: ['cat'] }).id === 2, '第二個群組');
ok(run('handleGroupSave', 'admin1', { id: 1, name: '業務組', members: ['amy', 'bob', 'dan'] }).success && run('handleGroupGetAll', 'admin1', {}).groups[0].members.length === 3, '修改成員');
let t = run('handleGetShareTargets', 'amy', {});
ok(t.users.length === 5 && t.groups.length === 2 && t.groups[0].members === undefined && t.groups[0].isMember === true && t.groups[1].isMember === false, '分享對象清單：一般人看不到群組成員名單');
ok(run('handleGetShareTargets', 'admin1', {}).groups[0].members.length === 3, '管理員看得到成員');

// ---------- 行事曆：建立與驗證 ----------
r = run('handleCalSaveEvent', 'amy', { title: '', startDate: '2026-11-10' });
ok(!r.success && r.message.includes('標題'), '標題必填');
ok(!run('handleCalSaveEvent', 'amy', { title: 'x', startDate: '明天' }).success, '日期格式');
ok(!run('handleCalSaveEvent', 'amy', { title: 'x', startDate: '2026-11-10', endDate: '2026-11-09' }).success, '結束不能早於開始');
ok(!run('handleCalSaveEvent', 'amy', { title: 'x', startDate: '2026-11-10', startTime: '10:00', endTime: '09:00' }).success, '結束時間不能早於開始時間');
ok(!run('handleCalSaveEvent', 'amy', { title: 'x', startDate: '2026-11-10', endDate: '2027-02-10' }).success, '最多跨 60 天');
r = run('handleCalSaveEvent', 'amy', { title: '拜訪甲公司', startDate: '2026-11-10', startTime: '14:00', location: '新竹', notes: '帶樣品' });
ok(r.success && r.id === 1, '建立行程');
let ev = run('handleCalGetEvents', 'amy', { from: '2026-11-01', to: '2026-11-30' }).events;
ok(ev.length === 1 && ev[0].startTime === '14:00' && ev[0].endTime === '15:00' && ev[0].allDay === false && ev[0].shareMode === 'self' && ev[0].isMine && ev[0].canEdit, '時間行程：預設一小時、只有自己');
r = run('handleCalSaveEvent', 'amy', { title: '展覽', startDate: '2026-11-12', endDate: '2026-11-14' });
ok(r.success, '全天跨天行程');
ev = run('handleCalGetEvents', 'amy', { from: '2026-11-13', to: '2026-11-13' }).events;
ok(ev.length === 1 && ev[0].allDay === true && ev[0].title === '展覽', '區間有重疊就算（跨天行程中間那天）');
ok(run('handleCalGetEvents', 'amy', { from: '2026-11-15', to: '2026-11-20' }).events.length === 0, '區間外不回傳');
ok(!run('handleCalGetEvents', 'amy', { from: '2026-01-01', to: '2028-01-01' }).success, '區間太長會擋');

// ---------- 行事曆：隱私與分享（只能看） ----------
ok(run('handleCalGetEvents', 'bob', { from: '2026-11-01', to: '2026-11-30' }).events.length === 0, '沒分享：別人完全看不到');
ok(run('handleCalGetEvents', 'admin1', { from: '2026-11-01', to: '2026-11-30' }).events.length === 0, '沒分享：連管理員也看不到（隱私）');
const share = (id, mode, withList) => run('handleCalSaveEvent', 'amy', { id, title: '拜訪甲公司', startDate: '2026-11-10', startTime: '14:00', shareMode: mode, shareWith: withList });
ok(share(1, 'users', ['bob', 'amy', 'ghost']).success, '分享給指定人');
let bobEv = run('handleCalGetEvents', 'bob', { from: '2026-11-01', to: '2026-11-30' }).events;
ok(bobEv.length === 1 && bobEv[0].isMine === false && bobEv[0].canEdit === false && bobEv[0].ownerName === '艾咪' && bobEv[0].shareWith.length === 0, '被指定的人看得到，只能看、看不到名單');
ok(run('handleCalGetEvents', 'cat', { from: '2026-11-01', to: '2026-11-30' }).events.length === 0 && run('handleCalGetEvents', 'dan', { from: '2026-11-01', to: '2026-11-30' }).events.length === 0, '沒被指定的人看不到');
ok(run('handleCalGetEvents', 'amy', { from: '2026-11-01', to: '2026-11-30' }).events.find((e) => e.id === 1).shareWith.join() === 'bob', '擁有者看得到名單（已排除自己與不存在的帳號）');
ok(run('handleCalGetEvents', 'bob', { from: '2026-11-01', to: '2026-11-30', scope: 'mine' }).events.length === 0 && run('handleCalGetEvents', 'bob', { from: '2026-11-01', to: '2026-11-30', scope: 'shared' }).events.length === 1, '我的 / 分享給我的 篩選');
r = run('handleCalSaveEvent', 'bob', { id: 1, title: '偷改', startDate: '2026-11-10' });
ok(!r.success && r.message.includes('只有擁有者'), '被分享的人不能改');
r = run('handleCalDeleteEvent', 'bob', { id: 1 });
ok(!r.success && r.message.includes('只有擁有者'), '被分享的人不能刪');
ok(share(1, 'groups', [1]).success, '分享給群組');
ok(run('handleCalGetEvents', 'dan', { from: '2026-11-01', to: '2026-11-30' }).events.length === 1 && run('handleCalGetEvents', 'bob', { from: '2026-11-01', to: '2026-11-30' }).events.length === 1, '群組成員看得到');
ok(run('handleCalGetEvents', 'cat', { from: '2026-11-01', to: '2026-11-30' }).events.length === 0, '不在群組的看不到');
ok(share(1, 'groups', [99]).success && run('handleCalGetEvents', 'amy', { from: '2026-11-01', to: '2026-11-30' }).events.find((e) => e.id === 1).shareMode === 'self', '群組不存在 → 退回只有自己');
ok(share(1, 'all').success && ['bob', 'cat', 'dan', 'admin1'].every((u) => run('handleCalGetEvents', u, { from: '2026-11-01', to: '2026-11-30' }).events.some((e) => e.id === 1)), '分享給全部');
ok(share(1, 'groups', [2]).success, '改分享給 FAE 組（cat）');
ok(run('handleCalGetEvents', 'cat', { from: '2026-11-01', to: '2026-11-30' }).events.length === 1 && run('handleCalGetEvents', 'bob', { from: '2026-11-01', to: '2026-11-30' }).events.length === 0, '換群組後舊群組看不到');
run('handleGroupDelete', 'admin1', { id: 2 });
ok(run('handleCalGetEvents', 'cat', { from: '2026-11-01', to: '2026-11-30' }).events.length === 0 && run('handleCalGetEvents', 'amy', { from: '2026-11-01', to: '2026-11-30' }).events.length >= 1, '群組刪除後資料還在、分享對象失效');
ok(run('handleGroupGetAll', 'admin1', {}).groups.length === 1, '群組已刪');
// 管理員可處理他人「看得到」的行程
share(1, 'all');
ok(run('handleCalSaveEvent', 'admin1', { id: 1, title: '管理員改', startDate: '2026-11-10', startTime: '14:00', shareMode: 'all' }).success, '管理員可修改他人行程');
ok(run('handleCalGetEvents', 'amy', { from: '2026-11-01', to: '2026-11-30' }).events.find((e) => e.id === 1).title === '管理員改', '修改生效');
ok(run('handleCalDeleteEvent', 'admin1', { id: 1 }).success, '管理員可刪除');
ok(!run('handleCalDeleteEvent', 'amy', { id: 1 }).success, '刪除不存在的');

// ---------- 工作清單 ----------
r = run('handleTodoSave', 'amy', { title: '' });
ok(!r.success, '標題必填');
ok(!run('handleTodoSave', 'amy', { title: 'x', dueDate: '下週' }).success, '期限格式');
const t1 = run('handleTodoSave', 'amy', { title: '寄樣品', dueDate: '2026-11-06', priority: '高' }).id;
const t2 = run('handleTodoSave', 'amy', { title: '整理報價', dueDate: '2026-11-05', priority: '低', notes: 'Q4' }).id;
const t3 = run('handleTodoSave', 'amy', { title: '沒期限的', priority: '亂寫' }).id;
const t4 = run('handleTodoSave', 'amy', { title: '全公司共享', dueDate: '2026-11-07', shareMode: 'all' }).id;
let todos = run('handleTodoGet', 'amy', {}).todos;
ok(todos.map((x) => x.title).join() === '整理報價,寄樣品,全公司共享,沒期限的', '排序：期限近的在前、沒期限最後');
ok(todos.find((x) => x.id === t3).priority === '中', '不合法的優先度 → 中');
ok(run('handleTodoGet', 'bob', {}).todos.map((x) => x.title).join() === '全公司共享', '別人只看得到分享的');
ok(!run('handleTodoSetStatus', 'bob', { id: t4, status: 'done' }).success, '被分享的人不能改狀態');
ok(!run('handleTodoSave', 'bob', { id: t4, title: '偷改' }).success && !run('handleTodoDelete', 'bob', { id: t4 }).success, '被分享的人不能改 / 刪');
ok(run('handleTodoSetStatus', 'amy', { id: t1, status: 'done' }).success, '完成');
ok(run('handleTodoGet', 'amy', {}).todos.every((x) => x.id !== t1) && run('handleTodoGet', 'amy', { status: 'done' }).todos[0].doneAt, '預設不含已完成、記錄完成時間');
ok(run('handleTodoGet', 'amy', { status: 'all' }).todos.at(-1).status === 'done', '全部時，已完成排最後');
ok(!run('handleTodoSetStatus', 'amy', { id: t1, status: 'weird' }).success, '狀態驗證');
ok(run('handleTodoSetStatus', 'amy', { id: t1, status: 'todo' }).success && run('handleTodoGet', 'amy', {}).todos.some((x) => x.id === t1), '重開');
ok(run('handleTodoSave', 'amy', { id: t2, title: '整理報價（改）', dueDate: '2026-11-08', priority: '中', shareMode: 'users', shareWith: ['cat'] }).success && run('handleTodoGet', 'cat', {}).todos.some((x) => x.id === t2), '修改並分享給指定人');
ok(run('handleTodoDelete', 'amy', { id: t3 }).success && !run('handleTodoGet', 'amy', {}).todos.some((x) => x.id === t3), '刪除');

// ---------- 備忘錄分享 ----------
ctx.appendObjectRow('Memos', { Owner: 'dan', OwnerName: '丹', Title: '舊的共享', Content: 'x', Shared: '是', CreatedDate: '2026-10-01', LastUpdated: '2026-10-01' });
ok(run('handleGetMemos', 'bob', {}).memos.some((m) => m.Title === '舊的共享' && m.Shared && m.ShareMode === 'all'), '舊資料 Shared=是 視為分享給全部');
ok(run('handleAddMemo', 'amy', { title: '私人', content: '只有我' }).success, '預設只有自己');
ok(run('handleAddMemo', 'amy', { title: '給業務組', content: 'x', shareMode: 'groups', shareWith: [1] }).success, '分享給群組');
ok(run('handleAddMemo', 'amy', { title: '給鮑勃', content: 'x', shareMode: 'users', shareWith: ['bob'] }).success, '分享給指定人');
ok(run('handleAddMemo', 'amy', { title: '舊寫法', content: 'x', shared: true }).success, '舊寫法 shared:true 仍可用');
const titles = (u) => run('handleGetMemos', u, {}).memos.map((m) => m.Title).sort().join();
ok(titles('bob') === ['給業務組','給鮑勃','舊的共享','舊寫法'].sort().join(), '鮑勃看到的備忘：' + titles('bob'));
ok(titles('cat') === ['舊的共享','舊寫法'].sort().join(), '凱特只看到全部共享的：' + titles('cat'));
ok(titles('dan') === ['給業務組','舊的共享','舊寫法'].sort().join(), '丹（業務組）：' + titles('dan'));
const bobMemo = run('handleGetMemos', 'bob', {}).memos.find((m) => m.Title === '給鮑勃');
ok(bobMemo.IsMine === false && bobMemo.CanManage === false && bobMemo.ShareWith.length === 0 && bobMemo.ShareLabel.includes('指定'), '被分享的備忘錄：不能管理');
let denied = false;
try {
  run('handleUpdateMemo', 'bob', { rowIndex: bobMemo.RowIndex, fields: { Title: '偷改' } });
} catch (e) {
  denied = e.message.includes('建立者');
}
ok(denied, '被分享的備忘錄不能改');
const mineMemo = run('handleGetMemos', 'amy', {}).memos.find((m) => m.Title === '私人');
ok(run('handleUpdateMemo', 'amy', { rowIndex: mineMemo.RowIndex, fields: { ShareMode: 'users', ShareWith: ['cat'] } }).success && titles('cat').includes('私人'), '改分享對象');
ok(run('handleUpdateMemo', 'amy', { rowIndex: mineMemo.RowIndex, fields: { Shared: true } }).success && run('handleGetMemos', 'amy', {}).memos.find((m) => m.Title === '私人').ShareMode === 'all', '舊寫法 Shared 切換');
ok(run('handleUpdateMemo', 'amy', { rowIndex: mineMemo.RowIndex, fields: { Shared: false } }).success && !titles('cat').includes('私人'), '取消分享');

// ---------- 客戶下次追蹤 → 操作者自己的行事曆 ----------
ctx.WS_ACTOR_ = 'amy';
r = run('handleAddCustomer', 'amy', { companyName: '甲公司', contact: '王先生', nextFollowUpDate: '2026-11-12', nextFollowUpTime: '10:30', nextFollowUpNote: '報價確認' });
ok(r.success, '新增客戶');
const fu = () => ctx.sheetToObjects('CalEvents').rows.filter((x) => x.Source === 'followup');
ok(fu().length === 1 && fu()[0].Owner === 'amy' && fu()[0].RefKey === '甲公司' && fu()[0].Title === '客戶追蹤：甲公司（王先生）' && fu()[0].StartTime === '10:30' && fu()[0].EndTime === '11:30' && fu()[0].ShareMode === 'self', '追蹤事件寫進 amy 的行事曆，只有自己看得到');
const fuId = Number(fu()[0].ID);
ok(run('handleCalSaveEvent', 'amy', { id: fuId, title: '亂改標題', startDate: '2030-01-01', shareMode: 'users', shareWith: ['bob'] }).success && fu()[0].Title === '客戶追蹤：甲公司（王先生）' && fu()[0].StartDate === '2026-11-12' && fu()[0].ShareMode === 'users', '追蹤提醒：只能改「誰看得到」，標題 / 日期仍由客戶資料同步');
ok(run('handleCalGetEvents', 'bob', { from: '2026-11-12', to: '2026-11-12' }).events.some((e) => e.source === 'followup' && !e.canEdit), '指定的人看得到追蹤提醒，只能看');
ok(run('handleCalSaveEvent', 'amy', { id: fuId, title: 'x', startDate: '2026-11-12', shareMode: 'self' }).success, '收回分享');
ok(run('handleCalGetEvents', 'amy', { from: '2026-11-12', to: '2026-11-12' }).events.some((e) => e.source === 'followup') && run('handleCalGetEvents', 'bob', { from: '2026-11-12', to: '2026-11-12' }).events.length === 0, '只有 amy 看得到追蹤事件');
ok(gcalCalls === 0, 'Google 日曆同步預設關閉：沒有呼叫 CalendarApp');
const cust = ctx.sheetToObjects('Customers').rows[0];
ctx.WS_ACTOR_ = 'amy';
run('handleCalSaveEvent', 'amy', { id: fuId, title: 'x', startDate: '2026-11-12', shareMode: 'users', shareWith: ['bob'] });
r = run('handleUpdateCustomer', 'amy', { rowIndex: 2, companyName: '甲公司', fields: { NextFollowUpDate: '2026-11-13', NextFollowUpTime: '10:30' } });
ok(r.success && fu()[0].Owner === 'amy' && fu()[0].ShareMode === 'users' && fu()[0].StartDate === '2026-11-13', '同一位負責人改期：保留「誰看得到」');
ctx.WS_ACTOR_ = 'dan';
r = run('handleUpdateCustomer', 'dan', { rowIndex: 2, companyName: '甲公司', fields: { NextFollowUpDate: '2026-11-15', NextFollowUpTime: '', NextFollowUpNote: '改期' } });
ok(r.success, '改期');
ok(fu().length === 1 && fu()[0].Owner === 'dan' && fu()[0].ShareMode === 'self' && fu()[0].StartDate === '2026-11-15' && fu()[0].AllDay === true && fu()[0].StartTime === '' && fu()[0].Notes === '改期', '改期：事件更新並歸到現在操作的人；沒時間 → 全天');
r = run('handleUpdateCustomer', 'dan', { rowIndex: 2, companyName: '甲公司', fields: { CompanyName: '甲甲公司' } });
ok(r.success && fu().length === 1 && fu()[0].RefKey === '甲甲公司' && fu()[0].Title.includes('甲甲公司'), '公司改名：事件跟著改，不會重複');
r = run('handleUpdateCustomer', 'dan', { rowIndex: 2, companyName: '甲甲公司', fields: { NextFollowUpDate: '' } });
ok(r.success && fu().length === 0, '不再追蹤：事件刪除');
run('handleUpdateCustomer', 'dan', { rowIndex: 2, companyName: '甲甲公司', fields: { NextFollowUpDate: '2026-11-20' } });
ok(fu().length === 1, '重新設定追蹤日');
ctx.WS_ACTOR_ = '';
run('handleUpdateCustomer', 'dan', { rowIndex: 2, companyName: '甲甲公司', fields: { NextFollowUpDate: '2026-11-21' } });
ok(fu().length === 1 && fu()[0].StartDate === '2026-11-20', '不知道誰在操作（沒登入帳號）→ 不動行事曆');
ctx.WS_ACTOR_ = 'dan';
r = run('handleDeleteCustomer', 'admin1', { rowIndex: 2, force: true });
ok(r.success && fu().length === 0, '刪除客戶：追蹤事件一起刪');

// Google 日曆同步（選用）
ok(run('handleWsGetSettings', 'admin1', {}).googleCalSync === false, '預設關');
run('handleWsSaveSettings', 'admin1', { googleCalSync: true });
ok(run('handleWsGetSettings', 'admin1', {}).googleCalSync === true, '管理員開啟');
run('handleAddCustomer', 'dan', { companyName: '乙公司', nextFollowUpDate: '2026-11-30' });
ok(gcalCalls > 0 && fu().length === 1, '開啟後同時同步 Google 日曆，內建行事曆照常寫');
run('handleWsSaveSettings', 'admin1', { googleCalSync: false });

// ---------- setup 遷移 ----------
ctx.appendObjectRow('Customers', { CompanyName: '舊客戶A', Contact: '甲', NextFollowUpDate: '2026-12-01', NextFollowUpTime: '09:00' });
ctx.appendObjectRow('Customers', { CompanyName: '舊客戶B', NextFollowUpDate: '2026-12-02' });
ctx.appendObjectRow('Customers', { CompanyName: '沒追蹤', NextFollowUpDate: '' });
ctx.appendObjectRow('Cases', { CaseID: 'K-1', CustomerName: '舊客戶A', Status: '需求單已發出', Salesperson: '艾咪' });
ctx.appendObjectRow('Cases', { CaseID: 'K-2', CustomerName: '舊客戶B', Status: '已結案', Salesperson: 'dan' });
ctx.WS_ACTOR_ = '';
const log = [];
ctx.wsMigrateFollowUps_(log);
const before = fu().length;
ok(fu().some((x) => x.RefKey === '舊客戶A' && x.Owner === 'amy'), '遷移：負責人 = 進行中案件的業務（用顯示名稱對得到帳號）');
ok(fu().some((x) => x.RefKey === '舊客戶B' && x.Owner === 'admin1'), '遷移：找不到負責人 → 第一位管理員');
ok(!fu().some((x) => x.RefKey === '沒追蹤'), '沒有追蹤日的不建立');
ctx.wsMigrateFollowUps_([]);
ok(fu().length === before, '遷移只做一次');
ok(log.length === 1 && log[0].includes('筆'), '有記錄');

// ---------- 員工助理 ----------
const stKey = run('handleBotGenKey', 'admin1', { role: 'staff' }).key;
run('handleBotSaveStaff', 'admin1', { config: { enabled: true, webEnabled: true } });
const bot = (op, id, extra) => ctx.handleBotApi(Object.assign({ secret: stKey, op, lineUserId: id }, extra || {}));
const member = (n, user, role) => {
  const id = 'U' + String(n).repeat(32);
  bot('start', id);
  run('handleBotMemberSave', 'admin1', { lineUserId: id, status: '已開通', role, linkedUsername: user });
  return id;
};
const AM = member(1, 'amy', 'editor');
const BO = member(2, 'bob', 'viewer');
const NL = member(3, '', 'editor');
const callTool = (id, c, p) => bot('call', id, { call: c, params: p || {} });
const today = ctx.todayStr();
run('handleCalSaveEvent', 'amy', { title: '今天的會議', startDate: today, startTime: '09:00', shareMode: 'all' });
run('handleCalSaveEvent', 'amy', { title: '私人行程', startDate: today, startTime: '12:00' });
run('handleTodoSave', 'amy', { title: '今天要交', dueDate: today });
run('handleTodoSave', 'amy', { title: '之前逾期', dueDate: '2020-01-01' });
r = callTool(AM, 'calendar', { days: 3 });
ok(r.success && r.data.items.some((x) => x.title === '今天的會議') && r.data.items.some((x) => x.title === '私人行程'), '助理查自己的行事曆');
r = callTool(BO, 'calendar', { days: 3 });
ok(r.success && r.data.items.some((x) => x.title === '今天的會議' && x.from === '艾咪') && !r.data.items.some((x) => x.title === '私人行程'), '助理只看得到別人分享的');
r = callTool(NL, 'calendar', {});
ok(!r.success && r.message.includes('綁定'), '沒綁定帳號：不能看行事曆：' + r.message);
r = callTool(AM, 'todos', {});
ok(r.success && r.data.items.map((x) => x.title).slice(0, 2).join() === '之前逾期,今天要交', '助理查工作清單（逾期在前）');
ok(callTool(BO, 'todos', {}).data.total === 1 /* 全公司共享那筆 */ || callTool(BO, 'todos', {}).data.total >= 1, '被分享的工作');
r = callTool(AM, 'overview', {});
ok(r.success && r.data.events.some((x) => x.title === '今天的會議') && r.data.todos.some((x) => x.title === '之前逾期'), '總覽含今日行程與快到期工作');
ok(callTool(AM, 'memos', {}).success, '備忘錄查詢');
// 寫入
ok(bot('start', AM).data.writable.includes('addEvent') && bot('start', AM).data.writable.includes('completeTodo'), 'writable 含個人工作區');
ok(bot('start', BO).data.writable.includes('addEvent') && !bot('start', BO).data.writable.includes('updateCustomer'), '查看者也能管理自己的行事曆與工作');
const stage = (id, ops) => bot('stage', id, { ops });
const commit = (id, ops) => {
  const s = stage(id, ops);
  return s.success ? bot('commit', id, { token: s.data.token }) : s;
};
r = stage(AM, [{ action: 'addEvent', data: { title: '', date: today } }]);
ok(!r.success && r.message.includes('標題'), '驗證：標題');
r = stage(AM, [{ action: 'addEvent', data: { title: 'x', date: '明天' } }]);
ok(!r.success, '驗證：日期');
r = stage(NL, [{ action: 'addEvent', data: { title: 'x', date: today } }]);
ok(!r.success && r.message.includes('綁定'), '沒綁定帳號不能新增');
r = commit(AM, [{ action: 'addEvent', data: { title: 'LINE 新增的會', date: '2026-12-05', time: '14:00', endTime: '15:30', location: '台北', allDay: false } }]);
ok(r.success, '新增行程');
let ne = ctx.sheetToObjects('CalEvents').rows.find((x) => x.Title === 'LINE 新增的會');
ok(ne && ne.Owner === 'amy' && ne.ShareMode === 'self' && ne.StartTime === '14:00' && ne.EndTime === '15:30' && ne.Location === '台北' && ne.Source === 'manual', '行程寫進 amy 的行事曆，預設只有自己');
r = commit(AM, [{ action: 'addEvent', data: { title: '大家都能看', date: '2026-12-06', allDay: true, shareAll: true } }]);
ne = ctx.sheetToObjects('CalEvents').rows.find((x) => x.Title === '大家都能看');
ok(r.success && ne.ShareMode === 'all' && ne.AllDay === true, '分享給全部');
r = commit(AM, [{ action: 'addTodo', data: { title: 'LINE 新增的工作', dueDate: '2026-12-07', priority: '高' } }]);
ok(r.success, '新增工作');
const nt = ctx.sheetToObjects('Todos').rows.find((x) => x.Title === 'LINE 新增的工作');
ok(nt && nt.Owner === 'amy' && nt.Priority === '高' && nt.Status === 'todo' && nt.ShareMode === 'self', '工作寫進 amy 的清單');
r = commit(AM, [{ action: 'completeTodo', data: { id: Number(nt.ID) } }]);
ok(r.success && ctx.sheetToObjects('Todos').rows.find((x) => x.Title === 'LINE 新增的工作').Status === 'done', '完成工作');
r = commit(AM, [{ action: 'completeTodo', data: { id: Number(nt.ID), reopen: true } }]);
ok(r.success && ctx.sheetToObjects('Todos').rows.find((x) => x.Title === 'LINE 新增的工作').Status === 'todo', '重開工作');
const sharedTodo = ctx.sheetToObjects('Todos').rows.find((x) => x.Title === '全公司共享');
r = stage(BO, [{ action: 'completeTodo', data: { id: Number(sharedTodo.ID) } }]);
ok(!r.success && r.message.includes('不是你的'), '助理不能改別人分享給我的工作：' + r.message);
r = stage(AM, [{ action: 'completeTodo', data: { id: 9999 } }]);
ok(!r.success && r.message.includes('找不到'), '找不到的工作');
r = commit(AM, [{ action: 'addMemo', data: { title: '助理備忘', content: 'x', shared: true } }]);
ok(r.success && ctx.sheetToObjects('Memos').rows.find((x) => x.Title === '助理備忘').ShareMode === 'all', '助理新增備忘錄（shared → 全部）');
ok(bot('stage', AM, { ops: [{ action: 'deleteEvent', data: { id: 1 } }] }).success === false, '助理仍然不能刪除');
run('handleBotSaveStaff', 'admin1', { config: { writes: ['addMemo'] } });
ok(!stage(AM, [{ action: 'addEvent', data: { title: 'x', date: today } }]).success, '管理員可關掉個別寫入');
ok(run('handleBotGetStaff', 'admin1', {}).writes.map((x) => x.key).join().includes('addEvent,addTodo,completeTodo'), '設定頁看得到新寫入項目');
console.log('workspace checks passed:', pass);
