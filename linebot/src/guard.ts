// 防濫用：網站客服視窗是公開的（任何人都能呼叫），在「呼叫 AI 與管理系統之前」先擋掉過量的請求。
//   這裡是第一道（記憶體內計數、不用等任何外部服務）；管理系統那邊另有一份跨執行個體共用的計數（csStart），兩邊用同一份設定（BOT 設定 → 客服設定 → 防濫用）。
//   Vercel 的函式可能同時有好幾個執行個體，這裡的計數只在同一個執行個體內有效，所以管理系統的計數才是準的；這裡的用途是讓大量灌入的請求不必每次都去打管理系統與 AI。

export interface GuardCfg {
  /** 同一個訪客編號每分鐘最多幾則 */
  visitorPerMin: number;
  /** 同一個 IP 每分鐘 / 每小時最多幾則（0 = 不限） */
  ipPerMin: number;
  ipPerHour: number;
  /** 同一個 IP 每分鐘最多幾次視窗請求（含查看新訊息、關閉、留資料；0 = 不限） */
  reqPerMin: number;
  /** 全站每小時 / 每天最多幾則（0 = 不限） */
  globalPerHour: number;
  globalPerDay: number;
  /** 同一個 IP 每小時最多留幾次聯繫資料（0 = 不限） */
  leadPerHour: number;
  /** 有設定「允許嵌入的網站」時，沒帶來源的請求（腳本）一律拒絕 */
  requireOrigin: boolean;
  alert: boolean;
  /** 超過 IP / 全站上限時回給客人的話 */
  overText: string;
}

export const DEFAULT_GUARD: GuardCfg = {
  visitorPerMin: 12,
  ipPerMin: 20,
  ipPerHour: 120,
  reqPerMin: 120,
  globalPerHour: 600,
  globalPerDay: 3000,
  leadPerHour: 10,
  requireOrigin: true,
  alert: true,
  overText: "目前諮詢的人比較多，暫時無法即時回覆。請稍後再試，或按「轉真人」、留下聯絡方式，由專人與您聯繫 🙏",
};

export const VISITOR_FAST_TEXT = "訊息傳得太快了，請稍等一下再試 🙏";

export type LimitReason = "visitor" | "ip" | "global";

/** 管理系統回傳的原因 → 要回給客人的話 */
export function limitText(reason: string | undefined, cfg: GuardCfg | undefined): string {
  return reason === "ip" || reason === "global" ? (cfg ?? DEFAULT_GUARD).overText : VISITOR_FAST_TEXT;
}

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

interface Counter {
  resetAt: number;
  n: number;
}
const counters = new Map<string, Counter>();
const MAX_KEYS = 5000;

/** 固定時間窗計數：回傳加 1 之後的次數。為了不讓記憶體被亂數訪客編號灌爆，鍵太多時先清掉過期的，還是太多就整個清空（寧可少擋也不要當機）。 */
function bump(key: string, windowMs: number, now: number): number {
  let c = counters.get(key);
  if (!c || c.resetAt <= now) {
    if (counters.size >= MAX_KEYS) {
      for (const [k, v] of counters) if (v.resetAt <= now) counters.delete(k);
      if (counters.size >= MAX_KEYS) counters.clear();
    }
    c = { resetAt: now + windowMs, n: 0 };
    counters.set(key, c);
  }
  c.n += 1;
  return c.n;
}

export function resetGuard(): void {
  counters.clear();
}

/** 這則網站訊息有沒有超過上限。傳回被擋下的原因，沒有超過回 null。 */
export function guardCheck(who: { ip?: string; uid: string }, cfg: GuardCfg, now = Date.now()): LimitReason | null {
  let reason: LimitReason | null = null;
  if (bump(`v:${who.uid}`, MINUTE, now) > cfg.visitorPerMin) reason = "visitor";
  if (who.ip) {
    const perMin = bump(`im:${who.ip}`, MINUTE, now);
    const perHour = bump(`ih:${who.ip}`, HOUR, now);
    if (!reason && cfg.ipPerMin && perMin > cfg.ipPerMin) reason = "ip";
    if (!reason && cfg.ipPerHour && perHour > cfg.ipPerHour) reason = "ip";
  }
  // 全站計數只算沒被擋下的訊息：單一來源狂灌不會把全站額度吃光
  if (!reason && cfg.globalPerHour && bump("gh", HOUR, now) > cfg.globalPerHour) reason = "global";
  if (!reason && cfg.globalPerDay && bump("gd", DAY, now) > cfg.globalPerDay) reason = "global";
  return reason;
}

/** 視窗請求（查看新訊息、關閉、留資料…）的 IP 頻率：超過回 true。 */
export function requestLimited(ip: string | undefined, cfg: GuardCfg, now = Date.now()): boolean {
  if (!ip || !cfg.reqPerMin) return false;
  return bump(`rq:${ip}`, MINUTE, now) > cfg.reqPerMin;
}

/** 留聯繫資料的 IP 頻率：超過回 true。 */
export function leadLimited(ip: string | undefined, cfg: GuardCfg, now = Date.now()): boolean {
  if (!ip || !cfg.leadPerHour) return false;
  return bump(`ld:${ip}`, HOUR, now) > cfg.leadPerHour;
}

/** 來源 IP：Vercel 會覆寫這些標頭（客人偽造不了）。 */
export function clientIp(request: Request): string {
  const h = request.headers;
  const raw = h.get("x-vercel-forwarded-for") ?? h.get("x-real-ip") ?? (h.get("x-forwarded-for") ?? "").split(",")[0] ?? "";
  const ip = raw.trim();
  return /^[0-9a-fA-F:.]{3,45}$/.test(ip) ? ip : "";
}
