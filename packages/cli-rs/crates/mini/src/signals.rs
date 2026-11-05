//! Signals and diagnostics of the mini host (`packages/cli/src/mini-host.ts:32-86,161-164`): SIGUSR2 reloads the
//! theme, `OPENCODE_SHOW_TTFD` prints the time to the first frame, and `OPENCODE_DIRECT_TRACE` writes a JSONL
//! trace of what mini sends and receives.
//!
//! SIGINT and SIGTERM stay with the renderer, which ends the app; mini then closes as on any exit.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use opentui::prelude::*;
use serde_json::{Value, json};

/// `OPENCODE_SHOW_TTFD` is `1` or `true`, in any case.
pub fn show_timing() -> bool {
    std::env::var("OPENCODE_SHOW_TTFD").is_ok_and(|value| matches!(value.to_lowercase().as_str(), "1" | "true"))
}

/// The JSONL trace (`createTrace`), on when `OPENCODE_DIRECT_TRACE` is set to anything.
#[derive(Clone)]
pub struct Trace {
    path: PathBuf,
    pid: u32,
    file: Arc<Mutex<fs::File>>,
}

impl Trace {
    /// Starts a trace under `<log>/direct/<stamp>-<pid>.jsonl` and points `<log>/direct/latest.json` at it.
    pub fn from_env(log: &Path, cwd: &str, argv: &[String]) -> Option<Self> {
        std::env::var_os("OPENCODE_DIRECT_TRACE")?;
        Self::start(log, std::process::id(), cwd, argv)
            .inspect_err(|error| log::warn!("mini trace failed to start: {error}"))
            .ok()
    }

    fn start(log: &Path, pid: u32, cwd: &str, argv: &[String]) -> std::io::Result<Self> {
        let directory = log.join("direct");
        let stamp = chrono::Utc::now().format("%Y%m%dT%H%M%SZ");
        let path = directory.join(format!("{stamp}-{pid}.jsonl"));
        fs::create_dir_all(&directory)?;
        let latest = json!({ "time": now(), "pid": pid, "cwd": cwd, "argv": argv, "path": path });
        fs::write(directory.join("latest.json"), format!("{latest}\n"))?;
        let file = OpenOptions::new().create(true).append(true).open(&path)?;
        let trace = Self { path: path.clone(), pid, file: Arc::new(Mutex::new(file)) };
        trace.write("trace.start", json!({ "argv": argv, "cwd": cwd, "path": path }));
        Ok(trace)
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Appends one record: `{ time, pid, type, data }`.
    pub fn write(&self, kind: &str, data: Value) {
        let mut record = json!({ "time": now(), "pid": self.pid, "type": kind });
        if !data.is_null() {
            record["data"] = data;
        }
        if let Ok(mut file) = self.file.lock() {
            let _ = writeln!(file, "{record}");
        }
    }
}

/// `new Date().toISOString()`.
fn now() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

/// Sent to the app on each SIGUSR2 (`signals.sigusr2`); mini reloads its theme.
pub struct ThemeReload;

/// Delivers [`ThemeReload`] to the app's message handlers for every SIGUSR2 until the guard drops.
#[cfg(unix)]
pub fn on_sigusr2(app: &App) -> Subscription {
    use tokio::signal::unix::{SignalKind, signal};

    let proxy = app.proxy();
    let task = app.runtime().spawn(async move {
        let Ok(mut signals) = signal(SignalKind::user_defined2()) else {
            log::warn!("mini could not listen for SIGUSR2");
            return;
        };
        while signals.recv().await.is_some() {
            if proxy.send(ThemeReload).is_err() {
                return;
            }
        }
    });
    Subscription(Some(task))
}

#[cfg(not(unix))]
pub fn on_sigusr2(_app: &App) -> Subscription {
    Subscription(None)
}

/// Stops listening when dropped.
pub struct Subscription(Option<tokio::task::JoinHandle<()>>);

impl Drop for Subscription {
    fn drop(&mut self) {
        if let Some(task) = self.0.take() {
            task.abort();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_trace_writes_latest_and_records() {
        let dir = tempfile::tempdir().unwrap();
        let trace = Trace::start(dir.path(), 42, "/work", &["mini".into()]).unwrap();
        trace.write("send.prompt", json!({ "sessionID": "ses_1" }));
        trace.write("ui.idle", Value::Null);
        let latest: Value =
            serde_json::from_str(&fs::read_to_string(dir.path().join("direct/latest.json")).unwrap()).unwrap();
        assert_eq!(latest["pid"], 42);
        assert_eq!(latest["path"], json!(trace.path()));
        let name = trace.path().file_name().unwrap().to_string_lossy().into_owned();
        assert!(name.ends_with("Z-42.jsonl"), "{name}");
        let lines: Vec<Value> =
            fs::read_to_string(trace.path()).unwrap().lines().map(|line| serde_json::from_str(line).unwrap()).collect();
        let kinds: Vec<_> = lines.iter().map(|line| line["type"].clone()).collect();
        assert_eq!(kinds, [json!("trace.start"), json!("send.prompt"), json!("ui.idle")]);
        assert_eq!(lines[0]["data"]["cwd"], "/work");
        assert_eq!(lines[1]["data"]["sessionID"], "ses_1");
        assert!(lines[2].get("data").is_none());
    }
}
