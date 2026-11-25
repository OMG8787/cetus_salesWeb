import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { csConverse, gateNeeded, parseLeadText, resetKnowledgeCache } from "../src/cs.js";
import type { CsGate, CsInfo } from "../src/gas.js";

// 轉真人前先留資料（BOT 設定 → 客服設定 → 客人要找真人）

process.env.CS_LINE_CHANNEL_SECRET = "cs-secret";
process.env.CS_LINE_CHANNEL_ACCESS_TOKEN = "cs-token";
process.env.GAS_URL = "https://script.example/exec";
process.env.BOT_SECRET = "aoi-test-secret";

const GATE: CsGate = { mode: "always", need: true, name: true, company: false, text: "WEB請先填表", lineText: "LINE請直接回覆" };
let info: Partial<CsInfo>;
let ops: { op: string; [k: string]: unknown }[];
let leadError = "";
const realFetch = globalThis.fetch;
let n = 0;
const visitor = () => "V" + (++n).toString(16).padStart(2, "0").repeat(16); // 每次新訪客：一定讀最新狀態（不走記憶體熱路徑）
const lineUser = () => "U" + (++n).toString(16).padStart(2, "0").repeat(16);

const baseInfo = (): CsInfo => ({
  enabled: true, channel: "line", appName: "鑫堡", brand: "鑫堡", welcome: "", prompt: "", handoffText: "已通知專人", replyDelay: 0,
  ai: { source: "bot", provider: "gemini", apiKey: "KEY", model: "main", endpoint: "https://ai.example/v1beta" },
  aiFallback: [], history: [], known: true, paused: false, replyWhen: "always", inHours: null, hoursText: "", offText: "",
  handoffWords: ["真人", "小編"], topics: [{ name: "價格", words: ["報價"] }], topicText: "", unsure: "ask", style: { tone: "friendly", address: "您", emoji: "some", maxLines: 5 },
  buttons: [], buttonsAlways: false, kbVer: "v1", handoffButton: true, contactAfter: 0, sendImages: true, turnCount: 0, leadState: "", gate: GATE, ...info,
}) as CsInfo;

beforeEach(() => {
  resetKnowledgeCache();
  info = {};
  ops = [];
  leadError = "";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (url === process.env.GAS_URL) {
      ops.push(body);
      const ok = (d: unknown) => new Response(JSON.stringify({ success: true, data: d }));
      if (body.op === "csStart") return ok(baseInfo());
      if (body.op === "csKnowledge") return ok([{ id: "k1", source: "常見問題", title: "保固", text: "保固一年" }]);
      if (body.op === "csVectors") return ok({ model: "", items: [], total: 0, next: 0 });
      if (body.op === "csCalcCatalog") return ok({ cameras: [], fa: [], tele: [] });
      if (body.op === "csRemember") return ok(2);
      if (body.op === "csHandoff") return ok(true);
      if (body.op === "csLead") return leadError ? new Response(JSON.stringify({ success: false, message: leadError })) : ok(true);
      return new Response(JSON.stringify({ success: false, message: "unknown " + body.op }));
    }
    if (url.includes("/v1beta/")) return new Response(JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "保固一年喔" }] } }] }));
    return realFetch(input, init);
  }) as typeof fetch;
});

const opsOf = (op: string) => ops.filter((o) => o.op === op);

test("什麼時候要擋：always 每次；first 只有第一句（或已經在等留資料）；off 或已留過不擋；舊版管理系統沒帶設定不擋", () => {
  const i = (x: Partial<CsInfo>) => ({ ...x }) as CsInfo;
  assert.equal(gateNeeded(i({ gate: GATE, turnCount: 5 })), true);
  assert.equal(gateNeeded(i({ gate: { ...GATE, mode: "first" }, turnCount: 0 })), true);
  assert.equal(gateNeeded(i({ gate: { ...GATE, mode: "first" }, turnCount: 3 })), false, "聊過幾句才找真人：前面的對話就有需求，不擋");
  assert.equal(gateNeeded(i({ gate: { ...GATE, mode: "first" }, turnCount: 1, leadState: "gate" })), true, "第一句被擋、還沒留，再喊真人仍要先留");
  assert.equal(gateNeeded(i({ gate: { ...GATE, mode: "off" }, turnCount: 0 })), false);
  assert.equal(gateNeeded(i({ gate: GATE, leadState: "done" })), false);
  assert.equal(gateNeeded(i({ turnCount: 0 })), false);
});

test("從客人打的一段話抓電話 / Email，剩下的字當需求", () => {
  const a = parseLeadText("想詢問 PCB 外觀檢測 王小明 0912-345-678");
  assert.equal(a.phone, "0912-345-678");
  assert.ok(a.rest.includes("PCB外觀檢測"));
  const b = parseLeadText("Email：ming@abc.com.tw，想問報價");
  assert.equal(b.email, "ming@abc.com.tw");
  assert.equal(b.phone, "");
  assert.equal(parseLeadText("我要找真人").phone + parseLeadText("我要找真人").email, "");
  assert.equal(parseLeadText("+886 2 2299 5111").phone, "+886222995111");
});

test("網站：第一句就要真人 → 不通知、不暫停，回覆說明並要求跳出表單（必填欄位照設定）", async () => {
  const r = await csConverse(visitor(), "我要找真人", { channel: "web" });
  assert.equal(r.reply, "WEB請先填表");
  assert.deepEqual(r.gate, { need: true, name: true, company: false });
  assert.equal(r.paused, false);
  assert.equal(r.handoff, null);
  assert.equal(opsOf("csHandoff").length, 0, "還沒留資料不通知同事");
  assert.equal(opsOf("csRemember")[0].gate, true, "記下正在等客人留資料");
});

test("網站：按轉真人按鈕、問到指定問題（價格）也一樣要先留", async () => {
  const a = await csConverse(visitor(), "", { channel: "web", human: true });
  assert.ok(a.gate);
  const b = await csConverse(visitor(), "請給我報價", { channel: "web" });
  assert.ok(b.gate);
  assert.equal(opsOf("csHandoff").length, 0);
});

test("網站：表單送出後（管理系統記為已留）再按轉真人 → 真的轉真人", async () => {
  info = { leadState: "done" };
  const r = await csConverse(visitor(), "", { channel: "web", human: true });
  assert.equal(r.gate, undefined);
  assert.equal(r.paused, true);
  assert.equal(opsOf("csHandoff").length, 1);
});

test("LINE：先請客人直接回覆；回覆裡有電話 + 需求 → 記進聯繫名單並轉真人", async () => {
  const uid = lineUser();
  const r1 = await csConverse(uid, "小編", { channel: "line" });
  assert.equal(r1.reply, "LINE請直接回覆");
  assert.equal(opsOf("csHandoff").length, 0);
  info = { leadState: "gate", turnCount: 1 };
  const r2 = await csConverse(lineUser(), "想詢問 PCB 外觀檢測設備，王小明 0912345678", { channel: "line" });
  const lead = opsOf("csLead")[0];
  assert.equal(lead.phone, "0912345678");
  assert.equal(lead.source, "chat");
  assert.match(String(lead.note), /PCB 外觀檢測/);
  assert.equal(opsOf("csHandoff").length, 1);
  assert.equal(r2.paused, true);
  assert.equal(r2.reply, "已通知專人", "已留過資料 → 轉真人回覆不再請他留");
});

test("LINE：只給電話沒說需求 → 再請他說明需求，還不轉", async () => {
  info = { leadState: "gate", turnCount: 1 };
  const r = await csConverse(lineUser(), "0912345678", { channel: "line" });
  assert.match(r.reply, /需求/);
  assert.equal(opsOf("csLead").length, 0);
  assert.equal(opsOf("csHandoff").length, 0);
});

test("LINE：管理系統拒收（例如電話不完整）→ 把原因告訴客人，不轉", async () => {
  info = { leadState: "gate", turnCount: 1 };
  leadError = "電話號碼看起來不完整";
  const r = await csConverse(lineUser(), "想問 AOI 設備報價 0912345678", { channel: "line" });
  assert.match(r.reply, /電話號碼看起來不完整/);
  assert.equal(opsOf("csHandoff").length, 0);
});

test("等留資料中，客人改問一般問題 → 照常回答（不會卡住）；再喊真人仍要先留", async () => {
  info = { leadState: "gate", turnCount: 1 };
  const r = await csConverse(lineUser(), "保固多久", { channel: "line" });
  assert.equal(r.reply, "保固一年喔");
  const r2 = await csConverse(lineUser(), "真人", { channel: "line" });
  assert.equal(r2.reply, "LINE請直接回覆");
  assert.equal(opsOf("csHandoff").length, 0);
});

test("後台設成不擋 / 舊版管理系統沒有這組設定 → 維持原本：直接轉真人", async () => {
  info = { gate: { ...GATE, mode: "off" } };
  assert.equal((await csConverse(visitor(), "真人", { channel: "web" })).paused, true);
  info = { gate: undefined };
  assert.equal((await csConverse(visitor(), "真人", { channel: "web" })).paused, true);
  assert.equal(opsOf("csHandoff").length, 2);
});
