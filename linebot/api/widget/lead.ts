import { gas } from "../../src/gas.js";
import { DEFAULT_GUARD, leadLimited } from "../../src/guard.js";
import { checkOrigin, corsHeaders, enforceRequestLimit, errorResponse, loadWidget, VISITOR_ID, visitorUserId, WidgetError } from "../../src/web.js";

/** 網站客服視窗的「留下聯繫資料」表單：POST /api/widget/lead { visitorId, name, company, phone, email, note } */
export async function OPTIONS(request: Request): Promise<Response> {
  try {
    return new Response(null, { status: 204, headers: corsHeaders(checkOrigin(request, await loadWidget())) });
  } catch (error) {
    return errorResponse(error);
  }
}

const field = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function POST(request: Request): Promise<Response> {
  let cors: Record<string, string> = {};
  try {
    const widget = await loadWidget();
    cors = corsHeaders(checkOrigin(request, widget));
    const ip = enforceRequestLimit(request, widget);
    // 換訪客編號也繞不過：同一個 IP 每小時最多留幾次（管理系統那邊另有一份跨執行個體的計數）
    if (leadLimited(ip, widget.guard ?? DEFAULT_GUARD)) throw new WidgetError("送出太頻繁了，請稍後再試", 429);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const visitorId = typeof body?.visitorId === "string" ? body.visitorId : "";
    if (!VISITOR_ID.test(visitorId)) throw new WidgetError("訪客編號不正確", 400);
    try {
      await gas.csLead(visitorUserId(visitorId), {
        name: field(body?.name, 40),
        company: field(body?.company, 60),
        phone: field(body?.phone, 30),
        email: field(body?.email, 80),
        note: field(body?.note, 300),
        source: "form",
        ip,
      });
    } catch (error) {
      // 資料不完整（沒填電話 / Email 等）是客人可以自己修正的，訊息直接給他看
      throw new WidgetError((error as Error).message || "資料送出失敗", 400);
    }
    return Response.json({ ok: true }, { headers: cors });
  } catch (error) {
    return errorResponse(error, cors);
  }
}
