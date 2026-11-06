import { embed, generate, type Tool, type Turn } from "./ai.js";
import { calcTool, cameraPixelTool, CALC_RULES } from "./calc-tool.js";
import { CardError, cardIntakeReply, extractCards } from "./cards.js";
import type { Catalog } from "./calc.js";
import { cleanReply, processEvents } from "./common.js";
import { DEFAULT_SEARCH, formatHits, KnowledgeIndex, loadVectorMap, searchKnowledge } from "./rag.js";
import { GasError, gas, type StaffInfo, type StaffWrite } from "./gas.js";
import { choicesTool } from "./human.js";
import { channels, downloadImage, getProfile, pushText, replyText, showLoading, type Choice, type LineEvent, type Profile } from "./line.js";
import { addDays, daysFrom, nowLocal, showDate } from "./time.js";

// 員工私人助理（員工專用的 LINE 官方帳號 + 網站右下角的「智能助理」，同一套邏輯）
//   ・員工要先被管理員在「BOT 設定 → 員工助理」開通，權限跟網站帳號同一套（編輯者 / 查看 / 特定各區塊）
//   ・查詢：只用管理系統提供的查詢（依這個人的權限過濾），AI 看不到沒有權限的資料
//   ・修改：AI 只能「提出」→ 暫存 15 分鐘 → 本人按「確認」才寫入；不能刪除任何資料
//   ・長期記憶：個人的（只有自己的助理知道）與全公司的

const ch = () => channels.staff;

const RESET_WORDS = ["重新開始", "/reset"];
const YES_WORDS = /^(確認|確定|好|好的|是|對|ok|okay|yes|y|沒問題|可以)[!！。.\s]*$/i;
const NO_WORDS = /^(取消|不要|不用|算了|不|否|no|n)[!！。.\s]*$/i;
const MAX_RESULT_CHARS = 7000;

const BLOCK_NAMES: Record<string, string> = {
  products: "產品與詢價",
  cases: "案件與評估",
  customers: "客戶與追蹤",
  files: "檔案製作",
  copy: "文案製作",
  bot: "BOT 設定",
};

export interface StaffResult {
  /** 沒有要回覆（群組、不支援的訊息） */
  silent: boolean;
  reply: string;
  /** AI 提供的選項按鈕 */
  choices: string[];
  /** 等待本人確認的修改 */
  pending: { token: string; summary: string } | null;
  info: StaffInfo | null;
}

export interface StaffInput {
  text?: string;
  /** true = 按了確認 / false = 按了取消（網站按鈕、LINE postback） */
  confirm?: boolean;
  token?: string;
  reset?: boolean;
}

// 公司知識庫（客服機器人用的那份：常見問答、文件、公司資訊，含向量）：每位已開通的同事都能查；同一個執行個體內快取 5 分鐘
const KB_TTL_MS = 5 * 60_000;
let kbCache: { at: number; index: Promise<KnowledgeIndex>; ver?: string } | null = null;

/** 知識庫（5 分鐘快取；管理系統回傳的知識庫版本號變了就馬上重讀） */
function staffKnowledge(uid: string, ver?: string): Promise<KnowledgeIndex> {
  if (kbCache && Date.now() - kbCache.at < KB_TTL_MS && (!ver || kbCache.ver === ver)) return kbCache.index;
  const index = (async () => {
    const chunks = (await gas.staffCall(uid, "kbChunks")) as ConstructorParameters<typeof KnowledgeIndex>[0];
    const vectors = await loadVectorMap(chunks, (after, limit) => gas.staffCall(uid, "kbVectors", { after, limit }) as Promise<{ items: { id: string; v: number[] }[]; total: number; next: number }>);
    return new KnowledgeIndex(chunks, vectors);
  })();
  index.catch(() => {
    kbCache = null;
  });
  kbCache = { at: Date.now(), index, ver };
  return index;
}

export function resetStaffKnowledgeCache(): void {
  kbCache = null;
}

const clip = (text: string) => (text.length > MAX_RESULT_CHARS ? text.slice(0, MAX_RESULT_CHARS) + "…（資料太多，已截斷；請用更精確的條件再查）" : text);

// ------------------------------------------------------------
// 提示詞
// ------------------------------------------------------------
export function staffSystemPrompt(info: StaffInfo): string {
  const t = nowLocal();
  const blocks = Object.entries(info.blocks ?? {})
    .filter(([k]) => BLOCK_NAMES[k])
    .map(([k, v]) => `${BLOCK_NAMES[k]}：${v === "edit" ? "可查看與修改" : v === "view" ? "只能查看" : "沒有權限"}`)
    .join("；");
  const memory = info.memory?.enabled ? info.memory.items.slice(0, info.memory.maxItems) : [];
  const memLines = memory.map((m) => `・#${m.id}［${m.category || "其他"}${m.scope === "all" ? "・全公司" : ""}］${m.content}`).join("\n");
  const w = info.writable ?? [];
  return [
    `你是「${info.appName}」的員工私人助理，現在正在幫「${info.name || "同事"}」處理工作。使用繁體中文（台灣用語），語氣親切、簡潔、像一位可靠的同事。`,
    `現在是 ${t.date}（星期${t.weekday}）${t.time}。`,
    blocks ? `這位同事的權限：${blocks}。` : "",
    "",
    "【規則】",
    "0. 公司知識庫（客服機器人回答客人用的常見問答、文件、公司資訊）用 search_knowledge 查；之前對話裡你自己說過的知識庫內容不算數（資料可能已經更新或刪除），每次都重新查；客服只看得到知識庫，同事除了知識庫還能查客戶、案件、產品等（依權限）。",
    "1. 客戶、案件、產品、行程等資料一律用工具查，不要憑印象回答，也不要編造任何客戶資料、電話、金額、規格、日期；工具查不到就老實說查不到。",
    "1-1. 公司自己的資料（地址、電話、統一編號、成立時間、人數、代理品牌、服務項目…）只能照 search_knowledge 這次查到的內容回答；沒查到就回答「知識庫裡沒有這項資料」，請同事補進知識庫，絕對不要憑你自己的記憶補數字。沒有真的呼叫過工具，就不能說「查了一下官網 / 資料庫」。",
    w.some((x) => x.startsWith("delete"))
      ? "2. 沒有權限的資料，工具會回報沒有權限，照實告訴同事需要請管理員開放，不要想辦法繞過。刪除要特別小心：只能刪你有刪除工具的資料；先用查詢工具找到確切那一筆（不確定就問，不要猜）、跟同事講清楚會刪掉什麼與「無法復原」，再用刪除工具提出，同事按確認才會執行；一次只處理同事明確要求刪的東西。"
      : "2. 沒有權限的資料，工具會回報沒有權限，照實告訴同事需要請管理員開放，不要想辦法繞過。你不能刪除任何資料（這位同事沒有刪除權限）。",
    "2.1 你做的每一件事（查詢、提出修改、刪除、被擋下的嘗試）都會記在備忘錄的「助理紀錄」讓管理員檢查，所以不要嘗試繞過權限，也不要隱瞞做過的事。",
    w.length
      ? `3. 需要新增 / 修改資料時，用提出修改的工具（${w.join("、")}）。這些工具不會立刻生效，要同事按「確認」才會寫入：所以不要說「已經完成」，說「已整理好，請確認」即可；修改清單與確認按鈕系統會自動附在你的回覆後面，你不用再把內容逐項列出一次。資訊不夠（例如沒說哪一家客戶）就先問，不要猜。`
      : "3. 這位同事沒有修改資料的權限，只能查詢；要求新增 / 修改時，請他到網站操作或請管理員開放權限。",
    `4. 日期：同事說「明天」「下週三」這類相對日期，請依今天（${t.date}，星期${t.weekday}）換算成 YYYY-MM-DD 再使用，並在回覆裡寫出換算後的日期讓他核對。`,
    "5. 回覆會顯示在聊天視窗：不要用 Markdown（不要用 **粗體**、# 標題、表格），條列用「・」，盡量簡短。",
    "6. 同事的問題模稜兩可（例如有好幾家名稱相近的客戶）時不要猜，用 offer_choices 給選項按鈕並用一句話反問。",
    "個人工作區：行事曆、工作清單、備忘錄是每個帳號各自的。新增的預設只有同事自己看得到，他明確說「分享給大家」才用 share_all；別人分享給他的只能看、不能改。需要綁定網站帳號才有行事曆與工作清單，沒綁定時照實告訴他。",
    (info.blocks?.products ?? "none") !== "none" ? CALC_RULES : "",
    (info.blocks?.products ?? "none") !== "none"
      ? "產品與詢價：問價格先用 get_product / price_history 查報價紀錄，沒有紀錄就說沒有，不要估價；要詢價先用 inquiry_draft 產生信件內容給同事看，同事要存草稿再用 create_inquiry_draft（只存草稿、不會寄出）；拿到供應商新報價用 add_price_record 記錄。底價與供應商只能對同事講，絕對不要轉述給客戶。"
      : "",
    (info.blocks?.customers ?? "none") === "edit"
      ? "名片登入：同事在 LINE 傳名片照片（單張或一次多張）時，系統已經讀出欄位放進「名片收件匣」。同事說「整理名片」「存名片」「看收件匣」時：先用 list_cards 看待整理的名片（有 existingCustomer 代表公司已是客戶，會新增為聯絡窗口），有明顯讀錯、缺公司名稱的先問同事或請他補；沒問題就用 save_cards 提出整批存入（同事按確認才寫入），不要一張一張分開提出。同事說「這批是 XX 展」就用 list_cards 的 note 參數記下展會註記。同事要丟掉名片用 discard_cards。名片收件匣也有網頁版：網站的「名片客戶專區」可以一次看完整欄位、手動編輯、逐張登入成客戶 / 建立案件 / 新增聯繫行事曆 / 刪除，同事想逐張處理就告訴他去那裡。回覆時不要把每張名片逐項重講（系統會附上摘要），只講重點與需要他決定的事。"
      : "",
    (info.blocks?.copy ?? "none") !== "none" ? "文案製作：寫社群文案前先用 copy_style 看公司風格與平台，照風格寫；寫好用 save_copy_post 存成草稿（不會自動發佈），並把內文貼給同事看。" : "",
    info.memory?.enabled
      ? "7. 同事要你「記住」某件事（稱呼、習慣、公司規定…）時用 remember 工具；要你忘掉時用 forget_memory。只記對之後的對話有用、不會很快過期的事，不要記客戶機密或密碼。"
      : "",
    info.prompt ? `\n【公司規則（管理員設定，優先遵守）】\n${info.prompt}` : "",
    info.pending ? `\n【目前有等待同事確認的修改】\n${info.pending}\n（同事回覆「確認」或按確認鈕才會寫入；如果他想改內容，請重新提出修改，舊的會被取代。）` : "",
    memLines ? `\n【你記得的事（長期記憶）】\n${memLines}` : "",
  ]
    .filter((x) => x !== "")
    .join("\n");
}

// ------------------------------------------------------------
// 工具
// ------------------------------------------------------------
const str = (description: string) => ({ type: "string", description });

async function query(uid: string, call: string, params: Record<string, unknown>): Promise<string> {
  try {
    return clip(JSON.stringify(await gas.staffCall(uid, call, params)));
  } catch (error) {
    if (error instanceof GasError) return `查詢失敗：${error.message}`;
    throw error;
  }
}

function readTools(uid: string, info: StaffInfo): Tool[] {
  const lv = (block: string) => info.blocks?.[block] ?? "none";
  const tools: Tool[] = [
    {
      name: "overview",
      description: "今日總覽：近 3 天要追蹤的客戶（含逾期）、進行中案件數、今明兩天行程與快到期的工作。同事問「今天有什麼事」「早報」時用。",
      parameters: { type: "object", properties: {} },
      handler: () => query(uid, "overview", {}),
    },
    {
      name: "list_memos",
      description: "查同事自己的與別人分享給他的備忘錄（最近的在前面）。自己的一般備忘錄有 ref 編號，刪除時要用。",
      parameters: { type: "object", properties: { limit: { type: "number", description: "筆數，預設 10" } } },
      handler: (a) => query(uid, "memos", { limit: a.limit }),
    },
    {
      name: "list_calendar",
      description: "查同事的行事曆未來幾天的行程（自己的 + 別人分享給他的；客戶下次追蹤也會在裡面，標示 followup）。自己的行程有 id，刪除時要用。需要綁定網站帳號。",
      parameters: { type: "object", properties: { days: { type: "number", description: "未來幾天，預設 7" } } },
      handler: (a) => query(uid, "calendar", { days: a.days }),
    },
    {
      name: "search_knowledge",
      description: "查公司知識庫（客服機器人用來回答客人的那份資料：常見問答、文件、公司資訊，含向量檢索）。同事問「客人問 XX 我們怎麼回答」「公司簡介」「產品怎麼用」「有沒有寫過 XX」時用。查產品規格與報價請用 search_products / get_product。",
      parameters: { type: "object", properties: { query: str("關鍵字或完整的問題") }, required: ["query"] },
      handler: async (a) => {
        try {
          await gas.staffAudit(uid, "read", `搜尋知識庫：${String(a.query ?? "").slice(0, 80)}`);
          const index = await staffKnowledge(uid, info.kbVer);
          const search = { ...DEFAULT_SEARCH, ...info.search };
          const result = await searchKnowledge(index, String(a.query ?? ""), search, info.embedAi ? async (q) => (await embed(info.embedAi!, [q], "query"))[0] : undefined);
          return clip(formatHits(result.hits) || "知識庫裡沒有找到相關資料");
        } catch (error) {
          if (error instanceof GasError) return `查詢失敗：${error.message}`;
          throw error;
        }
      },
    },
    {
      name: "list_todos",
      description: "查同事的工作清單（自己的 + 別人分享給他的），未完成的在前面，依期限排序。status：open（預設，未完成）/ done / all。",
      parameters: { type: "object", properties: { status: { type: "string", enum: ["open", "done", "all"], description: "預設 open" }, scope: { type: "string", enum: ["all", "mine", "shared"], description: "all（預設）/ mine 只看自己的 / shared 只看別人分享的" }, limit: { type: "number", description: "筆數，預設 10" } } },
      handler: (a) => query(uid, "todos", { status: a.status, scope: a.scope, limit: a.limit }),
    },
  ];
  if (lv("customers") !== "none") {
    tools.push(
      {
        name: "search_customers",
        description: "用關鍵字找客戶（公司名稱、聯絡人、電話、Email、統編、地址、備註）。回傳基本資料與下次追蹤。",
        parameters: { type: "object", properties: { keyword: str("關鍵字，可用空白分隔多個（要全部符合）；空白 = 列出全部"), limit: { type: "number", description: "最多幾筆，預設 10" } } },
        handler: (a) => query(uid, "customers", { keyword: a.keyword, limit: a.limit }),
      },
      {
        name: "get_customer",
        description: "查一間客戶的完整資料：基本資料、聯絡窗口、最近 5 筆聯繫紀錄、相關案件。公司名稱要完整（不確定時先用 search_customers）。",
        parameters: { type: "object", properties: { company_name: str("公司名稱") }, required: ["company_name"] },
        handler: (a) => query(uid, "customer", { companyName: a.company_name }),
      },
      {
        name: "followups_due",
        description: "要追蹤的客戶清單（含已逾期）：days = 0 只看今天以前，3 = 含未來 3 天。",
        parameters: { type: "object", properties: { days: { type: "number", description: "往後看幾天，預設 0（今天與已逾期）" }, limit: { type: "number", description: "預設 10" } } },
        handler: (a) => query(uid, "followups", { days: a.days, limit: a.limit }),
      },
      {
        name: "contact_logs",
        description: "查聯繫紀錄（最近的在前面）；可指定公司。",
        parameters: { type: "object", properties: { company_name: str("公司名稱（可部分）；空白 = 全部"), limit: { type: "number", description: "預設 10" } } },
        handler: (a) => query(uid, "logs", { companyName: a.company_name, limit: a.limit }),
      },
    );
  }
  if (lv("cases") !== "none") {
    tools.push(
      {
        name: "search_cases",
        description: "查案件。status 填「進行中」= 還沒結案的，或填 需求單已發出 / 評估單已發出 / 已結案；keyword 可以是案件編號、客戶、業務、FAE、應用、待測物件。",
        parameters: { type: "object", properties: { keyword: str("關鍵字"), status: str("狀態"), limit: { type: "number", description: "預設 10" } } },
        handler: (a) => query(uid, "cases", { keyword: a.keyword, status: a.status, limit: a.limit }),
      },
      {
        name: "get_case",
        description: "查一個案件的完整資料（含 CCD 需求）。案件編號要完整。",
        parameters: { type: "object", properties: { case_id: str("案件編號") }, required: ["case_id"] },
        handler: (a) => query(uid, "case", { caseId: a.case_id }),
      },
    );
  }
  if (lv("products") !== "none") {
    const calc = calcTool(async () => (await gas.staffCall(uid, "calcCatalog")) as Catalog);
    const runCalc = calc.handler;
    calc.handler = async (a) => {
      await gas.staffAudit(uid, "read", `選型計算：檢測範圍 ${a.fov_a_mm ?? "?"}×${a.fov_b_mm ?? "?"} mm、精度 ${a.accuracy ?? "?"}${a.accuracy_unit ?? ""}`);
      return runCalc(a);
    };
    tools.push(calc);
    tools.push(cameraPixelTool(async () => (await gas.staffCall(uid, "calcCatalog")) as Catalog));
    tools.push({
      name: "search_products",
      description: "查產品資料庫（型號、品牌、規格、介面、解析度…）；有權限的人才看得到供應商與參考底價，絕對不要把底價告訴客戶。",
      parameters: { type: "object", properties: { keyword: str("型號、品牌、類別或規格關鍵字，可用空白分隔"), limit: { type: "number", description: "最多幾筆，預設 8" } } },
      handler: (a) => query(uid, "products", { keyword: a.keyword, limit: a.limit }),
    });
    tools.push({
      name: "get_product",
      description: "查一個產品的完整資料：規格、相容產品，以及（有權限且管理員沒隱藏時）供應商、底價與最近 5 筆報價。內部型號或供應商型號要完整（不確定時先用 search_products）。",
      parameters: { type: "object", properties: { internal_model: str("內部型號（或供應商型號）") }, required: ["internal_model"] },
      handler: (a) => query(uid, "product", { internalModel: a.internal_model }),
    });
    tools.push({
      name: "price_history",
      description: "查一個產品的歷史報價紀錄（日期、供應商、價格、幣別、案件），最近的在前面。管理員可能設定助理不顯示價格。",
      parameters: { type: "object", properties: { internal_model: str("內部型號"), limit: { type: "number", description: "筆數，預設 10" } }, required: ["internal_model"] },
      handler: (a) => query(uid, "priceHistory", { internalModel: a.internal_model, limit: a.limit }),
    });
    tools.push({
      name: "inquiry_draft",
      description: "產生給供應商的詢價信文字草稿（含上次報價、需求數量）。只是文字，不會建立 Gmail 草稿；要建立草稿請另外用 create_inquiry_draft。",
      parameters: { type: "object", properties: { internal_model: str("內部型號"), quantity: str("需求數量") }, required: ["internal_model"] },
      handler: (a) => query(uid, "inquiryDraft", { internalModel: a.internal_model, quantity: a.quantity }),
    });
  }
  if (lv("copy") !== "none") {
    tools.push({
      name: "copy_posts",
      description: "查「文案製作」裡的文案（草稿 / 預排 / 已發佈），最近修改的在前面。",
      parameters: { type: "object", properties: { keyword: str("主題、關鍵字、平台或內文關鍵字"), status: { type: "string", enum: ["draft", "scheduled", "posted"], description: "狀態" }, limit: { type: "number", description: "筆數，預設 8" } } },
      handler: (a) => query(uid, "copyPosts", { keyword: a.keyword, status: a.status, limit: a.limit }),
    });
    tools.push({
      name: "copy_style",
      description: "查公司的文案風格與提示詞庫（寫文案前先看，照公司風格寫）；也列出可用的平台。",
      parameters: { type: "object", properties: {} },
      handler: () => query(uid, "copyStyle", {}),
    });
  }
  if (lv("customers") !== "none") {
    tools.push({
      name: "list_cards",
      description: "看「名片收件匣」：同事傳的名片照片讀出來的資料（編號、姓名、職稱、公司、電話、Email…）。status：pending 待整理（預設）/ saved 已存入 / discarded 已丟棄 / all。note 參數可設定這批名片的註記（例如「2026 台北自動化展」），之後傳的名片與收件匣裡待整理的都會帶上。",
      parameters: { type: "object", properties: { status: { type: "string", enum: ["pending", "saved", "discarded", "all"], description: "預設 pending" }, note: str("這批名片的註記，例如展會名稱（選填）") } },
      handler: (a) => query(uid, "cards", { status: a.status, note: a.note }),
    });
  }
  return tools;
}

/** 這一輪提出的修改：每提出一項就整批重新驗證並暫存，驗證失敗的回報給 AI 讓它修正或反問 */
interface Staging {
  ops: StaffWrite[];
  pending: { token: string; summary: string } | null;
}

function writeTools(uid: string, info: StaffInfo, staging: Staging): Tool[] {
  const writable = new Set(info.writable ?? []);
  const propose = (action: string, data: Record<string, unknown>) => async (): Promise<string> => {
    const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined && v !== null && v !== ""));
    const next = [...staging.ops, { action, data: clean }];
    try {
      staging.pending = await gas.staffStage(uid, next);
      staging.ops = next;
      return `已加入待確認清單（共 ${next.length} 項，同事按確認才會寫入，現在還沒有生效）。請簡短說明你整理了什麼並請他確認，不要說已經完成。`;
    } catch (error) {
      if (error instanceof GasError) return `無法加入：${error.message}`;
      throw error;
    }
  };
  const tools: Tool[] = [];
  if (writable.has("addMemo")) {
    tools.push({
      name: "add_memo",
      description: "新增備忘錄（預設只有同事自己看得到，shared=true 才共享給全部同事）",
      parameters: { type: "object", properties: { title: str("標題"), content: str("內容"), shared: { type: "boolean", description: "是否共享給全部同事，預設否" } } },
      handler: (a) => propose("addMemo", { title: a.title, content: a.content, shared: a.shared === true })(),
    });
  }
  if (writable.has("logFollowUp")) {
    tools.push({
      name: "log_followup",
      description: "記錄一次客戶聯繫，並可同時更新「下次追蹤」；或只改下次追蹤日 / 洽談內容；stop_following=true 表示不再追蹤。公司名稱必須是已存在的客戶（先用 search_customers 確認）。",
      parameters: {
        type: "object",
        properties: {
          company: str("客戶公司名稱（完整）"),
          summary: str("這次聯繫的內容 / 結果（沒有聯繫、只改日期時可省略）"),
          method: str("聯繫方式：電話 / Email / 拜訪 / LINE / 其他"),
          contact: str("聯繫的對象"),
          next_date: str("下次追蹤日 YYYY-MM-DD"),
          next_time: str("下次預約時間 HH:mm"),
          next_note: str("下次追蹤的洽談內容"),
          stop_following: { type: "boolean", description: "不再追蹤（清掉下次追蹤日）" },
          case_id: str("相關案件編號（可省略）"),
        },
        required: ["company"],
      },
      handler: (a) => propose("logFollowUp", { company: a.company, summary: a.summary, method: a.method, contact: a.contact, nextDate: a.next_date, nextTime: a.next_time, nextNote: a.next_note, stop: a.stop_following === true ? true : undefined, caseId: a.case_id })(),
    });
  }
  if (writable.has("updateCustomer")) {
    tools.push({
      name: "update_customer",
      description: "修改客戶資料（聯絡人、電話、Email、公司電話、地址、統編、分類、急迫性、備註）。公司名稱不能用助理修改。只填要改的欄位。",
      parameters: {
        type: "object",
        properties: {
          company: str("客戶公司名稱（完整）"),
          contact: str("聯絡人"), phone: str("聯繫人電話"), email: str("Email"), company_phone: str("公司電話"), address: str("地址"), tax_id: str("統一編號"),
          category: str("分類"), urgency: str("急迫性：高 / 中 / 低"), notes: str("客戶備註（會取代原本的備註，修改前先查原本內容）"),
        },
        required: ["company"],
      },
      handler: (a) =>
        propose("updateCustomer", {
          company: a.company,
          fields: Object.fromEntries(
            Object.entries({ Contact: a.contact, Phone: a.phone, Email: a.email, CompanyPhone: a.company_phone, Address: a.address, TaxId: a.tax_id, Category: a.category, Urgency: a.urgency, Notes: a.notes }).filter(([, v]) => v !== undefined && v !== ""),
          ),
        })(),
    });
  }
  if (writable.has("addCustomer")) {
    tools.push({
      name: "add_customer",
      description: "新增客戶（公司名稱不能跟現有的重複，先用 search_customers 確認沒有）",
      parameters: { type: "object", properties: { company_name: str("公司名稱"), contact: str("聯絡人"), phone: str("電話"), email: str("Email"), category: str("分類，預設一般客戶"), urgency: str("急迫性：高 / 中 / 低"), notes: str("備註") }, required: ["company_name"] },
      handler: (a) => propose("addCustomer", { companyName: a.company_name, contact: a.contact, phone: a.phone, email: a.email, category: a.category, urgency: a.urgency, notes: a.notes })(),
    });
  }
  if (writable.has("createCase")) {
    tools.push({
      name: "create_case",
      description: "建立案件（掛在已存在的客戶底下）。使用軟體名稱、待測物件、產品應用三項會組成案件編號，一定要問清楚，不要自己編。",
      parameters: {
        type: "object",
        properties: {
          customer_name: str("客戶公司名稱（完整）"), software_name: str("使用軟體名稱"), test_object: str("待測物件"), product_application: str("產品應用"),
          project_contact: str("專案聯絡人"), contact_phone: str("聯絡電話"), requirement_details: str("需求說明"), urgency: str("緊急程度：高 / 中 / 低"),
        },
        required: ["customer_name", "software_name", "test_object", "product_application"],
      },
      handler: (a) => propose("createCase", { customerName: a.customer_name, softwareName: a.software_name, testObject: a.test_object, productApplication: a.product_application, projectContact: a.project_contact, contactPhone: a.contact_phone, requirementDetails: a.requirement_details, urgency: a.urgency })(),
    });
  }
  if (writable.has("updateCaseStatus")) {
    tools.push({
      name: "update_case",
      description: "修改案件的狀態（需求單已發出 / 評估單已發出 / 已結案）或緊急程度（高 / 中 / 低）",
      parameters: { type: "object", properties: { case_id: str("案件編號（完整）"), status: str("新狀態"), urgency: str("新的緊急程度") }, required: ["case_id"] },
      handler: (a) => propose("updateCaseStatus", { caseId: a.case_id, status: a.status, urgency: a.urgency })(),
    });
  }
  if (writable.has("updateCase")) {
    tools.push({
      name: "update_case_info",
      description: "修改案件的內容欄位：專案聯絡人、聯絡電話、終端客戶、業務、FAE、需求說明、評估結果。只填要改的欄位（文字欄位會整個取代，修改前先用 get_case 看原本內容）。狀態 / 緊急程度請用 update_case。",
      parameters: {
        type: "object",
        properties: { case_id: str("案件編號（完整）"), project_contact: str("專案聯絡人"), contact_phone: str("聯絡電話"), end_customer: str("終端客戶"), salesperson: str("業務"), fae: str("FAE"), requirement_details: str("需求說明"), evaluation_result: str("評估結果") },
        required: ["case_id"],
      },
      handler: (a) =>
        propose("updateCase", {
          caseId: a.case_id,
          fields: Object.fromEntries(
            Object.entries({ ProjectContact: a.project_contact, ContactPhone: a.contact_phone, EndCustomerName: a.end_customer, Salesperson: a.salesperson, FAE: a.fae, RequirementDetails: a.requirement_details, EvaluationResult: a.evaluation_result }).filter(([, v]) => v !== undefined && v !== ""),
          ),
        })(),
    });
  }
  if (writable.has("addContact")) {
    tools.push({
      name: "add_contact",
      description: "幫已存在的客戶新增一位聯絡窗口（姓名、職稱、電話、Email）。公司名稱要完整；同一間公司同名的聯絡人不能重複。",
      parameters: { type: "object", properties: { company: str("客戶公司名稱（完整）"), contact_name: str("聯絡人姓名"), title: str("職稱"), phone: str("電話"), email: str("Email"), notes: str("備註") }, required: ["company", "contact_name"] },
      handler: (a) => propose("addContact", { company: a.company, contactName: a.contact_name, title: a.title, phone: a.phone, email: a.email, notes: a.notes })(),
    });
  }
  if (writable.has("addPriceRecord")) {
    tools.push({
      name: "add_price_record",
      description: "記錄一筆供應商報價到產品的價格紀錄（日期自動用今天）。產品要已存在；價格要是數字，幣別預設 TWD。",
      parameters: { type: "object", properties: { internal_model: str("內部型號"), price: { type: "number", description: "報價" }, currency: str("幣別，預設 TWD"), supplier: str("供應商（沒填就用產品的供應商）"), case_id: str("相關案件編號（可省略）"), notes: str("備註") }, required: ["internal_model", "price"] },
      handler: (a) => propose("addPriceRecord", { internalModel: a.internal_model, price: a.price, currency: a.currency, supplier: a.supplier, caseId: a.case_id, notes: a.notes })(),
    });
  }
  if (writable.has("addProduct")) {
    tools.push({
      name: "add_product",
      description: "新增產品到產品資料庫（內部型號不能重複，先用 search_products 確認沒有）。規格欄位都是選填，沒把握的不要亂填。",
      parameters: {
        type: "object",
        properties: {
          internal_model: str("內部型號"), supplier_model: str("供應商型號"), brand: str("品牌"), category: str("類別，例如 相機 / 鏡頭 / 光源"),
          interface: str("介面，例如 GigE / USB3.0"), resolution: str("解析度，例如 2448x2048"), pixel_size: str("像素尺寸 µm"), sensor_size: str("靶面"), fps: str("幀率"), mount: str("接口"),
          focal_length: str("焦距 mm（FA 鏡頭）"), magnification: str("倍率（遠心鏡頭）"), wd: str("工作距離"), dof: str("景深"), notes: str("備註"),
          supplier: str("供應商"), ref_price: str("參考底價"),
        },
        required: ["internal_model"],
      },
      handler: (a) =>
        propose("addProduct", {
          internalModel: a.internal_model,
          fields: Object.fromEntries(
            Object.entries({ SupplierModel: a.supplier_model, Brand: a.brand, Category: a.category, Interface: a.interface, Resolution: a.resolution, PixelSize: a.pixel_size, SensorSize: a.sensor_size, FPS: a.fps, Mount: a.mount, FocalLength: a.focal_length, Magnification: a.magnification, WD: a.wd, DOF: a.dof, Notes: a.notes, Supplier: a.supplier, RefPrice: a.ref_price }).filter(([, v]) => v !== undefined && v !== ""),
          ),
        })(),
    });
  }
  if (writable.has("updateProduct")) {
    tools.push({
      name: "update_product",
      description: "修改產品資料（規格、備註、供應商、參考底價等；內部型號不能用助理改）。只填要改的欄位，備註會整個取代，修改前先用 get_product 看原本內容。",
      parameters: {
        type: "object",
        properties: {
          internal_model: str("內部型號（完整）"), supplier_model: str("供應商型號"), brand: str("品牌"), category: str("類別"), interface: str("介面"), resolution: str("解析度"), pixel_size: str("像素尺寸"), sensor_size: str("靶面"),
          fps: str("幀率"), mount: str("接口"), focal_length: str("焦距"), magnification: str("倍率"), wd: str("工作距離"), dof: str("景深"), focus_wd: str("對焦距離"), notes: str("備註"),
          supplier: str("供應商"), supplier_contact: str("供應商聯絡人"), supplier_email: str("供應商 Email"), ref_price: str("參考底價"),
        },
        required: ["internal_model"],
      },
      handler: (a) =>
        propose("updateProduct", {
          internalModel: a.internal_model,
          fields: Object.fromEntries(
            Object.entries({ SupplierModel: a.supplier_model, Brand: a.brand, Category: a.category, Interface: a.interface, Resolution: a.resolution, PixelSize: a.pixel_size, SensorSize: a.sensor_size, FPS: a.fps, Mount: a.mount, FocalLength: a.focal_length, Magnification: a.magnification, WD: a.wd, DOF: a.dof, FocusWD: a.focus_wd, Notes: a.notes, Supplier: a.supplier, SupplierContact: a.supplier_contact, SupplierContactEmail: a.supplier_email, RefPrice: a.ref_price }).filter(([, v]) => v !== undefined && v !== ""),
          ),
        })(),
    });
  }
  if (writable.has("createInquiryDraft")) {
    tools.push({
      name: "create_inquiry_draft",
      description: "把詢價信存成 Gmail 草稿（只存草稿、不會寄出，建立在系統帳號的 Gmail 草稿匣）。產品要有供應商 Email。要先 inquiry_draft 看過內容再建立。",
      parameters: { type: "object", properties: { internal_model: str("內部型號"), quantity: str("需求數量") }, required: ["internal_model"] },
      handler: (a) => propose("createInquiryDraft", { internalModel: a.internal_model, quantity: a.quantity })(),
    });
  }
  if (writable.has("saveCopyPost")) {
    tools.push({
      name: "save_copy_post",
      description: "把寫好的社群文案存進「文案製作」成為草稿（有給 scheduled_for 就是預排）。修改既有文案時帶 id。寫之前先用 copy_style 看公司風格。不會自動發佈。",
      parameters: {
        type: "object",
        properties: { id: { type: "number", description: "要修改的文案編號（新增不用填）" }, platform: str("平台：Threads / Instagram / Facebook / X / LINE / YouTube / 方格子"), topic: str("主題"), keywords: str("關鍵字"), tone: str("語氣"), content: str("文案內文"), scheduled_for: str("預排日期 YYYY-MM-DD（可省略）") },
        required: ["content"],
      },
      handler: (a) => propose("saveCopyPost", { id: a.id, platform: a.platform, topic: a.topic, keywords: a.keywords, tone: a.tone, content: a.content, scheduledFor: a.scheduled_for })(),
    });
  }
  if (writable.has("addEvent")) {
    tools.push({
      name: "add_event",
      description: "在同事自己的行事曆新增行程（預設只有他自己看得到；share_all=true 才分享給全部同事，對方只能看）。沒給時間就是全天行程。日期用 YYYY-MM-DD、時間用 HH:mm。需要綁定網站帳號。",
      parameters: { type: "object", properties: { title: str("標題"), date: str("日期 YYYY-MM-DD"), time: str("開始時間 HH:mm（全天行程省略）"), end_time: str("結束時間 HH:mm（省略 = 一小時）"), end_date: str("結束日期（跨天才需要）"), location: str("地點"), notes: str("備註"), share_all: { type: "boolean", description: "分享給全部同事（只能看），預設否" } }, required: ["title", "date"] },
      handler: (a) => propose("addEvent", { title: a.title, date: a.date, time: a.time, endTime: a.end_time, endDate: a.end_date, location: a.location, notes: a.notes, allDay: !a.time, shareAll: a.share_all === true ? true : undefined })(),
    });
  }
  if (writable.has("addTodo")) {
    tools.push({
      name: "add_todo",
      description: "在同事自己的工作清單新增一項工作（期限 YYYY-MM-DD、優先度 高 / 中 / 低，預設中）。預設只有他自己看得到。需要綁定網站帳號。",
      parameters: { type: "object", properties: { title: str("工作內容"), due_date: str("期限 YYYY-MM-DD（可省略）"), priority: str("優先度：高 / 中 / 低"), notes: str("備註"), share_all: { type: "boolean", description: "分享給全部同事（只能看），預設否" } }, required: ["title"] },
      handler: (a) => propose("addTodo", { title: a.title, dueDate: a.due_date, priority: a.priority, notes: a.notes, shareAll: a.share_all === true ? true : undefined })(),
    });
  }
  if (writable.has("completeTodo")) {
    tools.push({
      name: "complete_todo",
      description: "把同事自己的某項工作標示為完成（reopen=true 則重開）。要用 list_todos 看到的編號 id；別人分享的工作不能改。",
      parameters: { type: "object", properties: { id: { type: "number", description: "工作編號" }, reopen: { type: "boolean", description: "重開（取消完成），預設否" } }, required: ["id"] },
      handler: (a) => propose("completeTodo", { id: a.id, reopen: a.reopen === true ? true : undefined })(),
    });
  }
  if (writable.has("saveCards")) {
    tools.push({
      name: "save_cards",
      description: "把「名片收件匣」待整理的名片整批存成客戶資料：公司還不是客戶 → 新增客戶（姓名放聯絡人，職稱、網站等放備註）；公司已經是客戶（或同一批裡同公司的第二張）→ 新增聯絡窗口；沒有公司名稱的會略過。要同事按確認才會寫入。ids 不填 = 全部待整理；fixes 可以修正某張讀錯的欄位或補公司名稱。一次整批提出，不要一張一張分開。",
      parameters: {
        type: "object",
        properties: {
          ids: { type: "array", items: { type: "number" }, description: "只存這些名片編號；不填 = 收件匣裡全部待整理的" },
          fixes: {
            type: "array",
            description: "要修正的欄位，每張一筆",
            items: {
              type: "object",
              properties: { id: { type: "number", description: "名片編號" }, name: str("姓名"), title: str("職稱"), company: str("公司"), phone: str("手機"), company_phone: str("公司電話"), email: str("Email"), address: str("地址"), tax_id: str("統編"), website: str("網站"), note: str("備註") },
              required: ["id"],
            },
          },
          category: str("新增客戶的分類：AOI同業資料 / 器材原廠 / 機構合作設備商 / 一般客戶（預設）"),
        },
      },
      handler: (a) => {
        const overrides: Record<string, Record<string, string>> = {};
        for (const f of Array.isArray(a.fixes) ? (a.fixes as Record<string, unknown>[]) : []) {
          const id = Number(f.id);
          if (!id) continue;
          const o: Record<string, string> = {};
          const map: Record<string, string> = { name: "name", title: "title", company: "company", phone: "phone", company_phone: "companyPhone", email: "email", address: "address", tax_id: "taxId", website: "website", note: "note" };
          for (const [from, to] of Object.entries(map)) if (typeof f[from] === "string" && String(f[from]).trim()) o[to] = String(f[from]).trim();
          if (Object.keys(o).length) overrides[String(id)] = o;
        }
        return propose("saveCards", { ids: Array.isArray(a.ids) && a.ids.length ? a.ids : undefined, overrides: Object.keys(overrides).length ? overrides : undefined, category: a.category })();
      },
    });
  }
  if (writable.has("discardCards")) {
    tools.push({
      name: "discard_cards",
      description: "丟棄「名片收件匣」裡的名片（不存進客戶資料；例如讀錯、重複、不需要的）。ids 不填 = 全部待整理的。要同事按確認才會執行。",
      parameters: { type: "object", properties: { ids: { type: "array", items: { type: "number" }, description: "要丟棄的名片編號；不填 = 全部待整理的" } } },
      handler: (a) => propose("discardCards", { ids: Array.isArray(a.ids) && a.ids.length ? a.ids : undefined })(),
    });
  }
  const del = (action: string, data: Record<string, unknown>) => propose(action, data)();
  if (writable.has("deleteCustomer")) {
    tools.push({
      name: "delete_customer",
      description: "刪除一間客戶（無法復原；要網站帳號有刪除權限）。公司名稱要完整，先 get_customer 確認。客戶底下還有案件時，要先跟同事確認「連同刪除」，確定後才把 force 設為 true。",
      parameters: { type: "object", properties: { company: str("客戶公司名稱（完整）"), force: { type: "boolean", description: "客戶底下還有案件、同事已明確確認仍要刪除時才填 true" } }, required: ["company"] },
      handler: (a) => del("deleteCustomer", { company: a.company, force: a.force === true ? true : undefined }),
    });
  }
  if (writable.has("deleteContact")) {
    tools.push({
      name: "delete_contact",
      description: "刪除客戶的一位聯絡窗口（無法復原）。先用 get_customer 看窗口名單。",
      parameters: { type: "object", properties: { company: str("客戶公司名稱（完整）"), contact_name: str("聯絡人姓名（完整）") }, required: ["company", "contact_name"] },
      handler: (a) => del("deleteContact", { company: a.company, contactName: a.contact_name }),
    });
  }
  if (writable.has("deleteCase")) {
    tools.push({
      name: "delete_case",
      description: "刪除一個案件（連同 CCD 需求與相關公司，無法復原；要網站帳號有刪除權限）。案件編號要完整，先 get_case 確認。",
      parameters: { type: "object", properties: { case_id: str("案件編號（完整）") }, required: ["case_id"] },
      handler: (a) => del("deleteCase", { caseId: a.case_id }),
    });
  }
  if (writable.has("deleteProduct")) {
    tools.push({
      name: "delete_product",
      description: "刪除一個產品（無法復原；要網站帳號有刪除權限）。內部型號要完整，先 get_product 確認。",
      parameters: { type: "object", properties: { internal_model: str("內部型號（完整）") }, required: ["internal_model"] },
      handler: (a) => del("deleteProduct", { internalModel: a.internal_model }),
    });
  }
  if (writable.has("deletePriceRecord")) {
    tools.push({
      name: "delete_price_record",
      description: "刪除一筆報價紀錄（無法復原）。用 price_history 查到的「日期」與「價格」指定；同一天同價格有多筆時無法指定，要請同事到網站刪。",
      parameters: { type: "object", properties: { internal_model: str("內部型號"), date: str("報價日期 YYYY-MM-DD"), price: { type: "number", description: "報價金額" } }, required: ["internal_model", "date", "price"] },
      handler: (a) => del("deletePriceRecord", { internalModel: a.internal_model, date: a.date, price: a.price }),
    });
  }
  if (writable.has("deleteCopyPost")) {
    tools.push({
      name: "delete_copy_post",
      description: "刪除一篇文案（無法復原）。用 copy_posts 查到的編號 id。",
      parameters: { type: "object", properties: { id: { type: "number", description: "文案編號" } }, required: ["id"] },
      handler: (a) => del("deleteCopyPost", { id: a.id }),
    });
  }
  if (writable.has("deleteEvent")) {
    tools.push({
      name: "delete_event",
      description: "刪除同事自己的行事曆行程。用 list_calendar 查到的行程 id；別人分享的不能刪。",
      parameters: { type: "object", properties: { id: { type: "number", description: "行程編號" } }, required: ["id"] },
      handler: (a) => del("deleteEvent", { id: a.id }),
    });
  }
  if (writable.has("deleteTodo")) {
    tools.push({
      name: "delete_todo",
      description: "刪除同事自己的工作清單項目（只是做完了請用 complete_todo）。用 list_todos 查到的 id；別人分享的不能刪。",
      parameters: { type: "object", properties: { id: { type: "number", description: "工作編號" } }, required: ["id"] },
      handler: (a) => del("deleteTodo", { id: a.id }),
    });
  }
  if (writable.has("deleteMemo")) {
    tools.push({
      name: "delete_memo",
      description: "刪除同事自己的備忘錄。用 list_memos 查到的 ref 編號與標題（標題用來核對，避免刪錯）；系統通知與助理紀錄不能刪。",
      parameters: { type: "object", properties: { ref: { type: "number", description: "備忘錄的 ref 編號" }, title: str("備忘錄標題（核對用）") }, required: ["ref"] },
      handler: (a) => del("deleteMemo", { rowIndex: a.ref, title: a.title }),
    });
  }
  if (writable.has("remember") && info.memory?.enabled) {
    const categories = info.memory.categories;
    tools.push({
      name: "remember",
      description:
        "把一件事記進長期記憶（稱呼、負責的工作、工作習慣、回覆偏好、公司規定…），之後每次對話都會帶著。scope=user 只有這位同事的助理知道（預設）；scope=all 全公司同事的助理都會知道（需要權限）。",
      parameters: {
        type: "object",
        properties: {
          content: str("要記住的內容，一句話（300 字內）"),
          category: { type: "string", enum: categories, description: "分類" },
          scope: { type: "string", enum: ["user", "all"], description: "user = 只有這位同事；all = 全公司" },
          importance: { type: "number", description: "重要度 1~5，預設 3；越高越優先帶入" },
        },
        required: ["content"],
      },
      handler: async (a) => {
        const data = { content: a.content, category: a.category, scope: a.scope === "all" ? "all" : "user", importance: a.importance };
        if (info.memory?.confirm) return propose("remember", data)();
        try {
          const r = await gas.staffMemory(uid, { mode: "add", ...data });
          return r.duplicate ? "這件事已經記過了" : `已記住（#${r.id}）`;
        } catch (error) {
          if (error instanceof GasError) return `無法記住：${error.message}`;
          throw error;
        }
      },
    });
    tools.push({
      name: "forget_memory",
      description: "忘掉一筆長期記憶（用【你記得的事】裡的編號 #id）。全公司的記憶只有有權限的人能刪。",
      parameters: { type: "object", properties: { id: { type: "number", description: "記憶編號" } }, required: ["id"] },
      handler: async (a) => {
        try {
          await gas.staffMemory(uid, { mode: "delete", id: a.id });
          return "已忘掉";
        } catch (error) {
          if (error instanceof GasError) return `無法刪除：${error.message}`;
          throw error;
        }
      },
    });
  }
  return tools;
}

// ------------------------------------------------------------
// 對話
// ------------------------------------------------------------
const noReply = (info: StaffInfo | null): StaffResult => ({ silent: true, reply: "", choices: [], pending: null, info });
const say = (info: StaffInfo | null, reply: string, extra: Partial<StaffResult> = {}): StaffResult => ({ silent: false, reply, choices: [], pending: null, info, ...extra });

/** 還沒開通 / 停用 / 沒啟用時的回覆 */
export function blockedReply(info: StaffInfo): string {
  if (info.status === "待開通") return info.texts.pending;
  if (info.status === "停用") return "🚫 你的員工助理帳號已停用，如有需要請洽管理員。";
  return info.problem || "目前無法使用員工助理，請洽管理員。";
}

async function remember(uid: string, user: string, reply: string): Promise<void> {
  try {
    await gas.staffRemember(uid, [{ u: true, t: user }, { u: false, t: reply }]);
  } catch (error) {
    console.warn("記錄員工助理對話失敗", error);
  }
}

async function commit(uid: string, info: StaffInfo, token: string, shown: string): Promise<StaffResult> {
  try {
    const done = await gas.staffCommit(uid, token);
    const extras = done.results.filter((r) => r.caseId).map((r) => `案件編號：${String(r.caseId)}`);
    const reply = `✅ 已寫入（${done.count} 項）\n${done.summary}${extras.length ? "\n" + extras.join("\n") : ""}`;
    await remember(uid, shown, reply);
    return say(info, reply);
  } catch (error) {
    if (!(error instanceof GasError)) throw error;
    return say(info, `❌ 沒有寫入：${error.message}`);
  }
}

async function cancel(uid: string, info: StaffInfo, shown: string): Promise<StaffResult> {
  await gas.staffCancel(uid);
  const reply = "好的，已取消，沒有寫入任何資料。";
  await remember(uid, shown, reply);
  return say(info, reply);
}

/**
 * 處理員工的一則訊息（LINE、網站共用）。
 * channel=line 時 profile 用來登記新成員（LINE 名稱、大頭貼）。
 */
export async function staffConverse(uid: string, input: StaffInput, opts: { channel: "line" | "web"; profile?: () => Promise<Profile>; displayName?: string }): Promise<StaffResult> {
  const prof = opts.channel === "line" && opts.profile ? await opts.profile() : { displayName: opts.displayName ?? "", pictureUrl: "" };
  const info = await gas.staffStart(uid, prof);
  if (!info.allowed) return say(info, blockedReply(info));
  const text = (input.text ?? "").trim();

  // 確認 / 取消（按鈕或直接回覆）
  if (info.pending) {
    if (input.confirm === true || (input.confirm === undefined && YES_WORDS.test(text))) return commit(uid, info, input.token ?? "", text || "確認");
    if (input.confirm === false || (input.confirm === undefined && NO_WORDS.test(text))) return cancel(uid, info, text || "取消");
  } else if (input.confirm !== undefined) {
    return say(info, "這筆修改已經處理過了，或超過 15 分鐘失效了。需要的話請再說一次。");
  }

  if (input.reset || RESET_WORDS.includes(text)) {
    await gas.staffForget(uid);
    return say(info, "好的，我們重新開始 😊 有什麼需要幫忙的？");
  }
  if (!text) return noReply(info);
  if (!info.ai) return say(info, "還沒有設定 AI：請管理員到網站「BOT 設定 → AI 模型」填入 API Key。");

  const choices: string[] = [];
  const staging: Staging = { ops: [], pending: null };
  const tools: Tool[] = [...readTools(uid, info), ...writeTools(uid, info, staging), choicesTool(choices, "同名的客戶有好幾間、「幫我改狀態」沒說哪個案件")];
  const turns: Turn[] = [...(info.history ?? []).map((h) => ({ isUser: h.u, text: h.t })), { isUser: true, text }];

  let reply: string;
  try {
    reply = cleanReply(await generate({ ai: info.ai, fallback: info.aiFallback, system: staffSystemPrompt(info), turns, tools }));
    if (!reply) reply = staging.pending ? "已整理好了，請確認：" : "我不太確定怎麼處理這件事，可以換個方式說說看嗎？";
  } catch (error) {
    console.error("員工助理 AI 回覆失敗", error);
    reply = "😵 AI 暫時忙碌或設定有誤，請稍後再試；若一直失敗請通知管理員檢查「BOT 設定 → AI 模型」。";
    return say(info, reply);
  }

  const pending = staging.pending;
  if (pending) reply = `${reply}\n\n📝 等你確認後才會寫入：\n${pending.summary}`;
  await remember(uid, text, reply);
  return say(info, reply, { choices: pending ? [] : choices, pending });
}

// ------------------------------------------------------------
// LINE 員工助理
// ------------------------------------------------------------
export const CONFIRM_DATA = /^staff:(ok|no):([0-9a-f]{10})$/;

/** 同事傳了一張照片（名片）：讀出欄位放進名片收件匣。需要「客戶與追蹤」編輯權限。 */
export async function staffCardPhoto(uid: string, messageId: string, opts: { profile?: () => Promise<Profile> } = {}): Promise<StaffResult> {
  const prof = opts.profile ? await opts.profile() : { displayName: "", pictureUrl: "" };
  const info = await gas.staffStart(uid, prof);
  if (!info.allowed) return say(info, blockedReply(info));
  if (info.blocks?.customers !== "edit" || !(info.writable ?? []).includes("saveCards")) {
    return say(info, "你目前沒有「客戶與追蹤」的編輯權限，或管理員沒有開放名片登入，所以不能登入名片。需要的話請管理員到「BOT 設定 → 員工助理」開放。");
  }
  if (!info.ai) return say(info, "還沒有設定 AI：請管理員到網站「BOT 設定 → AI 模型」填入 API Key（要用支援圖片輸入的模型）。");
  let reply: string;
  let shown = "（傳了一張照片）";
  try {
    const image = await downloadImage(ch(), messageId);
    const cards = await extractCards(info.ai, info.aiFallback, [image]);
    if (!cards.length) {
      reply = "📷 這張照片裡我看不出名片。請重拍一次：整張名片入鏡、對焦清楚、光線充足、不要反光。";
    } else {
      const res = await gas.staffCards(uid, cards);
      shown = `（傳了名片照片：${res.added.map((c) => c.name || c.company || "名片").join("、")}）`;
      reply = res.added.length ? cardIntakeReply(res.added, res.pending, res.batchNote) : "📷 名片上的字我讀不出來，請重拍一次（整張入鏡、對焦清楚、光線充足）。";
    }
  } catch (error) {
    if (error instanceof CardError || error instanceof GasError) reply = `📷 ${error.message}`;
    else {
      console.error("名片登入失敗", error);
      reply = "📷 這張照片處理失敗了，請稍後再傳一次。";
    }
  }
  await remember(uid, shown, reply);
  return say(info, reply, { choices: reply.startsWith("📇") ? ["📇 整理名片", "📥 看收件匣"] : [] });
}

export function pendingChoices(token: string): Choice[] {
  return [
    { label: "✅ 確認寫入", data: `staff:ok:${token}`, displayText: "確認" },
    { label: "❌ 取消", data: `staff:no:${token}`, displayText: "取消" },
  ];
}

export async function handleStaffEvent(e: LineEvent): Promise<void> {
  // 員工助理只在一對一聊天使用（群組裡不回應，避免洩漏資料）
  if (e.source.type !== "user" || !e.source.userId) return;
  const uid = e.source.userId;
  const profile = () => getProfile(ch(), uid);

  if (e.type === "unfollow") {
    await gas.staffUnfollow(uid);
    return;
  }

  if (e.type === "follow") {
    const info = await gas.staffStart(uid, await profile());
    await replyText(ch(), e.replyToken, uid, info.allowed ? info.texts.welcome : blockedReply(info));
    return;
  }

  let input: StaffInput;
  if (e.type === "postback") {
    const m = CONFIRM_DATA.exec(e.postback?.data ?? "");
    if (!m) return;
    input = { confirm: m[1] === "ok", token: m[2] };
  } else if (e.type === "message" && e.message?.type === "text" && e.message.text?.trim()) {
    input = { text: e.message.text.trim() };
  } else if (e.type === "message" && e.message?.type === "image" && e.message.id) {
    // 名片照片（單張或一次多張，每張各一個事件）
    await showLoading(ch(), uid);
    const photo = await staffCardPhoto(uid, e.message.id, { profile });
    if (!photo.silent) await replyText(ch(), e.replyToken, uid, photo.reply, photo.choices);
    return;
  } else {
    return;
  }

  await showLoading(ch(), uid);
  const result = await staffConverse(uid, input, { channel: "line", profile });
  if (result.silent) return;
  await replyText(ch(), e.replyToken, uid, result.reply, result.pending ? pendingChoices(result.pending.token) : result.choices);
}

export function processStaffEvents(events: LineEvent[]): Promise<void> {
  return processEvents(events, handleStaffEvent, ch());
}

// ------------------------------------------------------------
// 每日早報（不經過 AI：固定格式、穩定、不花 AI 額度）
// ------------------------------------------------------------
interface Overview {
  today?: string;
  followups?: { total: number; items: { CompanyName?: string; Contact?: string; NextFollowUpTime?: string; NextFollowUpNote?: string; NextFollowUpDate?: string; status?: string }[] };
  openCases?: { total: number; byStatus: Record<string, number>; high: { CaseID?: string; CustomerName?: string; Status?: string }[] };
  events?: { date: string; endDate?: string; time?: string; title: string; location?: string; from?: string }[];
  todos?: { id: number; title: string; dueDate?: string; priority?: string; status?: string; from?: string }[];
}

export function briefingText(name: string, ov: Overview, date = nowLocal().date): string {
  const lines = [`☀️ 早安${name ? "，" + name : ""}！今天 ${showDate(date)}`];
  const fu = ov.followups;
  if (fu) {
    const items = fu.items.filter((x) => x.NextFollowUpDate && x.NextFollowUpDate <= addDays(date, 0));
    const overdue = items.filter((x) => x.status === "已逾期");
    const todayItems = items.filter((x) => x.status === "今天");
    lines.push("", `📞 要追蹤：今天 ${todayItems.length} 家${overdue.length ? `、已逾期 ${overdue.length} 家` : ""}`);
    for (const x of [...overdue, ...todayItems].slice(0, 8)) {
      const late = x.status === "已逾期" ? `（逾期 ${Math.abs(daysFrom(x.NextFollowUpDate ?? date, date))} 天）` : "";
      lines.push(`・${x.CompanyName}${x.NextFollowUpTime ? " " + x.NextFollowUpTime : ""}${late}${x.NextFollowUpNote ? "：" + x.NextFollowUpNote : ""}`);
    }
    if (!items.length) lines.push("・今天沒有要追蹤的客戶 👍");
  }
  const oc = ov.openCases;
  if (oc) {
    const parts = Object.entries(oc.byStatus).map(([k, v]) => `${k} ${v}`);
    lines.push("", `📁 進行中案件 ${oc.total} 件${parts.length ? "（" + parts.join("、") + "）" : ""}`);
    for (const c of oc.high.slice(0, 3)) lines.push(`・緊急：${c.CaseID}（${c.CustomerName}）`);
  }
  const events = (ov.events ?? []).filter((x) => x.date <= date && (x.endDate ?? x.date) >= date);
  if (events.length) {
    lines.push("", "📅 今天行程");
    for (const x of events.slice(0, 6)) lines.push(`・${!x.time || x.time === "全天" ? "全天" : x.time.slice(0, 5)} ${x.title}${x.location ? "＠" + x.location : ""}${x.from ? `（${x.from} 分享）` : ""}`);
  }
  const todos = (ov.todos ?? []).filter((x) => x.dueDate && x.dueDate <= date);
  if (todos.length) {
    lines.push("", "✅ 今天要做 / 已逾期的工作");
    for (const x of todos.slice(0, 6)) lines.push(`・${x.title}${x.dueDate && x.dueDate < date ? `（逾期，期限 ${x.dueDate.slice(5)}）` : ""}`);
  }
  return lines.join("\n");
}

/** 推播早報給管理系統勾選的成員；回傳成功與失敗的人數 */
export async function pushBriefings(): Promise<{ targets: number; sent: number; failed: number }> {
  const targets = await gas.staffPushTargets();
  let sent = 0, failed = 0;
  for (const uid of targets) {
    try {
      const me = (await gas.staffCall(uid, "me")) as { name?: string };
      const ov = (await gas.staffCall(uid, "overview")) as Overview;
      (await pushText(ch(), uid, briefingText(me.name ?? "", ov))) ? sent++ : failed++;
    } catch (error) {
      console.warn(`早報失敗 ${uid.slice(0, 6)}…`, error);
      failed++;
    }
  }
  return { targets: targets.length, sent, failed };
}
