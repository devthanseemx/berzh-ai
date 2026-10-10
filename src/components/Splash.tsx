import { Check, Loader2, Minus, X } from "lucide-react";
import VoiceBlob from "./VoiceBlob";

export type StepState = "pending" | "active" | "done" | "skipped" | "failed";

export interface Step {
  id: string;
  label: string;
  state: StepState;
}

function StepIcon({ state }: { state: StepState }) {
  switch (state) {
    case "active":
      return <Loader2 size={16} className="animate-spin text-accent" />;
    case "done":
      return <Check size={16} className="text-green-600" />;
    case "failed":
      return <X size={16} className="text-red-600" />;
    case "skipped":
      return <Minus size={16} className="text-muted" />;
    default:
      return <span className="h-3 w-3 rounded-full border border-line" />;
  }
}

interface Props {
  steps: Step[];
  error: string | null;
  onRetry: () => void;
  onContinue: () => void;
}

export default function Splash({ steps, error, onRetry, onContinue }: Props) {
  return (
    <div className="h-screen bg-white flex flex-col items-center justify-center px-6">
      <div className="scale-90">
        <VoiceBlob analyser={null} hearing={false} />
      </div>
      <h1 className="mt-2 text-2xl font-semibold">Berzh AI</h1>
      <p className="mt-1 text-sm text-muted">
        {error ? "Something needs your attention" : "Starting up..."}
      </p>

      <ul className="mt-6 w-72 space-y-2.5">
        {steps.map((s) => (
          <li
            key={s.id}
            className={`flex items-center gap-3 text-sm ${
              s.state === "pending" ? "text-muted" : "text-ink"
            }`}
          >
            <span className="w-4 flex justify-center">
              <StepIcon state={s.state} />
            </span>
            {s.label}
          </li>
        ))}
      </ul>

      {error && (
        <div className="mt-6 w-110 max-w-full rounded-2xl border border-red-200 bg-red-50 px-5 py-4">
          <p className="text-sm text-red-700 whitespace-pre-wrap wrap-break-word max-h-40 overflow-y-auto">
            {error}
          </p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={onRetry}
              className="h-9 px-4 rounded-xl bg-red-600 text-white hover:opacity-90"
            >
              Retry
            </button>
            <button
              onClick={onContinue}
              className="h-9 px-4 rounded-xl border border-red-200 hover:bg-white"
            >
              Continue anyway
            </button>
          </div>
        </div>
      )}
    </div>
  );
}