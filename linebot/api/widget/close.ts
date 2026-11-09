import { csEnd } from "../../src/cs.js";
import { checkOrigin, corsHeaders, enforceRequestLimit, errorResponse, loadWidget, VISITOR_ID, visitorUserId, WidgetError } from "../../src/web.js";

/** 訪客關閉了網站客服視窗：POST /api/widget/close { visitorId }。這一段對話結束，下次開視窗是全新的一段（之前的紀錄在後台用顏色區分）。 */
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
    const body = (await request.json().catch(() => null)) as { visitorId?: unknown } | null;
    const visitorId = typeof body?.visitorId === "string" ? body.visitorId : "";
    if (!VISITOR_ID.test(visitorId)) throw new WidgetError("訪客編號不正確", 400);
    const ended = await csEnd(visitorUserId(visitorId));
    return Response.json({ ended }, { headers: cors });
  } catch (error) {
    return errorResponse(error, cors);
  }
}
