mod omniroute;
mod overlay;
mod speech;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(omniroute::OmniState::default())
        .manage(speech::SpeechState::default())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == overlay::LABEL {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    // however the popup closes (the cross button, Alt+F4):
                    // bring the main window back, then close the popup
                    api.prevent_close();
                    let handle = window.app_handle().clone();
                    speech::stop_source(&handle, "overlay");
                    overlay::restore_main(&handle);
                    let _ = window.destroy();
                }
            } else if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { .. } = event {
                    // the popup cannot answer on its own: closing the main
                    // window ends the app, so the popup goes with it
                    if let Some(w) = window.app_handle().get_webview_window(overlay::LABEL) {
                        let _ = w.destroy();
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            omniroute::start_omniroute,
            omniroute::omniroute_status,
            omniroute::stop_omniroute,
            overlay::open_overlay,
            overlay::close_overlay,
            speech::speech_start,
            speech::speech_stop
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                omniroute::stop(&app.state::<omniroute::OmniState>());
                speech::stop(app);
            }
        });
}