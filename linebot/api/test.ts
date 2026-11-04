import { csConverse } from "../src/cs.js";
import { humanPause } from "../src/human.js";
import { gas } from "../src/gas.js";
import { corsHeaders, errorResponse, MAX_TEXT, verifyTestToken, WidgetError } from "../src/web.js";

/**
 * 網站「BOT 設定 → 測試聊天」：POST /api/test { ts, sig, testId, text, reset? }
 * 權杖由管理系統簽（用 Bot 金鑰），5 分鐘內有效；用跟真實客人一樣的流程回答，但不通知同仁、不留對話紀錄。
 * 允許任何網站呼叫（權杖才是驗證），回覆還會附上這次用到的知識庫段落數等資訊方便調整。
 */
export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: corsHeaders("*") });
}

export async function POST(request: Request): Promise<Response> {
  const cors = corsHeaders("*");
  try {
    const body = (await request.json().catch(() => null)) as { ts?: string; sig?: string; testId?: string; text?: string; reset?: boolean } | null;
    if (!body || !verifyTestToken(String(body.ts ?? ""), String(body.sig ?? ""))) throw new WidgetError("測試權杖無效或已過期，請重新整理後台頁面", 403);
    const testId = String(body.testId ?? "");
    if (!/^T[0-9a-f]{32}$/.test(testId)) throw new WidgetError("測試編號不正確", 400);
    if (body.reset) {
      await gas.csForget(testId);
      return Response.json({ ok: true }, { headers: cors });
    }
    const text = String(body.text ?? "").trim();
    if (!text) throw new WidgetError("請輸入訊息", 400);
    if (text.length > MAX_TEXT) throw new WidgetError(`訊息太長了（上限 ${MAX_TEXT} 字）`, 400);

    const receivedAt = Date.now();
    const result = await csConverse(testId, text, { channel: "test", displayName: async () => "測試" });
    await humanPause(receivedAt, Math.min(1, result.info.replyDelay ?? 0));
    return Response.json({ reply: result.reply, choices: result.choices, handoff: result.handoff, silent: result.silent }, { headers: cors });
  } catch (error) {
    return errorResponse(error, cors);
  }
}
