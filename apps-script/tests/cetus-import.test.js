const assert = require('assert');
const path = require('path');
const { makeEnv } = require('./gasmock');

// Cetus 官網六個分頁：每個分頁一張規格表（表頭：型號 畫素 圖像分辨率 FPS Sensor Size 快門類型 像素尺寸 Sensor型號 Sensor類型）
const HEAD = ['型號', '畫素', '圖像分辨率', 'FPS', 'Sensor Size', '快門類型', '像素尺寸', 'Sensor型號', 'Sensor類型'];
const table = (rows) => '<table>' + [HEAD].concat(rows).map((r) => '<tr>' + r.map((c) => '<td>' + c + '</td>').join('') + '</tr>').join('') + '</table>';
const PANES = {
  1458: [['CVG-34M-387GT', '30萬', '640X480', '387', '1/4"', '全局快門', '4.8*4.8μm', 'ONSEMI', 'CMOS'], ['CVG-130M-60GT', '122萬', '1280X960', '60', '1/3"', '全局快門', '3.75*3.75 μm', 'AR0135', 'CMOS']],
  1488: [['CVG-34C-380GT', '30萬', '640X480', '380', '1/4 "', '全局快門', '4.8*4.8um', 'ONSEMI', 'CMOS']],
  1500: [['CV3-2000C-19RT', '2000萬', '5488X3672', '19.5', '1"', '滾動快門', '2.4*2.4μm', 'IMX183', 'CMOS']],
  1512: [['CV3-2000 M -19RT', '2000萬', '5488X3672', '19.5', '1"', '滾動快門', '2.4*2.4μm', 'IMX183', 'CMOS']],
  1530: [['CVB-1000C-4RT', '1000萬', '3664X2748', '4.7', '1/2.3"', '滾動快門', '1.67*1.67μm', 'MT9J003', 'CMOS']],
  1560: [['CVB-1000M-4RT', '1000萬', '3664X2748', '4.7', '1/2.3"', '滾動快門', '1.67*1.67μm', 'MT9J003', 'CMOS']],
};
const page = '<html><ul><li class="tab-con" id="tab-783"><table><tr><td>功能說明</td></tr></table></li>' +
  Object.keys(PANES).map((k) => '<li class="tab-con" id="tab-' + k + '">' + table(PANES[k]) + '</li>').join('') + '</ul></html>';

const { ctx } = makeEnv({ files: [path.join(__dirname, '..', 'Code.gs')], fetch: (url) => (String(url).indexOf('cetus.tw') > -1 ? { code: 200, body: page } : { code: 404, body: '' }) });
let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; };
const products = () => ctx.readProductsLite_().rows;
const find = (m) => products().find((r) => r['InternalModel'] === m);

// 解析小工具
ok(ctx.effPixToWan_('30萬') === 30 && ctx.effPixToWan_('5MP') === 500 && ctx.effPixToWan_('2.3 百萬像素') === 230 && ctx.effPixToWan_('307200') === 30.72 && ctx.effPixToWan_('') === 0, '有效像素文字 → 萬');
ok(ctx.effPixFromRes_(640, 480) === '30萬' && ctx.effPixFromRes_(1280, 960) === '122萬' && ctx.effPixFromRes_(2448, 2048) === '501萬', '解析度 → 有效像素（捨去取整數萬）');
const pr = ctx.parseResolution_('480 × 640');
ok(pr.w === 640 && pr.h === 480 && ctx.parseResolution_('無') === null, '解析度長邊在前');

// 匯入
let r = ctx.handleImportCetusProducts();
ok(r.success && r.added === 7 && r.errors.length === 0 && r.done, '六個分頁共 7 款相機新增：' + JSON.stringify(r));
const a = find('CVG-34M-387GT');
ok(a.Brand === 'Cetus' && a.Supplier === 'Cetus' && a.Category === '相機' && a.Interface === 'GigE' && a.Resolution === '640x480' && a.EffectivePixels === '30萬' && String(a.FPS) === '387' && String(a.PixelSize) === '4.8' && a.SensorSize === '1/4"', '規格欄位：' + JSON.stringify(a));
ok(find('CV3-2000M-19RT') && !find('CV3-2000 M -19RT'), '型號裡的空白拿掉');
ok(find('CV3-2000C-19RT').Interface === 'USB3.0' && find('CVB-1000C-4RT').Interface === 'USB2.0', '介面依分頁');
ok(/cetus\.tw.*tab=1488/.test(find('CVG-34C-380GT').SourceUrl), '資料來源網址 = 該分頁');
r = ctx.handleImportCetusProducts();
ok(r.success && r.added === 0, '再匯入一次不會重複');

// 推算相機畫素
ctx.appendObjectRow('Products', { InternalModel: 'T-RES', Category: '相機', Resolution: '2448x2048' });
ctx.appendObjectRow('Products', { InternalModel: 'T-NOTE', Category: '相機', Notes: '工業相機 約 200萬畫素 GigE' });
ctx.appendObjectRow('Products', { InternalModel: 'T-SPEC', Category: '相機', Specs: JSON.stringify({ '分辨率@帧率': '1920x1080@30fps' }) });
ctx.appendObjectRow('Products', { InternalModel: 'T-KEEP', Category: '相機', Resolution: '640x480', EffectivePixels: '28萬' });
ctx.appendObjectRow('Products', { InternalModel: 'T-LENS', Category: '鏡頭', Resolution: '5MP' });
ctx.appendObjectRow('Products', { InternalModel: 'T-NONE', Category: '相機' });
r = ctx.handleFillEffectivePixels();
ok(r.success && r.effFilled === 3 && r.resFilled === 1 && r.unresolved === 1, '推算結果：' + JSON.stringify(r));
ok(find('T-RES').EffectivePixels === '501萬', '用解析度算：2448x2048 → 501萬');
ok(find('T-NOTE').EffectivePixels === '200萬', '備註寫的 200 萬畫素直接用');
ok(find('T-SPEC').Resolution === '1920x1080' && find('T-SPEC').EffectivePixels === '207萬', '從規格找解析度並算出有效像素');
ok(find('T-KEEP').EffectivePixels === '28萬', '你填過的有效像素不覆蓋');
ok(!find('T-LENS').EffectivePixels, '鏡頭不處理');
ok(!find('T-NONE').EffectivePixels, '缺資料的相機維持空白');

// 選型型錄：帶有效像素（萬）與優先推薦旗標
const cat = ctx.botCalcCatalog_(null);
const c34 = cat.cameras.find((c) => c.name === 'CVG-34M-387GT');
ok(c34.effPx === 30 && c34.pref === true, '型錄 effPx = 30、Cetus 優先');
console.log('cetus import checks passed:', pass);
