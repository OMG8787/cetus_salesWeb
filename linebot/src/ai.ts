import type { AiConfig, EmbedConfig } from "./gas.js";

// 呼叫 AI（Gemini / Claude / OpenAI 相容），支援工具呼叫（function calling）
// 金鑰與模型由網站「BOT 管理」設定，每則訊息從管理系統取得

export interface Turn {
  isUser: boolean;
  text: string;
}

/** 提供給 AI 呼叫的工具 */
export interface Tool {
  name: string;
  description: string;
  /** JSON Schema（只用 type / properties / required / description / enum / items，三家都看得懂） */
  parameters: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<string>;
}

export interface AiRequest {
  ai: AiConfig;
  /** 主要 AI 失敗時，依序改用這些（BOT 設定 → AI 模型的備援順序） */
  fallback?: AiConfig[];
  system: string;
  turns: Turn[];
  tools?: Tool[];
}

export class AiError extends Error {}

export const MAX_TOOL_ROUNDS = 6;
const TIMEOUT_MS = 40_000;
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);

/** 合併連續同角色訊息，並確保第一則是使用者（各家 API 的共同要求） */
export function normalizeTurns(turns: Turn[]): Turn[] {
  const merged: Turn[] = [];
  for (const turn of turns) {
    if (!turn.text.trim()) continue;
    if (merged.length === 0 && !turn.isUser) continue;
    const last = merged.at(-1);
    if (last && last.isUser === turn.isUser) last.text += "\n" + turn.text;
    else merged.push({ ...turn });
  }
  return merged;
}

/** 暫時性錯誤（流量過大、服務忙碌）等一下再試一次 */
async function fetchAi(url: string, init: RequestInit): Promise<{ status: number; text: string }> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (RETRY_STATUS.has(response.status) && attempt === 0) {
      await response.body?.cancel();
      await new Promise((resolve) => setTimeout(resolve, 1500));
      continue;
    }
    return { status: response.status, text: await response.text() };
  }
}

function hideKey(text: string, key: string): string {
  return key ? text.split(key).join("••••") : text;
}

async function runTool(tools: Tool[], name: string, args: Record<string, unknown>): Promise<string> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) return `找不到工具 ${name}`;
  console.log(`AI 呼叫工具 ${name}(${JSON.stringify(args)})`);
  try {
    return await tool.handler(args);
  } catch (error) {
    console.warn(`工具 ${name} 失敗`, error);
    return `工具執行失敗：${(error as Error).message}`;
  }
}

// ------------------------------------------------------------
// Google Gemini（generateContent REST API）
// ------------------------------------------------------------
interface GeminiPart {
  text?: string;
  thought?: boolean;
  functionCall?: { name: string; args?: Record<string, unknown> };
  [key: string]: unknown;
}

async function gemini({ ai, system, turns, tools = [] }: AiRequest): Promise<string> {
  const contents: { role: string; parts: GeminiPart[] }[] = normalizeTurns(turns).map((t) => ({
    role: t.isUser ? "user" : "model",
    parts: [{ text: t.text }],
  }));
  const body: Record<string, unknown> = { systemInstruction: { parts: [{ text: system }] }, contents };
  if (tools.length) body.tools = [{ functionDeclarations: tools.map(({ name, description, parameters }) => ({ name, description, parameters })) }];
  const url = `${ai.endpoint.replace(/\/+$/, "")}/models/${encodeURIComponent(ai.model)}:generateContent`;

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const { status, text } = await fetchAi(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": ai.apiKey },
      body: JSON.stringify(body),
    });
    if (status < 200 || status >= 300) throw new AiError(`Gemini 錯誤 ${status}：${hideKey(text, ai.apiKey).slice(0, 300)}`);

    const content = (JSON.parse(text) as { candidates?: { content?: { role: string; parts: GeminiPart[] } }[] }).candidates?.[0]?.content;
    if (!content?.parts) throw new AiError("Gemini 沒有回傳內容（可能被安全機制擋下）");

    const calls = content.parts.filter((p) => p.functionCall).map((p) => p.functionCall!);
    if (!calls.length) return content.parts.filter((p) => !p.thought && typeof p.text === "string").map((p) => p.text).join("").trim();

    // 原樣保留模型回覆（含 thoughtSignature），再附上工具結果
    contents.push(content);
    const results: GeminiPart[] = [];
    for (const call of calls) results.push({ functionResponse: { name: call.name, response: { result: await runTool(tools, call.name, call.args ?? {}) } } });
    contents.push({ role: "user", parts: results });
  }
  throw new AiError("工具呼叫次數過多");
}

// ------------------------------------------------------------
// Anthropic Claude（Messages API）
// ------------------------------------------------------------
type ClaudeBlock = { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown>; [key: string]: unknown };

async function claude({ ai, system, turns, tools = [] }: AiRequest): Promise<string> {
  const messages: { role: string; content: string | ClaudeBlock[] }[] = normalizeTurns(turns).map((t) => ({
    role: t.isUser ? "user" : "assistant",
    content: t.text,
  }));
  const toolDefs = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  const url = `${ai.endpoint.replace(/\/+$/, "")}/messages`;

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const { status, text } = await fetchAi(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ai.apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: ai.model, max_tokens: 4096, system, messages, ...(toolDefs.length ? { tools: toolDefs } : {}) }),
    });
    if (status < 200 || status >= 300) throw new AiError(`Claude 錯誤 ${status}：${hideKey(text, ai.apiKey).slice(0, 300)}`);

    const res = JSON.parse(text) as { content?: ClaudeBlock[]; stop_reason?: string };
    if (res.stop_reason === "refusal") throw new AiError("Claude 拒絕回答這個問題");
    const content = res.content ?? [];
    if (res.stop_reason !== "tool_use") return content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();

    messages.push({ role: "assistant", content });
    const results: ClaudeBlock[] = [];
    for (const block of content) {
      if (block.type !== "tool_use") continue;
      results.push({ type: "tool_result", tool_use_id: block.id, content: await runTool(tools, block.name ?? "", block.input ?? {}) });
    }
    messages.push({ role: "user", content: results });
  }
  throw new AiError("工具呼叫次數過多");
}

// ------------------------------------------------------------
// OpenAI Chat Completions（也適用 OpenRouter、DeepSeek、Groq 等相容服務）
// ------------------------------------------------------------
interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

async function openai({ ai, system, turns, tools = [] }: AiRequest): Promise<string> {
  const messages: Record<string, unknown>[] = [
    { role: "system", content: system },
    ...normalizeTurns(turns).map((t) => ({ role: t.isUser ? "user" : "assistant", content: t.text })),
  ];
  const toolDefs = tools.map(({ name, description, parameters }) => ({ type: "function", function: { name, description, parameters } }));
  const url = `${ai.endpoint.replace(/\/+$/, "")}/chat/completions`;

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const { status, text } = await fetchAi(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ai.apiKey}` },
      body: JSON.stringify({ model: ai.model, messages, ...(toolDefs.length ? { tools: toolDefs } : {}) }),
    });
    if (status < 200 || status >= 300) throw new AiError(`AI 錯誤 ${status}：${hideKey(text, ai.apiKey).slice(0, 300)}`);

    const message = (JSON.parse(text) as { choices?: { message?: { content?: unknown; tool_calls?: ToolCall[] } }[] }).choices?.[0]?.message;
    if (!message) throw new AiError("AI 沒有回傳內容");
    if (!message.tool_calls?.length) return typeof message.content === "string" ? message.content.trim() : "";

    messages.push({ role: "assistant", content: message.content ?? null, tool_calls: message.tool_calls });
    for (const call of message.tool_calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        // 參數不是合法 JSON 就當作沒有參數
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: await runTool(tools, call.function.name, args) });
    }
  }
  throw new AiError("工具呼叫次數過多");
}

const PROVIDERS = { gemini, claude, openai };

async function generateOne(request: AiRequest, ai: AiConfig): Promise<string> {
  const run = PROVIDERS[ai.provider];
  if (!run) throw new AiError(`不支援的 AI 服務：${ai.provider}`);
  if (!ai.apiKey) throw new AiError("AI 沒有設定 API Key");
  return run({ ...request, ai });
}

/** 依順序試：主要 AI 失敗（金鑰錯誤、額度用完、服務忙碌…）就換下一個；全部失敗丟出最後的錯誤 */
export async function generate(request: AiRequest): Promise<string> {
  const list = [request.ai, ...(request.fallback ?? [])].filter(Boolean);
  let lastError: unknown = new AiError("沒有可用的 AI");
  for (const ai of list) {
    try {
      return await generateOne(request, ai);
    } catch (error) {
      lastError = error;
      console.warn(`AI ${ai.provider}/${ai.model} 失敗${list.length > 1 ? "，改用備援" : ""}：${(error as Error).message}`);
    }
  }
  throw lastError;
}

// ------------------------------------------------------------
// 向量（embedding）：問題與知識庫段落轉成向量，做語意檢索
// ------------------------------------------------------------
const normalize = (v: number[]): number[] => {
  const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
  return v.map((x) => x / n);
};

/** 一批文字轉向量（已正規化，內積即餘弦相似度）。kind：doc = 文件段落、query = 使用者的問題。失敗丟出 AiError（金鑰會遮掉）。 */
export async function embed(cfg: EmbedConfig, texts: string[], kind: "doc" | "query" = "query"): Promise<number[][]> {
  const base = cfg.endpoint.replace(/\/+$/, "");
  const input = texts.map((t) => t.slice(0, 6000) || " ");
  let url: string;
  let init: RequestInit;
  if (cfg.provider === "openai") {
    url = `${base}/embeddings`;
    init = { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` }, body: JSON.stringify({ model: cfg.model, input, dimensions: cfg.dim }) };
  } else {
    url = `${base}/models/${cfg.model}:batchEmbedContents`;
    init = {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": cfg.apiKey },
      body: JSON.stringify({
        requests: input.map((t) => ({ model: `models/${cfg.model}`, content: { parts: [{ text: t }] }, taskType: kind === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT", outputDimensionality: cfg.dim })),
      }),
    };
  }
  const { status, text } = await fetchAi(url, init);
  if (status < 200 || status >= 300) throw new AiError(`embedding 錯誤 ${status}：${hideKey(text, cfg.apiKey).slice(0, 300)}`);
  const body = JSON.parse(text) as { data?: { embedding: number[] }[]; embeddings?: { values: number[] }[] };
  const vectors = cfg.provider === "openai" ? (body.data ?? []).map((d) => d.embedding) : (body.embeddings ?? []).map((d) => d.values);
  if (vectors.length !== input.length) throw new AiError("embedding 回傳數量不對");
  return vectors.map(normalize);
}
