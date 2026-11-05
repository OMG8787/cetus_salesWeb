import { config } from "./config.js";

// 呼叫管理系統（Google Apps Script）：{ action: "bot", secret, op, lineUserId, ... }
//   lineUserId：U 開頭 = LINE 使用者；V 開頭 = 網站訪客（客服視窗）；T 開頭 = 後台測試聊天

export class GasError extends Error {
  constructor(message: string, public code = "") {
    super(message);
  }
}

export type Row = Record<string, unknown>;

export interface AiConfig {
  source: "bot" | "system";
  provider: "gemini" | "claude" | "openai";
  apiKey: string;
  model: string;
  endpoint: string;
  /** 每個問題最多查幾輪資料（工具呼叫輪數上限，1～12） */
  maxRounds?: number;
}

export interface CsTopic {
  name: string;
  words: string[];
  /** 轉給小編時，請客人先留下的資料（例如：公司名稱、電話） */
  ask?: string;
  /** 留資料的說明放在回覆後面（預設）或前面 */
  askPos?: "after" | "before";
}

export interface CsStyle {
  tone: "friendly" | "formal" | "concise";
  address: string;
  emoji: "many" | "some" | "none";
  maxLines: number;
}

/** 客服機器人的設定與對話記憶（每則訊息從管理系統取得，後台改設定馬上生效） */
export interface CsInfo {
  enabled: boolean;
  channel?: "line" | "web" | "test";
  appName: string;
  brand: string;
  welcome: string;
  prompt: string;
  handoffText: string;
  /** 回覆最少等待秒數（像真人打字） */
  replyDelay?: number;
  ai: AiConfig | null;
  /** 主要 AI 失敗時，依序改用這些 */
  aiFallback?: AiConfig[];
  /** 知識庫版本號：變了就要重讀知識庫與向量（不用等快取過期） */
  kbVer?: string;
  /** 回覆前先檢查有沒有知識庫根據（預設關閉） */
  groundCheck?: boolean;
  /** 檢查用的 AI（沒指定 = 用 ai） */
  checkAi?: AiConfig | null;
  /** 每則回覆下方附「轉真人」按鈕 */
  handoffButton?: boolean;
  /** 聊到第幾段請客人留聯繫資料（0 = 不問） */
  contactAfter?: number;
  /** 這位客人已經聊了幾段 */
  turnCount?: number;
  /** 聯繫資料：'' 還沒問 / asked 已問過 / done 已留 */
  leadState?: "" | "asked" | "done";
  /** 知識庫有附圖時可以直接給客人 */
  sendImages?: boolean;
  history: { u: boolean; t: string }[];
  /** 已經知道客人的名稱（false = 記對話時順便帶上名稱） */
  known?: boolean;
  /** 小編接手中（轉真人後暫停機器人） */
  paused?: boolean;
  /** 網站訪客傳太快 */
  rateLimited?: boolean;
  /** always 一律先回 / offHours 只在小編服務時間以外回 */
  replyWhen?: "always" | "offHours";
  /** 現在是不是小編服務時間（沒設定服務時間 = null） */
  inHours?: boolean | null;
  hoursText?: string;
  /** 非服務時間轉真人時的加註 */
  offText?: string;
  handoffWords?: string[];
  /** 交給真人回答的問題 */
  topics?: CsTopic[];
  /** 問到交給真人的問題時的回覆（{主題} = 問題類型） */
  topicText?: string;
  /** 找不到答案：ask 請客人找真人 / handoff 直接轉給小編 */
  unsure?: "ask" | "handoff";
  style?: CsStyle;
  /** 常用按鈕（歡迎詞下方；buttonsAlways = 每則回覆都附上） */
  buttons?: string[];
  buttonsAlways?: boolean;
  /** 知識庫搜尋流程與向量閥值 */
  search?: SearchSettings;
  /** 算向量的模型（沒有 = 沒辦法用向量，退回關鍵字） */
  embedAi?: EmbedConfig | null;
}

/** 知識庫的一段（RAG 檢索單位） */
export interface KnowledgeChunk {
  id: string;
  source: string;
  title: string;
  text: string;
  /** 大分類、主題、備註（備註是寫給 AI 看的分流提示）、關鍵字：用來先分流再檢索 */
  category?: string;
  topic?: string;
  notes?: string;
  tags?: string;
  /** 附圖（雲端硬碟檔案代號 + 說明） */
  images?: { id: string; caption: string }[];
}

/** 算向量（embedding）用的模型與金鑰（管理系統從 AI 設定裡挑 Gemini 或 OpenAI 相容的那一組） */
export interface EmbedConfig {
  provider: "gemini" | "openai";
  apiKey: string;
  endpoint: string;
  model: string;
  dim: number;
  /** 向量是用哪個模型算的（provider:model:dim）；跟知識庫向量不同代表要重算 */
  key: string;
}

export interface SearchSettings {
  mode: "vector" | "meta_vector" | "meta" | "both";
  threshold: number;
  topK: number;
  embedProvider?: string;
}

/** 網站客服視窗的公開設定 */
export interface WidgetConfig {
  enabled: boolean;
  title: string;
  subtitle: string;
  color: string;
  position: "left" | "right";
  autoOpen: boolean;
  /** 允許嵌入的網站（一行一個；空白 = 不限制） */
  allowedOrigins: string;
  welcome: string;
  buttons: string[];
  replyDelay: number;
  /** 每則回覆下方附「轉真人」按鈕 */
  handoffButton?: boolean;
  /** 轉真人按鈕上的稱呼（第一個轉真人關鍵字） */
  handoffWord?: string;
}

export interface ThreadMessage {
  id: number;
  role: "user" | "bot" | "human";
  text: string;
}

/** 員工助理：登記的成員、權限與記憶（每則訊息從管理系統取得） */
export interface StaffMemoryItem {
  id: number;
  scope: "user" | "all";
  category: string;
  content: string;
  importance: number;
}

export interface StaffInfo {
  allowed: boolean;
  status: string;
  problem: string;
  isNew: boolean;
  name: string;
  appName: string;
  channel: "line" | "web";
  replyDelay: number;
  texts: { welcome: string; pending: string };
  // 以下只有已開通（allowed）才有
  userId?: string;
  linked?: boolean;
  username?: string;
  /** 各功能區塊的權限：edit / view / none */
  blocks?: Record<string, "edit" | "view" | "none">;
  prompt?: string;
  ai?: AiConfig | null;
  aiFallback?: AiConfig[];
  /** 知識庫搜尋流程與向量模型（跟客服同一套） */
  search?: SearchSettings;
  embedAi?: EmbedConfig | null;
  kbVer?: string;
  history?: { u: boolean; t: string }[];
  /** 這個人可以提出的寫入動作（addMemo、logFollowUp…） */
  writable?: string[];
  /** 等待確認的修改（摘要） */
  pending?: string;
  today?: string;
  memory?: { enabled: boolean; maxItems: number; confirm: boolean; canShared: boolean; categories: string[]; items: StaffMemoryItem[] };
}

/** 名片上讀到的欄位 */
export interface CardFields {
  name?: string;
  title?: string;
  company?: string;
  phone?: string;
  companyPhone?: string;
  fax?: string;
  email?: string;
  address?: string;
  taxId?: string;
  website?: string;
  note?: string;
  confidence?: string;
}

export interface StaffWrite {
  action: string;
  data: Record<string, unknown>;
}

const TIMEOUT_MS = 25_000;

/** 員工助理的操作用員工金鑰，其餘（客服）用客服金鑰：管理系統那邊每把金鑰只能做自己那一邊的事 */
const STAFF_OPS = new Set(["start", "call", "stage", "commit", "cancel", "remember", "forget", "unfollow", "memory", "audit", "cards", "pushTargets"]);

async function post<T>(body: Record<string, unknown>, retry = true): Promise<T> {
  const staff = STAFF_OPS.has(String(body.op));
  const secret = staff ? config.gas.staffSecret : config.gas.csSecret;
  if (!config.gas.url || !secret) throw new GasError(`機器人還沒設定 GAS_URL / ${staff ? "BOT_STAFF_SECRET" : "BOT_CS_SECRET"}`, "CONFIG");
  let text = "";
  let status = 0;
  try {
    // Apps Script 會先 302 轉址再回傳內容（fetch 會自動跟著轉址）
    const response = await fetch(config.gas.url, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "bot", secret, ...body }),
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    status = response.status;
    text = await response.text();
  } catch (error) {
    if (retry) return post<T>(body, false);
    throw new GasError(`連不上管理系統：${(error as Error).message}`, "NETWORK");
  }

  let json: { success?: boolean; data?: T; message?: string; code?: string };
  try {
    json = JSON.parse(text);
  } catch {
    // Google 偶爾回傳錯誤頁（404 / 500），都是查詢，重試一次沒有副作用
    if (retry) return post<T>(body, false);
    throw new GasError(`管理系統回應格式錯誤（${status}）`, "FORMAT");
  }
  if (!json.success) throw new GasError(json.message || "管理系統錯誤", json.code || "");
  return json.data as T;
}

export const gas = {
  csStart(lineUserId: string): Promise<CsInfo> {
    return post<CsInfo>({ op: "csStart", lineUserId, botUrl: config.botUrl });
  },
  csRemember(lineUserId: string, turns: { u: boolean; t: string }[], displayName = "", topic = "", extra: { askedContact?: boolean; images?: { url: string; caption: string }[] } = {}): Promise<number> {
    return post<number>({ op: "csRemember", lineUserId, turns, displayName, topic, ...extra });
  },
  /** 客人留下聯繫資料（網站表單或 AI 聽到客人主動留） */
  csLead(lineUserId: string, lead: { name?: string; company?: string; phone?: string; email?: string; note?: string; source?: "form" | "ai" }): Promise<boolean> {
    return post<boolean>({ op: "csLead", lineUserId, ...lead });
  },
  csForget(lineUserId: string): Promise<boolean> {
    return post<boolean>({ op: "csForget", lineUserId });
  },
  csHandoff(lineUserId: string, displayName: string, text: string, topic = ""): Promise<boolean> {
    return post<boolean>({ op: "csHandoff", lineUserId, displayName, text, topic });
  },
  csKnowledge(): Promise<KnowledgeChunk[]> {
    return post<KnowledgeChunk[]>({ op: "csKnowledge" });
  },
  /** 知識庫向量（分頁取用） */
  csVectors(after = 0, limit = 300): Promise<{ model: string; items: { id: string; v: number[] }[]; total: number; next: number }> {
    return post({ op: "csVectors", after, limit });
  },
  /** 選型計算用的相機 / 鏡頭型錄（不含價格；客服要產品來源有開才有資料） */
  csCalcCatalog(): Promise<import("./calc.js").Catalog> {
    return post({ op: "csCalcCatalog" });
  },
  /** 網站客服視窗的公開設定 */
  csWidget(): Promise<WidgetConfig> {
    return post<WidgetConfig>({ op: "csWidget" });
  },
  /** 網站訪客的對話：after = 最後一則的編號（只回新的）；不帶 = 最近的對話 */
  csThread(lineUserId: string, after = 0): Promise<{ messages: ThreadMessage[]; paused: boolean }> {
    return post({ op: "csThread", lineUserId, after });
  },

  // ---- 員工助理（U = LINE 員工，W = 網站登入帳號）----
  staffStart(lineUserId: string, profile: { displayName?: string; pictureUrl?: string } = {}): Promise<StaffInfo> {
    return post<StaffInfo>({ op: "start", lineUserId, displayName: profile.displayName ?? "", pictureUrl: profile.pictureUrl ?? "", botUrl: config.botUrl });
  },
  /** 查詢（依這個人的權限過濾；沒權限會丟出錯誤） */
  /** 名片照片讀出來的欄位放進收件匣；回傳每張的編號、重複提醒與待整理張數 */
  staffCards(lineUserId: string, cards: CardFields[]): Promise<{ added: { id: number; name?: string; title?: string; company?: string; phone?: string; email?: string; duplicateOf?: number; existingCustomer?: string }[]; pending: number; batchNote?: string }> {
    return post({ op: "cards", lineUserId, cards });
  },
  staffCall(lineUserId: string, call: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return post({ op: "call", lineUserId, call, params });
  },
  /** 回報機器人伺服器自己做的事（搜尋知識庫、選型計算），記進管理系統的「助理紀錄」備忘錄。失敗不影響助理。 */
  async staffAudit(lineUserId: string, kind: "read" | "write" | "info", text: string): Promise<void> {
    try {
      await post({ op: "audit", lineUserId, kind, text });
    } catch (error) {
      console.warn("助理紀錄回報失敗", (error as Error).message);
    }
  },
  /** 提出要寫入的修改：驗證後暫存 15 分鐘，本人確認才寫入 */
  staffStage(lineUserId: string, ops: StaffWrite[]): Promise<{ token: string; summary: string }> {
    return post({ op: "stage", lineUserId, ops });
  },
  staffCommit(lineUserId: string, token: string): Promise<{ summary: string; count: number; results: Record<string, unknown>[] }> {
    return post({ op: "commit", lineUserId, token });
  },
  staffCancel(lineUserId: string): Promise<boolean> {
    return post<boolean>({ op: "cancel", lineUserId });
  },
  staffRemember(lineUserId: string, turns: { u: boolean; t: string }[]): Promise<number> {
    return post<number>({ op: "remember", lineUserId, turns });
  },
  staffForget(lineUserId: string): Promise<boolean> {
    return post<boolean>({ op: "forget", lineUserId });
  },
  staffUnfollow(lineUserId: string): Promise<boolean> {
    return post<boolean>({ op: "unfollow", lineUserId });
  },
  /** 長期記憶：新增 / 修改 / 刪除 */
  staffMemory(lineUserId: string, data: Record<string, unknown>): Promise<{ id: number; duplicate?: boolean; deleted?: boolean }> {
    return post({ op: "memory", lineUserId, data });
  },
  /** 要推早報的成員編號 */
  staffPushTargets(): Promise<string[]> {
    return post<string[]>({ op: "pushTargets" });
  },
};
