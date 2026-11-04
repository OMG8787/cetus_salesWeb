// 一次跑完 Apps Script（Code.gs）的全部檢查：node apps-script/tests/run-all.js
// 用 gasmock.js 在 Node 裡模擬 Apps Script / 試算表，不需要連網、不會動到真正的資料。
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const files = fs.readdirSync(__dirname).filter((f) => f.endsWith('.test.js')).sort();
let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8' });
  const last = (r.stdout || '').trim().split('\n').pop();
  if (r.status === 0) console.log('✔ ' + f.padEnd(28) + last);
  else {
    failed++;
    console.log('✖ ' + f);
    console.log((r.stderr || r.stdout || '').split('\n').slice(0, 8).join('\n'));
  }
}
console.log(failed ? '\n' + failed + ' 個檔案有失敗' : '\n全部通過（' + files.length + ' 個檔案）');
process.exit(failed ? 1 : 0);
