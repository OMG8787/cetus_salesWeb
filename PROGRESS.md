# PROGRESS

## 2026-11-13 建立
- 依全域規則（cds-project-init）立規矩：`CLAUDE.md`、盤點 `docs/PROJECT-INVENTORY.md` + `.claude/project-scan.json`、相依閘門 `linebot/test/depgraph-gate.test.ts`（循環 0、分層 1 條：`src` 不引用 `test`／`api`）。
- 盤點問題 9 項，全部是單檔 > 800 行（最大：`frontend/evalreport.js` 1542 行）；循環 0 組。
- 已知工具缺口：`depgraph.py --forbid` 有違規時 exit code 仍是 0，閘門測試改成讀輸出的違規數字判斷（之後應在 claude-dev-system repo 修正）。
- 下一步：用 `cds-verify-app` 生成本專案的驗證 skill（前端示範模式 + linebot）；改到大檔時順手小範圍拆。
