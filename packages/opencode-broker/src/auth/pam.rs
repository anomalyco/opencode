//! PAM authentication wrapper with thread-per-request model.
//!
//! Each authentication request spawns a dedicated thread because PAM handles
//! are NOT thread-safe when shared across threads. This follows the Cockpit
//! authentication model.

use std::ffi::OsString;
use std::thread;
use thiserror::Error;
use tokio::sync::oneshot;

/// Errors that can occur during PAM authentication.
///
/// Note: Error messages are intentionally generic to prevent user enumeration.
/// Internal details are logged via tracing but never exposed to callers.
#[derive(Debug, Error)]
pub enum AuthError {
    /// Authentication failed (generic message to prevent user enumeration).
    #[error("authentication failed")]
    PamError,

    /// Internal error (channel/thread failure).
    #[error("internal authentication error")]
    Internal,
}

/// Authenticate a user via PAM.
///
/// This function spawns a dedicated thread for PAM authentication because
/// PAM handles are not thread-safe when shared. Each thread creates its own
/// PAM context.
///
/// # Arguments
///
/// * `service` - PAM service name (e.g., "opencode")
/// * `username` - Username to authenticate
/// * `password` - Password for authentication
///
/// # Returns
///
/// * `Ok(())` - Authentication successful
/// * `Err(AuthError::PamError)` - Authentication failed (generic error)
/// * `Err(AuthError::Internal)` - Internal error (channel/thread failure)
///
/// # Security Notes
///
/// - All PAM errors are mapped to generic `AuthError::PamError` to prevent
///   user enumeration attacks
/// - Detailed errors are logged internally via tracing
pub async fn authenticate(service: &str, username: &str, password: &str) -> Result<(), AuthError> {
    let (tx, rx) = oneshot::channel();

    // Clone data for the thread
    let service = service.to_string();
    let username = username.to_string();
    let password = password.to_string();

    // Spawn a dedicated thread for PAM authentication
    // CRITICAL: PAM handles are NOT thread-safe when shared
    thread::spawn(move || {
        let result = do_pam_auth(&service, &username, &password);
        let _ = tx.send(result);
    });

    rx.await.map_err(|_| {
        tracing::error!("PAM authentication thread failed to send result");
        AuthError::Internal
    })?
}

/// Perform PAM authentication in a dedicated thread.
///
/// This function creates a fresh PAM context for each authentication request.
/// The context is automatically dropped when the function returns.
fn do_pam_auth(service: &str, username: &str, password: &str) -> Result<(), AuthError> {
    use nonstick::{
        AuthnFlags, ConversationAdapter, Result as PamResult, Transaction, TransactionBuilder,
    };
    use std::ffi::OsStr;

    // Conversation handler that provides username and password
    struct AuthConversation {
        username: String,
        password: String,
    }

    impl ConversationAdapter for AuthConversation {
        fn prompt(&self, _request: impl AsRef<OsStr>) -> PamResult<OsString> {
            Ok(OsString::from(&self.username))
        }

        fn masked_prompt(&self, _request: impl AsRef<OsStr>) -> PamResult<OsString> {
            Ok(OsString::from(&self.password))
        }

        fn error_msg(&self, message: impl AsRef<OsStr>) {
            tracing::warn!(
                message = ?message.as_ref(),
                "PAM error message"
            );
        }

        fn info_msg(&self, message: impl AsRef<OsStr>) {
            tracing::debug!(
                message = ?message.as_ref(),
                "PAM info message"
            );
        }
    }

    let conversation = AuthConversation {
        username: username.to_string(),
        password: password.to_string(),
    };

    // Build PAM transaction
    let mut txn = TransactionBuilder::new_with_service(service)
        .username(username)
        .build(conversation.into_conversation())
        .map_err(|e| {
            tracing::debug!(
                error = ?e,
                service = service,
                username = username,
                "PAM context creation failed"
            );
            AuthError::PamError
        })?;

    // Authenticate the user
    txn.authenticate(AuthnFlags::empty()).map_err(|e| {
        tracing::debug!(
            error = ?e,
            service = service,
            username = username,
            "PAM authentication failed"
        );
        AuthError::PamError
    })?;

    // Check account validity (expired, locked, etc.)
    txn.account_management(AuthnFlags::empty()).map_err(|e| {
        tracing::debug!(
            error = ?e,
            service = service,
            username = username,
            "PAM account management check failed"
        );
        AuthError::PamError
    })?;

    tracing::info!(
        service = service,
        username = username,
        "PAM authentication successful"
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore] // Requires PAM setup
    async fn test_authenticate_invalid_credentials() {
        let result = authenticate("opencode", "nonexistent", "wrongpass").await;
        assert!(result.is_err());
    }

    #[test]
    fn test_auth_error_messages_generic() {
        // Verify error messages don't leak information
        let pam_err = AuthError::PamError;
        assert_eq!(pam_err.to_string(), "authentication failed");

        let internal_err = AuthError::Internal;
        assert_eq!(internal_err.to_string(), "internal authentication error");
    }
}
