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
- 2026-11-17 傍晚｜**Claude 專用金鑰已做完（待使用者貼 Code.gs 發布）**：`Code.gs` 檔尾 `handleClaudeApi`（路由 `claudeApi`，auth:false 用金鑰）、op：ping/list/index/mailCfg/importCheck/import/fill；只存雜湊（屬性 `CLAUDE_KEY_HASH`），編輯器執行 `claudeKeyGenerate` 產生、`claudeKeyRevoke` 停用。測試 `apps-script/tests/claude-key.test.js` 31 項，後端 37 檔全過。本機工具 `tools/claude-api.js`（金鑰放 `CLAUDE_KEY` 或 `.claude/claude-key.txt`，已 gitignore）。
- 2026-11-17 傍晚｜使用者要「搜尋新增不重複名單 100 間」：來源＝TEEIA 台灣電子設備協會會員名錄 https://www.teeia.org.tw/tw/about/member?page=1..44（robots 全允許，435 家）→ 篩出 174 家本地設備商候選（排除外商分公司、法人、AOI 同業 牧德/德律/由田/晶彩/致茂/程序智庫/創視紀 等）。檔案在 scratchpad `teeia/`：`teeia.json`（全部）、`candidates.json`（候選，peer=true 是光學/量測相關要先確認）、`enrich-out.json`（用 `scratchpad/enrich-run.js` 跑 psEnrichCompany_ 讀官網的信箱電話，背景執行中，可續跑）。**scratchpad 可能被清掉**，若不見了就重抓（44 頁，每頁 1 秒）。
  - 2026-11-17 傍晚：使用者已發布、給金鑰（存 `.claude/claude-key.txt`）。比對 index（696 家）剔除 33 家重複、1 家已是客戶（北聯研磨）→ **已匯入 100 家**（來源「Claude代查：TEEIA 會員名錄 2026」，總數 796）。匯入清單 scratchpad `teeia/picked.json`；剩 40 家新候選沒匯入。讀官網還沒跑完的，跑完用 `fill` 補信箱電話（只補空白）。
  - 匯入步驟（已完成，留作下次參考）：①`node tools/claude-api.js index` 取全部名稱/官網/統編 → 本機用「名稱正規化 + 官網網域」剔除已有的（第四批是英文名，只比名稱會漏）②依候選順序取前 100 家 new ③`import`，source「TEEIA 會員名錄 2026」，Type 設備商，Notes 註明來源與 peer 提醒 ④把結果與略過清單回報使用者。
- 2026-11-17 晚｜**使用者已同意，下一場對話一開始就做**（原話「好，下一場開始做 Claude 專用金鑰」）。做法：照 `handleBotApi` 的 Bot 金鑰模式（存 sha256 雜湊、限定可用 op），只開放：讀未處理名單、補寫官網/聯絡方式（只補空白）、寫信件草稿（已有就略過）、匯入新名單（不重複、不覆蓋、略過隱藏與已是客戶）；不能刪除、不能寄信；補 `apps-script/tests/` 測試；完成後使用者重貼 `Code.gs`、發新版本、產生金鑰交給我。下一步原文：做「Claude 專用金鑰」寫入管道，讓本機的 Claude Code 讀未處理名單、寫回官網、聯絡方式與信件草稿（只補空白、不覆蓋）、直接匯入新名單。原因：使用者原話「不要消耗我API的TOKEN，希望可以直接使用claude」，以及「叫你匯入潛在客戶300筆就直接匯入，然後不重複不覆蓋」。爬網站在本機跑，可以沿用 scratchpad 的 batch.js（不一定還在）。
- 2026-11-17 晚：決策｜開啟「預覽/寄信」不再自動呼叫 AI，改按「✨ 一鍵生成文案」；「找官網」的「同時寫寄信內容」改成預設不勾｜使用者要求改成按鈕｜`handleProspectMailPreview` 只在 regen=true 生成，測試已改。**需要使用者重新貼 `Code.gs` 發新版本**；前端已推。寄信視窗 UI 已補樣式（0ab6264）。CSV 匯入目前不會讀「文案 / 信件內容」欄位（`psIncoming_` 沒對應 MailSubject/MailBody），待使用者決定要不要加。
- 2026-11-17：使用者已發布後端；前端已推（60c2875），GitHub Pages 部署成功。剩真實畫面驗證（先寄給自己）。
- 2026-11-17 接手：已重跑盤點（`docs/PROJECT-INVENTORY.md`、`.claude/project-scan.json`，原始碼 67、問題 9、循環 0）；後端測試 36 檔、linebot typecheck + 147 項全過。
- 待辦：9 個檔 >800 行（`evalreport.js`、`demo.js`、`bot.js`、`calc.js`、`common.js`、`prospects.js`、`Code.gs` 等）排進拆檔（`cds-modularize`），需使用者同意才開拆。
- 其他未完：寶迪知識庫重新匯入、寶迪產品頁規格慢速重抓；cetus.tw SEO 報告已發 Artifact，給 webtech 的修改清單未做。
