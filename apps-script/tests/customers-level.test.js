// 客戶分級：類型（一般使用者 / 設備商）各自 8 級；現有客戶初始等級；開發名單 = 1 級；轉客戶選等級；名片登入 = 2 有興趣
const assert = require('assert');
const path = require('path');
const { makeEnv } = require('./gasmock');
const { ctx } = makeEnv({ files: [path.join(__dirname, '..', 'Code.gs')] });
let pass = 0;
const ok = (c, m) => {
  assert.ok(c, m);
  pass++;
};
const me = { username: 'amy', displayName: 'Amy' };
const call = (fn, body) => ctx[fn](Object.assign({ _user: me }, body || {}));
const cust = (name) => call('handleGetCustomers').customers.find((c) => c.CompanyName === name);

// ---- 現有客戶：第一次讀取時補欄位、設定初始等級 ----
ctx.appendObjectRow('Customers', { CompanyName: '評估中設備股份有限公司', Category: '機構合作設備商' });
ctx.appendObjectRow('Customers', { CompanyName: '還沒開始有限公司', Category: '一般客戶' });
ctx.appendObjectRow('Customers', { CompanyName: '取消案件有限公司', Category: '一般客戶' });
ctx.appendObjectRow('Customers', { CompanyName: '原廠股份有限公司', Category: '器材原廠' });
ctx.appendObjectRow('Cases', { CaseID: 'A1', CustomerName: '評估中設備股份有限公司', Status: '評估單已發出' });
ctx.appendObjectRow('Cases', { CaseID: 'C1', CustomerName: '取消案件有限公司', Status: '已結案', CloseResult: '取消' });
ctx.appendObjectRow('Cases', { CaseID: 'D1', CustomerName: '原廠股份有限公司', Status: '已結案', CloseResult: '完成訂單' });
let c = cust('評估中設備股份有限公司');
ok(c.Level === '6' && c.CustomerType === '設備商' && c.LevelAt, '有評估中的案件 → 6 樣品測試評估；機構合作設備商 → 設備商');
c = cust('還沒開始有限公司');
ok(c.Level === '2' && c.CustomerType === '一般使用者', '還沒有案件 → 2 有興趣；一般客戶 → 一般使用者');
ok(cust('取消案件有限公司').Level === '2', '案件已取消 → 2 有興趣');
c = cust('原廠股份有限公司');
ok(c.Level === '6' && c.CustomerType === '', '完成訂單的也算進入評估（之後再手動調整）；器材原廠不推類型');
// 只做一次：手動改過的不會被蓋回去
call('handleUpdateCustomer', { companyName: '還沒開始有限公司', fields: { Level: '3' } });
ok(cust('還沒開始有限公司').Level === '3', '初始化只跑一次，手動改的保留');

// ---- 新增客戶 ----
ok(call('handleAddCustomer', { companyName: '新客戶有限公司' }).success && cust('新客戶有限公司').Level === '2', '新增客戶預設 2 有興趣');
call('handleAddCustomer', { companyName: '指定等級股份有限公司', customerType: '設備商', level: '5' });
c = cust('指定等級股份有限公司');
ok(c.Level === '5' && c.CustomerType === '設備商', '新增時可以指定類型與等級');
call('handleAddCustomer', { companyName: '亂填有限公司', customerType: '不知道', level: '1' });
c = cust('亂填有限公司');
ok(c.Level === '2' && c.CustomerType === '', '類型不對留空、1 級不能直接是客戶 → 2');

// ---- 修改等級 ----
let r = call('handleUpdateCustomer', { companyName: '新客戶有限公司', fields: { Level: '1' } });
ok(!r.success && /2～8/.test(r.message), '客戶不能改成 1 級（陌生開發名單）');
r = call('handleUpdateCustomer', { companyName: '新客戶有限公司', fields: { Level: '樣品測試評估' } });
ok(r.success && r.customer.Level === '6', '用名稱也可以：樣品測試評估 → 6');
ok(r.changes.some((x) => x === '等級：2 有興趣 → 6 樣品測試評估'), '修改紀錄寫出等級名稱');
ok(!call('handleUpdateCustomer', { companyName: '新客戶有限公司', fields: { CustomerType: '經銷商' } }).success, '類型只能是一般使用者 / 設備商');
r = call('handleCustomerLevel', { companyName: '新客戶有限公司' });
ok(r.found && r.level === 6 && r.name === '新客戶有限公司' && r.rowIndex >= 2, '查一間客戶目前的等級（升級詢問用）');
ok(call('handleCustomerLevel', { companyName: '不存在公司' }).found === false, '不是客戶 → found false');
ok(ctx.custLevelLabel_('8') === '8 已經成交' && ctx.custLevelNum_('7 成案') === 7 && ctx.custLevelNum_('9') === 0, '等級文字 / 數字轉換');

// ---- 開發名單的類型 ----
call('handleProspectImport', { source: '展覽', rows: [
  { Name: '甲設備股份有限公司', Category: '設備商|自動化' },
  { Name: '乙工廠有限公司', Type: '一般使用者' },
  { Name: '丙未知有限公司' },
  { Name: '丁備註設備有限公司', Notes: 'AOI 潛在客戶：自動化 / 設備商' },
] });
let q = call('handleProspectQuery', {});
const t = (n) => q.rows.find((x) => x.Name === n).Type;
ok(t('甲設備股份有限公司') === '設備商' && t('丁備註設備有限公司') === '設備商', '產業 / 備註有「設備商」→ 自動標設備商');
ok(t('乙工廠有限公司') === '一般使用者' && t('丙未知有限公司') === '', '檔案有寫類型就用；沒寫也猜不到就留空');
const pt = (v) => (q.facets.ptype.find((x) => x.v === v) || {}).n || 0;
ok(pt('D') === 2 && pt('U') === 1 && pt('N') === 1, '類型統計（設備商 2、一般使用者 1、未設定 1）');
ok(!q.facets.has.some((x) => x.v === 'D' || x.v === 'U'), '聯絡方式統計不含類型記號');
ok(call('handleProspectQuery', { ptypes: ['D'] }).total === 2 && call('handleProspectQuery', { ptypes: ['N', 'U'] }).total === 2, '依類型篩選');
const keyOf = (n) => call('handleProspectQuery', { q: n }).rows[0];
let p = keyOf('丙未知');
ok(call('handleProspectBulk', { keys: [p.Key], set: { Type: '一般使用者' } }).count === 1 && keyOf('丙未知').Type === '一般使用者' && keyOf('丙未知').Has.includes('U'), '批次設定類型（Has 記號同步）');
call('handleProspectBulk', { keys: [p.Key], set: { Hidden: true } });
call('handleProspectBulk', { keys: [p.Key], set: { Hidden: false } });
ok(keyOf('丙未知').Has.includes('U'), '隱藏 / 取消隱藏不會弄掉類型記號');
ok(!call('handleProspectUpdate', { key: p.Key, row: p.RowIndex, fields: { Type: '代理商' } }).success, '手動設定類型只能是一般使用者 / 設備商');
r = call('handleProspectUpdate', { key: p.Key, row: p.RowIndex, fields: { Type: '設備商' } });
ok(r.success && r.row.Type === '設備商' && r.row.Has.includes('D') && !r.row.Has.includes('U'), '單筆修改類型');

// ---- 分級總覽：1 級 = 開發名單 ----
let sm = call('handleLevelSummary');
ok(sm.counts.maker[1] === 3 && sm.counts.user[1] === 1 && sm.counts.none[1] === 0, '1 級：開發名單依類型計數');
ok(sm.counts.maker[6] === 1 && sm.counts.maker[5] === 1 && sm.counts.user[3] === 1 && sm.counts.none[6] === 2, '2～8 級：客戶依類型計數');

// ---- 轉客戶：選等級 / 類型 ----
p = keyOf('甲設備');
r = call('handleProspectToCustomer', { key: p.Key, row: p.RowIndex, level: '4' });
c = cust('甲設備股份有限公司');
ok(r.success && c.Level === '4' && c.CustomerType === '設備商', '轉客戶：選 4 級，類型沿用名單的設備商');
p = keyOf('乙工廠');
call('handleProspectToCustomer', { key: p.Key, row: p.RowIndex });
c = cust('乙工廠有限公司');
ok(c.Level === '2' && c.CustomerType === '一般使用者', '沒選等級 → 2 有興趣');
sm = call('handleLevelSummary');
ok(sm.counts.maker[1] === 2 && sm.counts.user[1] === 0 && sm.counts.maker[4] === 1, '轉成客戶後不再算 1 級');
// 手動新增客戶時從名單轉入：類型帶過來
p = keyOf('丁備註');
call('handleAddCustomer', { companyName: '丁備註設備有限公司', fromProspect: { key: p.Key, row: p.RowIndex } });
ok(cust('丁備註設備有限公司').CustomerType === '設備商' && cust('丁備註設備有限公司').Level === '2', '新增客戶從名單轉入：類型帶入、等級 2');

// ---- 名片 ----
const card = (o) => {
  const id = (ctx.sheetToObjects('BotCards').rows.length || 0) + 1;
  ctx.appendObjectRow('BotCards', Object.assign({ ID: id, Owner: 'amy', Time: ctx.nowStr(), Status: 'pending' }, o));
  return id;
};
let id = card({ Name: '陳小姐', Company: '名片設備股份有限公司' });
r = call('handleCardToCustomer', { id, customerType: '設備商' });
c = cust('名片設備股份有限公司');
ok(r.success && c.Level === '2' && c.CustomerType === '設備商', '名片登入成客戶 → 2 有興趣，類型照選的');
id = card({ Name: '林先生', Company: '名片陌生有限公司' });
call('handleCardToProspect', { id, customerType: '一般使用者' });
ok(keyOf('名片陌生').Type === '一般使用者', '名片放進開發名單：類型照選的');
ok(ctx.permFor_('customerLevel')[1] === 'r' && ctx.permFor_('levelSummary')[1] === 'r', '權限：查看');

console.log('customers-level checks passed:', pass);

// ---- LINE 助理：新增客戶時可以帶類型與等級 ----
{
  const ctxStaff = { access: { canDelete: false, blocks: { customers: 'edit' } }, username: 'amy', name: 'Amy', ownerKey: 'amy' };
  const bad = (w) => { try { ctx.botWriteCheck_(ctxStaff, w); return null; } catch (e) { return e.message; } };
  assert.ok(/類型只能是/.test(bad({ action: 'addCustomer', data: { companyName: '助理新客戶有限公司', customerType: '代理商' } })), '助理：類型不合法被擋');
  assert.ok(/2～8/.test(bad({ action: 'addCustomer', data: { companyName: '助理新客戶有限公司', level: '1' } })), '助理：等級 1 被擋');
  assert.strictEqual(bad({ action: 'addCustomer', data: { companyName: '助理新客戶有限公司', customerType: '設備商', level: '4' } }), null, '助理：合法的通過');
  ctx.botWriteRun_(ctxStaff, { action: 'addCustomer', data: { companyName: '助理新客戶有限公司', customerType: '設備商', level: '4' } });
  const nc = cust('助理新客戶有限公司');
  assert.ok(nc && nc.Level === '4' && nc.CustomerType === '設備商', '助理新增客戶：類型與等級寫入');
  console.log('customers-level assistant checks passed');
}
