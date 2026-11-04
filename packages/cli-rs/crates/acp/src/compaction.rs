//! Compaction progress as ACP updates (`packages/cli/src/acp/compaction.ts`).

use std::collections::HashMap;

use serde_json::{Map, Value, json};

const MARKER_META: &str = "opencode/compaction";

/// A compaction that started and has not ended.
#[derive(Debug, Clone, PartialEq)]
pub struct Started {
    pub message_id: String,
    pub reason: String,
}

/// Open compactions by session ID.
pub type Tracked = HashMap<String, Started>;

enum Status {
    Started,
    Completed { summary: String },
    Failed { error: Value },
}

struct Compaction {
    message_id: String,
    reason: String,
    status: Status,
}

// Without child updates, a child's standard update would read as the parent's own.
pub fn uses_standard_updates(compaction: bool, child_updates: bool, child: bool) -> bool {
    compaction && (!child || child_updates)
}

/// Applies a `session.compaction.started`, `ended`, or `failed` event.
pub fn apply(event: &Value, tracked: &Tracked, standard_updates: bool) -> (Tracked, Vec<Value>) {
    let data = event.get("data").unwrap_or(&Value::Null);
    let session_id = text(data, "sessionID");
    let reason = text(data, "reason");
    let mut remaining = tracked.clone();
    if event.get("type").and_then(Value::as_str) == Some("session.compaction.started") {
        let started = open(event);
        let update = update(&compaction(&started, Status::Started), standard_updates);
        remaining.insert(session_id, started);
        return (remaining, vec![update]);
    }
    let current = remaining.remove(&session_id);
    if event.get("type").and_then(Value::as_str) == Some("session.compaction.ended") {
        let Some(current) = current else {
            return (remaining, Vec::new());
        };
        let completed = Compaction {
            reason,
            ..compaction(
                &current,
                Status::Completed {
                    summary: text(data, "text"),
                },
            )
        };
        return (remaining, vec![update(&completed, standard_updates)]);
    }
    // Auto compaction can fail without a started event; open it first for standard clients.
    let opened = current.is_none();
    let started = current.unwrap_or_else(|| open(event));
    let failed = Compaction {
        reason,
        ..compaction(
            &started,
            Status::Failed {
                error: data.get("error").cloned().unwrap_or(Value::Null),
            },
        )
    };
    let mut updates = Vec::new();
    if opened && standard_updates {
        updates.push(update(
            &compaction(&started, Status::Started),
            standard_updates,
        ));
    }
    updates.push(update(&failed, standard_updates));
    (remaining, updates)
}

/// The update for a `session.compaction.delta`.
pub fn chunk(started: Option<&Started>, text: &str, standard_updates: bool) -> Option<Value> {
    let started = started.filter(|_| standard_updates)?;
    Some(json!({
        "sessionUpdate": "compaction_summary_chunk",
        "compactionId": started.message_id,
        "content": { "type": "text", "text": text },
    }))
}

/// The update that ends a compaction a cancelled turn left open.
pub fn abandon(started: &Started, standard_updates: bool) -> Option<Value> {
    let error = json!({ "type": "aborted", "message": "Compaction cancelled" });
    Some(update(
        &compaction(started, Status::Failed { error }),
        standard_updates,
    ))
}

/// The update for a stored compaction message. A running one is skipped: nothing on this connection
/// would settle it.
pub fn replay(message: &Value, standard_updates: bool) -> Option<Value> {
    let status = match message.get("status").and_then(Value::as_str) {
        Some("running") => return None,
        Some("failed") => Status::Failed {
            error: message.get("error").cloned().unwrap_or(Value::Null),
        },
        _ => Status::Completed {
            summary: text(message, "summary"),
        },
    };
    Some(update(
        &Compaction {
            message_id: text(message, "id"),
            reason: text(message, "reason"),
            status,
        },
        standard_updates,
    ))
}

fn compaction(started: &Started, status: Status) -> Compaction {
    Compaction {
        message_id: started.message_id.clone(),
        reason: started.reason.clone(),
        status,
    }
}

// Matches core's compaction message ID, so live and replayed compactions line up.
fn open(event: &Value) -> Started {
    let data = event.get("data").unwrap_or(&Value::Null);
    let message_id = data
        .get("inputID")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .unwrap_or_else(|| {
            let id = text(event, "id");
            match id.strip_prefix("evt_") {
                Some(rest) => format!("msg_{rest}"),
                None => id,
            }
        });
    Started {
        message_id,
        reason: text(data, "reason"),
    }
}

fn update(compaction: &Compaction, standard_updates: bool) -> Value {
    if !standard_updates {
        let mut marker = Map::new();
        let status = match compaction.status {
            Status::Started => "started",
            Status::Completed { .. } => "completed",
            Status::Failed { .. } => "failed",
        };
        marker.insert("status".to_owned(), json!(status));
        marker.insert("messageId".to_owned(), json!(compaction.message_id));
        marker.insert("reason".to_owned(), json!(compaction.reason));
        if let Status::Failed { error } = &compaction.status {
            marker.insert("error".to_owned(), error.clone());
        }
        return json!({ "sessionUpdate": "session_info_update", "_meta": { (MARKER_META): marker } });
    }
    let id = &compaction.message_id;
    match &compaction.status {
        Status::Started => {
            json!({ "sessionUpdate": "compaction_update", "compactionId": id, "status": "in_progress" })
        }
        Status::Completed { summary } => {
            let summary =
                (!summary.is_empty()).then(|| json!([{ "type": "text", "text": summary }]));
            json!({ "sessionUpdate": "compaction_update", "compactionId": id, "status": "completed", "summary": summary })
        }
        Status::Failed { error } => {
            if matches!(
                error.get("type").and_then(Value::as_str),
                Some("aborted" | "compaction.interrupted")
            ) {
                return json!({ "sessionUpdate": "compaction_update", "compactionId": id, "status": "cancelled", "summary": null });
            }
            json!({
                "sessionUpdate": "compaction_update", "compactionId": id, "status": "failed",
                "summary": null, "error": display_error(error),
            })
        }
    }
}

// Core reports a defect as `compaction.failed` with a multi-line pretty-printed cause.
fn display_error(error: &Value) -> String {
    let message = text(error, "message");
    let defect = error.get("type").and_then(Value::as_str) == Some("compaction.failed")
        && message.contains('\n');
    if message.is_empty() || defect {
        return "Compaction failed".to_owned();
    }
    message
}

fn text(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
}
