const assert = require('assert');
const path = require('path');
const { makeEnv } = require('./gasmock');
const { ctx } = makeEnv({ files: [path.join(__dirname, '..', 'Code.gs')], fetch: () => ({ code: 404, body: '' }) });
let pass = 0;
const ok = (c, m) => {
  assert.ok(c, m);
  pass++;
};
const mk = (u, role, perms) => ctx.appendObjectRow('Users', { Username: u, PasswordHash: 'x', Role: role, DisplayName: u, Perms: perms ? JSON.stringify(perms) : '' });
mk('admin1', 'admin');
const call = (fn, body) => ctx[fn](Object.assign({ _user: { username: 'admin1', displayName: 'admin1' } }, body));
const csKey = call('handleBotGenKey', { role: 'cs' }).key;
const stKey = call('handleBotGenKey', { role: 'staff' }).key;
const api = (key, op, id, extra) => ctx.handleBotApi(Object.assign({ secret: key, op, lineUserId: id }, extra || {}));
const U = 'U' + 'a'.repeat(32), V = 'V' + 'b'.repeat(32);

ctx.appendObjectRow('Products', { InternalModel: 'CAM-A', SupplierModel: 'Basler ace', Supplier: '秘密供應商X', Category: '相機', Brand: 'Basler', Resolution: '2448x2048', PixelSize: '3.45*3.45', SensorSize: '2/3"', FPS: '35', Interface: 'GigE', RefPrice: 15000, Notes: '內部備註：毛利很高' });
ctx.appendObjectRow('Products', { InternalModel: 'CAM-USB2', Category: '相機', Resolution: '640x480', PixelSize: '5.6', Interface: 'USB2.0', RefPrice: 100 });
ctx.appendObjectRow('Products', { InternalModel: 'CAM-NOREZ', Category: '相機', Resolution: '', PixelSize: '3.45', Interface: 'GigE' });
ctx.appendObjectRow('Products', { InternalModel: 'LENS25', SupplierModel: 'Computar', Supplier: '秘密供應商Y', Category: '鏡頭', Brand: 'Computar', FocalLength: '25mm', SensorSize: '2/3"', Resolution: '5MP', FocusWD: '100', RefPrice: 3000, Notes: '內部備註2' });
ctx.appendObjectRow('Products', { InternalModel: 'TELE05', Category: '鏡頭', Magnification: '0.5x', WD: '110', DOF: '5', SensorSize: '2/3"', RefPrice: 9999 });
ctx.appendObjectRow('Products', { InternalModel: 'LIGHT1', Category: '光源', RefPrice: 500 });

// 管理系統 → 型錄（無價格、無供應商）
const cat = ctx.botCalcCatalog_(null);
ok(cat.cameras.length === 1 && cat.cameras[0].name === 'CAM-A', '只收 GigE / USB3 且有解析度與像素的相機（USB2、缺解析度被排除）');
ok(cat.cameras[0].resW === 2448 && cat.cameras[0].resH === 2048 && cat.cameras[0].pixelW === 3.45 && cat.cameras[0].fps === 35, '相機規格解析');
ok(cat.fa.length === 1 && cat.fa[0].f === 25 && cat.fa[0].focusWd === 100, 'FA 鏡頭：焦距 25 mm');
ok(cat.tele.length === 1 && cat.tele[0].mag === 0.5, '遠心鏡頭：倍率 0.5');
const dump = JSON.stringify(cat);
for (const secret of ['秘密供應商', '15000', '3000', '9999', '內部備註', '毛利', 'RefPrice', 'Supplier"']) ok(!dump.includes(secret), '型錄不含：' + secret);
ok(JSON.stringify(ctx.botCalcCatalog_(['鏡頭'])).includes('LENS25') && ctx.botCalcCatalog_(['鏡頭']).cameras.length === 0, '類別過濾：只要鏡頭');

// 客服：選型計算有自己的開關（預設開，跟「產品型號與規格」知識來源各自獨立）
const form = call('handleBotGetSettings', {}).cs;
ok(form.sources.calc === true && form.sources.products === false, '預設：選型計算開、產品知識來源關');
let r = api(csKey, 'csCalcCatalog', U);
ok(r.success && r.data.cameras.length === 1 && r.data.fa.length === 1 && r.data.tele.length === 1, '沒開產品知識來源，客服也有選型型錄（機器人才推薦得出相機）');
ok(!JSON.stringify(r.data).match(/秘密供應商|15000|3000|9999|內部備註/), '客服型錄不含價格 / 供應商 / 備註');
form.sources.calc = false;
call('handleBotSaveSettings', { cs: form });
r = api(csKey, 'csCalcCatalog', U);
ok(r.success && r.data.cameras.length === 0 && r.data.fa.length === 0 && r.data.tele.length === 0, '關閉選型計算 → 空型錄');
form.sources.calc = true;
form.sources.products = true;
call('handleBotSaveSettings', { cs: form });
r = api(csKey, 'csCalcCatalog', U);
ok(r.data.cameras.length === 1, '重新打開 → 有型錄');
ok(!api(stKey, 'csCalcCatalog', V).success && api(stKey, 'csCalcCatalog', V).code === 'BOT_AUTH', '員工金鑰不能用客服的選型型錄');

// 員工助理：calcCatalog 需要產品檢視權
call('handleBotSaveStaff', { config: { enabled: true, webEnabled: true } });
api(stKey, 'start', 'U' + 'c'.repeat(32));
ok(call('handleBotMemberSave', { lineUserId: 'U' + 'c'.repeat(32), status: '已開通', role: 'editor' }).success, '開通員工');
const E = 'U' + 'c'.repeat(32);
let s = api(stKey, 'call', E, { call: 'calcCatalog', params: {} });
ok(s.success && s.data.cameras.length === 1 && s.data.fa.length === 1 && s.data.tele.length === 1, '員工助理取得完整型錄（不分客服開放類別）');
ok(!JSON.stringify(s.data).match(/秘密供應商|15000|3000|9999|內部備註/), '員工型錄也不含價格 / 供應商');
ok(!api(csKey, 'call', E, { call: 'calcCatalog', params: {} }).success, '客服金鑰不能呼叫員工助理');
call('handleBotSaveStaff', { config: { ceiling: { products: 'none' } } });
s = api(stKey, 'call', E, { call: 'calcCatalog', params: {} });
ok(!s.success && /產品/.test(s.message), '上限 products=none → 不能取型錄：' + s.message);
call('handleBotSaveStaff', { config: { ceiling: { products: 'edit' } } });
ctx.appendObjectRow('BotMembers', { LineUserId: 'U' + '8'.repeat(32), DisplayName: '無產品權限', Status: '已開通', Role: 'limited', Perms: JSON.stringify({ customers: 'view' }), IsFollowing: true });
s = api(stKey, 'call', 'U' + '8'.repeat(32), { call: 'calcCatalog', params: {} });
ok(!s.success, '成員沒有產品權限 → 不能取型錄');
console.log('calc catalog checks passed:', pass);
