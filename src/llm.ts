import { fetch } from "@tauri-apps/plugin-http";
import type { Message } from "./types";
import type { Settings } from "./settings";

const BASE_PROMPT =
  "You are Berzh AI, a helpful assistant inside a desktop app. Answer clearly and concisely. " +
  "If you are unsure, or the information may be out of date, say so instead of guessing.\n\n" +
  "Format answers in Markdown so they are easy to read: keep simple answers as short plain paragraphs; " +
  "use bullet lists for several points, numbered lists for steps (indent sub-points), **bold** for key terms, " +
  "tables for comparisons, and fenced code blocks for code. Never add headings to short answers.";


const ANSWER_TIMEOUT_MS = 60_000; // reasoning models may think for a while
const LIVE_TIMEOUT_MS = 6_000;

export interface ChatOptions {
  live?: boolean;
  quick?: boolean;
  maxTurns?: number;
  system?: string;
  context?: string; // excerpts from the user's documents
  web?: string; // results of a live web search
  webFailed?: boolean; // a search was needed but gave nothing
}
export class ConfigError extends Error { }
class FatalError extends Error { }

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

const HUMAN_RULES =
  "Write like a real person talking: natural, warm, plain everyday words, contractions, short sentences. " +
  "No bullet lists, headings, bold text or emojis unless I ask for them. " +
  'Do not open with filler such as "Certainly" or "Great question", do not mention being an AI, ' +
  "and do not end with a summary or an offer to help further. Keep it brief and direct.";

const AS_ME_RULES =
  'Every message you receive is a question addressed to me, the user, and you reply AS me, in the first person (I, my, me), using the details in "About me". ' +
  'Never address me as "you" and never describe me in the third person. ' +
  'For example, if asked "Tell me about yourself", answer "I am Alex and I am a ..." and never "You are Alex ...". ' +
  'Use only facts from "About me". If a detail is missing, do not invent it: keep that part general. ' +
  "Say it the way I would speak it out loud: plain sentences, no bullet points, tables or bold. " +
  'Do not mention being an AI. If "About me" is empty, tell me to fill it in under Settings.';

const INTERVIEW_COACH_RULES =
  "You are an interview coach and answer assistant for Thanseem, a candidate applying for entry-level IT Support and Service Desk Analyst roles. " +
  "When an interviewer asks a question, first identify its type internally, then answer in the matching style. " +
  "Use earlier conversation turns to understand follow-up questions and references such as 'they', 'those', or 'what kind'. " +
  "Answer the current question in that context; do not switch to a generic introduction or unrelated topic unless explicitly asked. " +
  "Write the spoken interview answer from Thanseem's first-person point of view, as if he is speaking directly to the interviewer. " +
  "Use 'I', 'me', and 'my'. Never describe Thanseem as 'he' or 'him', never say what 'you' should do, and never address the interviewer as 'you'. " +
  "Do not use second-person 'you' or 'your' anywhere in the spoken interview answer; use first-person wording for actions and explanations. " +
  "For example, say 'First, I would check...' rather than 'Thanseem would check...' or 'You should check...'. " +
  "Write an answer Thanseem can say out loud in a real interview.\n\n" +
  "Concept or definition questions: Give a clear plain-English definition in two to four sentences for a non-expert. " +
  "Do not add an example, use case, or commands unless the interviewer asks.\n\n" +
  "Example requests: Give one short, realistic example from support work in a few sentences.\n\n" +
  "'How do you do it' or day-to-day process questions: Explain the relevant steps in the order I would take them. " +
  "When useful, name relevant commands or tools such as ipconfig /all, ping, nslookup, tracert, Event Viewer, Task Manager, " +
  "or Active Directory Users and Computers, and briefly say what each shows or does. Keep the tools relevant to the question.\n\n" +
  "Scenario questions: Use only the situation described. Explain how I would confirm key facts (whether one or many users are affected, " +
  "what changed, and the error), then move from simple checks to deeper ones, confirm the fix, inform the user, and explain when I would escalate. " +
  "Do not add unrelated problems.\n\n" +
  "Behavioral questions: Use the STAR structure (Situation, Task, Action, Result), focused on one real-sounding example. " +
  "Never invent a specific employer or number. If details are unknown, use a general, honest example and remind me in the Tip to replace it with my own real example.\n\n" +
  "'Tell me about yourself' and other personal questions: Write a fresh, natural answer specific to the question. " +
  "Cover who I am, what I am doing now, what I am looking for, and how I feel about the opportunity, conversationally. " +
  "Avoid stock phrases and self-praise labels such as 'quick learner', 'passionate team player', or 'hard-working professional'. " +
  "Do not give a memorized-sounding opening. Vary wording and structure so the answer sounds spontaneous.\n\n" +
  "For every answer, speak in the first person as Thanseem, in natural, confident, friendly spoken English—not like a textbook, script, or chatbot. " +
  "Match length to the question and keep it under about 90 seconds unless clearly needed. " +
  "Do not use bullets, headings, or Markdown in the answer; write continuous speech. Avoid filler and empty buzzwords. " +
  "Never invent experience, certifications, employers, or numbers. Do not mention IT solutions or services business work. " +
  "Use only relevant hardware/software troubleshooting, tools used in that work, and Thanseem's academic background: " +
  "Bachelor of Information Technology (BIT), University of Moratuwa.\n\n" +
  "After each answer, add one short separate line beginning exactly 'Tip:' with one practical way Thanseem can sound stronger, " +
  "such as naming a tool he has actually used or adding a real detail from his experience.";

function buildSystemPrompt(
  s: Settings,
  context?: string,
  web?: string,
  webFailed?: boolean
): string {
  const parts = [
    s.interviewCoach
      ? "You are Berzh AI, a helpful interview answer assistant. Answer clearly and concisely. If you are unsure, say so instead of guessing."
      : BASE_PROMPT,
  ];
  parts.push(`Today's date: ${new Date().toDateString()}.`);
  parts.push(
    `About me (the user you are chatting with):\n${s.aboutMe.trim() || "(empty)"}`
  );
  if (context) {
    parts.push(
      "Reference documents I uploaded (excerpts). If they contain the answer, use them and do not contradict them. " +
      "If they do not cover the question, answer from your general knowledge as usual and do not mention the documents.\n\n" +
      context
    );
  }
  if (web) {
    parts.push(
      "Results from a live web search done just now. Use them for anything current or time-sensitive and prefer them over your memory. " +
      "If they do not contain the answer, say so plainly instead of guessing.\n\n" +
      web
    );
  } else if (webFailed) {
    parts.push(
      "A web search was attempted but returned nothing usable. If the question needs current information, " +
      "say that you could not check it right now instead of guessing."
    );
  }
  if (s.interviewCoach) {
    parts.push(INTERVIEW_COACH_RULES);
  } else {
    parts.push(
      "When a visual helps (a flow, structure, process, or relationship), you may answer with a ```mermaid fenced code block - it is rendered as a picture. " +
        "Use valid Mermaid syntax, with every edge connected to a node; do not put horizontal-rule or separator lines inside a diagram. " +
        "Use tables or bullet lists when they fit the question better than prose."
    );
    if (s.answerAsMe) parts.push(AS_ME_RULES);
    if (s.humanTone) parts.push(HUMAN_RULES);
  }
  const ins = s.instructions.trim();
  if (ins) parts.push(`My instructions:\n${ins}`);
  return parts.join("\n\n");
}

function buildTurns(history: Message[], maxTurns: number): Turn[] {
  const turns: Turn[] = [];
  for (const m of history) {
    if (m.error || !m.text.trim()) continue;
    const last = turns[turns.length - 1];
    if (last && last.role === m.role) last.text += "\n\n" + m.text;
    else turns.push({ role: m.role, text: m.text });
  }
  const recent = turns.slice(-maxTurns);
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

function friendlyError(e: unknown, models: string[], who: string): Error {
  if (e instanceof HttpError && (e.status === 0 || e.status === 429 || e.status >= 500)) {
    const what = e.status === 0 ? "no response in time" : `HTTP ${e.status}`;
    return new Error(
      `${who} is busy or not responding right now (${what}). Tried: ${models.join(", ")}. Please try again in a moment.`
    );
  }
  return e instanceof Error ? e : new Error(String(e));
}

/** Try each model (main, then fallback), retrying on temporary errors. */
async function withFallback(
  models: string[],
  run: (model: string, emit: (t: string) => void) => Promise<void>,
  onToken: (t: string) => void,
  signal: AbortSignal,
  attempts: number,
  who = "OmniRoute"
) {
  let started = false;
  const emit = (t: string) => {
    started = true;
    onToken(t);
  };
  let lastErr: unknown = null;

  for (const model of models) {
    for (let attempt = 0; attempt < attempts; attempt++) {
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
        if (attempt < attempts - 1) await sleep(1500, signal);
      }
    }
  }
  throw friendlyError(lastErr, models, who);
}

const uniqueModels = (...list: string[]) =>
  list.map((m) => m.trim()).filter((m, i, arr) => m && arr.indexOf(m) === i);

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
  system: string,
  turns: Turn[],
  emit: (t: string) => void,
  signal: AbortSignal,
  timeoutMs: number,
  maxOutputTokens?: number
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
  }, timeoutMs);

  try {
    let res: Response;
    try {
      res = await fetch(`${omniBase(s)}/chat/completions`, {
        method: "POST",
        headers: omniHeaders(s.omniKey),
        body: JSON.stringify({
          model,
          stream: true,
          ...(maxOutputTokens ? { max_tokens: maxOutputTokens } : {}),
          messages: [
            { role: "system", content: system },
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

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

async function geminiOnce(
  s: Settings,
  model: string,
  system: string,
  turns: Turn[],
  emit: (t: string) => void,
  signal: AbortSignal,
  timeoutMs: number,
  maxOutputTokens?: number
) {
  if (signal.aborted) throw abortError();

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal.addEventListener("abort", onAbort);

  let timedOut = false;
  let gotContent = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    let res: Response;
    try {
      res = await fetch(
        `${GEMINI_BASE}/models/${model}:streamGenerateContent?alt=sse`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": s.geminiKey.trim(),
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            ...(maxOutputTokens ? { generationConfig: { maxOutputTokens } } : {}),
            contents: turns.map((t) => ({
              role: t.role === "assistant" ? "model" : "user",
              parts: [{ text: t.text }],
            })),
          }),
          signal: controller.signal,
        }
      );
    } catch (e) {
      if (timedOut || signal.aborted) throw e;
      throw new FatalError("Could not reach the Gemini API. Check your internet connection.");
    }
    await failIfBad(res).catch((e) => {
      // Google reports a bad key as HTTP 400, not 401
      if (
        e instanceof HttpError &&
        (e.status === 400 || e.status === 403) &&
        /api key/i.test(e.message)
      ) {
        throw new ConfigError("Invalid Gemini API key. Check it in Settings.");
      }
      throw e;
    });

    for await (const data of sseData(res)) {
      let json: any;
      try {
        json = JSON.parse(data);
      } catch {
        continue;
      }
      if (json.error) throw new Error(json.error.message ?? "Gemini error");

      const parts = json.candidates?.[0]?.content?.parts;
      if (!Array.isArray(parts)) continue;
      const text = parts
        .map((p: any) => (typeof p?.text === "string" ? p.text : ""))
        .join("");
      if (text) {
        gotContent = true;
        clearTimeout(timer);
        emit(text);
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

export async function streamChat(
  settings: Settings,
  history: Message[],
  onToken: (t: string) => void,
  signal: AbortSignal,
  opts: ChatOptions = {}
): Promise<void> {
  const live = !!opts.live;
  const quick = !!opts.quick;

  // Gemini answers over the API - no local server needed, one provider at a time
  if (settings.llmProvider === "gemini") {
    if (!settings.geminiKey.trim()) {
      throw new ConfigError(
        "Add your Gemini API key in Settings (Models page), or switch back to OmniRoute."
      );
    }
    const geminiModels = quick
      ? uniqueModels(settings.geminiLiveModel, settings.geminiModel)
      : live
        ? uniqueModels(settings.geminiLiveModel || settings.geminiModel)
        : uniqueModels(settings.geminiModel);
    if (geminiModels.length === 0) {
      throw new ConfigError("Choose a Gemini model in Settings (Models page).");
    }

    const geminiTurns = buildTurns(history, opts.maxTurns ?? 20);
    const geminiSystem =
      opts.system ?? buildSystemPrompt(settings, opts.context, opts.web, opts.webFailed);

    await withFallback(
      geminiModels,
      (model, emit) =>
        geminiOnce(
          settings,
          model,
          geminiSystem,
          geminiTurns,
          emit,
          signal,
          live ? LIVE_TIMEOUT_MS : ANSWER_TIMEOUT_MS,
          quick ? 450 : undefined,
        ),
      onToken,
      signal,
      live || quick ? 1 : 2,
      "Gemini"
    );
    return;
  }

  if (!omniBase(settings)) throw new ConfigError("Set the OmniRoute base URL in Settings.");

  const models = quick
    ? uniqueModels(settings.liveModel, settings.omniModel, settings.liveFallbackModel, settings.omniFallbackModel)
    : live
      ? uniqueModels(settings.liveModel || settings.omniModel, settings.liveFallbackModel)
      : uniqueModels(settings.omniModel, settings.omniFallbackModel);
  if (models.length === 0) throw new ConfigError("Choose an OmniRoute model in Settings.");

  const turns = buildTurns(history, opts.maxTurns ?? 20);
  const system = opts.system ?? buildSystemPrompt(settings, opts.context, opts.web, opts.webFailed);
  const timeoutMs = live ? LIVE_TIMEOUT_MS : ANSWER_TIMEOUT_MS;

  await withFallback(
    models,
    (model, emit) =>
      omniOnce(settings, model, system, turns, emit, signal, timeoutMs, quick ? 450 : undefined),
    onToken,
    signal,
    live || quick ? 1 : 2
  );
}