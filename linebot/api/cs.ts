import { waitUntil } from "@vercel/functions";
import { config } from "../src/config.js";
import { processCsEvents } from "../src/cs.js";
import { channels, validateSignature, type LineEvent } from "../src/line.js";

/**
 * 對外客服機器人的 LINE Webhook（對外官方帳號的 Webhook URL 設為 https://你的網域/api/cs）
 * 驗證簽章後立即回 200，實際處理用 waitUntil 在回應後繼續進行
 */
export async function POST(request: Request): Promise<Response> {
  const body = await request.text();
  if (!validateSignature(channels.cs, body, request.headers.get("x-line-signature"))) {
    console.warn("客服機器人 LINE 簽章驗證失敗");
    return new Response("Unauthorized", { status: 401 });
  }

  const events = (JSON.parse(body) as { events?: LineEvent[] }).events ?? [];
  waitUntil(processCsEvents(events));
  return new Response("OK");
}

/** 健康檢查：只顯示缺少哪些設定，不顯示任何設定值 */
export function GET(): Response {
  const missing = [
    ["CS_LINE_CHANNEL_SECRET", channels.cs.secret],
    ["CS_LINE_CHANNEL_ACCESS_TOKEN", channels.cs.token],
    ["BOT_CS_SECRET（或舊版 BOT_SECRET）", config.gas.csSecret],
    ["GAS_URL", config.gas.url],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k);
  return Response.json({ ok: missing.length === 0, missing });
}
