import { useEffect } from "react";
import { Trash2 } from "lucide-react";

interface Props {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  danger,
  onConfirm,
  onCancel,
}: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px]"
      onClick={onCancel}
    >
      <div
        className="w-96 bg-panel rounded-md border border-line shadow-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div
            className={`h-9 w-9 shrink-0 flex items-center justify-center rounded-md ${
              danger ? "bg-red-50 text-red-600" : "bg-accent-soft text-accent"
            }`}
          >
            {danger ? <Trash2 size={18} /> : null}
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold">{title}</h2>
            <p className="mt-1.5 text-sm text-muted leading-relaxed">{message}</p>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="h-9 px-4 rounded-md border border-line text-sm font-medium hover:bg-bg"
          >
            Cancel
          </button>
          <button
            autoFocus
            onClick={onConfirm}
            className={`h-9 px-4 rounded-md text-sm font-medium transition-opacity hover:opacity-90 ${
              danger
                ? "bg-red-600 text-white hover:bg-red-700"
                : "bg-accent text-panel hover:bg-accent/90"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
