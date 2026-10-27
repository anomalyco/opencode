use std::fs::{self, OpenOptions};
use std::path::Path;
use std::time::{Duration, SystemTime};

use anyhow::Result;
use fs2::FileExt;

use super::{LOCK_FILE, REGISTRATION_FILE, Registration, platform, registration_path};

pub(super) const STALE_RUNTIME_AGE: Duration = Duration::from_secs(10 * 60);

/// Removes sibling runtime directories left by daemons that crashed.
pub(super) fn stale_runtimes(directory: &Path) {
    let Some(parent) = directory.parent() else {
        return;
    };
    let Ok(entries) = fs::read_dir(parent) else {
        return;
    };
    for entry in entries.flatten() {
        let candidate = entry.path();
        if same_path(&candidate, directory) {
            continue;
        }
        if let Err(error) = runtime(&candidate, SystemTime::now()) {
            eprintln!(
                "opencode-pty could not remove stale runtime {}: {error:#}",
                candidate.display()
            );
        }
    }
}

fn same_path(left: &Path, right: &Path) -> bool {
    matches!(
        (fs::canonicalize(left), fs::canonicalize(right)),
        (Ok(left), Ok(right)) if left == right
    )
}

pub(super) fn runtime(directory: &Path, now: SystemTime) -> Result<()> {
    // Symlinks and Windows junctions are never followed or removed.
    let metadata = fs::symlink_metadata(directory)?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Ok(());
    }
    let age = now.duration_since(metadata.modified()?).unwrap_or_default();
    if age < STALE_RUNTIME_AGE {
        return Ok(());
    }
    let mut files = Vec::new();
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let known = name == LOCK_FILE
            || name == REGISTRATION_FILE
            || (name.starts_with("service.") && name.ends_with(".tmp"));
        if !known || !entry.file_type()?.is_file() {
            // Not a runtime directory this daemon created.
            return Ok(());
        }
        files.push(entry.path());
    }

    // Only a lock file or a parseable registration proves a daemon created this
    // directory; anything else, including an empty directory, is left alone.
    let lock = match OpenOptions::new()
        .read(true)
        .write(true)
        .open(directory.join(LOCK_FILE))
    {
        Ok(lock) => {
            if lock.try_lock_exclusive().is_err() {
                return Ok(());
            }
            Some(lock)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let Some(registration) = fs::read(registration_path(directory))
                .ok()
                .and_then(|data| serde_json::from_slice::<Registration>(&data).ok())
            else {
                return Ok(());
            };
            if platform::process_exists(registration.pid) {
                return Ok(());
            }
            None
        }
        Err(error) => return Err(error.into()),
    };

    platform::remove_stale_endpoint(&fs::canonicalize(directory)?)?;
    // Remove the lock last so a racing daemon cannot claim a half-removed directory.
    files.sort_by_key(|file| file.ends_with(LOCK_FILE));
    for file in files {
        fs::remove_file(file)?;
    }
    // Windows deletes an open file only when its last handle closes.
    drop(lock);
    fs::remove_dir(directory)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;
    use crate::protocol::PROTOCOL_VERSION;

    fn random_id() -> String {
        format!("{:032x}", rand::random::<u128>())
    }

    struct Root(PathBuf);

    impl Root {
        fn new() -> Self {
            let root =
                std::env::temp_dir().join(format!("opencode-pty-sweep-test-{}", random_id()));
            fs::create_dir_all(&root).unwrap();
            Self(root)
        }

        fn runtime(&self, files: &[&str], pid: Option<u32>) -> PathBuf {
            let directory = self.0.join(random_id());
            fs::create_dir(&directory).unwrap();
            for file in files {
                fs::write(directory.join(file), b"").unwrap();
            }
            if let Some(pid) = pid {
                let registration = Registration {
                    instance_id: random_id(),
                    pid,
                    protocol: PROTOCOL_VERSION,
                    socket: PathBuf::from("/nonexistent.sock"),
                    token: random_id(),
                };
                fs::write(
                    directory.join(REGISTRATION_FILE),
                    serde_json::to_vec(&registration).unwrap(),
                )
                .unwrap();
            }
            directory
        }
    }

    impl Drop for Root {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn later() -> SystemTime {
        SystemTime::now() + STALE_RUNTIME_AGE + Duration::from_secs(1)
    }

    fn dead_pid() -> u32 {
        #[cfg(unix)]
        let mut child = std::process::Command::new("/usr/bin/true").spawn().unwrap();
        #[cfg(windows)]
        let mut child = std::process::Command::new("cmd.exe")
            .args(["/C", "exit 0"])
            .spawn()
            .unwrap();
        let pid = child.id();
        child.wait().unwrap();
        pid
    }

    #[test]
    fn sweep_removes_only_abandoned_old_runtimes() {
        let root = Root::new();
        let abandoned = root.runtime(&[LOCK_FILE, REGISTRATION_FILE], None);
        let young = root.runtime(&[LOCK_FILE], None);
        let foreign = root.runtime(&[LOCK_FILE, "notes.txt"], None);
        let locked = root.runtime(&[LOCK_FILE], None);
        let held = fs::File::open(locked.join(LOCK_FILE)).unwrap();
        held.try_lock_exclusive().unwrap();

        runtime(&abandoned, later()).unwrap();
        runtime(&young, SystemTime::now()).unwrap();
        runtime(&foreign, later()).unwrap();
        runtime(&locked, later()).unwrap();

        assert!(!abandoned.exists());
        assert!(young.join(LOCK_FILE).exists());
        assert!(foreign.join("notes.txt").exists());
        assert!(locked.join(LOCK_FILE).exists());
        drop(held);
    }

    #[test]
    fn sweep_without_lock_file_checks_registered_pid() {
        let root = Root::new();
        let live = root.runtime(&[], Some(std::process::id()));
        let dead = root.runtime(&[], Some(dead_pid()));

        runtime(&live, later()).unwrap();
        runtime(&dead, later()).unwrap();

        assert!(live.join(REGISTRATION_FILE).exists());
        assert!(!dead.exists());
    }

    #[test]
    fn sweep_keeps_directories_without_daemon_evidence() {
        let root = Root::new();
        let empty = root.runtime(&[], None);
        let foreign = root.runtime(&[], None);
        fs::write(foreign.join(REGISTRATION_FILE), br#"{"not":"ours"}"#).unwrap();
        let temporary = root.runtime(&["service.important.tmp"], None);

        for directory in [&empty, &foreign, &temporary] {
            runtime(directory, later()).unwrap();
            assert!(directory.exists(), "{}", directory.display());
        }
    }
}
