import { waitUntil } from "@vercel/functions";
import { csConverse } from "../../src/cs.js";
import { humanPause } from "../../src/human.js";
import { checkOrigin, corsHeaders, errorResponse, loadWidget, MAX_TEXT, VISITOR_ID, visitorUserId, WidgetError } from "../../src/web.js";

/** 網站客服視窗送出一則訊息：POST /api/widget/chat { visitorId, text } */
export async function OPTIONS(request: Request): Promise<Response> {
  try {
    return new Response(null, { status: 204, headers: corsHeaders(checkOrigin(request, await loadWidget())) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  const receivedAt = Date.now();
  let cors: Record<string, string> = {};
  try {
    const widget = await loadWidget();
    cors = corsHeaders(checkOrigin(request, widget));

    const body = (await request.json().catch(() => null)) as { visitorId?: unknown; text?: unknown; human?: unknown } | null;
    const human = body?.human === true; // 客人按了回覆下方的「轉真人」按鈕
    const visitorId = typeof body?.visitorId === "string" ? body.visitorId : "";
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (!VISITOR_ID.test(visitorId)) throw new WidgetError("訪客編號不正確", 400);
    if (!text && !human) throw new WidgetError("請輸入訊息", 400);
    if (text.length > MAX_TEXT) throw new WidgetError(`訊息太長了（上限 ${MAX_TEXT} 字）`, 400);

    const result = await csConverse(visitorUserId(visitorId), text, { channel: "web", displayName: async () => "網站訪客", human, defer: waitUntil });
    // 像真人一樣不要秒回
    if (!result.silent) await humanPause(receivedAt, result.info.replyDelay);
    return Response.json(
      {
        reply: result.silent || !result.reply ? null : { id: 0, text: result.reply, choices: result.choices, images: result.images, handoffButton: result.handoffButton, quickActions: result.quickActions, seeMore: result.seeMore === true },
        paused: result.paused,
        askContact: result.askContact,
      },
      { headers: cors },
    );
  } catch (error) {
    return errorResponse(error, cors);
  }
}
