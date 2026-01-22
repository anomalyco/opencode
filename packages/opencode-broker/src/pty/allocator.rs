use std::ffi::CStr;
use std::os::fd::{AsRawFd, OwnedFd};

use nix::errno::Errno;
use nix::pty::openpty;
use thiserror::Error;

/// A PTY master/slave pair.
///
/// Both file descriptors are owned and will be closed on drop.
pub struct PtyPair {
    /// The master end of the PTY (used by the broker for I/O).
    pub master: OwnedFd,
    /// The slave end of the PTY (attached to the child process).
    pub slave: OwnedFd,
}

/// Errors that can occur during PTY allocation.
#[derive(Debug, Error)]
pub enum AllocateError {
    #[error("failed to open PTY pair: {0}")]
    OpenPty(#[source] nix::Error),

    #[error("failed to get slave device path: {0}")]
    GetPtsName(#[source] nix::Error),

    #[error("failed to change ownership of slave device: {0}")]
    Chown(#[source] nix::Error),
}

/// Get the slave device path from a PTY master file descriptor.
///
/// Uses `ptsname_r` on Linux (thread-safe) and `ptsname` on other platforms.
fn get_slave_path(master_fd: &OwnedFd) -> Result<String, nix::Error> {
    #[cfg(target_os = "linux")]
    {
        get_slave_path_linux(master_fd)
    }

    #[cfg(not(target_os = "linux"))]
    {
        get_slave_path_posix(master_fd)
    }
}

/// Linux implementation using thread-safe ptsname_r.
#[cfg(target_os = "linux")]
fn get_slave_path_linux(master_fd: &OwnedFd) -> Result<String, nix::Error> {
    use std::ffi::CString;
    use std::os::raw::c_char;

    // ptsname_r buffer size (PATH_MAX is typically 4096 on Linux)
    const BUFFER_SIZE: usize = 4096;
    let mut buffer: Vec<c_char> = vec![0; BUFFER_SIZE];

    let ret = unsafe { libc::ptsname_r(master_fd.as_raw_fd(), buffer.as_mut_ptr(), BUFFER_SIZE) };

    if ret != 0 {
        return Err(Errno::from_raw(ret));
    }

    let c_str = unsafe { CStr::from_ptr(buffer.as_ptr()) };
    Ok(c_str.to_string_lossy().into_owned())
}

/// POSIX implementation using ptsname (not thread-safe).
#[cfg(not(target_os = "linux"))]
fn get_slave_path_posix(master_fd: &OwnedFd) -> Result<String, nix::Error> {
    // SAFETY: ptsname returns a pointer to a static buffer, which is not
    // thread-safe. However, we immediately copy the string to an owned
    // String, minimizing the race window. This is acceptable because:
    // 1. PTY allocation is not a high-frequency operation
    // 2. The broker is single-threaded for PTY operations
    // 3. We're copying the result immediately
    let name_ptr = unsafe { libc::ptsname(master_fd.as_raw_fd()) };
    if name_ptr.is_null() {
        return Err(Errno::last());
    }

    let c_str = unsafe { CStr::from_ptr(name_ptr) };
    Ok(c_str.to_string_lossy().into_owned())
}

/// Allocate a new PTY pair with the slave owned by the specified user.
///
/// This function:
/// 1. Opens a PTY master/slave pair via `openpty`
/// 2. Gets the slave device path
/// 3. Changes ownership of the slave to the target user
///
/// # Arguments
///
/// * `uid` - User ID to own the slave device
/// * `gid` - Group ID to own the slave device
///
/// # Returns
///
/// A `PtyPair` containing both file descriptors, or an error.
pub fn allocate(uid: u32, gid: u32) -> Result<PtyPair, AllocateError> {
    // Open a PTY master/slave pair
    let result = openpty(None, None).map_err(AllocateError::OpenPty)?;

    // Get the slave device path for chown
    let slave_path = get_slave_path(&result.master).map_err(AllocateError::GetPtsName)?;

    // Change ownership of the slave device to the target user
    nix::unistd::chown(
        slave_path.as_str(),
        Some(nix::unistd::Uid::from_raw(uid)),
        Some(nix::unistd::Gid::from_raw(gid)),
    )
    .map_err(AllocateError::Chown)?;

    Ok(PtyPair {
        master: result.master,
        slave: result.slave,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Test that PTY allocation creates valid file descriptors.
    /// This test may skip if not running as root (chown requires privileges).
    #[test]
    fn test_allocate_creates_valid_fds() {
        // Get current user's uid/gid (allocation to self should work)
        let uid = nix::unistd::getuid().as_raw();
        let gid = nix::unistd::getgid().as_raw();

        let result = allocate(uid, gid);

        // If we're not root and trying to chown to our own uid/gid, it may still fail
        // on some systems. Skip gracefully.
        let pty_pair = match result {
            Ok(pair) => pair,
            Err(AllocateError::Chown(nix::Error::EPERM)) => {
                eprintln!("Skipping test: chown requires root privileges");
                return;
            }
            Err(e) => panic!("Unexpected error: {e}"),
        };

        // Verify file descriptors are valid (non-negative)
        assert!(pty_pair.master.as_raw_fd() >= 0);
        assert!(pty_pair.slave.as_raw_fd() >= 0);
        assert_ne!(pty_pair.master.as_raw_fd(), pty_pair.slave.as_raw_fd());
    }

    /// Test that PTY pair file descriptors are closed on drop.
    #[test]
    fn test_pty_pair_drops_fds() {
        let uid = nix::unistd::getuid().as_raw();
        let gid = nix::unistd::getgid().as_raw();

        let (master_fd, slave_fd) = {
            let result = allocate(uid, gid);
            let pty_pair = match result {
                Ok(pair) => pair,
                Err(AllocateError::Chown(nix::Error::EPERM)) => {
                    eprintln!("Skipping test: chown requires root privileges");
                    return;
                }
                Err(e) => panic!("Unexpected error: {e}"),
            };

            let master = pty_pair.master.as_raw_fd();
            let slave = pty_pair.slave.as_raw_fd();
            (master, slave)
        };

        // After the block, PtyPair is dropped and FDs should be closed.
        // Verify by checking that fcntl fails with EBADF.
        use nix::fcntl::{fcntl, FcntlArg};
        let master_result = fcntl(master_fd, FcntlArg::F_GETFD);
        let slave_result = fcntl(slave_fd, FcntlArg::F_GETFD);

        assert!(
            master_result.is_err(),
            "Master FD should be closed after drop"
        );
        assert!(
            slave_result.is_err(),
            "Slave FD should be closed after drop"
        );
    }
}
