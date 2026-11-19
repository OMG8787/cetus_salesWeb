/**
 * cardpeople.js - 名片依公司彙整（共用）：同一家公司的名片放在一起，看得到對方有誰、是哪位同事收到的。
 * 名片專區的「依公司彙整」、客戶管理的「聯絡窗口」、開發名單的「聯繫 / 紀錄」都用這支。
 * 需要 common.js 的 callApi、htmlEsc。
 */

/** 一家公司的名片彙整 → HTML。opts.compact = true 時不顯示公司標題（放在已經有公司名稱的視窗裡）。 */
function cardGroupHtml(g, opts) {
  opts = opts || {};
  const e = htmlEsc;
  const tags = [
    g.customer ? `<span class="cp-tag cp-cust" title="客戶管理裡的名稱：${e(g.customer)}">已是客戶</span>` : '',
    g.prospect ? `<span class="cp-tag cp-pros" title="開發名單裡的名稱：${e(g.prospect)}">在開發名單</span>` : '',
  ].join('');
  const who = g.collectors.map((c) => `${e(c.name)}${c.count > 1 ? `×${c.count}` : ''}${c.mine ? '（我）' : ''}`).join('、');
  const other = g.names.length > 1 ? `<div class="calc-hint">名片上的寫法：${g.names.map(e).join('、')}</div>` : '';
  const rows = g.people
    .map(
      (p) => `<tr>
        <td><b>${e(p.name || '（沒有姓名）')}</b>${p.title ? `<div class="calc-hint">${e(p.title)}</div>` : ''}</td>
        <td>${p.phone ? `<a href="tel:${e(String(p.phone).replace(/[^\d+]/g, ''))}">${e(p.phone)}</a>` : ''}${p.companyPhone ? `<div class="calc-hint">公司 ${e(p.companyPhone)}</div>` : ''}</td>
        <td>${p.email ? `<a href="mailto:${e(p.email)}">${e(p.email)}</a>` : ''}</td>
        <td>${e(p.ownerName)}${p.mine ? '（我）' : ''}</td>
        <td class="calc-hint">${e(String(p.time || '').slice(0, 10))}${p.batch ? `<div>${e(p.batch)}</div>` : ''}</td>
        <td>${p.status === 'saved' ? `<span class="cp-tag cp-cust" title="${e(p.result)}">已登入</span>` : '<span class="cp-tag">待登入</span>'}</td>
      </tr>`
    )
    .join('');
  return `<div class="cp-group">
    ${opts.compact ? '' : `<div class="cp-head"><b>${e(g.company)}</b> ${tags}</div>`}
    <div class="calc-hint">📇 ${g.count} 張名片・最近 ${e(String(g.lastTime || '').slice(0, 10))}・收到名片的同事：${who}${opts.compact ? ' ' + tags : ''}</div>
    ${other}
    <div class="cp-scroll"><table class="cp-table"><thead><tr><th>對方聯絡人</th><th>電話</th><th>Email</th><th>收到的同事</th><th>日期 / 場合</th><th>狀態</th></tr></thead><tbody>${rows}</tbody></table></div>
  </div>`;
}

/** 讀一家公司的名片彙整，放進 elId；沒有名片就顯示提示。 */
async function loadCardPeople(company, elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (!company) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = '<span class="calc-hint">讀取名片紀錄中…</span>';
  const r = await callApi('cardCompanies', { company }, { silent: true });
  if (!r || !r.success) {
    el.innerHTML = `<span class="calc-hint">${htmlEsc((r && r.message) || '讀不到名片紀錄')}</span>`;
    return;
  }
  el.innerHTML = r.companies.length ? cardGroupHtml(r.companies[0], { compact: true }) : '<span class="calc-hint">還沒有同事收到這家公司的名片。</span>';
}
