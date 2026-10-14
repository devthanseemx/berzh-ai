import { EyeOff, Globe } from "lucide-react";
import type { Preview } from "../types";
import Markdown from "./Markdown";

export default function LivePreview({
  preview,
  compact = false,
  onToggle,
}: {
  preview: Preview;
  /** floating card layout: header strip + scrollable body (card chrome in ChatView) */
  compact?: boolean;
  /** hide button in the card header */
  onToggle?: () => void;
}) {
  const { predicted, answer, done, error, stale, docs, web, webFailed } = preview;

  const status = error
    ? "Preview unavailable"
    : stale
      ? "Updating..."
      : done
        ? "Answer ready. Press Enter to send"
        : "Preparing answer...";

  /* ---------- floating card (right side of the chat) ---------- */
  if (compact) {
    const dot = web
      ? "bg-accent animate-pulse"
      : error
        ? "bg-red-500"
        : `bg-accent ${done && !stale ? "" : "animate-pulse"}`;

    return (
      <div className={`transition-opacity ${stale ? "opacity-70" : ""}`}>
        <div className="flex items-center gap-2 border-b border-line bg-bg/60 px-4 py-2.5 text-xs font-semibold text-muted">
          <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
          <span className="truncate">
            {web ? "Searching the web..." : status}
          </span>
          <span className="ml-auto shrink-0 font-normal text-muted/70">
            Live preview
          </span>
          {onToggle && (
            <button
              onClick={onToggle}
              title="Hide live preview"
              className="ml-1 shrink-0 rounded-md p-1 text-muted hover:bg-bg hover:text-ink transition-colors"
            >
              <EyeOff size={13} />
            </button>
          )}
        </div>

        {(web || !error) && (
        <div className="max-h-[45vh] space-y-1.5 overflow-y-auto px-4 py-3 text-[13.5px] leading-relaxed">
          {web ? (
            <div className="flex items-center gap-2.5">
              <Globe size={16} className="shrink-0 text-accent" />
              <span>
                Searching the web for current information - the answer follows
                as soon as the results arrive.
              </span>
            </div>
          ) : (
            <>
              {webFailed && !error && (
                <div className="text-xs leading-relaxed text-amber-700 dark:text-amber-400">
                  Web search did not run (Tavily key missing or invalid, or the
                  search limit was reached), so this answer may not include
                  current data. Add a key under Settings - Search and voice.
                </div>
              )}
              {predicted && !error && (
                <div className="truncate text-xs text-muted">
                  Understood as: {predicted}
                </div>
              )}
              {docs && !error && (
                <div className="text-xs text-muted">
                  Using your uploaded documents
                </div>
              )}
              {!error &&
                (answer ? (
                  <Markdown text={answer} />
                ) : (
                  <div className="text-muted">Reading your question...</div>
                ))}
            </>
          )}
        </div>
        )}
      </div>
    );
  }

  /* ---------- inline fallback (no panel) ---------- */
  if (web) {
    return (
      <div className="max-w-3xl mx-auto rounded-2xl border border-line bg-bg px-4 py-3 flex items-center gap-2.5">
        <Globe size={16} className="shrink-0 text-accent" />
        <span>
          This needs current information - searching the web for it now...
        </span>
      </div>
    );
  }

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
