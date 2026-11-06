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
