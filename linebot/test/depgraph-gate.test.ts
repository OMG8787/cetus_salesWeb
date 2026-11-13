// 相依閘門：linebot 內不可出現循環依賴，src 不可引用 test／api。門檻只准降不准升。
// 需要 ~/.claude/claude-dev-system/tools/depgraph.py；別台電腦／CI 沒有這套工具就略過，不算失敗。
import { test } from "node:test";
import assert from "node:assert";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const tool = join(homedir(), ".claude", "claude-dev-system", "tools", "depgraph.py");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_CYCLE_FILES = "0";

test("相依閘門：無循環、src 不引用 test／api", (t) => {
  if (!existsSync(tool)) {
    console.log("閘門工具不在，略過");
    t.skip("閘門工具不在，略過");
    return;
  }
  const [cmd, pre] = process.platform === "win32" ? ["py", ["-3"]] : ["python3", []];
  const r = spawnSync(cmd, [...pre, tool, root, "--max-cycle-files", MAX_CYCLE_FILES, "--forbid", "src:test,api"], {
    encoding: "utf8",
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });
  if (r.error) {
    console.log("找不到 Python，閘門略過");
    t.skip("找不到 Python，閘門略過");
    return;
  }
  const out = (r.stdout || "") + (r.stderr || "");
  assert.strictEqual(r.status, 0, out);
  // depgraph.py 的 --forbid 有違規時 exit code 仍是 0（工具本身的缺口），所以另外讀「分層違規 …：N」。
  const viol = [...out.matchAll(/分層違規 .*?：(\d+)/g)].map((m) => Number(m[1]));
  assert.ok(viol.length > 0, "沒讀到分層違規統計：\n" + out);
  assert.deepStrictEqual(viol.filter((n) => n > 0), [], out);
});
