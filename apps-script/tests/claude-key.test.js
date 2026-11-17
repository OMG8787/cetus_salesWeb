// Claude 專用金鑰：只存雜湊、只能讀未處理名單 / 匯入（不重複不覆蓋）/ 只補空白寫回 / 草稿不覆蓋；不能刪除、寄信、改狀態
const assert = require('assert');
const path = require('path');
const { makeEnv } = require('./gasmock');
const { ctx, props } = makeEnv({ files: [path.join(__dirname, '..', 'Code.gs')] });
let pass = 0;
const ok = (c, m) => {
  assert.ok(c, m);
  pass++;
};
const me = { username: 'amy', displayName: 'Amy' };
const call = (fn, body) => ctx[fn](Object.assign({ _user: me }, body || {}));
const find = (q) => call('handleProspectQuery', { q }).rows[0];
const post = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).s);

// ---- 尚未啟用 / 金鑰 ----
let r = post({ action: 'claudeApi', secret: 'x', op: 'ping' });
ok(!r.success && r.code === 'CLAUDE_OFF', '沒產生金鑰前一律拒絕');
const key = ctx.claudeKeyGenerate();
ok(/^ck_[0-9a-f]{64}$/.test(key), '產生金鑰');
ok(props.CLAUDE_KEY_HASH && props.CLAUDE_KEY_HASH !== key && JSON.stringify(props).indexOf(key) < 0, '屬性只存雜湊，不存明碼');
ok(!post({ action: 'claudeApi', secret: 'wrong', op: 'ping' }).success, '金鑰錯誤 → 拒絕');
const api = (op, body) => post(Object.assign({ action: 'claudeApi', secret: key, op }, body || {}));
r = api('ping');
ok(r.success && r.ops.indexOf('import') > -1, '金鑰正確、不用登入就能 ping');
ok(['delete', 'send', 'prospectDelete', 'prospectMailSend', 'prospectBulk', 'prospectClear', 'update'].every((op) => !api(op).success), '刪除 / 寄信 / 批次改狀態 / 清空 / 任意更新都不能做');
ok(!post({ action: 'prospectDelete', secret: key, key: 'x' }).success, '拿這把金鑰呼叫一般動作 → 要登入，擋下');

// ---- 準備：名單 + 客戶 + 隱藏 ----
call('handleProspectImport', { source: '展覽', rows: [
  { Name: '甲精密股份有限公司', TaxId: '11111111', Phone: '02-11112222', Type: '設備商' },
  { Name: '乙自動化有限公司', Website: 'www.yi.com.tw', Email: 'old@yi.com.tw', Type: '設備商' },
  { Name: '丙光電股份有限公司', TaxId: '33333333', Type: '一般使用者' },
  { Name: '丁機械有限公司' },
  { Name: '隱藏工業有限公司' },
] });
let p = find('丁機械');
call('handleProspectUpdate', { key: p.Key, row: p.RowIndex, fields: { Stage: '已聯絡' } });
p = find('隱藏工業');
call('handleProspectBulk', { keys: [p.Key], set: { Hidden: true } });
call('handleAddCustomer', { companyName: '己客戶股份有限公司', contact: '陳先生', category: '一般客戶' });

// ---- list：只給未處理、沒隱藏 ----
r = api('list', { limit: 50 });
let names = r.rows.map((x) => x.name);
ok(r.success && r.total === 3 && names.indexOf('丁機械有限公司') < 0 && names.indexOf('隱藏工業有限公司') < 0, 'list：已聯絡、隱藏的不給');
ok(r.rows[0].key && r.rows[0].row >= 2 && 'hasMail' in r.rows[0], 'list：帶 key / row / hasMail');
ok(api('list', { type: 'D' }).total === 2 && api('list', { type: 'U' }).total === 1, 'list：可以只看設備商 / 一般使用者');
ok(api('list', { limit: 1, offset: 1 }).rows.length === 1, 'list：分頁');

// ---- index：全部名單的名稱 / 官網 / 統編（含已聯絡、隱藏），匯入前比對用 ----
r = api('index');
ok(r.success && r.rows.length === 5 && r.rows.some((x) => x[0] === '隱藏工業有限公司') && r.rows.some((x) => x[0] === '乙自動化有限公司' && /yi\.com\.tw/.test(x[1])) && r.rows.some((x) => x[2] === '11111111'), 'index：含隱藏、已聯絡，帶官網與統編');

// ---- mailCfg：給寫信用的設定，不給附件 ----
r = api('mailCfg');
ok(r.success && /AOI/.test(r.cfg.strategy) && r.cfg.signature && !('attach' in r.cfg), 'mailCfg：寫信原則、署名；不含附件');

// ---- import：不重複、不覆蓋、略過客戶與隱藏 ----
r = api('import', { source: '2026 測試', rows: [
  { Name: '新公司股份有限公司', Website: 'https://www.new.com.tw', Email: 'sales@new.com.tw' },
  { Name: '乙自動化有限公司', Email: 'NEW@yi.com.tw', Phone: '03-1234567', _update: true },
  { Name: '己客戶股份有限公司' },
  { Name: '隱藏工業有限公司', _unhide: true },
  { Name: '新公司股份有限公司' },
  { Name: '' },
] });
ok(r.success && r.added === 1, '匯入：只新增 1 家新的');
const st = {};
r.skipped.forEach((s) => { st[s.name || '(空)'] = s.status; });
ok(st['己客戶股份有限公司'] === 'customer' && st['隱藏工業有限公司'] === 'hidden' && st['新公司股份有限公司'] === 'dup' && st['(空)'] === 'invalid', '匯入：客戶 / 隱藏 / 同批重複 / 沒名稱 都略過並回報');
p = find('乙自動化');
ok(p.Email === 'old@yi.com.tw' && p.Phone === '03-1234567', '匯入：已存在的只補空白（電話補上），Email 不覆蓋（_update 無效）');
ok(!find('己客戶'), '匯入：已是客戶的不加進名單');
ok(!find('隱藏工業') && call('handleProspectQuery', {}).hidden === 1, '匯入：隱藏的不會被取消隱藏（_unhide 無效）');
ok(/Claude代查/.test(find('新公司').Source), '匯入：來源標「Claude代查」');
ok(!api('import', { rows: [{ Name: 'x' }] }).success, '匯入：沒填來源 → 擋下');

// ---- fill：只補空白、草稿不覆蓋、不動狀態 ----
const a = find('甲精密');
const b = find('乙自動化');
r = api('fill', { items: [
  { key: a.Key, row: a.RowIndex, Website: 'https://www.jia.com.tw', Phone: '09-99999999', Email: 'sales@jia.com.tw', Enriched: 'ok', EnrichNote: '讀了 3 頁', MailSubject: '主旨A', MailBody: '甲精密您好：\n內容' },
  { key: b.Key, row: b.RowIndex, Email: 'x@yi.com.tw', Website: 'https://evil.example.com' },
  { key: 'nope', row: 2 },
] });
ok(r.success && r.results[0].status === 'updated' && r.results[0].mail === 'saved', 'fill：寫入官網、Email、草稿');
ok(r.results[1].status === 'same' && r.results[2].status === 'notfound', 'fill：已有值的不覆蓋（沒變化回 same）；找不到回 notfound');
let a2 = find('甲精密');
ok(a2.Phone === '02-11112222' && a2.Email === 'sales@jia.com.tw' && /jia\.com\.tw/.test(a2.Website), 'fill：電話原本就有 → 不覆蓋；空白的補上');
ok(find('乙自動化').Email === 'old@yi.com.tw' && /yi\.com\.tw/.test(find('乙自動化').Website), 'fill：乙的 Email / 官網不被覆蓋');
ok(a2.HasMail === 1 && (a2.Stage === '' || a2.Stage === '未處理'), 'fill：有草稿旗標、開發狀態不變');
const pv = call('handleProspectMailPreview', { key: a2.Key, row: a2.RowIndex });
ok(pv.hasDraft && pv.subject === '主旨A' && /甲精密您好/.test(pv.body), 'fill：網站預覽看得到 Claude 寫的草稿');
r = api('fill', { items: [{ key: a2.Key, row: a2.RowIndex, MailBody: '第二版' }] });
ok(r.results[0].mail === 'kept' && /甲精密您好/.test(call('handleProspectMailPreview', { key: a2.Key, row: a2.RowIndex }).body), 'fill：已經有草稿 → 不覆蓋');
ok(api('list', { noMail: true }).rows.every((x) => x.name !== '甲精密股份有限公司'), 'list noMail：有草稿的不再列出');
ok(!api('fill', { items: [] }).success, 'fill：空的擋下');

// ---- 換金鑰 / 停用 ----
const key2 = ctx.claudeKeyGenerate();
ok(!api('ping').success && post({ action: 'claudeApi', secret: key2, op: 'ping' }).success, '重新產生：舊金鑰立刻失效、新的可用');
ctx.claudeKeyRevoke();
ok(!post({ action: 'claudeApi', secret: key2, op: 'ping' }).success, '停用後一律拒絕');

console.log('claude-key: ' + pass + ' passed');
