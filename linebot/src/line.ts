import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";

// LINE Messaging API 的最小資料模型（僅保留用得到的欄位）
// https://developers.line.biz/en/reference/messaging-api/#webhook-event-objects

export interface LineEvent {
  type: string;
  replyToken?: string;
  source: { type: "user" | "group" | "room"; userId?: string; groupId?: string; roomId?: string };
  message?: { id?: string; type: string; text?: string; mention?: { mentionees?: Mentionee[] } };
  postback?: { data?: string };
}

/** 訊息裡的 @標記（isSelf = 標記的是這個官方帳號） */
export interface Mentionee {
  index: number;
  length: number;
  type?: string;
  userId?: string;
  isSelf?: boolean;
}

/** 一個 LINE 官方帳號（員工助理 / 客服機器人各一個） */
export interface Channel {
  name: "staff" | "cs";
  secret: string;
  token: string;
}

export const channels = {
  get staff(): Channel {
    return { name: "staff", secret: config.line.channelSecret, token: config.line.channelAccessToken };
  },
  get cs(): Channel {
    return { name: "cs", secret: config.cs.channelSecret, token: config.cs.channelAccessToken };
  },
};

/** 快速回覆按鈕：文字（點了就是傳出那段文字）或 postback（例如「✅ 確認」） */
export type Choice = string | { label: string; data: string; displayText?: string };

const API = "https://api.line.me/v2/bot";
const MAX_TEXT_LENGTH = 5000;
const MAX_MESSAGES_PER_REPLY = 5;
/** 快速回覆最多 13 個按鈕，按鈕文字最多 20 字 */
export const MAX_CHOICES = 13;
export const MAX_CHOICE_LENGTH = 20;

/** 驗證 X-Line-Signature（HMAC-SHA256 + Base64） */
export function validateSignature(ch: Channel, body: string, signature: string | null): boolean {
  if (!signature || !ch.secret) return false;
  const computed = createHmac("sha256", ch.secret).update(body).digest();
  const given = Buffer.from(signature, "base64");
  return given.length === computed.length && timingSafeEqual(computed, given);
}

function headers(ch: Channel) {
  return { Authorization: `Bearer ${ch.token}`, "Content-Type": "application/json" };
}

/** 文字切成 LINE 能送的訊息（每則 5000 字、最多 5 則）；choices 變成最後一則下方的快速回覆按鈕 */
export function textMessages(text: string, choices: Choice[] = [], images: string[] = []): Record<string, unknown>[] {
  const chunks: string[] = [];
  let rest = text.trim() || "……";
  while (rest.length > MAX_TEXT_LENGTH) {
    // 盡量在換行處切開
    const cut = rest.lastIndexOf("\n", MAX_TEXT_LENGTH);
    const at = cut > MAX_TEXT_LENGTH / 2 ? cut : MAX_TEXT_LENGTH;
    chunks.push(rest.slice(0, at));
    rest = rest.slice(at).trimStart();
  }
  chunks.push(rest);
  const picCount = Math.min(images.length, MAX_MESSAGES_PER_REPLY - 1);
  const messages: Record<string, unknown>[] = chunks.slice(0, MAX_MESSAGES_PER_REPLY - picCount).map((t) => ({ type: "text", text: t }));
  // 圖片接在文字後面（LINE 一次最多 5 則；原圖 ≤10MB、縮圖 ≤1MB，縮圖用小尺寸）
  for (const url of images.slice(0, picCount)) messages.push({ type: "image", originalContentUrl: url, previewImageUrl: url.replace(/([?&])w=\d+/, "$1w=480") });
  if (choices.length) {
    messages[messages.length - 1].quickReply = {
      items: choices.slice(0, MAX_CHOICES).map((c) => ({
        type: "action",
        action: typeof c === "string"
          ? { type: "message", label: c.slice(0, MAX_CHOICE_LENGTH), text: c }
          : { type: "postback", label: c.label.slice(0, MAX_CHOICE_LENGTH), data: c.data, displayText: c.displayText ?? c.label },
      })),
    };
  }
  return messages;
}

/**
 * 回覆訊息；回覆權杖過期（處理太久）時改用推播送給本人（推播會用到官方帳號的每月額度）
 */
export async function replyText(ch: Channel, replyToken: string | undefined, userId: string, text: string, choices: Choice[] = [], images: string[] = []): Promise<void> {
  const messages = textMessages(text, choices, images);
  if (replyToken) {
    const response = await fetch(`${API}/message/reply`, { method: "POST", headers: headers(ch), body: JSON.stringify({ replyToken, messages }) });
    if (response.ok) return;
    const detail = await response.text();
    console.warn(`LINE 回覆失敗 ${response.status}: ${detail.slice(0, 300)}`);
    if (response.status !== 400 || !userId) return;
  }
  if (!userId) return;
  await pushText(ch, userId, text, choices, images);
}

/** 主動推播（會用到官方帳號的每月額度） */
export async function pushText(ch: Channel, to: string, text: string, choices: Choice[] = [], images: string[] = []): Promise<boolean> {
  const push = await fetch(`${API}/message/push`, { method: "POST", headers: headers(ch), body: JSON.stringify({ to, messages: textMessages(text, choices, images) }) });
  if (!push.ok) console.warn(`LINE 推播失敗 ${push.status}: ${(await push.text()).slice(0, 300)}`);
  return push.ok;
}

const MAX_CONTENT_BYTES = 10 * 1024 * 1024;

/** 下載使用者傳來的圖片（LINE 保留 14 天以內）；回傳 base64。太大、不是圖片或下載失敗丟出錯誤。 */
export async function downloadImage(ch: Channel, messageId: string): Promise<{ mime: string; data: string }> {
  const response = await fetch(`https://api-data.line.me/v2/bot/message/${encodeURIComponent(messageId)}/content`, { headers: { Authorization: `Bearer ${ch.token}` }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`LINE 圖片下載失敗（${response.status}）`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_CONTENT_BYTES) throw new Error("圖片太大了（上限 10MB）");
  const header = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  // LINE 的圖片幾乎都是 JPEG；用檔頭判斷，header 不可靠時也能認出來
  const mime = bytes[0] === 0xff && bytes[1] === 0xd8 ? "image/jpeg" : bytes.subarray(1, 4).toString() === "PNG" ? "image/png" : header.startsWith("image/") ? header : "";
  if (!mime) throw new Error("這不是圖片檔");
  return { mime, data: bytes.toString("base64") };
}

/** 顯示「輸入中」動畫（只有一對一聊天有效；失敗不影響回覆） */
export async function showLoading(ch: Channel, userId: string, seconds = 30): Promise<void> {
  try {
    const response = await fetch(`${API}/chat/loading/start`, {
      method: "POST",
      headers: headers(ch),
      body: JSON.stringify({ chatId: userId, loadingSeconds: seconds }),
    });
    if (!response.ok) console.warn(`輸入中動畫失敗 ${response.status}：${await response.text()}`);
  } catch (error) {
    console.warn("輸入中動畫失敗", error);
  }
}

export interface Profile {
  displayName: string;
  pictureUrl: string;
}

const profiles = new Map<string, { at: number; profile: Profile }>();
const PROFILE_TTL_MS = 6 * 3_600_000;

/** 群組名稱（多人聊天室沒有名稱，回傳 ""） */
export async function groupName(ch: Channel, groupId: string): Promise<string> {
  try {
    const response = await fetch(`${API}/group/${encodeURIComponent(groupId)}/summary`, { headers: headers(ch) });
    if (!response.ok) return "";
    return String(((await response.json()) as { groupName?: string }).groupName ?? "");
  } catch {
    return "";
  }
}

/** 群組成員的 LINE 名稱（不是好友也查得到；同一個執行個體內快取 6 小時） */
export async function groupMemberName(ch: Channel, source: { groupId?: string; roomId?: string; userId?: string }): Promise<string> {
  const { userId } = source;
  const path = source.groupId ? `group/${encodeURIComponent(source.groupId)}` : source.roomId ? `room/${encodeURIComponent(source.roomId)}` : "";
  if (!userId || !path) return "";
  const key = `${ch.name}:${path}:${userId}`;
  const cached = profiles.get(key);
  if (cached && Date.now() - cached.at < PROFILE_TTL_MS) return cached.profile.displayName;
  try {
    const response = await fetch(`${API}/${path}/member/${encodeURIComponent(userId)}`, { headers: headers(ch) });
    if (!response.ok) return "";
    const displayName = String(((await response.json()) as { displayName?: string }).displayName ?? "");
    profiles.set(key, { at: Date.now(), profile: { displayName, pictureUrl: "" } });
    return displayName;
  } catch {
    return "";
  }
}

/** LINE 名稱與大頭貼（同一個執行個體內快取 6 小時） */
export async function getProfile(ch: Channel, userId: string): Promise<Profile> {
  const key = `${ch.name}:${userId}`;
  const cached = profiles.get(key);
  if (cached && Date.now() - cached.at < PROFILE_TTL_MS) return cached.profile;
  try {
    const response = await fetch(`${API}/profile/${encodeURIComponent(userId)}`, { headers: headers(ch) });
    if (!response.ok) return { displayName: "", pictureUrl: "" };
    const p = (await response.json()) as { displayName?: string; pictureUrl?: string };
    const profile = { displayName: p.displayName ?? "", pictureUrl: p.pictureUrl ?? "" };
    profiles.set(key, { at: Date.now(), profile });
    return profile;
  } catch {
    return { displayName: "", pictureUrl: "" };
  }
}
