import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { beforeEach, test } from "node:test";
import * as chat from "../api/widget/chat.js";
import * as widgetConfig from "../api/widget/config.js";
import * as messages from "../api/widget/messages.js";
import * as testApi from "../api/test.js";
import { resetKnowledgeCache } from "../src/cs.js";
import { resetWidgetCache } from "../src/web.js";

process.env.GAS_URL = "https://script.example/exec";
process.env.BOT_SECRET = "aoi-test-secret";

let widgetOn = true;
let origins = "https://www.cetus.tw\nhttps://cetus.tw";
const gasOps: string[] = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  widgetOn = true;
  origins = "https://www.cetus.tw\nhttps://cetus.tw";
  gasOps.length = 0;
  resetWidgetCache();
  resetKnowledgeCache();
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (url === process.env.GAS_URL) {
      gasOps.push(String(body.op));
      const respond = (data: unknown) => new Response(JSON.stringify({ success: true, data }));
      if (body.op === "csWidget") return respond({ enabled: widgetOn, title: "線上客服", subtitle: "問我", color: "#2c5aa0", position: "right", autoOpen: true, allowedOrigins: origins, welcome: "您好", buttons: ["產品介紹"], replyDelay: 0 });
      if (body.op === "csStart") return respond({ enabled: true, channel: "web", brand: "鑫堡", appName: "鑫堡", welcome: "", prompt: "", handoffText: "", replyDelay: 0, ai: { source: "bot", provider: "gemini", apiKey: "K", model: "m", endpoint: "https://ai.example/v1beta" }, history: [], handoffWords: ["真人"], topics: [], style: undefined });
      if (body.op === "csKnowledge") return respond([{ id: "k1", source: "常見問題", title: "光源", text: "問：有光源嗎\n答：有" }]);
      if (body.op === "csRemember") return respond(2);
      if (body.op === "csForget") return respond(true);
      if (body.op === "csThread") return respond({ messages: [{ id: 5, role: "human", text: "我是小王" }, { id: 4, role: "bot", text: "請稍候" }, { id: 3, role: "user", text: "你好" }], paused: true });
      return new Response(JSON.stringify({ success: false, message: "unknown " + body.op }));
    }
    if (url.startsWith("https://ai.example/")) return new Response(JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "有的" }] } }] }));
    return realFetch(input, init);
  }) as typeof fetch;
});

const VID = "visitor-1234567890abcd";
const req = (url: string, init: RequestInit & { origin?: string } = {}) => new Request(url, { ...init, headers: { ...(init.origin ? { origin: init.origin } : {}), "content-type": "application/json" } });
const post = (text: unknown, visitorId: unknown = VID, origin = "https://www.cetus.tw") =>
  chat.POST(req("https://bot.example/api/widget/chat", { method: "POST", origin, body: JSON.stringify({ visitorId, text }) }));

test("視窗設定：公開資訊、不含金鑰；未啟用 → 403；沒帶來源網站不擋", async () => {
  const r = await widgetConfig.GET(req("https://bot.example/api/widget/config", { origin: "https://www.cetus.tw" }));
  assert.equal(r.status, 200);
  const j = (await r.json()) as Record<string, unknown>;
  assert.equal(j.title, "線上客服");
  assert.deepEqual(j.welcome, { text: "您好", choices: ["產品介紹"] });
  assert.equal("allowedOrigins" in j, false);
  assert.equal(r.headers.get("access-control-allow-origin"), "https://www.cetus.tw");
  assert.equal((await widgetConfig.GET(req("https://bot.example/api/widget/config"))).status, 200);
  widgetOn = false;
  resetWidgetCache();
  assert.equal((await widgetConfig.GET(req("https://bot.example/api/widget/config"))).status, 403);
});

test("來源網站白名單：不在名單 → 403；名單為空 → 任何網站；預檢請求", async () => {
  assert.equal((await post("你好", VID, "https://evil.example")).status, 403);
  assert.equal((await post("你好", VID, "https://CETUS.tw")).status, 200, "不分大小寫");
  origins = "";
  resetWidgetCache();
  const open = await post("你好", VID, "https://anything.example");
  assert.equal(open.status, 200);
  assert.equal(open.headers.get("access-control-allow-origin"), "*");
  const pre = await chat.OPTIONS(req("https://bot.example/api/widget/chat", { method: "OPTIONS", origin: "https://www.cetus.tw" }));
  assert.equal(pre.status, 204);
});

test("送出訊息：驗證訪客編號 / 空白 / 太長；成功回覆與暫停狀態", async () => {
  assert.equal((await post("你好", "x")).status, 400);
  assert.equal((await post("   ")).status, 400);
  assert.equal((await post("字".repeat(1001))).status, 400);
  const r = await post("有光源嗎？");
  assert.equal(r.status, 200);
  const j = (await r.json()) as { reply: { text: string; choices: string[] }; paused: boolean };
  assert.equal(j.reply.text, "有的");
  assert.equal(j.paused, false);
  assert.ok(gasOps.includes("csStart") && gasOps.includes("csRemember"));
});

test("還原對話 / 輪詢：回傳角色對應（user / human / assistant）與暫停狀態", async () => {
  const r = await messages.GET(req(`https://bot.example/api/widget/messages?visitorId=${VID}&after=2`, { origin: "https://www.cetus.tw" }));
  const j = (await r.json()) as { messages: { id: number; role: string }[]; paused: boolean };
  assert.deepEqual(j.messages.map((m) => m.role), ["human", "assistant", "user"]);
  assert.equal(j.paused, true);
  assert.equal((await messages.GET(req("https://bot.example/api/widget/messages?visitorId=bad"))).status, 400);
});

test("後台測試聊天：權杖正確才能用；重新開始；測試不通知同仁", async () => {
  const ts = String(Date.now());
  const sig = createHmac("sha256", "aoi-test-secret").update(ts).digest("hex");
  const testId = "T" + "a".repeat(32);
  const send = (body: Record<string, unknown>) => testApi.POST(req("https://bot.example/api/test", { method: "POST", body: JSON.stringify(body) }));
  assert.equal((await send({ ts, sig: "0".repeat(64), testId, text: "你好" })).status, 403);
  assert.equal((await send({ ts, sig, testId: "bad", text: "你好" })).status, 400);
  assert.equal((await send({ ts, sig, testId, text: "" })).status, 400);
  const r = await send({ ts, sig, testId, text: "有光源嗎？" });
  assert.equal(r.status, 200);
  assert.equal(((await r.json()) as { reply: string }).reply, "有的");
  assert.ok(!gasOps.includes("csHandoff"));
  assert.equal((await send({ ts, sig, testId, reset: true })).status, 200);
  assert.ok(gasOps.includes("csForget"));
});
