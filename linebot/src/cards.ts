import { generate, type ImageData } from "./ai.js";
import type { AiConfig, CardFields } from "./gas.js";

// 名片辨識：員工在 LINE 傳名片照片（單張或一次多張），用支援圖片輸入的模型（Gemini / Claude / GPT-4o…）讀出欄位。
// 讀出來的結果先放進「名片收件匣」，同事說「整理名片」、確認後才整批存成客戶與聯絡窗口，不會直接寫進客戶資料。

const CARD_PROMPT = [
  "你是名片辨識員。圖片裡有一張或多張名片（也可能不是名片）。逐張讀出名片上印的文字，整理成 JSON。",
  "規則：",
  "1. 只寫名片上真的看得到的字；看不清楚或沒有的欄位留空字串，不要猜、不要補全、不要編造。數字（電話、統編、分機）要一個字一個字照抄。",
  "2. 姓名和公司：同時有中英文時，姓名與公司以中文為主，英文姓名放 note；只有英文就寫英文。公司要寫全名（含「股份有限公司」「有限公司」等，名片上有印就照抄）。",
  "3. phone = 手機（09 開頭，或標示 Mobile / 手機 / M）；companyPhone = 公司市話（Tel / 電話 / T）；fax = 傳真；有分機就接在後面，例如 03-1234567#123。",
  "4. 電話保留原本的格式與開頭的 0。taxId 統一編號是 8 位數字（名片上有印才寫）。",
  "5. title = 職稱；address = 公司地址；website = 網址；email 小寫；note 放其他重要資訊（英文姓名、LINE ID、其他分公司…），沒有就留空。",
  "6. 同一張名片正反面都在圖裡，合併成一張。一張圖有好幾張名片就輸出好幾筆。",
  '7. confidence：整張都清楚 = high、部分模糊 = medium、很多地方看不清楚 = low。',
  '只輸出 JSON，不要其他文字：{"cards":[{"name":"","title":"","company":"","phone":"","companyPhone":"","fax":"","email":"","address":"","taxId":"","website":"","note":"","confidence":"high"}]}。圖片裡看不到任何名片就輸出 {"cards":[]}。',
].join("\n");

const FIELDS: (keyof CardFields)[] = ["name", "title", "company", "phone", "companyPhone", "fax", "email", "address", "taxId", "website", "note", "confidence"];

/** 把模型回的文字解析成名片欄位；格式不對回傳 null。每個欄位只留字串、去頭尾空白、限制長度。 */
export function parseCards(text: string): CardFields[] | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let json: { cards?: unknown };
  try {
    json = JSON.parse(m[0]) as { cards?: unknown };
  } catch {
    return null;
  }
  if (!Array.isArray(json.cards)) return null;
  const out: CardFields[] = [];
  for (const raw of json.cards.slice(0, 10)) {
    if (!raw || typeof raw !== "object") continue;
    const card: CardFields = {};
    for (const k of FIELDS) {
      const v = (raw as Record<string, unknown>)[k];
      if (typeof v === "string" || typeof v === "number") card[k] = String(v).trim().slice(0, k === "note" || k === "address" ? 200 : 80);
    }
    if (card.email) card.email = card.email.toLowerCase();
    if (card.name || card.company || card.phone || card.email) out.push(card);
  }
  return out;
}

export class CardError extends Error {}

/** 讀名片照片。AI 沒有圖片輸入能力或服務失敗丟出 CardError（訊息可以直接給同事看）。 */
export async function extractCards(ai: AiConfig, fallback: AiConfig[] | undefined, images: ImageData[]): Promise<CardFields[]> {
  let text: string;
  try {
    text = await generate({
      ai,
      fallback,
      system: CARD_PROMPT,
      turns: [{ isUser: true, text: "請辨識這張圖片裡的名片。", images }],
    });
  } catch (error) {
    throw new CardError(`名片辨識失敗：${(error as Error).message.slice(0, 120)}。請確認「BOT 設定 → AI 模型」用的是支援圖片輸入的模型（例如 Gemini 2.5、Claude、GPT-4o）。`);
  }
  const cards = parseCards(text);
  if (!cards) throw new CardError("名片辨識的結果看不懂，請重傳一次（拍清楚、整張入鏡、光線充足）。");
  return cards;
}

/** 收進收件匣後回覆給同事看的摘要 */
export function cardIntakeReply(added: { id: number; name?: string; title?: string; company?: string; phone?: string; email?: string; duplicateOf?: number; existingCustomer?: string }[], pending: number, batchNote = ""): string {
  const lines = added.map((c) => {
    const who = `${c.name || "（沒讀到姓名）"}${c.title ? ` ${c.title}` : ""}｜${c.company || "（沒讀到公司）"}`;
    const contact = [c.phone, c.email].filter(Boolean).join("｜");
    const warn = [
      c.duplicateOf ? `⚠️ 跟收件匣 #${c.duplicateOf} 重複` : "",
      !c.company ? "⚠️ 沒有公司名稱，存入前要補" : "",
      c.existingCustomer ? `（${c.existingCustomer} 已是客戶，會新增為聯絡窗口）` : "",
    ].filter(Boolean).join(" ");
    return `・#${c.id} ${who}${contact ? `\n   ${contact}` : ""}${warn ? `\n   ${warn}` : ""}`;
  });
  return [
    `📇 讀到 ${added.length} 張名片，已放進收件匣：`,
    ...lines,
    "",
    `📥 收件匣待整理共 ${pending} 張${batchNote ? `（註記：${batchNote}）` : ""}。可以繼續傳照片；傳完到網站的「名片客戶專區」核對（辨識錯的可以自己編輯），再逐張「登入成客戶 / 建立案件」；也可以對我說「整理名片」，我整批整理給你確認。`,
  ].join("\n");
}
