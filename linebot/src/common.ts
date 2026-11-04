import { GasError } from "./gas.js";
import { replyText, type Channel, type LineEvent } from "./line.js";

/** LINE / 網站都不支援 Markdown：去掉 AI 常用的格式符號 */
export function cleanReply(text: string): string {
  return text
    .replace(/```[a-z]*\n?/gi, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[ \t]*[-*][ \t]+/gm, "・")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 一批 LINE 事件：同一個人（或群組）依序處理，不同人並行；出錯時回覆「系統忙碌」 */
export async function processEvents(events: LineEvent[], handler: (e: LineEvent) => Promise<void>, channel: Channel): Promise<void> {
  const byUser = new Map<string, LineEvent[]>();
  for (const e of events) {
    const key = e.source.groupId ?? e.source.roomId ?? e.source.userId ?? "";
    byUser.set(key, [...(byUser.get(key) ?? []), e]);
  }
  await Promise.all(
    [...byUser.values()].map(async (list) => {
      for (const e of list) {
        try {
          await handler(e);
        } catch (error) {
          console.error(`處理 LINE 事件失敗 ${e.type}`, error);
          if (e.replyToken && e.source.type === "user" && e.source.userId) {
            const msg = error instanceof GasError && error.code === "BOT_OFF" ? "🔧 機器人目前暫停服務，請稍後再試。" : "😵 系統忙碌中，請稍後再試一次。";
            await replyText(channel, e.replyToken, e.source.userId, msg).catch(() => undefined);
          }
        }
      }
    }),
  );
}
