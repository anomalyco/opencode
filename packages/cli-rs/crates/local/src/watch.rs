//! Directory watches for live reload (F.5, rows L03 and L09).
//!
//! Ports `packages/tui/src/util/watch.ts` and the 50 ms debounce of its callers: one watch on one
//! directory, not recursive, and one thread that calls back after a burst of events settles. Linux reads
//! inotify directly; other platforms use `notify` for now. A watch that cannot start returns `None`; live
//! reload is lost and nothing else.

use std::ffi::OsStr;
use std::path::Path;
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

/// The debounce of the storage and `model.json` watches (`storage.tsx:126`, `model-preference.ts:168`).
pub const DEBOUNCE: Duration = Duration::from_millis(50);

/// A running watch; dropping it stops the watcher and its threads.
pub struct Watch {
    #[cfg(target_os = "linux")]
    _stop: std::io::PipeWriter,
    #[cfg(not(target_os = "linux"))]
    _watcher: notify::RecommendedWatcher,
}

/// Whether `OPENCODE_FILEWATCHER_DISABLE`, else `OPENCODE_DISABLE_FILEWATCHER`, is `1` or `true`.
pub fn disabled(var: impl Fn(&str) -> Option<String>) -> bool {
    var("OPENCODE_FILEWATCHER_DISABLE")
        .or_else(|| var("OPENCODE_DISABLE_FILEWATCHER"))
        .is_some_and(|value| value == "1" || value.to_lowercase() == "true")
}

/// Watches `dir` and calls `on_change` once events whose file name passes `filter` have been quiet for
/// `debounce`. A lost event queue, and the directory going away or coming back, count as changes.
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
    let watch = start(dir, filter, tx)
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
    Some(watch)
}

#[cfg(not(target_os = "linux"))]
fn start(dir: &Path, filter: impl Fn(&OsStr) -> bool + Send + 'static, tx: mpsc::Sender<()>) -> notify::Result<Watch> {
    use notify::{RecursiveMode, Watcher};
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        let Ok(event) = event else { return };
        if event.paths.iter().any(|path| path.file_name().is_some_and(&filter)) {
            let _ = tx.send(());
        }
    })?;
    watcher.watch(dir, RecursiveMode::NonRecursive)?;
    Ok(Watch { _watcher: watcher })
}

#[cfg(target_os = "linux")]
fn start(dir: &Path, filter: impl Fn(&OsStr) -> bool + Send + 'static, tx: mpsc::Sender<()>) -> std::io::Result<Watch> {
    use rustix::fs::inotify;
    let fd = inotify::init(inotify::CreateFlags::CLOEXEC | inotify::CreateFlags::NONBLOCK)?;
    let wd = inotify::add_watch(&fd, dir, MASK)?;
    let (stop, stop_tx) = std::io::pipe()?;
    let dir = dir.to_path_buf();
    thread::spawn(move || {
        if let Err(error) = read(&fd, &dir, wd, &stop, &filter, &tx) {
            log::error!("Watch failed, live-reload disabled: {}: {error}", dir.display());
        }
    });
    Ok(Watch { _stop: stop_tx })
}

#[cfg(target_os = "linux")]
const MASK: rustix::fs::inotify::WatchFlags = {
    use rustix::fs::inotify::WatchFlags;
    WatchFlags::CREATE
        .union(WatchFlags::MODIFY)
        .union(WatchFlags::CLOSE_WRITE)
        .union(WatchFlags::MOVED_TO)
        .union(WatchFlags::MOVED_FROM)
        .union(WatchFlags::DELETE)
        .union(WatchFlags::DELETE_SELF)
        .union(WatchFlags::MOVE_SELF)
};

/// How often a watch whose directory is gone looks for it again.
#[cfg(target_os = "linux")]
const REARM: rustix::event::Timespec = rustix::event::Timespec { tv_sec: 0, tv_nsec: 250_000_000 };

/// Reads events until `stop` closes. `wd` is `None` while the directory is gone; the loop polls for it and
/// watches it again when it is back.
#[cfg(target_os = "linux")]
fn read(
    fd: &std::os::fd::OwnedFd,
    dir: &Path,
    wd: i32,
    stop: &std::io::PipeReader,
    filter: &impl Fn(&OsStr) -> bool,
    tx: &mpsc::Sender<()>,
) -> rustix::io::Result<()> {
    use rustix::event::{PollFd, PollFlags, poll};
    use rustix::fs::inotify::{self, ReadFlags};
    use rustix::io::Errno;
    use std::mem::MaybeUninit;
    use std::os::unix::ffi::OsStrExt;

    let mut wd = Some(wd);
    let mut buf = [MaybeUninit::<u8>::uninit(); 4096];
    loop {
        if wd.is_none() {
            wd = inotify::add_watch(fd, dir, MASK).ok();
            if wd.is_some() {
                let _ = tx.send(());
            }
        }
        let mut fds = [PollFd::new(stop, PollFlags::IN), PollFd::new(fd, PollFlags::IN)];
        let watched = if wd.is_some() { 2 } else { 1 };
        match poll(&mut fds[..watched], wd.is_none().then_some(&REARM)) {
            Err(Errno::INTR) => continue,
            result => result?,
        };
        if !fds[0].revents().is_empty() {
            return Ok(());
        }
        let mut changed = false;
        let mut lost = false;
        let mut overflow = false;
        let mut reader = inotify::Reader::new(fd, &mut buf);
        loop {
            let event = match reader.next() {
                Err(Errno::AGAIN | Errno::INTR) => break,
                result => result?,
            };
            if event.events().contains(ReadFlags::QUEUE_OVERFLOW) {
                overflow = true;
                continue;
            }
            if Some(event.wd()) != wd {
                continue;
            }
            if event.events().intersects(ReadFlags::IGNORED | ReadFlags::DELETE_SELF | ReadFlags::MOVE_SELF) {
                lost = true;
            }
            changed |= event.file_name().is_some_and(|name| filter(OsStr::from_bytes(name.to_bytes())));
        }
        // Events may be missing after an overflow, the directory's removal among them: watch the path
        // again, which gives the same descriptor while it names the same directory.
        if overflow && !lost {
            match inotify::add_watch(fd, dir, MASK) {
                Ok(fresh) if Some(fresh) == wd => {}
                _ => lost = true,
            }
        }
        if lost && let Some(old) = wd.take() {
            let _ = inotify::remove_watch(fd, old);
        }
        if changed || overflow || lost {
            let _ = tx.send(());
        }
    }
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
        let dir = opencode_util::temp::tempdir().unwrap();
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

    #[test]
    fn an_atomic_save_over_a_watched_file_calls_back() {
        let dir = opencode_util::temp::tempdir().unwrap();
        std::fs::write(dir.path().join("a.json"), "0").unwrap();
        let (tx, rx) = mpsc::channel();
        let _watch = watch(dir.path(), |name| name == "a.json", DEBOUNCE, move || tx.send(()).unwrap()).unwrap();
        std::fs::write(dir.path().join("a.json.tmp"), "1").unwrap();
        std::fs::rename(dir.path().join("a.json.tmp"), dir.path().join("a.json")).unwrap();
        rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert!(rx.recv_timeout(Duration::from_millis(200)).is_err());
    }

    #[test]
    fn a_directory_made_again_is_watched_again() {
        let root = opencode_util::temp::tempdir().unwrap();
        let dir = root.path().join("watched");
        std::fs::create_dir(&dir).unwrap();
        let (tx, rx) = mpsc::channel();
        let _watch = watch(&dir, |name| name == "a.json", DEBOUNCE, move || tx.send(()).unwrap()).unwrap();
        std::fs::remove_dir(&dir).unwrap();
        rx.recv_timeout(Duration::from_secs(5)).unwrap();
        std::fs::create_dir(&dir).unwrap();
        rx.recv_timeout(Duration::from_secs(5)).unwrap();
        while rx.recv_timeout(Duration::from_millis(200)).is_ok() {}
        std::fs::write(dir.join("a.json"), "1").unwrap();
        rx.recv_timeout(Duration::from_secs(5)).unwrap();
    }

    #[test]
    fn dropping_the_watch_ends_its_threads() {
        let dir = opencode_util::temp::tempdir().unwrap();
        let (tx, rx) = mpsc::channel::<()>();
        let watch = watch(dir.path(), |_| true, DEBOUNCE, move || tx.send(()).unwrap()).unwrap();
        drop(watch);
        assert_eq!(rx.recv_timeout(Duration::from_secs(5)), Err(mpsc::RecvTimeoutError::Disconnected));
    }
}
