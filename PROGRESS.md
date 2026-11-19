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
  - 2026-11-17 傍晚：使用者已發布、給金鑰（存 `.claude/claude-key.txt`）。比對 index（696 家）剔除 33 家重複、1 家已是客戶（北聯研磨）→ **已匯入 100 家**（來源「Claude代查：TEEIA 會員名錄 2026」，總數 796）。匯入清單 scratchpad `teeia/picked.json`；剩 40 家新候選沒匯入。讀官網已跑完並用 `fill` 寫回：100 家都標了查詢結果，59 家有 Email。下一步：用 `list noMail` 讀這些公司官網、在本機寫開發信，再 `fill` 存草稿。
  - 匯入步驟（已完成，留作下次參考）：①`node tools/claude-api.js index` 取全部名稱/官網/統編 → 本機用「名稱正規化 + 官網網域」剔除已有的（第四批是英文名，只比名稱會漏）②依候選順序取前 100 家 new ③`import`，source「TEEIA 會員名錄 2026」，Type 設備商，Notes 註明來源與 peer 提醒 ④把結果與略過清單回報使用者。
- 2026-11-17 晚｜**使用者已同意，下一場對話一開始就做**（原話「好，下一場開始做 Claude 專用金鑰」）。做法：照 `handleBotApi` 的 Bot 金鑰模式（存 sha256 雜湊、限定可用 op），只開放：讀未處理名單、補寫官網/聯絡方式（只補空白）、寫信件草稿（已有就略過）、匯入新名單（不重複、不覆蓋、略過隱藏與已是客戶）；不能刪除、不能寄信；補 `apps-script/tests/` 測試；完成後使用者重貼 `Code.gs`、發新版本、產生金鑰交給我。下一步原文：做「Claude 專用金鑰」寫入管道，讓本機的 Claude Code 讀未處理名單、寫回官網、聯絡方式與信件草稿（只補空白、不覆蓋）、直接匯入新名單。原因：使用者原話「不要消耗我API的TOKEN，希望可以直接使用claude」，以及「叫你匯入潛在客戶300筆就直接匯入，然後不重複不覆蓋」。爬網站在本機跑，可以沿用 scratchpad 的 batch.js（不一定還在）。
- 2026-11-17 晚：決策｜開啟「預覽/寄信」不再自動呼叫 AI，改按「✨ 一鍵生成文案」；「找官網」的「同時寫寄信內容」改成預設不勾｜使用者要求改成按鈕｜`handleProspectMailPreview` 只在 regen=true 生成，測試已改。**需要使用者重新貼 `Code.gs` 發新版本**；前端已推。寄信視窗 UI 已補樣式（0ab6264）。CSV 匯入目前不會讀「文案 / 信件內容」欄位（`psIncoming_` 沒對應 MailSubject/MailBody），待使用者決定要不要加。
- 2026-11-17：使用者已發布後端；前端已推（60c2875），GitHub Pages 部署成功。剩真實畫面驗證（先寄給自己）。
- 2026-11-17 接手：已重跑盤點（`docs/PROJECT-INVENTORY.md`、`.claude/project-scan.json`，原始碼 67、問題 9、循環 0）；後端測試 36 檔、linebot typecheck + 147 項全過。
- 待辦：9 個檔 >800 行（`evalreport.js`、`demo.js`、`bot.js`、`calc.js`、`common.js`、`prospects.js`、`Code.gs` 等）排進拆檔（`cds-modularize`），需使用者同意才開拆。
- 其他未完：寶迪知識庫重新匯入、寶迪產品頁規格慢速重抓；cetus.tw SEO 報告已發 Artifact，給 webtech 的修改清單未做。
- 2026-11-17 晚｜使用者要求「名單中沒有開發信件的也補足，之後要直接發送」：沒有草稿且有 Email、沒拒絕聯絡的共 681 家（清單 scratchpad `teeia/todo-mail.json`，可用 `node tools/claude-api.js list '{"noMail":true}'` 重抓）。已寫 6 封（元捷、帝駒、東榮豐、春竑、承輝、昊爾，`fill` 存草稿）。**刻意略過**：三德科技（官網有薄膜檢測、黏袋視覺檢測機＝可能同業）、益賽德（Exyte 無塵室工程，非目標）。下一場：每批約 30～50 家，先抓官網文字（TEEIA 的在 `teeia/enrich-out.json` 的 text；舊名單要重讀官網），依 mailCfg 寫信 → fill；第四批標「可能是同業」的 75 家先列給使用者確認，不寫。
- 2026-11-17 晚｜開發信續寫：TEEIA 批完成（寫 43 封、略過 16 家，略過原因在 scratchpad `teeia/mail-skip.json`）。舊名單 622 家：85 家備註「可能是同業」不寫（`teeia/old-peer.json`，要給使用者確認）；537 家背景讀官網中（`enrich-run.js` → `teeia/old-out.json`，可續跑），讀完一批就用 `teeia/mailgen.py` 的範本寫信 → `fill`。scratchpad 若被清掉：用 `list noMail` 重抓即可，已寫的不會重寫（fill 不覆蓋草稿）。
- 2026-11-17 深夜｜開發信進度（持續更新）：已寫 229 封（TEEIA 43＋舊名單 186，到 mail-o14）；先前記錄：98 封已寫進名單（fill）。舊名單略過紀錄在 `teeia/old-skip.json`（同業、外商、代理商、網址錯誤）。續寫流程：`python -I teeia/nextold.py <S> 16 "列號=略過原因"` 列下一批 → 寫 `teeia/mail-oN.py`（用 mailgen.mail）→ fill。背景讀官網約 87/537，可續跑。
- 2026-11-18 凌晨｜**待補存**：`teeia/mail-o15.json`（18 封：友鋮～岱稜）寫好了但連不到 script.google.com（連線逾時）沒存進系統；網路恢復後先跑 `node tools/claude-api.js fill @<S>/teeia/mail-o15.json`。注意 `nextold.py` 會把 mail-o15 當成已完成，補存前不要刪這個檔。背景讀官網 537 家已全部讀完（`teeia/old-out.json`），剩約 222 家待寫。已存進系統：229 封。
- 2026-11-18｜o15 已確認存入（247 封）。**4 封開頭公司名寫錯，要使用者寄前手動改**：JAINNHER（寫建德工業→鍵和機械）、PERFECT MACHINE（準力機械→普發工業）、DediProg（德鑫科技→岱鐠科技）、Jiann Sheng（健昇機電→健陞機電）。之後英文名公司只用查證過的中文名或英文名。
- 2026-11-18｜**開發信全部完成：383 封**存進名單（TEEIA 43＋舊名單 340）。沒寫的 298 家整理在 `C:\Users\jason\Downloads\開發信沒寫的公司_20261118.md`：可能同業 38、名單備註可能同業 85、官網讀不到 91、非目標 84。待使用者：①改 4 封公司名（見上）②確認同業清單 ③寄信每天 100 封上限（一般 Gmail）。
- 2026-11-18｜使用者六項要求：①同業也寫信（硬體供應／軟體客製／合作）並在畫面標記 ②非同業跳過的也寫 ③「存成 Gmail 草稿」按鈕 ④CSV 匯入讀主旨／信件內容 ⑤TEEIA 剩 40 家匯入 ⑥4 封公司名直接改。
  - 已完成：程式（commit e78e968，**只在本機、還沒推**：舊後端不認得 draftOnly，前端先推會把信直接寄出）；40 家已匯入（總 836）並寫回官網查詢結果；補寫 316 封（同業 126＋通用 173＋TEEIA 17），開發信總計 699 封。排除寶迪自動化（供應商）、華洋精機（官網 / Email 是別家）。
  - **等使用者貼新版 Code.gs 發布後**：①`node tools/claude-api.js fill @<S>/teeia/peer-mark.json`（127 家同業標記）②`node tools/claude-api.js redraft @<S>/teeia/redraft4.json`（4 封公司名）③`git push` 推前端。scratchpad 不見的話：同業清單在 Downloads 的 skip 報告。
- 2026-11-18｜四種附件（設備商推 AOI／一般客戶 AOI／供應廠商／運動控制客戶）＋寄信時下拉選附件＋「🧪 測試寄出」（寄給自己、不算已寄出）完成，commit a2512ff（本機，還沒推；跟 e78e968 一起等後端發布）。
- 2026-11-18：使用者已發布後端。已完成：127 家同業標記（fill 127 updated）、4 封公司名修正（redraft 4 updated）、前端推送（78fde0d），GitHub Pages 部署成功、線上頁面已是 prospects.js?v=20261118b。剩：使用者在「⚙️ 寄信設定」貼四個 Drive 附件連結、用「🧪 測試寄出」寄給自己核對畫面（真實瀏覽器尚未點過）。待辦（需同意）：9 個超過 800 行的檔拆檔（cds-modularize）。
- 2026-11-18：開發名單（1）搜尋列加「開發狀態」下拉，左側開發狀態列出全部 7 種並移到類型下方；「清除全部條件」也清類型（原本漏了）。（2）批次列改成「選動作 → 執行」，新增 ✉️ 批次寄信（後端 `prospectMailBulk`，寄存好的草稿、略過沒信箱/沒草稿/拒絕/隱藏/已寄、先 dryRun 統計與 Gmail 額度、分批 20 家、每封記聯繫紀錄）。測試 prospects-mail 59 項、全 37 檔通過；無頭 Chrome 用假資料測試頁截圖確認淺色/深色。**要使用者重貼 Code.gs 發布**，前端已推（舊後端收到批次寄信會回「未知的操作」，不會亂寄）。
- 2026-11-18：寄出開發信（單封、批次）後狀態改成「開發中」（原本是「已聯絡」）；「已聯絡」留給雙方真的聯繫上。只改「未處理」的，後面狀態不動。手動記聯繫紀錄的第一次仍自動變「已聯絡」（沒改）。要使用者重貼 Code.gs。
- 2026-11-18：「預覽/寄信」視窗公司名稱下方加官網連結（開新分頁）；寄信 / 寄信設定視窗 z-index 提到 400，矮螢幕不再被頂部導覽列蓋住上半段。只改前端，已推。
- 2026-11-18：開發名單支援多個聯絡人（新欄 Contacts，JSON，最多 10 位）；寄信收件人預設帶主要+其他聯絡人全部信箱、一封寄給所有人；批次寄信同；查官網找到的其他信箱只列成按鈕不自動寄；額度以收件人數扣。Claude 金鑰 fill/import 可帶 Contacts（只新增）。prospects-mail 72 項、全 37 檔通過。**要使用者重貼 Code.gs**（新欄會在第一次讀名單時自動補上）。
- 2026-11-19：修多收件人只寄第一個：測試寄出原本只取第一個信箱（psEmail_）→ 改用共用 psRecipients_（逗號/分號/頓號/空白分隔、格式錯指出哪個），確認寄出/草稿/批次統一用逗號串接。若使用者還沒貼 ef10403 之後的 Code.gs，確認寄出也只會寄第一個。prospects-mail 75 項、全 37 檔通過。要使用者重貼 Code.gs。
- 2026-11-19：名片依公司彙整（後端 cardCompanies，全公司名片依 psNameKey_ 合併、標已是客戶/在開發名單）；名片專區加「依公司彙整」檢視，客戶管理聯絡窗口、開發名單聯繫視窗加「名片紀錄」（共用 frontend/cardpeople.js）。namecards-web 32 項、全 37 檔通過；示範模式截圖確認。**要使用者重貼 Code.gs**。另：2c73f45 的 Pages 部署因 GitHub 暫時錯誤失敗，已重跑成功。
