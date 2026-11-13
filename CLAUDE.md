# CetusSalesWeb（AOI 業務／評估／詢價系統）

## 技術棧與分層
- `frontend/`：純 HTML + JS（無打包），GitHub Pages 發布（`.github/workflows/pages.yml`）。每頁一支 `<頁>.js`；共用只放 `common.js`（callApi、登入檢查）、`config.js`（API_URL／DEMO_MODE）、`demo.js`（示範模式假後端）。
- `apps-script/Code.gs`：單檔後端（Google Apps Script + 試算表當資料庫）。使用者自己貼上整份、跑 `setup`、發新部署版本。
- `linebot/`：Node ≥20 + TypeScript，Vercel 部署（資料夾上傳，**不會自動部署**）。`src/` 是邏輯、`api/` 是入口；`src` 不可引用 `api`／`test`。
- 官網小機器人：根目錄 `robot-loader.js`、`robot-widget.js`。
- 依賴方向：frontend → Apps Script（fetch）；linebot → Apps Script（`src/gas.ts`）。frontend 不引用 linebot／apps-script 的檔案。

## 測試與閘門
- 後端：`node apps-script/tests/run-all.js`（用 `gasmock.js` 模擬，不連網）。
- linebot：`cd linebot && npm run typecheck && npm test`；`test/depgraph-gate.test.ts` 是相依閘門（循環檔數門檻 0、`src` 不引用 `test`／`api`），門檻只准降不准升。
- 畫面：用無頭 Chrome 在示範模式（DEMO_MODE）檢查。

## 新增功能怎麼接
- 新頁面：新增 `frontend/<頁>.html` + `<頁>.js` → 用 `common.js` 的 callApi → `demo.js` 補假資料 → README 檔案結構登記。
- 新後端動作：在 `Code.gs` 加 action → `apps-script/tests/` 補 `.test.js` → `setup()` 必須維持可重跑（idempotent）。
- 機器人新工具：`linebot/src/` 實作 → `test/` 補測試；AI 只能提議寫入／刪除，由使用者確認後才寫。
- 改核心先說明原因與影響：`Code.gs` 的權限／setup、`frontend/common.js`、`linebot/src/gas.ts`（被 21 檔引用）、`cs.ts`、`config.ts`。

## 業務規則放哪
- 客戶分級、權限、知識庫可見對象（`cs`／`staff`）都在 `Code.gs`，前端只負責顯示；README 有對應說明，改規則要一起更新。

## 保護規則
1. 不得因為「看起來多餘」就刪程式或資料（含 `demo.js` 假資料、舊相容路徑）。
2. 改到既有行為要在回報裡獨立列出。
3. 不可逆操作（刪資料、強制 git、覆蓋設定）先問。個資檔 `data.xlsx`、`客戶.xlsx`、`apps-script/ImportData.gs` 永不 commit。
4. 改完提醒使用者哪個要重新部署：`Code.gs`（自己貼）或 `linebot`（Vercel 重新上傳）。
