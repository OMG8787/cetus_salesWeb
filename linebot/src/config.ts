// 設定都來自環境變數（Vercel 專案 Settings → Environment Variables）
// 用 getter 每次讀取，測試時可以直接改 process.env

function env(name: string, fallback = ""): string {
  const value = process.env[name];
  return value === undefined || value.trim() === "" ? fallback : value.trim();
}

export const config = {
  /** 對外客服機器人的 LINE 官方帳號（Webhook 填 /api/cs） */
  cs: {
    get channelSecret() { return env("CS_LINE_CHANNEL_SECRET"); },
    get channelAccessToken() { return env("CS_LINE_CHANNEL_ACCESS_TOKEN"); },
  },
  /** 員工助理的 LINE 官方帳號（Webhook 填 /api/line） */
  line: {
    get channelSecret() { return env("LINE_CHANNEL_SECRET"); },
    get channelAccessToken() { return env("LINE_CHANNEL_ACCESS_TOKEN"); },
  },
  gas: {
    /** 管理系統的 Apps Script 網址（結尾是 /exec） */
    get url() { return env("GAS_URL"); },
    /** 客服機器人的金鑰（網站「BOT 設定 → 連線」產生；沒設定就沿用舊版共用的 BOT_SECRET）：只能呼叫客服的操作 */
    get csSecret() { return env("BOT_CS_SECRET") || env("BOT_SECRET"); },
    /** 員工助理的金鑰：只能呼叫員工助理的操作。客服跟員工助理建議分開部署、各自只放自己的金鑰 */
    get staffSecret() { return env("BOT_STAFF_SECRET") || env("BOT_SECRET"); },
  },
  get timeZone() { return env("BOT_TIMEZONE", "Asia/Taipei"); },
  get siteUrl() { return env("SITE_URL"); },
  /** 機器人自己的網址：BOT_URL，沒設定就用 Vercel 的正式網址（BOT 設定的測試聊天、網站助理要用） */
  get botUrl() {
    const own = env("BOT_URL") || env("VERCEL_PROJECT_PRODUCTION_URL");
    return !own ? "" : own.startsWith("https://") ? own.replace(/\/+$/, "") : "https://" + own.replace(/\/+$/, "");
  },
};

/** 缺少必要設定時回傳缺少的名稱（給健康檢查與錯誤訊息用）；客服機器人至少要 GAS_URL 與 BOT_SECRET */
export function missingConfig(): string[] {
  const missing: string[] = [];
  if (!config.gas.url) missing.push("GAS_URL");
  if (!config.gas.csSecret && !config.gas.staffSecret) missing.push("BOT_CS_SECRET 或 BOT_STAFF_SECRET");
  return missing;
}
