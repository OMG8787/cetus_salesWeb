// 產品「匯出勾選的項目」與「AI 撰寫上架文案」：後端（取完整規格、送給 AI 的資料不含底價 / 供應商）與前端純函式（售價計算、欄位、CSV）
const assert = require('assert');
const path = require('path');
const { makeEnv } = require('./gasmock');
let aiPayload = null;
let aiReply = '【標題】測試文案';
const { ctx, props } = makeEnv({
  files: [path.join(__dirname, '..', 'Code.gs')],
  fetch: (url, o) => {
    if (String(url).indexOf('generativelanguage') > -1) {
      aiPayload = JSON.parse(o.payload);
      return { code: 200, body: JSON.stringify({ candidates: [{ content: { parts: [{ text: aiReply }] } }] }) };
    }
    return { code: 404, body: '' };
  },
});
let pass = 0;
const ok = (c, m) => {
  assert.ok(c, m);
  pass++;
};
const user = { username: 'amy', displayName: 'Amy' };

const add = (o) => ctx.appendObjectRow('Products', o);
add({ InternalModel: 'CVG-100', SupplierModel: 'MV-CA050-10GM', Supplier: '秘密供應商', RefPrice: 1000, Category: '相機', Brand: 'Hikrobot', Interface: 'GigE', Resolution: '2448x2048', EffectivePixels: '500萬', Notes: '請洽 Ben', Specs: JSON.stringify({ 防護等級: 'IP40', 重量: '70g' }) });
add({ InternalModel: 'CVG-200', SupplierModel: 'LENS-8MM', Supplier: '另一家', RefPrice: 250.5, Category: '鏡頭', Brand: 'Computar', FocalLength: '8', Mount: 'C-Mount', Specs: '' });
add({ InternalModel: 'OTHER-1', Supplier: 'x', RefPrice: 1 });

// ---- 後端：取完整資料 ----
let r = ctx.handleGetProductsExport({ rowIndexes: [2, 3] });
ok(r.success && r.products.length === 2, '依列號取到 2 筆');
ok(r.products[0].InternalModel === 'CVG-100' && r.products[0].Specs['防護等級'] === 'IP40', '官網完整規格展開成物件');
ok(r.products[1].Specs && typeof r.products[1].Specs === 'object' && Object.keys(r.products[1].Specs).length === 0, '沒有規格 = 空物件');
ok(ctx.handleGetProductsExport({ rowIndexes: [] }).success === false, '沒選取 → 回錯誤');
ok(ctx.handleGetProductsExport({ rowIndexes: Array.from({ length: 501 }, (_, i) => i + 2) }).success === false, '一次最多 500 筆');
ok(ctx.ACTION_PERM.getProductsExport[0] === 'products' && ctx.ACTION_PERM.writeProductCopy[0] === 'products', '兩個動作都登記了權限（產品模組）');
ok(ctx.ROUTES.getProductsExport && ctx.ROUTES.writeProductCopy, '兩個動作都登記了路由');

// ---- 後端：AI 文案 ----
r = ctx.handleWriteProductCopy({ _user: user, products: [{ name: 'CVG-100', category: '相機', brand: 'Hikrobot', price: '2000', specs: { 介面: 'GigE' } }] });
ok(!r.success && /尚未設定 AI/.test(r.message), '還沒設定 AI → 清楚的錯誤');
props.GEMINI_API_KEY = 'KEY-123';
r = ctx.handleWriteProductCopy({ _user: user, products: [{ name: 'CVG-100', category: '相機', brand: 'Hikrobot', price: '2000', specs: { 介面: 'GigE', 防護等級: 'IP40' } }], tone: 'friendly', platform: 'market', length: 'short', mode: 'each', extra: '強調穩定' });
ok(r.success && r.text === '【標題】測試文案', '產生成功');
const sys = aiPayload.systemInstruction.parts[0].text;
const body = aiPayload.contents[0].parts[0].text;
ok(/只能使用使用者提供的資料/.test(sys) && /不要提到成本、底價、供應商/.test(sys), '提示詞：不准編造、不准提成本與供應商');
ok(/親切好懂/.test(sys) && /電商平台/.test(sys) && /100–150/.test(sys) && /強調穩定/.test(sys), '風格 / 用途 / 長度 / 額外要求都帶進提示詞');
ok(/CVG-100/.test(body) && /售價：2000/.test(body) && /防護等級：IP40/.test(body), '資料與勾選的售價有送給 AI');
ok(!/秘密供應商|底價|1000/.test(body), '底價、供應商沒有送給 AI');
r = ctx.handleWriteProductCopy({ _user: user, products: [{ name: 'A' }, { name: 'B' }], mode: 'one' });
ok(/一篇/.test(aiPayload.systemInstruction.parts[0].text), '整組寫成一篇');
r = ctx.handleWriteProductCopy({ _user: user, products: [] });
ok(!r.success, '沒有產品 → 錯誤');
const many = Array.from({ length: 50 }, (_, i) => ({ name: 'P' + i }));
ctx.handleWriteProductCopy({ _user: user, products: many });
ok((aiPayload.contents[0].parts[0].text.match(/【產品 /g) || []).length === 30, '一次最多 30 個產品');
// 每人每小時 20 次
let last;
for (let i = 0; i < 25; i++) last = ctx.handleWriteProductCopy({ _user: user, products: [{ name: 'X' }] });
ok(!last.success && /每小時最多 20 次/.test(last.message), '每人每小時最多 20 次');
ok(ctx.handleWriteProductCopy({ _user: { username: 'bob' }, products: [{ name: 'X' }] }).success, '別人不受影響');

// ---- 前端純函式 ----
const fx = require('../../frontend/product-export.js');
ok(fx.exportPrice(1000, { multiplier: 2, rounding: 'ceil' }) === '2000', '售價 = 底價 × 2');
ok(fx.exportPrice('250.5', { multiplier: 2, rounding: 'ceil' }) === '501' && fx.exportPrice('250.4', { multiplier: 2, rounding: 'ceil' }) === '501', '無條件進位到整數');
ok(fx.exportPrice(100.3, { multiplier: 1.35, rounding: 'round' }) === '135', '倍率可自訂、四捨五入');
ok(fx.exportPrice(101, { multiplier: 1.5, rounding: 'ceil10' }) === '160', '進位到 10 的倍數');
ok(fx.exportPrice(100.3, { multiplier: 2, rounding: 'none' }) === '200.60', '不處理 = 兩位小數');
ok(fx.exportPrice('', {}) === '' && fx.exportPrice('abc', {}) === '' && fx.exportPrice(0, {}) === '', '沒有底價 → 空白，不會算出 0 元');
ok(fx.exportPrice('1,200', {}) === '2400', '千分位逗號');
const cam = { InternalModel: 'CVG-100', SupplierModel: 'MV-CA050', Category: '相機', Brand: 'Hik', Interface: 'GigE', EffectivePixels: '500萬', FocalLength: '9', Supplier: '秘密', RefPrice: '1000', Specs: { 重量: '70g', 空: '' } };
ok(fx.exportSummary(cam) === '介面 GigE｜有效像素 500萬', '相機的規格摘要不含焦距，也不含品牌');
ok(fx.exportSummary({ Category: '鏡頭', FocalLength: '8', Mount: 'C', Interface: 'x' }) === '接口 C｜焦距 mm 8', '鏡頭的規格摘要不含介面');
ok(fx.exportOfficialSpecs(cam) === '重量：70g', '官網完整規格展開，空值略過');
const t = fx.buildExportTable([cam], ['name', 'price', 'summary', 'refPrice'], { multiplier: 2, rounding: 'ceil' });
ok(t.headers.join() === '名稱（內部型號）,售價,規格摘要,底價' && t.rows[0].join('|') === 'CVG-100|2000|介面 GigE｜有效像素 500萬|1000', '依勾選產生表格（內部資料標記字樣在標題拿掉）');
ok(fx.tableToCsv({ headers: ['a', 'b'], rows: [['x,y', 'say "hi"\nok']] }) === 'a,b\r\n"x,y","say ""hi""\nok"', 'CSV 逗號、雙引號、換行跳脫');
ok(fx.tableToTsv({ headers: ['a', 'b'], rows: [['x\ty', 'l1\nl2']] }) === 'a\tb\nx y\tl1 l2', '貼進試算表的格式：Tab 分隔、儲存格內換行拿掉');
const items = fx.buildCopyItems([cam], ['name', 'refPrice', 'supplier'], { multiplier: 2 });
ok(JSON.stringify(items).indexOf('秘密') < 0 && JSON.stringify(items).indexOf('1000') < 0 && items[0].price === '', '給 AI 的資料：沒勾售價就不帶價格；底價、供應商就算勾了也不帶');
ok(fx.buildCopyItems([cam], ['price'], { multiplier: 2, rounding: 'ceil' })[0].price === '2000' && fx.buildCopyItems([cam], [], {})[0].specs['重量'] === '70g', '勾售價才帶；官網完整規格一律帶');

console.log('product export checks passed:', pass);
