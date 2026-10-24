import { useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import type { Update } from "@tauri-apps/plugin-updater";
import RecentsPanel, { ActivityRail } from "./components/Sidebar";
import { ArrowLeft, ArrowRight, Minus, PanelLeftClose, PanelLeftOpen, Square, X, type LucideIcon } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import ChatView from "./components/ChatView";
import SettingsDialog, { type SettingsTab } from "./components/SettingsDialog";
import { Toaster, toast } from "sonner";
import ConfirmDialog from "./components/ConfirmDialog";
import UpdateBanner from "./components/UpdateBanner";
import Splash, { type Step, type StepState } from "./components/Splash";
import * as db from "./db";
import { streamChat, ConfigError } from "./llm";
import { startDraft, draftMatches, followDraft, MIN_CHARS, DEBOUNCE_MS, type Draft, } from "./live";
import { extractText, chunkText } from "./docs";
import { searchDocs, invalidateIndex, type DocHit } from "./rag";
import { searchWeb, type WebHit } from "./web";
import { decideRoute } from "./router";
import { ensureOmniRoute } from "./startup";
import { checkForUpdate, installUpdate, type UpdateUi } from "./updater";
import { startVoice, describeMicError, type VoiceSession, type VoiceState, } from "./voice";
import { DEFAULT_SETTINGS, type Settings } from "./settings";
import type { Doc, Message, Preview, Ref, Session, Source } from "./types";

const persist = (p: Promise<unknown>) =>
  p.catch((e) => console.error("DB error:", e));

const TITLE_SYSTEM = "You write very short chat titles.";

// an answer that admits its knowledge is stale means the web search should have run
const STALE_ANSWER =
  /\b(knowledge cutoff|knowledge may be|out of date|outdated|may not (be )?(current|up.to.date|accurate)|check the (latest|current)|as of my last|don'?t have (access to )?(the )?(latest|current|real.time)|no real.time (access|information)|cannot (browse|access the internet)|unable to (browse|access))/i;

const cleanTitle = (raw: string) =>
  raw
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0)
    ?.replace(/^["'“”‘’`*#\s]+|["'“”‘’`*#.\s]+$/g, "")
    .slice(0, 40) ?? "";

const isEmpty = (s: Session) => s.messages.length === 0 && s.docs.length === 0;

// the stale-answer fallback only re-searches when web is on AND a key exists
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

/** The document files that actually shaped the answer, as source pills. */
const docRefs = (hit: DocHit | null): Ref[] | undefined =>
  hit?.relevant && hit.files.length > 0
    ? hit.files.map((f) => ({ title: f, url: "", kind: "doc" as const }))
    : undefined;

/** The same question, typed a little longer or shorter, still matches. */
const similarQ = (a: string, b: string) => {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  return !!x && !!y && (x === y || x.startsWith(y) || y.startsWith(x));
};

const VOICE_DELAY = 300; // pause before drafting while speaking (ms)

interface ConfirmState {
  title: string;
  message: string;
  onConfirm: () => void;
}

/** Uniform icon button for the chat header (back / forward / new chat / help). */
function HeaderBtn({
  icon: Icon,
  title,
  onClick,
  disabled = false,
}: {
  icon: LucideIcon;
  title: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className="p-2 rounded-md text-muted hover:text-ink hover:bg-bg disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted transition-colors"
    >
      <Icon size={18} />
    </button>
  );
}

export default function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState("");
  const [sourcesOpen, setSourcesOpen] = useState(true);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("connection");
  // bumps on every Profile click so the dialog re-jumps even if the tab prop is unchanged
  const [accountPulse, setAccountPulse] = useState(0);

  // apply the light/dark theme to the document
  useEffect(() => {
    document.documentElement.classList.toggle("dark", settings.theme === "dark");
  }, [settings.theme]);

  // Windows caches the exe icon - set it at runtime too so the taskbar always
  // shows the app icon
  useEffect(() => {
    void (async () => {
      try {
        const { join, resourceDir } = await import("@tauri-apps/api/path");
        await appWindow?.setIcon(
          await join(await resourceDir(), "icons", "icon.ico")
        );
      } catch (e) {
        console.warn("Could not set window icon:", e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // instant theme switch (from the rail or settings) - saved immediately, no Save button needed
  const toggleTheme = () => {
    const next = {
      ...settingsRef.current,
      theme: settingsRef.current.theme === "dark" ? "light" : "dark",
    } as Settings;
    setSettings(next);
    persist(db.saveSettings(next));
  };
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [streamingIds, setStreamingIds] = useState<string[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [voice, setVoice] = useState<VoiceState | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [voicePaused, setVoicePaused] = useState(false);
  const voicePausedRef = useRef(false);

  // voice typing: the mic in the text box turns speech into text
  const [dictating, setDictating] = useState(false);
  const [dictText, setDictText] = useState("");

  // startup (loading screen)
  const [bootDone, setBootDone] = useState(false);
  // a non-fatal startup problem (e.g. OmniRoute did not start) - announced as
  // a toast once the home screen appears; boot always continues
  const [bootNotice, setBootNotice] = useState<string | null>(null);
  const [, setSteps] = useState<Step[]>([
    { id: "data", label: "Loading your chats and settings", state: "pending" },
    { id: "server", label: "Starting OmniRoute", state: "pending" },
    { id: "interface", label: "Opening Berzh AI", state: "pending" },
  ]);
  const bootStarted = useRef(false);
  const bootSettings = useRef<Settings>(DEFAULT_SETTINGS);

  const controllers = useRef(new Map<string, AbortController>());
  const deleted = useRef(new Set<string>());
  const persisted = useRef(new Set<string>()); // sessions already saved in the database
  const draftRef = useRef<Draft | null>(null);
  // the last web search, so the same question is never searched (or paid for) twice
  const webCache = useRef<{ sid: string; q: string; topic: string; hit: WebHit } | null>(null);
  const webInflight = useRef<{ sid: string; q: string; promise: Promise<WebHit | null> } | null>(null);
  const typingTimer = useRef<number | undefined>(undefined);
  const lastTyped = useRef("");
  const voiceRef = useRef<VoiceSession | null>(null);
  const dictSessionRef = useRef<VoiceSession | null>(null);
  const voiceGen = useRef(0);
  const dictCommit = useRef(""); // finished phrases of the running voice typing
  const dictOnRef = useRef(false); // voice typing is active
  const dictStopping = useRef(false);

  // Always-fresh copies for timers and callbacks
  const sessionsRef = useRef<Session[]>([]);
  sessionsRef.current = sessions;
  const settingsRef = useRef<Settings>(settings);
  settingsRef.current = settings;
  const activeIdRef = useRef("");
  activeIdRef.current = activeId;
  const voiceOnRef = useRef(false);
  voiceOnRef.current = voice !== null && voice.phase !== "error";
  const sendRef = useRef<(text: string) => Promise<void>>(async () => { });
  const onTypingRef = useRef<(text: string, delay?: number) => void>(() => { });

  /* ---------- startup ---------- */

  const setStep = (id: string, state: StepState, label?: string) =>
    setSteps((prev) =>
      prev.map((s) => (s.id === id ? { ...s, state, label: label ?? s.label } : s))
    );

  const runBoot = async (dataLoaded: boolean) => {
    if (!dataLoaded) {
      setStep("data", "active");
      const [cfg, loaded] = await Promise.all([
        db.loadSettings().catch((e) => {
          console.error("Failed to load settings:", e);
          return DEFAULT_SETTINGS;
        }),
        db.initSessions().catch((e) => {
          console.error("Failed to load database:", e);
          return [] as Session[];
        }),
      ]);
      loaded.forEach((s) => persisted.current.add(s.id));
      const fresh = db.newSession();
      bootSettings.current = cfg;
      setSettings(cfg);
      setSessions([fresh, ...loaded]);
      setActiveId(fresh.id);
      setStep("data", "done");
    }

    if (bootSettings.current.llmProvider === "gemini") {
      setStep("server", "skipped", "Using the Gemini API - no local server needed");
    } else {
      setStep("server", "active");
      try {
        const result = await ensureOmniRoute(bootSettings.current, (secs) =>
          setStep("server", "active", `Starting OmniRoute (${secs}s)...`)
        );
        setStep(
          "server",
          result === "skipped" ? "skipped" : "done",
          result === "already-running"
            ? "OmniRoute is already running"
            : result === "started"
              ? "OmniRoute is ready"
              : "OmniRoute auto-start is off"
        );
      } catch (e) {
        // not fatal: keep loading into the app and report it as a toast there
        setStep("server", "skipped", "OmniRoute is not running");
        setBootNotice(e instanceof Error ? e.message : String(e));
      }
    }

    setStep("interface", "active");
    await new Promise((r) => setTimeout(r, 350));
    setStep("interface", "done");
    await new Promise((r) => setTimeout(r, 200));
    setBootDone(true);
  };

  useEffect(() => {
    if (!bootStarted.current) {
      bootStarted.current = true;
      void runBoot(false);
    }
    return () => {
      void voiceRef.current?.stop().catch((e) => console.error("Could not stop voice session:", e));
      void dictSessionRef.current?.stop().catch((e) => console.error("Could not stop dictation:", e));
    };
  }, []);

  /* ---------- version & updates ---------- */

  const [version, setVersion] = useState("");
  const [upd, setUpd] = useState<UpdateUi>({ status: "idle" });
  const [bannerOpen, setBannerOpen] = useState(true);
  const updateRef = useRef<Update | null>(null);
  const updStatusRef = useRef(upd.status);
  updStatusRef.current = upd.status;

  const checkUpdates = async (manual: boolean) => {
    const s = updStatusRef.current;
    if (s === "checking" || s === "downloading" || s === "installing") return;

    const began = Date.now();
    // keep "Checking..." visible for a moment so the result doesn't flash by
    const settle = async () => {
      const left = 700 - (Date.now() - began);
      if (manual && left > 0) await new Promise((r) => setTimeout(r, left));
    };

    setUpd((u) => ({ ...u, status: "checking", error: undefined }));
    try {
      const update = await checkForUpdate();
      await settle();
      if (update) {
        updateRef.current = update;
        setUpd({ status: "available", version: update.version, notes: update.body ?? "" });
        setBannerOpen(true);
      } else {
        updateRef.current = null;
        setUpd({ status: "uptodate" });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("Update check:", msg);
      await settle();

      // no release has been published yet, so nothing newer exists
      if (/valid release json/i.test(msg)) {
        updateRef.current = null;
        setUpd({ status: "uptodate" });
        return;
      }

      const known = updateRef.current;
      if (manual) {
        setUpd({
          status: "error",
          error: "Could not check for updates. Check your internet connection and try again.",
        });
      } else {
        setUpd(
          known
            ? { status: "available", version: known.version, notes: known.body ?? "" }
            : { status: "idle" }
        );
      }
    }
  };

  const installNow = async () => {
    const update = updateRef.current;
    if (!update) return;
    setUpd((u) => ({ ...u, status: "downloading", progress: 0, error: undefined }));
    try {
      void voiceRef.current?.stop().catch((e) => console.error("Could not stop voice session:", e));
      await installUpdate(update, (p) =>
        setUpd((u) => ({ ...u, status: "downloading", progress: p ?? undefined }))
      );
      setUpd((u) => ({ ...u, status: "installing" }));
    } catch (e) {
      setUpd((u) => ({
        ...u,
        status: "error",
        error: e instanceof Error ? e.message : String(e),
      }));
    }
  };

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => { });
  }, []);

  // check shortly after the app opens, then every 6 hours
  useEffect(() => {
    if (!bootDone) return;
    const first = window.setTimeout(() => void checkUpdates(false), 3000);
    const every = window.setInterval(() => void checkUpdates(false), 6 * 60 * 60 * 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(every);
    };
  }, [bootDone]);

  // a failed OmniRoute start is announced after the home screen is up
  useEffect(() => {
    if (bootDone && bootNotice) {
      toast.error("OmniRoute did not start", { description: bootNotice });
      setBootNotice(null);
    }
  }, [bootDone, bootNotice]);

  const updateAvailable =
    upd.status === "available" || upd.status === "downloading" || upd.status === "installing";
  const showBanner =
    bannerOpen && (updateAvailable || (upd.status === "error" && !!updateRef.current));

  /* ---------- helpers ---------- */

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

  /** Search once per question. The result is cached and in-flight searches are
   * joined, so pausing while typing (or the draft + the sent question) all
   * share one 1-credit search instead of paying for several. */
  const searchOnce = async (sessionId: string, query: string): Promise<WebHit | null> => {
    const cfg = settingsRef.current;
    const cached = webCache.current;
    if (
      cached &&
      cached.sid === sessionId &&
      cached.topic === cfg.tavilyTopic &&
      similarQ(cached.q, query)
    ) {
      return cached.hit;
    }
    // a nearly identical question is already searching: wait for it, do not
    // pay for a second request (the credit is spent the moment it is sent)
    const inflight = webInflight.current;
    if (inflight && inflight.sid === sessionId && similarQ(inflight.q, query)) {
      return inflight.promise;
    }

    // never aborted on purpose: an abandoned search still lands in the cache
    // and is reused when the question is finally sent
    const signal = new AbortController().signal;
    const job = searchWeb(cfg.tavilyKey, query, { topic: cfg.tavilyTopic }, signal).then(
      (hit) => {
        if (hit) webCache.current = { sid: sessionId, q: query, topic: cfg.tavilyTopic, hit };
        return hit;
      }
    );
    webInflight.current = { sid: sessionId, q: query, promise: job };
    try {
      return await job;
    } finally {
      if (webInflight.current?.promise === job) webInflight.current = null;
    }
  };

  const onTyping = (text: string, delay: number = DEBOUNCE_MS) => {
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
      // by voice you may already ask the next question while the last answer is still being written
      if (!session || (controllers.current.has(sid) && !voiceOnRef.current)) return;

      const prev = draftRef.current;
      if (prev && prev.sessionId === sid && prev.typed === typed && !prev.error) {
        setPreview((p) => (p ? { ...p, stale: false } : p));
        return;
      }

      const hit = await docHit(session, typed);
      // the user kept typing or switched chats while we searched
      if (lastTyped.current.trim() !== typed || activeIdRef.current !== sid) return;

      // questions that need the web search automatically (1 credit, cached) -
      // no "press Enter" step; the same result is reused when the question is sent
      const cfg = settingsRef.current;
      const needsWeb =
        decideRoute(typed, hit, cfg.webSearch, cfg.answerAsMe) === "web";

      discardDraft();

      const beginDraft = (webCtx?: string, webFailed?: boolean) => {
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
              webFailed: !!webFailed,
            });
          },
          hit,
          webCtx,
          webFailed
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
          webFailed: !!webFailed,
        });
      };

      if (!needsWeb) {
        beginDraft();
        return;
      }

      // this question needs current information: run the search now, once
      setPreview({
        predicted: "",
        answer: "",
        done: false,
        error: false,
        stale: false,
        docs: !!hit?.relevant,
        web: true,
      });

      let web: WebHit | null = null;
      let webFailed = false;
      try {
        web = await searchOnce(sid, retrievalQuery(session, typed));
        if (!web) webFailed = true;
      } catch {
        webFailed = true; // send() surfaces the real error (e.g. a bad key)
      }
      // the user kept typing or switched chats while we searched
      if (lastTyped.current.trim() !== typed || activeIdRef.current !== sid) return;
      beginDraft(web?.context, webFailed);
    }, delay);
  };
  onTypingRef.current = onTyping;

  /** Redo the preview for whatever is currently typed (after a setting changed). */
  const refreshDraft = () => {
    discardDraft();
    if (lastTyped.current.trim().length >= MIN_CHARS) onTyping(lastTyped.current);
  };

  /* ---------- chat history (back / forward) ---------- */

  const historyRef = useRef<string[]>([]);
  const histIdxRef = useRef(-1);
  const navSkipRef = useRef(false);
  const [nav, setNav] = useState({ back: false, forward: false });

  const syncNav = () =>
    setNav({
      back: histIdxRef.current > 0,
      forward:
        histIdxRef.current >= 0 &&
        histIdxRef.current < historyRef.current.length - 1,
    });

  const pushNav = (id: string) => {
    if (!id) return;
    if (historyRef.current[histIdxRef.current] === id) return;
    // a new visit drops anything that was ahead of us
    historyRef.current = [
      ...historyRef.current.slice(0, histIdxRef.current + 1),
      id,
    ];
    histIdxRef.current = historyRef.current.length - 1;
    syncNav();
  };

  const sessionExists = (id: string) =>
    sessionsRef.current.some((s) => s.id === id);

  // every real navigation (boot, new chat, picking a chat, delete fallback)
  // lands here; back/forward set navSkipRef so they are not recorded twice
  useEffect(() => {
    if (!activeId) return;
    if (navSkipRef.current) {
      navSkipRef.current = false;
      return;
    }
    pushNav(activeId);
  }, [activeId]);

  const goBack = () => {
    let i = histIdxRef.current;
    while (i > 0 && !sessionExists(historyRef.current[i - 1])) i--;
    if (i <= 0) return;
    histIdxRef.current = i - 1;
    navSkipRef.current = true;
    syncNav();
    discardDraft();
    setActiveId(historyRef.current[histIdxRef.current]);
  };

  const goForward = () => {
    let i = histIdxRef.current;
    while (
      i < historyRef.current.length - 1 &&
      !sessionExists(historyRef.current[i + 1])
    )
      i++;
    if (i >= historyRef.current.length - 1) return;
    histIdxRef.current = i + 1;
    navSkipRef.current = true;
    syncNav();
    discardDraft();
    setActiveId(historyRef.current[histIdxRef.current]);
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
        toast.success("Chat deleted");
      },
    });
  };

  const togglePin = (id: string) => {
    let next = false;
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        next = !s.pinned;
        return { ...s, pinned: next };
      })
    );
    persist(db.setPinned(id, next));
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

    if (dictOnRef.current) {
      dictOnRef.current = false;
      dictStopping.current = false;
      void dictSessionRef.current?.stop().catch((e) => toast.error(String(e)));
      dictSessionRef.current = null;
      setDictating(false);
    }
    window.clearTimeout(typingTimer.current);
    lastTyped.current = "";
    // whatever was voice-typed is now a sent message: the next dictated
    // sentence starts on a clean line
    dictCommit.current = "";
    setDictText("");
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
      const route = decideRoute(text, hit, settings.webSearch, settings.answerAsMe);

      if (route === "web") {
        adoptable?.controller.abort(); // a draft without web results would be out of date
        patchMessage(sessionId, botId, { status: "Searching the web..." });

        let web: WebHit | null = null;
        let webFailed = false;
        try {
          // reuses the search the typing preview already did - one per question
          web = await searchOnce(sessionId, retrievalQuery(session, text));
          if (!web) webFailed = true;
        } catch (e) {
          if (controller.signal.aborted || e instanceof ConfigError) throw e;
          webFailed = true;
        }

        // matching documents stay visible as sources, also next to web results
        const docPart = docRefs(hit);
        if (web) {
          source = "web";
          refs = docPart ? [...docPart, ...web.refs] : web.refs;
        } else if (hit?.relevant) {
          source = "documents";
          refs = docPart;
        }
        patchMessage(sessionId, botId, { status: undefined, source, refs });
        await stream({ context: hit?.context, web: web?.context, webFailed });
      } else if (adoptable) {
        source = adoptable.usedDocs ? "documents" : "general";
        refs = docRefs(hit);
        patchMessage(sessionId, botId, { source, refs });
        await followDraft(adoptable, show, controller.signal);
        if (!reply.trim() && !controller.signal.aborted) {
          source = hit?.relevant ? "documents" : "general"; // draft failed: generate normally
          refs = docRefs(hit);
          patchMessage(sessionId, botId, { source, refs });
          await stream({ context: hit?.context });
        }
      } else {
        source = hit?.relevant ? "documents" : "general";
        refs = docRefs(hit);
        patchMessage(sessionId, botId, { source, refs });
        await stream({ context: hit?.context });

        // if the answer admits its knowledge is stale, search the web and answer again
        if (webAvailable(settings) && STALE_ANSWER.test(reply)) {
          patchMessage(sessionId, botId, { status: "Searching the web..." });
          try {
            const web = await searchOnce(sessionId, retrievalQuery(session, text));
            if (web) {
              source = "web";
              const docPart = docRefs(hit);
              refs = docPart ? [...docPart, ...web.refs] : web.refs;
              reply = "";
              patchMessage(sessionId, botId, { text: "", status: undefined, source, refs });
              await stream({ context: hit?.context, web: web.context });
            } else {
              patchMessage(sessionId, botId, { status: undefined });
            }
          } catch {
            if (!controller.signal.aborted) {
              patchMessage(sessionId, botId, { status: undefined });
            }
          }
        }
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
  sendRef.current = send;

  const stop = () => {
    if (active) controllers.current.get(active.id)?.abort();
  };

  /* ---------- voice listening ---------- */

  const handleVoiceQuestion = async (text: string) => {
    const q = text.trim();
    setVoice((v) =>
      v ? { ...v, transcript: "", question: q, hearing: false, answering: true } : v
    );
    // mute immediately: nothing said while the answer is written counts
    voiceRef.current?.setPaused(true);

    // ignore coughs and one-word noise
    if (q.split(/\s+/).length < 2) {
      discardDraft();
      resumeVoiceListening();
      return;
    }

    try {
      // a new question replaces an answer that is still being written
      const sid = activeIdRef.current;
      controllers.current.get(sid)?.abort();
      for (let i = 0; i < 30 && controllers.current.has(sid); i++) {
        await new Promise((r) => setTimeout(r, 25));
      }
      await sendRef.current(q);
    } finally {
      resumeVoiceListening(); // answer done - listening for the next question
    }
  };

  const startVoiceMode = async () => {
    if (voiceRef.current) return;
    const cfg = settingsRef.current;

    if (!cfg.deepgramKey.trim()) {
      setVoice({
        phase: "error",
        hearing: false,
        transcript: "",
        question: "",
        answering: false,
        error:
          "Add your Deepgram API key in Settings (Voice listening section) to use listening mode.",
      });
      return;
    }

    discardDraft();
    const gen = ++voiceGen.current;
    setVoice({ phase: "connecting", hearing: false, transcript: "", question: "", answering: false, error: "" });

    try {
      const session = await startVoice(
        { apiKey: cfg.deepgramKey, language: cfg.voiceLang },
        {
          onStatus: (phase) => setVoice((v) => (v ? { ...v, phase, error: "" } : v)),
          onSpeech: (hearing) => setVoice((v) => (v ? { ...v, hearing } : v)),
          onUtteranceStart: () => {},
          onTranscript: (text) => {
            setVoice((v) => (v ? { ...v, transcript: text } : v));
            onTypingRef.current(text, VOICE_DELAY);
          },
          onUtteranceEnd: (text) => {
            handleVoiceQuestion(text);
          },
          onError: (msg) =>
            setVoice((v) => (v ? { ...v, phase: "error", hearing: false, error: msg } : v)),
        }
      );

      if (gen !== voiceGen.current) {
        void session.stop().catch((e) => console.error("Could not stop voice session:", e));
        return;
      }
      voiceRef.current = session;
      setAnalyser(session.analyser);
    } catch (e) {
      if (gen !== voiceGen.current) return;
      setVoice({
        phase: "error",
        hearing: false,
        transcript: "",
        question: "",
        answering: false,
        error: describeMicError(e),
      });
    }
  };

  const stopVoiceMode = () => {
    voiceGen.current++;
    void voiceRef.current?.stop().catch((e) => console.error("Could not stop voice session:", e));
    voiceRef.current = null;
    setAnalyser(null);
    setVoice(null);
    setVoicePaused(false);
    voicePausedRef.current = false;
    discardDraft();
  };

  // pause = mute the mic but keep voice mode open
  const toggleVoicePause = () => {
    const session = voiceRef.current;
    if (!session) return;
    setVoicePaused((p) => {
      const next = !p;
      voicePausedRef.current = next;
      session.setPaused(next);
      return next;
    });
  };

  // turn-taking: the mic is muted while an answer is being written, so reading
  // the answer aloud (or talking over it) cannot become the next question
  const resumeVoiceListening = () => {
    if (!voicePausedRef.current) voiceRef.current?.setPaused(false);
    setVoice((v) => (v ? { ...v, answering: false, hearing: false } : v));
  };

  // Stop ends the listening session but keeps voice mode open, ready to Start again
  const endVoiceListening = () => {
    voiceGen.current++;
    void voiceRef.current?.stop().catch((e) => console.error("Could not stop voice session:", e));
    voiceRef.current = null;
    setAnalyser(null);
    setVoicePaused(false);
    voicePausedRef.current = false;
    setVoice((v) =>
      v ? { ...v, phase: "stopped", hearing: false, transcript: "" } : v
    );
    discardDraft();
  };

  const finishDictation = () => {
    dictOnRef.current = false;
    dictSessionRef.current = null;
    setDictating(false);
  };

  const stopDictation = () => {
    if (!dictOnRef.current || dictStopping.current) return;
    const session = dictSessionRef.current;
    if (!session) {
      finishDictation();
      return;
    }

    dictStopping.current = true;
    setDictating(false);
    void session
      .stop()
      .catch((e) => toast.error(e instanceof Error ? e.message : String(e)))
      .finally(() => {
        dictStopping.current = false;
        finishDictation();
      });
  };

  // Reuse Deepgram streaming from voice mode, but leave the transcribed text
  // in the composer for the user to review and send.
  const toggleDictation = async () => {
    if (dictOnRef.current) {
      stopDictation();
      return;
    }
    const cfg = settingsRef.current;
    if (!cfg.deepgramKey.trim()) {
      setSettingsTab("connection");
      setSettingsOpen(true);
      toast.error("Add your Deepgram API key in Settings > Connection > Voice listening.");
      return;
    }

    dictOnRef.current = true;
    dictStopping.current = false;
    dictCommit.current = "";
    setDictText("");
    setDictating(true);
    try {
      const session = await startVoice(
        { apiKey: cfg.deepgramKey, language: cfg.voiceLang },
        {
          onStatus: () => {},
          onSpeech: () => {},
          onUtteranceStart: () => {},
          onTranscript: (text) => {
            if (dictOnRef.current) {
              setDictText(dictCommit.current ? `${dictCommit.current} ${text}` : text);
            }
          },
          onUtteranceEnd: (text) => {
            if (dictOnRef.current && text) {
              dictCommit.current = dictCommit.current
                ? `${dictCommit.current} ${text}`
                : text;
              setDictText(dictCommit.current);
            }
          },
          onError: (message) => {
            if (dictOnRef.current) {
              finishDictation();
              dictStopping.current = false;
              toast.error(message);
            }
          },
        }
      );
      if (dictOnRef.current) {
        dictSessionRef.current = session;
      } else {
        void session.stop().catch((e) => console.error("Could not stop dictation:", e));
      }
    } catch (e) {
      if (!dictOnRef.current) return;
      finishDictation();
      toast.error(describeMicError(e));
    }
  };

  const retryVoice = () => {
    stopVoiceMode();
    void startVoiceMode();
  };

  /* ---------- documents ---------- */

  const uploadFiles = async (files: File[]): Promise<string | null> => {
    const sessionId = active.id;
    const errors: string[] = [];

    for (const file of files) {
      const key = `${file.name}:${file.size}`;
      const current = sessionsRef.current.find((s) => s.id === sessionId);
      const already = current?.docs.find((d) => d.path === key);
      if (already) {
        // already in this chat: re-uploading attaches an archived copy again
        if (already.archived) restoreDoc(already.id);
        continue;
      }

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

  // Removing a document only detaches it from the input box: its text stays a
  // source for this chat, so past answers and follow-up questions still work.
  const removeDoc = (id: string) => {
    patchSession(active.id, (s) => ({
      ...s,
      docs: s.docs.map((d) => (d.id === id ? { ...d, archived: true } : d)),
    }));
    persist(db.archiveDoc(id));
  };

  const restoreDoc = (id: string) => {
    patchSession(active.id, (s) => ({
      ...s,
      docs: s.docs.map((d) => (d.id === id ? { ...d, archived: false } : d)),
    }));
    persist(db.restoreDoc(id));
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

  /* ---------- render ---------- */

  // outside the Tauri webview getCurrentWindow() throws - never let that white-screen the app
  const appWindow = (() => {
    try {
      return getCurrentWindow();
    } catch {
      return null;
    }
  })();

  if (!bootDone || !active) {
    return <Splash />;
  }

  return (
    <div className="h-screen flex bg-[linear-gradient(180deg,#f4f4f3_0%,#e4e4e2_100%)] dark:bg-[linear-gradient(180deg,#17181c_0%,#121316_100%)] overflow-hidden fade-in">
      <Toaster
        position="bottom-right"
        theme={settings.theme === "dark" ? "dark" : "light"}
        closeButton
        toastOptions={{
          classNames: {
            toast: "!w-auto !min-w-64 !max-w-80 !rounded-lg !border !border-line !bg-panel !px-3 !py-2 !pr-7 !text-sm !shadow-md !text-ink",
            title: "!text-sm !text-ink !font-medium",
            description: "!text-xs !text-muted",
            content: "!gap-1",
            closeButton: "toast-close",
          },
        }}
      />
      <ActivityRail
        onNew={() => {
          stopVoiceMode();
          setSettingsOpen(false);
          addSession();
        }}
        onOpenSettings={() => {
          stopVoiceMode();
          setSettingsOpen((o) => !o);
        }}
        onOpenAccount={() => {
          stopVoiceMode();
          setSettingsTab("account");
          setAccountPulse((n) => n + 1);
          setSettingsOpen(true);
        }}
        voiceActive={voice !== null && voice.phase !== "error"}
        onStartVoice={() => {
          setSettingsOpen(false);
          if (voice) {
            stopVoiceMode();
          } else {
            if (active.messages.length > 0) addSession(); // voice always starts a fresh chat
            void startVoiceMode();
          }
        }}
        onOpenOverlay={() => {
          setSettingsOpen(false);
          // opens the floating popup and minimizes this window (Rust side)
          void invoke("open_overlay").catch((e) =>
            toast.error("Could not open the quick assistant", {
              description: e instanceof Error ? e.message : String(e),
            })
          );
        }}
        updateAvailable={updateAvailable}
        settingsOpen={settingsOpen}
        theme={settings.theme}
        onToggleTheme={toggleTheme}
      />
      <div className="flex-1 min-w-0 mt-12 mr-2 mb-2 flex rounded-md border border-line bg-panel overflow-hidden">
      {sourcesOpen && !settingsOpen && !voice && (
      <RecentsPanel
        sessions={sessions}
        activeId={active.id}
        onSelect={selectSession}
        onNew={addSession}
        onDelete={requestDelete}
        onTogglePin={togglePin}
        updateAvailable={updateAvailable}
        onUpdateClick={() => setBannerOpen(true)}
      />
      )}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
      {settingsOpen ? (
        <SettingsDialog
          inline
          settings={settings}
          onSave={saveSettings}
          onClose={() => setSettingsOpen(false)}
          initialTab={settingsTab}
          tabSignal={accountPulse}
          version={version}
          upd={upd}
          onCheckUpdate={() => void checkUpdates(true)}
          onInstallUpdate={() => void installNow()}
          onThemeChange={(t) => {
            const next = { ...settingsRef.current, theme: t } as Settings;
            setSettings(next);
            persist(db.saveSettings(next));
          }}
        />
      ) : (
        <>
      {!voice && (
      <div className="h-14 px-4 flex items-center justify-between shrink-0 gap-2">
        <div className="flex items-center gap-0.5">
          <HeaderBtn icon={ArrowLeft} title="Back" onClick={goBack} disabled={!nav.back} />
          <HeaderBtn icon={ArrowRight} title="Forward" onClick={goForward} disabled={!nav.forward} />
          <HeaderBtn
            icon={sourcesOpen ? PanelLeftClose : PanelLeftOpen}
            title={sourcesOpen ? "Hide recents" : "Show recents"}
            onClick={() => setSourcesOpen((s) => !s)}
          />
        </div>
      </div>
      )}
      <div className="flex-1 min-w-0 flex overflow-hidden">
      <ChatView
        session={active}
        busy={busy}
        preview={preview}
        humanTone={settings.humanTone}
        answerAsMe={settings.answerAsMe}
        webSearch={settings.webSearch}
        voice={voice}
        analyser={analyser}
        onToggleTone={() => toggleSetting("humanTone")}
        onToggleAsMe={() => toggleSetting("answerAsMe")}
        onToggleWeb={() => toggleSetting("webSearch")}
        dictating={dictating}
        dictText={dictText}            onToggleDictation={() => void toggleDictation()}
            onStopVoice={endVoiceListening}
        onRetryVoice={retryVoice}
        onOpenSettings={() => setSettingsOpen(true)}
        onSend={send}
        onStop={stop}
        onTyping={onTyping}
        onUpload={uploadFiles}
        onRemoveDoc={removeDoc}
        onRestoreDoc={restoreDoc}
        voicePaused={voicePaused}
        onPauseToggle={toggleVoicePause}
      />
      </div>
        </>
      )}
      </div>
      </div>
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
      {showBanner && (
        <UpdateBanner
          upd={upd}
          onInstall={() => void installNow()}
          onLater={() => setBannerOpen(false)}
        />
      )}

      {/* custom window controls (frameless window) */}
      <div
        className="fixed top-0 left-0 right-0 z-50 flex items-stretch h-8 select-none"
        data-tauri-drag-region
      >
        <div className="flex-1" data-tauri-drag-region />
        <button
          onClick={() => void appWindow?.minimize()}
          title="Minimize"
          className="w-11 flex items-center justify-center text-muted hover:bg-black/5"
        >
          <Minus size={15} />
        </button>
        <button
          onClick={() => void appWindow?.toggleMaximize()}
          title="Maximize"
          className="w-11 flex items-center justify-center text-muted hover:bg-black/5"
        >
          <Square size={12} />
        </button>
        <button
          onClick={() => void appWindow?.close()}
          title="Close"
          className="w-11 flex items-center justify-center text-muted hover:bg-red-600 hover:text-white"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}