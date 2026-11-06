import type { Tool } from "./ai.js";
import { briefCam, calcSelection, effPxOf, formatCalc, type CalcInput, type Camera, type Catalog } from "./calc.js";

export { effPxOf };

// 給 AI 的「選型計算」工具：AI 不自己心算，把客人 / 同事說的需求整理成參數丟進來，由程式照網站「選型計算」的公式算。
// 回傳一定是「我整理的需求 → 假設 → 計算結果 → 建議型號 → 算式 → 提醒」，AI 照著重述給對方確認，不可以改數字。

const num = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return isFinite(n) ? n : undefined;
};

export const CALC_RULES = [
  "【選型計算規則】客人或同事問的是計算問題（要選哪台相機 / 鏡頭、視野、精度、解析度、焦距、倍率、工作距離、飛拍曝光與速度…）時：",
  "1. 一律呼叫 calc_selection 工具，絕對不要自己心算，也不要憑印象給數字。",
  "2. 呼叫前先把對方的話整理成參數，缺的必要資料（檢測範圍兩個邊長、最小檢測精度與單位）先反問，不要猜；單位不確定（µm 還是 mm）一定要問。",
  "3. 工具回傳的「我整理的需求」和「假設」要原樣重述給對方確認（工具回傳精簡格式時例外，見規則 8）（特別是你替對方補上的預設值，例如精度單位、公差方向、每特徵像素數），再說計算結果；對方更正了就用新的參數再算一次。",
  "4. 結果裡的數字、算式、型號只能照工具回傳的講，不可以改、不可以編；工具說有 ❌ 或 ⚠️ 的提醒一定要告訴對方。",
  "5. 計算結果不含任何價格；客人問價格依客服規則處理。",
  "6. 客人只說要「N 萬畫素」（例如 30 萬、500 萬、2 百萬像素）、或只問某個品牌（例如 Basler）有哪些相機、還沒給檢測範圍與精度時，呼叫 find_camera_by_pixels（可帶 brand）列出相機；知識庫沒有的相機型號不代表型錄沒有，要先用這個工具查；之後再反問檢測範圍與精度，用 calc_selection 確認視野與精度夠不夠。",
  "8. 工具回傳的是精簡格式（只有「推薦相機：型號(像素)」「推薦鏡頭：型號」這幾行）時，回覆也要精簡：直接列出工具給的型號與括號內的像素，不要自己補解析度、像元尺寸、靶面、影格率、算式或其他規格，不要重述需求，不要多列工具沒給的型號；有「假設」或 ❌ ⚠️ 提醒就各用一句話帶過。客人追問規格時再用 find_camera_by_pixels 或知識庫回答。",
  "7. 結果裡標「⭐Cetus 優先推薦」的型號是我們優先推薦的，介紹建議型號時先講它們（可以說是我們優先推薦的型號）；沒有標的才當作其他選擇。不要提供應商、進價或為什麼優先推薦的內部原因。",
  "9. 結果有 ❌（達不到需求，例如沒有相機夠大、視野拍不滿、拖影太大）時，一定要用一兩句話告訴客人「怎麼調整」才能達到（照工具提示的調整建議：放寬精度、縮小檢測範圍、拉遠 WD、改倍率或鏡頭、拆成多個視野…），並問客人要不要調整後再算一次；客人說沒辦法調整、或調整後仍然達不到，就請客人轉專人協助（客服版：引導客人按「轉真人」或輸入轉真人關鍵字；員工版：建議找 FAE 評估），不要硬湊型號。",
].join("\n");

/** onResult：算出結果（不是還缺資料）時通知一聲，網站視窗據此在回覆下方附「看更多」按鈕 */
export function calcTool(getCatalog: () => Promise<Catalog>, onResult?: () => void): Tool {
  return {
    name: "calc_selection",
    description:
      "選型計算（相機、鏡頭、視野、空間解析度、飛拍）。需求：檢測範圍兩個邊長（mm）、最小檢測精度（含單位與公差方向）；可選：單特徵像素數（預設 5）、工作距離 WD、鏡頭類型（fa 定焦 / tele 遠心）、指定相機型號或手動相機規格、飛拍速度與曝光等。回傳整理後的需求、假設、結果、建議型號與算式。",
    parameters: {
      type: "object",
      properties: {
        fov_a_mm: { type: "number", description: "檢測範圍的一個邊長（mm）；不用分長短" },
        fov_b_mm: { type: "number", description: "檢測範圍的另一個邊長（mm）" },
        accuracy: { type: "number", description: "最小檢測精度的數值" },
        accuracy_unit: { type: "string", enum: ["um", "mm"], description: "精度單位：um = 微米 µm、mm = 毫米；對方沒說清楚要先問" },
        tolerance: { type: "string", enum: ["pm", "p", "m"], description: "pm = ±（兩側各容許）、p = 只能多不能少（+）、m = 只能少不能多（−）；沒說就是 pm" },
        pixels_per_feature: { type: "number", description: "單個最小特徵要佔幾個像素，預設 5" },
        working_distance_mm: { type: "number", description: "工作距離 WD（mm），FA 鏡頭需要" },
        lens_type: { type: "string", enum: ["fa", "tele"], description: "fa = FA 定焦鏡頭、tele = 遠心鏡頭" },
        pixel_base: { type: "string", enum: ["short", "long"], description: "空間解析度的基準邊，預設 short 短邊" },
        camera_model: { type: "string", description: "指定的相機型號（沒指定就從型錄挑最小符合的）" },
        camera_res_w: { type: "number", description: "手動相機：長邊像素數" },
        camera_res_h: { type: "number", description: "手動相機：短邊像素數" },
        camera_pixel_um: { type: "number", description: "手動相機：像素尺寸（µm）" },
        camera_fps: { type: "number", description: "手動相機：最高幀率" },
        speed_mm_s: { type: "number", description: "飛拍：移動速度（mm/s）" },
        exposure: { type: "number", description: "飛拍：曝光時間數值" },
        exposure_unit: { type: "string", enum: ["us", "ms"], description: "曝光時間單位，預設 ms" },
        blur_px: { type: "number", description: "飛拍：容許拖影（px）" },
        parts_per_sec: { type: "number", description: "產能：每秒要檢測幾個" },
        motion_along: { type: "string", enum: ["long", "short"], description: "移動方向沿著視野的哪一邊，預設 long 長邊" },
      },
    },
    handler: async (a) => {
      const input: CalcInput = {
        fovA: num(a.fov_a_mm),
        fovB: num(a.fov_b_mm),
        accuracy: num(a.accuracy),
        accuracyUnit: a.accuracy_unit === "mm" ? "mm" : a.accuracy_unit === "um" ? "um" : undefined,
        tolerance: a.tolerance === "p" ? "p" : a.tolerance === "m" ? "m" : a.tolerance === "pm" ? "pm" : undefined,
        pxPerFeature: num(a.pixels_per_feature),
        wd: num(a.working_distance_mm),
        lensType: a.lens_type === "tele" ? "tele" : a.lens_type === "fa" ? "fa" : undefined,
        base: a.pixel_base === "long" ? "l" : a.pixel_base === "short" ? "s" : undefined,
        cameraModel: typeof a.camera_model === "string" && a.camera_model.trim() ? a.camera_model.trim() : undefined,
        speed: num(a.speed_mm_s),
        exposure: num(a.exposure),
        exposureUnit: a.exposure_unit === "us" ? "us" : "ms",
        blurPx: num(a.blur_px),
        partsPerSec: num(a.parts_per_sec),
        motion: a.motion_along === "short" ? "s" : "l",
      };
      const rw = num(a.camera_res_w);
      const rh = num(a.camera_res_h);
      const pix = num(a.camera_pixel_um);
      if (rw && rh && pix) input.manualCamera = { resW: rw, resH: rh, pixelUm: pix, fps: num(a.camera_fps) };
      let catalog: Catalog = { cameras: [], fa: [], tele: [] };
      try {
        catalog = await getCatalog();
      } catch (error) {
        console.warn("取得選型型錄失敗", (error as Error).message);
      }
      const result = calcSelection(input, catalog);
      if (result.ok && !result.missing.length) onResult?.();
      return formatCalc(result, catalog.reply);
    },
  };
}

const fmtWan = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/**
 * 依「有效像素」找相機：客人只說要幾萬畫素時，列出最接近的幾款（Cetus 優先推薦的型號，離得最近的一款一定會列出）。
 * 距離相同時 Cetus 排前面、再依 GigE 優先。
 */
export function findCamerasByPixels(cameras: Camera[], targetWan: number | undefined, opts: { iface?: "gige" | "usb3"; brand?: string; limit?: number; brief?: boolean } = {}): { text: string; count: number } {
  const limit = Math.min(8, Math.max(1, Math.floor(opts.limit ?? 5)));
  let pool = cameras.filter((c) => effPxOf(c) > 0);
  if (opts.iface) pool = pool.filter((c) => (opts.iface === "gige" ? /gige/i : /usb/i).test(String(c.iface ?? "")));
  const brand = String(opts.brand ?? "").trim().toLowerCase();
  if (brand) pool = pool.filter((c) => `${c.brand ?? ""} ${c.name}`.toLowerCase().includes(brand));
  if (!pool.length) {
    return { text: brand ? `選型型錄裡沒有「${opts.brand}」品牌的相機（可能還沒匯入、或缺解析度 / 像元尺寸而沒有進選型型錄）。請改用其他條件，或請專人協助。` : "型錄裡沒有符合的相機資料。", count: 0 };
  }
  const gige = (c: Camera) => (/gige/i.test(String(c.iface ?? "")) ? 0 : 1);
  const ranked = pool
    .map((c) => ({ c, diff: targetWan === undefined ? 0 : Math.abs(effPxOf(c) - targetWan) }))
    .sort((a, b) => a.diff - b.diff || (targetWan === undefined ? effPxOf(a.c) - effPxOf(b.c) : 0) || Number(!!b.c.pref) - Number(!!a.c.pref) || gige(a.c) - gige(b.c) || a.c.name.localeCompare(b.c.name));
  const picked = ranked.slice(0, limit);
  if (!picked.some((x) => x.c.pref)) {
    const best = ranked.find((x) => x.c.pref);
    if (best) picked[picked.length - 1] = best; // 最接近的 Cetus 型號一定要列出
  }
  if (opts.brief) {
    return { count: picked.length, text: [targetWan === undefined ? `${opts.brand ?? ""}相機：` : `最接近 ${fmtWan(targetWan)} 萬的相機：`, ...picked.map(({ c }) => `・${briefCam(c)}`)].join("\n") };
  }
  const lines = picked.map(
    ({ c, diff }) =>
      `・${c.name}${c.pref ? " ⭐Cetus 優先推薦" : ""}｜${c.brand ? c.brand + "｜" : ""}有效像素 ${fmtWan(effPxOf(c))} 萬${targetWan === undefined ? "" : diff === 0 ? "（剛好）" : `（差 ${fmtWan(diff)} 萬）`}｜解析度 ${c.resW} × ${c.resH}｜${c.iface || "-"}${c.fps ? `｜${c.fps} fps` : ""}${c.pixelW ? `｜像素 ${c.pixelW} µm` : ""}`,
  );
  return {
    count: picked.length,
    text: [targetWan === undefined ? `【${opts.brand ?? ""}相機（有效像素由小到大）】` : `【${brand ? opts.brand + " " : ""}有效像素最接近 ${fmtWan(targetWan)} 萬的相機】`, ...lines, "", "ℹ️ 有效像素以型錄為準；視野、精度夠不夠，還要有檢測範圍與最小檢測精度才能用選型計算確認。"].join("\n"),
  };
}

/** 給 AI 的「依有效像素找相機」工具（客人直接說要幾萬畫素時用） */
export function cameraPixelTool(getCatalog: () => Promise<Catalog>, onResult?: () => void): Tool {
  return {
    name: "find_camera_by_pixels",
    description:
      "客人只說要「幾萬畫素」（例如 30 萬、200 萬、500 萬）、或只問某個品牌有哪些相機（例如 Basler）時使用：列出有效像素最接近的相機型號。target_wan 單位是「萬」：30 萬 = 30、5 MP = 500；只問品牌時可以不填。brand 是客人指定的品牌（例如 Basler）。回傳型號、品牌、有效像素、解析度、介面、影格率，標 ⭐Cetus 的是優先推薦；不含價格。這是選型型錄，查相機型號 / 規格 / 品牌都先用這個，不要只看知識庫。",
    parameters: {
      type: "object",
      properties: {
        target_wan: { type: "number", description: "目標有效像素，單位萬（30 萬畫素 = 30；5 MP = 500）；只問品牌時可以不填" },
        brand: { type: "string", description: "客人指定的品牌，例如 Basler、FLIR；沒指定就不要填" },
        interface: { type: "string", enum: ["gige", "usb3"], description: "客人指定的介面；沒指定就不要填" },
        limit: { type: "number", description: "最多列幾款，預設 5" },
      },
    },
    handler: async (a) => {
      const target = num(a.target_wan);
      const brand = typeof a.brand === "string" ? a.brand.trim() : "";
      if ((!target || target <= 0) && !brand) return "失敗：請提供目標有效像素（萬）或品牌";
      let catalog: Catalog = { cameras: [], fa: [], tele: [] };
      try {
        catalog = await getCatalog();
      } catch (error) {
        console.warn("取得選型型錄失敗", (error as Error).message);
      }
      const r = findCamerasByPixels(catalog.cameras, target && target > 0 ? target : undefined, { brand, iface: a.interface === "gige" ? "gige" : a.interface === "usb3" ? "usb3" : undefined, limit: num(a.limit), brief: catalog.reply?.brief });
      if (r.count) onResult?.();
      return r.text;
    },
  };
}
