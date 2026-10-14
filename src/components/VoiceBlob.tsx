import { useEffect, useRef } from "react";

export default function VoiceBlob({
  analyser,
  hearing,
  paused = false,
}: {
  analyser: AnalyserNode | null;
  hearing: boolean;
  /** paused state freezes the morphing effect and returns the blob to rest */
  paused?: boolean;
}) {
  const scaleRef = useRef<HTMLDivElement>(null);

  // the blob swells with the loudness of your voice
  useEffect(() => {
    if (!analyser) return;
    const data = new Uint8Array(analyser.fftSize);
    let raf = 0;
    let level = 0;

    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      const target = paused ? 0 : Math.min(1, rms * 6);
      level = level * 0.8 + target * 0.2;
      if (scaleRef.current) {
        scaleRef.current.style.transform = `scale(${1 + level * 0.45})`;
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [analyser, paused]);

  return (
    <div className={`h-full w-full flex items-center justify-center ${hearing ? "blob-fast" : ""}${paused ? " blob-paused" : ""}`}>
      <div ref={scaleRef} className="blob-wrap relative h-[78%] w-[78%] will-change-transform">
        <div className="blob blob-a" />
        <div className="blob blob-b" />
        <div className="blob blob-c" />
      </div>
    </div>
  );
}