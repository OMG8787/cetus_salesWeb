/**
 * 業務行事曆（每天上班照著這頁做）：
 *   ① 行事曆：自己的內建行事曆（可看別人分享的）；客戶的下次追蹤會自動出現在裡面
 *   ② 需要追蹤、但還沒建立案件的客戶（可直接「建立案件」）
 *   ③ 已建立、進行中的案件（連動客戶的下次追蹤日與緊急程度）
 * 客戶資料與案件資料跟「案件管理」共用同一份暫存（casesPageData），追蹤進度都記在客戶身上。
 */
let schCustomers = [];
let schCases = [];
let schData = null; // 最近一次的 getCasesPageData 結果（存回暫存用）

const URGENCY_RANK = { 高: 0, 中: 1, 低: 2 };
const URGENCY_STYLE = {
  高: 'background:#c0392b;color:#fff;',
  中: 'background:#e67e22;color:#fff;',
  低: 'background:#7f8c8d;color:#fff;',
};

function esc(v) {
  return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function argAttr(v) {
  return encodeURIComponent(String(v == null ? '' : v));
}

function urgencyBadge(u) {
  const t = u || '中';
  return `<span style="${URGENCY_STYLE[t] || URGENCY_STYLE['中']}padding:1px 8px;border-radius:10px;font-size:12px;font-weight:bold;">${esc(t)}</span>`;
}

function daysUntil(dateStr) {
  const d = normalizeDateStr(dateStr);
  if (!d) return null;
  const n = Math.round((new Date(d + 'T00:00:00') - new Date(localTodayStr() + 'T00:00:00')) / 86400000);
  return isNaN(n) ? null : n;
}

/** 排序：預設「緊急程度優先，再依追蹤日（逾期最前面）」；也可以改成追蹤日優先。沒設定追蹤日的排最後。 */
function schSort(a, b) {
  const mode = document.getElementById('sch-sort').value;
  const ua = URGENCY_RANK[a.Urgency || '中'] ?? 1;
  const ub = URGENCY_RANK[b.Urgency || '中'] ?? 1;
  const da = daysUntil(a.NextFollowUpDate);
  const db = daysUntil(b.NextFollowUpDate);
  const dka = da == null ? 99999 : da;
  const dkb = db == null ? 99999 : db;
  const ta = timeMinutes(a.NextFollowUpTime);
  const tb = timeMinutes(b.NextFollowUpTime);
  if (mode === 'urgency') return ua - ub || dka - dkb || ta - tb;
  return dka - dkb || ta - tb || ua - ub; // 預設：先依追蹤日（逾期最前面），同一天先看預約時間，再依緊急程度
}

function rangeLimit() {
  const v = document.getElementById('sch-range').value;
  return v === 'all' ? Infinity : Number(v);
}

function matchKeyword(texts) {
  const kw = document.getElementById('sch-keyword').value.trim().toLowerCase();
  return !kw || texts.some((t) => String(t || '').toLowerCase().indexOf(kw) > -1);
}

function applyScheduleData(data) {
  schData = data;
  schCustomers = data.customers || [];
  schCases = data.cases || [];
  renderSchedule();
}

async function loadScheduleData() {
  const cached = await getCachedAsync('casesPageData');
  if (cached) applyScheduleData(cached);
  const result = await callApi('getCasesPageData', {}, { silent: !!cached });
  if (!result.success) {
    if (!cached) alert(result.message);
    return;
  }
  setCached('casesPageData', result);
  applyScheduleData(result);
}

/** 追蹤視窗存檔後：先用回傳的客戶資料直接更新畫面（不用等重新載入），再在背景跟資料庫同步。 */
function schAfterSave(r, oldName) {
  if (r && r.customer) {
    patchCustomerList(schCustomers, r.customer, oldName);
    if (oldName && r.customer.CompanyName !== oldName) {
      schCases.forEach((c) => {
        if (c.CustomerName === oldName) c.CustomerName = r.customer.CompanyName;
      });
    }
    if (schData) setCached('casesPageData', Object.assign({}, schData, { customers: schCustomers, cases: schCases }));
  }
  renderSchedule();
  callApi('getCasesPageData', {}, { silent: true }).then((res) => {
    if (res && res.success) {
      setCached('casesPageData', res);
      applyScheduleData(res);
    }
  });
}

function followCell(c) {
  const f = followUpInfo(c.NextFollowUpDate, c.NextFollowUpTime);
  if (!normalizeDateStr(c.NextFollowUpDate)) return '<span style="color:#999;">未設定</span>';
  return `<span style="color:${f.color};${f.note && f.color !== '#333' ? 'font-weight:bold;' : ''}">${f.text}</span>${f.note ? `<br><small style="color:${f.color};">${f.note}</small>` : ''}`;
}

// 每間客戶最近一筆「真正的聯繫」（「上次聯繫」用；系統記的資料修改 / 改期不算）
let schLastLog = {};

function rebuildLastLog() {
  const map = {};
  Object.keys(ContactLogStore.byCompany).forEach((name) => {
    const l = lastRealContact(ContactLogStore.byCompany[name]);
    if (l) map[name] = l;
  });
  schLastLog = map;
}

/** 全部聯繫紀錄在背景載入（追蹤視窗的歷史紀錄也用同一份，按「展開」不用再等）。 */
async function loadScheduleLogs() {
  await ContactLogStore.loadAll(true);
}

ContactLogStore.onChange(() => {
  rebuildLastLog();
  renderSchedule();
});

/** 「本次需要洽談」：上次追蹤時寫的「下次追蹤說明」，今天打電話前先看這格；下面小字是上次聯繫的結果。 */
function discussCell(c) {
  // 只顯示專門寫的「下次洽談內容」；客戶備註已經在旁邊的「…」，不在這裡重複顯示
  const note = String(c.NextFollowUpNote || '').trim();
  const last = schLastLog[c.CompanyName || c.CustomerName];
  const main = note
    ? `<div class="sch-discuss">${esc(note)}</div>`
    : '<div class="calc-hint">（還沒寫這次要談什麼，按「改日」補上洽談內容）</div>';
  const lastHtml = last
    ? `<div class="calc-hint" style="margin-top:3px;" title="${esc(last.Summary)}">上次聯繫 ${esc(String(last.Date).slice(5))}${last.Method ? ' ' + esc(last.Method) : ''}：${esc(String(last.Summary || '').replace(/[\r\n]+/g, ' ').slice(0, 60))}</div>`
    : '';
  return main + lastHtml;
}

function renderSchedule() {
  const urgencyFilter = document.getElementById('sch-urgency').value;
  const limit = rangeLimit();
  // 只算「進行中」的案件：客戶只有已結案的案件時，還是要追蹤的話，仍然會出現在「未建立案件」清單
  const casesByCustomer = {};
  schCases
    .filter((c) => c.Status !== '已結案')
    .forEach((c) => {
      (casesByCustomer[c.CustomerName] = casesByCustomer[c.CustomerName] || []).push(c);
    });
  const custByName = {};
  schCustomers.forEach((c) => (custByName[c.CompanyName] = c));

  // ② 需要追蹤、但還沒有任何案件的客戶
  const noCase = schCustomers
    .filter((c) => {
      const d = daysUntil(c.NextFollowUpDate);
      if (d == null || d > limit) return false;
      if ((casesByCustomer[c.CompanyName] || []).length) return false;
      if (urgencyFilter && (c.Urgency || '中') !== urgencyFilter) return false;
      return matchKeyword([c.CompanyName, c.Contact, c.Phone, c.Notes, c.NextFollowUpNote]);
    })
    .sort(schSort);

  // ③ 進行中的案件（狀態不是「已結案」），帶出客戶的追蹤日與緊急程度
  const openCases = schCases
    .filter((c) => c.Status !== '已結案')
    .map((c) => {
      const cust = custByName[c.CustomerName] || {};
      return Object.assign({}, c, { Urgency: c.Urgency || cust.Urgency || '中', NextFollowUpDate: cust.NextFollowUpDate || '', NextFollowUpTime: cust.NextFollowUpTime || '', _cust: cust });
    })
    .filter((c) => {
      if (urgencyFilter && c.Urgency !== urgencyFilter) return false;
      return matchKeyword([c.CaseID, c.CustomerName, c.Salesperson, c.FAE, c.ProductApplication]);
    })
    .sort(schSort);

  // 摘要
  const allDue = schCustomers.filter((c) => daysUntil(c.NextFollowUpDate) != null);
  const overdue = allDue.filter((c) => daysUntil(c.NextFollowUpDate) < 0).length;
  const today = allDue.filter((c) => daysUntil(c.NextFollowUpDate) === 0).length;
  const soon = allDue.filter((c) => daysUntil(c.NextFollowUpDate) > 0 && daysUntil(c.NextFollowUpDate) <= 3).length;
  document.getElementById('sch-summary').innerHTML = [
    ['已逾期', overdue, '#c0392b'],
    ['今天要追蹤', today, '#d35400'],
    ['3 天內', soon, '#b7950b'],
    ['未建案件待追蹤', noCase.length, '#8e44ad'],
    ['進行中案件', openCases.length, '#2c5aa0'],
  ]
    .map(([l, n, c]) => `<span class="sch-chip" style="border-color:${c};color:${c};"><b>${n}</b> ${l}</span>`)
    .join('');

  // 未建案件的客戶
  const tbody1 = document.querySelector('#sch-nocase-table tbody');
  tbody1.innerHTML = '';
  noCase.forEach((c) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${urgencyBadge(c.Urgency)}</td><td>${esc(c.CompanyName)}${siteLinkHtml(customerSite(c))}</td><td>${esc(c.Contact)}</td><td>${c.Phone ? `<a href="tel:${esc(String(c.Phone).replace(/[^\d+#,]/g, ''))}">${esc(c.Phone)}</a>` : ''}</td><td>${followCell(c)}</td>
      <td>${discussCell(c)}</td>
      <td class="sch-notes-dot" ${c.Notes ? `data-full="${esc(c.Notes)}" title="${esc(c.Notes)}"` : ''}>${c.Notes ? '…' : ''}</td>
      <td>
        <button class="btn-mini" style="background:#27ae60;" onclick="schDone(decodeURIComponent('${argAttr(c.CompanyName)}'), '')">追蹤完畢</button>
        <button class="btn-mini" style="background:#8e44ad;" onclick="location.href='cases.html?newCaseFor=${argAttr(c.CompanyName)}'">建立案件</button>
        <button class="btn-mini" onclick="schChangeDate(decodeURIComponent('${argAttr(c.CompanyName)}'))">改日</button>
      </td>`;
    tbody1.appendChild(tr);
  });
  document.getElementById('sch-nocase-empty').style.display = noCase.length ? 'none' : '';

  // 進行中案件
  const tbody2 = document.querySelector('#sch-case-table tbody');
  tbody2.innerHTML = '';
  openCases.forEach((c) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${urgencyBadge(c.Urgency)}</td><td>${esc(c.CaseID)}</td><td>${esc(c.CustomerName)}${siteLinkHtml(customerSite(Object.assign({ CompanyName: c.CustomerName }, c._cust || {})))}</td><td>${esc(c.Status)}</td><td>${followCell(c)}</td>
      <td>${discussCell(Object.assign({}, c._cust || {}, { CompanyName: c.CustomerName, NextFollowUpNote: (c._cust || {}).NextFollowUpNote }))}</td>
      <td>${esc(c.Salesperson)}${c.FAE ? '<br><small class="calc-hint">FAE：' + esc(c.FAE) + '</small>' : ''}</td>
      <td>
        <button class="btn-mini" onclick="location.href='cases.html?caseId=${argAttr(c.CaseID)}'">查看案件</button>
        <button class="btn-mini" style="background:#27ae60;" onclick="schDone(decodeURIComponent('${argAttr(c.CustomerName)}'), decodeURIComponent('${argAttr(c.CaseID)}'))">追蹤完畢</button>
        <button class="btn-mini" onclick="schChangeDate(decodeURIComponent('${argAttr(c.CustomerName)}'))">改日</button>
      </td>`;
    tbody2.appendChild(tr);
  });
  document.getElementById('sch-case-empty').style.display = openCases.length ? 'none' : '';
  renderAgenda();
}

function schDone(companyName, caseId) {
  const cust = schCustomers.find((c) => c.CompanyName === companyName);
  if (!cust) return alert('客戶資料裡找不到「' + companyName + '」');
  openFollowUpDialog({
    companyName,
    rowIndex: cust.RowIndex,
    contact: cust.Contact || '',
    customer: cust,
    caseData: schCases.find((x) => x.CaseID === caseId) || null,
    caseId: caseId || '',
    onSaved: schAfterSave,
    onDone: () => loadDailyReport(),
  });
}

function schChangeDate(companyName) {
  const cust = schCustomers.find((c) => c.CompanyName === companyName);
  if (!cust) return alert('客戶資料裡找不到「' + companyName + '」');
  openFollowUpDialog({
    companyName,
    rowIndex: cust.RowIndex,
    customer: cust,
    editOnly: true,
    onSaved: schAfterSave,
  });
}

// ④ 今日已完成的工作（工作日報）：這天的客戶聯繫紀錄，整理成可以直接複製貼到日報的文字
let repLogs = [];

let repPLogs = []; // 這天的開發名單聯繫紀錄
let repDoneTodos = []; // 這天完成的工作
let repMe = '';

async function loadDailyReport() {
  const date = document.getElementById('rep-date').value || localTodayStr();
  const [r, p, t] = await Promise.all([
    callApi('getContactLogs', { date }, { silent: true }),
    callApi('workAgenda', { logsOnly: true, reportDate: date }, { silent: true }),
    callApi('todoGet', { scope: 'all', status: 'done' }, { silent: true }),
  ]);
  if (!r.success) {
    document.getElementById('rep-text').value = r.message || '讀取失敗';
    return;
  }
  repLogs = r.logs || [];
  repPLogs = p && p.success ? p.prospectLogs || [] : [];
  repMe = p && p.success ? p.me : '';
  repDoneTodos = t && t.success ? (t.todos || []).filter((x) => String(x.doneAt || '').slice(0, 10) === date) : [];
  renderDailyReport();
}

function renderDailyReport() {
  const date = document.getElementById('rep-date').value || localTodayStr();
  const mineOnly = document.getElementById('rep-mine').checked;
  const me = typeof currentUsername !== 'undefined' ? currentUsername : '';
  const logs = repLogs
    .filter((l) => !isChangeLog(l)) // 系統自動記的「資料修改 / 改期」不是工作內容
    .filter((l) => !mineOnly || !l.Salesperson || l.Salesperson === me)
    .slice()
    .sort((a, b) => String(a.CreatedAt || '').localeCompare(String(b.CreatedAt || '')) || a.RowIndex - b.RowIndex); // 依記錄的先後順序
  const caseById = {};
  schCases.forEach((c) => (caseById[c.CaseID] = c));

  const lines = [`${date} 工作內容${me ? '（' + me + '）' : ''}`];
  if (!logs.length) lines.push('（這天還沒有記錄任何追蹤 / 聯繫。完成追蹤後在上面按「追蹤完畢」，就會出現在這裡。）');
  logs.forEach((l, i) => {
    const cs = l.CaseID ? caseById[l.CaseID] : null;
    lines.push(`${i + 1}. ${l.CompanyName}${l.Contact ? '（聯絡人：' + l.Contact + '）' : ''}`);
    lines.push(`   方式：${l.Method || '—'}`);
    if (l.CaseID) lines.push(`   案件：${l.CaseID}${cs ? '（' + (cs.ProductApplication || cs.TestObject || cs.Status || '') + '）' : ''}`.replace(/（）$/, ''));
    lines.push(`   內容：${String(l.Summary || '').replace(/\n+/g, '\n         ')}`);
    const cust = schCustomers.find((x) => x.CompanyName === l.CompanyName);
    if (cust && normalizeDateStr(cust.NextFollowUpDate)) lines.push(`   下次追蹤：${followWhenText(cust.NextFollowUpDate, cust.NextFollowUpTime)}${cust.NextFollowUpNote ? '　' + String(cust.NextFollowUpNote).replace(/\n+/g, ' ') : ''}`);
  });
  const plogs = repPLogs.filter((l) => !mineOnly || !repMe || l.User === repMe);
  if (plogs.length) {
    lines.push('', '【陌生開發聯繫】');
    plogs.forEach((l, i) => {
      lines.push(`${i + 1}. ${l.Company || l.Key}（${l.Method}）${l.Stage ? '→ ' + l.Stage : ''}`);
      lines.push(`   內容：${String(l.Content || '').replace(/\n+/g, '\n         ')}`);
      if (l.NextFollowUp) lines.push(`   下次追蹤：${l.NextFollowUp}`);
    });
  }
  const todosDone = repDoneTodos.filter((x) => !mineOnly || x.isMine);
  if (todosDone.length) {
    lines.push('', '【完成的工作】');
    todosDone.forEach((x) => lines.push(`- ${x.title}`));
  }
  if (!logs.length && (plogs.length || todosDone.length)) lines.splice(1, 1); // 有其他內容時，不顯示「還沒有記錄」的提示
  document.getElementById('rep-text').value = lines.join('\n');
  document.getElementById('rep-count').textContent = `共 ${logs.length + plogs.length + todosDone.length} 筆`;
}

async function copyDailyReport() {
  const box = document.getElementById('rep-text');
  try {
    await navigator.clipboard.writeText(box.value);
  } catch (e) {
    box.select();
    document.execCommand('copy');
  }
  const btn = document.getElementById('rep-copy');
  const old = btn.textContent;
  btn.textContent = '已複製 ✓';
  setTimeout(() => (btn.textContent = old), 1500);
}

// ① 我的行事曆（內建；清單 / 月曆）
let calView = 'list';
let calMonth = ''; // YYYY-MM
let calEvents = [];

function ymd(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function addDaysStr2(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return ymd(d);
}

function calSetView(v) {
  calView = v;
  document.getElementById('cal-v-list').classList.toggle('on', v === 'list');
  document.getElementById('cal-v-month').classList.toggle('on', v === 'month');
  document.getElementById('sch-days').style.display = v === 'list' ? '' : 'none';
  document.getElementById('cal-month-nav').style.display = v === 'month' ? 'inline-flex' : 'none';
  if (v === 'month' && !calMonth) calMonth = localTodayStr().slice(0, 7);
  loadScheduleEvents();
}

function calShiftMonth(n) {
  const [y, m] = calMonth.split('-').map(Number);
  calMonth = ymd(new Date(y, m - 1 + n, 1)).slice(0, 7);
  loadScheduleEvents();
}

function calToday() {
  calMonth = localTodayStr().slice(0, 7);
  loadScheduleEvents();
}

/** 月曆顯示的範圍：從該月 1 號那週的星期日，到該月最後一天那週的星期六。 */
function monthGrid() {
  const [y, m] = calMonth.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const start = new Date(y, m - 1, 1 - first.getDay());
  const last = new Date(y, m, 0);
  const end = new Date(y, m - 1, last.getDate() + (6 - last.getDay()));
  return { from: ymd(start), to: ymd(end) };
}

function evTimeText(ev) {
  return ev.allDay ? '全天' : ev.startTime + (ev.endTime ? '–' + ev.endTime : '');
}

function evBadges(ev) {
  const out = [];
  if (ev.source === 'followup') out.push('<span class="ws-badge follow">客戶追蹤</span>');
  if (!ev.isMine) out.push(`<span class="ws-badge shared">${esc(ev.ownerName)} 分享（只能看）</span>`);
  else if (ev.shareMode !== 'self') out.push(`<span class="ws-badge shared" title="${esc(ev.shareLabel)}">已分享：${esc(ev.shareLabel)}</span>`);
  return out.join('');
}

async function loadScheduleEvents() {
  const box = document.getElementById('sch-events');
  box.innerHTML = '<span class="calc-hint">讀取中...</span>';
  let from, to;
  if (calView === 'month') {
    ({ from, to } = monthGrid());
  } else {
    from = localTodayStr();
    to = addDaysStr2(from, Number(document.getElementById('sch-days').value) - 1);
  }
  const result = await callApi('calGetEvents', { from, to, scope: document.getElementById('cal-scope').value }, { silent: true });
  if (!result.success) {
    box.innerHTML = `<span class="calc-hint">${esc(result.message)}</span>`;
    return;
  }
  calEvents = result.events || [];
  renderEvents();
}

function renderEvents() {
  const box = document.getElementById('sch-events');
  if (calView === 'month') return renderMonth(box);
  document.getElementById('cal-month-title').textContent = '';
  if (!calEvents.length) {
    box.innerHTML = '<span class="calc-hint">這段期間沒有行程。按右上「＋ 新增行程」可以加一個。</span>';
    return;
  }
  box.innerHTML = calEvents
    .map((ev) => {
      const when = ev.endDate && ev.endDate !== ev.startDate ? `${ev.startDate.slice(5)} → ${ev.endDate.slice(5)}` : ev.startDate.slice(5);
      return `<div class="ws-evrow">
        <span class="ws-evdate">${esc(when)}</span><span class="ws-evtime">${esc(evTimeText(ev))}</span>
        <span class="ws-evmain">${esc(ev.title)}${siteLinkFor(ev.title + ' ' + (ev.location || '') + ' ' + (ev.notes || ''))}${ev.location ? ` <span class="calc-hint">@${esc(ev.location)}</span>` : ''}${evBadges(ev)}${ev.notes ? `<div class="calc-hint">${esc(ev.notes).replace(/\n/g, '<br>')}</div>` : ''}</span>
        <span class="ws-evact"><button type="button" class="btn-secondary" onclick="openEventModal(${ev.id})">${ev.canEdit && ev.source !== 'followup' ? '編輯' : '查看'}</button></span>
      </div>`;
    })
    .join('');
}

function renderMonth(box) {
  const [y, m] = calMonth.split('-').map(Number);
  document.getElementById('cal-month-title').textContent = `${y} 年 ${m} 月`;
  const { from, to } = monthGrid();
  const today = localTodayStr();
  const byDay = {};
  calEvents.forEach((ev) => {
    let d = ev.startDate < from ? from : ev.startDate;
    const stop = ev.endDate > to ? to : ev.endDate || ev.startDate;
    for (let n = 0; d <= stop && n < 70; n++, d = addDaysStr2(d, 1)) (byDay[d] = byDay[d] || []).push(ev);
  });
  let html = ['日', '一', '二', '三', '四', '五', '六'].map((w) => `<div class="ws-dow">${w}</div>`).join('');
  for (let d = from; d <= to; d = addDaysStr2(d, 1)) {
    const list = byDay[d] || [];
    const inMonth = d.slice(0, 7) === calMonth;
    html += `<div class="ws-day${inMonth ? '' : ' other'}${d === today ? ' today' : ''}" onclick="openEventModal(0, '${d}')"><span class="ws-dnum">${Number(d.slice(8))}</span>`;
    list.slice(0, 3).forEach((ev) => {
      html += `<span class="ws-chip${ev.source === 'followup' ? ' follow' : !ev.isMine ? ' shared' : ''}" title="${esc(ev.title)}" onclick="event.stopPropagation();openEventModal(${ev.id})">${ev.allDay ? '' : esc(ev.startTime) + ' '}${esc(ev.title)}</span>`;
    });
    if (list.length > 3) html += `<div class="ws-more">還有 ${list.length - 3} 項…</div>`;
    html += '</div>';
  }
  box.innerHTML = `<div class="ws-month">${html}</div>`;
}

function evSyncAllDay() {
  document.getElementById('ev-times').style.display = document.getElementById('ev-allday').checked ? 'none' : '';
}

async function openEventModal(id, date) {
  const ev = id ? calEvents.find((x) => x.id === id) : null;
  if (id && !ev) return;
  await ShareUI.mount('ev-share');
  const editable = !ev || (ev.canEdit && ev.source !== 'followup'); // 內容能不能改
  const shareEditable = !ev || ev.canEdit; // 誰看得到：擁有者都能改（包含客戶追蹤提醒）
  document.getElementById('ev-heading').textContent = ev ? (editable ? '編輯行程' : '行程內容') : '新增行程';
  document.getElementById('ev-id').value = ev ? ev.id : '';
  document.getElementById('ev-title').value = ev ? ev.title : '';
  document.getElementById('ev-date').value = ev ? ev.startDate : date || localTodayStr();
  document.getElementById('ev-enddate').value = ev && ev.endDate !== ev.startDate ? ev.endDate : '';
  document.getElementById('ev-allday').checked = ev ? ev.allDay : false;
  document.getElementById('ev-start').value = ev ? ev.startTime : '09:00';
  document.getElementById('ev-end').value = ev ? ev.endTime : '';
  document.getElementById('ev-loc').value = ev ? ev.location : '';
  document.getElementById('ev-notes').value = ev ? ev.notes : '';
  ShareUI.set('ev-share', ev ? ev.shareMode : 'self', ev ? ev.shareWith : []);
  evSyncAllDay();
  ['ev-title', 'ev-date', 'ev-enddate', 'ev-allday', 'ev-start', 'ev-end', 'ev-loc', 'ev-notes'].forEach((k) => (document.getElementById(k).disabled = !editable));
  document.querySelector('#ev-share .share-mode').disabled = !shareEditable;
  document.getElementById('ev-share').style.display = ev && !ev.isMine ? 'none' : '';
  document.getElementById('ev-save').style.display = shareEditable ? '' : 'none';
  document.getElementById('ev-del').style.display = ev && ev.canEdit ? '' : 'none';
  const ro = document.getElementById('ev-readonly');
  ro.style.display = editable ? 'none' : '';
  ro.textContent = !ev ? '' : ev.source === 'followup' && ev.isMine ? '這是客戶「下次追蹤」自動加的提醒，預設只有你自己看得到；要讓別人也看得到，可以在上面選「誰看得到」。要改日期請在下面的清單按「改日」或「追蹤完畢」。' : ev.source === 'followup' ? `這是 ${ev.ownerName} 分享給你的客戶追蹤提醒，只能查看。` : `這是 ${ev.ownerName} 分享給你的行程，只能查看，不能修改。`;
  document.getElementById('event-modal').style.display = 'flex';
}

function closeEventModal() {
  document.getElementById('event-modal').style.display = 'none';
}

async function saveEvent() {
  const share = ShareUI.get('ev-share');
  const body = {
    id: Number(document.getElementById('ev-id').value) || 0,
    title: document.getElementById('ev-title').value.trim(),
    startDate: document.getElementById('ev-date').value,
    endDate: document.getElementById('ev-enddate').value || '',
    allDay: document.getElementById('ev-allday').checked,
    startTime: document.getElementById('ev-allday').checked ? '' : document.getElementById('ev-start').value,
    endTime: document.getElementById('ev-allday').checked ? '' : document.getElementById('ev-end').value,
    location: document.getElementById('ev-loc').value.trim(),
    notes: document.getElementById('ev-notes').value.trim(),
    shareMode: share.shareMode,
    shareWith: share.shareWith,
  };
  const r = await callApi('calSaveEvent', body);
  if (!r.success) return alert(r.message);
  closeEventModal();
  loadScheduleEvents();
}

async function deleteEvent() {
  const id = Number(document.getElementById('ev-id').value);
  if (!id || !confirm('確定要刪除這個行程嗎？')) return;
  const r = await callApi('calDeleteEvent', { id });
  if (!r.success) return alert(r.message);
  closeEventModal();
  loadScheduleEvents();
}

window.addEventListener('DOMContentLoaded', async () => {
  if (!(await ensureAuth())) return;
  renderHeaderUser();
  applyAdminOnlyVisibility();
  document.getElementById('rep-date').value = localTodayStr();
  document.getElementById('rep-date').addEventListener('change', loadDailyReport);
  document.getElementById('rep-mine').addEventListener('change', renderDailyReport);
  ['sch-urgency', 'sch-sort'].forEach((id) => document.getElementById(id).addEventListener('change', renderSchedule));
  document.getElementById('sch-range').addEventListener('change', () => {
    renderSchedule();
    loadAgenda();
  });
  document.querySelectorAll('#ag-types button').forEach((b) =>
    b.addEventListener('click', () => {
      agType = b.dataset.ag;
      document.querySelectorAll('#ag-types button').forEach((x) => x.classList.toggle('on', x === b));
      renderAgenda();
    })
  );
  loadAgenda();
  document.getElementById('sch-keyword').addEventListener('input', renderSchedule);
  loadScheduleEvents();
  loadScheduleData();
  loadScheduleLogs();
  loadDailyReport();
});

// 導覽列「↻ 重撈資料」
window.refreshPageData = () => Promise.all([loadScheduleData(), loadScheduleEvents(), loadScheduleLogs(), loadDailyReport(), loadAgenda(), typeof loadTodos === 'function' ? loadTodos() : null]);


// ------------------------------------------------------------
// ⓪ 今天要做的事：行程、客戶追蹤、開發名單追蹤、工作清單合成一份清單；每項都可以開官網、撥電話
// ------------------------------------------------------------
let agType = 'all';
let agProspects = [];
let agTodos = [];
let agEvents = [];
let agSites = {}; // 公司名稱 → 官網（客戶資料 + 開發名單）
let agSiteIdx = []; // 比對用：依核心名稱長度排序（長的先比，避免「台積」比到「台積電」以外的公司）
let agLoaded = false;

function safeSite(u) {
  const s = String(u || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[a-z][a-z0-9+.\-]*:/i.test(s)) return ''; // javascript: 之類的不給連
  return 'http://' + s;
}

/** 公司名稱去掉「股份有限公司、工廠」等，剩下用來比對標題文字的核心名稱。 */
function agCoreName(n) {
  let s = String(n || '').replace(/[（(][^）)]*[）)]/g, '').replace(/[一二三四五六七八九十\d]+廠$/, '');
  s = s.replace(/股份有限公司|有限責任|有限公司|無限公司|股份|企業社|工業社|實業社|商行|工廠|公司/g, '').trim();
  return s.length >= 2 ? s : String(n || '').trim();
}

function buildSiteIndex() {
  agSiteIdx = Object.keys(agSites)
    .map((n) => ({ n, core: agCoreName(n), url: agSites[n] }))
    .filter((x) => x.core.length >= 2)
    .sort((a, b) => b.core.length - a.core.length);
}

/** 一段文字（行程標題、工作內容）裡提到哪家公司 → 那家的官網。 */
function siteFor(text) {
  const t = String(text || '');
  if (!t) return '';
  for (const x of agSiteIdx) if (t.indexOf(x.core) > -1) return x.url;
  return '';
}

function siteLinkHtml(url) {
  const u = safeSite(url);
  return u ? ` <a class="ag-site" href="${esc(u)}" target="_blank" rel="noopener noreferrer" title="${esc(u)}">🌐 官網</a>` : '';
}

function siteLinkFor(text) {
  return siteLinkHtml(siteFor(text));
}

function customerSite(c) {
  return safeSite(c.Website) || agSites[c.CompanyName] || siteFor(c.CompanyName);
}

async function loadAgenda() {
  const v = document.getElementById('sch-range').value;
  const today = localTodayStr();
  const to = addDaysStr2(today, v === 'all' ? 90 : Number(v));
  const [a, t, ev] = await Promise.all([
    callApi('workAgenda', { days: v === 'all' ? 'all' : Number(v) }, { silent: true }),
    callApi('todoGet', { scope: 'all', status: 'open' }, { silent: true }),
    callApi('calGetEvents', { from: today, to, scope: 'all' }, { silent: true }),
  ]);
  agProspects = a && a.success ? a.prospects || [] : [];
  agSites = a && a.success ? a.sites || {} : {};
  agTodos = t && t.success ? t.todos || [] : [];
  agEvents = ev && ev.success ? ev.events || [] : [];
  agLoaded = true;
  buildSiteIndex();
  renderSchedule(); // 客戶 / 案件表的官網連結也要用新的對照表（裡面會呼叫 renderAgenda）
  renderEvents();
  if (typeof renderTodos === 'function' && typeof tdTodos !== 'undefined') renderTodos();
}

/** 工作清單有變動（新增 / 完成 / 刪除）時，只更新「今天要做的事」裡的工作。 */
async function onTodosChanged() {
  if (!agLoaded) return;
  const t = await callApi('todoGet', { scope: 'all', status: 'open' }, { silent: true });
  if (t && t.success) agTodos = t.todos || [];
  renderAgenda();
}

async function agTodoDone(id) {
  const r = await callApi('todoSetStatus', { id, status: 'done' }, { silent: true });
  if (!r.success) return alert(r.message);
  if (typeof loadTodos === 'function') loadTodos();
  else onTodosChanged();
  loadDailyReport();
}

const AG_LABEL = { event: ['行程', '#2c5aa0'], customer: ['客戶追蹤', '#d35400'], prospect: ['陌生開發', '#8e44ad'], todo: ['工作', '#27ae60'] };

function agContactLinks(it) {
  const out = [];
  if (it.phone) out.push(`<a class="ag-site" href="tel:${esc(String(it.phone).replace(/[^\d+#,]/g, ''))}">📞 ${esc(it.phone)}</a>`);
  if (it.email) out.push(`<a class="ag-site" href="mailto:${esc(it.email)}">✉️</a>`);
  return out.join(' ');
}

function renderAgenda() {
  const box = document.getElementById('ag-list');
  if (!box) return;
  if (!agLoaded) return;
  const lim = rangeLimit();
  const today = localTodayStr();
  const items = [];
  agEvents
    .filter((ev) => ev.source !== 'followup') // 客戶追蹤自動產生的行程，下面「客戶追蹤」已經有了
    .forEach((ev) =>
      items.push({
        type: 'event', date: ev.startDate, time: ev.allDay ? '全天' : ev.startTime, title: ev.title,
        sub: [ev.location ? '@' + ev.location : '', ev.isMine ? '' : ev.ownerName + ' 分享'].filter(Boolean).join('　'),
        site: siteFor(ev.title + ' ' + (ev.location || '') + ' ' + (ev.notes || '')),
        act: `<button type="button" class="btn-mini" onclick="openEventModal(${ev.id})">${ev.canEdit ? '編輯' : '查看'}</button>`,
      })
    );
  schCustomers.forEach((c) => {
    const d = daysUntil(c.NextFollowUpDate);
    if (d == null || d > lim) return;
    const name = argAttr(c.CompanyName);
    items.push({
      type: 'customer', date: normalizeDateStr(c.NextFollowUpDate), time: c.NextFollowUpTime || '', title: c.CompanyName,
      sub: [c.Contact, c.NextFollowUpNote].filter(Boolean).join('｜'), phone: c.Phone || c.CompanyPhone, email: c.Email, site: customerSite(c),
      act: `<button type="button" class="btn-mini" style="background:#27ae60;" onclick="schDone(decodeURIComponent('${name}'), '')">追蹤完畢</button> <button type="button" class="btn-mini" onclick="schChangeDate(decodeURIComponent('${name}'))">改日</button>`,
    });
  });
  agProspects.forEach((p) =>
    items.push({
      type: 'prospect', date: p.NextFollowUp, time: '', title: p.Name,
      label: p.IsCustomer ? '開發名單' : '', color: '#8e44ad',
      sub: [p.IsCustomer ? '⚠️ 已是客戶（' + p.IsCustomer + '），不是陌生開發' : '', p.Stage, p.Contact, p.City].filter(Boolean).join('｜'), phone: p.Phone, email: p.Email, site: safeSite(p.Website),
      act: `<a class="btn-mini ag-btn" href="prospects.html?q=${encodeURIComponent(p.Name)}&open=1" target="_blank" rel="noopener">📞 記錄</a>`,
    })
  );
  agTodos.forEach((t) => {
    if (!t.dueDate) return;
    const d = daysUntil(t.dueDate);
    if (d == null || d > lim) return;
    items.push({
      type: 'todo', date: t.dueDate, time: '', title: t.title, sub: [t.priority ? '優先度 ' + t.priority : '', t.isMine ? '' : t.ownerName + ' 分享', t.notes].filter(Boolean).join('｜'),
      site: siteFor(t.title + ' ' + (t.notes || '')),
      act: t.canEdit ? `<button type="button" class="btn-mini" style="background:#27ae60;" onclick="agTodoDone(${t.id})">✓ 完成</button> <button type="button" class="btn-mini" onclick="openTodoModal(${t.id})">編輯</button>` : '',
    });
  });
  const counts = { all: items.length, event: 0, customer: 0, prospect: 0, todo: 0 };
  items.forEach((it) => counts[it.type]++);
  document.querySelectorAll('#ag-types button').forEach((b) => {
    const k = b.dataset.ag;
    b.textContent = (k === 'all' ? '全部' : AG_LABEL[k][0]) + ' ' + counts[k];
  });
  const list = items
    .filter((it) => agType === 'all' || it.type === agType)
    .filter((it) => matchKeyword([it.title, it.sub]))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.time).localeCompare(String(b.time)));
  const noDue = agTodos.filter((t) => !t.dueDate).length;
  document.getElementById('ag-count').textContent = noDue ? `另有 ${noDue} 項沒有期限的工作在下方「⑤ 工作清單」` : '';
  if (!list.length) {
    box.innerHTML = '<div class="calc-hint" style="padding:6px 0;">這個範圍內沒有要做的事 🎉</div>';
    return;
  }
  let lastGroup = '';
  box.innerHTML = list
    .map((it) => {
      const group = it.date < today ? '已逾期' : it.date === today ? '今天' : it.date;
      const head = group !== lastGroup ? `<div class="ag-group${group === '已逾期' ? ' late' : ''}">${esc(group === it.date ? it.date.slice(5) + '（' + '日一二三四五六'.charAt(new Date(it.date + 'T00:00:00').getDay()) + '）' : group)}</div>` : '';
      lastGroup = group;
      const [label, color] = it.label ? [it.label, it.color] : AG_LABEL[it.type];
      const when = group === '已逾期' ? it.date.slice(5) + (it.time ? ' ' + it.time : '') : it.time;
      return `${head}<div class="ag-row"><span class="ag-type" style="background:${color};">${label}</span><span class="ag-time">${esc(when || '')}</span>
        <span class="ag-main"><b>${esc(it.title)}</b>${siteLinkHtml(it.site)} ${agContactLinks(it)}${it.sub ? `<div class="calc-hint">${esc(String(it.sub).slice(0, 140))}</div>` : ''}</span>
        <span class="ag-act">${it.act}</span></div>`;
    })
    .join('');
}
