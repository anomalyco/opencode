//! Stopping the service (F.9).
//!
//! Ports `stop` and `terminate` (`packages/client/src/effect/service.ts:129-197`) and
//! `shutdownPersistentPty` (`packages/cli/src/services/server-connection.ts:78-85`). Only the
//! explicit `service stop`, `restart`, and `set` commands stop a service; `ensure` never stops one
//! it did not start (plan 6.6).

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use opencode_api::client::RequestOptions;
use opencode_api::transport::Transport;
use opencode_local::registration::{self, Registration};

use crate::handoff;
use crate::probe::{Endpoint, REQUEST_TIMEOUT};

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
        Self {
            interval: Duration::from_millis(50),
            attempts: 100,
        }
    }
}

#[derive(Debug, thiserror::Error)]
#[error("Server process {0} is still running")]
pub struct StillRunning(pub u32);

/// Stops the service registered in `file`, if any.
pub async fn stop(
    transport: Arc<dyn Transport>,
    file: &Path,
    pty: Pty,
    poll: Poll,
) -> Result<(), StillRunning> {
    let info = registration::read(file);
    match (&info, pty) {
        (Some(info), Pty::Handoff) => {
            handoff::prepare(transport, file, info, REQUEST_TIMEOUT).await
        }
        _ => handoff::clear(file),
    }
    match info {
        Some(info) => terminate(&info, file, poll).await,
        None => Ok(()),
    }
}

/// Signals the process in `info` while `file` still registers it: SIGTERM, then SIGKILL when it
/// outlives the grace period. Removes the registration unless another service took it over.
pub async fn terminate(info: &Registration, file: &Path, poll: Poll) -> Result<(), StillRunning> {
    if !registration::read(file).is_some_and(|current| current.same(info)) {
        return Ok(());
    }
    signal(info.pid, Signal::Term);
    // The registration can disappear or change hands before this process exits. Only the pid that
    // was signalled tells whether it has stopped, so escalate on that process.
    if !stopped(info.pid, poll).await {
        signal(info.pid, Signal::Kill);
        if !stopped(info.pid, poll).await {
            return Err(StillRunning(info.pid));
        }
    }
    if registration::read(file).is_some_and(|latest| latest.same(info)) {
        let _ = std::fs::remove_file(file);
    }
    Ok(())
}

/// Shuts down the persistent terminals of the service at `endpoint` before an explicit stop. The
/// caller ignores the error, as TS does.
pub async fn shutdown_persistent_pty(
    transport: Arc<dyn Transport>,
    endpoint: &Endpoint,
) -> Result<(), opencode_api::error::Error> {
    endpoint
        .client(transport)?
        .experimental_persistent_pty_shutdown(&RequestOptions::default())
        .await
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
        let Some(pid) = i32::try_from(pid).ok().and_then(Pid::from_raw) else {
            return;
        };
        let raw = match signal {
            Signal::Term => Raw::TERM,
            Signal::Kill => Raw::KILL,
        };
        let _ = kill_process(pid, raw);
    }
    #[cfg(not(unix))]
    let _ = (pid, signal);
}

/// Whether `pid` exists (`process.kill(pid, 0)`; any error counts as gone).
pub(crate) fn running(pid: u32) -> bool {
    #[cfg(unix)]
    return i32::try_from(pid)
        .ok()
        .and_then(rustix::process::Pid::from_raw)
        .is_some_and(|pid| rustix::process::test_kill_process(pid).is_ok());
    #[cfg(not(unix))]
    return pid == 0;
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
