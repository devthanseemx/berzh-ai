import { useEffect, useRef } from "react";
import { PanelRight } from "lucide-react";
import type { Session } from "../types";
import Composer from "./Composer";

const sourceLabel = {
  documents: "From documents",
  web: "From web",
  general: "General knowledge",
} as const;

interface Props {
  session: Session;
  onSend: (text: string) => void;
  onToggleSources: () => void;
}

export default function ChatView({ session, onSend, onToggleSources }: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView();
  }, [session.messages.length]);

  return (
    <section className="flex-1 min-w-0 flex flex-col">
      <header className="h-12 px-5 flex items-center justify-between bg-panel border-b border-line">
        <span className="font-medium truncate">{session.title}</span>
        <button
          onClick={onToggleSources}
          title="Toggle sources"
          className="p-1.5 border border-transparent hover:border-line hover:bg-bg"
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
          session.messages.map((m) => (
            <div key={m.id} className="border-b border-line px-6 py-4">
              <div className="max-w-3xl mx-auto">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted mb-1">
                  {m.role === "user" ? "You" : "Berzh AI"}
                </div>
                <div className="whitespace-pre-wrap leading-relaxed">{m.text}</div>
                {m.source && (
                  <span className="inline-block mt-2 px-2 py-0.5 text-xs border border-line text-muted">
                    {sourceLabel[m.source]}
                  </span>
                )}
              </div>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      <Composer onSend={onSend} />
    </section>
  );
}