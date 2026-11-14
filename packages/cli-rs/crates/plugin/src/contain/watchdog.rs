//! The watchdog (synthesis 4.5). A plugin call holds the UI thread and cannot be stopped, so two threads watch the run
//! record instead:
//!
//! - **The deadline thread** reads the running call every 20 ms. It allocates nothing, logs nothing and does no I/O
//!   that can block: at [`Limits::notice`] it hands the call to the notice thread without waiting, and at
//!   [`Limits::hang`] it claims the call in the record and ends the process. A call that returned in the meantime
//!   wins the claim, and nothing happens.
//! - **The notice thread** paints one line over the frozen frame. Its write may block on the terminal; nothing waits
//!   for it.
//!
//! Both end once the record is gone. Only a client on a real terminal, under a parent, starts them.

use std::io::Write;
use std::sync::Weak;
use std::sync::mpsc::{Receiver, SyncSender};
use std::time::{Duration, Instant};

use super::Limits;
use super::record::{KINDS, Record, Running};

/// What the watchdog does about a call that has run for `running`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    Wait,
    /// Paint the notice, once for the call.
    Notice,
    /// Claim the call and end the process.
    Hang,
}

/// The rule, apart from the threads and their clock: `noticed` says the notice of this call is handed over.
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

/// What one look at the record decides, given the generation whose notice is handed over: the action and the call.
pub fn decide(limits: &Limits, record: &Record, elapsed: Duration, noticed: u64) -> (Action, Option<Running>) {
    let Some(running) = record.running() else { return (Action::Wait, None) };
    let ran = elapsed.saturating_sub(Duration::from_millis(running.started));
    (action(limits, ran, noticed == running.generation), Some(running))
}

/// Starts both threads over `record`, made at `epoch`; the notice goes to `terminal`.
pub fn spawn(
    record: Weak<Record>,
    epoch: Instant,
    limits: Limits,
    terminal: Option<std::fs::File>,
) -> std::io::Result<()> {
    let (notices, received) = std::sync::mpsc::sync_channel::<Running>(1);
    let notifier = record.clone();
    std::thread::Builder::new()
        .name("plugin-notice".into())
        .spawn(move || paint(notifier, received, limits, terminal, epoch))?;
    std::thread::Builder::new().name("plugin-watchdog".into()).spawn(move || watch(record, epoch, limits, notices))?;
    Ok(())
}

fn watch(record: Weak<Record>, epoch: Instant, limits: Limits, notices: SyncSender<Running>) {
    let mut noticed = 0;
    loop {
        std::thread::sleep(Duration::from_millis(20));
        let Some(record) = record.upgrade() else { return };
        match decide(&limits, &record, epoch.elapsed(), noticed) {
            (Action::Notice, Some(running)) => {
                noticed = running.generation;
                // Never waits: a notice still being painted keeps this one from being sent, and that is all.
                let _ = notices.try_send(running);
            }
            // Only a call still running is claimed: one that returned meanwhile keeps the client alive.
            (Action::Hang, Some(running)) if record.claim(running.generation) => opencode_util::page::exit_now(HUNG),
            _ => {}
        }
    }
}

pub(super) fn paint(
    record: Weak<Record>,
    notices: Receiver<Running>,
    limits: Limits,
    mut terminal: Option<std::fs::File>,
    epoch: Instant,
) {
    for running in notices {
        let Some(record) = record.upgrade() else { return };
        let plugin = record.named(running.slot).map(|artifact| artifact.id).unwrap_or_else(|| "a plugin".to_owned());
        let plugin =
            opencode_ui::terminal_text(&plugin).chars().filter(|c| !c.is_control()).take(80).collect::<String>();
        let kind = KINDS.get(usize::from(running.kind)).copied().unwrap_or("a call");
        let ran = epoch.elapsed().saturating_sub(Duration::from_millis(running.started));
        let left = limits.hang.saturating_sub(ran).as_secs_f32();
        // The call may have returned while the name was read: then there is nothing to say.
        if record.running().map(|now| now.generation) != Some(running.generation) {
            continue;
        }
        record.noticed(running.generation);
        // The UI thread is stuck and nothing else writes to the terminal: one line over the frozen frame.
        let line = format!(
            "\x1b7\x1b[1;1H\x1b[2K\x1b[41;97m plugin {plugin} in {kind} is not responding; restarting in {left:.1} s \x1b[0m\x1b8"
        );
        if let Some(terminal) = &mut terminal {
            let _ = terminal.write_all(line.as_bytes()).and_then(|()| terminal.flush());
        }
    }
}

/// The terminal the notice goes to, opened before the client takes it over.
pub fn terminal() -> Option<std::fs::File> {
    let path = if cfg!(windows) { "CONOUT$" } else { "/dev/tty" };
    std::fs::OpenOptions::new().write(true).open(path).ok()
}
