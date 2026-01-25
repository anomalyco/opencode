//! OTP (One-Time Password) module for two-factor authentication.
//!
//! Provides detection and validation of TOTP-based 2FA using pam_google_authenticator.

use std::ffi::OsString;
use std::fs;
use std::io::Write;
use std::path::Path;
use std::thread;
use tokio::sync::oneshot;

use super::pam::AuthError;

/// Result of OTP configuration check.
#[derive(Debug, Clone)]
pub struct OtpConfigStatus {
    /// Whether all configuration is valid.
    pub configured: bool,
    /// Whether the PAM module is installed.
    pub pam_module_installed: bool,
    /// Path where PAM module was found (or expected path if not found).
    pub pam_module_path: String,
    /// Whether the PAM service file exists.
    pub pam_service_exists: bool,
    /// Path to PAM service file.
    pub pam_service_path: String,
    /// If service was auto-created.
    pub service_auto_created: bool,
    /// Specific error code if not configured.
    pub error_code: Option<String>,
}

/// Platform-specific paths where pam_google_authenticator.so might be installed.
#[cfg(target_os = "linux")]
const PAM_MODULE_PATHS: &[&str] = &[
    "/lib/security/pam_google_authenticator.so",
    "/lib/x86_64-linux-gnu/security/pam_google_authenticator.so",
    "/lib64/security/pam_google_authenticator.so",
    "/usr/lib/security/pam_google_authenticator.so",
    "/usr/lib/x86_64-linux-gnu/security/pam_google_authenticator.so",
    "/usr/lib64/security/pam_google_authenticator.so",
];

#[cfg(target_os = "macos")]
const PAM_MODULE_PATHS: &[&str] = &[
    "/opt/homebrew/lib/security/pam_google_authenticator.so",
    "/usr/local/lib/security/pam_google_authenticator.so",
    "/opt/local/lib/security/pam_google_authenticator.so",
];

/// Content for the PAM service file.
const PAM_SERVICE_CONTENT: &str = "# PAM configuration for opencode OTP validation
# Auto-created by opencode-broker
auth required pam_google_authenticator.so nullok
";

/// Check if the PAM google_authenticator module is installed.
fn find_pam_module() -> Option<String> {
    for path in PAM_MODULE_PATHS {
        if Path::new(path).exists() {
            return Some(path.to_string());
        }
    }
    None
}

/// Check the OTP/2FA server configuration.
///
/// Verifies:
/// 1. PAM google_authenticator module is installed
/// 2. PAM service file exists at /etc/pam.d/opencode-otp
///
/// If the service file is missing and the broker has permissions,
/// it will attempt to auto-create it.
///
/// # Returns
///
/// `OtpConfigStatus` with detailed information about the configuration state.
pub fn check_otp_config(pam_service: &str) -> OtpConfigStatus {
    let otp_service_path = format!("/etc/pam.d/{}-otp", pam_service);
    let mut status = OtpConfigStatus {
        configured: false,
        pam_module_installed: false,
        pam_module_path: PAM_MODULE_PATHS.first().unwrap_or(&"").to_string(),
        pam_service_exists: false,
        pam_service_path: otp_service_path.clone(),
        service_auto_created: false,
        error_code: None,
    };

    // Check if PAM module is installed
    if let Some(path) = find_pam_module() {
        status.pam_module_installed = true;
        status.pam_module_path = path;
        tracing::debug!(
            path = %status.pam_module_path,
            "PAM google_authenticator module found"
        );
    } else {
        status.error_code = Some("pam_module_not_installed".to_string());
        tracing::warn!(
            expected_paths = ?PAM_MODULE_PATHS,
            "PAM google_authenticator module not found"
        );
        return status;
    }

    // Check if PAM service file exists
    if Path::new(&otp_service_path).exists() {
        status.pam_service_exists = true;
        tracing::debug!(
            path = %otp_service_path,
            "PAM OTP service file found"
        );
    } else {
        tracing::info!(
            path = %otp_service_path,
            "PAM OTP service file not found, attempting to create"
        );

        // Try to create the service file
        match fs::File::create(&otp_service_path) {
            Ok(mut file) => {
                if let Err(e) = file.write_all(PAM_SERVICE_CONTENT.as_bytes()) {
                    tracing::warn!(
                        error = %e,
                        path = %otp_service_path,
                        "Failed to write PAM service file"
                    );
                    status.error_code = Some("pam_service_not_configured".to_string());
                    return status;
                }
                status.pam_service_exists = true;
                status.service_auto_created = true;
                tracing::info!(
                    path = %otp_service_path,
                    "PAM OTP service file auto-created"
                );
            }
            Err(e) => {
                tracing::warn!(
                    error = %e,
                    path = %otp_service_path,
                    "Failed to create PAM service file (permission denied?)"
                );
                status.error_code = Some("pam_service_not_configured".to_string());
                return status;
            }
        }
    }

    // All checks passed
    status.configured = true;
    status
}

/// Check if a user has 2FA configured.
///
/// Looks for the presence of a `.google_authenticator` file in the user's home directory.
/// This file is created by `google-authenticator` when setting up TOTP.
///
/// # Arguments
///
/// * `home` - The user's home directory path
///
/// # Returns
///
/// * `true` - If the user has a `.google_authenticator` file
/// * `false` - If the file doesn't exist or isn't readable
pub fn has_2fa_configured(home: &str) -> bool {
    let auth_file = Path::new(home).join(".google_authenticator");

    // Check if file exists and is readable
    match std::fs::metadata(&auth_file) {
        Ok(metadata) => {
            let exists = metadata.is_file();
            tracing::debug!(
                home = home,
                auth_file = ?auth_file,
                exists = exists,
                "2FA configuration check"
            );
            exists
        }
        Err(_) => {
            tracing::debug!(
                home = home,
                auth_file = ?auth_file,
                "2FA configuration file not found"
            );
            false
        }
    }
}

/// Validate an OTP code via PAM.
///
/// Uses a separate PAM service (`{service}-otp`) for OTP-only validation.
/// This is called after password authentication succeeds.
///
/// # Arguments
///
/// * `pam_service` - Base PAM service name (e.g., "opencode"). "-otp" will be appended.
/// * `username` - Username to validate OTP for
/// * `code` - The OTP code to validate
///
/// # Returns
///
/// * `Ok(())` - OTP validation successful
/// * `Err(AuthError::PamError)` - OTP validation failed
/// * `Err(AuthError::Internal)` - Internal error (channel/thread failure)
///
/// # Security Notes
///
/// - OTP codes are never logged
/// - All PAM errors are mapped to generic errors to prevent enumeration
pub async fn validate_otp(pam_service: &str, username: &str, code: &str) -> Result<(), AuthError> {
    let (tx, rx) = oneshot::channel();

    // Clone data for the thread
    let otp_service = format!("{}-otp", pam_service);
    let username = username.to_string();
    let code = code.to_string();

    // Spawn a dedicated thread for PAM authentication
    // CRITICAL: PAM handles are NOT thread-safe when shared
    thread::spawn(move || {
        let result = do_otp_validation(&otp_service, &username, &code);
        let _ = tx.send(result);
    });

    rx.await.map_err(|_| {
        tracing::error!("OTP validation thread failed to send result");
        AuthError::Internal
    })?
}

/// Perform OTP validation in a dedicated thread.
fn do_otp_validation(service: &str, username: &str, code: &str) -> Result<(), AuthError> {
    use nonstick::{
        AuthnFlags, ConversationAdapter, Result as PamResult, Transaction, TransactionBuilder,
    };
    use std::ffi::OsStr;

    // Conversation handler for OTP - responds to any prompt with the OTP code
    struct OtpConversation {
        code: String,
    }

    impl ConversationAdapter for OtpConversation {
        fn prompt(&self, _request: impl AsRef<OsStr>) -> PamResult<OsString> {
            // For OTP, we return the code for any prompt
            Ok(OsString::from(&self.code))
        }

        fn masked_prompt(&self, _request: impl AsRef<OsStr>) -> PamResult<OsString> {
            // OTP code is also returned for masked prompts
            Ok(OsString::from(&self.code))
        }

        fn error_msg(&self, message: impl AsRef<OsStr>) {
            tracing::warn!(
                message = ?message.as_ref(),
                "PAM OTP error message"
            );
        }

        fn info_msg(&self, message: impl AsRef<OsStr>) {
            tracing::debug!(
                message = ?message.as_ref(),
                "PAM OTP info message"
            );
        }
    }

    let conversation = OtpConversation {
        code: code.to_string(),
    };

    // Build PAM transaction for OTP service
    let mut txn = TransactionBuilder::new_with_service(service)
        .username(username)
        .build(conversation.into_conversation())
        .map_err(|e| {
            tracing::debug!(
                error = ?e,
                service = service,
                username = username,
                "PAM OTP context creation failed"
            );
            AuthError::PamError
        })?;

    // Authenticate using OTP
    txn.authenticate(AuthnFlags::empty()).map_err(|e| {
        tracing::debug!(
            error = ?e,
            service = service,
            username = username,
            "PAM OTP validation failed"
        );
        AuthError::PamError
    })?;

    tracing::info!(
        service = service,
        username = username,
        "OTP validation successful"
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn test_has_2fa_configured_file_exists() {
        let tmp = tempdir().unwrap();
        let home = tmp.path().to_str().unwrap();

        // Create the .google_authenticator file
        let auth_file = tmp.path().join(".google_authenticator");
        fs::write(&auth_file, "secret").unwrap();

        assert!(has_2fa_configured(home));
    }

    #[test]
    fn test_has_2fa_configured_file_not_exists() {
        let tmp = tempdir().unwrap();
        let home = tmp.path().to_str().unwrap();

        assert!(!has_2fa_configured(home));
    }

    #[test]
    fn test_has_2fa_configured_invalid_home() {
        assert!(!has_2fa_configured("/nonexistent/path"));
    }

    #[tokio::test]
    #[ignore] // Requires PAM setup
    async fn test_validate_otp_invalid_code() {
        let result = validate_otp("opencode", "testuser", "000000").await;
        assert!(result.is_err());
    }
}
