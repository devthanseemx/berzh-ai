import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface SpeechEvents {
  /** the words being spoken right now (updates while you talk) */
  onPartial: (text: string) => void;
  /** a finished phrase - noise is already filtered out by Windows */
  onFinal: (text: string) => void;
  /** the session ended by itself and released the microphone */
  onStopped: () => void;
  onError: (message: string) => void;
}

/**
 * Starts Windows' own speech recognition (no API key, the engine Windows
 * itself uses) and streams its results into the given handlers.
 *
 * `source` tags every event, so the caller that started the session is the
 * only one that reacts to it - the main chat and the popup can both listen.
 *
 * The returned function stops the session and detaches the listeners.
 */
export async function startNativeSpeech(
  source: string,
  handlers: SpeechEvents,
): Promise<() => Promise<void>> {
  const un: UnlistenFn[] = [];
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    un.splice(0).forEach((stopListening) => {
      try {
        stopListening();
      } catch {
        /* listener is already gone */
      }
    });
  };
  let resolveStopped: () => void = () => {};
  const stopped = new Promise<void>((resolve) => {
    resolveStopped = resolve;
  });

  try {
    un.push(
      await listen<{ source: string; text: string }>("speech-partial", (e) => {
        if (e.payload.source === source) handlers.onPartial(e.payload.text);
      }),
    );
    un.push(
      await listen<{ source: string; text: string }>("speech-final", (e) => {
        if (e.payload.source === source) handlers.onFinal(e.payload.text);
      }),
    );
    un.push(
      await listen<{ source: string; listening: boolean }>("speech-state", (e) => {
        if (e.payload.source === source && !e.payload.listening) {
          try {
            handlers.onStopped();
          } finally {
            resolveStopped();
            cleanup();
          }
        }
      }),
    );
    un.push(
      await listen<{ source: string; message: string }>("speech-error", (e) => {
        if (e.payload.source === source) handlers.onError(e.payload.message);
      }),
    );
  } catch (e) {
    cleanup();
    throw e;
  }

  try {
    await invoke("speech_start", { source });
  } catch (e) {
    cleanup();
    throw e;
  }

  return async () => {
    let timeout: number | undefined;
    try {
      await invoke("speech_stop");
      await Promise.race([
        stopped,
        new Promise<void>((resolve) => {
          timeout = window.setTimeout(resolve, 1500);
        }),
      ]);
    } finally {
      if (timeout !== undefined) window.clearTimeout(timeout);
      cleanup();
    }
  };
}
