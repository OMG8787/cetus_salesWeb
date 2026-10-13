// ------------------------------------------------------------
// 行銷宣傳製作：把寄給客戶的 HTML 宣傳信（templates/marketing/）當範本，
// 在頁面上直接點文字修改、換圖片、複製 / 刪除 / 移動區塊，再輸出成 HTML、貼進信件、或列印成 PDF。
// 草稿只存在這台瀏覽器（localStorage），要長期留存請下載 HTML。
// ------------------------------------------------------------
const MK_TEMPLATES = [
  { id: 'edm-expo', file: 'edm-expo.html', name: '展覽邀請 EDM', desc: '2026 台中自動化工業展' },
  { id: 'b2b-expo', file: 'b2b-expo.html', name: 'B2B 機器視覺（展覽版）', desc: 'AOI 檢測應用 + 展覽資訊' },
  { id: 'b2b', file: 'b2b.html', name: 'B2B 機器視覺', desc: 'AOI 檢測應用 / 光學尺詢價' },
  { id: 'aoi', file: 'aoi.html', name: 'AOI 機器視覺檢測應用', desc: '免費樣品測試' },
  { id: 'equipment', file: 'equipment.html', name: '設備商選配系統', desc: 'AOI・Robot Vision 設備商合作' },
  { id: 'camera-dm', file: 'camera-dm.html', name: '智慧型相機 DM', desc: '量測、瑕疵、OCR、條碼' },
  { id: 'camera-lite', file: 'camera-lite.html', name: '智慧型相機（簡版）', desc: '全功能智慧型相機高性價比' },
];
const MK_DRAFT_KEY = 'mkDrafts';

let mkCur = null; // { draftId, templateId }
let mkSel = null; // 目前選取的元素
let mkUndoStack = [];
let mkDirty = false;

const mkFrame = () => document.getElementById('mk-frame');
const mkDoc = () => mkFrame().contentDocument;

function mkLoadDrafts() {
  try {
    return JSON.parse(localStorage.getItem(MK_DRAFT_KEY) || '[]');
  } catch (e) {
    return [];
  }
}

function mkStoreDrafts(list) {
  try {
    localStorage.setItem(MK_DRAFT_KEY, JSON.stringify(list));
    return true;
  } catch (e) {
    alert('草稿存不下（瀏覽器儲存空間不足，常見原因是放了很大的上傳圖片）。請改用「下載 HTML」留存，或把圖片改成網址。');
    return false;
  }
}

function mkEsc(t) {
  return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

function mkRenderLists() {
  const t = document.getElementById('mk-templates');
  t.innerHTML = '';
  MK_TEMPLATES.forEach((tpl) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn-secondary mk-tpl';
    b.innerHTML = `${mkEsc(tpl.name)}<small>${mkEsc(tpl.desc)}</small>`;
    b.onclick = () => mkOpenTemplate(tpl);
    t.appendChild(b);
  });
  const d = document.getElementById('mk-drafts');
  const drafts = mkLoadDrafts();
  d.innerHTML = drafts.length ? '' : '<div class="calc-hint" style="margin-top:6px;">還沒有草稿</div>';
  drafts
    .slice()
    .sort((a, b) => String(b.updated).localeCompare(String(a.updated)))
    .forEach((dr) => {
      const row = document.createElement('div');
      row.className = 'mk-draft-row';
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn-secondary mk-draft';
      b.innerHTML = `${mkEsc(dr.name)}<small>${mkEsc(dr.updated)}</small>`;
      b.onclick = () => mkOpenDraft(dr.id);
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'btn-mini';
      x.textContent = '✕';
      x.title = '刪除草稿';
      x.onclick = () => {
        if (!confirm(`刪除草稿「${dr.name}」？`)) return;
        mkStoreDrafts(mkLoadDrafts().filter((y) => y.id !== dr.id));
        if (mkCur && mkCur.draftId === dr.id) mkCur.draftId = null;
        mkRenderLists();
      };
      row.appendChild(b);
      row.appendChild(x);
      d.appendChild(row);
    });
}

function mkConfirmLeave() {
  return !mkDirty || confirm('目前的內容還沒儲存草稿 / 下載，確定要離開嗎？');
}

async function mkOpenTemplate(tpl) {
  if (!mkConfirmLeave()) return;
  let html;
  try {
    const r = await fetch(`templates/marketing/${tpl.file}?v=${Date.now()}`);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    html = await r.text();
  } catch (e) {
    return alert('讀取範本失敗：' + e.message);
  }
  mkCur = { draftId: null, templateId: tpl.id };
  document.getElementById('mk-name').value = tpl.name;
  mkOpenEditor(html);
}

function mkOpenDraft(id) {
  if (!mkConfirmLeave()) return;
  const dr = mkLoadDrafts().find((x) => x.id === id);
  if (!dr) return;
  mkCur = { draftId: dr.id, templateId: dr.templateId };
  document.getElementById('mk-name').value = dr.name;
  mkOpenEditor(dr.html);
}

function mkOpenEditor(html) {
  document.getElementById('mk-empty').style.display = 'none';
  document.getElementById('mk-editor').style.display = '';
  document.getElementById('mk-width').value = '190mm';
  mkSetWidth('190mm');
  const f = mkFrame();
  const doc = f.contentDocument;
  doc.open();
  doc.write(html);
  doc.close();
  mkUndoStack = [];
  mkSel = null;
  mkDirty = false;
  mkUpdateSelLabel();
  const ready = () => {
    mkPrepareDoc();
    document.getElementById('mk-title').value = mkDoc().title || '';
    mkFit();
  };
  // 等圖片載入再量高度
  setTimeout(ready, 50);
  Array.from(doc.images).forEach((img) => {
    if (!img.complete) img.addEventListener('load', mkFit);
  });
}

/** 讓內容可編輯，並裝上點選 / 輸入的監聽。 */
function mkPrepareDoc() {
  const doc = mkDoc();
  if (!doc || !doc.body || doc.getElementById('mk-edit-style')) return;
  const st = doc.createElement('style');
  st.id = 'mk-edit-style';
  st.textContent = '[data-mk-sel]{outline:2px dashed #e67e22 !important;outline-offset:2px;}img{cursor:pointer;}a{cursor:text;}body{caret-color:#e67e22;}[data-mk-pb]{border-top:2px dotted #c0392b;position:relative;}[data-mk-pb]::after{content:"— 從這裡換頁 —";position:absolute;right:0;top:2px;font:12px sans-serif;color:#c0392b;}';
  doc.head.appendChild(st);
  doc.body.contentEditable = 'true';
  doc.body.spellcheck = false;
  doc.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a');
    if (a) e.preventDefault(); // 編輯時不要跳轉
    mkSelect(e.target);
  });
  doc.addEventListener('input', () => {
    mkDirty = true;
    mkFit();
  });
  doc.addEventListener('keyup', (e) => {
    const s = doc.getSelection();
    if (s && s.anchorNode && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      const n = s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement;
      if (n && n !== doc.body) mkSelect(n);
    }
  });
}

function mkFit() {
  const f = mkFrame();
  const d = f.contentDocument;
  if (!d || !d.documentElement) return;
  mkDrawGuides();
  f.style.height = Math.max(600, d.documentElement.scrollHeight + 20) + 'px';
}

// ---------------- PDF 分頁線 ----------------
// 列印時固定 A4、上下左右各留 10mm（mkPrint 會寫進 @page），所以每頁可用高度 277mm、寬度 190mm。
// 預覽寬度選「PDF（A4 寬）」時，在每 277mm 的位置畫紅色虛線 = 該頁結尾；手動「此處換頁」會推到下一頁開頭。
const MK_PAGE_MM = 277;

function mkMmToPx(mm) {
  return (mm * 96) / 25.4;
}

function mkDrawGuides() {
  const doc = mkDoc();
  if (!doc || !doc.body) return;
  const old = doc.getElementById('mk-guides');
  if (old) old.remove();
  const pageH = mkMmToPx(MK_PAGE_MM);
  const pbs = Array.from(doc.querySelectorAll('[data-mk-pb]'));
  const pdfMode = document.getElementById('mk-width').value === '190mm';
  // 手動換頁：用空白墊高模擬「下一頁才開始」（輸出時會移除墊高，改由瀏覽器真正換頁）
  pbs.forEach((e) => (e.style.height = '0px'));
  if (pdfMode) {
    pbs.forEach((e) => {
      const top = e.getBoundingClientRect().top + doc.defaultView.scrollY;
      const into = top % pageH;
      e.style.height = into > 1 ? pageH - into + 'px' : '0px';
    });
  }
  const label = document.getElementById('mk-pages');
  if (!pdfMode) {
    if (label) label.textContent = '';
    return;
  }
  const total = Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight);
  const pages = Math.max(1, Math.ceil((total - 2) / pageH));
  if (label) label.textContent = `約 ${pages} 頁`;
  if (!document.getElementById('mk-guide').checked) return;
  const box = doc.createElement('div');
  box.id = 'mk-guides';
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

function mkPageBreak() {
  if (!mkNeedSel()) return;
  const prev = mkSel.previousElementSibling;
  if (prev && prev.hasAttribute('data-mk-pb')) {
    mkPushUndo();
    prev.remove(); // 再按一次 = 取消換頁
    mkDirty = true;
    return mkFit();
  }
  mkPushUndo();
  const b = mkDoc().createElement('div');
  b.setAttribute('data-mk-pb', '1');
  b.setAttribute('style', 'break-before:page;page-break-before:always;height:0px;');
  mkSel.before(b);
  mkDirty = true;
  mkFit();
}

function mkSetWidth(w) {
  const f = mkFrame();
  f.style.width = w;
  f.style.margin = w === '100%' ? '0' : '0 auto';
  setTimeout(mkFit, 100);
}

// ---------------- 選取 ----------------
function mkSelect(el) {
  const doc = mkDoc();
  if (mkSel) mkSel.removeAttribute('data-mk-sel');
  mkSel = el && el !== doc.body && el !== doc.documentElement && el.nodeType === 1 ? el : null;
  if (mkSel) mkSel.setAttribute('data-mk-sel', '1');
  mkUpdateSelLabel();
}

function mkUpdateSelLabel() {
  const l = document.getElementById('mk-sel');
  if (!mkSel) {
    l.textContent = '點一下畫面上的元素可選取（橘色虛線框）。';
    return;
  }
  const cls = (mkSel.className || '').toString().trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
  l.textContent = `已選取：<${mkSel.tagName.toLowerCase()}${cls ? '.' + cls : ''}>`;
}

function mkSelParent() {
  if (!mkSel) return alert('請先點一下畫面上的元素');
  const p = mkSel.parentElement;
  if (!p || p === mkDoc().body) return alert('已經是最上層了');
  mkSelect(p);
}

// ---------------- 還原（區塊 / 取代 / 換圖用） ----------------
function mkPushUndo() {
  const doc0 = mkDoc();
  const g = doc0.getElementById('mk-guides');
  if (g) g.remove();
  const body = doc0.body;
  const had = mkSel;
  if (had) had.removeAttribute('data-mk-sel');
  mkUndoStack.push(body.innerHTML);
  if (mkUndoStack.length > 30) mkUndoStack.shift();
  if (had) had.setAttribute('data-mk-sel', '1');
}

function mkUndo() {
  if (!mkUndoStack.length) return alert('沒有可以還原的區塊操作（文字修改請在畫面上按 Ctrl+Z）');
  mkDoc().body.innerHTML = mkUndoStack.pop();
  mkSel = null;
  mkUpdateSelLabel();
  mkDirty = true;
  mkFit();
}

// ---------------- 文字格式 ----------------
function mkCmd(cmd, val) {
  const doc = mkDoc();
  mkFrame().contentWindow.focus();
  doc.execCommand('styleWithCSS', false, true);
  doc.execCommand(cmd, false, val || null);
  mkDirty = true;
  mkFit();
}

function mkFontSize(px) {
  if (!px) return;
  const doc = mkDoc();
  const s = doc.getSelection();
  if (!s || s.isCollapsed) return alert('請先在畫面上選取要改大小的文字');
  mkFrame().contentWindow.focus();
  doc.execCommand('styleWithCSS', false, false);
  doc.execCommand('fontSize', false, '7');
  doc.querySelectorAll('font[size="7"]').forEach((f) => {
    const span = doc.createElement('span');
    span.style.fontSize = px + 'px';
    while (f.firstChild) span.appendChild(f.firstChild);
    f.replaceWith(span);
  });
  mkDirty = true;
  mkFit();
}

function mkLink() {
  const doc = mkDoc();
  const s = doc.getSelection();
  let a = mkSel && mkSel.closest('a');
  if (!a && s && s.anchorNode) {
    const n = s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement;
    a = n && n.closest('a');
  }
  if (a) {
    const url = prompt('連結網址（可用 https://、mailto:、tel:；清空會移除連結）：', a.getAttribute('href') || '');
    if (url == null) return;
    mkPushUndo();
    if (url.trim()) a.setAttribute('href', url.trim());
    else a.replaceWith(...a.childNodes);
  } else {
    if (!s || s.isCollapsed) return alert('請先選取要加連結的文字，或點一下既有的連結 / 按鈕');
    const url = prompt('連結網址（例如 https://…、mailto:abc@xxx.com、tel:0912…）：', 'https://');
    if (!url || url === 'https://') return;
    mkPushUndo();
    mkFrame().contentWindow.focus();
    doc.execCommand('createLink', false, url.trim());
  }
  mkDirty = true;
}

// ---------------- 區塊操作 ----------------
function mkNeedSel() {
  if (!mkSel) {
    alert('請先點一下要操作的區塊（會出現橘色虛線框）；選到太小的元素可按「⬆ 選上一層」。');
    return false;
  }
  return true;
}

function mkDup() {
  if (!mkNeedSel()) return;
  mkPushUndo();
  const c = mkSel.cloneNode(true);
  c.removeAttribute('data-mk-sel');
  mkSel.after(c);
  mkDirty = true;
  mkFit();
}

function mkDel() {
  if (!mkNeedSel()) return;
  if (!confirm('刪除目前選取的區塊？（可用「↶ 還原區塊操作」救回來）')) return;
  mkPushUndo();
  mkSel.remove();
  mkSel = null;
  mkUpdateSelLabel();
  mkDirty = true;
  mkFit();
}

function mkMove(dir) {
  if (!mkNeedSel()) return;
  const sib = dir < 0 ? mkSel.previousElementSibling : mkSel.nextElementSibling;
  if (!sib) return alert(dir < 0 ? '已經在最上面了' : '已經在最下面了');
  mkPushUndo();
  if (dir < 0) sib.before(mkSel);
  else sib.after(mkSel);
  mkSel.scrollIntoView({ block: 'nearest' });
  mkDirty = true;
}

// ---------------- 圖片 ----------------
function mkSelectedImg() {
  if (!mkSel) return null;
  return mkSel.tagName === 'IMG' ? mkSel : mkSel.querySelector('img');
}

function mkImage(mode) {
  const img = mkSelectedImg();
  if (!img) return alert('請先點一下要換的圖片');
  if (mode === 'url') {
    const url = prompt('新的圖片網址：', img.getAttribute('src') || '');
    if (!url || !url.trim()) return;
    mkPushUndo();
    img.setAttribute('src', url.trim());
    img.removeAttribute('srcset');
    mkDirty = true;
    img.addEventListener('load', mkFit, { once: true });
    return;
  }
  const inp = document.getElementById('mk-file');
  inp.value = '';
  inp.onchange = () => {
    const file = inp.files && inp.files[0];
    if (!file) return;
    mkReadImage(file).then((data) => {
      mkPushUndo();
      img.setAttribute('src', data);
      img.removeAttribute('srcset');
      mkDirty = true;
      img.addEventListener('load', mkFit, { once: true });
    });
  };
  inp.click();
}

/** 讀圖片並縮到最寬 1200px（JPEG / PNG 維持），避免 HTML 檔變太大。 */
function mkReadImage(file) {
  return new Promise((resolve) => {
    const fr = new FileReader();
    fr.onload = () => {
      if (/svg|gif/.test(file.type)) return resolve(fr.result);
      const im = new Image();
      im.onload = () => {
        const r = Math.min(1, 1200 / im.width);
        const c = document.createElement('canvas');
        c.width = Math.round(im.width * r);
        c.height = Math.round(im.height * r);
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
        resolve(c.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.85));
      };
      im.onerror = () => resolve(fr.result);
      im.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}

// ---------------- 尋找取代 ----------------
function mkReplaceAll() {
  const from = prompt('要尋找的文字或網址（例如舊的電話、Email）：');
  if (!from) return;
  const to = prompt(`把「${from}」取代成：`, '');
  if (to == null) return;
  const doc = mkDoc();
  mkPushUndo();
  let n = 0;
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach((t) => {
    if (t.nodeValue.includes(from)) {
      n += t.nodeValue.split(from).length - 1;
      t.nodeValue = t.nodeValue.split(from).join(to);
    }
  });
  doc.body.querySelectorAll('[href],[src]').forEach((e) => {
    ['href', 'src'].forEach((a) => {
      const v = e.getAttribute(a);
      if (v && v.includes(from)) {
        n += v.split(from).length - 1;
        e.setAttribute(a, v.split(from).join(to));
      }
    });
  });
  if (!n) mkUndoStack.pop();
  else mkDirty = true;
  alert(n ? `已取代 ${n} 處` : '找不到這段文字');
  mkFit();
}

// ---------------- 輸出 ----------------
/** 乾淨的最終 HTML：拿掉編輯用的屬性與樣式。 */
function mkFinalHtml() {
  const doc = mkDoc();
  const clone = doc.documentElement.cloneNode(true);
  const st = clone.querySelector('#mk-edit-style');
  if (st) st.remove();
  const gd = clone.querySelector('#mk-guides');
  if (gd) gd.remove();
  clone.querySelectorAll('[data-mk-pb]').forEach((e) => {
    e.style.height = '0px';
    e.removeAttribute('data-mk-pb');
  });
  clone.querySelectorAll('[data-mk-sel]').forEach((e) => e.removeAttribute('data-mk-sel'));
  clone.querySelectorAll('[contenteditable]').forEach((e) => e.removeAttribute('contenteditable'));
  clone.querySelectorAll('[spellcheck]').forEach((e) => e.removeAttribute('spellcheck'));
  const title = document.getElementById('mk-title').value.trim();
  const t = clone.querySelector('title');
  if (title) {
    if (t) t.textContent = title;
    else {
      const nt = doc.createElement('title');
      nt.textContent = title;
      clone.querySelector('head').prepend(nt);
    }
  }
  return '<!DOCTYPE html>\n' + clone.outerHTML;
}

function mkFilename(ext) {
  const n = (document.getElementById('mk-name').value.trim() || '行銷宣傳').replace(/[\\/:*?"<>|]+/g, '_');
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `${n}_${ymd}.${ext}`;
}

function mkDownload() {
  const html = mkFinalHtml();
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = mkFilename('html');
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  mkDirty = false;
  const mb = blob.size / 1024 / 1024;
  if (mb > 1) alert(`檔案約 ${mb.toFixed(1)} MB（含上傳的圖片）。寄 EDM 建議把圖片放在網路空間，改用「換圖片（網址）」，信件才不會太大。`);
}

async function mkCopyHtml() {
  const html = mkFinalHtml();
  try {
    await navigator.clipboard.writeText(html);
    alert('已複製 HTML 原始碼');
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = html;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    alert('已複製 HTML 原始碼');
  }
}

/** 把乾淨版放進隱藏 iframe，全選複製：貼到 Gmail / Outlook 會保留排版與圖片。 */
function mkCopyRich() {
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;left:-9999px;top:0;width:800px;height:600px;border:0;';
  document.body.appendChild(f);
  const d = f.contentDocument;
  d.open();
  d.write(mkFinalHtml());
  d.close();
  setTimeout(() => {
    f.contentWindow.focus();
    d.getSelection().selectAllChildren(d.body);
    const ok = d.execCommand('copy');
    f.remove();
    alert(ok ? '已複製畫面內容，到信件編輯區按 Ctrl+V 貼上。\n（部分排版如多欄格線，貼進不同郵件軟體可能略有差異，寄出前請先寄給自己確認。）' : '複製失敗，請改用「下載 HTML」或「複製 HTML 碼」');
  }, 300);
}

function mkPrint() {
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(f);
  const d = f.contentDocument;
  d.open();
  // 固定 A4 + 10mm 邊界，分頁位置才會跟預覽的紅色分頁線一致
  d.write(mkFinalHtml().replace('</head>', '<style>@page{size:A4;margin:10mm;}body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}</style></head>'));
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

// ---------------- 草稿 ----------------
function mkSaveDraft() {
  const name = document.getElementById('mk-name').value.trim();
  if (!name) return alert('請先填檔案名稱');
  const list = mkLoadDrafts();
  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const html = mkFinalHtml();
  let dr = mkCur.draftId && list.find((x) => x.id === mkCur.draftId);
  if (dr) {
    dr.name = name;
    dr.html = html;
    dr.updated = stamp;
  } else {
    dr = { id: 'd' + Date.now(), name, templateId: mkCur.templateId, html, updated: stamp };
    list.push(dr);
    mkCur.draftId = dr.id;
  }
  if (!mkStoreDrafts(list)) return;
  mkDirty = false;
  mkRenderLists();
  alert('草稿已儲存');
}

window.addEventListener('beforeunload', (e) => {
  if (mkDirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});

mkRenderLists();
