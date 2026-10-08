import { useEffect, useRef, useState } from "react";
import Sidebar from "./components/Sidebar";
import ChatView from "./components/ChatView";
import SourcesPanel from "./components/SourcesPanel";
import SettingsDialog from "./components/SettingsDialog";
import ConfirmDialog from "./components/ConfirmDialog";
import * as db from "./db";
import { streamChat, ConfigError } from "./llm";
import {
  startDraft,
  draftMatches,
  followDraft,
  MIN_CHARS,
  DEBOUNCE_MS,
  type Draft,
} from "./live";
import { DEFAULT_SETTINGS, type Settings } from "./settings";
import type { Doc, Message, Preview, Session } from "./types";

const persist = (p: Promise<unknown>) =>
  p.catch((e) => console.error("DB error:", e));

const TITLE_SYSTEM = "You write very short chat titles.";

const cleanTitle = (raw: string) =>
  raw
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0)
    ?.replace(/^["'“”‘’`*#\s]+|["'“”‘’`*#.\s]+$/g, "")
    .slice(0, 40) ?? "";

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
  const [preview, setPreview] = useState<Preview | null>(null);

  const controllers = useRef(new Map<string, AbortController>());
  const deleted = useRef(new Set<string>());
  const draftRef = useRef<Draft | null>(null);
  const typingTimer = useRef<number | undefined>(undefined);
  const lastTyped = useRef("");

  // Always-fresh copies for timers and callbacks
  const sessionsRef = useRef<Session[]>([]);
  sessionsRef.current = sessions;
  const settingsRef = useRef<Settings>(settings);
  settingsRef.current = settings;
  const activeIdRef = useRef("");
  activeIdRef.current = activeId;

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

  /* ---------- live drafting ---------- */

  const discardDraft = () => {
    window.clearTimeout(typingTimer.current);
    draftRef.current?.controller.abort();
    draftRef.current = null;
    setPreview(null);
  };

  const onTyping = (text: string) => {
    lastTyped.current = text;
    window.clearTimeout(typingTimer.current);
    const typed = text.trim();
    if (typed.length < MIN_CHARS) {
      discardDraft();
      return;
    }

    // the visible preview is now out of date until the next draft starts
    setPreview((p) => (p && !p.stale ? { ...p, stale: true } : p));

    typingTimer.current = window.setTimeout(() => {
      if (!settingsRef.current.liveDraft) return;

      const sid = activeIdRef.current;
      const session = sessionsRef.current.find((s) => s.id === sid);
      if (!session || controllers.current.has(sid)) return;

      const prev = draftRef.current;
      if (prev && prev.sessionId === sid && prev.typed === typed && !prev.error) {
        setPreview((p) => (p ? { ...p, stale: false } : p));
        return;
      }

      discardDraft();

      const d: Draft = startDraft(settingsRef.current, session, typed, () => {
        if (draftRef.current !== d) return; // an older draft: ignore
        setPreview({
          predicted: d.predicted,
          answer: d.answer,
          done: d.done,
          error: !!d.error,
          stale: false,
        });
      });
      draftRef.current = d;
      setPreview({
        predicted: "",
        answer: "",
        done: false,
        error: false,
        stale: false,
      });
    }, DEBOUNCE_MS);
  };

  /** Redo the preview for whatever is currently typed (after a setting changed). */
  const refreshDraft = () => {
    discardDraft();
    if (lastTyped.current.trim().length >= MIN_CHARS) onTyping(lastTyped.current);
  };

  /* ---------- sessions ---------- */

  const selectSession = (id: string) => {
    discardDraft();
    setActiveId(id);
  };

  const addSession = () => {
    discardDraft();
    const s = db.newSession();
    setSessions((prev) => [s, ...prev]);
    setActiveId(s.id);
    persist(db.insertSession(s));
  };

  const removeSession = (id: string) => {
    discardDraft();
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

  /* ---------- titles ---------- */

  const generateTitle = async (sessionId: string, text: string) => {
    const prompt =
      `Write a title of 2 to 5 words that summarizes this message. ` +
      `Use the same language as the message. ` +
      `Reply with only the title, no quotes and no punctuation at the end.\n\n` +
      `Message: ${text.slice(0, 500)}`;

    try {
      let out = "";
      await streamChat(
        settingsRef.current,
        [{ id: "title", role: "user", text: prompt }],
        (t) => {
          out += t;
        },
        new AbortController().signal,
        { live: true, maxTurns: 1, system: TITLE_SYSTEM }
      );
      const title = cleanTitle(out);
      if (title && !deleted.current.has(sessionId)) {
        patchSession(sessionId, (s) => ({ ...s, title }));
        persist(db.updateTitle(sessionId, title));
      }
    } catch {
      /* keep the temporary title */
    }
  };

  /* ---------- sending ---------- */

  const send = async (text: string) => {
    if (!active || controllers.current.has(active.id)) return;

    window.clearTimeout(typingTimer.current);
    lastTyped.current = "";
    const sessionId = active.id;

    // Use the background draft if it answers what was actually sent
    const draft = draftRef.current;
    draftRef.current = null;
    setPreview(null);
    const adopt = draft && draftMatches(draft, sessionId, text) ? draft : null;
    if (draft && !adopt) draft.controller.abort();

    const userMsg: Message = { id: crypto.randomUUID(), role: "user", text };
    const botId = crypto.randomUUID();
    const botMsg: Message = {
      id: botId,
      role: "assistant",
      text: "",
      source: "general",
    };
    const isFirst = active.messages.length === 0;
    const tempTitle = isFirst ? text.slice(0, 32) : active.title;
    const history = [...active.messages, userMsg];

    patchSession(sessionId, (s) => ({
      ...s,
      title: tempTitle,
      messages: [...s.messages, userMsg, botMsg],
    }));
    persist(db.insertMessages(sessionId, [userMsg]));
    if (isFirst) {
      persist(db.updateTitle(sessionId, tempTitle));
      generateTitle(sessionId, text); // replaces the temporary title when ready
    }

    const controller = new AbortController();
    controllers.current.set(sessionId, controller);
    setStreamingIds((p) => [...p, sessionId]);

    let reply = "";
    let failure: string | null = null;

    const show = (answer: string) => {
      reply = answer;
      patchMessage(sessionId, botId, { text: answer });
    };

    const runNormal = () =>
      streamChat(settings, history, (tok) => show(reply + tok), controller.signal);

    try {
      if (adopt) {
        await followDraft(adopt, show, controller.signal);
        if (!reply.trim() && !controller.signal.aborted) {
          await runNormal(); // draft failed: generate normally
        }
      } else {
        await runNormal();
      }
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

  /* ---------- documents & settings ---------- */

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
    refreshDraft(); // the preview may have been written in the old style
  };

  const toggleSetting = (key: "humanTone" | "answerAsMe") => {
    const next = {
      ...settingsRef.current,
      [key]: !settingsRef.current[key],
    } as Settings;
    setSettings(next);
    persist(db.saveSettings(next));
    refreshDraft();
  };

  if (!ready || !active) return <div className="h-screen bg-white" />;

  return (
    <div className="h-screen flex">
      <Sidebar
        sessions={sessions}
        activeId={active.id}
        onSelect={selectSession}
        onNew={addSession}
        onDelete={requestDelete}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <ChatView
        session={active}
        busy={busy}
        preview={preview}
        humanTone={settings.humanTone}
        answerAsMe={settings.answerAsMe}
        onToggleTone={() => toggleSetting("humanTone")}
        onToggleAsMe={() => toggleSetting("answerAsMe")}
        onSend={send}
        onStop={stop}
        onTyping={onTyping}
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