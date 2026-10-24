
export type VoiceStatus = "connecting" | "listening" | "reconnecting" | "stopped";

export interface VoiceState {
  phase: VoiceStatus | "error";
  hearing: boolean; // speech is happening right now
  transcript: string; // what is being said right now
  question: string; // the last finished question
  answering: boolean; // an answer is being written - the mic stays muted until it is done
  error: string;
}

export interface VoiceHandlers {
  onStatus: (s: VoiceStatus) => void;
  onSpeech: (hearing: boolean) => void;
  onUtteranceStart: () => void;
  onTranscript: (text: string) => void;
  onUtteranceEnd: (text: string) => void;
  onError: (message: string) => void;
}

export interface VoiceSession {
  analyser: AnalyserNode;
  stop: () => Promise<void>;
  /** temporarily mute the microphone so nothing is transcribed until resumed */
  setPaused: (paused: boolean) => void;
}

export function describeMicError(e: unknown): string {
  const name = e instanceof DOMException ? e.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Microphone access is blocked. Allow it when Windows asks, or turn it on under Settings > Privacy & security > Microphone (including for desktop apps), then try again.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No microphone was found. Plug one in and try again.";
  }
  if (name === "NotReadableError") {
    return "The microphone is being used by another app.";
  }
  return e instanceof Error ? e.message : String(e);
}

export async function startVoice(
  opts: { apiKey: string; language: string },
  h: VoiceHandlers
): Promise<VoiceSession> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });

  let ctx: AudioContext;
  let analyser: AnalyserNode;
  try {
    ctx = new AudioContext();
    if (ctx.state === "suspended") await ctx.resume();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(analyser);
  } catch (e) {
    stream.getTracks().forEach((track) => track.stop());
    throw e;
  }

  let stopped = false;
  let socket: WebSocket | null = null;
  let recorder: MediaRecorder | null = null;
  let shutdownPromise: Promise<void> | null = null;
  let keepAlive: number | undefined;
  let retries = 0;
  let everOpened = false;
  let finals: string[] = [];
  let interim = "";
  let lastUtterance = "";

  const current = () => [...finals, interim].filter(Boolean).join(" ").trim();
  const finishUtterance = (fallback = "") => {
    const text = current() || fallback.trim();
    finals = [];
    interim = "";
    h.onSpeech(false);
    if (!text || text === lastUtterance) return;
    lastUtterance = text;
    h.onTranscript(text);
    h.onUtteranceEnd(text);
  };

  const stopRecorder = () => {
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        /* ignore */
      }
    }
    recorder = null;
  };

  const shutdown = () => {
    if (shutdownPromise) return shutdownPromise;
    stopped = true;
    window.clearInterval(keepAlive);
    const ws = socket;
    shutdownPromise = new Promise<void>((resolve) => {
      const closeSocket = () => {
        try {
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "CloseStream" }));
            window.setTimeout(() => {
              ws.close();
              resolve();
            }, 1000);
          } else {
            ws?.close();
            resolve();
          }
        } catch {
          ws?.close();
          resolve();
        }
        stream.getTracks().forEach((t) => t.stop());
        void ctx.close().catch((e) => {
          console.warn("Could not close the microphone audio context:", e);
        });
      };

      if (recorder && recorder.state !== "inactive") {
        const activeRecorder = recorder;
        recorder = null;
        activeRecorder.addEventListener("stop", closeSocket, { once: true });
        try {
          activeRecorder.stop();
        } catch {
          closeSocket();
        }
      } else {
        stopRecorder();
        closeSocket();
      }
    });
    return shutdownPromise;
  };

  const connect = () => {
    h.onStatus(everOpened ? "reconnecting" : "connecting");

    const params = new URLSearchParams({
      model: "nova-3",
      language: opts.language || "en",
      smart_format: "true",
      interim_results: "true",
      endpointing: "300",
      utterance_end_ms: "1000",
      vad_events: "true",
    });
    let ws: WebSocket;
    try {
      ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, [
        "token",
        opts.apiKey.trim(),
      ]);
    } catch (e) {
      h.onError(`Could not connect to Deepgram: ${describeMicError(e)}`);
      void shutdown();
      return;
    }
    socket = ws;

    ws.onopen = () => {
      everOpened = true;
      retries = 0;
      try {
        const mime = [
          "audio/webm;codecs=opus",
          "audio/ogg;codecs=opus",
          "audio/mp4",
        ].find((candidate) => MediaRecorder.isTypeSupported(candidate));
        const rec = mime
          ? new MediaRecorder(stream, { mimeType: mime })
          : new MediaRecorder(stream);
        recorder = rec;
        let reportedListening = false;
        rec.ondataavailable = (e) => {
          if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) {
            ws.send(e.data);
            if (!reportedListening) {
              reportedListening = true;
              h.onStatus("listening");
            }
          }
        };
        rec.onerror = () => {
          if (stopped) return;
          h.onError("The microphone could not record audio. Check microphone permissions and try again.");
          void shutdown();
        };
        rec.start(100);

        window.clearInterval(keepAlive);
        keepAlive = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "KeepAlive" }));
          }
        }, 5000);
      } catch (e) {
        h.onError(`Could not start microphone recording: ${describeMicError(e)}`);
        void shutdown();
      }
    };

    ws.onmessage = (ev) => {
      if (typeof ev.data !== "string") return;
      let msg: any;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }

      if (msg.type === "Results") {
        const text: string = msg.channel?.alternatives?.[0]?.transcript ?? "";
        if (msg.is_final) {
          if (text) finals.push(text);
          interim = "";
        } else {
          interim = text;
        }
        const now = current();
        if (now) {
          h.onSpeech(true);
          h.onTranscript(now);
        }
        if (msg.speech_final) finishUtterance(text);
      } else if (msg.type === "SpeechFinal") {
        const text: string = msg.channel?.alternatives?.[0]?.transcript ?? "";
        finishUtterance(text);
      } else if (msg.type === "SpeechStarted") {
        lastUtterance = "";
        h.onSpeech(true);
        h.onUtteranceStart();
      } else if (msg.type === "UtteranceEnd") {
        finishUtterance();
      }
    };

    ws.onclose = (event) => {
      window.clearInterval(keepAlive);
      stopRecorder();
      if (stopped) return;

      retries++;
      if (!everOpened && retries >= 2) {
        shutdown();
        h.onError(
          `Deepgram closed the connection before starting (code ${event.code}). ` +
            "Check the API key, Deepgram project access, and internet connection.",
        );
        return;
      }
      if (retries > 6) {
        shutdown();
        h.onError("Lost the connection to Deepgram.");
        return;
      }
      window.setTimeout(() => {
        if (!stopped) connect();
      }, Math.min(500 * retries, 3000));
    };
  };

  let paused = false;
  const setPaused = (p: boolean) => {
    if (paused === p || stopped) return;
    paused = p;
    // a disabled track sends silence, so Deepgram transcribes nothing
    stream.getAudioTracks().forEach((t) => (t.enabled = !p));
    if (recorder) {
      try {
        if (p && recorder.state === "recording") recorder.pause();
        if (!p && recorder.state === "paused") recorder.resume();
      } catch {
        /* ignore */
      }
    }
    if (p) h.onSpeech(false);
  };

  connect();
  return { analyser, stop: shutdown, setPaused };
}