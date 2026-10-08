import { streamChat } from "./llm";
import type { Settings } from "./settings";
import type { Message, Session } from "./types";

export const MIN_CHARS = 3;
export const DEBOUNCE_MS = 150;

export interface Draft {
  sessionId: string;
  typed: string;
  predicted: string;
  answer: string;
  done: boolean;
  error: string | null;
  controller: AbortController;
  listener: (() => void) | null;
}

const instruction = (typed: string) =>
  `A message is still being typed. So far:\n"""\n${typed}\n"""\n` +
  `Work out the most likely complete message, then reply to it briefly (1 to 3 sentences), following all your usual rules.\n` +
  `Reply in exactly this format:\nQUESTION: <the full message on one line>\n\n<your reply>`;

export function startDraft(
  settings: Settings,
  session: Session,
  typed: string,
  onChange?: () => void
): Draft {
  const draft: Draft = {
    sessionId: session.id,
    typed,
    predicted: "",
    answer: "",
    done: false,
    error: null,
    controller: new AbortController(),
    listener: null,
  };

    const history: Message[] = [
    ...session.messages.slice(-4),
    { id: "draft", role: "user", text: instruction(typed) },
  ];

  let raw = "";

  const parse = (final: boolean) => {
    const s = raw.trimStart();
    if (/^question:/i.test(s)) {
      const body = s.slice(s.indexOf(":") + 1);
      const nl = body.indexOf("\n");
      if (nl === -1) {
        draft.predicted = body.trim();
        draft.answer = "";
      } else {
        draft.predicted = body.slice(0, nl).trim();
        draft.answer = body.slice(nl + 1).replace(/^\s+/, "");
      }
    } else if (s.length >= 9 || final) {
      draft.predicted = typed; // model ignored the format
      draft.answer = raw;
    }
  };

  const notify = () => {
    onChange?.();
    draft.listener?.();
  };

  streamChat(
    settings,
    history,
    (tok) => {
      raw += tok;
      parse(false);
      notify();
    },
    draft.controller.signal,
    { live: true, maxTurns: 4 }
  )
    .then(() => {
      parse(true);
      draft.done = true;
      notify();
    })
    .catch((e) => {
      if (!draft.controller.signal.aborted) {
        draft.error = e instanceof Error ? e.message : String(e);
      }
      draft.done = true;
      notify();
    });

  return draft;
}

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

function jaccard(a: string[], b: string[]) {
  const A = new Set(a);
  const B = new Set(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  A.forEach((w) => {
    if (B.has(w)) inter++;
  });
  return inter / (A.size + B.size - inter);
}

/** Does this draft answer what the user actually sent? */
export function draftMatches(d: Draft, sessionId: string, finalText: string) {
  if (d.sessionId !== sessionId || d.error) return false;
  const f = words(finalText);
  if (f.length === 0) return false;

  const typed = words(d.typed);
  if (f.join(" ") === typed.join(" ")) return true; // sent exactly what was typed at the pause

  // user only added a word or two after the draft started
  const extra = f.length - typed.length;
  if (extra >= 0 && extra <= 2 && typed.every((w, i) => f[i] === w)) return true;

  return jaccard(f, words(d.predicted || d.typed)) >= 0.5;
}

/** Show the draft's answer as it arrives; resolves when it finishes (or is stopped). */
export function followDraft(
  d: Draft,
  onText: (answer: string) => void,
  signal: AbortSignal
): Promise<void> {
  return new Promise((resolve) => {
    const update = () => {
      onText(d.answer);
      if (d.done) {
        d.listener = null;
        resolve();
      }
    };
    d.listener = update;
    signal.addEventListener(
      "abort",
      () => {
        d.controller.abort();
        d.listener = null;
        resolve();
      },
      { once: true }
    );
    update();
  });
}