//! Speech-to-text using the recognizer that is built into Windows - the same
//! engine Windows itself uses for voice typing (Win+H) and Voice Access.
//! No API key is needed and it hears far better than a raw microphone stream.
//!
//! A dedicated thread owns the WinRT session and streams final results to the
//! windows as events. Only one session can hold the microphone, and it is
//! tagged with the `source` that started it ("composer" for the main chat's
//! text box, "overlay" for the floating popup) so that only the caller reacts.

use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::json;
use tauri::{AppHandle, Emitter, Manager};
use windows::Foundation::TypedEventHandler;
use windows::Media::SpeechRecognition::{
    SpeechContinuousRecognitionResultGeneratedEventArgs, SpeechContinuousRecognitionSession,
    SpeechRecognitionHypothesisGeneratedEventArgs, SpeechRecognitionResultStatus,
    SpeechRecognitionScenario, SpeechRecognitionTopicConstraint, SpeechRecognizer,
    SpeechRecognizerStateChangedEventArgs,
};

/// HRESULT 0x80045509 (`HResultPrivacyStatementDeclined`): Windows refuses to
/// recognize anything until the user accepts its speech privacy statement in
/// Settings. Only the user can accept that, so the code is translated into a
/// sentence and `run` opens the matching Settings page for them.
const HR_PRIVACY_DECLINED: i32 = 0x8004_5509u32 as i32;

/// What the user reads when Windows blocks on that consent.
const PRIVACY_HELP: &str = "Windows hasn't been allowed to hear you yet: I'm opening Settings > Privacy & security > Speech. Turn on \"Online speech recognition\", then allow microphone access for desktop apps under Microphone settings and press the mic again.";

fn privacy_declined(e: &windows::core::Error) -> bool {
    e.code().0 == HR_PRIVACY_DECLINED
}

#[derive(Default)]
pub struct SpeechState {
    worker: Mutex<Option<Worker>>,
}

/// The one running recognition session (there is only ever one microphone).
struct Worker {
    source: String,          // which caller started it
    stop: Arc<AtomicBool>,   // ask the worker to clean up and exit
    joined: Arc<AtomicBool>, // the worker has fully exited
}

/// Starts (or restarts) speech-to-text for the given caller.
#[tauri::command]
pub fn speech_start(app: AppHandle, source: String) -> Result<(), String> {
    let source = source.trim().to_string();
    if source.is_empty() {
        return Err("speech_start needs a source.".into());
    }

    let previous = {
        let state = app.state::<SpeechState>();
        let slot = state.worker.lock();
        let mut slot = slot.map_err(|e| e.to_string())?;
        slot.take()
    };

    // only one session can use the microphone: stop the previous one first
    if let Some(prev) = previous {
        prev.stop.store(true, Ordering::SeqCst);
        for _ in 0..150 {
            if prev.joined.load(Ordering::SeqCst) {
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        if !prev.joined.load(Ordering::SeqCst) {
            return Err("The previous speech session did not release the microphone.".into());
        }
    }

    let stop = Arc::new(AtomicBool::new(false));
    let joined = Arc::new(AtomicBool::new(false));
    {
        let state = app.state::<SpeechState>();
        let mut slot = state.worker.lock().map_err(|e| e.to_string())?;
        *slot = Some(Worker {
            source: source.clone(),
            stop: stop.clone(),
            joined: joined.clone(),
        });
    }

    std::thread::spawn(move || run(app, source, stop, joined));
    Ok(())
}

/// Stops the running session, if there is one.
#[tauri::command]
pub fn speech_stop(app: AppHandle) -> Result<(), String> {
    let state = app.state::<SpeechState>();
    let mut slot = state.worker.lock().map_err(|e| e.to_string())?;
    if let Some(worker) = slot.as_ref() {
        worker.stop.store(true, Ordering::SeqCst);
        for _ in 0..150 {
            if worker.joined.load(Ordering::SeqCst) {
                slot.take();
                return Ok(());
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        return Err("Timed out while stopping Windows speech recognition.".into());
    }

    Ok(())
}

pub fn stop(app: &AppHandle) {
    let state = app.state::<SpeechState>();
    let slot = state.worker.lock();
    if let Ok(mut slot) = slot {
        if let Some(w) = slot.take() {
            w.stop.store(true, Ordering::SeqCst);
        }
    }
}

/// Stops the session only if it belongs to the given caller (window).
pub fn stop_source(app: &AppHandle, source: &str) {
    let state = app.state::<SpeechState>();
    let slot = state.worker.lock();
    if let Ok(mut slot) = slot {
        let mine = matches!(slot.as_ref(), Some(w) if w.source == source);
        if mine {
            if let Some(w) = slot.take() {
                w.stop.store(true, Ordering::SeqCst);
            }
        }
    }
}

fn run(app: AppHandle, source: String, stop: Arc<AtomicBool>, joined: Arc<AtomicBool>) {
    if let Err(msg) = recognize(&app, &source, &stop) {
        if msg == PRIVACY_HELP {
            // the fix is a single toggle in Settings - take the user there
            open_speech_privacy_settings();
        }
        let _ = app.emit("speech-error", json!({ "source": source, "message": msg }));
    }
    let _ = app.emit("speech-state", json!({ "source": source, "listening": false }));
    joined.store(true, Ordering::SeqCst);
}

/// The recognition loop: create the recognizer, listen until `stop` is set.
///
/// The WinRT async operations here are "hot start" (already running by the
/// time we get them); we drive them to completion on this dedicated thread
/// with `block_on` rather than a blocking `.get()` (which windows 0.62 no
/// longer provides).
fn recognize(app: &AppHandle, source: &str, stop: &AtomicBool) -> Result<(), String> {
    // WinRT needs an initialized COM apartment on this thread
    unsafe {
        use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
        CoInitializeEx(None, COINIT_MULTITHREADED)
            .ok()
            .map_err(|e| format!("Could not initialize Windows speech recognition: {e}"))?;
    }

    let recognizer = SpeechRecognizer::new().map_err(|e| {
        if privacy_declined(&e) {
            return PRIVACY_HELP.to_string();
        }
        format!(
            "Windows speech recognition is not available: {e}. \
             Make sure a speech language is installed (Settings > Time & language > Speech) \
             and that microphone access is allowed for desktop apps \
             (Settings > Privacy & security > Microphone)."
        )
    })?;

    // the recognizer's own state machine: Listening -> SoundStopped etc.
    // tells us whether Windows heard anything at all
    let state_rec = recognizer.clone();
    let state_handler = TypedEventHandler::<
        SpeechRecognizer,
        SpeechRecognizerStateChangedEventArgs,
    >::new(
        move |_sender, _args| {
            eprintln!("[speech] recognizer state: {:?}", state_rec.State().ok());
            Ok(())
        },
    );
    let _state_token = recognizer.StateChanged(&state_handler).ok();

    // live words while you are still speaking (the hypothesis event is on the
    // recognizer itself, not the continuous session)
    let app_hyp = app.clone();
    let source_hyp = source.to_string();
    let hypothesis =
        TypedEventHandler::<SpeechRecognizer, SpeechRecognitionHypothesisGeneratedEventArgs>::new(
            move |_sender, args| {
                if let Some(args) = (*args).as_ref() {
                    if let Ok(h) = args.Hypothesis() {
                        if let Ok(text) = h.Text() {
                            eprintln!("[speech] hypothesis: {:?}", text.to_string());
                            let _ = app_hyp.emit(
                                "speech-partial",
                                json!({ "source": source_hyp, "text": text.to_string() }),
                            );
                        }
                    }
                }
                Ok(())
            },
        );
    let _hyp_token = recognizer
        .HypothesisGenerated(&hypothesis)
        .map_err(|e| win_err("Speech recognition failed")(e))?;

    prepare_recognizer(&recognizer)?;

    let session = recognizer
        .ContinuousRecognitionSession()
        .map_err(|e| win_err("Speech recognition failed")(e))?;

    // ...and a finished phrase once you pause
    let app_res = app.clone();
    let source_res = source.to_string();
    let result = TypedEventHandler::<
        SpeechContinuousRecognitionSession,
        SpeechContinuousRecognitionResultGeneratedEventArgs,
    >::new(move |_sender, args| {
        if let Some(args) = (*args).as_ref() {
            if let Ok(r) = args.Result() {
                if let Ok(status) = r.Status() {
                    let text = r.Text().ok().map(|t| t.to_string()).unwrap_or_default();
                    eprintln!("[speech] result: status={status:?} text={text:?}");
                    if status == SpeechRecognitionResultStatus::Success {
                        if !text.trim().is_empty() {
                            let _ = app_res.emit(
                                "speech-final",
                                json!({ "source": source_res, "text": text }),
                            );
                        }
                    }
                }
            }
        }
        Ok(())
    });

    let tok_final = session
        .ResultGenerated(&result)
        .map_err(|e| win_err("Speech recognition failed")(e))?;

    block_on(
        session
            .StartAsync()
            .map_err(|e| win_err("Could not start the microphone")(e))?,
    )
    .map_err(|e| win_err("Could not start the microphone")(e))?;
    eprintln!("[speech] started; recognizer state={:?}", recognizer.State().ok());
    let _ = app.emit("speech-state", json!({ "source": source, "listening": true }));

    // listen until the caller asks us to stop
    while !stop.load(Ordering::SeqCst) {
        std::thread::sleep(Duration::from_millis(50));
    }

    block_on(
        session
            .StopAsync()
            .map_err(|e| win_err("Could not stop speech recognition")(e))?,
    )
    .map_err(|e| win_err("Could not stop speech recognition")(e))?;
    session
        .RemoveResultGenerated(tok_final)
        .map_err(|e| win_err("Could not stop speech recognition")(e))?;
    Ok(())
}

fn prepare_recognizer(recognizer: &SpeechRecognizer) -> Result<(), String> {
    let dictation = SpeechRecognitionTopicConstraint::Create(
        SpeechRecognitionScenario::Dictation,
        &windows::core::HSTRING::from(""),
    )
    .map_err(|e| win_err("Could not prepare speech recognition")(e))?;
    recognizer
        .Constraints()
        .and_then(|constraints| constraints.Append(&dictation))
        .map_err(|e| win_err("Could not prepare speech recognition")(e))?;

    let compiled = block_on(
        recognizer
            .CompileConstraintsAsync()
            .map_err(|e| win_err("Could not prepare speech recognition")(e))?,
    )
    .map_err(|e| win_err("Could not prepare speech recognition")(e))?;
    let status = compiled
        .Status()
        .map_err(|e| win_err("Could not check speech recognition setup")(e))?;
    if status != SpeechRecognitionResultStatus::Success {
        return Err(format!(
            "Could not prepare speech recognition (Windows reported {status:?}). \
             Check that a speech language is installed and microphone access is allowed \
             in Settings > Privacy & security > Microphone."
        ));
    }
    Ok(())
}

/// Hands `ms-settings:privacy-speech` to the shell, which opens the exact
/// Windows page that accepts the speech privacy statement - an unpackaged app
/// cannot show that consent dialog itself.
fn open_speech_privacy_settings() {
    let _ = std::process::Command::new("explorer.exe")
        .arg("ms-settings:privacy-speech")
        .spawn();
}

/// Drives a WinRT async operation to completion on this thread. Windows 0.62
/// exposes these as `IntoFuture` and no longer provides a blocking `.get()`,
/// so we poll the future ourselves. The waker signals a channel that this
/// thread waits on, so we block efficiently until the operation is ready
/// (a self-waking waker would also work but burns CPU spinning).
fn block_on<F: std::future::IntoFuture>(op: F) -> F::Output {
    use std::sync::mpsc;

    struct SignalWaker(mpsc::Sender<()>);
    impl std::task::Wake for SignalWaker {
        fn wake(self: std::sync::Arc<Self>) {
            let _ = self.0.send(());
        }
        fn wake_by_ref(self: &std::sync::Arc<Self>) {
            let _ = self.0.send(());
        }
    }

    let mut fut = std::pin::pin!(op.into_future());
    let (tx, rx) = mpsc::channel();
    let waker = std::task::Waker::from(std::sync::Arc::new(SignalWaker(tx)));
    let mut cx = std::task::Context::from_waker(&waker);
    loop {
        if let std::task::Poll::Ready(out) = fut.as_mut().poll(&mut cx) {
            return out;
        }
        // block until the completion callback wakes us (or a short timeout, so
        // a missed wake can never hang the thread forever)
        let _ = rx.recv_timeout(Duration::from_millis(50));
    }
}

// Every call site hands over the `windows::core::Error` straight from the WinRT
// call. The consent refusal is handled first: its only fix is a switch in
// Settings, so the raw hex code would just be noise for the reader.
fn win_err(context: &'static str) -> impl FnOnce(windows::core::Error) -> String {
    move |e| {
        if privacy_declined(&e) {
            PRIVACY_HELP.to_string()
        } else {
            format!("{context}: {e}")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The built-in recognizer must create, compile and start cleanly from this
    /// unpackaged desktop app - no speech needed, just the setup that every
    /// dictation session performs first.
    #[test]
    fn built_in_recognizer_starts() {
        unsafe {
            use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
        let recognizer = SpeechRecognizer::new().expect("SpeechRecognizer::new");
        prepare_recognizer(&recognizer).expect("prepare_recognizer");
        let session = recognizer
            .ContinuousRecognitionSession()
            .expect("ContinuousRecognitionSession");
        block_on(session.StartAsync().expect("StartAsync")).expect("StartAsync result");
        std::thread::sleep(Duration::from_millis(400));
        if let Ok(op) = session.StopAsync() {
            block_on(op).expect("StopAsync result");
        }
    }

    /// HRESULT 0x80045509 (speech privacy statement declined) must come back
    /// as a sentence that points at the Settings switch - never as a code.
    #[test]
    fn privacy_decline_is_explained() {
        let declined = windows::core::Error::from(windows::core::HRESULT(HR_PRIVACY_DECLINED));
        assert!(privacy_declined(&declined));
        assert_eq!(
            win_err("Could not start the microphone")(declined),
            PRIVACY_HELP
        );

        // anything else keeps its context around the raw error
        let other = windows::core::Error::from(windows::core::HRESULT(0x8004_0001u32 as i32));
        let msg = win_err("Could not start the microphone")(other);
        assert!(msg.starts_with("Could not start the microphone:"), "{msg}");
    }

    /// End-to-end acoustic probe: start the recognizer, play a spoken phrase
    /// through the speakers from *inside* the test, and require at least one
    /// recognition event. Splits "Windows speech engine hears nothing on this
    /// machine" from "the app wiring is broken". Ignored by default because
    /// it needs working speakers + mic; run with `--ignored --nocapture`.
    #[test]
    #[ignore = "acoustic: needs speakers and microphone"]
    fn built_in_recognizer_hears_speech() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::Arc;

        unsafe {
            use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
        let recognizer = SpeechRecognizer::new().expect("SpeechRecognizer::new");
        prepare_recognizer(&recognizer).expect("prepare_recognizer");
        if let Ok(t) = recognizer.Timeouts() {
            eprintln!(
                "[probe] timeouts: initial={:?} end={:?} babble={:?}",
                t.InitialSilenceTimeout().ok(),
                t.EndSilenceTimeout().ok(),
                t.BabbleTimeout().ok(),
            );
        }

        let events = Arc::new(AtomicUsize::new(0));
        let ev = events.clone();
        let hyp = TypedEventHandler::<SpeechRecognizer, SpeechRecognitionHypothesisGeneratedEventArgs>::new(
            move |_s, a| {
                if let Some(a) = (*a).as_ref() {
                    if let Ok(h) = a.Hypothesis() {
                        if let Ok(t) = h.Text() {
                            eprintln!("[probe] hypothesis: {}", t.to_string());
                            ev.fetch_add(1, Ordering::SeqCst);
                        }
                    }
                }
                Ok(())
            },
        );
        let _t1 = recognizer.HypothesisGenerated(&hyp).unwrap();

        let ev2 = events.clone();
        let res = TypedEventHandler::<
            SpeechContinuousRecognitionSession,
            SpeechContinuousRecognitionResultGeneratedEventArgs,
        >::new(move |_s, a| {
            if let Some(a) = (*a).as_ref() {
                if let Ok(r) = a.Result() {
                    if let Ok(t) = r.Text() {
                        eprintln!("[probe] final: {}", t.to_string());
                        ev2.fetch_add(1, Ordering::SeqCst);
                    }
                }
            }
            Ok(())
        });
        let ev3 = events.clone();
        let st = TypedEventHandler::<SpeechRecognizer, SpeechRecognizerStateChangedEventArgs>::new(
            move |_s, _a| {
                eprintln!("[probe] state: {:?}", _s.as_ref().and_then(|s| s.State().ok()));
                ev3.fetch_add(0, Ordering::SeqCst);
                Ok(())
            },
        );

        let session = recognizer
            .ContinuousRecognitionSession()
            .expect("ContinuousRecognitionSession");
        let _t2 = session.ResultGenerated(&res).unwrap();
        let _t3 = recognizer.StateChanged(&st).unwrap();
        block_on(session.StartAsync().expect("StartAsync")).expect("StartAsync result");

        // speak a phrase through the default render device from a child process
        let phrase = "The quick brown fox jumps over the lazy dog. Please write this sentence into the box.";
        let ps = format!(
            "Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Rate = -1; $s.Speak('{phrase}');"
        );
        let _ = std::process::Command::new("powershell")
            .args(["-NoProfile", "-Command", &ps])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();

        std::thread::sleep(Duration::from_millis(2500));
        if let Ok(op) = session.StopAsync() {
            block_on(op).expect("StopAsync result");
        }
        let n = events.load(Ordering::SeqCst);
        eprintln!("[probe] continuous events so far: {n}");

        // One-shot path: RecognizeAsync returns a result *status* even when it
        // finds no text - the diagnostic the continuous session never gives.
        let ps2 = format!(
            "Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Rate = -1; $s.Speak('{phrase}');"
        );
        let child = std::process::Command::new("powershell")
            .args(["-NoProfile", "-Command", &ps2])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn();
        std::thread::sleep(Duration::from_millis(1500));

        let rec2 = recognizer.clone();
        let (tx, rx) = std::sync::mpsc::channel::<(String, bool)>();
        std::thread::spawn(move || {
            unsafe {
                use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
                let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            }
            let msg = match rec2.RecognizeAsync() {
                Ok(op) => match block_on(op) {
                    Ok(res) => {
                        let text = res.Text().ok().map(|t| t.to_string()).unwrap_or_default();
                        let status = res.Status().ok();
                        (
                            format!("text={text:?} status={status:?}"),
                            !text.trim().is_empty(),
                        )
                    }
                    Err(e) => (format!("await error: {e}"), false),
                },
                Err(e) => (format!("start error: {e}"), false),
            };
            let _ = tx.send(msg);
        });
        let mut one_shot_text = false;
        match rx.recv_timeout(Duration::from_secs(40)) {
            Ok((msg, has_text)) => {
                one_shot_text = has_text;
                eprintln!("[probe] one-shot: {msg}");
            }
            Err(_) => eprintln!("[probe] one-shot: TIMED OUT after 40s"),
        }
        if let Ok(mut c) = child {
            let _ = c.wait();
        }

        let n = events.load(Ordering::SeqCst);
        eprintln!("[probe] total recognition events: {n}");
        assert!(
            n > 0 || one_shot_text,
            "the built-in recognizer produced ZERO events while phrases played \
             through the speakers - Windows speech itself is not hearing/decoding \
             audio on this machine"
        );
    }
}
