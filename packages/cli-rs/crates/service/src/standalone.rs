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
#[cfg(unix)]
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
    let (program, args) =
        command.split_first().ok_or_else(|| Error("Failed to resolve standalone server command".to_owned()))?;
    let password = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(rand::random::<[u8; 32]>());
    let mut command = Command::new(program);
    // `detached: true`: its own process group, so Ctrl+Z, which stops this client's group, leaves it running.
    #[cfg(unix)]
    command.process_group(0);
    // On Windows it shares the console, as `detached: false` does. libuv's `windowsHide` adds `CREATE_NO_WINDOW` only
    // when the child inherits no stdio.
    #[cfg(windows)]
    if !print_logs {
        command.creation_flags(crate::spawn::CREATE_NO_WINDOW);
    }
    let mut child = command
        .args(args)
        .current_dir(cwd)
        // An explicit entry wins over anything inherited, so an exported OPENCODE_PASSWORD cannot
        // shadow the lease credential.
        .env("OPENCODE_PASSWORD", &password)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(if print_logs { Stdio::inherit() } else { Stdio::null() })
        .spawn()
        .map_err(|error| Error(format!("Failed to start standalone server: {}: {error}", program.to_string_lossy())))?;
    let pid = child.id().unwrap_or_default();
    let lease = child.stdin.take();
    let mut lines = BufReader::new(child.stdout.take().expect("stdout is piped")).lines();
    let ready = lines.next_line().await.ok().flatten();
    // Keep draining stdout after readiness so later server writes cannot hit EPIPE.
    tokio::spawn(async move { while let Ok(Some(_)) = lines.next_line().await {} });
    let mut server = Server { endpoint: Endpoint::new(String::new(), Some(password)), pid, child, lease };
    // An early return drops `server`, which ends the lease and stops the child.
    let Some(ready) = ready else {
        return Err(Error("Standalone server exited before reporting readiness".to_owned()));
    };
    server.endpoint.url = serde_json::from_str::<serde_json::Value>(&ready)
        .ok()
        .and_then(|value| value.get("url")?.as_str().map(str::to_owned))
        .ok_or_else(|| Error(format!("Invalid standalone server ready line: {ready}")))?;
    Ok(server)
}

impl Server {
    /// Waits until the server exits on its own (`endpoint.exited`).
    pub async fn wait(&mut self) -> std::io::Result<std::process::ExitStatus> {
        self.child.wait().await
    }

    /// Ends the lease, then SIGTERM, then SIGKILL after 3 s, and waits for the exit. On Windows both are
    /// `taskkill /T /F`, which also ends the LSP and MCP servers it started.
    pub async fn shutdown(mut self) {
        self.lease.take();
        #[cfg(unix)]
        stop::signal(self.pid, Signal::Term);
        #[cfg(windows)]
        self.kill_tree().await;
        if tokio::time::timeout(FORCE_KILL_AFTER, self.child.wait()).await.is_err() {
            #[cfg(windows)]
            self.kill_tree().await;
            let _ = self.child.kill().await;
        }
    }

    /// TS's `killGroup` on Windows, `taskkill /pid <pid> /T /F`; when that fails, the server alone (`killOne`).
    #[cfg(windows)]
    async fn kill_tree(&mut self) {
        let status = Command::from(taskkill(self.pid)).status().await;
        if !status.is_ok_and(|status| status.success()) {
            let _ = self.child.start_kill();
        }
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        self.lease.take();
        if matches!(self.child.try_wait(), Ok(None)) {
            #[cfg(unix)]
            stop::signal(self.pid, Signal::Term);
            // Not waited for: a drop cannot await, and the tree ends either way.
            #[cfg(windows)]
            if taskkill(self.pid).spawn().is_err() {
                let _ = self.child.start_kill();
            }
        }
    }
}

#[cfg(windows)]
fn taskkill(pid: u32) -> std::process::Command {
    use std::os::windows::process::CommandExt;
    let mut command = std::process::Command::new("taskkill");
    command
        .args(["/pid", &pid.to_string(), "/T", "/F"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(crate::spawn::CREATE_NO_WINDOW);
    command
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    // The PID of the `ping` that process `parent` started, once it runs. Other tests run `ping` too, so it is found
    // by its parent.
    fn child_ping(parent: u32) -> Option<u32> {
        let script = format!(
            "Get-CimInstance Win32_Process | Where-Object {{ $_.ParentProcessId -eq {parent} -and $_.Name -eq 'ping.exe' }} | ForEach-Object ProcessId"
        );
        let output = std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .output()
            .unwrap();
        String::from_utf8_lossy(&output.stdout).trim().parse().ok()
    }

    #[tokio::test]
    async fn shutdown_ends_the_server_and_its_children() {
        // `ping` waits a second between echoes; `timeout` needs a console on stdin.
        let script = "Write-Output '{\"url\":\"http://127.0.0.1:1\"}'; ping -n 60 127.0.0.1 | Out-Null";
        let command = ["powershell", "-NoProfile", "-NonInteractive", "-Command", script].map(OsString::from);
        let server = start(&command, &std::env::temp_dir(), false).await.unwrap();
        assert_eq!(server.endpoint.url, "http://127.0.0.1:1");
        let deadline = std::time::Instant::now() + Duration::from_secs(20);
        let ping = loop {
            if let Some(ping) = child_ping(server.pid) {
                break ping;
            }
            assert!(std::time::Instant::now() < deadline, "the server's ping did not start");
            tokio::time::sleep(Duration::from_millis(50)).await;
        };
        let started = std::time::Instant::now();
        server.shutdown().await;
        assert!(started.elapsed() < FORCE_KILL_AFTER, "taskkill did not end the server");
        // `TerminateProcess` returns before the process has exited.
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while opencode_util::win::process_alive(ping) {
            assert!(std::time::Instant::now() < deadline, "the server's child survived");
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }
}
