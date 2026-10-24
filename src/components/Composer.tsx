import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent } from "react";
import { ArrowUp, FileText, Globe, Loader2, Mic, Plus, RotateCcw, Smile, Square, User, X } from "lucide-react";
import Chip from "./Chip";
import type { Doc } from "../types";

interface Props {
  onSend: (text: string) => void;
  busy?: boolean;
  onStop?: () => void;
  onTextChange?: (text: string) => void;
  humanTone: boolean;
  answerAsMe: boolean;
  webSearch: boolean;
  onToggleTone: () => void;
  onToggleAsMe: () => void;
  onToggleWeb: () => void;
  /** voice typing: speak and the words land in the text box */
  dictating: boolean;
  dictText: string;
  onToggleDictation: () => void;
  docs: Doc[];
  onUpload: (files: File[]) => Promise<string | null>;
  onRemoveDoc: (id: string) => void;
  onRestoreDoc: (id: string) => void;
  /** new chat: the box floats centered in the middle of the screen */
  centered?: boolean;
}

const ACCEPT = ".pdf,.docx,.txt,.md,.markdown,.csv,.json,.log,.xml,.html,.htm";

export default function Composer({
  onSend,
  busy,
  onStop,
  onTextChange,
  humanTone,
  answerAsMe,
  webSearch,
  onToggleTone,
  onToggleAsMe,
  onToggleWeb,
  dictating,
  dictText,
  onToggleDictation,
  docs,
  onUpload,
  onRemoveDoc,
  onRestoreDoc,
  centered = false,
}: Props) {
  const [text, setText] = useState("");

  // Voice typing starts fresh: pressing the mic clears whatever is still in
  // the box (typed or dictated earlier), and every dictated phrase is written
  // into the empty box instead of being appended to old text.
  const wasDictating = useRef(false);
  useEffect(() => {
    if (dictating && !wasDictating.current) {
      setText(""); // a new mic press replaces the old text
      onTextChange?.("");
    }
    wasDictating.current = dictating;
    if (dictText) {
      setText(dictText);
      onTextChange?.(dictText);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dictating, dictText]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // the box grows with the text up to 3 lines, then scrolls inside itself
  const taRef = useRef<HTMLTextAreaElement>(null);
  const autosize = () => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    const lh = parseFloat(getComputedStyle(el).lineHeight);
    const line = Number.isFinite(lh) && lh > 0 ? lh : 24;
    const max = Math.round(line * 3 + 12); // 3 lines plus the vertical padding
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  };
  useLayoutEffect(autosize, [text]);

  const send = () => {
    const t = text.trim();
    if (!t || busy) return;
    onSend(t);
    setText("");
    onTextChange?.("");
  };

  const handleFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // allows picking the same file again
    if (files.length === 0) return;
    setUploading(true);
    setUploadError("");
    try {
      const err = await onUpload(files);
      if (err) setUploadError(err);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div
      className={
        centered
          ? "mx-auto w-full max-w-3xl rounded-2xl border border-line bg-panel px-3 pb-3 pt-2.5 shadow-lg shadow-black/5"
          : "bg-panel px-4 pb-4 pt-2"
      }
    >
      {docs.length > 0 && (
        <div className="max-w-3xl mx-auto mb-2 flex flex-wrap gap-1.5">
          {docs.map((d) => (
            <span
              key={d.id}
              title={
                d.archived
                  ? `${d.name} - kept as a source for this chat (click the arrow to attach again)`
                  : d.name
              }
              className={`flex items-center gap-1.5 max-w-45 pl-2 pr-1 py-1 rounded-md bg-bg border border-line text-xs text-muted ${
                d.archived ? "opacity-60" : ""
              }`}
            >
              <FileText size={13} className="shrink-0" />
              <span className="truncate">{d.name}</span>
              {d.archived ? (
                <button
                  onClick={() => onRestoreDoc(d.id)}
                  title="Attach again"
                  className="p-0.5 rounded-md text-muted hover:text-ink hover:bg-line"
                >
                  <RotateCcw size={12} />
                </button>
              ) : (
                <button
                  onClick={() => onRemoveDoc(d.id)}
                  title="Detach - stays a source for this chat"
                  className="p-0.5 rounded-md text-muted hover:text-ink hover:bg-line"
                >
                  <X size={12} />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      {uploadError && (
        <p className="max-w-3xl mx-auto mb-2 text-xs text-red-600 whitespace-pre-wrap">
          {uploadError}
        </p>
      )}
      <input
        ref={fileRef}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        onChange={handleFiles}
      />
      <div
        className={`max-w-3xl mx-auto flex items-center gap-2 rounded-md p-2.5 focus-within:border-muted/60 focus-within:ring-2 focus-within:ring-muted/15 ${
          centered
            ? "border border-transparent bg-bg/60"
            : "border border-line bg-panel/70 backdrop-blur-sm shadow-sm"
        }`}
      >
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          title="Upload documents"
          className="h-9 w-9 shrink-0 flex items-center justify-center rounded-md text-muted hover:bg-bg hover:text-accent disabled:opacity-60"
        >
          {uploading ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
        </button>
        <textarea
          ref={taRef}
          rows={1}
          value={text}
          placeholder={dictating ? "Listening... speak now" : "Ask anything..."}
          className="flex-1 resize-none outline-none bg-transparent px-2 leading-normal min-h-9 py-1.5"
          onChange={(e) => {
            setText(e.target.value);
            onTextChange?.(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button
          onClick={onToggleDictation}
          title={dictating ? "Stop voice typing" : "Voice typing - replaces whatever is in the box"}
          aria-pressed={dictating}
          className={`h-9 w-9 flex items-center justify-center rounded-full border transition-colors ${
            dictating
              ? "border-red-300 bg-red-50 text-red-600 animate-pulse dark:border-red-900/60 dark:bg-red-950/50"
              : "border-line text-muted hover:bg-bg hover:text-accent"
          }`}
        >
          {dictating ? <Square size={12} fill="currentColor" /> : <Mic size={18} />}
        </button>
        {busy ? (
          <button
            onClick={onStop}
            title="Stop"
            className="h-9 w-9 flex items-center justify-center rounded-full bg-ink text-panel hover:opacity-90"
          >
            <Square size={14} fill="currentColor" />
          </button>
        ) : (
          <button
            onClick={send}
            className="h-9 w-9 flex items-center justify-center rounded-full bg-accent text-panel hover:opacity-90"
          >
            <ArrowUp size={18} />
          </button>
        )}
      </div>

      <div className="max-w-3xl mx-auto mt-2 flex items-center gap-2">
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
          active={webSearch}
          label="Web search"
          title="Search the web for current questions (needs a Tavily key in Settings)"
          icon={<Globe size={14} />}
          onClick={onToggleWeb}
        />
      </div>
    </div>
  );
}
