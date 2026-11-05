import { config } from "./config.js";

// 知識庫圖片：存在 Google 雲端硬碟（知道連結的人可檢視），機器人伺服器代理成固定網址 /api/img?id=檔案代號&w=寬度
//   ・LINE 只收 https 的 JPG / PNG，雲端硬碟的分享連結不是圖片檔，所以一律經過 /api/img 轉成可用的圖片
//   ・只代理格式合格的檔案代號，來源固定是 Google 圖片伺服器

export const DRIVE_ID = /^[A-Za-z0-9_-]{10,80}$/;
export const IMG_MIN_W = 100;
export const IMG_MAX_W = 2000;

/** 給客人看的圖片網址；機器人網址還沒設定（BOT_URL / Vercel 正式網址）時回傳空字串 */
export function imageUrl(driveId: string, width = 1280): string {
  const base = config.botUrl;
  if (!base || !DRIVE_ID.test(driveId)) return "";
  return `${base}/api/img?id=${encodeURIComponent(driveId)}&w=${Math.min(IMG_MAX_W, Math.max(IMG_MIN_W, Math.round(width)))}`;
}

export interface ReplyImage {
  url: string;
  caption: string;
}
