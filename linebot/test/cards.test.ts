import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { generate } from "../src/ai.js";
import { cardIntakeReply, parseCards } from "../src/cards.js";
import type { StaffInfo } from "../src/gas.js";
import { downloadImage } from "../src/line.js";
import type { LineEvent } from "../src/line.js";
import { handleStaffEvent, resetStaffKnowledgeCache, staffConverse } from "../src/staff.js";

process.env.LINE_CHANNEL_SECRET = "staff-secret";
process.env.LINE_CHANNEL_ACCESS_TOKEN = "staff-token";
process.env.GAS_URL = "https://script.example/exec";
process.env.BOT_SECRET = "aoi-test-secret";

// JPEG 檔頭 + 一些內容
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("fake-card-photo")]);

interface State {
  info: Partial<StaffInfo>;
  gas: { op: string; [k: string]: any }[];
  line: { kind: string; body: any }[];
  /** 依輪次回傳 AI 的回應 */
  ai: (round: number, body: any) => Record<string, unknown>;
  aiCalls: any[];
  round: number;
  lineContent: () => Response;
}
let state: State;
const realFetch = globalThis.fetch;
const gemText = (t: string) => ({ candidates: [{ content: { role: "model", parts: [{ text: t }] } }] });
const gemTool = (name: string, args: Record<string, unknown>) => ({ candidates: [{ content: { role: "model", parts: [{ functionCall: { name, args } }] } }] });

const baseInfo = (): StaffInfo => ({
  allowed: true, status: "已開通", problem: "", isNew: false, name: "小明", appName: "鑫堡", channel: "line", replyDelay: 0,
  texts: { welcome: "hi", pending: "wait" }, userId: "U", linked: true, username: "ed",
  blocks: { products: "edit", cases: "edit", customers: "edit", files: "edit", copy: "none", bot: "none" },
  prompt: "", ai: { source: "bot", provider: "gemini", apiKey: "KEY", model: "vision", endpoint: "https://ai.example/v1beta" },
  aiFallback: [], history: [], writable: ["addMemo", "saveCards", "discardCards", "addCustomer"], pending: "", today: "2026-11-04",
  memory: { enabled: false, maxItems: 30, confirm: true, canShared: false, categories: [], items: [] }, ...state.info,
});

beforeEach(() => {
  resetStaffKnowledgeCache();
  state = { info: {}, gas: [], line: [], aiCalls: [], round: 0, ai: () => gemText("ok"), lineContent: () => new Response(JPEG, { headers: { "content-type": "image/jpeg" } }) };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (url === process.env.GAS_URL) {
      state.gas.push(body);
      const ok = (d: unknown) => new Response(JSON.stringify({ success: true, data: d }));
      if (body.op === "start") return ok(baseInfo());
      if (body.op === "cards") return ok({ added: (body.cards as any[]).map((c, i) => ({ id: 10 + i, ...c })), pending: 3, batchNote: "台北展" });
      if (body.op === "call") return ok({ total: 1, items: [{ id: 10, name: "王小明", company: "甲公司", status: "pending" }] });
      if (body.op === "stage") return ok({ token: "abcdef0123", summary: "📇 名片整批存入" });
      if (["remember", "audit", "cancel"].includes(body.op)) return ok(true);
      return new Response(JSON.stringify({ success: false, message: "unknown " + body.op }));
    }
    if (url.startsWith("https://api-data.line.me/")) return state.lineContent();
    if (url.includes("api.line.me")) {
      if (/\/message\/(reply|push)/.test(url)) state.line.push({ kind: url.includes("/reply") ? "reply" : "push", body });
      return new Response("{}");
    }
    if (url.includes("/v1beta/")) {
      state.aiCalls.push(body);
      return new Response(JSON.stringify(state.ai(state.round++, body)));
    }
    return realFetch(input, init);
  }) as typeof fetch;
});

const imageEvent = (id = "m1"): LineEvent => ({ type: "message", replyToken: "rt", source: { type: "user", userId: "U" + "a".repeat(32) }, message: { id, type: "image" } }) as LineEvent;
const cardsJson = (cards: unknown[]) => gemText("```json\n" + JSON.stringify({ cards }) + "\n```");

test("parseCards：包在 ```json 裡也能解析、空白名片丟掉、Email 轉小寫、數字轉字串、格式錯回傳 null", () => {
  const cards = parseCards('好的\n```json\n{"cards":[{"name":" 王小明 ","company":"甲公司","email":"MING@A.COM","phone":912345678},{"name":"","company":""},"junk",{"note":"x"}]}\n```');
  assert.equal(cards?.length, 1);
  assert.equal(cards?.[0].name, "王小明");
  assert.equal(cards?.[0].email, "ming@a.com");
  assert.equal(cards?.[0].phone, "912345678");
  assert.equal(parseCards("沒有 JSON"), null);
  assert.equal(parseCards('{"cards":"x"}'), null);
  assert.deepEqual(parseCards('{"cards":[]}'), []);
  assert.equal(parseCards(JSON.stringify({ cards: [{ name: "a", note: "x".repeat(999) }] }))?.[0].note?.length, 200, "備註限制 200 字");
});

test("圖片輸入：三家 AI 的請求格式", async () => {
  const image = { mime: "image/jpeg", data: "QUJD" };
  let seen: any;
  globalThis.fetch = (async (_u: RequestInfo | URL, init?: RequestInit) => {
    seen = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }], content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", choices: [{ message: { content: "ok" } }] }));
  }) as typeof fetch;
  const ai = (provider: any) => ({ source: "bot" as const, provider, apiKey: "K", model: "m", endpoint: "https://x.example/v1" });
  await generate({ ai: ai("gemini"), system: "s", turns: [{ isUser: true, text: "看圖", images: [image] }] });
  assert.deepEqual(seen.contents[0].parts[1], { inlineData: { mimeType: "image/jpeg", data: "QUJD" } });
  await generate({ ai: ai("claude"), system: "s", turns: [{ isUser: true, text: "看圖", images: [image] }] });
  assert.deepEqual(seen.messages[0].content[0], { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "QUJD" } });
  assert.equal(seen.messages[0].content[1].text, "看圖");
  await generate({ ai: ai("openai"), system: "s", turns: [{ isUser: true, text: "看圖", images: [image] }] });
  assert.equal(seen.messages[1].content[1].image_url.url, "data:image/jpeg;base64,QUJD");
  // 沒有圖片時維持原本的純文字格式
  await generate({ ai: ai("openai"), system: "s", turns: [{ isUser: true, text: "你好" }] });
  assert.equal(seen.messages[1].content, "你好");
});

test("downloadImage：用檔頭判斷格式、太大 / 不是圖片 / 下載失敗會丟錯誤", async () => {
  const ch = { name: "staff", secret: "s", token: "tok" } as any;
  const got = await downloadImage(ch, "m1");
  assert.equal(got.mime, "image/jpeg");
  assert.equal(Buffer.from(got.data, "base64").length, JPEG.length);
  state.lineContent = () => new Response("not an image", { headers: { "content-type": "text/plain" } });
  await assert.rejects(downloadImage(ch, "m2"), /不是圖片/);
  state.lineContent = () => new Response("", { status: 404 });
  await assert.rejects(downloadImage(ch, "m3"), /下載失敗/);
  state.lineContent = () => new Response(Buffer.alloc(11 * 1024 * 1024, 0xff), { headers: { "content-type": "image/jpeg" } });
  await assert.rejects(downloadImage(ch, "m4"), /太大/);
});

test("LINE 傳名片照片 → 視覺模型讀出欄位 → 放進收件匣 → 回覆摘要與快速回覆按鈕", async () => {
  state.ai = () => cardsJson([{ name: "王小明", title: "業務經理", company: "甲公司", phone: "0912-345-678", email: "ming@a.com" }]);
  await handleStaffEvent(imageEvent());
  // 圖片有送給 AI
  const parts = state.aiCalls[0].contents[0].parts;
  assert.ok(parts.some((p: any) => p.inlineData?.mimeType === "image/jpeg" && p.inlineData.data === JPEG.toString("base64")), "照片 base64 送給模型");
  // 收件匣
  const op = state.gas.find((g) => g.op === "cards")!;
  assert.equal(op.cards[0].company, "甲公司");
  assert.equal(op.cards[0].phone, "0912-345-678");
  // 回覆
  const reply = state.line.at(-1)!.body.messages[0];
  assert.match(reply.text, /讀到 1 張名片/);
  assert.match(reply.text, /王小明 業務經理｜甲公司/);
  assert.match(reply.text, /收件匣待整理共 3 張（註記：台北展）/);
  assert.deepEqual(reply.quickReply.items.map((i: any) => i.action.label), ["📇 整理名片", "📥 看收件匣"]);
  // 對話記憶有記下
  assert.ok(state.gas.some((g) => g.op === "remember"));
});

test("一張照片有好幾張名片 → 全部收下；多張照片各自處理", async () => {
  state.ai = () => cardsJson([{ name: "甲", company: "A公司" }, { name: "乙", company: "B公司" }]);
  await handleStaffEvent(imageEvent("m1"));
  await handleStaffEvent(imageEvent("m2"));
  assert.equal(state.gas.filter((g) => g.op === "cards").length, 2);
  assert.match(state.line[0].body.messages[0].text, /讀到 2 張名片/);
  assert.equal(state.line.length, 2, "每張照片各回覆一次");
});

test("照片裡沒有名片 / 讀不出來 → 請重拍，不會寫入收件匣", async () => {
  state.ai = () => cardsJson([]);
  await handleStaffEvent(imageEvent());
  assert.match(state.line[0].body.messages[0].text, /看不出名片/);
  assert.equal(state.gas.filter((g) => g.op === "cards").length, 0);
  state.ai = () => gemText("我看不太懂");
  await handleStaffEvent(imageEvent());
  assert.match(state.line[1].body.messages[0].text, /看不懂/);
});

test("模型不支援圖片 / AI 出錯 → 告訴同事要換支援圖片輸入的模型", async () => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === process.env.GAS_URL) return new Response(JSON.stringify({ success: true, data: baseInfo() }));
    if (url.startsWith("https://api-data.line.me/")) return state.lineContent();
    if (url.includes("api.line.me")) {
      if (url.includes("/message/reply")) state.line.push({ kind: "reply", body: JSON.parse(String(init?.body)) });
      return new Response("{}");
    }
    return new Response('{"error":{"message":"image input is not supported"}}', { status: 400 });
  }) as typeof fetch;
  await handleStaffEvent(imageEvent());
  assert.match(state.line[0].body.messages[0].text, /支援圖片輸入的模型/);
});

test("沒有客戶編輯權限 / 沒開放名片登入 / 未開通 → 不讀照片、不呼叫 AI", async () => {
  state.info = { blocks: { products: "edit", cases: "edit", customers: "view", files: "none", copy: "none", bot: "none" } };
  await handleStaffEvent(imageEvent());
  assert.match(state.line[0].body.messages[0].text, /沒有「客戶與追蹤」的編輯權限/);
  state.info = { writable: ["addMemo"] };
  await handleStaffEvent(imageEvent());
  assert.match(state.line[1].body.messages[0].text, /沒有開放名片登入/);
  state.info = { allowed: false, status: "待開通" };
  await handleStaffEvent(imageEvent());
  assert.equal(state.aiCalls.length, 0);
  assert.equal(state.gas.filter((g) => g.op === "cards").length, 0);
});

test("說「整理名片」→ AI 先看收件匣 → 一次整批提出存入（修正與分類帶進去）", async () => {
  state.ai = (round) =>
    round === 0 ? gemTool("list_cards", {})
      : round === 1 ? gemTool("save_cards", { ids: [10], fixes: [{ id: 10, company: "甲股份有限公司", tax_id: "12345678" }], category: "機構合作設備商" })
        : gemText("已整理好，請確認");
  const r = await staffConverse("U" + "a".repeat(32), { text: "整理名片" }, { channel: "line" });
  assert.equal(state.gas.find((g) => g.op === "call" && g.call === "cards")!.params.status, undefined);
  const staged = state.gas.find((g) => g.op === "stage")!;
  assert.equal(staged.ops.length, 1);
  assert.equal(staged.ops[0].action, "saveCards");
  assert.deepEqual(staged.ops[0].data, { ids: [10], overrides: { "10": { company: "甲股份有限公司", taxId: "12345678" } }, category: "機構合作設備商" });
  assert.ok(r.pending, "要同事按確認才寫入");
  assert.match(r.reply, /名片整批存入/);
});

test("提示詞：有客戶編輯權限才有名片登入的說明和工具；沒有權限就沒有", async () => {
  state.ai = () => gemText("ok");
  await staffConverse("U" + "a".repeat(32), { text: "你好" }, { channel: "line" });
  let sys = JSON.stringify(state.aiCalls[0].systemInstruction);
  assert.match(sys, /名片登入/);
  let names = (state.aiCalls[0].tools?.[0]?.functionDeclarations ?? []).map((t: any) => t.name);
  assert.ok(names.includes("list_cards") && names.includes("save_cards") && names.includes("discard_cards"));
  state.info = { blocks: { products: "none", cases: "none", customers: "view", files: "none", copy: "none", bot: "none" }, writable: [] };
  await staffConverse("U" + "a".repeat(32), { text: "你好" }, { channel: "line" });
  sys = JSON.stringify(state.aiCalls[1].systemInstruction);
  assert.doesNotMatch(sys, /名片登入/);
  names = (state.aiCalls[1].tools?.[0]?.functionDeclarations ?? []).map((t: any) => t.name);
  assert.ok(names.includes("list_cards") && !names.includes("save_cards"), "唯讀可看收件匣，不能存入");
});

test("cardIntakeReply：重複、缺公司、已是客戶都會提醒", () => {
  const t = cardIntakeReply([
    { id: 1, name: "王", company: "甲公司", existingCustomer: "甲股份有限公司" },
    { id: 2, name: "李", duplicateOf: 1 },
  ], 2);
  assert.match(t, /甲股份有限公司 已是客戶/);
  assert.match(t, /跟收件匣 #1 重複/);
  assert.match(t, /沒有公司名稱，存入前要補/);
});
