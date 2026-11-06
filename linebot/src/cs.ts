import { embed, generate, type Tool, type Turn } from "./ai.js";
import { calcTool, CALC_RULES } from "./calc-tool.js";
import { cleanReply, processEvents } from "./common.js";
import { gas, type CsInfo, type CsStyle, type CsTopic, type EmbedConfig } from "./gas.js";
import { imageUrl, type ReplyImage } from "./img.js";
import { choicesTool, humanPause } from "./human.js";
import { channels, getProfile, MAX_CHOICES, replyText, showLoading, type LineEvent } from "./line.js";
import { DEFAULT_SEARCH, formatHits, KnowledgeIndex, loadVectorMap, searchKnowledge, type Hit, type SearchConfig, type SearchResult } from "./rag.js";
import { nowLocal } from "./time.js";

// 客服機器人（對外 LINE 官方帳號 + 網站右下角客服視窗，同一套邏輯）：任何人都能問
//   每次先從知識庫找出跟問題相關的段落（RAG），只根據這些內容回答；看不到任何內部資料
//   客人說轉真人關鍵字（預設「真人」「小編」…），或問到 BOT 設定「交給真人回答」的問題（例如價格）
//   → 回覆轉真人的文字、通知有 BOT 權限的同事，並暫停機器人一段時間讓小編接手
//   以上都可以在網站「BOT 設定 → 客服機器人」設定

const DEFAULT_HANDOFF = ["真人", "客服人員", "小編", "專人", "人工", "業務"];
const DEFAULT_STYLE: CsStyle = { tone: "friendly", address: "您", emoji: "some", maxLines: 5 };
const TONES: Record<CsStyle["tone"], string> = {
  friendly: "口吻親切、溫暖有禮",
  formal: "口吻專業正式、有禮貌",
  concise: "口吻簡潔直接、只講重點",
};
const EMOJIS: Record<CsStyle["emoji"], string> = {
  many: "多用 emoji 讓語氣活潑",
  some: "適度使用 emoji",
  none: "不要使用 emoji",
};
const RESET_WORDS = ["重新開始", "/reset"];
const KNOWLEDGE_TTL_MS = 5 * 60_000;
const TOP_K = 6;

const ch = () => channels.cs;

let cached: { at: number; index: KnowledgeIndex; ver?: string } | null = null;

/**
 * 知識庫（同一個執行個體內快取 5 分鐘）。管理系統每次回傳的設定都帶著「知識庫版本號」：
 * 版本號變了（後台新增 / 修改 / 刪除知識）就馬上重讀，不用等快取過期，刪掉的資料不會再被找到。
 */
export async function knowledge(force = false, ver?: string): Promise<KnowledgeIndex> {
  if (!force && cached && Date.now() - cached.at < KNOWLEDGE_TTL_MS && (!ver || cached.ver === ver)) return cached.index;
  const chunks = await gas.csKnowledge();
  const index = new KnowledgeIndex(chunks, await loadVectorMap(chunks, (after, limit) => gas.csVectors(after, limit)));
  cached = { at: Date.now(), index, ver };
  return index;
}

let catalogCache: { at: number; ver?: string; value: Promise<import("./calc.js").Catalog> } | null = null;
/**
 * 選型計算用的型錄（客服版：不含價格）。同一個執行個體內快取 5 分鐘、知識庫版本號變了就重讀；
 * 型錄讀進記憶體後，算選型就是「AI 整理參數 → 程式查型錄算前三名 → AI 重述」，不再碰試算表。
 */
function catalogOnce(ver?: string): Promise<import("./calc.js").Catalog> {
  if (catalogCache && Date.now() - catalogCache.at < KNOWLEDGE_TTL_MS && (!ver || catalogCache.ver === ver)) return catalogCache.value;
  const value = gas.csCalcCatalog();
  value.catch(() => {
    catalogCache = null;
  });
  catalogCache = { at: Date.now(), ver, value };
  return value;
}

/** 看起來是選型計算的問題（視野、工作距離、精度、解析度、相機、鏡頭…）：先在背景載入型錄，等 AI 整理好參數時已經在記憶體裡 */
const CALC_HINT = /視野|FOV|WD|工作距離|精度|解析度|畫素|像素|相機|鏡頭|選型|焦距|倍率|飛拍|曝光|[uµμ]m|mm|\d\s*[x×*]\s*\d/i;

/** 依 BOT 設定的搜尋流程找知識庫（問題轉向量失敗會自動退回關鍵字，不會讓客人沒有回覆） */
export async function runSearch(index: KnowledgeIndex, query: string, search: SearchConfig | undefined, embedAi: EmbedConfig | null | undefined): Promise<SearchResult> {
  const cfg = { ...DEFAULT_SEARCH, ...search };
  return searchKnowledge(index, query, cfg, embedAi ? async (q) => (await embed(embedAi, [q], "query"))[0] : undefined);
}

export function resetKnowledgeCache(): void {
  cached = null;
  catalogCache = null;
}

const squash = (s: string) => s.toLowerCase().replace(/\s+/g, "");
export const callWord = (info: CsInfo) => (info.handoffWords?.length ? info.handoffWords : DEFAULT_HANDOFF)[0];

/** 訊息裡有沒有這些關鍵字（不分大小寫、忽略空白） */
export function hasWord(text: string, words: string[]): boolean {
  const t = squash(text);
  return words.some((w) => squash(w) && t.includes(squash(w)));
}

/** 問到哪一個「交給真人回答」的問題：命中最多關鍵字的那一類 */
export function matchTopic(text: string, topics: CsTopic[] = []): CsTopic | undefined {
  const t = squash(text);
  let best: CsTopic | undefined, most = 0;
  for (const topic of topics) {
    const n = topic.words.filter((w) => squash(w) && t.includes(squash(w))).length;
    if (n > most) { best = topic; most = n; }
  }
  return best;
}

/** 轉真人時的回覆：問到指定問題用「主題回覆」＋請客人留資料（放後面或前面），其他用「找真人回覆」；小編休息時間再加註 */
export function handoffReply(info: CsInfo, topic = ""): string {
  const t = topic ? (info.topics ?? []).find((x) => x.name === topic) : undefined;
  const base = t
    ? (info.topicText || "這個問題（{主題}）由專人為您回覆，已經通知同仁囉，請稍候 🙏").replaceAll("{主題}", topic)
    : info.handoffText || "🙏 已經通知專人，營業時間內會盡快回覆您，請稍候！";
  const ask = t?.ask?.trim() ?? "";
  const parts = t?.askPos === "before" ? [ask, base] : [base, ask];
  if (info.inHours === false) parts.push(info.offText || `⏰ 目前是專人休息時間（服務時間：${info.hoursText}），上班後會盡快回覆您。`);
  return parts.filter(Boolean).join("\n\n");
}

export function csSystemPrompt(info: CsInfo, references: string): string {
  const t = nowLocal();
  const st = { ...DEFAULT_STYLE, ...info.style };
  const call = callWord(info);
  const topics = info.topics ?? [];
  const unsure = info.unsure === "handoff"
    ? "誠實說不確定，並呼叫 transfer_to_human（topic 填「資料裡沒有的問題」）交給專人"
    : `誠實說不確定，請客人輸入「${call}」由專人回覆`;
  return [
    `你是「${info.brand}」的線上客服。使用繁體中文（台灣用語），${TONES[st.tone] ?? TONES.friendly}，稱呼客人「${st.address}」。`,
    `現在是 ${t.date}（星期${t.weekday}）${t.time}。`,
    info.hoursText ? `專人（真人客服）服務時間：${info.hoursText}。` : "",
    "",
    "【規則】",
    `1. 只能根據下面【參考資料】回答（產品與規格、常見問題、公司資訊）；資料裡沒有的，${unsure}，絕對不要自己編造規格、價格、庫存、交期、客戶名稱或承諾。`,
    "2. 參考資料不夠時，可以用 search_knowledge 換個關鍵字再找一次。之前對話裡你自己說過的話不算參考資料（資料可能已經更新或刪除）：每次都只能根據這次的【參考資料】回答，這次找不到就當作沒有，不要沿用之前的回答。",
    "3. 不要提到「參考資料」「知識庫」「系統」這些字，像真人客服一樣自然回答。",
    `4. 回覆會顯示在聊天視窗：不要用 Markdown（不要用 **粗體**、# 標題、表格），用「・」條列，${EMOJIS[st.emoji] ?? EMOJIS.some}，盡量 ${st.maxLines} 行以內。`,
    `5. 報價、價格、折扣、交期、下訂、退換貨、客訴或客人要找人時，請他輸入「${call}」，由專人處理；你不能報價，也不要說出任何價格或金額。`,
    "6. 客人的問題模稜兩可（沒說哪個產品、哪個應用）時不要猜，用 offer_choices 給選項按鈕並用一句話反問。",
    CALC_RULES,
    topics.length
      ? `7. 以下問題不要自己回答，一律呼叫 transfer_to_human（topic 填問題類型）交給專人，就算參考資料裡有答案也一樣（這條優先於其他規則）：${topics.map((x) => x.name).join("、")}。`
      : "",
    info.sendImages !== false
      ? "8. 參考資料標有「可附圖片」，而且客人問的內容用得到那張圖（架構圖、示意圖、接線圖…）、或客人要看圖時，呼叫 send_image 把圖傳給客人，並用一句話說明這張圖；只能傳這次參考資料標的圖片，不要自己貼圖片網址。"
      : "",
    (info.contactAfter ?? 0) > 0
      ? "9. 客人主動說了自己的姓名、公司、電話或 Email，或答應留下聯繫資料時，呼叫 save_contact 記下來（至少要有電話或 Email）；不要主動追問、也不要逼對方留資料。"
      : "",
    "10. 客人只是打招呼、閒聊，或你根據參考資料沒辦法回答（不確定）時，呼叫 offer_quick_actions，畫面下方會附上「轉真人客服」「找相機」「找鏡頭」按鈕；回覆內容照原本規則寫（打招呼就簡短問候並問需要什麼協助），不要自己把這三個按鈕寫進文字。",
    info.prompt ? `\n【公司規則（管理員設定，優先遵守）】\n${info.prompt}` : "",
    "",
    "【參考資料】",
    references || "（沒有找到相關資料）",
  ].join("\n");
}

/** AI 判斷要交給真人時呼叫（關鍵字沒抓到、但意思是指定的問題；或找不到答案） */
function transferTool(info: CsInfo, handed: { topic: string | null }): Tool {
  const names = (info.topics ?? []).map((t) => t.name);
  return {
    name: "transfer_to_human",
    description:
      "把問題交給專人（真人客服）回答：問到規則指定交給真人的問題" + (info.unsure === "handoff" ? "，或參考資料裡找不到答案" : "") +
      "時呼叫。呼叫後系統會自動回覆客人並通知同仁，你不用再回答問題。",
    parameters: {
      type: "object",
      properties: { topic: { type: "string", description: "問題類型" + (names.length ? `（${names.join("、")}，或「資料裡沒有的問題」）` : "") } },
      required: ["topic"],
    },
    handler: async (a) => {
      handed.topic = String(a.topic ?? "").trim() || "需要專人協助";
      return "已轉給專人，請直接結束，不用再回覆內容。";
    },
  };
}

/** 打招呼（短短一句問候）：網站視窗下方改附「轉真人客服 / 找相機 / 找鏡頭」按鈕 */
export function isGreeting(text: string): boolean {
  const t = text.trim();
  return t.length > 0 && t.length <= 12 && /^(你好|您好|哈囉|哈啰|哈嘍|嗨|hi|hello|hey|早安|午安|晚安|安安|在嗎|在吗)/i.test(t);
}

/** AI 判斷是打招呼 / 不確定時呼叫：網站視窗下方附上快捷按鈕（轉真人客服、找相機、找鏡頭） */
function quickActionsTool(flag: { on: boolean }): Tool {
  return {
    name: "offer_quick_actions",
    description: "客人只是打招呼、閒聊，或你根據參考資料沒辦法回答（不確定）時呼叫：回覆下方會附上「轉真人客服」「找相機」「找鏡頭」按鈕。呼叫後照常回覆文字。",
    parameters: { type: "object", properties: {} },
    handler: async () => {
      flag.on = true;
      return "已附上快捷按鈕，請照常回覆（不要在文字裡列出這三個按鈕）。";
    },
  };
}

const MAX_REPLY_IMAGES = 3;

/** 把這次找到的資料附的圖片（架構圖、示意圖）直接傳給客人；只能傳這次檢索到的資料附的圖 */
export function imageTool(seen: Hit[], images: ReplyImage[]): Tool {
  return {
    name: "send_image",
    description: `把參考資料附的圖片（架構圖、示意圖…）直接傳給客人。客人問的內容剛好有對應的圖、或要求看圖時使用；ref 照參考資料括號裡寫的給（例如 k12#0）。一次最多 ${MAX_REPLY_IMAGES} 張，不相關的圖不要傳。`,
    parameters: { type: "object", properties: { ref: { type: "string", description: "圖片編號，例如 k12#0" } }, required: ["ref"] },
    handler: async (a) => {
      const m = String(a.ref ?? "").trim().match(/^(.+)#(\d+)$/);
      const im = m ? seen.find((h) => h.chunk.id === m[1])?.chunk.images?.[Number(m[2])] : undefined;
      if (!m || !im) return "失敗：沒有這張圖片，請照參考資料裡「可附圖片」寫的編號（只能傳這次找到的資料附的圖）";
      const url = imageUrl(im.id);
      if (!url) return "失敗：機器人網址還沒設定，現在沒辦法傳圖片，請改用文字說明";
      if (images.some((x) => x.url === url)) return "這張圖片已經附上了";
      if (images.length >= MAX_REPLY_IMAGES) return `已經附了 ${MAX_REPLY_IMAGES} 張圖片，不能再多了`;
      images.push({ url, caption: im.caption });
      return `已附上圖片「${im.caption || "圖片"}」，會顯示在你的回覆下方；回覆裡用一句話說明這張圖即可，不要貼網址。`;
    },
  };
}

/** 客人主動留下聯繫資料時，記給專人（存進後台「聯繫名單」並通知同仁） */
export function leadTool(uid: string, state: { saved: boolean }): Tool {
  return {
    name: "save_contact",
    description: "客人主動提供（或答應留下）自己的聯繫資料時呼叫，記給專人日後聯繫。至少要有電話或 Email；有幾項就填幾項，不要自己編。",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "姓名" },
        company: { type: "string", description: "公司" },
        phone: { type: "string", description: "電話" },
        email: { type: "string", description: "Email" },
        note: { type: "string", description: "需求或備註（一句話）" },
      },
    },
    handler: async (a) => {
      const f = (k: string) => String(a[k] ?? "").trim();
      try {
        await gas.csLead(uid, { name: f("name"), company: f("company"), phone: f("phone"), email: f("email"), note: f("note"), source: "ai" });
        state.saved = true;
        return "已記下，專人之後會聯繫對方。回覆裡謝謝對方即可。";
      } catch (error) {
        return `沒有記下：${(error as Error).message}。請把原因告訴對方，請他補上。`;
      }
    },
  };
}

/** 再找一次知識庫的工具 */
export function searchTool(run: (query: string) => Promise<Hit[]>, seen?: Hit[]): Tool {
  return {
    name: "search_knowledge",
    description: "用其他關鍵字或換個說法再找一次參考資料（產品與規格、常見問題、文件、公司資訊）",
    parameters: { type: "object", properties: { query: { type: "string", description: "關鍵字或完整的問題" } }, required: ["query"] },
    handler: async (a) => {
      const hits = await run(String(a.query ?? ""));
      seen?.push(...hits); // 給「回覆前檢查」一起看
      return formatHits(hits) || "沒有找到相關資料";
    },
  };
}

// ---- 回覆前檢查：回覆裡每個事實都要能在這次的參考資料找到根據（預設關閉，BOT 設定 → 總覽打開；出錯一律當作不通過）----
const GROUND_PROMPT = [
  "你是客服回覆的檢查員。檢查【回覆】裡提到的每一個事實（價格、金額、日期、時間、地點、數量、規定、規格、型號、做法、優惠、承諾）是否都能在【參考資料】找到根據。",
  "【回覆】裡如果有「選型計算」的結果（需求像素、焦距、倍率、視野、建議的相機 / 鏡頭型號），那是系統計算工具算出來的，視為有根據。",
  "打招呼、客套話、道歉、請客人留資料、建議找真人、反問釐清問題，不需要根據。換句話說、摘要都可以，只要意思跟參考資料一致。",
  "只要有一個事實在參考資料裡找不到、或跟參考資料不一致，就不通過。【客人最近的問題】只用來理解接續的問題（例如「那另一款呢？」），不能當作根據。",
  '只輸出 JSON，不要其他文字：{"ok":true} 或 {"ok":false,"reason":"哪一句沒有根據"}',
].join("\n");

export async function groundCheck(info: CsInfo, questions: string[], refs: string, reply: string): Promise<{ ok: boolean; reason: string }> {
  try {
    const out = await generate({
      ai: info.checkAi ?? info.ai!,
      fallback: info.aiFallback,
      system: GROUND_PROMPT,
      turns: [{ isUser: true, text: `【客人最近的問題】\n${questions.join("\n")}\n\n【參考資料】\n${refs || "（沒有找到相關資料）"}\n\n【回覆】\n${reply}` }],
    });
    const m = out.match(/\{[\s\S]*\}/);
    if (!m) return { ok: false, reason: "檢查員的回覆看不懂" };
    const j = JSON.parse(m[0]) as { ok?: unknown; reason?: unknown };
    return { ok: j.ok === true, reason: String(j.reason ?? "") };
  } catch (error) {
    console.warn("回覆檢查失敗（當作不通過）", (error as Error).message);
    return { ok: false, reason: "檢查失敗" };
  }
}

/** 用知識庫回答一個問題：reply = 回覆、choices = 選項按鈕、handed = AI 判斷要交給真人（問題類型） */
export async function csAnswer(info: CsInfo, text: string, history: { u: boolean; t: string }[], uid = ""): Promise<{ reply: string; choices: string[]; handed: string | null; blocked?: string; images: ReplyImage[]; leadSaved: boolean; quickActions: boolean }> {
  if (CALC_HINT.test(text)) void catalogOnce(info.kbVer).catch(() => undefined); // 選型問題：型錄先在背景載入，跟知識庫檢索同時進行
  const index = await knowledge(false, info.kbVer);
  const choices: string[] = [];
  const images: ReplyImage[] = [];
  const lead = { saved: false };
  const handed: { topic: string | null } = { topic: null };
  const quick = { on: false };
  // 檢索時連同上一個問題一起找（「那另一款呢？」這種接續問題）
  const lastUser = [...history].reverse().find((h) => h.u)?.t ?? "";
  const query = text.length < 10 && lastUser ? `${lastUser} ${text}` : text;
  const search = { ...DEFAULT_SEARCH, ...info.search, topK: info.search?.topK ?? TOP_K };
  const hits = (await runSearch(index, query, search, info.embedAi)).hits;

  const seen: Hit[] = [...hits];
  const tools: Tool[] = [searchTool(async (q) => (await runSearch(index, q, search, info.embedAi)).hits, seen), calcTool(() => catalogOnce(info.kbVer)), choicesTool(choices, "「這個怎麼用」沒說哪一款產品、「有沒有支援」不知道是哪個應用")];
  tools.push(quickActionsTool(quick));
  if (info.topics?.length || info.unsure === "handoff") tools.push(transferTool(info, handed));
  if (info.sendImages !== false) tools.push(imageTool(seen, images));
  if ((info.contactAfter ?? 0) > 0 && uid) tools.push(leadTool(uid, lead));

  const turns: Turn[] = [...history.map((h) => ({ isUser: h.u, text: h.t })), { isUser: true, text }];
  let reply: string;
  try {
    reply = cleanReply(await generate({ ai: info.ai!, fallback: info.aiFallback, system: csSystemPrompt(info, formatHits(hits)), turns, tools }));
    if (!reply) {
      reply = `不好意思，這個問題我不太確定，需要專人協助請輸入「${callWord(info)}」🙏`;
      quick.on = true;
    }
  } catch (error) {
    console.error("客服 AI 回覆失敗", error);
    reply = `不好意思，系統忙碌中，請稍後再問一次，或輸入「${callWord(info)}」由專人回覆 🙏`;
    return { reply, choices, handed: handed.topic, images: [], leadSaved: false, quickActions: true };
  }
  // 回覆前檢查（沒開、或這則本來就要轉真人時不檢查）：沒有根據就不送出，改請客人找專人（或直接轉專人）
  if (info.groundCheck && handed.topic === null) {
    const questions = [...history.filter((h) => h.u).slice(-2).map((h) => h.t), text];
    const check = await groundCheck(info, questions, formatHits(seen), reply);
    if (!check.ok) {
      console.warn("客服回覆沒有知識庫根據，已攔下", check.reason);
      if (info.unsure === "handoff") return { reply, choices: [], handed: "知識庫找不到根據", blocked: check.reason, images: [], leadSaved: false, quickActions: false };
      return { reply: `不好意思，這個問題我不太確定，需要專人協助請輸入「${callWord(info)}」🙏`, choices: [], handed: null, blocked: check.reason, images: [], leadSaved: false, quickActions: true };
    }
  }
  return { reply, choices, handed: handed.topic, images, leadSaved: lead.saved, quickActions: quick.on };
}

export type CsChannel = "line" | "web" | "test";

export interface CsResult {
  /** 沒有回覆（沒啟用、專人服務時間、小編接手中）；paused 時網站視窗會開始輪詢專人的回覆 */
  silent: boolean;
  paused: boolean;
  reply: string;
  choices: string[];
  /** 這次有轉給真人（問題類型；空字串 = 客人要求） */
  handoff: string | null;
  info: CsInfo;
  /** 這則回覆附的圖片（知識庫的架構圖 / 示意圖） */
  images: ReplyImage[];
  /** 該請客人留聯繫資料了（聊到設定的段數、還沒留過）：網站視窗跳出表單；LINE 已經把請求附在回覆文字後面 */
  askContact: boolean;
  /** 每則回覆下方要不要附「轉真人」按鈕 */
  handoffButton: boolean;
  /** 打招呼 / 不確定時：網站視窗附上「轉真人客服 / 找相機 / 找鏡頭」快捷按鈕 */
  quickActions: boolean;
}

const NO_REPLY = (info: CsInfo, paused = false): CsResult => ({ silent: true, paused, reply: "", choices: [], handoff: null, info, images: [], askContact: false, handoffButton: false, quickActions: false });

/** LINE 沒辦法跳出表單，聊到設定的段數就在回覆後面直接請客人留資料 */
export const CONTACT_ASK_TEXT = "📇 方便留下您的姓名、公司和電話 / Email 嗎？之後專人可以主動聯繫您，直接回覆就可以了 😊";

/** 「轉真人」按鈕上的字 */
export const handoffLabel = (info: CsInfo) => `🙋 轉${callWord(info)}`;

/**
 * 處理客人的一則訊息（LINE、網站視窗、後台測試共用）：
 * 沒啟用 / 專人服務時間 / 小編接手中 → 不回；重新開始；轉真人關鍵字；指定問題；知識庫 + AI 回答。
 * 回覆前不會等待（像真人打字的停頓由呼叫端用 humanPause 處理）。
 */
export async function csConverse(uid: string, text: string, opts: { channel: CsChannel; displayName?: () => Promise<string>; human?: boolean }): Promise<CsResult> {
  const info = await gas.csStart(uid);
  const testing = opts.channel === "test";
  if (!testing && (!info.enabled || !info.ai)) return NO_REPLY(info);
  if (testing && !info.ai) {
    return { ...NO_REPLY(info), silent: false, reply: "還沒有設定 AI：請先到「AI 模型」填入 API Key 並儲存。" };
  }
  if (info.rateLimited) return { ...NO_REPLY(info), silent: false, reply: "訊息傳得太快了，請稍等一下再試 🙏" };
  // 設定「只在專人服務時間以外回覆」：服務時間內交給專人（測試聊天不受限）
  if (!testing && info.replyWhen === "offHours" && info.inHours === true) return NO_REPLY(info);
  const reset = RESET_WORDS.includes(text);
  if (info.paused && !reset && !testing) return NO_REPLY(info, true);

  const name = async () => (info.known === false || opts.channel === "web" ? (await opts.displayName?.()) ?? "" : "");
  const said = opts.human ? handoffLabel(info) : text; // 客人按「轉真人」按鈕時，對話紀錄記成按鈕上的字
  const remember = async (reply: string, topic = "", extra: { askedContact?: boolean; images?: ReplyImage[] } = {}) => {
    try {
      await gas.csRemember(uid, [{ u: true, t: said }, { u: false, t: reply }], await name(), topic, extra);
    } catch (err) {
      console.warn("記錄客服對話失敗", err);
    }
  };
  const handoff = async (topic = ""): Promise<CsResult> => {
    const displayName = (await opts.displayName?.()) ?? "";
    if (!testing) await gas.csHandoff(uid, displayName, said, topic);
    const reply = handoffReply(info, topic);
    await remember(reply, topic || "找真人");
    return { silent: false, paused: !testing, reply, choices: [], handoff: topic, info, images: [], askContact: false, handoffButton: false, quickActions: false };
  };

  if (reset) {
    await gas.csForget(uid);
    return { silent: false, paused: false, reply: "好的～想問什麼都可以直接問我 😊", choices: [], handoff: null, info, images: [], askContact: false, handoffButton: info.handoffButton !== false, quickActions: false };
  }

  if (opts.human) return handoff(); // 客人按了回覆下方的「轉真人」按鈕
  if (hasWord(text, info.handoffWords?.length ? info.handoffWords : DEFAULT_HANDOFF)) return handoff();

  // 問到交給真人回答的問題（關鍵字）：不經過 AI，直接轉
  const topic = matchTopic(text, info.topics);
  if (topic) return handoff(topic.name);

  const answer = await csAnswer(info, text, info.history, uid);
  if (answer.handed !== null) return handoff(answer.handed);
  const { choices, blocked } = answer;
  const images = info.sendImages === false ? [] : answer.images;

  // 聊到設定的段數（後台「客服設定」可改，0 = 不問）還沒留過聯繫資料 → 請客人留下
  const askContact = !blocked && !answer.leadSaved && (info.contactAfter ?? 0) > 0 && (info.turnCount ?? 0) + 1 >= (info.contactAfter ?? 0) && !info.leadState;
  const reply = askContact && opts.channel === "line" ? `${answer.reply}

${CONTACT_ASK_TEXT}` : answer.reply;

  await remember(reply, blocked ? "回覆檢查未通過" : "", { askedContact: askContact, images }); // 後台對話紀錄看得出哪些問題缺資料、需要補進知識庫
  return { silent: false, paused: false, reply, choices, handoff: null, info, images, askContact, handoffButton: info.handoffButton !== false, quickActions: answer.quickActions || isGreeting(text) };
}

export async function handleCsEvent(e: LineEvent): Promise<void> {
  // 群組 / 多人聊天室：客服機器人只服務一對一
  if (e.source.type !== "user") return;
  const uid = e.source.userId;
  if (!uid) return;
  const lineId = uid; // LINE userId：U + 32 個十六進位字元

  if (e.type === "follow") {
    const info = await gas.csStart(lineId);
    if (!info.enabled) return;
    await replyText(ch(), e.replyToken, lineId,
      info.welcome || `👋 歡迎加入「${info.brand}」！\n有任何關於產品、規格、應用的問題都可以直接問我；需要專人協助請輸入「${callWord(info)}」。`,
      info.buttons ?? []);
    return;
  }

  if (e.type !== "message" || e.message?.type !== "text" || !e.message.text?.trim()) return;
  const text = e.message.text.trim();
  const receivedAt = Date.now();

  // 先顯示「輸入中…」（沒啟用 / 小編接手時 csConverse 會直接不回，這個動畫過幾秒自己消失）
  await showLoading(ch(), lineId);
  const result = await csConverse(lineId, text, { channel: "line", displayName: async () => (await getProfile(ch(), lineId)).displayName });
  if (result.silent) return;
  await humanPause(receivedAt, result.info.replyDelay);
  const buttons = result.info.buttonsAlways ? result.info.buttons ?? [] : [];
  const base = result.choices.length ? result.choices : buttons;
  // 每則回覆下方都附「轉真人」按鈕（快速回覆最多 13 個，按鈕留一個位置給它）
  const choices = result.handoffButton && !result.handoff ? [...base.slice(0, MAX_CHOICES - 1), handoffLabel(result.info)] : base;
  await replyText(ch(), e.replyToken, lineId, result.reply, choices, result.images.map((i) => i.url));
}

export function processCsEvents(events: LineEvent[]): Promise<void> {
  return processEvents(events, handleCsEvent, ch());
}
