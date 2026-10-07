import { useEffect, useRef, useState } from "react";
import Sidebar from "./components/Sidebar";
import ChatView from "./components/ChatView";
import SourcesPanel from "./components/SourcesPanel";
import SettingsDialog from "./components/SettingsDialog";
import ConfirmDialog from "./components/ConfirmDialog";
import * as db from "./db";
import { streamChat, ConfigError } from "./llm";
import { DEFAULT_SETTINGS, type Settings } from "./settings";
import type { Doc, Message, Session } from "./types";

const persist = (p: Promise<unknown>) =>
  p.catch((e) => console.error("DB error:", e));

interface ConfirmState {
  title: string;
  message: string;
  onConfirm: () => void;
}

export default function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState("");
  const [ready, setReady] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(true);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [streamingIds, setStreamingIds] = useState<string[]>([]);

  const controllers = useRef(new Map<string, AbortController>());
  const deleted = useRef(new Set<string>());
  const sessionsRef = useRef<Session[]>([]);
  sessionsRef.current = sessions;

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

    db.loadSettings()
      .then(setSettings)
      .catch((e) => console.error("Failed to load settings:", e));
  }, []);

  const active = sessions.find((s) => s.id === activeId) ?? sessions[0];
  const busy = !!active && streamingIds.includes(active.id);

  const patchSession = (id: string, fn: (s: Session) => Session) =>
    setSessions((prev) => prev.map((s) => (s.id === id ? fn(s) : s)));

  const patchMessage = (sid: string, mid: string, patch: Partial<Message>) =>
    patchSession(sid, (s) => ({
      ...s,
      messages: s.messages.map((m) => (m.id === mid ? { ...m, ...patch } : m)),
    }));

  const removeMessage = (sid: string, mid: string) =>
    patchSession(sid, (s) => ({
      ...s,
      messages: s.messages.filter((m) => m.id !== mid),
    }));

  const addSession = () => {
    const s = db.newSession();
    setSessions((prev) => [s, ...prev]);
    setActiveId(s.id);
    persist(db.insertSession(s));
  };

  const removeSession = (id: string) => {
    deleted.current.add(id);
    controllers.current.get(id)?.abort(); // stop its reply if one is running
    persist(db.deleteSession(id));

    const remaining = sessionsRef.current.filter((s) => s.id !== id);
    if (remaining.length === 0) {
      const fresh = db.newSession();
      setSessions([fresh]);
      setActiveId(fresh.id);
      persist(db.insertSession(fresh));
      return;
    }
    setSessions((prev) => prev.filter((s) => s.id !== id));
    setActiveId((cur) => (cur === id ? remaining[0].id : cur));
  };

  const requestDelete = (id: string) => {
    const target = sessionsRef.current.find((s) => s.id === id);
    if (!target) return;

    if (target.messages.length === 0 && target.docs.length === 0) {
      removeSession(id);
      return;
    }
    setConfirm({
      title: "Delete chat?",
      message: `"${target.title}" and its messages will be permanently deleted.`,
      onConfirm: () => {
        setConfirm(null);
        removeSession(id);
      },
    });
  };

  const send = async (text: string) => {
    if (!active || controllers.current.has(active.id)) return;

    const sessionId = active.id;
    const userMsg: Message = { id: crypto.randomUUID(), role: "user", text };
    const botId = crypto.randomUUID();
    const botMsg: Message = {
      id: botId,
      role: "assistant",
      text: "",
      source: "general",
    };
    const isFirst = active.messages.length === 0;
    const title = isFirst ? text.slice(0, 32) : active.title;
    const history = [...active.messages, userMsg];

    patchSession(sessionId, (s) => ({
      ...s,
      title,
      messages: [...s.messages, userMsg, botMsg],
    }));
    persist(db.insertMessages(sessionId, [userMsg]));
    if (isFirst) persist(db.updateTitle(sessionId, title));

    const controller = new AbortController();
    controllers.current.set(sessionId, controller);
    setStreamingIds((p) => [...p, sessionId]);

    let reply = "";
    let failure: string | null = null;

    try {
      await streamChat(
        settings,
        history,
        (token) => {
          reply += token;
          patchMessage(sessionId, botId, { text: reply });
        },
        controller.signal
      );
    } catch (e) {
      if (!controller.signal.aborted) {
        failure = e instanceof Error ? e.message : String(e);
        if (e instanceof ConfigError) setSettingsOpen(true);
      }
    } finally {
      controllers.current.delete(sessionId);
      setStreamingIds((p) => p.filter((x) => x !== sessionId));
    }

    if (deleted.current.has(sessionId)) return; // chat was deleted meanwhile

    if (reply.trim()) {
      persist(db.insertMessages(sessionId, [{ ...botMsg, text: reply }]));
    } else if (failure) {
      patchMessage(sessionId, botId, {
        text: failure,
        error: true,
        source: undefined,
      });
    } else {
      removeMessage(sessionId, botId); // stopped before any text arrived
    }
  };

  const stop = () => {
    if (active) controllers.current.get(active.id)?.abort();
  };

  const addDocs = (docs: Doc[]) => {
    const fresh = docs.filter((d) => !active.docs.some((x) => x.path === d.path));
    if (fresh.length === 0) return;
    patchSession(active.id, (s) => ({ ...s, docs: [...s.docs, ...fresh] }));
    persist(db.insertDocs(active.id, fresh));
  };

  const removeDoc = (id: string) => {
    patchSession(active.id, (s) => ({
      ...s,
      docs: s.docs.filter((d) => d.id !== id),
    }));
    persist(db.deleteDoc(id));
  };

  const saveSettings = (s: Settings) => {
    setSettings(s);
    persist(db.saveSettings(s));
  };

  if (!ready || !active) return <div className="h-screen bg-white" />;

  return (
    <div className="h-screen flex">
      <Sidebar
        sessions={sessions}
        activeId={active.id}
        onSelect={setActiveId}
        onNew={addSession}
        onDelete={requestDelete}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <ChatView
        session={active}
        busy={busy}
        onSend={send}
        onStop={stop}
        onToggleSources={() => setSourcesOpen((o) => !o)}
      />
      {sourcesOpen && (
        <SourcesPanel docs={active.docs} onAdd={addDocs} onRemove={removeDoc} />
      )}
      {settingsOpen && (
        <SettingsDialog
          settings={settings}
          onSave={saveSettings}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          confirmLabel="Delete"
          danger
          onConfirm={confirm.onConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}