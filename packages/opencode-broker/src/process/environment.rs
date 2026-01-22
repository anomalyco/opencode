//! Login environment setup for user process spawning.
//!
//! This module provides configuration for setting up a login-like environment
//! when spawning user processes. It ensures the process receives the correct
//! environment variables expected by login shells.

use std::collections::HashMap;

/// Default PATH for login shells.
///
/// This includes standard directories in a security-conscious order:
/// - `/usr/local/bin`: User-installed binaries (higher priority)
/// - `/usr/bin`: System binaries
/// - `/bin`: Essential binaries
/// - `/usr/sbin`: System administration binaries
/// - `/sbin`: Essential system administration binaries
const DEFAULT_PATH: &str = "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";

/// Configuration for a login environment.
///
/// This struct holds all the information needed to construct a proper
/// login shell environment for a user process.
#[derive(Debug, Clone)]
pub struct LoginEnvironment {
    /// Username for USER and LOGNAME variables.
    pub user: String,
    /// Home directory path.
    pub home: String,
    /// User's login shell path.
    pub shell: String,
    /// User ID (for documentation/debugging, not used in env).
    pub uid: u32,
    /// Group ID (for documentation/debugging, not used in env).
    pub gid: u32,
    /// Terminal type (default: xterm-256color).
    pub term: String,
    /// Additional environment variables to include.
    pub extra_env: HashMap<String, String>,
}

impl LoginEnvironment {
    /// Create a new login environment configuration.
    ///
    /// # Arguments
    ///
    /// * `user` - Username
    /// * `home` - Home directory path
    /// * `shell` - Login shell path
    /// * `uid` - User ID
    /// * `gid` - Group ID
    #[must_use]
    pub fn new(user: String, home: String, shell: String, uid: u32, gid: u32) -> Self {
        Self {
            user,
            home,
            shell,
            uid,
            gid,
            term: "xterm-256color".to_string(),
            extra_env: HashMap::new(),
        }
    }

    /// Set the terminal type.
    #[must_use]
    pub fn with_term(mut self, term: String) -> Self {
        self.term = term;
        self
    }

    /// Add an extra environment variable.
    #[must_use]
    pub fn with_env(mut self, key: String, value: String) -> Self {
        self.extra_env.insert(key, value);
        self
    }

    /// Add multiple extra environment variables.
    #[must_use]
    pub fn with_envs(mut self, envs: HashMap<String, String>) -> Self {
        self.extra_env.extend(envs);
        self
    }

    /// Build the environment variables for the login shell.
    ///
    /// Returns a fresh environment (does not inherit from parent process).
    /// This is important for security: the broker runs as root, and we don't
    /// want root's environment leaking into user processes.
    ///
    /// # Standard variables set
    ///
    /// - `USER` - Username
    /// - `LOGNAME` - Username (POSIX standard)
    /// - `HOME` - Home directory
    /// - `SHELL` - Login shell
    /// - `TERM` - Terminal type
    /// - `PATH` - Standard search path
    /// - `OPENCODE` - Marker variable indicating opencode environment
    ///
    /// # Extra variables
    ///
    /// If `SSH_AUTH_SOCK` is in `extra_env`, it will be included for git SSH key support.
    /// If `GPG_AGENT_INFO` is in `extra_env`, it will be included for GPG signing.
    #[must_use]
    pub fn build(&self) -> Vec<(String, String)> {
        let mut env = Vec::with_capacity(7 + self.extra_env.len());

        // Standard login environment variables
        env.push(("USER".to_string(), self.user.clone()));
        env.push(("LOGNAME".to_string(), self.user.clone()));
        env.push(("HOME".to_string(), self.home.clone()));
        env.push(("SHELL".to_string(), self.shell.clone()));
        env.push(("TERM".to_string(), self.term.clone()));
        env.push(("PATH".to_string(), DEFAULT_PATH.to_string()));

        // Marker variable for opencode environment detection
        env.push(("OPENCODE".to_string(), "1".to_string()));

        // Add extra environment variables
        for (key, value) in &self.extra_env {
            env.push((key.clone(), value.clone()));
        }

        env
    }

    /// Get the default PATH used for login shells.
    #[must_use]
    pub const fn default_path() -> &'static str {
        DEFAULT_PATH
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_sets_required_vars() {
        let env = LoginEnvironment::new(
            "alice".to_string(),
            "/home/alice".to_string(),
            "/bin/bash".to_string(),
            1000,
            1000,
        );

        let vars = env.build();
        let vars_map: HashMap<_, _> = vars.into_iter().collect();

        assert_eq!(vars_map.get("USER"), Some(&"alice".to_string()));
        assert_eq!(vars_map.get("LOGNAME"), Some(&"alice".to_string()));
        assert_eq!(vars_map.get("HOME"), Some(&"/home/alice".to_string()));
        assert_eq!(vars_map.get("SHELL"), Some(&"/bin/bash".to_string()));
        assert_eq!(vars_map.get("TERM"), Some(&"xterm-256color".to_string()));
        assert!(vars_map.contains_key("PATH"));
        assert_eq!(vars_map.get("OPENCODE"), Some(&"1".to_string()));
    }

    #[test]
    fn test_build_includes_extra_env() {
        let env = LoginEnvironment::new(
            "bob".to_string(),
            "/home/bob".to_string(),
            "/bin/zsh".to_string(),
            1001,
            1001,
        )
        .with_env(
            "SSH_AUTH_SOCK".to_string(),
            "/tmp/ssh-agent.sock".to_string(),
        )
        .with_env(
            "GPG_AGENT_INFO".to_string(),
            "/tmp/gpg-agent.info".to_string(),
        );

        let vars = env.build();
        let vars_map: HashMap<_, _> = vars.into_iter().collect();

        assert_eq!(
            vars_map.get("SSH_AUTH_SOCK"),
            Some(&"/tmp/ssh-agent.sock".to_string())
        );
        assert_eq!(
            vars_map.get("GPG_AGENT_INFO"),
            Some(&"/tmp/gpg-agent.info".to_string())
        );
    }

    #[test]
    fn test_default_path_includes_standard_dirs() {
        let path = LoginEnvironment::default_path();

        assert!(path.contains("/usr/local/bin"));
        assert!(path.contains("/usr/bin"));
        assert!(path.contains("/bin"));
        assert!(path.contains("/usr/sbin"));
        assert!(path.contains("/sbin"));
    }

    #[test]
    fn test_with_term_overrides_default() {
        let env = LoginEnvironment::new(
            "charlie".to_string(),
            "/home/charlie".to_string(),
            "/bin/sh".to_string(),
            1002,
            1002,
        )
        .with_term("screen-256color".to_string());

        let vars = env.build();
        let vars_map: HashMap<_, _> = vars.into_iter().collect();

        assert_eq!(vars_map.get("TERM"), Some(&"screen-256color".to_string()));
    }

    #[test]
    fn test_with_envs_adds_multiple() {
        let mut extra = HashMap::new();
        extra.insert("FOO".to_string(), "bar".to_string());
        extra.insert("BAZ".to_string(), "qux".to_string());

        let env = LoginEnvironment::new(
            "dave".to_string(),
            "/home/dave".to_string(),
            "/bin/bash".to_string(),
            1003,
            1003,
        )
        .with_envs(extra);

        let vars = env.build();
        let vars_map: HashMap<_, _> = vars.into_iter().collect();

        assert_eq!(vars_map.get("FOO"), Some(&"bar".to_string()));
        assert_eq!(vars_map.get("BAZ"), Some(&"qux".to_string()));
    }
}
