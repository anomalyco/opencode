use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::{EnvFilter, fmt, layer::SubscriberExt, util::SubscriberInitExt};

const MAX_LOG_AGE_DAYS: u64 = 7;
const TAIL_LINES: usize = 1000;

static LOG_PATH: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

pub fn init(log_dir: &Path) -> WorkerGuard {
    std::fs::create_dir_all(log_dir).expect("failed to create log directory");

    cleanup(log_dir);

    let timestamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S");
    let filename = format!("opencode-desktop_{timestamp}.log");
    let log_path = log_dir.join(&filename);

    LOG_PATH
        .set(log_path.clone())
        .expect("logging already initialized");

    let file = File::create(&log_path).expect("failed to create log file");
    let (non_blocking, guard) = tracing_appender::non_blocking(file);

    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| {
        if cfg!(debug_assertions) {
            EnvFilter::new("opencode_lib=debug,opencode_desktop=debug,sidecar=debug")
        } else {
            EnvFilter::new("opencode_lib=info,opencode_desktop=info,sidecar=info")
        }
    });

    tracing_subscriber::registry()
        .with(filter)
        .with(fmt::layer().with_writer(std::io::stderr))
        .with(
            fmt::layer()
                .with_writer(non_blocking)
                .with_ansi(false),
        )
        .init();

    guard
}

pub fn tail() -> String {
    let Some(path) = LOG_PATH.get() else {
        return String::new();
    };

    let Ok(file) = File::open(path) else {
        return String::new();
    };

    let lines: Vec<String> = BufReader::new(file)
        .lines()
        .map_while(Result::ok)
        .collect();

    let start = lines.len().saturating_sub(TAIL_LINES);
    lines[start..].join("\n")
}

fn cleanup(log_dir: &Path) {
    let cutoff = std::time::SystemTime::now()
        - std::time::Duration::from_secs(MAX_LOG_AGE_DAYS * 24 * 60 * 60);

    let Ok(entries) = std::fs::read_dir(log_dir) else {
        return;
    };

    for entry in entries.flatten() {
        if let Ok(meta) = entry.metadata()
            && let Ok(modified) = meta.modified()
            && modified < cutoff
        {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}
