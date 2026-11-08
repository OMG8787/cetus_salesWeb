import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { csConverse, handleCsEvent, resetKnowledgeCache } from "../src/cs.js";
import type { CsInfo, KnowledgeChunk } from "../src/gas.js";
import type { LineEvent } from "../src/line.js";
import { textMessages } from "../src/line.js";
import { imageUrl } from "../src/img.js";

process.env.CS_LINE_CHANNEL_SECRET = "cs-secret";
process.env.CS_LINE_CHANNEL_ACCESS_TOKEN = "cs-token";
process.env.GAS_URL = "https://script.example/exec";
process.env.BOT_SECRET = "aoi-test-secret";
process.env.BOT_URL = "https://bot.example.app";

const UID = "U" + "a".repeat(32);
const V = "V" + "b".repeat(32);
const DRIVE = "1AbCdEfGhIjKlMnOpQrStUvWxYz";
const CHUNKS: KnowledgeChunk[] = [
  { id: "k1", source: "文件", title: "系統架構", text: "我們的系統分成前端、後端與資料庫三層。", images: [{ id: DRIVE, caption: "系統架構圖" }] },
  { id: "k2", source: "常見問題", title: "保固", text: "保固一年" },
];

interface State {
  info: Partial<CsInfo>;
  gas: { op: string; [k: string]: unknown }[];
  answer: (round: number) => Record<string, unknown>;
  line: { kind: string; body: any }[];
  mainRound: number;
  leadError: string;
}
let state: State;
const realFetch = globalThis.fetch;
const text = (t: string) => ({ candidates: [{ content: { role: "model", parts: [{ text: t }] } }] });
const toolCall = (name: string, args: Record<string, unknown>) => ({ candidates: [{ content: { role: "model", parts: [{ functionCall: { name, args } }] } }] });
const baseInfo = (): CsInfo => ({
  enabled: true, channel: "line", appName: "鑫堡", brand: "鑫堡", welcome: "", prompt: "", handoffText: "", replyDelay: 0,
  ai: { source: "bot", provider: "gemini", apiKey: "KEY", model: "main", endpoint: "https://ai.example/v1beta" },
  aiFallback: [], history: [], known: true, paused: false, replyWhen: "always", inHours: null, hoursText: "", offText: "",
  handoffWords: ["真人", "小編"], topics: [], topicText: "", unsure: "ask", style: { tone: "friendly", address: "您", emoji: "some", maxLines: 5 },
  buttons: [], buttonsAlways: false, kbVer: "v1", handoffButton: true, contactAfter: 3, sendImages: true, turnCount: 0, leadState: "", ...state.info,
});

beforeEach(() => {
  resetKnowledgeCache();
  state = { info: {}, gas: [], answer: () => text("好的"), line: [], mainRound: 0, leadError: "" };
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
      if (body.op === "csLead") return state.leadError ? new Response(JSON.stringify({ success: false, message: state.leadError })) : ok(true);
      return new Response(JSON.stringify({ success: false, message: "unknown " + body.op }));
    }
    if (url.includes("api.line.me")) {
      if (/\/message\/(reply|push)/.test(url)) state.line.push({ kind: url.includes("/reply") ? "reply" : "push", body });
      return new Response("{}");
    }
    if (url.includes("/v1beta/")) return new Response(JSON.stringify(state.answer(state.mainRound++)));
    return realFetch(input, init);
  }) as typeof fetch;
});

const gasOps = (op: string) => state.gas.filter((g) => g.op === op);
const lineEvent = (t: string): LineEvent => ({ type: "message", replyToken: "rt", source: { type: "user", userId: UID }, message: { type: "text", id: "1", text: t } }) as LineEvent;

test("圖片網址：經過機器人的 /api/img 代理，檔案代號格式不對就不給", () => {
  assert.equal(imageUrl(DRIVE), `https://bot.example.app/api/img?id=${DRIVE}&w=1280`);
  assert.equal(imageUrl("../bad"), "");
  assert.match(imageUrl(DRIVE, 99999), /w=2000$/);
});

test("LINE 訊息：文字後面接圖片（縮圖用小尺寸），快速回覆掛在最後一則", () => {
  const u = imageUrl(DRIVE);
  const m = textMessages("如下圖", ["🙋 轉真人"], [u]);
  assert.equal(m.length, 2);
  assert.equal(m[1].type, "image");
  assert.equal(m[1].originalContentUrl, u);
  assert.match(String(m[1].previewImageUrl), /w=480/);
  assert.ok(m[1].quickReply, "快速回覆在最後一則（圖片）");
  assert.equal(textMessages("x", [], [u, u, u, u, u, u]).length, 5, "LINE 一次最多 5 則");
});

test("客人問架構 → AI 用 send_image 附圖：LINE 收到文字 + 圖片", async () => {
  state.answer = (round) => (round === 0 ? toolCall("send_image", { ref: "k1#0" }) : text("這是我們的系統架構，三層設計。"));
  await handleCsEvent(lineEvent("系統架構長怎樣"));
  const msgs = state.line[0].body.messages;
  assert.equal(msgs[0].type, "text");
  assert.equal(msgs[1].type, "image");
  assert.match(msgs[1].originalContentUrl, /\/api\/img\?id=1AbCdEf/);
  const remembered = gasOps("csRemember")[0];
  assert.equal((remembered.images as any[])[0].caption, "系統架構圖", "對話紀錄記下附了哪張圖");
});

test("send_image 只能傳這次找到的資料附的圖；亂編的編號會被拒絕，不會有圖", async () => {
  state.answer = (round) => (round === 0 ? toolCall("send_image", { ref: "k9#0" }) : text("沒有圖喔"));
  const r = await csConverse(UID, "架構圖", { channel: "line" });
  assert.equal(r.images.length, 0);
});

test("後台關閉「附圖」→ 不提供 send_image，結果沒有圖片", async () => {
  state.info = { sendImages: false };
  state.answer = (round) => (round === 0 ? toolCall("send_image", { ref: "k1#0" }) : text("文字說明"));
  const r = await csConverse(UID, "系統架構", { channel: "line" });
  assert.equal(r.images.length, 0);
});

test("每則 LINE 回覆下方都有「轉真人」按鈕；關閉就沒有", async () => {
  await handleCsEvent(lineEvent("保固多久"));
  const labels = (state.line[0].body.messages.at(-1).quickReply.items as any[]).map((i) => i.action.label);
  assert.deepEqual(labels, ["🙋 轉真人"]);
  state.line = [];
  state.info = { handoffButton: false };
  await handleCsEvent(lineEvent("保固多久"));
  assert.equal(state.line[0].body.messages.at(-1).quickReply, undefined);
});

test("按「轉真人」按鈕（網站）：直接轉小編，對話紀錄記成按鈕上的字", async () => {
  const r = await csConverse(V, "ignored", { channel: "web", human: true });
  assert.equal(r.handoff, "");
  assert.equal(gasOps("csHandoff").length, 1);
  assert.equal(gasOps("csHandoff")[0].text, "🙋 轉真人");
  assert.equal(r.handoffButton, false, "轉真人後不再附按鈕");
  assert.match(r.reply, /專人/);
});

test("LINE 點「🙋 轉真人」快速回覆（文字含「真人」）→ 轉小編", async () => {
  await handleCsEvent(lineEvent("🙋 轉真人"));
  assert.equal(gasOps("csHandoff").length, 1);
});

test("聊到第 3 段：網站要跳出留資料表單；LINE 在回覆後面請客人留資料", async () => {
  state.info = { turnCount: 2 };
  const web = await csConverse(V, "保固多久", { channel: "web" });
  assert.equal(web.askContact, true);
  assert.doesNotMatch(web.reply, /方便留下您的姓名/);
  assert.equal(gasOps("csRemember")[0].askedContact, true, "記下已經問過，不會每則都問");
  state.gas = [];
  const line = await csConverse(UID, "保固多久", { channel: "line" });
  assert.equal(line.askContact, true);
  assert.match(line.reply, /方便留下您的姓名、公司和電話/);
});

test("還沒到段數 / 問過了 / 留過了 / 後台設 0 → 不問", async () => {
  let n = 0;
  const visitor = () => "V" + (++n).toString(16).repeat(32); // 每次換新訪客：一定讀最新狀態
  for (const info of [{ turnCount: 1 }, { turnCount: 5, leadState: "asked" as const }, { turnCount: 5, leadState: "done" as const }, { turnCount: 9, contactAfter: 0 }]) {
    state.info = info;
    const r = await csConverse(visitor(), "保固多久", { channel: "web" });
    assert.equal(r.askContact, false, JSON.stringify(info));
  }
  state.info = { turnCount: 2, contactAfter: 5 };
  assert.equal((await csConverse(visitor(), "保固多久", { channel: "web" })).askContact, false, "後台改成 5 段 → 第 3 段不問");
  state.info = { turnCount: 4, contactAfter: 5 };
  assert.equal((await csConverse(visitor(), "保固多久", { channel: "web" })).askContact, true, "第 5 段才問");
});

test("客人在聊天中主動留資料 → AI 呼叫 save_contact 記下來，這次就不再追問", async () => {
  state.info = { turnCount: 2 };
  state.answer = (round) => (round === 0 ? toolCall("save_contact", { name: "王小明", company: "甲公司", phone: "0912345678" }) : text("好的，已經幫您記下了，謝謝！"));
  const r = await csConverse(UID, "我是甲公司的王小明，電話 0912345678", { channel: "line" });
  const lead = gasOps("csLead")[0];
  assert.equal(lead.name, "王小明");
  assert.equal(lead.phone, "0912345678");
  assert.equal(lead.source, "ai");
  assert.equal(r.askContact, false);
  assert.doesNotMatch(r.reply, /方便留下您的姓名/);
});

test("save_contact 被拒絕（例如沒給電話）→ 把原因還給 AI，沒有記成功就會繼續問", async () => {
  state.info = { turnCount: 2 };
  state.leadError = "請留下電話或 Email，專人才能聯繫您";
  state.answer = (round) => (round === 0 ? toolCall("save_contact", { name: "王小明" }) : text("再請您留個電話或 Email 好嗎？"));
  const r = await csConverse(V, "我是王小明", { channel: "web" });
  assert.equal(r.askContact, true);
});

test("客服的選型型錄：看起來是選型問題就先在背景載入；沒有型錄也不影響回答", async () => {
  await csConverse(UID, "視野 100x80 精度 10um 要用哪台相機", { channel: "line" });
  assert.ok(gasOps("csCalcCatalog").length >= 1, "背景載入型錄");
  state.gas = [];
  await csConverse(UID, "保固多久", { channel: "line" });
  assert.equal(gasOps("csCalcCatalog").length, 0, "一般問題不載入型錄");
});
