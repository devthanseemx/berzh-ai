import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { Settings } from "../settings";
import { listOmniModels } from "../llm";
import type { UpdateUi } from "../updater";
import { Check, ChevronDown, RefreshCw, User } from "lucide-react";

interface Props {
  settings: Settings;
  onSave: (s: Settings) => void;
  onClose: () => void;
  version: string;
  upd: UpdateUi;
  onCheckUpdate: () => void;
  onInstallUpdate: () => void;
  /** rendered as a full-height panel inside the chat area instead of a modal */
  inline?: boolean;
  /** theme applies instantly - no Save needed */
  onThemeChange: (t: Settings["theme"]) => void;
  /** which page to open on (Profile opens Account) */
  initialTab?: SettingsTab;
  /** increments on every Profile click, forcing the jump even if initialTab is unchanged */
  tabSignal?: number;
}

const inputCls =
  "w-full h-9 px-3 border border-line rounded-md outline-none focus:border-accent bg-panel text-sm";
const areaCls =
  "w-full px-3 py-2 border border-line rounded-md outline-none focus:border-accent bg-panel resize-y leading-relaxed text-sm";

/** Custom dropdown: same look as the inputs, keyboard + click friendly. */
function Select({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selected = options.find((o) => o.value === value);

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`${inputCls} flex items-center justify-between gap-2 text-left`}
      >
        <span className={`truncate ${selected ? "" : "text-muted"}`}>
          {selected ? selected.label : value || "Select..."}
        </span>
        <ChevronDown
          size={16}
          className={`shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-line bg-panel py-1 shadow-lg">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className={`w-full px-3 py-2 flex items-center justify-between gap-2 text-left text-sm hover:bg-bg ${
                o.value === value ? "text-accent font-medium" : ""
              }`}
            >
              <span className="truncate">{o.label}</span>
              {o.value === value && <Check size={14} className="shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Sidebar item of the settings dialog. */
/** Segmented toggle buttons - a compact alternative to dropdowns. */
function Segmented({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <Field label={label}>
      <div className="inline-flex gap-0.5 rounded-md border border-line p-0.5">
        {options.map((o) => (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={`h-7 px-3 rounded text-xs font-medium transition-colors ${
              value === o.value
                ? "bg-accent text-panel"
                : "text-muted hover:text-ink hover:bg-bg"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </Field>
  );
}

function TabBtn({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full px-3 py-2 rounded-md text-left text-sm transition-colors ${
        active ? "bg-accent-soft text-accent font-medium" : "text-muted hover:bg-bg hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}

function Field({
  label,
  action,
  children,
}: {
  label: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-semibold text-muted">{label}</span>
        {action}
      </div>
      {children}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  title,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: string;
  hint: string;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors ${
          checked ? "bg-accent" : "bg-line"
        }`}
      >
        <span
          className={`block h-4 w-4 rounded-full bg-panel shadow transition-transform ${
            checked ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </button>
      <span>
        <span className="block font-medium">{title}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
    </label>
  );
}

type Tab = "account" | "connection" | "models" | "search" | "personal" | "about";
export type SettingsTab = Tab;

const TABS: { id: Tab; label: string }[] = [
  { id: "account", label: "Account" },
  { id: "connection", label: "Connection" },
  { id: "models", label: "Models" },
  { id: "search", label: "Search & voice" },
  { id: "personal", label: "Personalization" },
  { id: "about", label: "About" },
];

export default function SettingsDialog({ settings, onSave, onClose, version, upd, onCheckUpdate, onInstallUpdate, inline = false, onThemeChange, initialTab = "connection", tabSignal = 0 }: Props) {
  const [draft, setDraft] = useState<Settings>(settings);
  const [tab, setTab] = useState<Tab>(initialTab);

  // the rail's Profile button can jump to Account while the dialog is open,
  // even when the tab prop itself did not change (tabSignal bumps per click)
  useEffect(() => {
    setTab(initialTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTab, tabSignal]);
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsError, setModelsError] = useState("");

  // which keys were edited here - auto-save only writes those, so an external
  // change (like the rail theme toggle) is never overwritten by a stale draft
  const saveTimer = useRef<number | undefined>(undefined);
  const touched = useRef<Set<keyof Settings>>(new Set());
  const latestDraft = useRef(draft);
  latestDraft.current = draft;

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    touched.current.add(key);
    setDraft((d) => ({ ...d, [key]: value }));
  };

  // follow settings changed outside the dialog (theme toggle in the rail)
  useEffect(() => {
    setDraft((d) => {
      const next = { ...d };
      (Object.keys(settings) as (keyof Settings)[]).forEach((k) => {
        if (!touched.current.has(k)) (next as any)[k] = settings[k];
      });
      return next;
    });
  }, [settings]);

  // Auto-save: an edit applies on its own after a short pause - no Save button
  useEffect(() => {
    if (touched.current.size === 0) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const merged = { ...settings } as Settings;
      const draftNow = latestDraft.current;
      touched.current.forEach((k) => {
        (merged as any)[k] = draftNow[k];
      });
      touched.current = new Set();
      onSave(merged);
      toast.success("Settings saved", { id: "settings-saved", duration: 1600 });
    }, 1200);
    return () => window.clearTimeout(saveTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, settings]);

  const loadModels = async () => {
    setLoadingModels(true);
    setModelsError("");
    try {
      setModels(await listOmniModels(draft.omniBaseUrl, draft.omniKey));
    } catch (e) {
      setModels([]);
      setModelsError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingModels(false);
    }
  };

  useEffect(() => {
    loadModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const modelOptions = (emptyLabel?: string) => {
    const opts = models.map((id) => ({ value: id, label: id }));
    if (!models.includes(draft.omniModel) && draft.omniModel) {
      opts.unshift({ value: draft.omniModel, label: draft.omniModel });
    }
    if (emptyLabel) opts.unshift({ value: "", label: emptyLabel });
    return opts;
  };

  const updateText =
    upd.status === "available"
      ? `Version ${upd.version} is available.`
      : upd.status === "downloading"
        ? `Downloading update${upd.progress != null ? ` ${upd.progress}%` : "..."}`
        : upd.status === "installing"
          ? "Installing. The app will restart."
          : upd.status === "error"
            ? upd.error ?? "Could not check for updates."
            : "";
  const updateBusy = upd.status === "checking" || upd.status === "downloading" || upd.status === "installing";

  const panel = (
      <div
        className={
          inline
            ? "flex-1 min-w-0 min-h-0 bg-panel flex flex-col overflow-hidden"
            : "w-170 h-130 max-h-[90vh] bg-panel rounded-md border border-line shadow-2xl flex flex-col overflow-hidden"
        }
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-13 px-5 flex items-center justify-between border-b border-line shrink-0">
          <span className="font-semibold">Settings</span>
          <span className="text-xs text-muted">Changes save automatically</span>
        </div>

        <div className="flex-1 min-h-0 flex">
          {/* left nav */}
          <nav className="w-44 shrink-0 border-r border-line bg-bg/50 p-2 space-y-0.5">
            {TABS.map((t) => (
              <TabBtn
                key={t.id}
                label={t.label}
                active={tab === t.id}
                onClick={() => setTab(t.id)}
              />
            ))}
          </nav>

          {/* content */}
          <div className="flex-1 min-w-0 overflow-y-auto p-5 space-y-5">
            {tab === "account" && (
              <>
                <div>
                  <h3 className="text-sm font-semibold">Account</h3>
                  <p className="text-xs text-muted mt-0.5">
                    Sign in to sync your chats across devices.
                  </p>
                </div>
                <div className="flex items-center justify-between gap-4 rounded-md border border-line p-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-10 w-10 shrink-0 flex items-center justify-center rounded-full bg-bg border border-line">
                      <User size={20} className="text-muted" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium">Sign in with Google</div>
                      <div className="text-xs text-muted">Not signed in</div>
                    </div>
                  </div>
                  <span className="shrink-0 px-2.5 py-1 rounded-md border border-line text-xs font-medium text-muted">
                    Coming soon
                  </span>
                </div>
                <p className="text-xs text-muted">
                  Google sign-in is coming soon. Until then, your chats stay saved on this
                  computer.
                </p>
              </>
            )}
            {tab === "connection" && (
              <>
                <div>
                  <h3 className="text-sm font-semibold">OmniRoute connection</h3>
                  <p className="text-xs text-muted mt-0.5">
                    Where the app sends its questions.
                  </p>
                </div>
                <Field label="Base URL">
                  <input
                    className={inputCls}
                    value={draft.omniBaseUrl}
                    onChange={(e) => set("omniBaseUrl", e.target.value)}
                  />
                </Field>
                <Field label="API key (optional)">
                  <input
                    type="password"
                    className={inputCls}
                    value={draft.omniKey}
                    onChange={(e) => set("omniKey", e.target.value)}
                  />
                </Field>
                <Toggle
                  checked={draft.omniAutoStart}
                  onChange={(v) => set("omniAutoStart", v)}
                  title="Start OmniRoute when the app opens"
                  hint="Only for a local address. Takes effect next launch. Closing Berzh AI also stops a server it started."
                />
                <Field label="Start command">
                  <input
                    className={inputCls}
                    value={draft.omniCommand}
                    onChange={(e) => set("omniCommand", e.target.value)}
                    placeholder="omniroute"
                  />
                </Field>
              </>
            )}

            {tab === "models" && (
              <>
                <Segmented
                  label="Where answers come from"
                  value={draft.llmProvider}
                  options={[
                    { value: "omni", label: "OmniRoute (local)" },
                    { value: "gemini", label: "Gemini API" },
                  ]}
                  onChange={(v) => set("llmProvider", v as Settings["llmProvider"])}
                />
                <p className="-mt-3 text-xs text-muted">
                  Only one at a time. OmniRoute runs models on your computer; Gemini answers over
                  its API with a key (free models available) and needs no local server.
                </p>

                {draft.llmProvider === "gemini" && (
                  <>
                    <Field label="Gemini API key">
                      <input
                        type="password"
                        className={inputCls}
                        value={draft.geminiKey}
                        placeholder="AIza..."
                        onChange={(e) => set("geminiKey", e.target.value)}
                      />
                      <p className="mt-1 text-xs text-muted">
                        Free key at aistudio.google.com. Answers work even when OmniRoute is not
                        running.
                      </p>
                    </Field>
                    <div>
                      <h3 className="text-sm font-semibold">Answer model</h3>
                      <p className="text-xs text-muted mt-0.5">
                        The free-tier Gemini model that writes your replies.
                      </p>
                    </div>
                    <Field label="Model">
                      <input
                        className={inputCls}
                        value={draft.geminiModel}
                        placeholder="gemini-3.8-flash"
                        onChange={(e) => set("geminiModel", e.target.value)}
                      />
                      <p className="mt-1 text-xs text-muted">
                        Free-tier options include gemini-3.8-flash (chat) and
                        gemini-3.5-flash-lite (fastest).
                      </p>
                    </Field>
                    <Toggle
                      checked={draft.liveDraft}
                      onChange={(v) => set("liveDraft", v)}
                      title="Live drafting"
                      hint="Prepare an answer in the background while you type."
                    />
                    {draft.liveDraft && (
                      <Field label="Live preview model (fast and light)">
                        <input
                          className={inputCls}
                          value={draft.geminiLiveModel}
                          placeholder="gemini-3.5-flash-lite"
                          onChange={(e) => set("geminiLiveModel", e.target.value)}
                        />
                      </Field>
                    )}
                  </>
                )}

                {draft.llmProvider === "omni" && (
                  <>
                <div>
                  <h3 className="text-sm font-semibold">Answer model</h3>
                  <p className="text-xs text-muted mt-0.5">
                    The model that writes your replies.
                  </p>
                </div>
                <Field
                  label="Model"
                  action={
                    <button
                      onClick={loadModels}
                      title="Reload models from OmniRoute"
                      className="p-1 rounded-md text-muted hover:text-ink hover:bg-bg"
                    >
                      <RefreshCw
                        size={14}
                        className={loadingModels ? "animate-spin" : ""}
                      />
                    </button>
                  }
                >
                  {models.length === 0 ? (
                    <input
                      className={inputCls}
                      value={draft.omniModel}
                      placeholder="Model name from OmniRoute"
                      onChange={(e) => set("omniModel", e.target.value)}
                    />
                  ) : (
                    <Select
                      value={draft.omniModel}
                      options={modelOptions()}
                      onChange={(v) => set("omniModel", v)}
                    />
                  )}
                  {modelsError && (
                    <p className="mt-1 text-xs text-red-600">{modelsError}</p>
                  )}
                </Field>
                <Field label="Fallback model (used if the main one fails)">
                  {models.length === 0 ? (
                    <input
                      className={inputCls}
                      value={draft.omniFallbackModel}
                      placeholder="Optional"
                      onChange={(e) => set("omniFallbackModel", e.target.value)}
                    />
                  ) : (
                    <Select
                      value={draft.omniFallbackModel}
                      options={modelOptions("None")}
                      onChange={(v) => set("omniFallbackModel", v)}
                    />
                  )}
                </Field>

                <div className="pt-2">
                  <h3 className="text-sm font-semibold">Live preview</h3>
                </div>
                <Toggle
                  checked={draft.liveDraft}
                  onChange={(v) => set("liveDraft", v)}
                  title="Live drafting"
                  hint="Prepare an answer in the background while you type."
                />
                {draft.liveDraft && (
                  <>
                    <Field label="Live preview model (pick the fastest, non-reasoning)">
                      {models.length === 0 ? (
                        <input
                          className={inputCls}
                          value={draft.liveModel}
                          placeholder="Empty = same as answer model"
                          onChange={(e) => set("liveModel", e.target.value)}
                        />
                      ) : (
                        <Select
                          value={draft.liveModel}
                          options={modelOptions("Same as answer model")}
                          onChange={(v) => set("liveModel", v)}
                        />
                      )}
                    </Field>
                    <Field label="Live preview fallback model">
                      {models.length === 0 ? (
                        <input
                          className={inputCls}
                          value={draft.liveFallbackModel}
                          placeholder="Optional"
                          onChange={(e) => set("liveFallbackModel", e.target.value)}
                        />
                      ) : (
                        <Select
                          value={draft.liveFallbackModel}
                          options={modelOptions("None")}
                          onChange={(v) => set("liveFallbackModel", v)}
                        />
                      )}
                    </Field>
                  </>
                )}
                  </>
                )}
              </>
            )}

            {tab === "search" && (
              <>
                <div>
                  <h3 className="text-sm font-semibold">Web search</h3>
                </div>
                <Toggle
                  checked={draft.webSearch}
                  onChange={(v) => set("webSearch", v)}
                  title="Search the web for current questions"
                  hint='Used for prices, news, weather and "search for ...". Your documents are checked first.'
                />
                <Field label="Tavily API key">
                  <input
                    type="password"
                    className={inputCls}
                    value={draft.tavilyKey}
                    onChange={(e) => set("tavilyKey", e.target.value)}
                    placeholder="tvly-..."
                  />
                  <p className="mt-1 text-xs text-muted">
                    Free key at tavily.com (about 1,000 searches a month, no card).
                    Every search uses exactly 1 credit.
                  </p>
                </Field>
                <Segmented
                  label="What to search"
                  value={draft.tavilyTopic}
                  options={[
                    { value: "general", label: "General" },
                    { value: "news", label: "News" },
                    { value: "finance", label: "Finance" },
                  ]}
                  onChange={(v) => set("tavilyTopic", v as Settings["tavilyTopic"])}
                />
                <div className="pt-2">
                  <h3 className="text-sm font-semibold">Voice listening</h3>
                </div>
                <Field label="Deepgram API key">
                  <input
                    type="password"
                    className={inputCls}
                    value={draft.deepgramKey}
                    onChange={(e) => set("deepgramKey", e.target.value)}
                    placeholder="Deepgram API key"
                  />
                  <p className="mt-1 text-xs text-muted">
                    Free key at deepgram.com (new accounts get starting credit). Audio is
                    sent to Deepgram only while listening is on.
                  </p>
                </Field>
                <Field label="Deepgram management key (optional)">
                  <input
                    type="password"
                    className={inputCls}
                    value={draft.deepgramManagementKey}
                    onChange={(e) => set("deepgramManagementKey", e.target.value)}
                    placeholder="Key with usage and billing read access"
                  />
                  <p className="mt-1 text-xs text-muted">
                    Used only by the Usage dashboard; it does not replace your voice key. Create a project key with usage:read and billing:read permissions.
                  </p>
                </Field>
                <Field label="Deepgram project ID">
                  <input
                    className={inputCls}
                    value={draft.deepgramProjectId}
                    onChange={(e) => set("deepgramProjectId", e.target.value)}
                    placeholder="Project ID for the usage dashboard"
                  />
                  <p className="mt-1 text-xs text-muted">
                    Used with the management key to show usage and balances. The Project ID is specific to your Deepgram project.
                  </p>
                </Field>
                <Field label="Spoken language">
                  <Select
                    value={draft.voiceLang}
                    options={[
                      { value: "en", label: "English" },
                      { value: "multi", label: "Multilingual (mixed languages)" },
                    ]}
                    onChange={(v) => set("voiceLang", v)}
                  />
                </Field>
              </>
            )}

            {tab === "personal" && (
              <>
                <div>
                  <h3 className="text-sm font-semibold">Appearance</h3>
                </div>
                <Field label="Theme">
                  <Select
                    value={draft.theme}
                    options={[
                      { value: "light", label: "Light" },
                      { value: "dark", label: "Dark" },
                    ]}
                    onChange={(v) => {
                      const t = v as Settings["theme"];
                      set("theme", t);
                      onThemeChange(t); // applies and saves instantly
                    }}
                  />
                </Field>
                <div className="pt-2">
                  <h3 className="text-sm font-semibold">Personalization</h3>
                </div>
                <Toggle
                  checked={draft.humanTone}
                  onChange={(v) => set("humanTone", v)}
                  title="Humanized answers"
                  hint="Reply like a real person: natural, plain words, no AI-style lists or filler."
                />
                <Toggle
                  checked={draft.answerAsMe}
                  onChange={(v) => set("answerAsMe", v)}
                  title="Answer as me"
                  hint='Reply in the first person as you, using "About me" (for example "I am ... and I am a ...").'
                />
                <Toggle
                  checked={draft.interviewCoach}
                  onChange={(v) => set("interviewCoach", v)}
                  title="Interview coach"
                  hint="Shape answers as concise, natural spoken responses for Thanseem's entry-level IT Support and Service Desk interviews."
                />
                <Field label="About me">
                  <textarea
                    rows={4}
                    className={areaCls}
                    value={draft.aboutMe}
                    onChange={(e) => set("aboutMe", e.target.value)}
                    placeholder="Your name, role, skills, projects, and anything the AI should know about you."
                  />
                </Field>
                <Field label="Extra instructions (optional)">
                  <textarea
                    rows={4}
                    className={areaCls}
                    value={draft.instructions}
                    onChange={(e) => set("instructions", e.target.value)}
                  />
                </Field>
              </>
            )}

            {tab === "about" && (
              <>
                <div>
                  <h3 className="text-sm font-semibold">About</h3>
                </div>
                <div className="flex items-center justify-between rounded-md border border-line p-4">
                  <div>
                    <div className="font-medium">Berzh AI</div>
                    <div className="text-xs text-muted">Version {version || "..."}</div>
                  </div>
                  {upd.status === "available" ? (
                    <button
                      onClick={onInstallUpdate}
                      className="h-9 px-4 rounded-md bg-accent text-sm font-medium text-panel hover:opacity-90"
                    >
                      Install {upd.version}
                    </button>
                  ) : (
                    <button
                      onClick={onCheckUpdate}
                      disabled={updateBusy}
                      className="h-9 px-4 rounded-md border border-line text-sm font-medium hover:bg-bg disabled:opacity-60"
                    >
                      {upd.status === "checking" ? "Checking..." : "Check for updates"}
                    </button>
                  )}
                </div>
                {upd.status === "uptodate" && (
                  <p className="flex items-center gap-1.5 text-sm text-green-700">
                    <Check size={16} />
                    You're already up to date.
                  </p>
                )}
                {updateText && (
                  <p className={`text-xs ${upd.status === "error" ? "text-red-600" : "text-muted"}`}>
                    {updateText}
                  </p>
                )}
                <p className="text-xs text-muted pt-2">
                  Settings are stored on this computer in the app database.
                </p>
              </>
            )}

            {/* everything saves automatically - no action buttons */}
          </div>
        </div>
      </div>
  );

  if (inline) return panel;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px]"
      onClick={onClose}
    >
      {panel}
    </div>
  );
}
