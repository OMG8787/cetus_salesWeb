// 用法：npx tsx test/calc-compare.ts <cases.json> <browser-results.json>
// 把網站原本的選型計算（calc.js）在瀏覽器裡算出的數字，跟 calc.ts 逐項比對。
import { readFileSync } from "node:fs";
import { calcSelection } from "../src/calc.js";

const cases = JSON.parse(readFileSync(process.argv[2], "utf8"));
const browser = JSON.parse(readFileSync(process.argv[3], "utf8").replace(/^﻿/, ""));
let bad = 0;
let checks = 0;
const near = (a: unknown, b: unknown) => (a == null || (typeof a === "number" && isNaN(a))) && (b == null || (typeof b === "number" && isNaN(b))) ? true : typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

cases.forEach((c: any, i: number) => {
  const b = browser[i];
  const r = calcSelection(
    {
      fovA: c.fovL, fovB: c.fovS, accuracy: c.acc, accuracyUnit: c.unit, tolerance: c.tol, pxPerFeature: c.ppf, wd: c.wd || undefined, lensType: c.lens, base: c.base,
      manualCamera: { resW: c.cam.w, resH: c.cam.h, pixelUm: c.cam.pix, fps: c.cam.fps },
      speed: c.fly?.speed, exposure: c.fly?.exp, exposureUnit: c.fly?.expUnit, blurPx: c.fly?.blur, partsPerSec: c.fly?.pps || undefined, motion: c.fly?.motion,
    },
    { cameras: [], fa: [], tele: [] },
  );
  const a = {
    acc: r.req?.acc, pxReq: r.req?.pxReq, reqW: r.req?.reqW, reqH: r.req?.reqH, fovL: r.req?.fovL, fovS: r.req?.fovS,
    sensorW: r.camera?.sensorW, sensorH: r.camera?.sensorH, k: r.camera?.k, resOk: r.camera?.resOk,
    target: r.lens?.target, f: r.lens?.used?.f, mag: r.lens?.used?.mag, lensWd: r.lens?.used?.wd,
    actL: r.actual?.fovL, actS: r.actual?.fovS, px: r.actual?.px, featPx: r.actual?.featPx,
    maxExp: r.fly?.maxExp, maxSpeed: r.fly?.maxSpeed, blurPx: r.fly?.blurPx, fpsReq: r.fly?.fpsReq,
    errors: r.msgs.filter((m) => m.level === "error").length,
  } as Record<string, unknown>;
  for (const key of Object.keys(a)) {
    checks++;
    const bv = (b as Record<string, unknown>)[key];
    // lensWd：遠心鏡頭在網站上是字串空值、FA 才有數字
    const ok = key === "resOk" || key === "errors" ? a[key] === bv : near(a[key], bv);
    if (!ok) {
      bad++;
      console.log(`✖ ${c.name} / ${key}: calc.ts = ${a[key]}，網站 calc.js = ${bv}`);
    }
  }
});
console.log(`比對 ${cases.length} 個案例、${checks} 個數值：${bad ? bad + " 項不同" : "全部一致 ✓"}`);
process.exit(bad ? 1 : 0);
