import type { Tool } from "./ai.js";
import { calcSelection, formatCalc, type CalcInput, type Catalog } from "./calc.js";

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
  "3. 工具回傳的「我整理的需求」和「假設」要原樣重述給對方確認（特別是你替對方補上的預設值，例如精度單位、公差方向、每特徵像素數），再說計算結果；對方更正了就用新的參數再算一次。",
  "4. 結果裡的數字、算式、型號只能照工具回傳的講，不可以改、不可以編；工具說有 ❌ 或 ⚠️ 的提醒一定要告訴對方。",
  "5. 計算結果不含任何價格；客人問價格依客服規則處理。",
  "6. 結果裡標「⭐Cetus 優先推薦」的型號是我們優先推薦的，介紹建議型號時先講它們（可以說是我們優先推薦的型號）；沒有標的才當作其他選擇。不要提供應商、進價或為什麼優先推薦的內部原因。",
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
      return formatCalc(result);
    },
  };
}
