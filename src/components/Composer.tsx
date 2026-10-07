import { useState } from "react";
import { ArrowUp } from "lucide-react";

interface Props {
  onSend: (text: string) => void;
  onTextChange?: (text: string) => void; // used later by the live engine
}

export default function Composer({ onSend, onTextChange }: Props) {
  const [text, setText] = useState("");

  const send = () => {
    const t = text.trim();
    if (!t) return;
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
        <button
          onClick={send}
          className="h-9 w-9 flex items-center justify-center rounded-full bg-accent text-white hover:opacity-90"
        >
          <ArrowUp size={18} />
        </button>
      </div>
    </div>
  );
}