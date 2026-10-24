import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowUp, Loader2, Mic, Square, X } from "lucide-react";
import Markdown from "./Markdown";
import { loadSettings } from "../db";
import { describeMicError, startVoice, type VoiceSession } from "../voice";
import { ConfigError, streamChat } from "../llm";
import { decideRoute } from "../router";
import { searchWeb } from "../web";
import type { Message, Ref } from "../types";

interface OverlayMsg {
  id: string;
  role: "user" | "assistant";
  text: string;
  refs?: Ref[];
  error?: boolean;
  pending?: boolean;
  status?: string;
}

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/**
 * The floating "Quick assistant" window: a transparent, always-on-top glass
 * panel with the input on top and the answers below. Closing it restores the
 * main window (handled in Rust).
 */
export default function OverlayWindow() {
  const [msgs, setMsgs] = useState<OverlayMsg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [dictating, setDictating] = useState(false);
  const [dictReady, setDictReady] = useState(false);
  const [note, setNote] = useState(""); // a small warning under the input

  const dictBase = useRef({ text: "", cursor: 0 });
  const dictManualEdit = useRef(false);
  const conversationRef = useRef<Message[]>([]);
  const textRef = useRef("");
  const dictOn = useRef(false);
  const dictSession = useRef<VoiceSession | null>(null);
  const busyRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const updateText = (value: string) => {
    textRef.current = value;
    setText(value);
  };

  // the popup is always the same dark glass: a fixed dark surface keeps
  // text readable no matter what shows through the transparent window behind
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  // newest answer always in view
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  // release the microphone when the window closes
  useEffect(() => {
    return () => {
      dictOn.current = false;
      void dictSession.current?.stop().catch((e) => console.error("Could not stop overlay dictation:", e));
      dictSession.current = null;
      controllerRef.current?.abort();
    };
  }, []);

  // keep the input one line tall (up to a few lines), like the main composer
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 110)}px`;
  }, [text]);

  const stopDictation = async () => {
    const session = dictSession.current;
    if (session) await session.stop();
    dictOn.current = false;
    dictSession.current = null;
    setDictating(false);
    setDictReady(false);
    dictManualEdit.current = false;
  };

  const ask = async () => {
    if (busyRef.current) return;
    if (dictOn.current) {
      try {
        await stopDictation();
      } catch (e) {
        setNote(`Could not stop voice typing: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
    }
    const q = textRef.current.trim();
    if (!q) return;
    busyRef.current = true;
    setBusy(true);
    setNote("");
    const qid = crypto.randomUUID();
    const controller = new AbortController();
    controllerRef.current = controller;
    setMsgs([
      { id: `u-${qid}`, role: "user", text: q },
      { id: qid, role: "assistant", text: "", pending: true, status: "Preparing your answer..." },
    ]);
    updateText("");
    dictBase.current = { text: "", cursor: 0 };
    let raw = "";
    try {
      const loadedSettings = await loadSettings();
      const settings = { ...loadedSettings, interviewCoach: true };
      const route = decideRoute(
        q,
        null,
        settings.webSearch && !!settings.tavilyKey.trim(),
        false,
      );
      let web: Awaited<ReturnType<typeof searchWeb>> | null = null;
      let webFailed = false;
      if (route === "web") {
        setMsgs((messages) =>
          messages.map((message) =>
            message.id === qid ? { ...message, status: "Searching the web..." } : message,
          ),
        );
        try {
          web = await searchWeb(
            settings.tavilyKey,
            q,
            { topic: settings.tavilyTopic },
            controller.signal,
          );
          webFailed = !web;
        } catch (e) {
          if (controller.signal.aborted || e instanceof ConfigError) throw e;
          webFailed = true;
        }
      }
      setMsgs((messages) =>
        messages.map((message) =>
          message.id === qid ? { ...message, status: "Generating answer..." } : message,
        ),
      );
      const history: Message[] = [{ id: qid, role: "user", text: q }];
      const contextualHistory = [...conversationRef.current, ...history];
      await streamChat(
        settings,
        contextualHistory,
        (token) => {
          raw += token;
          setMsgs((messages) =>
            messages.map((message) =>
              message.id === qid
                ? { ...message, text: raw, pending: false, status: undefined }
                : message,
            ),
          );
        },
        controller.signal,
        { web: web?.context, webFailed, maxTurns: 12, quick: true },
      );
      conversationRef.current = [
        ...conversationRef.current,
        { id: `u-${qid}`, role: "user" as const, text: q },
        { id: qid, role: "assistant" as const, text: raw },
      ].slice(-24);
      setMsgs((messages) =>
        messages.map((message) =>
          message.id === qid
            ? { ...message, text: raw, pending: false, status: undefined, refs: web?.refs }
            : message,
        ),
      );
    } catch (e) {
      if (controller.signal.aborted) {
        setMsgs((messages) =>
          messages.map((message) =>
            message.id === qid
              ? { ...message, text: raw, pending: false, status: undefined }
              : message,
          ),
        );
      } else {
        const error = e instanceof Error ? e.message : String(e);
        setMsgs((messages) =>
          messages.map((message) =>
            message.id === qid
              ? { ...message, text: error, pending: false, status: undefined, error: true }
              : message,
          ),
        );
      }
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      busyRef.current = false;
      setBusy(false);
    }
  };

  const toggleMic = async () => {
    if (dictOn.current) {
      try {
        await stopDictation();
      } catch (e) {
        setNote(e instanceof Error ? e.message : String(e));
      }
      return;
    }

    const input = inputRef.current;
    const currentText = textRef.current;
    const selectionStart = input?.selectionStart ?? currentText.length;
    const selectionEnd = input?.selectionEnd ?? selectionStart;

    setNote("");
    let settings;
    try {
      settings = await loadSettings();
    } catch (e) {
      setNote(`Could not load voice settings: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (!settings.deepgramKey.trim()) {
      setNote("Add your Deepgram API key in Settings > Connection > Voice listening.");
      return;
    }

    dictOn.current = true;
    dictManualEdit.current = false;
    setDictReady(false);
    dictBase.current = {
      text: currentText.slice(0, selectionStart) + currentText.slice(selectionEnd),
      cursor: selectionStart,
    };
    updateText(dictBase.current.text);
    setDictating(true);
    try {
      const session = await startVoice(
        { apiKey: settings.deepgramKey, language: settings.voiceLang },
        {
          onStatus: (status) => setDictReady(status === "listening"),
          onSpeech: () => {},
          onUtteranceStart: () => {
            dictManualEdit.current = false;
            dictBase.current = {
              text: textRef.current,
              cursor: inputRef.current?.selectionStart ?? textRef.current.length,
            };
          },
          onTranscript: (transcript) => {
            if (dictOn.current && !dictManualEdit.current) {
              const { text: base, cursor } = dictBase.current;
              const next = base.slice(0, cursor) + transcript + base.slice(cursor);
              updateText(next);
              const nextCursor = cursor + transcript.length;
              requestAnimationFrame(() => inputRef.current?.setSelectionRange(nextCursor, nextCursor));
            }
          },
          onUtteranceEnd: (transcript) => {
            if (!dictOn.current || dictManualEdit.current || !transcript) return;
            const { text: base, cursor } = dictBase.current;
            const next = base.slice(0, cursor) + transcript + base.slice(cursor);
            dictBase.current = { text: next, cursor: cursor + transcript.length };
            updateText(next);
            requestAnimationFrame(() =>
              inputRef.current?.setSelectionRange(dictBase.current.cursor, dictBase.current.cursor),
            );
          },
          onError: (message) => {
            if (!dictOn.current) return;
            dictOn.current = false;
            dictSession.current = null;
            setDictating(false);
            setDictReady(false);
            setNote(message);
          },
        },
      );
      if (dictOn.current) {
        dictSession.current = session;
      }
      else void session.stop().catch((e) => console.error("Could not stop overlay dictation:", e));
    } catch (e) {
      if (!dictOn.current) return;
      dictOn.current = false;
      setDictating(false);
      setDictReady(false);
      setNote(describeMicError(e));
    }
  };

  const close = () => {
    // restores the main window (Rust side)
    void invoke("close_overlay").catch(() => {
      /* plain browser preview: nothing to close */
    });
  };

  return (
    <div className="h-screen flex flex-col rounded-xl border border-white/15 bg-[#17181c]/90 backdrop-blur-2xl overflow-hidden box-border select-none">
        {/* title bar: drag the window by it, close with the cross */}
        <div
          className="h-11 pl-4 pr-2 flex items-center justify-between shrink-0"
          data-tauri-drag-region
        >
          <span
            className="text-sm font-semibold tracking-wide text-white/90"
            data-tauri-drag-region
          >
            Quick Assistant
          </span>
          <button
            onClick={close}
            title="Close"
            aria-label="Close quick assistant"
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/10 text-white hover:bg-red-500/80 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-white"
          >
            <X size={16} />
          </button>
        </div>

        {/* input on top, with the voice icon for speech-to-text */}
        <div className="px-4 pt-2 pb-3 shrink-0">
          <div className="flex items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-3 py-2">
            <textarea
              ref={inputRef}
              rows={1}
              value={text}
              placeholder={
                dictating
                  ? dictReady
                    ? "Listening..."
                    : "Connecting microphone..."
                  : "Ask an interview question..."
              }
              onChange={(e) => {
                updateText(e.target.value);
                if (dictOn.current) {
                  dictBase.current = {
                    text: e.target.value,
                    cursor: e.target.selectionStart,
                  };
                  dictManualEdit.current = true;
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  ask();
                }
              }}
              className="min-h-9 flex-1 resize-none select-text cursor-text bg-transparent py-1 text-sm leading-6 text-white outline-none placeholder:text-white/50"
            />
            <button
              onClick={() => void toggleMic()}
              title={dictating ? "Stop voice typing" : "Voice typing"}
              aria-label={dictating ? "Stop voice typing" : "Voice typing"}
              aria-pressed={dictating}
              className={`h-9 w-9 flex items-center justify-center rounded-lg shrink-0 ${
                dictating
                  ? "bg-red-500 text-white"
                  : "bg-white/10 text-white/80 hover:bg-white/20 hover:text-white"
              }`}
            >
              {dictating && !dictReady ? (
                <Loader2 size={15} className="animate-spin" />
              ) : dictating ? (
                <Square size={13} className="fill-current" />
              ) : (
                <Mic size={16} />
              )}
            </button>
            <button
              onClick={ask}
              disabled={!text.trim() || busy}
              title="Send"
              aria-label="Send"
              className="h-9 w-9 flex items-center justify-center rounded-lg shrink-0 bg-accent text-panel disabled:opacity-40"
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : <ArrowUp size={16} />}
            </button>
          </div>
          {note && (
            <p className="mt-1.5 px-1 text-xs text-amber-600 dark:text-amber-400">{note}</p>
          )}
        </div>

        {/* answers below */}
        <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto px-4 pb-3">
          {msgs.length === 0 ? (
            <div className="h-full flex items-center justify-center text-center px-6">
              <p className="text-[13px] text-white/70 leading-5">
                <span className="block text-base font-semibold text-white/90">Interview practice, made simple.</span>
                <span className="mt-1 block">Ask an interview question to practice your answer.</span>
              </p>
            </div>
          ) : (
            <div className="space-y-3 text-sm">
              {msgs.map((m) =>
                m.role === "user" ? (
                  <div key={m.id} className="flex justify-end">
                    <div className="max-w-[85%] rounded-lg rounded-tr-sm bg-accent text-panel px-3 py-2 text-[13.5px] whitespace-pre-wrap wrap-break-word">
                      {m.text}
                    </div>
                  </div>
                ) : (
                  <div key={m.id}>
                    {m.pending && !m.text ? (
                      <span className="inline-flex items-center gap-1.5 text-muted text-[13px]">
                        <Loader2 size={13} className="animate-spin" /> {m.status ?? "Thinking..."}
                      </span>
                    ) : (
                      <div
                        className={`md text-[13.5px] ${
                          m.error ? "text-red-600 dark:text-red-400" : "text-ink"
                        }`}
                      >
                        <Markdown text={m.text} />
                      </div>
                    )}
                    {m.refs && m.refs.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {m.refs.map((r) => (
                          <button
                            key={r.url || r.title}
                            title={r.title}
                            onClick={() => {
                              if (r.url) openUrl(r.url).catch(console.error);
                            }}
                            className="px-2 py-0.5 max-w-40 truncate text-xs rounded-full bg-accent-soft text-accent hover:underline"
                          >
                            {host(r.url) || r.title}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ),
              )}
            </div>
          )}
        </div>
    </div>
  );
}
