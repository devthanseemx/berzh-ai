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
import { extractText, chunkText } from "./docs";
import { searchDocs, invalidateIndex, type DocHit } from "./rag";
import { searchWeb, type WebHit } from "./web";
import { decideRoute } from "./router";
import { DEFAULT_SETTINGS, type Settings } from "./settings";
import type { Doc, Message, Preview, Ref, Session, Source } from "./types";

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

const isEmpty = (s: Session) => s.messages.length === 0 && s.docs.length === 0;

const webAvailable = (s: Settings) => s.webSearch && s.tavilyKey.trim().length > 0;

/** For short follow-ups ("and the second one?"), include the previous question. */
const retrievalQuery = (s: Session, text: string) => {
  const prevUser = [...s.messages].reverse().find((m) => m.role === "user");
  return prevUser && text.split(/\s+/).length < 5 ? `${prevUser.text} ${text}` : text;
};

const docHit = (s: Session, text: string): Promise<DocHit | null> =>
  s.docs.length === 0
    ? Promise.resolve(null)
    : searchDocs(s.id, retrievalQuery(s, text)).catch(() => null);

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
  const persisted = useRef(new Set<string>()); // sessions already saved in the database
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
        loaded.forEach((s) => persisted.current.add(s.id));
        const fresh = db.newSession();
        setSessions([fresh, ...loaded]);
        setActiveId(fresh.id);
      })
      .catch((e) => {
        console.error("Failed to load database:", e);
        const fresh = db.newSession();
        setSessions([fresh]);
        setActiveId(fresh.id);
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

  /** A chat is saved to the database only when something is added to it. */
  const ensurePersisted = async (sessionId: string, title: string) => {
    if (persisted.current.has(sessionId)) return;
    persisted.current.add(sessionId);
    try {
      await db.insertSession({ id: sessionId, title });
    } catch (e) {
      console.error("DB error:", e);
    }
  };

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

    typingTimer.current = window.setTimeout(async () => {
      if (!settingsRef.current.liveDraft) return;

      const sid = activeIdRef.current;
      const session = sessionsRef.current.find((s) => s.id === sid);
      if (!session || controllers.current.has(sid)) return;

      const prev = draftRef.current;
      if (prev && prev.sessionId === sid && prev.typed === typed && !prev.error) {
        setPreview((p) => (p ? { ...p, stale: false } : p));
        return;
      }

      const hit = await docHit(session, typed);
      // the user kept typing or switched chats while we searched
      if (lastTyped.current.trim() !== typed || activeIdRef.current !== sid) return;

      // questions that need the web are searched on Enter, never while typing
      const cfg = settingsRef.current;
      if (decideRoute(typed, hit, webAvailable(cfg), cfg.answerAsMe) === "web") {
        discardDraft();
        setPreview({
          predicted: "",
          answer: "",
          done: true,
          error: false,
          stale: false,
          docs: false,
          web: true,
        });
        return;
      }

      discardDraft();

      const d: Draft = startDraft(
        cfg,
        session,
        typed,
        () => {
          if (draftRef.current !== d) return; // an older draft: ignore
          setPreview({
            predicted: d.predicted,
            answer: d.answer,
            done: d.done,
            error: !!d.error,
            stale: false,
            docs: d.usedDocs,
            web: false,
          });
        },
        hit
      );
      draftRef.current = d;
      setPreview({
        predicted: "",
        answer: "",
        done: false,
        error: false,
        stale: false,
        docs: d.usedDocs,
        web: false,
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
    // reuse the empty chat instead of piling up new ones
    const existing = sessionsRef.current.find(isEmpty);
    if (existing) {
      setActiveId(existing.id);
      return;
    }
    const s = db.newSession();
    setSessions((prev) => [s, ...prev]);
    setActiveId(s.id);
  };

  const removeSession = (id: string) => {
    discardDraft();
    deleted.current.add(id);
    persisted.current.delete(id);
    controllers.current.get(id)?.abort(); // stop its reply if one is running
    invalidateIndex(id);
    persist(db.deleteSession(id));

    const remaining = sessionsRef.current.filter((s) => s.id !== id);
    if (remaining.length === 0) {
      const fresh = db.newSession();
      setSessions([fresh]);
      setActiveId(fresh.id);
      return;
    }
    setSessions((prev) => prev.filter((s) => s.id !== id));
    setActiveId((cur) => (cur === id ? remaining[0].id : cur));
  };

  const requestDelete = (id: string) => {
    const target = sessionsRef.current.find((s) => s.id === id);
    if (!target) return;

    if (isEmpty(target)) {
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

    // A background draft can be reused if it answers what was actually sent
    const draft = draftRef.current;
    draftRef.current = null;
    setPreview(null);
    const adoptable = draft && draftMatches(draft, sessionId, text) ? draft : null;
    if (draft && !adoptable) draft.controller.abort();

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

    // save the chat now that it has a conversation
    if (!persisted.current.has(sessionId)) {
      persist(ensurePersisted(sessionId, tempTitle));
    } else if (isFirst) {
      persist(db.updateTitle(sessionId, tempTitle));
    }
    persist(db.insertMessages(sessionId, [userMsg]));
    if (isFirst) generateTitle(sessionId, text); // replaces the temporary title when ready

    const controller = new AbortController();
    controllers.current.set(sessionId, controller);
    setStreamingIds((p) => [...p, sessionId]);

    let reply = "";
    let failure: string | null = null;
    let source: Source = "general";
    let refs: Ref[] | undefined;

    const show = (answer: string) => {
      reply = answer;
      patchMessage(sessionId, botId, { text: answer });
    };

    const stream = (opts: {
      context?: string;
      web?: string;
      webFailed?: boolean;
    }) => streamChat(settings, history, (tok) => show(reply + tok), controller.signal, opts);

    try {
      const session = sessionsRef.current.find((s) => s.id === sessionId) ?? active;
      const hit = await docHit(session, text);
      const route = decideRoute(text, hit, webAvailable(settings), settings.answerAsMe);

      if (route === "web") {
        adoptable?.controller.abort(); // a draft without web results would be out of date
        patchMessage(sessionId, botId, { status: "Searching the web..." });

        let web: WebHit | null = null;
        let webFailed = false;
        try {
          web = await searchWeb(
            settings.tavilyKey,
            retrievalQuery(session, text),
            controller.signal
          );
          if (!web) webFailed = true;
        } catch (e) {
          if (controller.signal.aborted || e instanceof ConfigError) throw e;
          webFailed = true;
        }

        if (web) {
          source = "web";
          refs = web.refs;
        }
        patchMessage(sessionId, botId, { status: undefined, source, refs });
        await stream({ context: hit?.context, web: web?.context, webFailed });
      } else if (adoptable) {
        source = adoptable.usedDocs ? "documents" : "general";
        patchMessage(sessionId, botId, { source });
        await followDraft(adoptable, show, controller.signal);
        if (!reply.trim() && !controller.signal.aborted) {
          source = hit?.relevant ? "documents" : "general"; // draft failed: generate normally
          patchMessage(sessionId, botId, { source });
          await stream({ context: hit?.context });
        }
      } else {
        source = hit?.relevant ? "documents" : "general";
        patchMessage(sessionId, botId, { source });
        await stream({ context: hit?.context });
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
      persist(db.insertMessages(sessionId, [{ ...botMsg, text: reply, source, refs }]));
    } else if (failure) {
      patchMessage(sessionId, botId, {
        text: failure,
        error: true,
        source: undefined,
        refs: undefined,
        status: undefined,
      });
    } else {
      removeMessage(sessionId, botId); // stopped before any text arrived
    }
  };

  const stop = () => {
    if (active) controllers.current.get(active.id)?.abort();
  };

  /* ---------- documents ---------- */

  const uploadFiles = async (files: File[]): Promise<string | null> => {
    const sessionId = active.id;
    const errors: string[] = [];

    for (const file of files) {
      const key = `${file.name}:${file.size}`;
      const current = sessionsRef.current.find((s) => s.id === sessionId);
      if (current?.docs.some((d) => d.path === key)) continue; // already added

      try {
        const text = await extractText(file);
        const chunks = chunkText(text);
        if (chunks.length === 0) {
          throw new Error("no readable text found (a scanned PDF?)");
        }
        const doc: Doc = { id: crypto.randomUUID(), name: file.name, path: key };

        await ensurePersisted(sessionId, current?.title ?? "New chat");
        await db.insertDoc(sessionId, doc, chunks);
        invalidateIndex(sessionId);
        patchSession(sessionId, (s) => ({ ...s, docs: [...s.docs, doc] }));
      } catch (e) {
        errors.push(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    refreshDraft(); // the preview may now use the new documents
    return errors.length > 0 ? errors.join("\n") : null;
  };

  const removeDoc = (id: string) => {
    patchSession(active.id, (s) => ({
      ...s,
      docs: s.docs.filter((d) => d.id !== id),
    }));
    invalidateIndex(active.id);
    persist(db.deleteDoc(id));
    refreshDraft();
  };

  /* ---------- settings ---------- */

  const saveSettings = (s: Settings) => {
    setSettings(s);
    persist(db.saveSettings(s));
    refreshDraft(); // the preview may have been written in the old style
  };

  const toggleSetting = (key: "humanTone" | "answerAsMe" | "webSearch") => {
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
        webSearch={settings.webSearch}
        onToggleTone={() => toggleSetting("humanTone")}
        onToggleAsMe={() => toggleSetting("answerAsMe")}
        onToggleWeb={() => toggleSetting("webSearch")}
        onSend={send}
        onStop={stop}
        onTyping={onTyping}
        onToggleSources={() => setSourcesOpen((o) => !o)}
      />
      {sourcesOpen && (
        <SourcesPanel docs={active.docs} onUpload={uploadFiles} onRemove={removeDoc} />
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