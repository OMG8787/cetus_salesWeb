import { gas } from "../../src/gas.js";
import { checkOrigin, corsHeaders, errorResponse, loadWidget, VISITOR_ID, visitorUserId, WidgetError } from "../../src/web.js";

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
