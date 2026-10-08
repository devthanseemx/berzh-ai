import { useEffect, useState, type ReactNode } from "react";
import { RefreshCw, X } from "lucide-react";
import type { Settings } from "../settings";
import { listOmniModels } from "../llm";

interface Props {
  settings: Settings;
  onSave: (s: Settings) => void;
  onClose: () => void;
}

const inputCls =
  "w-full h-10 px-3 border border-line rounded-xl outline-none focus:border-accent bg-white";
const areaCls =
  "w-full px-3 py-2 border border-line rounded-xl outline-none focus:border-accent bg-white resize-y leading-relaxed";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-3 pt-4 border-t border-line first:border-t-0 first:pt-0">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
        {title}
      </h3>
      {children}
    </div>
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
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-semibold text-muted">{label}</span>
        {action}
      </div>
      {children}
    </div>
  );
}

function ModelPicker({
  value,
  models,
  onChange,
  emptyLabel,
  placeholder,
}: {
  value: string;
  models: string[];
  onChange: (v: string) => void;
  emptyLabel?: string;
  placeholder?: string;
}) {
  if (models.length === 0) {
    return (
      <input
        className={inputCls}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  const known = models.includes(value);
  return (
    <select
      className={inputCls}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {emptyLabel && <option value="">{emptyLabel}</option>}
      {!known && value && <option value={value}>{value}</option>}
      {models.map((id) => (
        <option key={id} value={id}>
          {id}
        </option>
      ))}
    </select>
  );
}

export default function SettingsDialog({ settings, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<Settings>(settings);
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsError, setModelsError] = useState("");

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={onClose}
    >
      <div
        className="w-130 max-h-[90vh] overflow-y-auto bg-white rounded-2xl border border-line shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-12 px-5 flex items-center justify-between border-b border-line sticky top-0 bg-white">
          <span className="font-semibold">Settings</span>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-bg">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <Section title="OmniRoute connection">
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
          </Section>

          <Section title="Answer model">
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
              <ModelPicker
                value={draft.omniModel}
                models={models}
                onChange={(v) => set("omniModel", v)}
                placeholder="Model name from OmniRoute"
              />
              {modelsError && (
                <p className="mt-1 text-xs text-red-600">{modelsError}</p>
              )}
            </Field>
            <Field label="Fallback model (used if the main one fails)">
              <ModelPicker
                value={draft.omniFallbackModel}
                models={models}
                onChange={(v) => set("omniFallbackModel", v)}
                emptyLabel="None"
                placeholder="Optional"
              />
            </Field>
          </Section>

          <Section title="Live preview">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 accent-accent"
                checked={draft.liveDraft}
                onChange={(e) => set("liveDraft", e.target.checked)}
              />
              <span>
                <span className="block font-medium">Live drafting</span>
                <span className="block text-xs text-muted">
                  Prepare an answer in the background while you type.
                </span>
              </span>
            </label>

            {draft.liveDraft && (
              <>
                <Field label="Live preview model (pick the fastest, non-reasoning)">
                  <ModelPicker
                    value={draft.liveModel}
                    models={models}
                    onChange={(v) => set("liveModel", v)}
                    emptyLabel="Same as answer model"
                    placeholder="Empty = same as answer model"
                  />
                </Field>
                <Field label="Live preview fallback model">
                  <ModelPicker
                    value={draft.liveFallbackModel}
                    models={models}
                    onChange={(v) => set("liveFallbackModel", v)}
                    emptyLabel="None"
                    placeholder="Optional"
                  />
                </Field>
              </>
            )}
          </Section>

          <Section title="Personalization">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 accent-accent"
                checked={draft.humanTone}
                onChange={(e) => set("humanTone", e.target.checked)}
              />
              <span>
                <span className="block font-medium">Humanized answers</span>
                <span className="block text-xs text-muted">
                  Reply like a real person: natural, plain words, no AI-style lists or filler.
                </span>
              </span>
            </label>

            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 accent-accent"
                checked={draft.answerAsMe}
                onChange={(e) => set("answerAsMe", e.target.checked)}
              />
              <span>
                <span className="block font-medium">Answer as me</span>
                <span className="block text-xs text-muted">
                  Reply in the first person as you, using "About me" (for example "I am ... and I am a ...").
                </span>
              </span>
            </label>

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
          </Section>

          <p className="text-xs text-muted">
            Settings are stored on this computer in the app database.
          </p>
        </div>

        <div className="px-5 pb-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="h-10 px-4 rounded-xl border border-line hover:bg-bg"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onSave(draft);
              onClose();
            }}
            className="h-10 px-5 rounded-xl bg-accent text-white hover:opacity-90"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}