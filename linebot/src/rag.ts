import type { KnowledgeChunk } from "./gas.js";

// 知識庫檢索（RAG 的「找資料」那一步）
//   關鍵字：BM25 排序。中文沒有空白分詞，用「相鄰兩個字」當詞（芒果冰淇淋 → 芒果、果冰、冰淇、淇淋），英文與數字用整個字；標題的詞算兩次
//   中繼資料：只比對「大分類、主題、備註、標題、關鍵字」（BM25），用來先縮小範圍或分流
//   向量：問題與段落都轉成向量（embedding），用餘弦相似度（已正規化，內積即可）；分數低於閥值的不採用
//   搜尋流程（BOT 設定可選）：
//     vector       直接向量（預設）
//     meta_vector  先用中繼資料找出可能的大分類 / 主題，只在那個範圍內做向量檢索
//     meta         只用中繼資料（不需要向量）
//     both         中繼檢索與向量檢索各做一次，兩邊都命中的才採用（沒有交集 = 找不到）

const K1 = 1.2;
const B = 0.75;

const CJK = /[㐀-鿿豈-﫿]/;

export function tokenize(text: string): string[] {
  const out: string[] = [];
  const s = text.toLowerCase();
  // 英文 / 數字
  for (const m of s.matchAll(/[a-z0-9]+(?:\.[0-9]+)?/g)) out.push(m[0]);
  // 中文：連續的中文字切成兩字一組；單獨一個字就用那個字
  for (const m of s.matchAll(/[㐀-鿿豈-﫿]+/g)) {
    const run = m[0];
    if (run.length === 1) out.push(run);
    for (let i = 0; i + 1 < run.length; i++) out.push(run.slice(i, i + 2));
  }
  return out;
}

export interface Hit {
  chunk: KnowledgeChunk;
  /** 關鍵字 / 中繼：BM25 分數；向量：餘弦相似度（0~1） */
  score: number;
  /** 這筆是怎麼找到的 */
  by?: "vector" | "meta" | "keyword";
}

export type SearchMode = "vector" | "meta_vector" | "meta" | "both";

export interface SearchConfig {
  mode: SearchMode;
  /** 向量相似度閥值（0~1），低於這個分數的段落不採用 */
  threshold: number;
  topK: number;
  embedProvider?: string;
}

export const DEFAULT_SEARCH: SearchConfig = { mode: "vector", threshold: 0.6, topK: 6 };

export const SEARCH_MODE_LABEL: Record<SearchMode, string> = {
  vector: "直接向量",
  meta_vector: "先用大分類 / 主題 / 備註縮小範圍，再向量",
  meta: "只用大分類 / 主題 / 備註",
  both: "兩種都做，結果一致才採用",
};

/** BM25 索引（文件已經分好詞） */
class Bm25 {
  private tfs: Map<string, number>[];
  private lens: number[];
  private df = new Map<string, number>();
  private avgLen: number;

  constructor(tokenLists: string[][]) {
    this.tfs = tokenLists.map((tokens) => {
      const tf = new Map<string, number>();
      tokens.forEach((t) => tf.set(t, (tf.get(t) ?? 0) + 1));
      tf.forEach((_, t) => this.df.set(t, (this.df.get(t) ?? 0) + 1));
      return tf;
    });
    this.lens = tokenLists.map((t) => t.length);
    this.avgLen = this.lens.reduce((a, b) => a + b, 0) / Math.max(1, this.lens.length);
  }

  scores(query: string): number[] {
    const terms = [...new Set(tokenize(query))];
    const n = this.tfs.length;
    return this.tfs.map((tf, i) => {
      let score = 0;
      for (const t of terms) {
        const f = tf.get(t);
        if (!f) continue;
        const df = this.df.get(t) ?? 0;
        const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
        score += idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * this.lens[i]) / this.avgLen)));
      }
      return score;
    });
  }
}

const dot = (a: number[], b: number[]) => {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
};

export class KnowledgeIndex {
  private content: Bm25;
  private meta: Bm25;

  constructor(public chunks: KnowledgeChunk[], public vectors: Map<string, number[]> = new Map()) {
    this.content = new Bm25(chunks.map((c) => [...tokenize(c.title), ...tokenize(c.title), ...tokenize(c.text)]));
    // 中繼資料：大分類、主題算兩次（最能代表這段在講什麼），備註、標題、關鍵字各一次
    this.meta = new Bm25(
      chunks.map((c) => [
        ...tokenize(c.category ?? ""), ...tokenize(c.category ?? ""),
        ...tokenize(c.topic ?? ""), ...tokenize(c.topic ?? ""),
        ...tokenize(c.notes ?? ""), ...tokenize(c.title), ...tokenize(c.tags ?? ""),
      ]),
    );
  }

  hasVectors(): boolean {
    return this.vectors.size > 0;
  }

  /** 關鍵字檢索（內容） */
  search(query: string, k = 6): Hit[] {
    const scores = this.content.scores(query);
    return this.chunks
      .map((chunk, i) => ({ chunk, score: scores[i], by: "keyword" as const }))
      .filter((h) => h.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  /** 中繼資料檢索：只比對大分類 / 主題 / 備註 / 標題 / 關鍵字 */
  metaSearch(query: string, k = 6): Hit[] {
    const scores = this.meta.scores(query);
    return this.chunks
      .map((chunk, i) => ({ chunk, score: scores[i], by: "meta" as const }))
      .filter((h) => h.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  /** 向量檢索：只看有向量的段落；candidates 有給就只在那些段落裡找；分數低於 threshold 的丟掉 */
  vectorSearch(queryVector: number[], threshold: number, k = 6, candidates?: Set<string>): Hit[] {
    const out: Hit[] = [];
    for (const chunk of this.chunks) {
      const v = this.vectors.get(chunk.id);
      if (!v || (candidates && !candidates.has(chunk.id))) continue;
      const score = dot(queryVector, v);
      if (score >= threshold) out.push({ chunk, score, by: "vector" });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, k);
  }
}

export interface SearchResult {
  hits: Hit[];
  /** 實際用的流程（向量不能用時會退回關鍵字） */
  mode: SearchMode | "keyword";
  /** 給後台「搜尋測試」看的過程說明 */
  trace: string[];
}

/** 沒有向量的段落（產品、公司資訊）用關鍵字找，補在向量結果後面 */
function withoutVectors(index: KnowledgeIndex, query: string, k: number, exclude: Set<string>): Hit[] {
  return index.search(query, k * 3).filter((h) => !index.vectors.has(h.chunk.id) && !exclude.has(h.chunk.id)).slice(0, k);
}

/**
 * 依搜尋流程找出相關段落。embedQuery 負責把問題轉成向量（失敗或沒有 embedding 服務時退回關鍵字檢索，不會讓客人沒有回覆）。
 */
export async function searchKnowledge(
  index: KnowledgeIndex,
  query: string,
  cfg: SearchConfig,
  embedQuery?: (q: string) => Promise<number[]>,
): Promise<SearchResult> {
  const trace: string[] = [];
  const k = Math.max(1, cfg.topK);
  const keyword = (why: string): SearchResult => {
    trace.push(why);
    return { hits: index.search(query, k), mode: "keyword", trace };
  };

  if (cfg.mode === "meta") {
    const hits = index.metaSearch(query, k);
    trace.push(`中繼資料檢索：命中 ${hits.length} 段`);
    if (hits.length) return { hits, mode: "meta", trace };
    return keyword("中繼資料沒有命中，改用內容關鍵字檢索");
  }

  if (!index.hasVectors()) return keyword("知識庫還沒有向量（到 BOT 設定 → 知識庫按「重新計算向量」），改用關鍵字檢索");
  if (!embedQuery) return keyword("沒有可用的 embedding 模型，改用關鍵字檢索");
  let qv: number[];
  try {
    qv = await embedQuery(query);
  } catch (error) {
    console.warn("問題轉向量失敗", error);
    return keyword("問題轉向量失敗，改用關鍵字檢索");
  }

  if (cfg.mode === "vector") {
    const vh = index.vectorSearch(qv, cfg.threshold, k);
    trace.push(`向量檢索（閥值 ${cfg.threshold}）：命中 ${vh.length} 段`);
    const extra = withoutVectors(index, query, k, new Set(vh.map((h) => h.chunk.id)));
    if (extra.length) trace.push(`另外用關鍵字補上沒有向量的段落（產品 / 公司資訊）${extra.length} 段`);
    return { hits: [...vh, ...extra].slice(0, k), mode: "vector", trace };
  }

  if (cfg.mode === "meta_vector") {
    const mh = index.metaSearch(query, 20);
    const top = mh.slice(0, 5);
    const cats = new Set(top.map((h) => h.chunk.category).filter(Boolean) as string[]);
    const topics = new Set(top.map((h) => h.chunk.topic).filter(Boolean) as string[]);
    let candidates: Set<string> | undefined;
    if (cats.size || topics.size) {
      candidates = new Set(index.chunks.filter((c) => (c.category && cats.has(c.category)) || (c.topic && topics.has(c.topic))).map((c) => c.id));
      trace.push(`中繼資料縮小範圍：大分類 ${[...cats].join("、") || "（無）"}；主題 ${[...topics].join("、") || "（無）"}；共 ${candidates.size} 段`);
    } else {
      trace.push("中繼資料沒有命中任何大分類 / 主題，改在全部段落裡做向量檢索");
    }
    const vh = index.vectorSearch(qv, cfg.threshold, k, candidates);
    trace.push(`向量檢索（閥值 ${cfg.threshold}）：命中 ${vh.length} 段`);
    const extra = withoutVectors(index, query, k, new Set(vh.map((h) => h.chunk.id)));
    if (extra.length) trace.push(`另外用關鍵字補上沒有向量的段落 ${extra.length} 段`);
    return { hits: [...vh, ...extra].slice(0, k), mode: "meta_vector", trace };
  }

  // both：兩種各做一次，兩邊都命中才採用
  const mh = index.metaSearch(query, 30);
  const vh = index.vectorSearch(qv, cfg.threshold, 30);
  const metaIds = new Set(mh.map((h) => h.chunk.id));
  const both = vh.filter((h) => metaIds.has(h.chunk.id)).slice(0, k);
  trace.push(`中繼資料命中 ${mh.length} 段、向量命中 ${vh.length} 段（閥值 ${cfg.threshold}）→ 兩邊一致 ${both.length} 段`);
  const extra = withoutVectors(index, query, k, new Set(both.map((h) => h.chunk.id)));
  if (extra.length) trace.push(`沒有向量的段落無法交叉比對，用關鍵字補上 ${extra.length} 段`);
  return { hits: [...both, ...extra].slice(0, k), mode: "both", trace };
}

/** 給 AI 看的參考資料（有備註的一併附上，備註是給 AI 判斷怎麼用這段的提示） */
export function formatHits(hits: Hit[]): string {
  return hits
    .map((h, i) => {
      const c = h.chunk;
      const tags = [c.category, c.topic].filter(Boolean).join(" / ");
      return `【${i + 1}｜${c.source}｜${c.title}${tags ? `｜${tags}` : ""}】\n${c.text}${c.notes ? `\n（備註：${c.notes}）` : ""}`;
    })
    .join("\n\n");
}

export const hasCjk = (s: string) => CJK.test(s);
