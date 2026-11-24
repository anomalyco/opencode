//! Replays stored messages on `session/load`.

use std::borrow::Cow;
use std::sync::Arc;

use opencode_api::client::Client;
use opencode_api::generated::{MessageListInput, MessageListInputOrder};
use opencode_util::json_object;
use serde_json::{Value, json};

use crate::capabilities::Capabilities;
use crate::client::classify;
use crate::compaction;
use crate::connection::Connection;
use crate::content::{PromptPart, ReplayPart, parts_to_content_chunks};
use crate::error::Failure;
use crate::permission;
use crate::sessions::Attached;
use crate::tools::{
    DiffSource, Part, completed_tool_update, error_tool_update, pending_tool_call, running_tool_update,
};
use crate::update::{Id, Input, Kind, Update};

const PAGE_SIZE: i64 = 200;

/// Sends the session's stored messages to the client as session updates, oldest first.
pub async fn history(
    client: &Client,
    connection: &Connection,
    attached: &Attached,
    capabilities: &Capabilities,
) -> Result<(), Failure> {
    let mut cursor: Option<String> = None;
    loop {
        let page = list(client, &attached.id, cursor.as_deref()).await?;
        for message in page.get("data").and_then(Value::as_array).into_iter().flatten() {
            for (mut update, source) in updates(message, &attached.cwd, capabilities) {
                permission::add_completed_diffs(&mut update, source.as_ref(), &attached.cwd).await;
                connection.session_update_written(&attached.id, &update).await?;
            }
        }
        cursor = page.get("cursor").and_then(|cursor| cursor.get("next")).and_then(Value::as_str).map(str::to_owned);
        if cursor.is_none() {
            return Ok(());
        }
    }
}

// The page stays JSON: the generated message types would drop fields the updates forward as they are.
async fn list(client: &Client, session_id: &str, cursor: Option<&str>) -> Result<Value, Failure> {
    let input = MessageListInput {
        session_id: session_id.into(),
        limit: Some(PAGE_SIZE),
        order: cursor.is_none().then_some(MessageListInputOrder::Asc),
        cursor: cursor.map(str::to_owned),
        r#type: None,
    };
    let call = Client::message_list_call(&input).map_err(|error| classify(&error))?;
    client.json::<Value>(call).await.map_err(|error| classify(&error))
}

/// The updates that replay one stored message, each with what a completed tool call's diffs come from.
pub fn updates<'a>(
    message: &'a Value,
    cwd: &'a str,
    capabilities: &Capabilities,
) -> Vec<(Update<'a>, Option<DiffSource>)> {
    let id = message.get("id").cloned().unwrap_or(Value::Null);
    let json = |updates: Vec<Value>| updates.into_iter().map(|update| (Kind::Json(update).into(), None)).collect();
    match message.get("type").and_then(Value::as_str) {
        Some("user") => json(user_updates(message, &id)),
        Some("compaction") => {
            compaction::replay(message, capabilities.compaction).into_iter().map(|update| (update, None)).collect()
        }
        Some("assistant") => assistant_updates(message, &id, cwd),
        _ => Vec::new(),
    }
}

fn user_updates(message: &Value, id: &Value) -> Vec<Value> {
    let parts: Vec<ReplayPart> = message
        .get("files")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|file| {
            let mime = text(file, "mime");
            let source = file.get("source");
            let url = match source.and_then(|source| source.get("type")).and_then(Value::as_str) {
                Some("uri") => text(source.unwrap_or(&Value::Null), "uri").to_owned(),
                _ => format!("data:{mime};base64,{}", text(file, "data")),
            };
            ReplayPart::Prompt(PromptPart::File {
                url,
                filename: file.get("name").and_then(Value::as_str).map(str::to_owned),
                mime: mime.to_owned(),
            })
        })
        .collect();
    let mut updates = vec![json!({
        "sessionUpdate": "user_message_chunk",
        "messageId": id,
        "content": { "type": "text", "text": message.get("text").cloned().unwrap_or(Value::Null) },
    })];
    updates.extend(
        parts_to_content_chunks(&parts)
            .into_iter()
            .map(|chunk| json_object! { "sessionUpdate": "user_message_chunk", "messageId": id, ..chunk }),
    );
    updates
}

fn assistant_updates<'a>(message: &'a Value, id: &Value, cwd: &'a str) -> Vec<(Update<'a>, Option<DiffSource>)> {
    let message_id = id.as_str().unwrap_or_default();
    let content = message.get("content").and_then(Value::as_array).map_or(&[][..], Vec::as_slice);
    // Live reasoning ordinals count only reasoning parts, not the mixed content array.
    let mut reasoning = 0;
    content
        .iter()
        .flat_map(|part| match part.get("type").and_then(Value::as_str) {
            Some("text") => vec![chunk("agent_message_chunk", id.clone(), part)],
            Some("reasoning") => {
                let ordinal = reasoning;
                reasoning += 1;
                vec![chunk("agent_thought_chunk", json!(Id::Reasoning(message_id, ordinal)), part)]
            }
            _ => tool_updates(part, cwd),
        })
        .collect()
}

fn chunk<'a>(kind: &str, message_id: Value, part: &Value) -> (Update<'a>, Option<DiffSource>) {
    let text = part.get("text").cloned().unwrap_or(Value::Null);
    let update = json!({ "sessionUpdate": kind, "messageId": message_id, "content": { "type": "text", "text": text } });
    (Kind::Json(update).into(), None)
}

fn tool_updates<'a>(part: &'a Value, cwd: &'a str) -> Vec<(Update<'a>, Option<DiffSource>)> {
    let (id, name) = (Cow::Borrowed(text(part, "id")), text(part, "name"));
    let state = part.get("state").unwrap_or(&Value::Null);
    let status = state.get("status").and_then(Value::as_str);
    let input = Arc::new(match status {
        Some("streaming") => Input::new(),
        _ => open(state.get("input")).unwrap_or_default(),
    });
    let metadata = open(state.get("metadata"));
    let parts: Vec<Part> =
        state.get("content").and_then(Value::as_array).into_iter().flatten().map(Part::json).collect();
    let call = Kind::ToolCall(pending_tool_call(id.clone(), name, &input, None, cwd)).into();
    let update = match status {
        Some("completed") => {
            let source = DiffSource { tool_name: name.to_owned(), input: input.clone(), metadata: metadata.clone() };
            let update = completed_tool_update(id, name, &input, &parts, metadata.map(Cow::Owned), cwd);
            return vec![(call, None), (Kind::ToolCallUpdate(update).into(), Some(source))];
        }
        Some("running") => running_tool_update(id, name, &input, cwd),
        Some("error") => {
            let error = state.get("error").and_then(|error| error.get("message")).and_then(Value::as_str);
            error_tool_update(id, name, &input, &parts, metadata.map(Cow::Owned), error.unwrap_or_default(), cwd)
        }
        _ => return vec![(call, None)],
    };
    vec![(call, None), (Kind::ToolCallUpdate(update).into(), None)]
}

/// An object of open data, as the live events decode it.
fn open(value: Option<&Value>) -> Option<Input> {
    Some(value?.as_object()?.iter().map(|(key, value)| (key.clone(), value.clone())).collect())
}

fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value.get(key).and_then(Value::as_str).unwrap_or_default()
}
