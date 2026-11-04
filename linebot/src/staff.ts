import { generate, type Tool, type Turn } from "./ai.js";
import { calcTool, CALC_RULES } from "./calc-tool.js";
import type { Catalog } from "./calc.js";
import { cleanReply, processEvents } from "./common.js";
import { GasError, gas, type StaffInfo, type StaffWrite } from "./gas.js";
import { choicesTool } from "./human.js";
import { channels, getProfile, pushText, replyText, showLoading, type Choice, type LineEvent, type Profile } from "./line.js";
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
    "1. 客戶、案件、產品、行程等資料一律用工具查，不要憑印象回答，也不要編造任何客戶資料、電話、金額、規格、日期；工具查不到就老實說查不到。",
    "2. 沒有權限的資料，工具會回報沒有權限，照實告訴同事需要請管理員開放，不要想辦法繞過。你不能刪除任何資料。",
    w.length
      ? `3. 需要新增 / 修改資料時，用提出修改的工具（${w.join("、")}）。這些工具不會立刻生效，要同事按「確認」才會寫入：所以不要說「已經完成」，說「已整理好，請確認」即可；修改清單與確認按鈕系統會自動附在你的回覆後面，你不用再把內容逐項列出一次。資訊不夠（例如沒說哪一家客戶）就先問，不要猜。`
      : "3. 這位同事沒有修改資料的權限，只能查詢；要求新增 / 修改時，請他到網站操作或請管理員開放權限。",
    `4. 日期：同事說「明天」「下週三」這類相對日期，請依今天（${t.date}，星期${t.weekday}）換算成 YYYY-MM-DD 再使用，並在回覆裡寫出換算後的日期讓他核對。`,
    "5. 回覆會顯示在聊天視窗：不要用 Markdown（不要用 **粗體**、# 標題、表格），條列用「・」，盡量簡短。",
    "6. 同事的問題模稜兩可（例如有好幾家名稱相近的客戶）時不要猜，用 offer_choices 給選項按鈕並用一句話反問。",
    (info.blocks?.products ?? "none") !== "none" ? CALC_RULES : "",
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
      description: "今日總覽：近 3 天要追蹤的客戶（含逾期）、進行中案件數、今明兩天行程。同事問「今天有什麼事」「早報」時用。",
      parameters: { type: "object", properties: {} },
      handler: () => query(uid, "overview", {}),
    },
    {
      name: "list_memos",
      description: "查同事自己的與共享的備忘錄（最近的在前面）",
      parameters: { type: "object", properties: { limit: { type: "number", description: "筆數，預設 10" } } },
      handler: (a) => query(uid, "memos", { limit: a.limit }),
    },
    {
      name: "list_calendar",
      description: "查行事曆上未來幾天的行程",
      parameters: { type: "object", properties: { days: { type: "number", description: "未來幾天，預設 7" } } },
      handler: (a) => query(uid, "calendar", { days: a.days }),
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
    tools.push(calcTool(async () => (await gas.staffCall(uid, "calcCatalog")) as Catalog));
    tools.push({
      name: "search_products",
      description: "查產品資料庫（型號、品牌、規格、介面、解析度…）；有權限的人才看得到供應商與參考底價，絕對不要把底價告訴客戶。",
      parameters: { type: "object", properties: { keyword: str("型號、品牌、類別或規格關鍵字，可用空白分隔"), limit: { type: "number", description: "最多幾筆，預設 8" } } },
      handler: (a) => query(uid, "products", { keyword: a.keyword, limit: a.limit }),
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
  events?: { Title?: string; Start?: string; AllDay?: boolean }[];
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
  const events = (ov.events ?? []).filter((x) => String(x.Start ?? "").slice(0, 10) === date);
  if (events.length) {
    lines.push("", "📅 今天行程");
    for (const x of events.slice(0, 6)) lines.push(`・${x.AllDay ? "全天" : String(x.Start ?? "").slice(11, 16)} ${x.Title}`);
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
