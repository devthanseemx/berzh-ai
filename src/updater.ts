import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export interface UpdateUi {
  status:
    | "idle"
    | "checking"
    | "uptodate"
    | "available"
    | "downloading"
    | "installing"
    | "error";
  version?: string;
  notes?: string;
  progress?: number; // 0-100
  error?: string;
}

/** Returns the new version, or null when you are up to date. */
export async function checkForUpdate(): Promise<Update | null> {
  return check({ timeout: 15000 });
}

export async function installUpdate(
  update: Update,
  onProgress: (percent: number | null) => void
): Promise<void> {
  let total = 0;
  let done = 0;
  await update.downloadAndInstall((event) => {
    if (event.event === "Started") {
      total = event.data.contentLength ?? 0;
      done = 0;
      onProgress(total ? 0 : null);
    } else if (event.event === "Progress") {
      done += event.data.chunkLength;
      onProgress(total ? Math.min(100, Math.round((done / total) * 100)) : null);
    } else if (event.event === "Finished") {
      onProgress(100);
    }
  });
  await relaunch();
}