//! Directory watches for live reload (F.5, rows L03 and L09).
//!
//! Ports `packages/tui/src/util/watch.ts` and the 50 ms debounce of its callers: one `notify` watcher on
//! one directory, not recursive, and one thread that calls back after a burst of events settles. A
//! watch that cannot start returns `None`; live reload is lost and nothing else.

use std::ffi::OsStr;
use std::path::Path;
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use notify::{RecursiveMode, Watcher};

/// The debounce of the storage and `model.json` watches (`storage.tsx:126`, `model-preference.ts:168`).
pub const DEBOUNCE: Duration = Duration::from_millis(50);

/// A running watch; dropping it stops the watcher and its thread.
pub struct Watch {
    _watcher: notify::RecommendedWatcher,
}

/// Whether `OPENCODE_FILEWATCHER_DISABLE`, else `OPENCODE_DISABLE_FILEWATCHER`, is `1` or `true`.
pub fn disabled(var: impl Fn(&str) -> Option<String>) -> bool {
    var("OPENCODE_FILEWATCHER_DISABLE")
        .or_else(|| var("OPENCODE_DISABLE_FILEWATCHER"))
        .is_some_and(|value| value == "1" || value.to_lowercase() == "true")
}

/// Watches `dir` and calls `on_change` once events whose file name passes `filter` have been quiet for
/// `debounce`.
pub fn watch(
    dir: &Path,
    filter: impl Fn(&OsStr) -> bool + Send + 'static,
    debounce: Duration,
    mut on_change: impl FnMut() + Send + 'static,
) -> Option<Watch> {
    if disabled(|name| std::env::var(name).ok()) {
        return None;
    }
    let (tx, rx) = mpsc::channel::<()>();
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        let Ok(event) = event else { return };
        if event.paths.iter().any(|path| path.file_name().is_some_and(&filter)) {
            let _ = tx.send(());
        }
    })
    .inspect_err(|error| log::error!("Failed to watch path, live-reload disabled: {error}"))
    .ok()?;
    watcher
        .watch(dir, RecursiveMode::NonRecursive)
        .inspect_err(|error| log::error!("Failed to watch path, live-reload disabled: {}: {error}", dir.display()))
        .ok()?;
    // Ends when the watcher, and with it the sender, is dropped.
    thread::spawn(move || {
        while rx.recv().is_ok() {
            loop {
                match rx.recv_timeout(debounce) {
                    Ok(()) => continue,
                    Err(mpsc::RecvTimeoutError::Timeout) => break,
                    Err(mpsc::RecvTimeoutError::Disconnected) => return,
                }
            }
            on_change();
        }
    });
    Some(Watch { _watcher: watcher })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    #[test]
    fn disable_switches_follow_typescript() {
        let env = |pairs: &'static [(&'static str, &'static str)]| {
            move |name: &str| pairs.iter().find(|(key, _)| *key == name).map(|(_, value)| value.to_string())
        };
        assert!(disabled(env(&[("OPENCODE_FILEWATCHER_DISABLE", "1")])));
        assert!(disabled(env(&[("OPENCODE_DISABLE_FILEWATCHER", "TRUE")])));
        assert!(!disabled(env(&[("OPENCODE_FILEWATCHER_DISABLE", "0"), ("OPENCODE_DISABLE_FILEWATCHER", "1")])));
        assert!(!disabled(env(&[])));
    }

    #[test]
    fn a_burst_of_writes_gives_one_callback() {
        let dir = tempfile::tempdir().unwrap();
        let (tx, rx) = mpsc::channel();
        let _watch = watch(dir.path(), |name| name == "a.json", DEBOUNCE, move || tx.send(()).unwrap()).unwrap();
        for index in 0..5 {
            std::fs::write(dir.path().join("a.json"), index.to_string()).unwrap();
        }
        std::fs::write(dir.path().join("other"), "x").unwrap();
        rx.recv_timeout(Duration::from_secs(5)).unwrap();
        let quiet = Instant::now();
        assert!(rx.recv_timeout(Duration::from_millis(300)).is_err());
        assert!(quiet.elapsed() >= Duration::from_millis(300));
        std::fs::write(dir.path().join("other"), "y").unwrap();
        assert!(rx.recv_timeout(Duration::from_millis(300)).is_err());
    }
}
