import { timingSafeEqual } from "node:crypto";
import { config } from "../src/config.js";
import { pushAlert, pushBriefings } from "../src/staff.js";

/**
 * 每日早報：管理系統每小時檢查一次，到 BOT 設定的時間就呼叫這裡（header x-bot-secret = Bot 金鑰），
 * 推播給「員工助理」裡勾了「每天推播早報」的成員。
 */
export async function POST(request: Request): Promise<Response> {
  const given = request.headers.get("x-bot-secret") ?? "";
  const secret = config.gas.staffSecret;
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  if (!secret || a.length !== b.length || !timingSafeEqual(a, b)) return Response.json({ error: "未授權" }, { status: 401 });
  try {
    // 管理系統的即時通知：{ alert: 文字, targets: [LINE 編號] }；沒帶就是每日早報
    const body = (await request.json().catch(() => ({}))) as { alert?: unknown; targets?: unknown };
    if (typeof body.alert === "string" && body.alert.trim()) {
      const targets = Array.isArray(body.targets) ? body.targets.map(String) : [];
      return Response.json(await pushAlert(targets, body.alert.trim()));
    }
    return Response.json(await pushBriefings());
  } catch (error) {
    console.error("早報推播失敗", error);
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}
