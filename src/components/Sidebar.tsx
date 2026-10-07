import { Plus, Trash2 } from "lucide-react";
import type { Session } from "../types";

interface Props {
  sessions: Session[];
  activeId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}

export default function Sidebar({ sessions, activeId, onSelect, onNew, onDelete }: Props) {
  return (
    <aside className="w-64 shrink-0 bg-panel border-r border-line flex flex-col">
      <div className="h-12 px-4 flex items-center border-b border-line font-semibold">
        Berzh AI
      </div>
      <div className="p-3">
        <button
          onClick={onNew}
          className="w-full h-10 px-3 flex items-center gap-2 border border-line rounded-xl hover:bg-bg"
        >
          <Plus size={16} /> New chat
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 pb-2 space-y-1">
        {sessions.map((s) => {
          const isActive = s.id === activeId;
          return (
            <div
              key={s.id}
              className={`group flex items-center rounded-lg ${
                isActive ? "bg-accent-soft" : "hover:bg-bg"
              }`}
            >
              <button
                onClick={() => onSelect(s.id)}
                className={`flex-1 min-w-0 text-left px-3 py-2 truncate ${
                  isActive ? "text-accent font-medium" : ""
                }`}
              >
                {s.title}
              </button>
              <button
                onClick={() => onDelete(s.id)}
                title="Delete chat"
                className="mr-1 p-1.5 rounded-md text-muted opacity-0 group-hover:opacity-100 hover:text-red-600 hover:bg-white"
              >
                <Trash2 size={15} />
              </button>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}