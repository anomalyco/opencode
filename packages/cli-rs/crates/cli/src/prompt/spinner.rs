//! `spinner` (`@clack/prompts` `spinner.ts`, with `@clack/core`'s `block`).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread::JoinHandle;
use std::time::Duration;

use super::Output;
use super::core::{ERASE_DOWN, HIDE, SHOW, move_cursor};
use super::style::{
    S_BAR, S_STEP_CANCEL, S_STEP_ERROR, S_STEP_SUBMIT, gray, green, magenta, red, unicode,
};
use super::term::{Keys, Raw};

/// Printed when Ctrl+C ends the process, or when the spinner is dropped while spinning.
const CANCELED: &str = "Canceled";

/// A line with an animated frame while work runs. While it spins, Ctrl+C or Escape prints the cancel
/// message and exits the process with code 0, as Clack's spinner does.
pub struct Spinner {
    shared: Arc<Mutex<Shared>>,
    threads: Option<Threads>,
}

struct Shared {
    message: String,
    previous: Option<String>,
    raw: Option<Raw>,
}

struct Threads {
    frames: Sender<()>,
    frame_thread: JoinHandle<()>,
    stop_input: Arc<AtomicBool>,
    input_thread: JoinHandle<()>,
}

pub fn spinner() -> Spinner {
    Spinner {
        shared: Arc::new(Mutex::new(Shared {
            message: String::new(),
            previous: None,
            raw: None,
        })),
        threads: None,
    }
}

impl Spinner {
    pub fn start(&mut self, message: &str) {
        if self.threads.is_some() {
            self.stop("");
        }
        let output = Output::Stdout;
        {
            let mut shared = lock(&self.shared);
            shared.raw = Some(Raw::enable());
            shared.message = trim_dots(message);
            shared.previous = None;
        }
        output.write(HIDE);
        output.write(&format!("{}\n", gray(S_BAR())));
        let (frames, receive) = mpsc::channel();
        let shared = self.shared.clone();
        let frame_thread = std::thread::spawn(move || {
            let ci = std::env::var("CI").as_deref() == Ok("true");
            let frames: [&str; 4] = if unicode() {
                ["◒", "◐", "◓", "◑"]
            } else {
                ["•", "o", "O", "0"]
            };
            let delay = Duration::from_millis(if unicode() { 80 } else { 120 });
            let mut index = 0;
            let mut dots = 0.0f64;
            while let Err(RecvTimeoutError::Timeout) = receive.recv_timeout(delay) {
                let mut shared = lock(&shared);
                if ci && shared.previous.as_deref() == Some(shared.message.as_str()) {
                    continue;
                }
                clear_previous(&shared, output, ci);
                shared.previous = Some(shared.message.clone());
                let frame = magenta(frames[index]);
                let line = if ci {
                    format!("{frame}  {}...", shared.message)
                } else {
                    format!(
                        "{frame}  {}{}",
                        shared.message,
                        ".".repeat(dots.floor() as usize)
                            .chars()
                            .take(3)
                            .collect::<String>()
                    )
                };
                output.write(&line);
                index = (index + 1) % frames.len();
                dots = if dots < 4.0 { dots + 0.125 } else { 0.0 };
            }
        });
        let stop_input = Arc::new(AtomicBool::new(false));
        let input_thread = {
            let stop = stop_input.clone();
            let shared = self.shared.clone();
            std::thread::spawn(move || {
                let mut keys = Keys::stoppable(stop);
                while let Some(press) = keys.next() {
                    let key = &press.key;
                    let cancel = press.char.as_deref() == Some("\x03") || key.is("escape");
                    if cancel {
                        // `block` shows the cursor and exits; the exit hook then stops the spinner with code 0.
                        let mut shared = lock(&shared);
                        output.write(SHOW);
                        clear_previous(
                            &shared,
                            output,
                            std::env::var("CI").as_deref() == Ok("true"),
                        );
                        output.write(&format!("{}  {CANCELED}\n", green(S_STEP_SUBMIT())));
                        output.write(SHOW);
                        shared.raw.take();
                        std::process::exit(0);
                    }
                }
            })
        };
        self.threads = Some(Threads {
            frames,
            frame_thread,
            stop_input,
            input_thread,
        });
    }

    #[allow(dead_code, reason = "only opencode-prompt-demo uses it")]
    /// Changes the message while it spins.
    pub fn message(&self, message: &str) {
        lock(&self.shared).message = trim_dots(message);
    }

    /// Stops with a success line.
    pub fn stop(&mut self, message: &str) {
        self.stop_with(message, 0);
    }

    /// Stops with a success (0), cancel (1), or error (2 and above) line.
    pub fn stop_with(&mut self, message: &str, code: i32) {
        let Some(threads) = self.threads.take() else {
            return;
        };
        drop(threads.frames);
        let _ = threads.frame_thread.join();
        threads.stop_input.store(true, Ordering::Relaxed);
        let _ = threads.input_thread.join();
        let mut shared = lock(&self.shared);
        let output = Output::Stdout;
        clear_previous(&shared, output, std::env::var("CI").as_deref() == Ok("true"));
        let step = match code {
            0 => green(S_STEP_SUBMIT()),
            1 => red(S_STEP_CANCEL()),
            _ => red(S_STEP_ERROR()),
        };
        shared.message = message.to_string();
        output.write(&format!("{step}  {message}\n"));
        output.write(SHOW);
        shared.raw.take();
    }
}

impl Drop for Spinner {
    /// A spinner dropped while spinning stops as Clack's does when the process exits with code 1.
    fn drop(&mut self) {
        if self.threads.is_some() {
            self.stop_with(CANCELED, 1);
        }
    }
}

fn lock(shared: &Mutex<Shared>) -> MutexGuard<'_, Shared> {
    shared
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn clear_previous(shared: &Shared, output: Output, ci: bool) {
    let Some(previous) = &shared.previous else {
        return;
    };
    if ci {
        output.write("\n");
    }
    let lines = previous.split('\n').count();
    // Clack moves down, not up, for a message of several lines.
    output.write(&move_cursor(-999, lines as i64 - 1));
    output.write(&ERASE_DOWN.repeat(lines));
}

fn trim_dots(message: &str) -> String {
    message.trim_end_matches('.').to_string()
}
