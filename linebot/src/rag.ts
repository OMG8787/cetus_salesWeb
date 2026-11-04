import type { KnowledgeChunk } from "./gas.js";

// 知識庫檢索（RAG 的「找資料」那一步）：BM25 排序
//   中文沒有空白分詞，用「相鄰兩個字」當詞（芒果冰淇淋 → 芒果、果冰、冰淇、淇淋），英文與數字用整個字
//   標題的詞算兩次（標題命中的比較相關）

const K1 = 1.2;
const B = 0.75;

const CJK = /[㐀-鿿豈-﫿]/;

export function tokenize(text: string): string[] {
  const out: string[] = [];
  const s = text.toLowerCase();
  // 英文 / 數字
  for (const m of s.matchAll(/[a-z0-9]+(?:\.[0-9]+)?/g)) out.push(m[0]);
  // 中文：連續的中文字切成兩字一組；單獨一個字就用那個字
  for (const m of s.matchAll(/[㐀-鿿豈-﫿]+/g)) {
    const run = m[0];
    if (run.length === 1) out.push(run);
    for (let i = 0; i + 1 < run.length; i++) out.push(run.slice(i, i + 2));
  }
  return out;
}

export interface Hit {
  chunk: KnowledgeChunk;
  score: number;
}

export class KnowledgeIndex {
  private docs: { chunk: KnowledgeChunk; tf: Map<string, number>; len: number }[];
  private df = new Map<string, number>();
  private avgLen: number;

  constructor(public chunks: KnowledgeChunk[]) {
    this.docs = chunks.map((chunk) => {
      const tokens = [...tokenize(chunk.title), ...tokenize(chunk.title), ...tokenize(chunk.text)];
      const tf = new Map<string, number>();
      tokens.forEach((t) => tf.set(t, (tf.get(t) ?? 0) + 1));
      tf.forEach((_, t) => this.df.set(t, (this.df.get(t) ?? 0) + 1));
      return { chunk, tf, len: tokens.length };
    });
    this.avgLen = this.docs.reduce((t, d) => t + d.len, 0) / Math.max(1, this.docs.length);
  }

  search(query: string, k = 6): Hit[] {
    const terms = [...new Set(tokenize(query))];
    if (!terms.length) return [];
    const n = this.docs.length;
    return this.docs
      .map((d) => {
        let score = 0;
        for (const t of terms) {
          const f = d.tf.get(t);
          if (!f) continue;
          const df = this.df.get(t) ?? 0;
          const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
          score += idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * d.len) / this.avgLen)));
        }
        return { chunk: d.chunk, score };
      })
      .filter((h) => h.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }
}

/** 給 AI 看的參考資料 */
export function formatHits(hits: Hit[]): string {
  return hits.map((h, i) => `【${i + 1}｜${h.chunk.source}｜${h.chunk.title}】\n${h.chunk.text}`).join("\n\n");
}

export const hasCjk = (s: string) => CJK.test(s);
