import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";
import { gas, type WidgetConfig } from "./gas.js";
import { clientIp, DEFAULT_GUARD, requestLimited } from "./guard.js";

// 網站客服視窗與後台「測試聊天」的公開 API 共用工具。這些端點不需要登入（任何訪客都能呼叫），所以：
//   ・只回傳視窗外觀等公開設定，不含任何金鑰、知識庫內容
//   ・來源網站白名單（CORS + 伺服器端檢查 Origin）
//   ・訪客編號格式檢查、訊息長度限制（頻率限制在管理系統）

export const MAX_TEXT = 1000;
export const VISITOR_ID = /^[A-Za-z0-9_-]{16,64}$/;
const WIDGET_TTL_MS = 60_000;

export class WidgetError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

let cached: { at: number; widget: WidgetConfig } | null = null;

/** 視窗設定（同一個執行個體內快取 1 分鐘） */
export async function widgetConfig(force = false): Promise<WidgetConfig> {
  if (!force && cached && Date.now() - cached.at < WIDGET_TTL_MS) return cached.widget;
  const widget = await gas.csWidget();
  cached = { at: Date.now(), widget };
  return widget;
}

export function resetWidgetCache(): void {
  cached = null;
}

/** 訪客編號 → 管理系統用的編號：V + 32 個十六進位字元（不直接用訪客自己給的字串） */
export function visitorUserId(visitorId: string): string {
  return "V" + createHash("sha256").update("aoi-visitor:" + visitorId).digest("hex").slice(0, 32);
}

/** 視窗請求的 IP 頻率檢查（查看新訊息、關閉、留資料等會打到管理系統的請求）：超過直接擋，不去打管理系統。 */
export function enforceRequestLimit(request: Request, widget: WidgetConfig): string {
  const cfg = widget.guard ?? DEFAULT_GUARD;
  const ip = clientIp(request);
  if (requestLimited(ip, cfg)) throw new WidgetError(cfg.overText, 429);
  return ip;
}

/** 載入視窗設定並檢查：已啟用 */
export async function loadWidget(): Promise<WidgetConfig> {
  const widget = await widgetConfig();
  if (!widget.enabled) throw new WidgetError("客服目前未開放", 403);
  return widget;
}

/** 允許的來源網站：一行一個，去掉結尾斜線、轉小寫。空陣列 = 不限制 */
export function allowedOrigins(widget: WidgetConfig): string[] {
  return String(widget.allowedOrigins ?? "")
    .split(/[\s,]+/)
    .map((o) => o.trim().replace(/\/+$/, "").toLowerCase())
    .filter(Boolean);
}

/**
 * 檢查來源網站；回傳要放在 Access-Control-Allow-Origin 的值。
 * 沒有 Origin 標頭：瀏覽器的同網站請求（Sec-Fetch-Site 是 same-origin / none）放行；其他（腳本、curl）在「防濫用 → 沒帶來源的請求一律拒絕」開著時擋下。
 * 注意：Origin 是客戶端自己填的，偽造得了，所以這只是擋掉最陽春的腳本，真正的流量限制是 guard.ts 與管理系統的計數。
 */
export function checkOrigin(request: Request, widget: WidgetConfig): string {
  const allowed = allowedOrigins(widget);
  const origin = request.headers.get("origin");
  if (allowed.length === 0) return "*";
  if (!origin) {
    const site = request.headers.get("sec-fetch-site");
    if (widget.guard?.requireOrigin !== false && site !== "same-origin" && site !== "none") throw new WidgetError("這個網站未獲授權使用客服視窗", 403);
    return allowed[0];
  }
  // 機器人自己的網址（測試頁）一律放行
  if (origin === new URL(request.url).origin) return origin;
  if (!allowed.includes(origin.toLowerCase())) throw new WidgetError("這個網站未獲授權使用客服視窗", 403);
  return origin;
}

export function corsHeaders(allowOrigin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
    "Cache-Control": "no-store",
  };
}

/** 視窗外觀與歡迎詞（公開資訊） */
export function publicConfig(widget: WidgetConfig) {
  return {
    title: widget.title,
    subtitle: widget.subtitle,
    color: widget.color,
    position: widget.position,
    avatar: "💬",
    placeholder: "輸入訊息…",
    autoOpen: widget.autoOpen,
    resetOnReload: widget.resetOnReload !== false,
    trackTraffic: widget.trackTraffic === true,
    welcome: widget.welcome ? { text: widget.welcome, choices: widget.buttons ?? [] } : null,
    handoffButton: widget.handoffButton !== false,
    handoffLabel: `🙋 轉${widget.handoffWord || "真人"}`,
    robot: widget.robot ?? null,
  };
}

/** 把例外轉成 JSON 回應；未預期的錯誤不洩漏細節 */
export function errorResponse(error: unknown, cors: Record<string, string> = {}): Response {
  if (error instanceof WidgetError) return Response.json({ error: error.message }, { status: error.status, headers: cors });
  console.error("網站客服視窗錯誤", error);
  return Response.json({ error: "系統忙碌中，請稍後再試" }, { status: 500, headers: cors });
}

/** 後台測試聊天的權杖：管理系統用 Bot 金鑰簽的 HMAC-SHA256(ts)，5 分鐘內有效 */
export function verifyTestToken(ts: string, sig: string): boolean {
  const secret = config.gas.csSecret;
  if (!secret || !/^\d{10,16}$/.test(ts) || !/^[0-9a-f]{64}$/.test(sig)) return false;
  if (Math.abs(Date.now() - Number(ts)) > 5 * 60_000) return false;
  const expected = createHmac("sha256", secret).update(ts).digest();
  const given = Buffer.from(sig, "hex");
  return given.length === expected.length && timingSafeEqual(expected, given);
}
