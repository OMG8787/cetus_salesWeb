import assert from "node:assert/strict";
import { test } from "node:test";
import { handoffReply } from "../src/cs.js";
import type { CsInfo } from "../src/gas.js";

process.env.CS_LINE_CHANNEL_SECRET = "cs-secret";
process.env.CS_LINE_CHANNEL_ACCESS_TOKEN = "cs-token";
process.env.GAS_URL = "https://script.example/exec";
process.env.BOT_SECRET = "aoi-test-secret";

const info = (extra: Partial<CsInfo>) => ({ handoffText: "已通知專人", topics: [], ...extra }) as CsInfo;

test("按轉真人：先請客人留下資料（文字取自後台設定）", () => {
  const r = handoffReply(info({ handoffLeadText: "請先留下姓名與電話" }));
  assert.equal(r, "已通知專人\n\n請先留下姓名與電話");
});

test("客人已經留過資料 → 不再請他留", () => {
  const r = handoffReply(info({ handoffLeadText: "請先留下姓名與電話", leadState: "done" }));
  assert.equal(r, "已通知專人");
});

test("指定問題有自己的留資料說明 → 用它，不重複加", () => {
  const r = handoffReply(info({ handoffLeadText: "請先留下姓名與電話", topics: [{ name: "價格", words: ["報價"], ask: "請留公司與數量", askPos: "after" }] }), "價格");
  assert.ok(r.includes("請留公司與數量") && !r.includes("請先留下姓名與電話"));
});

test("後台沒設定文字（舊版管理系統）→ 維持原本回覆", () => {
  assert.equal(handoffReply(info({})), "已通知專人");
});
