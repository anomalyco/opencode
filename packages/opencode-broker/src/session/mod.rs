//! Session management for the authentication broker.
//!
//! This module provides mapping between web session IDs and UNIX user information,
//! allowing the broker to look up user details when spawning PTY sessions.

pub mod user;
