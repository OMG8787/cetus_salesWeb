import type { Tool } from "./ai.js";
import { MAX_CHOICE_LENGTH, MAX_CHOICES } from "./line.js";

// 像真人一樣回覆（參考 EggBot）：
//   1. 收到訊息就顯示「輸入中…」，而且至少等幾秒才回（BOT 管理設定），不會秒回
//   2. 問題模稜兩可時不要猜：用一句話反問，下方附上選項按鈕，點按鈕就等於回答

/** 從收到訊息起至少等 seconds 秒（最多 10 秒）；處理得比較久就不再多等 */
export async function humanPause(receivedAt: number, seconds = 0): Promise<void> {
  const wait = receivedAt + Math.min(10, Math.max(0, Number(seconds) || 0)) * 1000 - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}

/** 給 AI 的「反問並附上選項按鈕」工具；選好的選項放進 choices（回覆時變成快速回覆按鈕） */
export function choicesTool(choices: string[], examples: string): Tool {
  return {
    name: "offer_choices",
    description:
      `對方的問題或要求模稜兩可、要從幾個選項中選一個時使用（例如 ${examples}）：` +
      `回覆裡用一句話反問，同時用這個工具提供 2～${MAX_CHOICES} 個選項按鈕，對方點按鈕就等於回答。` +
      `選項要簡短具體（${MAX_CHOICE_LENGTH} 字內）。已經知道答案、不需要選擇時不要使用。`,
    parameters: {
      type: "object",
      properties: { options: { type: "array", items: { type: "string" }, description: `2～${MAX_CHOICES} 個選項` } },
      required: ["options"],
    },
    handler: async (args) => {
      const options = [...new Set((Array.isArray(args.options) ? args.options : []).map((o) => String(o).trim().slice(0, MAX_CHOICE_LENGTH)).filter(Boolean))]
        .slice(0, MAX_CHOICES);
      if (options.length < 2) return "失敗：至少要 2 個不同的選項";
      choices.splice(0, choices.length, ...options);
      return `已附上 ${options.length} 個選項按鈕：${options.join("、")}。請在回覆裡用一句話反問對方要選哪一個（按鈕會顯示在訊息下方），不要再把選項逐條列出。`;
    },
  };
}
