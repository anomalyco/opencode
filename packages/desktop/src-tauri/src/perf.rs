use serde_json::{Value, json};
use std::{
    fs::{File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::{Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

#[derive(Clone)]
pub struct PerfState {
    enabled: bool,
    start: Instant,
    file: Arc<Mutex<Option<File>>>,
    path: Option<String>,
    seq: Arc<AtomicU64>,
}

fn enabled() -> bool {
    let v = std::env::var_os("OC_PERF")
        .or_else(|| std::env::var_os("TAURI_ENV_OC_PERF"));
    let Some(v) = v else {
        return false;
    };
    let v = v.to_string_lossy();
    if v.is_empty() {
        return true;
    }
    !matches!(v.to_ascii_lowercase().as_str(), "0" | "false" | "no" | "off")
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn ensure_dir(dir: &Path) -> Option<()> {
    std::fs::create_dir_all(dir).ok()?;
    Some(())
}

fn open_file(dir: &Path) -> Option<(File, PathBuf)> {
    ensure_dir(dir)?;
    let path = dir.join(format!("desktop-startup-{}.jsonl", now_ms()));
    let file = OpenOptions::new().create(true).append(true).open(&path).ok()?;
    Some((file, path))
}

fn dir(app: &AppHandle) -> PathBuf {
    if let Ok(dir) = std::env::var("OC_PERF_DIR").or_else(|_| std::env::var("TAURI_ENV_OC_PERF_DIR")) {
        return PathBuf::from(dir);
    }

    app.path()
        .app_log_dir()
        .ok()
        .unwrap_or_else(std::env::temp_dir)
        .join("opencode-perf")
}

impl PerfState {
    pub fn new(app: &AppHandle) -> Self {
        if !enabled() {
            return Self {
                enabled: false,
                start: Instant::now(),
                file: Arc::new(Mutex::new(None)),
                path: None,
                seq: Arc::new(AtomicU64::new(0)),
            };
        }

        let Some((file, path)) = open_file(&dir(app)) else {
            return Self {
                enabled: false,
                start: Instant::now(),
                file: Arc::new(Mutex::new(None)),
                path: None,
                seq: Arc::new(AtomicU64::new(0)),
            };
        };

        let state = Self {
            enabled: true,
            start: Instant::now(),
            file: Arc::new(Mutex::new(Some(file))),
            path: Some(path.to_string_lossy().to_string()),
            seq: Arc::new(AtomicU64::new(0)),
        };

        state.rust("perf_enabled", Some(json!({ "path": state.path })));
        state
    }

    pub fn init_script(&self) -> String {
        let enabled = self.enabled;
        let path = serde_json::to_string(&self.path).unwrap_or_else(|_| "null".into());
        format!(r#"window.__OPENCODE__.perfEnabled = {enabled}; window.__OPENCODE__.perfPath = {path};"#)
    }

    pub fn rust(&self, name: &'static str, data: Option<Value>) {
        self.event("rust", name, Some(self.start.elapsed().as_millis() as f64), data);
    }

    pub fn frontend(&self, name: String, at_ms: Option<f64>, data: Option<String>) {
        let data = data.map(|s| serde_json::from_str(&s).unwrap_or(Value::String(s)));
        self.event("frontend", &name, at_ms, data);
    }

    fn event(&self, kind: &'static str, name: &str, at_ms: Option<f64>, data: Option<Value>) {
        if !self.enabled {
            return;
        }

        let seq = self.seq.fetch_add(1, Ordering::Relaxed);
        let line = json!({
            "seq": seq,
            "kind": kind,
            "name": name,
            "at_ms": at_ms,
            "ts_ms": now_ms(),
            "data": data,
        });

        let Ok(mut guard) = self.file.lock() else {
            return;
        };
        let Some(file) = guard.as_mut() else {
            return;
        };
        let _ = writeln!(file, "{}", line);
        let _ = file.flush();
    }

}
