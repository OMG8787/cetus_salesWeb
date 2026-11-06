const assert = require('assert');
const path = require('path');
const { makeEnv } = require('./gasmock');
const { ctx } = makeEnv({ files: [path.join(__dirname, '..', 'Code.gs')], fetch: () => ({ code: 404, body: '' }) });
let pass = 0;
const ok = (c, m) => {
  assert.ok(c, m);
  pass++;
};
const admin = { username: 'admin1', displayName: 'admin1' };
ctx.appendObjectRow('Users', { Username: 'admin1', PasswordHash: 'x', Role: 'admin', DisplayName: 'admin1' });

// 預設：精簡、各推薦 1、短邊
let c = ctx.botSettings_().calc;
ok(c.brief === true && c.cameras === 1 && c.lenses === 1 && c.base === 's', '預設精簡 / 1 台 / 1 款 / 短邊');
let cat = ctx.botCalcCatalog_(null);
ok(cat.reply && cat.reply.brief === true && cat.reply.cameras === 1 && cat.reply.base === 's', '型錄帶著回覆格式設定給機器人');

// 後台儲存：範圍會被限制
let r = ctx.handleBotSaveSettings({ _user: admin, cs: { calc: { brief: false, cameras: 3, lenses: 2, base: 'l' } } });
ok(r.success, '儲存成功');
c = ctx.botSettings_().calc;
ok(c.brief === false && c.cameras === 3 && c.lenses === 2 && c.base === 'l', '儲存後讀回：完整格式 / 3 台 / 2 款 / 長邊');
r = ctx.handleBotSaveSettings({ _user: admin, cs: { calc: { brief: true, cameras: 99, lenses: 0, base: 'x' } } });
c = ctx.botSettings_().calc;
ok(c.cameras === 5 && c.lenses === 1 && c.base === 's', '數量最多 5 台、最少 1；基準邊亂填 = 短邊');
ok(ctx.handleBotGetSettings({ _user: admin }).cs.calc.cameras === 5, '設定頁讀得到');
console.log('calc reply checks passed:', pass);
