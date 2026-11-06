// 選型計算（移植自網站「選型計算」frontend/calc.js，公式與判斷完全一致，純函式、不依賴畫面）
//   ① 客戶需求：檢測範圍、最小檢測精度（含公差方向）、單特徵像素 → 需求空間解析度與所需像素
//   ② 相機：手動規格、指定型號、或從型錄挑「最小符合需求」的；算感測器尺寸與成像比例
//   ③ 鏡頭：FA 理論焦距 / 遠心理論倍率，從型錄打分數挑建議鏡頭
//   ④ 實際視野、空間解析度、最小特徵佔幾 px
//   ⑤ 飛拍：最大曝光、最高速度、拖影 px、所需幀率
// AI 不自己心算：一律呼叫這裡，結果附完整算式；輸入有疑義的地方列在「假設」裡讓使用者確認。

export interface Camera { name: string; brand?: string; resW: number; resH: number; pixelW: number; pixelH: number; fps: number; iface?: string; size?: string; mp: number; effPx?: number; pref?: boolean }
export interface FaLens { name: string; brand?: string; f: number; sensorSize?: string; resolution?: string; focusWd?: number; pref?: boolean }
export interface TeleLens { name: string; brand?: string; mag: number; wd?: string; dof?: string; sensorSize?: string; resolution?: string; pref?: boolean }
export interface Catalog { cameras: Camera[]; fa: FaLens[]; tele: TeleLens[] }

export interface CalcInput {
  /** 檢測範圍（mm）。給兩個數字就好，不用分長短（長的算長邊） */
  fovA?: number;
  fovB?: number;
  /** 最小檢測精度 */
  accuracy?: number;
  accuracyUnit?: "um" | "mm";
  /** pm = ±（兩側各容許）、p = 只能多不能少、m = 只能少不能多 */
  tolerance?: "pm" | "p" | "m";
  /** 單個最小特徵要佔幾個像素（預設 5） */
  pxPerFeature?: number;
  wd?: number;
  lensType?: "fa" | "tele";
  /** 空間解析度的基準邊：s 短邊（預設）/ l 長邊 */
  base?: "s" | "l";
  cameraModel?: string;
  manualCamera?: { resW: number; resH: number; pixelUm: number; fps?: number };
  /** 飛拍 / 產能 */
  speed?: number;
  exposure?: number;
  exposureUnit?: "us" | "ms";
  blurPx?: number;
  partsPerSec?: number;
  /** 移動方向沿著視野的哪一邊：l 長邊 / s 短邊（預設 l） */
  motion?: "l" | "s";
}

export interface Msg { level: "error" | "warn" | "info" | "ok"; text: string }

const STANDARD_FOCAL_LENGTHS = [8, 12, 16, 25, 35, 50, 75];
const TOL_SYMBOLS = { pm: "±", p: "+", m: "-" } as const;

export function fmt(n: number | null | undefined, digits?: number): string {
  if (n == null || isNaN(n) || !isFinite(n)) return "-";
  if (digits != null) return n.toFixed(digits);
  const a = Math.abs(n);
  if (a >= 1000) return n.toFixed(0);
  if (a >= 10) return n.toFixed(1);
  if (a >= 1) return n.toFixed(2);
  if (a >= 0.01) return n.toFixed(4);
  return n.toFixed(6);
}
const fmtPx = (mmPerPx: number) => (isFinite(mmPerPx) ? `${fmt(mmPerPx * 1000)} µm/px` : "-");
const fmtExposure = (sec: number) => (!isFinite(sec) ? "-" : sec >= 0.001 ? `${fmt(sec * 1000)} ms` : `${fmt(sec * 1e6)} µs`);
const positive = (v: unknown): v is number => typeof v === "number" && isFinite(v) && v > 0;
const lensMp = (res?: string) => {
  const m = String(res ?? "").match(/([0-9.]+)/);
  return m ? parseFloat(m[1]) : 5;
};
const extensionRing = (f: number, wd: number, focusWd: number) => (!(wd > f) || !(focusWd > f) || wd >= focusWd ? 0 : Math.max(0.1, (f * f) / (wd - f) - (f * f) / (focusWd - f)));

export interface Requirement {
  fovL: number; fovS: number; acc: number; accInput: number; tol: "pm" | "p" | "m"; accLabel: string; ppf: number; wd: number;
  ok: boolean; pxReq: number; reqW: number; reqH: number;
}
export interface UsedCamera extends Camera {
  sensorW: number; sensorH: number; side: "s" | "l"; sideName: string; otherName: string; sensorSide: number; fovSide: number; resSide: number; k: number; pxIdeal: number; resOk: boolean;
  source: "手動輸入" | "指定型號" | "型錄自動挑選";
}
export interface LensRec { name: string; brand?: string; score: number; detail: string; f?: number; mag?: number; wd?: number; wdText?: string; focusWd?: number; ring?: number; errors: string[]; warnings: string[]; virtual?: boolean; resolution?: string; pref?: boolean }

export interface CalcResult {
  ok: boolean;
  /** 缺少的必要資料（有的話沒有計算，要先問使用者） */
  missing: string[];
  /** 我整理的需求（給使用者確認；含自動採用的預設值） */
  restated: string[];
  /** 這次自己補上的假設 / 預設值，請使用者確認 */
  assumptions: string[];
  req: Requirement | null;
  camera: UsedCamera | null;
  cameraRecs: Camera[];
  lens: { type: "fa" | "tele"; target: number; used: LensRec | null; recs: LensRec[] } | null;
  actual: { fovL: number; fovS: number; px: number; featPx: number } | null;
  fly: { maxExp: number; maxSpeed: number; blurPx: number; fpsReq: number } | null;
  /** 算式（一行一條） */
  steps: string[];
  msgs: Msg[];
}

export function calcSelection(input: CalcInput, catalog: Catalog): CalcResult {
  const msgs: Msg[] = [];
  const steps: string[] = [];
  const assumptions: string[] = [];
  const add = (level: Msg["level"], text: string) => msgs.push({ level, text });
  const out: CalcResult = { ok: false, missing: [], restated: [], assumptions, req: null, camera: null, cameraRecs: [], lens: null, actual: null, fly: null, steps, msgs };

  // ---------- 整理輸入 ----------
  let fovL = input.fovA ?? NaN;
  let fovS = input.fovB ?? NaN;
  if (!positive(fovL)) out.missing.push("檢測範圍的兩個邊長（mm），例如 100 × 80");
  if (!positive(fovS)) {
    if (positive(fovL) && !out.missing.length) out.missing.push("檢測範圍的另一邊長（mm）");
    else if (!out.missing.length) out.missing.push("檢測範圍的兩個邊長（mm），例如 100 × 80");
  }
  const accRaw = input.accuracy ?? NaN;
  if (!positive(accRaw)) out.missing.push("最小檢測精度（要說明單位是 µm 還是 mm，以及 ± / 只能多 / 只能少）");
  const accUnit = input.accuracyUnit ?? "um";
  if (!input.accuracyUnit && positive(accRaw)) assumptions.push("精度單位沒說，先當作 µm（微米）");
  const tol = input.tolerance ?? "pm";
  if (!input.tolerance && positive(accRaw)) assumptions.push("公差方向沒說，先當作 ±（兩側各容許）");
  const ppf = positive(input.pxPerFeature) ? input.pxPerFeature : 5;
  if (!positive(input.pxPerFeature)) assumptions.push("單個最小特徵要佔幾個像素沒說，先用建議值 5 px");
  const wd = positive(input.wd) ? input.wd : 0;
  const base: "s" | "l" = input.base === "l" ? "l" : "s";
  if (!input.base) assumptions.push("空間解析度以「短邊」為基準（預設）");
  let lensType = input.lensType;
  if (!lensType) {
    lensType = wd > 0 ? "fa" : "tele";
    assumptions.push(wd > 0 ? "鏡頭類型沒說、有給工作距離，先以 FA 定焦鏡頭計算" : "鏡頭類型沒說、也沒給工作距離，先算遠心鏡頭需要的倍率（FA 鏡頭需要工作距離）");
  }
  const speed = input.speed ?? NaN;
  const expUnit = input.exposureUnit ?? "ms";
  const exp = positive(input.exposure) ? (expUnit === "us" ? input.exposure / 1e6 : input.exposure / 1000) : NaN;
  const blur = input.blurPx ?? NaN;
  const pps = input.partsPerSec ?? NaN;
  if (out.missing.length) {
    out.restated = restate();
    return out;
  }

  const accInput = accUnit === "um" ? accRaw / 1000 : accRaw; // 一律 mm
  // 公差方向：± 兩側各容許 X → 以 X 計算；只能多 / 只能少 公差帶只有一側、寬 X，量測誤差要落在帶寬中間 → 以 X ÷ 2 計算
  const acc = tol === "pm" ? accInput : accInput / 2;
  if (fovS > fovL) {
    add("info", `寬 H (${fovS}) 比長 W (${fovL}) 大，已自動把長短邊對調計算`);
    [fovL, fovS] = [fovS, fovL];
  }
  if (ppf < 3) add("error", `單個特徵只給 ${ppf} px 太少，影像處理幾乎判斷不出來（建議 ≥ 5 px）`);
  else if (ppf < 5) add("warn", `單個特徵 ${ppf} px 偏低，建議至少 5 px 檢測才穩定`);

  const accLabel = `${TOL_SYMBOLS[tol]}${accRaw} ${accUnit === "um" ? "µm" : "mm"}`;
  const req: Requirement = { fovL, fovS, acc, accInput, tol, accLabel, ppf, wd, ok: true, pxReq: NaN, reqW: NaN, reqH: NaN };
  out.req = req;

  const otherUnit = accUnit === "um" ? "mm" : "µm";
  if (accInput >= fovS) add("error", `最小檢測精度 ${fmt(accInput)} mm 比檢測範圍還大，單位可能打錯（應該是 ${otherUnit}？）`);
  else if (accInput > fovS / 20) add("warn", `最小檢測精度 ${fmt(accInput)} mm 佔了檢測範圍的 1/${Math.round(fovS / accInput)}，不太像 AOI 精度，請確認單位是否該是 ${otherUnit}`);

  const um = (mm: number) => `${fmt(mm * 1000)} µm`;
  if (tol === "pm") steps.push(`計算用精度 = ${accLabel}：兩側各容許 ${um(accInput)}，直接以 ${um(acc)} 計算`);
  else {
    const dir = tol === "p" ? "只能多不能少" : "只能少不能多";
    const band = tol === "p" ? `0 ~ +${um(accInput)}` : `−${um(accInput)} ~ 0`;
    steps.push(`計算用精度 = ${accLabel}（${dir}）：公差帶 ${band}，寬 ${um(accInput)}；量測誤差要落在公差帶中間 → ${um(accInput)} ÷ 2 = ${um(acc)}`);
  }
  req.pxReq = acc / ppf;
  req.reqW = Math.ceil(fovL / req.pxReq);
  req.reqH = Math.ceil(fovS / req.pxReq);
  steps.push(`需求空間解析度 ≤ ${fmtPx(req.pxReq)} = 計算用精度 ${fmt(acc * 1000)} µm ÷ 每特徵 ${ppf} px`);
  steps.push(`所需像素：長 = ${fmt(fovL)} mm ÷ ${fmt(req.pxReq * 1000)} µm/px = ${req.reqW} px；寬 = ${fmt(fovS)} mm ÷ ${fmt(req.pxReq * 1000)} µm/px = ${req.reqH} px（無條件進位）→ ${req.reqW} × ${req.reqH}（${fmt((req.reqW * req.reqH) / 1e6, 1)} MP）`);
  if (req.pxReq < 0.001) add("warn", `要求空間解析度 ${fmtPx(req.pxReq)} 小於 1 µm，已接近光學極限，建議確認需求或改用顯微/高倍率方案`);

  // ---------- ② 相機 ----------
  const pool = [...catalog.cameras];
  const recs = pool
    .filter((c) => c.resW >= req.reqW && c.resH >= req.reqH)
    .sort((a, b) => Number(!!b.pref) - Number(!!a.pref) || a.mp - b.mp || (String(a.iface).toLowerCase().includes("gige") ? 0 : 1) - (String(b.iface).toLowerCase().includes("gige") ? 0 : 1));
  out.cameraRecs = recs.slice(0, 3);
  let cam: UsedCamera | null = null;
  const toUsed = (c: Camera, source: UsedCamera["source"]): UsedCamera => ({ ...c, sensorW: NaN, sensorH: NaN, side: base, sideName: "", otherName: "", sensorSide: NaN, fovSide: NaN, resSide: NaN, k: NaN, pxIdeal: NaN, resOk: false, source });
  if (input.manualCamera && positive(input.manualCamera.resW) && positive(input.manualCamera.resH)) {
    let { resW, resH } = input.manualCamera;
    if (resH > resW) [resW, resH] = [resH, resW];
    const pix = input.manualCamera.pixelUm;
    if (pix > 50) add("warn", `像素尺寸 ${pix} µm 異常大，請確認單位是 µm（一般工業相機約 1.5 ~ 10 µm）`);
    cam = toUsed({ name: "手動輸入", resW, resH, pixelW: pix, pixelH: pix, fps: input.manualCamera.fps ?? 0, mp: (resW * resH) / 1e6 }, "手動輸入");
  } else if (input.cameraModel) {
    const key = input.cameraModel.trim().toLowerCase();
    const found = pool.find((c) => c.name.toLowerCase() === key) ?? pool.find((c) => c.name.toLowerCase().includes(key));
    if (!found) {
      add("error", `型錄裡找不到相機「${input.cameraModel}」，改用自動挑選`);
    } else {
      if (found.resW < req.reqW || found.resH < req.reqH) {
        const auto = recs[0];
        if (auto) add("warn", `型錄中最小符合需求的是 ${auto.name}（${auto.resW} × ${auto.resH}）`);
      }
      cam = toUsed(found, "指定型號");
    }
  }
  if (!cam) {
    if (!pool.length) {
      out.restated = restate();
      add("info", "沒有相機型錄資料：請提供相機的解析度與像素尺寸（µm），才能算鏡頭與實際視野");
      out.steps = steps;
      return finishNoCamera();
    }
    const auto = recs[0];
    if (!auto) {
      const biggest = pool.reduce((a, b) => (b.mp > a.mp ? b : a));
      add("error", `型錄裡沒有任何一台相機達到 ${req.reqW} × ${req.reqH}，以下以最大的 ${biggest.name} 計算，建議拆成多個視野或改用線掃相機`);
      cam = toUsed(biggest, "型錄自動挑選");
    } else {
      assumptions.push(`相機沒指定，從型錄挑最小符合需求的：${auto.name}`);
      cam = toUsed(auto, "型錄自動挑選");
    }
  }
  out.camera = cam;
  steps.push(`相機：${cam.name}｜${cam.resW} × ${cam.resH}${cam.fps ? `｜${cam.fps} fps` : ""}（${fmt(cam.mp, 1)} MP${cam.iface ? `，${cam.iface}` : ""}${cam.size ? `，靶面 ${cam.size}` : ""}）`);
  if (!(cam.pixelW > 0 && cam.pixelH > 0)) {
    add("error", "相機缺少像素尺寸，算不出感測器尺寸、鏡頭與空間解析度");
    out.restated = restate();
    return out;
  }
  cam.sensorW = (cam.resW * cam.pixelW) / 1000;
  cam.sensorH = (cam.resH * cam.pixelH) / 1000;
  steps.push(`感測器：長 = ${cam.resW} px × ${cam.pixelW} µm = ${fmt(cam.sensorW)} mm；寬 = ${cam.resH} px × ${cam.pixelH} µm = ${fmt(cam.sensorH)} mm`);
  cam.side = base;
  cam.sideName = base === "s" ? "短邊" : "長邊";
  cam.otherName = base === "s" ? "長邊" : "短邊";
  cam.sensorSide = base === "s" ? cam.sensorH : cam.sensorW;
  cam.fovSide = base === "s" ? req.fovS : req.fovL;
  cam.resSide = base === "s" ? cam.resH : cam.resW;
  cam.k = cam.sensorSide / cam.fovSide; // 成像比例 = 感測器 ÷ 視野（遠心鏡頭就是倍率）
  cam.pxIdeal = cam.fovSide / cam.resSide;
  cam.resOk = req.acc / cam.pxIdeal >= req.ppf;
  if (!cam.resOk) {
    const tiles = Math.ceil(req.reqW / cam.resW) * Math.ceil(req.reqH / cam.resH);
    add("error", `相機像素不足：就算鏡頭剛好拍滿${cam.sideName}，最小特徵也只佔 ${fmt(req.acc / cam.pxIdeal, 1)} px（需 ≥ ${req.ppf} px）。需要 ≥ ${req.reqW} × ${req.reqH}，或把檢測範圍拆成 ${tiles} 個視野拍`);
  }

  // ---------- ③ 鏡頭 ----------
  const isFa = lensType === "fa";
  const s = cam.sideName;
  let target = NaN;
  if (isFa) {
    if (wd > 0) {
      target = cam.k * wd;
      steps.push(`FA 理論焦距 = 感測器${s} ${fmt(cam.sensorSide)} mm × WD ${fmt(wd)} mm ÷ 視野${s} ${fmt(cam.fovSide)} mm = ${fmt(target)} mm`);
    }
  } else {
    target = cam.k;
    steps.push(`遠心 理論倍率 = 感測器${s} ${fmt(cam.sensorSide)} mm ÷ 視野${s} ${fmt(cam.fovSide)} mm = ${fmt(target, 4)} x`);
  }
  const wdFor = (f: number) => (wd > 0 ? wd : f / cam.k);
  if (isFa) {
    if (wd > 0 && target >= wd) add("error", `焦距 ${fmt(target)} mm ≥ WD ${wd} mm，FA 鏡頭做不到，請改用遠心/顯微鏡頭或加大視野`);
    else if (target > 80) add("warn", `焦距 ${fmt(target)} mm 超過一般 FA 鏡頭範圍（≤ 75 mm），建議縮短 WD、加大視野，或改用遠心鏡頭`);
    if (cam.k > 0.3) add("warn", `視野${s}只有感測器的 ${fmt(1 / cam.k, 1)} 倍（成像比例 ${fmt(cam.k, 3)}），FA 鏡頭需加很長的延伸環才對得到焦，建議改用遠心或微距鏡頭`);
  }

  let used: LensRec | null = null;
  let lensRecs: LensRec[] = [];
  if (!(target > 0)) {
    add("info", "FA 鏡頭需要工作距離 WD（或直接指定焦距）才能計算");
  } else {
    lensRecs = isFa ? scoreFa(catalog.fa, req, cam, target, wdFor) : scoreTele(catalog.tele, req, cam, target);
    used = lensRecs.find((l) => !l.errors.length) ?? lensRecs[0] ?? null;
    if (!used) {
      if (isFa) {
        if (!catalog.fa.length && wd > 0) {
          const fits = STANDARD_FOCAL_LENGTHS.filter((F) => F <= target);
          if (fits.length) {
            const F = fits[fits.length - 1];
            used = { name: `標準 ${F} mm`, f: F, focusWd: 0, virtual: true, score: 0, errors: [], warnings: [], detail: `沒有鏡頭型錄，以不超過計算焦距 ${fmt(target)} mm 的標準焦距推算（不計算延伸環）` };
          }
        }
        used ??= { name: "理論焦距", f: target, focusWd: 0, virtual: true, score: 0, errors: [], warnings: [], detail: "尚未選定鏡頭型號，以理論焦距計算（不計算延伸環）" };
      } else {
        used = { name: "理論倍率", mag: target, virtual: true, score: 0, errors: [], warnings: [], detail: "尚未選定鏡頭型號，以理論倍率計算" };
      }
      const pool2 = isFa ? catalog.fa : catalog.tele;
      if (pool2.length) {
        const tv = isFa ? `焦距 ${fmt(target)} mm` : `倍率 ${fmt(target, 4)}x`;
        add("warn", `找不到合適的${isFa ? "FA" : "遠心"}鏡頭（${tv}，型錄裡沒有 ±50% 內且分數夠高的型號），目前以計算值推算`);
      }
    }
    if (isFa && used.f != null) {
      used.wd = wdFor(used.f);
      steps.push(`實際採用 ${used.name}（F ${fmt(used.f)} mm）：WD ${fmt(used.wd)} mm${wd > 0 ? "（客戶指定）" : `= 焦距 ${fmt(used.f)} × 視野${s} ${fmt(cam.fovSide)} ÷ 感測器${s} ${fmt(cam.sensorSide)}（剛好拍滿所需）`}`);
      const angH = 2 * Math.atan(cam.sensorW / (2 * used.f)) * (180 / Math.PI);
      const angV = 2 * Math.atan(cam.sensorH / (2 * used.f)) * (180 / Math.PI);
      steps.push(`視角：水平 = 2 × atan(${fmt(cam.sensorW)} ÷ (2 × ${fmt(used.f)})) = ${fmt(angH, 1)}°；垂直 = 2 × atan(${fmt(cam.sensorH)} ÷ (2 × ${fmt(used.f)})) = ${fmt(angV, 1)}°`);
      if (used.wd <= used.f) add("error", `WD ${fmt(used.wd)} mm 小於等於焦距 ${fmt(used.f)} mm，無法成像`);
      else {
        used.ring = extensionRing(used.f, used.wd, used.focusWd ?? 0);
        if (used.ring > 0) add("warn", `${used.name} 最近對焦距離 ${fmt(used.focusWd)} mm，WD ${fmt(used.wd)} mm 需加裝延伸環約 ${fmt(used.ring, 1)} mm（= F²/(WD−F) − F²/(最近對焦−F)）`);
      }
    } else if (used.mag != null) {
      steps.push(`實際採用 ${used.name}（${fmt(used.mag, 4)}x）${used.wdText ? `，工作距離 ${used.wdText} mm（遠心鏡頭 WD 為鏡頭固定規格）` : ""}`);
      const lensWd = parseFloat(used.wdText ?? "");
      if (wd > 0 && lensWd > 0 && Math.abs(lensWd - wd) / wd > 0.1) add("warn", `${used.name} 工作距離固定 ${lensWd} mm，跟客戶提的 WD ${wd} mm 不同，機構需配合調整`);
    }
    if (used.resolution && cam.mp > lensMp(used.resolution)) add("warn", `${used.name} 解析力 ${used.resolution}，低於相機 ${fmt(cam.mp, 1)} MP，影像邊緣可能不夠銳利`);
  }
  out.lens = { type: lensType, target, used, recs: lensRecs };

  // ---------- ④ 實際視野與空間解析度 ----------
  const a = { fovL: NaN, fovS: NaN, px: NaN, featPx: NaN };
  if (cam.k > 0) {
    if (used && isFa && used.f != null && used.wd != null) {
      a.fovL = (cam.sensorW * used.wd) / used.f;
      a.fovS = (cam.sensorH * used.wd) / used.f;
      steps.push(`實際視野：長 = 感測器 ${fmt(cam.sensorW)} × WD ${fmt(used.wd)} ÷ F ${fmt(used.f)} = ${fmt(a.fovL)} mm；寬 = 感測器 ${fmt(cam.sensorH)} × WD ${fmt(used.wd)} ÷ F ${fmt(used.f)} = ${fmt(a.fovS)} mm`);
    } else if (used && !isFa && used.mag != null) {
      a.fovL = cam.sensorW / used.mag;
      a.fovS = cam.sensorH / used.mag;
      steps.push(`實際視野：長 = 感測器 ${fmt(cam.sensorW)} ÷ 倍率 ${fmt(used.mag, 4)} = ${fmt(a.fovL)} mm；寬 = 感測器 ${fmt(cam.sensorH)} ÷ 倍率 ${fmt(used.mag, 4)} = ${fmt(a.fovS)} mm`);
    } else {
      a.fovL = cam.sensorW / cam.k;
      a.fovS = cam.sensorH / cam.k;
      steps.push(`理想視野（鏡頭剛好拍滿${s}）= 感測器 ${fmt(cam.sensorW)} × ${fmt(cam.sensorH)} mm ÷ ${fmt(cam.k, 4)} = ${fmt(a.fovL)} × ${fmt(a.fovS)} mm`);
    }
    const pxL = a.fovL / cam.resW;
    const pxS = a.fovS / cam.resH;
    a.px = cam.side === "s" ? pxS : pxL;
    a.featPx = req.acc / a.px;
    steps.push(`空間解析度（${s}）= ${cam.side === "s" ? `短邊視野 ${fmt(a.fovS)} mm ÷ 短邊 ${cam.resH} px` : `長邊視野 ${fmt(a.fovL)} mm ÷ 長邊 ${cam.resW} px`} = ${fmtPx(a.px)}（參考：${cam.side === "s" ? `長邊 ${fmtPx(pxL)}` : `短邊 ${fmtPx(pxS)}`}）`);
    steps.push(`最小特徵佔 = 計算用精度 ${fmt(req.acc * 1000)} µm ÷ ${fmtPx(a.px)} = ${fmt(a.featPx, 1)} px（需 ≥ ${req.ppf} px）`);
    if (a.fovL < req.fovL - 1e-6 || a.fovS < req.fovS - 1e-6) {
      const otherShort = cam.side === "s" ? cam.sensorW / cam.k < req.fovL - 1e-6 : cam.sensorH / cam.k < req.fovS - 1e-6;
      const fix = otherShort
        ? `。以${cam.sideName}為基準時${cam.otherName}本來就拍不滿，請把「空間解析度基準邊」改成${cam.otherName}`
        : isFa && used?.f != null ? `，WD 需拉到 ≥ ${fmt(used.f / cam.k)} mm 或改用較短焦距` : "，請改用倍率較小的鏡頭";
      add("error", `實際視野 ${fmt(a.fovL)} × ${fmt(a.fovS)} mm 拍不滿檢測範圍 ${fmt(req.fovL)} × ${fmt(req.fovS)} mm${fix}`);
    }
    if (a.featPx < req.ppf) {
      if (cam.resOk) {
        const fix = isFa ? "請換較接近計算焦距的鏡頭，或把 WD 調到剛好拍滿的距離" : "請換倍率較接近計算倍率的遠心鏡頭，或換更高像素的相機";
        add("error", `鏡頭讓視野變大（${fmt(a.fovL)} × ${fmt(a.fovS)} mm），空間解析度 ${fmtPx(a.px)}，最小特徵只剩 ${fmt(a.featPx, 1)} px（需 ≥ ${req.ppf} px）。${fix}`);
      }
    } else add("ok", `空間解析度 ${fmtPx(a.px)}（${cam.sideName}），最小特徵佔 ${fmt(a.featPx, 1)} px（需 ≥ ${req.ppf} px）`);
  }
  out.actual = a;

  // ---------- ⑤ 飛拍 / 產能 ----------
  const f = { maxExp: NaN, maxSpeed: NaN, blurPx: NaN, fpsReq: NaN };
  const px = a.px;
  const wantFly = positive(speed) || positive(exp) || positive(pps);
  if (wantFly) {
    if (!(px > 0) && (positive(speed) || positive(exp))) add("info", "飛拍計算需要空間解析度，請先完成需求、相機與鏡頭");
    if (px > 0 && positive(blur) && positive(speed)) {
      f.maxExp = (blur * px) / speed;
      steps.push(`最大曝光 = 容許拖影 ${blur} px × ${fmtPx(px)} ÷ 速度 ${speed} mm/s = ${fmtExposure(f.maxExp)}`);
      if (f.maxExp < 10e-6) add("warn", `容許曝光不到 10 µs（${fmtExposure(f.maxExp)}），需要高亮度頻閃光源，或降低速度`);
    }
    const expText = `${input.exposure} ${expUnit === "us" ? "µs" : "ms"}`;
    if (px > 0 && positive(blur) && positive(exp)) {
      f.maxSpeed = (blur * px) / exp;
      steps.push(`最高速度 = 容許拖影 ${blur} px × ${fmtPx(px)} ÷ 曝光 ${expText} = ${fmt(f.maxSpeed)} mm/s`);
    }
    if (px > 0 && positive(speed) && positive(exp)) {
      f.blurPx = (speed * exp) / px;
      steps.push(`拖影 = 速度 ${speed} mm/s × 曝光 ${expText} ÷ ${fmtPx(px)} = ${fmt(f.blurPx, 2)} px（曝光期間移動 ${fmt(speed * exp * 1000)} µm）`);
      if (positive(blur) && f.blurPx > blur) add("error", `飛拍拖影 ${fmt(f.blurPx, 2)} px 超過容許 ${blur} px：曝光要縮到 ≤ ${fmtExposure(f.maxExp)}，或速度降到 ≤ ${fmt(f.maxSpeed)} mm/s`);
      else if (positive(blur)) add("ok", `飛拍拖影 ${fmt(f.blurPx, 2)} px，在容許 ${blur} px 內`);
    }
    const fovMotion = (input.motion ?? "l") === "l" ? a.fovL : a.fovS;
    if (positive(speed) && fovMotion > 0) {
      f.fpsReq = speed / fovMotion;
      steps.push(`所需幀率 = 速度 ${speed} mm/s ÷ 移動方向視野 ${fmt(fovMotion)} mm = ${fmt(f.fpsReq, 1)} fps${cam.fps ? `（相機最高 ${cam.fps} fps）` : ""}`);
      if (cam.fps > 0 && cam.fps < f.fpsReq) add("error", `相機影格率不足：${speed} mm/s 連續拍需要 ≥ ${fmt(f.fpsReq, 1)} fps，${cam.name} 最高 ${cam.fps} fps`);
    }
    if (positive(pps) && cam.fps > 0 && cam.fps < pps) add("error", `每秒要檢 ${pps} 個，但 ${cam.name} 最高只有 ${cam.fps} fps（每個至少拍 1 張）`);
  }
  out.fly = f;
  out.ok = true;
  out.restated = restate();
  return out;

  function finishNoCamera(): CalcResult {
    out.ok = true;
    return out;
  }

  function restate(): string[] {
    const lines: string[] = [];
    if (positive(input.fovA) || positive(input.fovB)) lines.push(`檢測範圍：${positive(input.fovA) ? fmt(input.fovA) : "？"} × ${positive(input.fovB) ? fmt(input.fovB) : "？"} mm`);
    if (positive(accRaw)) lines.push(`最小檢測精度：${TOL_SYMBOLS[tol]}${accRaw} ${accUnit === "um" ? "µm" : "mm"}（${tol === "pm" ? "兩側各容許" : tol === "p" ? "只能多不能少" : "只能少不能多"}）`);
    lines.push(`單個最小特徵佔：${ppf} px`);
    if (wd > 0) lines.push(`工作距離 WD：${fmt(wd)} mm`);
    lines.push(`鏡頭類型：${lensType === "fa" ? "FA 定焦鏡頭" : "遠心鏡頭"}`);
    lines.push(`空間解析度基準邊：${base === "s" ? "短邊" : "長邊"}`);
    if (input.manualCamera && positive(input.manualCamera.resW)) lines.push(`相機：手動 ${input.manualCamera.resW} × ${input.manualCamera.resH}、像素 ${input.manualCamera.pixelUm} µm`);
    else if (input.cameraModel) lines.push(`相機：${input.cameraModel}`);
    else lines.push("相機：從型錄挑最小符合需求的");
    if (positive(speed)) lines.push(`移動速度：${speed} mm/s`);
    if (positive(input.exposure)) lines.push(`曝光時間：${input.exposure} ${expUnit === "us" ? "µs" : "ms"}`);
    if (positive(blur)) lines.push(`容許拖影：${blur} px`);
    if (positive(pps)) lines.push(`每秒檢測：${pps} 個`);
    return lines;
  }
}

/** 鏡頭排序：能拍滿視野的先，其中優先推薦的供應商（Cetus）排前面，再依分數 */
function byPreferred(a: LensRec, b: LensRec): number {
  return Number(a.errors.length > 0) - Number(b.errors.length > 0) || Number(!!b.pref) - Number(!!a.pref) || b.score - a.score;
}

function scoreFa(pool: FaLens[], req: Requirement, cam: UsedCamera, targetF: number, wdFor: (f: number) => number): LensRec[] {
  if (req.wd > 0 && targetF >= req.wd) return [];
  return pool
    .filter((l) => Math.abs(l.f - targetF) / targetF <= 0.5)
    .map((l) => {
      const errors: string[] = [];
      const warnings: string[] = [];
      let score = 100;
      const wd = wdFor(l.f);
      const gap = Math.abs(l.f - targetF) / targetF;
      if (gap > 0.0001) score -= gap * 50;
      if (cam.mp > lensMp(l.resolution)) {
        score -= 15;
        warnings.push("解析力偏低");
      }
      const focusWd = l.focusWd || l.f * 10;
      const ring = extensionRing(l.f, wd, focusWd);
      if (ring > 0) {
        score -= ring * 2.5;
        warnings.push(`延伸環 ${fmt(ring, 1)} mm`);
      }
      const fovL = (cam.sensorW * wd) / l.f;
      const fovS = (cam.sensorH * wd) / l.f;
      if (fovL < req.fovL - 1e-6 || fovS < req.fovS - 1e-6) {
        score -= 30;
        errors.push("視野拍不滿");
      }
      return { name: l.name, brand: l.brand, pref: l.pref, f: l.f, focusWd, ring, resolution: l.resolution, score: Math.max(0, score), errors, warnings, detail: `焦距 ${l.f} mm / 靶面 ${l.sensorSize || "-"} / 解析力 ${l.resolution || "-"} / WD ${fmt(wd)}${req.wd > 0 ? "" : "（反推）"} 時視野 ${fmt(fovL)}×${fmt(fovS)} mm` } as LensRec;
    })
    .filter((l) => l.score >= 25)
    .sort(byPreferred)
    .slice(0, 3);
}

function scoreTele(pool: TeleLens[], req: Requirement, cam: UsedCamera, targetMag: number): LensRec[] {
  return pool
    .filter((l) => Math.abs(l.mag - targetMag) / targetMag <= 0.5)
    .map((l) => {
      const errors: string[] = [];
      const warnings: string[] = [];
      let score = 100;
      const gap = Math.abs(l.mag - targetMag) / targetMag;
      if (gap > 0.0001) {
        score -= gap * 80;
        warnings.push("倍率不完全相符");
      }
      const fovL = cam.sensorW / l.mag;
      const fovS = cam.sensorH / l.mag;
      if (fovL < req.fovL - 1e-6 || fovS < req.fovS - 1e-6) {
        score -= 30;
        errors.push("視野拍不滿");
      }
      return { name: l.name, brand: l.brand, pref: l.pref, mag: l.mag, wdText: l.wd, resolution: l.resolution, score: Math.max(0, score), errors, warnings, detail: `倍率 ${l.mag}x / WD ${l.wd || "-"} mm / 景深 ${l.dof || "-"} mm / 視野 ${fmt(fovL)}×${fmt(fovS)} mm` } as LensRec;
    })
    .filter((l) => l.score >= 15)
    .sort(byPreferred)
    .slice(0, 3);
}

const PREF_TAG = " ⭐Cetus 優先推薦";

/** 給 AI / 使用者看的完整結果：先重述需求，再列結果與算式，最後是建議型號與提醒（不含任何價格）。 */
export function formatCalc(r: CalcResult): string {
  const lines: string[] = [];
  lines.push("【我整理的需求】", ...r.restated.map((x) => `・${x}`));
  if (r.assumptions.length) lines.push("", "【我自己補上的假設（請確認）】", ...r.assumptions.map((x) => `・${x}`));
  if (r.missing.length) {
    lines.push("", "【還缺的資料（沒有這些就不能算）】", ...r.missing.map((x) => `・${x}`));
    return lines.join("\n");
  }
  if (r.req) {
    lines.push("", "【計算結果】");
    lines.push(`・需求空間解析度 ≤ ${fmtPx(r.req.pxReq)}，需要 ≥ ${r.req.reqW} × ${r.req.reqH} px（${fmt((r.req.reqW * r.req.reqH) / 1e6, 1)} MP）`);
    if (r.camera) lines.push(`・相機：${r.camera.name}（${r.camera.resW} × ${r.camera.resH}，像素 ${r.camera.pixelW} µm，感測器 ${fmt(r.camera.sensorW)} × ${fmt(r.camera.sensorH)} mm${r.camera.source === "型錄自動挑選" ? "，型錄自動挑選" : ""}）`);
    if (r.lens && r.lens.target > 0) lines.push(`・${r.lens.type === "fa" ? `FA 理論焦距 ${fmt(r.lens.target)} mm` : `遠心理論倍率 ${fmt(r.lens.target, 4)} x`}`);
    if (r.lens?.used) lines.push(`・採用鏡頭：${r.lens.used.name}（${r.lens.used.detail}）`);
    if (r.actual && isFinite(r.actual.px)) lines.push(`・實際視野 ${fmt(r.actual.fovL)} × ${fmt(r.actual.fovS)} mm，空間解析度 ${fmtPx(r.actual.px)}，最小特徵佔 ${fmt(r.actual.featPx, 1)} px`);
    if (r.fly) {
      if (isFinite(r.fly.maxExp)) lines.push(`・最大曝光 ${fmtExposure(r.fly.maxExp)}`);
      if (isFinite(r.fly.maxSpeed)) lines.push(`・最高速度 ${fmt(r.fly.maxSpeed)} mm/s`);
      if (isFinite(r.fly.blurPx)) lines.push(`・拖影 ${fmt(r.fly.blurPx, 2)} px`);
      if (isFinite(r.fly.fpsReq)) lines.push(`・所需幀率 ${fmt(r.fly.fpsReq, 1)} fps`);
    }
  }
  if (r.cameraRecs.length) lines.push("", "【符合需求的相機（Cetus 優先，其餘由小到大）】", ...r.cameraRecs.map((c) => `・${c.name}${c.pref ? PREF_TAG : ""}｜${c.resW} × ${c.resH}（${fmt(c.mp, 1)} MP）｜像素 ${c.pixelW} µm｜${c.iface || "-"}${c.fps ? `｜${c.fps} fps` : ""}`));
  if (r.lens?.recs.length) lines.push("", "【建議鏡頭】", ...r.lens.recs.map((l, i) => `${i + 1}. ${l.name}${l.pref ? PREF_TAG : ""}（${Math.round(l.score)} 分）${l.errors.length ? "⚠" + l.errors.join("、") : ""}${l.warnings.length ? "；" + l.warnings.join("、") : ""}\n   ${l.detail}`));
  if (r.steps.length) lines.push("", "【算式】", ...r.steps.map((x) => `・${x}`));
  const order = { error: 0, warn: 1, ok: 2, info: 3 } as const;
  const notes = [...r.msgs].sort((a, b) => order[a.level] - order[b.level]);
  if (notes.length) lines.push("", "【提醒與檢查】", ...notes.map((m) => `${{ error: "❌", warn: "⚠️", ok: "✅", info: "ℹ️" }[m.level]} ${m.text}`));
  return lines.join("\n");
}
