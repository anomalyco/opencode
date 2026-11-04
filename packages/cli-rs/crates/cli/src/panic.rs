//! The panic hook while the TUI runs (rs-ms1-accept problem 2).
//!
//! The default hook prints over the TUI's screen, which scrolls it out of step with the renderer.
//! This one writes every panic to `<log>/opencode-rs-panic.log` instead. A panic on another thread
//! leaves the TUI running: tokio ends only the panicking task, and the event loop reconnects. A panic
//! on the UI thread ends the app: opentui's hook, which `App::new` installs around this one, restores
//! the terminal first, then this hook prints a short note to stderr and exits with 101, the code of an
//! unhandled Rust panic.

use std::backtrace::Backtrace;
use std::io::Write;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

/// Installs the hook. Call it on the UI thread before the TUI's `App` is created.
pub fn install(log: &Path) {
    let dir = log.to_path_buf();
    let path = log.join("opencode-rs-panic.log");
    let ui = std::thread::current().id();
    std::panic::set_hook(Box::new(move |info| {
        let thread = std::thread::current();
        let created = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |elapsed| elapsed.as_millis());
        let text = format!(
            "{created} thread '{}' {info}\n{}\n",
            thread.name().unwrap_or("<unnamed>"),
            Backtrace::force_capture()
        );
        let written = std::fs::create_dir_all(&dir)
            .and_then(|()| {
                std::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&path)
            })
            .and_then(|mut file| file.write_all(text.as_bytes()));
        if thread.id() != ui {
            return;
        }
        match written {
            Ok(()) => eprintln!("opencode-rs {info}\nThe backtrace is in {}", path.display()),
            Err(_) => eprint!("{text}"),
        }
        std::process::exit(101);
    }));
}
