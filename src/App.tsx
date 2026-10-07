import { useState } from "react";
import Sidebar from "./components/Sidebar";
import ChatView from "./components/ChatView";
import SourcesPanel from "./components/SourcesPanel";
import StatusBar from "./components/StatusBar";
import type { Doc, Message, Session } from "./types";

const newSession = (): Session => ({
  id: crypto.randomUUID(),
  title: "New chat",
  messages: [],
  docs: [],
});

export default function App() {
  const [sessions, setSessions] = useState<Session[]>(() => [newSession()]);
  const [activeId, setActiveId] = useState(() => sessions[0].id);
  const [sourcesOpen, setSourcesOpen] = useState(true);

  const active = sessions.find((s) => s.id === activeId) ?? sessions[0];

  const addSession = () => {
    const s = newSession();
    setSessions((prev) => [s, ...prev]);
    setActiveId(s.id);
  };

  const send = (text: string) => {
    const userMsg: Message = { id: crypto.randomUUID(), role: "user", text };
    const botMsg: Message = {
      id: crypto.randomUUID(),
      role: "assistant",
      text: "Placeholder reply. The AI connection comes in the next step.",
      source: "general",
    };
    setSessions((prev) =>
      prev.map((s) =>
        s.id !== active.id
          ? s
          : {
              ...s,
              title: s.messages.length === 0 ? text.slice(0, 32) : s.title,
              messages: [...s.messages, userMsg, botMsg],
            }
      )
    );
  };

  const addDocs = (docs: Doc[]) =>
    setSessions((prev) =>
      prev.map((s) =>
        s.id !== active.id
          ? s
          : {
              ...s,
              docs: [
                ...s.docs,
                ...docs.filter((d) => !s.docs.some((x) => x.path === d.path)),
              ],
            }
      )
    );

  const removeDoc = (id: string) =>
    setSessions((prev) =>
      prev.map((s) =>
        s.id !== active.id ? s : { ...s, docs: s.docs.filter((d) => d.id !== id) }
      )
    );

  return (
    <div className="h-screen flex flex-col">
      <div className="flex flex-1 min-h-0">
        <Sidebar
          sessions={sessions}
          activeId={active.id}
          onSelect={setActiveId}
          onNew={addSession}
        />
        <ChatView
          session={active}
          onSend={send}
          onToggleSources={() => setSourcesOpen((o) => !o)}
        />
        {sourcesOpen && (
          <SourcesPanel docs={active.docs} onAdd={addDocs} onRemove={removeDoc} />
        )}
      </div>
      <StatusBar />
    </div>
  );
}