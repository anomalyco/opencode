//! Session-to-user mapping storage.
//!
//! Maps web session IDs to UNIX user information, enabling the broker to look up
//! user details (UID, GID, home directory, shell) when spawning PTY sessions.

use std::collections::HashMap;
use std::sync::RwLock;

/// UNIX user information associated with a session.
#[derive(Debug, Clone)]
pub struct UserInfo {
    /// Username (from /etc/passwd).
    pub username: String,
    /// User ID.
    pub uid: u32,
    /// Primary group ID.
    pub gid: u32,
    /// Home directory path.
    pub home: String,
    /// Login shell path.
    pub shell: String,
}

/// Maps web session IDs to UNIX user information.
///
/// The web server registers sessions after successful authentication,
/// and the broker looks up user info when spawning PTYs.
///
/// # Thread Safety
///
/// Uses `RwLock` for thread-safe concurrent access. Reads are lock-free
/// relative to each other, only writes block.
pub struct UserSessionStore {
    sessions: RwLock<HashMap<String, UserInfo>>,
}

impl UserSessionStore {
    /// Create a new empty session store.
    #[must_use]
    pub fn new() -> Self {
        Self {
            sessions: RwLock::new(HashMap::new()),
        }
    }

    /// Register a session with user info.
    ///
    /// Called by web server after successful login.
    ///
    /// # Arguments
    ///
    /// * `session_id` - Unique session identifier from the web server
    /// * `user` - UNIX user information for this session
    pub fn register(&self, session_id: &str, user: UserInfo) {
        let mut sessions = self.sessions.write().expect("sessions lock poisoned");
        sessions.insert(session_id.to_string(), user);
    }

    /// Look up user info by session ID.
    ///
    /// Returns `None` if the session doesn't exist.
    #[must_use]
    pub fn get(&self, session_id: &str) -> Option<UserInfo> {
        let sessions = self.sessions.read().expect("sessions lock poisoned");
        sessions.get(session_id).cloned()
    }

    /// Remove a session (logout).
    ///
    /// Returns `true` if the session existed and was removed.
    pub fn remove(&self, session_id: &str) -> bool {
        let mut sessions = self.sessions.write().expect("sessions lock poisoned");
        sessions.remove(session_id).is_some()
    }

    /// Remove all sessions for a user (logout everywhere).
    ///
    /// Returns the number of sessions removed.
    pub fn remove_by_user(&self, username: &str) -> usize {
        let mut sessions = self.sessions.write().expect("sessions lock poisoned");
        let to_remove: Vec<_> = sessions
            .iter()
            .filter(|(_, u)| u.username == username)
            .map(|(k, _)| k.clone())
            .collect();
        let count = to_remove.len();
        for key in to_remove {
            sessions.remove(&key);
        }
        count
    }

    /// Get the number of active sessions.
    #[must_use]
    pub fn len(&self) -> usize {
        let sessions = self.sessions.read().expect("sessions lock poisoned");
        sessions.len()
    }

    /// Check if there are no active sessions.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

impl Default for UserSessionStore {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_user(name: &str) -> UserInfo {
        UserInfo {
            username: name.to_string(),
            uid: 1000,
            gid: 1000,
            home: format!("/home/{name}"),
            shell: "/bin/bash".to_string(),
        }
    }

    #[test]
    fn test_register_and_get() {
        let store = UserSessionStore::new();
        let user = test_user("testuser");

        store.register("session-1", user);

        let retrieved = store.get("session-1").expect("should exist");
        assert_eq!(retrieved.username, "testuser");
        assert_eq!(retrieved.uid, 1000);
        assert_eq!(retrieved.home, "/home/testuser");
    }

    #[test]
    fn test_get_nonexistent_returns_none() {
        let store = UserSessionStore::new();
        assert!(store.get("nonexistent").is_none());
    }

    #[test]
    fn test_remove() {
        let store = UserSessionStore::new();
        store.register("session-1", test_user("testuser"));

        assert!(store.remove("session-1"));
        assert!(store.get("session-1").is_none());
    }

    #[test]
    fn test_remove_nonexistent_returns_false() {
        let store = UserSessionStore::new();
        assert!(!store.remove("nonexistent"));
    }

    #[test]
    fn test_remove_by_user() {
        let store = UserSessionStore::new();
        store.register("session-1", test_user("alice"));
        store.register("session-2", test_user("alice"));
        store.register("session-3", test_user("bob"));

        assert_eq!(store.remove_by_user("alice"), 2);
        assert!(store.get("session-1").is_none());
        assert!(store.get("session-2").is_none());
        assert!(store.get("session-3").is_some());
    }

    #[test]
    fn test_remove_by_user_nonexistent_returns_zero() {
        let store = UserSessionStore::new();
        store.register("session-1", test_user("alice"));

        assert_eq!(store.remove_by_user("nonexistent"), 0);
    }

    #[test]
    fn test_len_and_is_empty() {
        let store = UserSessionStore::new();
        assert!(store.is_empty());
        assert_eq!(store.len(), 0);

        store.register("session-1", test_user("user1"));
        assert!(!store.is_empty());
        assert_eq!(store.len(), 1);

        store.register("session-2", test_user("user2"));
        assert_eq!(store.len(), 2);

        store.remove("session-1");
        assert_eq!(store.len(), 1);
    }

    #[test]
    fn test_overwrite_session() {
        let store = UserSessionStore::new();
        store.register("session-1", test_user("alice"));
        store.register("session-1", test_user("bob"));

        let retrieved = store.get("session-1").expect("should exist");
        assert_eq!(retrieved.username, "bob");
    }
}
