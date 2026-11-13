# 專案盤點（project-scan.py 產生，2026-11-13T09:23:26）

原始碼 66、測試 49、腳本 0、設定 9、文件 5、資源 6、其他 30；語言：.js 74, .ts 41；依賴邊 165。

## 入口與啟動方式
- （沒找到 package.json／pyproject／main 類入口，請人工確認）

## 最大的檔（行數）
- frontend/evalreport.js：1542 行
- frontend/demo.js：1490 行
- frontend/bot.js：1431 行
- frontend/calc.js：1393 行
- frontend/common.js：1366 行
- frontend/prospects.js：1257 行
- frontend/products.js：1124 行
- linebot/src/staff.ts：913 行
- frontend/cases.js：869 行
- frontend/schedule.js：734 行

## 循環依賴
- 無

## 被引用最多的模組（改到要走 cds-blast-radius）
- apps-script/tests/gasmock.js：被 33 個檔引用
- linebot/src/gas.ts：被 21 個檔引用
- linebot/src/cs.ts：被 15 個檔引用
- linebot/src/web.ts：被 11 個檔引用
- linebot/src/line.ts：被 10 個檔引用
- linebot/src/config.ts：被 9 個檔引用
- linebot/src/ai.ts：被 9 個檔引用
- linebot/src/rag.ts：被 7 個檔引用
- linebot/src/calc.ts：被 7 個檔引用
- linebot/src/staff.ts：被 5 個檔引用

## 問題清單（門檻：單檔 > 800 行、循環依賴、≥10 個原始碼檔卻沒有測試）
- big-file：frontend/evalreport.js — 1542 行 > 800
- big-file：frontend/demo.js — 1490 行 > 800
- big-file：frontend/bot.js — 1431 行 > 800
- big-file：frontend/calc.js — 1393 行 > 800
- big-file：frontend/common.js — 1366 行 > 800
- big-file：frontend/prospects.js — 1257 行 > 800
- big-file：frontend/products.js — 1124 行 > 800
- big-file：linebot/src/staff.ts — 913 行 > 800
- big-file：frontend/cases.js — 869 行 > 800

## 無法讀取的檔
- 無

## 設定檔
- .github/workflows/pages.yml
- .gitignore
- apps-script/appsscript.json
- linebot/.env.example
- linebot/.gitignore
- linebot/package-lock.json
- linebot/package.json
- linebot/tsconfig.json
- linebot/vercel.json

每個檔的雜湊在 `.claude/project-scan.json`；`python project-scan.py <root> --check` 列出自上次盤點後改過的檔。
