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
        let mut s = f.debug_struct("Request");
        s.field("id", &self.id)
            .field("version", &self.version)
            .field("method", &self.method);

        match &self.params {
            RequestParams::Authenticate(params) => s.field("params", params),
            RequestParams::Ping(params) => s.field("params", params),
            RequestParams::SpawnPty(params) => s.field("params", params),
            RequestParams::KillPty(params) => s.field("params", params),
            RequestParams::ResizePty(params) => s.field("params", params),
        };

        s.finish()
    }
}

/// Method types for IPC requests.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Method {
    Authenticate,
    Ping,
    /// Spawn a new PTY session for a user.
    SpawnPty,
    /// Kill an existing PTY session.
    KillPty,
    /// Resize an existing PTY session.
    ResizePty,
}

/// Parameters for different request types.
#[derive(Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum RequestParams {
    Authenticate(AuthenticateParams),
    Ping(PingParams),
    /// Parameters for spawning a new PTY.
    SpawnPty(SpawnPtyParams),
    /// Parameters for killing an existing PTY.
    KillPty(KillPtyParams),
    /// Parameters for resizing an existing PTY.
    ResizePty(ResizePtyParams),
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

/// Parameters for spawning a new PTY session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpawnPtyParams {
    /// Session ID of the authenticated user (for user lookup).
    pub session_id: String,
    /// Terminal type (e.g., "xterm-256color").
    #[serde(default = "default_term")]
    pub term: String,
    /// Initial number of columns.
    #[serde(default = "default_cols")]
    pub cols: u16,
    /// Initial number of rows.
    #[serde(default = "default_rows")]
    pub rows: u16,
    /// Additional environment variables for the PTY process.
    #[serde(default)]
    pub env: std::collections::HashMap<String, String>,
}

fn default_term() -> String {
    "xterm-256color".to_string()
}

fn default_cols() -> u16 {
    80
}

fn default_rows() -> u16 {
    24
}

/// Parameters for killing a PTY session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KillPtyParams {
    /// The PTY session ID to kill.
    pub pty_id: String,
}

/// Parameters for resizing a PTY session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResizePtyParams {
    /// The PTY session ID to resize.
    pub pty_id: String,
    /// New number of columns.
    pub cols: u16,
    /// New number of rows.
    pub rows: u16,
}

/// Result of a successful PTY spawn.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpawnPtyResult {
    /// Unique ID for this PTY session.
    pub pty_id: String,
    /// Process ID of the spawned shell.
    pub pid: u32,
}

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

    #[test]
    fn test_spawn_pty_params_serialization() {
        let params = SpawnPtyParams {
            session_id: "sess-123".to_string(),
            term: "xterm-256color".to_string(),
            cols: 120,
            rows: 40,
            env: std::collections::HashMap::from([
                ("CUSTOM_VAR".to_string(), "value".to_string()),
            ]),
        };

        let json = serde_json::to_string(&params).expect("serialize");
        assert!(json.contains("sess-123"));
        assert!(json.contains("xterm-256color"));
        assert!(json.contains("120"));
        assert!(json.contains("40"));
        assert!(json.contains("CUSTOM_VAR"));
    }

    #[test]
    fn test_spawn_pty_params_deserialization_with_defaults() {
        // Test with minimal fields - defaults should be applied
        let json = r#"{"session_id":"sess-456"}"#;
        let params: SpawnPtyParams = serde_json::from_str(json).expect("deserialize");

        assert_eq!(params.session_id, "sess-456");
        assert_eq!(params.term, "xterm-256color"); // default
        assert_eq!(params.cols, 80); // default
        assert_eq!(params.rows, 24); // default
        assert!(params.env.is_empty()); // default
    }

    #[test]
    fn test_spawn_pty_params_deserialization_full() {
        let json = r#"{"session_id":"sess-789","term":"vt100","cols":132,"rows":50,"env":{"FOO":"bar"}}"#;
        let params: SpawnPtyParams = serde_json::from_str(json).expect("deserialize");

        assert_eq!(params.session_id, "sess-789");
        assert_eq!(params.term, "vt100");
        assert_eq!(params.cols, 132);
        assert_eq!(params.rows, 50);
        assert_eq!(params.env.get("FOO"), Some(&"bar".to_string()));
    }

    #[test]
    fn test_kill_pty_params_roundtrip() {
        let params = KillPtyParams {
            pty_id: "pty-abc".to_string(),
        };

        let json = serde_json::to_string(&params).expect("serialize");
        let parsed: KillPtyParams = serde_json::from_str(&json).expect("deserialize");

        assert_eq!(parsed.pty_id, "pty-abc");
    }

    #[test]
    fn test_resize_pty_params_roundtrip() {
        let params = ResizePtyParams {
            pty_id: "pty-def".to_string(),
            cols: 200,
            rows: 60,
        };

        let json = serde_json::to_string(&params).expect("serialize");
        let parsed: ResizePtyParams = serde_json::from_str(&json).expect("deserialize");

        assert_eq!(parsed.pty_id, "pty-def");
        assert_eq!(parsed.cols, 200);
        assert_eq!(parsed.rows, 60);
    }

    #[test]
    fn test_spawn_pty_result_roundtrip() {
        let result = SpawnPtyResult {
            pty_id: "pty-123".to_string(),
            pid: 12345,
        };

        let json = serde_json::to_string(&result).expect("serialize");
        let parsed: SpawnPtyResult = serde_json::from_str(&json).expect("deserialize");

        assert_eq!(parsed.pty_id, "pty-123");
        assert_eq!(parsed.pid, 12345);
    }

    #[test]
    fn test_method_serialization() {
        // Test new methods serialize correctly
        assert_eq!(
            serde_json::to_string(&Method::SpawnPty).expect("serialize"),
            "\"spawnpty\""
        );
        assert_eq!(
            serde_json::to_string(&Method::KillPty).expect("serialize"),
            "\"killpty\""
        );
        assert_eq!(
            serde_json::to_string(&Method::ResizePty).expect("serialize"),
            "\"resizepty\""
        );
    }

    #[test]
    fn test_method_deserialization() {
        // Test new methods deserialize correctly
        let spawn: Method = serde_json::from_str("\"spawnpty\"").expect("deserialize");
        assert_eq!(spawn, Method::SpawnPty);

        let kill: Method = serde_json::from_str("\"killpty\"").expect("deserialize");
        assert_eq!(kill, Method::KillPty);

        let resize: Method = serde_json::from_str("\"resizepty\"").expect("deserialize");
        assert_eq!(resize, Method::ResizePty);
    }
}
