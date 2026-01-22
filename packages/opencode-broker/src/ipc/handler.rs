//! Request handler for the authentication broker.
//!
//! Orchestrates the authentication flow: validation -> rate limiting -> PAM.
//! This module is the core of the broker, connecting all auth components.

use crate::auth::pam;
use crate::auth::rate_limit::RateLimiter;
use crate::auth::validation;
use crate::config::BrokerConfig;
use crate::ipc::protocol::{Method, PROTOCOL_VERSION, Request, RequestParams, Response};
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

        Method::Authenticate => handle_authenticate(request, config, rate_limiter).await,

        Method::SpawnPty => handle_spawn_pty(request).await,

        Method::KillPty => handle_kill_pty(request).await,

        Method::ResizePty => handle_resize_pty(request).await,
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

/// Handle a PTY spawn request (stub - returns not implemented).
///
/// In the full implementation, this will:
/// 1. Look up the user's session by session_id
/// 2. Allocate a PTY pair
/// 3. Spawn the user's shell with proper user/group IDs
/// 4. Return the PTY ID and PID
async fn handle_spawn_pty(request: Request) -> Response {
    // Extract and log params for debugging
    let params = match &request.params {
        RequestParams::SpawnPty(params) => params,
        _ => {
            return Response::failure(&request.id, "invalid params for spawn_pty");
        }
    };

    info!(
        id = %request.id,
        session_id = %params.session_id,
        term = %params.term,
        cols = params.cols,
        rows = params.rows,
        "spawn_pty request (not implemented)"
    );

    Response::failure(&request.id, "spawn_pty not implemented")
}

/// Handle a PTY kill request (stub - returns not implemented).
///
/// In the full implementation, this will:
/// 1. Look up the PTY session by pty_id
/// 2. Send SIGTERM/SIGKILL to the child process
/// 3. Clean up PTY resources
async fn handle_kill_pty(request: Request) -> Response {
    // Extract and log params for debugging
    let params = match &request.params {
        RequestParams::KillPty(params) => params,
        _ => {
            return Response::failure(&request.id, "invalid params for kill_pty");
        }
    };

    info!(
        id = %request.id,
        pty_id = %params.pty_id,
        "kill_pty request (not implemented)"
    );

    Response::failure(&request.id, "kill_pty not implemented")
}

/// Handle a PTY resize request (stub - returns not implemented).
///
/// In the full implementation, this will:
/// 1. Look up the PTY session by pty_id
/// 2. Call TIOCSWINSZ ioctl with new dimensions
async fn handle_resize_pty(request: Request) -> Response {
    // Extract and log params for debugging
    let params = match &request.params {
        RequestParams::ResizePty(params) => params,
        _ => {
            return Response::failure(&request.id, "invalid params for resize_pty");
        }
    };

    info!(
        id = %request.id,
        pty_id = %params.pty_id,
        cols = params.cols,
        rows = params.rows,
        "resize_pty request (not implemented)"
    );

    Response::failure(&request.id, "resize_pty not implemented")
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
        assert!(
            response
                .error
                .unwrap()
                .contains("unsupported protocol version")
        );
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
        assert!(
            response2
                .error
                .unwrap()
                .contains("too many authentication attempts")
        );
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
