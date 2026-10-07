import { Plus } from "lucide-react";
import type { Session } from "../types";

interface Props {
  sessions: Session[];
  activeId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
}

export default function Sidebar({ sessions, activeId, onSelect, onNew }: Props) {
  return (
    <aside className="w-64 shrink-0 bg-panel border-r border-line flex flex-col">
      <div className="h-12 px-4 flex items-center border-b border-line font-semibold">
        Berzh AI
      </div>
      <div className="p-3 border-b border-line">
        <button
          onClick={onNew}
          className="w-full h-9 px-3 flex items-center gap-2 border border-line hover:bg-bg"
        >
          <Plus size={16} /> New chat
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto p-2 space-y-1">
        {sessions.map((s) => (
          <button
            key={s.id}
            onClick={() => onSelect(s.id)}
            className={`w-full text-left px-3 py-2 truncate rounded-md ${s.id === activeId ? "bg-accent-soft text-accent font-medium" : "hover:bg-bg"
              }`}
          >
            {s.title}
          </button>
        ))}
      </nav>
    </aside>
  );
}