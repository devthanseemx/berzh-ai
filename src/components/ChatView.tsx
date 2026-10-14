import { useEffect, useRef, useState } from "react";
import { Check, Copy, Eye } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Preview, Session } from "../types";
import type { VoiceState } from "../voice";
import Composer from "./Composer";
import LivePreview from "./LivePreview";
import VoiceMode from "./VoiceMode";
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
  onStopVoice: () => void;
  onRetryVoice: () => void;
  onOpenSettings: () => void;
  onSend: (text: string) => void;
  onStop: () => void;
  onTyping: (text: string) => void;
  /** voice typing in the text box */
  dictating: boolean;
  dictText: string;
  onToggleDictation: () => void;
  /** documents attached to this chat */
  onUpload: (files: File[]) => Promise<string | null>;
  onRemoveDoc: (id: string) => void;
  onRestoreDoc: (id: string) => void;
  /** mic muted but voice mode stays open */
  voicePaused: boolean;
  onPauseToggle: () => void;
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
  onStopVoice,
  onRetryVoice,
  onOpenSettings,
  onSend,
  onStop,
  onTyping,
  dictating,
  dictText,
  onToggleDictation,
  onUpload,
  onRemoveDoc,
  onRestoreDoc,
  voicePaused,
  onPauseToggle,
}: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  // the live preview can be folded away while typing, then brought back with one click
  const [previewOn, setPreviewOn] = useState(true);

  useEffect(() => {
    endRef.current?.scrollIntoView();
  }, [session.messages.length]);

  const lastAssistant =
    [...session.messages].reverse().find((m) => m.role === "assistant") ?? null;

  // new chat: greeting + input in the middle; once the conversation starts
  // the input moves back to the bottom
  const isEmpty = session.messages.length === 0;

  return (
    <section className="relative flex-1 min-w-0 flex flex-col bg-panel">
      <header className="h-12 px-5 flex items-center shrink-0">
        {!isEmpty && (
          <span className="font-medium truncate">{session.title}</span>
        )}
      </header>

      <div className="flex-1 min-w-0 flex overflow-hidden">
        <div className={`flex-1 min-w-0 flex flex-col overflow-hidden ${isEmpty ? "justify-center" : ""}`}>
          {isEmpty ? (
            <h1 className="fade-in px-6 pb-10 text-center text-4xl xl:text-5xl font-semibold tracking-tight text-ink">
              How can I help you today?
            </h1>
          ) : (
          <div className="flex-1 overflow-y-auto">
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
                      className={`leading-relaxed text-[14.5px] ${isUser
                          ? "px-4 py-2.5 rounded-xl rounded-tr-none bg-accent text-panel whitespace-pre-wrap"
                          : m.error
                            ? "px-4 py-2.5 rounded-2xl rounded-bl-md bg-red-50 text-red-700 whitespace-pre-wrap"
                            : "text-ink"
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
                            key={r.url || r.title}
                            title={r.title}
                            onClick={() => {
                              if (r.url) openUrl(r.url).catch(console.error);
                            }}
                            className="px-2 py-0.5 max-w-45 truncate text-xs rounded-full bg-accent-soft text-accent hover:underline"
                          >
                            {host(r.url) || r.title}
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
          <div ref={endRef} />
          </div>
        )}

          <Composer
        centered={isEmpty}
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
        dictating={dictating}
        dictText={dictText}
        onToggleDictation={onToggleDictation}
        docs={session.docs}
        onUpload={onUpload}
        onRemoveDoc={onRemoveDoc}
        onRestoreDoc={onRestoreDoc}
          />
        </div>
      </div>

      {preview && !voice && (
        previewOn ? (
          <div className="fade-in absolute right-4 top-14 z-10 w-[26rem] max-w-[calc(100%-2rem)]">
            <div className="overflow-hidden rounded-2xl border border-line bg-panel shadow-xl shadow-black/10">
              <LivePreview
                preview={preview}
                compact
                onToggle={() => setPreviewOn(false)}
              />
            </div>
          </div>
        ) : (
          <button
            onClick={() => setPreviewOn(true)}
            title="Show live preview"
            className="fade-in absolute right-4 top-14 z-10 h-8 w-8 flex items-center justify-center rounded-full border border-line bg-panel text-muted shadow-md shadow-black/10 hover:text-ink hover:bg-bg transition-colors"
          >
            <Eye size={15} />
          </button>
        )
      )}

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
          paused={voicePaused}
          onPauseToggle={onPauseToggle}
        />
      )}
    </section>
  );
}