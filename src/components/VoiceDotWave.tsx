import type { CSSProperties } from "react";

/**
 * Dot wave activity animation used by the Voice Assistant while it is listening.
 *
 * A small row of dots chases itself, each lane kept in place, instead of
 * inflating or shrinking like the old orb. It only plays the wave while the
 * assistant is actually hearing you; everything else sits still.
 */
export default function VoiceDotWave({
  hearing,
}: {
  hearing: boolean;
}) {
  const lanes = Array.from({ length: 5 }, (_, i) => i);
  return (
    <div className="flex items-center justify-center gap-2 py-2">
      {lanes.map((i) => (
        <span
          key={i}
          className={`h-2 w-2 rounded-full ${i === 2 ? "bg-accent" : "bg-line"}`}
          style={
            {
              backgroundColor: i === 2 ? "#17171a" : "var(--color-line)",
              boxShadow: i === 2 ? "0 0 0 3px rgba(23,23,26,0.12), 0 0 14px rgba(23,23,26,0.28)" : "none",
              animation: hearing ? `dot-wave 1.1s ease-in-out ${i * 0.16}s infinite` : "none",
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
