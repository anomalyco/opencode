//! Request handler for the authentication broker.
//!
//! Orchestrates the authentication flow: validation -> rate limiting -> PAM.

use crate::auth::rate_limit::RateLimiter;
use crate::config::BrokerConfig;
use crate::ipc::protocol::{Method, Request, RequestParams, Response, PROTOCOL_VERSION};

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
pub async fn handle_request(
    request: Request,
    _config: &BrokerConfig,
    _rate_limiter: &RateLimiter,
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
        Method::Ping => Response::success(&request.id),

        Method::Authenticate => {
            // Placeholder - Task 2 will implement the full flow
            match &request.params {
                RequestParams::Authenticate(_params) => {
                    Response::auth_failure(&request.id)
                }
                _ => Response::failure(&request.id, "invalid params for authenticate"),
            }
        }
    }
}
