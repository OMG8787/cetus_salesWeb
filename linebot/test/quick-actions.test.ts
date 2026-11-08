import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { csConverse, isGreeting, resetKnowledgeCache } from "../src/cs.js";
import type { CsInfo } from "../src/gas.js";

process.env.GAS_URL = "https://script.example/exec";
process.env.BOT_SECRET = "aoi-test-secret";

const V = "V" + "c".repeat(32);
let round = 0;
let answer: (round: number) => Record<string, unknown>;
const realFetch = globalThis.fetch;
const text = (t: string) => ({ candidates: [{ content: { role: "model", parts: [{ text: t }] } }] });
const toolCall = (name: string, args: Record<string, unknown>) => ({ candidates: [{ content: { role: "model", parts: [{ functionCall: { name, args } }] } }] });
const info = (): CsInfo => ({
  enabled: true, channel: "web", appName: "鑫堡", brand: "鑫堡", welcome: "", prompt: "", handoffText: "", replyDelay: 0,
  ai: { source: "bot", provider: "gemini", apiKey: "KEY", model: "main", endpoint: "https://ai.example/v1beta" },
  aiFallback: [], history: [], known: true, paused: false, replyWhen: "always", inHours: null, hoursText: "", offText: "",
  handoffWords: ["真人"], topics: [], topicText: "", unsure: "ask", style: { tone: "friendly", address: "您", emoji: "some", maxLines: 5 },
  buttons: [], buttonsAlways: false, kbVer: "v1", handoffButton: true, contactAfter: 0, sendImages: true, turnCount: 0, leadState: "",
});

beforeEach(() => {
  resetKnowledgeCache();
  round = 0;
  answer = () => text("好的");
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (url === process.env.GAS_URL) {
      const ok = (d: unknown) => new Response(JSON.stringify({ success: true, data: d }));
      if (body.op === "csStart") return ok(info());
      if (body.op === "csKnowledge") return ok([{ id: "k1", source: "常見問題", title: "保固", text: "保固一年" }]);
      if (body.op === "csVectors") return ok({ model: "", items: [], total: 0, next: 0 });
      if (body.op === "csCalcCatalog") return ok({ cameras: [], fa: [], tele: [] });
      return ok(true);
    }
    if (url.includes("/v1beta/")) return new Response(JSON.stringify(answer(round++)));
    return realFetch(input, init);
  }) as typeof fetch;
});

test("isGreeting：短短一句問候才算", () => {
  for (const t of ["你好", "您好！", "哈囉", "hi", "Hello", "早安", "嗨嗨", "在嗎？"]) assert.equal(isGreeting(t), true, t);
  for (const t of ["", "保固多久", "你好，請問 MV-CA050 的接口是什麼", "我要買相機"]) assert.equal(isGreeting(t), false, t);
});

test("打招呼 → 附快捷按鈕（就算 AI 沒呼叫工具）", async () => {
  answer = () => text("您好！請問需要什麼協助呢？");
  const r = await csConverse(V, "你好", { channel: "web" });
  assert.equal(r.quickActions, true);
  assert.equal(r.handoffButton, true, "每則回覆的「轉真人」維持");
});

test("一般問題有答案 → 不附快捷按鈕", async () => {
  answer = () => text("保固一年。");
  const r = await csConverse(V, "保固多久", { channel: "web" });
  assert.equal(r.quickActions, false);
  assert.equal(r.handoffButton, true);
});

test("AI 說不確定時呼叫 offer_quick_actions → 附快捷按鈕", async () => {
  answer = (n) => (n === 0 ? toolCall("offer_quick_actions", {}) : text("這個問題我不太確定，建議請專人協助。"));
  const r = await csConverse(V, "你們跟某某公司合作嗎", { channel: "web" });
  assert.equal(r.quickActions, true);
  assert.match(r.reply, /不太確定/);
});

test("AI 沒有任何回覆（備用說法）→ 附快捷按鈕", async () => {
  answer = () => text("");
  const r = await csConverse(V, "xyz", { channel: "web" });
  assert.equal(r.quickActions, true);
});

test("轉真人後不再附快捷按鈕", async () => {
  const r = await csConverse(V, "我要找真人", { channel: "web" });
  assert.equal(r.quickActions, false);
});

test("選型計算算出結果 → 回覆附「看更多」；還缺資料時不附", async () => {
  const calc = { fov_a_mm: 100, fov_b_mm: 80, accuracy: 10, accuracy_unit: "um" };
  answer = (n) => (n === 0 ? toolCall("calc_selection", calc) : text("建議規格如上。"));
  const done = await csConverse(V, "幫我選相機 視野 100x80 精度 10um", { channel: "web" });
  assert.equal(done.seeMore, true);

  answer = (n) => (n === 0 ? toolCall("calc_selection", { fov_a_mm: 100 }) : text("請問精度要求多少？"));
  const missing = await csConverse(V, "幫我選相機 視野 100", { channel: "web" });
  assert.equal(missing.seeMore, false);
});

test("一般問題不附「看更多」", async () => {
  answer = () => text("保固一年。");
  const r = await csConverse(V, "保固多久", { channel: "web" });
  assert.equal(r.seeMore, false);
});

// ---- 熱路徑：第二則起不等管理系統（Apps Script 一次約 2.5 秒），背景核對最新狀態、送出前再確認 ----
function slowStart(opts: { delayMs: number; patch?: () => Partial<CsInfo> }) {
  const log: string[] = [];
  const inner = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (String(input) === process.env.GAS_URL && body.op === "csStart") {
      log.push("start");
      if (log.filter((x) => x === "start").length > 1) {
        await new Promise((r) => setTimeout(r, opts.delayMs));
        return new Response(JSON.stringify({ success: true, data: { ...info(), ...(opts.patch?.() ?? {}) } }));
      }
    }
    if (String(input) === process.env.GAS_URL && body.op === "csRemember") log.push("remember");
    return inner(input, init);
  }) as typeof fetch;
  return { log, restore: () => { globalThis.fetch = inner; } };
}

test("熱路徑：同一位訪客的第二則不用等管理系統，AI 看得到上一輪對話", async () => {
  const net = slowStart({ delayMs: 400 });
  const prompts: string[] = [];
  const U = "V" + "d".repeat(32);
  answer = () => text("保固一年。");
  const jobs: Promise<unknown>[] = [];
  try {
    await csConverse(U, "保固多久", { channel: "web", defer: (j) => jobs.push(j) });
    const base = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/v1beta/")) {
        prompts.push(String(init?.body));
        await new Promise((r) => setTimeout(r, 300)); // AI 想 300ms，管理系統 400ms：同時進行 → 約 400ms，不是 700ms
      }
      return base(input, init);
    }) as typeof fetch;
    const t = Date.now();
    const r = await csConverse(U, "那維修呢", { channel: "web", defer: (j) => jobs.push(j) });
    const took = Date.now() - t;
    await Promise.all(jobs);
    assert.ok(!r.silent && r.reply, "有回覆");
    assert.ok(took < 600, `管理系統與 AI 同時進行（循序要 700ms）：${took}ms`);
    assert.match(prompts[0], /保固多久/, "AI 看得到上一輪（記憶體裡的歷史）");
    assert.equal(net.log.filter((x) => x === "start").length, 2, "背景仍然取得最新狀態");
  } finally {
    net.restore();
  }
});

test("熱路徑：背景發現小編已接手 / 已停用 → 這則回覆作廢，不送出", async () => {
  for (const patch of [{ paused: true }, { enabled: false }, { rateLimited: true }]) {
    resetKnowledgeCache();
    const net = slowStart({ delayMs: 50, patch: () => patch });
    const U = "V" + "e".repeat(32);
    try {
      await csConverse(U, "保固多久", { channel: "web" });
      const r = await csConverse(U, "那維修呢", { channel: "web" });
      if ("rateLimited" in patch) assert.match(r.reply, /太快/);
      else assert.equal(r.silent, true, JSON.stringify(patch));
    } finally {
      net.restore();
    }
  }
});

test("熱路徑：第一則、重新整理（新的執行個體）仍然等管理系統；後台測試聊天永遠讀最新設定", async () => {
  const net = slowStart({ delayMs: 10 });
  try {
    const U = "V" + "f".repeat(32);
    await csConverse(U, "保固多久", { channel: "web" });
    assert.equal(net.log.filter((x) => x === "start").length, 1);
    await csConverse(U, "保固多久", { channel: "test" });
    await csConverse(U, "保固多久", { channel: "test" });
    assert.equal(net.log.filter((x) => x === "start").length, 3, "測試聊天每則都等最新設定");
  } finally {
    net.restore();
  }
});

test("Gemini 2.5 Flash：客服回覆關閉思考；型號不支援時自動拿掉再送", async () => {
  const bodies: Record<string, unknown>[] = [];
  const inner = globalThis.fetch;
  let reject = false;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes("/v1beta/")) {
      const b = JSON.parse(String(init?.body));
      bodies.push(b);
      if (reject && b.generationConfig) return new Response(JSON.stringify({ error: { message: "Thinking is not supported by this model" } }), { status: 400 });
      return new Response(JSON.stringify(text("好的")));
    }
    return inner(input, init);
  }) as typeof fetch;
  try {
    const ai = (model: string) => ({ source: "bot" as const, provider: "gemini" as const, apiKey: "KEY", model, endpoint: "https://ai.example/v1beta" });
    const { generate } = await import("../src/ai.js");
    await generate({ ai: ai("gemini-2.5-flash"), system: "s", turns: [{ isUser: true, text: "hi" }], fast: true });
    assert.deepEqual((bodies.at(-1) as { generationConfig: unknown }).generationConfig, { thinkingConfig: { thinkingBudget: 0 } });
    await generate({ ai: ai("gemini-2.5-pro"), system: "s", turns: [{ isUser: true, text: "hi" }], fast: true });
    assert.equal((bodies.at(-1) as { generationConfig?: unknown }).generationConfig, undefined, "非 2.5 Flash 不送思考設定");
    reject = true;
    const before = bodies.length;
    assert.equal(await generate({ ai: ai("gemini-2.5-flash-lite"), system: "s", turns: [{ isUser: true, text: "hi" }], fast: true }), "好的");
    assert.equal(bodies.length - before, 2, "被拒絕後拿掉思考設定重送一次");
  } finally {
    globalThis.fetch = inner;
  }
});

test("同一輪的多個工具一起跑，結果順序不變", async () => {
  const { generate } = await import("../src/ai.js");
  const calls = [{ functionCall: { name: "slow", args: {} } }, { functionCall: { name: "fast", args: {} } }];
  let n = 0;
  const inner = globalThis.fetch;
  const started: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (String(input).includes("/v1beta/")) return new Response(JSON.stringify(n++ === 0 ? { candidates: [{ content: { role: "model", parts: calls } }] } : text("完成")));
    return inner(input);
  }) as typeof fetch;
  try {
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const tools = [
      { name: "slow", description: "", parameters: { type: "object", properties: {} }, handler: async () => { started.push("slow"); await wait(60); return "S"; } },
      { name: "fast", description: "", parameters: { type: "object", properties: {} }, handler: async () => { started.push("fast"); return "F"; } },
    ];
    const t0 = Date.now();
    const out = await generate({ ai: { source: "bot", provider: "gemini", apiKey: "K", model: "m", endpoint: "https://ai.example/v1beta" }, system: "s", turns: [{ isUser: true, text: "hi" }], tools });
    assert.equal(out, "完成");
    assert.deepEqual(started, ["slow", "fast"], "兩個工具同時開始");
    assert.ok(Date.now() - t0 < 200);
  } finally {
    globalThis.fetch = inner;
  }
});

test("關閉思考是開關：預設關閉思考（送 thinkingBudget 0），後台取消勾選就不送", async () => {
  const bodies: Record<string, unknown>[] = [];
  const inner = globalThis.fetch;
  let noThinking: boolean | undefined;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (String(input) === process.env.GAS_URL && body.op === "csStart") {
      return new Response(JSON.stringify({ success: true, data: { ...info(), ai: { source: "bot", provider: "gemini", apiKey: "KEY", model: "gemini-2.5-flash", endpoint: "https://ai.example/v1beta" }, noThinking } }));
    }
    if (String(input).includes("/v1beta/")) bodies.push(body);
    return inner(input, init);
  }) as typeof fetch;
  try {
    answer = () => text("保固一年。");
    for (const [flag, expectCfg] of [[undefined, true], [true, true], [false, false]] as const) {
      noThinking = flag;
      bodies.length = 0;
      resetKnowledgeCache();
      await csConverse("V" + (flag === undefined ? "7" : flag ? "8" : "9").repeat(32), "保固多久", { channel: "web" });
      const cfg = (bodies.at(-1) as { generationConfig?: { thinkingConfig?: { thinkingBudget: number } } }).generationConfig;
      assert.equal(cfg?.thinkingConfig?.thinkingBudget === 0, expectCfg, `noThinking=${flag}`);
    }
  } finally {
    globalThis.fetch = inner;
  }
});
