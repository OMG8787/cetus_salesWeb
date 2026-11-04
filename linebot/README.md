# 機器人伺服器（linebot）

AOI 業務系統的機器人伺服器，部署在 Vercel。設定、知識庫、對話紀錄都存在網站的 Google 試算表，**在網站「BOT 設定」頁管理**，這裡只負責：驗證 LINE 簽章、檢索知識庫、呼叫 AI、回覆。

| 入口 | 用途 |
|---|---|
| `/api/cs` | **客服機器人**的 LINE Webhook（對外官方帳號）：客人問產品、規格、公司資訊，機器人用知識庫回答；報價、訂購、客訴、找人 → 轉真人 |
| `/widget.js` + `/api/widget/*` | **網站客服視窗**：貼一行 `<script>` 到任何網站，右下角出現客服視窗，跟 LINE 客服同一套知識庫與規則 |
| `/api/test` | 網站「BOT 設定 → 測試聊天」用（用管理系統簽的權杖，不通知同仁、不留對話紀錄） |
| `/api/line` | **員工助理**的 LINE Webhook（員工專用官方帳號）：員工查客戶 / 案件 / 行程、記錄追蹤；修改要本人確認才寫入 |
| `/api/web` | 網站右下角「智能助理」：只給管理系統（Apps Script）用 Bot 金鑰呼叫 |
| `/api/push` | 每日早報：管理系統每小時檢查，到時間呼叫（header `x-bot-secret`） |

```
LINE 客人 ──► LINE 官方帳號 ──► /api/cs（驗簽章）─┐
網站訪客 ──► widget.js ──► /api/widget/chat ────┤──► 檢索知識庫 + AI ──► 回覆
後台測試聊天 ──► /api/test ──────────────────────┘        │
                                                        ▼
                                       管理系統 Code.gs + Bot.gs（Google 試算表）
                                       設定、知識庫、AI 金鑰、對話紀錄、轉真人通知
```

## 客服機器人怎麼回答

- 每則客人訊息先從**知識庫**（常見問答、文件、產品型號與規格、公司簡介）找出最相關的幾段（中文兩字一組的 BM25 排序），連同「公司規則」交給 AI，**只根據這些內容回答**；資料裡沒有的就請客人輸入「真人」。
- **產品底價、供應商資料永遠不會進知識庫**；機器人不報價，價格、交期、下訂都轉給真人。
- 客人說「真人」「小編」「業務」…，或問到你勾選「交給真人回答」的問題（價格 / 報價、訂購、樣品測試、運費 / 交期、客訴…）→ 回覆轉真人的文字（可附上請客人先留下的資料）、在網站首頁備忘錄通知有「BOT 設定」權限的同事（附上之前的對話），並暫停機器人 N 分鐘讓同事接手。處理完把備忘錄刪除，機器人就恢復回覆這位客人；客人說「重新開始」也能叫回。
- 可設定「只在專人服務時間以外回覆」、語氣、稱呼、emoji、每則最多幾行、歡迎詞與常用按鈕；問題模稜兩可時 AI 會用 `offer_choices` 反問並附上選項按鈕。
- AI 可設多個模型，**依順序備援**（第一個失敗就換下一個）。支援 Gemini、Claude、OpenAI 相容服務。

## 部署

1. **管理系統**：把最新的 `apps-script/Code.gs` 與 `Bot.gs` 都貼到 Apps Script（兩個檔案），執行一次 `setup`，部署 → 管理部署作業 → 編輯 → 新版本。
2. **網站 → BOT 設定 → 連線資訊**：按「🔑 產生 Bot 金鑰」，複製「系統網址」與 Bot 金鑰。
3. **Vercel**（https://vercel.com/new）：匯入這個 GitHub 專案，**Root Directory 選 `linebot`**，Environment Variables 填：

   | 名稱 | 內容 |
   |---|---|
   | `GAS_URL` | BOT 設定頁的「系統網址」（結尾 /exec） |
   | `BOT_SECRET` | BOT 設定頁產生的 Bot 金鑰 |
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
> 重新產生 Bot 金鑰後，要到 Vercel 更新 `BOT_SECRET` 並 Redeploy，機器人才會恢復。

## 費用

- LINE：回覆訊息不限則數（客服機器人都用回覆）；只有處理超過時限時才會改用推播（免費方案每月 200 則）。
- AI：依你選的服務計費；Gemini 有免費額度。

## 開發

```bash
npm install
npm run typecheck
npm test
```
