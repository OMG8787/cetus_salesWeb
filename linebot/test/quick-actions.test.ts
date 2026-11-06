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

test("背景寫入對話紀錄時，同一位訪客的下一則會先等它寫完再讀歷史", async () => {
  const log: string[] = [];
  const inner = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (String(input) === process.env.GAS_URL && body.op === "csRemember") {
      log.push("remember:start");
      await new Promise((r) => setTimeout(r, 150));
      log.push("remember:end");
    }
    if (String(input) === process.env.GAS_URL && body.op === "csStart") log.push("start");
    return inner(input, init);
  }) as typeof fetch;
  const jobs: Promise<unknown>[] = [];
  const U = "V" + "d".repeat(32);
  answer = () => text("保固一年。");
  await csConverse(U, "保固多久", { channel: "web", defer: (j) => jobs.push(j) });
  await csConverse(U, "那維修呢", { channel: "web", defer: (j) => jobs.push(j) }); // 立刻送下一則
  await Promise.all(jobs);
  assert.deepEqual(log.slice(0, 4), ["start", "remember:start", "remember:end", "start"], "第二則的 csStart 要在第一則的 csRemember 結束之後");
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
