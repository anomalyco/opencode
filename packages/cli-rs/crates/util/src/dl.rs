//! Shared libraries opened at run time, over `dlopen`, `dlsym`, `dlerror` and `dlclose`. Libraries open with
//! `RTLD_LAZY | RTLD_LOCAL`. Errors are the loader's own message. Unix only for now; elsewhere opening fails.

#![allow(unsafe_code)]

use std::ffi::{CStr, CString, OsStr, c_void};
use std::ptr::NonNull;

/// An open library; dropping it closes it, `leak` keeps it open for the life of the process.
pub struct Library(NonNull<c_void>);

// SAFETY: a handle is an opaque token that `dlsym` and `dlclose` accept from any thread.
unsafe impl Send for Library {}
// SAFETY: as above; nothing mutates through `&Library`.
unsafe impl Sync for Library {}

impl Library {
    /// Opens the library at `path`, or by name through the loader's search path when it has no slash.
    ///
    /// # Safety
    ///
    /// Opening runs the library's initializers, which may do anything.
    pub unsafe fn open(path: impl AsRef<OsStr>) -> Result<Self, String> {
        let path = CString::new(path.as_ref().as_encoded_bytes()).map_err(|error| error.to_string())?;
        // SAFETY: `path` is a C string. The caller vouches for the initializers.
        let handle = unsafe { open(&path) };
        NonNull::new(handle).map(Self).ok_or_else(|| last_error("dlopen failed"))
    }

    /// The address of `name`, as a `T` (a function pointer or a raw pointer).
    ///
    /// # Safety
    ///
    /// `T` must be the type of the symbol, and the value must not be used after the library closes.
    pub unsafe fn symbol<T: Copy>(&self, name: &str) -> Result<T, String> {
        assert_eq!(size_of::<T>(), size_of::<*mut c_void>(), "a symbol is pointer-sized");
        let name = CString::new(name).map_err(|error| error.to_string())?;
        // SAFETY: the handle is open and `name` is a C string. `dlerror` clears a stale error first.
        let address = unsafe {
            error();
            symbol(self.0.as_ptr(), &name)
        };
        if address.is_null() {
            return Err(last_error("symbol not found"));
        }
        // SAFETY: `T` is pointer-sized, and the caller vouches that it is the symbol's type.
        Ok(unsafe { std::mem::transmute_copy::<*mut c_void, T>(&address) })
    }

    /// Keeps the library open for the life of the process, so pointers into it stay valid.
    pub fn leak(self) {
        std::mem::forget(self);
    }
}

impl Drop for Library {
    fn drop(&mut self) {
        // SAFETY: the handle is open, and `symbol`'s contract keeps its values from outliving it.
        unsafe { close(self.0.as_ptr()) };
    }
}

fn last_error(fallback: &str) -> String {
    // SAFETY: `dlerror` returns null or a C string valid until the next loader call on this thread.
    let message = unsafe { error() };
    if message.is_null() {
        return fallback.to_owned();
    }
    // SAFETY: as above; it is copied before any other loader call.
    unsafe { CStr::from_ptr(message) }.to_string_lossy().into_owned()
}

// The four thin wrappers below pass their arguments through; their callers above state why each call is sound.
#[cfg(unix)]
unsafe fn open(path: &CStr) -> *mut c_void {
    unsafe { libc::dlopen(path.as_ptr(), libc::RTLD_LAZY | libc::RTLD_LOCAL) }
}

#[cfg(unix)]
unsafe fn symbol(handle: *mut c_void, name: &CStr) -> *mut c_void {
    unsafe { libc::dlsym(handle, name.as_ptr()) }
}

#[cfg(unix)]
unsafe fn error() -> *const std::ffi::c_char {
    unsafe { libc::dlerror() }
}

#[cfg(unix)]
unsafe fn close(handle: *mut c_void) {
    unsafe { libc::dlclose(handle) };
}

#[cfg(not(unix))]
unsafe fn open(_: &CStr) -> *mut c_void {
    std::ptr::null_mut()
}

#[cfg(not(unix))]
unsafe fn symbol(_: *mut c_void, _: &CStr) -> *mut c_void {
    std::ptr::null_mut()
}

#[cfg(not(unix))]
unsafe fn error() -> *const std::ffi::c_char {
    c"shared libraries are not supported on this platform".as_ptr()
}

#[cfg(not(unix))]
unsafe fn close(_: *mut c_void) {}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::Library;

    #[test]
    fn opens_libc_and_finds_a_function() {
        // SAFETY: libc is already loaded; `strlen` has this signature.
        let library = unsafe { Library::open("libc.so.6") }.unwrap();
        let strlen: unsafe extern "C" fn(*const std::ffi::c_char) -> usize =
            unsafe { library.symbol("strlen") }.unwrap();
        assert_eq!(unsafe { strlen(c"abc".as_ptr()) }, 3);
    }

    #[test]
    fn reports_the_loader_message() {
        let error = unsafe { Library::open("/nonexistent/libnothing.so") }.err().unwrap();
        assert!(error.contains("libnothing.so"), "{error}");
        let library = unsafe { Library::open("libc.so.6") }.unwrap();
        let error = unsafe { library.symbol::<*mut u8>("no_such_symbol_here") }.err().unwrap();
        assert!(error.contains("no_such_symbol_here"), "{error}");
    }
}
