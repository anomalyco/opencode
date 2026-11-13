//! A file mapped into memory and shared with the file's pages, so what this process stores reaches the file at once
//! and another process reads it after this one died: the plugin run record (synthesis 4.5). `mmap` with `MAP_SHARED`
//! on Unix, `CreateFileMappingW` and `MapViewOfFile` on Windows. A store is a plain store into memory: it costs no
//! system call, and nothing in it waits for the disk.

#![allow(unsafe_code)]

use std::fs::File;
use std::io;
use std::path::Path;
use std::ptr::NonNull;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};

/// A mapped file of a fixed length. Dropping it unmaps the file and leaves it on disk.
pub struct Page {
    map: NonNull<u8>,
    len: usize,
    #[cfg(windows)]
    _mapping: std::os::windows::io::OwnedHandle,
    _file: File,
}

// SAFETY: the mapping lives as long as the value, and every access goes through volatile copies or atomics, so two
// threads may store to different places of it, and read it, at the same time.
unsafe impl Send for Page {}
// SAFETY: as above.
unsafe impl Sync for Page {}

impl Page {
    /// Creates the file at `path` (or truncates it), owner-only on Unix, `len` bytes of zeros, and maps it.
    pub fn create(path: &Path, len: usize) -> io::Result<Page> {
        assert!(len > 0 && len.is_multiple_of(8), "a page is a whole number of words");
        let mut options = std::fs::OpenOptions::new();
        options.read(true).write(true).create(true).truncate(true);
        #[cfg(unix)]
        std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
        let file = options.open(path)?;
        file.set_len(len as u64)?;
        sys::map(file, len)
    }

    pub fn len(&self) -> usize {
        self.len
    }

    pub fn is_empty(&self) -> bool {
        self.len == 0
    }

    /// Copies `bytes` to offset `at`.
    pub fn write(&self, at: usize, bytes: &[u8]) {
        assert!(at + bytes.len() <= self.len, "a write past the page");
        for (index, byte) in bytes.iter().enumerate() {
            // SAFETY: inside the mapping, which is writable.
            unsafe { self.map.as_ptr().add(at + index).write_volatile(*byte) };
        }
    }

    /// The `len` bytes at offset `at`.
    pub fn read(&self, at: usize, len: usize) -> Vec<u8> {
        assert!(at + len <= self.len, "a read past the page");
        // SAFETY: inside the mapping.
        (0..len).map(|index| unsafe { self.map.as_ptr().add(at + index).read_volatile() }).collect()
    }

    /// Stores the 8-byte word at offset `at`, a multiple of 8, in one store.
    pub fn store(&self, at: usize, value: u64) {
        self.word(at).store(value, Ordering::Release);
    }

    pub fn load(&self, at: usize) -> u64 {
        self.word(at).load(Ordering::Acquire)
    }

    /// Stores the 4-byte word at offset `at`, a multiple of 4.
    pub fn store_u32(&self, at: usize, value: u32) {
        assert!(at.is_multiple_of(4) && at + 4 <= self.len, "a misplaced word");
        // SAFETY: aligned (the mapping is page-aligned) and inside it; atomics may alias shared memory.
        unsafe { AtomicU32::from_ptr(self.map.as_ptr().add(at).cast()) }.store(value, Ordering::Release);
    }

    fn word(&self, at: usize) -> &AtomicU64 {
        assert!(at.is_multiple_of(8) && at + 8 <= self.len, "a misplaced word");
        // SAFETY: as in `store_u32`; the word lives as long as `self`.
        unsafe { AtomicU64::from_ptr(self.map.as_ptr().add(at).cast()) }
    }
}

#[cfg(unix)]
mod sys {
    use std::os::fd::AsRawFd;

    use super::*;

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
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};

    use windows_sys::Win32::System::Memory::{
        CreateFileMappingW, FILE_MAP_WRITE, MEMORY_MAPPED_VIEW_ADDRESS, MapViewOfFile, PAGE_READWRITE, UnmapViewOfFile,
    };

    use super::*;

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

    // Expected: what one mapping stores is in the file at once, for a reader that did not map it, and a second
    // mapping of a new file starts from zeros.
    #[test]
    fn a_store_reaches_the_file_without_a_flush() {
        let dir = crate::temp::tempdir().unwrap();
        let path = dir.path().join("record");
        let page = Page::create(&path, 4096).unwrap();
        page.store(8, 0x0102_0304_0506_0708);
        page.store_u32(16, 0xAABB_CCDD);
        page.write(100, b"plugin");
        let bytes = std::fs::read(&path).unwrap();
        assert_eq!(bytes.len(), 4096);
        assert_eq!(u64::from_ne_bytes(bytes[8..16].try_into().unwrap()), 0x0102_0304_0506_0708);
        assert_eq!(u32::from_ne_bytes(bytes[16..20].try_into().unwrap()), 0xAABB_CCDD);
        assert_eq!(&bytes[100..106], b"plugin");
        assert_eq!(page.read(100, 6), b"plugin");
        assert_eq!(page.load(8), 0x0102_0304_0506_0708);
        drop(page);
        let again = Page::create(&path, 4096).unwrap();
        assert_eq!(again.load(8), 0);
    }
}
