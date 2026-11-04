//! `run`'s text output on stderr (`packages/cli/src/run/ui.ts`).

use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};

pub const TEXT_DIM: &str = "\x1b[90m";
pub const TEXT_NORMAL: &str = "\x1b[0m";
pub const TEXT_WARNING_BOLD: &str = "\x1b[93m\x1b[1m";
pub const TEXT_DANGER_BOLD: &str = "\x1b[91m\x1b[1m";

/// The parts joined by spaces, then a newline, on stderr.
pub fn println(parts: &[&str]) {
    let _ = writeln!(std::io::stderr().lock(), "{}", parts.join(" "));
}

// TS never resets its flag, so only the first blank line of a run is printed.
static BLANK: AtomicBool = AtomicBool::new(false);

pub fn empty() {
    if BLANK.swap(true, Ordering::Relaxed) {
        return;
    }
    println(&[TEXT_NORMAL]);
}

pub fn error(message: &str) {
    let message = message.strip_prefix("Error: ").unwrap_or(message);
    println(&[&format!("{TEXT_DANGER_BOLD}Error: {TEXT_NORMAL}{message}")]);
}
