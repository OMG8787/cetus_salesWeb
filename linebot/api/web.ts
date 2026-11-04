import { timingSafeEqual } from "node:crypto";
import { config } from "../src/config.js";
import { staffConverse } from "../src/staff.js";

/**
 * 網站「智能助理」（右下角）：只給管理系統（Apps Script）呼叫，瀏覽器不會直接打這裡。
 *   POST /api/web { secret, id, text?, confirm?, token?, reset?, displayName? }
 *   管理系統先驗證網站登入，再用 Bot 金鑰轉過來；id（W + 32 字元）= 登入帳號的暫時編號，
 *   機器人只能用這個編號回頭查詢（權限 = 該網站帳號的權限），拿不到登入權杖。
 */
const WEB_ID = /^W[0-9a-f]{32}$/;
const MAX_TEXT = 1500;

function sameSecret(given: unknown): boolean {
  const secret = config.gas.staffSecret;
  if (!secret || typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || !sameSecret(body.secret)) return Response.json({ error: "未授權" }, { status: 401 });
  const id = String(body.id ?? "");
  if (!WEB_ID.test(id)) return Response.json({ error: "使用者編號不正確" }, { status: 400 });
  const text = String(body.text ?? "").trim();
  if (text.length > MAX_TEXT) return Response.json({ error: `訊息太長了（上限 ${MAX_TEXT} 字）` }, { status: 400 });

  try {
    const result = await staffConverse(
      id,
      { text, confirm: typeof body.confirm === "boolean" ? body.confirm : undefined, token: String(body.token ?? ""), reset: body.reset === true },
      { channel: "web", displayName: String(body.displayName ?? "") },
    );
    return Response.json({ reply: result.reply, choices: result.choices, pending: result.pending });
  } catch (error) {
    console.error("網站智能助理錯誤", error);
    return Response.json({ error: "助理暫時無法使用，請稍後再試" }, { status: 500 });
  }
}
