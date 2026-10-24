import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import OverlayWindow from "./components/OverlayWindow";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "./index.css";

// The floating quick assistant is a second window loading the same bundle:
// it renders only its own UI. Outside Tauri (a plain browser) ?overlay=1
// shows it for development.
const isOverlay = (() => {
  try {
    if (getCurrentWindow().label === "overlay") return true;
  } catch {
    /* not inside tauri */
  }
  return new URLSearchParams(window.location.search).get("overlay") === "1";
})();

if (isOverlay) document.documentElement.classList.add("overlay-window");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isOverlay ? <OverlayWindow /> : <App />}
  </React.StrictMode>,
);
