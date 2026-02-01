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
            RequestParams::AuthenticateOtp(params) => s.field("params", params),
            RequestParams::SetupOtp(params) => s.field("params", params),
            RequestParams::RemoveOtp(params) => s.field("params", params),
            RequestParams::Check2fa(params) => s.field("params", params),
            RequestParams::CheckOtpConfig(params) => s.field("params", params),
            RequestParams::Ping(params) => s.field("params", params),
            RequestParams::SpawnPty(params) => s.field("params", params),
            RequestParams::KillPty(params) => s.field("params", params),
            RequestParams::ResizePty(params) => s.field("params", params),
            RequestParams::RegisterSession(params) => s.field("params", params),
            RequestParams::UnregisterSession(params) => s.field("params", params),
            RequestParams::PtyWrite(params) => s.field("params", params),
            RequestParams::PtyRead(params) => s.field("params", params),
        };

        s.finish()
    }
}

/// Method types for IPC requests.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Method {
    Authenticate,
    /// Validate OTP code for two-factor authentication.
    AuthenticateOtp,
    /// Write ~/.google_authenticator for the session user.
    SetupOtp,
    /// Remove ~/.google_authenticator for the session user.
    RemoveOtp,
    /// Check if user has 2FA configured.
    Check2fa,
    /// Check OTP/2FA server configuration (PAM module, service file).
    CheckOtpConfig,
    Ping,
    /// Spawn a new PTY session for a user.
    SpawnPty,
    /// Kill an existing PTY session.
    KillPty,
    /// Resize an existing PTY session.
    ResizePty,
    /// Register a session with user info after successful authentication.
    RegisterSession,
    /// Unregister a session on logout.
    UnregisterSession,
    /// Write data to a PTY's master fd.
    PtyWrite,
    /// Read data from a PTY's master fd.
    PtyRead,
}

/// Parameters for different request types.
///
/// IMPORTANT: Order matters for `#[serde(untagged)]` - serde tries variants in order.
/// Rules:
/// - Variants with MORE required fields come BEFORE variants with fewer
/// - `RegisterSession` (6 required) before `SpawnPty` (1 required + defaults)
/// - `UnregisterSession` (1 required + deny_unknown_fields) before `SpawnPty`
/// - `SetupOtp` must come before `SpawnPty` because it uses session_id
/// - `RemoveOtp` must come before `SpawnPty` because it uses session_id
/// - `Check2fa` (2 required) before `Ping`
/// - `CheckOtpConfig` uses deny_unknown_fields - must come before Ping
/// - `Ping` must be LAST because `PingParams` is empty and matches any JSON
#[derive(Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum RequestParams {
    Authenticate(AuthenticateParams),
    /// AuthenticateOtp has 2 required fields - must come after Authenticate.
    AuthenticateOtp(AuthenticateOtpParams),
    /// SetupOtp has 2 required fields - must come before SpawnPty.
    SetupOtp(SetupOtpParams),
    /// RemoveOtp has 2 required fields - must come before SpawnPty.
    RemoveOtp(RemoveOtpParams),
    /// RegisterSession has 6 required fields - must come before SpawnPty.
    RegisterSession(RegisterSessionParams),
    /// UnregisterSession uses deny_unknown_fields - must come before SpawnPty.
    UnregisterSession(UnregisterSessionParams),
    /// Parameters for spawning a new PTY.
    SpawnPty(SpawnPtyParams),
    /// Parameters for killing an existing PTY.
    KillPty(KillPtyParams),
    /// Parameters for resizing an existing PTY.
    ResizePty(ResizePtyParams),
    /// Parameters for writing to a PTY.
    PtyWrite(PtyWriteParams),
    /// Parameters for reading from a PTY.
    PtyRead(PtyReadParams),
    /// Check2fa has 2 required fields - must come before Ping.
    Check2fa(Check2faParams),
    /// CheckOtpConfig uses deny_unknown_fields - must come before Ping.
    CheckOtpConfig(CheckOtpConfigParams),
    /// Ping must be last - empty params match any JSON with untagged serde.
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

/// Parameters for checking if user has 2FA configured.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Check2faParams {
    /// Username to check.
    pub username: String,
    /// User's home directory for .google_authenticator check.
    pub home: String,
}

/// Parameters for OTP validation.
#[derive(Clone, Serialize, Deserialize)]
pub struct AuthenticateOtpParams {
    /// Username to validate OTP for.
    pub username: String,
    /// The TOTP code entered by user.
    /// Redacted in Debug output like password.
    #[serde(skip_serializing)]
    pub code: String,
}

impl fmt::Debug for AuthenticateOtpParams {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("AuthenticateOtpParams")
            .field("username", &self.username)
            .field("code", &"[REDACTED]")
            .finish()
    }
}

/// Parameters for writing ~/.google_authenticator.
#[derive(Clone, Serialize, Deserialize)]
pub struct SetupOtpParams {
    /// Session ID of the authenticated user (for user lookup).
    pub session_id: String,
    /// Base32 secret to write.
    pub secret: String,
}

impl fmt::Debug for SetupOtpParams {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SetupOtpParams")
            .field("session_id", &self.session_id)
            .field("secret", &"[REDACTED]")
            .finish()
    }
}

/// Parameters for removing ~/.google_authenticator.
#[derive(Clone, Serialize, Deserialize)]
pub struct RemoveOtpParams {
    /// Session ID of the authenticated user (for user lookup).
    pub session_id: String,
    /// Explicit confirmation to remove 2FA.
    pub confirm: bool,
}

impl fmt::Debug for RemoveOtpParams {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("RemoveOtpParams")
            .field("session_id", &self.session_id)
            .field("confirm", &self.confirm)
            .finish()
    }
}

/// Parameters for checking OTP/2FA server configuration.
///
/// Uses `deny_unknown_fields` to prevent matching with untagged serde
/// since it has no required fields.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CheckOtpConfigParams {}

/// Result of OTP configuration check.
///
/// Contains detailed information about the server's 2FA/OTP configuration status.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OtpConfigResult {
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
    /// Possible values: "pam_module_not_installed", "pam_service_not_configured", null
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

/// Result of writing ~/.google_authenticator.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetupOtpResult {
    /// Whether the file was written successfully.
    pub written: bool,
    /// Whether the file already existed.
    pub already_configured: bool,
    /// Optional error code when writing failed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

/// Result of removing ~/.google_authenticator.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoveOtpResult {
    /// Whether the file was removed.
    pub removed: bool,
    /// Whether the file was already missing.
    pub already_missing: bool,
    /// Optional error code when removal failed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
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
///
/// Uses `deny_unknown_fields` to prevent serde untagged matching when
/// extra fields are present (e.g., PtyWrite's `data` field).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
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

/// Parameters for registering a session with user info.
/// Called by web server after successful PAM authentication.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegisterSessionParams {
    /// Session ID (from web server's UserSession).
    pub session_id: String,
    /// UNIX username.
    pub username: String,
    /// UNIX user ID.
    pub uid: u32,
    /// UNIX primary group ID.
    pub gid: u32,
    /// User's home directory.
    pub home: String,
    /// User's login shell.
    pub shell: String,
}

/// Parameters for unregistering a session.
/// Called by web server on logout.
///
/// Uses `deny_unknown_fields` to prevent matching SpawnPty requests
/// (which also has session_id but with additional optional fields).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UnregisterSessionParams {
    /// Session ID to unregister.
    pub session_id: String,
}

/// Parameters for writing to a PTY.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PtyWriteParams {
    /// The PTY session ID to write to.
    pub pty_id: String,
    /// Base64-encoded data to write.
    pub data: String,
}

/// Parameters for reading from a PTY.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PtyReadParams {
    /// The PTY session ID to read from.
    pub pty_id: String,
    /// Maximum bytes to read (0 = all available).
    #[serde(default = "default_max_bytes")]
    pub max_bytes: usize,
}

fn default_max_bytes() -> usize {
    4096
}

/// Result of a successful PTY read.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PtyReadResult {
    /// Base64-encoded data read from PTY.
    pub data: String,
    /// Whether more data is available.
    pub more: bool,
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
    /// Optional data payload for successful responses.
    /// Used to return structured data like SpawnPtyResult.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
}

impl Response {
    /// Create a successful response.
    pub fn success(id: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            success: true,
            error: None,
            data: None,
        }
    }

    /// Create a successful response with data payload.
    pub fn success_with_data(id: impl Into<String>, data: serde_json::Value) -> Self {
        Self {
            id: id.into(),
            success: true,
            error: None,
            data: Some(data),
        }
    }

    /// Create a failed response with a generic error message.
    /// Note: Never include specific error details for authentication failures.
    pub fn failure(id: impl Into<String>, error: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            success: false,
            error: Some(error.into()),
            data: None,
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
            env: std::collections::HashMap::from([("CUSTOM_VAR".to_string(), "value".to_string())]),
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
        let json =
            r#"{"session_id":"sess-789","term":"vt100","cols":132,"rows":50,"env":{"FOO":"bar"}}"#;
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
        assert_eq!(
            serde_json::to_string(&Method::RemoveOtp).expect("serialize"),
            "\"removeotp\""
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

        let remove: Method = serde_json::from_str("\"removeotp\"").expect("deserialize");
        assert_eq!(remove, Method::RemoveOtp);
    }

    #[test]
    fn test_register_session_params_roundtrip() {
        let params = RegisterSessionParams {
            session_id: "sess-abc".to_string(),
            username: "testuser".to_string(),
            uid: 1000,
            gid: 1000,
            home: "/home/testuser".to_string(),
            shell: "/bin/bash".to_string(),
        };

        let json = serde_json::to_string(&params).expect("serialize");
        let parsed: RegisterSessionParams = serde_json::from_str(&json).expect("deserialize");

        assert_eq!(parsed.session_id, "sess-abc");
        assert_eq!(parsed.username, "testuser");
        assert_eq!(parsed.uid, 1000);
        assert_eq!(parsed.gid, 1000);
        assert_eq!(parsed.home, "/home/testuser");
        assert_eq!(parsed.shell, "/bin/bash");
    }

    #[test]
    fn test_unregister_session_params_roundtrip() {
        let params = UnregisterSessionParams {
            session_id: "sess-def".to_string(),
        };

        let json = serde_json::to_string(&params).expect("serialize");
        let parsed: UnregisterSessionParams = serde_json::from_str(&json).expect("deserialize");

        assert_eq!(parsed.session_id, "sess-def");
    }

    #[test]
    fn test_session_method_serialization() {
        assert_eq!(
            serde_json::to_string(&Method::RegisterSession).expect("serialize"),
            "\"registersession\""
        );
        assert_eq!(
            serde_json::to_string(&Method::UnregisterSession).expect("serialize"),
            "\"unregistersession\""
        );
    }

    #[test]
    fn test_session_method_deserialization() {
        let register: Method = serde_json::from_str("\"registersession\"").expect("deserialize");
        assert_eq!(register, Method::RegisterSession);

        let unregister: Method =
            serde_json::from_str("\"unregistersession\"").expect("deserialize");
        assert_eq!(unregister, Method::UnregisterSession);
    }

    #[test]
    fn test_pty_write_params_roundtrip() {
        let params = PtyWriteParams {
            pty_id: "pty-123".to_string(),
            data: "SGVsbG8gV29ybGQ=".to_string(), // "Hello World" in base64
        };

        let json = serde_json::to_string(&params).expect("serialize");
        let parsed: PtyWriteParams = serde_json::from_str(&json).expect("deserialize");

        assert_eq!(parsed.pty_id, "pty-123");
        assert_eq!(parsed.data, "SGVsbG8gV29ybGQ=");
    }

    #[test]
    fn test_pty_read_params_with_defaults() {
        let json = r#"{"pty_id":"pty-456"}"#;
        let params: PtyReadParams = serde_json::from_str(json).expect("deserialize");

        assert_eq!(params.pty_id, "pty-456");
        assert_eq!(params.max_bytes, 4096); // default
    }

    #[test]
    fn test_pty_read_params_custom_max_bytes() {
        let json = r#"{"pty_id":"pty-789","max_bytes":8192}"#;
        let params: PtyReadParams = serde_json::from_str(json).expect("deserialize");

        assert_eq!(params.pty_id, "pty-789");
        assert_eq!(params.max_bytes, 8192);
    }

    #[test]
    fn test_pty_read_result_roundtrip() {
        let result = PtyReadResult {
            data: "SGVsbG8=".to_string(),
            more: true,
        };

        let json = serde_json::to_string(&result).expect("serialize");
        let parsed: PtyReadResult = serde_json::from_str(&json).expect("deserialize");

        assert_eq!(parsed.data, "SGVsbG8=");
        assert!(parsed.more);
    }

    #[test]
    fn test_pty_io_method_serialization() {
        assert_eq!(
            serde_json::to_string(&Method::PtyWrite).expect("serialize"),
            "\"ptywrite\""
        );
        assert_eq!(
            serde_json::to_string(&Method::PtyRead).expect("serialize"),
            "\"ptyread\""
        );
    }

    #[test]
    fn test_pty_io_method_deserialization() {
        let write: Method = serde_json::from_str("\"ptywrite\"").expect("deserialize");
        assert_eq!(write, Method::PtyWrite);

        let read: Method = serde_json::from_str("\"ptyread\"").expect("deserialize");
        assert_eq!(read, Method::PtyRead);
    }

    #[test]
    fn test_check2fa_params_roundtrip() {
        let params = Check2faParams {
            username: "testuser".to_string(),
            home: "/home/testuser".to_string(),
        };

        let json = serde_json::to_string(&params).expect("serialize");
        let parsed: Check2faParams = serde_json::from_str(&json).expect("deserialize");

        assert_eq!(parsed.username, "testuser");
        assert_eq!(parsed.home, "/home/testuser");
    }

    #[test]
    fn test_authenticate_otp_params_code_not_serialized() {
        let params = AuthenticateOtpParams {
            username: "testuser".to_string(),
            code: "123456".to_string(),
        };

        // Serialize should NOT include code
        let json = serde_json::to_string(&params).expect("serialize");
        assert!(json.contains("testuser"));
        assert!(!json.contains("123456"), "code should not be serialized");
    }

    #[test]
    fn test_authenticate_otp_params_deserialization() {
        let json = r#"{"username":"testuser","code":"654321"}"#;
        let params: AuthenticateOtpParams = serde_json::from_str(json).expect("deserialize");

        assert_eq!(params.username, "testuser");
        assert_eq!(params.code, "654321");
    }

    #[test]
    fn test_authenticate_otp_code_redaction_in_debug() {
        let params = AuthenticateOtpParams {
            username: "testuser".to_string(),
            code: "123456".to_string(),
        };

        let debug_output = format!("{:?}", params);
        assert!(debug_output.contains("[REDACTED]"));
        assert!(!debug_output.contains("123456"));
    }

    #[test]
    fn test_2fa_method_serialization() {
        assert_eq!(
            serde_json::to_string(&Method::Check2fa).expect("serialize"),
            "\"check2fa\""
        );
        assert_eq!(
            serde_json::to_string(&Method::AuthenticateOtp).expect("serialize"),
            "\"authenticateotp\""
        );
        assert_eq!(
            serde_json::to_string(&Method::SetupOtp).expect("serialize"),
            "\"setupotp\""
        );
        assert_eq!(
            serde_json::to_string(&Method::RemoveOtp).expect("serialize"),
            "\"removeotp\""
        );
    }

    #[test]
    fn test_2fa_method_deserialization() {
        let check: Method = serde_json::from_str("\"check2fa\"").expect("deserialize");
        assert_eq!(check, Method::Check2fa);

        let otp: Method = serde_json::from_str("\"authenticateotp\"").expect("deserialize");
        assert_eq!(otp, Method::AuthenticateOtp);

        let setup: Method = serde_json::from_str("\"setupotp\"").expect("deserialize");
        assert_eq!(setup, Method::SetupOtp);

        let remove: Method = serde_json::from_str("\"removeotp\"").expect("deserialize");
        assert_eq!(remove, Method::RemoveOtp);
    }
}
