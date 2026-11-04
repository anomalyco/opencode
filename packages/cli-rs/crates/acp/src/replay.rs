//! `session/load` history replay (`packages/cli/src/acp/replay.ts`). Messages stay JSON, as the server
//! sends them.

use opencode_api::client::{Call, Client, RequestOptions, path_param};
use serde_json::{Map, Value, json};

use crate::capabilities::Capabilities;
use crate::client::classify;
use crate::compaction;
use crate::connection::Connection;
use crate::content::{PromptPart, ReplayPart, parts_to_content_chunks};
use crate::error::Failure;
use crate::permission;
use crate::sessions::Attached;
use crate::tools::{
    DiffSource, completed_tool_update, error_tool_update, pending_tool_call, running_tool_update,
};
use crate::translate::reasoning_message_id;

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
        for message in page
            .get("data")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            for update in updates(message, &attached.cwd, capabilities) {
                let source = completed_source(message, &update);
                let enriched =
                    permission::with_completed_diffs(update, source.as_ref(), &attached.cwd).await;
                connection.session_update(&attached.id, enriched)?;
            }
        }
        cursor = page
            .get("cursor")
            .and_then(|cursor| cursor.get("next"))
            .and_then(Value::as_str)
            .map(str::to_owned);
        if cursor.is_none() {
            return Ok(());
        }
    }
}

// The page stays JSON: the generated message types would drop fields the updates forward as they are.
async fn list(client: &Client, session_id: &str, cursor: Option<&str>) -> Result<Value, Failure> {
    let path = path_param(session_id).map_err(|error| classify(&error))?;
    let mut call = Call::new(
        "GET",
        format!("/api/session/{path}/message"),
        200,
        &[400, 401, 404, 500],
    );
    let query = match cursor {
        Some(cursor) => call
            .query("limit", &PAGE_SIZE)
            .and_then(|()| call.query("cursor", cursor)),
        None => call
            .query("limit", &PAGE_SIZE)
            .and_then(|()| call.query("order", "asc")),
    };
    query.map_err(|error| classify(&error))?;
    client
        .json::<Value>(call, &RequestOptions::default())
        .await
        .map_err(|error| classify(&error))
}

/// The updates that replay one stored message.
pub fn updates(message: &Value, cwd: &str, capabilities: &Capabilities) -> Vec<Value> {
    let id = message.get("id").cloned().unwrap_or(Value::Null);
    match message.get("type").and_then(Value::as_str) {
        Some("user") => user_updates(message, &id),
        Some("compaction") => compaction::replay(message, capabilities.compaction)
            .into_iter()
            .collect(),
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
            let url = match source
                .and_then(|source| source.get("type"))
                .and_then(Value::as_str)
            {
                Some("uri") => text(source.unwrap_or(&Value::Null), "uri"),
                _ => format!("data:{mime};base64,{}", text(file, "data")),
            };
            ReplayPart::Prompt(PromptPart::File {
                url,
                filename: file.get("name").and_then(Value::as_str).map(str::to_owned),
                mime,
            })
        })
        .collect();
    let mut updates = vec![json!({
        "sessionUpdate": "user_message_chunk",
        "messageId": id,
        "content": { "type": "text", "text": message.get("text").cloned().unwrap_or(Value::Null) },
    })];
    updates.extend(parts_to_content_chunks(&parts).into_iter().map(|chunk| {
        let mut update = Map::new();
        update.insert("sessionUpdate".to_owned(), json!("user_message_chunk"));
        update.insert("messageId".to_owned(), id.clone());
        if let Value::Object(chunk) = chunk {
            update.extend(chunk);
        }
        Value::Object(update)
    }));
    updates
}

fn assistant_updates(message: &Value, id: &Value, cwd: &str) -> Vec<Value> {
    let message_id = id.as_str().unwrap_or_default();
    let content = message
        .get("content")
        .and_then(Value::as_array)
        .map_or(&[][..], Vec::as_slice);
    // Live reasoning ordinals count only reasoning parts, not the mixed content array.
    let mut reasoning = 0;
    content
        .iter()
        .flat_map(|part| match part.get("type").and_then(Value::as_str) {
            Some("text") => vec![json!({
                "sessionUpdate": "agent_message_chunk",
                "messageId": id,
                "content": { "type": "text", "text": part.get("text").cloned().unwrap_or(Value::Null) },
            })],
            Some("reasoning") => {
                let ordinal = reasoning;
                reasoning += 1;
                vec![json!({
                    "sessionUpdate": "agent_thought_chunk",
                    "messageId": reasoning_message_id(message_id, &json!(ordinal)),
                    "content": { "type": "text", "text": part.get("text").cloned().unwrap_or(Value::Null) },
                })]
            }
            _ => tool_updates(part, cwd),
        })
        .collect()
}

fn tool_updates(part: &Value, cwd: &str) -> Vec<Value> {
    let id = text(part, "id");
    let name = text(part, "name");
    let state = part.get("state").unwrap_or(&Value::Null);
    let status = state.get("status").and_then(Value::as_str);
    let empty = json!({});
    let input = match status {
        Some("streaming") => &empty,
        _ => state.get("input").unwrap_or(&empty),
    };
    let metadata = state.get("metadata").filter(|metadata| !metadata.is_null());
    let content = state.get("content").unwrap_or(&Value::Null);
    let call = tagged("tool_call", pending_tool_call(&id, &name, input, None, cwd));
    let update = match status {
        Some("completed") => completed_tool_update(&id, &name, input, content, metadata, cwd),
        Some("running") => running_tool_update(&id, &name, input, cwd),
        Some("error") => error_tool_update(
            &id,
            &name,
            input,
            content,
            metadata,
            state
                .get("error")
                .and_then(|error| error.get("message"))
                .and_then(Value::as_str)
                .unwrap_or_default(),
            cwd,
        ),
        _ => return vec![call],
    };
    vec![call, tagged("tool_call_update", update)]
}

fn tagged(kind: &str, update: Value) -> Value {
    let mut tagged = Map::new();
    tagged.insert("sessionUpdate".to_owned(), json!(kind));
    if let Value::Object(update) = update {
        tagged.extend(update);
    }
    Value::Object(tagged)
}

fn completed_source(message: &Value, update: &Value) -> Option<DiffSource> {
    if message.get("type").and_then(Value::as_str) != Some("assistant")
        || update.get("sessionUpdate").and_then(Value::as_str) != Some("tool_call_update")
    {
        return None;
    }
    let part = message.get("content")?.as_array()?.iter().find(|item| {
        item.get("type").and_then(Value::as_str) == Some("tool")
            && item.get("id") == update.get("toolCallId")
    })?;
    let state = part.get("state")?;
    if state.get("status").and_then(Value::as_str) != Some("completed") {
        return None;
    }
    Some(DiffSource {
        tool_name: text(part, "name"),
        input: state.get("input").cloned().unwrap_or(Value::Null),
        metadata: state.get("metadata").cloned(),
    })
}

fn text(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
}
