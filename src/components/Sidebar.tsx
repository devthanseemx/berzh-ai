import { useLayoutEffect, useRef, useState } from "react";
import { Gauge, Home, Mic, Moon, Pin, PictureInPicture2, Settings, SquarePen, Sun, Trash2, User, type LucideIcon } from "lucide-react";
import type { Session } from "../types";

interface RailProps {
  onNew: () => void;
  onOpenSettings: () => void;
  onOpenAccount: () => void;
  voiceActive: boolean;
  onStartVoice: () => void;
  onOpenOverlay: () => void;
  onOpenUsage: () => void;
  updateAvailable: boolean;
  settingsOpen: boolean;
  usageOpen: boolean;
  theme: "light" | "dark";
  onToggleTheme: () => void;
}

interface RecentsProps {
  sessions: Session[];
  activeId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onTogglePin: (id: string) => void;
  updateAvailable: boolean;
  onUpdateClick: () => void;
}

/** One icon button in the left activity rail. */
function RailButton({
  icon: Icon,
  label,
  onClick,
  active = false,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`w-10 h-10 flex items-center justify-center rounded-md transition-colors ${
        active
          ? "bg-accent text-panel shadow-sm"
          : "text-muted hover:text-ink hover:bg-panel"
      }`}
    >
      <Icon size={19} strokeWidth={2.2} />
    </button>
  );
}

/** Left icon rail - sits outside the main card. */
export function ActivityRail({
  onNew,
  onOpenSettings,
  onOpenAccount,
  onStartVoice,
  onOpenOverlay,
  onOpenUsage,
  voiceActive,
  updateAvailable,
  settingsOpen,
  usageOpen,
  theme,
  onToggleTheme,
}: RailProps) {
  const dark = theme === "dark";
  return (
    <nav className="w-14 shrink-0 my-2 flex flex-col items-center pt-10 pb-2 gap-1">
      <RailButton icon={Home} label="Home" onClick={onNew} active={!settingsOpen && !usageOpen && !voiceActive} />
      <RailButton
        icon={Mic}
        label={voiceActive ? "Voice mode (listening)" : "Voice mode"}
        onClick={onStartVoice}
        active={voiceActive}
      />
      <RailButton icon={PictureInPicture2} label="Quick assistant" onClick={onOpenOverlay} />
      <RailButton icon={Gauge} label="Usage & credits" onClick={onOpenUsage} active={usageOpen} />
      <RailButton icon={Settings} label="Settings" onClick={onOpenSettings} active={settingsOpen} />
      {updateAvailable && (
        <span
          className="w-2 h-2 rounded-full bg-amber-500"
          title="Update available"
        />
      )}
      <div className="flex-1" />
      <RailButton
        icon={dark ? Sun : Moon}
        label={dark ? "Switch to light theme" : "Switch to dark theme"}
        onClick={onToggleTheme}
      />
      <RailButton icon={User} label="Account" onClick={onOpenAccount} active={settingsOpen && false} />
    </nav>
  );
}

/** One chat row shared by the Pinned and Recents lists. */
function ChatRow({
  session,
  activeId,
  onSelect,
  onDelete,
  onTogglePin,
}: {
  session: Session;
  activeId: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onTogglePin: (id: string) => void;
}) {
  const isActive = session.id === activeId;
  return (
    <div
      className={`group flex items-center rounded-md ${isActive ? "bg-accent-soft" : "hover:bg-bg"}`}
    >
      <button
        onClick={() => onSelect(session.id)}
        className={`flex-1 min-w-0 text-left px-3 py-1.5 text-[13px] truncate ${isActive ? "text-accent font-medium" : ""}`}
      >
        {session.title}
      </button>
      <button
        onClick={() => onTogglePin(session.id)}
        title={session.pinned ? "Unpin chat" : "Pin chat"}
        className={`p-1.5 rounded-md text-muted opacity-0 group-hover:opacity-100 hover:text-ink hover:bg-panel ${
          session.pinned ? "opacity-100 text-accent" : ""
        }`}
      >
        <Pin size={14} className={session.pinned ? "fill-accent" : ""} />
      </button>
      <button
        onClick={() => onDelete(session.id)}
        title="Delete chat"
        className="mr-1 p-1.5 rounded-md text-muted opacity-0 group-hover:opacity-100 hover:text-red-600 hover:bg-panel"
      >
        <Trash2 size={15} />
      </button>
    </div>
  );
}

/** Section header inside the scrollable list, left-aligned with the chat titles. */
function ListLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pt-4 pb-1.5 text-xs font-bold text-ink/80">{children}</div>
  );
}

/** Recent-history column inside the main card. */
export default function RecentsPanel({
  sessions,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onTogglePin,
  updateAvailable,
  onUpdateClick,
}: RecentsProps) {
  // empty chats are not part of the history
  const visible = sessions.filter((s) => s.messages.length > 0 || s.docs.length > 0);
  const pinned = visible.filter((s) => s.pinned);
  const recents = visible.filter((s) => !s.pinned);

  // the divider between "New chat" and the history only shows when the list overflows
  const navRef = useRef<HTMLElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const check = () => setOverflowing(nav.scrollHeight > nav.clientHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(nav);
    return () => ro.disconnect();
  }, [visible.length]);

  return (
    <aside className="w-64 shrink-0 border-r border-line bg-panel flex flex-col">
      <div className="px-4 pt-3 pb-2">
        <span className="text-lg font-bold">Berzh AI</span>
      </div>
      <div className="px-2 pt-1 pb-2">
        <button
          onClick={onNew}
          title="New chat"
          className="w-full h-8 px-2 flex items-center gap-2 rounded-md text-sm text-left hover:bg-bg"
        >
          <SquarePen size={16} className="shrink-0 text-muted" /> New chat
        </button>
      </div>
      <div className={`mx-3 border-t border-line transition-opacity ${overflowing ? "opacity-100" : "opacity-0"}`} />
      <nav ref={navRef} className="flex-1 overflow-y-auto px-2 pt-1 pb-2 space-y-0.5">
        {visible.length === 0 && (
          <p className="px-3 py-2 text-xs text-muted">Your chats will appear here.</p>
        )}
        {pinned.length > 0 && (
          <>
            <ListLabel>Pinned</ListLabel>
            {pinned.map((s) => (
              <ChatRow
                key={s.id}
                session={s}
                activeId={activeId}
                onSelect={onSelect}
                onDelete={onDelete}
                onTogglePin={onTogglePin}
              />
            ))}
          </>
        )}
        {recents.length > 0 && (
          <>
            <ListLabel>Recents</ListLabel>
            {recents.map((s) => (
              <ChatRow
                key={s.id}
                session={s}
                activeId={activeId}
                onSelect={onSelect}
                onDelete={onDelete}
                onTogglePin={onTogglePin}
              />
            ))}
          </>
        )}
      </nav>
      <div className="px-3 py-2 flex items-center text-xs text-muted">
        {updateAvailable && (
          <button
            onClick={onUpdateClick}
            className="px-2 py-0.5 rounded-full bg-accent-soft text-accent font-medium hover:underline"
          >
            Update available
          </button>
        )}
      </div>
    </aside>
  );
}
