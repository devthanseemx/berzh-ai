import { Download } from "lucide-react";
import type { UpdateUi } from "../updater";

interface Props {
  upd: UpdateUi;
  onInstall: () => void;
  onLater: () => void;
}

export default function UpdateBanner({ upd, onInstall, onLater }: Props) {
  const busy = upd.status === "downloading" || upd.status === "installing";

  return (
    <div className="fixed bottom-4 right-4 z-40 w-85 rounded-2xl border border-line bg-white shadow-xl p-4 fade-in">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 h-8 w-8 shrink-0 rounded-full bg-accent-soft text-accent flex items-center justify-center">
          <Download size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold">Update available</div>
          <div className="text-xs text-muted">Version {upd.version}</div>

          {!busy && upd.notes && (
            <p className="mt-2 text-sm text-muted line-clamp-4 whitespace-pre-wrap">
              {upd.notes}
            </p>
          )}

          {busy && (
            <div className="mt-3">
              <div className="h-1.5 rounded-full bg-bg overflow-hidden">
                <div
                  className="h-full bg-accent transition-all"
                  style={{ width: `${upd.status === "installing" ? 100 : upd.progress ?? 0}%` }}
                />
              </div>
              <div className="mt-1.5 text-xs text-muted">
                {upd.status === "installing"
                  ? "Installing. The app will restart."
                  : `Downloading... ${upd.progress ?? 0}%`}
              </div>
            </div>
          )}

          {upd.status === "error" && (
            <p className="mt-2 text-xs text-red-600">{upd.error}</p>
          )}
        </div>
      </div>

      {!busy && (
        <div className="mt-3 flex justify-end gap-2">
          <button
            onClick={onLater}
            className="h-9 px-4 rounded-xl border border-line hover:bg-bg"
          >
            Later
          </button>
          <button
            onClick={onInstall}
            className="h-9 px-4 rounded-xl bg-accent text-white hover:opacity-90"
          >
            {upd.status === "error" ? "Try again" : "Update now"}
          </button>
        </div>
      )}
    </div>
  );
}