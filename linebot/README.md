# 機器人伺服器（linebot）

AOI 業務系統的機器人伺服器，部署在 Vercel。設定、知識庫、對話紀錄都存在網站的 Google 試算表，**在網站「BOT 設定」頁管理**，這裡只負責：驗證 LINE 簽章、檢索知識庫、呼叫 AI、回覆。

| 入口 | 用途 |
|---|---|
| `/api/cs` | **客服機器人**的 LINE Webhook（對外官方帳號）：客人問產品、規格、公司資訊，機器人用知識庫回答；報價、訂購、客訴、找人 → 轉真人 |
| `/widget.js` + `/api/widget/*` | **網站客服視窗**：貼一行 `<script>` 到任何網站，右下角出現客服視窗，跟 LINE 客服同一套知識庫與規則 |
| `/api/test` | 網站「BOT 設定 → 測試聊天」用（用管理系統簽的權杖，不通知同仁、不留對話紀錄） |
| `/api/line` | **員工助理**的 LINE Webhook（員工專用官方帳號）：員工查客戶 / 案件 / 產品與報價 / 行事曆與工作清單、記錄追蹤、選型計算、寫詢價信與文案草稿；所有修改與刪除要本人確認才執行（刪除還要網站帳號有刪除權限），做的每件事都記在備忘錄 |
| `/api/search` | 網站「BOT 設定 → 知識庫 → 搜尋測試」用（管理系統簽的權杖）：顯示各種檢索模式找到的段落與分數 |
| `/api/web` | 網站右下角「智能助理」：只給管理系統（Apps Script）用 Bot 金鑰呼叫 |
| `/api/push` | 每日早報：管理系統每小時檢查，到時間呼叫（header `x-bot-secret`） |

```
LINE 客人 ──► LINE 官方帳號 ──► /api/cs（驗簽章）─┐
網站訪客 ──► widget.js ──► /api/widget/chat ────┤──► 檢索知識庫 + AI ──► 回覆
後台測試聊天 ──► /api/test ──────────────────────┘        │
                                                        ▼
                                       管理系統 Code.gs（Google 試算表）
                                       設定、知識庫、AI 金鑰、對話紀錄、轉真人通知
```

## 客服機器人怎麼回答

- 每則客人訊息先從**知識庫**（常見問答、文件、產品型號與規格、公司簡介）找出最相關的幾段，連同「公司規則」交給 AI，**只根據這些內容回答**；資料裡沒有的就請客人輸入「真人」。檢索流程在 BOT 設定 → 知識庫 →「搜尋流程與向量」選擇：**直接向量（預設）／先用大分類、主題、備註縮小範圍再向量／只用中繼資料（BM25，不用向量）／兩種都做、結果一致才回答**；向量的餘弦相似度低於**分數閥值**（預設 0.6）的段落不採用，全部低於就請客人換個說法或轉真人。向量由管理系統用 embedding 模型算好存在試算表（`BotVectors`），機器人伺服器分頁取回後快取 5 分鐘；沒有可用的 embedding 或呼叫失敗時自動退回關鍵字檢索。
- **回覆前檢查**（選用，預設關閉）：打開後，客服回覆送出前再請 AI 核對每個事實是否有這次參考資料的根據，沒有根據就改請客人找專人（或轉專人）；檢查出錯一律不通過。知識庫快取依管理系統回傳的版本號即時更新。
- **每則回覆附「轉真人」按鈕、聊幾段後請訪客留資料、知識庫附圖**：見根目錄 README。網站視窗端點 `POST /api/widget/chat`（`human: true` = 按了轉真人）、`POST /api/widget/lead`（留資料表單）；圖片代理 `GET /api/img?id=雲端硬碟檔案代號&w=寬度`。`widget.js` 可加 `data-launcher="false"` 隱藏右下角圓鈕，改由官網小機器人（`robot-widget.js`）的選單用 `AoiChat.open() / contact() / human()` 開啟。
- **名片登入**（員工助理）：LINE 圖片事件 → `downloadImage` → `extractCards`（`src/cards.ts`，視覺模型）→ `gas.staffCards` 放進名片收件匣 → 助理工具 `list_cards` / `save_cards` / `discard_cards`（確認後才寫入客戶與聯絡窗口）。
- **計算問題**（選型計算）：AI 不心算，一定呼叫 `calc_selection` 工具（`src/calc.ts`，公式與網站選型計算相同）。固定先「重述需求」→「列出自己補的假設」→「計算結果與算式」→「建議型號」；缺必要資料就先反問。相機 / 鏡頭型錄來自管理系統（客服版受產品來源與類別限制，**不含任何價格**）。
- **產品底價、供應商資料永遠不會進知識庫**；機器人不報價，價格、交期、下訂都轉給真人。
- 客人說「真人」「小編」「業務」…，或問到你勾選「交給真人回答」的問題（價格 / 報價、訂購、樣品測試、運費 / 交期、客訴…）→ 回覆轉真人的文字（可附上請客人先留下的資料）、在網站首頁備忘錄通知有「BOT 設定」權限的同事（附上之前的對話），並暫停機器人 N 分鐘讓同事接手。處理完把備忘錄刪除，機器人就恢復回覆這位客人；客人說「重新開始」也能叫回。
- 可設定「只在專人服務時間以外回覆」、語氣、稱呼、emoji、每則最多幾行、歡迎詞與常用按鈕；問題模稜兩可時 AI 會用 `offer_choices` 反問並附上選項按鈕。
- AI 可設多個模型，**依順序備援**（第一個失敗就換下一個）。支援 Gemini、Claude、OpenAI 相容服務。

## 部署

1. **管理系統**：把最新的 `apps-script/Code.gs` 整份貼到 Apps Script（專案裡只留這一個檔案），執行一次 `setup`，部署 → 管理部署作業 → 編輯 → 新版本。
2. **網站 → BOT 設定 → 連線與設定**：分別按「客服機器人金鑰」與「員工助理金鑰」的「🔑 產生」，複製「系統網址」與兩把金鑰。
3. **Vercel**（https://vercel.com/new）：匯入這個 GitHub 專案，**Root Directory 選 `linebot`**，Environment Variables 填：

   | 名稱 | 內容 |
   |---|---|
   | `GAS_URL` | BOT 設定頁的「系統網址」（結尾 /exec） |
   | `BOT_CS_SECRET` | 客服機器人金鑰（只能呼叫客服的功能） |
   | `BOT_STAFF_SECRET` | 員工助理金鑰（只能呼叫員工助理的功能） |
   | `CS_LINE_CHANNEL_SECRET`、`CS_LINE_CHANNEL_ACCESS_TOKEN` | 客服官方帳號的 Channel secret / access token（只用網站客服視窗可以先不填） |
   | `LINE_CHANNEL_SECRET`、`LINE_CHANNEL_ACCESS_TOKEN`（選填） | 員工助理官方帳號（跟客服的官方帳號分開建立；Webhook 填 `/api/line`）。只用網站智能助理可以不填 |
   | `SITE_URL`（選填） | 網站網址 |
   | `BOT_URL`（選填） | 機器人自己的網址；沒填就用 Vercel 正式網址，機器人會自動回報給 BOT 設定頁 |

   Deploy 完成後打開 `https://你的專案.vercel.app/api/cs`，看到 `{"ok":true,"missing":[]}` 就是設定齊全。
4. **LINE Developers → Messaging API**：客服官方帳號的 Webhook URL 填 `https://你的專案.vercel.app/api/cs`，打開 **Use webhook**，按 **Verify**。
5. **LINE Official Account Manager → 回應設定**：「聊天」保持開啟（同事才能接手）、打開 Webhook，**關閉**「自動回應訊息」與「加入好友的歡迎訊息」（改由機器人回覆）。
6. **網站 → BOT 設定**：填 AI 的 API Key（「AI 模型」）、勾「啟用」、建好常見問題，用「測試聊天」試問幾題。
7. **網站客服視窗**：BOT 設定 →「網站客服視窗」勾啟用、填「允許嵌入的網站」，複製嵌入碼貼到你的網站 `</body>` 前面。

> Vercel 免費方案（Hobby）限非商業用途，公司正式使用請改用 Pro 方案。
>
> 重新產生金鑰後，要到對應的 Vercel 專案更新 `BOT_CS_SECRET` / `BOT_STAFF_SECRET` 並 Redeploy，機器人才會恢復。

## 之後更新：從本機重新發布（CMD / PowerShell）

專案是用資料夾上傳建立的，**不會跟 GitHub 自動同步**，改了 `linebot/` 的程式要手動發布：

```
cd /d D:\claude\CetusSalesWeb\linebot
npx.cmd vercel --prod
```

- 第一次會要求 `npx.cmd vercel login`（開瀏覽器授權），之後不用再登入；`linebot/.vercel` 已記住專案，不要建立新專案。
- PowerShell 找不到 `vercel` 時，一律用 `npx.cmd vercel --prod`。
- 發布完成後，網站按 Ctrl+F5，讓新的 `widget.js` 生效。
- **Vercel 免費版（Hobby）最多 12 支 API**（`api/` 底下每個 .ts 算一支，目前剛好 12：cs、img、line、push、search、test、web、widget/chat、close、config、lead、messages）。新增功能請併進既有檔案（例如網站流量回報就併在 `widget/messages.ts` 的 POST），不要再新增檔案，否則會部署失敗。

## 資料隔離（客服與員工助理分流）

- **兩把金鑰**：管理系統（Apps Script）每個操作只屬於一個角色。客服金鑰只能呼叫客服的操作（知識庫、對話、轉真人），員工金鑰只能呼叫員工助理的操作。客服金鑰就算外流，也查不到客戶、案件、員工助理的任何東西。
- **建議分兩個 Vercel 專案**（同一個 repo，Root Directory 都選 `linebot`）：**客服專案**只放 `GAS_URL`、`BOT_CS_SECRET`、客服 LINE；**員工專案**只放 `GAS_URL`、`BOT_STAFF_SECRET`、員工 LINE。這樣客服那個專案的伺服器上根本沒有員工金鑰。
- **客服只讀知識庫**：客服機器人唯一的資料來源是你在 BOT 設定勾選的知識庫（常見問答、文件、公司資訊、產品型號規格）。產品欄位是白名單，**底價、供應商、備註不在白名單，永遠不會給客服**；也可以限定只開放某些產品類別。BOT 設定 →「客服設定」有「預覽客服看得到的資料」。
- **員工助理有上限**：BOT 設定 →「員工助理」可設定客戶 / 案件 / 產品的存取上限（不開放 / 只能查看 / 可編輯）、隱藏底價與供應商、關閉特定的寫入動作；實際權限 = 成員權限與上限取較小者。
- 沿用舊版單一 `BOT_SECRET` 仍然可以運作（兩邊共用），但客服與員工助理會共用同一把，建議到 BOT 設定重新產生，拆成兩把。

## 費用

- LINE：回覆訊息不限則數（客服機器人都用回覆）；只有處理超過時限時才會改用推播（免費方案每月 200 則）。
- AI：依你選的服務計費；Gemini 有免費額度。

## 員工助理的工具

| 類型 | 工具 |
|---|---|
| 查詢 | `overview`、`list_memos`、`list_calendar`、`list_todos`、`search_knowledge`、`search_customers`、`get_customer`、`followups_due`、`contact_logs`、`search_cases`、`get_case`、`search_products`、`get_product`、`price_history`、`inquiry_draft`、`calc_selection`、`copy_posts`、`copy_style` |
| 提出修改（暫存 15 分鐘，本人確認才寫入） | `add_memo`、`log_followup`、`update_customer`、`add_customer`、`add_contact`、`create_case`、`update_case`、`update_case_info`、`add_price_record`、`add_product`、`update_product`、`create_inquiry_draft`、`save_copy_post`、`add_event`、`add_todo`、`complete_todo`、`delete_customer`、`delete_contact`、`delete_case`、`delete_product`、`delete_price_record`、`delete_copy_post`、`delete_event`、`delete_todo`、`delete_memo`、`remember` |

工具依這個人的權限與管理員設定的上限出現；**刪除工具只有網站帳號本來就有刪除權限的人才有**，仍要本人確認；每個動作（含搜尋知識庫、選型計算）都會回報給管理系統記進「助理紀錄」備忘錄。

## 開發

```bash
npm install
npm run typecheck
npm test          # 78 組：檢索 / 向量、選型計算、客服與員工助理、金鑰分流…
npx tsx test/calc-compare.ts <cases.json> <網站算出的結果.json>   # 選用：與網站 calc.js 逐項比對
```

後端（`apps-script/Code.gs`）的檢查在上一層：`node apps-script/tests/run-all.js`。
