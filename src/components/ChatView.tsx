import { useEffect, useRef, useState } from "react";
import { PanelRight } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Preview, Session } from "../types";
import type { VoiceState } from "../voice";
import Composer from "./Composer";
import LivePreview from "./LivePreview";
import VoiceMode from "./VoiceMode";
import { Check, Copy } from "lucide-react";
import Markdown from "./Markdown";

const sourceLabel = {
  documents: "From documents",
  web: "From web",
} as const;

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

interface Props {
  session: Session;
  busy: boolean;
  preview: Preview | null;
  humanTone: boolean;
  answerAsMe: boolean;
  webSearch: boolean;
  voice: VoiceState | null;
  analyser: AnalyserNode | null;
  onToggleTone: () => void;
  onToggleAsMe: () => void;
  onToggleWeb: () => void;
  onStartVoice: () => void;
  onStopVoice: () => void;
  onRetryVoice: () => void;
  onOpenSettings: () => void;
  onSend: (text: string) => void;
  onStop: () => void;
  onTyping: (text: string) => void;
  onToggleSources: () => void;
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      title="Copy answer"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        } catch {
          /* ignore */
        }
      }}
      className="p-1 rounded-md text-muted opacity-0 group-hover/msg:opacity-100 hover:text-ink hover:bg-bg"
    >
      {done ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}

export default function ChatView({
  session,
  busy,
  preview,
  humanTone,
  answerAsMe,
  webSearch,
  voice,
  analyser,
  onToggleTone,
  onToggleAsMe,
  onToggleWeb,
  onStartVoice,
  onStopVoice,
  onRetryVoice,
  onOpenSettings,
  onSend,
  onStop,
  onTyping,
  onToggleSources,
}: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView();
  }, [session.messages.length]);

  const lastAssistant =
    [...session.messages].reverse().find((m) => m.role === "assistant") ?? null;

  return (
    <section className="relative flex-1 min-w-0 flex flex-col bg-white">
      <header className="h-12 px-5 flex items-center justify-between border-b border-line">
        <span className="font-medium truncate">{session.title}</span>
        <button
          onClick={onToggleSources}
          title="Toggle sources"
          className="p-2 rounded-lg hover:bg-bg"
        >
          <PanelRight size={18} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
        {session.messages.length === 0 ? (
          <div className="h-full flex items-center justify-center text-muted">
            Ask a question to start this session.
          </div>
        ) : (
          <div className="max-w-4xl mx-auto py-4">
            {session.messages.map((m) => {
              const isUser = m.role === "user";
              return (
                <div
                  key={m.id}
                  className={`px-6 py-2 flex ${isUser ? "justify-end" : "justify-start"}`}
                >
                  <div className={`group/msg flex flex-col min-w-0 ${isUser ? "max-w-[75%]" : "max-w-[88%]"}`}>
                    <div
                      className={`px-4 py-2.5 rounded-2xl leading-relaxed ${isUser
                          ? "bg-accent text-white rounded-br-md whitespace-pre-wrap"
                          : m.error
                            ? "bg-red-50 text-red-700 rounded-bl-md whitespace-pre-wrap"
                            : "bg-bg text-ink rounded-bl-md"
                        }`}
                    >
                      {isUser || m.error || !m.text ? (
                        m.text || m.status || "Thinking..."
                      ) : (
                        <Markdown text={m.text} />
                      )}
                    </div>
                    {!isUser && (
                      <div className="mt-1.5 ml-1 flex flex-wrap items-center gap-1.5">
                        {m.source && m.source !== "general" && (
                          <span className="px-2 py-0.5 text-xs rounded-full border border-line text-muted">
                            {sourceLabel[m.source]}
                          </span>
                        )}
                        {m.refs?.map((r) => (
                          <button
                            key={r.url}
                            title={r.title}
                            onClick={() => openUrl(r.url).catch(console.error)}
                            className="px-2 py-0.5 max-w-45 truncate text-xs rounded-full bg-accent-soft text-accent hover:underline"
                          >
                            {host(r.url)}
                          </button>
                        ))}
                        {m.text && !m.error && <CopyButton text={m.text} />}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div ref={endRef} />
      </div>

      {preview && !voice && (
        <div className="bg-white px-4 pt-2">
          <LivePreview preview={preview} />
        </div>
      )}
      <Composer
        onSend={onSend}
        busy={busy}
        onStop={onStop}
        onTextChange={onTyping}
        humanTone={humanTone}
        answerAsMe={answerAsMe}
        webSearch={webSearch}
        onToggleTone={onToggleTone}
        onToggleAsMe={onToggleAsMe}
        onToggleWeb={onToggleWeb}
        onStartVoice={onStartVoice}
      />

      {voice && (
        <VoiceMode
          voice={voice}
          analyser={analyser}
          preview={preview}
          last={lastAssistant}
          humanTone={humanTone}
          answerAsMe={answerAsMe}
          webSearch={webSearch}
          onToggleTone={onToggleTone}
          onToggleAsMe={onToggleAsMe}
          onToggleWeb={onToggleWeb}
          onStop={onStopVoice}
          onRetry={onRetryVoice}
          onOpenSettings={onOpenSettings}
        />
      )}
    </section>
  );
}