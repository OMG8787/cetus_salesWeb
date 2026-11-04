import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { calcSelection, formatCalc, type Catalog } from "../src/calc.js";
import { calcTool, CALC_RULES } from "../src/calc-tool.js";
import { csConverse, resetKnowledgeCache } from "../src/cs.js";
import type { CsInfo } from "../src/gas.js";

process.env.CS_LINE_CHANNEL_SECRET = "cs-secret";
process.env.CS_LINE_CHANNEL_ACCESS_TOKEN = "cs-token";
process.env.GAS_URL = "https://script.example/exec";
process.env.BOT_SECRET = "aoi-test-secret";

const CATALOG: Catalog = {
  cameras: [
    { name: "CAM-5MP-USB", resW: 2448, resH: 2048, pixelW: 3.45, pixelH: 3.45, fps: 35, iface: "USB3.0", size: '2/3"', mp: 5.01 },
    { name: "CAM-5MP-GIGE", resW: 2448, resH: 2048, pixelW: 3.45, pixelH: 3.45, fps: 24, iface: "GigE", size: '2/3"', mp: 5.01 },
    { name: "CAM-12MP", resW: 4096, resH: 3000, pixelW: 3.45, pixelH: 3.45, fps: 20, iface: "GigE", size: '1.1"', mp: 12.3 },
    { name: "CAM-1MP", resW: 1280, resH: 1024, pixelW: 5.3, pixelH: 5.3, fps: 100, iface: "GigE", size: '1/2"', mp: 1.3 },
  ],
  fa: [
    { name: "LENS-25", f: 25, sensorSize: '2/3"', resolution: "5MP", focusWd: 100 },
    { name: "LENS-35", f: 35, sensorSize: '2/3"', resolution: "5MP", focusWd: 200 },
    { name: "LENS-8", f: 8, sensorSize: '2/3"', resolution: "5MP", focusWd: 100 },
  ],
  tele: [{ name: "TELE-0.5X", mag: 0.5, wd: "110", dof: "5", sensorSize: '2/3"', resolution: "5MP" }, { name: "TELE-1X", mag: 1, wd: "65", dof: "2", sensorSize: '2/3"', resolution: "5MP" }],
};

test("缺必要資料就不計算，列出缺什麼並先重述已知的需求", () => {
  const r = calcSelection({ fovA: 100 }, CATALOG);
  assert.equal(r.ok, false);
  assert.ok(r.missing.some((m) => /另一邊長/.test(m)) && r.missing.some((m) => /最小檢測精度/.test(m)));
  assert.ok(r.restated.some((x) => /檢測範圍：100\.0 × ？/.test(x)));
  assert.equal(r.camera, null);
  const text = formatCalc(r);
  assert.match(text, /還缺的資料/);
  assert.doesNotMatch(text, /計算結果/);
});

test("沒說的欄位自己補預設值，但一定列在「假設」讓對方確認", () => {
  const r = calcSelection({ fovA: 100, fovB: 80, accuracy: 20 }, CATALOG);
  assert.ok(r.ok);
  const a = r.assumptions.join("\n");
  assert.match(a, /單位沒說.*µm/);
  assert.match(a, /公差方向.*±/);
  assert.match(a, /5 px/);
  assert.match(a, /沒給工作距離.*遠心/);
  assert.equal(r.lens?.type, "tele");
  const text = formatCalc(r);
  assert.ok(text.indexOf("【我整理的需求】") < text.indexOf("【我自己補上的假設") && text.indexOf("【我自己補上的假設") < text.indexOf("【計算結果】"), "順序：需求 → 假設 → 結果");
});

test("公差方向與單位：± 直接用；只能多 / 只能少除以 2；mm 與 µm 換算", () => {
  const pm = calcSelection({ fovA: 100, fovB: 80, accuracy: 20, accuracyUnit: "um", tolerance: "pm" }, CATALOG);
  const p = calcSelection({ fovA: 100, fovB: 80, accuracy: 20, accuracyUnit: "um", tolerance: "p" }, CATALOG);
  const mm = calcSelection({ fovA: 100, fovB: 80, accuracy: 0.02, accuracyUnit: "mm", tolerance: "pm" }, CATALOG);
  assert.equal(pm.req!.acc, 0.02);
  assert.equal(p.req!.acc, 0.01);
  assert.equal(mm.req!.acc, 0.02);
  assert.equal(pm.req!.reqW, 100 / (0.02 / 5));
  assert.match(p.steps.join("\n"), /÷ 2/);
});

test("長短邊自動對調；單位可疑時提醒", () => {
  const r = calcSelection({ fovA: 50, fovB: 120, accuracy: 20, accuracyUnit: "um" }, CATALOG);
  assert.equal(r.req!.fovL, 120);
  assert.ok(r.msgs.some((m) => /對調/.test(m.text)));
  const suspicious = calcSelection({ fovA: 100, fovB: 80, accuracy: 10, accuracyUnit: "mm" }, CATALOG);
  assert.ok(suspicious.msgs.some((m) => /請確認單位是否該是 µm/.test(m.text)));
});

test("相機：從型錄挑最小符合需求的（同畫素 GigE 優先），也可以指定型號或手動輸入", () => {
  const hard = calcSelection({ fovA: 40, fovB: 30, accuracy: 5, accuracyUnit: "um" }, CATALOG); // 需求 ≥ 32000 × 24000，型錄沒有這麼大
  assert.ok(hard.msgs.some((m) => /沒有任何一台相機達到/.test(m.text)));
  const easy = calcSelection({ fovA: 10, fovB: 8, accuracy: 25, accuracyUnit: "um" }, CATALOG); // pxReq=5µm → 2000×1600，5MP 夠用
  assert.equal(easy.camera!.name, "CAM-5MP-GIGE", "5MP 兩款同畫素，GigE 優先");
  assert.equal(easy.camera!.source, "型錄自動挑選");
  assert.deepEqual(easy.cameraRecs.map((c) => c.name), ["CAM-5MP-GIGE", "CAM-5MP-USB", "CAM-12MP"]);
  assert.ok(easy.assumptions.some((x) => /CAM-5MP-GIGE/.test(x)));
  const pick = calcSelection({ fovA: 10, fovB: 8, accuracy: 20, accuracyUnit: "um", cameraModel: "cam-12mp" }, CATALOG);
  assert.equal(pick.camera!.name, "CAM-12MP");
  assert.equal(pick.camera!.source, "指定型號");
  const manual = calcSelection({ fovA: 10, fovB: 8, accuracy: 20, accuracyUnit: "um", manualCamera: { resW: 2000, resH: 3000, pixelUm: 4 } }, CATALOG);
  assert.equal(manual.camera!.resW, 3000, "手動輸入的長短邊自動對調");
  const missingCam = calcSelection({ fovA: 10, fovB: 8, accuracy: 20, accuracyUnit: "um", cameraModel: "不存在" }, CATALOG);
  assert.ok(missingCam.msgs.some((m) => /找不到相機/.test(m.text)));
});

test("FA：理論焦距 = 感測器 × WD ÷ 視野，從型錄打分數挑鏡頭", () => {
  const r = calcSelection({ fovA: 10, fovB: 8, accuracy: 20, accuracyUnit: "um", wd: 100, lensType: "fa", cameraModel: "CAM-5MP-GIGE" }, CATALOG);
  // 感測器短邊 = 2048 × 3.45 / 1000 = 7.0656 mm；k = 7.0656 / 8 = 0.8832；F = 88.32 → 超過一般 FA 範圍
  assert.ok(Math.abs(r.lens!.target - 88.32) < 0.001);
  assert.ok(r.msgs.some((m) => /超過一般 FA 鏡頭範圍/.test(m.text)));
  const r2 = calcSelection({ fovA: 100, fovB: 80, accuracy: 100, accuracyUnit: "um", wd: 300, lensType: "fa", cameraModel: "CAM-5MP-GIGE" }, CATALOG);
  assert.ok(Math.abs(r2.lens!.target - (7.0656 / 80) * 300) < 0.001); // 26.496
  assert.equal(r2.lens!.used!.name, "LENS-25", "最接近 26.5 mm 的是 25 mm");
  assert.ok(r2.lens!.recs.length >= 1 && r2.lens!.recs[0].score > r2.lens!.recs[r2.lens!.recs.length - 1].score - 1);
  assert.ok(r2.actual!.px > 0 && r2.actual!.featPx > 0);
});

test("遠心：理論倍率 = 感測器 ÷ 視野", () => {
  const r = calcSelection({ fovA: 14, fovB: 10, accuracy: 10, accuracyUnit: "um", lensType: "tele", cameraModel: "CAM-5MP-GIGE" }, CATALOG);
  assert.ok(Math.abs(r.lens!.target - 7.0656 / 10) < 1e-9);
  assert.equal(r.lens!.used!.name, "TELE-0.5X");
  assert.ok(r.lens!.used!.errors.length === 0 || r.lens!.used!.errors.includes("視野拍不滿"));
});

test("飛拍：最大曝光、最高速度、拖影與幀率；影格率不足會報錯", () => {
  const r = calcSelection(
    { fovA: 60, fovB: 40, accuracy: 10, accuracyUnit: "um", wd: 250, lensType: "fa", manualCamera: { resW: 2448, resH: 2048, pixelUm: 3.45, fps: 60 }, speed: 200, exposure: 100, exposureUnit: "us", blurPx: 1, partsPerSec: 100, motion: "s" },
    { cameras: [], fa: [], tele: [] },
  );
  assert.ok(r.fly!.blurPx > 0 && r.fly!.maxExp > 0 && r.fly!.maxSpeed > 0 && r.fly!.fpsReq > 0);
  assert.ok(r.msgs.some((m) => /每秒要檢 100 個/.test(m.text)), "每秒 100 個超過 60 fps");
});

test("輸出不含任何價格；工具輸入整理（字串數字、單位 / 公差對應）", async () => {
  let asked = 0;
  const tool = calcTool(async () => {
    asked++;
    return CATALOG;
  });
  const text = await tool.handler({ fov_a_mm: "10", fov_b_mm: 8, accuracy: "20", accuracy_unit: "um", tolerance: "p", working_distance_mm: 120, camera_model: "CAM-5MP-GIGE" });
  assert.equal(asked, 1);
  assert.match(text, /最小檢測精度：\+20 µm（只能多不能少）/);
  assert.match(text, /【算式】/);
  assert.doesNotMatch(text, /價|NT\$|TWD|報價/);
  const missing = await tool.handler({ fov_a_mm: 10 });
  assert.match(missing, /還缺的資料/);
  const broken = await calcTool(async () => {
    throw new Error("連不上");
  }).handler({ fov_a_mm: 10, fov_b_mm: 8, accuracy: 20, accuracy_unit: "um", camera_res_w: 2448, camera_res_h: 2048, camera_pixel_um: 3.45 });
  assert.match(broken, /計算結果/, "型錄讀不到時，手動相機規格仍可計算");
  assert.match(CALC_RULES, /不要自己心算/);
});

// ---- 整合：客服機器人遇到計算問題 → AI 呼叫 calc_selection → 用型錄算出 ----
let state: { gas: string[]; aiBodies: Record<string, any>[]; round: number };
const realFetch = globalThis.fetch;
const baseInfo = (): CsInfo => ({
  enabled: true, channel: "line", appName: "鑫堡", brand: "鑫堡", welcome: "", prompt: "", handoffText: "", replyDelay: 0,
  ai: { source: "bot", provider: "gemini", apiKey: "KEY", model: "g", endpoint: "https://ai.example/v1beta" },
  aiFallback: [], history: [], known: true, paused: false, replyWhen: "always", inHours: null, hoursText: "", offText: "",
  handoffWords: ["真人"], topics: [], topicText: "", unsure: "ask", style: { tone: "friendly", address: "您", emoji: "some", maxLines: 5 }, buttons: [], buttonsAlways: false,
});
beforeEach(() => {
  resetKnowledgeCache();
  state = { gas: [], aiBodies: [], round: 0 };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (url === process.env.GAS_URL) {
      state.gas.push(body.op);
      const ok = (d: unknown) => new Response(JSON.stringify({ success: true, data: d }));
      if (body.op === "csStart") return ok(baseInfo());
      if (body.op === "csKnowledge") return ok([]);
      if (body.op === "csCalcCatalog") return ok(CATALOG);
      if (body.op === "csRemember") return ok(2);
      return new Response(JSON.stringify({ success: false, message: "unknown " + body.op }));
    }
    if (url.startsWith("https://ai.example/")) {
      state.aiBodies.push(body);
      const round = state.round++;
      if (round === 0) return new Response(JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "calc_selection", args: { fov_a_mm: 10, fov_b_mm: 8, accuracy: 25, accuracy_unit: "um" } } }] } }] }));
      return new Response(JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "我整理的需求是…（照工具結果重述）" }] } }] }));
    }
    return realFetch(input, init);
  }) as typeof fetch;
});

test("客服機器人：系統提示帶選型規則，AI 呼叫計算工具時用客服型錄（不含價格）", async () => {
  const r = await csConverse("U" + "a".repeat(32), "10x8mm 精度 20um 要用什麼相機", { channel: "line" });
  assert.equal(r.reply, "我整理的需求是…（照工具結果重述）");
  assert.ok(state.gas.includes("csCalcCatalog"), "向管理系統取客服版型錄");
  const first = state.aiBodies[0];
  assert.match(JSON.stringify(first.systemInstruction), /選型計算規則/);
  assert.ok((first.tools[0].functionDeclarations as { name: string }[]).some((t) => t.name === "calc_selection"));
  const toolResult = JSON.stringify(state.aiBodies[1].contents.at(-1));
  assert.match(toolResult, /CAM-5MP-GIGE/);
  assert.match(toolResult, /我整理的需求/);
  assert.doesNotMatch(toolResult, /價格|NT\$/);
});

test("每個問題最多查幾輪資料：用管理系統設定的 maxRounds（沒設定 = 6）", async () => {
  const { generate } = await import("../src/ai.js");
  const run = async (maxRounds?: number) => {
    let calls = 0;
    const real = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls++;
      return new Response(JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "t", args: {} } }] } }] }));
    }) as typeof fetch;
    try {
      await generate({ ai: { source: "bot", provider: "gemini", apiKey: "K", model: "m", endpoint: "https://ai.example/v1beta", maxRounds }, system: "s", turns: [{ isUser: true, text: "x" }], tools: [{ name: "t", description: "d", parameters: { type: "object", properties: {} }, handler: async () => "ok" }] });
    } catch {
      /* 超過輪數會丟錯，這裡只數次數 */
    }
    globalThis.fetch = real;
    return calls;
  };
  assert.equal(await run(), 7, "預設 6 輪（+ 最後一次）");
  assert.equal(await run(2), 3);
  assert.equal(await run(99), 13, "上限 12");
});
