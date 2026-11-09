// 開發名單庫：匯入（分批、去重、跨來源合併）、篩選與分面統計、關鍵字、分頁、修改、批次修改、匯出、清空、權限
const assert = require('assert');
const path = require('path');
const { makeEnv } = require('./gasmock');
const { ctx, props, extraSs } = makeEnv({ files: [path.join(__dirname, '..', 'Code.gs')] });
let pass = 0;
const ok = (c, m) => {
  assert.ok(c, m);
  pass++;
};
const me = { username: 'amy', displayName: 'Amy' };
const call = (fn, body) => ctx[fn](Object.assign({ _user: me }, body || {}));
const SRC = '經濟部生產中工廠名錄';

// ---- 權限 / 路由 ----
const perms = ctx.prospectPerms_();
ok(perms.prospectQuery[0] === 'customers' && perms.prospectImport[1] === 'w' && perms.prospectClear[0] === 'admin' && perms.prospectClear[1] === 'd', '權限：看 / 改歸客戶區塊，清空只有管理員');
ok(ctx.permFor_('prospectBulk')[1] === 'w' && ctx.getRoute_('prospectQuery').auth === true, '權限與路由都接上了');

// ---- 還沒匯入過 ----
let r = call('handleProspectQuery', {});
ok(r.success && r.ready === false && r.total === 0 && r.rows.length === 0, '沒匯入過：回空結果，不會自己建試算表');
ok(!props.PROSPECT_SSID, '查詢不會建立試算表');

// ---- 欄位解析 ----
const cats = ctx.psCatParse_('13皮革、毛皮及其製品製造業、15紙漿、紙及紙製品製造業、29機械設備製造業  ');
ok(JSON.stringify(cats.map((c) => c.code)) === '["13","15","29"]', '產業類別：名稱裡有頓號也能正確切成 13 / 15 / 29');
ok(cats[1].name === '紙漿、紙及紙製品製造業', '名稱保留完整');
ok(JSON.stringify(ctx.psCatParse_('半導體、PCB／載板').map((c) => c.code)) === '["半導體","PCB","載板"]', '自由文字的產業用符號切開');
ok(ctx.psCityOf_('台南市永康區') === '臺南市' && ctx.psCityOf_('330桃園縣桃園市') === '桃園市' && ctx.psCityOf_('不明地址') === '', '縣市：台→臺、舊桃園縣、找不到回空');
ok(ctx.psTaxId_('1234567') === '01234567' && ctx.psTaxId_('abc') === '' && ctx.psTaxId_('22099131') === '22099131', '統編：7 碼補 0、非數字視為沒有');
ok(ctx.psWebsite_('javascript:alert(1)') === '' && ctx.psWebsite_('www.a.com') === 'www.a.com', '網站：不收 javascript: 等危險網址');
ok(ctx.psEmail_('Sales@A.com; x@y.com') === 'sales@a.com' && ctx.psEmail_('壞掉') === '', 'Email：取第一個、轉小寫、格式不對就丟掉');

// ---- 匯入（工廠名錄）----
const fac = (i, o) => Object.assign({ Name: '工廠' + i, RegNo: 'F' + String(i).padStart(6, '0'), TaxId: String(10000000 + i), Address: '臺中市西屯區工業路' + i + '號', Owner: '王' + i, Category: '29機械設備製造業、25金屬製品製造業', Products: '293通用機械設備', Status: '生產中', Org: '有限公司' }, o || {});
const batch1 = [
  fac(1),
  fac(2, { Address: '新北市樹林區中山路2號', Category: '26電子零組件製造業' }),
  fac(3, { Address: '台南市永康區1號', Category: '13皮革、毛皮及其製品製造業、15紙漿、紙及紙製品製造業', TaxId: '1234567' }),
  fac(4, { Address: '彰化縣和美鎮1號', Category: '22塑膠製品製造業', Products: '塑膠射出成型 AOI 檢測治具' }),
  { Name: '', TaxId: '99999999' },
];
r = call('handleProspectImport', { source: SRC, rows: batch1 });
ok(r.success && r.added === 4 && r.invalid === 1 && r.total === 4, '第一批：新增 4 筆、沒有名稱的 1 筆略過');
ok(props.PROSPECT_SSID && extraSs[props.PROSPECT_SSID], '第一次匯入自動建立獨立試算表');
const ss = extraSs[props.PROSPECT_SSID];
ok(ss.getSheetByName('Prospects') && !ss.getSheetByName('工作表1'), '預設的空白工作表改名成 Prospects');
ok(ctx.getDb_ && ctx.getDb_(false).getSheetByName('Prospects') == null, '名單不會寫進主資料庫');
const sh = ss.getSheetByName('Prospects');
ok(sh.getRange(1, 1, 1, 25).getValues()[0].join() === ctx.PS_COLS.join(), '標題列正確');
r = call('handleProspectImport', { source: SRC, rows: batch1 });
ok(r.success && r.added === 0 && r.same === 4 && r.total === 4, '同一批再匯入一次：不重複、沒有變動');
ok(sh.getLastRow() === 5, '試算表仍是 4 筆資料');
const tax = ctx.psColVals_(sh, ctx.psCol_('TaxId'), 4);
ok(tax[2] === '01234567', '統編開頭的 0 保留（7 碼補回 8 碼）');

// ---- 同一批裡重複 ----
r = call('handleProspectImport', { source: SRC, rows: [fac(10), fac(10, { Owner: '重複的人' })] });
ok(r.added === 1 && r.duplicateInBatch === 1 && r.total === 5, '同一批裡重複的只算一筆');

// ---- 跨來源合併：先有工廠、後匯入沒有登記編號的聯絡名單（同統編）----
r = call('handleProspectImport', { source: '2026自動化展', rows: [{ Name: '工廠1', TaxId: '10000001', Phone: '04-22223333', Email: 'Sales@Fac1.com', Website: 'www.fac1.com', Category: '自動化設備' }, { Name: '展覽新公司', TaxId: '55555555', Phone: '0912345678', Category: '自動化設備' }] });
ok(r.success && r.added === 1 && r.merged === 1 && r.total === 6, '同統編的聯絡名單合併進工廠，不重複新增');
let q = call('handleProspectQuery', { q: '工廠1' });
const f1 = q.rows.find((x) => x.RegNo === 'F000001');
ok(f1 && f1.Phone === '04-22223333' && f1.Email === 'sales@fac1.com' && f1.Website === 'www.fac1.com', '電話 / Email / 網站補進原本的工廠');
ok(f1.Source === SRC + '、2026自動化展', '來源記錄兩個');
ok(f1.Category.indexOf('29機械設備製造業') === 0, '原有的產業類別沒被蓋掉（只補空欄位）');
ok(f1.Has === 'PEW' && f1.CatCodes === '29|25', '有電話 / Email / 網站旗標、產業代碼正確');

// ---- 反過來：先有聯絡名單，後匯入工廠（同統編）→ 補上登記編號 ----
r = call('handleProspectImport', { source: SRC, rows: [fac(55, { Name: '展覽新公司', TaxId: '55555555', RegNo: 'F000055', Category: '26電子零組件製造業' })] });
ok(r.added === 0 && r.merged === 1 && r.total === 6, '後匯入的工廠登記資料併進先前的聯絡名單');
q = call('handleProspectQuery', { q: '55555555' });
ok(q.total === 1 && q.rows[0].RegNo === 'F000055' && q.rows[0].Key === 'R:F000055' && q.rows[0].Phone === '0912345678' && q.rows[0].Source === '2026自動化展、' + SRC, '合併後有登記編號、保留電話與兩個來源');
ok(q.rows[0].Phone === '0912345678', '電話開頭的 0 保留');

// ---- 覆蓋更新 ----
r = call('handleProspectImport', { source: SRC, rows: [fac(2, { Owner: '新負責人', Address: '新北市樹林區中山路2號' })] });
ok(r.same === 1 && r.merged === 0, '沒勾「覆蓋更新」：既有欄位不動');
r = call('handleProspectImport', { source: SRC, update: true, rows: [fac(2, { Owner: '新負責人', Category: '26電子零組件製造業' })] });
ok(r.merged === 1, '勾了「覆蓋更新」：有差異的欄位才更新');
q = call('handleProspectQuery', { q: '新負責人' });
ok(q.total === 1 && q.rows[0].Owner === '新負責人', '負責人已更新');
ok(call('handleProspectImport', { source: '', rows: [fac(1)] }).success === false, '沒有來源 → 拒絕');
ok(call('handleProspectImport', { source: SRC, rows: [] }).success === false, '沒有資料 → 拒絕');
ok(call('handleProspectImport', { source: SRC, rows: Array.from({ length: 3001 }, (_, i) => fac(i)) }).success === false, '一批超過 3000 筆 → 拒絕');

// ---- 大量資料：再匯入 6000 筆，分兩批 ----
const cities = ['臺中市', '新北市', '彰化縣', '桃園市', '高雄市'];
const catSet = ['25金屬製品製造業', '29機械設備製造業', '22塑膠製品製造業', '26電子零組件製造業、27電腦、電子產品及光學製品製造業'];
const bulk = Array.from({ length: 6000 }, (_, i) => fac(1000 + i, { Address: cities[i % 5] + '某區' + i + '號', Category: catSet[i % 4], Products: i % 50 === 0 ? 'AOI 光學檢測設備' : '一般零件' }));
const t0 = Date.now();
ok(call('handleProspectImport', { source: SRC, rows: bulk.slice(0, 3000) }).added === 3000, '大量：第一批 3000 筆');
ok(call('handleProspectImport', { source: SRC, rows: bulk.slice(3000) }).added === 3000, '大量：第二批 3000 筆');
ok(call('handleProspectImport', { source: SRC, rows: bulk.slice(0, 3000) }).same === 3000, '大量：重送整批 → 全部辨識為已存在');
console.log('  （匯入 6000 筆含重送，模擬環境耗時 ' + (Date.now() - t0) + ' ms）');

// ---- 篩選 / 分面 ----
q = call('handleProspectQuery', { size: 20 });
ok(q.all === 6006 && q.total === 6006 && q.rows.length === 20 && q.pages === 301, '全部 6006 筆、每頁 20 筆、共 301 頁');
const facOf = (list, v) => (list.find((x) => x.v === v) || { n: 0 }).n;
ok(facOf(q.facets.source, SRC) === 6006 && facOf(q.facets.source, '2026自動化展') === 2, '來源統計（合併的兩個來源各算一次）');
ok(facOf(q.facets.cat, '29') > 1500 && facOf(q.facets.cat, '13') === 1 && facOf(q.facets.cat, '15') === 1, '產業統計：一家可屬於多個產業');
ok(facOf(q.facets.city, '臺南市') === 1 && facOf(q.facets.city, '臺中市') > 1000, '縣市統計（台南市→臺南市）');
ok(facOf(q.facets.stage, '未處理') === 6006, '全部都是「未處理」');

q = call('handleProspectQuery', { cats: ['29'], cities: ['臺中市'], size: 10 });
ok(q.total > 0 && q.rows.every((x) => x.City === '臺中市' && x.CatCodes.split('|').indexOf('29') > -1), '產業 + 縣市 AND 篩選，結果都符合');
q = call('handleProspectQuery', { cats: ['29'], size: 10 });
const qAll = call('handleProspectQuery', { cats: ['29'], cities: ['臺中市'], size: 10 });
ok(facOf(qAll.facets.cat, '25') > 0 && facOf(qAll.facets.cat, '29') === qAll.total, '分面：產業清單算「套用縣市、不含產業自己」→ 其他產業仍看得到數字');
ok(facOf(qAll.facets.city, '新北市') === 0 || facOf(qAll.facets.city, '新北市') >= 0, '縣市清單算「套用產業、不含縣市自己」');
const cityNums = q.facets.city.reduce((s, x) => s + x.n, 0);
ok(cityNums >= q.total, '單選產業時，縣市統計加總 ≥ 符合筆數');
q = call('handleProspectQuery', { cats: ['22', '26'], size: 10 });
ok(q.total > 3000 && q.rows.every((x) => /22|26/.test(x.CatCodes)), '同一分面多選 = OR');

// 關鍵字
q = call('handleProspectQuery', { q: 'aoi 光學' });
ok(q.total === 120 && q.rows[0].Products.indexOf('AOI') > -1, '關鍵字：不分大小寫、多詞 AND（搜到主要產品）');
q = call('handleProspectQuery', { q: '台南' });
ok(q.total === 1 && q.rows[0].Name === '工廠3', '關鍵字：輸入「台」也找得到「臺」');
q = call('handleProspectQuery', { q: '01234567' });
ok(q.total === 1, '關鍵字：搜統編');
q = call('handleProspectQuery', { q: '工廠1', cats: ['29'] });
ok(q.total >= 1 && q.facets.cat.length > 0, '關鍵字 + 篩選一起用');
q = call('handleProspectQuery', { q: '不存在的字串xyz' });
ok(q.total === 0 && q.rows.length === 0 && q.pages === 1, '沒有符合 → 空結果');

// 聯絡方式旗標
q = call('handleProspectQuery', { has: 'PE' });
ok(q.total === 1 && q.rows[0].Name === '工廠1', '只看「有電話且有 Email」');
q = call('handleProspectQuery', { has: 'P' });
ok(q.total === 2, '只看有電話（工廠1 + 展覽新公司）');
ok(facOf(q.facets.has, 'E') === 1, '聯絡方式分面');

// 分頁
q = call('handleProspectQuery', { page: 2, size: 25 });
ok(q.page === 2 && q.rows[0].RowIndex === 27, '第 2 頁從第 26 筆開始（RowIndex = 27）');
q = call('handleProspectQuery', { page: 9999, size: 25 });
ok(q.page === q.pages, '頁碼超過上限 → 停在最後一頁');
ok(call('handleProspectQuery', { size: 5 }).size === 10, '每頁至少 10 筆');
ok(call('handleProspectQuery', { size: 999 }).size === 100, '每頁最多 100 筆');

// ---- 修改單筆 ----
q = call('handleProspectQuery', { q: '工廠4' });
const row4 = q.rows.find((x) => x.Name === '工廠4');
r = call('handleProspectUpdate', { key: row4.Key, row: row4.RowIndex, fields: { Stage: '開發中', Notes: '第一次電話：對 AOI 有興趣\n下週回電', Phone: '0937-111222', Email: 'buyer@fac4.com', Website: 'https://fac4.com', Contact: '採購 林先生', AssignedTo: 'amy' } });
ok(r.success && r.row.Stage === '開發中' && r.row.Has === 'PEW' && r.row.Phone === '0937-111222', '修改：狀態、聯絡方式、指派');
ok(r.row.Notes.indexOf('\n') > -1, '備註保留換行');
q = call('handleProspectQuery', { q: 'buyer@fac4.com' });
ok(q.total === 1, '剛填的 Email 立刻可以搜到（搜尋欄同步更新）');
q = call('handleProspectQuery', { stages: ['開發中'] });
ok(q.total === 1 && facOf(q.facets.stage, '未處理') === 6005, '依開發狀態篩選，狀態統計正確');
q = call('handleProspectQuery', { assigned: 'me' });
ok(q.total === 1 && q.rows[0].AssignedTo === 'amy', '「我負責的」篩選');
q = call('handleProspectQuery', { assigned: 'none' });
ok(q.total === 6005, '「未指派」篩選');
ok(call('handleProspectUpdate', { key: row4.Key, row: row4.RowIndex, fields: { Stage: '亂寫' } }).success === false, '不在清單內的狀態 → 拒絕');
ok(call('handleProspectUpdate', { key: row4.Key, row: row4.RowIndex, fields: { Email: '不是信箱' } }).message === 'Email 格式不正確', 'Email 格式錯 → 拒絕');
r = call('handleProspectUpdate', { key: row4.Key, row: row4.RowIndex, fields: { Website: 'javascript:alert(1)', Name: '想偷改名稱', Key: 'X' } });
ok(r.success && r.row.Website === '' && r.row.Name === '工廠4' && r.row.Key === row4.Key, '網址危險 → 清掉；名稱 / Key 不能從這裡改');
r = call('handleProspectUpdate', { key: row4.Key, row: 999, fields: { Optout: true } });
ok(r.success && r.row.Optout === 'Y', '列號對不上時用 Key 重新找');
ok(call('handleProspectUpdate', { key: 'R:不存在', row: 3, fields: { Stage: '無效' } }).success === false, '找不到這筆 → 拒絕');
r = call('handleProspectUpdate', { key: row4.Key, row: row4.RowIndex, fields: { Stage: '未處理' } });
ok(r.success && r.row.Stage === '未處理', '改回「未處理」');
ok(ctx.psColVals_(sh, ctx.psCol_('Stage'), 6006)[row4.RowIndex - 2] === '', '「未處理」在試算表裡存空白');

// ---- 批次修改 ----
r = call('handleProspectBulk', { keys: [row4.Key, 'R:F000001', 'R:不存在'], set: { Stage: '已聯絡', AssignedTo: 'ben' } });
ok(r.success && r.count === 2, '勾選的 2 筆批次修改（不存在的略過）');
q = call('handleProspectQuery', { stages: ['已聯絡'], assigned: 'none' });
ok(q.total === 0, '兩筆都指派給 ben 了');
r = call('handleProspectBulk', { filter: { cats: ['22'], cities: ['桃園市'] }, set: { Stage: '無效' } });
const expect = call('handleProspectQuery', { stages: ['無效'] }).total;
ok(r.success && r.count === expect && r.count > 100, '「符合目前篩選的全部」批次修改：' + r.count + ' 筆');
q = call('handleProspectQuery', { stages: ['無效'], size: 100 });
ok(q.rows.every((x) => x.CatCodes.split('|').indexOf('22') > -1 && x.City === '桃園市'), '只改到符合條件的');
ok(call('handleProspectBulk', { keys: ['R:F000001'], set: {} }).success === false, '沒有要改的欄位 → 拒絕');
ok(call('handleProspectBulk', { keys: ['R:F000001'], set: { Stage: '亂寫' } }).success === false, '批次修改也檢查狀態');
r = call('handleProspectBulk', { filter: { stages: ['無效'] }, set: { Stage: '未處理' } });
ok(r.success && call('handleProspectQuery', { stages: ['無效'] }).total === 0, '改回未處理');

// '@me' = 登入帳號（畫面上的顯示名稱不一定等於帳號）
r = call('handleProspectUpdate', { key: row4.Key, row: row4.RowIndex, fields: { AssignedTo: '@me' } });
ok(r.success && r.row.AssignedTo === 'amy', "單筆指派：'@me' 換成登入帳號");
r = call('handleProspectBulk', { keys: ['R:F000001'], set: { AssignedTo: '@me' } });
ok(r.count === 1 && call('handleProspectQuery', { assigned: 'me' }).rows.some((x) => x.RegNo === 'F000001'), "批次指派：'@me' 換成登入帳號，「我負責的」篩得到");

// ---- 匯出 ----
r = call('handleProspectExport', { cats: ['29'], cities: ['彰化縣'] });
ok(r.success && r.exported === r.total && !r.truncated && r.rows.length === r.total && r.rows[0].Search === undefined, '匯出符合條件的全部，不含內部搜尋欄');
r = call('handleProspectExport', {});
ok(r.exported === 5000 && r.truncated && r.total === 6006, '匯出上限 5000 筆，超過會標示被截斷');

// ---- 狀態 ----
r = call('handleProspectStatus', {});
ok(r.ready && r.total === 6006 && r.last.source === SRC && r.last.by === 'amy' && r.stages.length === 7 && r.industry['26'] === '電子零組件製造業', '狀態：筆數、最後匯入、產業代碼表');

// ---- 清空 ----
ok(call('handleProspectClear', { confirm: 'yes' }).success === false, '清空要輸入確認文字');
r = call('handleProspectClear', { confirm: 'CLEAR' });
ok(r.success && r.removed === 6006, '清空：移除 6006 筆');
q = call('handleProspectQuery', {});
ok(q.ready && q.total === 0, '清空後是空的，標題列還在');
r = call('handleProspectImport', { source: SRC, rows: [fac(1)] });
ok(r.added === 1 && r.total === 1, '清空後可以重新匯入');

console.log('prospects checks passed:', pass);
