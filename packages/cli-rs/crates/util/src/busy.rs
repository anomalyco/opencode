//! Paths Windows reports busy while another process has them open or is deleting them, tried again for a bounded time.

use std::io;
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
pub fn retry<T>(tries: u32, mut f: impl FnMut() -> io::Result<T>) -> io::Result<T> {
    for _ in 0..tries {
        match f() {
            Err(err) if busy(&err) => thread::sleep(WAIT),
            result => return result,
        }
    }
    f()
}

/// `fs::rename`, tried again while Windows reports `from` or `to` busy: replacing a file another TUI is reading.
pub fn rename(from: &Path, to: &Path) -> io::Result<()> {
    retry(RENAME_TRIES, || std::fs::rename(from, to))
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn a_busy_path_is_tried_again_until_it_is_free() {
        for code in [5, 32, 33] {
            let mut calls = 0;
            let result = retry(RENAME_TRIES, || {
                calls += 1;
                (calls < 3).then_some(()).ok_or_else(|| io::Error::from_raw_os_error(code))
            });
            assert!(result.is_ok());
            assert_eq!(calls, 3);
        }
    }

    #[test]
    fn a_path_that_stays_busy_fails_after_the_bound() {
        let mut calls = 0;
        let result = retry(RENAME_TRIES, || {
            calls += 1;
            Err::<(), _>(io::Error::from_raw_os_error(32))
        });
        assert_eq!(result.unwrap_err().raw_os_error(), Some(32));
        assert_eq!(calls, RENAME_TRIES + 1);
    }

    #[test]
    fn other_errors_are_not_tried_again() {
        let mut calls = 0;
        let result = retry(RENAME_TRIES, || {
            calls += 1;
            Err::<(), _>(io::Error::from_raw_os_error(2))
        });
        assert_eq!(result.unwrap_err().kind(), io::ErrorKind::NotFound);
        assert_eq!(calls, 1);
    }
}
