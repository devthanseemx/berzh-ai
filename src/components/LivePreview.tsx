import { Globe } from "lucide-react";
import type { Preview } from "../types";
import Markdown from "./Markdown";

export default function LivePreview({ preview }: { preview: Preview }) {
  const { predicted, answer, done, error, stale, docs, web } = preview;

  if (web) {
    return (
      <div className="max-w-3xl mx-auto rounded-2xl border border-line bg-bg px-4 py-3 flex items-center gap-2.5">
        <Globe size={16} className="shrink-0 text-accent" />
        <span>
          This looks like it needs current information. Press Enter to search the web.
        </span>
      </div>
    );
  }

  const status = error
    ? "Preview unavailable"
    : stale
      ? "Updating..."
      : done
        ? "Answer ready. Press Enter to send"
        : "Preparing answer...";

  return (
    <div
      className={`max-w-3xl mx-auto rounded-2xl border border-line bg-bg px-4 py-3 transition-opacity ${stale ? "opacity-60" : ""
        }`}
    >
      <div className="flex items-center gap-2 text-xs font-semibold text-accent">
        <span
          className={`h-2 w-2 rounded-full bg-accent ${done && !stale ? "" : "animate-pulse"
            }`}
        />
        {status}
      </div>

      {predicted && !error && (
        <div className="mt-1.5 text-xs text-muted truncate">
          Understood as: {predicted}
        </div>
      )}
      {docs && !error && (
        <div className="mt-1 text-xs text-muted">Using your uploaded documents</div>
      )}

      {!error &&
        (answer ? (
          <div className="mt-2 max-h-40 overflow-y-auto">
            <Markdown text={answer} />
          </div>
        ) : (
          <div className="mt-2 text-muted">Reading your question...</div>
        ))}
    </div>
  );
}