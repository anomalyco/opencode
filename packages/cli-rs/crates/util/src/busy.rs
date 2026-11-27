//! Paths Windows reports busy while another process has them open or is deleting them, tried again for a bounded time.

use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::Path;
use std::thread;
use std::time::Duration;

/// How long each wait between two tries lasts.
pub const WAIT: Duration = Duration::from_millis(10);

/// How many times [`rename`] is tried past the first, as TypeScript's `writeJsonAtomic` does (#64875).
pub const RENAME_TRIES: u32 = 20;

/// Whether Windows answers for a path another process holds, where Unix would let the operation through:
/// `ERROR_ACCESS_DENIED` (5) for a file open without delete sharing (a TUI reloading the file a rename replaces) or a
/// directory marked for deletion, `ERROR_SHARING_VIOLATION` (32) and `ERROR_LOCK_VIOLATION` (33) for a file another
/// process opened exclusively, such as a scanner. Node reports them as `EPERM`, `EACCES` and `EBUSY`.
pub fn busy(err: &io::Error) -> bool {
    cfg!(windows) && (err.kind() == io::ErrorKind::PermissionDenied || matches!(err.raw_os_error(), Some(32 | 33)))
}

/// Runs `f`, again after [`WAIT`] while Windows reports the path busy, `tries` times past the first at most.
pub fn retry<T>(tries: u32, f: impl FnMut() -> io::Result<T>) -> io::Result<T> {
    retry_while(tries, busy, f)
}

/// `fs::rename`, tried again while Windows reports `from` or `to` busy: replacing a file another TUI is reading.
pub fn rename(from: &Path, to: &Path) -> io::Result<()> {
    retry(RENAME_TRIES, || fs::rename(from, to))
}

/// Replaces `file` with `bytes` so a crash or power loss leaves the old file or the new one, never an empty one: writes
/// them to `temp`, opened with `options`, syncs it, and renames it over `file` with [`rename_synced`]. When a step
/// after the open fails, `temp` is removed; a `temp` that could not be opened, perhaps another writer's, stays.
pub fn replace(file: &Path, temp: &Path, options: &OpenOptions, bytes: &[u8]) -> io::Result<()> {
    let mut handle = options.open(temp)?;
    let written = handle.write_all(bytes).and_then(|()| handle.sync_all());
    drop(handle);
    let result = written.and_then(|()| rename_synced(temp, file));
    if result.is_err() {
        let _ = fs::remove_file(temp);
    }
    result
}

/// [`rename`], then on Unix a sync of `to`'s directory, so the rename itself survives a crash. A directory sync that
/// fails is ignored: `from`'s bytes must be synced already, so a lost rename leaves the old file whole. Windows has no
/// directory sync through `File::open`, and NTFS journals the rename, so it renames only.
pub fn rename_synced(from: &Path, to: &Path) -> io::Result<()> {
    rename(from, to)?;
    #[cfg(unix)]
    if let Ok(dir) = fs::File::open(to.parent().filter(|dir| !dir.as_os_str().is_empty()).unwrap_or(Path::new("."))) {
        let _ = dir.sync_all();
    }
    Ok(())
}

// The loop behind [`retry`], with the busy test passed in so it runs on every platform under test.
fn retry_while<T>(
    tries: u32,
    busy: impl Fn(&io::Error) -> bool,
    mut f: impl FnMut() -> io::Result<T>,
) -> io::Result<T> {
    for _ in 0..tries {
        match f() {
            Err(err) if busy(&err) => thread::sleep(WAIT),
            result => return result,
        }
    }
    f()
}

#[cfg(test)]
mod tests {
    use super::*;

    // A stand-in for a Windows busy error, so the loop is tested on every platform.
    const FAKE: i32 = 32;

    fn fake(err: &io::Error) -> bool {
        err.raw_os_error() == Some(FAKE)
    }

    #[test]
    fn only_windows_reports_a_path_busy() {
        for code in [5, 32, 33] {
            assert_eq!(busy(&io::Error::from_raw_os_error(code)), cfg!(windows), "code {code}");
        }
        assert!(!busy(&io::Error::from_raw_os_error(2)));
    }

    #[test]
    fn a_busy_path_is_tried_again_until_it_is_free() {
        let mut calls = 0;
        let result = retry_while(RENAME_TRIES, fake, || {
            calls += 1;
            if calls < 3 {
                return Err(io::Error::from_raw_os_error(FAKE));
            }
            Ok(())
        });
        assert!(result.is_ok());
        assert_eq!(calls, 3);
    }

    #[test]
    fn a_path_that_stays_busy_fails_after_the_bound() {
        let mut calls = 0;
        let result = retry_while(RENAME_TRIES, fake, || {
            calls += 1;
            Err::<(), _>(io::Error::from_raw_os_error(FAKE))
        });
        assert_eq!(result.unwrap_err().raw_os_error(), Some(FAKE));
        assert_eq!(calls, RENAME_TRIES + 1);
    }

    fn truncating() -> OpenOptions {
        let mut options = OpenOptions::new();
        options.write(true).create(true).truncate(true);
        options
    }

    // A crash between the write and the rename leaves a temporary file behind; the next write over it still lands.
    #[test]
    fn a_replace_lands_over_a_stale_temporary_file() {
        let dir = crate::temp::tempdir().unwrap();
        let (file, temp) = (dir.path().join("cli.json"), dir.path().join("cli.json.tmp"));
        fs::write(&file, "old").unwrap();
        fs::write(&temp, "a longer half-written leftover").unwrap();
        replace(&file, &temp, &truncating(), b"new").unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "new");
        assert!(!temp.exists());
    }

    // A temporary file that exists already when it must be new is someone else's: the write fails and leaves both.
    #[test]
    fn a_replace_that_cannot_open_its_temporary_file_keeps_both() {
        let dir = crate::temp::tempdir().unwrap();
        let (file, temp) = (dir.path().join("sidecar"), dir.path().join("sidecar.tmp"));
        fs::write(&file, "old").unwrap();
        fs::write(&temp, "theirs").unwrap();
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        assert_eq!(replace(&file, &temp, &options, b"new").unwrap_err().kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(fs::read_to_string(&file).unwrap(), "old");
        assert_eq!(fs::read_to_string(&temp).unwrap(), "theirs");
    }

    // A rename that fails removes the temporary file and keeps the old one.
    #[test]
    fn a_replace_whose_rename_fails_keeps_the_old_file() {
        let dir = crate::temp::tempdir().unwrap();
        let (file, temp) = (dir.path().join("taken"), dir.path().join("taken.tmp"));
        fs::create_dir(&file).unwrap();
        fs::write(file.join("inside"), "").unwrap();
        assert!(replace(&file, &temp, &truncating(), b"new").is_err());
        assert!(file.is_dir());
        assert!(!temp.exists());
    }

    #[test]
    fn other_errors_are_not_tried_again() {
        let mut calls = 0;
        let result = retry_while(RENAME_TRIES, fake, || {
            calls += 1;
            Err::<(), _>(io::Error::from_raw_os_error(2))
        });
        assert_eq!(result.unwrap_err().raw_os_error(), Some(2));
        assert_eq!(calls, 1);
    }
}
