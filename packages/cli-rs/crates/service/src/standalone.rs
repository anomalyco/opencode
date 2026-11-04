//! Standalone server (F.9).
//!
//! Ports `packages/cli/src/services/standalone.ts`: a private TypeScript server for this client
//! alone, with a random password. Its stdin is the ownership lease: the server exits on EOF, which
//! the OS delivers even when this client is killed.

use std::ffi::OsString;
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use base64::Engine as _;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};

use crate::probe::Endpoint;
use crate::stop::{self, Signal};

/// How long `shutdown` waits after SIGTERM before SIGKILL (`forceKillAfter`).
const FORCE_KILL_AFTER: Duration = Duration::from_secs(3);

/// A running standalone server. Dropping it ends the lease and sends SIGTERM.
#[derive(Debug)]
pub struct Server {
    pub endpoint: Endpoint,
    pub pid: u32,
    child: Child,
    lease: Option<ChildStdin>,
}

impl PartialEq for Server {
    fn eq(&self, other: &Self) -> bool {
        self.pid == other.pid
    }
}

impl Eq for Server {}

#[derive(Debug, thiserror::Error)]
#[error("{0}")]
pub struct Error(pub String);

/// Starts `command` (program first, `TsCommand::standalone`) in `cwd` and waits for its ready line.
pub async fn start(command: &[OsString], cwd: &Path, print_logs: bool) -> Result<Server, Error> {
    let (program, args) = command
        .split_first()
        .ok_or_else(|| Error("Failed to resolve standalone server command".to_owned()))?;
    let password =
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(rand::random::<[u8; 32]>());
    let mut child = Command::new(program)
        .args(args)
        .current_dir(cwd)
        // An explicit entry wins over anything inherited, so an exported OPENCODE_PASSWORD cannot
        // shadow the lease credential.
        .env("OPENCODE_PASSWORD", &password)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(if print_logs {
            Stdio::inherit()
        } else {
            Stdio::null()
        })
        .spawn()
        .map_err(|error| {
            Error(format!(
                "Failed to start standalone server: {}: {error}",
                program.to_string_lossy()
            ))
        })?;
    let pid = child.id().unwrap_or_default();
    let lease = child.stdin.take();
    let mut lines = BufReader::new(child.stdout.take().expect("stdout is piped")).lines();
    let ready = lines.next_line().await.ok().flatten();
    // Keep draining stdout after readiness so later server writes cannot hit EPIPE.
    tokio::spawn(async move { while let Ok(Some(_)) = lines.next_line().await {} });
    let mut server = Server {
        endpoint: Endpoint::new(String::new(), Some(password)),
        pid,
        child,
        lease,
    };
    // An early return drops `server`, which ends the lease and stops the child.
    let Some(ready) = ready else {
        return Err(Error(
            "Standalone server exited before reporting readiness".to_owned(),
        ));
    };
    server.endpoint.url = serde_json::from_str::<serde_json::Value>(&ready)
        .ok()
        .and_then(|value| value.get("url")?.as_str().map(str::to_owned))
        .ok_or_else(|| Error(format!("Invalid standalone server ready line: {ready}")))?;
    Ok(server)
}

impl Server {
    /// Ends the lease, then SIGTERM, then SIGKILL after 3 s, and waits for the exit.
    pub async fn shutdown(mut self) {
        self.lease.take();
        stop::signal(self.pid, Signal::Term);
        if tokio::time::timeout(FORCE_KILL_AFTER, self.child.wait())
            .await
            .is_err()
        {
            let _ = self.child.kill().await;
        }
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        self.lease.take();
        if matches!(self.child.try_wait(), Ok(None)) {
            stop::signal(self.pid, Signal::Term);
        }
    }
}
