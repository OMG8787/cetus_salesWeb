import { config } from "./config.js";

// 日期一律用「當地」的 YYYY-MM-DD 字串比較（試算表存的也是當地日期）

export const WEEKDAYS = "日一二三四五六";

/** 當地現在時間：{ date: "2026-10-27", time: "14:05", weekday: "二" } */
export function nowLocal(at = new Date()): { date: string; time: string; weekday: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: config.timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  return { date, time: `${get("hour")}:${get("minute")}`, weekday: weekdayOf(date) };
}

export function today(): string {
  return nowLocal().date;
}

export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function weekdayOf(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** 試算表的日期欄位（2026/10/27、2026-10-27T09:00、2026-10-27 09:00）→ YYYY-MM-DD；不是日期回傳 "" */
export function ymd(value: unknown): string {
  const m = String(value ?? "").trim().match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : "";
}

/** 時間部分（HH:mm），沒有回傳 "" */
export function hm(value: unknown): string {
  const m = String(value ?? "").match(/[T\s](\d{1,2}):(\d{2})/) ?? String(value ?? "").match(/^(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : "";
}

/** 顯示用：10/27（二） */
export function showDate(date: string): string {
  if (!date) return "";
  const [, m, d] = date.split("-");
  return `${Number(m)}/${Number(d)}（${weekdayOf(date)}）`;
}

/** 距離今天幾天（負數 = 已經過了） */
export function daysFrom(date: string, base = today()): number {
  const t = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  return Math.round((t(date) - t(base)) / 86_400_000);
}
