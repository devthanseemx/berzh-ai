import { useEffect, useState, type ReactNode } from "react";
import { RefreshCw, X } from "lucide-react";
import type { ProviderId, Settings } from "../settings";
import { listOmniModels } from "../llm";

interface Props {
  settings: Settings;
  onSave: (s: Settings) => void;
  onClose: () => void;
}

interface Opt {
  id: string;
  label: string;
}

const inputCls =
  "w-full h-10 px-3 border border-line rounded-xl outline-none focus:border-accent bg-white";

const GEMINI_MODELS: Opt[] = [
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite (fastest, recommended)" },
  { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite" },
  { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash (smarter, slower)" },
  { id: "gemini-3.7-flash", label: "Gemini 3.7 Flash" },
];

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <span className="block mb-1 text-xs font-semibold text-muted">{label}</span>
      {children}
    </div>
  );
}

function ModelSelect({
  value,
  options,
  onChange,
  emptyLabel,
}: {
  value: string;
  options: Opt[];
  onChange: (v: string) => void;
  emptyLabel?: string;
}) {
  const known = options.some((o) => o.id === value);
  return (
    <select
      className={inputCls}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {emptyLabel && <option value="">{emptyLabel}</option>}
      {!known && value && <option value={value}>{value}</option>}
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function OmniPicker({
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
  return (
    <ModelSelect
      value={value}
      options={models.map((id) => ({ id, label: id }))}
      onChange={onChange}
      emptyLabel={emptyLabel}
    />
  );
}

export default function SettingsDialog({ settings, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<Settings>(settings);
  const [omniModels, setOmniModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsError, setModelsError] = useState("");

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const loadModels = async () => {
    setLoadingModels(true);
    setModelsError("");
    try {
      setOmniModels(await listOmniModels(draft.omniBaseUrl, draft.omniKey));
    } catch (e) {
      setOmniModels([]);
      setModelsError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingModels(false);
    }
  };

  useEffect(() => {
    if (draft.provider === "omniroute") loadModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.provider]);

  const providers: { id: ProviderId; label: string }[] = [
    { id: "gemini", label: "Gemini" },
    { id: "omniroute", label: "OmniRoute" },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={onClose}
    >
      <div
        className="w-120 max-h-[90vh] overflow-y-auto bg-white rounded-2xl border border-line shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-12 px-5 flex items-center justify-between border-b border-line">
          <span className="font-semibold">Settings</span>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-bg">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <Field label="AI provider">
            <div className="flex gap-2">
              {providers.map((p) => (
                <button
                  key={p.id}
                  onClick={() => set("provider", p.id)}
                  className={`flex-1 h-10 rounded-xl border ${
                    draft.provider === p.id
                      ? "border-accent bg-accent-soft text-accent font-medium"
                      : "border-line hover:bg-bg"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </Field>

          {draft.provider === "gemini" ? (
            <>
              <Field label="Gemini API key">
                <input
                  type="password"
                  className={inputCls}
                  value={draft.geminiKey}
                  onChange={(e) => set("geminiKey", e.target.value)}
                  placeholder="From Google AI Studio"
                />
              </Field>
              <Field label="Model">
                <ModelSelect
                  value={draft.geminiModel}
                  options={GEMINI_MODELS}
                  onChange={(v) => set("geminiModel", v)}
                />
              </Field>
              <Field label="Fallback model (used if the main one is busy)">
                <ModelSelect
                  value={draft.geminiFallbackModel}
                  options={GEMINI_MODELS}
                  onChange={(v) => set("geminiFallbackModel", v)}
                  emptyLabel="None"
                />
              </Field>
            </>
          ) : (
            <>
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
              <Field label="Model">
                <div className="flex gap-2">
                  <div className="flex-1 min-w-0">
                    <OmniPicker
                      value={draft.omniModel}
                      models={omniModels}
                      onChange={(v) => set("omniModel", v)}
                      placeholder="Model name from OmniRoute"
                    />
                  </div>
                  <button
                    onClick={loadModels}
                    title="Load models from OmniRoute"
                    className="h-10 w-10 shrink-0 flex items-center justify-center rounded-xl border border-line hover:bg-bg"
                  >
                    <RefreshCw
                      size={16}
                      className={loadingModels ? "animate-spin" : ""}
                    />
                  </button>
                </div>
                {modelsError && (
                  <p className="mt-1 text-xs text-red-600">{modelsError}</p>
                )}
              </Field>
              <Field label="Fallback model (used if the main one fails)">
                <OmniPicker
                  value={draft.omniFallbackModel}
                  models={omniModels}
                  onChange={(v) => set("omniFallbackModel", v)}
                  emptyLabel="None"
                  placeholder="Optional"
                />
              </Field>
            </>
          )}

          <p className="text-xs text-muted">
            Keys are stored on this computer in the app database.
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