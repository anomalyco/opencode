//! OTP (One-Time Password) module for two-factor authentication.
//!
//! Provides detection and validation of TOTP-based 2FA using pam_google_authenticator.

use std::ffi::OsString;
use std::path::Path;
use std::thread;
use tokio::sync::oneshot;

use super::pam::AuthError;

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
