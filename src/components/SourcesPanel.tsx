import { useRef, useState, type ChangeEvent } from "react";
import { FileText, Loader2, Upload, X } from "lucide-react";
import type { Doc } from "../types";

interface Props {
  docs: Doc[];
  onUpload: (files: File[]) => Promise<string | null>; // returns an error text, if any
  onRemove: (id: string) => void;
}

export default function SourcesPanel({ docs, onUpload, onRemove }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // allows picking the same file again
    if (files.length === 0) return;

    setLoading(true);
    setError("");
    try {
      const err = await onUpload(files);
      if (err) setError(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <aside className="w-72 shrink-0 bg-panel flex flex-col">
      <div className="px-3 pt-3 pb-1 flex items-center gap-1.5 text-xs font-medium text-muted uppercase tracking-wide shrink-0">
        <FileText size={12} /> Sources
      </div>

      <div className="px-3 pb-3">
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.docx,.txt,.md,.markdown,.csv,.json,.log,.xml,.html,.htm"
          className="hidden"
          onChange={handleFiles}
        />
        <button
          onClick={() => inputRef.current?.click()}
          disabled={loading}
          className="w-full h-10 px-3 flex items-center gap-2 border border-line rounded-md hover:bg-bg disabled:opacity-60"
        >
          {loading ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Upload size={16} />
          )}
          {loading ? "Reading files..." : "Upload document"}
        </button>
        {error && (
          <p className="mt-2 text-xs text-red-600 whitespace-pre-wrap">{error}</p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1">
        {docs.length === 0 ? (
          <div className="px-2 text-muted">
            Upload PDF, Word or text files. Answers use them first, then general
            knowledge.
          </div>
        ) : (
          docs.map((d) => (
            <div
              key={d.id}
              className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-bg"
            >
              <FileText size={16} className="shrink-0 text-muted" />
              <span className="flex-1 truncate" title={d.name}>
                {d.name}
              </span>
              <button
                onClick={() => onRemove(d.id)}
                title="Remove"
                className="p-1 rounded-md text-muted hover:text-ink hover:bg-line"
              >
                <X size={14} />
              </button>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}