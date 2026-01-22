//! User process spawning with privilege impersonation.
//!
//! This module provides the ability to spawn child processes as a target user
//! with proper privilege separation. The broker (running as root) spawns a
//! child process that drops privileges to the authenticated user's UID/GID.
//!
//! # Integration Testing
//!
//! Integration tests for this module require root privileges to test actual
//! user impersonation. The unit tests here verify the structure and logic,
//! but full testing of `spawn_as_user` must be done with elevated privileges.
//!
//! Example manual test (as root):
//!
//! ```bash
//! sudo cargo test --test spawn_integration -- --nocapture
//! ```
//!
//! # Security Model
//!
//! 1. Broker runs as root with `CAP_SETUID`, `CAP_SETGID`
//! 2. Pre-exec hook sets up supplementary groups with `initgroups`
//! 3. `CommandExt::uid/gid` drops to user's UID/GID
//! 4. `setsid` creates a new session (process becomes leader)
//! 5. `TIOCSCTTY` establishes controlling terminal
//! 6. stdio is redirected to the PTY slave

use std::ffi::CString;
use std::os::fd::RawFd;
use std::os::unix::process::CommandExt;
use std::path::PathBuf;
use std::process::{Child, Command};

use thiserror::Error;

use super::environment::LoginEnvironment;

/// TIOCSCTTY ioctl number - platform-specific.
///
/// On Linux, this is 0x540E (from linux/tty.h).
/// On macOS, this is 0x20007461 (from sys/ttycom.h).
#[cfg(target_os = "linux")]
const TIOCSCTTY: libc::c_ulong = 0x540E;

#[cfg(target_os = "macos")]
const TIOCSCTTY: libc::c_ulong = 0x20007461;

/// Errors that can occur during process spawning.
#[derive(Debug, Error)]
pub enum SpawnError {
    /// Failed to spawn the process.
    #[error("failed to spawn process: {0}")]
    Spawn(#[from] std::io::Error),

    /// Failed during pre-exec setup (e.g., initgroups, setsid).
    #[error("failed to set up process: {0}")]
    Setup(String),

    /// Invalid username (contains null byte).
    #[error("invalid username: {0}")]
    InvalidUsername(String),
}

/// Configuration for spawning a user process.
#[derive(Debug)]
pub struct SpawnConfig {
    /// Environment configuration for the login shell.
    pub env: LoginEnvironment,
    /// The PTY slave file descriptor to attach as controlling terminal.
    pub slave_fd: RawFd,
    /// Working directory for the process (typically user's home).
    pub working_dir: PathBuf,
}

impl SpawnConfig {
    /// Create a new spawn configuration.
    #[must_use]
    pub fn new(env: LoginEnvironment, slave_fd: RawFd, working_dir: PathBuf) -> Self {
        Self {
            env,
            slave_fd,
            working_dir,
        }
    }
}

/// Spawn a login shell as the specified user.
///
/// This function creates a new process with:
/// - The user's UID/GID
/// - Supplementary groups from `/etc/group` (via `initgroups`)
/// - A new session (process becomes session leader via `setsid`)
/// - The PTY slave as the controlling terminal
/// - stdio redirected to the PTY slave
/// - A clean login environment
///
/// # Arguments
///
/// * `config` - Spawn configuration including environment, slave FD, and working dir
///
/// # Returns
///
/// The spawned `Child` process, or an error if spawning failed.
///
/// # Safety
///
/// The `pre_exec` hook runs in a signal-handler context after fork but before exec.
/// All code in this hook must be async-signal-safe:
/// - No heap allocations
/// - No locks
/// - No logging
/// - Only direct libc calls
///
/// # Errors
///
/// Returns `SpawnError::InvalidUsername` if the username contains a null byte.
/// Returns `SpawnError::Setup` if pre-exec setup fails.
/// Returns `SpawnError::Spawn` if the actual spawn fails.
pub fn spawn_as_user(config: SpawnConfig) -> Result<Child, SpawnError> {
    let uid = config.env.uid;
    let gid = config.env.gid;
    let slave_fd = config.slave_fd;

    // Convert gid to the platform-specific type for initgroups
    // Linux uses gid_t (u32), macOS uses c_int (i32)
    #[cfg(target_os = "linux")]
    let initgroups_gid = gid;
    #[cfg(target_os = "macos")]
    let initgroups_gid = gid as libc::c_int;

    // Create CString for username BEFORE entering pre_exec (no heap allocation in pre_exec)
    let username = CString::new(config.env.user.as_str())
        .map_err(|_| SpawnError::InvalidUsername(config.env.user.clone()))?;

    // Build environment variables
    let env_vars = config.env.build();

    // Create the command for the login shell
    let mut cmd = Command::new(&config.env.shell);

    // Pass "-" as argv[0] to indicate a login shell
    cmd.arg0("-");

    // Set working directory
    cmd.current_dir(&config.working_dir);

    // Clear environment and set our login environment
    cmd.env_clear();
    for (key, value) in env_vars {
        cmd.env(key, value);
    }

    // Set UID/GID (CommandExt will call setuid/setgid after fork)
    cmd.uid(uid);
    cmd.gid(gid);

    // SAFETY: pre_exec runs after fork, before exec.
    // All code here must be async-signal-safe.
    // The username CString is created before this closure is invoked.
    unsafe {
        cmd.pre_exec(move || {
            // Set supplementary groups from /etc/group
            // MUST be called before setgid/setuid (which CommandExt handles)
            // but initgroups needs to be called while still root
            let ret = libc::initgroups(username.as_ptr(), initgroups_gid);
            if ret != 0 {
                return Err(std::io::Error::last_os_error());
            }

            // Create a new session (detach from broker's session)
            // This makes the child the session leader
            let ret = libc::setsid();
            if ret == -1 {
                return Err(std::io::Error::last_os_error());
            }

            // Set the PTY slave as the controlling terminal
            // The 0 argument means "don't steal if already owned"
            // (but since we're a new session, there's no existing ctty)
            let ret = libc::ioctl(slave_fd, TIOCSCTTY, 0);
            if ret == -1 {
                return Err(std::io::Error::last_os_error());
            }

            // Redirect stdio to the PTY slave
            // dup2 is async-signal-safe
            if libc::dup2(slave_fd, libc::STDIN_FILENO) == -1 {
                return Err(std::io::Error::last_os_error());
            }
            if libc::dup2(slave_fd, libc::STDOUT_FILENO) == -1 {
                return Err(std::io::Error::last_os_error());
            }
            if libc::dup2(slave_fd, libc::STDERR_FILENO) == -1 {
                return Err(std::io::Error::last_os_error());
            }

            // Close the original slave_fd if it's not one of stdio
            // (we've already dup2'd it to 0, 1, 2)
            if slave_fd > libc::STDERR_FILENO {
                libc::close(slave_fd);
            }

            Ok(())
        });
    }

    // Spawn the process
    let child = cmd.spawn()?;

    Ok(child)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_spawn_config_new() {
        let env = LoginEnvironment::new(
            "testuser".to_string(),
            "/home/testuser".to_string(),
            "/bin/bash".to_string(),
            1000,
            1000,
        );

        let config = SpawnConfig::new(env, 5, PathBuf::from("/home/testuser"));

        assert_eq!(config.slave_fd, 5);
        assert_eq!(config.working_dir, PathBuf::from("/home/testuser"));
        assert_eq!(config.env.user, "testuser");
    }

    #[test]
    fn test_invalid_username_with_null_byte() {
        let env = LoginEnvironment::new(
            "test\0user".to_string(),
            "/home/testuser".to_string(),
            "/bin/bash".to_string(),
            1000,
            1000,
        );

        let config = SpawnConfig::new(env, 5, PathBuf::from("/home/testuser"));
        let result = spawn_as_user(config);

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(matches!(err, SpawnError::InvalidUsername(_)));
    }

    #[test]
    fn test_tiocsctty_constant_is_correct_for_platform() {
        // Platform-specific sanity checks for TIOCSCTTY ioctl number
        #[cfg(target_os = "linux")]
        assert_eq!(TIOCSCTTY, 0x540E);

        #[cfg(target_os = "macos")]
        assert_eq!(TIOCSCTTY, 0x20007461);
    }
}
