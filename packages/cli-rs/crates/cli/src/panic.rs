//! The panic hook while the TUI runs (rs-ms1-accept problem 2).
//!
//! The default hook prints over the TUI's screen, which scrolls it out of step with the renderer.
//! This one logs every panic, with its backtrace, to the CLI's log file (`telemetry`) instead. A panic
//! on another thread leaves the TUI running: tokio ends only the panicking task, and the event loop
//! reconnects. A panic on the UI thread ends the app: opentui's hook, which `App::new` installs around
//! this one, restores the terminal first, then this hook prints a short note to stderr and exits with
//! 101, the code of an unhandled Rust panic.

use std::backtrace::Backtrace;

/// Installs the hook. Call it on the UI thread before the TUI's `App` is created.
pub fn install() {
    let ui = std::thread::current().id();
    std::panic::set_hook(Box::new(move |info| {
        let thread = std::thread::current();
        let backtrace = Backtrace::force_capture().to_string();
        log::error!(
            thread = thread.name().unwrap_or("<unnamed>"),
            backtrace = backtrace.as_str();
            "panic {info}"
        );
        if thread.id() != ui {
            return;
        }
        match crate::telemetry::file() {
            Some(path) => eprintln!("opencode-rs {info}\nThe backtrace is in {}", path.display()),
            None => eprintln!("opencode-rs {info}\n{backtrace}"),
        }
        crate::telemetry::flush();
        std::process::exit(101);
    }));
}
