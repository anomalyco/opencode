//! A file mapped into memory and shared with the file's pages, so what this process stores reaches the file at once
//! and another process reads it after this one died: the plugin run record (synthesis 4.5). `mmap` with `MAP_SHARED`
//! on Unix, `CreateFileMappingW` and `MapViewOfFile` on Windows.
//!
//! The mapping hands out a raw pointer and nothing else: the record that owns it decides the layout, gives each field
//! one access type, and keeps the fields apart, which is what makes concurrent access sound.

#![allow(unsafe_code)]

use std::fs::File;
use std::io;
use std::path::Path;
use std::ptr::NonNull;

/// A mapped file of a fixed length. Dropping it unmaps the file.
pub struct Page {
    map: NonNull<u8>,
    len: usize,
    #[cfg(windows)]
    _mapping: std::os::windows::io::OwnedHandle,
    _file: File,
}

// SAFETY: the mapping lives as long as the value and is only reached through `as_ptr`, whose users make each access
// atomic.
unsafe impl Send for Page {}
// SAFETY: as above.
unsafe impl Sync for Page {}

impl Page {
    /// Maps `file`, which is `len` bytes long, shared and writable.
    pub fn map(file: File, len: usize) -> io::Result<Page> {
        if len == 0 || !len.is_multiple_of(8) || file.metadata()?.len() != len as u64 {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "not a page of the expected length"));
        }
        sys::map(file, len)
    }

    /// The first byte of the mapping, aligned to a page.
    pub fn as_ptr(&self) -> *mut u8 {
        self.map.as_ptr()
    }

    pub fn len(&self) -> usize {
        self.len
    }

    /// The mapped file, to hand its handle to a child that maps it too.
    pub fn file(&self) -> &File {
        &self._file
    }

    pub fn is_empty(&self) -> bool {
        self.len == 0
    }
}

/// Creates a private file of `len` bytes of zeros in `dir`, under a new name nobody else can have chosen first: owner
/// only, never following a link, failing on any file already there. On Unix it is unlinked at once, so it lives only
/// as long as its descriptors; on Windows it is deleted when its last handle closes, and nobody else may open it. Its
/// blocks are allocated, so a full disk fails here and not at a later store.
pub fn private_file(dir: &Path, len: usize) -> io::Result<File> {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    for _ in 0..16 {
        let unique = format!(
            "opencode-plugins-{}-{}-{}.run",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        );
        match sys::create(&dir.join(unique), len) {
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            result => return result,
        }
    }
    Err(io::Error::new(io::ErrorKind::AlreadyExists, "no free name for a private file"))
}

#[cfg(unix)]
mod sys {
    use std::os::fd::AsRawFd;
    use std::os::unix::fs::OpenOptionsExt;

    use super::*;

    pub(super) fn create(path: &Path, len: usize) -> io::Result<File> {
        let file = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(true)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW)
            .open(path)?;
        let removed = std::fs::remove_file(path);
        allocate(&file, len)?;
        removed?;
        Ok(file)
    }

    #[cfg(target_os = "linux")]
    fn allocate(file: &File, len: usize) -> io::Result<()> {
        // SAFETY: a plain call on an open descriptor.
        match unsafe { libc::posix_fallocate(file.as_raw_fd(), 0, len as libc::off_t) } {
            0 => Ok(()),
            error => Err(io::Error::from_raw_os_error(error)),
        }
    }

    #[cfg(not(target_os = "linux"))]
    fn allocate(file: &File, len: usize) -> io::Result<()> {
        use std::io::Write;
        (&*file).write_all(&vec![0; len])
    }

    pub(super) fn map(file: File, len: usize) -> io::Result<Page> {
        // SAFETY: a new shared mapping of a file of `len` bytes; it is unmapped once, in `drop`.
        let map = unsafe {
            libc::mmap(
                std::ptr::null_mut(),
                len,
                libc::PROT_READ | libc::PROT_WRITE,
                libc::MAP_SHARED,
                file.as_raw_fd(),
                0,
            )
        };
        if map == libc::MAP_FAILED {
            return Err(io::Error::last_os_error());
        }
        let map = NonNull::new(map.cast()).ok_or_else(|| io::Error::other("mmap returned null"))?;
        Ok(Page { map, len, _file: file })
    }

    impl Drop for Page {
        fn drop(&mut self) {
            // SAFETY: the mapping `map` made, unmapped once.
            unsafe { libc::munmap(self.map.as_ptr().cast(), self.len) };
        }
    }
}

#[cfg(windows)]
mod sys {
    use std::os::windows::fs::OpenOptionsExt;
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};

    use windows_sys::Win32::Storage::FileSystem::FILE_FLAG_DELETE_ON_CLOSE;
    use windows_sys::Win32::System::Memory::{
        CreateFileMappingW, FILE_MAP_WRITE, MEMORY_MAPPED_VIEW_ADDRESS, MapViewOfFile, PAGE_READWRITE, UnmapViewOfFile,
    };

    use super::*;

    pub(super) fn create(path: &Path, len: usize) -> io::Result<File> {
        // No sharing: only the handles this process holds, and those it hands to its child, reach the file.
        let file = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(true)
            .share_mode(0)
            .custom_flags(FILE_FLAG_DELETE_ON_CLOSE)
            .open(path)?;
        file.set_len(len as u64)?;
        Ok(file)
    }

    pub(super) fn map(file: File, len: usize) -> io::Result<Page> {
        let size = len as u64;
        // SAFETY: a mapping of the open file, at its length; the handle is owned below.
        let mapping = unsafe {
            CreateFileMappingW(
                file.as_raw_handle(),
                std::ptr::null(),
                PAGE_READWRITE,
                (size >> 32) as u32,
                size as u32,
                std::ptr::null(),
            )
        };
        if mapping.is_null() {
            return Err(io::Error::last_os_error());
        }
        // SAFETY: `CreateFileMappingW` returned a handle this function owns.
        let mapping = unsafe { OwnedHandle::from_raw_handle(mapping) };
        // SAFETY: a view of the whole mapping; it is unmapped once, in `drop`.
        let view = unsafe { MapViewOfFile(mapping.as_raw_handle(), FILE_MAP_WRITE, 0, 0, len) };
        let map = NonNull::new(view.Value.cast()).ok_or_else(io::Error::last_os_error)?;
        Ok(Page { map, len, _mapping: mapping, _file: file })
    }

    impl Drop for Page {
        fn drop(&mut self) {
            // SAFETY: the view `map` made, unmapped once.
            unsafe { UnmapViewOfFile(MEMORY_MAPPED_VIEW_ADDRESS { Value: self.map.as_ptr().cast() }) };
        }
    }
}

/// Ends this process at once with `code`: no destructors, no exit handlers and no flush, so a thread that holds a lock
/// cannot keep it alive. `_exit` on Unix, `TerminateProcess` on Windows.
pub fn exit_now(code: i32) -> ! {
    #[cfg(unix)]
    // SAFETY: `_exit` takes no pointers and does not return.
    unsafe {
        libc::_exit(code)
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::System::Threading::{GetCurrentProcess, TerminateProcess};
        // SAFETY: the pseudo-handle of this process.
        unsafe { TerminateProcess(GetCurrentProcess(), code as u32) };
        unreachable!("TerminateProcess of this process returned")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Expected: a private file is new, empty, of its length and already gone from the directory (Unix), and a second
    // one in the same directory is another file; a file of another length does not map.
    #[test]
    fn a_private_file_is_new_and_has_no_name() {
        let dir = crate::temp::tempdir().unwrap();
        let file = private_file(dir.path(), 4096).unwrap();
        assert_eq!(file.metadata().unwrap().len(), 4096);
        #[cfg(unix)]
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
        let other = private_file(dir.path(), 4096).unwrap();
        let page = Page::map(file, 4096).unwrap();
        assert_eq!(page.len(), 4096);
        assert!(Page::map(other, 8192).is_err());
    }
}
