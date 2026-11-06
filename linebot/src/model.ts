import type { Catalog } from "./calc.js";
import { effPxOf } from "./calc-tool.js";
import type { KnowledgeChunk } from "./gas.js";
import type { Hit, KnowledgeIndex } from "./rag.js";

// 型號直接比對：客人訊息裡出現「看起來像型號」的字串（例如 puA2500-14um、CVG-34M-387GT、MV-CA050-10GM）時，
// 不靠 AI 去搜尋，直接拿這個型號去產品資料（知識庫的產品段落）與選型型錄比對，找到的規格直接當參考資料。

/** 去掉符號、轉小寫：puA2500-14um → pua250014um */
export const normModel = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * 從文字裡抓出型號：英文字母開頭、混有數字、至少 5 個字元且有 3 個以上數字（過濾 USB3、GigE、5MP 這類不是型號的字）。
 * 型號中間可以有 - _ . / 。最多回傳 3 個（依出現順序）。
 */
export function extractModels(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/[A-Za-z][A-Za-z0-9]*(?:[-_./][A-Za-z0-9]+)*/g)) {
    const raw = m[0].replace(/[-_./]+$/, "");
    const key = normModel(raw);
    const digits = (key.match(/\d/g) ?? []).length;
    if (key.length < 5 || digits < 3 || !/[a-z]/.test(key)) continue;
    if (!out.some((x) => normModel(x) === key)) out.push(raw);
    if (out.length >= 3) break;
  }
  return out;
}

/** 名稱比對：完全相同優先，其次「名稱含這個型號」或「型號含這個名稱（名稱至少 5 字）」 */
function rank(name: string, key: string): number {
  const n = normModel(name);
  if (!n) return 0;
  if (n === key) return 3;
  if (n.includes(key)) return 2;
  if (n.length >= 5 && key.includes(n)) return 1;
  return 0;
}

/** 知識庫裡的產品段落（來源「產品」）：標題比對型號 */
export function modelHitsFromIndex(index: KnowledgeIndex, models: string[], limit = 5): Hit[] {
  const keys = models.map(normModel);
  const scored: { chunk: KnowledgeChunk; r: number }[] = [];
  for (const chunk of index.chunks) {
    if (chunk.source !== "產品") continue;
    const r = Math.max(0, ...keys.map((k) => rank(chunk.title, k)));
    if (r > 0) scored.push({ chunk, r });
  }
  return scored.sort((a, b) => b.r - a.r).slice(0, limit).map((x) => ({ chunk: x.chunk, score: x.r, by: "keyword" as const }));
}

const line = (label: string, v: unknown, unit = ""): string => (v === undefined || v === null || v === "" || v === 0 ? "" : `${label}：${v}${unit}\n`);

/** 選型型錄裡的相機 / 鏡頭（只有型號與規格，沒有價格與供應商）→ 當成參考資料 */
export function modelHitsFromCatalog(catalog: Catalog, models: string[], limit = 5): Hit[] {
  const keys = models.map(normModel);
  const best = (name: string) => Math.max(0, ...keys.map((k) => rank(name, k)));
  const out: { chunk: KnowledgeChunk; r: number }[] = [];
  let n = 0;
  const add = (name: string, r: number, text: string) => out.push({ r, chunk: { id: `m${++n}`, source: "型號比對", title: name, text } });
  for (const c of catalog.cameras) {
    const r = best(c.name);
    if (r) add(c.name, r, `產品型號：${c.name}\n類別：相機\n` + line("品牌", c.brand) + line("介面", c.iface) + line("解析度", `${c.resW} × ${c.resH}`) + line("有效像素", effPxOf(c), " 萬") + line("像元尺寸 µm", c.pixelW) + line("靶面", c.size) + line("影格率 fps", c.fps));
  }
  for (const l of catalog.fa) {
    const r = best(l.name);
    if (r) add(l.name, r, `產品型號：${l.name}\n類別：FA 定焦鏡頭\n` + line("品牌", l.brand) + line("焦距 mm", l.f) + line("靶面", l.sensorSize) + line("解析度（百萬畫素）", l.resolution) + line("最近對焦距離 mm", l.focusWd));
  }
  for (const l of catalog.tele) {
    const r = best(l.name);
    if (r) add(l.name, r, `產品型號：${l.name}\n類別：遠心鏡頭\n` + line("品牌", l.brand) + line("放大倍率", l.mag, "x") + line("工作距離 WD", l.wd) + line("景深 DOF", l.dof) + line("靶面", l.sensorSize) + line("解析度", l.resolution));
  }
  return out.sort((a, b) => b.r - a.r).slice(0, limit).map((x) => ({ chunk: { ...x.chunk, text: x.chunk.text.trim() }, score: x.r, by: "keyword" as const }));
}

/** 有沒有「完全相同」的型號命中（有的話就不用再去讀選型型錄） */
export const hasExact = (hits: Hit[]): boolean => hits.some((h) => h.score >= 3);
