//! Permission asks as `session/request_permission`, and completed edits as diffs
//! (`packages/cli/src/acp/permission.ts`).
//!
//! C.12 (`rs-acp-rest`) owns this file. C.11 left the signatures the turn calls, with a plain ask (the
//! tool or action name as title, no previews or locations) and no diffs. C.12 adds titles, previews,
//! locations, and full-file diffs.

use opencode_api::client::{Client, RequestOptions};
use opencode_api::generated::{PermissionID, PermissionReply, PermissionReplyInput, SessionID};
use serde_json::{Value, json};

use crate::child;
use crate::client::{check, is_declared};
use crate::connection::Connection;
use crate::error::Failure;
use crate::tools::{DiffSource, pending_tool_call};
use crate::translate::Tool;

pub struct Input {
    pub client: Client,
    pub connection: Connection,
    /// The `permission.asked` event.
    pub event: Value,
    pub session_id: String,
    pub client_session_id: String,
    pub cwd: String,
    pub tool: Option<Tool>,
    pub child: Option<child::Session>,
}

impl Input {
    fn data(&self, key: &str) -> Option<&Value> {
        self.event.get("data").and_then(|data| data.get(key))
    }
}

/// Asks the client and returns the decision: `once`, `always`, or `reject`.
pub async fn ask(input: &Input) -> Result<String, Failure> {
    let tool_name = input.tool.as_ref().map_or_else(
        || {
            input
                .data("action")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned()
        },
        |tool| tool.name.clone(),
    );
    let tool_input = input
        .tool
        .as_ref()
        .map(|tool| tool.input.clone())
        .or_else(|| input.data("metadata").cloned())
        .unwrap_or_else(|| json!({}));
    let request_id = input.data("id").and_then(Value::as_str).unwrap_or_default();
    let tool_call_id = child::tool_call_id(
        input.child.as_ref(),
        input
            .tool
            .as_ref()
            .map_or(request_id, |tool| tool.id.as_str()),
    );
    let title = child::prefix_title(input.child.as_ref(), &tool_name);
    let mut tool_call = pending_tool_call(
        &tool_call_id,
        &tool_name,
        &tool_input,
        Some(&title),
        &input.cwd,
    );
    if let Some(child) = &input.child
        && let Some(object) = tool_call.as_object_mut()
    {
        object.insert("_meta".to_owned(), child::meta(child));
    }
    let result = input
        .connection
        .request(
            "session/request_permission",
            json!({
                "sessionId": input.client_session_id,
                "toolCall": tool_call,
                "options": [
                    { "optionId": "once", "kind": "allow_once", "name": "Allow once" },
                    { "optionId": "always", "kind": "allow_always", "name": "Always allow" },
                    { "optionId": "reject", "kind": "reject_once", "name": "Reject" },
                ],
            }),
        )
        .await?;
    let outcome = result.get("outcome");
    let selected = (outcome
        .and_then(|outcome| outcome.get("outcome"))
        .and_then(Value::as_str)
        == Some("selected"))
    .then(|| {
        outcome
            .and_then(|outcome| outcome.get("optionId"))
            .and_then(Value::as_str)
    })
    .flatten();
    Ok(match selected {
        Some(decision @ ("once" | "always")) => decision.to_owned(),
        _ => "reject".to_owned(),
    })
}

pub async fn respond(input: &Input, decision: &str) -> Result<(), Failure> {
    let result = input
        .client
        .permission_reply(
            &PermissionReplyInput {
                session_id: SessionID(input.session_id.clone()),
                request_id: PermissionID(
                    input
                        .data("id")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_owned(),
                ),
                decision: match decision {
                    "once" => PermissionReply::Once,
                    "always" => PermissionReply::Always,
                    _ => PermissionReply::Reject,
                },
                message: None,
            },
            &RequestOptions::default(),
        )
        .await;
    match result {
        Err(error) if is_declared(&error, "PermissionNotFoundError") => Ok(()),
        result => check(result),
    }
}

/// A completed edit's update with full-file diffs added.
pub async fn with_completed_diffs(
    update: Value,
    _source: Option<&DiffSource>,
    _cwd: &str,
) -> Value {
    update
}
