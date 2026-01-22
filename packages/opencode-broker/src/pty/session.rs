use std::os::fd::OwnedFd;
use std::time::Instant;

use dashmap::DashMap;
use nix::unistd::Pid;

/// Unique identifier for a PTY session.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct PtyId(String);

impl PtyId {
    /// Create a new random PTY ID using UUID v4.
    #[must_use]
    pub fn new() -> Self {
        Self(uuid::Uuid::new_v4().to_string())
    }

    /// Get the ID as a string slice.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl Default for PtyId {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Display for PtyId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl From<String> for PtyId {
    fn from(s: String) -> Self {
        Self(s)
    }
}

impl From<&str> for PtyId {
    fn from(s: &str) -> Self {
        Self(s.to_string())
    }
}

/// A PTY session representing an allocated PTY with associated metadata.
pub struct PtySession {
    /// Unique identifier for this session.
    pub id: PtyId,
    /// The master end of the PTY (used by the broker for I/O).
    pub master_fd: OwnedFd,
    /// PID of the child process (set after spawn).
    pub child_pid: Option<Pid>,
    /// User ID of the session owner.
    pub uid: u32,
    /// Group ID of the session owner.
    pub gid: u32,
    /// Username of the session owner.
    pub username: String,
    /// User's home directory (for verification/debugging).
    pub home: String,
    /// User's login shell (for verification/debugging).
    pub shell: String,
    /// When the session was created.
    pub created_at: Instant,
    /// Terminal width in columns.
    pub cols: u16,
    /// Terminal height in rows.
    pub rows: u16,
}

impl PtySession {
    /// Create a new PTY session.
    #[must_use]
    pub fn new(
        id: PtyId,
        master_fd: OwnedFd,
        uid: u32,
        gid: u32,
        username: String,
        home: String,
        shell: String,
        cols: u16,
        rows: u16,
    ) -> Self {
        Self {
            id,
            master_fd,
            child_pid: None,
            uid,
            gid,
            username,
            home,
            shell,
            created_at: Instant::now(),
            cols,
            rows,
        }
    }

    /// Set the child process PID.
    pub fn set_child_pid(&mut self, pid: Pid) {
        self.child_pid = Some(pid);
    }
}

/// Thread-safe manager for PTY sessions.
///
/// Uses `DashMap` internally for lock-free concurrent access.
pub struct SessionManager {
    sessions: DashMap<PtyId, PtySession>,
}

impl SessionManager {
    /// Create a new session manager.
    #[must_use]
    pub fn new() -> Self {
        Self {
            sessions: DashMap::new(),
        }
    }

    /// Insert a session and return its ID.
    ///
    /// The session's ID is cloned and returned for future lookups.
    pub fn insert(&self, session: PtySession) -> PtyId {
        let id = session.id.clone();
        self.sessions.insert(id.clone(), session);
        id
    }

    /// Get a reference to a session by ID.
    ///
    /// Returns `None` if the session doesn't exist.
    #[must_use]
    pub fn get(&self, id: &PtyId) -> Option<dashmap::mapref::one::Ref<'_, PtyId, PtySession>> {
        self.sessions.get(id)
    }

    /// Get a mutable reference to a session by ID.
    ///
    /// Returns `None` if the session doesn't exist.
    #[must_use]
    pub fn get_mut(
        &self,
        id: &PtyId,
    ) -> Option<dashmap::mapref::one::RefMut<'_, PtyId, PtySession>> {
        self.sessions.get_mut(id)
    }

    /// Remove a session by ID.
    ///
    /// Returns the removed session, or `None` if it didn't exist.
    pub fn remove(&self, id: &PtyId) -> Option<PtySession> {
        self.sessions.remove(id).map(|(_, session)| session)
    }

    /// Get all session IDs for a specific user.
    ///
    /// This is useful for cleanup when a user logs out.
    #[must_use]
    pub fn get_by_user(&self, username: &str) -> Vec<PtyId> {
        self.sessions
            .iter()
            .filter(|entry| entry.value().username == username)
            .map(|entry| entry.key().clone())
            .collect()
    }

    /// Get the number of active sessions.
    #[must_use]
    pub fn len(&self) -> usize {
        self.sessions.len()
    }

    /// Check if there are no active sessions.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.sessions.is_empty()
    }
}

impl Default for SessionManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pty::allocator::allocate;

    /// Helper to create a test session (skips if PTY allocation fails).
    fn create_test_session(username: &str) -> Option<PtySession> {
        let uid = nix::unistd::getuid().as_raw();
        let gid = nix::unistd::getgid().as_raw();

        let pty_pair = match allocate(uid, gid) {
            Ok(pair) => pair,
            Err(crate::pty::allocator::AllocateError::Chown(nix::Error::EPERM)) => {
                eprintln!("Skipping: chown requires root privileges");
                return None;
            }
            Err(e) => panic!("Unexpected error: {e}"),
        };

        Some(PtySession::new(
            PtyId::new(),
            pty_pair.master,
            uid,
            gid,
            username.to_string(),
            "/home/test".to_string(),
            "/bin/bash".to_string(),
            80,
            24,
        ))
    }

    #[test]
    fn test_pty_id_generation() {
        let id1 = PtyId::new();
        let id2 = PtyId::new();

        // IDs should be unique
        assert_ne!(id1, id2);

        // IDs should be valid UUID v4 format
        assert_eq!(id1.as_str().len(), 36);
        assert_eq!(id2.as_str().len(), 36);
    }

    #[test]
    fn test_insert_and_get() {
        let Some(session) = create_test_session("testuser") else {
            return;
        };

        let manager = SessionManager::new();
        let id = session.id.clone();

        manager.insert(session);

        let retrieved = manager.get(&id);
        assert!(retrieved.is_some());

        let retrieved = retrieved.expect("session should exist");
        assert_eq!(retrieved.username, "testuser");
        assert_eq!(retrieved.cols, 80);
        assert_eq!(retrieved.rows, 24);
    }

    #[test]
    fn test_remove() {
        let Some(session) = create_test_session("removeuser") else {
            return;
        };

        let manager = SessionManager::new();
        let id = session.id.clone();

        manager.insert(session);
        assert!(!manager.is_empty());

        let removed = manager.remove(&id);
        assert!(removed.is_some());
        assert!(manager.is_empty());

        // Should not find after removal
        assert!(manager.get(&id).is_none());
    }

    #[test]
    fn test_get_by_user() {
        let manager = SessionManager::new();

        // Create multiple sessions for different users
        let Some(session1) = create_test_session("alice") else {
            return;
        };
        let Some(session2) = create_test_session("alice") else {
            return;
        };
        let Some(session3) = create_test_session("bob") else {
            return;
        };

        manager.insert(session1);
        manager.insert(session2);
        manager.insert(session3);

        // Should find 2 sessions for alice
        let alice_sessions = manager.get_by_user("alice");
        assert_eq!(alice_sessions.len(), 2);

        // Should find 1 session for bob
        let bob_sessions = manager.get_by_user("bob");
        assert_eq!(bob_sessions.len(), 1);

        // Should find 0 sessions for unknown user
        let unknown_sessions = manager.get_by_user("charlie");
        assert!(unknown_sessions.is_empty());
    }

    #[test]
    fn test_session_set_child_pid() {
        let Some(mut session) = create_test_session("piduser") else {
            return;
        };

        assert!(session.child_pid.is_none());

        session.set_child_pid(Pid::from_raw(12345));

        assert_eq!(session.child_pid, Some(Pid::from_raw(12345)));
    }
}
