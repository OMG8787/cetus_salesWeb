/**
 * calc.js - 選型計算 頁面專屬邏輯
 * ------------------------------------------------------------
 * 跟客戶洽談時邊聽邊輸入，任何欄位一改就即時重算，並把「算不過 / 前後矛盾」的地方
 * 馬上列在右側「檢查結果」，相關欄位也會標紅/標黃。每個結果底下用小字列出代入數字的算式，
 * 方便自己檢查、也能直接跟客戶解釋。
 *
 * 計算順序（前一步的結果是下一步的輸入）：
 *   ① 需求：要求空間解析度 = 最小精度 ÷ 每特徵像素；相機至少像素 = 檢測範圍 ÷ 要求空間解析度
 *   ② 相機：感測器尺寸 = 像素數 × 像素尺寸；選「空間解析度基準邊」（預設短邊）
 *   ③ 鏡頭：FA 焦距 F = 感測器 × WD ÷ 視野；遠心倍率 = 感測器 ÷ 視野（都用基準邊）。
 *         計算值自動寫進「焦距 / 倍率」欄位（可手動改），再用欄位值依型錄打分數建議（規則同 CCD_lens.html）
 *   ④ 實際視野 = 感測器 × WD ÷ F（FA）或 感測器 ÷ 倍率（遠心）；空間解析度 = 基準邊實際視野 ÷ 基準邊像素
 *   ⑤ 飛拍：拖影(px) = 速度 × 曝光 ÷ 空間解析度；所需影格率 = 速度 ÷ 移動方向視野
 * 相機長邊一律對齊檢測範圍的長 W。
 * ------------------------------------------------------------
 */

const STANDARD_FOCAL_LENGTHS = [8, 12, 16, 25, 35, 50, 75];
const TOL_SYMBOLS = { pm: '±', p: '+', m: '-' };
const CALC_STATE_KEY = 'aoi_calc_state';
const CATALOG_CACHE_KEY = 'visionCatalog_v4';
const CALC_INPUT_IDS = [
  'c-fov-l', 'c-fov-s', 'c-acc-tol', 'c-acc', 'c-acc-unit', 'c-ppf', 'c-wd',
  'c-cam-source', 'c-cam-iface', 'c-brand', 'c-origin', 'c-cam-model', 'c-px-side', 'c-res-w', 'c-res-h', 'c-pix', 'c-fps',
  'c-lens-type', 'c-lens-model', 'c-f-user', 'c-mag-user',
  'c-speed', 'c-motion', 'c-exp', 'c-exp-unit', 'c-blur', 'c-pps',
];

let cameraCatalog = []; // { name, resW, resH, pixelW, pixelH, fps, iface, size, mp }
let lensCatalog = { fa: [], tele: [] }; // fa: { name, f, sensorSize, resolution, focusWd } / tele: { name, mag, wd, dof, sensorSize, resolution }
let catalogLoaded = false;
let lastCalc = null; // 最近一次計算結果，給「複製摘要 / 存回案件」用
let calcCaseCcds = []; // 目前選的案件的 CCD 清單
let savedSelects = {}; // 型錄載入前記住的型號選擇（載入完才選得回去）

// ------------------------------------------------------------
// 小工具
// ------------------------------------------------------------
function num(id) {
  const v = parseFloat(document.getElementById(id).value);
  return isNaN(v) ? NaN : v;
}

function val(id) {
  return document.getElementById(id).value;
}

/** 依大小自動決定小數位數。 */
function fmt(n, digits) {
  if (n == null || isNaN(n) || !isFinite(n)) return '-';
  if (digits != null) return n.toFixed(digits);
  const a = Math.abs(n);
  if (a >= 1000) return n.toFixed(0);
  if (a >= 10) return n.toFixed(1);
  if (a >= 1) return n.toFixed(2);
  if (a >= 0.01) return n.toFixed(4);
  return n.toFixed(6);
}

/** mm/px 顯示成 µm/px 比較好讀。 */
function fmtPx(mmPerPx) {
  return isFinite(mmPerPx) ? `${fmt(mmPerPx * 1000)} µm/px` : '-';
}

function fmtExposure(sec) {
  if (!isFinite(sec)) return '-';
  return sec >= 0.001 ? `${fmt(sec * 1000)} ms` : `${fmt(sec * 1e6)} µs`;
}

/**
 * 寫入結果：text 是大字結果，formula 是底下的小字算式（可以是陣列，一行一條）。
 * 算式同時收集到 formulaLog，複製摘要時一起帶出去。
 */
let formulaLog = [];
function setOut(id, text, formula) {
  const strong = document.getElementById(id);
  strong.textContent = text == null || text === '' ? '-' : text;
  const box = strong.parentElement;
  let small = box.querySelector('.calc-formula');
  if (!small) {
    small = document.createElement('small');
    small.className = 'calc-formula';
    box.appendChild(small);
  }
  const lines = !formula ? [] : Array.isArray(formula) ? formula : [formula];
  small.textContent = lines.join('\n');
  if (lines.length && text) formulaLog.push(`${box.querySelector('span').textContent}：${lines.join('；')}`);
}

// ------------------------------------------------------------
// 主計算：每次任何欄位變動都整個重算一次
// ------------------------------------------------------------
function recalc() {
  saveCalcState();
  toggleLensFields();
  formulaLog = [];
  document.querySelectorAll('.calc-page .field-error, .calc-page .field-warn').forEach((el) => el.classList.remove('field-error', 'field-warn'));

  const msgs = [];
  const add = (level, text, fields) => msgs.push({ level, text, fields: fields || [] });

  const req = calcRequirement(add);
  const cam = calcCamera(req, add);
  renderCameraRecs(req, cam);
  const lens = calcLens(req, cam, add);
  const act = calcActual(req, cam, lens, add);
  const fly = calcFly(req, cam, act, add);

  renderMessages(msgs);
  lastCalc = { req, cam, lens, act, fly, msgs, formulas: formulaLog.slice() };
}

// ---- ① 客戶需求 ----
function calcRequirement(add) {
  let fovL = num('c-fov-l');
  let fovS = num('c-fov-s');
  const accRaw = num('c-acc');
  const accUnit = val('c-acc-unit');
  const accInput = accUnit === 'um' ? accRaw / 1000 : accRaw; // 一律換成 mm
  // 公差方向：± 兩側各容許 X → 以 X 計算；只能多(+X) / 只能少(−X) 公差帶只有一側、寬 X，
  // 量測誤差要落在帶寬中間（兩側各 X/2）→ 以 X ÷ 2 計算
  const tol = val('c-acc-tol');
  const acc = tol === 'pm' ? accInput : accInput / 2;
  const ppf = num('c-ppf');
  const wd = num('c-wd');

  [['c-fov-l', fovL], ['c-fov-s', fovS], ['c-acc', accRaw], ['c-ppf', ppf], ['c-wd', wd]].forEach(([id, v]) => {
    if (!isNaN(v) && v <= 0) add('error', '數值必須大於 0', [id]);
  });

  if (fovL > 0 && fovS > 0 && fovS > fovL) {
    add('info', `寬 H (${fovS}) 比長 W (${fovL}) 大，已自動把長短邊對調計算`, ['c-fov-l', 'c-fov-s']);
    [fovL, fovS] = [fovS, fovL];
  }
  if (ppf > 0 && ppf < 3) add('error', `單個特徵只給 ${ppf} px 太少，影像處理幾乎判斷不出來（建議 ≥ 5 px）`, ['c-ppf']);
  else if (ppf > 0 && ppf < 5) add('warn', `單個特徵 ${ppf} px 偏低，建議至少 5 px 檢測才穩定`, ['c-ppf']);

  const accLabel = `${TOL_SYMBOLS[tol]}${accRaw} ${accUnit === 'um' ? 'µm' : 'mm'}`;
  const r = { fovL, fovS, acc, accInput, tol, accLabel, ppf, wd, ok: fovL > 0 && fovS > 0 && acc > 0 && ppf > 0, pxReq: NaN, reqW: NaN, reqH: NaN };
  if (!r.ok) {
    setOut('o-acc-eff', '');
    setOut('o-px-req', '');
    setOut('o-res-req', '');
    add('info', '請先輸入檢測範圍 W / H 與最小檢測精度');
    return r;
  }

  const otherUnit = accUnit === 'um' ? 'mm' : 'µm';
  if (accInput >= fovS) {
    add('error', `最小檢測精度 ${fmt(accInput)} mm 比檢測範圍還大，單位可能打錯（應該選 ${otherUnit}？）`, ['c-acc', 'c-acc-unit']);
  } else if (accInput > fovS / 20) {
    add('warn', `最小檢測精度 ${fmt(accInput)} mm 佔了檢測範圍的 1/${Math.round(fovS / accInput)}，不太像 AOI 精度，請確認單位是否該選 ${otherUnit}`, ['c-acc', 'c-acc-unit']);
  }

  const um = (mm) => `${fmt(mm * 1000)} µm`;
  if (tol === 'pm') {
    setOut('o-acc-eff', um(acc), `= ${accLabel}：兩側各容許 ${um(accInput)}，直接以 ${um(acc)} 計算`);
  } else {
    const dir = tol === 'p' ? '只能多不能少' : '只能少不能多';
    const band = tol === 'p' ? `0 ~ +${um(accInput)}` : `−${um(accInput)} ~ 0`;
    setOut('o-acc-eff', um(acc), [
      `= ${accLabel}（${dir}）：公差帶 ${band}，寬 ${um(accInput)}`,
      `量測誤差要落在公差帶中間 → ${um(accInput)} ÷ 2 = ${um(acc)}`,
    ]);
  }

  r.pxReq = acc / ppf;
  r.reqW = Math.ceil(fovL / r.pxReq);
  r.reqH = Math.ceil(fovS / r.pxReq);
  setOut('o-px-req', `≤ ${fmtPx(r.pxReq)}`, `= 計算用精度 ${fmt(acc * 1000)} µm ÷ 每特徵 ${ppf} px = ${fmtPx(r.pxReq)}`);
  setOut('o-res-req', `${r.reqW} × ${r.reqH}（${fmt((r.reqW * r.reqH) / 1e6, 1)} MP）`, [
    `長 = ${fmt(fovL)} mm ÷ ${fmt(r.pxReq * 1000)} µm/px = ${r.reqW} px`,
    `寬 = ${fmt(fovS)} mm ÷ ${fmt(r.pxReq * 1000)} µm/px = ${r.reqH} px（無條件進位）`,
  ]);
  if (r.pxReq < 0.001) add('warn', `要求空間解析度 ${fmtPx(r.pxReq)} 小於 1 µm，已接近光學極限，建議確認需求或改用顯微/高倍率方案`, ['c-acc']);
  return r;
}

// ---- ② 相機 ----
function calcCamera(req, add) {
  const cam = pickCamera(req, add);
  if (!cam) {
    ['o-cam', 'o-sensor'].forEach((id) => setOut(id, ''));
    if (req.ok) add('info', '請選擇相機（需要相機像素數才算得出空間解析度）', ['c-cam-model', 'c-res-w']);
    return null;
  }
  setOut('o-cam', `${cam.name}｜${cam.resW} × ${cam.resH}${cam.fps ? `｜${cam.fps} fps` : ''}`, `${fmt(cam.mp, 1)} MP${cam.iface ? `，${cam.iface}` : ''}${cam.size ? `，靶面 ${cam.size}` : ''}`);

  if (!(cam.pixelW > 0 && cam.pixelH > 0)) {
    setOut('o-sensor', '');
    add('error', '相機缺少像素尺寸，算不出感測器尺寸、鏡頭與空間解析度', ['c-pix']);
    return cam;
  }
  cam.sensorW = (cam.resW * cam.pixelW) / 1000;
  cam.sensorH = (cam.resH * cam.pixelH) / 1000;
  setOut('o-sensor', `${fmt(cam.sensorW)} × ${fmt(cam.sensorH)} mm`, [
    `長 = ${cam.resW} px × ${cam.pixelW} µm = ${fmt(cam.sensorW)} mm`,
    `寬 = ${cam.resH} px × ${cam.pixelH} µm = ${fmt(cam.sensorH)} mm`,
  ]);

  if (req.ok) {
    // 基準邊（預設短邊）：空間解析度、FA 焦距、遠心倍率都以這一邊計算
    cam.side = val('c-px-side') === 'l' ? 'l' : 's';
    cam.sideName = cam.side === 's' ? '短邊' : '長邊';
    cam.otherName = cam.side === 's' ? '長邊' : '短邊';
    cam.sensorSide = cam.side === 's' ? cam.sensorH : cam.sensorW;
    cam.fovSide = cam.side === 's' ? req.fovS : req.fovL;
    cam.resSide = cam.side === 's' ? cam.resH : cam.resW;
    cam.k = cam.sensorSide / cam.fovSide; // 成像比例 = 感測器 ÷ 視野（遠心鏡頭就是倍率）

    // 相機本身的能力：鏡頭剛好把基準邊拍滿時的空間解析度
    cam.pxIdeal = cam.fovSide / cam.resSide;
    cam.resOk = req.acc / cam.pxIdeal >= req.ppf;
    if (!cam.resOk) {
      const tiles = Math.ceil(req.reqW / cam.resW) * Math.ceil(req.reqH / cam.resH);
      add('error', `相機像素不足：就算鏡頭剛好拍滿${cam.sideName}，最小特徵也只佔 ${fmt(req.acc / cam.pxIdeal, 1)} px（需 ≥ ${req.ppf} px）。需要 ≥ ${req.reqW} × ${req.reqH}，或把檢測範圍拆成 ${tiles} 個視野拍`, ['c-cam-model', 'c-res-w', 'c-res-h']);
    }
  }
  return cam;
}

/** 決定採用哪台相機：手動規格，或型錄中指定型號 / 自動挑最小符合者。 */
function pickCamera(req, add) {
  if (val('c-cam-source') === 'manual') {
    let resW = num('c-res-w');
    let resH = num('c-res-h');
    const pix = num('c-pix');
    const fps = num('c-fps');
    if (!(resW > 0) || !(resH > 0)) return null;
    if (resH > resW) [resW, resH] = [resH, resW];
    if (pix > 50) add('warn', `像素尺寸 ${pix} µm 異常大，請確認單位是 µm（一般工業相機約 1.5 ~ 10 µm）`, ['c-pix']);
    return { name: '手動輸入', resW, resH, pixelW: pix, pixelH: pix, fps: fps > 0 ? fps : 0, mp: (resW * resH) / 1e6 };
  }

  if (!cameraCatalog.length) return null;
  const chosen = val('c-cam-model');
  if (chosen) {
    const cam = cameraCatalog.find((c) => c.name === chosen);
    if (cam && req.ok && (cam.resW < req.reqW || cam.resH < req.reqH)) {
      const auto = findSmallestCamera(req.reqW, req.reqH);
      if (auto) add('warn', `型錄中最小符合需求的是 ${auto.name}（${auto.resW} × ${auto.resH}）`, ['c-cam-model']);
    }
    return cam ? Object.assign({}, cam) : null;
  }
  if (!req.ok) return null;
  const auto = findSmallestCamera(req.reqW, req.reqH);
  if (!auto) {
    const pool = cameraPool();
    if (!pool.length) return null;
    const biggest = pool.reduce((a, b) => (b.mp > a.mp ? b : a));
    add('error', `型錄裡沒有任何一台相機達到 ${req.reqW} × ${req.reqH}，以下以最大的 ${biggest.name} 計算，建議拆成多個視野或改用線掃相機`, ['c-cam-model']);
    return Object.assign({}, biggest);
  }
  return Object.assign({}, auto);
}

/**
 * 相機推薦（規則同 CCD_camera.html）：長邊像素 ≥ 所需長邊、短邊像素 ≥ 所需短邊，
 * 再依畫素由小到大排（最接近需求的在前面），同畫素時 GigE 優先。
 */
// 品牌 → 產地（型錄沒有產地欄時的預設對照；產品資料庫(Products)有填產地的型號會優先採用）
const BRAND_ORIGIN_RULES = [
  [/basler|allied\s*vision|avt|schneider|ids\b|imaging\s*source|vieworks/i, '德國'],
  [/flir|cognex|edmund|navitar|point\s*grey|teledyne\s*flir/i, '美國'],
  [/dalsa/i, '加拿大'],
  [/hik|海康|mind\s*vision|mv-|大恆|daheng|dhc|華睿|dahua|大華|嘉恆|do3think|\bhr\b/i, '中國'],
  [/sony|omron|computar|tamron|kowa|fujinon|fujifilm|moritex|myutron|keyence|panasonic|ricoh|cbc|evt/i, '日本'],
  [/opto\s*engineering|optotune/i, '義大利'],
  [/lucid/i, '加拿大'],
  [/sentech|toshiba|jai/i, '日本'],
  [/vst|opt\b/i, '日本'],
];
let productOriginMap = {}; // 型號(大寫) → 產地，來自產品資料庫

function originOf(item) {
  const brandRule = BRAND_ORIGIN_RULES.find((r) => r[0].test(item.brand || '') || r[0].test(item.name || ''));
  if (brandRule) return brandRule[1];
  return productOriginMap[String(item.name || '').toUpperCase()] || '';
}

function matchesBrandOrigin(item) {
  const b = val('c-brand');
  const o = val('c-origin');
  return (!b || item.brand === b) && (!o || originOf(item) === o);
}

/** 依「介面類別」「品牌」「產地」選項過濾後的相機清單（空值 = 不限）。 */
function cameraPool() {
  const f = val('c-cam-iface');
  return cameraCatalog.filter((c) => (!f || c.iface === f) && matchesBrandOrigin(c));
}

/** 依品牌 / 產地過濾後的鏡頭清單。 */
function lensPool(type) {
  return lensCatalog[type].filter(matchesBrandOrigin);
}

/** 品牌 / 產地下拉選項：直接依型錄（相機 + 鏡頭）裡有哪些產生。 */
function rebuildBrandOriginOptions() {
  const all = [...cameraCatalog, ...lensCatalog.fa, ...lensCatalog.tele];
  const build = (id, firstLabel, values) => {
    const select = document.getElementById(id);
    const keep = select.value || savedSelects[id] || '';
    select.innerHTML = '<option value="">' + firstLabel + '</option>';
    [...new Set(values.filter(Boolean))].sort().forEach((v) => {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      select.appendChild(opt);
    });
    if ([...select.options].some((o) => o.value === keep)) select.value = keep;
  };
  build('c-brand', '不限品牌', all.map((x) => x.brand));
  build('c-origin', '不限產地', all.map(originOf));
}

/** 產品資料庫有填產地的型號補進對照表，讀完後重建選項（讀不到就只用品牌對照）。 */
async function loadProductOrigins() {
  try {
    let list = getCached('products_all');
    if (!list) {
      const r = await callApi('searchProducts', { keyword: '' });
      if (!r.success) return;
      list = r.products;
    }
    const map = {};
    list.forEach((p) => {
      if (!p.Origin) return;
      [p.InternalModel, p.SupplierModel].forEach((m) => {
        if (m) map[String(m).toUpperCase()] = p.Origin;
      });
    });
    productOriginMap = map;
    rebuildBrandOriginOptions();
    recalc();
  } catch (e) {
    console.error('讀取產品產地失敗', e);
  }
}

function findCameraRecs(reqW, reqH, count) {
  const gigeFirst = (c) => (String(c.iface).toLowerCase().includes('gige') ? 0 : 1);
  return cameraPool()
    .filter((c) => c.resW >= reqW && c.resH >= reqH)
    .sort((a, b) => a.mp - b.mp || gigeFirst(a) - gigeFirst(b))
    .slice(0, count);
}

function findSmallestCamera(reqW, reqH) {
  return findCameraRecs(reqW, reqH, 1)[0] || null;
}

function renderCameraRecs(req, used) {
  const box = document.getElementById('c-cam-recs');
  box.innerHTML = '';
  if (!cameraCatalog.length) {
    box.innerHTML = `<div class="calc-hint">${catalogLoaded ? '沒有相機型錄資料，請用手動輸入規格' : '型錄載入中...'}</div>`;
    return;
  }
  if (!req.ok) {
    box.innerHTML = '<div class="calc-hint">輸入檢測範圍與最小精度後顯示</div>';
    return;
  }
  const recs = findCameraRecs(req.reqW, req.reqH, 3);
  if (!recs.length) {
    box.innerHTML = `<div class="calc-msg calc-msg-warn">⚠ 型錄裡沒有長邊 ≥ ${req.reqW} px 且短邊 ≥ ${req.reqH} px 的相機（需 ${fmt((req.reqW * req.reqH) / 1e6, 1)} MP），建議拆成多個視野或改用線掃相機</div>`;
    return;
  }
  const reqMp = (req.reqW * req.reqH) / 1e6;
  const manual = val('c-cam-source') === 'manual';
  recs.forEach((c, i) => {
    const isUsed = !manual && used && used.name === c.name;
    const marginL = (c.resW / req.reqW - 1) * 100;
    const marginS = (c.resH / req.reqH - 1) * 100;
    const card = document.createElement('div');
    card.className = 'lens-card' + (isUsed ? ' lens-card-used' : '');
    card.innerHTML = `
      <div class="lens-card-head"><strong>${i === 0 ? '⭐ ' : ''}${c.name}</strong><span class="lens-score">${fmt(c.mp, 1)} MP</span></div>
      <small class="calc-formula">${c.resW} × ${c.resH} / 像素 ${c.pixelW ? fmt(c.pixelW) + ' µm' : '-'} / ${c.iface || '-'}${c.fps ? ` / ${c.fps} fps` : ''}${c.size ? ` / 靶面 ${c.size}` : ''}</small>
      <div><span class="lens-badge good">✔ 符合需求</span>${i === 0 ? '<span class="lens-badge good">最接近需求</span>' : ''}</div>
      <small class="calc-formula">長邊 ${c.resW} ≥ ${req.reqW}（餘裕 +${fmt(marginL, 0)}%）
短邊 ${c.resH} ≥ ${req.reqH}（餘裕 +${fmt(marginS, 0)}%）
需求 ${fmt(reqMp, 1)} MP → 此款 ${fmt(c.mp, 1)} MP</small>
      ${isUsed ? '<div class="lens-used-tag">目前採用</div>' : ''}`;
    card.addEventListener('click', () => {
      document.getElementById('c-cam-source').value = 'catalog';
      toggleCamSource();
      document.getElementById('c-cam-model').value = c.name;
      recalc();
    });
    box.appendChild(card);
  });
}

// ---- ③ 鏡頭 ----
// FA：焦距 F = 感測器 × WD ÷ 視野；遠心：倍率 = 感測器 ÷ 視野（都用「空間解析度基準邊」那一邊）。
// 計算值自動寫進「焦距 F / 倍率」欄位，也可以手動改；型錄建議就用這個欄位的值去搜尋。
function calcLens(req, cam, add) {
  const type = val('c-lens-type');
  const isFa = type === 'fa';
  const inputId = isFa ? 'c-f-user' : 'c-mag-user';
  const recBox = document.getElementById('c-lens-recs');
  const lens = { type, used: null, recs: [], calc: NaN, target: NaN, targetManual: false };
  populateLensSelect(type);
  document.getElementById('o-target-label').textContent = isFa ? 'FA 理論焦距' : '遠心 理論倍率';
  const clearOuts = () => ['o-lens', 'o-wd-act', 'o-angle'].forEach((id) => setOut(id, ''));

  if (!(req.ok && cam && cam.k > 0)) {
    syncTargetInput(type, NaN);
    setOut('o-target', '');
    clearOuts();
    recBox.innerHTML = '<div class="calc-hint">輸入需求並選好相機（需有像素尺寸）後顯示</div>';
    return lens;
  }

  const wd = req.wd;
  const s = cam.sideName;
  if (isFa) {
    if (wd > 0) {
      lens.calc = cam.k * wd;
      setOut('o-target', `${fmt(lens.calc)} mm`, `= 感測器${s} ${fmt(cam.sensorSide)} mm × WD ${fmt(wd)} mm ÷ 視野${s} ${fmt(cam.fovSide)} mm = ${fmt(lens.calc)} mm`);
    } else {
      setOut('o-target', '輸入 WD 後計算', '也可以直接在「焦距 F」輸入想用的焦距，系統會反推所需 WD');
    }
  } else {
    lens.calc = cam.k;
    setOut('o-target', `${fmt(lens.calc, 4)} x`, `= 感測器${s} ${fmt(cam.sensorSide)} mm ÷ 視野${s} ${fmt(cam.fovSide)} mm = ${fmt(lens.calc, 4)} x`);
  }

  const t = syncTargetInput(type, lens.calc);
  lens.target = t.value;
  lens.targetManual = t.manual;
  if (t.manual && lens.calc > 0) {
    add('info', `${isFa ? '焦距' : '倍率'}為手動輸入 ${t.value}${isFa ? ' mm' : 'x'}（計算值 ${isFa ? fmt(lens.calc) + ' mm' : fmt(lens.calc, 4) + 'x'}），以手動值搜尋鏡頭`, [inputId]);
  }

  // FA 的 WD：客戶有給就用客戶的；沒給就由焦距反推「剛好拍滿基準邊」的距離
  const wdFor = (f) => (wd > 0 ? wd : f / cam.k);
  if (isFa) {
    if (wd > 0 && lens.target >= wd) add('error', `焦距 ${fmt(lens.target)} mm ≥ WD ${wd} mm，FA 鏡頭做不到，請改用遠心/顯微鏡頭或加大視野`, ['c-wd', inputId]);
    else if (lens.target > 80) add('warn', `焦距 ${fmt(lens.target)} mm 超過一般 FA 鏡頭範圍（≤ 75 mm），建議縮短 WD、加大視野，或改用遠心鏡頭`, ['c-wd', inputId]);
    if (cam.k > 0.3) add('warn', `視野${s}只有感測器的 ${fmt(1 / cam.k, 1)} 倍（成像比例 ${fmt(cam.k, 3)}），FA 鏡頭需加很長的延伸環才對得到焦，建議改用遠心或微距鏡頭`, ['c-lens-type']);
  }

  if (!(lens.target > 0)) {
    clearOuts();
    recBox.innerHTML = '<div class="calc-hint">FA 鏡頭需要工作距離 WD，或直接輸入焦距 F，才能搜尋鏡頭</div>';
    add('info', 'FA 鏡頭需要工作距離 WD（或直接輸入焦距 F）才能計算', ['c-wd', 'c-f-user']);
    return lens;
  }

  lens.recs = isFa ? scoreFaLenses(req, cam, lens.target, wdFor) : scoreTeleLenses(req, cam, lens.target);
  lens.used = pickLens(type, lens, req);
  renderLensRecs(lens.recs, lens.used, type);

  if (lensPool(type).length && !lens.recs.length) {
    const tv = isFa ? `焦距 ${fmt(lens.target)} mm` : `倍率 ${fmt(lens.target, 4)}x`;
    const inRange = lensPool(type).some((l) => Math.abs((isFa ? l.f : l.mag) - lens.target) / lens.target <= 0.5);
    const why = inRange ? '接近的型號都因解析力 / 延伸環 / 視野扣分過多' : '型錄裡沒有 ±50% 內的型號';
    add('warn', `找不到合適的${isFa ? 'FA' : '遠心'}鏡頭（${tv}，${why}），目前以計算值推算。可從「型號」手動挑一支看詳細問題，${isFa ? '或調整 WD、改用遠心鏡頭' : '或改用 FA 鏡頭'}`, ['c-lens-model', inputId]);
  }

  const u = lens.used;
  if (isFa) {
    u.wd = wdFor(u.f);
    setOut('o-lens', `${u.name}（F ${fmt(u.f)} mm）`, u.detail || '');
    setOut('o-wd-act', `${fmt(u.wd)} mm`, wd > 0 ? '客戶指定' : `= 焦距 ${fmt(u.f)} mm × 視野${s} ${fmt(cam.fovSide)} mm ÷ 感測器${s} ${fmt(cam.sensorSide)} mm = ${fmt(u.wd)} mm（剛好拍滿所需）`);
    const angH = 2 * Math.atan(cam.sensorW / (2 * u.f)) * (180 / Math.PI);
    const angV = 2 * Math.atan(cam.sensorH / (2 * u.f)) * (180 / Math.PI);
    setOut('o-angle', `${fmt(angH, 1)}° / ${fmt(angV, 1)}°`, [
      `水平 = 2 × atan(${fmt(cam.sensorW)} ÷ (2 × ${fmt(u.f)})) = ${fmt(angH, 1)}°`,
      `垂直 = 2 × atan(${fmt(cam.sensorH)} ÷ (2 × ${fmt(u.f)})) = ${fmt(angV, 1)}°`,
    ]);
    if (u.wd <= u.f) add('error', `WD ${fmt(u.wd)} mm 小於等於焦距 ${fmt(u.f)} mm，無法成像`, ['c-wd', 'c-f-user']);
    else {
      u.ring = extensionRing(u.f, u.wd, u.focusWd);
      if (u.ring > 0) add('warn', `${u.name} 最近對焦距離 ${fmt(u.focusWd)} mm，WD ${fmt(u.wd)} mm 需加裝延伸環約 ${fmt(u.ring, 1)} mm（= F²/(WD−F) − F²/(最近對焦−F)）`, ['c-wd']);
    }
  } else {
    setOut('o-lens', `${u.name}（${fmt(u.mag, 4)}x）`, u.detail || '');
    setOut('o-wd-act', u.wd ? `${u.wd} mm` : '-', u.virtual ? '尚未選定鏡頭型號' : '遠心鏡頭 WD 為鏡頭固定規格');
    setOut('o-angle', '');
    const lensWd = parseFloat(u.wd);
    if (wd > 0 && lensWd > 0 && Math.abs(lensWd - wd) / wd > 0.1) {
      add('warn', `${u.name} 工作距離固定 ${lensWd} mm，跟客戶提的 WD ${wd} mm 不同，機構需配合調整`, ['c-wd']);
    }
  }

  if (u.resolution && cam.mp > getLensMp(u.resolution)) {
    add('warn', `${u.name} 解析力 ${u.resolution}，低於相機 ${fmt(cam.mp, 1)} MP，影像邊緣可能不夠銳利`, ['c-lens-model']);
  }
  return lens;
}

/**
 * 「焦距 F / 倍率」欄位：自動模式時把計算值寫進去（顯示用四捨五入，計算用原值）；
 * 使用者自己打字就變手動模式，直到按「↺ 自動」或清空欄位。
 */
function syncTargetInput(type, calcValue) {
  const id = type === 'fa' ? 'c-f-user' : 'c-mag-user';
  const el = document.getElementById(id);
  const manual = el.dataset.manual === '1' && el.value !== '';
  if (!manual) {
    el.dataset.manual = '0';
    el.value = calcValue > 0 ? (type === 'fa' ? calcValue.toFixed(2) : calcValue.toFixed(4)) : '';
  }
  const tag = document.getElementById(id + '-mode');
  tag.textContent = manual ? '手動' : '自動';
  tag.classList.toggle('manual', manual);
  document.getElementById(id + '-auto').style.display = manual ? '' : 'none';
  return { value: manual ? parseFloat(el.value) : calcValue, manual };
}

function setTargetAuto(id) {
  document.getElementById(id).dataset.manual = '0';
  recalc();
}

/** 採用哪支鏡頭：型號下拉選的 > 建議第一名 > 沒型錄時用標準焦距 / 欄位數值。 */
function pickLens(type, lens, req) {
  const recs = lens.recs;
  const chosen = val('c-lens-model');
  if (chosen) {
    const inRecs = recs.find((l) => l.name === chosen);
    if (inRecs) return inRecs;
    const raw = lensCatalog[type].find((l) => l.name === chosen);
    if (raw) {
      const detail = type === 'fa' ? `焦距 ${raw.f} mm / 靶面 ${raw.sensorSize || '-'} / 解析力 ${raw.resolution || '-'}（不在建議名單內）` : `倍率 ${raw.mag}x / WD ${raw.wd || '-'} mm / 景深 ${raw.dof || '-'} mm（不在建議名單內）`;
      return Object.assign({}, raw, { detail }, type === 'fa' ? { focusWd: raw.focusWd || raw.f * 10 } : {});
    }
  }

  const best = recs.find((l) => !l.errors.length) || recs[0];
  if (best) return best;

  if (type === 'fa') {
    // 沒有 FA 型錄、焦距又是自動算的：挑「拍得滿」的最長標準焦距（焦距越短視野越大）
    if (!lensCatalog.fa.length && !lens.targetManual && req.wd > 0) {
      const fits = STANDARD_FOCAL_LENGTHS.filter((F) => F <= lens.target);
      if (fits.length) {
        const F = fits[fits.length - 1];
        return { name: `標準 ${F} mm`, f: F, focusWd: 0, virtual: true, detail: `沒有鏡頭型錄，以不超過計算焦距 ${fmt(lens.target)} mm 的標準焦距推算（不計算延伸環）` };
      }
    }
    return { name: lens.targetManual ? '手動焦距' : '理論焦距', f: lens.target, focusWd: 0, virtual: true, detail: '尚未選定鏡頭型號，以欄位焦距計算（不計算延伸環）' };
  }
  return { name: lens.targetManual ? '手動倍率' : '理論倍率', mag: lens.target, virtual: true, detail: '尚未選定鏡頭型號，以欄位倍率計算' };
}

/** FA 鏡頭打分數（規則同 CCD_lens.html）：只看焦距在目標 ±50% 內，100 分往下扣。 */
function scoreFaLenses(req, cam, targetF, wdFor) {
  if (req.wd > 0 && targetF >= req.wd) return [];
  return lensPool('fa')
    .filter((l) => Math.abs(l.f - targetF) / targetF <= 0.5)
    .map((l) => {
      const errors = [];
      const warnings = [];
      const notes = [];
      let score = 100;
      const wd = wdFor(l.f);

      const gap = Math.abs(l.f - targetF) / targetF;
      if (gap > 0.0001) {
        score -= gap * 50;
        notes.push(`焦距差 ${fmt(gap * 100, 0)}% −${fmt(gap * 50, 1)}`);
      }
      if (cam.mp > getLensMp(l.resolution)) {
        score -= 15;
        warnings.push('解析力偏低');
        notes.push('解析力 < 相機 −15');
      }
      const focusWd = l.focusWd || l.f * 10;
      const ring = extensionRing(l.f, wd, focusWd);
      if (ring > 0) {
        score -= ring * 2.5;
        warnings.push(`延伸環 ${fmt(ring, 1)} mm`);
        notes.push(`延伸環 ${fmt(ring, 1)} mm −${fmt(ring * 2.5, 1)}`);
      }
      // 在這個 WD 下實際拍得到的視野（原計算器沒扣這項，這裡補上：焦距比目標長就拍不滿）
      const fovL = (cam.sensorW * wd) / l.f;
      const fovS = (cam.sensorH * wd) / l.f;
      if (fovL < req.fovL - 1e-6 || fovS < req.fovS - 1e-6) {
        score -= 30;
        errors.push('視野拍不滿');
        notes.push(`視野 ${fmt(fovL)}×${fmt(fovS)} 拍不滿 −30`);
      }
      return Object.assign({}, l, {
        focusWd,
        ring,
        score: Math.max(0, score),
        errors,
        warnings,
        detail: `焦距 ${l.f} mm / 靶面 ${l.sensorSize || '-'} / 解析力 ${l.resolution || '-'} / WD ${fmt(wd)}${req.wd > 0 ? '' : '（反推）'} 時視野 ${fmt(fovL)}×${fmt(fovS)} mm`,
        notes,
      });
    })
    .filter((l) => l.score >= 25)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

/** 遠心鏡頭打分數（規則同 CCD_lens.html）：只看倍率在目標 ±50% 內。 */
function scoreTeleLenses(req, cam, targetMag) {
  return lensPool('tele')
    .filter((l) => Math.abs(l.mag - targetMag) / targetMag <= 0.5)
    .map((l) => {
      const errors = [];
      const warnings = [];
      const notes = [];
      let score = 100;
      const gap = Math.abs(l.mag - targetMag) / targetMag;
      if (gap > 0.0001) {
        score -= gap * 80;
        warnings.push('倍率不完全相符');
        notes.push(`倍率差 ${fmt(gap * 100, 0)}% −${fmt(gap * 80, 1)}`);
      }
      const fovL = cam.sensorW / l.mag;
      const fovS = cam.sensorH / l.mag;
      if (fovL < req.fovL - 1e-6 || fovS < req.fovS - 1e-6) {
        score -= 30;
        errors.push('視野拍不滿');
        notes.push(`視野 ${fmt(fovL)}×${fmt(fovS)} 拍不滿 −30`);
      }
      return Object.assign({}, l, {
        score: Math.max(0, score),
        errors,
        warnings,
        detail: `倍率 ${l.mag}x / WD ${l.wd || '-'} mm / 景深 ${l.dof || '-'} mm / 視野 ${fmt(fovL)}×${fmt(fovS)} mm`,
        notes,
      });
    })
    .filter((l) => l.score >= 15)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

/** 延伸環長度 = F²/(WD−F) − F²/(最近對焦距離−F)；WD 比最近對焦距離近才需要。 */
function extensionRing(f, wd, focusWd) {
  if (!(wd > f) || !(focusWd > f) || wd >= focusWd) return 0;
  return Math.max(0.1, (f * f) / (wd - f) - (f * f) / (focusWd - f));
}

function getLensMp(resStr) {
  const m = String(resStr || '').match(/([0-9.]+)/);
  return m ? parseFloat(m[1]) : 5;
}

function renderLensRecs(recs, used, type) {
  const box = document.getElementById('c-lens-recs');
  box.innerHTML = '';
  if (!lensPool(type).length) {
    box.innerHTML = `<div class="calc-hint">${catalogLoaded ? '型錄裡沒有' : '尚未載入'}${type === 'fa' ? ' FA ' : '遠心'}鏡頭資料，${type === 'fa' ? '以標準焦距 8/12/16/25/35/50/75 mm 或欄位焦距推算' : '以欄位倍率推算'}</div>`;
    return;
  }
  if (!recs.length) {
    box.innerHTML = `<div class="calc-msg calc-msg-warn">⚠ 型錄中找不到${type === 'fa' ? '焦距' : '倍率'}在目標 ±50% 內且評分及格的鏡頭，請調整 WD / 視野 / 欄位數值，或切換鏡頭類型</div>`;
    return;
  }
  recs.forEach((l, i) => {
    const card = document.createElement('div');
    const isUsed = used && used.name === l.name;
    card.className = 'lens-card' + (isUsed ? ' lens-card-used' : '') + (l.errors.length ? ' lens-card-bad' : '');
    const pct = Math.round(l.score);
    const badges = [
      ...l.errors.map((t) => `<span class="lens-badge bad">✖ ${t}</span>`),
      ...l.warnings.map((t) => `<span class="lens-badge warn">⚠ ${t}</span>`),
    ];
    if (!badges.length) badges.push('<span class="lens-badge good">✔ 符合規格</span>');
    card.innerHTML = `
      <div class="lens-card-head"><strong>${i === 0 && !l.errors.length ? '⭐ ' : ''}${l.name}</strong><span class="lens-score">${pct} 分</span></div>
      <div class="lens-bar"><div style="width:${pct}%" class="${pct >= 70 ? 'high' : pct >= 45 ? 'mid' : 'low'}"></div></div>
      <small class="calc-formula">${l.detail}</small>
      <div>${badges.join('')}</div>
      <small class="calc-formula">評分：100${l.notes.length ? ' ' + l.notes.join('、') : ''} = ${pct}</small>
      ${isUsed ? '<div class="lens-used-tag">目前採用</div>' : ''}`;
    card.addEventListener('click', () => {
      document.getElementById('c-lens-model').value = l.name;
      recalc();
    });
    box.appendChild(card);
  });
}

function populateLensSelect(type) {
  const select = document.getElementById('c-lens-model');
  const pool = lensPool(type);
  const poolKey = `${pool.length}|${val('c-brand')}|${val('c-origin')}`;
  if (select.dataset.type === type && select.dataset.count === poolKey) return;
  const keep = select.value || savedSelects['c-lens-model'] || '';
  select.innerHTML = '<option value="">自動（採用建議第一名）</option>';
  const list = pool.slice().sort((a, b) => (type === 'fa' ? a.f - b.f : a.mag - b.mag));
  list.forEach((l) => {
    const opt = document.createElement('option');
    opt.value = l.name;
    opt.textContent = type === 'fa' ? `${l.name}｜F ${l.f} mm｜${l.sensorSize || ''}` : `${l.name}｜${l.mag}x｜WD ${l.wd || '-'}`;
    select.appendChild(opt);
  });
  select.value = list.some((l) => l.name === keep) ? keep : '';
  select.dataset.type = type;
  select.dataset.count = poolKey;
}

function toggleLensFields() {
  const fa = val('c-lens-type') === 'fa';
  document.getElementById('c-f-user-wrap').style.display = fa ? '' : 'none';
  document.getElementById('c-mag-user-wrap').style.display = fa ? 'none' : '';
  document.getElementById('o-angle-box').style.display = fa ? '' : 'none';
}

// ---- ④ 實際視野與空間解析度 ----
function calcActual(req, cam, lens, add) {
  const a = { fovL: NaN, fovS: NaN, px: NaN, featPx: NaN };
  if (!req.ok || !cam || !(cam.k > 0)) {
    ['o-fov-act', 'o-px-act', 'o-feat-px'].forEach((id) => setOut(id, ''));
    if (req.ok && cam && !(cam.k > 0)) add('info', '相機要有像素尺寸才能算空間解析度');
    return a;
  }

  const u = lens.used;
  let fovFormula;
  if (u && lens.type === 'fa') {
    a.fovL = (cam.sensorW * u.wd) / u.f;
    a.fovS = (cam.sensorH * u.wd) / u.f;
    fovFormula = [
      `長 = 感測器 ${fmt(cam.sensorW)} × WD ${fmt(u.wd)} ÷ F ${fmt(u.f)} = ${fmt(a.fovL)} mm`,
      `寬 = 感測器 ${fmt(cam.sensorH)} × WD ${fmt(u.wd)} ÷ F ${fmt(u.f)} = ${fmt(a.fovS)} mm`,
    ];
  } else if (u && lens.type === 'tele') {
    a.fovL = cam.sensorW / u.mag;
    a.fovS = cam.sensorH / u.mag;
    fovFormula = [
      `長 = 感測器 ${fmt(cam.sensorW)} ÷ 倍率 ${fmt(u.mag, 4)} = ${fmt(a.fovL)} mm`,
      `寬 = 感測器 ${fmt(cam.sensorH)} ÷ 倍率 ${fmt(u.mag, 4)} = ${fmt(a.fovS)} mm`,
    ];
  } else {
    a.fovL = cam.sensorW / cam.k;
    a.fovS = cam.sensorH / cam.k;
    fovFormula = [`理想（鏡頭剛好拍滿${cam.sideName}）= 感測器 ${fmt(cam.sensorW)} × ${fmt(cam.sensorH)} mm ÷ ${fmt(cam.k, 4)}`];
  }

  // 空間解析度 = 基準邊的實際視野 ÷ 基準邊的像素數
  const pxL = a.fovL / cam.resW;
  const pxS = a.fovS / cam.resH;
  a.px = cam.side === 's' ? pxS : pxL;
  a.featPx = req.acc / a.px;

  setOut('o-fov-act', `${fmt(a.fovL)} × ${fmt(a.fovS)} mm`, fovFormula);
  setOut('o-px-act', `${fmtPx(a.px)}（${cam.sideName}）`, cam.side === 's'
    ? [`= 短邊視野 ${fmt(a.fovS)} mm ÷ 短邊 ${cam.resH} px = ${fmtPx(pxS)}`, `（參考：長邊 ${fmt(a.fovL)} ÷ ${cam.resW} = ${fmtPx(pxL)}）`]
    : [`= 長邊視野 ${fmt(a.fovL)} mm ÷ 長邊 ${cam.resW} px = ${fmtPx(pxL)}`, `（參考：短邊 ${fmt(a.fovS)} ÷ ${cam.resH} = ${fmtPx(pxS)}）`]);
  setOut('o-feat-px', `${fmt(a.featPx, 1)} px`, `= 計算用精度 ${fmt(req.acc * 1000)} µm ÷ ${fmtPx(a.px)} = ${fmt(a.featPx, 1)} px（需 ≥ ${req.ppf} px）`);

  if (a.fovL < req.fovL - 1e-6 || a.fovS < req.fovS - 1e-6) {
    // 以基準邊剛好拍滿時，另一邊會不會本來就不夠？會的話建議換基準邊
    const otherShort = cam.side === 's' ? cam.sensorW / cam.k < req.fovL - 1e-6 : cam.sensorH / cam.k < req.fovS - 1e-6;
    const fix = otherShort
      ? `。以${cam.sideName}為基準時${cam.otherName}本來就拍不滿，請把「空間解析度基準邊」改成${cam.otherName}`
      : lens.type === 'fa' && u ? `，WD 需拉到 ≥ ${fmt(u.f / cam.k)} mm 或改用較短焦距` : '，請改用倍率較小的鏡頭';
    add('error', `實際視野 ${fmt(a.fovL)} × ${fmt(a.fovS)} mm 拍不滿檢測範圍 ${fmt(req.fovL)} × ${fmt(req.fovS)} mm${fix}`, ['c-lens-model', 'c-f-user', 'c-mag-user', 'c-wd', 'c-px-side']);
  }
  if (a.featPx < req.ppf) {
    if (cam.resOk) {
      const fix = lens.type === 'fa' ? '請換較接近計算焦距的鏡頭，或把 WD 調到剛好拍滿的距離' : '請換倍率較接近計算倍率的遠心鏡頭，或換更高像素的相機';
      add('error', `鏡頭讓視野變大（${fmt(a.fovL)} × ${fmt(a.fovS)} mm），空間解析度 ${fmtPx(a.px)}，最小特徵只剩 ${fmt(a.featPx, 1)} px（需 ≥ ${req.ppf} px）。${fix}`, ['c-lens-model', 'c-f-user', 'c-mag-user', 'c-wd']);
    }
  } else {
    add('ok', `空間解析度 ${fmtPx(a.px)}（${cam.sideName}），最小特徵佔 ${fmt(a.featPx, 1)} px（需 ≥ ${req.ppf} px）`);
  }
  return a;
}

// ---- ⑤ 飛拍 / 產能 ----
function calcFly(req, cam, act, add) {
  const speed = num('c-speed');
  const expRaw = num('c-exp');
  const expUnit = val('c-exp-unit');
  const exp = expUnit === 'us' ? expRaw / 1e6 : expRaw / 1000; // 秒
  const blur = num('c-blur');
  const pps = num('c-pps');
  const f = { maxExp: NaN, maxSpeed: NaN, blurPx: NaN, fpsReq: NaN };

  [['c-speed', speed], ['c-exp', expRaw], ['c-blur', blur], ['c-pps', pps]].forEach(([id, v]) => {
    if (!isNaN(v) && v <= 0) add('error', '數值必須大於 0', [id]);
  });

  const px = act.px;
  const hasPx = px > 0;
  if (!hasPx && (speed > 0 || exp > 0)) add('info', '飛拍計算需要空間解析度，請先完成需求、相機與鏡頭');

  if (hasPx && blur > 0 && speed > 0) {
    f.maxExp = (blur * px) / speed;
    setOut('o-max-exp', fmtExposure(f.maxExp), `= 容許拖影 ${blur} px × ${fmtPx(px)} ÷ 速度 ${speed} mm/s = ${fmtExposure(f.maxExp)}`);
    if (f.maxExp < 10e-6) add('warn', `容許曝光不到 10 µs（${fmtExposure(f.maxExp)}），需要高亮度頻閃光源，或降低速度`, ['c-speed']);
  } else setOut('o-max-exp', '');

  const expText = `${expRaw} ${expUnit === 'us' ? 'µs' : 'ms'}`;
  if (hasPx && blur > 0 && exp > 0) {
    f.maxSpeed = (blur * px) / exp;
    setOut('o-max-speed', `${fmt(f.maxSpeed)} mm/s`, `= 容許拖影 ${blur} px × ${fmtPx(px)} ÷ 曝光 ${expText} = ${fmt(f.maxSpeed)} mm/s`);
  } else setOut('o-max-speed', '');

  if (hasPx && speed > 0 && exp > 0) {
    f.blurPx = (speed * exp) / px;
    setOut('o-blur', `${fmt(f.blurPx, 2)} px`, `= 速度 ${speed} mm/s × 曝光 ${expText} ÷ ${fmtPx(px)} = ${fmt(f.blurPx, 2)} px（曝光期間移動 ${fmt(speed * exp * 1000)} µm）`);
    if (blur > 0 && f.blurPx > blur) {
      add('error', `飛拍拖影 ${fmt(f.blurPx, 2)} px 超過容許 ${blur} px：曝光要縮到 ≤ ${fmtExposure(f.maxExp)}，或速度降到 ≤ ${fmt(f.maxSpeed)} mm/s`, ['c-exp', 'c-speed']);
    } else if (blur > 0) {
      add('ok', `飛拍拖影 ${fmt(f.blurPx, 2)} px，在容許 ${blur} px 內`);
    }
  } else setOut('o-blur', '');

  // 連續拍不漏：每秒移動距離 ÷ 移動方向的視野長度
  const alongL = val('c-motion') === 'l';
  const fovMotion = alongL ? act.fovL : act.fovS;
  if (speed > 0 && fovMotion > 0) {
    f.fpsReq = speed / fovMotion;
    setOut('o-fps-req', `${fmt(f.fpsReq, 1)} fps`, `= 速度 ${speed} mm/s ÷ 移動方向視野 ${fmt(fovMotion)} mm = ${fmt(f.fpsReq, 1)} fps${cam && cam.fps ? `（相機最高 ${cam.fps} fps）` : ''}`);
    if (cam && cam.fps > 0 && cam.fps < f.fpsReq) {
      add('error', `相機影格率不足：${speed} mm/s 連續拍需要 ≥ ${fmt(f.fpsReq, 1)} fps，${cam.name} 最高 ${cam.fps} fps`, ['c-speed', 'c-cam-model', 'c-fps']);
    }
  } else setOut('o-fps-req', '');

  if (pps > 0 && cam && cam.fps > 0 && cam.fps < pps) {
    add('error', `每秒要檢 ${pps} 個，但 ${cam.name} 最高只有 ${cam.fps} fps（每個至少拍 1 張）`, ['c-pps', 'c-cam-model', 'c-fps']);
  }
  return f;
}

function renderMessages(msgs) {
  const order = { error: 0, warn: 1, ok: 2, info: 3 };
  const icons = { error: '✖', warn: '⚠', ok: '✔', info: 'ℹ' };
  msgs.sort((a, b) => order[a.level] - order[b.level]);

  const box = document.getElementById('c-msgs');
  box.innerHTML = '';
  if (!msgs.length) {
    box.innerHTML = '<div class="calc-msg calc-msg-info">ℹ 目前沒有需要注意的地方</div>';
  }
  msgs.forEach((m) => {
    const div = document.createElement('div');
    div.className = 'calc-msg calc-msg-' + m.level;
    div.textContent = `${icons[m.level]} ${m.text}`;
    box.appendChild(div);
    if (m.level === 'error' || m.level === 'warn') {
      m.fields.forEach((id) => {
        const el = document.getElementById(id);
        if (el && !el.classList.contains('field-error')) el.classList.add(m.level === 'error' ? 'field-error' : 'field-warn');
      });
    }
  });

  const errors = msgs.filter((m) => m.level === 'error').length;
  document.querySelector('.calc-check').classList.toggle('has-error', errors > 0);
}

// ------------------------------------------------------------
// 型錄：讀 config.js 的 CAMERA_CATALOG_SHEET_ID（公開 Google 試算表），
// 分頁 GigE / USB3（相機）、FA鏡頭 / 遠心鏡頭（鏡頭），跟原本 CCD_camera / CCD_lens 用同一份資料。
// 沒設定或讀不到時改用手動輸入規格。
// ------------------------------------------------------------
/** 後端回傳的分頁（標題列 + 資料列）轉成跟 gviz 一樣的表格格式，這樣下面原本的欄位辨識與解析程式完全不用改。 */
function sheetToGvizTable(t) {
  return { cols: (t.header || []).map((label) => ({ label })), rows: (t.rows || []).map((r) => ({ c: r.map((v) => ({ v })) })) };
}

/**
 * 型錄來源：自己的試算表（GigE / USB3 / FA鏡頭 / 遠心鏡頭 四個分頁，由 setup 從原本的公開型錄完整複製，
 * 德鴻官網規格也寫在「遠心鏡頭」分頁）。自己的分頁還沒有資料時，才退回讀 config.js 的公開型錄。
 */
async function loadCatalogs() {
  const status = document.getElementById('c-catalog-status');
  const cached = getCached(CATALOG_CACHE_KEY);
  if (cached && cached.cameras && cached.cameras.length) {
    cameraCatalog = cached.cameras;
    lensCatalog = cached.lenses;
    missingPixelCameras = cached.missing || 0;
    onCatalogReady();
    return;
  }
  status.textContent = '正在讀取相機 / 鏡頭型錄（我的試算表）...';
  missingPixelCameras = 0;
  try {
    const r = await callApi('getCalcCatalog', {});
    if (r && r.success && r.catalog) {
      const c = r.catalog;
      cameraCatalog = [...parseCameraTable(sheetToGvizTable(c['GigE']), 'GigE'), ...parseCameraTable(sheetToGvizTable(c['USB3']), 'USB 3.0')];
      lensCatalog = { fa: parseLensTable(sheetToGvizTable(c['FA鏡頭']), false), tele: parseLensTable(sheetToGvizTable(c['遠心鏡頭']), true) };
      if (cameraCatalog.length) {
        setCached(CATALOG_CACHE_KEY, { cameras: cameraCatalog, lenses: lensCatalog, missing: missingPixelCameras });
        onCatalogReady();
        return;
      }
    }
  } catch (e) {
    console.error('讀取自己的型錄分頁失敗', e);
  }
  cameraCatalog = [];
  lensCatalog = { fa: [], tele: [] };
  loadCatalogsFromPublic();
}

/** 按「同步型錄」：從公開型錄把自己分頁缺的型號補進來（已有的不動），然後重新讀取。 */
async function syncCatalog() {
  if (!confirm('要把公開型錄裡「我的試算表還沒有」的相機/鏡頭型號補進來嗎？（已有的型號不會被覆蓋）')) return;
  const r = await callApi('syncCalcCatalog', {});
  if (!r.success) return alert(r.message);
  alert(r.message);
  reloadCatalog();
}

function reloadCatalog() {
  clearCached(CATALOG_CACHE_KEY);
  clearCached('visionCatalog_v2');
  cameraCatalog = [];
  lensCatalog = { fa: [], tele: [] };
  missingPixelCameras = 0;
  loadCatalogs();
}

function loadCatalogsFromPublic() {
  const status = document.getElementById('c-catalog-status');
  const sheetId = typeof CAMERA_CATALOG_SHEET_ID !== 'undefined' ? CAMERA_CATALOG_SHEET_ID : '';
  if (!sheetId) {
    status.textContent = '未設定型錄（config.js 的 CAMERA_CATALOG_SHEET_ID），相機請改用手動輸入規格';
    catalogLoaded = true;
    recalc();
    return;
  }

  const cached = getCached(CATALOG_CACHE_KEY);
  if (cached && cached.cameras && cached.cameras.length) {
    cameraCatalog = cached.cameras;
    lensCatalog = cached.lenses;
    onCatalogReady();
    return;
  }

  status.textContent = '正在讀取相機 / 鏡頭型錄...';
  const sheets = [
    { name: 'GigE', parse: (t) => cameraCatalog.push(...parseCameraTable(t, 'GigE')) },
    { name: 'USB3', parse: (t) => cameraCatalog.push(...parseCameraTable(t, 'USB 3.0')) },
    { name: 'FA鏡頭', parse: (t) => lensCatalog.fa.push(...parseLensTable(t, false)) },
    { name: '遠心鏡頭', parse: (t) => lensCatalog.tele.push(...parseLensTable(t, true)) },
  ];
  let pending = sheets.length;
  const done = () => {
    pending--;
    if (pending > 0) return;
    if (cameraCatalog.length) setCached(CATALOG_CACHE_KEY, { cameras: cameraCatalog, lenses: lensCatalog });
    onCatalogReady();
  };

  sheets.forEach((s, i) => {
    const cbName = `calcCatalogCallback${i}`;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      done();
    };
    window[cbName] = (resp) => {
      try {
        s.parse(resp.table);
      } catch (e) {
        console.error('型錄解析失敗', s.name, e);
      }
      finish();
    };
    const script = document.createElement('script');
    script.src = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?sheet=${encodeURIComponent(s.name)}&tqx=responseHandler:${cbName}`;
    script.onerror = finish;
    setTimeout(finish, 15000);
    document.body.appendChild(script);
  });
}

/** 型號下拉：只列出目前「介面類別」的相機；原本選的型號不在新類別裡就回到「自動」。 */
function renderCamModelOptions(preferred) {
  const select = document.getElementById('c-cam-model');
  const keep = preferred || select.value || '';
  const pool = cameraPool();
  select.innerHTML = '<option value="">自動（最小符合需求）</option>';
  pool.forEach((c) => {
    const opt = document.createElement('option');
    opt.value = c.name;
    opt.textContent = `${c.name}｜${c.resW}×${c.resH}｜${c.iface}${c.fps ? `｜${c.fps}fps` : ''}`;
    select.appendChild(opt);
  });
  if (pool.some((c) => c.name === keep)) select.value = keep;
}

function onCatalogReady() {
  catalogLoaded = true;
  const status = document.getElementById('c-catalog-status');
  cameraCatalog.sort((a, b) => a.mp - b.mp);
  // 介面類別選項：直接從型錄(自己的試算表 GigE / USB3 分頁)裡有哪些介面產生
  const ifaceSelect = document.getElementById('c-cam-iface');
  const keepIface = ifaceSelect.value || savedSelects['c-cam-iface'] || '';
  ifaceSelect.innerHTML = '<option value="">全部介面</option>';
  [...new Set(cameraCatalog.map((c) => c.iface).filter(Boolean))].forEach((name) => {
    const count = cameraCatalog.filter((c) => c.iface === name).length;
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = `${name}（${count} 款）`;
    ifaceSelect.appendChild(opt);
  });
  if ([...ifaceSelect.options].some((o) => o.value === keepIface)) ifaceSelect.value = keepIface;
  rebuildBrandOriginOptions();
  renderCamModelOptions(savedSelects['c-cam-model']);
  status.textContent = cameraCatalog.length
    ? `型錄：相機 ${cameraCatalog.length} 款、FA 鏡頭 ${lensCatalog.fa.length} 款、遠心鏡頭 ${lensCatalog.tele.length} 款${missingPixelCameras ? `（另有 ${missingPixelCameras} 款相機缺像元尺寸，沒有納入計算，請到試算表相機分頁補上）` : ''}`
    : '讀不到相機型錄，請改用手動輸入規格';
  document.getElementById('c-lens-model').dataset.type = ''; // 強制重建鏡頭下拉
  recalc();
  savedSelects = {};
}

/** gviz 表格欄位辨識：欄名中英文都認得（跟原本計算器同一套規則）。 */
function detectColumns(table, rules) {
  const idx = {};
  Object.keys(rules).forEach((k) => (idx[k] = -1));
  const detect = (labels) =>
    labels.forEach((label, i) => {
      const l = String(label || '').trim().replace(/\s+/g, ' ');
      Object.keys(rules).forEach((k) => {
        if (idx[k] === -1 && rules[k](l)) idx[k] = i;
      });
    });
  if (table.cols) detect(table.cols.map((c) => (c ? c.label : '')));
  if (table.rows[0] && table.rows[0].c) detect(table.rows[0].c.map((c) => (c && c.v != null ? String(c.v) : '')));
  return idx;
}

function cellValue(row, i) {
  return row && row.c && i !== -1 && row.c[i] && row.c[i].v != null ? row.c[i].v : '';
}

const isNameHeader = (l) => (l.includes('公司型號') || l === 'Name') && !l.includes('原廠型號');

let missingPixelCameras = 0; // 型錄裡缺像元尺寸、因此沒有納入選型的相機數

function parseCameraTable(table, iface) {
  if (!table || !table.rows || !table.rows.length) return [];
  const idx = detectColumns(table, {
    name: isNameHeader,
    brand: (l) => l.includes('原廠名稱') || l.includes('Original Company'),
    resolution: (l) => l.includes('解析度') || l.includes('Resolution'),
    pixelSize: (l) => l.includes('像元尺寸') || l.includes('Pixel Size'),
    fps: (l) => l.includes('偵率') || l.includes('幀率') || l.includes('FPS'),
    sensorSize: (l) => l.includes('感測器尺寸') || l.includes('Sensor Size'),
    maximumGain: (l) => l.includes('最大增益') || l.includes('MaximumGain'),
  });
  const cams = [];
  table.rows.forEach((row) => {
    const name = String(cellValue(row, idx.name)).trim();
    const brand = String(cellValue(row, idx.brand)).trim();
    const res = String(cellValue(row, idx.resolution)).trim();
    if (!name || !res || name === '公司型號' || name === 'Name' || res === '解析度' || res === 'Resolution') return;
    const parts = res.toUpperCase().split(/X|\*|×/);
    const resW = parseInt(parts[0], 10);
    const resH = parseInt(parts[1], 10);
    if (!(resW > 0) || !(resH > 0)) return;

    const rawPix = String(cellValue(row, idx.pixelSize));
    const pm = rawPix.match(/([0-9.]+)\s*[*xX×]\s*([0-9.]+)/);
    const single = rawPix.match(/([0-9.]+)/);
    const pixelW = pm ? parseFloat(pm[1]) : single ? parseFloat(single[1]) : 0;
    const pixelH = pm ? parseFloat(pm[2]) : pixelW;

    // USB3 分頁的靶面尺寸欄位有位移，原本計算器就是從「最大增益」欄位補讀
    let size = String(cellValue(row, idx.sensorSize)).trim();
    if (iface !== 'GigE') {
      const alt = String(cellValue(row, idx.maximumGain)).trim();
      if (alt.includes('"')) size = alt;
    }
    if (!(pixelW > 0)) {
      missingPixelCameras++;
      return;
    }
    cams.push({ name, brand, resW, resH, pixelW, pixelH, size, iface, fps: parseFloat(cellValue(row, idx.fps)) || 0, mp: (resW * resH) / 1e6 });
  });
  return cams;
}

function parseLensTable(table, isTele) {
  if (!table || !table.rows || !table.rows.length) return [];
  const idx = detectColumns(table, {
    name: isNameHeader,
    brand: (l) => l.includes('原廠名稱') || l.includes('Original Company'),
    resolution: (l) => l.includes('解析度') || l.includes('Resolution'),
    sensorSize: (l) => l.includes('感測器尺寸') || l.includes('靶面') || l.includes('SensorSize') || l.includes('Sensor Size'),
    f: (l) => l.includes('焦距') || l.includes('Focus Length'),
    focusWd: (l) => l.includes('最低對焦距離') || l.includes('最近對焦') || l.includes('Focus WD'),
    mag: (l) => l.includes('放大倍率') || l.includes('MAG'),
    wd: (l) => (l.includes('工作距離') || l === 'WD') && !l.includes('對焦'),
    dof: (l) => l.includes('景深') || l.includes('DOF'),
  });
  const lenses = [];
  table.rows.forEach((row) => {
    const name = String(cellValue(row, idx.name)).trim();
    if (!name || name === '公司型號' || name === 'Name') return;
    const base = { name, brand: String(cellValue(row, idx.brand)).trim(), sensorSize: String(cellValue(row, idx.sensorSize)).trim(), resolution: String(cellValue(row, idx.resolution)).trim() };
    if (isTele) {
      const mag = parseFloat(cellValue(row, idx.mag));
      if (mag > 0) lenses.push(Object.assign(base, { mag, wd: String(cellValue(row, idx.wd)).trim(), dof: String(cellValue(row, idx.dof)).trim() }));
    } else {
      const f = parseFloat(cellValue(row, idx.f));
      if (f > 0) lenses.push(Object.assign(base, { f, focusWd: parseFloat(cellValue(row, idx.focusWd)) || 0 }));
    }
  });
  return lenses;
}

// ------------------------------------------------------------
// 案件整合：從案件的 CCD 需求帶入 / 把計算結果存回去
// ------------------------------------------------------------
async function loadCalcCaseList() {
  const fill = (cases) => {
    const select = document.getElementById('c-case');
    const current = select.value;
    select.innerHTML = '<option value="">（不帶入案件）</option>';
    cases.forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c.CaseID;
      opt.textContent = `${c.CaseID}｜${c.CustomerName || ''}`;
      select.appendChild(opt);
    });
    select.value = current;
  };
  const cached = getCached('calcCaseList');
  if (cached) fill(cached);
  const result = await callApi('getCases', {});
  if (!result.success) return;
  const slim = result.cases.map((c) => ({ CaseID: c.CaseID, CustomerName: c.CustomerName }));
  setCached('calcCaseList', slim);
  fill(slim);
}

async function onCalcCaseChange() {
  const caseId = val('c-case');
  const select = document.getElementById('c-ccd');
  calcCaseCcds = [];
  if (!caseId) {
    select.innerHTML = '<option value="">（先選案件）</option>';
    return;
  }
  const result = await callApi('getCase', { caseId });
  if (!result.success) return alert(result.message);
  calcCaseCcds = result.caseData.CcdRequirements || [];
  select.innerHTML = '';
  calcCaseCcds.forEach((ccd, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = `CCD ${i + 1}${ccd.Description ? '：' + String(ccd.Description).split('\n')[0].slice(0, 20) : ''}`;
    select.appendChild(opt);
  });
  const newOpt = document.createElement('option');
  newOpt.value = 'new';
  newOpt.textContent = '＋ 存成新的一組 CCD';
  select.appendChild(newOpt);
}

/** 案件裡的精度文字 "±2" / "+2" / "-2" / "2"（µm）→ { tol, value }；沒有符號視為 ±。 */
function parseAccuracyText(text) {
  const t = String(text == null ? '' : text).trim();
  const tol = /^[+＋]/.test(t) ? 'p' : /^[-−－]/.test(t) ? 'm' : 'pm';
  const value = parseFloat(t.replace(/^[±+＋\-−－]\s*/, ''));
  return { tol, value: isNaN(value) ? '' : value };
}

function loadFromCaseCcd() {
  const idx = val('c-ccd');
  const ccd = calcCaseCcds[idx];
  if (!ccd) return alert('請先選案件跟要帶入的 CCD');
  const set = (id, v) => (document.getElementById(id).value = v == null ? '' : v);
  set('c-fov-l', ccd.FovLengthMm);
  set('c-fov-s', ccd.FovWidthMm);
  set('c-wd', ccd.WdMm);
  const accParsed = parseAccuracyText(ccd.AccuracyUm);
  set('c-acc-tol', accParsed.tol);
  set('c-acc', accParsed.value);
  set('c-acc-unit', 'um');
  set('c-speed', ccd.FlyingSpeedMmS);
  set('c-pps', ccd.InspectionSpeedPs);
  setTargetsAuto();
  recalc();
}

/** 摘要文字：複製給客戶/同事，也會寫進 CCD 的「檢測需求說明」。含完整計算過程。 */
function buildCalcSummary() {
  const c = lastCalc;
  if (!c) return '';
  const { req, cam, lens, act, fly } = c;
  const lines = ['【選型計算】' + new Date().toLocaleString('zh-TW', { hour12: false })];
  if (req.ok) lines.push(`需求：檢測範圍 ${fmt(req.fovL)} × ${fmt(req.fovS)} mm，最小精度 ${req.accLabel}（計算用 ${fmt(req.acc * 1000)} µm），每特徵 ${req.ppf} px${req.wd > 0 ? `，WD ${req.wd} mm` : ''}`);
  if (cam) lines.push(`相機：${cam.name}（${cam.resW} × ${cam.resH}${cam.pixelW ? `，${cam.pixelW} µm` : ''}${cam.fps ? `，${cam.fps} fps` : ''}）`);
  if (lens.used) lines.push(`鏡頭：${lens.type === 'fa' ? `FA ${lens.used.name}（F ${fmt(lens.used.f)} mm，WD ${fmt(lens.used.wd)} mm）` : `遠心 ${lens.used.name}（${fmt(lens.used.mag, 4)}x）`}`);
  if (isFinite(act.px)) lines.push(`結果：實際視野 ${fmt(act.fovL)} × ${fmt(act.fovS)} mm，空間解析度 ${fmtPx(act.px)}（${cam.sideName}），最小特徵佔 ${fmt(act.featPx, 1)} px`);
  if (isFinite(fly.maxExp)) lines.push(`飛拍：容許最長曝光 ${fmtExposure(fly.maxExp)}${isFinite(fly.blurPx) ? `，實際拖影 ${fmt(fly.blurPx, 2)} px` : ''}${isFinite(fly.fpsReq) ? `，所需影格率 ${fmt(fly.fpsReq, 1)} fps` : ''}`);
  const problems = c.msgs.filter((m) => m.level === 'error' || m.level === 'warn');
  if (problems.length) {
    lines.push('注意事項：');
    problems.forEach((m) => lines.push(`- ${m.text}`));
  }
  if (c.formulas.length) {
    lines.push('計算過程：');
    c.formulas.forEach((f) => lines.push(`- ${f}`));
  }
  return lines.join('\n');
}

async function copyCalcSummary() {
  const text = buildCalcSummary();
  try {
    await navigator.clipboard.writeText(text);
    alert('已複製計算摘要（含計算過程）');
  } catch (e) {
    prompt('請手動複製：', text);
  }
}

async function saveToCaseCcd() {
  const caseId = val('c-case');
  const idx = val('c-ccd');
  if (!caseId || idx === '') return alert('請先選要存回的案件跟 CCD');
  const errors = lastCalc ? lastCalc.msgs.filter((m) => m.level === 'error').length : 0;
  if (errors && !confirm(`目前還有 ${errors} 個錯誤沒解決，確定還是要存回案件嗎？`)) return;
  if (!errors && !confirm(`確定要把目前的計算結果存回案件 ${caseId} 嗎？`)) return;

  const list = calcCaseCcds.map((c) => Object.assign({}, c));
  const target = idx === 'new' ? {} : list[idx];
  const acc = lastCalc && lastCalc.req.accInput > 0 ? TOL_SYMBOLS[lastCalc.req.tol] + +(lastCalc.req.accInput * 1000).toFixed(3) : '';
  Object.assign(target, {
    FovLengthMm: val('c-fov-l'),
    FovWidthMm: val('c-fov-s'),
    WdMm: val('c-wd'),
    AccuracyUm: acc,
    FlyingSpeedMmS: val('c-speed'),
    InspectionSpeedPs: val('c-pps'),
  });
  // 說明欄保留原本內容，只替換掉上一次存進去的【選型計算】區塊
  const oldDesc = String(target.Description || '').replace(/\n*【選型計算】[\s\S]*$/, '');
  target.Description = (oldDesc ? oldDesc + '\n\n' : '') + buildCalcSummary();
  if (idx === 'new') list.push(target);

  const result = await callApi('updateCase', { caseId, ccdRequirements: list });
  if (!result.success) return alert(result.message);
  clearCached('casesPageData');
  alert('已存回案件');
  await onCalcCaseChange();
  document.getElementById('c-ccd').value = idx === 'new' ? String(list.length - 1) : idx;
}

// ------------------------------------------------------------
// 輸入值記在瀏覽器裡，重新整理或切到別頁再回來，剛剛聊到一半的數字還在
// ------------------------------------------------------------
function saveCalcState() {
  const state = {};
  CALC_INPUT_IDS.forEach((id) => (state[id] = document.getElementById(id).value));
  ['c-f-user', 'c-mag-user'].forEach((id) => (state[id + '__manual'] = document.getElementById(id).dataset.manual || '0'));
  // 型錄還沒載入時下拉選單是空的，不要把記住的型號蓋掉
  Object.keys(savedSelects).forEach((id) => {
    if (!state[id]) state[id] = savedSelects[id];
  });
  try {
    localStorage.setItem(CALC_STATE_KEY, JSON.stringify(state));
  } catch (e) {}
}

function loadCalcState() {
  try {
    return JSON.parse(localStorage.getItem(CALC_STATE_KEY) || '{}');
  } catch (e) {
    return {};
  }
}

function resetCalc() {
  if (!confirm('確定要清空所有輸入嗎？')) return;
  savedSelects = {};
  CALC_INPUT_IDS.forEach((id) => {
    const el = document.getElementById(id);
    el.value = el.tagName === 'SELECT' ? el.options[0].value : '';
  });
  document.getElementById('c-ppf').value = 5;
  document.getElementById('c-blur').value = 1;
  setTargetsAuto();
  toggleCamSource();
  recalc();
}

/** 焦距 / 倍率欄位改回自動計算（換新需求時用）。 */
function setTargetsAuto() {
  ['c-f-user', 'c-mag-user'].forEach((id) => (document.getElementById(id).dataset.manual = '0'));
}

function toggleCamSource() {
  const manual = val('c-cam-source') === 'manual';
  document.getElementById('c-cam-manual').style.display = manual ? 'grid' : 'none';
  document.getElementById('c-cam-model-wrap').style.display = manual ? 'none' : '';
  document.getElementById('c-cam-iface-wrap').style.display = manual ? 'none' : '';
}

window.addEventListener('DOMContentLoaded', async () => {
  if (!(await ensureAuth())) return;
  renderHeaderUser();
  applyAdminOnlyVisibility();

  const state = loadCalcState();
  ['c-cam-model', 'c-cam-iface', 'c-brand', 'c-origin', 'c-lens-model'].forEach((id) => {
    if (state[id]) savedSelects[id] = state[id];
  });
  CALC_INPUT_IDS.forEach((id) => {
    const el = document.getElementById(id);
    if (state[id] != null && !savedSelects[id]) el.value = state[id];
    if (id === 'c-f-user' || id === 'c-mag-user') {
      // 使用者自己打字 → 手動模式（要在 recalc 之前標記）；清空 → 回到自動
      el.dataset.manual = state[id + '__manual'] === '1' ? '1' : '0';
      el.addEventListener('input', () => (el.dataset.manual = el.value === '' ? '0' : '1'));
    }
    if (id === 'c-cam-iface' || id === 'c-brand' || id === 'c-origin') {
      el.addEventListener('change', () => {
        renderCamModelOptions();
        recalc();
      });
      return;
    }
    el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', recalc);
  });
  document.getElementById('c-cam-source').addEventListener('change', toggleCamSource);
  toggleCamSource();

  recalc();
  loadCatalogs();
  loadProductOrigins();
  loadCalcCaseList();
});
