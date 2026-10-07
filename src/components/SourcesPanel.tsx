import { Upload, X, FileText } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import type { Doc } from "../types";

interface Props {
  docs: Doc[];
  onAdd: (docs: Doc[]) => void;
  onRemove: (id: string) => void;
}

const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;

export default function SourcesPanel({ docs, onAdd, onRemove }: Props) {
  const pick = async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [{ name: "Documents", extensions: ["pdf", "txt", "md", "docx"] }],
      });
      if (!selected) return;
      onAdd(
        selected.map((path) => ({
          id: crypto.randomUUID(),
          name: fileName(path),
          path,
        }))
      );
    } catch (err) {
      console.error("File dialog failed:", err);
    }
  };

  return (
    <aside className="w-72 shrink-0 bg-panel border-l border-line flex flex-col">
      <div className="h-12 px-4 flex items-center border-b border-line font-semibold">
        Sources
      </div>
      <div className="p-3 border-b border-line">
        <button
          onClick={pick}
          className="w-full h-9 px-3 flex items-center gap-2 border border-line rounded-md hover:bg-bg"
        >
          <Upload size={16} /> Upload document
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {docs.length === 0 ? (
          <div className="p-2 text-muted">
            Uploaded documents for this session appear here.
          </div>
        ) : (
          docs.map((d) => (
            <div
              key={d.id}
              className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-bg"
            >
              <FileText size={16} className="shrink-0 text-muted" />
              <span className="flex-1 truncate" title={d.path}>
                {d.name}
              </span>
              <button
                onClick={() => onRemove(d.id)}
                title="Remove"
                className="p-1 rounded text-muted hover:text-ink hover:bg-line"
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