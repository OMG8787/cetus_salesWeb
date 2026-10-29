// ------------------------------------------------------------
// quotedoc.js - 報價單編輯器（跟「檔案製作」同一套做法）：
// 報價單產生成一份可以直接修改的文件，點文字就能改、不需要的整列 / 整欄 / 單行規格手動刪掉，
// 再輸出成 HTML、Word(.doc)、貼進信件、或列印成 PDF。
// ------------------------------------------------------------
const QD_PAGE_MM = 277; // 列印固定 A4、邊界 10mm：每頁可用高度 277mm、寬度 190mm

let qdSel = null; // 目前選取的元素
let qdUndoStack = [];
let qdDirty = false;

const qdFrame = () => document.getElementById('qd-frame');
const qdDoc = () => qdFrame().contentDocument;

/** 開啟編輯器並載入報價單 HTML。 */
function qdOpen(html, name) {
  const box = document.getElementById('qd-editor');
  box.style.display = '';
  document.getElementById('qd-name').value = name || '報價單';
  const doc = qdFrame().contentDocument;
  doc.open();
  doc.write(html);
  doc.close();
  qdUndoStack = [];
  qdSel = null;
  qdDirty = false;
  qdUpdateSelLabel();
  setTimeout(() => {
    qdPrepare();
    qdFit();
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 60);
  Array.from(doc.images).forEach((img) => {
    if (!img.complete) img.addEventListener('load', qdFit);
  });
}

function qdClose() {
  if (qdDirty && !confirm('報價單還沒有輸出，關閉後修改的內容會不見，確定要關閉嗎？')) return;
  document.getElementById('qd-editor').style.display = 'none';
  qdDirty = false;
}

/** 讓內容可以編輯、裝上點選 / 輸入的監聽。 */
function qdPrepare() {
  const doc = qdDoc();
  if (!doc || !doc.body || doc.getElementById('qd-edit-style')) return;
  const st = doc.createElement('style');
  st.id = 'qd-edit-style';
  st.textContent = '[data-qd-sel]{outline:2px dashed #e67e22 !important;outline-offset:1px;}body{caret-color:#e67e22;}[data-qd-pb]{border-top:2px dotted #c0392b;position:relative;}[data-qd-pb]::after{content:"— 從這裡換頁 —";position:absolute;right:0;top:2px;font:12px sans-serif;color:#c0392b;}';
  doc.head.appendChild(st);
  doc.body.contentEditable = 'true';
  doc.body.spellcheck = false;
  doc.addEventListener('click', (e) => {
    if (e.target.closest && e.target.closest('a')) e.preventDefault();
    qdSelect(e.target);
  });
  doc.addEventListener('input', () => {
    qdDirty = true;
    qdFit();
  });
  doc.addEventListener('keyup', (e) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      const s = doc.getSelection();
      const n = s && s.anchorNode ? (s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement) : null;
      if (n && n !== doc.body) qdSelect(n);
    }
  });
}

function qdFit() {
  const f = qdFrame();
  const d = f.contentDocument;
  if (!d || !d.documentElement) return;
  qdDrawGuides();
  f.style.height = Math.max(600, qdContentHeight(d) + 20) + 'px';
}

/** 文件內容的實際高度（不能用 documentElement.scrollHeight：它至少等於視窗高度，會讓 iframe 越撐越高、頁數誤判）。 */
function qdContentHeight(doc) {
  const g = doc.getElementById('qd-guides');
  if (g) g.style.display = 'none';
  const h = Math.ceil(doc.body.getBoundingClientRect().bottom + doc.defaultView.scrollY);
  if (g) g.style.display = '';
  return h;
}

// ---------------- PDF 分頁線 ----------------
function qdMmToPx(mm) {
  return (mm * 96) / 25.4;
}

function qdDrawGuides() {
  const doc = qdDoc();
  if (!doc || !doc.body) return;
  const old = doc.getElementById('qd-guides');
  if (old) old.remove();
  const pageH = qdMmToPx(QD_PAGE_MM);
  const pbs = Array.from(doc.querySelectorAll('[data-qd-pb]'));
  // 手動換頁：用空白墊高模擬「下一頁才開始」（輸出時移除墊高，改由瀏覽器真正換頁）
  pbs.forEach((e) => (e.style.height = '0px'));
  pbs.forEach((e) => {
    const top = e.getBoundingClientRect().top + doc.defaultView.scrollY;
    const into = top % pageH;
    e.style.height = into > 1 ? pageH - into + 'px' : '0px';
  });
  const total = qdContentHeight(doc);
  const pages = Math.max(1, Math.ceil((total - 2) / pageH));
  const label = document.getElementById('qd-pages');
  if (label) label.textContent = `約 ${pages} 頁`;
  if (!document.getElementById('qd-guide').checked) return;
  const box = doc.createElement('div');
  box.id = 'qd-guides';
  box.contentEditable = 'false';
  box.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:0;pointer-events:none;z-index:99999;';
  for (let i = 1; i < pages; i++) {
    const line = doc.createElement('div');
    line.style.cssText = `position:absolute;left:0;right:0;top:${Math.round(pageH * i)}px;border-top:2px dashed #e74c3c;`;
    const tag = doc.createElement('span');
    tag.textContent = `↑ 第 ${i} 頁結束　第 ${i + 1} 頁開始 ↓`;
    tag.style.cssText = 'position:absolute;right:0;top:0;background:#e74c3c;color:#fff;font:11px sans-serif;padding:1px 6px;';
    line.appendChild(tag);
    box.appendChild(line);
  }
  doc.body.appendChild(box);
}

function qdPageBreak() {
  if (!qdNeedSel()) return;
  // 選到儲存格 / 文字時，換頁點放在「整列」前面比較合理
  const target = qdSel.closest('tr') || qdSel;
  const prev = target.previousElementSibling;
  if (prev && prev.hasAttribute('data-qd-pb')) {
    qdPushUndo();
    prev.remove();
    qdDirty = true;
    return qdFit();
  }
  if (target.tagName === 'TR') return alert('表格列前面沒辦法直接換頁，請改選表格上面或下面的區塊（例如備註）再按「此處換頁」；或把需要換頁後的項目整個表格分開。');
  qdPushUndo();
  const b = qdDoc().createElement('div');
  b.setAttribute('data-qd-pb', '1');
  b.setAttribute('style', 'break-before:page;page-break-before:always;height:0px;');
  target.before(b);
  qdDirty = true;
  qdFit();
}

// ---------------- 選取 ----------------
function qdSelect(el) {
  const doc = qdDoc();
  if (qdSel) qdSel.removeAttribute('data-qd-sel');
  qdSel = el && el !== doc.body && el !== doc.documentElement && el.nodeType === 1 && !el.closest('#qd-guides') ? el : null;
  if (qdSel) qdSel.setAttribute('data-qd-sel', '1');
  qdUpdateSelLabel();
}

function qdUpdateSelLabel() {
  const l = document.getElementById('qd-sel');
  if (!qdSel) {
    l.textContent = '點一下文件裡的文字 / 儲存格 / 規格行可選取（橘色虛線框）。';
    return;
  }
  const cls = (qdSel.className || '').toString().trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
  l.textContent = `已選取：<${qdSel.tagName.toLowerCase()}${cls ? '.' + cls : ''}>`;
}

function qdNeedSel() {
  if (!qdSel) {
    alert('請先點一下要操作的地方（會出現橘色虛線框）；選到太小的元素可按「⬆ 選上一層」。');
    return false;
  }
  return true;
}

function qdSelParent() {
  if (!qdSel) return alert('請先點一下文件裡的元素');
  const p = qdSel.parentElement;
  if (!p || p === qdDoc().body) return alert('已經是最上層了');
  qdSelect(p);
}

// ---------------- 還原 ----------------
function qdPushUndo() {
  const doc = qdDoc();
  const g = doc.getElementById('qd-guides');
  if (g) g.remove();
  const had = qdSel;
  if (had) had.removeAttribute('data-qd-sel');
  qdUndoStack.push(doc.body.innerHTML);
  if (qdUndoStack.length > 30) qdUndoStack.shift();
  if (had) had.setAttribute('data-qd-sel', '1');
}

function qdUndo() {
  if (!qdUndoStack.length) return alert('沒有可以還原的操作（文字修改請在文件裡按 Ctrl+Z）');
  qdDoc().body.innerHTML = qdUndoStack.pop();
  qdSel = null;
  qdUpdateSelLabel();
  qdDirty = true;
  qdFit();
}

// ---------------- 文字格式 ----------------
function qdCmd(cmd, val) {
  qdFrame().contentWindow.focus();
  const doc = qdDoc();
  doc.execCommand('styleWithCSS', false, true);
  doc.execCommand(cmd, false, val || null);
  qdDirty = true;
  qdFit();
}

function qdFontSize(px) {
  if (!px) return;
  const doc = qdDoc();
  const s = doc.getSelection();
  if (!s || s.isCollapsed) return alert('請先在文件裡選取要改大小的文字');
  qdFrame().contentWindow.focus();
  doc.execCommand('styleWithCSS', false, false);
  doc.execCommand('fontSize', false, '7');
  doc.querySelectorAll('font[size="7"]').forEach((f) => {
    const span = doc.createElement('span');
    span.style.fontSize = px + 'px';
    while (f.firstChild) span.appendChild(f.firstChild);
    f.replaceWith(span);
  });
  qdDirty = true;
  qdFit();
}

// ---------------- 區塊 / 表格操作 ----------------
function qdDel() {
  if (!qdNeedSel()) return;
  qdPushUndo();
  const row = qdSel.tagName === 'TR' ? qdSel : null;
  qdSel.remove();
  qdSel = null;
  qdUpdateSelLabel();
  qdDirty = true;
  if (row) qdRecalc(true);
  qdFit();
}

function qdDup() {
  if (!qdNeedSel()) return;
  qdPushUndo();
  const c = qdSel.cloneNode(true);
  c.removeAttribute('data-qd-sel');
  qdSel.after(c);
  qdDirty = true;
  qdFit();
}

function qdMove(dir) {
  if (!qdNeedSel()) return;
  const sib = dir < 0 ? qdSel.previousElementSibling : qdSel.nextElementSibling;
  if (!sib || sib.hasAttribute('data-qd-pb')) return alert(dir < 0 ? '已經在最上面了' : '已經在最下面了');
  qdPushUndo();
  if (dir < 0) sib.before(qdSel);
  else sib.after(qdSel);
  qdDirty = true;
  qdFit();
}

function qdDelRow() {
  if (!qdNeedSel()) return;
  const tr = qdSel.closest('tr');
  if (!tr) return alert('請先點一下表格裡的儲存格');
  if (tr.closest('thead')) return alert('表頭那一列不能刪，要刪整欄請用「刪除此欄」');
  qdPushUndo();
  tr.remove();
  qdSel = null;
  qdUpdateSelLabel();
  qdDirty = true;
  qdRecalc(true);
  qdFit();
}

function qdDelCol() {
  if (!qdNeedSel()) return;
  const cell = qdSel.closest('td,th');
  if (!cell) return alert('請先點一下表格裡的儲存格');
  const idx = cell.cellIndex;
  const table = cell.closest('table');
  qdPushUndo();
  table.querySelectorAll('tr').forEach((tr) => {
    if (tr.cells[idx]) tr.deleteCell(idx);
  });
  qdSel = null;
  qdUpdateSelLabel();
  qdDirty = true;
  qdFit();
}

function qdAddRow() {
  if (!qdNeedSel()) return;
  const tr = qdSel.closest('tr');
  if (!tr) return alert('請先點一下表格裡的儲存格');
  qdPushUndo();
  const c = tr.cloneNode(true);
  c.removeAttribute('data-qd-sel');
  c.querySelectorAll('[data-qd-sel]').forEach((e) => e.removeAttribute('data-qd-sel'));
  c.querySelectorAll('td').forEach((td) => {
    td.innerHTML = '&nbsp;';
  });
  c.removeAttribute('data-qd-item'); // 空白列不當成品項，也不會被合計
  tr.after(c);
  qdDirty = true;
  qdFit();
}

function qdNum(el) {
  const n = parseFloat(String((el && el.textContent) || '').replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? 0 : n;
}

function qdFmt(n) {
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/** 重新計算：每個品項列的小計 = 數量 × 單價，合計 = 全部小計加總（手動改過數量、單價或刪了列之後按）。silent = 不跳提示。 */
function qdRecalc(silent) {
  const doc = qdDoc();
  const rows = Array.from(doc.querySelectorAll('tr[data-qd-item]'));
  let total = 0;
  rows.forEach((tr) => {
    const qty = tr.querySelector('.q-qty');
    const unit = tr.querySelector('.q-unit');
    const sub = tr.querySelector('.q-sub');
    if (qty && unit && sub) sub.textContent = qdFmt(qdNum(qty) * qdNum(unit));
    if (sub) total += qdNum(sub);
  });
  const totalCell = doc.querySelector('.q-total');
  if (totalCell) totalCell.textContent = qdFmt(total);
  // 項目編號重排（只有有「編號」欄時）
  let n = 0;
  rows.forEach((tr) => {
    const no = tr.querySelector('.q-no');
    if (no) no.textContent = String(++n);
  });
  qdDirty = true;
  if (!silent) alert(totalCell ? `已重新計算，合計 ${qdFmt(total)}` : '已重新計算小計（文件裡沒有「合計」欄位）');
}

// ---------------- 輸出 ----------------
/** 乾淨的最終 HTML：拿掉編輯用的屬性與樣式。 */
function qdFinalHtml() {
  const clone = qdDoc().documentElement.cloneNode(true);
  ['#qd-edit-style', '#qd-guides'].forEach((q) => {
    const e = clone.querySelector(q);
    if (e) e.remove();
  });
  clone.querySelectorAll('[data-qd-pb]').forEach((e) => {
    e.style.height = '0px';
    e.removeAttribute('data-qd-pb');
  });
  clone.querySelectorAll('[data-qd-sel]').forEach((e) => e.removeAttribute('data-qd-sel'));
  clone.querySelectorAll('[contenteditable]').forEach((e) => e.removeAttribute('contenteditable'));
  clone.querySelectorAll('[spellcheck]').forEach((e) => e.removeAttribute('spellcheck'));
  return '<!DOCTYPE html>\n' + clone.outerHTML;
}

function qdFilename(ext) {
  const n = (document.getElementById('qd-name').value.trim() || '報價單').replace(/[\\/:*?"<>|]+/g, '_');
  const d = new Date();
  return `${n}_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.${ext}`;
}

function qdSaveBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  qdDirty = false;
}

function qdDownloadHtml() {
  qdSaveBlob(new Blob([qdFinalHtml()], { type: 'text/html;charset=utf-8' }), qdFilename('html'));
}

/** Word 可以直接開啟 HTML 內容的 .doc；版面會依 Word 的版型略有差異，要微調可在 Word 裡改。 */
function qdDownloadDoc() {
  const html = qdFinalHtml().replace('<html', '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"');
  qdSaveBlob(new Blob(['﻿', html], { type: 'application/msword;charset=utf-8' }), qdFilename('doc'));
}

function qdTempFrame(visible) {
  const f = document.createElement('iframe');
  f.style.cssText = visible ? 'position:fixed;left:-9999px;top:0;width:800px;height:600px;border:0;' : 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(f);
  return f;
}

function qdCopyRich() {
  const f = qdTempFrame(true);
  const d = f.contentDocument;
  d.open();
  d.write(qdFinalHtml());
  d.close();
  setTimeout(() => {
    f.contentWindow.focus();
    d.getSelection().selectAllChildren(d.body);
    const ok = d.execCommand('copy');
    f.remove();
    alert(ok ? '已複製畫面內容，到信件編輯區按 Ctrl+V 貼上。\n（寄出前建議先寄給自己確認排版。）' : '複製失敗，請改用「下載 HTML」或「下載 Word」');
  }, 300);
}

function qdPrint() {
  const f = qdTempFrame(false);
  const d = f.contentDocument;
  d.open();
  // 固定 A4 + 10mm 邊界，分頁位置才會跟預覽的紅色分頁線一致
  d.write(qdFinalHtml().replace('</head>', '<style>@page{size:A4;margin:10mm;}body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}</style></head>'));
  d.close();
  const go = () => {
    f.contentWindow.focus();
    f.contentWindow.print();
    setTimeout(() => f.remove(), 60000);
  };
  Promise.all(Array.from(d.images).map((img) => (img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; }))))
    .then(() => (d.fonts ? d.fonts.ready : null))
    .then(() => setTimeout(go, 200));
}

window.addEventListener('beforeunload', (e) => {
  const box = document.getElementById('qd-editor');
  if (qdDirty && box && box.style.display !== 'none') {
    e.preventDefault();
    e.returnValue = '';
  }
});
