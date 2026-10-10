use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::State;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Default)]
pub struct OmniState {
    child: Mutex<Option<Child>>,
    stderr: Arc<Mutex<Vec<String>>>,
}

#[derive(Serialize)]
pub struct OmniStatus {
    spawned: bool,
    running: bool,
    exit_code: Option<i32>,
    stderr: String,
}

fn shell(command: &str) -> Command {
    #[cfg(windows)]
    {
        let mut c = Command::new("cmd");
        c.arg("/C").raw_arg(command);
        c.creation_flags(CREATE_NO_WINDOW);
        c
    }
    #[cfg(not(windows))]
    {
        let mut c = Command::new("sh");
        c.arg("-c").arg(command);
        c
    }
}

#[tauri::command]
pub fn start_omniroute(state: State<'_, OmniState>, command: String) -> Result<(), String> {
    let command = command.trim().to_string();
    if command.is_empty() {
        return Err("No OmniRoute start command is set. Add one in Settings.".into());
    }

    let mut guard = state.child.lock().map_err(|e| e.to_string())?;

    // already started by us and still alive
    if let Some(child) = guard.as_mut() {
        if matches!(child.try_wait(), Ok(None)) {
            return Ok(());
        }
    }
    if let Ok(mut buf) = state.stderr.lock() {
        buf.clear();
    }

    let mut cmd = shell(&command);
    cmd.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Could not start \"{command}\": {e}"))?;

    // keep the last error lines so the loading screen can show why it failed
    if let Some(err) = child.stderr.take() {
        let buf = Arc::clone(&state.stderr);
        std::thread::spawn(move || {
            for chunk in BufReader::new(err).split(b'\n').map_while(Result::ok) {
                let line = String::from_utf8_lossy(&chunk).trim_end().to_string();
                if let Ok(mut b) = buf.lock() {
                    b.push(line);
                    if b.len() > 30 {
                        b.remove(0);
                    }
                }
            }
        });
    }

    *guard = Some(child);
    Ok(())
}

#[tauri::command]
pub fn omniroute_status(state: State<'_, OmniState>) -> OmniStatus {
    let mut guard = state.child.lock().unwrap();
    let spawned = guard.is_some();
    let (running, exit_code) = match guard.as_mut() {
        None => (false, None),
        Some(child) => match child.try_wait() {
            Ok(None) => (true, None),
            Ok(Some(status)) => (false, status.code()),
            Err(_) => (false, None),
        },
    };
    let stderr = state.stderr.lock().map(|b| b.join("\n")).unwrap_or_default();
    OmniStatus {
        spawned,
        running,
        exit_code,
        stderr,
    }
}

/// Stops the server only if this app started it (kills the whole process tree).
pub fn stop(state: &OmniState) {
    if let Ok(mut guard) = state.child.lock() {
        if let Some(mut child) = guard.take() {
            #[cfg(windows)]
            {
                let mut k = Command::new("taskkill");
                k.args(["/PID", &child.id().to_string(), "/T", "/F"]);
                k.creation_flags(CREATE_NO_WINDOW);
                let _ = k.status();
            }
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[tauri::command]
pub fn stop_omniroute(state: State<'_, OmniState>) {
    stop(&state);
}