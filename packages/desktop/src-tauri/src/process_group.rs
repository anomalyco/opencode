//! Linux Process Group for reliable child process cleanup.
//!
//! This module provides utilities to ensure child processes are terminated
//! when the parent process exits, even if the parent crashes or is killed.
//!
//! It uses two mechanisms:
//! - `prctl(PR_SET_PDEATHSIG, SIGTERM)`: Tells the kernel to send SIGTERM to
//!   the child when its parent dies
//! - Process groups: Allows killing all related processes with a single signal
//!
//! This is the Linux equivalent of the Windows `job_object.rs` module.

use std::sync::Mutex;

/// Holds the PIDs of spawned processes for cleanup on exit.
/// On Linux, when the parent process exits normally, we kill all tracked processes.
/// If the parent crashes, the kernel's PDEATHSIG mechanism handles cleanup.
pub struct ProcessGroupState {
    pids: Mutex<Vec<u32>>,
}

impl ProcessGroupState {
    pub fn new() -> Self {
        Self {
            pids: Mutex::new(Vec::new()),
        }
    }

    /// Registers a process ID for cleanup when the app exits.
    pub fn add_pid(&self, pid: u32) {
        if let Ok(mut pids) = self.pids.lock() {
            pids.push(pid);
            println!("Registered process {pid} for cleanup on exit");
        }
    }

    /// Kills all tracked processes and their process groups.
    pub fn kill_all(&self) {
        let pids = match self.pids.lock() {
            Ok(mut guard) => std::mem::take(&mut *guard),
            Err(_) => return,
        };

        for pid in pids {
            // First try to kill the process group (negative PID)
            // This catches any children the process may have spawned
            unsafe {
                let pgid = libc::getpgid(pid as i32);
                if pgid > 0 {
                    libc::kill(-pgid, libc::SIGTERM);
                }
                // Also kill the process directly in case it's not a group leader
                libc::kill(pid as i32, libc::SIGTERM);
            }
            println!("Sent SIGTERM to process {pid} and its group");
        }
    }
}

impl Drop for ProcessGroupState {
    fn drop(&mut self) {
        self.kill_all();
    }
}

/// Configuration for spawning a process with proper cleanup on Linux.
/// Call this in a `pre_exec` closure to ensure the child dies when parent dies.
///
/// # Safety
/// Must be called in a pre_exec context (after fork, before exec).
/// Only async-signal-safe functions should be used here.
pub unsafe fn configure_child_process() -> std::io::Result<()> {
    unsafe {
        // Set up death signal: when parent dies, child receives SIGTERM
        if libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGTERM) == -1 {
            return Err(std::io::Error::last_os_error());
        }

        // Check if parent already died (race condition protection)
        // If parent died between fork() and prctl(), we're now orphaned to init (PID 1)
        if libc::getppid() == 1 {
            // Parent already died, exit immediately
            libc::_exit(1);
        }

        // Create a new session/process group so we can kill all children together
        // setsid() makes this process the leader of a new process group
        if libc::setsid() == -1 {
            // setsid can fail if we're already a session leader, which is fine
            // Just log and continue
            eprintln!("setsid() failed (may already be session leader)");
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_process_group_state_creation() {
        let state = ProcessGroupState::new();
        state.add_pid(12345);
        // Just verify it doesn't panic
    }
}
