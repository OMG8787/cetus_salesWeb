import { waitUntil } from "@vercel/functions";
import { gas } from "../../src/gas.js";
import { checkOrigin, corsHeaders, enforceRequestLimit, errorResponse, loadWidget, VISITOR_ID, visitorUserId, WidgetError } from "../../src/web.js";

/**
 * 視窗用：GET /api/widget/messages?visitorId=…&after=…
 *   ・不帶 after → 還原最近的對話（重新整理頁面、換頁後）
 *   ・帶 after=最後一則的編號 → 只回新訊息（小編接手後輪詢）
 */
export async function OPTIONS(request: Request): Promise<Response> {
  try {
    return new Response(null, { status: 204, headers: corsHeaders(checkOrigin(request, await loadWidget())) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: Request): Promise<Response> {
  let cors: Record<string, string> = {};
  try {
    const widget = await loadWidget();
    cors = corsHeaders(checkOrigin(request, widget));
    enforceRequestLimit(request, widget);
    const url = new URL(request.url);
    const visitorId = url.searchParams.get("visitorId") ?? "";
    if (!VISITOR_ID.test(visitorId)) throw new WidgetError("訪客編號不正確", 400);
    const after = Number(url.searchParams.get("after")) || 0;
    const thread = await gas.csThread(visitorUserId(visitorId), after);
    return Response.json(
      {
        messages: thread.messages.map((m) => ({ id: m.id, role: m.role === "user" ? "user" : m.role === "human" ? "human" : "assistant", text: m.text })),
        paused: thread.paused,
      },
      { headers: cors },
    );
  } catch (error) {
    return errorResponse(error, cors);
  }
}

/** 網站流量回報（併在這支，Vercel 免費版 API 上限 12 支）：POST { visitorId, visitId, page, ref }，頁面載入一次、之後每 30 秒一次 */
export async function POST(request: Request): Promise<Response> {
  let cors: Record<string, string> = {};
  try {
    const widget = await loadWidget();
    cors = corsHeaders(checkOrigin(request, widget));
    enforceRequestLimit(request, widget);
    const body = (await request.json().catch(() => null)) as { visitorId?: unknown; visitId?: unknown; page?: unknown; ref?: unknown } | null;
    const visitorId = typeof body?.visitorId === "string" ? body.visitorId : "";
    const visitId = typeof body?.visitId === "string" ? body.visitId : "";
    if (!VISITOR_ID.test(visitorId) || !/^[A-Za-z0-9_-]{8,40}$/.test(visitId)) throw new WidgetError("參數不正確", 400);
    const page = typeof body?.page === "string" ? body.page.slice(0, 200) : "";
    const ref = typeof body?.ref === "string" ? body.ref.slice(0, 200) : "";
    waitUntil(gas.csVisit(visitorUserId(visitorId), visitId, page, ref).catch((err) => console.warn("記錄流量失敗", (err as Error).message)));
    return Response.json({ ok: true }, { headers: cors });
  } catch (error) {
    return errorResponse(error, cors);
  }
}
