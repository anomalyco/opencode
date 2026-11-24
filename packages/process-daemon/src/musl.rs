use std::ffi::{c_char, c_int, c_uint, c_void};

/// Zig 0.16 assumes musl provides `statx` (added in musl 1.2.5), so libghostty
/// references it, but Rust's self-contained musl is older. Forward to the raw
/// syscall exactly as musl's own wrapper does.
///
/// # Safety
///
/// Same contract as `statx(2)`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn statx(
    dirfd: c_int,
    path: *const c_char,
    flags: c_int,
    mask: c_uint,
    buffer: *mut c_void,
) -> c_int {
    // SAFETY: the caller upholds statx(2)'s pointer requirements.
    unsafe { libc::syscall(libc::SYS_statx, dirfd, path, flags, mask, buffer) as c_int }
}

#[cfg(test)]
mod tests {
    use super::*;

    // From linux/stat.h; the libc crate does not expose it for musl.
    const STATX_BASIC_STATS: c_uint = 0x7ff;

    #[test]
    fn statx_matches_the_syscall_contract() {
        let mut buffer = [0u8; 256];
        // SAFETY: both paths are NUL-terminated and the buffer exceeds struct statx.
        unsafe {
            let root = statx(
                libc::AT_FDCWD,
                c"/".as_ptr(),
                0,
                STATX_BASIC_STATS,
                buffer.as_mut_ptr().cast(),
            );
            assert_eq!(root, 0);
            let missing = c"/opencode-pty-missing".as_ptr();
            assert_eq!(
                statx(
                    libc::AT_FDCWD,
                    missing,
                    0,
                    STATX_BASIC_STATS,
                    buffer.as_mut_ptr().cast()
                ),
                -1
            );
        }
        assert_eq!(
            std::io::Error::last_os_error().raw_os_error(),
            Some(libc::ENOENT)
        );
    }
}
