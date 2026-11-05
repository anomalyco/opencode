//! Server errors as ACP errors, session IDs, and event subscriptions (`packages/cli/src/acp/client.ts`).

use futures_util::stream::BoxStream;
use opencode_api::client::Client;
use opencode_api::error::Error;
use serde_json::Value;

use crate::error::Failure;

/// `classify`: an unreachable server, a missing session, and invalid requests become ACP errors;
/// anything else is a defect.
pub fn classify(error: &Error) -> Failure {
    match error {
        // The TS client reports a failed send or body read as a transport error.
        Error::Transport(_) => Failure::ServerUnavailable,
        Error::Declared(declared) => {
            let text = |key: &str| declared.body.get(key).and_then(Value::as_str).map(str::to_owned);
            match declared.tag.as_deref() {
                Some("SessionNotFoundError") => {
                    Failure::SessionNotFound { session_id: text("sessionID").unwrap_or_default() }
                }
                Some("InvalidRequestError") => Failure::InvalidRequest {
                    message: declared.message.clone().unwrap_or_default(),
                    field: text("field"),
                },
                Some("InvalidCursorError") => Failure::InvalidRequest {
                    message: declared.message.clone().unwrap_or_default(),
                    field: Some("cursor".to_owned()),
                },
                tag => Failure::Defect { name: tag.map(str::to_owned), detail: error.to_string() },
            }
        }
        _ => Failure::Defect { name: Some("ClientError".to_owned()), detail: error.to_string() },
    }
}

/// `classify` as a result mapper.
pub fn check<T>(result: Result<T, Error>) -> Result<T, Failure> {
    result.map_err(|error| classify(&error))
}

/// Whether `error` is the declared error `tag`.
pub fn is_declared(error: &Error, tag: &str) -> bool {
    error.declared().is_some_and(|declared| declared.tag.as_deref() == Some(tag))
}

/// `decodeSessionID`: session IDs start with `ses`.
pub fn decode_session_id(value: &str) -> Result<String, Failure> {
    if value.starts_with("ses") {
        return Ok(value.to_owned());
    }
    Err(Failure::invalid_request("Invalid session ID", Some("sessionID")))
}

/// One `GET /api/event` stream of raw events. A failure to open the stream is its first item.
pub fn subscribe(client: &Client) -> BoxStream<'static, Result<Value, Error>> {
    opencode_api::events::raw(client)
}

/// The `type` of an event.
pub fn event_type(event: &Value) -> &str {
    event.get("type").and_then(Value::as_str).unwrap_or_default()
}
