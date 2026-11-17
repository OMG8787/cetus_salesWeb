# PROGRESS

## 2026-11-13 建立
- 依全域規則（cds-project-init）立規矩：`CLAUDE.md`、盤點 `docs/PROJECT-INVENTORY.md` + `.claude/project-scan.json`、相依閘門 `linebot/test/depgraph-gate.test.ts`（循環 0、分層 1 條：`src` 不引用 `test`／`api`）。
- 盤點問題 9 項，全部是單檔 > 800 行（最大：`frontend/evalreport.js` 1542 行）；循環 0 組。
- 已知工具缺口：`depgraph.py --forbid` 有違規時 exit code 仍是 0，閘門測試改成讀輸出的違規數字判斷（之後應在 claude-dev-system repo 修正）。
- 下一步：用 `cds-verify-app` 生成本專案的驗證 skill（前端示範模式 + linebot）；改到大檔時順手小範圍拆。

## 2026-11-17 開發信功能（commit 410e1b5，尚未 push）
- 做完：開發名單「找官網」可同時產生開發信草稿；名單操作欄「✉️ 預覽/寄信」；「⚙️ 寄信設定」（管理員）；寄出後記 Email 聯繫紀錄並把「未處理」改「已聯絡」。後端 `Code.gs`（prospectMail*）、前端 `prospects.html/js`、測試 `apps-script/tests/prospects-mail.test.js`（36 項）、README 新增一節。
- 附件：Apps Script 讀不到 `D:\` 路徑，必須上傳 Google Drive 後在「寄信設定」貼連結；`鑫堡AOI檢測系統.pdf`（根目錄）未 commit。
- 尚待：①使用者貼整份 `Code.gs` 並發新版本（可能要重新授權 Gmail/Drive）②推送前端（等後端發布後）③真實瀏覽器點過畫面（未驗）④Gmail 每日寄信額度已查證：Apps Script 寄信收件人一般 Gmail 帳號 100 位/天、Workspace 1,500 位/天（https://developers.google.com/apps-script/guides/services/quotas，2026-11-17 查）。重新授權：Code.gs 原本就用 GmailApp、DriveApp，權限範圍應該沒有變，可能不會跳授權（未實測）。
- 2026-11-17 接手：已重跑盤點（`docs/PROJECT-INVENTORY.md`、`.claude/project-scan.json`，原始碼 67、問題 9、循環 0）；後端測試 36 檔、linebot typecheck + 147 項全過。
- 待辦：9 個檔 >800 行（`evalreport.js`、`demo.js`、`bot.js`、`calc.js`、`common.js`、`prospects.js`、`Code.gs` 等）排進拆檔（`cds-modularize`），需使用者同意才開拆。
- 其他未完：寶迪知識庫重新匯入、寶迪產品頁規格慢速重抓；cetus.tw SEO 報告已發 Artifact，給 webtech 的修改清單未做。
