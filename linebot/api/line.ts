import { waitUntil } from "@vercel/functions";
import { channels, validateSignature, type LineEvent } from "../src/line.js";
import { processStaffEvents } from "../src/staff.js";

/**
 * 員工助理的 LINE Webhook（員工專用官方帳號的 Webhook URL 設為 https://你的網域/api/line）
 * 驗證簽章後立即回 200，實際處理用 waitUntil 在回應後繼續進行
 */
export async function POST(request: Request): Promise<Response> {
  const body = await request.text();
  if (!validateSignature(channels.staff, body, request.headers.get("x-line-signature"))) {
    console.warn("員工助理 LINE 簽章驗證失敗");
    return new Response("Unauthorized", { status: 401 });
  }

  const events = (JSON.parse(body) as { events?: LineEvent[] }).events ?? [];
  waitUntil(processStaffEvents(events));
  return new Response("OK");
}

/** 健康檢查：只顯示缺少哪些設定，不顯示任何設定值 */
export function GET(): Response {
  const missing = [
    ["LINE_CHANNEL_SECRET", channels.staff.secret],
    ["LINE_CHANNEL_ACCESS_TOKEN", channels.staff.token],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k);
  return Response.json({ ok: missing.length === 0, missing });
}
