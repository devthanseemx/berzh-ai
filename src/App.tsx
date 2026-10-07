import { useEffect, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import Sidebar from "./components/Sidebar";
import ChatView from "./components/ChatView";
import SourcesPanel from "./components/SourcesPanel";
import * as db from "./db";
import type { Doc, Message, Session } from "./types";

const persist = (p: Promise<unknown>) =>
  p.catch((e) => console.error("DB error:", e));

export default function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState("");
  const [ready, setReady] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(true);

  useEffect(() => {
    db.initSessions()
      .then((loaded) => {
        setSessions(loaded);
        setActiveId(loaded[0].id);
      })
      .catch((e) => {
        console.error("Failed to load database:", e);
        const s = db.newSession();
        setSessions([s]);
        setActiveId(s.id);
      })
      .finally(() => setReady(true));
  }, []);

  const active = sessions.find((s) => s.id === activeId) ?? sessions[0];

  const addSession = () => {
    const s = db.newSession();
    setSessions((prev) => [s, ...prev]);
    setActiveId(s.id);
    persist(db.insertSession(s));
  };

  const deleteSession = async (id: string) => {
    const target = sessions.find((s) => s.id === id);
    if (!target) return;

    if (target.messages.length > 0 || target.docs.length > 0) {
      const ok = await ask(`Delete "${target.title}"?`, {
        title: "Berzh AI",
        kind: "warning",
      });
      if (!ok) return;
    }

    persist(db.deleteSession(id));
    const remaining = sessions.filter((s) => s.id !== id);
    if (remaining.length === 0) {
      const fresh = db.newSession();
      setSessions([fresh]);
      setActiveId(fresh.id);
      persist(db.insertSession(fresh));
      return;
    }
    setSessions(remaining);
    if (id === activeId) setActiveId(remaining[0].id);
  };

  const send = (text: string) => {
    const userMsg: Message = { id: crypto.randomUUID(), role: "user", text };
    const botMsg: Message = {
      id: crypto.randomUUID(),
      role: "assistant",
      text: "Placeholder reply. The AI connection comes in the next step.",
      source: "general",
    };
    const isFirst = active.messages.length === 0;
    const title = isFirst ? text.slice(0, 32) : active.title;

    setSessions((prev) =>
      prev.map((s) =>
        s.id !== active.id
          ? s
          : { ...s, title, messages: [...s.messages, userMsg, botMsg] }
      )
    );
    if (isFirst) persist(db.updateTitle(active.id, title));
    persist(db.insertMessages(active.id, [userMsg, botMsg]));
  };

  const addDocs = (docs: Doc[]) => {
    const fresh = docs.filter((d) => !active.docs.some((x) => x.path === d.path));
    if (fresh.length === 0) return;
    setSessions((prev) =>
      prev.map((s) =>
        s.id !== active.id ? s : { ...s, docs: [...s.docs, ...fresh] }
      )
    );
    persist(db.insertDocs(active.id, fresh));
  };

  const removeDoc = (id: string) => {
    setSessions((prev) =>
      prev.map((s) =>
        s.id !== active.id ? s : { ...s, docs: s.docs.filter((d) => d.id !== id) }
      )
    );
    persist(db.deleteDoc(id));
  };

  if (!ready) return <div className="h-screen bg-white" />;

  return (
    <div className="h-screen flex">
      <Sidebar
        sessions={sessions}
        activeId={active.id}
        onSelect={setActiveId}
        onNew={addSession}
        onDelete={deleteSession}
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
  );
}