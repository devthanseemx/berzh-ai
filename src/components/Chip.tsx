import type { ReactNode } from "react";
import { Check } from "lucide-react";

export default function Chip({
  active,
  label,
  title,
  icon,
  onClick,
}: {
  active: boolean;
  label: string;
  title: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      onClick={onClick}
      className={`group h-8 pl-2.5 pr-2 flex items-center gap-1.5 rounded-md border text-xs whitespace-nowrap transition-colors ${
        active
          ? "border-emerald-600/50 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 font-medium shadow-sm"
          : "border-line bg-panel text-muted hover:border-muted hover:text-ink"
      }`}
    >
      <span className={active ? "text-emerald-600 dark:text-emerald-400" : "text-muted group-hover:text-ink"}>
        {icon}
      </span>
      {label}
      <span
        className={`ml-0.5 h-3.5 w-3.5 flex items-center justify-center rounded-full transition-colors ${
          active ? "bg-emerald-600 text-white" : "bg-transparent text-transparent"
        }`}
      >
        <Check size={10} strokeWidth={3} />
      </span>
    </button>
  );
}
