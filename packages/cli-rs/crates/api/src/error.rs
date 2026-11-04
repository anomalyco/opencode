//! Client errors, mirroring the reasons of the TypeScript `ClientError`
//! (`packages/client/src/promise/generated/client-error.ts`), plus declared error bodies.

use serde::de::DeserializeOwned;
use serde_json::Value;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// The request could not be sent or the response could not be read.
    #[error("Transport: {0}")]
    Transport(String),
    /// A status that is neither the success status nor a declared error status.
    #[error("UnexpectedStatus: {status}")]
    UnexpectedStatus { status: u16 },
    /// The response has the wrong content type.
    #[error("UnsupportedContentType: {}", .0.as_deref().unwrap_or("none"))]
    UnsupportedContentType(Option<String>),
    /// The response body is empty or not valid for its type.
    #[error("MalformedResponse: {0}")]
    MalformedResponse(String),
    /// One server-sent event exceeds the size limit.
    #[error("SseEventTooLarge")]
    SseEventTooLarge,
    /// A declared error the server returned, such as `SessionNotFoundError`.
    #[error("{0}")]
    Declared(Box<DeclaredError>),
}

impl Error {
    /// The `ClientError` reason, or the declared error's tag.
    pub fn reason(&self) -> &str {
        match self {
            Self::Transport(_) => "Transport",
            Self::UnexpectedStatus { .. } => "UnexpectedStatus",
            Self::UnsupportedContentType(_) => "UnsupportedContentType",
            Self::MalformedResponse(_) => "MalformedResponse",
            Self::SseEventTooLarge => "SseEventTooLarge",
            Self::Declared(error) => error.tag.as_deref().unwrap_or("DeclaredError"),
        }
    }

    /// The declared error, if the server returned one.
    pub fn declared(&self) -> Option<&DeclaredError> {
        match self {
            Self::Declared(error) => Some(error),
            _ => None,
        }
    }
}

/// A declared error body. The tag is `_tag`, else `name`; the message is `message`, else `data.message`,
/// as `declared` in the TypeScript client.
#[derive(Debug, Clone, PartialEq)]
pub struct DeclaredError {
    pub status: u16,
    pub tag: Option<String>,
    pub message: Option<String>,
    pub body: Value,
}

impl DeclaredError {
    pub fn new(status: u16, body: Value) -> Self {
        let text = |value: Option<&Value>| value.and_then(Value::as_str).map(str::to_owned);
        Self {
            status,
            tag: text(body.get("_tag")).or_else(|| text(body.get("name"))),
            message: text(body.get("message"))
                .or_else(|| text(body.get("data").and_then(|data| data.get("message")))),
            body,
        }
    }

    /// Decodes the body into a generated error type, such as `SessionNotFoundError`.
    pub fn decode<T: DeserializeOwned>(&self) -> Result<T, serde_json::Error> {
        serde_json::from_value(self.body.clone())
    }
}

impl std::fmt::Display for DeclaredError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match (&self.tag, &self.message) {
            (Some(tag), Some(message)) => write!(f, "{tag}: {message}"),
            (Some(tag), None) => f.write_str(tag),
            (None, Some(message)) => f.write_str(message),
            (None, None) => write!(f, "declared error {}", self.status),
        }
    }
}
