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
//! # Security Model
//!
//! 1. Broker runs as root with `CAP_SETUID`, `CAP_SETGID`
//! 2. Pre-exec hook sets up supplementary groups with `initgroups`
//! 3. `CommandExt::uid/gid` drops to user's UID/GID
//! 4. `setsid` creates a new session (process becomes leader)
//! 5. `TIOCSCTTY` establishes controlling terminal
//! 6. stdio is redirected to the PTY slave

// Placeholder - Task 2 will implement the actual spawn logic.
