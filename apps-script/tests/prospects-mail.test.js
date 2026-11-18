// 開發名單庫：開發信（讀官網 → AI 寫草稿 → 預覽 → 寄出），用假網站 / 假 AI / 假 Gmail，不會真的連外或寄信
const assert = require('assert');
const path = require('path');
const { makeEnv } = require('./gasmock');

const SITES = {};
SITES['https://www.cam.com.tw/'] = '<body><h1>翔笙精密機械</h1>專營滾子凸輪式分割器、中空旋轉平台、四軸五軸分度盤。<a href="/contact">聯絡我們</a> sales@cam.com.tw</body>';
SITES['https://www.cam.com.tw/contact'] = '<body>電話 06-233-1234 信箱 sales@cam.com.tw</body>';
SITES['https://www.fac.com.tw/'] = '<body>大塑膠工業 射出成型塑膠零件 info@fac.com.tw</body>';

let aiReply = '{"angle":"collab","subject":"AOI 視覺與精密旋轉平台的合作可能","body":"翔笙精密機械團隊您好：\\n\\n我是鑫堡股份有限公司的 Austin。\\n\\n了解到貴公司投入滾子凸輪式分割器與中空旋轉平台。"}';
let aiStatus = 200;
const calls = { ai: 0, prompts: [] };
const { ctx, props } = makeEnv({
  files: [path.join(__dirname, '..', 'Code.gs')],
  fetch: (url, o) => {
    if (/generativelanguage/.test(url)) {
      calls.ai++;
      calls.prompts.push(JSON.parse(o.payload));
      if (aiStatus !== 200) return { code: aiStatus, body: { error: { message: 'bad KEY-SECRET' } } };
      return { code: 200, body: { candidates: [{ content: { parts: [{ text: aiReply }] } }] } };
    }
    if (SITES[url] !== undefined) return { code: 200, body: SITES[url] };
    return { code: 404, body: '' };
  },
});
props.GEMINI_API_KEY = 'KEY-SECRET';
// 假 Gmail / Drive 檔案
const sent = [];
let sendFail = false;
const drafts = [];
ctx.GmailApp = { sendEmail: (to, subject, body, opts) => { if (sendFail) throw new Error('Service invoked too many times'); sent.push({ to, subject, body, opts }); }, createDraft: (to, subject, body, opts) => { drafts.push({ to, subject, body, opts }); return { getMessage: () => ({ getId: () => 'MSG1' }) }; } };
const DRIVE_ID = 'abcDEF1234567890xyz_-';
ctx.DriveApp.getFileById = (id) => {
  if (id !== DRIVE_ID) throw new Error('no file');
  return { getName: () => '鑫堡AOI檢測系統.pdf', getSize: () => 2939628, getBlob: () => ({ name: '鑫堡AOI檢測系統.pdf' }) };
};
let pass = 0;
const ok = (c, m) => {
  assert.ok(c, m);
  pass++;
};
const me = { username: 'amy', displayName: 'Amy' };
const call = (fn, body) => ctx[fn](Object.assign({ _user: me }, body || {}));

const rec = (name, o) => Object.assign({ Name: name, Address: '臺南市永康區中山路1號', Category: '29機械設備製造業', Status: '生產中' }, o || {});
call('handleProspectImport', { source: '測試', rows: [
  rec('翔笙精密機械股份有限公司', { RegNo: 'M1', TaxId: '20000001', Website: 'https://www.cam.com.tw', Email: 'sales@cam.com.tw', Type: '設備商' }),
  rec('大塑膠工業股份有限公司', { RegNo: 'M2', TaxId: '20000002', Website: 'https://www.fac.com.tw', Email: 'info@fac.com.tw', Type: '一般使用者' }),
  rec('沒信箱工業社', { RegNo: 'M3', TaxId: '20000003', Website: 'https://www.cam.com.tw' }),
  rec('拒絕聯絡有限公司', { RegNo: 'M4', TaxId: '20000004', Website: 'https://www.cam.com.tw', Email: 'no@cam.com.tw' }),
  rec('沒官網工業社', { RegNo: 'M5', TaxId: '20000005', Email: 'x@nosite.com.tw' }),
] });
const find = (q) => call('handleProspectQuery', { q }).rows[0];
const optRow = find('拒絕聯絡');
call('handleProspectUpdate', { key: optRow.Key, row: optRow.RowIndex, fields: { Optout: true } });

// ---- 權限與路由 ----
ok(ctx.permFor_('prospectMailPreview')[1] === 'w' && ctx.permFor_('prospectMailSend')[1] === 'w' && ctx.permFor_('prospectMailCfgSave')[0] === 'admin', '權限：預覽 / 寄信要客戶區塊編輯權；改寄信設定要管理員');
ok(['prospectMailCfg', 'prospectMailCfgSave', 'prospectMailPreview', 'prospectMailSend'].every((a) => ctx.getRoute_(a) && ctx.getRoute_(a).auth === true), '路由都要登入');

// ---- 設定 ----
ok(ctx.psDriveId_('https://drive.google.com/file/d/' + DRIVE_ID + '/view?usp=sharing') === DRIVE_ID && ctx.psDriveId_('https://drive.google.com/open?id=' + DRIVE_ID) === DRIVE_ID && ctx.psDriveId_(DRIVE_ID) === DRIVE_ID && ctx.psDriveId_('D:\\claude\\x.pdf') === '', 'Drive 連結 / ID 解析；電腦路徑認不出來');
let cfg = call('handleProspectMailCfg', {});
ok(cfg.success && /Austin/.test(cfg.cfg.signature) && /AOI/.test(cfg.cfg.strategy) && cfg.cfg.attach === '' && cfg.attach.ok === false, '預設：署名、寫信原則有預設值，附件沒設定');
let r = call('handleProspectMailCfgSave', { cfg: { attach: 'D:\\claude\\CetusSalesWeb\\鑫堡AOI檢測系統.pdf' } });
ok(!r.success && /Google Drive/.test(r.message), '附件填電腦路徑 → 擋下並說明要放 Drive');
r = call('handleProspectMailCfgSave', { cfg: { attach: 'https://drive.google.com/file/d/' + DRIVE_ID + '/view', sender: 'Austin', signature: '', intro: '', strategy: '', fromName: '' } });
ok(r.success && r.attach.ok && r.attach.name === '鑫堡AOI檢測系統.pdf', '附件填 Drive 連結 → 存起來並讀到檔名');
ok(call('handleProspectMailCfg', {}).cfg.signature === ctx.PS_MAIL_DEFAULTS.signature, '欄位留空 = 用預設');
call('handleProspectMailCfgSave', { cfg: { attach: DRIVE_ID, signature: 'MY-SIG\nAustin' } });
ok(call('handleProspectMailCfg', {}).cfg.signature === 'MY-SIG\nAustin', '署名可以改');

// ---- 預覽：沒有草稿 → 現場產生（讀官網 → AI） ----
const a = find('翔笙');
ok(a.HasMail === 0 && a.MailBody === undefined, '列表：不帶信件全文，只有 HasMail 旗標');
const n0 = calls.ai;
r = call('handleProspectMailPreview', { key: a.Key, row: a.RowIndex });
ok(r.success && !r.generated && !r.hasDraft && calls.ai === n0 && /MY-SIG/.test(r.body) && r.to === 'sales@cam.com.tw', '開啟預覽不呼叫 AI：沒有草稿就給空白信件（只有署名）');
ok(find('翔笙').HasMail === 0, '只開預覽不會存草稿');
r = call('handleProspectMailPreview', { key: a.Key, row: a.RowIndex, regen: true });
ok(r.success && r.generated && r.hasDraft && r.to === 'sales@cam.com.tw' && /AOI 視覺/.test(r.subject) && /翔笙精密機械團隊您好/.test(r.body), '預覽：產生草稿（收件人、主旨、內容）');
ok(/MY-SIG/.test(r.body) && r.attach.ok && r.attach.name === '鑫堡AOI檢測系統.pdf', '預覽：署名接在最後；附件顯示檔名');
const prompt1 = JSON.stringify(calls.prompts[0]);
ok(/滾子凸輪式分割器/.test(prompt1) && /EtherCAT/.test(prompt1) && /沒有明確關聯/.test(prompt1) && /設備商/.test(prompt1), '給 AI 的提示：有官網文字、鑫堡項目、寫信原則、對方類型');
ok(find('翔笙').HasMail === 1, '草稿已存進名單');
const n = calls.ai;
r = call('handleProspectMailPreview', { key: a.Key, row: a.RowIndex });
ok(r.success && !r.generated && calls.ai === n, '再開一次預覽：用存好的草稿，不重複呼叫 AI');
r = call('handleProspectMailPreview', { key: a.Key, row: a.RowIndex, regen: true });
ok(r.success && r.generated && calls.ai === n + 1, '再按「一鍵生成文案」→ 再呼叫一次 AI');

// ---- 預覽的各種例外 ----
const fac = find('大塑膠');
aiReply = '這不是 JSON，但是有內容：貴公司從事射出成型，我們提供 AOI 產線檢測。';
r = call('handleProspectMailPreview', { key: fac.Key, row: fac.RowIndex, regen: true });
ok(r.success && r.generated && /射出成型/.test(r.body) && /鑫堡 AOI 檢測方案/.test(r.subject), 'AI 沒回 JSON：整段當正文、主旨用預設');
aiStatus = 403;
const nof = find('沒信箱');
r = call('handleProspectMailPreview', { key: nof.Key, row: nof.RowIndex, regen: true });
ok(r.success && !r.generated && /AI 都失敗/.test(r.genError) && r.genError.indexOf('KEY-SECRET') < 0 && /MY-SIG/.test(r.body) && r.to === '', 'AI 失敗：回空白草稿讓人手寫、金鑰不外洩、沒有收件人');
aiStatus = 200;
r = call('handleProspectMailPreview', { key: optRow.Key, row: optRow.RowIndex });
ok(!r.success && /拒絕聯絡/.test(r.message), '標了拒絕聯絡 → 不能預覽 / 寄信');
const nosite = find('沒官網');
r = call('handleProspectMailPreview', { key: nosite.Key, row: nosite.RowIndex, regen: true });
ok(r.success && !r.generated && /還沒有官網/.test(r.genError), '沒有官網：說明原因，仍可手寫');

// ---- 寄出 ----
const before = call('handleProspectLogs', { key: a.Key }).logs.length;
r = call('handleProspectMailSend', { key: a.Key, row: a.RowIndex, to: 'sales@cam.com.tw', subject: '改過的主旨', body: '翔笙團隊您好：這是我改過的內容，共有二十個字以上。\n\nMY-SIG' });
ok(r.success && sent.length === 1 && sent[0].to === 'sales@cam.com.tw' && sent[0].subject === '改過的主旨' && /我改過的內容/.test(sent[0].body), '寄出：用預覽時編輯過的主旨與內容');
ok(sent[0].opts.name === '鑫堡股份有限公司 CETUS' && sent[0].opts.attachments.length === 1 && sent[0].opts.attachments[0].name === '鑫堡AOI檢測系統.pdf', '寄件人名稱用預設；附上 Drive 的 PDF');
const logs = call('handleProspectLogs', { key: a.Key }).logs;
ok(logs.length === before + 1 && logs[0].Method === 'Email' && /改過的主旨/.test(logs[0].Content) && /附件：鑫堡AOI檢測系統\.pdf/.test(logs[0].Content), '寄信後自動記一筆聯繫紀錄（Email，含主旨與附件）');
const after = find('翔笙');
ok(after.Stage === '已聯絡' && after.MailSentAt && r.sentAt === after.MailSentAt && after.LastContactAt, '開發狀態「未處理」→「已聯絡」，記下寄出時間');
r = call('handleProspectMailSend', { key: a.Key, row: a.RowIndex, to: 'sales@cam.com.tw', subject: '改過的主旨', body: '翔笙團隊您好：這是我改過的內容，共有二十個字以上。' });
ok(!r.success && /重複/.test(r.message) && sent.length === 1, '30 秒內再按寄出 → 擋下，避免重複寄');
r = call('handleProspectMailPreview', { key: a.Key, row: a.RowIndex });
ok(r.sentAt && r.subject === '改過的主旨', '再開預覽：顯示已寄出時間，內容是寄出的版本');

// ---- 寄出的各種檢查 ----
const b = find('大塑膠');
ok(!call('handleProspectMailSend', { key: b.Key, row: b.RowIndex, to: 'bad', subject: 's', body: '一'.repeat(30) }).success, '收件人格式不對 → 不寄');
ok(!call('handleProspectMailSend', { key: b.Key, row: b.RowIndex, to: 'a@b.com', subject: '', body: '一'.repeat(30) }).success, '沒有主旨 → 不寄');
ok(!call('handleProspectMailSend', { key: b.Key, row: b.RowIndex, to: 'a@b.com', subject: 's', body: '太短' }).success, '內容太短 → 不寄');
ok(!call('handleProspectMailSend', { key: optRow.Key, row: optRow.RowIndex, to: 'no@cam.com.tw', subject: 's', body: '一'.repeat(30) }).success && sent.length === 1, '拒絕聯絡 → 後端也不寄（不只前端擋）');
call('handleProspectMailCfgSave', { cfg: { attach: 'zzzzzzzzzzzzzzzzzzzz' } });
r = call('handleProspectMailSend', { key: b.Key, row: b.RowIndex, to: 'info@fac.com.tw', subject: 's', body: '一'.repeat(30) });
ok(!r.success && /附件讀取失敗/.test(r.message) && sent.length === 1, '附件讀不到 → 信不寄出（不會偷偷少附檔）');
r = call('handleProspectMailSend', { key: b.Key, row: b.RowIndex, to: 'info@fac.com.tw', subject: 's', body: '一'.repeat(30), noAttach: true });
ok(r.success && sent.length === 2 && !sent[1].opts.attachments && /沒有附件/.test(call('handleProspectLogs', { key: b.Key }).logs[0].Content), '勾「這封不附檔案」→ 照寄，紀錄寫沒有附件');
call('handleProspectMailCfgSave', { cfg: { attach: '' } });
sendFail = true;
const c = find('沒信箱');
r = call('handleProspectMailSend', { key: c.Key, row: c.RowIndex, to: 'x@y.com', subject: 's', body: '一'.repeat(30) });
ok(!r.success && /寄信失敗/.test(r.message) && !find('沒信箱').MailSentAt, 'Gmail 失敗（例如超過每日寄信額度）→ 回報原因，不記成已寄出');
sendFail = false;

// ---- 查官網時一起產生寄信內容 ----
const d = find('沒官網');
call('handleProspectUpdate', { key: d.Key, row: d.RowIndex, fields: { Website: 'https://www.fac.com.tw' } });
const plan = call('handleProspectEnrichPlan', { filter: { q: '沒官網' } });
const callsBefore = calls.ai;
let e = call('handleProspectEnrich', { items: plan.items });
ok(e.results[0].status === 'ok' && !e.results[0].mail && calls.ai === callsBefore && find('沒官網').HasMail === 0, '沒勾「同時產生寄信內容」→ 只查聯絡方式，不呼叫 AI（維持舊行為）');
e = call('handleProspectEnrich', { items: call('handleProspectEnrichPlan', { filter: { q: '沒官網' }, onlyNew: false }).items, mail: true });
ok(e.results[0].mail === 'ok' && calls.ai === callsBefore + 1 && find('沒官網').HasMail === 1, '勾了 → 查完官網順便寫好草稿');
e = call('handleProspectEnrich', { items: call('handleProspectEnrichPlan', { filter: { q: '沒官網' }, onlyNew: false }).items, mail: true });
ok(calls.ai === callsBefore + 1 && !e.results[0].mail, '已經有草稿的不重寫（不浪費 AI 次數、不蓋掉人工編輯）');
aiStatus = 500;
const g = find('大塑膠');
e = call('handleProspectEnrich', { items: [{ key: g.Key, row: g.RowIndex, name: g.Name }], mail: true });
ok(e.results[0].status === 'ok' && (e.results[0].mail === undefined || e.results[0].mail === 'fail' || e.results[0].mail === 'ok'), 'AI 失敗不影響找官網的結果');
aiStatus = 200;

// ---- 存成 Gmail 草稿：不寄出、不記聯繫紀錄、不改開發狀態 ----
const dz = find('沒官網');
const sentBefore = sent.length;
r = call('handleProspectMailSend', { key: dz.Key, row: dz.RowIndex, to: 'x@nosite.com.tw', subject: '草稿主旨', body: '沒官網團隊您好：這是要先存成草稿的內容，確認後再寄。', draftOnly: true, noAttach: true });
ok(r.success && r.draft && /drafts/.test(r.draftUrl) && drafts.length === 1 && sent.length === sentBefore, '存成 Gmail 草稿：建立草稿、沒有寄出');
const dz2 = find('沒官網');
ok(!dz2.MailSentAt && (dz2.Stage === '' || dz2.Stage === '未處理') && call('handleProspectMailPreview', { key: dz2.Key, row: dz2.RowIndex }).subject === '草稿主旨', '存成草稿：修改的內容存回名單、狀態不變、不算已寄');
console.log('prospects-mail checks passed: ' + pass);
