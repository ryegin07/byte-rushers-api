import axios from "axios";
import crypto from "crypto";
import { TokenBucket } from "../utils/rateLimiter";

export const INTEGRATION_VERSION = "openai_rl_v6b";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY as string || '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';
const RESPONSES_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const RESPONSES_URL = "https://api.openai.com/v1/responses";

const USE_CHAT_FALLBACK = process.env.OPENAI_USE_CHAT_FALLBACK === "1";
const CHAT_URL = "https://api.openai.com/v1/chat/completions";
const CHAT_MODEL = process.env.OPENAI_FALLBACK_CHAT_MODEL || "gpt-4o-mini";

const DEBUG = process.env.OPENAI_DEBUG === "1";

type OpenAICallMeta = {
  ts: string;
  model: string;
  path: string;
  status?: number;
  requestId?: string;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  error?: string;
  mode?: "responses" | "chat";
};

const RECENT_LIMIT = 100;
const recentCalls: OpenAICallMeta[] = [];
function pushRecent(meta: OpenAICallMeta) {
  recentCalls.push(meta);
  if (recentCalls.length > RECENT_LIMIT) recentCalls.shift();
}
export function getRecentOpenAICalls(n = 10): OpenAICallMeta[] {
  return recentCalls.slice(-n).reverse();
}

/* Cache & coalescing */
type CacheEntry = { ts: number; ttlMs: number; value: any };
const CACHE = new Map<string, CacheEntry>();
const INFLIGHT = new Map<string, Promise<any>>();
const keyHash = (x: any) => crypto.createHash("sha256").update(JSON.stringify(x)).digest("hex");
const cacheGet = <T>(k: string): T | undefined => {
  const v = CACHE.get(k);
  if (!v) return;
  if (Date.now() - v.ts > v.ttlMs) { CACHE.delete(k); return; }
  return v.value as T;
};
const cacheSet = (k: string, value: any, ttlMs: number) => CACHE.set(k, { ts: Date.now(), ttlMs, value });

/* Server-side rate limiter */
const bucket = new TokenBucket(
  Number(process.env.OPENAI_RATE_CAPACITY || 3),
  Number(process.env.OPENAI_RATE_REFILL || 3)
);

/* Helpers */
function extractStructured<T = any>(data: any): T {
  const items = data?.output?.[0]?.content || [];
  for (const it of items) {
    if (!it) continue;
    if (it.type === "output_json" && it.json) return it.json as T;
    if (it.type === "output_text" && typeof it.text === "string") {
      try { return JSON.parse(it.text) as T; } catch {}
    }
    if (it.json) return it.json as T;
    if (typeof it.text === "string") {
      try { return JSON.parse(it.text) as T; } catch {}
    }
  }
  const c = data?.output?.[0]?.content?.[0];
  const obj = c?.json ?? (c?.text ? JSON.parse(c.text) : null);
  if (obj) return obj as T;
  throw new Error("OpenAI structured output missing or invalid format");
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
function parseRetryAfter(h?: string | number): number | null {
  if (!h) return null;
  if (typeof h === "number") return Math.max(0, h * 1000);
  const sec = parseInt(h, 10);
  if (!isNaN(sec)) return Math.max(0, sec * 1000);
  const dt = new Date(h).getTime();
  if (!isNaN(dt)) return Math.max(0, dt - Date.now());
  return null;
}
async function withRetry<T>(fn: () => Promise<{obj: T; meta: OpenAICallMeta}>): Promise<{obj: T; meta: OpenAICallMeta}> {
  const max = Number(process.env.OPENAI_MAX_ATTEMPTS || 4);
  const base = Number(process.env.OPENAI_BASE_DELAY_MS || 250);
  let last: any;
  for (let i = 1; i <= max; i++) {
    try {
      await bucket.take();
      return await fn();
    } catch (e: any) {
      last = e;
      const status = e?.response?.status;
      const retriable = status === 429 || (status >= 500 && status < 600) || !status;
      if (!retriable || i === max) break;
      const retryAfter = parseRetryAfter(e?.response?.headers?.["retry-after"]);
      const jitter = Math.random() * base;
      const backoff = Math.min(4000, base * Math.pow(2, i - 1)) + jitter;
      const wait = retryAfter ?? backoff;
      if (DEBUG) console.warn(`[OpenAI RETRY] attempt ${i}/${max} wait=${Math.round(wait)}ms status=${status}`);
      await sleep(wait);
    }
  }
  throw last;
}

/* Raw calls */
async function callResponses<T>(system: string, user: any, schema: Record<string, unknown>, timeoutMs: number) {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is missing in environment");
  const userStr = typeof user === "string" ? user : JSON.stringify(user);
  const input = `SYSTEM:\n${system}\n\nUSER:\n${userStr}`;

  const payload = {
    model: RESPONSES_MODEL,
    input,
    text: { format: { type: "json_schema", name: "structured_output", strict: true, schema } }
  };

  const started = Date.now();
  const meta: OpenAICallMeta = { ts: new Date().toISOString(), model: RESPONSES_MODEL, path: "/v1/responses", mode: "responses" };
  const { data, headers, status } = await axios.post(RESPONSES_URL, payload, {
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    timeout: timeoutMs
  });
  meta.status = status;
  meta.requestId = headers?.["x-request-id"];
  meta.durationMs = Date.now() - started;
  meta.inputTokens = data?.usage?.input_tokens ?? data?.usage?.prompt_tokens;
  meta.outputTokens = data?.usage?.output_tokens ?? data?.usage?.completion_tokens;
  const obj = extractStructured<T>(data);
  recentCalls.push(meta); if (recentCalls.length > 100) recentCalls.shift();
  if (DEBUG) console.log(`[OpenAI OK:responses] ${meta.model} ${meta.status} id=${meta.requestId} inTok=${meta.inputTokens} outTok=${meta.outputTokens} ${meta.durationMs}ms`);
  return { obj, meta };
}

async function callChat<T>(system: string, user: any, schema: Record<string, unknown>, timeoutMs: number) {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is missing in environment");
  const userStr = typeof user === "string" ? user : JSON.stringify(user);
  const instructions = `${system}\n\nReturn ONLY JSON that validates this JSON Schema:\n${JSON.stringify(schema)}`;
  const payload: any = {
    model: CHAT_MODEL,
    messages: [{ role: "system", content: instructions }, { role: "user", content: userStr }],
    temperature: 0,
    response_format: { type: "json_object" }
  };
  const started = Date.now();
  const meta: OpenAICallMeta = { ts: new Date().toISOString(), model: CHAT_MODEL, path: "/v1/chat/completions", mode: "chat" };
  const { data, headers, status } = await axios.post(CHAT_URL, payload, {
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    timeout: timeoutMs
  });
  meta.status = status;
  meta.requestId = headers?.["x-request-id"];
  meta.durationMs = Date.now() - started;
  meta.inputTokens = data?.usage?.prompt_tokens;
  meta.outputTokens = data?.usage?.completion_tokens;
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error("Chat fallback returned empty content");
  let obj: any; try { obj = JSON.parse(text); } catch { throw new Error("Chat fallback returned non-JSON content"); }
  recentCalls.push(meta); if (recentCalls.length > 100) recentCalls.shift();
  if (DEBUG) console.log(`[OpenAI OK:chat] ${meta.model} ${meta.status} id=${meta.requestId} inTok=${meta.inputTokens} outTok=${meta.outputTokens} ${meta.durationMs}ms`);
  return { obj: obj as any, meta };
}

export async function openAIJson<T>(system: string, user: any, schema: Record<string, unknown>, options?: { timeoutMs?: number; cacheTtlMs?: number }): Promise<T> {
  const timeoutMs = options?.timeoutMs ?? 30_000;
  const cacheTtlMs = options?.cacheTtlMs ?? Number(process.env.OPENAI_CACHE_TTL_MS || 300_000);
  const key = keyHash({ RESPONSES_MODEL, system, user, schema });

  const c = cacheGet<T>(key);
  if (c) return c;

  const inflight = INFLIGHT.get(key);
  if (inflight) return inflight;

  const promise = (async () => {
    try {
      const { obj } = await withRetry<T>(() => callResponses<T>(system, user, schema, timeoutMs));
      cacheSet(key, obj, cacheTtlMs);
      return obj;
    } catch (e: any) {
      const status = e?.response?.status;
      const rid = e?.response?.headers?.["x-request-id"];
      const body = e?.response?.data ? JSON.stringify(e.response.data) : e?.message || String(e);
      if (DEBUG) console.error(`[OpenAI ERR:responses] status=${status} id=${rid} :: ${body}`);
      if (USE_CHAT_FALLBACK && (status === 400 || status === 404 || status === 422 || status === 429 || (status >= 500 && status < 600))) {
        const { obj } = await withRetry<T>(() => callChat<T>(system, user, schema, timeoutMs));
        cacheSet(key, obj, cacheTtlMs);
        return obj;
      }
      throw e;
    } finally {
      INFLIGHT.delete(key);
    }
  })();

  INFLIGHT.set(key, promise);
  return promise;
}
