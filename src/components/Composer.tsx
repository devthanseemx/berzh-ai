import { useState } from "react";
import { ArrowUp, Smile, Square, User } from "lucide-react";

interface Props {
  onSend: (text: string) => void;
  busy?: boolean;
  onStop?: () => void;
  onTextChange?: (text: string) => void;
  humanTone: boolean;
  answerAsMe: boolean;
  onToggleTone: () => void;
  onToggleAsMe: () => void;
}

function Chip({
  active,
  label,
  title,
  icon,
  onClick,
}: {
  active: boolean;
  label: string;
  title: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      onClick={onClick}
      className={`h-7 px-3 flex items-center gap-1.5 rounded-full border text-xs ${
        active
          ? "border-accent bg-accent-soft text-accent font-medium"
          : "border-line text-muted hover:bg-bg"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

export default function Composer({
  onSend,
  busy,
  onStop,
  onTextChange,
  humanTone,
  answerAsMe,
  onToggleTone,
  onToggleAsMe,
}: Props) {
  const [text, setText] = useState("");

  const send = () => {
    const t = text.trim();
    if (!t || busy) return;
    onSend(t);
    setText("");
    onTextChange?.("");
  };

  return (
    <div className="bg-white px-4 pb-4 pt-2">
      <div className="max-w-3xl mx-auto flex items-end gap-2 border border-line focus-within:border-accent rounded-2xl p-2.5 shadow-sm">
        <textarea
          rows={2}
          value={text}
          placeholder="Ask anything..."
          className="flex-1 resize-none outline-none bg-transparent px-2"
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
        {busy ? (
          <button
            onClick={onStop}
            title="Stop"
            className="h-9 w-9 flex items-center justify-center rounded-full bg-ink text-white hover:opacity-90"
          >
            <Square size={14} fill="currentColor" />
          </button>
        ) : (
          <button
            onClick={send}
            className="h-9 w-9 flex items-center justify-center rounded-full bg-accent text-white hover:opacity-90"
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
      </div>
    </div>
  );
}