/**
 * namecards.js - 名片客戶專區
 * LINE 傳來、辨識完的名片（BotCards 收件匣）的網頁版：一次看完整欄位 → 編輯修正 →
 * 登入成客戶 / 建立案件 / 新增聯繫行事曆 / 刪除。
 */

let allCards = [];
let editingId = 0;
let calCard = null;

const FIELDS = [
  ['name', '姓名'],
  ['title', '職稱'],
  ['company', '公司'],
  ['phone', '手機'],
  ['companyPhone', '公司電話'],
  ['fax', '傳真'],
  ['email', 'Email'],
  ['address', '地址'],
  ['taxId', '統編'],
  ['website', '網站'],
  ['note', '備註'],
];

function readOnlyCards() {
  return typeof canWrite === 'function' && !canWrite('customers');
}

async function loadCards() {
  const r = await callApi('getNameCards', {}, { silent: true });
  if (!r || !r.success) {
    document.getElementById('nc-empty').style.display = '';
    document.getElementById('nc-empty').textContent = (r && r.message) || '讀取失敗，請稍後再試';
    return;
  }
  allCards = r.cards;
  renderCards();
}

function cardById(id) {
  return allCards.find((c) => c.id === id);
}

function renderCards() {
  const filter = document.getElementById('nc-filter').value;
  const kw = document.getElementById('nc-search').value.trim().toLowerCase();
  const list = allCards.filter((c) => {
    if (filter !== 'all' && c.status !== filter) return false;
    if (!kw) return true;
    return FIELDS.concat([['batch'], ['result']]).some(([k]) => String(c[k] || '').toLowerCase().includes(kw));
  });
  const pending = allCards.filter((c) => c.status === 'pending').length;
  document.getElementById('nc-count').textContent = `待登入 ${pending} 張・已登入 ${allCards.length - pending} 張・目前顯示 ${list.length} 張`;
  const empty = document.getElementById('nc-empty');
  empty.style.display = list.length ? 'none' : '';
  empty.textContent = allCards.length ? '沒有符合的名片。' : '還沒有名片。用 LINE 把名片照片傳給員工助理，辨識完就會出現在這裡。';
  const ro = readOnlyCards();
  document.getElementById('nc-body').innerHTML = list
    .map((c) => {
      const e = htmlEsc;
      const done = c.status === 'saved';
      const warn = !c.company ? '<div class="nc-warn">缺公司名稱</div>' : '';
      const conf = c.confidence === 'low' || c.confidence === 'medium' ? `<div class="nc-warn">辨識${c.confidence === 'low' ? '很不確定' : '部分模糊'}，請核對</div>` : '';
      const status = done
        ? `<span class="nc-badge ok" title="${e(c.result)}">已登入</span>`
        : `<span class="nc-badge">待登入</span>${c.existingCustomer ? `<div class="nc-hint">${e(c.existingCustomer)} 已是客戶 → 新增聯絡窗口</div>` : ''}`;
      const dis = ro ? 'disabled' : '';
      return `<tr data-id="${c.id}">
        <td>${status}${warn}${conf}</td>
        <td><b>${e(c.name)}</b></td><td>${e(c.title)}</td><td>${e(c.company)}</td>
        <td>${e(c.phone)}</td><td>${e(c.companyPhone)}</td><td>${e(c.fax)}</td><td>${e(c.email)}</td>
        <td>${e(c.address)}</td><td>${e(c.taxId)}</td><td>${e(c.website)}</td><td class="nc-note">${e(c.note)}</td>
        <td class="nc-small">${e(c.batch)}<div>${e(String(c.time || '').slice(0, 16))}</div></td>
        <td class="nc-act">
          <button type="button" class="btn-mini" ${dis} onclick="openEdit(${c.id})">編輯</button>
          ${done ? '' : `<button type="button" class="btn-mini nc-primary" ${dis} onclick="toCustomer(${c.id})">登入成客戶</button>`}
          <button type="button" class="btn-mini" ${dis} onclick="toCase(${c.id})">建立案件</button>
          <button type="button" class="btn-mini" onclick="openCalendar(${c.id})">新增聯繫行事曆</button>
          <button type="button" class="btn-mini nc-danger" ${dis} onclick="removeCard(${c.id})">刪除</button>
        </td>
      </tr>`;
    })
    .join('');
}

function closeModal(id) {
  document.getElementById(id).style.display = 'none';
}

function afterCustomerChange() {
  clearCached('customers');
  clearCached('casesPageData');
}

// ---------------- 編輯 ----------------
function openEdit(id) {
  const c = cardById(id);
  if (!c) return;
  editingId = id;
  document.getElementById('nce-id').textContent = '#' + id;
  FIELDS.forEach(([k]) => (document.getElementById('nce-' + k).value = c[k] || ''));
  document.getElementById('nc-edit-modal').style.display = 'flex';
}

async function saveEdit() {
  const fields = {};
  FIELDS.forEach(([k]) => (fields[k] = document.getElementById('nce-' + k).value.trim()));
  const r = await callApi('cardUpdate', { id: editingId, fields });
  if (!r.success) return alert(r.message);
  closeModal('nc-edit-modal');
  await loadCards();
}

// ---------------- 登入成客戶 ----------------
/** 這張名片登入時會做什麼，給確認視窗用 */
function describeRegister(c) {
  const who = c.name || '（無姓名）';
  if (c.existingCustomer) return `「${c.existingCustomer}」已經是客戶，會把「${who}」新增為聯絡窗口。`;
  return `「${c.company}」還不是客戶，會新增這間客戶（聯絡人：${who}）。`;
}

/** 登入成客戶；成功回傳 { company, kind }，取消或失敗回傳 null。needConfirm=false 時不再問一次。 */
async function registerCard(c, confirmText) {
  let company = '';
  if (!c.company) {
    company = (prompt('這張名片沒有公司名稱，請輸入公司名稱（要寫全名）：') || '').trim();
    if (!company) return null;
    c = Object.assign({}, c, { company, existingCustomer: '' });
  }
  if (!confirm(confirmText ? confirmText + '\n\n' + describeRegister(c) : describeRegister(c) + '\n\n確定登入嗎？')) return null;
  // 新客戶：開發名單（含隱藏名單）裡有這家 → 問要不要從名單轉成客戶
  let conv = {};
  if (!c.existingCustomer) {
    conv = await askProspectConvert(c.company, c.taxId);
    if (conv === null) return null;
  }
  const r = await callApi('cardToCustomer', { id: c.id, company, fromProspect: conv.fromProspect || null });
  if (!r.success) {
    alert(r.message);
    return null;
  }
  afterCustomerChange();
  return r;
}

async function toCustomer(id) {
  const c = cardById(id);
  if (!c) return;
  // 公司還不是客戶：先問要登入成一般客戶，還是放進開發名單（陌生開發）
  if (!c.existingCustomer) {
    const where = await chooseOption('這張名片要登入到哪裡？', `${c.company || '（名片上沒有公司名稱）'}${c.name ? '｜' + c.name : ''}${c.title ? ' ' + c.title : ''}`, [
      { value: 'customer', label: '👔 一般客戶', desc: '新增到客戶管理（已經在往來、或確定要當客戶經營的）', primary: true },
      { value: 'prospect', label: '🧭 陌生開發名單', desc: '放進開發名單庫，來源標「名片」，負責業務是你；之後聯繫有進展再轉客戶' },
    ]);
    if (!where) return;
    if (where === 'prospect') return toProspect(c);
  }
  const r = await registerCard(c);
  if (!r) return;
  alert(r.kind === 'addContact' ? `已新增為「${r.company}」的聯絡窗口` : `已新增客戶「${r.company}」`);
  await loadCards();
}

/** 名片放進開發名單（陌生開發）。公司在隱藏名單裡會先問要不要恢復。 */
async function toProspect(c) {
  let company = '';
  if (!c.company) {
    company = (prompt('這張名片沒有公司名稱，請輸入公司名稱（要寫全名）：') || '').trim();
    if (!company) return;
  }
  let r = await callApi('cardToProspect', { id: c.id, company });
  if (r && !r.success && r.hidden) {
    if (!confirm(`${r.message}。\n\n要把它從隱藏名單恢復，並把這張名片的資料加進去嗎？`)) return;
    r = await callApi('cardToProspect', { id: c.id, company, unhide: true });
  }
  if (!r || !r.success) return alert((r && r.message) || '加入開發名單失敗');
  alert(`${r.added ? '已加入開發名單' : '已併入開發名單裡原本的'}「${r.company}」（來源：${r.source}，標示為陌生開發）`);
  await loadCards();
}

// ---------------- 建立案件 ----------------
async function toCase(id) {
  const c = cardById(id);
  if (!c) return;
  let company = c.existingCustomer || c.company;
  if (c.status !== 'saved') {
    const r = await registerCard(c, '建立案件前，要先把這張名片登入成客戶：');
    if (!r) return;
    company = r.company;
  }
  if (!company) return alert('這張名片沒有公司名稱，沒辦法建立案件');
  location.href = `cases.html?newCaseFor=${encodeURIComponent(company)}`;
}

// ---------------- 刪除 ----------------
async function removeCard(id) {
  const c = cardById(id);
  if (!c) return;
  const label = [c.name, c.company].filter(Boolean).join('｜') || '#' + id;
  if (!confirm(`確定刪除這張名片嗎？\n${label}\n\n${c.status === 'saved' ? '（已經登入的客戶資料不會被刪掉）' : '刪除後無法復原，也不會登入成客戶。'}`)) return;
  const r = await callApi('cardDelete', { id });
  if (!r.success) return alert(r.message);
  await loadCards();
}

// ---------------- 新增聯繫行事曆 ----------------
function dateAfter(n) {
  const d = new Date(Date.now() + n * 86400000);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function openCalendar(id) {
  const c = cardById(id);
  if (!c) return;
  calCard = c;
  const set = (k, v) => (document.getElementById(k).value = v);
  set('ncc-title', `聯繫 ${c.name || '客戶'}${c.company ? '（' + c.company + '）' : ''}`);
  set('ncc-date', dateAfter(1));
  set('ncc-time', '');
  set(
    'ncc-notes',
    [c.title ? '職稱：' + c.title : '', c.phone ? '手機：' + c.phone : '', c.companyPhone ? '公司電話：' + c.companyPhone : '', c.email ? 'Email：' + c.email : '', c.batch ? '名片註記：' + c.batch : '']
      .filter(Boolean)
      .join('\n')
  );
  const quick = document.getElementById('ncc-quick');
  quick.innerHTML = '';
  [['明天', 1], ['3 天後', 3], ['1 週後', 7], ['2 週後', 14]].forEach(([label, n]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn-mini';
    b.textContent = label;
    b.onclick = () => set('ncc-date', dateAfter(n));
    quick.appendChild(b);
  });
  document.getElementById('nc-cal-modal').style.display = 'flex';
}

async function saveCalendar() {
  const title = document.getElementById('ncc-title').value.trim();
  const startDate = document.getElementById('ncc-date').value;
  const startTime = document.getElementById('ncc-time').value;
  if (!title) return alert('請輸入標題');
  if (!startDate) return alert('請選日期');
  const r = await callApi('calSaveEvent', { title, startDate, startTime, allDay: !startTime, notes: document.getElementById('ncc-notes').value, shareMode: 'self' });
  if (!r.success) return alert(r.message);
  closeModal('nc-cal-modal');
  alert(`已加入行事曆：${startDate}${startTime ? ' ' + startTime : '（全天）'} ${title}`);
}

window.refreshPageData = loadCards;

window.addEventListener('DOMContentLoaded', async () => {
  if (!(await ensureAuth())) return;
  renderHeaderUser();
  applyAdminOnlyVisibility();
  await loadCards();
});
