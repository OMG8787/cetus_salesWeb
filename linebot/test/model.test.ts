import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { csConverse, resetKnowledgeCache } from "../src/cs.js";
import type { CsInfo } from "../src/gas.js";
import { extractModels, modelHitsFromCatalog, modelHitsFromIndex, normModel } from "../src/model.js";
import { KnowledgeIndex } from "../src/rag.js";

process.env.GAS_URL = "https://script.example/exec";
process.env.BOT_SECRET = "aoi-test-secret";

test("extractModels：抓出像型號的字串，不抓一般英文字與規格單位", () => {
  assert.deepEqual(extractModels("puA2500-14um規格是?"), ["puA2500-14um"]);
  assert.deepEqual(extractModels("CVG-34M-387GT 跟 MV-CA050-10GM 差在哪"), ["CVG-34M-387GT", "MV-CA050-10GM"]);
  assert.deepEqual(extractModels("USB3 相機 GigE 5MP 30萬畫素 12um"), []);
  assert.deepEqual(extractModels("你好"), []);
  assert.equal(normModel("puA2500-14um"), "pua250014um");
});

test("modelHitsFromIndex：產品段落依型號比對，完全相同優先", () => {
  const index = new KnowledgeIndex([
    { id: "p1", source: "產品", title: "puA2500-14um", text: "產品型號：puA2500-14um" },
    { id: "p2", source: "產品", title: "puA2500-14uc", text: "產品型號：puA2500-14uc" },
    { id: "k1", source: "常見問題", title: "puA2500-14um 保固", text: "保固一年" },
  ]);
  const hits = modelHitsFromIndex(index, ["puA2500-14um"]);
  assert.equal(hits[0].chunk.id, "p1");
  assert.ok(!hits.some((h) => h.chunk.id === "k1"), "只比對產品段落");
  assert.equal(modelHitsFromIndex(index, ["puA2500"]).length, 2, "只打前半段型號也找得到");
});

test("modelHitsFromCatalog：選型型錄的相機規格", () => {
  const cat = { cameras: [{ name: "puA2500-14um", brand: "Basler", resW: 2590, resH: 1942, pixelW: 2.2, pixelH: 2.2, fps: 14, iface: "USB3.0", mp: 5.03, effPx: 503 }], fa: [], tele: [] };
  const hits = modelHitsFromCatalog(cat, ["puA2500-14um"]);
  assert.equal(hits.length, 1);
  assert.match(hits[0].chunk.text, /Basler/);
  assert.match(hits[0].chunk.text, /2590 × 1942/);
  assert.match(hits[0].chunk.text, /有效像素：503 萬/);
  assert.doesNotMatch(hits[0].chunk.text, /價|供應商/);
});

// ---- 整合：產品來源沒開（知識庫沒有產品），只靠選型型錄，問型號也要答得出規格 ----
const realFetch = globalThis.fetch;
let aiBodies: string[] = [];
const text = (t: string) => ({ candidates: [{ content: { role: "model", parts: [{ text: t }] } }] });
const info = (): CsInfo => ({
  enabled: true, channel: "web", appName: "鑫堡", brand: "鑫堡", welcome: "", prompt: "", handoffText: "", replyDelay: 0,
  ai: { source: "bot", provider: "gemini", apiKey: "KEY", model: "main", endpoint: "https://ai.example/v1beta" },
  aiFallback: [], history: [], known: true, paused: false, replyWhen: "always", inHours: null, hoursText: "", offText: "",
  handoffWords: ["真人"], topics: [], topicText: "", unsure: "ask", style: { tone: "friendly", address: "您", emoji: "some", maxLines: 5 },
  buttons: [], buttonsAlways: false, kbVer: "v1", handoffButton: true, contactAfter: 0, sendImages: true, turnCount: 0, leadState: "",
});

beforeEach(() => {
  resetKnowledgeCache();
  aiBodies = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (url === process.env.GAS_URL) {
      const ok = (d: unknown) => new Response(JSON.stringify({ success: true, data: d }));
      if (body.op === "csStart") return ok(info());
      if (body.op === "csKnowledge") return ok([{ id: "k1", source: "常見問題", title: "保固", text: "保固一年" }]);
      if (body.op === "csVectors") return ok({ model: "", items: [], total: 0, next: 0 });
      if (body.op === "csCalcCatalog") return ok({ cameras: [{ name: "puA2500-14um", brand: "Basler", resW: 2590, resH: 1942, pixelW: 2.2, pixelH: 2.2, fps: 14, iface: "USB3.0", mp: 5.03, effPx: 503 }], fa: [], tele: [] });
      return ok(true);
    }
    if (url.includes("/v1beta/")) {
      aiBodies.push(String(init?.body));
      return new Response(JSON.stringify(text("puA2500-14um 是 Basler 的 USB3.0 相機。")));
    }
    return realFetch(input, init);
  }) as typeof fetch;
});

test("客人問型號：直接用型號比對選型型錄，規格交給 AI 當參考資料", async () => {
  const r = await csConverse("V" + "e".repeat(32), "puA2500-14um規格是?", { channel: "web" });
  assert.match(r.reply, /Basler/);
  const prompt = aiBodies[0];
  assert.match(prompt, /2590 × 1942/, "參考資料裡有這個型號的解析度");
  assert.match(prompt, /型號比對/);
});

test("沒有型號的一般問題不會去比對", async () => {
  await csConverse("V" + "f".repeat(32), "保固多久", { channel: "web" });
  assert.doesNotMatch(aiBodies[0], /型號比對/);
});
