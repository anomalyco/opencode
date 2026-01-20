//! Request handler for the authentication broker.
//!
//! Orchestrates the authentication flow: validation -> rate limiting -> PAM.
//! This module is the core of the broker, connecting all auth components.

use crate::auth::pam;
use crate::auth::rate_limit::RateLimiter;
use crate::auth::validation;
use crate::config::BrokerConfig;
use crate::ipc::protocol::{Method, Request, RequestParams, Response, PROTOCOL_VERSION};
use tracing::{debug, info, warn};

/// Handle a single IPC request.
///
/// This function dispatches to the appropriate handler based on the request
/// method, orchestrating validation, rate limiting, and PAM authentication.
///
/// # Arguments
///
/// * `request` - The parsed IPC request.
/// * `config` - Server configuration.
/// * `rate_limiter` - Per-username rate limiter.
///
/// # Returns
///
/// A response to send back to the client.
///
/// # Security Notes
///
/// - NEVER log passwords (handled by protocol types)
/// - NEVER return detailed errors (prevents user enumeration)
/// - Check rate limit BEFORE PAM (fail fast on brute force)
pub async fn handle_request(
    request: Request,
    config: &BrokerConfig,
    rate_limiter: &RateLimiter,
) -> Response {
    // Version check
    if request.version != PROTOCOL_VERSION {
        return Response::failure(
            &request.id,
            format!(
                "unsupported protocol version: {}, expected {}",
                request.version, PROTOCOL_VERSION
            ),
        );
    }

    match request.method {
        Method::Ping => {
            debug!(id = %request.id, "ping request");
            Response::success(&request.id)
        }

        Method::Authenticate => {
            handle_authenticate(request, config, rate_limiter).await
        }
    }
}

/// Handle an authentication request.
///
/// Flow: Validate username -> Check rate limit -> Call PAM -> Return result
async fn handle_authenticate(
    request: Request,
    config: &BrokerConfig,
    rate_limiter: &RateLimiter,
) -> Response {
    // Extract params
    let (username, password) = match &request.params {
        RequestParams::Authenticate(params) => (&params.username, &params.password),
        _ => {
            return Response::failure(&request.id, "invalid params for authenticate");
        }
    };

    // Log attempt (never log password - the Request Debug impl handles this)
    info!(
        id = %request.id,
        username = %username,
        "authentication attempt"
    );

    // 1. Validate username
    // Note: We return a generic error to prevent user enumeration
    if let Err(e) = validation::validate_username(username) {
        debug!(
            id = %request.id,
            username = %username,
            error = %e,
            "username validation failed"
        );
        return Response::auth_failure(&request.id);
    }

    // 2. Check rate limit BEFORE PAM (fail fast on brute force)
    if let Err(e) = rate_limiter.check(username) {
        warn!(
            id = %request.id,
            username = %username,
            "rate limit exceeded"
        );
        // Return a specific message for rate limiting so clients know to back off
        return Response::failure(&request.id, e.to_string());
    }

    // 3. Call PAM for actual authentication
    match pam::authenticate(&config.pam_service, username, password).await {
        Ok(()) => {
            info!(
                id = %request.id,
                username = %username,
                "authentication successful"
            );
            Response::success(&request.id)
        }
        Err(e) => {
            debug!(
                id = %request.id,
                username = %username,
                error = %e,
                "authentication failed"
            );
            // Generic error to prevent user enumeration
            Response::auth_failure(&request.id)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ipc::protocol::{AuthenticateParams, PingParams};

    fn test_config() -> BrokerConfig {
        BrokerConfig {
            pam_service: "opencode".to_string(),
            socket_path: "/tmp/test.sock".to_string(),
            rate_limit_per_minute: 5,
            rate_limit_lockout_minutes: 15,
        }
    }

    #[tokio::test]
    async fn test_ping_returns_success() {
        let config = test_config();
        let rate_limiter = RateLimiter::new(5);

        let request = Request {
            id: "ping-1".to_string(),
            version: PROTOCOL_VERSION,
            method: Method::Ping,
            params: RequestParams::Ping(PingParams {}),
        };

        let response = handle_request(request, &config, &rate_limiter).await;

        assert!(response.success);
        assert_eq!(response.id, "ping-1");
        assert!(response.error.is_none());
    }

    #[tokio::test]
    async fn test_unknown_version_returns_error() {
        let config = test_config();
        let rate_limiter = RateLimiter::new(5);

        let request = Request {
            id: "ver-1".to_string(),
            version: 999, // Invalid version
            method: Method::Ping,
            params: RequestParams::Ping(PingParams {}),
        };

        let response = handle_request(request, &config, &rate_limiter).await;

        assert!(!response.success);
        assert!(response.error.unwrap().contains("unsupported protocol version"));
    }

    #[tokio::test]
    async fn test_rate_limit_rejection() {
        let config = test_config();
        let rate_limiter = RateLimiter::new(1); // Only 1 attempt allowed

        // First attempt should be allowed (but will fail PAM)
        let request1 = Request {
            id: "auth-1".to_string(),
            version: PROTOCOL_VERSION,
            method: Method::Authenticate,
            params: RequestParams::Authenticate(AuthenticateParams {
                username: "testuser".to_string(),
                password: "wrong".to_string(),
            }),
        };

        let response1 = handle_request(request1, &config, &rate_limiter).await;
        // Will fail PAM but rate limit check passes
        assert_eq!(response1.id, "auth-1");

        // Second attempt should be rate limited
        let request2 = Request {
            id: "auth-2".to_string(),
            version: PROTOCOL_VERSION,
            method: Method::Authenticate,
            params: RequestParams::Authenticate(AuthenticateParams {
                username: "testuser".to_string(),
                password: "wrong".to_string(),
            }),
        };

        let response2 = handle_request(request2, &config, &rate_limiter).await;

        assert!(!response2.success);
        assert!(response2.error.unwrap().contains("too many authentication attempts"));
    }

    #[tokio::test]
    async fn test_invalid_username_returns_generic_error() {
        let config = test_config();
        let rate_limiter = RateLimiter::new(5);

        // Invalid username (uppercase)
        let request = Request {
            id: "auth-1".to_string(),
            version: PROTOCOL_VERSION,
            method: Method::Authenticate,
            params: RequestParams::Authenticate(AuthenticateParams {
                username: "InvalidUser".to_string(),
                password: "password".to_string(),
            }),
        };

        let response = handle_request(request, &config, &rate_limiter).await;

        assert!(!response.success);
        // Should return generic "authentication failed" not validation details
        assert_eq!(response.error, Some("authentication failed".to_string()));
    }

    #[tokio::test]
    async fn test_empty_username_returns_generic_error() {
        let config = test_config();
        let rate_limiter = RateLimiter::new(5);

        let request = Request {
            id: "auth-1".to_string(),
            version: PROTOCOL_VERSION,
            method: Method::Authenticate,
            params: RequestParams::Authenticate(AuthenticateParams {
                username: "".to_string(),
                password: "password".to_string(),
            }),
        };

        let response = handle_request(request, &config, &rate_limiter).await;

        assert!(!response.success);
        assert_eq!(response.error, Some("authentication failed".to_string()));
    }
}
