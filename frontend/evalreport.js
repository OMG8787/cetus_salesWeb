/**
 * evalreport.js - 評估報告編輯器 頁面專屬邏輯
 * ------------------------------------------------------------
 * 左邊編輯「區塊」、右邊即時 A4 預覽；最終 HTML 由 evalreport-render.js 的 buildReportHtml() 產生。
 *
 * 資料來源：
 *   - 案件基本資料、CCD 需求 → 自動產生「基本資訊 / 原始需求 / FAE 方案」表格
 *     （FAE 方案會解析選型計算存回 CCD 的【選型計算】區塊，自動填相機、鏡頭、視野、空間解析度、延伸環）
 *   - 案件附件中的圖片 → 「帶入案件圖片」
 *   - 其他內容自己加：文字、圖片（上傳 / 拖曳 / Ctrl+V 貼上截圖）、圖文並排、重點框、簽核欄、分頁
 * 草稿自動存在這台電腦的瀏覽器（IndexedDB），完成後可列印成 PDF、下載 HTML，或存到案件附件。
 * ------------------------------------------------------------
 */

const DRAFT_PREFIX = 'evalreport_';
const BRAND_KEY = 'aoi_evalreport_brand';
const IMAGE_EXT = /\.(jpe?g|png|gif|bmp|webp)$/i;

const BLOCK_TYPES = {
  cover: { label: '封面', icon: '📘' },
  heading: { label: '章節標題', icon: '🔖' },
  table: { label: '表格', icon: '▦' },
  text: { label: '文字', icon: '✎' },
  images: { label: '圖片', icon: '🖼' },
  imageText: { label: '圖文並排', icon: '◧' },
  callout: { label: '重點框', icon: '❗' },
  signature: { label: '簽核欄', icon: '✍' },
  pagebreak: { label: '分頁', icon: '⤓' },
};

let report = null;
let caseData = null;
let defaultLogo = '';
let activeBlockId = null;
const collapsed = new Set();

// ------------------------------------------------------------
// 產品型號（相機/鏡頭/光源...）：表格欄位下拉建議、找不到就問要不要存進產品資料表，
// 也是「依報告型號詢價/報價」的資料來源
// ------------------------------------------------------------
const MODEL_FIELD_CATEGORY = { 相機型號: '相機', 鏡頭型號: '鏡頭', 光源: '光源', 光源控制器: '調光器' };
const MODEL_FIELD_LABELS = Object.keys(MODEL_FIELD_CATEGORY);
let productCatalog = [];
let quoteModelItems = [];

// ------------------------------------------------------------
// 小工具
// ------------------------------------------------------------
const $ = (id) => document.getElementById(id);

function newId() {
  return 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([k, v]) => {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? '' : v);
  });
  (children || []).forEach((c) => c && node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
  return node;
}

function readJsonLocal(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch (e) {
    return null;
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** 圖片縮到長邊 maxSide 以內，照片轉 JPEG，減少報告檔案大小（變大就維持原圖）。 */
async function compressDataUrl(dataUrl, maxSide, quality) {
  try {
    const img = await loadImage(dataUrl);
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const scale = Math.min(1, (maxSide || 1800) / Math.max(w, h));
    if (scale === 1 && dataUrl.length < 700 * 1024) return dataUrl;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d');
    const keepPng = /^data:image\/png/.test(dataUrl) && dataUrl.length < 3 * 1024 * 1024;
    if (!keepPng) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const out = keepPng ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', quality || 0.86);
    return out.length < dataUrl.length ? out : dataUrl;
  } catch (e) {
    return dataUrl;
  }
}

async function filesToImages(files) {
  const list = [...(files || [])].filter((f) => /^image\//.test(f.type));
  const out = [];
  for (const f of list) {
    const src = await compressDataUrl(await fileToDataUrl(f));
    out.push({ src, caption: f.name && !/^image\.\w+$/i.test(f.name) ? f.name.replace(/\.[^.]+$/, '') : '' });
  }
  return out;
}

function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function safeFilename(name) {
  return String(name).replace(/[\\/:*?"<>|\s]+/g, '_');
}

// ------------------------------------------------------------
// 草稿儲存（IndexedDB，圖片多也放得下；不支援時退回 localStorage）
// ------------------------------------------------------------
const DraftStore = (() => {
  let dbPromise = null;
  const open = () =>
    dbPromise ||
    (dbPromise = new Promise((resolve, reject) => {
      // 有些環境（例如直接用 file:// 開、無痕視窗）IndexedDB 會卡住不回應，3 秒沒開成就改用 localStorage
      const timer = setTimeout(() => reject(new Error('IndexedDB timeout')), 3000);
      const req = indexedDB.open('aoi_reports', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('drafts');
      req.onsuccess = () => { clearTimeout(timer); resolve(req.result); };
      req.onerror = () => { clearTimeout(timer); reject(req.error); };
    }));
  const run = async (mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('drafts', mode);
      const req = fn(tx.objectStore('drafts'));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
    });
  };
  return {
    async get(key) {
      try {
        return await run('readonly', (s) => s.get(key));
      } catch (e) {
        return readJsonLocal(key);
      }
    },
    async set(key, value) {
      try {
        await run('readwrite', (s) => s.put(value, key));
      } catch (e) {
        localStorage.setItem(key, JSON.stringify(value)); // 失敗會丟例外，由呼叫端顯示
      }
    },
  };
})();

// ------------------------------------------------------------
// 從案件資料產生報告內容
// ------------------------------------------------------------
function defaultTheme() {
  return Object.assign(
    {
      preset: 'cetus',
      primary: REPORT_THEMES.cetus.primary,
      dark: REPORT_THEMES.cetus.dark,
      textColor: '#2b2b2b',
      font: 'jhenghei',
      baseSize: 14,
      companyName: '鑫堡股份有限公司',
      companySub: 'AOI Vision Inspection Solution',
      logo: '',
      watermark: true,
      watermarkText: '鑫堡股份有限公司',
      title: 'FAE 評估報告',
      numbering: true,
      footerText: '本文件為 鑫堡股份有限公司 AOI 視覺檢測評估報告\n文件內容涉及技術與商業資訊，禁止未經授權轉載、散佈或商業使用',
      footerBless: 'Thank you for your trust and support.',
      coverNote: '本報告內容僅供評估參考，實際效果以現場驗證為準',
    },
    readJsonLocal(BRAND_KEY) || {}
  );
}

/** CCD 說明裡選型計算頁存進來的【選型計算】區塊，不放進「檢測需求」原文。 */
function stripCalcBlock(desc) {
  return String(desc || '').replace(/\n*【選型計算】[\s\S]*$/, '').trim();
}

/** 解析【選型計算】區塊，帶出相機、鏡頭、視野、空間解析度、延伸環。 */
function parseCalcBlock(desc) {
  const m = String(desc || '').match(/【選型計算】[\s\S]*$/);
  if (!m) return {};
  const t = m[0];
  const get = (re) => {
    const r = t.match(re);
    return r ? r[1].trim() : '';
  };
  return {
    camera: get(/^相機：(.+)$/m),
    lens: get(/^鏡頭：(.+)$/m),
    fov: get(/實際視野 ([\d.]+ × [\d.]+) mm/),
    resolution: get(/空間解析度 ([\d.]+ µm\/px(?:（[^）]*）)?)/),
    feature: get(/最小特徵佔 ([\d.]+ px)/),
    ring: get(/延伸環約 ([\d.]+) mm/),
    wd: get(/WD ([\d.]+) mm）/),
  };
}

function accuracyText(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  if (/^[+＋]/.test(s)) return `${s} µm（只能多）`;
  if (/^[-−－]/.test(s)) return `${s} µm（只能少）`;
  return `${/^±/.test(s) ? s : '±' + s} µm`;
}

function infoRows(c) {
  const sw = c.SoftwareCustomization ? `${c.SoftwareCustomization}${c.SoftwareCustomizationNote ? `（${c.SoftwareCustomizationNote}）` : ''}` : '';
  return [
    { k: '案件編號', v: c.CaseID || '', auto: true },
    { k: '客戶名稱', v: c.CustomerName || '', auto: true },
    { k: '終端客戶', v: c.EndCustomerName || '', auto: true },
    { k: '專案聯絡人', v: [c.ProjectContact, c.ContactPhone].filter(Boolean).join(' / '), auto: true },
    { k: '業務', v: c.Salesperson || '', auto: true },
    { k: 'FAE', v: c.FAE || '', auto: true },
    { k: '產品應用', v: c.ProductApplication || '', auto: true },
    { k: '待測物件', v: c.TestObject || '', auto: true },
    { k: '使用軟體', v: c.SoftwareName || '', auto: true },
    { k: '軟體客製化', v: sw, auto: true },
    { k: '需求描述', v: c.RequirementDetails || '', wide: true, auto: true },
  ];
}

function reqRows(ccd) {
  const fov = ccd.FovLengthMm || ccd.FovWidthMm ? `${ccd.FovLengthMm || '-'} × ${ccd.FovWidthMm || '-'}` : '';
  return [
    { k: '檢測需求', v: stripCalcBlock(ccd.Description), wide: true, auto: true },
    { k: 'FOV (mm)', v: fov, auto: true },
    { k: 'WD (mm)', v: ccd.WdMm || '', auto: true },
    { k: '精度', v: accuracyText(ccd.AccuracyUm), auto: true },
    { k: '光源限制', v: ccd.LightingNote || '', auto: true },
    { k: '飛拍速度 (mm/s)', v: ccd.FlyingSpeedMmS || '', auto: true },
    { k: '檢測速度 (pcs/s)', v: ccd.InspectionSpeedPs || '', auto: true },
  ];
}

function planRows(ccd) {
  const p = parseCalcBlock(ccd.Description);
  return [
    { k: '相機型號', v: p.camera || '', auto: true },
    { k: '鏡頭型號', v: p.lens || '', auto: true },
    { k: '延伸環', v: p.ring ? `${p.ring} mm` : '', auto: true },
    { k: 'WD (mm)', v: p.wd || ccd.WdMm || '', auto: true },
    { k: 'FOV (mm)', v: p.fov || '', auto: true },
    { k: '空間解析度', v: p.resolution || '', auto: true },
    { k: '光源', v: '' },
    { k: '光源控制器', v: '' },
    { k: '測試結論', v: '', wide: true },
  ];
}

function projectLine(c) {
  return [c.SoftwareName, c.TestObject, c.ProductApplication].filter(Boolean).join(' ／ ');
}

function headingBlock(text) {
  return { id: newId(), type: 'heading', text };
}

function buildBlocksFromCase(c) {
  const ccds = c.CcdRequirements || [];
  const blocks = [
    { id: newId(), type: 'cover', source: 'cover', kicker: 'AOI VISION INSPECTION REPORT', title: '', subtitle: projectLine(c), customer: c.CustomerName || '', image: '' },
    headingBlock('基本資訊'),
    { id: newId(), type: 'table', source: 'info', title: '', badge: '', rows: infoRows(c) },
    headingBlock('原始需求分析'),
  ];
  if (!ccds.length) blocks.push({ id: newId(), type: 'text', html: '（此案件尚未填寫 CCD 檢測需求）' });
  ccds.forEach((ccd, i) => blocks.push({ id: newId(), type: 'table', source: `req:${i}`, badge: `CCD${i + 1}`, title: '檢測需求', rows: reqRows(ccd) }));
  blocks.push(headingBlock('FAE 評估方案'));
  ccds.forEach((ccd, i) => blocks.push({ id: newId(), type: 'table', source: `plan:${i}`, badge: `CCD${i + 1}`, title: '方案規格', rows: planRows(ccd) }));
  blocks.push(headingBlock('測試影像'));
  blocks.push({ id: newId(), type: 'images', source: 'caseImages', title: '', columns: 2, width: 80, align: 'center', items: [] });
  blocks.push(headingBlock('評估結論'));
  blocks.push({ id: newId(), type: 'callout', source: 'conclusion', variant: 'conclusion', title: '評估結論', html: c.EvaluationResult ? textToHtml(c.EvaluationResult) : '' });
  blocks.push({
    id: newId(),
    type: 'signature',
    slots: [
      { label: '撰寫（FAE）', name: c.FAE || '', date: '' },
      { label: '審核', name: '', date: '' },
      { label: '客戶確認', name: '', date: '' },
    ],
  });
  return blocks;
}

function newReport(c) {
  const d = todayStr();
  return {
    caseId: c.CaseID,
    theme: defaultTheme(),
    meta: { reportNo: `ER-${d.replace(/-/g, '')}-01`, date: d, author: c.FAE || sessionStorage.getItem('displayName') || currentUsername || '', version: 'V1.0' },
    blocks: buildBlocksFromCase(c),
  };
}

/**
 * 用案件最新資料更新「自動產生」的區塊：自動欄位（auto）覆蓋，
 * 自己填的欄位（光源、控制器、測試結論…）保留；自己新增的區塊完全不動。
 */
function refillFromCase() {
  if (!report || !caseData) return;
  const c = caseData;
  const ccds = c.CcdRequirements || [];
  const mergeRows = (oldRows, newRows) =>
    newRows.map((nr) => {
      const old = (oldRows || []).find((r) => r.k === nr.k);
      if (!old) return nr;
      return nr.auto ? Object.assign({}, old, { v: nr.v, auto: true }) : old;
    }).concat((oldRows || []).filter((r) => !newRows.some((nr) => nr.k === r.k)));

  report.blocks.forEach((b) => {
    if (b.source === 'info') b.rows = mergeRows(b.rows, infoRows(c));
    else if (b.source === 'cover') {
      b.customer = c.CustomerName || b.customer;
      if (!b.subtitle) b.subtitle = projectLine(c);
    } else if (b.source && b.source.startsWith('req:')) {
      const ccd = ccds[+b.source.slice(4)];
      if (ccd) b.rows = mergeRows(b.rows, reqRows(ccd));
    } else if (b.source && b.source.startsWith('plan:')) {
      const ccd = ccds[+b.source.slice(5)];
      if (ccd) b.rows = mergeRows(b.rows, planRows(ccd));
    } else if (b.source === 'conclusion' && !stripHtml(b.html) && c.EvaluationResult) {
      b.html = textToHtml(c.EvaluationResult);
    }
  });

  // 案件後來新增的 CCD：補在最後一個同類表格後面
  ['req', 'plan'].forEach((kind) => {
    ccds.forEach((ccd, i) => {
      if (report.blocks.some((b) => b.source === `${kind}:${i}`)) return;
      const lastIdx = report.blocks.map((b) => (b.source || '').startsWith(kind + ':')).lastIndexOf(true);
      const block = { id: newId(), type: 'table', source: `${kind}:${i}`, badge: `CCD${i + 1}`, title: kind === 'req' ? '檢測需求' : '方案規格', rows: kind === 'req' ? reqRows(ccd) : planRows(ccd) };
      report.blocks.splice(lastIdx >= 0 ? lastIdx + 1 : report.blocks.length, 0, block);
    });
  });
  renderBlocks();
  changed();
  alert('已用案件最新資料更新自動產生的表格（自己填的欄位與自己加的區塊都保留）');
}

function stripHtml(html) {
  const d = document.createElement('div');
  d.innerHTML = html || '';
  return d.textContent.trim();
}

/** 把案件附件裡的圖片帶進「測試影像」區塊（沒有就在結論前面新增一個）。 */
async function importCaseImages() {
  if (!report) return alert('請先選擇案件');
  const result = await callApi('getCaseImages', { caseId: report.caseId });
  if (!result.success) return alert(result.message || '讀取圖片失敗');
  const images = result.images || [];
  if (!images.length) {
    return alert('這個案件的附件裡沒有圖片（jpg / png / gif / bmp / webp）。可以先到案件管理上傳，或在圖片區塊直接上傳 / 貼上。');
  }

  let target = report.blocks.find((b) => b.source === 'caseImages');
  if (!target) {
    target = { id: newId(), type: 'images', source: 'caseImages', title: '', columns: 2, width: 80, align: 'center', items: [] };
    const conclusionIdx = report.blocks.findIndex((b) => b.source === 'conclusion');
    const at = conclusionIdx > 0 ? conclusionIdx - 1 : report.blocks.length;
    report.blocks.splice(at, 0, headingBlock('測試影像'), target);
  }

  showLoading();
  let added = 0;
  try {
    for (const img of images) {
      if (target.items.some((it) => it.fileId && it.fileId === img.fileId)) continue;
      const src = await compressDataUrl(`data:${img.mimeType || 'image/jpeg'};base64,${img.base64}`);
      target.items.push({ src, caption: String(img.name || '').replace(/\.[^.]+$/, ''), fileId: img.fileId });
      added++;
    }
  } finally {
    hideLoading();
  }
  activeBlockId = target.id;
  collapsed.delete(target.id);
  renderBlocks();
  changed();
  const skipped = (result.skipped || []).length ? `\n（${result.skipped.length} 張太大或讀取失敗未帶入：${result.skipped.join('、')}）` : '';
  alert(`已帶入 ${added} 張圖片${added < images.length ? `（${images.length - added} 張已經在報告裡）` : ''}${skipped}`);
}

// ------------------------------------------------------------
// 區塊編輯
// ------------------------------------------------------------
function blockDefaults(type) {
  switch (type) {
    case 'cover':
      return { kicker: 'AOI VISION INSPECTION REPORT', title: '', subtitle: caseData ? projectLine(caseData) : '', customer: caseData ? caseData.CustomerName : '', image: '' };
    case 'heading':
      return { text: '新章節' };
    case 'table':
      return { title: '', badge: '', rows: [{ k: '項目', v: '' }, { k: '項目', v: '' }] };
    case 'text':
      return { html: '' };
    case 'images':
      return { title: '', columns: 1, width: 80, align: 'center', items: [] };
    case 'imageText':
      return { title: '', side: 'left', imageWidth: 45, src: '', caption: '', html: '' };
    case 'callout':
      return { variant: 'suggest', title: '建議', html: '' };
    case 'signature':
      return { slots: [{ label: '撰寫（FAE）', name: '', date: '' }, { label: '審核', name: '', date: '' }, { label: '客戶確認', name: '', date: '' }] };
    default:
      return {};
  }
}

/** 新區塊插在目前選取的區塊後面（沒選就放最後）。 */
function addBlock(type) {
  if (!report) return alert('請先選擇案件');
  const block = Object.assign({ id: newId(), type }, blockDefaults(type));
  const idx = report.blocks.findIndex((b) => b.id === activeBlockId);
  if (type === 'cover') report.blocks.unshift(block);
  else report.blocks.splice(idx >= 0 ? idx + 1 : report.blocks.length, 0, block);
  activeBlockId = block.id;
  renderBlocks();
  changed();
  scrollEditorTo(block.id);
}

function moveBlock(id, dir) {
  const i = report.blocks.findIndex((b) => b.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= report.blocks.length) return;
  [report.blocks[i], report.blocks[j]] = [report.blocks[j], report.blocks[i]];
  renderBlocks();
  changed();
  scrollEditorTo(id);
}

function duplicateBlock(id) {
  const i = report.blocks.findIndex((b) => b.id === id);
  if (i < 0) return;
  const copy = JSON.parse(JSON.stringify(report.blocks[i]));
  copy.id = newId();
  delete copy.source; // 複製出來的就是自己的區塊，重新帶入時不會被覆蓋
  report.blocks.splice(i + 1, 0, copy);
  activeBlockId = copy.id;
  renderBlocks();
  changed();
}

function deleteBlock(id) {
  const b = report.blocks.find((x) => x.id === id);
  if (!b) return;
  if (!confirm(`確定要刪除這個「${BLOCK_TYPES[b.type].label}」區塊嗎？`)) return;
  report.blocks = report.blocks.filter((x) => x.id !== id);
  renderBlocks();
  changed();
}

function setActiveBlock(id, fromPreview) {
  activeBlockId = id;
  document.querySelectorAll('.er-block').forEach((n) => n.classList.toggle('active', n.dataset.id === id));
  highlightPreview(id, !fromPreview);
  if (fromPreview) {
    collapsed.delete(id);
    const card = document.querySelector(`.er-block[data-id="${id}"]`);
    if (card && card.classList.contains('collapsed')) renderBlocks();
    scrollEditorTo(id);
  }
}

function scrollEditorTo(id) {
  const card = document.querySelector(`.er-block[data-id="${id}"]`);
  if (card) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function blockSummary(b) {
  switch (b.type) {
    case 'heading':
      return b.text;
    case 'table':
      return [b.badge, b.title].filter(Boolean).join(' ') || `${(b.rows || []).length} 列`;
    case 'text':
    case 'callout':
      return (b.title ? b.title + '：' : '') + stripHtml(b.html).slice(0, 30);
    case 'images':
      return `${(b.items || []).length} 張${b.title ? '｜' + b.title : ''}`;
    case 'imageText':
      return b.title || b.caption || stripHtml(b.html).slice(0, 20);
    case 'cover':
      return b.title || report.theme.title;
    case 'signature':
      return (b.slots || []).map((s) => s.label).join('、');
    default:
      return '';
  }
}

function renderBlocks() {
  const box = $('er-blocks');
  box.innerHTML = '';
  if (!report) {
    box.appendChild(el('div', { class: 'calc-hint', text: '請先在上方選擇案件' }));
    return;
  }
  report.blocks.forEach((b, idx) => {
    const isCollapsed = collapsed.has(b.id);
    const card = el('div', { class: `er-block${b.id === activeBlockId ? ' active' : ''}${isCollapsed ? ' collapsed' : ''}`, 'data-id': b.id });
    const head = el('div', { class: 'er-block-head' }, [
      el('button', { class: 'er-collapse', title: isCollapsed ? '展開' : '收合', text: isCollapsed ? '▸' : '▾', onclick: (e) => { e.stopPropagation(); isCollapsed ? collapsed.delete(b.id) : collapsed.add(b.id); renderBlocks(); } }),
      el('span', { class: 'er-block-type', text: `${BLOCK_TYPES[b.type].icon} ${BLOCK_TYPES[b.type].label}` }),
      b.source ? el('span', { class: 'er-auto-tag', text: '自動', title: '由案件資料自動產生，可按「重新帶入案件資料」更新' }) : null,
      el('span', { class: 'er-block-summary', text: blockSummary(b) || '' }),
      el('span', { class: 'er-block-actions' }, [
        el('button', { title: '上移', text: '↑', disabled: idx === 0, onclick: (e) => { e.stopPropagation(); moveBlock(b.id, -1); } }),
        el('button', { title: '下移', text: '↓', disabled: idx === report.blocks.length - 1, onclick: (e) => { e.stopPropagation(); moveBlock(b.id, 1); } }),
        el('button', { title: '複製', text: '⧉', onclick: (e) => { e.stopPropagation(); duplicateBlock(b.id); } }),
        el('button', { title: '刪除', text: '✕', class: 'er-del', onclick: (e) => { e.stopPropagation(); deleteBlock(b.id); } }),
      ]),
    ]);
    card.appendChild(head);
    card.addEventListener('mousedown', () => { if (activeBlockId !== b.id) setActiveBlock(b.id); });
    if (!isCollapsed) {
      const body = el('div', { class: 'er-block-body' });
      (BLOCK_EDITORS[b.type] || (() => {}))(b, body);
      card.appendChild(body);
    }
    box.appendChild(card);
  });
}

/** 一般輸入欄位 ↔ block 屬性綁定。 */
function field(label, block, key, opts) {
  const o = opts || {};
  let input;
  if (o.options) {
    input = el('select', {}, Object.entries(o.options).map(([v, t]) => el('option', { value: v, text: t })));
  } else if (o.multiline) {
    input = el('textarea', { rows: o.rows || 2, placeholder: o.placeholder || '' });
  } else {
    input = el('input', { type: o.type || 'text', placeholder: o.placeholder || '', min: o.min, max: o.max, step: o.step });
  }
  input.value = block[key] == null || block[key] === '' ? (o.defaultValue != null ? o.defaultValue : '') : block[key];
  input.addEventListener(o.options || o.type === 'color' || o.type === 'range' ? 'input' : 'input', () => {
    block[key] = o.type === 'number' || o.type === 'range' ? parseFloat(input.value) : input.value;
    if (o.onChange) o.onChange(input.value);
    changed();
    updateSummary(block);
  });
  if (o.options) input.addEventListener('change', () => o.rerender && renderBlocks());
  const wrap = el('label', { class: o.inline ? 'er-field er-inline' : 'er-field' }, [label, input]);
  if (o.type === 'range') {
    const out = el('small', { text: `${input.value}%` });
    input.addEventListener('input', () => (out.textContent = `${input.value}%`));
    wrap.appendChild(out);
  }
  return wrap;
}

function updateSummary(block) {
  const s = document.querySelector(`.er-block[data-id="${block.id}"] .er-block-summary`);
  if (s) s.textContent = blockSummary(block) || '';
}

/** 富文字編輯器：粗體 / 斜體 / 底線 / 字級 / 顏色 / 螢光筆 / 對齊 / 清單。 */
function richEditor(block, key, placeholder) {
  const editor = el('div', { class: 'er-rich', contenteditable: 'true', 'data-placeholder': placeholder || '輸入內容…' });
  editor.innerHTML = block[key] || '';
  let savedRange = null;
  const saveRange = () => {
    const sel = window.getSelection();
    if (sel.rangeCount && editor.contains(sel.anchorNode)) savedRange = sel.getRangeAt(0).cloneRange();
  };
  const restoreRange = () => {
    editor.focus();
    if (savedRange) {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedRange);
    }
  };
  const sync = () => {
    block[key] = editor.innerHTML;
    changed();
    updateSummary(block);
  };
  const exec = (cmd, value) => {
    restoreRange();
    document.execCommand('styleWithCSS', false, true);
    document.execCommand(cmd, false, value);
    saveRange();
    sync();
  };
  const setFontSize = (px) => {
    if (!px) return;
    restoreRange();
    document.execCommand('styleWithCSS', false, false);
    document.execCommand('fontSize', false, '7');
    editor.querySelectorAll('font[size="7"]').forEach((f) => {
      const span = document.createElement('span');
      span.style.fontSize = `${px}px`;
      while (f.firstChild) span.appendChild(f.firstChild);
      f.replaceWith(span);
    });
    saveRange();
    sync();
  };
  ['keyup', 'mouseup', 'focus'].forEach((ev) => editor.addEventListener(ev, saveRange));
  editor.addEventListener('input', sync);
  editor.addEventListener('paste', (e) => {
    if ([...(e.clipboardData?.files || [])].some((f) => /^image\//.test(f.type))) {
      e.preventDefault();
      alert('圖片請貼在「圖片」或「圖文並排」區塊裡');
    }
  });

  const btn = (text, title, onClick, style) => el('button', { type: 'button', title, style, text, onmousedown: (e) => e.preventDefault(), onclick: onClick });
  const sizeSel = el('select', { title: '字級' }, [el('option', { value: '', text: '字級' }), ...[12, 13, 14, 16, 18, 20, 24, 28, 32].map((s) => el('option', { value: s, text: `${s}px` }))]);
  sizeSel.addEventListener('mousedown', saveRange);
  sizeSel.addEventListener('change', () => { setFontSize(sizeSel.value); sizeSel.value = ''; });
  const color = el('input', { type: 'color', title: '文字顏色', value: report.theme.primary });
  color.addEventListener('mousedown', saveRange);
  color.addEventListener('input', () => exec('foreColor', color.value));
  const hl = el('input', { type: 'color', title: '螢光筆（底色）', value: '#fff3a3' });
  hl.addEventListener('mousedown', saveRange);
  hl.addEventListener('input', () => exec('hiliteColor', hl.value));

  const toolbar = el('div', { class: 'er-rich-toolbar' }, [
    btn('B', '粗體', () => exec('bold'), 'font-weight:bold'),
    btn('I', '斜體', () => exec('italic'), 'font-style:italic'),
    btn('U', '底線', () => exec('underline'), 'text-decoration:underline'),
    sizeSel,
    el('label', { class: 'er-color', title: '文字顏色' }, ['A', color]),
    el('label', { class: 'er-color', title: '螢光筆' }, ['🖍', hl]),
    btn('⯇', '靠左', () => exec('justifyLeft')),
    btn('≡', '置中', () => exec('justifyCenter')),
    btn('⯈', '靠右', () => exec('justifyRight')),
    btn('•', '項目清單', () => exec('insertUnorderedList')),
    btn('1.', '編號清單', () => exec('insertOrderedList')),
    btn('⌫', '清除格式', () => exec('removeFormat')),
  ]);
  return el('div', { class: 'er-rich-wrap' }, [toolbar, editor]);
}

/** 圖片放置區：點選上傳 / 拖曳 / 貼上。onAdd(images) 收到壓縮好的圖片。 */
function dropZone(text, multiple, onAdd) {
  const input = el('input', { type: 'file', accept: 'image/*', multiple: multiple ? true : false, style: 'display:none' });
  const zone = el('div', { class: 'er-drop', tabindex: '0', text });
  const handle = async (files) => {
    const imgs = await filesToImages(files);
    if (imgs.length) onAdd(multiple ? imgs : [imgs[0]]);
  };
  zone.addEventListener('click', () => input.click());
  input.addEventListener('change', () => handle(input.files));
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('over'); handle(e.dataTransfer.files); });
  zone.addEventListener('paste', (e) => { const files = e.clipboardData?.files; if (files && files.length) { e.preventDefault(); handle(files); } });
  return el('div', {}, [zone, input]);
}

// ------------------------------------------------------------
// 型號欄位（相機型號/鏡頭型號/光源/光源控制器）：從產品資料表下拉建議，也可以自己打，
// 打完離開欄位時，如果不在資料表裡就問要不要順便存進去
// ------------------------------------------------------------
async function loadProductCatalog() {
  const cached = getCached('products_all');
  if (cached) productCatalog = cached;
  const result = await callApi('searchProducts', { keyword: '' });
  if (!result.success) return;
  productCatalog = result.products;
  setCached('products_all', productCatalog);
  refreshModelDatalist();
}

function refreshModelDatalist() {
  const list = $('er-model-datalist');
  if (!list) return;
  list.innerHTML = '';
  productCatalog.forEach((p) => list.appendChild(el('option', { value: p.InternalModel })));
}

function findCatalogProduct(value) {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return null;
  return productCatalog.find((p) => String(p.InternalModel).trim().toLowerCase() === v) || null;
}

/** 型號欄位的輸入框：跟一般 textarea 不同，離開欄位時會檢查是否要匯入產品資料表。 */
function buildModelValueInput(r) {
  const input = el('input', { class: 'er-row-v er-model-input', list: 'er-model-datalist', placeholder: '型號（可從清單選，也可以自己打）', value: r.v || '' });
  const markKnown = () => input.classList.toggle('er-model-known', !!findCatalogProduct(input.value));
  markKnown();
  input.addEventListener('input', () => { r.v = input.value; if (r.auto) r.auto = false; markKnown(); changed(); });
  input.addEventListener('blur', () => maybeImportModel(input, r));
  return input;
}

/** 型號不在產品資料表時，問使用者要不要順便新增，方便以後查詢/報價/詢價。 */
async function maybeImportModel(input, r) {
  const value = input.value.trim();
  if (!value || findCatalogProduct(value)) return;
  const category = MODEL_FIELD_CATEGORY[(r.k || '').trim()] || '其他';
  if (!confirm(`「${value}」不在產品資料表中，要順便新增一筆（類別：${category}）方便以後查詢 / 詢價 / 報價嗎？\n\n不需要的話按「取消」，這裡仍然可以直接打字使用。`)) return;

  const refPriceInput = prompt('底價（選填，不填之後可以到「產品搜尋」頁再補）：', '');
  const result = await callApi('addProduct', { internalModel: value, category, refPrice: refPriceInput ? refPriceInput.trim() : '' });
  if (!result.success) return alert(result.message || '新增失敗');

  productCatalog.push({ InternalModel: value, Category: category, RefPrice: refPriceInput || '', InquiryCount: 0 });
  clearCached('products_all');
  refreshModelDatalist();
  input.classList.add('er-model-known');
}

// ------------------------------------------------------------
// 依報告型號詢價 / 報價：掃描報告裡「相機型號/鏡頭型號/光源/光源控制器」欄位，
// 只要值有對到產品資料表就抓出來，讓你一次產生詢價信或報價單，不用再回產品/報價頁重打一次型號
// ------------------------------------------------------------
function toggleQuotePanel() {
  if (!report) return alert('請先選擇案件');
  const panel = $('er-quote-panel');
  const show = panel.style.display === 'none';
  panel.style.display = show ? '' : 'none';
  if (show) {
    if (!$('er-quote-customer').value) $('er-quote-customer').value = (caseData && caseData.CustomerName) || '';
    refreshQuoteModels();
  }
}

/** 掃描目前報告的表格區塊，把「相機型號/鏡頭型號/光源/光源控制器」欄位裡對得到產品資料表的型號整理出來（依型號去重）。 */
function collectReportModels() {
  const found = new Map();
  report.blocks.forEach((b) => {
    if (b.type !== 'table') return;
    (b.rows || []).forEach((r) => {
      if (!MODEL_FIELD_LABELS.includes((r.k || '').trim())) return;
      const product = findCatalogProduct(r.v);
      if (product) found.set(product.InternalModel, product);
    });
  });
  return [...found.values()];
}

function refreshQuoteModels() {
  const matched = collectReportModels();
  // 保留使用者已經調整過的數量；新出現的型號預設數量 1
  const oldQtyByModel = new Map(quoteModelItems.map((it) => [it.InternalModel, it.qty]));
  quoteModelItems = matched.map((p) => ({ ...p, qty: oldQtyByModel.get(p.InternalModel) || 1 }));
  renderQuoteModelsTable();
}

function onQuoteTypeSelectChange() {
  $('er-quote-custom-wrap').style.display = $('er-quote-type').value === 'custom' ? '' : 'none';
  renderQuoteModelsTable();
}

function getEvalQuoteMultiplier() {
  const type = $('er-quote-type').value;
  if (type === 'custom') return parseFloat($('er-quote-custom-multiplier').value) || 0;
  return parseFloat(type);
}

function getEvalQuoteTypeLabel() {
  const type = $('er-quote-type').value;
  if (type === '1.3') return '設備商';
  if (type === '1.5') return '一般用戶';
  return `自訂義（×${getEvalQuoteMultiplier()}）`;
}

function renderQuoteModelsTable() {
  const box = $('er-quote-models');
  if (!quoteModelItems.length) {
    box.innerHTML = '<div class="calc-hint">目前報告的型號欄位裡，沒有對得到產品資料表的型號。可以按上面「重新偵測型號」，或先在型號欄位填寫並確認匯入。</div>';
    return;
  }
  const multiplier = getEvalQuoteMultiplier();
  const rows = quoteModelItems
    .map((it, i) => {
      const base = parseFloat(it.RefPrice);
      const hasPrice = !isNaN(base) && base > 0;
      const unitPrice = hasPrice ? base * multiplier : 0;
      const subtotal = unitPrice * it.qty;
      return `<tr>
        <td>${it.InternalModel}${it.SupplierModel ? `（${it.SupplierModel}）` : ''}</td>
        <td>${hasPrice ? base.toFixed(2) : '<span class="er-no-price">未設定</span>'}</td>
        <td><input type="number" min="1" step="1" value="${it.qty}" onchange="updateQuoteModelQty(${i}, this.value)" /></td>
        <td>${hasPrice ? subtotal.toFixed(2) : '-'}</td>
      </tr>`;
    })
    .join('');
  box.innerHTML = `<table class="er-quote-table"><thead><tr><th>型號</th><th>底價</th><th>數量</th><th>小計（${getEvalQuoteTypeLabel()}）</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function updateQuoteModelQty(index, value) {
  const qty = parseInt(value, 10);
  quoteModelItems[index].qty = qty > 0 ? qty : 1;
  renderQuoteModelsTable();
}

/** 產生合併詢價信（不管有沒有底價都列進去，詢價本來就是為了問到價格），同供應商信箱只有一組時順便建 Gmail 草稿。 */
async function generateInquiryFromReport() {
  if (!quoteModelItems.length) return alert('目前沒有可以詢價的型號，請先「重新偵測型號」');

  const blocks = [];
  const emails = new Set();
  for (const it of quoteModelItems) {
    const detail = await callApi('getProduct', { internalModel: it.InternalModel });
    if (!detail.success) continue;
    const p = detail.product;
    const lastPrice = detail.lastPrice;
    if (p.SupplierContactEmail) emails.add(p.SupplierContactEmail);
    blocks.push(
      `供應商型號: ${p.SupplierModel || '-'}\n對應內部型號: ${p.InternalModel}\n` +
        (lastPrice ? `上次報價紀錄: ${lastPrice.Price} ${lastPrice.Currency || ''}（${lastPrice.Date}）\n` : '') +
        `需求數量: ${it.qty}`
    );
  }
  if (!blocks.length) return alert('讀取產品資料失敗，請稍後再試');

  const text = `您好，\n\n想請教以下產品報價：\n${blocks.join('\n---\n')}\n\n麻煩協助報價，謝謝！`;
  const files = [{ base64: btoa(unescape(encodeURIComponent(text))), filename: `詢價信_${report.caseId}.txt`, mimeType: 'text/plain', label: '詢價信（依報告型號自動整理）' }];

  if (emails.size === 1) {
    const draft = await callApi('createGmailDraft', { to: [...emails][0], subject: `詢價 - ${report.caseId}`, body: text });
    if (draft.success && draft.draftUrl) alert(`已自動建立 Gmail 草稿：${draft.draftUrl}`);
  }
  openPreviewModal(files);
}

/** 產生報價單：只有底價的型號才會列進去，沒有底價的會先提醒。 */
async function generateQuoteFromReport() {
  if (!quoteModelItems.length) return alert('目前沒有可以報價的型號，請先「重新偵測型號」');

  const priced = quoteModelItems.filter((it) => !isNaN(parseFloat(it.RefPrice)) && parseFloat(it.RefPrice) > 0);
  const skipped = quoteModelItems.length - priced.length;
  if (!priced.length) return alert('這些型號都還沒有底價，請先到「產品搜尋」補上底價再產生報價單');
  if (skipped && !confirm(`有 ${skipped} 項型號沒有底價，報價單裡不會出現，要繼續產生嗎？`)) return;

  const multiplier = getEvalQuoteMultiplier();
  const rows = priced.map((it) => {
    const basePrice = parseFloat(it.RefPrice);
    const listPrice = basePrice * 2;
    const unitPrice = basePrice * multiplier;
    const subtotal = unitPrice * it.qty;
    return { name: `${it.InternalModel}${it.SupplierModel ? `（${it.SupplierModel}）` : ''}`, basePrice, listPrice, unitPrice, quantity: it.qty, subtotal };
  });
  const total = rows.reduce((sum, r) => sum + r.subtotal, 0);

  const result = await callApi('generateQuoteDoc', {
    customerName: $('er-quote-customer').value,
    quoteType: getEvalQuoteTypeLabel(),
    format: $('er-quote-format').value,
    items: rows.map((r) => ({ name: r.name, basePrice: r.basePrice.toFixed(2), listPrice: r.listPrice.toFixed(2), unitPrice: r.unitPrice.toFixed(2), quantity: r.quantity, subtotal: r.subtotal.toFixed(2) })),
    total: total.toFixed(2),
  });
  if (!result.success) return alert(result.message);
  openPreviewModal([Object.assign({}, result, { label: '報價單（依報告型號自動整理）' })]);
}

const BLOCK_EDITORS = {
  cover(b, body) {
    body.append(
      field('上方小標', b, 'kicker'),
      field('封面標題（空白＝用報告標題）', b, 'title', { placeholder: report.theme.title }),
      field('副標（專案名稱）', b, 'subtitle', { multiline: true }),
      field('客戶名稱', b, 'customer'),
    );
    body.append(el('div', { class: 'er-field' }, ['封面圖片（產品照 / 設備照，選填）']));
    if (b.image) {
      body.append(el('div', { class: 'er-thumbs' }, [el('div', { class: 'er-thumb' }, [el('img', { src: b.image }), el('button', { class: 'er-del', text: '✕', title: '移除', onclick: () => { b.image = ''; renderBlocks(); changed(); } })])]));
    } else {
      body.append(dropZone('點擊選擇 / 拖曳 / Ctrl+V 貼上封面圖片', false, (imgs) => { b.image = imgs[0].src; renderBlocks(); changed(); }));
    }
  },

  heading(b, body) {
    body.append(el('div', { class: 'er-row' }, [
      field('標題文字', b, 'text'),
      field(b.color ? '顏色（自訂）' : '顏色（目前用主題標題色）', b, 'color', { type: 'color', defaultValue: report.theme.dark }),
    ]));
    if (b.color) body.append(el('button', { class: 'btn-mini', text: '改回主題顏色', onclick: () => { delete b.color; renderBlocks(); changed(); } }));
  },

  table(b, body) {
    body.append(el('div', { class: 'er-row' }, [field('標籤（例如 CCD1）', b, 'badge'), field('表格標題', b, 'title')]));
    const list = el('div', { class: 'er-rows' });
    (b.rows || []).forEach((r, i) => {
      const k = el('input', { value: r.k || '', placeholder: '欄位名稱', class: 'er-row-k' });
      k.addEventListener('input', () => { r.k = k.value; changed(); });
      const isModelField = MODEL_FIELD_LABELS.includes((r.k || '').trim());
      const v = isModelField ? buildModelValueInput(r) : el('textarea', { rows: r.wide ? 3 : 1, placeholder: '內容', class: 'er-row-v' });
      if (!isModelField) {
        v.value = r.v || '';
        v.addEventListener('input', () => { r.v = v.value; if (r.auto) r.auto = false; changed(); });
      }
      const wide = el('input', { type: 'checkbox', title: '這一列自己佔整列（適合長文字）' });
      wide.checked = !!r.wide;
      wide.addEventListener('change', () => { r.wide = wide.checked; renderBlocks(); changed(); });
      list.append(el('div', { class: 'er-kv' }, [
        k, v,
        el('label', { class: 'er-kv-wide', title: '整列' }, [wide, '整列']),
        el('button', { class: 'btn-mini', text: '↑', title: '上移', disabled: i === 0, onclick: () => { [b.rows[i - 1], b.rows[i]] = [b.rows[i], b.rows[i - 1]]; renderBlocks(); changed(); } }),
        el('button', { class: 'btn-mini er-del', text: '✕', title: '刪除此列', onclick: () => { b.rows.splice(i, 1); renderBlocks(); changed(); } }),
      ]));
    });
    body.append(list, el('button', { class: 'btn-mini', text: '＋ 加一列', onclick: () => { b.rows.push({ k: '', v: '' }); renderBlocks(); changed(); } }));
  },

  text(b, body) {
    body.append(el('div', { class: 'er-row' }, [
      field('整段字級', b, 'fontSize', { options: { '': '預設', 12: '12px', 13: '13px', 14: '14px', 15: '15px', 16: '16px', 18: '18px', 20: '20px', 24: '24px' } }),
      field(b.color ? '整段顏色（自訂）' : '整段顏色（目前用主題內文色）', b, 'color', { type: 'color', defaultValue: report.theme.textColor || '#2b2b2b' }),
      field('整段對齊', b, 'align', { options: { '': '預設（靠左）', center: '置中', right: '靠右', justify: '左右對齊' } }),
    ]));
    if (b.color) body.append(el('button', { class: 'btn-mini', text: '整段顏色改回主題內文色', onclick: () => { delete b.color; renderBlocks(); changed(); } }));
    body.append(richEditor(b, 'html', '輸入說明文字，可選取文字後用工具列調整粗體、字級、顏色…'));
  },

  images(b, body) {
    body.append(el('div', { class: 'er-row' }, [
      field('區塊標題（選填）', b, 'title'),
      field('每列張數', b, 'columns', { options: { 1: '1 張', 2: '2 張並排', 3: '3 張並排' }, rerender: true }),
      field('對齊', b, 'align', { options: { center: '置中', left: '靠左', right: '靠右' } }),
    ]));
    if (+b.columns === 1) body.append(field('圖片寬度', b, 'width', { type: 'range', min: 20, max: 100, step: 5 }));
    const thumbs = el('div', { class: 'er-thumbs' });
    (b.items || []).forEach((it, i) => {
      const cap = el('input', { value: it.caption || '', placeholder: `圖說（圖 ${i + 1}）` });
      cap.addEventListener('input', () => { it.caption = cap.value; changed(); });
      thumbs.append(el('div', { class: 'er-thumb' }, [
        el('img', { src: it.src, alt: '' }),
        cap,
        el('div', { class: 'er-thumb-actions' }, [
          el('button', { class: 'btn-mini', text: '◀', title: '往前', disabled: i === 0, onclick: () => { [b.items[i - 1], b.items[i]] = [b.items[i], b.items[i - 1]]; renderBlocks(); changed(); } }),
          el('button', { class: 'btn-mini', text: '▶', title: '往後', disabled: i === b.items.length - 1, onclick: () => { [b.items[i + 1], b.items[i]] = [b.items[i], b.items[i + 1]]; renderBlocks(); changed(); } }),
          el('button', { class: 'btn-mini er-del', text: '✕', title: '移除', onclick: () => { b.items.splice(i, 1); renderBlocks(); changed(); } }),
        ]),
      ]));
    });
    body.append(thumbs, dropZone('＋ 點擊選擇圖片（可多選）/ 拖曳到這裡 / 點一下後按 Ctrl+V 貼上截圖', true, (imgs) => { b.items.push(...imgs); renderBlocks(); changed(); }));
  },

  imageText(b, body) {
    body.append(el('div', { class: 'er-row' }, [
      field('標題（選填）', b, 'title'),
      field('圖片位置', b, 'side', { options: { left: '圖在左', right: '圖在右' } }),
    ]));
    body.append(field('圖片寬度', b, 'imageWidth', { type: 'range', min: 25, max: 70, step: 5 }));
    if (b.src) {
      const cap = el('input', { value: b.caption || '', placeholder: '圖說' });
      cap.addEventListener('input', () => { b.caption = cap.value; changed(); });
      body.append(el('div', { class: 'er-thumbs' }, [el('div', { class: 'er-thumb' }, [el('img', { src: b.src }), cap, el('div', { class: 'er-thumb-actions' }, [el('button', { class: 'btn-mini er-del', text: '✕ 換圖', onclick: () => { b.src = ''; renderBlocks(); changed(); } })])])]));
    } else {
      body.append(dropZone('＋ 點擊選擇 / 拖曳 / Ctrl+V 貼上圖片', false, (imgs) => { b.src = imgs[0].src; if (!b.caption) b.caption = imgs[0].caption; renderBlocks(); changed(); }));
    }
    body.append(richEditor(b, 'html', '圖片旁邊的說明文字…'));
  },

  callout(b, body) {
    body.append(el('div', { class: 'er-row' }, [
      field('樣式', b, 'variant', { options: Object.fromEntries(Object.entries(CALLOUT_VARIANTS).map(([k, v]) => [k, v.name])) }),
      field('標題', b, 'title'),
    ]));
    body.append(richEditor(b, 'html', '重點內容，例如評估結論、建議方案、注意事項…'));
  },

  signature(b, body) {
    (b.slots || []).forEach((s, i) => {
      body.append(el('div', { class: 'er-row' }, [
        field('欄位', s, 'label'),
        field('姓名（選填）', s, 'name'),
        field('日期（選填）', s, 'date'),
        el('button', { class: 'btn-mini er-del', text: '✕', title: '移除', onclick: () => { b.slots.splice(i, 1); renderBlocks(); changed(); } }),
      ]));
    });
    body.append(el('button', { class: 'btn-mini', text: '＋ 加一欄', onclick: () => { b.slots.push({ label: '簽核', name: '', date: '' }); renderBlocks(); changed(); } }));
  },

  pagebreak(b, body) {
    body.append(el('div', { class: 'calc-hint', text: '列印 / 另存 PDF 時從這裡換到下一頁' }));
  },
};

// ------------------------------------------------------------
// 版面與品牌
// ------------------------------------------------------------
function switchEditorTab(tab) {
  $('er-panel-content').style.display = tab === 'content' ? '' : 'none';
  $('er-panel-brand').style.display = tab === 'brand' ? '' : 'none';
  $('er-tab-content').classList.toggle('active', tab === 'content');
  $('er-tab-brand').classList.toggle('active', tab === 'brand');
}

const BRAND_FIELDS = [
  ['er-primary', 'theme', 'primary'],
  ['er-dark', 'theme', 'dark'],
  ['er-text-color', 'theme', 'textColor'],
  ['er-font', 'theme', 'font'],
  ['er-base-size', 'theme', 'baseSize'],
  ['er-company', 'theme', 'companyName'],
  ['er-company-sub', 'theme', 'companySub'],
  ['er-watermark-text', 'theme', 'watermarkText'],
  ['er-title', 'theme', 'title'],
  ['er-footer-text', 'theme', 'footerText'],
  ['er-footer-bless', 'theme', 'footerBless'],
  ['er-cover-note', 'theme', 'coverNote'],
  ['er-report-no', 'meta', 'reportNo'],
  ['er-version', 'meta', 'version'],
  ['er-date', 'meta', 'date'],
  ['er-author', 'meta', 'author'],
];

function fillBrandPanel() {
  if (!report) return;
  BRAND_FIELDS.forEach(([id, group, key]) => ($(id).value = report[group][key] == null ? '' : report[group][key]));
  $('er-theme-preset').value = report.theme.preset || 'custom';
  $('er-watermark').checked = report.theme.watermark !== false;
  $('er-numbering').checked = report.theme.numbering !== false;
  $('er-logo-preview').src = report.theme.logo || defaultLogo || '';
}

function initBrandPanel() {
  const preset = $('er-theme-preset');
  Object.entries(REPORT_THEMES).forEach(([k, v]) => preset.append(el('option', { value: k, text: v.name })));
  preset.append(el('option', { value: 'custom', text: '自訂' }));
  preset.addEventListener('change', () => {
    const p = REPORT_THEMES[preset.value];
    report.theme.preset = preset.value;
    if (p) Object.assign(report.theme, { primary: p.primary, dark: p.dark });
    fillBrandPanel();
    changed();
  });
  Object.entries(REPORT_FONTS).forEach(([k, v]) => $('er-font').append(el('option', { value: k, text: v.name })));

  BRAND_FIELDS.forEach(([id, group, key]) => {
    const input = $(id);
    input.addEventListener(input.tagName === 'SELECT' ? 'change' : 'input', () => {
      if (!report) return;
      report[group][key] = input.type === 'number' ? parseFloat(input.value) : input.value;
      if (id === 'er-primary' || id === 'er-dark') {
        report.theme.preset = 'custom';
        preset.value = 'custom';
      }
      changed();
    });
  });
  $('er-watermark').addEventListener('change', () => { report.theme.watermark = $('er-watermark').checked; changed(); });
  $('er-numbering').addEventListener('change', () => { report.theme.numbering = $('er-numbering').checked; changed(); });
  $('er-logo-file').addEventListener('change', async () => {
    const f = $('er-logo-file').files[0];
    if (!f) return;
    report.theme.logo = await compressDataUrl(await fileToDataUrl(f), 600);
    fillBrandPanel();
    changed();
  });
}

function resetLogo() {
  if (!report) return;
  report.theme.logo = '';
  $('er-logo-file').value = '';
  fillBrandPanel();
  changed();
}

function saveBrandAsDefault() {
  if (!report) return;
  try {
    localStorage.setItem(BRAND_KEY, JSON.stringify(report.theme));
    alert('已存成預設，之後新建的報告都會套用這組品牌設定');
  } catch (e) {
    alert('儲存失敗（Logo 圖片可能太大）');
  }
}

// ------------------------------------------------------------
// 預覽
// ------------------------------------------------------------
let previewTimer = null;
function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(renderPreview, 250);
}

function currentLogo() {
  return (report && report.theme.logo) || defaultLogo;
}

function renderPreview() {
  const frame = $('er-preview-frame');
  if (!report) return;
  const doc = frame.contentDocument;
  const scroll = doc && doc.scrollingElement ? doc.scrollingElement.scrollTop : 0;
  const html = buildReportHtml(report, { logoSrc: currentLogo(), forEditor: true });
  doc.open();
  doc.write(html);
  doc.close();
  doc.documentElement.style.zoom = $('er-zoom').value;
  doc.addEventListener('click', (e) => {
    const target = e.target.closest('[data-block-id]');
    if (target) setActiveBlock(target.getAttribute('data-block-id'), true);
  });
  const restore = () => { if (doc.scrollingElement) doc.scrollingElement.scrollTop = scroll; };
  restore();
  requestAnimationFrame(restore);
  highlightPreview(activeBlockId, false);
}

function highlightPreview(id, scroll) {
  const doc = $('er-preview-frame').contentDocument;
  if (!doc) return;
  doc.querySelectorAll('.rp-focus').forEach((n) => n.classList.remove('rp-focus'));
  const node = id && doc.querySelector(`[data-block-id="${id}"]`);
  if (node) {
    node.classList.add('rp-focus');
    if (scroll) node.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

// ------------------------------------------------------------
// 自動存草稿
// ------------------------------------------------------------
let saveTimer = null;
function changed() {
  schedulePreview();
  clearTimeout(saveTimer);
  $('er-save-status').textContent = '編輯中…';
  saveTimer = setTimeout(saveDraft, 1200);
}

async function saveDraft() {
  if (!report) return;
  report.savedAt = new Date().toISOString();
  try {
    await DraftStore.set(DRAFT_PREFIX + report.caseId, report);
    $('er-save-status').textContent = `草稿已自動儲存（本機）${new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}`;
  } catch (e) {
    $('er-save-status').textContent = '⚠ 草稿無法自動儲存（瀏覽器空間不足），完成後請記得「存到案件附件」';
  }
}

// ------------------------------------------------------------
// 輸出
// ------------------------------------------------------------
function finalHtml() {
  return buildReportHtml(report, { logoSrc: currentLogo() });
}

function reportFilename(ext) {
  return safeFilename(`${report.theme.title || '評估報告'}_${report.caseId}_${report.meta.date || todayStr()}.${ext}`);
}

function downloadReportHtml() {
  if (!report) return alert('請先選擇案件');
  const blob = new Blob([finalHtml()], { type: 'text/html;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = reportFilename('html');
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/** 用隱藏的 iframe 放乾淨版本（沒有編輯用的外框）再叫出列印視窗，可選「另存為 PDF」。 */
function printReport() {
  if (!report) return alert('請先選擇案件');
  const frame = el('iframe', { style: 'position:fixed;right:0;bottom:0;width:0;height:0;border:0', title: 'print' });
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  doc.open();
  doc.write(finalHtml());
  doc.close();
  const go = () => {
    frame.contentWindow.focus();
    frame.contentWindow.print();
    setTimeout(() => frame.remove(), 60000);
  };
  // 等圖片與字型載入完再印，避免空白
  const imgs = [...doc.images];
  Promise.all(imgs.map((img) => (img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; }))))
    .then(() => (doc.fonts ? doc.fonts.ready : null))
    .then(() => setTimeout(go, 200));
}

async function saveReportToCase() {
  if (!report) return alert('請先選擇案件');
  const html = finalHtml();
  const sizeMb = new Blob([html]).size / 1024 / 1024;
  if (sizeMb > 35) return alert(`報告檔案約 ${sizeMb.toFixed(1)} MB，超過上傳上限，請減少或縮小圖片後再試`);
  if (!confirm(`要把報告（約 ${sizeMb.toFixed(1)} MB）存成 HTML 檔放進案件「${report.caseId}」的附件嗎？`)) return;

  let result;
  try {
    result = await callApi('uploadCaseAttachment', { caseId: report.caseId, filename: reportFilename('html'), mimeType: 'text/html', base64: utf8ToBase64(html) });
  } catch (e) {
    return alert('上傳失敗：' + (e.message || e));
  }
  if (!result.success) return alert(result.message || '上傳失敗');
  clearCached('casesPageData');

  if (caseData && caseData.Status !== '評估單已發出' && confirm('已存到案件附件。要順便把案件狀態改成「評估單已發出」嗎？')) {
    const upd = await callApi('updateCase', { caseId: report.caseId, fields: { Status: '評估單已發出' } });
    if (upd.success) caseData.Status = '評估單已發出';
  } else {
    alert('已存到案件附件（案件管理 → 檢測規章及其他附件 可以看到）');
  }
}

// ------------------------------------------------------------
// 載入案件
// ------------------------------------------------------------
async function loadCaseList(selectedId) {
  const select = $('er-case');
  const fill = (cases) => {
    select.innerHTML = '<option value="">選擇案件...</option>';
    cases.forEach((c) => select.append(el('option', { value: c.CaseID, text: `${c.CaseID}｜${c.CustomerName || ''}` })));
    if (selectedId) {
      if (![...select.options].some((o) => o.value === selectedId)) select.append(el('option', { value: selectedId, text: selectedId }));
      select.value = selectedId;
    }
  };
  const cached = getCached('calcCaseList');
  if (cached) fill(cached);
  const result = await callApi('getCases', {});
  if (!result.success) return;
  const slim = result.cases.map((c) => ({ CaseID: c.CaseID, CustomerName: c.CustomerName }));
  setCached('calcCaseList', slim);
  fill(slim);
}

async function loadCase(caseId) {
  if (!caseId) return;
  if (report) {
    clearTimeout(saveTimer);
    await saveDraft();
  }
  const result = await callApi('getCase', { caseId });
  if (!result.success) return alert(result.message || '讀取案件失敗');
  caseData = result.caseData;

  const draft = await DraftStore.get(DRAFT_PREFIX + caseId);
  if (draft && draft.blocks) {
    report = draft;
    report.theme = Object.assign(defaultTheme(), report.theme);
    $('er-save-status').textContent = `已載入上次的草稿（${new Date(draft.savedAt || Date.now()).toLocaleString('zh-TW', { hour12: false })}）`;
  } else {
    report = newReport(caseData);
    $('er-save-status').textContent = '已依案件資料建立新報告';
  }
  activeBlockId = null;
  collapsed.clear();
  const url = new URL(location.href);
  url.searchParams.set('caseId', caseId);
  history.replaceState(null, '', url);
  fillBrandPanel();
  renderBlocks();
  renderPreview();
}

async function loadDefaultLogo() {
  try {
    const res = await fetch('img/logo.png');
    if (!res.ok) return;
    defaultLogo = await fileToDataUrl(await res.blob());
  } catch (e) {
    defaultLogo = ''; // 用 file:// 開啟時讀不到，報告就不放 Logo（可在「版面與品牌」上傳）
  }
}

// 在頁面空白處按 Ctrl+V：如果目前選的是圖片區塊，就把截圖加進去
document.addEventListener('paste', async (e) => {
  const t = e.target;
  if (!report || t.closest('input, textarea, [contenteditable="true"], .er-drop')) return;
  const files = [...(e.clipboardData?.files || [])].filter((f) => /^image\//.test(f.type));
  if (!files.length) return;
  const b = report.blocks.find((x) => x.id === activeBlockId);
  if (!b || !['images', 'imageText', 'cover'].includes(b.type)) return alert('請先點選一個「圖片」或「圖文並排」區塊，再貼上截圖');
  e.preventDefault();
  const imgs = await filesToImages(files);
  if (b.type === 'images') b.items.push(...imgs);
  else if (b.type === 'imageText') b.src = imgs[0].src;
  else b.image = imgs[0].src;
  renderBlocks();
  changed();
});

window.addEventListener('DOMContentLoaded', async () => {
  if (!(await ensureAuth())) return;
  renderHeaderUser();
  applyAdminOnlyVisibility();
  initBrandPanel();
  $('er-zoom').addEventListener('change', () => {
    const doc = $('er-preview-frame').contentDocument;
    if (doc) doc.documentElement.style.zoom = $('er-zoom').value;
  });
  $('er-case').addEventListener('change', () => loadCase($('er-case').value));
  renderBlocks();

  const caseId = new URL(location.href).searchParams.get('caseId') || '';
  await loadDefaultLogo();
  loadCaseList(caseId);
  loadProductCatalog();
  if (caseId) await loadCase(caseId);
});

// 離開頁面前把還沒存的草稿存起來
window.addEventListener('beforeunload', () => {
  if (saveTimer) saveDraft();
});
