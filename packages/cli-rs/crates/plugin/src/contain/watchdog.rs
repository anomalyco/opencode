//! The watchdog (synthesis 4.5): a thread that reads the run record every 20 ms. A plugin call holds the UI thread
//! and cannot be stopped, so when one has not returned after [`Limits::notice`] the watchdog paints one line over the
//! frozen frame, and after [`Limits::hang`] it marks the record and ends the process. The parent then restarts the
//! client, which disables the plugin the record names.

use std::io::Write;
use std::sync::Arc;
use std::time::{Duration, Instant};

use super::Limits;
use super::record::{KINDS, Record};

/// What the watchdog does about a call that has run for `running`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    Wait,
    /// Paint the notice, once for the call.
    Notice,
    /// Mark the record and end the process.
    Hang,
}

/// The rule, apart from the thread and its clock: `noticed` says the notice of this call is painted.
pub fn action(limits: &Limits, running: Duration, noticed: bool) -> Action {
    if running >= limits.hang {
        return Action::Hang;
    }
    if running >= limits.notice && !noticed {
        return Action::Notice;
    }
    Action::Wait
}

/// The exit code of a client the watchdog ended.
pub const HUNG: i32 = 75;

/// Starts the watchdog over `record`, made at `epoch`. It paints on `terminal`.
pub fn spawn(record: Arc<Record>, epoch: Instant, limits: Limits, mut terminal: Option<std::fs::File>) {
    let watch = move || {
        let mut noticed = None;
        loop {
            std::thread::sleep(Duration::from_millis(20));
            let Some((slot, kind, started)) = record.running() else { continue };
            let running = epoch.elapsed().saturating_sub(Duration::from_millis(started));
            let what = || {
                let plugin = record.named(slot).unwrap_or_else(|| "a plugin".to_owned());
                let kind = KINDS.get(usize::from(kind)).copied().unwrap_or("a call");
                (plugin, kind)
            };
            match action(&limits, running, noticed == Some(started)) {
                Action::Wait => {}
                Action::Notice => {
                    noticed = Some(started);
                    let (plugin, kind) = what();
                    let left = limits.hang.saturating_sub(running).as_secs_f32();
                    // The UI thread is stuck and nothing else writes to the terminal: one line over the frozen frame.
                    let line = format!(
                        "\x1b7\x1b[1;1H\x1b[2K\x1b[41;97m plugin {plugin} in {kind} is not responding; restarting in \
                         {left:.1} s \x1b[0m\x1b8"
                    );
                    if let Some(terminal) = &mut terminal {
                        let _ = terminal.write_all(line.as_bytes()).and_then(|()| terminal.flush());
                    }
                }
                Action::Hang => {
                    let (plugin, kind) = what();
                    log::error!("plugin {plugin} hung in {kind}; ending the client");
                    record.hang();
                    opencode_util::page::exit_now(HUNG);
                }
            }
        }
    };
    if let Err(error) = std::thread::Builder::new().name("plugin-watchdog".into()).spawn(watch) {
        log::error!("plugin watchdog: {error}");
    }
}

/// The terminal the notice goes to, opened before the client takes it over.
pub fn terminal() -> Option<std::fs::File> {
    let path = if cfg!(windows) { "CONOUT$" } else { "/dev/tty" };
    std::fs::OpenOptions::new().write(true).open(path).ok()
}
