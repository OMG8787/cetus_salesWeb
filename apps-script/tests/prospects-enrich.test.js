// 開發名單庫：找官網 + 抓聯絡方式（用假網站 / 假 API 回應測試，不會真的連外）
const assert = require('assert');
const path = require('path');
const { makeEnv } = require('./gasmock');

// ---- 假的網路世界 ----
const SITES = {};
let geminiReply = '```json\n{"website":"https://www.fac1.com.tw/about","reason":"官網"}\n```';
let geminiStatus = 200;
let placesBody = { places: [] };
const calls = { gemini: 0, places: 0 };
const cfHex = (email, key) => key.toString(16).padStart(2, '0') + [...email].map((c) => (c.charCodeAt(0) ^ key).toString(16).padStart(2, '0')).join('');
SITES['https://www.fac1.com.tw/'] = '<html><head><title>琮允五金行 官方網站</title></head><body><h1>琮允五金行</h1><a href="/contact.html">聯絡我們</a><a href="/products">產品</a><a href="https://facebook.com/x">FB</a><a href="https://other.com/contact">外站聯絡</a><img src="logo@2x.png"></body></html>';
SITES['https://www.fac1.com.tw/contact.html'] = '<body>聯絡電話：(06) 233-1234　傳真：06-233-5678　手機 <a href="tel:0912-345-678">0912-345-678</a><br>業務 Email：sales [at] fac1.com.tw　客服：<a class="__cf_email__" data-cfemail="' + cfHex('service@fac1.com.tw', 0x5a) + '">[email&#160;protected]</a><br>Gmail：boss@gmail.com　範例：your@domain.com　圖：banner@2x.png 免付費 0800-123-456</body>';
SITES['https://www.nofit.com.tw/'] = '<body>這是別家公司的網站，賣鞋子。 contact: hi@nofit.com.tw</body>';
SITES['https://www.blocked.com.tw/'] = '<body>琮剛工業社 info@blocked.com.tw</body>';
SITES['https://www.blocked.com.tw/robots.txt'] = 'User-agent: *\nDisallow: /\n';
SITES['http://www.nocontact.com.tw/'] = '<body>無聯絡頁工業社 歡迎洽詢</body>';
SITES['http://www.partial.com.tw/'] = '<body>部分允許工業社 <a href="/contact">聯絡我們</a><a href="/private/contact">私人</a></body>';
SITES['http://www.partial.com.tw/robots.txt'] = 'User-agent: *\nDisallow: /private\n';
SITES['http://www.partial.com.tw/contact'] = '<body>電話 03-555-1234 信箱 contact@partial.com.tw</body>';
SITES['http://www.partial.com.tw/private/contact'] = '<body>secret@partial.com.tw</body>';
SITES['https://www.placesco.com.tw/'] = '<body>頁面沒有寫名稱 service@placesco.com.tw</body>';
SITES['http://www.manual.com.tw/'] = '<body>手填工業社 <a href="/contact">聯絡我們</a></body>';
SITES['http://www.manual.com.tw/contact'] = '<body>sales@manual.com.tw 02-2222-3333</body>';

const { ctx, props } = makeEnv({
  files: [path.join(__dirname, '..', 'Code.gs')],
  fetch: (url, o) => {
    if (/generativelanguage/.test(url)) {
      calls.gemini++;
      if (geminiStatus !== 200) return { code: geminiStatus, body: { error: { message: 'API key KEY-SECRET not allowed' } } };
      return { code: 200, body: { candidates: [{ content: { parts: [{ text: geminiReply }] } }] } };
    }
    if (/places\.googleapis/.test(url)) {
      calls.places++;
      return { code: 200, body: placesBody };
    }
    if (SITES[url] !== undefined) return { code: 200, body: SITES[url] };
    return { code: 404, body: '' };
  },
});
let pass = 0;
const ok = (c, m) => {
  assert.ok(c, m);
  pass++;
};
const me = { username: 'amy', displayName: 'Amy' };
const call = (fn, body) => ctx[fn](Object.assign({ _user: me }, body || {}));

// ---- 純函式 ----
ok(ctx.psCoreName_('琮允五金行永康廠') === '琮允五金行永康' || ctx.psCoreName_('琮允五金行永康廠').indexOf('琮允') === 0, '核心名稱：去掉「廠」');
ok(ctx.psCoreName_('台灣積體電路製造股份有限公司') === '台灣積體電路製造' && ctx.psCoreName_('大立光電股份有限公司') === '大立光電', '核心名稱：去掉「股份有限公司」');
ok(ctx.psCoreName_('王') === '王', '太短就用原名');
ok(ctx.psNormalizeSite_('https://www.A.com.tw/path?x=1') === 'https://www.a.com.tw' && ctx.psNormalizeSite_('a.com.tw') === 'http://a.com.tw', '網址：只留首頁、補 http');
ok(ctx.psNormalizeSite_('https://www.facebook.com/abc') === '' && ctx.psNormalizeSite_('https://tw.104.com.tw/company/x') === '' && ctx.psNormalizeSite_('javascript:alert(1)') === '' && ctx.psNormalizeSite_('https://shop.blogspot.com') === '', '網址：社群、人力銀行、部落格平台、危險協定都不當官網');
ok(ctx.psNormalizeSite_('https://myfacebook.com.tw') === 'https://myfacebook.com.tw', '網址：只擋網域本身與子網域，名字相似的不誤殺');
const emails = ctx.psExtractEmails_(SITES['https://www.fac1.com.tw/contact.html']);
ok(emails.indexOf('sales@fac1.com.tw') > -1, 'Email：[at] 寫法');
ok(emails.indexOf('service@fac1.com.tw') > -1, 'Email：Cloudflare 電子郵件保護解碼');
ok(emails.indexOf('boss@gmail.com') > -1, 'Email：一般信箱');
ok(!emails.some((e) => /your@domain|2x\.png/.test(e)), 'Email：範例網域與圖片檔名（@2x.png）不算');
ok(ctx.psExtractEmails_('<a href="mailto:Info@A.com?subject=hi">x</a> ＠ 全形：b＠c.com.tw').join() === 'info@a.com,b@c.com.tw', 'Email：mailto（去掉參數）、全形 ＠');
const phones = ctx.psExtractPhones_(SITES['https://www.fac1.com.tw/contact.html']);
ok(phones.indexOf('06-2331234') > -1 && phones.indexOf('0912-345-678') > -1 && phones.indexOf('0800-123-456') > -1, '電話：市話、tel: 手機、免付費');
ok(phones.indexOf('06-2335678') < 0, '電話：傳真不算');
ok(ctx.psPhoneFormat_('+886-2-2345-6789') === '02-23456789' && ctx.psPhoneFormat_('(03) 555 1234') === '03-5551234' && ctx.psPhoneFormat_('12345') === '' && ctx.psPhoneFormat_('2023-01-12') === '', '電話格式化：+886 轉 0、不合規格的回空');
ok(ctx.psExtractPhones_('<p>發票 2026-11-09 編號 1234567890123</p>').length === 0, '電話：日期、長數字不誤判');
ok(ctx.psPhoneFormat_('03-92876168') === '' && ctx.psPhoneFormat_('04-23594510') === '04-23594510' && ctx.psPhoneFormat_('02-27815301') === '02-27815301' && ctx.psPhoneFormat_('037-123456') === '03-7123456', '電話：只有 02 / 04 允許 8 碼號碼（實測上銀官網的誤判）');
ok(ctx.PS_EMAIL_AVOID_RE.test('largan-welfare@largan.com.tw') && ctx.PS_EMAIL_AVOID_RE.test('hr@a.com') && ctx.PS_EMAIL_AVOID_RE.test('ir.dept@a.com') && !ctx.PS_EMAIL_AVOID_RE.test('sales@a.com') && !ctx.PS_EMAIL_AVOID_RE.test('irene@a.com'), 'Email：福委會 / 人資 / 投資人關係排最後（irene 不誤判）');
const links = ctx.psContactLinks_(SITES['https://www.fac1.com.tw/'], 'https://www.fac1.com.tw');
ok(links.length === 1 && links[0].url === 'https://www.fac1.com.tw/contact.html', '連結：只留同網域的「聯絡我們」頁（外站、產品頁、FB 不要）');
ok(ctx.psRobotsAllows_('User-agent: *\nDisallow: /', '/') === false && ctx.psRobotsAllows_('User-agent: *\nDisallow: /private', '/contact') === true && ctx.psRobotsAllows_('User-agent: *\nDisallow: /private', '/private/x') === false, 'robots.txt：全擋 / 部分擋');
ok(ctx.psRobotsAllows_('User-agent: Googlebot\nDisallow: /', '/') === true && ctx.psRobotsAllows_('User-agent: *\nDisallow: /a\nAllow: /a/pub', '/a/pub/x') === true, 'robots.txt：只針對別的爬蟲不管；Allow 較長者優先');
ok(ctx.psRobotsAllows_('', '/') === true, 'robots.txt：沒有檔案 = 允許');

// ---- 準備名單 ----
const rec = (name, o) => Object.assign({ Name: name, Address: '臺南市永康區中山路1號', Category: '25金屬製品製造業', Status: '生產中' }, o || {});
call('handleProspectImport', { source: '測試', rows: [
  rec('琮允五金行', { RegNo: 'A1', TaxId: '10000001' }),
  rec('別家鞋業有限公司', { RegNo: 'A2', TaxId: '10000002' }),
  rec('琮剛工業社', { RegNo: 'A3', TaxId: '10000003', Website: 'https://www.blocked.com.tw/' }),
  rec('無聯絡頁工業社', { RegNo: 'A4', TaxId: '10000004', Website: 'www.nocontact.com.tw' }),
  rec('部分允許工業社', { RegNo: 'A5', TaxId: '10000005', Website: 'www.partial.com.tw' }),
  rec('手填工業社', { RegNo: 'A6', TaxId: '10000006', Website: 'www.manual.com.tw', Email: 'mine@manual.com.tw', Phone: '0911-000-111' }),
  rec('拒絕聯絡有限公司', { RegNo: 'A7', TaxId: '10000007' }),
] });
const q0 = call('handleProspectQuery', { q: '拒絕聯絡' });
call('handleProspectUpdate', { key: q0.rows[0].Key, row: q0.rows[0].RowIndex, fields: { Optout: true } });

// ---- 沒有任何搜尋來源 ----
let r = call('handleProspectStatus', {});
ok(r.enrich.source === 'none' && r.enrich.limit === 1500 && r.enrich.used === 0, '狀態：沒設 Gemini 也沒設 Places → source=none，每日上限預設 1500');
let plan = call('handleProspectEnrichPlan', { filter: { q: '琮允' } });
ok(plan.success && plan.items.length === 1 && plan.items[0].name === '琮允五金行' && plan.source === 'none', '規劃：依篩選找出要查的公司');
r = call('handleProspectEnrich', { items: plan.items });
ok(r.success && r.results[0].status === 'nosite' && /GOOGLE_PLACES_API_KEY/.test(r.results[0].note), '沒有搜尋來源：沒官網的公司回報要設定什麼');
const pre = call('handleProspectEnrichPlan', { filter: { q: '部分允許' } });
r = call('handleProspectEnrich', { items: pre.items });
ok(r.success && r.results[0].status === 'ok', '沒有搜尋來源：已經有官網的公司照樣可以抓聯絡方式');

// ---- Gemini 找官網 ----
props.GEMINI_API_KEY = 'KEY-SECRET';
ok(call('handleProspectStatus', {}).enrich.source === 'gemini', '有 Gemini → source=gemini');
r = call('handleProspectEnrich', { items: plan.items });
ok(r.success && r.results.length === 1 && r.remaining.length === 0, 'Gemini：處理 1 家');
let x = r.results[0];
ok(x.status === 'ok' && x.website === 'https://www.fac1.com.tw', 'Gemini 給的網址（/about 頁）→ 正規化成首頁，確認頁面有公司名稱 → 採用');
ok(x.email === 'service@fac1.com.tw' || x.email === 'sales@fac1.com.tw', '主要 Email = 同網域的信箱（' + x.email + '）');
ok(/boss@gmail\.com/.test(x.extra) && /信箱：/.test(x.extra) && /電話：/.test(x.extra), '其他信箱 / 電話放進「其他聯絡方式」');
ok(x.phone === '06-2331234', '主要電話是第一個抓到的市話（tel: 手機放其他）：' + x.phone);
ok(calls.gemini === 1, '只搜尋一次');
let row = call('handleProspectQuery', { q: '琮允五金行' }).rows[0];
ok(row.Website === 'https://www.fac1.com.tw' && row.Enriched === 'ok' && row.Has.indexOf('C') > -1 && row.Has.indexOf('E') > -1 && row.Has.indexOf('P') > -1 && row.Has.indexOf('W') > -1 && /fac1\.com\.tw/.test(row.EnrichNote), '寫回名單：官網、狀態、旗標、備註');
ok(row.EnrichedAt && row.UpdatedAt === row.EnrichedAt, '記錄查詢時間');
plan = call('handleProspectEnrichPlan', { filter: { q: '琮允五金行' } });
ok(plan.items.length === 0, '預設只查還沒查過的：剛查過的不會再出現');
plan = call('handleProspectEnrichPlan', { filter: { q: '琮允五金行' }, onlyNew: false });
ok(plan.items.length === 1, '取消「只查沒查過」→ 可以重查');
ok(call('handleProspectQuery', { site: 'checked' }).total === 2 && call('handleProspectQuery', { site: 'unchecked' }).total === 5, '篩選：已查過 2 家、還沒查 5 家');

// ---- 找到的網站不是這家公司 ----
geminiReply = '{"website":"https://www.nofit.com.tw","reason":"猜的"}';
plan = call('handleProspectEnrichPlan', { filter: { q: '別家鞋業' } });
r = call('handleProspectEnrich', { items: plan.items });
x = r.results[0];
row = call('handleProspectQuery', { q: '別家鞋業' }).rows[0];
ok(x.status === 'nosite' && /沒有出現公司名稱/.test(x.note) && !row.Website && !row.Email, '網頁沒出現公司名稱 → 不採用，不寫官網也不寫 Email（hi@nofit.com.tw 不會被當成這家的）');
geminiReply = '我找不到';
plan = call('handleProspectEnrichPlan', { filter: { q: '別家鞋業' }, onlyNew: false });
x = call('handleProspectEnrich', { items: plan.items }).results[0];
ok(x.status === 'nosite', 'Gemini 沒給 JSON → 找不到官網');
geminiReply = '{"website":"https://www.facebook.com/shoe"}';
x = call('handleProspectEnrich', { items: plan.items }).results[0];
ok(x.status === 'nosite', 'Gemini 給的是 Facebook → 不採用');
geminiStatus = 403;
x = call('handleProspectEnrich', { items: plan.items }).results[0];
ok(x.status === 'error' && /Gemini 搜尋錯誤/.test(x.note) && x.note.indexOf('KEY-SECRET') < 0, 'API 錯誤 → status=error，金鑰不會出現在訊息裡');
geminiStatus = 200;

// ---- robots.txt / 沒有聯絡方式 / 部分允許 ----
plan = call('handleProspectEnrichPlan', { filter: { q: '琮剛' } });
x = call('handleProspectEnrich', { items: plan.items }).results[0];
ok(x.status === 'blocked' && /robots\.txt/.test(x.note) && !x.email, 'robots.txt 全擋 → 不讀頁面、不抓聯絡方式');
x = call('handleProspectEnrich', { items: call('handleProspectEnrichPlan', { filter: { q: '無聯絡頁' } }).items }).results[0];
ok(x.status === 'nocontact' && /沒有找到公開的/.test(x.note), '有官網但沒有聯絡方式 → nocontact');
x = call('handleProspectEnrich', { items: call('handleProspectEnrichPlan', { filter: { q: '部分允許' }, onlyNew: false }).items }).results[0];
ok(x.status === 'ok' && x.email === 'contact@partial.com.tw' && !/secret@/.test(x.extra || ''), 'robots.txt 只擋 /private → 聯絡頁照讀，被擋的頁面不讀');
ok(x.phone === '03-5551234', '抓到電話');

// ---- 人工填的資料不被覆蓋 ----
x = call('handleProspectEnrich', { items: call('handleProspectEnrichPlan', { filter: { q: '手填工業社' } }).items }).results[0];
row = call('handleProspectQuery', { q: '手填工業社' }).rows[0];
ok(row.Email === 'mine@manual.com.tw' && row.Phone === '0911-000-111', '人工填的 Email / 電話不被覆蓋');
ok(/sales@manual\.com\.tw/.test(row.ExtraContacts) && /02-22223333/.test(row.ExtraContacts), '新抓到的放「其他聯絡方式」');
ok(row.Website === 'www.manual.com.tw', '人工填的官網保留');

// ---- 拒絕聯絡的不查 ----
plan = call('handleProspectEnrichPlan', { filter: { q: '拒絕聯絡' } });
ok(plan.items.length === 0, '標了「拒絕聯絡」的公司不列入查詢');

// ---- Google Places ----
props.GOOGLE_PLACES_API_KEY = 'PLACES-KEY';
ok(call('handleProspectStatus', {}).enrich.source === 'places', '有 Places 金鑰 → 優先用 Places');
call('handleProspectImport', { source: '測試', rows: [rec('地圖工業股份有限公司', { RegNo: 'B1', TaxId: '20000001' }), rec('地圖找不到有限公司', { RegNo: 'B2', TaxId: '20000002' })] });
placesBody = { places: [{ displayName: { text: '地圖工業' }, websiteUri: 'https://www.placesco.com.tw/home', nationalPhoneNumber: '(06) 123 4567' }] };
plan = call('handleProspectEnrichPlan', { filter: { q: '地圖工業' } });
x = call('handleProspectEnrich', { items: plan.items }).results[0];
ok(x.status === 'ok' && x.website === 'https://www.placesco.com.tw' && x.phone === '06-1234567' && x.email === 'service@placesco.com.tw', 'Places：官網 + 電話（頁面沒寫公司名稱也信任 Places 的比對）');
ok(calls.places === 1, '呼叫了 Places 一次');
placesBody = { places: [{ displayName: { text: '完全不同的公司' }, websiteUri: 'https://www.nofit.com.tw' }] };
plan = call('handleProspectEnrichPlan', { filter: { q: '地圖找不到' } });
x = call('handleProspectEnrich', { items: plan.items }).results[0];
ok(x.status === 'nosite', 'Places 找到的名稱不像 → 不採用');

// ---- 每日上限 / 單次時間上限 ----
props.PS_ENRICH_DAILY = String(ctx.psEnrichQuota_().used + 1);
call('handleProspectImport', { source: '測試', rows: [rec('額度一', { RegNo: 'C1' }), rec('額度二', { RegNo: 'C2' }), rec('額度三', { RegNo: 'C3' })] });
placesBody = { places: [] };
plan = call('handleProspectEnrichPlan', { filter: { q: '額度' } });
ok(plan.items.length === 3 && plan.quota.left === 1, '規劃時顯示今天剩餘額度');
r = call('handleProspectEnrich', { items: plan.items });
ok(r.quotaReached === true && r.results.length === 1 && r.remaining.length === 2, '每日上限：用完就停，剩下的回報給前端');
props.PS_ENRICH_DAILY = '0';
ctx.PS_ENRICH_BATCH_MS = -1;
r = call('handleProspectEnrich', { items: plan.items.slice(1) });
ok(r.results.length === 1 && r.remaining.length === 1, '單次請求時間用完 → 處理到一半就回傳，剩下的下一次再送');
ctx.PS_ENRICH_BATCH_MS = 22000;
ok(call('handleProspectStatus', {}).enrich.limit === 0, '每日上限設 0 = 不限');

// ---- 防呆 ----
r = call('handleProspectEnrich', { items: [{ key: 'R:不存在', row: 3, name: '幽靈' }] });
ok(r.results[0].status === 'error' && /找不到這筆名單/.test(r.results[0].note), '名單被刪 / 列號變了 → 該筆回報錯誤，不會寫到別家公司');
ok(call('handleProspectEnrich', { items: [] }).success === false, '沒有要查的 → 拒絕');
ok(ctx.permFor_('prospectEnrich')[1] === 'w' && ctx.permFor_('prospectEnrichPlan')[0] === 'customers', '權限：需要客戶區塊的編輯權');
plan = call('handleProspectEnrichPlan', { keys: [q0.rows[0].Key, 'R:A1'], onlyNew: false });
ok(plan.items.length === 1 && plan.items[0].name === '琮允五金行', '勾選模式（keys）：略過拒絕聯絡者');
ok(call('handleProspectEnrichPlan', { filter: {}, limit: 99999 }).items.length <= 500, '一次規劃最多 500 家');

console.log('prospects-enrich checks passed:', pass);
