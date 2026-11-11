// 開發名單：轉成正式客戶、隱藏名單（不再匯入、不出現）、刪除、新增客戶時比對名單、名片加入開發名單
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
const find = (q) => call('handleProspectQuery', { q }).rows[0];
const customers = () => ctx.sheetToObjects('Customers').rows;

call('handleProspectImport', { source: '展覽', rows: [
  { Name: '甲精密股份有限公司', TaxId: '11111111', Website: 'www.jia.com.tw', Phone: '02-11112222', Email: 'sales@jia.com.tw', Contact: '王經理', Address: '臺中市西屯區', Notes: '攤位 A1' },
  { Name: '乙自動化有限公司', Phone: '03-3334444' },
  { Name: '丙光電股份有限公司', TaxId: '33333333' },
  { Name: '丁機械有限公司' },
  { Name: '戊電子有限公司' },
] });
ok(call('handleProspectQuery', {}).total === 5, '先匯入 5 家');

// ---- 一鍵轉客戶 ----
let p = find('甲精密');
call('handleProspectLogAdd', { key: p.Key, row: p.RowIndex, method: '電話', content: '第一次聯繫，對 AOI 有興趣', nextFollowUp: '2099-01-05' });
let r = call('handleProspectToCustomer', { key: p.Key, row: p.RowIndex, category: '機構合作設備商' });
ok(r.success && r.created && r.customer === '甲精密股份有限公司', '轉客戶：新增客戶');
let c = customers().find((x) => x.CompanyName === '甲精密股份有限公司');
ok(c && c.TaxId === '11111111' && c.CompanyPhone === '02-11112222' && c.Email === 'sales@jia.com.tw' && c.Contact === '王經理' && c.Address === '臺中市西屯區', '名單資料帶入客戶（統編 / 公司電話 / Email / 聯絡人 / 地址）');
ok(/jia\.com\.tw/.test(c.Website) && c.Category === '機構合作設備商' && /由開發名單轉入（來源：展覽/.test(c.Notes) && /攤位 A1/.test(c.Notes), '官網、分類、備註（來源 + 原本備註）');
ok(String(c.NextFollowUpDate).slice(0, 10) === '2099-01-05', '下次追蹤日帶到客戶');
const logs = ctx.sheetToObjects('ContactLogs').rows.filter((x) => x.CompanyName === '甲精密股份有限公司');
ok(logs.length === 1 && /【開發名單】第一次聯繫/.test(logs[0].Summary) && logs[0].Salesperson === 'amy' && r.logsCopied === 1, '聯繫紀錄複製到客戶');
p = find('甲精密');
ok(p.Stage === '已轉客戶' && p.ConvertedTo === '甲精密股份有限公司' && p.ConvertedAt && !p.NextFollowUp, '名單：已轉客戶、記下客戶名稱、清掉名單的追蹤日');
ok(call('handleProspectToCustomer', { key: p.Key, row: p.RowIndex }).success === false, '已轉過 → 不重複新增');
ok(customers().filter((x) => x.CompanyName === '甲精密股份有限公司').length === 1, '客戶只有一筆');

// 客戶管理已經有這家 → 不新增，只標已轉客戶
ctx.appendObjectRow('Customers', { CompanyName: '丙光電股份有限公司', TaxId: '33333333' });
p = find('丙光電');
r = call('handleProspectToCustomer', { key: p.Key, row: p.RowIndex });
ok(r.success && r.created === false && r.customer === '丙光電股份有限公司' && customers().filter((x) => x.CompanyName === '丙光電股份有限公司').length === 1, '已經是客戶 → 只標記，不重複新增');

// ---- 隱藏 ----
p = find('乙自動化');
r = call('handleProspectBulk', { keys: [p.Key], set: { Hidden: true } });
ok(r.success && r.count === 1, '隱藏 1 家');
let q = call('handleProspectQuery', {});
ok(q.total === 4 && q.hidden === 1 && !q.rows.some((x) => x.Name === '乙自動化有限公司'), '隱藏的不出現在名單（hidden 計數 1）');
ok(!q.facets.has.some((x) => x.v === 'H'), '聯絡方式統計不含隱藏記號');
q = call('handleProspectQuery', { hidden: 'only' });
ok(q.total === 1 && q.rows[0].Name === '乙自動化有限公司' && q.rows[0].Hidden === 'Y' && q.rows[0].HiddenBy === 'amy' && q.rows[0].HiddenAt, '「隱藏名單」可以看到（誰、什麼時候隱藏）');
// 隱藏的有追蹤日也不會出現在今天要聯繫
call('handleProspectUpdate', { key: p.Key, row: p.RowIndex, fields: { NextFollowUp: '2020-01-01', AssignedTo: '@me' } });
ok(!call('handleWorkAgenda', {}).prospects.some((x) => x.Name === '乙自動化有限公司'), '隱藏的不會出現在今天要聯繫');
ok(call('handleProspectEnrichPlan', { keys: [p.Key], onlyNew: false }).items.length === 0, '找官網也跳過隱藏的');
// 匯入前檢查：提醒在隱藏名單
r = call('handleProspectImportCheck', { rows: [{ Name: '乙自動化有限公司', Phone: '03-9999999' }, { Name: '新公司有限公司' }] });
ok(r.results[0].status === 'hidden' && r.results[0].hiddenBy === 'amy' && r.count.hidden === 1 && r.results[1].status === 'new', '匯入前檢查：標出隱藏名單');
// 匯入：隱藏的不會再加進來 / 不更新
r = call('handleProspectImport', { source: '第二份', rows: [{ Name: '乙自動化有限公司', Phone: '03-9999999' }] });
ok(r.added === 0 && r.merged === 0 && r.hiddenSkipped === 1, '匯入：隱藏的略過');
q = call('handleProspectQuery', { hidden: 'only' });
ok(q.rows[0].Phone === '03-3334444' && !/第二份/.test(q.rows[0].Source), '隱藏的資料沒有被改');
// 使用者選「恢復並匯入」
r = call('handleProspectImport', { source: '第二份', rows: [{ Name: '乙自動化有限公司', Email: 'b@yi.com.tw', _unhide: true }] });
ok(r.merged === 1 && r.hiddenSkipped === 0, '選恢復 → 取消隱藏並合併');
p = find('乙自動化');
ok(p && !p.Hidden && p.Email === 'b@yi.com.tw' && call('handleProspectQuery', { hidden: 'only' }).total === 0, '恢復後回到名單');
// 取消隱藏（批次）
call('handleProspectBulk', { keys: [p.Key], set: { Hidden: true } });
r = call('handleProspectBulk', { filter: { hidden: 'only' }, set: { Hidden: false } });
ok(r.count === 1 && call('handleProspectQuery', {}).total === 5 && !find('乙自動化').Has.includes('H'), '隱藏名單 → 全部取消隱藏');

// ---- 新增客戶時比對名單 ----
p = find('丁機械');
call('handleProspectBulk', { keys: [p.Key], set: { Hidden: true } });
r = call('handleProspectLookup', { name: '丁機械有限公司' });
ok(r.matches.length === 1 && r.matches[0].hidden === true && r.matches[0].name === '丁機械有限公司', '新增客戶前比對：找到隱藏名單裡的');
ok(call('handleProspectLookup', { name: '甲精密股份有限公司' }).matches.length === 0, '已轉過客戶的不再提醒');
ok(call('handleProspectLookup', { name: '台灣不存在公司' }).matches.length === 0, '名單沒有 → 空');
r = call('handleAddCustomer', { companyName: '丁機械有限公司', contact: '李先生', category: '一般客戶', fromProspect: { key: r.matches[0].key, row: r.matches[0].row } });
ok(r.success && r.fromProspect, '新增客戶時選「轉客戶」');
p = call('handleProspectQuery', {}).rows.find((x) => x.Name === '丁機械有限公司');
ok(p && p.Stage === '已轉客戶' && !p.Hidden && p.ConvertedTo === '丁機械有限公司', '隱藏名單的公司轉客戶後：取消隱藏、已轉客戶');
c = customers().find((x) => x.CompanyName === '丁機械有限公司');
ok(c.Contact === '李先生' && /由開發名單轉入/.test(c.Notes), '使用者填的優先，備註記來源');

// ---- 刪除 ----
p = find('戊電子');
call('handleProspectLogAdd', { key: p.Key, row: p.RowIndex, method: '電話', content: 'x' });
r = call('handleProspectDelete', { keys: [p.Key] });
ok(r.success && r.count === 1 && r.logsRemoved === 1, '刪除 1 家（連同聯繫紀錄）');
ok(!find('戊電子') && call('handleProspectQuery', {}).total === 4, '刪掉後不見了');
r = call('handleProspectImport', { source: '第三份', rows: [{ Name: '戊電子有限公司' }] });
ok(r.added === 1, '刪除的可以再匯入（跟隱藏不同）');
ok(call('handleProspectDelete', {}).success === false, '沒指定 → 拒絕');
r = call('handleProspectDelete', { all: true, filter: { q: '戊電子' } });
ok(r.count === 1 && call('handleProspectQuery', {}).total === 4, '刪除符合篩選的全部');
ok(ctx.permFor_('prospectDelete')[1] === 'd' && ctx.permFor_('prospectToCustomer')[1] === 'w' && ctx.permFor_('prospectLookup')[1] === 'r', '權限：刪除要刪除權、轉客戶要編輯權');

// ---- 名片 ----
const card = (o) => {
  const id = (ctx.sheetToObjects('BotCards').rows.length || 0) + 1;
  ctx.appendObjectRow('BotCards', Object.assign({ ID: id, Owner: 'amy', Time: ctx.nowStr(), Status: 'pending' }, o));
  return id;
};
let id = card({ Name: '陳小姐', Title: '採購', Company: '己科技股份有限公司', Phone: '0912-345678', CompanyPhone: '04-22223333', Email: 'chen@ji.com.tw', Batch: '2026 自動化展' });
r = call('handleCardToProspect', { id });
ok(r.success && r.added === 1 && r.source === '名片（2026 自動化展）', '名片 → 開發名單（來源標名片）');
p = find('己科技');
ok(p.Source === '名片（2026 自動化展）' && p.Contact === '陳小姐 採購' && p.Phone === '04-22223333' && p.Email === 'chen@ji.com.tw' && p.AssignedTo === 'amy', '名片欄位帶入、負責業務是自己');
ok(/聯絡人電話：0912-345678/.test(p.Notes) && /名片登入/.test(p.Notes), '個人手機記在備註');
let cardRow = ctx.sheetToObjects('BotCards').rows.find((x) => Number(x.ID) === id);
ok(cardRow.Status === 'saved' && /加入開發名單（陌生開發）/.test(cardRow.Result), '名片標成已登入');
ok(!customers().some((x) => x.CompanyName === '己科技股份有限公司'), '沒有變成客戶');
ok(call('handleCardToProspect', { id }).success === false, '同一張不能再登入');
// 已經是客戶 → 不能加到陌生名單
id = card({ Name: '林先生', Company: '甲精密股份有限公司' });
r = call('handleCardToProspect', { id });
ok(!r.success && /已經是客戶/.test(r.message), '已是客戶 → 拒絕加入陌生名單');
// 隱藏名單 → 要確認
p = find('乙自動化');
call('handleProspectBulk', { keys: [p.Key], set: { Hidden: true } });
id = card({ Name: '張經理', Company: '乙自動化有限公司', Email: 'chang@yi.com.tw' });
r = call('handleCardToProspect', { id });
ok(!r.success && r.hidden, '公司在隱藏名單 → 先問');
r = call('handleCardToProspect', { id, unhide: true });
ok(r.success && find('乙自動化') && /名片/.test(find('乙自動化').Source), '確認後恢復並併入');
// 名片登入成客戶時，從名單轉入
p = find('己科技');
id = card({ Name: '黃先生', Company: '己科技股份有限公司', Phone: '0922-000000' });
r = call('handleCardToCustomer', { id, fromProspect: { key: p.Key, row: p.RowIndex } });
ok(r.success && r.kind === 'newCustomer', '名片登入成客戶');
c = customers().find((x) => x.CompanyName === '己科技股份有限公司');
ok(c && c.Contact === '黃先生' && c.Email === 'chen@ji.com.tw' && find('己科技').Stage === '已轉客戶', '名單資料補空白欄位，名單標成已轉客戶');
ok(ctx.permFor_('cardToProspect')[1] === 'w', '權限：名片加入開發名單要編輯權');

console.log('prospects-convert checks passed:', pass);
