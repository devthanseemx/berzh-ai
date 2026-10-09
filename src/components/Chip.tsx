import type { ReactNode } from "react";

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