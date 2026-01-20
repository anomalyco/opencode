use serde::Deserialize;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use thiserror::Error;

/// Configuration filename to search for.
const CONFIG_FILENAME: &str = "opencode.json";

/// Broker configuration loaded from opencode.json.
#[derive(Debug, Clone)]
pub struct BrokerConfig {
    /// PAM service name (default: "opencode").
    pub pam_service: String,
    /// Unix socket path for IPC.
    pub socket_path: String,
    /// Maximum failed authentication attempts per minute per username.
    pub rate_limit_per_minute: u32,
    /// Lockout duration in minutes after rate limit exceeded.
    pub rate_limit_lockout_minutes: u32,
}

impl Default for BrokerConfig {
    fn default() -> Self {
        Self {
            pam_service: "opencode".to_string(),
            socket_path: default_socket_path(),
            rate_limit_per_minute: 5,
            rate_limit_lockout_minutes: 15,
        }
    }
}

/// Get the default socket path based on platform.
fn default_socket_path() -> String {
    #[cfg(target_os = "linux")]
    {
        "/run/opencode/auth.sock".to_string()
    }
    #[cfg(target_os = "macos")]
    {
        "/var/run/opencode/auth.sock".to_string()
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        "/tmp/opencode/auth.sock".to_string()
    }
}

/// Errors that can occur during configuration loading.
#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("configuration file not found: searched up to filesystem root")]
    NotFound,
    #[error("failed to read configuration file: {0}")]
    ReadError(#[from] std::io::Error),
    #[error("failed to parse configuration file: {0}")]
    ParseError(#[from] serde_json::Error),
    #[error("invalid configuration: {0}")]
    ValidationError(String),
}

/// Raw configuration structure matching opencode.json format.
#[derive(Debug, Deserialize)]
struct RawConfig {
    auth: Option<RawAuthConfig>,
}

#[derive(Debug, Deserialize)]
struct RawAuthConfig {
    pam: Option<RawPamConfig>,
    #[serde(rename = "rateLimiting")]
    rate_limiting: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct RawPamConfig {
    service: Option<String>,
}

/// Load broker configuration from opencode.json.
///
/// Searches for opencode.json starting from the current directory
/// and walking up to the filesystem root.
///
/// If no config file is found or auth section is missing,
/// returns default configuration.
pub fn load_config() -> Result<BrokerConfig, ConfigError> {
    load_config_from_dir(&env::current_dir().map_err(ConfigError::ReadError)?)
}

/// Load broker configuration starting from a specific directory.
pub fn load_config_from_dir(start_dir: &Path) -> Result<BrokerConfig, ConfigError> {
    match find_config_file(start_dir) {
        Some(path) => load_config_from_file(&path),
        None => Ok(BrokerConfig::default()),
    }
}

/// Load configuration from a specific file path.
pub fn load_config_from_file(path: &Path) -> Result<BrokerConfig, ConfigError> {
    let contents = fs::read_to_string(path)?;
    parse_config(&contents)
}

/// Parse configuration from JSON string.
pub fn parse_config(json: &str) -> Result<BrokerConfig, ConfigError> {
    let raw: RawConfig = serde_json::from_str(json)?;
    let mut config = BrokerConfig::default();

    if let Some(auth) = raw.auth {
        if let Some(pam) = auth.pam
            && let Some(service) = pam.service
        {
            validate_pam_service(&service)?;
            config.pam_service = service;
        }

        // If rate limiting is explicitly disabled, use very high limits
        if auth.rate_limiting == Some(false) {
            config.rate_limit_per_minute = u32::MAX;
            config.rate_limit_lockout_minutes = 0;
        }
    }

    Ok(config)
}

/// Find opencode.json by walking up from the starting directory.
fn find_config_file(start_dir: &Path) -> Option<PathBuf> {
    let mut current = start_dir.to_path_buf();

    loop {
        let config_path = current.join(CONFIG_FILENAME);
        if config_path.exists() {
            return Some(config_path);
        }

        match current.parent() {
            Some(parent) => current = parent.to_path_buf(),
            None => return None,
        }
    }
}

/// Validate PAM service name.
fn validate_pam_service(service: &str) -> Result<(), ConfigError> {
    if service.is_empty() {
        return Err(ConfigError::ValidationError(
            "PAM service name cannot be empty".to_string(),
        ));
    }

    // PAM service names should be simple identifiers (alphanumeric + underscore/hyphen)
    // They become filenames in /etc/pam.d/
    if !service
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err(ConfigError::ValidationError(format!(
            "PAM service name contains invalid characters: {}",
            service
        )));
    }

    // No path traversal
    if service.contains("..") || service.contains('/') {
        return Err(ConfigError::ValidationError(
            "PAM service name cannot contain path components".to_string(),
        ));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_values() {
        let config = BrokerConfig::default();
        assert_eq!(config.pam_service, "opencode");
        assert_eq!(config.rate_limit_per_minute, 5);
        assert_eq!(config.rate_limit_lockout_minutes, 15);
    }

    #[test]
    fn test_parse_empty_config() {
        let json = "{}";
        let config = parse_config(json).expect("should parse");
        assert_eq!(config.pam_service, "opencode");
    }

    #[test]
    fn test_parse_auth_config() {
        let json = r#"{"auth":{"pam":{"service":"myapp"}}}"#;
        let config = parse_config(json).expect("should parse");
        assert_eq!(config.pam_service, "myapp");
    }

    #[test]
    fn test_parse_rate_limiting_disabled() {
        let json = r#"{"auth":{"rateLimiting":false}}"#;
        let config = parse_config(json).expect("should parse");
        assert_eq!(config.rate_limit_per_minute, u32::MAX);
        assert_eq!(config.rate_limit_lockout_minutes, 0);
    }

    #[test]
    fn test_parse_invalid_json() {
        let json = "not json";
        let result = parse_config(json);
        assert!(matches!(result, Err(ConfigError::ParseError(_))));
    }

    #[test]
    fn test_validate_pam_service_empty() {
        let json = r#"{"auth":{"pam":{"service":""}}}"#;
        let result = parse_config(json);
        assert!(matches!(result, Err(ConfigError::ValidationError(_))));
    }

    #[test]
    fn test_validate_pam_service_invalid_chars() {
        let json = r#"{"auth":{"pam":{"service":"bad/service"}}}"#;
        let result = parse_config(json);
        assert!(matches!(result, Err(ConfigError::ValidationError(_))));
    }

    #[test]
    fn test_validate_pam_service_path_traversal() {
        let json = r#"{"auth":{"pam":{"service":"../etc/shadow"}}}"#;
        let result = parse_config(json);
        assert!(matches!(result, Err(ConfigError::ValidationError(_))));
    }

    #[test]
    fn test_default_socket_path_platform() {
        let path = default_socket_path();
        // Just verify it's a reasonable path
        assert!(path.starts_with('/'));
        assert!(path.ends_with("auth.sock"));
    }
}
