//! Shared libraries opened at run time: `dlopen`, `dlsym` and `dlclose` with `RTLD_LAZY | RTLD_LOCAL` on Unix,
//! `LoadLibraryW`, `GetProcAddress` and `FreeLibrary` on Windows. Errors are the loader's own message, with the path
//! or symbol on Windows. Elsewhere opening fails.

#![allow(unsafe_code)]

use std::ffi::{CString, OsStr, c_void};
use std::ptr::NonNull;

/// An open library; dropping it closes it, `leak` keeps it open for the life of the process.
pub struct Library(NonNull<c_void>);

// SAFETY: a handle is an opaque token that the loader accepts from any thread.
unsafe impl Send for Library {}
// SAFETY: as above; nothing mutates through `&Library`.
unsafe impl Sync for Library {}

impl Library {
    /// Opens the library at `path`, or by name through the loader's search path when it has no separator.
    ///
    /// # Safety
    ///
    /// Opening runs the library's initializers, which may do anything.
    pub unsafe fn open(path: impl AsRef<OsStr>) -> Result<Self, String> {
        // SAFETY: the caller vouches for the initializers.
        unsafe { sys::open(path.as_ref()) }.map(Self)
    }

    /// The address of `name`, as a `T` (a function pointer or a raw pointer).
    ///
    /// # Safety
    ///
    /// `T` must be the type of the symbol, and the value must not be used after the library closes.
    pub unsafe fn symbol<T: Copy>(&self, name: &str) -> Result<T, String> {
        assert_eq!(size_of::<T>(), size_of::<*mut c_void>(), "a symbol is pointer-sized");
        let name = CString::new(name).map_err(|error| error.to_string())?;
        // SAFETY: the handle is open and `name` is a C string.
        let address = unsafe { sys::symbol(self.0, &name) }?;
        // SAFETY: `T` is pointer-sized, and the caller vouches that it is the symbol's type.
        Ok(unsafe { std::mem::transmute_copy::<*mut c_void, T>(&address.as_ptr()) })
    }

    /// Keeps the library open for the life of the process, so pointers into it stay valid.
    pub fn leak(self) {
        std::mem::forget(self);
    }
}

impl Drop for Library {
    fn drop(&mut self) {
        // SAFETY: the handle is open, and `symbol`'s contract keeps its values from outliving it.
        unsafe { sys::close(self.0) };
    }
}

// The platform calls. Their callers above state why each call is sound.
#[cfg(unix)]
mod sys {
    use std::ffi::{CStr, CString, OsStr, c_void};
    use std::ptr::NonNull;

    pub unsafe fn open(path: &OsStr) -> Result<NonNull<c_void>, String> {
        let path = CString::new(path.as_encoded_bytes()).map_err(|error| error.to_string())?;
        let handle = unsafe { libc::dlopen(path.as_ptr(), libc::RTLD_LAZY | libc::RTLD_LOCAL) };
        NonNull::new(handle).ok_or_else(|| last_error("dlopen failed"))
    }

    pub unsafe fn symbol(handle: NonNull<c_void>, name: &CStr) -> Result<NonNull<c_void>, String> {
        // `dlerror` clears a stale error first.
        let address = unsafe {
            libc::dlerror();
            libc::dlsym(handle.as_ptr(), name.as_ptr())
        };
        NonNull::new(address).ok_or_else(|| last_error("symbol not found"))
    }

    pub unsafe fn close(handle: NonNull<c_void>) {
        unsafe { libc::dlclose(handle.as_ptr()) };
    }

    fn last_error(fallback: &str) -> String {
        // SAFETY: `dlerror` returns null or a C string valid until the next loader call on this thread.
        let message = unsafe { libc::dlerror() };
        if message.is_null() {
            return fallback.to_owned();
        }
        // SAFETY: as above; it is copied before any other loader call.
        unsafe { CStr::from_ptr(message) }.to_string_lossy().into_owned()
    }
}

#[cfg(windows)]
mod sys {
    use crate::win;
    use std::ffi::{CStr, OsStr, c_void};
    use std::ptr::NonNull;

    pub unsafe fn open(path: &OsStr) -> Result<NonNull<c_void>, String> {
        unsafe { win::load_library(path) }.map_err(|error| error.to_string())
    }

    pub unsafe fn symbol(handle: NonNull<c_void>, name: &CStr) -> Result<NonNull<c_void>, String> {
        unsafe { win::library_symbol(handle, name) }.map_err(|error| error.to_string())
    }

    pub unsafe fn close(handle: NonNull<c_void>) {
        unsafe { win::free_library(handle) };
    }
}

#[cfg(not(any(unix, windows)))]
mod sys {
    use std::ffi::{CStr, OsStr, c_void};
    use std::ptr::NonNull;

    const UNSUPPORTED: &str = "shared libraries are not supported on this platform";

    pub unsafe fn open(_: &OsStr) -> Result<NonNull<c_void>, String> {
        Err(UNSUPPORTED.to_owned())
    }

    pub unsafe fn symbol(_: NonNull<c_void>, _: &CStr) -> Result<NonNull<c_void>, String> {
        Err(UNSUPPORTED.to_owned())
    }

    pub unsafe fn close(_: NonNull<c_void>) {}
}

#[cfg(all(test, any(target_os = "linux", windows)))]
mod tests {
    use super::Library;

    #[cfg(target_os = "linux")]
    const LIBC: &str = "libc.so.6";
    // The C runtime every Windows has, by name through the system directory.
    #[cfg(windows)]
    const LIBC: &str = "ucrtbase.dll";
    #[cfg(target_os = "linux")]
    const MISSING: &str = "/nonexistent/libnothing.so";
    #[cfg(windows)]
    const MISSING: &str = "C:/nonexistent/libnothing.dll";

    #[test]
    fn opens_libc_and_finds_a_function() {
        // SAFETY: libc is already loaded; `strlen` has this signature.
        let library = unsafe { Library::open(LIBC) }.unwrap();
        let strlen: unsafe extern "C" fn(*const std::ffi::c_char) -> usize =
            unsafe { library.symbol("strlen") }.unwrap();
        assert_eq!(unsafe { strlen(c"abc".as_ptr()) }, 3);
    }

    #[test]
    fn reports_the_loader_message() {
        let error = unsafe { Library::open(MISSING) }.err().unwrap();
        assert!(error.contains("libnothing"), "{error}");
        let library = unsafe { Library::open(LIBC) }.unwrap();
        let error = unsafe { library.symbol::<*mut u8>("no_such_symbol_here") }.err().unwrap();
        assert!(error.contains("no_such_symbol_here"), "{error}");
    }
}
