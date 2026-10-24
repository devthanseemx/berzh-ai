//! The floating "Quick Assistant" popup: an always-on-top glass window.
//!
//! Opening it minimizes the main window; the popup stays above every other
//! application and answers come from the main window (which owns the settings,
//! the web search and the model connection) streamed over events.
//! Closing it - with the cross button or Alt+F4 - brings the main window back.

use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub const LABEL: &str = "overlay";

/// Opens the popup (or focuses it if it is already open) and minimizes the
/// main window so only the popup is visible.
///
/// The popup is built hidden and revealed from `on_page_load` once its
/// WebView2 has finished loading. Two Windows-specific reasons drive that:
/// calling `show()` straight after `build()` can run before the native
/// window exists (tauri-apps/tauri discussion #11493), and creating a
/// `WebviewWindow` inside a synchronous command can deadlock on Windows, so
/// this command must be async.
#[tauri::command]
pub async fn open_overlay(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        return Ok(());
    }

    // The window itself is transparent: the page paints its own translucent
    // gradient and glass panel, so the desktop shows through around and
    // behind them. Transparency is only safe because the popup is revealed
    // from `on_page_load` - a transparent window whose WebView2 renderer has
    // not started yet is what used to render as a blank white panel.
    WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::App("index.html".into()))
        .title("Quick Assistant")
        .inner_size(860.0, 640.0)
        .min_inner_size(600.0, 400.0)
        .decorations(false)
        .shadow(false) // no square DWM outline around a rounded panel: it
        // drew visible lines at the four corners of the glass
        .always_on_top(true) // stays above every other application
        .transparent(true) // the desktop shows through the page's glass
        .visible(false) // revealed once the WebView2 renderer is up
        .center()
        .on_page_load(move |window, payload| {
            if matches!(payload.event(), PageLoadEvent::Finished) {
                let _ = window.show();
                let _ = window.set_focus();
                // hide the main window now that the popup is on screen
                if let Some(main) = window.app_handle().get_webview_window("main") {
                    let _ = main.minimize();
                }
            }
        })
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Closes the popup and brings the main window back.
#[tauri::command]
pub fn close_overlay(app: AppHandle) {
    crate::speech::stop_source(&app, "overlay");
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.destroy();
    }
    restore_main(&app);
}

/// Shows the main window again - used whenever the popup closes (the cross
/// button, Alt+F4).
pub fn restore_main(app: &AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.unminimize();
        let _ = main.set_focus();
    }
}
