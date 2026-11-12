//! Stopping the service (F.9).
//!
//! Ports `stop` and `terminate` (`packages/client/src/effect/service.ts:129-197`). Only the explicit
//! `service stop`, `restart`, and `set` commands stop a service; `ensure` never stops one it did not
//! start (plan 6.6).

use opencode_api::transport::Transport;
use opencode_local::registration::{self, Registration};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use crate::handoff;
use crate::probe::{self, REQUEST_TIMEOUT};

/// What happens to persistent terminals (`StopOptions.pty`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Pty {
    /// Drop any published handoff.
    #[default]
    Clear,
    /// Publish the terminals for the next service first.
    Handoff,
}

/// The SIGTERM grace period and the wait after SIGKILL: `attempts` polls `interval` apart.
#[derive(Clone, Copy, Debug)]
pub struct Poll {
    pub interval: Duration,
    pub attempts: u32,
}

impl Default for Poll {
    /// 50 ms × 100 (`stopPollInterval`, `stopPollAttempts`).
    fn default() -> Self {
        Self { interval: Duration::from_millis(50), attempts: 100 }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Server process {0} is still running")]
    StillRunning(u32),
    #[error(
        "Process {pid} is not the OpenCode server registered in {}, so it was not stopped. Remove that file if the server is gone.",
        file.display()
    )]
    NotTheServer { pid: u32, file: PathBuf },
}

/// Stops the service registered in `file`, if any. A live pid that is not that service's process
/// (a stale registration whose pid was reused) is never signalled (deviation O89-service-stop-pid).
pub async fn stop(transport: Arc<dyn Transport>, file: &Path, pty: Pty, poll: Poll) -> Result<(), Error> {
    let info = registration::read(file);
    if let Some(info) = &info
        && running(info.pid)
        && !registered_process(transport.as_ref(), info, file).await
    {
        return Err(Error::NotTheServer { pid: info.pid, file: file.to_owned() });
    }
    match (&info, pty) {
        (Some(info), Pty::Handoff) => handoff::prepare(transport, file, info, REQUEST_TIMEOUT).await,
        _ => handoff::clear(file),
    }
    match info {
        Some(info) => terminate(&info, file, poll).await,
        None => Ok(()),
    }
}

/// Signals the process in `info` while `file` still registers it: SIGTERM, then SIGKILL when it
/// outlives the grace period. Removes the registration unless another service took it over.
pub async fn terminate(info: &Registration, file: &Path, poll: Poll) -> Result<(), Error> {
    if !registration::read(file).is_some_and(|current| current.same(info)) {
        return Ok(());
    }
    signal(info.pid, Signal::Term);
    // The registration can disappear or change hands before this process exits. Only the pid that
    // was signalled tells whether it has stopped, so escalate on that process.
    if !stopped(info.pid, poll).await {
        signal(info.pid, Signal::Kill);
        if !stopped(info.pid, poll).await {
            return Err(Error::StillRunning(info.pid));
        }
    }
    if registration::read(file).is_some_and(|latest| latest.same(info)) {
        let _ = std::fs::remove_file(file);
    }
    Ok(())
}

/// Whether `info.pid` is the process that registered in `file`. On Linux, a process that started after
/// the file was last written cannot have written it. Elsewhere, the service must answer with its pid,
/// or accept the connection and not answer in time (a hung service).
async fn registered_process(transport: &dyn Transport, info: &Registration, file: &Path) -> bool {
    #[cfg(target_os = "linux")]
    if let (Some(started), Ok(written)) = (started(info.pid), std::fs::metadata(file).and_then(|meta| meta.modified()))
    {
        // `/proc` times are in clock ticks; allow for that and for coarse file times.
        return started <= written + Duration::from_secs(1);
    }
    #[cfg(not(target_os = "linux"))]
    let _ = file;
    let probe = probe::probe(transport, info, REQUEST_TIMEOUT).await;
    probe.service.is_some() || probe.timed_out
}

/// When `pid` started: field 22 of `/proc/<pid>/stat`, in clock ticks since boot, against `/proc/uptime`.
#[cfg(target_os = "linux")]
fn started(pid: u32) -> Option<std::time::SystemTime> {
    // USER_HZ, the unit of `/proc` process times, is 100 on every architecture Rust targets but Alpha.
    const TICKS: f64 = 100.0;
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    // The command name (field 2) may hold spaces and parentheses; the fields after it do not.
    let ticks: f64 = stat.rsplit_once(')')?.1.split_whitespace().nth(19)?.parse().ok()?;
    let uptime: f64 = std::fs::read_to_string("/proc/uptime").ok()?.split_whitespace().next()?.parse().ok()?;
    std::time::SystemTime::now().checked_sub(Duration::try_from_secs_f64(uptime - ticks / TICKS).ok()?)
}

#[derive(Clone, Copy)]
pub(crate) enum Signal {
    Term,
    Kill,
}

/// Sends `signal`, ignoring failure (a process that is gone needs none).
pub(crate) fn signal(pid: u32, signal: Signal) {
    #[cfg(unix)]
    {
        use rustix::process::{Pid, Signal as Raw, kill_process};
        let Some(pid) = i32::try_from(pid).ok().and_then(Pid::from_raw) else { return };
        let raw = match signal {
            Signal::Term => Raw::TERM,
            Signal::Kill => Raw::KILL,
        };
        let _ = kill_process(pid, raw);
    }
    // libuv's `uv_kill` terminates the process for either signal.
    #[cfg(windows)]
    {
        let _ = signal;
        let _ = opencode_util::win::terminate(pid);
    }
}

/// Whether `pid` exists (`process.kill(pid, 0)`; any error counts as gone, but on Windows a process this user may
/// not open counts as alive).
pub(crate) fn running(pid: u32) -> bool {
    #[cfg(unix)]
    return i32::try_from(pid)
        .ok()
        .and_then(rustix::process::Pid::from_raw)
        .is_some_and(|pid| rustix::process::test_kill_process(pid).is_ok());
    #[cfg(windows)]
    return opencode_util::win::process_alive(pid);
}

async fn stopped(pid: u32, poll: Poll) -> bool {
    for attempt in 0..=poll.attempts {
        if !running(pid) {
            return true;
        }
        if attempt < poll.attempts {
            tokio::time::sleep(poll.interval).await;
        }
    }
    false
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn kill_ends_a_running_process() {
        // `ping` waits a second between echoes; `timeout` needs a console on stdin.
        let mut child = std::process::Command::new("ping")
            .args(["-n", "60", "127.0.0.1"])
            .stdout(std::process::Stdio::null())
            .spawn()
            .unwrap();
        assert!(running(child.id()));
        signal(child.id(), Signal::Kill);
        child.wait().unwrap();
        assert!(!running(child.id()));
    }
}
