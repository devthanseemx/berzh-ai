import { useEffect, useRef } from "react";
import { PanelRight } from "lucide-react";
import type { Preview, Session } from "../types";
import Composer from "./Composer";
import LivePreview from "./LivePreview";

const sourceLabel = {
  documents: "From documents",
  web: "From web",
} as const;

interface Props {
  session: Session;
  busy: boolean;
  preview: Preview | null;
  humanTone: boolean;
  answerAsMe: boolean;
  onToggleTone: () => void;
  onToggleAsMe: () => void;
  onSend: (text: string) => void;
  onStop: () => void;
  onTyping: (text: string) => void;
  onToggleSources: () => void;
}

export default function ChatView({
  session,
  busy,
  preview,
  humanTone,
  answerAsMe,
  onToggleTone,
  onToggleAsMe,
  onSend,
  onStop,
  onTyping,
  onToggleSources,
}: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView();
  }, [session.messages.length]);

  return (
    <section className="flex-1 min-w-0 flex flex-col bg-white">
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
                  <div className="max-w-[75%] flex flex-col">
                    <div
                      className={`px-4 py-2.5 rounded-2xl whitespace-pre-wrap leading-relaxed ${
                        isUser
                          ? "bg-accent text-white rounded-br-md"
                          : m.error
                          ? "bg-red-50 text-red-700 rounded-bl-md"
                          : "bg-bg text-ink rounded-bl-md"
                      }`}
                    >
                      {m.text || "Thinking..."}
                    </div>
                    {!isUser && m.source && m.source !== "general" && (
                      <span className="mt-1.5 ml-1 self-start px-2 py-0.5 text-xs rounded-full border border-line text-muted">
                        {sourceLabel[m.source]}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div ref={endRef} />
      </div>

      {preview && (
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
        onToggleTone={onToggleTone}
        onToggleAsMe={onToggleAsMe}
      />
    </section>
  );
}