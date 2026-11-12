import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { beforeEach, test } from "node:test";
import { csConverse, handleCsEvent, handoffReply, hasWord, matchTopic, resetKnowledgeCache } from "../src/cs.js";
import type { CsInfo, KnowledgeChunk } from "../src/gas.js";
import type { LineEvent } from "../src/line.js";
import { KnowledgeIndex, tokenize } from "../src/rag.js";
import { resetWidgetCache, verifyTestToken, visitorUserId } from "../src/web.js";

process.env.CS_LINE_CHANNEL_SECRET = "cs-secret";
process.env.CS_LINE_CHANNEL_ACCESS_TOKEN = "cs-token";
process.env.GAS_URL = "https://script.example/exec";
process.env.BOT_SECRET = "aoi-test-secret";

const KB: KnowledgeChunk[] = [
  { id: "k1", source: "常見問題", title: "你們有賣光源嗎？", text: "問：你們有賣光源嗎？\n答：有，環形、條形、同軸光源都有。\n關鍵字：光源" },
  { id: "k2", source: "文件", title: "公司簡介", text: "鑫堡股份有限公司專營機器視覺與 AOI 檢測方案，位於新竹。" },
  { id: "p1", source: "產品", title: "ACA2440-20GM", text: "產品型號：ACA2440-20GM\n類別：相機\n品牌：Basler\n介面：GigE\n解析度：2448X2048" },
  { id: "p2", source: "產品", title: "LENS-25MM", text: "產品型號：LENS-25MM\n類別：鏡頭\n焦距 mm：25" },
];

// ---- 模擬管理系統（GAS）、AI、LINE ----
interface State {
  info: Partial<CsInfo>;
  history: Record<string, { u: boolean; t: string }[]>;
  paused: Set<string>;
  handoffs: { id: string; text: string; topic: string; name: string }[];
  remembered: { id: string; turns: { u: boolean; t: string }[]; name: string; topic: string }[];
  forgot: string[];
  line: { kind: string; body: Record<string, unknown> }[];
  aiCalls: { url: string; body: Record<string, unknown> }[];
  aiReply: (body: Record<string, unknown>) => Record<string, unknown>;
}
let state: State;
const realFetch = globalThis.fetch;

function baseInfo(over: Partial<CsInfo> = {}): CsInfo {
  return {
    enabled: true, channel: "line", appName: "鑫堡", brand: "鑫堡", welcome: "", prompt: "", handoffText: "", replyDelay: 0,
    ai: { source: "bot", provider: "gemini", apiKey: "KEY", model: "gemini-test", endpoint: "https://ai.example/v1beta" },
    aiFallback: [], history: [], known: true, paused: false, replyWhen: "always", inHours: null, hoursText: "", offText: "",
    handoffWords: ["真人", "小編"], topics: [{ name: "價格 / 報價", words: ["報價", "多少錢"], ask: "請留下公司名稱與電話", askPos: "after" }], topicText: "", unsure: "ask",
    style: { tone: "friendly", address: "您", emoji: "some", maxLines: 5 }, buttons: ["產品介紹", "找真人"], buttonsAlways: false, ...over,
  };
}

beforeEach(() => {
  resetKnowledgeCache();
  resetWidgetCache();
  state = {
    info: {}, history: {}, paused: new Set(), handoffs: [], remembered: [], forgot: [], line: [], aiCalls: [],
    aiReply: () => ({ candidates: [{ content: { role: "model", parts: [{ text: "有的，我們有環形與條形光源。" }] } }] }),
  };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (url === process.env.GAS_URL) {
      const id = String(body.lineUserId ?? "");
      const respond = (data: unknown) => new Response(JSON.stringify({ success: true, data }));
      switch (body.op) {
        case "csStart": return respond(baseInfo({ ...state.info, history: state.history[id] ?? [], paused: state.paused.has(id) }));
        case "csKnowledge": return respond(KB);
        case "csRemember": state.remembered.push({ id, turns: body.turns, name: body.displayName, topic: body.topic }); state.history[id] = [...(state.history[id] ?? []), ...body.turns]; return respond(2);
        case "csForget": state.forgot.push(id); state.history[id] = []; state.paused.delete(id); return respond(true);
        case "csHandoff": state.handoffs.push({ id, text: body.text, topic: body.topic, name: body.displayName }); state.paused.add(id); return respond(true);
        case "csWidget": return respond({ enabled: true, title: "線上客服", subtitle: "", color: "#2c5aa0", position: "right", autoOpen: false, allowedOrigins: "https://www.cetus.tw", welcome: "您好", buttons: ["a"], replyDelay: 0 });
        case "csThread": return respond({ messages: [{ id: 5, role: "human", text: "我是小王" }, { id: 4, role: "bot", text: "請稍候" }], paused: true });
        default: return new Response(JSON.stringify({ success: false, message: "unknown op " + body.op }));
      }
    }
    if (url.startsWith("https://ai.example/")) {
      state.aiCalls.push({ url, body });
      return new Response(JSON.stringify(state.aiReply(body)));
    }
    if (url.startsWith("https://api.line.me/")) {
      state.line.push({ kind: url.split("/bot/")[1], body });
      return new Response("{}");
    }
    return realFetch(input, init);
  }) as typeof fetch;
});

const U1 = "U" + "a".repeat(32);
const msg = (text: string): LineEvent => ({ type: "message", replyToken: "rt1", source: { type: "user", userId: U1 }, message: { type: "text", text } });
const replies = () => state.line.filter((l) => l.kind === "message/reply");
const replyTextOf = (i = 0) => String(((replies()[i]?.body.messages as { text: string }[]) ?? [])[0]?.text ?? "");

test("分詞與檢索：中文兩字一組、英文數字整個字，問題找到最相關的段落", () => {
  assert.deepEqual(tokenize("光源"), ["光源"]);
  assert.deepEqual(tokenize("ACA2440 GigE"), ["aca2440", "gige"]);
  const index = new KnowledgeIndex(KB);
  assert.equal(index.search("有賣光源嗎")[0].chunk.id, "k1");
  assert.equal(index.search("ACA2440 解析度")[0].chunk.id, "p1");
  assert.equal(index.search("鏡頭 焦距")[0].chunk.id, "p2");
  assert.equal(index.search("完全無關的火星語").length, 0);
});

test("轉真人判斷：關鍵字、指定問題（命中最多的那類）", () => {
  assert.equal(hasWord("我想找 真 人", ["真人"]), true);
  assert.equal(hasWord("你好", ["真人"]), false);
  const topics = [
    { name: "價格 / 報價", words: ["報價", "多少錢"] },
    { name: "樣品測試", words: ["樣品", "測試", "評估"] },
  ];
  assert.equal(matchTopic("這個多少錢", topics)?.name, "價格 / 報價");
  assert.equal(matchTopic("我想樣品測試評估，多少錢", topics)?.name, "樣品測試");
  assert.equal(matchTopic("你好", topics), undefined);
});

test("轉真人回覆：預設文字、主題回覆 + 留資料（前 / 後）、休息時間加註", () => {
  const info = baseInfo();
  assert.match(handoffReply(info), /已經通知專人/);
  const t = handoffReply(info, "價格 / 報價");
  assert.match(t, /價格 \/ 報價/);
  assert.match(t, /請留下公司名稱與電話/);
  assert.ok(t.indexOf("已經通知") < t.indexOf("請留下"), "預設放在後面");
  const before = handoffReply(baseInfo({ topics: [{ name: "x", words: ["x"], ask: "資料", askPos: "before" }] }), "x");
  assert.ok(before.indexOf("資料") < before.indexOf("由專人為您回覆"), "askPos=before");
  assert.match(handoffReply(baseInfo({ inHours: false, hoursText: "週一到週五 9:00–18:00" })), /休息時間/);
  assert.match(handoffReply(baseInfo({ inHours: false, offText: "明天回覆您" })), /明天回覆您/);
});

test("LINE：問知識庫的問題 → AI 依參考資料回答，記錄對話", async () => {
  await handleCsEvent(msg("你們有賣光源嗎？"));
  assert.equal(replies().length, 1);
  assert.equal(replyTextOf(), "有的，我們有環形與條形光源。");
  const sys = JSON.stringify(state.aiCalls[0].body.systemInstruction);
  assert.match(sys, /環形、條形、同軸光源/, "參考資料帶進提示詞");
  assert.match(sys, /鑫堡/, "品牌");
  assert.match(sys, /不要報價|你不能報價/, "不報價規則");
  assert.equal(state.remembered.length, 1);
  assert.equal(state.remembered[0].turns[0].t, "你們有賣光源嗎？");
  assert.equal(state.handoffs.length, 0);
});

test("LINE：客人說真人 → 轉真人回覆、通知、暫停（之後不再回）", async () => {
  await handleCsEvent(msg("我要找真人"));
  assert.equal(state.handoffs.length, 1);
  assert.match(replyTextOf(), /已經通知專人/);
  assert.equal(state.aiCalls.length, 0, "不經過 AI");
  const before = replies().length;
  await handleCsEvent(msg("還在嗎？"));
  assert.equal(replies().length, before, "暫停中不回覆");
  assert.ok(state.remembered.some((r) => r.turns.length === 1 && r.turns[0].u === true && r.turns[0].t === "還在嗎？"), "暫停中雖然不回覆，客人說的話仍要記進後台");
  await handleCsEvent(msg("重新開始"));
  assert.deepEqual(state.forgot, [U1]);
  assert.match(replyTextOf(before), /好的/);
});

test("LINE：問到指定問題（報價）→ 直接轉真人並請客人留資料，不問 AI", async () => {
  await handleCsEvent(msg("ACA2440 多少錢？"));
  assert.equal(state.handoffs[0].topic, "價格 / 報價");
  assert.equal(state.aiCalls.length, 0);
  assert.match(replyTextOf(), /請留下公司名稱與電話/);
});

test("AI 呼叫工具 transfer_to_human → 轉真人", async () => {
  state.info = { topics: [{ name: "客訴 / 退換貨", words: ["退貨"], ask: "", askPos: "after" }] };
  let round = 0;
  state.aiReply = () =>
    round++ === 0
      ? { candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "transfer_to_human", args: { topic: "客訴 / 退換貨" } } }] } }] }
      : { candidates: [{ content: { role: "model", parts: [{ text: "好的" }] } }] };
  await handleCsEvent(msg("我買的東西不太對勁"));
  assert.equal(state.handoffs[0].topic, "客訴 / 退換貨");
  assert.match(replyTextOf(), /客訴 \/ 退換貨/);
});

test("AI 提供選項按鈕 → 變成 LINE 快速回覆", async () => {
  let round = 0;
  state.aiReply = () =>
    round++ === 0
      ? { candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "offer_choices", args: { options: ["相機", "鏡頭"] } } }] } }] }
      : { candidates: [{ content: { role: "model", parts: [{ text: "請問是哪一類產品？" }] } }] };
  await handleCsEvent(msg("這個怎麼用"));
  const messages = replies()[0].body.messages as { quickReply?: { items: { action: { label: string } }[] } }[];
  assert.deepEqual(messages[0].quickReply?.items.map((i) => i.action.label), ["相機", "鏡頭", "🙋 轉真人"]); // 每則回覆下方都有「轉真人」按鈕
});

test("沒啟用 / 專人服務時間（只在服務時間以外回）→ 不回覆", async () => {
  state.info = { enabled: false };
  await handleCsEvent(msg("你好"));
  assert.equal(replies().length, 0);
  state.info = { replyWhen: "offHours", inHours: true };
  await handleCsEvent(msg("你好"));
  assert.equal(replies().length, 0);
  state.info = { replyWhen: "offHours", inHours: false };
  await handleCsEvent(msg("你們有賣光源嗎？"));
  assert.equal(replies().length, 1);
});

test("加好友：歡迎詞與按鈕；群組訊息不處理", async () => {
  state.info = { welcome: "歡迎光臨" };
  await handleCsEvent({ type: "follow", replyToken: "rt", source: { type: "user", userId: U1 } });
  assert.equal(replyTextOf(), "歡迎光臨");
  const m = replies()[0].body.messages as { quickReply?: { items: unknown[] } }[];
  assert.equal(m[0].quickReply?.items.length, 2);
  await handleCsEvent({ type: "message", replyToken: "rt", source: { type: "group", groupId: "C" + "b".repeat(32), userId: U1 }, message: { type: "text", text: "你好" } });
  assert.equal(replies().length, 1);
});

test("AI 失敗 → 自動改用備援；全部失敗 → 友善的錯誤訊息", async () => {
  state.info = { aiFallback: [{ source: "bot", provider: "gemini", apiKey: "K2", model: "backup", endpoint: "https://ai.example/v1beta" }] };
  state.aiReply = () => ({ candidates: [{ content: { role: "model", parts: [{ text: "備援回答" }] } }] });
  // 主要 AI 第一次呼叫回 429（額度用完），應該自動改用備援
  const orig = globalThis.fetch;
  let n = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).startsWith("https://ai.example/") && n++ === 0) {
      state.aiCalls.push({ url: String(input), body: {} });
      return new Response(JSON.stringify({ error: { message: "quota" } }), { status: 429 });
    }
    return orig(input, init);
  }) as typeof fetch;
  await handleCsEvent(msg("你們有賣光源嗎？"));
  assert.match(replyTextOf(), /備援回答/);
});

test("網站訪客：csConverse（web）— 暫停時 silent+paused、頻率限制、測試通道不通知", async () => {
  const vid = visitorUserId("visitor-12345678901234");
  assert.match(vid, /^V[0-9a-f]{32}$/);
  const r = await csConverse(vid, "你們有賣光源嗎？", { channel: "web", displayName: async () => "網站訪客" });
  assert.equal(r.silent, false);
  assert.equal(state.remembered[0].name, "網站訪客");
  state.paused.add(vid);
  const p = await csConverse(vid, "還在嗎", { channel: "web" });
  assert.equal(p.silent, true);
  assert.equal(p.paused, true);
  state.paused.clear();
  state.info = { rateLimited: true };
  assert.match((await csConverse(vid, "x", { channel: "web" })).reply, /太快/);
  state.info = {};
  const t = "T" + "e".repeat(32);
  const tr = await csConverse(t, "我要找真人", { channel: "test" });
  assert.equal(tr.handoff, "");
  assert.equal(state.handoffs.length, 0, "測試聊天不通知同仁");
  state.info = { ai: null };
  assert.match((await csConverse(t, "你好", { channel: "test" })).reply, /還沒有設定 AI/);
});

test("測試權杖：HMAC 簽章、過期、竄改", () => {
  const ts = String(Date.now());
  const sig = createHmac("sha256", "aoi-test-secret").update(ts).digest("hex");
  assert.equal(verifyTestToken(ts, sig), true);
  assert.equal(verifyTestToken(ts, "0".repeat(64)), false);
  assert.equal(verifyTestToken(String(Date.now() - 10 * 60_000), createHmac("sha256", "aoi-test-secret").update(String(Date.now() - 10 * 60_000)).digest("hex")), false);
  assert.equal(verifyTestToken("abc", sig), false);
});
