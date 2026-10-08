/**
 * 業務行事曆（每天上班照著這頁做）：
 *   ① 行事曆：Google 日曆接下來的行程
 *   ② 需要追蹤、但還沒建立案件的客戶（可直接「建立案件」）
 *   ③ 已建立、進行中的案件（連動客戶的下次追蹤日與緊急程度）
 * 客戶資料與案件資料跟「案件管理」共用同一份暫存（casesPageData），追蹤進度都記在客戶身上。
 */
let schCustomers = [];
let schCases = [];

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
  if (mode === 'urgency') return ua - ub || dka - dkb;
  return dka - dkb || ua - ub; // 預設：先依追蹤日（逾期最前面），同一天再依緊急程度
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
  schCustomers = data.customers || [];
  schCases = data.cases || [];
  renderSchedule();
}

async function loadScheduleData() {
  const cached = await getCachedAsync('casesPageData');
  if (cached) applyScheduleData(cached);
  const result = await callApi('getCasesPageData', {}, { silent: !!cached });
  if (!result.success) return alert(result.message);
  setCached('casesPageData', result);
  applyScheduleData(result);
}

function followCell(c) {
  const f = followUpInfo(c.NextFollowUpDate);
  if (!normalizeDateStr(c.NextFollowUpDate)) return '<span style="color:#999;">未設定</span>';
  return `<span style="color:${f.color};${f.note && f.color !== '#333' ? 'font-weight:bold;' : ''}">${f.text}</span>${f.note ? `<br><small style="color:${f.color};">${f.note}</small>` : ''}${followNoteHtml(c.NextFollowUpNote)}`;
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
      return Object.assign({}, c, { Urgency: c.Urgency || cust.Urgency || '中', NextFollowUpDate: cust.NextFollowUpDate || '', _cust: cust });
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
    tr.innerHTML = `<td>${urgencyBadge(c.Urgency)}</td><td>${esc(c.CompanyName)}</td><td>${esc(c.Contact)}</td><td>${esc(c.Phone)}</td><td>${followCell(c)}</td>
      <td class="sch-notes" title="${esc(c.Notes)}">${esc(String(c.Notes || '').slice(0, 80))}</td>
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
    tr.innerHTML = `<td>${urgencyBadge(c.Urgency)}</td><td>${esc(c.CaseID)}</td><td>${esc(c.CustomerName)}</td><td>${esc(c.Status)}</td><td>${followCell(c)}</td>
      <td>${esc(c.Salesperson)}${c.FAE ? '<br><small class="calc-hint">FAE：' + esc(c.FAE) + '</small>' : ''}</td>
      <td>
        <button class="btn-mini" onclick="location.href='cases.html?caseId=${argAttr(c.CaseID)}'">查看案件</button>
        <button class="btn-mini" style="background:#27ae60;" onclick="schDone(decodeURIComponent('${argAttr(c.CustomerName)}'), decodeURIComponent('${argAttr(c.CaseID)}'))">追蹤完畢</button>
        <button class="btn-mini" onclick="schChangeDate(decodeURIComponent('${argAttr(c.CustomerName)}'))">改日</button>
      </td>`;
    tbody2.appendChild(tr);
  });
  document.getElementById('sch-case-empty').style.display = openCases.length ? 'none' : '';
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
    currentDate: cust.NextFollowUpDate,
    currentNote: cust.NextFollowUpNote,
    caseId: caseId || '',
    onDone: () => {
      loadScheduleData();
      loadDailyReport();
    },
  });
}

function schChangeDate(companyName) {
  const cust = schCustomers.find((c) => c.CompanyName === companyName);
  if (!cust) return;
  openFollowUpDialog({
    companyName,
    rowIndex: cust.RowIndex,
    customer: cust,
    currentDate: cust.NextFollowUpDate,
    currentNote: cust.NextFollowUpNote,
    editOnly: true,
    onDone: () => loadScheduleData(),
  });
}

// ④ 今日已完成的工作（工作日報）：這天的客戶聯繫紀錄，整理成可以直接複製貼到日報的文字
let repLogs = [];

async function loadDailyReport() {
  const date = document.getElementById('rep-date').value || localTodayStr();
  const r = await callApi('getContactLogs', { date }, { silent: true });
  if (!r.success) {
    document.getElementById('rep-text').value = r.message || '讀取失敗';
    return;
  }
  repLogs = r.logs || [];
  renderDailyReport();
}

function renderDailyReport() {
  const date = document.getElementById('rep-date').value || localTodayStr();
  const mineOnly = document.getElementById('rep-mine').checked;
  const me = typeof currentUsername !== 'undefined' ? currentUsername : '';
  const logs = repLogs
    .filter((l) => !mineOnly || !l.Salesperson || l.Salesperson === me)
    .slice()
    .sort((a, b) => a.RowIndex - b.RowIndex); // 試算表由上到下＝記錄的先後順序
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
    if (cust && normalizeDateStr(cust.NextFollowUpDate)) lines.push(`   下次追蹤：${normalizeDateStr(cust.NextFollowUpDate)}${cust.NextFollowUpNote ? '　' + String(cust.NextFollowUpNote).replace(/\n+/g, ' ') : ''}`);
  });
  document.getElementById('rep-text').value = lines.join('\n');
  document.getElementById('rep-count').textContent = `共 ${logs.length} 筆`;
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

// ① Google 日曆行程（客戶追蹤日也會被加進日曆，這裡略過那些，因為下面清單已經列出）
async function loadScheduleEvents() {
  const days = document.getElementById('sch-days').value;
  const box = document.getElementById('sch-events');
  box.innerHTML = '<span class="calc-hint">讀取中...</span>';
  const result = await callApi('getCalendarEvents', { days: Number(days) }, { silent: true });
  if (!result.success) {
    box.innerHTML = `<span class="calc-hint">${esc(result.message)}</span>`;
    return;
  }
  const events = result.events.filter((e) => String(e.Title).indexOf('[AOI客戶追蹤]') !== 0);
  const skipped = result.events.length - events.length;
  if (!events.length) {
    box.innerHTML = `<span class="calc-hint">這段期間沒有其他行程。${skipped ? '（客戶追蹤提醒 ' + skipped + ' 筆已列在下面的清單）' : ''}</span>`;
    return;
  }
  box.innerHTML = events
    .map((ev) => {
      const time = ev.AllDay ? `${ev.Start}（全天）` : ev.Start.replace('T', ' ');
      return `<div class="event-row"><span class="event-time">${esc(time)}</span><span style="flex:1">${esc(ev.Title)}${ev.Location ? ' <span class="calc-hint">@' + esc(ev.Location) + '</span>' : ''}</span></div>`;
    })
    .join('');
  if (skipped) box.innerHTML += `<div class="calc-hint">（客戶追蹤提醒 ${skipped} 筆已列在下面的清單）</div>`;
}

window.addEventListener('DOMContentLoaded', async () => {
  if (!(await ensureAuth())) return;
  renderHeaderUser();
  applyAdminOnlyVisibility();
  document.getElementById('rep-date').value = localTodayStr();
  document.getElementById('rep-date').addEventListener('change', loadDailyReport);
  document.getElementById('rep-mine').addEventListener('change', renderDailyReport);
  ['sch-urgency', 'sch-range', 'sch-sort'].forEach((id) => document.getElementById(id).addEventListener('change', renderSchedule));
  document.getElementById('sch-keyword').addEventListener('input', renderSchedule);
  document.getElementById('sch-days').addEventListener('change', loadScheduleEvents);
  loadScheduleEvents();
  loadScheduleData();
  loadDailyReport();
});

// 導覽列「↻ 重撈資料」
window.refreshPageData = () => Promise.all([loadScheduleData(), loadScheduleEvents(), loadDailyReport()]);
