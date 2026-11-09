/**
 * product-export.js - 產品「匯出勾選的項目」與「AI 撰寫上架文案」
 * 依賴 products.js 的 selectedRows / allProducts，以及 common.js 的 callApi()。
 * 勾選的產品、要匯出的欄位 → 下載 CSV / JSON、複製成可貼進試算表的表格，或交給 AI 寫文案。
 * 底價、供應商是內部資料：預設不勾，而且絕對不會送給 AI。
 */

// 欄位清單：key / 顯示名稱 / 取值 / 預設有沒有勾 / 是不是內部資料
const EXPORT_FIELDS = [
  { key: 'name', label: '名稱（內部型號）', get: (p) => p.InternalModel || p.SupplierModel || '', def: true },
  { key: 'model', label: '型號（供應商型號）', get: (p) => p.SupplierModel, def: true },
  { key: 'brand', label: '品牌', get: (p) => p.Brand, def: true },
  { key: 'category', label: '類別', get: (p) => p.Category, def: true },
  { key: 'price', label: '售價', get: (p, o) => exportPrice(p.RefPrice, o), def: true },
  { key: 'summary', label: '規格摘要', get: (p) => exportSummary(p), def: true },
  { key: 'interface', label: '介面', get: (p) => p.Interface },
  { key: 'resolution', label: '解析度', get: (p) => p.Resolution },
  { key: 'effpx', label: '有效像素', get: (p) => p.EffectivePixels },
  { key: 'pixel', label: '像元尺寸 µm', get: (p) => p.PixelSize },
  { key: 'sensor', label: '靶面', get: (p) => p.SensorSize },
  { key: 'fps', label: '影格率 fps', get: (p) => p.FPS },
  { key: 'mount', label: '接口', get: (p) => p.Mount },
  { key: 'focal', label: '焦距 mm', get: (p) => p.FocalLength },
  { key: 'mag', label: '放大倍率', get: (p) => p.Magnification },
  { key: 'wd', label: '工作距離 WD', get: (p) => p.WD },
  { key: 'dof', label: '景深 DOF', get: (p) => p.DOF },
  { key: 'focuswd', label: '最近對焦距離', get: (p) => p.FocusWD },
  { key: 'official', label: '官網完整規格', get: (p) => exportOfficialSpecs(p), needsSpecs: true },
  { key: 'notes', label: '備註', get: (p) => p.Notes },
  { key: 'origin', label: '產地', get: (p) => p.Origin },
  { key: 'url', label: '來源網址', get: (p) => p.SourceUrl },
  { key: 'refPrice', label: '底價（內部）', get: (p) => p.RefPrice, internal: true },
  { key: 'supplier', label: '供應商（內部）', get: (p) => p.Supplier, internal: true },
];

const EXPORT_PREF_KEY = 'aoi_product_export_prefs';
const exportFull = new Map(); // 列號 → 含官網完整規格的產品資料（匯出時才向後端取）

// ---- 純函式（不碰畫面，方便測試）----

/** 售價 = 底價 × 倍率，再依設定取整數；沒有底價回空字串。 */
function exportPrice(refPrice, o) {
  const base = parseFloat(String(refPrice == null ? '' : refPrice).replace(/,/g, ''));
  if (isNaN(base) || base <= 0) return '';
  const raw = base * (Number(o && o.multiplier) > 0 ? Number(o.multiplier) : 2);
  const mode = (o && o.rounding) || 'ceil';
  if (mode === 'ceil') return String(Math.ceil(raw - 1e-9));
  if (mode === 'round') return String(Math.round(raw));
  if (mode === 'ceil10') return String(Math.ceil(raw / 10 - 1e-9) * 10);
  return raw.toFixed(2);
}

/** 選型規格：依類別（鏡頭 / 相機）只列有意義的欄位。 */
function exportSpecPairs(p) {
  const isLens = p.Category === '鏡頭';
  return [
    ['品牌', p.Brand], ['介面', p.Interface], ['解析度', p.Resolution], ['有效像素', p.EffectivePixels], ['像元尺寸 µm', p.PixelSize], ['靶面', p.SensorSize],
    ['影格率 fps', p.FPS], ['接口', p.Mount], ['焦距 mm', p.FocalLength], ['放大倍率', p.Magnification],
    ['工作距離 WD', p.WD], ['景深 DOF', p.DOF], ['最近對焦距離', p.FocusWD],
  ].filter(([k, v]) => v !== '' && v != null && (isLens ? !/像元|影格|介面|有效像素/.test(k) : !/焦距|倍率|WD|DOF|最近/.test(k)));
}

function exportSummary(p) {
  return exportSpecPairs(p).filter(([k]) => k !== '品牌').map(([k, v]) => k + ' ' + v).join('｜');
}

function exportOfficialSpecs(p) {
  const s = p.Specs && typeof p.Specs === 'object' ? p.Specs : {};
  return Object.keys(s)
    .filter((k) => s[k] !== '' && s[k] != null)
    .map((k) => k + '：' + s[k])
    .join('；');
}

function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** 依勾選的欄位把產品轉成表格：{ headers, rows }。 */
function buildExportTable(products, keys, opts) {
  const fields = EXPORT_FIELDS.filter((f) => keys.includes(f.key));
  return {
    headers: fields.map((f) => f.label.replace('（內部）', '')),
    rows: products.map((p) => fields.map((f) => String(f.get(p, opts) == null ? '' : f.get(p, opts)))),
  };
}

function tableToCsv(t) {
  return [t.headers, ...t.rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

/** 貼進 Excel / Google 試算表用：欄位以 Tab 分隔，儲存格內的換行與 Tab 換成空白。 */
function tableToTsv(t) {
  const clean = (s) => String(s).replace(/[\t\r\n]+/g, ' ');
  return [t.headers, ...t.rows].map((r) => r.map(clean).join('\t')).join('\n');
}

/** 給 AI 看的資料：只含對外公開的欄位（不含底價、供應商）；售價有勾才帶。 */
function buildCopyItems(products, keys, opts) {
  return products.map((p) => {
    const specs = {};
    exportSpecPairs(p).forEach(([k, v]) => {
      if (k !== '品牌') specs[k] = v;
    });
    const official = p.Specs && typeof p.Specs === 'object' ? p.Specs : {};
    Object.keys(official).forEach((k) => {
      if (official[k] !== '' && official[k] != null && !(k in specs)) specs[k] = official[k];
    });
    if (keys.includes('notes') && p.Notes) specs['備註'] = p.Notes;
    if (keys.includes('origin') && p.Origin) specs['產地'] = p.Origin;
    return {
      name: [p.InternalModel, p.SupplierModel && p.SupplierModel !== p.InternalModel ? p.SupplierModel : ''].filter(Boolean).join(' / '),
      category: p.Category || '',
      brand: p.Brand || '',
      price: keys.includes('price') ? exportPrice(p.RefPrice, opts) : '',
      specs,
    };
  });
}

// ---- 畫面 ----

function exportPrefs() {
  try {
    return JSON.parse(localStorage.getItem(EXPORT_PREF_KEY) || '{}') || {};
  } catch (e) {
    return {};
  }
}

function saveExportPrefs() {
  try {
    localStorage.setItem(EXPORT_PREF_KEY, JSON.stringify({ keys: selectedExportKeys(), multiplier: document.getElementById('export-multiplier').value, rounding: document.getElementById('export-rounding').value }));
  } catch (e) {
    // 記不住欄位選擇不影響功能
  }
}

function selectedExportKeys() {
  return [...document.querySelectorAll('#export-fields input[type=checkbox]:checked')].map((c) => c.value);
}

function exportOpts() {
  return { multiplier: document.getElementById('export-multiplier').value, rounding: document.getElementById('export-rounding').value };
}

function renderExportFields() {
  const box = document.getElementById('export-fields');
  if (box.childElementCount) return;
  const prefs = exportPrefs();
  const keys = Array.isArray(prefs.keys) ? prefs.keys : EXPORT_FIELDS.filter((f) => f.def).map((f) => f.key);
  box.innerHTML = EXPORT_FIELDS.map((f) => `<label class="${f.internal ? 'internal' : ''}"><input type="checkbox" value="${f.key}" ${keys.includes(f.key) ? 'checked' : ''} onchange="saveExportPrefs()" />${pdEsc(f.label)}</label>`).join('');
  if (prefs.multiplier) document.getElementById('export-multiplier').value = prefs.multiplier;
  if (prefs.rounding) document.getElementById('export-rounding').value = prefs.rounding;
  ['export-multiplier', 'export-rounding'].forEach((id) => document.getElementById(id).addEventListener('change', saveExportPrefs));
}

function openExportPanel(focus) {
  if (!selectedRows.size) return alert('還沒有勾選任何產品：先搜尋（例如 CVG-），再勾選要上架的產品，或按「全選目前篩選結果」。');
  renderExportFields();
  const panel = document.getElementById('export-panel');
  panel.style.display = 'block';
  document.getElementById('export-count').textContent = '（已選 ' + selectedRows.size + ' 筆）';
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (focus === 'copy') document.getElementById('copy-extra').focus({ preventScroll: true });
}

/** 取得勾選的產品；要官網完整規格時，把還沒取過的列號向後端要（分批，一次最多 500 筆）。 */
async function selectedProducts(needSpecs) {
  const rows = [...selectedRows];
  if (needSpecs) {
    const missing = rows.filter((r) => !exportFull.has(r));
    for (let i = 0; i < missing.length; i += 500) {
      const r = await callApi('getProductsExport', { rowIndexes: missing.slice(i, i + 500) });
      if (!r.success) throw new Error(r.message || '讀取產品規格失敗');
      r.products.forEach((p) => exportFull.set(p.RowIndex, p));
    }
  }
  const byRow = new Map(allProducts.map((p) => [p.RowIndex, p]));
  return rows.map((r) => (needSpecs && exportFull.get(r)) || byRow.get(r)).filter(Boolean);
}

function setExportMsg(id, text) {
  document.getElementById(id).textContent = text || '';
}

async function buildTableFromSelection() {
  if (!selectedRows.size) throw new Error('還沒有勾選任何產品');
  const keys = selectedExportKeys();
  if (!keys.length) throw new Error('請至少勾選一個要匯出的欄位');
  const products = await selectedProducts(keys.some((k) => EXPORT_FIELDS.find((f) => f.key === k).needsSpecs));
  if (keys.includes('price') && products.some((p) => !String(p.RefPrice || '').trim())) setExportMsg('export-msg', '提醒：有些產品沒有底價，售價欄會是空白。');
  return buildExportTable(products, keys, exportOpts());
}

function downloadFile(name, text, type) {
  const blob = new Blob([type === 'text/csv' ? '﻿' + text : text], { type: type + ';charset=utf-8' }); // CSV 加 BOM，Excel 才不會把中文開成亂碼
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function exportStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
}

async function exportDownload(format) {
  setExportMsg('export-msg', '');
  try {
    const t = await buildTableFromSelection();
    if (format === 'json') {
      const objs = t.rows.map((r) => Object.fromEntries(t.headers.map((h, i) => [h, r[i]])));
      downloadFile('產品匯出_' + exportStamp() + '.json', JSON.stringify(objs, null, 2), 'application/json');
    } else {
      downloadFile('產品匯出_' + exportStamp() + '.csv', tableToCsv(t), 'text/csv');
    }
    setExportMsg('export-msg', '✓ 已匯出 ' + t.rows.length + ' 筆');
  } catch (e) {
    setExportMsg('export-msg', '');
    alert(e.message);
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

async function exportCopyTable() {
  try {
    const t = await buildTableFromSelection();
    setExportMsg('export-msg', (await copyText(tableToTsv(t))) ? '✓ 已複製 ' + t.rows.length + ' 筆，到試算表按貼上即可' : '複製失敗，請改用下載');
  } catch (e) {
    alert(e.message);
  }
}

async function writeCopy() {
  if (!selectedRows.size) return alert('還沒有勾選任何產品');
  const btn = document.getElementById('copy-write-btn');
  btn.disabled = true;
  setExportMsg('copy-msg', 'AI 撰寫中…（通常 10–30 秒；產品很多時會久一點）');
  try {
    const keys = selectedExportKeys();
    const products = await selectedProducts(true);
    const r = await callApi('writeProductCopy', {
      products: buildCopyItems(products, keys, exportOpts()),
      tone: document.getElementById('copy-tone').value,
      platform: document.getElementById('copy-platform').value,
      length: document.getElementById('copy-length').value,
      mode: document.getElementById('copy-mode').value,
      extra: document.getElementById('copy-extra').value,
    });
    if (!r.success) throw new Error(r.message || '產生失敗');
    const box = document.getElementById('copy-result');
    box.value = r.text;
    box.style.display = 'block';
    document.getElementById('copy-actions').style.display = 'block';
    setExportMsg('copy-msg', '✓ 完成（可以直接在下面修改）。請自己確認型號與規格都正確再上架。' + (products.length > 30 ? ' 一次最多寫 30 個產品，只用了前 30 個。' : ''));
  } catch (e) {
    setExportMsg('copy-msg', '');
    alert(e.message);
  } finally {
    btn.disabled = false;
  }
}

async function copyResultText() {
  setExportMsg('copy-msg', (await copyText(document.getElementById('copy-result').value)) ? '✓ 已複製文案' : '複製失敗，請手動選取');
}

function downloadResultText() {
  downloadFile('產品文案_' + exportStamp() + '.txt', document.getElementById('copy-result').value, 'text/plain');
}

if (typeof module !== 'undefined') module.exports = { EXPORT_FIELDS, exportPrice, exportSpecPairs, exportSummary, exportOfficialSpecs, buildExportTable, tableToCsv, tableToTsv, buildCopyItems };
