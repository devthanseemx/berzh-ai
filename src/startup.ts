import { invoke } from "@tauri-apps/api/core";
import { fetch } from "@tauri-apps/plugin-http";
import type { Settings } from "./settings";

interface OmniStatus {
  spawned: boolean;
  running: boolean;
  exit_code: number | null;
  stderr: string;
}

const WAIT_MS = 60_000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function isLocalUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]";
  } catch {
    return false;
  }
}

/** Any HTTP answer (even 401) means the server is up. */
export async function isReachable(baseUrl: string, timeoutMs = 1500): Promise<boolean> {
  const base = baseUrl.trim().replace(/\/+$/, "");
  if (!base) return false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(`${base}/models`, { signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export type OmniResult = "already-running" | "started" | "skipped";

export async function ensureOmniRoute(
  s: Settings,
  onWait: (seconds: number) => void
): Promise<OmniResult> {
  if (!s.omniAutoStart || !isLocalUrl(s.omniBaseUrl)) return "skipped";
  if (await isReachable(s.omniBaseUrl)) return "already-running";

  try {
    await invoke("start_omniroute", { command: s.omniCommand });
  } catch (e) {
    throw new Error(typeof e === "string" ? e : e instanceof Error ? e.message : String(e));
  }

  const began = Date.now();
  while (Date.now() - began < WAIT_MS) {
    await sleep(500);
    if (await isReachable(s.omniBaseUrl)) return "started";

    const st = await invoke<OmniStatus>("omniroute_status");
    if (st.spawned && !st.running) {
      const code = st.exit_code !== null ? ` (exit code ${st.exit_code})` : "";
      const detail = st.stderr.trim() ? `\n\n${st.stderr.trim()}` : "";
      throw new Error(
        `OmniRoute stopped right after starting${code}. Check the start command in Settings.${detail}`
      );
    }
    onWait(Math.round((Date.now() - began) / 1000));
  }
  throw new Error("OmniRoute did not answer within 60 seconds.");
}