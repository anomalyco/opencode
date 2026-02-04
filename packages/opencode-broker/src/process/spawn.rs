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
//! 2. Pre-exec hook sets up supplementary groups with `initgroups` (Linux only, best-effort)
//! 3. `CommandExt::uid/gid` drops to user's UID/GID
//! 4. `setsid` creates a new session (process becomes leader)
//! 5. `TIOCSCTTY` establishes controlling terminal
//! 6. stdio is redirected to the PTY slave
//!
//! ## macOS Note
//!
//! On macOS, `initgroups()` fails with EPERM when called in a pre_exec hook
//! after fork but before exec. This is a macOS security restriction. The
//! workaround is to skip `initgroups()` on macOS - the supplementary groups
//! are inherited correctly from the Open Directory system without it.

#[cfg(target_os = "linux")]
use std::ffi::CString;
use std::mem;
use std::os::fd::RawFd;
use std::os::unix::process::CommandExt;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::ptr;

use thiserror::Error;
use tracing::warn;

use super::environment::LoginEnvironment;

/// TIOCSCTTY ioctl number - platform-specific.
///
/// On Linux, this is 0x540E (from linux/tty.h).
/// On macOS, this is 0x20007461 (from sys/ttycom.h).
#[cfg(target_os = "linux")]
const TIOCSCTTY: libc::c_ulong = 0x540E;

#[cfg(target_os = "macos")]
const TIOCSCTTY: libc::c_ulong = 0x20007461;

/// Report kind for non-fatal pre-exec issues (e.g., initgroups EPERM).
const PRE_EXEC_REPORT_KIND_WARNING: u8 = 1;
/// Report kind for fatal pre-exec failures.
const PRE_EXEC_REPORT_KIND_ERROR: u8 = 2;

/// Enumerates the pre-exec steps so the parent can log precise failures.
#[derive(Copy, Clone)]
#[repr(u8)]
enum PreExecStep {
    InitGroups = 1,
    SetSid = 2,
    SetCtty = 3,
    Dup2Stdin = 4,
    Dup2Stdout = 5,
    Dup2Stderr = 6,
}

impl PreExecStep {
    /// Human-readable name for logging.
    fn as_str(self) -> &'static str {
        match self {
            Self::InitGroups => "initgroups",
            Self::SetSid => "setsid",
            Self::SetCtty => "ioctl(TIOCSCTTY)",
            Self::Dup2Stdin => "dup2(stdin)",
            Self::Dup2Stdout => "dup2(stdout)",
            Self::Dup2Stderr => "dup2(stderr)",
        }
    }
}

/// Fixed-size report message sent from the pre-exec hook to the parent.
#[repr(C)]
#[derive(Copy, Clone)]
struct PreExecReport {
    kind: u8,
    step: u8,
    errno: i32,
}

/// Size of a single pre-exec report message.
const PRE_EXEC_REPORT_SIZE: usize = mem::size_of::<PreExecReport>();

/// Set FD_CLOEXEC on a file descriptor so it doesn't leak into the child.
fn set_cloexec(fd: RawFd) -> std::io::Result<()> {
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFD) };
    if flags == -1 {
        return Err(std::io::Error::last_os_error());
    }
    let ret = unsafe { libc::fcntl(fd, libc::F_SETFD, flags | libc::FD_CLOEXEC) };
    if ret == -1 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(())
}

/// Create a pipe used to report pre-exec failures to the parent.
fn create_report_pipe() -> std::io::Result<(RawFd, RawFd)> {
    let mut fds = [0; 2];
    let ret = unsafe { libc::pipe(fds.as_mut_ptr()) };
    if ret == -1 {
        return Err(std::io::Error::last_os_error());
    }
    if let Err(err) = set_cloexec(fds[0]).and_then(|_| set_cloexec(fds[1])) {
        unsafe {
            libc::close(fds[0]);
            libc::close(fds[1]);
        }
        return Err(err);
    }
    Ok((fds[0], fds[1]))
}

/// Write a pre-exec report using a single async-signal-safe write(2).
fn write_pre_exec_report(fd: RawFd, kind: u8, step: PreExecStep, errno: i32) {
    let report = PreExecReport {
        kind,
        step: step as u8,
        errno,
    };
    let buf = ptr::addr_of!(report).cast::<libc::c_void>();
    let _ = unsafe { libc::write(fd, buf, PRE_EXEC_REPORT_SIZE) };
}

/// Read all pre-exec reports from the pipe, handling partial reads.
fn read_pre_exec_reports(fd: RawFd) -> Vec<PreExecReport> {
    let mut reports = Vec::new();
    let mut buf = [0u8; PRE_EXEC_REPORT_SIZE];
    let mut offset = 0;

    loop {
        let remaining = PRE_EXEC_REPORT_SIZE - offset;
        let n = unsafe {
            libc::read(
                fd,
                buf[offset..].as_mut_ptr().cast::<libc::c_void>(),
                remaining,
            )
        };

        if n == -1 {
            let err = std::io::Error::last_os_error();
            if err.kind() == std::io::ErrorKind::Interrupted {
                continue;
            }
            break;
        }

        if n == 0 {
            break;
        }

        offset += n as usize;
        if offset == PRE_EXEC_REPORT_SIZE {
            let report = unsafe { ptr::read_unaligned(buf.as_ptr().cast::<PreExecReport>()) };
            reports.push(report);
            offset = 0;
        }
    }

    reports
}

/// Map a serialized step id to a stable string for logging and errors.
fn step_name(step: u8) -> &'static str {
    match step {
        x if x == PreExecStep::InitGroups as u8 => PreExecStep::InitGroups.as_str(),
        x if x == PreExecStep::SetSid as u8 => PreExecStep::SetSid.as_str(),
        x if x == PreExecStep::SetCtty as u8 => PreExecStep::SetCtty.as_str(),
        x if x == PreExecStep::Dup2Stdin as u8 => PreExecStep::Dup2Stdin.as_str(),
        x if x == PreExecStep::Dup2Stdout as u8 => PreExecStep::Dup2Stdout.as_str(),
        x if x == PreExecStep::Dup2Stderr as u8 => PreExecStep::Dup2Stderr.as_str(),
        _ => "unknown",
    }
}

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
    let (report_read_fd, report_write_fd) = match create_report_pipe() {
        Ok((read_fd, write_fd)) => (read_fd, write_fd),
        Err(_) => (-1, -1),
    };

    // On Linux, we need to call initgroups() to set supplementary groups.
    // On macOS, initgroups() fails with EPERM in pre_exec context, but
    // supplementary groups are inherited correctly from Open Directory.
    #[cfg(target_os = "linux")]
    let initgroups_gid = gid;
    #[cfg(target_os = "linux")]
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
    // We report failures to the parent via a pipe since logging is not safe here.
    // The username CString is created before this closure is invoked.
    unsafe {
        cmd.pre_exec(move || {
            if report_read_fd >= 0 {
                libc::close(report_read_fd);
            }

            // Set supplementary groups from /etc/group (Linux only)
            // On macOS, this fails with EPERM in pre_exec context, but groups
            // are inherited correctly from Open Directory without it.
            #[cfg(target_os = "linux")]
            {
                let ret = libc::initgroups(username.as_ptr(), initgroups_gid);
                if ret != 0 {
                    let err = std::io::Error::last_os_error();
                    let errno = err.raw_os_error().unwrap_or(libc::EINVAL);
                    // In rootless/user-namespace containers, setgroups is often denied.
                    // If initgroups fails with EPERM, continue without supplemental groups.
                    if errno == libc::EPERM {
                        if report_write_fd >= 0 {
                            write_pre_exec_report(
                                report_write_fd,
                                PRE_EXEC_REPORT_KIND_WARNING,
                                PreExecStep::InitGroups,
                                errno,
                            );
                        }
                    } else {
                        if report_write_fd >= 0 {
                            write_pre_exec_report(
                                report_write_fd,
                                PRE_EXEC_REPORT_KIND_ERROR,
                                PreExecStep::InitGroups,
                                errno,
                            );
                        }
                        return Err(err);
                    }
                }
            }

            // Create a new session (detach from broker's session)
            // This makes the child the session leader
            let ret = libc::setsid();
            if ret == -1 {
                let err = std::io::Error::last_os_error();
                let errno = err.raw_os_error().unwrap_or(libc::EINVAL);
                if report_write_fd >= 0 {
                    write_pre_exec_report(
                        report_write_fd,
                        PRE_EXEC_REPORT_KIND_ERROR,
                        PreExecStep::SetSid,
                        errno,
                    );
                }
                return Err(err);
            }

            // Set the PTY slave as the controlling terminal
            // The 0 argument means "don't steal if already owned"
            // (but since we're a new session, there's no existing ctty)
            let ret = libc::ioctl(slave_fd, TIOCSCTTY, 0);
            if ret == -1 {
                let err = std::io::Error::last_os_error();
                let errno = err.raw_os_error().unwrap_or(libc::EINVAL);
                if report_write_fd >= 0 {
                    write_pre_exec_report(
                        report_write_fd,
                        PRE_EXEC_REPORT_KIND_ERROR,
                        PreExecStep::SetCtty,
                        errno,
                    );
                }
                return Err(err);
            }

            // Redirect stdio to the PTY slave
            // dup2 is async-signal-safe
            if libc::dup2(slave_fd, libc::STDIN_FILENO) == -1 {
                let err = std::io::Error::last_os_error();
                let errno = err.raw_os_error().unwrap_or(libc::EINVAL);
                if report_write_fd >= 0 {
                    write_pre_exec_report(
                        report_write_fd,
                        PRE_EXEC_REPORT_KIND_ERROR,
                        PreExecStep::Dup2Stdin,
                        errno,
                    );
                }
                return Err(err);
            }
            if libc::dup2(slave_fd, libc::STDOUT_FILENO) == -1 {
                let err = std::io::Error::last_os_error();
                let errno = err.raw_os_error().unwrap_or(libc::EINVAL);
                if report_write_fd >= 0 {
                    write_pre_exec_report(
                        report_write_fd,
                        PRE_EXEC_REPORT_KIND_ERROR,
                        PreExecStep::Dup2Stdout,
                        errno,
                    );
                }
                return Err(err);
            }
            if libc::dup2(slave_fd, libc::STDERR_FILENO) == -1 {
                let err = std::io::Error::last_os_error();
                let errno = err.raw_os_error().unwrap_or(libc::EINVAL);
                if report_write_fd >= 0 {
                    write_pre_exec_report(
                        report_write_fd,
                        PRE_EXEC_REPORT_KIND_ERROR,
                        PreExecStep::Dup2Stderr,
                        errno,
                    );
                }
                return Err(err);
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
    let spawn_result = cmd.spawn();

    if report_write_fd >= 0 {
        unsafe {
            libc::close(report_write_fd);
        }
    }
    let reports = if report_read_fd >= 0 {
        let reports = read_pre_exec_reports(report_read_fd);
        unsafe {
            libc::close(report_read_fd);
        }
        reports
    } else {
        Vec::new()
    };

    match spawn_result {
        Ok(child) => {
            for report in reports
                .into_iter()
                .filter(|report| report.kind == PRE_EXEC_REPORT_KIND_WARNING)
            {
                warn!(
                    syscall = step_name(report.step),
                    errno = report.errno,
                    "pre-exec syscall failed; continuing without supplemental groups"
                );
            }
            Ok(child)
        }
        Err(err) => {
            if let Some(report) = reports
                .into_iter()
                .find(|report| report.kind == PRE_EXEC_REPORT_KIND_ERROR)
            {
                let io_err = std::io::Error::from_raw_os_error(report.errno);
                return Err(SpawnError::Setup(format!(
                    "{} failed: {}",
                    step_name(report.step),
                    io_err
                )));
            }
            Err(SpawnError::Spawn(err))
        }
    }
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

    // This test only applies on Linux where we validate the username for initgroups
    #[test]
    #[cfg(target_os = "linux")]
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
