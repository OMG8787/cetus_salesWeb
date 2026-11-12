import { waitUntil } from "@vercel/functions";
import { gas } from "../../src/gas.js";
import { checkOrigin, corsHeaders, enforceRequestLimit, errorResponse, loadWidget, VISITOR_ID, visitorUserId, WidgetError } from "../../src/web.js";

/** 網站流量回報：POST /api/widget/visit { visitorId, visitId, page, ref }（頁面載入一次，之後每 30 秒一次） */
export async function OPTIONS(request: Request): Promise<Response> {
  try {
    return new Response(null, { status: 204, headers: corsHeaders(checkOrigin(request, await loadWidget())) });
  } catch (error) {
    return errorResponse(error);
  }
}

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
