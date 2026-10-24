import { Briefcase, Globe, MicOff, Pause, Play, Smile, User } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Message, Preview } from "../types";
import type { VoiceState } from "../voice";
import Chip from "./Chip";
import VoiceBlob from "./VoiceBlob";
import Markdown from "./Markdown";

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

interface Props {
  voice: VoiceState;
  analyser: AnalyserNode | null;
  preview: Preview | null;
  last: Message | null; // latest assistant message of the chat
  humanTone: boolean;
  answerAsMe: boolean;
  interviewCoach: boolean;
  webSearch: boolean;
  onToggleTone: () => void;
  onToggleAsMe: () => void;
  onToggleInterviewCoach: () => void;
  onToggleWeb: () => void;
  onStop: () => void;
  onRetry: () => void;
  onOpenSettings: () => void;
  /** mic muted but voice mode stays open */
  paused: boolean;
  onPauseToggle: () => void;
}

export default function VoiceMode({
  voice,
  analyser,
  preview,
  last,
  humanTone,
  answerAsMe,
  interviewCoach,
  webSearch,
  onToggleTone,
  onToggleAsMe,
  onToggleInterviewCoach,
  onToggleWeb,
  onStop,
  onRetry,
  onOpenSettings,
  paused,
  onPauseToggle,
}: Props) {
  const isError = voice.phase === "error";
  const stopped = voice.phase === "stopped";
  const hearing = voice.hearing || !!voice.transcript;

  const status = isError
    ? "Not listening"
    : voice.phase === "connecting"
      ? "Connecting..."
      : voice.phase === "reconnecting"
        ? "Reconnecting..."
        : paused
          ? "Paused"
          : stopped
            ? "Not listening"
            : hearing
              ? "Hearing you..."
              : voice.answering
                ? "Answering..."
                : "Listening...";

  // while you speak, show the live draft; otherwise the finished answer
  const liveAnswer = preview && !preview.web ? preview.answer : "";
  const useLive = !!voice.transcript && !!liveAnswer;
  const needsWeb = !!voice.transcript && !!preview?.web;
  const answer = useLive ? liveAnswer : last ? last.text || last.status || "" : "";
  const dim = !!voice.transcript && !useLive;
  const question = voice.transcript || voice.question;

  return (
    <div className="absolute inset-0 z-20 bg-panel flex">
      {/* the assistant effect has its own space on the left: centered and responsive */}
      <div className="relative w-[38%] min-w-55 max-w-107.5 shrink-0 flex items-center justify-center bg-bg/40">
        {/* the divider only spans the height of the visualization */}
        <span
          aria-hidden
          className="pointer-events-none absolute right-0 top-1/2 h-80 xl:h-96 -translate-y-1/2 w-px bg-line"
        />
        <div className="w-[clamp(8.5rem,18vw,16rem)] aspect-square">
          <VoiceBlob
            analyser={isError ? null : analyser}
            hearing={hearing && !paused && !isError}
            paused={paused && !isError}
          />
        </div>
      </div>

      <div className="flex-1 min-w-0 flex flex-col">
      <div className="h-12 px-5 flex items-center justify-between border-b border-line shrink-0">
        <div className="flex items-center gap-2 text-sm font-medium">
          <span
            className={`h-2 w-2 rounded-full ${isError
                ? "bg-red-500"
                : paused
                  ? "bg-amber-500"
                  : stopped
                    ? "bg-muted"
                    : "bg-green-500 animate-pulse"
              }`}
          />
          {status}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={stopped ? onRetry : onPauseToggle}
            disabled={isError}
            title={
              stopped
                ? "Start listening"
                : paused
                  ? "Start listening again"
                  : "Pause temporarily"
            }
            className="h-8 px-2.5 flex items-center gap-1.5 rounded-lg border border-line bg-panel text-xs font-medium hover:bg-bg disabled:opacity-40 transition-colors"
          >
            {stopped || paused ? <Play size={13} /> : <Pause size={13} />}
            {stopped || paused ? "Start" : "Pause"}
          </button>
          <button
            onClick={onStop}
            title="Stop listening"
            className="h-8 px-2.5 flex items-center gap-1.5 rounded-lg border border-line bg-panel text-xs font-medium text-muted hover:bg-bg hover:text-red-600 hover:border-red-300 transition-colors"
          >
            <MicOff size={13} /> Stop listening
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pt-4 pb-2">
        <div className="max-w-2xl mx-auto">
          <div className="min-h-12 mb-2 text-center text-base text-muted">
            {question ||
              (isError
                ? ""
                : stopped
                  ? "Press Start to listen."
                  : "Ask me anything. I answer as you speak.")}
          </div>
          {isError && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-red-700">
              <p className="whitespace-pre-wrap">{voice.error}</p>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={onRetry}
                  className="h-9 px-4 rounded-xl bg-red-600 text-white hover:opacity-90"
                >
                  Try again
                </button>
                <button
                  onClick={onOpenSettings}
                  className="h-9 px-4 rounded-xl border border-red-200 hover:bg-white"
                >
                  Open settings
                </button>
              </div>
            </div>
          )}

          {!isError && needsWeb && (
            <div className="mb-3 flex items-center gap-2.5 rounded-2xl border border-line bg-bg px-4 py-3">
              <Globe size={16} className="shrink-0 text-accent" />
              This needs current information. I will search the web when you finish.
            </div>
          )}

          {!isError && answer && (
            <div className={`transition-opacity ${dim ? "opacity-50" : ""}`}>
              <div
                className={`rounded-2xl px-6 py-5 text-base ${last?.error && !useLive ? "bg-red-50 text-red-700" : "bg-bg text-ink"
                  }`}
              >
                {last?.error && !useLive ? answer : <Markdown text={answer} />}
              </div>
              {!useLive && last?.source && last.source !== "general" && (
                <div className="mt-2 ml-1 flex flex-wrap items-center gap-1.5">
                  <span className="px-2 py-0.5 text-xs rounded-full border border-line text-muted">
                    {last.source === "web" ? "From web" : "From documents"}
                  </span>
                  {last.refs?.map((r) => (
                    <button
                      key={r.url}
                      title={r.title}
                      onClick={() => openUrl(r.url).catch(console.error)}
                      className="px-2 py-0.5 max-w-45 truncate text-xs rounded-full bg-accent-soft text-accent hover:underline"
                    >
                      {host(r.url)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="px-4 pb-4 pt-2 flex items-center justify-center gap-2 shrink-0">
        <Chip
          active={humanTone}
          label="Human tone"
          title="Answer like a real person, not like an AI"
          icon={<Smile size={14} />}
          onClick={onToggleTone}
        />
        <Chip
          active={answerAsMe}
          label="Answer as me"
          title="Reply in the first person, as you, using About me"
          icon={<User size={14} />}
          onClick={onToggleAsMe}
        />
        <Chip
          active={interviewCoach}
          label="Interview coach"
          title="Answer as Thanseem for entry-level IT support interviews"
          icon={<Briefcase size={14} />}
          onClick={onToggleInterviewCoach}
        />
        <Chip
          active={webSearch}
          label="Web search"
          title="Search the web for current questions"
          icon={<Globe size={14} />}
          onClick={onToggleWeb}
        />
      </div>
      </div>
    </div>
  );
}