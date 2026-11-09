import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import * as chat from "../api/widget/chat.js";
import * as lead from "../api/widget/lead.js";
import * as messages from "../api/widget/messages.js";
import { resetKnowledgeCache } from "../src/cs.js";
import { clientIp, DEFAULT_GUARD, guardCheck, leadLimited, requestLimited, resetGuard, type GuardCfg } from "../src/guard.js";
import { resetWidgetCache } from "../src/web.js";

process.env.GAS_URL = "https://script.example/exec";
process.env.BOT_SECRET = "aoi-test-secret";

let guard: Partial<GuardCfg> = {};
let origins = "https://www.cetus.tw";
let gasLimited: "" | "ip" | "global" | "visitor" = "";
let aiCalls = 0;
const gasOps: string[] = [];
const realFetch = globalThis.fetch;
const cfg = () => ({ ...DEFAULT_GUARD, ...guard });

beforeEach(() => {
  guard = {};
  origins = "https://www.cetus.tw";
  gasLimited = "";
  aiCalls = 0;
  gasOps.length = 0;
  resetWidgetCache();
  resetKnowledgeCache();
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (url === process.env.GAS_URL) {
      gasOps.push(String(body.op));
      const respond = (data: unknown) => new Response(JSON.stringify({ success: true, data }));
      if (body.op === "csWidget") return respond({ enabled: true, title: "線上客服", subtitle: "", color: "#2c5aa0", position: "right", autoOpen: false, allowedOrigins: origins, guard: cfg(), welcome: "您好", buttons: [], replyDelay: 0 });
      if (body.op === "csStart") return respond({ enabled: true, channel: "web", brand: "鑫堡", appName: "鑫堡", welcome: "", prompt: "", handoffText: "", replyDelay: 0, ai: { source: "bot", provider: "gemini", apiKey: "K", model: "m", endpoint: "https://ai.example/v1beta" }, history: [], handoffWords: ["真人"], topics: [], rateLimited: gasLimited !== "", limitReason: gasLimited, guard: cfg() });
      if (body.op === "csKnowledge") return respond([{ id: "k1", source: "常見問題", title: "光源", text: "問：有光源嗎\n答：有" }]);
      if (body.op === "csRemember") return respond(2);
      if (body.op === "csLead") return respond(true);
      if (body.op === "csThread") return respond({ messages: [], paused: false });
      return respond(true);
    }
    if (url.startsWith("https://ai.example/")) {
      aiCalls++;
      return new Response(JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "有的" }] } }] }));
    }
    return realFetch(input, init);
  }) as typeof fetch;
});

const vid = (n: number) => `visitor-${String(n).padStart(16, "0")}`;
const headers = (ip: string) => ({ origin: "https://www.cetus.tw", "x-real-ip": ip, "content-type": "application/json" });
const say = (visitor: string, ip: string, text = "有光源嗎？") =>
  chat.POST(new Request("https://bot.example/api/widget/chat", { method: "POST", headers: headers(ip), body: JSON.stringify({ visitorId: visitor, text }) }));
const replyOf = async (r: Response) => ((await r.json()) as { reply: { text: string } | null }).reply?.text ?? "";

// ---- 計數器本身 ----
test("guardCheck：訪客 / IP / 全站各自的上限，0 = 不限；時間窗過了就重算", () => {
  const g: GuardCfg = { ...DEFAULT_GUARD, visitorPerMin: 2, ipPerMin: 3, ipPerHour: 0, globalPerHour: 0, globalPerDay: 0 };
  const t = 1_000_000;
  assert.equal(guardCheck({ uid: "Va", ip: "1.1.1.1" }, g, t), null);
  assert.equal(guardCheck({ uid: "Va", ip: "1.1.1.1" }, g, t), null);
  assert.equal(guardCheck({ uid: "Va", ip: "1.1.1.1" }, g, t), "visitor");
  assert.equal(guardCheck({ uid: "Vb", ip: "1.1.1.1" }, g, t), "ip", "換訪客編號也算同一個 IP（前面已經算了 3 次）");
  assert.equal(guardCheck({ uid: "Vc", ip: "2.2.2.2" }, g, t), null, "別的 IP 不受影響");
  assert.equal(guardCheck({ uid: "Va", ip: "1.1.1.1" }, g, t + 61_000), null, "過了一分鐘重算");
  resetGuard();
  const open: GuardCfg = { ...DEFAULT_GUARD, visitorPerMin: 120, ipPerMin: 0, ipPerHour: 0, globalPerHour: 0, globalPerDay: 0 };
  for (let i = 0; i < 100; i++) assert.equal(guardCheck({ uid: `V${i}`, ip: "3.3.3.3" }, open, t), null);
});

test("guardCheck：全站每小時 / 每天上限；被 IP 擋下的不吃全站額度", () => {
  const g: GuardCfg = { ...DEFAULT_GUARD, visitorPerMin: 50, ipPerMin: 1, ipPerHour: 0, globalPerHour: 3, globalPerDay: 0 };
  const t = 5_000_000;
  assert.equal(guardCheck({ uid: "V1", ip: "9.9.9.9" }, g, t), null);
  for (let i = 0; i < 20; i++) assert.equal(guardCheck({ uid: `Vx${i}`, ip: "9.9.9.9" }, g, t), "ip"); // 狂灌的人被 IP 擋下
  assert.equal(guardCheck({ uid: "V2", ip: "8.8.8.1" }, g, t), null);
  assert.equal(guardCheck({ uid: "V3", ip: "8.8.8.2" }, g, t), null, "全站才用了 3 次");
  assert.equal(guardCheck({ uid: "V4", ip: "8.8.8.3" }, g, t), "global");
  resetGuard();
  const day: GuardCfg = { ...DEFAULT_GUARD, ipPerMin: 0, ipPerHour: 0, globalPerHour: 0, globalPerDay: 2 };
  assert.equal(guardCheck({ uid: "V1" }, day, t), null);
  assert.equal(guardCheck({ uid: "V2" }, day, t), null);
  assert.equal(guardCheck({ uid: "V3" }, day, t), "global");
  assert.equal(guardCheck({ uid: "V3" }, day, t + 86_400_001), null, "隔天重算");
});

test("視窗請求與留資料的 IP 頻率；沒有 IP 或設 0 = 不限", () => {
  const g: GuardCfg = { ...DEFAULT_GUARD, reqPerMin: 2, leadPerHour: 1 };
  assert.equal(requestLimited("1.2.3.4", g, 100), false);
  assert.equal(requestLimited("1.2.3.4", g, 100), false);
  assert.equal(requestLimited("1.2.3.4", g, 100), true);
  assert.equal(requestLimited("", g, 100), false);
  assert.equal(requestLimited("1.2.3.4", { ...g, reqPerMin: 0 }, 100), false);
  assert.equal(leadLimited("5.5.5.5", g, 100), false);
  assert.equal(leadLimited("5.5.5.5", g, 100), true);
});

test("clientIp：只認 Vercel 帶的標頭，格式不對就當沒有", () => {
  const ip = (h: Record<string, string>) => clientIp(new Request("https://x.example", { headers: h }));
  assert.equal(ip({ "x-vercel-forwarded-for": "1.2.3.4" }), "1.2.3.4");
  assert.equal(ip({ "x-real-ip": "2001:db8::1" }), "2001:db8::1");
  assert.equal(ip({ "x-forwarded-for": "5.6.7.8, 10.0.0.1" }), "5.6.7.8");
  assert.equal(ip({ "x-real-ip": "<script>" }), "");
  assert.equal(ip({}), "");
});

// ---- 整條路徑：被擋下的請求不會呼叫 AI，也不會去打管理系統 ----
test("換訪客編號狂灌：同一個 IP 超過每分鐘上限 → 回「人比較多」，不呼叫 AI、不打管理系統", async () => {
  guard = { ipPerMin: 3 };
  const texts: string[] = [];
  for (let i = 1; i <= 8; i++) texts.push(await replyOf(await say(vid(i), "7.7.7.7")));
  assert.equal(aiCalls, 3, "只有前 3 則會呼叫 AI");
  assert.equal(gasOps.filter((o) => o === "csStart").length, 3, "被擋下的不會去打管理系統");
  assert.equal(texts.slice(0, 3).every((t) => t === "有的"), true);
  assert.equal(texts.slice(3).every((t) => t === DEFAULT_GUARD.overText), true);
  assert.equal(await replyOf(await say(vid(99), "6.6.6.6")), "有的", "別的 IP 照常回覆");
});

test("同一個訪客傳太快（熱路徑）：超過上限的訊息不會先花掉 AI 費用", async () => {
  guard = { visitorPerMin: 2, ipPerMin: 0, ipPerHour: 0 };
  const texts: string[] = [];
  for (let i = 0; i < 5; i++) texts.push(await replyOf(await say(vid(1), "7.7.7.7")));
  assert.equal(aiCalls, 2);
  assert.equal(texts[2], "訊息傳得太快了，請稍等一下再試 🙏");
});

test("全站上限：不同 IP、不同訪客合計超過就擋；設定值來自後台（0 = 不限）", async () => {
  guard = { globalPerHour: 2, ipPerMin: 0, ipPerHour: 0, overText: "客滿了" };
  const texts: string[] = [];
  for (let i = 1; i <= 4; i++) texts.push(await replyOf(await say(vid(i), `10.0.0.${i}`)));
  assert.deepEqual(texts, ["有的", "有的", "客滿了", "客滿了"]);
  assert.equal(aiCalls, 2);
  resetKnowledgeCache();
  resetWidgetCache();
  guard = { globalPerHour: 0, globalPerDay: 0, ipPerMin: 0, ipPerHour: 0 };
  for (let i = 10; i < 30; i++) assert.equal(await replyOf(await say(vid(i), `10.0.1.${i}`)), "有的");
});

test("管理系統那邊判定超過（跨執行個體的計數）→ 照樣擋，回後台設定的話", async () => {
  guard = { overText: "請稍後" };
  gasLimited = "ip";
  assert.equal(await replyOf(await say(vid(1), "4.4.4.4")), "請稍後");
  assert.equal(aiCalls, 0);
  resetKnowledgeCache();
  gasLimited = "visitor";
  assert.equal(await replyOf(await say(vid(2), "4.4.4.5")), "訊息傳得太快了，請稍等一下再試 🙏");
});

test("視窗請求（查看新訊息）超過每分鐘上限 → 429，不打管理系統", async () => {
  guard = { reqPerMin: 2 };
  const get = () => messages.GET(new Request(`https://bot.example/api/widget/messages?visitorId=${vid(1)}`, { headers: { origin: "https://www.cetus.tw", "x-real-ip": "3.3.3.3" } }));
  assert.equal((await get()).status, 200);
  assert.equal((await get()).status, 200);
  const before = gasOps.length;
  const r = await get();
  assert.equal(r.status, 429);
  assert.equal(gasOps.length, before);
});

test("留聯繫資料：換訪客編號也繞不過同一個 IP 的次數上限", async () => {
  guard = { leadPerHour: 2 };
  const send = (n: number) => lead.POST(new Request("https://bot.example/api/widget/lead", { method: "POST", headers: headers("2.2.2.2"), body: JSON.stringify({ visitorId: vid(n), phone: "0912345678" }) }));
  assert.equal((await send(1)).status, 200);
  assert.equal((await send(2)).status, 200);
  assert.equal((await send(3)).status, 429);
});

test("沒帶來源的請求：白名單有設且「沒帶來源一律拒絕」開著 → 403；關掉就放行", async () => {
  const noOrigin = () => chat.POST(new Request("https://bot.example/api/widget/chat", { method: "POST", headers: { "x-real-ip": "1.1.1.1", "content-type": "application/json" }, body: JSON.stringify({ visitorId: vid(1), text: "你好" }) }));
  assert.equal((await noOrigin()).status, 403);
  guard = { requireOrigin: false };
  resetWidgetCache();
  assert.equal((await noOrigin()).status, 200);
  origins = "";
  guard = { requireOrigin: true };
  resetWidgetCache();
  assert.equal((await noOrigin()).status, 200, "白名單留空 = 不限制");
});
