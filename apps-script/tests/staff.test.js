const assert = require('assert');
const path = require('path');
const { makeEnv } = require('./gasmock');
const files = [path.join(__dirname, '..', 'Code.gs')];
const pushes = [];
const { ctx, sheets, cache, props } = makeEnv({
  files,
  fetch: (url, o) => {
    if (/\/api\/web$/.test(url)) {
      const b = JSON.parse(o.payload);
      pushes.push({ url, b });
      return { code: 200, body: { reply: '收到：' + b.text, choices: ['好'], pending: null } };
    }
    if (/\/api\/push$/.test(url)) {
      pushes.push({ url, h: o.headers });
      return { code: 200, body: { sent: 2 } };
    }
    return { code: 404, body: '' };
  },
});
let pass = 0;
const ok = (c, m) => {
  assert.ok(c, m);
  pass++;
};
const mk = (u, role, perms) => ctx.appendObjectRow('Users', { Username: u, PasswordHash: 'x', Role: role, DisplayName: u + '名', Perms: perms ? JSON.stringify(perms) : '' });
mk('admin1', 'admin');
mk('ed', 'editor');
mk('vw', 'viewer');
mk('botlim', 'limited', { bot: 'edit' });
mk('botview', 'limited', { bot: 'view' });
mk('sal', 'sales');
const can = (u, a) => {
  try {
    ctx.requirePermission_(a, { username: u });
    return true;
  } catch (e) {
    return false;
  }
};
const call = (fn, body, u) => ctx[fn](Object.assign({ _user: { username: u || 'admin1', displayName: (u || 'admin1') + '名' } }, body));

// 權限登記
const noperm = Object.keys(ctx.botRoutes_()).filter((a) => ctx.botRoutes_()[a].auth && !ctx.botPerms_()[a]);
ok(noperm.length === 0, '沒登記權限：' + noperm.join(','));
ok(can('botlim', 'botSaveStaff') && !can('botlim', 'botMemberRemove') && can('botview', 'botGetStaff') && !can('botview', 'botMemberSave'), 'bot 區塊權限');
ok(can('vw', 'botAssist') && can('sal', 'botAssist'), '網站助理任何登入帳號都能呼叫（權限在內部依區塊過濾）');
ok(Object.keys(ctx.allSchemas_().schema).includes('BotMembers') && Object.keys(ctx.allSchemas_().schema).includes('BotMemory'), '資料表');

// Bot 金鑰 + 設定
const KEY = call('handleBotGenKey', { role: 'staff' }).key;
const bot = (op, id, extra) => ctx.handleBotApi(Object.assign({ secret: KEY, op, lineUserId: id }, extra || {}));
const S1 = 'U' + '1'.repeat(32);
const S2 = 'U' + '2'.repeat(32);

// 員工助理未啟用
let r = bot('start', S1, { displayName: '小明' });
ok(r.success && r.data.allowed === false && r.data.isNew === true && r.data.status === '待開通' && r.data.problem.includes('還沒啟用'), '未啟用時新成員也會登記');
ok(ctx.sheetToObjects('BotMembers').rows.length === 1, '登記成員');
let memos = ctx.sheetToObjects('Memos').rows;
ok(memos.length === 1 && memos[0].NeedBlock === 'bot' && memos[0].LinkType === 'botMember', '通知備忘錄');
r = bot('start', S1, { displayName: '小明' });
ok(r.data.isNew === false && ctx.sheetToObjects('Memos').rows.length === 1 && ctx.sheetToObjects('BotMembers').rows.length === 1, '不重複登記');

// 啟用
r = call('handleBotSaveStaff', { config: { enabled: true, welcome: '嗨', prompt: '稱呼我老闆', push: { enabled: true, hour: 8 }, memory: { enabled: true, maxItems: 10, canShared: false } } });
ok(r.success && r.config.enabled && r.config.welcome === '嗨' && r.config.push.hour === 8 && r.config.memory.maxItems === 10, '儲存設定');
r = bot('start', S1, {});
ok(r.data.allowed === false && r.data.status === '待開通' && r.data.texts.pending.includes('等待'), '待開通者不能用');
ok(!bot('call', S1, { call: 'customers', params: {} }).success, '待開通者不能查資料');

// 開通：查看
r = call('handleBotMemberSave', { lineUserId: S1, status: '已開通', role: 'viewer' });
ok(r.success, '開通');
ok(ctx.sheetToObjects('Memos').rows.length === 0, '開通後通知備忘錄清掉');
ok(!call('handleBotMemberSave', { lineUserId: S1, role: 'limited', perms: {} }).success, '特定至少一個區塊');
ok(!call('handleBotMemberSave', { lineUserId: S1, role: 'admin' }).success, '不能設成管理員');
ok(!call('handleBotMemberSave', { lineUserId: S1, linkedUsername: 'nobody' }).success, '綁定不存在帳號');
ok(!call('handleBotMemberSave', { lineUserId: S1, linkedUsername: 'ed' }, 'botlim').success, '非管理員不能綁別人');
ok(call('handleBotMemberSave', { lineUserId: S1, linkedUsername: 'botlim' }, 'botlim').success, '可綁自己');
ok(call('handleBotMemberSave', { lineUserId: S1, linkedUsername: '' }, 'botlim').success, '解除綁定');

// 資料
ctx.appendObjectRow('Customers', { CompanyName: '甲公司', Contact: '王先生', Phone: '0912345678', NextFollowUpDate: ctx.todayStr(), NextFollowUpTime: '14:30', Urgency: '高', Category: '一般客戶', NextFollowUpNote: '報價確認', Notes: '很重要' });
ctx.appendObjectRow('Customers', { CompanyName: '乙公司', Contact: '李小姐', Phone: '0922', NextFollowUpDate: '2020-01-01', Category: '一般客戶' });
ctx.appendObjectRow('Cases', { CaseID: 'C-1', CustomerName: '甲公司', Status: '需求單已發出', Urgency: '高', CreatedDate: '2026-10-01', ProductApplication: '外觀檢測', TestObject: 'PCB', SoftwareName: 'Halcon', Salesperson: '小王' });
ctx.appendObjectRow('Cases', { CaseID: 'C-2', CustomerName: '乙公司', Status: '已結案', Urgency: '低', CreatedDate: '2026-09-01' });
ctx.appendObjectRow('Products', { InternalModel: 'ACA2440', SupplierModel: 'Basler', Supplier: '供應商X', Category: '相機', RefPrice: '15000', Resolution: '5MP' });
const call1 = (id, c, p) => bot('call', id, { call: c, params: p || {} });
r = call1(S1, 'customers', { keyword: '甲' });
ok(r.success && r.data.total === 1 && r.data.items[0].CompanyName === '甲公司' && r.data.items[0].NextFollowUpTime === '14:30', '查客戶');
r = call1(S1, 'customer', { companyName: '甲公司' });
ok(r.success && r.data.customer.Phone === '0912345678' && r.data.cases.length === 1, '客戶詳情含案件');
r = call1(S1, 'customer', { companyName: '丙公司' });
ok(!r.success && r.message.includes('找不到'), '找不到客戶');
r = call1(S1, 'followups', {});
ok(r.success && r.data.total === 2 && r.data.items[0].CompanyName === '乙公司' && r.data.items[0].status === '已逾期' && r.data.items[1].status === '今天', '追蹤清單');
r = call1(S1, 'cases', { status: '進行中' });
ok(r.success && r.data.total === 1 && r.data.items[0].CaseID === 'C-1', '進行中案件');
r = call1(S1, 'case', { caseId: 'C-1' });
ok(r.success && r.data.ProductApplication === '外觀檢測', '案件詳情');
r = call1(S1, 'products', { keyword: 'aca' });
ok(r.success && r.data.total === 1 && r.data.items[0].RefPrice == 15000, '產品（有產品權限含底價）');
r = call1(S1, 'overview', {});
ok(r.success && r.data.followups.total === 2 && r.data.openCases.total === 1, '總覽');
ok(!call1(S1, 'delete', {}).success && !call1(S1, 'deleteCustomer', {}).success, '沒有刪除類查詢');

// 查看者不能寫入
r = bot('stage', S1, { ops: [{ action: 'updateCaseStatus', data: { caseId: 'C-1', status: '已結案' } }] });
ok(!r.success && r.message.includes('編輯權限'), '查看者不能 stage 案件修改：' + r.message);
r = bot('start', S1, {});
ok(r.data.allowed && r.data.writable.join() === 'addMemo,addEvent,addTodo,completeTodo,remember' && r.data.blocks.customers === 'view', '查看者只剩個人項目：備忘錄 / 行事曆 / 工作清單（跟網站一樣，自己的人人可記）');
bot('cancel', S1, {});

// 特定：只有案件編輯
ok(call('handleBotMemberSave', { lineUserId: S1, role: 'limited', perms: { cases: 'edit', customers: 'none', bogus: 'edit' } }).success, '改成特定');
ok(call1(S1, 'customers', {}).message.includes('沒有「客戶'), '特定：沒客戶權限不能查客戶');
ok(call1(S1, 'cases', {}).success, '特定：能查案件');
r = call1(S1, 'customer', { companyName: '甲公司' });
ok(!r.success, '特定：客戶詳情被擋');
r = call1(S1, 'products', {});
ok(!r.success, '特定：沒有產品權限');
r = call1(S1, 'overview', {});
ok(r.success && !r.data.followups && r.data.openCases, '總覽依權限省略');
r = bot('start', S1, {});
ok(r.data.writable.includes('updateCaseStatus') && r.data.writable.includes('addMemo') && !r.data.writable.includes('updateCustomer'), 'writable：案件與備忘錄');
// 寫入：案件狀態
r = bot('stage', S1, { ops: [{ action: 'updateCaseStatus', data: { caseId: 'C-1', status: '評估單已發出', urgency: '中' } }] });
ok(r.success && r.data.summary.includes('評估單已發出') && r.data.token, 'stage 案件');
ok(bot('start', S1, {}).data.pending.includes('評估單已發出'), 'start 帶回待確認');
r = bot('stage', S1, { ops: [{ action: 'updateCaseStatus', data: { caseId: 'C-1', status: '亂寫' } }] });
ok(!r.success && r.message.includes('案件狀態只能是'), '狀態驗證');
r = bot('stage', S1, { ops: [{ action: 'updateCustomer', data: { company: '甲公司', fields: { Phone: '1' } } }] });
ok(!r.success && r.message.includes('編輯權限'), '沒有客戶編輯權限被擋');
r = bot('stage', S1, { ops: [{ action: 'deleteCase', data: { caseId: 'C-1' } }] });
ok(!r.success, '不能刪除');
r = bot('stage', S1, { ops: [{ action: 'updateCaseStatus', data: { caseId: 'C-1', status: '評估單已發出', urgency: '中' } }] });
const token = r.data.token;
ok(!bot('commit', S1, { token: 'wrong' }).success, 'token 不符不寫入');
ok(ctx.sheetToObjects('Cases').rows[0].Status === '需求單已發出', '尚未寫入');
r = bot('commit', S1, { token });
ok(r.success && r.data.count === 1, 'commit');
ok(ctx.sheetToObjects('Cases').rows[0].Status === '評估單已發出' && ctx.sheetToObjects('Cases').rows[0].Urgency === '中', '案件已改');
ok(!bot('commit', S1, {}).success, '不能重複 commit');
bot('stage', S1, { ops: [{ action: 'addMemo', data: { title: '記一下', content: '明天帶樣品' } }] });
ok(bot('cancel', S1, {}).success && !bot('commit', S1, {}).success, '取消');

// 編輯者：客戶寫入
ok(call('handleBotMemberSave', { lineUserId: S1, role: 'editor' }).success, '改成編輯者');
r = bot('stage', S1, { ops: [
  { action: 'logFollowUp', data: { company: '甲公司', method: '電話', summary: '確認規格', nextDate: '2026-12-01', nextTime: '10:00', nextNote: '回覆報價' } },
  { action: 'updateCustomer', data: { company: '甲公司', fields: { Contact: '陳經理' } } },
  { action: 'addCustomer', data: { companyName: '丁公司', contact: '張三', phone: '0933' } },
  { action: 'addMemo', data: { title: '提醒', content: '寄樣品' } },
] });
ok(r.success && r.data.summary.split('\n').length === 4, 'stage 四項');
r = bot('commit', S1, { token: r.data.token });
ok(r.success && r.data.count === 4, 'commit 四項：' + r.message);
const cu = ctx.sheetToObjects('Customers').rows;
const jia = cu.find((x) => x.CompanyName === '甲公司');
ok(jia.NextFollowUpDate === '2026-12-01' && jia.Contact === '陳經理' && cu.some((x) => x.CompanyName === '丁公司'), '客戶已寫入');
const logs = ctx.sheetToObjects('ContactLogs').rows;
ok(logs.length >= 1 && logs.some((l) => l.Summary === '確認規格' && l.Method === '電話'), '聯繫紀錄已寫入');
ok(ctx.sheetToObjects('Memos').rows.some((m) => m.Title === '提醒'), '備忘錄已寫入');
r = bot('stage', S1, { ops: [{ action: 'addCustomer', data: { companyName: '丁公司' } }] });
ok(!r.success && r.message.includes('已經有'), '重複客戶');
r = bot('stage', S1, { ops: [{ action: 'createCase', data: { customerName: '丁公司', softwareName: 'A' } }] });
ok(!r.success && r.message.includes('缺'), '建立案件缺欄位');
r = bot('stage', S1, { ops: [{ action: 'updateCustomer', data: { company: '甲公司', fields: { CompanyName: '改名' } } }] });
ok(!r.success && r.message.includes('不能用助理修改'), '不能改公司名稱');
r = bot('stage', S1, { ops: [{ action: 'logFollowUp', data: { company: '不存在', summary: 'x' } }] });
ok(!r.success, '找不到客戶');
r = bot('stage', S1, { ops: new Array(11).fill({ action: 'addMemo', data: { title: 'x' } }) });
ok(!r.success, '一次最多 10 項');

// 停用 / 取消追蹤
ok(call('handleBotMemberSave', { lineUserId: S1, status: '停用' }).success, '停用');
ok(bot('start', S1, {}).data.allowed === false && !call1(S1, 'customers', {}).success, '停用後不能用');
ok(call('handleBotMemberSave', { lineUserId: S1, status: '已開通' }).success, '重新開通');
bot('unfollow', S1, {});
ok(ctx.sheetToObjects('BotMembers').rows[0].IsFollowing === false, '封鎖記錄');
bot('start', S1, { displayName: '小明' });
ok(ctx.sheetToObjects('BotMembers').rows[0].IsFollowing === true, '再次出現恢復');

// 短期記憶
ok(bot('remember', S1, { turns: [{ u: true, t: '你好' }, { u: false, t: '您好' }] }).data === 2, '記住');
ok(bot('start', S1, {}).data.history.length === 2, '帶回歷史');
bot('forget', S1, {});
ok(bot('start', S1, {}).data.history.length === 0, '清除歷史');

// remember 走 stage / commit（LINE 說「記住」要先確認）
r = bot('stage', S1, { ops: [{ action: 'remember', data: { content: '我是業務', category: '稱呼與職務' } }] });
ok(r.success && r.data.summary.includes('記住'), 'stage remember');
ok(bot('commit', S1, { token: r.data.token }).success && ctx.sheetToObjects('BotMemory').rows.some((m) => m.Content === '我是業務'), 'commit remember');
ok(call('handleBotMemoryDelete', { ids: [ctx.sheetToObjects('BotMemory').rows.find((m) => m.Content === '我是業務').ID] }).deleted === 1, '清掉測試記憶');
// 長期記憶（一般成員：沒有 BOT 設定編輯權限）
call('handleBotMemberSave', { lineUserId: S1, role: 'limited', perms: { customers: 'edit', cases: 'edit' } });
r = bot('memory', S1, { data: { mode: 'add', scope: 'user', category: '回覆偏好', content: '回覆要短', importance: 4 } });
ok(r.success && r.data.id === 1, '新增個人記憶');
ok(bot('memory', S1, { data: { mode: 'add', scope: 'user', content: '回覆要短' } }).data.duplicate === true, '重複不新增');
r = bot('memory', S1, { data: { mode: 'add', scope: 'all', content: '公司上班九點' } });
ok(!r.success && r.message.includes('全公司'), '一般成員不能新增全公司記憶');
ok(call('handleBotMemorySave', { data: { mode: 'add', scope: 'all', content: '公司上班九點', category: '公司規定', importance: 5 } }).success, '管理員新增全公司記憶');
ok(!call('handleBotMemorySave', { data: { mode: 'add', scope: 'all', content: 'x' } }, 'botview').success, '查看者不能新增全公司記憶');
let items = bot('start', S1, {}).data.memory.items;
ok(items.length === 2 && items[0].scope === 'all' && items[0].importance === 5, '記憶依重要度排序並帶入');
ok(!bot('memory', S1, { data: { mode: 'delete', id: 2 } }).success, '成員不能刪全公司記憶');
ok(bot('memory', S1, { data: { mode: 'edit', id: 1, content: '回覆要很短', category: '回覆偏好', importance: 3 } }).success, '修改個人記憶');
// 別人的個人記憶
call('handleBotMemberSave', { lineUserId: S1, linkedUsername: 'ed' });
ok(bot('start', S1, {}).data.memory.items.filter((m) => m.scope === 'user').length === 0, '綁定帳號後個人記憶歸帳號（原本以 LINE 編號存的看不到）');
call('handleBotMemberSave', { lineUserId: S1, linkedUsername: '' });
ok(bot('memory', S1, { data: { mode: 'delete', id: 1 } }).success, '刪除個人記憶');
const list = call('handleBotGetStaff', {});
ok(list.success && list.members.length === 1 && list.memory.length === 1 && list.accounts.length === 6 && list.canLinkOthers, '員工助理管理頁資料');
ok(call('handleBotMemoryDelete', { ids: [2] }).deleted === 1, '管理端刪記憶');

// 第二位成員 + 移除
bot('start', S2, { displayName: '小華' });
ok(ctx.sheetToObjects('BotMembers').rows.length === 2 && ctx.sheetToObjects('Memos').rows.filter((m) => m.LinkType === 'botMember').length === 1, '第二位成員與通知');
ok(call('handleBotMemberRemove', { lineUserId: S2 }).success && ctx.sheetToObjects('BotMembers').rows.length === 1 && ctx.sheetToObjects('Memos').rows.filter((m) => m.LinkType === 'botMember').length === 0, '移除成員並清通知');

// 早報
call('handleBotMemberSave', { lineUserId: S1, pushDaily: true });
ok(JSON.stringify(bot('pushTargets', '').data || ctx.botPushTargets_()) === JSON.stringify([S1]), '早報名單');
call('handleBotSaveSettings', { general: { botUrl: 'https://aoi-bot.vercel.app' } });
r = call('handleBotPushNow', {});
ok(r.success && pushes.some((p) => /\/api\/push$/.test(p.url) && p.h['x-bot-secret'] === KEY), '立即推播呼叫機器人伺服器');

// 網站智能助理
ok(call('handleBotAssistInfo', {}).enabled === true, 'assist info');
r = call('handleBotAssist', { text: '今天追蹤誰' }, 'ed');
ok(r.success && r.reply === '收到：今天追蹤誰', 'assist 轉發');
const W = pushes.filter((p) => p.b && p.b.id)[0].b.id;
ok(/^W[0-9a-f]{32}$/.test(W) && !JSON.stringify(pushes[pushes.length - 1].b).includes('PasswordHash'), 'W 編號格式、不外洩');
r = bot('start', W, {});
ok(r.success && r.data.allowed && r.data.channel === 'web' && r.data.username === 'ed' && r.data.blocks.customers === 'edit', 'W 編號用登入帳號權限');
r = call1(W, 'customers', {});
ok(r.success && r.data.total >= 1, 'W 查詢');
mk('vw2', 'viewer');
call('handleBotAssist', { text: 'hi' }, 'vw2');
const Wv = pushes[pushes.length - 1].b.id;
r = bot('stage', Wv, { ops: [{ action: 'updateCustomer', data: { company: '甲公司', fields: { Phone: '1' } } }] });
ok(!r.success, 'W 查看者不能寫入');
ok(call1(Wv, 'customers', {}).success && !bot('stage', Wv, { ops: [{ action: 'addCustomer', data: { companyName: '戊' } }] }).success, 'W 查看者可查不能寫');
const Wnone = 'W' + '9'.repeat(32);
r = bot('start', Wnone, {});
ok(r.data.allowed === false && r.data.problem.includes('逾期'), '未登入的 W 編號被拒');
ok(!call1(Wnone, 'customers', {}).success, '未登入的 W 編號不能查詢');
// 關閉網站助理
call('handleBotSaveStaff', { config: { webEnabled: false } });
ok(!call('handleBotAssist', { text: 'x' }, 'ed').success, '關閉網站助理');
ok(bot('start', W, {}).data.allowed === false, '關閉後 W 編號不可用');
call('handleBotSaveStaff', { config: { webEnabled: true, enabled: false } });
ok(bot('start', S1, {}).data.allowed === false, '關閉整個員工助理');
console.log('staff checks passed:', pass);
