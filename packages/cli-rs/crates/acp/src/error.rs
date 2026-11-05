//! ACP errors and their JSON-RPC form (`packages/cli/src/acp/error.ts`).

use serde_json::{Map, Value, json};

/// A JSON-RPC error object, as the ACP SDK's `RequestError` writes it.
#[derive(Debug, Clone, PartialEq)]
pub struct RpcError {
    pub code: i64,
    pub message: String,
    pub data: Option<Value>,
}

impl RpcError {
    pub fn new(code: i64, message: impl Into<String>, data: Option<Value>) -> Self {
        Self { code, message: message.into(), data }
    }

    pub fn parse_error() -> Self {
        Self::new(-32700, "Parse error", None)
    }

    pub fn invalid_request(data: Value) -> Self {
        Self::new(-32600, "Invalid request", Some(data))
    }

    pub fn method_not_found(method: &str) -> Self {
        Self::new(-32601, format!("\"Method not found\": {method}"), Some(json!({ "method": method })))
    }

    pub fn invalid_params(data: Value, detail: &str) -> Self {
        Self::new(-32602, with_detail("Invalid params", detail), Some(data))
    }

    pub fn internal_error(data: Value, detail: &str) -> Self {
        Self::new(-32603, with_detail("Internal error", detail), Some(data))
    }

    pub fn auth_required(data: Value, detail: &str) -> Self {
        Self::new(-32000, with_detail("Authentication required", detail), Some(data))
    }

    /// The `error` member of a response. `data` is left out when unset, as `JSON.stringify` drops
    /// `undefined`.
    pub fn to_json(&self) -> Value {
        let mut object = Map::new();
        object.insert("code".to_owned(), json!(self.code));
        object.insert("message".to_owned(), json!(self.message));
        if let Some(data) = &self.data {
            object.insert("data".to_owned(), data.clone());
        }
        Value::Object(object)
    }
}

fn with_detail(base: &str, detail: &str) -> String {
    if detail.is_empty() {
        return base.to_owned();
    }
    format!("{base}: {detail}")
}

/// Why the catalog could not be read (`CatalogNotReadyError.reason`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NotReady {
    Models,
    Agents,
}

/// Every failure a handler can end with: the tagged errors of `error.ts`, a JSON-RPC error from the
/// client, the catalog errors, and defects.
#[derive(Debug, Clone)]
pub enum Failure {
    SessionNotFound {
        session_id: String,
    },
    SessionDirectoryMismatch {
        session_id: String,
        cwd: String,
    },
    InvalidConfigOption {
        config_id: String,
    },
    InvalidModel {
        model_id: String,
        provider_id: Option<String>,
    },
    InvalidEffort {
        effort: String,
    },
    InvalidMode {
        mode: String,
    },
    InvalidAdditionalDirectory {
        directory: String,
    },
    AuthRequired,
    UnknownAuthMethod {
        method_id: String,
    },
    InvalidRequest {
        message: String,
        field: Option<String>,
    },
    ServiceFailure {
        safe_message: String,
        service: Option<String>,
        error_name: Option<String>,
    },
    ServerUnavailable,
    CatalogNotReady(NotReady),
    /// A catalog read failed; the handler classifies the cause.
    CatalogLoad(std::sync::Arc<opencode_api::error::Error>),
    /// A JSON-RPC error the client answered with.
    Rpc(RpcError),
    /// An unexpected failure (TS: a defect). Only its error name reaches the client.
    Defect {
        name: Option<String>,
        detail: String,
    },
}

impl Failure {
    pub fn invalid_request(message: impl Into<String>, field: Option<&str>) -> Self {
        Self::InvalidRequest { message: message.into(), field: field.map(str::to_owned) }
    }

    pub fn tag(&self) -> &'static str {
        match self {
            Self::SessionNotFound { .. } => "ACPSessionNotFoundError",
            Self::SessionDirectoryMismatch { .. } => "ACPSessionDirectoryMismatchError",
            Self::InvalidConfigOption { .. } => "ACPInvalidConfigOptionError",
            Self::InvalidModel { .. } => "ACPInvalidModelError",
            Self::InvalidEffort { .. } => "ACPInvalidEffortError",
            Self::InvalidMode { .. } => "ACPInvalidModeError",
            Self::InvalidAdditionalDirectory { .. } => "ACPInvalidAdditionalDirectoryError",
            Self::AuthRequired => "ACPAuthRequiredError",
            Self::UnknownAuthMethod { .. } => "ACPUnknownAuthMethodError",
            Self::InvalidRequest { .. } => "ACPInvalidRequestError",
            Self::ServiceFailure { .. } => "ACPServiceFailureError",
            Self::ServerUnavailable => "ACPServerUnavailableError",
            Self::CatalogNotReady(_) => "ACPCatalogNotReadyError",
            Self::CatalogLoad(_) => "ACPCatalogLoadError",
            Self::Rpc(_) => "RequestError",
            Self::Defect { .. } => "Defect",
        }
    }

    /// `toRequestError`, plus the handler's mapping of catalog errors and defects (`agent.ts`).
    pub fn to_rpc(&self) -> RpcError {
        match self {
            Self::SessionNotFound { session_id } => RpcError::invalid_params(
                json!({ "sessionId": session_id }),
                &format!("session not found: {session_id}"),
            ),
            Self::SessionDirectoryMismatch { session_id, cwd } => RpcError::invalid_params(
                json!({ "sessionId": session_id, "cwd": cwd }),
                &format!("session {session_id} does not belong to cwd: {cwd}"),
            ),
            Self::InvalidConfigOption { config_id } => RpcError::invalid_params(
                json!({ "configId": config_id }),
                &format!("unknown config option: {config_id}"),
            ),
            Self::InvalidModel { model_id, provider_id } => {
                let mut data = Map::new();
                if let Some(provider_id) = provider_id {
                    data.insert("providerId".to_owned(), json!(provider_id));
                }
                data.insert("modelId".to_owned(), json!(model_id));
                RpcError::invalid_params(Value::Object(data), &format!("model not found: {model_id}"))
            }
            Self::InvalidEffort { effort } => {
                RpcError::invalid_params(json!({ "effort": effort }), &format!("effort not found: {effort}"))
            }
            Self::InvalidMode { mode } => {
                RpcError::invalid_params(json!({ "mode": mode }), &format!("mode not found: {mode}"))
            }
            Self::InvalidAdditionalDirectory { directory } => RpcError::invalid_params(
                json!({ "additionalDirectory": directory }),
                &format!("additional directory must be an absolute path without glob characters: {directory}"),
            ),
            Self::AuthRequired => RpcError::auth_required(json!({}), "provider authentication required"),
            Self::UnknownAuthMethod { method_id } => {
                RpcError::invalid_params(json!({ "methodId": method_id }), &format!("unknown auth method: {method_id}"))
            }
            Self::InvalidRequest { message, field } => RpcError::invalid_params(
                field.as_ref().map_or_else(|| json!({}), |field| json!({ "field": field })),
                message,
            ),
            Self::ServiceFailure { safe_message, service, error_name } => {
                let mut data = Map::new();
                if let Some(service) = service {
                    data.insert("service".to_owned(), json!(service));
                }
                if let Some(error_name) = error_name {
                    data.insert("errorName".to_owned(), json!(error_name));
                }
                RpcError::internal_error(Value::Object(data), safe_message)
            }
            Self::ServerUnavailable => {
                RpcError::internal_error(json!({ "errorName": "ServerUnavailable" }), "OpenCode server is unavailable")
            }
            Self::CatalogNotReady(reason) => Self::ServiceFailure {
                safe_message: not_ready_message(*reason).to_owned(),
                service: None,
                error_name: Some("CatalogNotReady".to_owned()),
            }
            .to_rpc(),
            Self::CatalogLoad(cause) => crate::client::classify(cause).to_rpc(),
            Self::Rpc(error) => error.clone(),
            Self::Defect { name, detail } => {
                log::error!(cause = detail.as_str(); "ACP request failed");
                from_unknown(name.clone()).to_rpc()
            }
        }
    }
}

pub fn not_ready_message(reason: NotReady) -> &'static str {
    match reason {
        NotReady::Models => "No models are available",
        NotReady::Agents => "No primary agents are available",
    }
}

/// `fromUnknown`: a defect reaches the client only as its error name.
pub fn from_unknown(name: Option<String>) -> Failure {
    Failure::ServiceFailure { safe_message: "Internal service failure".to_owned(), service: None, error_name: name }
}

impl From<RpcError> for Failure {
    fn from(error: RpcError) -> Self {
        Self::Rpc(error)
    }
}
