import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { csConverse, knowledge, resetKnowledgeCache } from "../src/cs.js";
import type { CsInfo } from "../src/gas.js";

process.env.CS_LINE_CHANNEL_SECRET = "cs-secret";
process.env.CS_LINE_CHANNEL_ACCESS_TOKEN = "cs-token";
process.env.GAS_URL = "https://script.example/exec";
process.env.BOT_SECRET = "aoi-test-secret";

const UID = "U" + "a".repeat(32);
const CHUNKS = [
  { id: "k1", source: "常見問題", title: "光源", text: "問：有光源嗎\n答：有環形光源與條形光源" },
  { id: "k2", source: "文件", title: "保固", text: "保固一年" },
];

interface State {
  info: Partial<CsInfo>;
  gas: { op: string; [k: string]: unknown }[];
  /** 依「是主答還是檢查員」回傳 AI 文字；round = 主答這輪第幾次呼叫 */
  answer: (round: number) => Record<string, unknown>;
  check: () => Response | Record<string, unknown>;
  aiCalls: { url: string; body: Record<string, any> }[];
  mainRound: number;
}
let state: State;
const realFetch = globalThis.fetch;
const text = (t: string) => ({ candidates: [{ content: { role: "model", parts: [{ text: t }] } }] });
const toolCall = (name: string, args: Record<string, unknown>) => ({ candidates: [{ content: { role: "model", parts: [{ functionCall: { name, args } }] } }] });
const baseInfo = (): CsInfo => ({
  enabled: true, channel: "line", appName: "鑫堡", brand: "鑫堡", welcome: "", prompt: "", handoffText: "", replyDelay: 0,
  ai: { source: "bot", provider: "gemini", apiKey: "KEY", model: "main", endpoint: "https://ai.example/v1beta" },
  aiFallback: [], history: [], known: true, paused: false, replyWhen: "always", inHours: null, hoursText: "", offText: "",
  handoffWords: ["真人"], topics: [], topicText: "", unsure: "ask", style: { tone: "friendly", address: "您", emoji: "some", maxLines: 5 }, buttons: [], buttonsAlways: false,
  search: { mode: "meta", threshold: 0.6, topK: 6 }, kbVer: "v1", ...state.info,
});

beforeEach(() => {
  resetKnowledgeCache();
  state = { info: {}, gas: [], aiCalls: [], mainRound: 0, answer: () => text("有環形光源與條形光源"), check: () => text('{"ok":true}') };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (url === process.env.GAS_URL) {
      state.gas.push(body);
      const ok = (d: unknown) => new Response(JSON.stringify({ success: true, data: d }));
      if (body.op === "csStart") return ok(baseInfo());
      if (body.op === "csKnowledge") return ok(CHUNKS);
      if (body.op === "csVectors") return ok({ model: "", items: [], total: 0, next: 0 });
      if (body.op === "csCalcCatalog") return ok({ cameras: [], fa: [], tele: [] });
      if (body.op === "csRemember") return ok(2);
      if (body.op === "csHandoff") return ok(true);
      return new Response(JSON.stringify({ success: false, message: "unknown " + body.op }));
    }
    if (url.includes("/v1beta/") || url.includes("check.example")) {
      state.aiCalls.push({ url, body });
      const isChecker = JSON.stringify(body.systemInstruction ?? "").includes("檢查員");
      const r = isChecker ? state.check() : state.answer(state.mainRound++);
      return r instanceof Response ? r : new Response(JSON.stringify(r));
    }
    return realFetch(input, init);
  }) as typeof fetch;
});

const gasOps = (op: string) => state.gas.filter((g) => g.op === op);
const checkerCalls = () => state.aiCalls.filter((c) => JSON.stringify(c.body.systemInstruction ?? "").includes("檢查員"));

test("回覆前檢查預設關閉：只呼叫一次 AI", async () => {
  const r = await csConverse(UID, "有光源嗎", { channel: "line" });
  assert.equal(r.reply, "有環形光源與條形光源");
  assert.equal(checkerCalls().length, 0);
  assert.equal(state.aiCalls.length, 1);
});

test("開啟後：有根據 → 照常送出（JSON 包在 ```json 裡也能解析），檢查員看得到參考資料與回覆", async () => {
  state.info = { groundCheck: true };
  state.check = () => text('```json\n{"ok":true}\n```');
  const r = await csConverse(UID, "有光源嗎", { channel: "line" });
  assert.equal(r.reply, "有環形光源與條形光源");
  assert.equal(checkerCalls().length, 1);
  const sent = JSON.stringify(checkerCalls()[0].body.contents);
  assert.match(sent, /環形光源與條形光源/, "含回覆");
  assert.match(sent, /客人最近的問題/);
  assert.match(sent, /有光源嗎/);
});

test("沒有根據 → 不送出原回覆，改請客人找專人；對話紀錄標「回覆檢查未通過」", async () => {
  state.info = { groundCheck: true };
  state.answer = () => text("我們的光源保固三年，現在特價九折");
  state.check = () => text('{"ok":false,"reason":"保固三年、九折沒有根據"}');
  const r = await csConverse(UID, "光源保固多久", { channel: "line" });
  assert.doesNotMatch(r.reply, /三年|九折/);
  assert.match(r.reply, /不太確定/);
  assert.match(r.reply, /真人/);
  assert.equal(r.choices.length, 0);
  assert.equal(r.handoff, null);
  const remembered = gasOps("csRemember")[0];
  assert.equal(remembered.topic, "回覆檢查未通過");
  assert.doesNotMatch(JSON.stringify(remembered.turns), /三年|九折/, "記下的是實際送出的回覆");
});

test("找不到答案時設成「直接轉專人」：沒有根據 → 轉小編（主題：知識庫找不到根據）", async () => {
  state.info = { groundCheck: true, unsure: "handoff" };
  state.answer = () => text("保固三年");
  state.check = () => text('{"ok":false,"reason":"x"}');
  const r = await csConverse(UID, "光源保固多久", { channel: "line" });
  assert.equal(r.handoff, "知識庫找不到根據");
  assert.equal(gasOps("csHandoff").length, 1);
  assert.equal(gasOps("csHandoff")[0].topic, "知識庫找不到根據");
});

test("檢查員出錯 / 回覆看不懂 / JSON 壞掉：一律當作不通過（寧可不答）", async () => {
  state.info = { groundCheck: true };
  for (const make of [
    () => new Response("server error", { status: 500 }),
    () => text("我覺得沒問題"),
    () => text('{"ok":'),
    () => text('{"ok":"yes"}'),
  ]) {
    resetKnowledgeCache();
    state.check = make;
    const r = await csConverse(UID, "有光源嗎", { channel: "line" });
    assert.match(r.reply, /不太確定/, "不通過");
  }
});

test("AI 用 search_knowledge 另外找到的內容，也算根據（檢查員看得到）", async () => {
  state.info = { groundCheck: true };
  state.answer = (round) => (round === 0 ? toolCall("search_knowledge", { query: "保固" }) : text("保固一年"));
  await csConverse(UID, "保固多久", { channel: "line" });
  assert.match(JSON.stringify(checkerCalls()[0].body.contents), /保固一年/);
});

test("有指定「回覆檢查」用的 AI 就用它；沒指定用客服那一組", async () => {
  state.info = { groundCheck: true, checkAi: { source: "bot", provider: "gemini", apiKey: "CHK", model: "cheap", endpoint: "https://check.example/v1beta" } };
  await csConverse(UID, "有光源嗎", { channel: "line" });
  assert.ok(checkerCalls()[0].url.startsWith("https://check.example/"), "檢查走指定的 AI：" + checkerCalls()[0].url);
  assert.ok(state.aiCalls.some((c) => c.url.startsWith("https://ai.example/")), "回答仍用客服那組");
  state.aiCalls = [];
  state.info = { groundCheck: true };
  await csConverse(UID, "有光源嗎", { channel: "line" });
  assert.ok(checkerCalls()[0].url.startsWith("https://ai.example/"));
});

test("這則本來就要轉真人時不檢查", async () => {
  state.info = { groundCheck: true };
  await csConverse(UID, "我要找真人", { channel: "line" });
  assert.equal(checkerCalls().length, 0);
});

test("知識庫版本號：版本一樣用快取、版本變了就馬上重讀（刪掉的資料不會再被找到）", async () => {
  await knowledge(false, "v1");
  await knowledge(false, "v1");
  assert.equal(gasOps("csKnowledge").length, 1, "同版本只讀一次");
  await knowledge(false, "v2");
  assert.equal(gasOps("csKnowledge").length, 2, "版本變了重讀");
  await knowledge(false, undefined);
  assert.equal(gasOps("csKnowledge").length, 2, "沒帶版本號（舊版管理系統）照 5 分鐘快取");
  // 整則訊息流程也一樣：每則訊息的 csStart 帶回版本號
  resetKnowledgeCache();
  state.info = { kbVer: "a" };
  await csConverse(UID, "有光源嗎", { channel: "line" });
  await csConverse(UID, "有光源嗎", { channel: "line" });
  assert.equal(gasOps("csKnowledge").length, 3, "同版本 → 不重讀");
  state.info = { kbVer: "b" };
  await csConverse(UID, "有光源嗎", { channel: "line" });
  assert.equal(gasOps("csKnowledge").length, 4, "版本變了 → 重讀");
});

test("提示詞：不要沿用之前對話裡自己說過的話", async () => {
  await csConverse(UID, "有光源嗎", { channel: "line" });
  assert.match(JSON.stringify(state.aiCalls[0].body.systemInstruction), /不要沿用之前的回答/);
});
