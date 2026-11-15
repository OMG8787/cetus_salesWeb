// LINE 通知系統管理員：排程時段（平日 / 假日）、事件勾選、推播內容、測試通知、預設訊息可在後台改
const assert = require('assert');
const path = require('path');
const { makeEnv } = require('./gasmock');
const pushes = [];
const { ctx } = makeEnv({
  files: [path.join(__dirname, '..', 'Code.gs')],
  fetch: (url, o) => {
    pushes.push({ url, headers: o.headers, body: JSON.parse(o.payload) });
    return { code: 200, body: { sent: 1 } };
  },
});
let pass = 0;
const ok = (c, m) => {
  assert.ok(c, m);
  pass++;
};
const admin = { username: 'admin1', displayName: 'admin1' };
ctx.appendObjectRow('Users', { Username: 'admin1', PasswordHash: 'x', Role: 'admin', DisplayName: 'admin1' });
ctx.appendObjectRow('Users', { Username: 'ed', PasswordHash: 'x', Role: 'editor', DisplayName: 'ed' });
const LU = (n) => 'U' + String(n).padStart(32, '0');
ctx.appendObjectRow('BotMembers', { LineUserId: LU(1), DisplayName: '老闆', Status: '已開通', Role: 'editor', LinkedUsername: 'admin1', IsFollowing: true });
ctx.appendObjectRow('BotMembers', { LineUserId: LU(2), DisplayName: '編輯', Status: '已開通', Role: 'editor', LinkedUsername: 'ed', IsFollowing: true });
ctx.appendObjectRow('BotMembers', { LineUserId: LU(3), DisplayName: '管理員但已封鎖', Status: '已開通', Role: 'editor', LinkedUsername: 'admin1', IsFollowing: false });
ctx.handleBotGenKey({ role: 'staff' });
ctx.handleBotSaveSettings({ _user: admin, general: { botUrl: 'https://bot.example.vercel.app' } });

// 預設值
let n = ctx.botNotifyCfg_();
ok(n.enabled && n.weekday.start === '17:30' && n.weekday.end === '23:00' && n.weekend.start === '08:00' && n.weekend.end === '23:00' && n.chatEvery === 30, '預設：平日 17:30–23:00、假日 08:00–23:00');
ok(n.events.handoff && n.events.lead && n.events.limit && n.events.chat, '預設事件全開');

// 時段判斷（台灣時間；2026-11-16 週一、2026-11-14 週六、2026-11-15 週日）
const at = (s) => new Date(s + '+08:00');
ok(!ctx.botNotifyInWindow_(n, at('2026-11-16T12:00:00')), '週一中午（上班時間）不推播');
ok(!ctx.botNotifyInWindow_(n, at('2026-11-16T17:29:00')) && ctx.botNotifyInWindow_(n, at('2026-11-16T17:30:00')), '週一 17:30 開始');
ok(ctx.botNotifyInWindow_(n, at('2026-11-16T22:59:00')) && !ctx.botNotifyInWindow_(n, at('2026-11-16T23:00:00')), '週一 23:00 結束');
ok(ctx.botNotifyInWindow_(n, at('2026-11-14T08:00:00')) && ctx.botNotifyInWindow_(n, at('2026-11-15T13:00:00')) && !ctx.botNotifyInWindow_(n, at('2026-11-15T07:59:00')), '週六日 08:00–23:00');

// 目標：只有「已開通 + 追蹤中 + 綁定管理員帳號」
const targets = ctx.botAdminTargets_();
ok(targets.length === 1 && targets[0] === LU(1), '只通知綁定管理員、還在追蹤的成員');

// 後台儲存、關閉
ctx.handleBotSaveSettings({ _user: admin, notify: { enabled: true, weekday: { on: true, start: '00:00', end: '23:59' }, weekend: { on: true, start: '00:00', end: '23:59' }, events: { handoff: true, lead: false, limit: true, chat: true }, chatEvery: 10 } });
n = ctx.botNotifyCfg_();
ok(n.weekday.start === '00:00' && n.chatEvery === 10 && n.events.lead === false, '設定可以存');
ok(ctx.handleBotGetSettings({ _user: admin }).notify.chatEvery === 10 && ctx.handleBotGetSettings({ _user: admin }).notifyTargets === 1, '設定頁讀得到通知設定與目標人數');

pushes.length = 0;
const V = (k) => 'V' + String(k).padStart(32, '0');
ctx.csHandoff_(V(1), { text: '我要找真人報價', displayName: '王小姐', topic: '價格' });
ok(pushes.length === 1 && pushes[0].url === 'https://bot.example.vercel.app/api/push' && pushes[0].body.targets[0] === LU(1) && /客人找真人：王小姐（價格）/.test(pushes[0].body.alert) && /報價/.test(pushes[0].body.alert), '轉真人 → LINE 推播給管理員');
ok(!!pushes[0].headers['x-bot-secret'], '帶員工助理金鑰');
pushes.length = 0;
ctx.csLead_(V(2), { name: '李', phone: '0912345678', source: 'form' });
ok(pushes.length === 0, '留資料事件沒勾選 → 不推播');
ctx.handleBotSaveSettings({ _user: admin, notify: Object.assign({}, n, { events: { handoff: true, lead: true, limit: true, chat: true } }) });
ctx.csLead_(V(3), { name: '陳', phone: '0922333444', email: 'a@b.com', source: 'form' });
ok(pushes.length === 1 && /新的聯繫名單：陳/.test(pushes[0].body.alert) && /0922333444/.test(pushes[0].body.alert), '留資料 → 推播含電話');

// 有人使用機器人：N 分鐘彙整
pushes.length = 0;
ctx.csRemember_(V(10), { turns: [{ u: true, t: '你們有賣光學尺嗎' }, { u: false, t: '有' }], displayName: '' });
ok(pushes.length === 1 && /正在使用機器人/.test(pushes[0].body.alert), '第一個人 → 推播');
ctx.csRemember_(V(11), { turns: [{ u: true, t: '哈囉' }, { u: false, t: '您好' }] });
ctx.csRemember_(V(12), { turns: [{ u: true, t: '請問' }, { u: false, t: '請說' }] });
ok(pushes.length === 1, '彙整期間內其他人不再推播（省推播則數）');

// 時段外不推播；總開關關閉不推播；測試通知不受限
ctx.handleBotSaveSettings({ _user: admin, notify: { enabled: true, weekday: { on: false }, weekend: { on: false }, events: { handoff: true } } });
pushes.length = 0;
ctx.csHandoff_(V(20), { text: '真人', displayName: 'A' });
ok(pushes.length === 0, '兩個時段都關閉 → 不推播');
const t = ctx.handleBotNotifyTest({ _user: admin });
ok(t.success && pushes.length === 1 && /測試通知/.test(pushes[0].body.alert), '測試通知不看時段');
ctx.handleBotSaveSettings({ _user: admin, notify: { enabled: false } });
pushes.length = 0;
ctx.csHandoff_(V(21), { text: '真人', displayName: 'B' });
ok(pushes.length === 0, '總開關關閉 → 完全不推播');

// 轉真人訊息可在後台改，空白用預設
let cs = ctx.botSettings_();
ok(/留下您的姓名/.test(cs.handoffLeadText) && /離開前/.test(cs.leaveText) && cs.leaveYes === '📇 留下資料' && cs.leaveNo === '不用了，離開', '預設訊息');
ctx.handleBotSaveSettings({ _user: admin, cs: { handoffLeadText: '請留電話', leaveText: '真的要走嗎？', leaveYes: '好', leaveNo: '不要' } });
cs = ctx.botSettings_();
ok(cs.handoffLeadText === '請留電話' && cs.leaveText === '真的要走嗎？' && cs.leaveYes === '好' && cs.leaveNo === '不要', '訊息可自訂');
const w = ctx.csWidgetConfig_();
ok(w.leave.text === '真的要走嗎？' && w.leave.yes === '好' && w.leave.no === '不要', '視窗拿得到離開提醒設定');
ok(ctx.csStart_(V(30), {}).handoffLeadText === '請留電話', '機器人拿得到轉真人留資料文字');
ctx.handleBotSaveSettings({ _user: admin, cs: { handoffLeadText: '', leaveText: '' } });
ok(/留下您的姓名/.test(ctx.botSettings_().handoffLeadText), '清空 → 回到預設');

console.log('notify checks passed: ' + pass);
