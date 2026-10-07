import { fetch } from "@tauri-apps/plugin-http";
import type { Message } from "./types";
import type { Settings } from "./settings";

const SYSTEM_PROMPT =
  "You are Berzh AI, a helpful assistant inside a desktop app. Answer clearly and concisely. " +
  "If you are unsure, or the information may be out of date, say so instead of guessing.";

const MAX_TURNS = 20;
const FIRST_TOKEN_TIMEOUT_MS = 20_000;

export class ConfigError extends Error {}
class FatalError extends Error {}

class HttpError extends Error {
  status: number; // 0 = timed out
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Turn = { role: "user" | "assistant"; text: string };

const abortError = () => new DOMException("Aborted", "AbortError");

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true }
    );
  });

function buildTurns(history: Message[]): Turn[] {
  const turns: Turn[] = [];
  for (const m of history) {
    if (m.error || !m.text.trim()) continue;
    const last = turns[turns.length - 1];
    if (last && last.role === m.role) last.text += "\n\n" + m.text;
    else turns.push({ role: m.role, text: m.text });
  }
  const recent = turns.slice(-MAX_TURNS);
  while (recent.length > 0 && recent[0].role === "assistant") recent.shift();
  return recent;
}

async function failIfBad(res: Response) {
  if (res.ok) return;
  let detail = "";
  try {
    detail = await res.text();
  } catch {
    /* ignore */
  }
  let msg = detail;
  try {
    msg = JSON.parse(detail).error?.message ?? detail;
  } catch {
    /* not JSON */
  }
  throw new HttpError(res.status, `HTTP ${res.status}${msg ? `: ${msg.slice(0, 300)}` : ""}`);
}

async function* sseData(res: Response): AsyncGenerator<string> {
  if (!res.body) throw new Error("Empty response from server.");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const parse = (line: string) =>
    line.startsWith("data:") ? line.slice(5).trim() : "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const data = parse(line);
      if (data) yield data;
    }
  }
  const rest = parse(buffer.trim());
  if (rest) yield rest;
}

function friendlyError(e: unknown, models: string[], label: string): Error {
  if (e instanceof HttpError && (e.status === 0 || e.status === 429 || e.status >= 500)) {
    const what = e.status === 0 ? "no response in time" : `HTTP ${e.status}`;
    return new Error(
      `${label} is busy or not responding right now (${what}). Tried: ${models.join(", ")}. Please try again in a moment.`
    );
  }
  return e instanceof Error ? e : new Error(String(e));
}

/** Try each model (main, then fallback), retrying once on temporary errors. */
async function withFallback(
  models: string[],
  run: (model: string, emit: (t: string) => void) => Promise<void>,
  onToken: (t: string) => void,
  signal: AbortSignal,
  label: string
) {
  let started = false;
  const emit = (t: string) => {
    started = true;
    onToken(t);
  };
  let lastErr: unknown = null;

  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await run(model, emit);
        return;
      } catch (e) {
        if (signal.aborted) throw e;
        if (started || e instanceof FatalError) throw e; // can't retry after partial output
        lastErr = e;
        const status = e instanceof HttpError ? e.status : -1;
        if (status === 401 || status === 403) throw e;
        if (status === 400 || status === 404) break; // model problem: next model
        if (attempt === 0) await sleep(1500, signal);
      }
    }
  }
  throw friendlyError(lastErr, models, label);
}

const uniqueModels = (...list: string[]) =>
  list.map((m) => m.trim()).filter((m, i, arr) => m && arr.indexOf(m) === i);

/* ---------- Gemini ---------- */

async function geminiOnce(
  model: string,
  key: string,
  turns: Turn[],
  emit: (t: string) => void,
  signal: AbortSignal
) {
  if (signal.aborted) throw abortError();

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal.addEventListener("abort", onAbort);

  let timedOut = false;
  let gotFirst = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, FIRST_TOKEN_TIMEOUT_MS);

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: turns.map((t) => ({
          role: t.role === "user" ? "user" : "model",
          parts: [{ text: t.text }],
        })),
      }),
      signal: controller.signal,
    });
    await failIfBad(res);

    for await (const data of sseData(res)) {
      let json: any;
      try {
        json = JSON.parse(data);
      } catch {
        continue;
      }
      if (json.error) throw new Error(json.error.message ?? "Gemini error");
      const parts = json.candidates?.[0]?.content?.parts ?? [];
      for (const p of parts) {
        if (typeof p.text === "string" && p.text && !p.thought) {
          if (!gotFirst) {
            gotFirst = true;
            clearTimeout(timer);
          }
          emit(p.text);
        }
      }
    }
    if (!gotFirst) throw new Error("The model returned an empty reply.");
  } catch (e) {
    if (timedOut && !signal.aborted) throw new HttpError(0, "timed out");
    throw e;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}

async function streamGemini(
  s: Settings,
  turns: Turn[],
  onToken: (t: string) => void,
  signal: AbortSignal
) {
  const key = s.geminiKey.trim();
  if (!key) throw new ConfigError("Add your Gemini API key in Settings.");
  const models = uniqueModels(s.geminiModel, s.geminiFallbackModel);
  if (models.length === 0) throw new ConfigError("Set the Gemini model in Settings.");

  await withFallback(
    models,
    (model, emit) => geminiOnce(model, key, turns, emit, signal),
    onToken,
    signal,
    "Gemini"
  );
}

/* ---------- OmniRoute (OpenAI-compatible) ---------- */

const omniBase = (s: { omniBaseUrl: string }) =>
  s.omniBaseUrl.trim().replace(/\/+$/, "");

const omniHeaders = (key: string): Record<string, string> => {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (key.trim()) h.Authorization = `Bearer ${key.trim()}`;
  return h;
};

export async function listOmniModels(baseUrl: string, apiKey: string): Promise<string[]> {
  const base = baseUrl.trim().replace(/\/+$/, "");
  if (!base) throw new Error("Set the base URL first.");

  let res: Response;
  try {
    res = await fetch(`${base}/models`, { headers: omniHeaders(apiKey) });
  } catch {
    throw new Error("Could not reach OmniRoute. Is the server running?");
  }
  await failIfBad(res);

  const json: any = await res.json();
  const raw: any[] = json.data ?? json.models ?? [];
  const ids = raw
    .map((m) => (typeof m === "string" ? m : m?.id))
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  return Array.from(new Set(ids)).sort();
}

async function omniOnce(
  s: Settings,
  model: string,
  turns: Turn[],
  emit: (t: string) => void,
  signal: AbortSignal
) {
  if (signal.aborted) throw abortError();

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal.addEventListener("abort", onAbort);

  let timedOut = false;
  let alive = false; // any output at all, including "thinking"
  let gotContent = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, FIRST_TOKEN_TIMEOUT_MS);

  try {
    let res: Response;
    try {
      res = await fetch(`${omniBase(s)}/chat/completions`, {
        method: "POST",
        headers: omniHeaders(s.omniKey),
        body: JSON.stringify({
          model,
          stream: true,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            ...turns.map((t) => ({ role: t.role, content: t.text })),
          ],
        }),
        signal: controller.signal,
      });
    } catch (e) {
      if (timedOut || signal.aborted) throw e;
      throw new FatalError("Could not reach OmniRoute. Is the server running?");
    }
    await failIfBad(res);

    for await (const data of sseData(res)) {
      if (data === "[DONE]") break;
      let json: any;
      try {
        json = JSON.parse(data);
      } catch {
        continue;
      }
      if (json.error) throw new Error(json.error.message ?? "OmniRoute error");

      const delta = json.choices?.[0]?.delta;
      if (!delta) continue;
      if (!alive && (delta.content || delta.reasoning_content || delta.reasoning)) {
        alive = true;
        clearTimeout(timer);
      }
      if (typeof delta.content === "string" && delta.content) {
        gotContent = true;
        emit(delta.content);
      }
    }
    if (!gotContent) throw new Error("The model returned an empty reply.");
  } catch (e) {
    if (timedOut && !signal.aborted) throw new HttpError(0, "timed out");
    throw e;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}

async function streamOmniRoute(
  s: Settings,
  turns: Turn[],
  onToken: (t: string) => void,
  signal: AbortSignal
) {
  if (!omniBase(s)) throw new ConfigError("Set the OmniRoute base URL in Settings.");
  const models = uniqueModels(s.omniModel, s.omniFallbackModel);
  if (models.length === 0) throw new ConfigError("Choose an OmniRoute model in Settings.");

  await withFallback(
    models,
    (model, emit) => omniOnce(s, model, turns, emit, signal),
    onToken,
    signal,
    "OmniRoute"
  );
}

/* ---------- Public ---------- */

export async function streamChat(
  settings: Settings,
  history: Message[],
  onToken: (t: string) => void,
  signal: AbortSignal
): Promise<void> {
  const turns = buildTurns(history);
  if (settings.provider === "gemini") {
    return streamGemini(settings, turns, onToken, signal);
  }
  return streamOmniRoute(settings, turns, onToken, signal);
}