import { waitUntil } from "@vercel/functions";
import { prewarmCs } from "../../src/cs.js";
import { checkOrigin, corsHeaders, errorResponse, loadWidget, publicConfig } from "../../src/web.js";

/** 網站客服視窗的外觀設定（公開）：GET /api/widget/config */
export async function OPTIONS(request: Request): Promise<Response> {
  try {
    return new Response(null, { status: 204, headers: corsHeaders(checkOrigin(request, await loadWidget())) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: Request): Promise<Response> {
  try {
    const widget = await loadWidget();
    if (widget.enabled) waitUntil(prewarmCs()); // 訪客一開網頁就在背景預熱，第一則訊息不用等知識庫載入
    return Response.json(publicConfig(widget), { headers: corsHeaders(checkOrigin(request, widget)) });
  } catch (error) {
    return errorResponse(error);
  }
}
