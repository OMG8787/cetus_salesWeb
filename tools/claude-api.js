#!/usr/bin/env node
// 本機 Claude Code 呼叫「Claude 專用金鑰」API 的小工具（不經過 BOT 設定的 AI 金鑰）。
// 金鑰放環境變數 CLAUDE_KEY 或檔案 .claude/claude-key.txt（已列入 .gitignore，永不 commit）。
// 用法：
//   node tools/claude-api.js ping
//   node tools/claude-api.js list '{"limit":50,"noMail":true}'
//   node tools/claude-api.js index > index.json
//   node tools/claude-api.js import @rows.json      （檔案內容：{"source":"...","rows":[...]}）
//   node tools/claude-api.js fill @items.json       （檔案內容：{"items":[...]}）
// 這把金鑰只能讀未處理名單、匯入（不重複不覆蓋）、只補空白寫回、寫還沒有的草稿；不能刪除、不能寄信。
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const cfg = fs.readFileSync(path.join(root, 'frontend', 'config.js'), 'utf8');
const m = cfg.match(/API_URL\s*=\s*["']([^"']+)["']/);
if (!m) throw new Error('frontend/config.js 找不到 API_URL');
const keyFile = path.join(root, '.claude', 'claude-key.txt');
const secret = (process.env.CLAUDE_KEY || (fs.existsSync(keyFile) ? fs.readFileSync(keyFile, 'utf8') : '')).trim();
if (!secret) {
  console.error('沒有金鑰：設定環境變數 CLAUDE_KEY，或把金鑰存成 .claude/claude-key.txt');
  process.exit(2);
}

const [, , op, arg] = process.argv;
if (!op) {
  console.error('用法：node tools/claude-api.js <ping|list|index|mailCfg|importCheck|import|fill> [JSON 或 @檔案]');
  process.exit(2);
}
let extra = {};
if (arg) extra = JSON.parse(arg.startsWith('@') ? fs.readFileSync(arg.slice(1), 'utf8') : arg);

(async () => {
  const res = await fetch(m[1], {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // Apps Script 不接受 CORS 預檢，用 text/plain
    body: JSON.stringify(Object.assign({}, extra, { action: 'claudeApi', secret, op })),
    redirect: 'follow',
  });
  const text = await res.text();
  let out;
  try {
    out = JSON.parse(text);
  } catch (e) {
    console.error('回應不是 JSON（可能還沒發布含 claudeApi 的新版本）：' + text.slice(0, 300));
    process.exit(1);
  }
  process.stdout.write(JSON.stringify(out, null, 1) + '\n');
  if (!out.success) process.exit(1);
})();
