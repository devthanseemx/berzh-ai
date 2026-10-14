import logo from "../assets/logo.svg";

export type StepState = "pending" | "active" | "done" | "skipped" | "failed";

export interface Step {
  id: string;
  label: string;
  state: StepState;
}

/** Shown while the app starts. Never blocks: a failed step is reported as a
 * toast after the home screen appears, and the loading always continues. */
export default function Splash() {
  return (
    <div
      data-tauri-drag-region
      className="h-screen flex flex-col items-center justify-center px-6 bg-gradient-to-b from-panel to-bg"
    >
      {/* the logo sits on a small tile so it reads in both themes */}
      <div
        data-tauri-drag-region
        className="p-3.5 rounded-2xl bg-white shadow-lg shadow-black/10 ring-1 ring-black/5"
      >
        <img src={logo} alt="Berzh AI" className="h-16 w-16" draggable={false} />
      </div>
      <h1 data-tauri-drag-region className="mt-5 text-lg font-semibold tracking-tight">
        Berzh AI
      </h1>

      <div className="mt-6 splash-bar" aria-label="Starting" />
    </div>
  );
}
