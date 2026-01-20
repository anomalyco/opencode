use serde::{Deserialize, Serialize};
use std::fmt;

/// Protocol version for the IPC protocol.
pub const PROTOCOL_VERSION: u32 = 1;

/// Request message sent from opencode to the broker.
#[derive(Clone, Serialize, Deserialize)]
pub struct Request {
    /// Unique request ID for multiplexing responses.
    pub id: String,
    /// Protocol version (always 1 for now).
    pub version: u32,
    /// Method to invoke.
    pub method: Method,
    /// Method-specific parameters.
    #[serde(flatten)]
    pub params: RequestParams,
}

impl fmt::Debug for Request {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.params {
            RequestParams::Authenticate(params) => f
                .debug_struct("Request")
                .field("id", &self.id)
                .field("version", &self.version)
                .field("method", &self.method)
                .field("params", params)
                .finish(),
            RequestParams::Ping(params) => f
                .debug_struct("Request")
                .field("id", &self.id)
                .field("version", &self.version)
                .field("method", &self.method)
                .field("params", params)
                .finish(),
        }
    }
}

/// Method types for IPC requests.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Method {
    Authenticate,
    Ping,
}

/// Parameters for different request types.
#[derive(Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum RequestParams {
    Authenticate(AuthenticateParams),
    Ping(PingParams),
}

/// Parameters for authentication requests.
#[derive(Clone, Serialize, Deserialize)]
pub struct AuthenticateParams {
    /// Username to authenticate.
    pub username: String,
    /// Password for authentication.
    /// Note: This field is intentionally NOT serialized when writing to prevent
    /// accidental logging. It can be deserialized (read) but never serialized.
    #[serde(skip_serializing)]
    pub password: String,
}

impl fmt::Debug for AuthenticateParams {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("AuthenticateParams")
            .field("username", &self.username)
            .field("password", &"[REDACTED]")
            .finish()
    }
}

/// Parameters for ping/health check requests.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PingParams {}

/// Response message sent from the broker to opencode.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Response {
    /// Request ID this response corresponds to.
    pub id: String,
    /// Whether the operation succeeded.
    pub success: bool,
    /// Error message if operation failed.
    /// Note: For authentication, this is always a generic message
    /// to prevent user enumeration attacks.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl Response {
    /// Create a successful response.
    pub fn success(id: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            success: true,
            error: None,
        }
    }

    /// Create a failed response with a generic error message.
    /// Note: Never include specific error details for authentication failures.
    pub fn failure(id: impl Into<String>, error: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            success: false,
            error: Some(error.into()),
        }
    }

    /// Create an authentication failure response.
    /// Uses a generic message to prevent user enumeration.
    pub fn auth_failure(id: impl Into<String>) -> Self {
        Self::failure(id, "authentication failed")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_authenticate_request_serialization() {
        let request = Request {
            id: "req-1".to_string(),
            version: 1,
            method: Method::Authenticate,
            params: RequestParams::Authenticate(AuthenticateParams {
                username: "testuser".to_string(),
                password: "secret123".to_string(),
            }),
        };

        // Serialize should NOT include password
        let json = serde_json::to_string(&request).expect("serialize");
        assert!(json.contains("testuser"));
        assert!(!json.contains("secret123"), "password should be redacted");
    }

    #[test]
    fn test_authenticate_request_deserialization() {
        let json = r#"{"id":"req-1","version":1,"method":"authenticate","username":"testuser","password":"secret123"}"#;
        let request: Request = serde_json::from_str(json).expect("deserialize");

        assert_eq!(request.id, "req-1");
        assert_eq!(request.version, 1);
        assert_eq!(request.method, Method::Authenticate);

        if let RequestParams::Authenticate(params) = request.params {
            assert_eq!(params.username, "testuser");
            assert_eq!(params.password, "secret123");
        } else {
            panic!("expected Authenticate params");
        }
    }

    #[test]
    fn test_ping_request_roundtrip() {
        let request = Request {
            id: "req-2".to_string(),
            version: 1,
            method: Method::Ping,
            params: RequestParams::Ping(PingParams {}),
        };

        let json = serde_json::to_string(&request).expect("serialize");
        let parsed: Request = serde_json::from_str(&json).expect("deserialize");

        assert_eq!(parsed.id, "req-2");
        assert_eq!(parsed.method, Method::Ping);
    }

    #[test]
    fn test_response_serialization() {
        let response = Response::success("req-1");
        let json = serde_json::to_string(&response).expect("serialize");
        assert!(json.contains("\"success\":true"));
        assert!(!json.contains("error")); // should skip None

        let response = Response::auth_failure("req-2");
        let json = serde_json::to_string(&response).expect("serialize");
        assert!(json.contains("\"success\":false"));
        assert!(json.contains("authentication failed"));
    }

    #[test]
    fn test_response_deserialization() {
        let json = r#"{"id":"req-1","success":true}"#;
        let response: Response = serde_json::from_str(json).expect("deserialize");
        assert!(response.success);
        assert!(response.error.is_none());

        let json = r#"{"id":"req-2","success":false,"error":"authentication failed"}"#;
        let response: Response = serde_json::from_str(json).expect("deserialize");
        assert!(!response.success);
        assert_eq!(response.error, Some("authentication failed".to_string()));
    }

    #[test]
    fn test_password_redaction_in_debug() {
        let params = AuthenticateParams {
            username: "testuser".to_string(),
            password: "supersecret".to_string(),
        };

        let debug_output = format!("{:?}", params);
        assert!(debug_output.contains("[REDACTED]"));
        assert!(!debug_output.contains("supersecret"));
    }
}
