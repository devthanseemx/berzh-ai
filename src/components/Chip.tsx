import type { ReactNode } from "react";
import { Check } from "lucide-react";

export default function Chip({
  active,
  label,
  title,
  icon,
  onClick,
  compact = false,
}: {
  active: boolean;
  label: string;
  title: string;
  icon: ReactNode;
  onClick: () => void;
  compact?: boolean;
}) {
  const button = (
    <button
      type="button"
      title={title}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={`group flex items-center rounded-md border transition-colors ${
        compact
          ? "h-8 shrink-0 gap-1.5 whitespace-nowrap px-2"
          : "h-8 gap-1.5 whitespace-nowrap pl-2.5 pr-2"
      } ${
        active
          ? "border-emerald-600/50 bg-emerald-50 text-emerald-700 shadow-sm dark:bg-emerald-950/40 dark:text-emerald-400"
          : "border-line bg-panel text-muted hover:border-muted hover:text-ink"
      }`}
    >
      <span className={`shrink-0 ${active ? "text-emerald-600 dark:text-emerald-400" : "text-muted group-hover:text-ink"}`}>
        {icon}
      </span>
      <span className={compact ? "text-[11px]" : ""}>{label}</span>
      {!compact && (
        <span
          className={`ml-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full transition-colors ${
            active ? "bg-emerald-600 text-white" : "bg-transparent text-transparent"
          }`}
        >
          <Check size={10} strokeWidth={3} />
        </span>
      )}
    </button>
  );

  return button;
}
