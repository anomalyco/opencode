//! The quarantine macOS gives a download (`com.apple.quarantine`), which the private copy of a library carries so the
//! system checks the copy as it would the file (review carbon-6). It is read through the descriptor the library's
//! bytes were read through, as its raw bytes, so the copy carries the attribute of the very file that was hashed and
//! loaded, not of whatever the name leads to later (final review big-boi 3). An attribute that is not there is told
//! from one that cannot be read, which refuses the library. Elsewhere there is no quarantine.

use std::fs::File;

/// The raw quarantine of `file`, or `None` when it has none.
pub fn read(file: &File) -> Result<Option<Vec<u8>>, String> {
    #[cfg(test)]
    if let Some(error) = FAIL.take() {
        return Err(unreadable(error));
    }
    imp::read(file)
}

/// Why a library whose quarantine cannot be read is refused.
#[cfg(any(test, target_os = "macos"))]
fn unreadable(error: impl std::fmt::Display) -> String {
    format!("cannot read its quarantine: {error}")
}

#[cfg(test)]
thread_local! {
    static FAIL: std::cell::Cell<Option<std::io::Error>> = const { std::cell::Cell::new(None) };
}

/// Makes the next [`read`] on this thread fail with `error`, as an attribute the system cannot read does on macOS:
/// what the loader does then runs on every platform (final re-review big-boi 3).
#[cfg(test)]
pub(crate) fn fail_next_read(error: std::io::Error) {
    FAIL.set(Some(error));
}

/// Puts the quarantine `value` on `copy`.
pub fn put(copy: &File, value: &[u8]) -> Result<(), String> {
    imp::put(copy, value)
}

#[cfg(target_os = "macos")]
#[allow(unsafe_code)]
mod imp {
    use std::fs::File;
    use std::io::Error;
    use std::os::fd::AsRawFd;

    const NAME: &std::ffi::CStr = c"com.apple.quarantine";
    /// Reads of a value that grows between asking its size and reading it before the host gives up.
    const TRIES: usize = 4;

    pub fn read(file: &File) -> Result<Option<Vec<u8>>, String> {
        let fd = file.as_raw_fd();
        for _ in 0..TRIES {
            // SAFETY: a null buffer of size 0 asks for the value's size.
            let size = unsafe { libc::fgetxattr(fd, NAME.as_ptr(), std::ptr::null_mut(), 0, 0, 0) };
            if size < 0 {
                return absent(Error::last_os_error());
            }
            let mut value = vec![0u8; size as usize];
            // SAFETY: `value` has room for `value.len()` bytes.
            let read = unsafe { libc::fgetxattr(fd, NAME.as_ptr(), value.as_mut_ptr().cast(), value.len(), 0, 0) };
            if read >= 0 {
                value.truncate(read as usize);
                return Ok(Some(value));
            }
            let error = Error::last_os_error();
            if error.raw_os_error() != Some(libc::ERANGE) {
                return absent(error);
            }
        }
        Err("cannot read its quarantine: it changed while it was read".into())
    }

    /// `None` for an attribute that is not there, or on a file system that holds none; any other error refuses the
    /// library.
    pub(super) fn absent(error: Error) -> Result<Option<Vec<u8>>, String> {
        match error.raw_os_error() {
            Some(libc::ENOATTR | libc::ENOTSUP) => Ok(None),
            _ => Err(super::unreadable(error)),
        }
    }

    pub fn put(copy: &File, value: &[u8]) -> Result<(), String> {
        // SAFETY: `value` is readable for its length.
        let set = unsafe { libc::fsetxattr(copy.as_raw_fd(), NAME.as_ptr(), value.as_ptr().cast(), value.len(), 0, 0) };
        match set {
            0 => Ok(()),
            _ => Err(format!("cannot keep its quarantine on the copy the host opens: {}", Error::last_os_error())),
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    use std::fs::File;

    pub fn read(_: &File) -> Result<Option<Vec<u8>>, String> {
        Ok(None)
    }

    pub fn put(_: &File, _: &[u8]) -> Result<(), String> {
        Ok(())
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use std::io::Write;

    use super::*;

    // Expected (final review big-boi 3; runs on macOS only): the quarantine is read through the descriptor as its raw
    // bytes, absent is `None`, and once the name leads to another file the descriptor still reads the file that was
    // opened; a copy given the value carries the same bytes.
    #[test]
    fn the_quarantine_is_read_through_the_descriptor() {
        let dir = opencode_util::temp::TempDir::new().unwrap();
        let path = dir.path().join("plugin.dylib");
        let mut file = File::create(&path).unwrap();
        file.write_all(b"build").unwrap();
        assert_eq!(read(&file), Ok(None), "absent");
        let value = b"0083;6553f000;Safari;\xff raw".to_vec();
        put(&file, &value).unwrap();
        let opened = File::open(&path).unwrap();
        assert_eq!(read(&opened), Ok(Some(value.clone())), "present, byte for byte");
        // The name now leads to another file, with no quarantine: the open one still has its own.
        std::fs::rename(&path, dir.path().join("moved")).unwrap();
        std::fs::write(&path, b"other").unwrap();
        assert_eq!(read(&opened), Ok(Some(value.clone())), "replaced source");
        assert_eq!(read(&File::open(&path).unwrap()), Ok(None));
        let copy = File::create(dir.path().join("copy")).unwrap();
        put(&copy, &value).unwrap();
        assert_eq!(read(&copy), Ok(Some(value)));
    }

    // Expected (final re-review big-boi 3; macOS only): an attribute that is not there, or a file system that holds
    // none, is no quarantine; every other error is one the library is refused for.
    #[test]
    fn only_absence_is_no_quarantine() {
        for (errno, absent) in [(libc::ENOATTR, true), (libc::ENOTSUP, true), (libc::EACCES, false), (libc::EIO, false)]
        {
            let read = imp::absent(std::io::Error::from_raw_os_error(errno));
            assert_eq!(read.is_ok(), absent, "{errno}: {read:?}");
        }
    }
}
