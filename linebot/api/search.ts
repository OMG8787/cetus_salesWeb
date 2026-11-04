import { DEFAULT_SEARCH, SEARCH_MODE_LABEL, type SearchMode } from "../src/rag.js";
import { knowledge, runSearch } from "../src/cs.js";
import { gas } from "../src/gas.js";
import { corsHeaders, errorResponse, MAX_TEXT, verifyTestToken, WidgetError } from "../src/web.js";

/**
 * 網站「BOT 設定 → 知識庫 → 搜尋測試」：POST /api/search { ts, sig, testId, q, threshold?, topK? }
 * 權杖跟測試聊天一樣（管理系統用客服金鑰簽，5 分鐘有效）。四種搜尋流程各跑一次，回傳每一種找到的段落、分數與過程，方便調整閥值。
 */
const MODES: SearchMode[] = ["vector", "meta_vector", "meta", "both"];

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: corsHeaders("*") });
}

export async function POST(request: Request): Promise<Response> {
  const cors = corsHeaders("*");
  try {
    const body = (await request.json().catch(() => null)) as { ts?: string; sig?: string; testId?: string; q?: string; threshold?: number; topK?: number } | null;
    if (!body || !verifyTestToken(String(body.ts ?? ""), String(body.sig ?? ""))) throw new WidgetError("測試權杖無效或已過期，請重新整理後台頁面", 403);
    if (!/^T[0-9a-f]{32}$/.test(String(body.testId ?? ""))) throw new WidgetError("測試編號不正確", 400);
    const q = String(body.q ?? "").trim();
    if (!q) throw new WidgetError("請輸入要搜尋的問題", 400);
    if (q.length > MAX_TEXT) throw new WidgetError(`問題太長了（上限 ${MAX_TEXT} 字）`, 400);

    const info = await gas.csStart(String(body.testId));
    const index = await knowledge(true); // 測試一律讀最新的知識庫與向量
    const base = { ...DEFAULT_SEARCH, ...info.search };
    if (typeof body.threshold === "number" && body.threshold >= 0 && body.threshold <= 1) base.threshold = body.threshold;
    if (typeof body.topK === "number" && body.topK >= 1 && body.topK <= 15) base.topK = Math.floor(body.topK);

    const modes: Record<string, unknown> = {};
    for (const mode of MODES) {
      const r = await runSearch(index, q, { ...base, mode }, info.embedAi);
      modes[mode] = {
        label: SEARCH_MODE_LABEL[mode],
        used: r.mode,
        trace: r.trace,
        hits: r.hits.map((h) => ({ id: h.chunk.id, title: h.chunk.title, source: h.chunk.source, category: h.chunk.category ?? "", topic: h.chunk.topic ?? "", by: h.by, score: Math.round(h.score * 1000) / 1000, preview: h.chunk.text.slice(0, 120) })),
      };
    }
    return Response.json({ current: base.mode, threshold: base.threshold, topK: base.topK, chunks: index.chunks.length, withVectors: index.vectors.size, hasEmbedding: !!info.embedAi, modes }, { headers: cors });
  } catch (error) {
    return errorResponse(error, cors);
  }
}
