/**
 * prospects.js - 開發名單庫頁面
 * 依賴 prospects-lib.js（讀檔 / 欄位對應 / CSV）與 common.js（callApi、htmlEsc）。
 * 篩選、分頁、統計都在伺服器做（十萬筆不能全部載到瀏覽器）；這裡只負責畫面與操作。
 */

const IMPORT_CHUNK = 2000;
const state = { q: '', sources: new Set(), cities: new Set(), cats: new Set(), stages: new Set(), has: new Set(), assigned: '', site: '', follow: '', page: 1, size: 30 };
let data = null; // 最近一次查詢結果
let selected = new Set(); // 勾選的 Key
let selectAllMatching = false; // 是否已選「符合條件的全部」
let reqSeq = 0;
let searchTimer = null;
let industry = {};
let stages = ['未處理', '開發中', '已聯絡', '有興趣', '無意願', '已轉客戶', '無效'];
let editRow = null;
const e = (v) => htmlEsc(v);

function readOnly() {
  return typeof canWrite === 'function' && !canWrite('customers');
}

// ---------- 查詢 ----------
function filterBody() {
  return {
    q: state.q,
    sources: [...state.sources],
    cities: [...state.cities],
    cats: [...state.cats],
    stages: [...state.stages],
    has: [...state.has].join(''),
    assigned: state.assigned,
    site: state.site,
    follow: state.follow,
  };
}

async function load(page) {
  if (page) state.page = page;
  const seq = ++reqSeq;
  const status = document.getElementById('ps-stats');
  if (!data) status.textContent = '讀取中…（名單很多時第一次需要幾秒）';
  else status.classList.add('ps-loading');
  const r = await callApi('prospectQuery', Object.assign(filterBody(), { page: state.page, size: state.size }), { silent: true });
  if (seq !== reqSeq) return; // 已經有更新的查詢，丟掉這個舊結果
  status.classList.remove('ps-loading');
  if (!r || !r.success) {
    status.textContent = (r && r.message) || '讀取失敗，請稍後再試';
    return;
  }
  data = r;
  industry = r.industry || industry;
  stages = r.stages || stages;
  state.page = r.page;
  render();
}

function render() {
  const empty = !data.ready || data.all === 0;
  document.getElementById('ps-empty').style.display = empty ? '' : 'none';
  document.getElementById('ps-layout').style.display = empty ? 'none' : '';
  renderStats();
  document.getElementById('ps-export-btn').style.display = empty ? 'none' : '';
  if (empty) return;
  renderFilters();
  renderChips();
  renderRows();
  renderPager();
  renderBulk();
}

function renderStats() {
  const st = window.__psStatus;
  const stageN = (s) => ((data.facets && data.facets.stage) || []).filter((x) => x.v === s).reduce((n, x) => n + x.n, 0);
  const cards = [
    ['名單庫', data.all.toLocaleString(), '家公司'],
    ['符合目前條件', (data.total || 0).toLocaleString(), '家'],
    ['開發中 / 已聯絡', (stageN('開發中') + stageN('已聯絡') + stageN('有興趣')).toLocaleString(), '家（目前條件內）'],
  ];
  const last = st && st.last && st.last.time ? `<div class="ps-kpi ps-kpi-wide"><span>最後匯入</span><b class="ps-kpi-sm">${e(st.last.time)}</b><small title="${e(st.last.source || '')}">${e(shortSource(st.last.source || ''))}</small></div>` : '';
  document.getElementById('ps-stats').innerHTML = cards.map((c) => `<div class="ps-kpi"><span>${c[0]}</span><b>${c[1]}</b><small>${c[2]}</small></div>`).join('') + last;
}

/** 來源名稱太長（例如用檔名當來源）時，只顯示重點：拿掉「開發名單_」前綴與結尾的日期。 */
function shortSource(s) {
  return String(s || '').replace(/^開發名單[_＿]/, '').replace(/[_＿]?\d{8}(?:[_＿].*)?$/, '').replace(/\.csv$/i, '') || String(s || '');
}

async function loadStatus() {
  const r = await callApi('prospectStatus', {}, { silent: true });
  if (r && r.success) {
    window.__psStatus = r;
    const a = document.getElementById('ps-sheet-link');
    if (r.url) {
      a.href = r.url;
      a.style.display = '';
    }
    if (data) renderStats();
  }
}

// ---------- 篩選面板 ----------
function facetBlock(title, key, list, setRef, labelOf, opts) {
  opts = opts || {};
  const items = list.slice();
  // 已勾選、但現在統計是 0 的項目也要列出來，才能取消勾選
  setRef.forEach((v) => {
    if (!items.some((x) => x.v === v)) items.push({ v, n: 0 });
  });
  const shown = opts.limit && !opts.expanded ? items.slice(0, opts.limit) : items;
  const rows = shown
    .map(
      (x) =>
        `<label class="ps-opt${x.n === 0 ? ' ps-zero' : ''}"><input type="checkbox" data-facet="${key}" value="${e(x.v)}" ${setRef.has(x.v) ? 'checked' : ''}/> <span class="ps-opt-name" title="${e(labelOf(x.v))}">${e(labelOf(x.v))}</span><span class="ps-n">${x.n.toLocaleString()}</span></label>`
    )
    .join('');
  const more = opts.limit && items.length > opts.limit ? `<button type="button" class="ps-more" data-more="${key}">${opts.expanded ? '收合' : `顯示全部 ${items.length} 項`}</button>` : '';
  return `<details class="ps-facet" open><summary>${title}${setRef.size ? ` <span class="ps-sel">${setRef.size}</span>` : ''}</summary>${opts.pre || ''}<div class="ps-opts">${rows || '<div class="calc-hint">沒有資料</div>'}</div>${more}</details>`;
}

const expandedFacets = new Set();

function renderFilters() {
  const f = data.facets;
  const catLabel = (c) => `${c}｜${industry[c] || c}`.replace(/^(.+)｜\1$/, '$1');
  const groups = PS_GROUPS.map((g, i) => `<button type="button" class="btn-mini ps-group" data-group="${i}">${e(g.label)}</button>`).join('');
  const hasList = [
    { v: 'P', n: (f.has.find((x) => x.v === 'P') || {}).n || 0 },
    { v: 'E', n: (f.has.find((x) => x.v === 'E') || {}).n || 0 },
    { v: 'W', n: (f.has.find((x) => x.v === 'W') || {}).n || 0 },
  ];
  const hasLabel = { P: '有電話', E: '有 Email', W: '有網站' };
  document.getElementById('ps-filters').innerHTML =
    facetBlock('產業分類', 'cat', f.cat, state.cats, catLabel, { pre: `<div class="ps-groups"><span class="calc-hint">快速選取：</span>${groups}</div>`, limit: 12, expanded: expandedFacets.has('cat') }) +
    facetBlock('來源', 'source', f.source, state.sources, (v) => v) +
    facetBlock('縣市', 'city', f.city, state.cities, (v) => v, { limit: 10, expanded: expandedFacets.has('city') }) +
    facetBlock('開發狀態', 'stage', f.stage, state.stages, (v) => v) +
    facetBlock('聯絡方式', 'has', hasList, state.has, (v) => hasLabel[v]);
}

document.addEventListener('change', (ev) => {
  const t = ev.target;
  if (!t || !t.dataset || !t.dataset.facet) return;
  const set = { cat: state.cats, source: state.sources, city: state.cities, stage: state.stages, has: state.has }[t.dataset.facet];
  if (!set) return;
  if (t.checked) set.add(t.value);
  else set.delete(t.value);
  filtersChanged();
});

document.addEventListener('click', (ev) => {
  const t = ev.target;
  if (!t || !t.dataset) return;
  if (t.dataset.more) {
    if (expandedFacets.has(t.dataset.more)) expandedFacets.delete(t.dataset.more);
    else expandedFacets.add(t.dataset.more);
    renderFilters();
  } else if (t.dataset.group !== undefined) {
    const codes = PS_GROUPS[Number(t.dataset.group)].codes;
    const allOn = codes.every((c) => state.cats.has(c));
    codes.forEach((c) => (allOn ? state.cats.delete(c) : state.cats.add(c)));
    filtersChanged();
  } else if (t.dataset.chip) {
    const [k, v] = JSON.parse(t.dataset.chip);
    if (k === 'q') {
      state.q = '';
      document.getElementById('ps-q').value = '';
    } else if (k === 'follow') {
      state.follow = '';
      document.getElementById('ps-follow').value = '';
    } else if (k === 'site') {
      state.site = '';
      document.getElementById('ps-site').value = '';
    } else if (k === 'assigned') {
      state.assigned = '';
      document.getElementById('ps-assigned').value = '';
    } else ({ cat: state.cats, source: state.sources, city: state.cities, stage: state.stages, has: state.has }[k] || new Set()).delete(v);
    filtersChanged();
  }
});

function filtersChanged() {
  state.page = 1;
  clearSelection();
  load();
}

function onSearchInput() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.q = document.getElementById('ps-q').value.trim();
    filtersChanged();
  }, 450);
}

function onAssignedChange() {
  state.assigned = document.getElementById('ps-assigned').value;
  filtersChanged();
}

function onFollowChange() {
  state.follow = document.getElementById('ps-follow').value;
  filtersChanged();
}

/** 一鍵：我負責、今天以前要聯繫的（依追蹤日排序，最早的在前）。 */
function showMyDue() {
  ['sources', 'cities', 'cats', 'stages', 'has'].forEach((k) => state[k].clear());
  state.q = '';
  state.site = '';
  state.assigned = 'me';
  state.follow = 'due';
  document.getElementById('ps-q').value = '';
  document.getElementById('ps-site').value = '';
  document.getElementById('ps-assigned').value = 'me';
  document.getElementById('ps-follow').value = 'due';
  filtersChanged();
}

function onSiteChange() {
  state.site = document.getElementById('ps-site').value;
  filtersChanged();
}

function onSizeChange() {
  state.size = Number(document.getElementById('ps-size').value) || 30;
  filtersChanged();
}

function resetFilters() {
  ['sources', 'cities', 'cats', 'stages', 'has'].forEach((k) => state[k].clear());
  state.q = '';
  state.assigned = '';
  state.site = '';
  state.follow = '';
  document.getElementById('ps-follow').value = '';
  document.getElementById('ps-q').value = '';
  document.getElementById('ps-assigned').value = '';
  document.getElementById('ps-site').value = '';
  filtersChanged();
}

function renderChips() {
  const chips = [];
  const catName = (c) => industry[c] || c;
  if (state.q) chips.push(['q', state.q, `關鍵字：${state.q}`]);
  state.cats.forEach((v) => chips.push(['cat', v, `產業：${catName(v)}`]));
  state.sources.forEach((v) => chips.push(['source', v, `來源：${v}`]));
  state.cities.forEach((v) => chips.push(['city', v, v]));
  state.stages.forEach((v) => chips.push(['stage', v, `狀態：${v}`]));
  const hasLabel = { P: '有電話', E: '有 Email', W: '有網站' };
  state.has.forEach((v) => chips.push(['has', v, hasLabel[v]]));
  if (state.assigned) chips.push(['assigned', state.assigned, state.assigned === 'me' ? '我負責的' : '尚未指派']);
  if (state.site) chips.push(['site', state.site, state.site === 'checked' ? '官網已查過' : '官網還沒查']);
  if (state.follow) chips.push(['follow', state.follow, { due: '今天以前要聯繫', planned: '已排定追蹤', none: '還沒排追蹤日' }[state.follow]]);
  document.getElementById('ps-chips').innerHTML = chips.map((c) => `<span class="ps-chip">${e(c[2])} <button type="button" data-chip="${e(JSON.stringify([c[0], c[1]]))}" title="移除這個條件">×</button></span>`).join('');
}

// ---------- 表格 ----------
function contactHtml(r) {
  const out = [];
  if (r.Contact) out.push(`<div>👤 ${e(r.Contact)}</div>`);
  if (r.Phone) out.push(`<div>📞 <a href="tel:${e(String(r.Phone).replace(/[^\d+]/g, ''))}">${e(r.Phone)}</a></div>`);
  if (r.Email) out.push(`<div>✉️ <a href="mailto:${e(r.Email)}">${e(r.Email)}</a></div>`);
  const url = psSafeUrl(r.Website);
  if (url) out.push(`<div>🌐 <a href="${e(url)}" target="_blank" rel="noopener noreferrer">${e(String(r.Website).replace(/^https?:\/\//i, '').slice(0, 32))}</a></div>`);
  else if (r.Website) out.push(`<div>🌐 ${e(r.Website)}</div>`);
  if (r.ExtraContacts) out.push(`<div class="calc-hint" title="${e(r.ExtraContacts)}">＋ ${e(r.ExtraContacts.slice(0, 40))}</div>`);
  if (r.Enriched && r.Enriched !== 'ok') out.push(`<div class="calc-hint" title="${e(r.EnrichNote || '')}">🔎 ${e(ENRICH_LABEL[r.Enriched] || r.Enriched)}</div>`);
  return out.join('') || '<span class="calc-hint">—</span>';
}

const ENRICH_LABEL = { ok: '找到聯絡方式', nocontact: '有官網、沒找到聯絡方式', nosite: '找不到官網', blocked: '網站不允許自動讀取', error: '查詢失敗' };

function catHtml(r) {
  const names = psCatNames(r.CatCodes, industry);
  if (!names.length) return '<span class="calc-hint">—</span>';
  const full = names.join('、');
  return `<div title="${e(full)}">${names.slice(0, 3).map((n) => `<span class="ps-tag">${e(n.replace(/製造業$/, ''))}</span>`).join('')}${names.length > 3 ? `<span class="ps-tag ps-tag-more">+${names.length - 3}</span>` : ''}</div>`;
}

function renderRows() {
  const ro = readOnly();
  const body = document.getElementById('ps-body');
  const none = document.getElementById('ps-none');
  none.style.display = data.rows.length ? 'none' : '';
  none.textContent = '沒有符合條件的名單。試著放寬篩選條件，或按「清除全部條件」。';
  body.innerHTML = data.rows
    .map((r, i) => {
      const stageOpts = stages.map((s) => `<option value="${e(s)}" ${s === r.Stage ? 'selected' : ''}>${e(s)}</option>`).join('');
      const warn = r.Status && r.Status !== '生產中' ? `<span class="nc-badge" title="工廠登記狀態">${e(r.Status)}</span>` : '';
      const src = (r.Source || '').split('、').join('、');
      return `<tr data-i="${i}" class="${r.Optout ? 'ps-optout' : ''}">
        <td><input type="checkbox" data-key="${e(r.Key)}" ${selected.has(r.Key) || selectAllMatching ? 'checked' : ''} ${selectAllMatching ? 'disabled' : ''} /></td>
        <td class="ps-name"><div><b>${e(r.Name)}</b> ${warn}${r.IsCustomer ? ` <span class="ps-iscust" title="客戶管理裡已有：${e(r.IsCustomer)}">已是客戶</span>` : ''}</div><div class="calc-hint">${r.TaxId ? '統編 ' + e(r.TaxId) : ''}${r.Org ? '　' + e(r.Org) : ''}</div><div class="ps-src" title="來源：${e(src)}">📂 ${e(src.split('、').map(shortSource).join('、'))}</div></td>
        <td class="ps-cat">${catHtml(r)}<div class="ps-prod" title="${e(r.Products || '')}">${e((r.Products || '').slice(0, 70))}</div></td>
        <td class="ps-addr"><div><b>${e(r.City || '')}</b> <span class="calc-hint">${e(r.Address || '').replace(e(r.City || ''), '')}</span></div>${r.Owner ? `<div class="calc-hint">負責人 ${e(r.Owner)}</div>` : ''}</td>
        <td class="ps-contact">${contactHtml(r)}</td>
        <td class="ps-stage-cell"><select class="ps-stage" data-stage="${e(r.Stage)}" data-i="${i}" ${ro ? 'disabled' : ''}>${stageOpts}</select>${r.Optout ? '<div><span class="nc-badge">拒絕聯絡</span></div>' : ''}${followHtml(r)}${r.AssignedTo ? `<div class="ps-meta">👤 ${e(r.AssignedTo)}</div>` : ''}</td>
        <td class="nc-act"><button type="button" class="btn-mini" onclick="openEdit(${i})">${ro ? '查看紀錄' : '📞 聯繫 / 紀錄'}</button></td>
      </tr>`;
    })
    .join('');
  // 這一頁都沒有地址 / 負責人（例如展覽名單）就把那欄收起來
  document.querySelector('.ps-table').classList.toggle('ps-noaddr', !data.rows.some((r) => r.Address || r.Owner || r.City));
  const all = data.rows.length > 0 && data.rows.every((r) => selected.has(r.Key));
  const pageCheck = document.getElementById('ps-check-page');
  pageCheck.checked = selectAllMatching || all;
  pageCheck.disabled = selectAllMatching;
}

document.addEventListener('change', (ev) => {
  const t = ev.target;
  if (!t) return;
  if (t.dataset && t.dataset.key !== undefined) {
    if (t.checked) selected.add(t.dataset.key);
    else selected.delete(t.dataset.key);
    renderBulk();
    const pageCheck = document.getElementById('ps-check-page');
    pageCheck.checked = data.rows.length > 0 && data.rows.every((r) => selected.has(r.Key));
  } else if (t.classList && t.classList.contains('ps-stage')) {
    changeStage(Number(t.dataset.i), t.value, t);
  }
});

function togglePage(on) {
  data.rows.forEach((r) => (on ? selected.add(r.Key) : selected.delete(r.Key)));
  renderRows();
  renderBulk();
}

function clearSelection() {
  selected = new Set();
  selectAllMatching = false;
}

async function changeStage(i, value, selectEl) {
  const r = data.rows[i];
  const res = await callApi('prospectUpdate', { key: r.Key, row: r.RowIndex, fields: { Stage: value } }, { silent: true });
  if (!res || !res.success) {
    alert((res && res.message) || '儲存失敗');
    selectEl.value = r.Stage;
    return;
  }
  data.rows[i] = res.row;
  load(); // 左邊的統計數字跟著更新
}

// ---------- 分頁 ----------
function renderPager() {
  const el = document.getElementById('ps-pager');
  if (data.pages <= 1) {
    el.innerHTML = data.total ? `<span class="calc-hint">共 ${data.total.toLocaleString()} 筆</span>` : '';
    return;
  }
  const p = data.page;
  const btn = (label, page, dis) => `<button type="button" class="btn-mini" ${dis ? 'disabled' : `onclick="load(${page})"`}>${label}</button>`;
  el.innerHTML = `${btn('« 第一頁', 1, p === 1)} ${btn('‹ 上一頁', p - 1, p === 1)} <span>第 <input id="ps-goto" type="number" min="1" max="${data.pages}" value="${p}" onchange="load(Number(this.value))" style="width:80px;display:inline-block;margin:0 4px;" /> / ${data.pages.toLocaleString()} 頁（共 ${data.total.toLocaleString()} 筆）</span> ${btn('下一頁 ›', p + 1, p === data.pages)} ${btn('最後一頁 »', data.pages, p === data.pages)}`;
}

// ---------- 批次操作 ----------
function renderBulk() {
  const el = document.getElementById('ps-bulk');
  const n = selectAllMatching ? data.total : selected.size;
  if (!n || readOnly()) {
    el.style.display = 'none';
    return;
  }
  const canAll = !selectAllMatching && data.total > data.rows.length && data.rows.length > 0 && data.rows.every((r) => selected.has(r.Key));
  el.style.display = '';
  el.innerHTML = `<span>已選 <b>${n.toLocaleString()}</b> 筆${selectAllMatching ? '（符合目前條件的全部）' : ''}</span>
    ${canAll ? `<button type="button" class="btn-mini" onclick="pickAllMatching()">改選符合條件的全部 ${data.total.toLocaleString()} 筆</button>` : ''}
    <select id="ps-bulk-stage"><option value="">設定開發狀態…</option>${stages.map((s) => `<option value="${e(s)}">${e(s)}</option>`).join('')}</select>
    <button type="button" class="btn-mini" onclick="applyBulk('stage')">套用狀態</button>
    <button type="button" class="btn-mini" onclick="applyBulk('me')">指派給我</button>
    <button type="button" class="btn-mini" onclick="applyBulk('unassign')">取消指派</button>
    <button type="button" class="btn-mini ps-danger" onclick="applyBulk('optout')">標記拒絕聯絡</button>
    <button type="button" class="btn-mini" onclick="clearSelection();renderRows();renderBulk();">取消勾選</button>`;
}

function pickAllMatching() {
  selectAllMatching = true;
  renderRows();
  renderBulk();
}

async function applyBulk(kind) {
  const set = {};
  let what = '';
  if (kind === 'stage') {
    const v = document.getElementById('ps-bulk-stage').value;
    if (!v) return alert('請先選要設定的開發狀態');
    set.Stage = v;
    what = `開發狀態設為「${v}」`;
  } else if (kind === 'me') {
    set.AssignedTo = '@me'; // 伺服器換成登入帳號
    what = '指派給你';
  } else if (kind === 'unassign') {
    set.AssignedTo = '';
    what = '取消指派';
  } else {
    set.Optout = true;
    what = '標記為「拒絕聯絡」';
  }
  const n = selectAllMatching ? data.total : selected.size;
  if (!selectAllMatching && selected.size > 3000) return alert('一次最多勾選 3,000 筆；要處理更多請用「改選符合條件的全部」');
  if (!confirm(`確定要把 ${n.toLocaleString()} 筆名單${what}嗎？`)) return;
  const body = selectAllMatching ? { filter: filterBody(), set } : { keys: [...selected], set };
  const r = await callApi('prospectBulk', body);
  if (!r || !r.success) return alert((r && r.message) || '批次修改失敗');
  clearSelection();
  await load();
  alert(`完成：已更新 ${r.count.toLocaleString()} 筆`);
}

// ---------- 匯出 ----------
async function exportResult() {
  if (!data || !data.total) return alert('目前沒有符合條件的名單可以匯出');
  const r = await callApi('prospectExport', filterBody());
  if (!r || !r.success) return alert((r && r.message) || '匯出失敗');
  const csv = '﻿' + psRowsToCsv(r.rows, industry);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const d = new Date();
  a.download = `開發名單_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
  if (r.truncated) alert(`符合的有 ${r.total.toLocaleString()} 筆，一次最多匯出 ${r.exported.toLocaleString()} 筆。請再加上篩選條件（例如縣市、產業）分批匯出。`);
}

// ---------- 編輯 ----------
function openEdit(i) {
  const r = data.rows[i];
  editRow = r;
  const ro = readOnly();
  document.getElementById('pse-title').innerHTML = e(r.Name) + (r.IsCustomer ? ` <span class="ps-iscust">已是客戶：${e(r.IsCustomer)}</span>` : ' <span class="ps-cold">陌生開發</span>');
  document.getElementById('pse-sub').textContent = [r.TaxId ? '統編 ' + r.TaxId : '', r.City, r.Source].filter(Boolean).join('｜');
  document.getElementById('pse-stage').innerHTML = stages.map((s) => `<option value="${e(s)}" ${s === r.Stage ? 'selected' : ''}>${e(s)}</option>`).join('');
  const set = (id, v) => (document.getElementById(id).value = v || '');
  set('pse-assigned', r.AssignedTo);
  set('pse-contact', r.Contact);
  set('pse-phone', r.Phone);
  set('pse-email', r.Email);
  set('pse-website', r.Website);
  set('pse-notes', r.Notes);
  document.getElementById('pse-optout').checked = !!r.Optout;
  document.getElementById('pse-next').value = r.NextFollowUp || '';
  openLogPanel(r);
  document.getElementById('pse-enrich').innerHTML = (r.ExtraContacts ? `其他聯絡方式：${e(r.ExtraContacts)}<br>` : '') + (r.Enriched ? `官網查詢（${e(r.EnrichedAt || '')}）：${e(ENRICH_LABEL[r.Enriched] || r.Enriched)}　${e(r.EnrichNote || '')}` : '');
  document.getElementById('pse-msg').textContent = ro ? '你只有查看權限' : '';
  ['pse-stage', 'pse-next', 'pse-assigned', 'pse-contact', 'pse-phone', 'pse-email', 'pse-website', 'pse-notes', 'pse-optout'].forEach((id) => (document.getElementById(id).disabled = ro));
  document.getElementById('ps-edit-modal').style.display = 'flex';
}

function assignMe() {
  document.getElementById('pse-assigned').value = '@me'; // 儲存時伺服器換成你的帳號
}

async function saveEdit() {
  const v = (id) => document.getElementById(id).value.trim();
  const fields = { Stage: v('pse-stage'), AssignedTo: v('pse-assigned'), Contact: v('pse-contact'), Phone: v('pse-phone'), Email: v('pse-email'), Website: v('pse-website'), Notes: document.getElementById('pse-notes').value, Optout: document.getElementById('pse-optout').checked, NextFollowUp: v('pse-next') };
  const r = await callApi('prospectUpdate', { key: editRow.Key, row: editRow.RowIndex, fields });
  if (!r || !r.success) {
    document.getElementById('pse-msg').textContent = (r && r.message) || '儲存失敗';
    return;
  }
  closeModal('ps-edit-modal');
  load();
}

function closeModal(id) {
  document.getElementById(id).style.display = 'none';
}

// ---------- 匯入 ----------
let importFile = null; // { headers, rows, fileName }
let importMap = {};
let importing = false;
let importCancelled = false;

function openImport() {
  if (readOnly()) return alert('你只有查看權限，不能匯入名單');
  importFile = null;
  importFinal = null;
  document.getElementById('ps-step-check').style.display = 'none';
  document.getElementById('ps-file').value = '';
  document.getElementById('ps-paste').value = '';
  document.getElementById('ps-file-msg').textContent = '';
  document.getElementById('ps-step-file').style.display = '';
  document.getElementById('ps-step-map').style.display = 'none';
  document.getElementById('ps-step-run').style.display = 'none';
  document.getElementById('ps-import-modal').style.display = 'flex';
}

function closeImport() {
  if (importing && !confirm('正在匯入中，確定要關閉嗎？（已經匯入的不會消失，之後可以從中斷的筆數接續）')) return;
  importCancelled = true;
  closeModal('ps-import-modal');
  if (data) load();
}

async function onFilePicked(file) {
  if (!file) return;
  const msg = document.getElementById('ps-file-msg');
  msg.textContent = '讀取並解析檔案中…';
  try {
    const buf = await file.arrayBuffer();
    importFile = await psReadFileBuffer(buf, file.name);
  } catch (err) {
    msg.textContent = '讀取失敗：' + err.message;
    return;
  }
  importMap = psAutoMap(importFile.headers);
  document.getElementById('ps-file-info').textContent = `${importFile.fileName || file.name}：共 ${importFile.rows.length.toLocaleString()} 筆資料、${importFile.headers.length} 個欄位`;
  document.getElementById('ps-source').value = psDetectSource(importFile.headers) || file.name.replace(/\.[^.]+$/, '');
  document.getElementById('ps-start').value = 1;
  renderMapping();
  document.getElementById('ps-step-file').style.display = 'none';
  document.getElementById('ps-step-map').style.display = '';
  msg.textContent = '';
}

// 匯入：把檔案拖進虛線框
document.addEventListener('DOMContentLoaded', () => {
  const drop = document.getElementById('ps-drop');
  if (!drop) return;
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (x) => { x.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (x) => { x.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (x) => {
    const f = x.dataTransfer && x.dataTransfer.files && x.dataTransfer.files[0];
    if (f) onFilePicked(f);
  });
});

function usePastedNames() {
  const lines = document.getElementById('ps-paste').value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return alert('請先貼上公司名稱，一行一家');
  const rows = lines.map((l) => {
    const m = l.match(/^(.*?)[,，\t]\s*(\d{7,8})\s*$/);
    return m ? [m[1].trim(), m[2]] : [l, ''];
  });
  importFile = { headers: ['公司名稱', '統一編號'], rows, fileName: '貼上的名單' };
  importMap = { Name: 0, TaxId: 1 };
  document.getElementById('ps-file-info').textContent = `貼上的名單：共 ${rows.length.toLocaleString()} 家`;
  document.getElementById('ps-source').value = '手動輸入';
  document.getElementById('ps-start').value = 1;
  renderMapping();
  document.getElementById('ps-step-file').style.display = 'none';
  document.getElementById('ps-step-map').style.display = '';
}

function renderMapping() {
  const opts = (sel) => '<option value="">不匯入</option>' + importFile.headers.map((h, i) => `<option value="${i}" ${sel === i ? 'selected' : ''}>${e(h || '（第 ' + (i + 1) + ' 欄）')}</option>`).join('');
  document.getElementById('ps-map').innerHTML = PS_FIELDS.map((f) => `<label class="ps-map-row"><span>${e(f.label)}${f.required ? ' <b style="color:#c0392b">*</b>' : ''}</span><select data-map="${f.key}">${opts(importMap[f.key])}</select></label>`).join('');
  renderPreview();
}

document.addEventListener('change', (ev) => {
  const t = ev.target;
  if (!t || !t.dataset || !t.dataset.map) return;
  if (t.value === '') delete importMap[t.dataset.map];
  else importMap[t.dataset.map] = Number(t.value);
  renderPreview();
});

function renderPreview() {
  const keys = PS_FIELDS.filter((f) => importMap[f.key] !== undefined);
  const sample = importFile.rows.slice(0, 3).map((r) => psRowToRecord(r, importMap) || {});
  document.getElementById('ps-preview').innerHTML = `<thead><tr>${keys.map((f) => `<th>${e(f.label)}</th>`).join('')}</tr></thead><tbody>${sample.map((r) => `<tr>${keys.map((f) => `<td>${e(String(r[f.key] || '').slice(0, 60))}</td>`).join('')}</tr>`).join('')}</tbody>`;
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function startImport() {
  if (importMap.Name === undefined) return alert('一定要對應「公司名稱」欄位');
  const source = document.getElementById('ps-source').value.trim();
  if (!source) return alert('請填來源名稱');
  const built = importFinal ? { records: importFinal, skipped: 0 } : psBuildRecords(importFile.rows, importMap);
  const { records, skipped } = built;
  if (!records.length) return alert('沒有可匯入的資料（公司名稱都是空白）');
  const update = document.getElementById('ps-update').checked;
  const startAt = Math.max(1, Math.floor(Number(document.getElementById('ps-start').value)) || 1);
  if (startAt > records.length) return alert('起始筆數超過資料總數');
  const todo = records.length - (startAt - 1);
  if (!importFinal && !confirm(`要匯入 ${todo.toLocaleString()} 筆（來源：${source}）。${todo > 20000 ? '\n筆數很多，約需要 ' + Math.ceil(todo / IMPORT_CHUNK / 4) + ' 分鐘以上，過程中請不要關閉這個分頁。' : ''}\n確定開始嗎？`)) return;

  importing = true;
  importCancelled = false;
  document.getElementById('ps-step-map').style.display = 'none';
  document.getElementById('ps-step-check').style.display = 'none';
  document.getElementById('ps-step-run').style.display = '';
  document.getElementById('ps-cancel').style.display = '';
  const bar = document.getElementById('ps-progress-bar');
  const text = document.getElementById('ps-progress-text');
  const log = document.getElementById('ps-progress-log');
  const warn = (ev) => {
    ev.preventDefault();
    ev.returnValue = '';
  };
  window.addEventListener('beforeunload', warn);
  const totals = { added: 0, merged: 0, same: 0, invalid: skipped, dup: 0 };
  let done = startAt - 1;
  const t0 = Date.now();
  let failed = '';
  while (done < records.length && !importCancelled) {
    const chunk = records.slice(done, done + IMPORT_CHUNK);
    let r = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      r = await callApi('prospectImport', { source, update, rows: chunk }, { silent: true });
      if (r && r.success) break;
      const msg = (r && r.message) || '';
      if (!(r && r.networkError) && !/忙碌|逾時|timeout/i.test(msg)) break; // 非網路 / 忙碌問題，重試也沒用
      text.textContent = `連線不穩或系統忙碌，${attempt + 1}/3 次重試中…`;
      await sleep(3000 * (attempt + 1));
    }
    if (!r || !r.success) {
      failed = (r && r.message) || '匯入失敗';
      break;
    }
    totals.added += r.added;
    totals.merged += r.merged;
    totals.same += r.same;
    totals.invalid += r.invalid;
    totals.dup += r.duplicateInBatch;
    done += chunk.length;
    const pct = Math.round((done / records.length) * 100);
    bar.style.width = pct + '%';
    const elapsed = (Date.now() - t0) / 1000;
    const rate = (done - (startAt - 1)) / elapsed;
    const eta = rate > 0 ? Math.ceil((records.length - done) / rate / 60) : 0;
    text.textContent = `已處理 ${done.toLocaleString()} / ${records.length.toLocaleString()} 筆（${pct}%）${done < records.length ? `，預估還要約 ${eta} 分鐘` : ''}`;
    log.textContent = `新增 ${totals.added.toLocaleString()}　合併 ${totals.merged.toLocaleString()}　已存在 ${totals.same.toLocaleString()}　略過 ${totals.invalid.toLocaleString()}　同批重複 ${totals.dup.toLocaleString()}`;
  }
  window.removeEventListener('beforeunload', warn);
  importing = false;
  document.getElementById('ps-cancel').style.display = 'none';
  const summary = `新增 ${totals.added.toLocaleString()}、合併 ${totals.merged.toLocaleString()}、已存在 ${totals.same.toLocaleString()}、略過 ${totals.invalid.toLocaleString()}`;
  if (failed) {
    text.textContent = `⚠️ 匯入中斷：${failed}`;
    log.textContent += `\n已處理到第 ${done.toLocaleString()} 筆。重新選同一個檔案、把「從第幾筆開始」填 ${(done + 1).toLocaleString()} 即可接續。\n${summary}`;
  } else if (importCancelled) {
    text.textContent = `已停止（處理到第 ${done.toLocaleString()} 筆）`;
    log.textContent += `\n要接續請重新選檔案，「從第幾筆開始」填 ${(done + 1).toLocaleString()}。`;
  } else {
    text.textContent = `✅ 匯入完成：${summary}`;
  }
  loadStatus();
  load();
}

function cancelImport() {
  importCancelled = true;
  document.getElementById('ps-cancel').style.display = 'none';
  document.getElementById('ps-progress-text').textContent = '正在停止（等這一批處理完）…';
}

// ---------- 匯入前檢查重複 ----------
let importFinal = null; // 檢查後確定要送出的資料（null = 沒經過檢查）
let checkRecords = [];
let checkResults = [];
let checkSkipped = 0;
const diffChoice = {}; // 列索引 → 'update' / 'keep'
const custChoice = {}; // 列索引 → true（仍加入名單）
const CHECK_CHUNK = 2000;

function backToMap() {
  document.getElementById('ps-step-check').style.display = 'none';
  document.getElementById('ps-step-map').style.display = '';
}

async function checkImport() {
  if (importMap.Name === undefined) return alert('一定要對應「公司名稱」欄位');
  if (!document.getElementById('ps-source').value.trim()) return alert('請填來源名稱');
  const { records, skipped } = psBuildRecords(importFile.rows, importMap);
  if (!records.length) return alert('沒有可匯入的資料（公司名稱都是空白）');
  checkRecords = records;
  checkSkipped = skipped;
  checkResults = [];
  Object.keys(diffChoice).forEach((k) => delete diffChoice[k]);
  Object.keys(custChoice).forEach((k) => delete custChoice[k]);
  document.getElementById('ps-step-map').style.display = 'none';
  document.getElementById('ps-step-check').style.display = '';
  ['pc-summary', 'pc-diff', 'pc-cust', 'pc-msg'].forEach((id) => (document.getElementById(id).innerHTML = ''));
  document.getElementById('pc-go').disabled = true;
  const prog = document.getElementById('pc-progress');
  for (let off = 0; off < records.length; off += CHECK_CHUNK) {
    prog.textContent = `比對系統中的資料… ${Math.min(off + CHECK_CHUNK, records.length).toLocaleString()} / ${records.length.toLocaleString()}`;
    const chunk = records.slice(off, off + CHECK_CHUNK);
    let r = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      r = await callApi('prospectImportCheck', { rows: chunk }, { silent: true });
      if (r && r.success) break;
      if (!(r && r.networkError) && !/忙碌/.test((r && r.message) || '')) break;
      await sleep(3000 * (attempt + 1));
    }
    if (!r || !r.success) {
      prog.textContent = '⚠️ 檢查失敗：' + ((r && r.message) || '連線失敗');
      return;
    }
    r.results.forEach((x) => {
      x.i += off;
      if (x.of !== undefined) x.of += off;
      checkResults.push(x);
    });
  }
  // 跨批次的同名重複（每批只能看到自己那批）：用公司名稱再擋一次
  const seen = {};
  checkResults.forEach((x) => {
    if (x.status !== 'new' && x.status !== 'customer') return;
    const k = String(checkRecords[x.i].Name).replace(/\s/g, '');
    if (seen[k] !== undefined) {
      x.status = 'dup';
      x.of = seen[k];
    } else seen[k] = x.i;
  });
  prog.textContent = '';
  document.getElementById('pc-go').disabled = false;
  renderCheck();
}

function renderCheck() {
  const by = (s) => checkResults.filter((x) => x.status === s);
  const nNew = by('new').length, same = by('same'), diff = by('diff'), cust = by('customer'), dup = by('dup').length, invalid = by('invalid').length + checkSkipped;
  const nUpd = diff.filter((x) => diffChoice[x.i] === 'update').length;
  const nCust = cust.filter((x) => custChoice[x.i]).length;
  document.getElementById('pc-summary').innerHTML = [
    ['新的公司（會新增）', nNew, '#27ae60'],
    ['已存在、資料相同（不新增）', same.length, '#7f8c8d'],
    ['已存在、資料不同', diff.length, '#d35400'],
    ['已經是客戶', cust.length, '#2c5aa0'],
    ['同一份檔案裡重複', dup, '#95a5a6'],
    ['沒有公司名稱（略過）', invalid, '#95a5a6'],
  ]
    .filter(([, n]) => n)
    .map(([l, n, c]) => `<span class="sch-chip" style="border-color:${c};color:${c};"><b>${n.toLocaleString()}</b> ${l}</span>`)
    .join('');
  const SHOW = 300;
  document.getElementById('pc-diff').innerHTML = diff.length
    ? `<h4>已存在但資料不同（${diff.length.toLocaleString()} 家）：要更新成檔案裡的資料嗎？</h4>
      <div class="calc-hint">「更新」= 有差異的欄位改成新的；「保留原本」= 這家完全不動。開發狀態、聯繫紀錄、負責業務不會被改。</div>
      <div style="margin:6px 0;"><button type="button" class="btn-mini" onclick="setAllDiff('update')">全部更新</button> <button type="button" class="btn-mini" onclick="setAllDiff('keep')">全部保留原本</button> <span class="calc-hint">目前選「更新」${nUpd} 家</span></div>
      <div class="nc-scroll" style="max-height:40vh;overflow:auto;"><table class="nc-table pc-table"><thead><tr><th>公司</th><th>差異（原本 → 檔案）</th><th>要怎麼處理</th></tr></thead><tbody>
      ${diff
        .slice(0, SHOW)
        .map(
          (x) => `<tr><td><b>${e(x.name)}</b><div class="calc-hint">${e(x.stage)}${x.customer ? '｜已是客戶' : ''}</div></td>
          <td>${x.diffs.map((d) => `<div>${e(d.label)}：<span class="pc-old">${e(d.old || '（空白）')}</span> → <span class="pc-new">${e(d.now)}</span></div>`).join('')}</td>
          <td style="white-space:nowrap;"><label><input type="radio" name="pcd${x.i}" ${diffChoice[x.i] === 'update' ? 'checked' : ''} onchange="diffChoice[${x.i}]='update';renderCheck()" style="width:auto;" /> 更新</label>
          <label><input type="radio" name="pcd${x.i}" ${diffChoice[x.i] !== 'update' ? 'checked' : ''} onchange="diffChoice[${x.i}]='keep';renderCheck()" style="width:auto;" /> 保留原本</label></td></tr>`
        )
        .join('')}</tbody></table></div>${diff.length > SHOW ? `<div class="calc-hint">只列前 ${SHOW} 家；其餘依上面的「全部更新 / 全部保留原本」處理。</div>` : ''}`
    : '';
  document.getElementById('pc-cust').innerHTML = cust.length
    ? `<h4>客戶管理裡已經有的公司（${cust.length.toLocaleString()} 家）：要加入開發名單嗎？</h4>
      <div class="calc-hint">這些是既有客戶，不是陌生開發；預設不加入。勾選的會加入名單並標示「已是客戶」。</div>
      <div style="margin:6px 0;"><button type="button" class="btn-mini" onclick="setAllCust(true)">全部加入</button> <button type="button" class="btn-mini" onclick="setAllCust(false)">全部略過</button> <span class="calc-hint">目前勾選 ${nCust} 家</span></div>
      <div class="nc-scroll" style="max-height:30vh;overflow:auto;"><table class="nc-table pc-table"><thead><tr><th>加入</th><th>檔案裡的名稱</th><th>客戶管理裡的名稱</th></tr></thead><tbody>
      ${cust
        .slice(0, SHOW)
        .map((x) => `<tr><td><input type="checkbox" ${custChoice[x.i] ? 'checked' : ''} onchange="custChoice[${x.i}]=this.checked;renderCheck()" style="width:auto;" /></td><td>${e(checkRecords[x.i].Name)}</td><td>${e(x.customer)}</td></tr>`)
        .join('')}</tbody></table></div>`
    : '';
  const total = nNew + nUpd + nCust;
  const btn = document.getElementById('pc-go');
  btn.textContent = total ? `確認匯入（新增 ${(nNew + nCust).toLocaleString()} 家${nUpd ? '、更新 ' + nUpd.toLocaleString() + ' 家' : ''}）` : '沒有需要新增或更新的資料';
  btn.disabled = !total;
}

function setAllDiff(v) {
  checkResults.filter((x) => x.status === 'diff').forEach((x) => (diffChoice[x.i] = v));
  renderCheck();
}

function setAllCust(v) {
  checkResults.filter((x) => x.status === 'customer').forEach((x) => (custChoice[x.i] = v));
  renderCheck();
}

function confirmImport() {
  const final = [];
  checkResults.forEach((x) => {
    const rec = checkRecords[x.i];
    if (x.status === 'new') final.push(rec);
    else if (x.status === 'diff' && diffChoice[x.i] === 'update') final.push(Object.assign({ _update: true }, rec));
    else if (x.status === 'customer' && custChoice[x.i]) final.push(rec);
  });
  if (!final.length) return;
  importFinal = final;
  startImport();
}

// ---------- 管理 ----------
async function clearAll() {
  if (!data || !data.all) return alert('名單庫已經是空的');
  const input = prompt(`這會刪除名單庫裡全部 ${data.all.toLocaleString()} 筆資料（含開發狀態與備註），無法復原。\n確定的話請輸入 CLEAR：`);
  if (input !== 'CLEAR') return;
  const r = await callApi('prospectClear', { confirm: 'CLEAR' });
  if (!r || !r.success) return alert((r && r.message) || '清空失敗');
  clearSelection();
  alert(`已清空 ${r.removed.toLocaleString()} 筆`);
  loadStatus();
  load();
}

// ---------- 找官網與聯絡方式 ----------
let enrichStop = false;
let enrichRunning = false;
const ENRICH_BATCH = 3;

function enrichScope() {
  if (selectAllMatching) return { filter: filterBody(), label: `符合目前條件的 ${data.total.toLocaleString()} 筆` };
  if (selected.size) return { keys: [...selected], label: `已勾選的 ${selected.size.toLocaleString()} 筆` };
  return { filter: filterBody(), label: `符合目前條件的 ${data ? data.total.toLocaleString() : 0} 筆（沒有勾選時就用目前的篩選結果）` };
}

function openEnrich() {
  if (readOnly()) return alert('你只有查看權限');
  if (!data || !data.total) return alert('目前沒有名單可以查。先匯入名單，或放寬篩選條件。');
  const st = (window.__psStatus && window.__psStatus.enrich) || { source: 'none' };
  const srcText = {
    places: '搜尋方式：<b>Google Places</b>（比對公司名稱與地址，同時提供電話；依 Google 計費）',
    gemini: '搜尋方式：<b>Gemini + Google 搜尋</b>（用「BOT 設定 → AI 模型」裡的 Gemini 金鑰；搜到的網址會再打開確認是不是這家公司）',
    none: '⚠️ <b>還沒有搜尋方式</b>：請到「BOT 設定 → AI 模型」設定 Gemini，或請管理員在 Apps Script 指令碼屬性加上 GOOGLE_PLACES_API_KEY。已經有官網的公司仍可以直接抓聯絡方式。',
  }[st.source] || '';
  const quota = st.limit ? `今天已查 ${Number(st.used || 0).toLocaleString()} / 上限 ${Number(st.limit).toLocaleString()} 家（管理員可在指令碼屬性 PS_ENRICH_DAILY 調整）` : '每日上限：不限';
  document.getElementById('pen-source').innerHTML = `${srcText}<div class="calc-hint">${e(quota)}</div>`;
  document.getElementById('pen-scope').textContent = '範圍：' + enrichScope().label;
  document.getElementById('pen-msg').textContent = '';
  document.getElementById('pen-setup').style.display = '';
  document.getElementById('pen-run').style.display = 'none';
  document.getElementById('pen-go').disabled = false;
  document.getElementById('ps-enrich-modal').style.display = 'flex';
}

function closeEnrich() {
  if (enrichRunning && !confirm('正在查詢中，確定要關閉嗎？（已經查完的會保留）')) return;
  enrichStop = true;
  closeModal('ps-enrich-modal');
  load();
  loadStatus();
}

function stopEnrich() {
  enrichStop = true;
  document.getElementById('pen-stop').style.display = 'none';
  document.getElementById('pen-text').textContent = '正在停止（等這一批查完）…';
}

function enrichRowHtml(x) {
  const url = psSafeUrl(x.website);
  const cls = x.status === 'ok' ? 'nc-badge ok' : 'nc-badge';
  return `<tr><td>${e(x.name || '')}</td><td><span class="${cls}">${e(ENRICH_LABEL[x.status] || x.status)}</span></td><td>${url ? `<a href="${e(url)}" target="_blank" rel="noopener noreferrer">${e(String(x.website).replace(/^https?:\/\//i, ''))}</a>` : ''}</td><td>${e(x.email || '')}</td><td>${e(x.phone || '')}</td><td class="calc-hint" style="white-space:normal;max-width:260px;">${e(x.note || '')}${x.extra ? '<br>＋ ' + e(x.extra) : ''}</td></tr>`;
}

async function startEnrich() {
  const limit = Math.min(500, Math.max(1, Math.floor(Number(document.getElementById('pen-limit').value)) || 50));
  const scope = enrichScope();
  document.getElementById('pen-go').disabled = true;
  document.getElementById('pen-msg').textContent = '整理要查的名單…';
  const plan = await callApi('prospectEnrichPlan', Object.assign({ onlyNew: document.getElementById('pen-onlynew').checked, limit }, scope.keys ? { keys: scope.keys } : { filter: scope.filter }));
  if (!plan || !plan.success) {
    document.getElementById('pen-go').disabled = false;
    document.getElementById('pen-msg').textContent = (plan && plan.message) || '規劃失敗';
    return;
  }
  if (!plan.items.length) {
    document.getElementById('pen-go').disabled = false;
    document.getElementById('pen-msg').textContent = '沒有需要查的公司（可能都查過了，取消「只查還沒查過的」可以重查）。';
    return;
  }
  document.getElementById('pen-setup').style.display = 'none';
  document.getElementById('pen-run').style.display = '';
  document.getElementById('pen-stop').style.display = '';
  document.getElementById('pen-body').innerHTML = '';
  enrichStop = false;
  enrichRunning = true;
  const warn = (ev) => {
    ev.preventDefault();
    ev.returnValue = '';
  };
  window.addEventListener('beforeunload', warn);
  const total = plan.items.length;
  let queue = plan.items.slice();
  let done = 0;
  const tally = { ok: 0, nocontact: 0, nosite: 0, blocked: 0, error: 0 };
  let stopMsg = '';
  const text = document.getElementById('pen-text');
  const t0 = Date.now();
  while (queue.length && !enrichStop) {
    const batch = queue.slice(0, ENRICH_BATCH);
    let r = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      r = await callApi('prospectEnrich', { items: batch }, { silent: true });
      if (r && r.success) break;
      if (!(r && r.networkError) && !/忙碌/.test((r && r.message) || '')) break;
      await new Promise((res) => setTimeout(res, 3000 * (attempt + 1)));
    }
    if (!r || !r.success) {
      stopMsg = '⚠️ 中斷：' + ((r && r.message) || '查詢失敗');
      break;
    }
    r.results.forEach((x) => {
      tally[x.status] = (tally[x.status] || 0) + 1;
      document.getElementById('pen-body').insertAdjacentHTML('beforeend', enrichRowHtml(x));
    });
    done += r.results.length;
    const handled = new Set(r.results.map((x) => x.key));
    const rest = r.remaining && r.remaining.length ? r.remaining : batch.filter((b) => !handled.has(b.key));
    queue = rest.concat(queue.slice(batch.length)).filter((b) => !handled.has(b.key));
    if (r.quotaReached) {
      stopMsg = `已達今天的查詢上限（${Number(r.quota.limit).toLocaleString()} 家），明天會自動恢復。`;
      break;
    }
    if (!r.results.length && r.remaining && r.remaining.length) {
      stopMsg = '⚠️ 伺服器沒有處理任何一筆，先停止。';
      break;
    }
    const pct = Math.round((done / total) * 100);
    document.getElementById('pen-bar').style.width = pct + '%';
    const rate = done / ((Date.now() - t0) / 1000);
    text.textContent = `已查 ${done} / ${total} 家（${pct}%）${queue.length && rate > 0 ? `，預估還要約 ${Math.ceil(queue.length / rate / 60)} 分鐘` : ''}`;
    document.getElementById('pen-tally').textContent = `找到聯絡方式 ${tally.ok}　有官網沒聯絡方式 ${tally.nocontact}　找不到官網 ${tally.nosite}　不允許讀取 ${tally.blocked}　失敗 ${tally.error}`;
  }
  window.removeEventListener('beforeunload', warn);
  enrichRunning = false;
  document.getElementById('pen-stop').style.display = 'none';
  document.getElementById('pen-bar').style.width = Math.round((done / total) * 100) + '%';
  text.textContent = stopMsg || (enrichStop ? `已停止：查了 ${done} 家` : `✅ 完成：查了 ${done} 家，找到聯絡方式 ${tally.ok} 家`);
  document.getElementById('pen-tally').textContent = `找到聯絡方式 ${tally.ok}　有官網沒聯絡方式 ${tally.nocontact}　找不到官網 ${tally.nosite}　不允許讀取 ${tally.blocked}　失敗 ${tally.error}`;
  loadStatus();
  load();
}

// ---------- 聯繫紀錄 ----------
function localDate(offset) {
  const d = new Date();
  d.setDate(d.getDate() + (offset || 0));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 表格「開發狀態」欄下面的追蹤資訊：下次追蹤日（今天以前標紅）、最後聯繫。 */
function followHtml(r) {
  const out = [];
  if (r.NextFollowUp) {
    const due = r.NextFollowUp <= localDate(0);
    out.push(`<div class="${due ? 'ps-due' : 'calc-hint'}">⏰ 下次 ${e(r.NextFollowUp.slice(5))}${due ? (r.NextFollowUp < localDate(0) ? '（逾期）' : '（今天）') : ''}</div>`);
  }
  if (r.LastContactAt) out.push(`<div class="calc-hint">最後聯繫 ${e(String(r.LastContactAt).slice(5, 10))}</div>`);
  return out.join('');
}

function telHref(p) {
  return 'tel:' + String(p || '').replace(/[^\d+]/g, '');
}

function openLogPanel(r) {
  const ro = readOnly();
  document.querySelectorAll('#ps-edit-modal .ps-write-block').forEach((el) => (el.style.display = ro ? 'none' : ''));
  // 快速聯繫：直接撥號 / 寄信 / 開官網
  const q = [];
  if (r.Phone) q.push(`<a class="btn-mini ps-qbtn" href="${e(telHref(r.Phone))}">📞 ${e(r.Phone)}</a>`);
  if (r.Email) q.push(`<a class="btn-mini ps-qbtn" href="mailto:${e(r.Email)}">✉️ ${e(r.Email)}</a>`);
  const url = psSafeUrl(r.Website);
  if (url) q.push(`<a class="btn-mini ps-qbtn" href="${e(url)}" target="_blank" rel="noopener noreferrer">🌐 官網</a>`);
  if (r.ExtraContacts) q.push(`<span class="calc-hint">其他：${e(r.ExtraContacts)}</span>`);
  if (r.Notes) q.push(`<div class="ps-note-box">📝 ${e(r.Notes)}</div>`);
  document.getElementById('pse-quick').innerHTML = q.join(' ');
  document.getElementById('psl-method').innerHTML = ['電話', 'Email', '拜訪', 'LINE', '展覽', '其他'].map((m) => `<option>${m}</option>`).join('');
  document.getElementById('psl-stage').innerHTML = '<option value="">開發狀態：不變</option>' + stages.map((s) => `<option value="${e(s)}">${e(s)}</option>`).join('');
  document.getElementById('psl-content').value = '';
  document.getElementById('psl-next').value = r.NextFollowUp || ''; // 帶入目前排定的追蹤日，要取消請按「不排」
  document.getElementById('psl-msg').textContent = '';
  document.getElementById('psl-quick').innerHTML = [['明天', 1], ['3 天後', 3], ['1 週後', 7], ['2 週後', 14], ['1 個月後', 30]]
    .map(([t, n]) => `<button type="button" class="ps-pill" onclick="document.getElementById('psl-next').value='${localDate(n)}'">${t}</button>`)
    .join(' ') + ' <button type="button" class="ps-pill" onclick="document.getElementById(\'psl-next\').value=\'\'">不排</button>';
  loadLogs(r.Key);
}

async function loadLogs(key) {
  const box = document.getElementById('pse-logs');
  box.innerHTML = '<span class="calc-hint">讀取中…</span>';
  const r = await callApi('prospectLogs', { key }, { silent: true });
  if (!editRow || editRow.Key !== key) return; // 視窗已經換成別家
  if (!r || !r.success) {
    box.innerHTML = `<span class="calc-hint">${e((r && r.message) || '讀取失敗')}</span>`;
    return;
  }
  box.innerHTML = r.logs.length
    ? r.logs
        .map((l) => `<div class="ps-log"><div class="ps-log-head"><b>${e(l.Method)}</b>　${e(l.Time)}　${e(l.User)}${l.Stage ? `　→ ${e(l.Stage)}` : ''}${l.NextFollowUp ? `　⏰ 下次 ${e(l.NextFollowUp)}` : ''}</div><div class="ps-log-body">${e(l.Content)}</div></div>`)
        .join('')
    : '<span class="calc-hint">還沒有聯繫紀錄。</span>';
}

async function addLog() {
  const content = document.getElementById('psl-content').value.trim();
  const msg = document.getElementById('psl-msg');
  if (!content) {
    msg.textContent = '請先填寫這次聯繫的內容';
    return;
  }
  const r = await callApi('prospectLogAdd', {
    key: editRow.Key,
    row: editRow.RowIndex,
    method: document.getElementById('psl-method').value,
    content,
    stage: document.getElementById('psl-stage').value,
    nextFollowUp: document.getElementById('psl-next').value,
  });
  if (!r || !r.success) {
    msg.textContent = (r && r.message) || '新增失敗';
    return;
  }
  editRow = r.row;
  const i = data.rows.findIndex((x) => x.Key === r.row.Key);
  if (i > -1) data.rows[i] = r.row;
  document.getElementById('pse-stage').value = r.row.Stage;
  document.getElementById('pse-next').value = r.row.NextFollowUp || '';
  document.getElementById('pse-assigned').value = r.row.AssignedTo || '';
  document.getElementById('psl-content').value = '';
  document.getElementById('psl-next').value = r.row.NextFollowUp || '';
  document.getElementById('psl-stage').value = '';
  msg.textContent = '✓ 已記錄' + (r.row.NextFollowUp ? `，下次追蹤 ${r.row.NextFollowUp}` : '');
  loadLogs(r.row.Key);
  renderRows();
}

window.refreshPageData = () => load();

window.addEventListener('DOMContentLoaded', async () => {
  if (!(await ensureAuth())) return;
  renderHeaderUser();
  applyAdminOnlyVisibility();
  if (readOnly()) document.querySelectorAll('.ps-write').forEach((b) => (b.style.display = 'none'));
  loadStatus();
  // 從業務行事曆點「📞 記錄」：?q=公司名稱&open=1 → 搜尋並直接打開那家的聯繫視窗
  const params = new URLSearchParams(location.search);
  if (params.get('q')) {
    state.q = params.get('q');
    document.getElementById('ps-q').value = state.q;
  }
  await load();
  if (params.get('open') === '1' && data && data.rows && data.rows.length) {
    const i = Math.max(0, data.rows.findIndex((r) => r.Name === state.q));
    openEdit(i);
  }
});
