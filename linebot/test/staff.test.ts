import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import type { StaffInfo } from "../src/gas.js";
import type { LineEvent } from "../src/line.js";
import { briefingText, handleStaffEvent, pushBriefings, resetStaffKnowledgeCache, staffConverse, staffSystemPrompt } from "../src/staff.js";

process.env.LINE_CHANNEL_SECRET = "staff-secret";
process.env.LINE_CHANNEL_ACCESS_TOKEN = "staff-token";
process.env.GAS_URL = "https://script.example/exec";
process.env.BOT_SECRET = "aoi-test-secret";

type Call = { op: string; [k: string]: unknown };
interface State {
  info: Partial<StaffInfo>;
  gas: Call[];
  line: { kind: string; body: Record<string, any> }[];
  aiRound: number;
  aiCalls: Record<string, any>[];
  /** 依輪次回傳 AI 的回應；預設直接回文字 */
  ai: (round: number, body: Record<string, any>) => Record<string, any>;
  stageError: string;
  pending: string;
  history: { u: boolean; t: string }[];
}
let state: State;
const realFetch = globalThis.fetch;

const text = (t: string) => ({ candidates: [{ content: { role: "model", parts: [{ text: t }] } }] });
const toolCall = (name: string, args: Record<string, unknown>) => ({ candidates: [{ content: { role: "model", parts: [{ functionCall: { name, args } }] } }] });

function baseInfo(over: Partial<StaffInfo> = {}): StaffInfo {
  return {
    allowed: true, status: "已開通", problem: "", isNew: false, name: "小明", appName: "鑫堡", channel: "line", replyDelay: 0,
    texts: { welcome: "👋 您好小明", pending: "⏳ 等待開通" },
    userId: "U", linked: true, username: "ed",
    blocks: { products: "edit", cases: "edit", customers: "edit", files: "edit", copy: "none", bot: "none" },
    prompt: "稱呼我老闆",
    ai: { source: "bot", provider: "gemini", apiKey: "KEY", model: "gemini-test", endpoint: "https://ai.example/v1beta" },
    aiFallback: [], history: state.history,
    writable: ["addMemo", "logFollowUp", "updateCustomer", "addCustomer", "createCase", "updateCaseStatus", "remember"],
    pending: state.pending, today: "2026-11-04",
    memory: { enabled: true, maxItems: 30, confirm: true, canShared: false, categories: ["稱呼與職務", "其他"], items: [{ id: 3, scope: "all", category: "公司規定", content: "上班時間九點", importance: 5 }] },
    ...over,
  };
}

beforeEach(() => {
  resetStaffKnowledgeCache();
  state = {
    info: {}, gas: [], line: [], aiRound: 0, aiCalls: [], stageError: "", pending: "", history: [],
    ai: () => text("好的"),
  };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (url === process.env.GAS_URL) {
      state.gas.push(body);
      const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data }));
      const err = (message: string) => new Response(JSON.stringify({ success: false, message }));
      switch (body.op) {
        case "start": return ok(baseInfo(state.info));
        case "call":
          if (body.call === "customers") return ok({ total: 1, items: [{ CompanyName: "甲公司", Phone: "0912" }] });
          if (body.call === "cases" && body.lineUserId.startsWith("Ulimited")) return err("你沒有「案件與評估」的查看權限");
          if (body.call === "kbChunks") return ok([{ id: "k1", source: "常見問題", title: "光源", category: "光源", topic: "環形", text: "問：有光源嗎\n答：有環形光源" }, { id: "k2", source: "文件", title: "簡介", text: "公司簡介內容" }]);
          if (body.call === "kbVectors") return ok({ model: "gemini:gemini-embedding-001:256", items: [{ id: "k1", v: [1, 0] }, { id: "k2", v: [0, 1] }], total: 2, next: 2 });
          if (body.call === "me") return ok({ name: "小明" });
          if (body.call === "overview") return ok({ followups: { total: 2, items: [{ CompanyName: "乙公司", NextFollowUpDate: "2026-11-01", status: "已逾期" }, { CompanyName: "甲公司", NextFollowUpDate: "2026-11-04", NextFollowUpTime: "14:30", NextFollowUpNote: "報價確認", status: "今天" }] }, openCases: { total: 3, byStatus: { 需求單已發出: 2, 評估單已發出: 1 }, high: [{ CaseID: "C-1", CustomerName: "甲公司" }] } });
          return ok({});
        case "stage":
          if (state.stageError) return err(state.stageError);
          return ok({ token: "abcdef0123", summary: (body.ops as { action: string }[]).map((o) => `📝 ${o.action}`).join("\n") });
        case "commit": return ok({ summary: "📝 addMemo", count: 1, results: [{ action: "createCase", ok: true, caseId: "S-T-A-甲公司" }] });
        case "cancel": return ok(true);
        case "remember": return ok(2);
        case "forget": return ok(true);
        case "unfollow": return ok(true);
        case "memory": return ok({ id: 9 });
        case "pushTargets": return ok(["U" + "1".repeat(32), "U" + "2".repeat(32)]);
        default: return err("unknown op " + body.op);
      }
    }
    if (url.startsWith("https://ai.example/")) {
      state.aiCalls.push(body);
      return new Response(JSON.stringify(state.ai(state.aiRound++, body)));
    }
    if (url.startsWith("https://api.line.me/")) {
      state.line.push({ kind: url.split("/bot/")[1], body });
      return new Response("{}");
    }
    return realFetch(input, init);
  }) as typeof fetch;
});

const U1 = "U" + "a".repeat(32);
const evMsg = (t: string): LineEvent => ({ type: "message", replyToken: "rt", source: { type: "user", userId: U1 }, message: { type: "text", text: t } });
const gasOps = (op: string) => state.gas.filter((g) => g.op === op);
const replies = () => state.line.filter((l) => l.kind === "message/reply");
const replyOf = (i = 0) => String(replies()[i]?.body.messages.at(-1)?.text ?? "");

test("提示詞：日期、權限、記憶、管理員規則、等待確認", () => {
  state.pending = "📝 addMemo";
  const p = staffSystemPrompt(baseInfo({ pending: "📝 addMemo" }));
  assert.match(p, /\d{4}-\d{2}-\d{2}/);
  assert.match(p, /客戶與追蹤：可查看與修改/);
  assert.match(p, /文案製作：沒有權限/);
  assert.match(p, /上班時間九點/);
  assert.match(p, /全公司/);
  assert.match(p, /稱呼我老闆/);
  assert.match(p, /等待同事確認/);
  assert.match(p, /不能刪除任何資料/);
  const viewer = staffSystemPrompt(baseInfo({ writable: [], blocks: { customers: "view" } }));
  assert.match(viewer, /只能查詢/);
  assert.doesNotMatch(viewer, /提出修改的工具/);
});

test("LINE：未開通的員工 → 回覆等待開通，不呼叫 AI", async () => {
  state.info = { allowed: false, status: "待開通", isNew: true };
  await handleStaffEvent(evMsg("你好"));
  assert.equal(replyOf(), "⏳ 等待開通");
  assert.equal(state.aiCalls.length, 0);
  state.info = { allowed: false, status: "停用" };
  state.line = [];
  await handleStaffEvent(evMsg("你好"));
  assert.match(replyOf(), /已停用/);
});

test("LINE：加好友登記並回覆歡迎詞 / 封鎖通知管理系統", async () => {
  await handleStaffEvent({ type: "follow", replyToken: "rt", source: { type: "user", userId: U1 } });
  assert.equal(gasOps("start").length, 1);
  assert.equal(replyOf(), "👋 您好小明");
  await handleStaffEvent({ type: "unfollow", source: { type: "user", userId: U1 } });
  assert.equal(gasOps("unfollow").length, 1);
});

test("群組裡不回應（避免洩漏資料）", async () => {
  await handleStaffEvent({ type: "message", replyToken: "rt", source: { type: "group", groupId: "G1", userId: U1 }, message: { type: "text", text: "查客戶" } });
  assert.equal(state.gas.length, 0);
  assert.equal(state.line.length, 0);
});

test("查詢：AI 呼叫 search_customers → 管理系統查詢 → 用結果回答；沒有權限的區塊沒有工具", async () => {
  state.ai = (round) => (round === 0 ? toolCall("search_customers", { keyword: "甲" }) : text("甲公司，電話 0912"));
  await handleStaffEvent(evMsg("甲公司的電話"));
  const call = gasOps("call")[0];
  assert.equal(call.call, "customers");
  assert.deepEqual(call.params, { keyword: "甲" });
  assert.equal(replyOf(), "甲公司，電話 0912");
  const names = (state.aiCalls[0].tools[0].functionDeclarations as { name: string }[]).map((t) => t.name);
  assert.ok(names.includes("search_customers") && names.includes("search_products") && names.includes("log_followup"));
  assert.equal(gasOps("remember").length, 1, "記錄短期對話");

  // 只有案件權限
  state.info = { blocks: { cases: "view", customers: "none", products: "none" }, writable: ["addMemo"] };
  state.aiCalls = [];
  state.aiRound = 0;
  state.ai = () => text("ok");
  await handleStaffEvent(evMsg("查"));
  const names2 = (state.aiCalls[0].tools[0].functionDeclarations as { name: string }[]).map((t) => t.name);
  assert.ok(names2.includes("search_cases") && !names2.includes("search_customers") && !names2.includes("search_products") && !names2.includes("update_customer"));
  assert.ok(names2.includes("add_memo") && !names2.includes("log_followup"));
});

test("沒有任何刪除工具", async () => {
  state.ai = () => text("ok");
  await handleStaffEvent(evMsg("hi"));
  const names = (state.aiCalls[0].tools[0].functionDeclarations as { name: string }[]).map((t) => t.name);
  assert.ok(names.length > 8);
  assert.ok(!names.some((n) => /delete|remove|刪/.test(n)), names.join());
});

test("修改：AI 提出 → 暫存 + 回覆附清單與確認按鈕（還沒寫入）；按確認才 commit", async () => {
  state.ai = (round) => (round === 0 ? toolCall("add_memo", { title: "提醒", content: "寄樣品" }) : text("好，幫你記了一則備忘錄，請確認。"));
  await handleStaffEvent(evMsg("記一下明天要寄樣品"));
  const stage = gasOps("stage")[0];
  assert.deepEqual(stage.ops, [{ action: "addMemo", data: { title: "提醒", content: "寄樣品", shared: false } }]);
  assert.equal(gasOps("commit").length, 0, "還沒寫入");
  const r = replies()[0].body.messages.at(-1);
  assert.match(r.text, /請確認/);
  assert.match(r.text, /等你確認後才會寫入/);
  assert.match(r.text, /addMemo/);
  const qr = r.quickReply.items.map((i: any) => i.action);
  assert.equal(qr[0].type, "postback");
  assert.equal(qr[0].data, "staff:ok:abcdef0123");
  assert.equal(qr[1].data, "staff:no:abcdef0123");

  // 按確認
  state.pending = "📝 addMemo";
  state.line = [];
  await handleStaffEvent({ type: "postback", replyToken: "rt", source: { type: "user", userId: U1 }, postback: { data: "staff:ok:abcdef0123" } });
  assert.equal(gasOps("commit").length, 1);
  assert.equal(gasOps("commit")[0].token, "abcdef0123");
  assert.match(replyOf(), /✅ 已寫入（1 項）/);
  assert.match(replyOf(), /案件編號：S-T-A-甲公司/);
  assert.equal(state.aiCalls.length, 2, "確認時不再呼叫 AI");
});

test("文字回覆「確認」/「取消」也行（有待確認時）；沒有待確認時照一般對話", async () => {
  state.pending = "📝 addMemo";
  await handleStaffEvent(evMsg("確認"));
  assert.equal(gasOps("commit").length, 1);
  state.line = [];
  await handleStaffEvent(evMsg("取消"));
  assert.equal(gasOps("cancel").length, 1);
  assert.match(replyOf(), /已取消/);

  state.pending = "";
  state.gas = [];
  state.line = [];
  await handleStaffEvent(evMsg("好"));
  assert.equal(gasOps("commit").length, 0, "沒有待確認時「好」只是一般訊息");
  assert.equal(state.aiCalls.length, 1);
});

test("按舊的確認按鈕（已處理 / 逾期）→ 提示，不寫入", async () => {
  state.pending = "";
  await handleStaffEvent({ type: "postback", replyToken: "rt", source: { type: "user", userId: U1 }, postback: { data: "staff:ok:abcdef0123" } });
  assert.equal(gasOps("commit").length, 0);
  assert.match(replyOf(), /已經處理過|失效/);
});

test("提出修改驗證失敗 → 錯誤回給 AI 讓它反問，不暫存", async () => {
  state.stageError = "找不到客戶「丙公司」";
  state.ai = (round, body) => {
    if (round === 0) return toolCall("log_followup", { company: "丙公司", summary: "x" });
    const last = JSON.stringify(body.contents.at(-1));
    assert.match(last, /找不到客戶/);
    return text("找不到丙公司，你是指哪一間？");
  };
  await handleStaffEvent(evMsg("記錄丙公司"));
  assert.match(replyOf(), /找不到丙公司/);
  assert.doesNotMatch(replyOf(), /等你確認後/);
  assert.equal(replies()[0].body.messages.at(-1).quickReply, undefined);
});

test("一次提出多項修改：每次整批重新驗證，最後清單包含全部", async () => {
  state.ai = (round) => {
    if (round === 0) return toolCall("update_case", { case_id: "C-1", status: "已結案" });
    if (round === 1) return toolCall("add_memo", { title: "t" });
    return text("兩項都整理好了");
  };
  await handleStaffEvent(evMsg("C-1 結案並記備忘"));
  const stages = gasOps("stage");
  assert.equal(stages.length, 2);
  assert.equal((stages[1].ops as unknown[]).length, 2);
  assert.match(replyOf(), /updateCaseStatus/);
  assert.match(replyOf(), /addMemo/);
});

test("update_customer 只送有填的欄位；logFollowUp 欄位名稱轉換", async () => {
  state.ai = (round) => (round === 0 ? toolCall("update_customer", { company: "甲公司", phone: "0922", email: "" }) : round === 1 ? toolCall("log_followup", { company: "甲公司", summary: "報價", next_date: "2026-11-10", next_time: "10:00", stop_following: false }) : text("ok"));
  await handleStaffEvent(evMsg("改"));
  const ops = gasOps("stage")[1].ops as { action: string; data: Record<string, any> }[];
  assert.deepEqual(ops[0].data.fields, { Phone: "0922" });
  assert.equal(ops[1].data.nextDate, "2026-11-10");
  assert.equal(ops[1].data.nextTime, "10:00");
  assert.equal(ops[1].data.stop, undefined);
});

test("長期記憶：要確認 → 走 stage；不用確認 → 直接寫入；忘記 → 直接刪除", async () => {
  state.ai = (round) => (round === 0 ? toolCall("remember", { content: "我負責北區", category: "稱呼與職務" }) : text("我記下來了，請確認"));
  await handleStaffEvent(evMsg("記住我負責北區"));
  assert.equal((gasOps("stage")[0].ops as { action: string }[])[0].action, "remember");
  assert.equal(gasOps("memory").length, 0);

  state.gas = [];
  state.aiRound = 0;
  state.info = { memory: { enabled: true, maxItems: 30, confirm: false, canShared: false, categories: ["其他"], items: [] } };
  state.ai = (round) => (round === 0 ? toolCall("remember", { content: "我負責北區", scope: "all" }) : round === 1 ? toolCall("forget_memory", { id: 3 }) : text("好"));
  await handleStaffEvent(evMsg("記住"));
  const mem = gasOps("memory");
  assert.equal(mem.length, 2);
  assert.deepEqual(mem[0].data, { mode: "add", content: "我負責北區", scope: "all" });
  assert.deepEqual(mem[1].data, { mode: "delete", id: 3 });
  assert.equal(gasOps("stage").length, 0);
});

test("重新開始：清除短期記憶，不呼叫 AI", async () => {
  await handleStaffEvent(evMsg("重新開始"));
  assert.equal(gasOps("forget").length, 1);
  assert.equal(state.aiCalls.length, 0);
});

test("AI 失敗 → 友善訊息，不洩漏錯誤細節", async () => {
  state.ai = () => {
    throw new Error("key AIza-secret invalid");
  };
  await handleStaffEvent(evMsg("你好"));
  assert.match(replyOf(), /AI 暫時忙碌或設定有誤/);
  assert.doesNotMatch(replyOf(), /AIza/);
});

test("網站助理：沒有 profile 也行，回傳 pending 讓前端畫確認鈕", async () => {
  state.ai = (round) => (round === 0 ? toolCall("create_case", { customer_name: "甲公司", software_name: "S", test_object: "T", product_application: "A" }) : text("案件整理好了"));
  const r = await staffConverse("W" + "c".repeat(32), { text: "建立案件" }, { channel: "web", displayName: "小明" });
  assert.equal(r.pending?.token, "abcdef0123");
  assert.match(r.reply, /等你確認後才會寫入/);
  assert.equal(gasOps("start")[0].displayName, "小明");
  state.pending = "📝 createCase";
  const done = await staffConverse("W" + "c".repeat(32), { confirm: true, token: "abcdef0123" }, { channel: "web" });
  assert.match(done.reply, /已寫入/);
});

test("早報：固定格式（逾期 / 今天 / 案件）；推播給名單內每個人", async () => {
  const t = briefingText("小明", {
    followups: { total: 2, items: [{ CompanyName: "乙公司", NextFollowUpDate: "2026-11-01", status: "已逾期" }, { CompanyName: "甲公司", NextFollowUpDate: "2026-11-04", NextFollowUpTime: "14:30", NextFollowUpNote: "報價確認", status: "今天" }] },
    openCases: { total: 3, byStatus: { 需求單已發出: 2, 評估單已發出: 1 }, high: [{ CaseID: "C-1", CustomerName: "甲公司" }] },
    events: [{ date: "2026-11-04", time: "10:00–11:00", title: "拜訪", location: "新竹" }, { date: "2026-11-05", time: "10:00–11:00", title: "明天的" }, { date: "2026-11-03", endDate: "2026-11-05", time: "全天", title: "展覽", from: "小華" }],
    todos: [{ id: 1, title: "寄樣品", dueDate: "2026-11-04", priority: "高" }, { id: 2, title: "整理報價", dueDate: "2026-11-02" }, { id: 3, title: "下週的事", dueDate: "2026-11-10" }],
  }, "2026-11-04");
  assert.match(t, /早安，小明/);
  assert.match(t, /今天 1 家、已逾期 1 家/);
  assert.match(t, /乙公司（逾期 3 天）/);
  assert.match(t, /甲公司 14:30：報價確認/);
  assert.match(t, /進行中案件 3 件（需求單已發出 2、評估單已發出 1）/);
  assert.match(t, /緊急：C-1/);
  assert.match(t, /10:00 拜訪＠新竹/);
  assert.match(t, /全天 展覽（小華 分享）/, "跨天行程今天也算");
  assert.match(t, /寄樣品/);
  assert.match(t, /整理報價（逾期，期限 11-02）/);
  assert.doesNotMatch(t, /下週的事/);
  assert.doesNotMatch(t, /明天的/);
  const r = await pushBriefings();
  assert.deepEqual(r, { targets: 2, sent: 2, failed: 0 });
  assert.equal(state.line.filter((l) => l.kind === "message/push").length, 2);
});

test("金鑰分開：員工助理的操作用員工金鑰、客服的操作用客服金鑰；網站助理與早報只認員工金鑰", async () => {
  const { gas } = await import("../src/gas.js");
  const { verifyTestToken } = await import("../src/web.js");
  const { POST: webPost } = await import("../api/web.js");
  const { POST: pushPost } = await import("../api/push.js");
  const saved = { cs: process.env.BOT_CS_SECRET, staff: process.env.BOT_STAFF_SECRET };
  process.env.BOT_CS_SECRET = "cs-key-111";
  process.env.BOT_STAFF_SECRET = "staff-key-222";
  try {
    await gas.staffCall(U1, "me").catch(() => undefined);
    await gas.csKnowledge().catch(() => undefined);
    await gas.staffPushTargets().catch(() => undefined);
    await gas.csWidget().catch(() => undefined);
    const used = state.gas.map((g) => `${g.op}:${g.secret}`);
    assert.deepEqual(used, ["call:staff-key-222", "csKnowledge:cs-key-111", "pushTargets:staff-key-222", "csWidget:cs-key-111"]);

    // 網站助理 /api/web：客服金鑰不行
    const post = (key: string) => webPost(new Request("https://x/api/web", { method: "POST", body: JSON.stringify({ secret: key, id: "W" + "c".repeat(32), text: "hi" }) }));
    assert.equal((await post("cs-key-111")).status, 401);
    assert.notEqual((await post("staff-key-222")).status, 401);
    // 早報 /api/push：客服金鑰不行
    const push = (key: string) => pushPost(new Request("https://x/api/push", { method: "POST", headers: { "x-bot-secret": key } }));
    assert.equal((await push("cs-key-111")).status, 401);
    assert.equal((await push("staff-key-222")).status, 200);

    // 測試聊天權杖：用客服金鑰簽；員工金鑰簽的不算
    const { createHmac } = await import("node:crypto");
    const ts = String(Date.now());
    const sign = (key: string) => createHmac("sha256", key).update(ts).digest("hex");
    assert.equal(verifyTestToken(ts, sign("cs-key-111")), true);
    assert.equal(verifyTestToken(ts, sign("staff-key-222")), false);

    // 只設定員工金鑰時，客服操作不能用（不會偷用員工金鑰）
    delete process.env.BOT_CS_SECRET;
    delete process.env.BOT_SECRET;
    await assert.rejects(() => gas.csKnowledge(), /BOT_CS_SECRET/);
  } finally {
    process.env.BOT_SECRET = "aoi-test-secret";
    if (saved.cs === undefined) delete process.env.BOT_CS_SECRET; else process.env.BOT_CS_SECRET = saved.cs;
    if (saved.staff === undefined) delete process.env.BOT_STAFF_SECRET; else process.env.BOT_STAFF_SECRET = saved.staff;
  }
});

// ---------- 全功能：產品 / 詢價 / 報價 / 客戶窗口 / 案件內容 / 文案 ----------
const allWritable = ["addEvent", "addTodo", "completeTodo", "addMemo", "logFollowUp", "updateCustomer", "addCustomer", "createCase", "updateCaseStatus", "updateCase", "addContact", "addPriceRecord", "addProduct", "updateProduct", "createInquiryDraft", "saveCopyPost", "remember"];
const toolNames = (i = 0) => (state.aiCalls[i].tools[0].functionDeclarations as { name: string }[]).map((t) => t.name);

test("全功能工具：依權限出現（產品 / 文案 / 寫入白名單各自控制）", async () => {
  state.info = { blocks: { products: "edit", cases: "edit", customers: "edit", copy: "edit" }, writable: allWritable };
  state.ai = () => text("ok");
  await handleStaffEvent(evMsg("hi"));
  const all = toolNames();
  for (const n of ["list_todos", "add_event", "add_todo", "complete_todo", "get_product", "price_history", "inquiry_draft", "calc_selection", "copy_posts", "copy_style", "update_case_info", "add_contact", "add_price_record", "add_product", "update_product", "create_inquiry_draft", "save_copy_post"]) assert.ok(all.includes(n), "缺工具 " + n);
  assert.ok(!all.some((n) => /delete|remove|刪/.test(n)));

  state.info = { blocks: { products: "view", cases: "none", customers: "none", copy: "none" }, writable: ["addMemo"] };
  state.aiCalls = [];
  state.aiRound = 0;
  await handleStaffEvent(evMsg("hi"));
  const viewer = toolNames();
  assert.ok(viewer.includes("get_product") && viewer.includes("price_history") && viewer.includes("inquiry_draft"));
  assert.ok(!viewer.includes("copy_posts") && !viewer.includes("copy_style"), "沒有文案權限不給文案查詢");
  for (const n of ["update_case_info", "add_contact", "add_price_record", "add_product", "update_product", "create_inquiry_draft", "save_copy_post"]) assert.ok(!viewer.includes(n), "不該有寫入工具 " + n);

  state.info = { blocks: { products: "edit", cases: "none", customers: "none", copy: "none" }, writable: ["addPriceRecord"] };
  state.aiCalls = [];
  state.aiRound = 0;
  await handleStaffEvent(evMsg("hi"));
  const onlyPrice = toolNames();
  assert.ok(onlyPrice.includes("add_price_record") && !onlyPrice.includes("add_product") && !onlyPrice.includes("update_product"), "管理員只開報價 → 只有報價工具");
});

test("提示詞：有產品權限帶詢價規則（不估價、底價不外流）；有文案權限帶文案規則", () => {
  const p = staffSystemPrompt(baseInfo({ blocks: { products: "edit", copy: "edit" } }));
  assert.match(p, /沒有紀錄就說沒有，不要估價/);
  assert.match(p, /不會寄出/);
  assert.match(p, /絕對不要轉述給客戶/);
  assert.match(p, /copy_style/);
  const none = staffSystemPrompt(baseInfo({ blocks: { products: "none", copy: "none" } }));
  assert.doesNotMatch(none, /不要估價|create_inquiry_draft/);
  assert.doesNotMatch(none, /save_copy_post/);
});

test("查詢類工具的參數對應到管理系統的查詢", async () => {
  state.info = { blocks: { products: "edit", copy: "edit" } };
  const steps = [
    ["get_product", { internal_model: "ACA2440" }, "product", { internalModel: "ACA2440" }],
    ["price_history", { internal_model: "ACA2440", limit: 3 }, "priceHistory", { internalModel: "ACA2440", limit: 3 }],
    ["inquiry_draft", { internal_model: "ACA2440", quantity: "10" }, "inquiryDraft", { internalModel: "ACA2440", quantity: "10" }],
    ["copy_posts", { keyword: "光源", status: "draft" }, "copyPosts", { keyword: "光源", status: "draft", limit: undefined }],
    ["copy_style", {}, "copyStyle", {}],
    ["list_todos", { status: "all", scope: "mine" }, "todos", { status: "all", scope: "mine", limit: undefined }],
    ["list_calendar", { days: 14 }, "calendar", { days: 14 }],
  ] as const;
  for (const [tool, args, call, params] of steps) {
    state.gas = [];
    state.aiRound = 0;
    state.ai = (round) => (round === 0 ? toolCall(tool, args as Record<string, unknown>) : text("ok"));
    await handleStaffEvent(evMsg("查"));
    const c = gasOps("call").find((g) => g.call === call);
    assert.ok(c, tool + " → " + call);
    assert.deepEqual(JSON.parse(JSON.stringify(c.params)), JSON.parse(JSON.stringify(params)), tool);
  }
});

test("寫入類工具：欄位名稱轉成管理系統的格式，只送有填的欄位", async () => {
  state.info = { blocks: { products: "edit", cases: "edit", customers: "edit", copy: "edit" }, writable: allWritable };
  const steps: [string, Record<string, unknown>, string, Record<string, unknown>][] = [
    ["update_case_info", { case_id: "C-1", project_contact: "張工", requirement_details: "", fae: "李" }, "updateCase", { caseId: "C-1", fields: { ProjectContact: "張工", FAE: "李" } }],
    ["add_contact", { company: "甲公司", contact_name: "李經理", title: "採購" }, "addContact", { company: "甲公司", contactName: "李經理", title: "採購" }],
    ["add_price_record", { internal_model: "ACA2440", price: 14800, currency: "USD", case_id: "C-1" }, "addPriceRecord", { internalModel: "ACA2440", price: 14800, currency: "USD", caseId: "C-1" }],
    ["add_product", { internal_model: "N1", brand: "Computar", focal_length: "25", fps: "30" }, "addProduct", { internalModel: "N1", fields: { Brand: "Computar", FocalLength: "25", FPS: "30" } }],
    ["update_product", { internal_model: "ACA2440", notes: "新備註", supplier_email: "a@b.com" }, "updateProduct", { internalModel: "ACA2440", fields: { Notes: "新備註", SupplierContactEmail: "a@b.com" } }],
    ["create_inquiry_draft", { internal_model: "ACA2440", quantity: "20" }, "createInquiryDraft", { internalModel: "ACA2440", quantity: "20" }],
    ["add_event", { title: "拜訪甲公司", date: "2026-11-10", time: "14:00", end_time: "15:30", location: "新竹", share_all: false }, "addEvent", { title: "拜訪甲公司", date: "2026-11-10", time: "14:00", endTime: "15:30", location: "新竹", allDay: false }],
    ["add_event", { title: "展覽", date: "2026-11-12", share_all: true }, "addEvent", { title: "展覽", date: "2026-11-12", allDay: true, shareAll: true }],
    ["add_todo", { title: "寄樣品", due_date: "2026-11-06", priority: "高" }, "addTodo", { title: "寄樣品", dueDate: "2026-11-06", priority: "高" }],
    ["complete_todo", { id: 7 }, "completeTodo", { id: 7 }],
    ["complete_todo", { id: 7, reopen: true }, "completeTodo", { id: 7, reopen: true }],
    ["save_copy_post", { platform: "Instagram", topic: "新品", content: "新品上市", scheduled_for: "2026-11-20" }, "saveCopyPost", { platform: "Instagram", topic: "新品", content: "新品上市", scheduledFor: "2026-11-20" }],
  ];
  for (const [tool, args, action, data] of steps) {
    state.gas = [];
    state.aiRound = 0;
    state.ai = (round) => (round === 0 ? toolCall(tool, args) : text("已整理好，請確認"));
    await handleStaffEvent(evMsg("改"));
    const st = gasOps("stage")[0];
    assert.ok(st, tool + " 沒有 stage");
    const op = (st.ops as { action: string; data: Record<string, unknown> }[])[0];
    assert.equal(op.action, action, tool);
    assert.deepEqual(op.data, data, tool);
    assert.equal(gasOps("commit").length, 0, tool + " 不能直接寫入");
  }
});

test("員工助理可以查公司知識庫（含向量）：search_knowledge → 取全部啟用中的段落與向量 → 依搜尋流程檢索", async () => {
  state.info = { search: { mode: "vector", threshold: 0.6, topK: 6 }, embedAi: { provider: "gemini", apiKey: "K", endpoint: "https://ai.example/v1beta", model: "gemini-embedding-001", dim: 2, key: "k" } as never };
  const realFetch2 = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes("batchEmbedContents")) return new Response(JSON.stringify({ embeddings: [{ values: [1, 0] }] }));
    return realFetch2(input, init);
  }) as typeof fetch;
  state.ai = (round) => (round === 0 ? toolCall("search_knowledge", { query: "有沒有光源" }) : text("知識庫說有環形光源"));
  await handleStaffEvent(evMsg("客人問有沒有光源我們怎麼回"));
  globalThis.fetch = realFetch2;
  const calls = gasOps("call").map((g) => g.call);
  assert.ok(calls.includes("kbChunks") && calls.includes("kbVectors"), "向管理系統取知識庫與向量：" + calls.join());
  const names = (state.aiCalls[0].tools[0].functionDeclarations as { name: string }[]).map((t) => t.name);
  assert.ok(names.includes("search_knowledge"), "每位已開通的同事都有知識庫工具");
  const toolResult = JSON.stringify(state.aiCalls[1].contents.at(-1));
  assert.match(toolResult, /環形光源/);
  assert.doesNotMatch(toolResult, /公司簡介內容/, "向量相似度低於閥值的段落不採用");
  // 第二次查詢用快取，不再向管理系統取資料
  const before = gasOps("call").filter((g) => g.call === "kbChunks").length;
  state.aiRound = 0;
  state.ai = (round) => (round === 0 ? toolCall("search_knowledge", { query: "簡介" }) : text("ok"));
  await handleStaffEvent(evMsg("公司簡介"));
  assert.equal(gasOps("call").filter((g) => g.call === "kbChunks").length, before, "5 分鐘內快取");
});

test("沒有向量也能查知識庫（退回關鍵字）；提示詞說明知識庫與客服的差別", async () => {
  state.info = {};
  state.ai = (round) => (round === 0 ? toolCall("search_knowledge", { query: "公司簡介" }) : text("ok"));
  await handleStaffEvent(evMsg("公司簡介是什麼"));
  assert.match(JSON.stringify(state.aiCalls[1].contents.at(-1)), /公司簡介內容/);
  assert.match(staffSystemPrompt(baseInfo()), /search_knowledge/);
  assert.match(staffSystemPrompt(baseInfo()), /客服只看得到知識庫/);
});
