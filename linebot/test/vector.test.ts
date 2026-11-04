import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { beforeEach, test } from "node:test";
import { embed } from "../src/ai.js";
import { resetKnowledgeCache, runSearch, csConverse } from "../src/cs.js";
import type { CsInfo, EmbedConfig, KnowledgeChunk } from "../src/gas.js";
import { KnowledgeIndex, searchKnowledge, formatHits } from "../src/rag.js";

process.env.CS_LINE_CHANNEL_SECRET = "cs-secret";
process.env.CS_LINE_CHANNEL_ACCESS_TOKEN = "cs-token";
process.env.GAS_URL = "https://script.example/exec";
process.env.BOT_SECRET = "aoi-test-secret";

// 向量用 4 維：[光源, 相機, 鏡頭, 其他]；問題的向量由 embedQuery 依關鍵字決定
const unit = (v: number[]) => {
  const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0));
  return v.map((x) => x / n);
};
const CHUNKS: KnowledgeChunk[] = [
  { id: "k1", source: "常見問題", title: "光源怎麼選", text: "環形光源適合表面檢測。", category: "光源", topic: "環形光源", notes: "客人問打光、照明時使用" },
  { id: "k2", source: "常見問題", title: "同軸光源", text: "同軸光源適合反光表面。", category: "光源", topic: "同軸光源", notes: "反光、鏡面" },
  { id: "k3", source: "常見問題", title: "相機怎麼選", text: "依檢測範圍與精度選相機。", category: "相機", topic: "選型", notes: "解析度、像素" },
  { id: "k4", source: "文件", title: "公司簡介", text: "鑫堡專營機器視覺。", category: "公司", topic: "簡介", notes: "" },
  { id: "p1", source: "產品", title: "ACA2440", text: "產品型號：ACA2440\n解析度：2448X2048" }, // 產品：沒有向量
];
const VEC = new Map<string, number[]>([
  ["k1", unit([1, 0, 0, 0.1])],
  ["k2", unit([0.8, 0, 0, 0.6])],
  ["k3", unit([0, 1, 0, 0.1])],
  ["k4", unit([0, 0, 0, 1])],
]);
const embedQuery = async (q: string) => unit(/光|照明|打光/.test(q) ? [1, 0, 0, 0.1] : /相機|像素/.test(q) ? [0, 1, 0, 0.1] : /公司/.test(q) ? [0, 0, 0, 1] : [0, 0, 1, 0]);
const index = () => new KnowledgeIndex(CHUNKS, VEC);
const ids = (r: { hits: { chunk: { id: string } }[] }) => r.hits.map((h) => h.chunk.id);
const cfg = (over = {}) => ({ mode: "vector" as const, threshold: 0.6, topK: 6, ...over });

test("直接向量：依相似度排序，低於閥值的不採用", async () => {
  const r = await searchKnowledge(index(), "照明要怎麼打", cfg(), embedQuery);
  assert.equal(r.mode, "vector");
  assert.equal(ids(r)[0], "k1");
  assert.ok(ids(r).includes("k2"), "k2 相似度 0.8 以上");
  assert.ok(!ids(r).includes("k3") && !ids(r).includes("k4"));
  const strict = await searchKnowledge(index(), "照明要怎麼打", cfg({ threshold: 0.99 }), embedQuery);
  assert.deepEqual(ids(strict).filter((x) => x.startsWith("k")), ["k1"], "閥值提高只剩最像的");
  const none = await searchKnowledge(index(), "完全無關的火星語", cfg({ threshold: 0.9 }), embedQuery);
  assert.equal(ids(none).filter((x) => x.startsWith("k")).length, 0, "沒有達到閥值的段落");
});

test("向量檢索會用關鍵字補上沒有向量的段落（產品、公司資訊）", async () => {
  const r = await searchKnowledge(index(), "ACA2440 解析度", cfg(), embedQuery);
  assert.ok(ids(r).includes("p1"));
  assert.match(r.trace.join("\n"), /沒有向量的段落/);
});

test("先中繼再向量：先用大分類 / 主題 / 備註縮小範圍，再在範圍內做向量", async () => {
  // 問題的向量偏相機，但文字講「光源 打光」→ 中繼資料先把範圍縮在「光源」，向量只在 k1、k2 裡比
  const r = await searchKnowledge(index(), "光源 打光", cfg({ mode: "meta_vector", threshold: 0.0 }), async () => unit([0, 1, 0, 0.1]));
  const ks = ids(r).filter((x) => x.startsWith("k"));
  assert.ok(ks.every((x) => x === "k1" || x === "k2"), "只在光源範圍內：" + ks.join());
  assert.match(r.trace.join("\n"), /大分類 光源/);
  // 中繼完全沒命中 → 在全部段落做向量
  const all = await searchKnowledge(index(), "火星語", cfg({ mode: "meta_vector", threshold: 0.0 }), embedQuery);
  assert.match(all.trace.join("\n"), /全部段落/);
});

test("只用中繼資料：不需要向量，用大分類 / 主題 / 備註 / 標題比對；沒命中退回內容關鍵字", async () => {
  const r = await searchKnowledge(index(), "反光 鏡面", cfg({ mode: "meta" }));
  assert.equal(r.mode, "meta");
  assert.equal(ids(r)[0], "k2", "備註裡的「反光、鏡面」命中");
  const noVec = await searchKnowledge(new KnowledgeIndex(CHUNKS), "打光 照明", cfg({ mode: "meta" }));
  assert.equal(ids(noVec)[0], "k1", "沒有向量也能用");
  const fallback = await searchKnowledge(index(), "環形光源適合", cfg({ mode: "meta" }));
  assert.ok(ids(fallback).includes("k1"));
});

test("兩種都做：中繼與向量兩邊都命中才採用，沒有交集就找不到", async () => {
  const r = await searchKnowledge(index(), "光源 打光", cfg({ mode: "both", threshold: 0.5 }), async () => unit([1, 0, 0, 0.1]));
  assert.equal(ids(r)[0], "k1");
  assert.match(r.trace.join("\n"), /兩邊一致/);
  // 向量說像「相機」，文字卻問光源 → 沒有交集
  const none = await searchKnowledge(index(), "光源 打光", cfg({ mode: "both", threshold: 0.9 }), async () => unit([0, 1, 0, 0.1]));
  assert.equal(ids(none).filter((x) => x.startsWith("k")).length, 0);
  assert.match(none.trace.join("\n"), /一致 0 段/);
});

test("向量用不了時自動退回關鍵字（沒有向量 / 沒有 embedding 模型 / 轉向量失敗），不會讓客人沒回覆", async () => {
  const a = await searchKnowledge(new KnowledgeIndex(CHUNKS), "環形光源", cfg(), embedQuery);
  assert.equal(a.mode, "keyword");
  assert.match(a.trace[0], /還沒有向量/);
  assert.ok(ids(a).includes("k1"));
  const b = await searchKnowledge(index(), "環形光源", cfg());
  assert.equal(b.mode, "keyword");
  assert.match(b.trace[0], /沒有可用的 embedding/);
  const c = await searchKnowledge(index(), "環形光源", cfg(), async () => {
    throw new Error("boom");
  });
  assert.equal(c.mode, "keyword");
  assert.match(c.trace[0], /轉向量失敗/);
});

test("給 AI 的參考資料帶大分類 / 主題與備註", () => {
  const text = formatHits(index().search("環形光源", 1));
  assert.match(text, /光源 \/ 環形光源/);
  assert.match(text, /備註：客人問打光/);
});

test("embedding 請求格式：Gemini / OpenAI，向量正規化，錯誤訊息遮掉金鑰", async () => {
  const real = globalThis.fetch;
  const seen: { url: string; body: Record<string, any>; headers: Record<string, string> }[] = [];
  let fail = false;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body));
    seen.push({ url, body, headers: init?.headers as Record<string, string> });
    if (fail) return new Response(JSON.stringify({ error: { message: "bad key KEY-SECRET" } }), { status: 401 });
    const v = [3, 4];
    if (/batchEmbedContents/.test(url)) return new Response(JSON.stringify({ embeddings: body.requests.map(() => ({ values: v })) }));
    return new Response(JSON.stringify({ data: body.input.map(() => ({ embedding: v })) }));
  }) as typeof fetch;
  try {
    const g: EmbedConfig = { provider: "gemini", apiKey: "KEY-SECRET", endpoint: "https://gem.example/v1beta", model: "gemini-embedding-001", dim: 256, key: "gemini:gemini-embedding-001:256" };
    const out = await embed(g, ["問題一", "問題二"], "query");
    assert.equal(out.length, 2);
    assert.ok(Math.abs(out[0][0] - 0.6) < 1e-9 && Math.abs(out[0][1] - 0.8) < 1e-9, "已正規化");
    assert.equal(seen[0].url, "https://gem.example/v1beta/models/gemini-embedding-001:batchEmbedContents");
    assert.equal(seen[0].headers["x-goog-api-key"], "KEY-SECRET");
    assert.equal(seen[0].body.requests[0].taskType, "RETRIEVAL_QUERY");
    assert.equal(seen[0].body.requests[0].outputDimensionality, 256);
    const o: EmbedConfig = { provider: "openai", apiKey: "KEY-SECRET", endpoint: "https://oa.example/v1", model: "text-embedding-3-small", dim: 256, key: "x" };
    await embed(o, ["a"], "doc");
    assert.equal(seen[1].url, "https://oa.example/v1/embeddings");
    assert.equal(seen[1].body.dimensions, 256);
    assert.equal(seen[1].headers.Authorization, "Bearer KEY-SECRET");
    fail = true;
    await assert.rejects(() => embed(g, ["x"]), (e: Error) => /401/.test(e.message) && !e.message.includes("KEY-SECRET") && e.message.includes("••••"));
  } finally {
    globalThis.fetch = real;
  }
});

test("整合：客服對話依搜尋設定檢索，向量 / 閥值 / 設定都來自管理系統", async () => {
  resetKnowledgeCache();
  const real = globalThis.fetch;
  const aiPrompts: string[] = [];
  const baseInfo = (over: Partial<CsInfo> = {}): CsInfo => ({
    enabled: true, channel: "line", appName: "鑫堡", brand: "鑫堡", welcome: "", prompt: "", handoffText: "", replyDelay: 0,
    ai: { source: "bot", provider: "gemini", apiKey: "KEY", model: "g", endpoint: "https://ai.example/v1beta" },
    aiFallback: [], history: [], known: true, paused: false, replyWhen: "always", inHours: null, hoursText: "", offText: "",
    handoffWords: ["真人"], topics: [], topicText: "", unsure: "ask", style: { tone: "friendly", address: "您", emoji: "some", maxLines: 5 }, buttons: [], buttonsAlways: false,
    search: { mode: "vector", threshold: 0.6, topK: 3 },
    embedAi: { provider: "gemini", apiKey: "EKEY", endpoint: "https://emb.example/v1beta", model: "gemini-embedding-001", dim: 4, key: "gemini:gemini-embedding-001:4" },
    ...over,
  });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (url === process.env.GAS_URL) {
      const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data }));
      if (body.op === "csStart") return ok(baseInfo());
      if (body.op === "csKnowledge") return ok(CHUNKS);
      if (body.op === "csVectors") return ok({ model: "m", items: [...VEC].map(([id, v]) => ({ id, v })), total: VEC.size, next: VEC.size });
      if (body.op === "csRemember") return ok(2);
      return new Response(JSON.stringify({ success: false, message: "unknown " + body.op }));
    }
    if (url.startsWith("https://emb.example/")) return new Response(JSON.stringify({ embeddings: body.requests.map(() => ({ values: [1, 0, 0, 0.1] })) }));
    if (url.startsWith("https://ai.example/")) {
      aiPrompts.push(JSON.stringify(body.systemInstruction));
      return new Response(JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "環形光源適合表面檢測。" }] } }] }));
    }
    return real(input, init);
  }) as typeof fetch;
  try {
    const r = await csConverse("U" + "a".repeat(32), "我想問光源怎麼打", { channel: "line" });
    assert.equal(r.reply, "環形光源適合表面檢測。");
    assert.match(aiPrompts[0], /環形光源適合表面檢測/, "向量命中的段落放進參考資料");
    assert.match(aiPrompts[0], /備註：客人問打光/);
    assert.doesNotMatch(aiPrompts[0], /依檢測範圍與精度選相機/, "不相關的相機段落低於閥值，不放進去");
  } finally {
    globalThis.fetch = real;
    resetKnowledgeCache();
  }
});

test("搜尋測試端點：權杖正確才能用，四種流程各回傳找到的段落與分數", async () => {
  resetKnowledgeCache();
  const { POST } = await import("../api/search.js");
  const real = globalThis.fetch;
  const info: Partial<CsInfo> = { search: { mode: "meta_vector", threshold: 0.6, topK: 4 }, embedAi: { provider: "gemini", apiKey: "EKEY", endpoint: "https://emb.example/v1beta", model: "m", dim: 4, key: "k" } };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (url === process.env.GAS_URL) {
      const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data }));
      if (body.op === "csStart") return ok(info);
      if (body.op === "csKnowledge") return ok(CHUNKS);
      if (body.op === "csVectors") return ok({ model: "m", items: [...VEC].map(([id, v]) => ({ id, v })), total: VEC.size, next: VEC.size });
    }
    if (url.startsWith("https://emb.example/")) return new Response(JSON.stringify({ embeddings: body.requests.map(() => ({ values: [1, 0, 0, 0.1] })) }));
    return real(input, init);
  }) as typeof fetch;
  try {
    const ts = String(Date.now());
    const sig = createHmac("sha256", process.env.BOT_SECRET!).update(ts).digest("hex");
    const post = (extra: Record<string, unknown>) => POST(new Request("https://x/api/search", { method: "POST", body: JSON.stringify({ ts, sig, testId: "T" + "d".repeat(32), q: "光源 打光", ...extra }) }));
    const ok = await post({});
    assert.equal(ok.status, 200);
    const j = (await ok.json()) as any;
    assert.equal(j.current, "meta_vector");
    assert.equal(j.withVectors, 4);
    assert.equal(j.hasEmbedding, true);
    assert.deepEqual(Object.keys(j.modes), ["vector", "meta_vector", "meta", "both"]);
    assert.equal(j.modes.vector.hits[0].id, "k1");
    assert.ok(j.modes.vector.hits[0].score > 0.9);
    assert.equal(j.modes.meta.hits[0].by, "meta");
    const strict = (await (await post({ threshold: 0.999 })).json()) as any;
    assert.equal(strict.threshold, 0.999);
    assert.ok(strict.modes.vector.hits.filter((h: any) => h.id.startsWith("k")).length <= 1);
    const bad = await POST(new Request("https://x/api/search", { method: "POST", body: JSON.stringify({ ts, sig: "0".repeat(64), testId: "T" + "d".repeat(32), q: "x" }) }));
    assert.equal(bad.status, 403);
    assert.equal((await post({ q: "" })).status, 400);
  } finally {
    globalThis.fetch = real;
    resetKnowledgeCache();
  }
});

test("runSearch：沒有設定時用預設（直接向量、閥值 0.6）", async () => {
  const r = await runSearch(index(), "照明", undefined, null);
  assert.equal(r.mode, "keyword", "沒有 embedding 模型就用關鍵字");
});
