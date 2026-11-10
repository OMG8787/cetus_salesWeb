// 開發名單：匯入 Claude 產出的 CSV、聯繫紀錄、下次追蹤日、「今天要聯繫」篩選與排序、舊分頁自動補欄
const assert = require('assert');
const path = require('path');
const { makeEnv } = require('./gasmock');
const lib = require('../../frontend/prospects-lib.js');
const { ctx, extraSs, props } = makeEnv({ files: [path.join(__dirname, '..', 'Code.gs')] });
let pass = 0;
const ok = (c, m) => {
  assert.ok(c, m);
  pass++;
};
const amy = { username: 'amy' };
const ben = { username: 'ben' };
const call = (fn, body, user) => ctx[fn](Object.assign({ _user: user || amy }, body || {}));
const today = ctx.todayStr();
const plus = (n) => ctx.addDaysStr(today, n);

// ---- 用 Claude 產出的 CSV 格式匯入 ----
const csv = '﻿公司名稱,統一編號,官網,Email,公司電話,產業,備註\r\n' +
  '均豪精密工業股份有限公司,12345678,https://www.gpmcorp.com.tw,sales@gpmcorp.com.tw,03-5639999,設備商、面板 / 半導體設備,AOI 潛在客戶：設備商（面板 / 半導體設備）；Claude 核對官網 2026-11-10\r\n' +
  '福泰益自動化設備股份有限公司,,https://www.futaiyi.com/tw,fy101@futaiyi.com,06-6521616,設備商、自動化,2027 自動化展參展商（攤位 K116）\r\n' +
  '鑫野智動工業股份有限公司,,https://www.injection.com.tw,,03-3218768,設備商、自動化,\r\n';
const file = { headers: null, rows: null };
const parsed = lib.psParseCsv(lib.psDecode(Buffer.from(csv, 'utf8')));
file.headers = parsed[0].map((h) => h.replace(/^﻿/, ''));
file.rows = parsed.slice(1);
const map = lib.psAutoMap(file.headers);
ok(map.Name === 0 && map.TaxId === 1 && map.Website === 2 && map.Email === 3 && map.Phone === 4 && map.Category === 5 && map.Notes === 6, 'Claude 產出的 CSV：7 個欄位全部自動對應');
const { records } = lib.psBuildRecords(file.rows, map);
let r = call('handleProspectImport', { source: 'Claude 查詢－設備商', rows: records });
ok(r.success && r.added === 3, '匯入 3 家');
let q = call('handleProspectQuery', { q: '均豪' });
let g = q.rows[0];
ok(g.Website === 'https://www.gpmcorp.com.tw' && g.Email === 'sales@gpmcorp.com.tw' && g.Phone === '03-5639999' && g.TaxId === '12345678' && /Claude 核對/.test(g.Notes) && g.Source === 'Claude 查詢－設備商', '官網 / Email / 電話 / 統編 / 備註 / 來源都進來了');
ok(g.Has.indexOf('P') > -1 && g.Has.indexOf('E') > -1 && g.Has.indexOf('W') > -1, '「有電話 / 有 Email / 有網站」篩選可用');
ok(q.rows[0].Stage === '未處理' && !g.NextFollowUp && !g.LastContactAt, '剛匯入：未處理、沒有追蹤日');

// ---- 聯繫紀錄 ----
r = call('handleProspectLogAdd', { key: g.Key, row: g.RowIndex, method: '電話', content: '打總機，轉設備部林經理，對 AOI 有興趣\n約下週二回電', nextFollowUp: plus(-1) });
ok(r.success && r.log.Method === '電話' && r.log.User === 'amy' && r.log.Time && r.log.NextFollowUp === plus(-1), '新增聯繫紀錄');
ok(r.row.Stage === '已聯絡' && r.row.AssignedTo === 'amy' && r.row.LastContactAt === r.log.Time && r.row.NextFollowUp === plus(-1), '第一次聯繫：狀態自動變「已聯絡」、記錄的人成為負責業務、更新最後聯繫與下次追蹤日');
r = call('handleProspectLogAdd', { key: g.Key, row: g.RowIndex, method: 'Email', content: '寄型錄與報價', stage: '有興趣', nextFollowUp: plus(3) });
ok(r.success && r.row.Stage === '有興趣' && r.row.NextFollowUp === plus(3), '指定狀態與新的追蹤日');
r = call('handleProspectLogAdd', { key: g.Key, row: g.RowIndex, method: '拜訪', content: '現場 Demo' }, ben);
ok(r.success && r.row.AssignedTo === 'amy' && r.row.Stage === '有興趣' && r.row.NextFollowUp === '', '別人記錄不會搶走負責業務；沒給狀態就不改；沒給追蹤日 = 清除');
let logs = call('handleProspectLogs', { key: g.Key });
ok(logs.success && logs.logs.length === 3 && logs.logs[0].Method === '拜訪' && logs.logs[0].User === 'ben' && logs.logs[2].Method === '電話', '紀錄依時間新到舊（同一分鐘依編號）');
ok(logs.logs[2].Content.indexOf('\n') > -1, '內容保留換行');
ok(logs.methods.indexOf('LINE') > -1, '回傳可選的聯繫方式');
ok(call('handleProspectLogs', { key: 'R:不存在' }).logs.length === 0, '沒有紀錄的公司 → 空陣列');

// 防呆
ok(call('handleProspectLogAdd', { key: g.Key, method: '飛鴿傳書', content: 'x' }).success === false, '不在清單的聯繫方式 → 拒絕');
ok(call('handleProspectLogAdd', { key: g.Key, method: '電話', content: '  ' }).success === false, '沒寫內容 → 拒絕');
ok(/yyyy-MM-dd/.test(call('handleProspectLogAdd', { key: g.Key, method: '電話', content: 'x', nextFollowUp: '下週' }).message), '追蹤日格式錯 → 拒絕');
ok(call('handleProspectLogAdd', { key: g.Key, method: '電話', content: 'x', stage: '亂寫' }).success === false, '狀態不在清單 → 拒絕');
ok(call('handleProspectLogAdd', { key: 'R:不存在', method: '電話', content: 'x' }).success === false, '找不到名單 → 拒絕');
ok(call('handleProspectLogs', { key: g.Key }).logs.length === 3, '被拒絕的不會寫入紀錄');
r = call('handleProspectLogAdd', { key: g.Key, row: 999, method: 'LINE', content: '列號錯也找得到', nextFollowUp: plus(-3) });
ok(r.success && r.row.Name === '均豪精密工業股份有限公司', '列號對不上時用 Key 找');

// ---- 今天要聯繫 / 已排定 / 沒排 ----
const f = call('handleProspectQuery', { q: '福泰益' }).rows[0];
call('handleProspectLogAdd', { key: f.Key, row: f.RowIndex, method: '電話', content: '沒人接', nextFollowUp: today });
const x = call('handleProspectQuery', { q: '鑫野' }).rows[0];
call('handleProspectLogAdd', { key: x.Key, row: x.RowIndex, method: '電話', content: '請寄資料', nextFollowUp: plus(7) }, ben);
q = call('handleProspectQuery', { follow: 'due' });
ok(q.total === 2 && q.rows[0].Name.indexOf('均豪') === 0 && q.rows[1].Name.indexOf('福泰益') === 0, '「今天以前要聯繫」：逾期的排最前面（3 天前 → 今天）');
q = call('handleProspectQuery', { follow: 'due', assigned: 'me' });
ok(q.total === 2, '我負責、今天要聯繫的 2 家');
q = call('handleProspectQuery', { follow: 'due', assigned: 'me' }, ben);
ok(q.total === 0, 'ben 今天沒有要聯繫的');
q = call('handleProspectQuery', { follow: 'planned' });
ok(q.total === 1 && q.rows[0].Name.indexOf('鑫野') === 0, '「已排定（未來）」');
call('handleProspectImport', { source: '其他', rows: [{ Name: '還沒聯繫工業社' }] });
q = call('handleProspectQuery', { follow: 'none' });
ok(q.total === 1 && q.rows[0].Name === '還沒聯繫工業社', '「沒有排追蹤日」');
q = call('handleProspectQuery', {});
ok(q.total === 4, '不選追蹤條件 = 全部');

// ---- 從編輯視窗直接改追蹤日 ----
r = call('handleProspectUpdate', { key: f.Key, row: f.RowIndex, fields: { NextFollowUp: plus(2) } });
ok(r.success && r.row.NextFollowUp === plus(2), '編輯時可直接改下次追蹤日');
ok(call('handleProspectUpdate', { key: f.Key, row: f.RowIndex, fields: { NextFollowUp: '明天' } }).success === false, '編輯時日期格式錯 → 拒絕');

// ---- 權限 ----
ok(ctx.permFor_('prospectLogs')[1] === 'r' && ctx.permFor_('prospectLogAdd')[1] === 'w' && ctx.getRoute_('prospectLogAdd').auth === true, '權限與路由');

// ---- 舊版名單分頁（沒有新欄位）自動補欄，資料不動 ----
const ss = extraSs[props.PROSPECT_SSID];
const sh = ss.getSheetByName('Prospects');
const oldCols = ctx.PS_COLS.length - 2;
const cnt = sh.getLastRow();
for (let rr = 1; rr <= cnt; rr++) { sh.rows[rr - 1].length = oldCols; }
ok(sh.getLastColumn() === oldCols, '（模擬舊版分頁：少了最後 2 欄）');
q = call('handleProspectQuery', { q: '均豪' });
ok(sh.getRange(1, 1, 1, ctx.PS_COLS.length).getValues()[0].join() === ctx.PS_COLS.join(), '查詢時自動補上新欄位標題');
ok(q.rows[0].Name.indexOf('均豪') === 0 && q.rows[0].Email === 'sales@gpmcorp.com.tw', '既有資料不動');

console.log('prospects-logs checks passed:', pass);
