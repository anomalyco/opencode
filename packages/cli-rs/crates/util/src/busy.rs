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
pub fn retry<T>(tries: u32, f: impl FnMut() -> io::Result<T>) -> io::Result<T> {
    retry_while(tries, busy, f)
}

/// `fs::rename`, tried again while Windows reports `from` or `to` busy: replacing a file another TUI is reading.
pub fn rename(from: &Path, to: &Path) -> io::Result<()> {
    retry(RENAME_TRIES, || std::fs::rename(from, to))
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
