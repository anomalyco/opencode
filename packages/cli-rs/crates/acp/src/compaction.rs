use std::borrow::Cow;
use std::collections::HashMap;

use opencode_api::generated::{
    SessionCompactionEnded, SessionCompactionFailed, SessionCompactionStarted, SessionMessageID,
};
use serde::Serialize;
use serde_json::{Value, json};

use crate::update::{Content, Kind, Meta, Update};

/// A compaction that started and has not ended.
#[derive(Debug, Clone, PartialEq)]
pub struct Started {
    pub message_id: String,
    pub reason: String,
}

/// Open compactions by session ID.
pub type Tracked = HashMap<String, Started>;

enum Status<'a> {
    Started,
    Completed { summary: &'a str },
    Failed { error: Cow<'a, Value> },
}

/// A `compaction_update`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompactionUpdate<'a> {
    compaction_id: String,
    status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    summary: Option<Option<[Content<'a>; 1]>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

/// The `opencode/compaction` marker that stands in for compaction updates.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Marker<'a> {
    status: &'static str,
    message_id: String,
    reason: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<Cow<'a, Value>>,
}

// Without child updates, a child's standard update would read as the parent's own.
pub fn uses_standard_updates(compaction: bool, child_updates: bool, child: bool) -> bool {
    compaction && (!child || child_updates)
}

pub fn started<'a>(tracked: &mut Tracked, event: &SessionCompactionStarted, standard_updates: bool) -> Update<'a> {
    let data = &event.data;
    let started = open(&event.id.0, data.input_id.as_ref(), data.reason.as_str());
    let update = update(&started.message_id, &started.reason, Status::Started, standard_updates);
    tracked.insert(data.session_id.0.clone(), started);
    update
}

pub fn ended<'a>(
    tracked: &mut Tracked,
    event: &'a SessionCompactionEnded,
    standard_updates: bool,
) -> Option<Update<'a>> {
    let current = tracked.remove(event.data.session_id.as_str())?;
    let status = Status::Completed { summary: &event.data.text };
    Some(update(&current.message_id, event.data.reason.as_str(), status, standard_updates))
}

pub fn failed<'a>(
    tracked: &mut Tracked,
    event: &SessionCompactionFailed,
    error: &'a Value,
    standard_updates: bool,
) -> Vec<Update<'a>> {
    let data = &event.data;
    let current = tracked.remove(data.session_id.as_str());
    // Auto compaction can fail without a started event; open it first for standard clients.
    let opened = current.is_none();
    let started = current.unwrap_or_else(|| open(&event.id.0, data.input_id.as_ref(), data.reason.as_str()));
    let mut updates = Vec::new();
    if opened && standard_updates {
        updates.push(update(&started.message_id, &started.reason, Status::Started, standard_updates));
    }
    let status = Status::Failed { error: Cow::Borrowed(error) };
    updates.push(update(&started.message_id, data.reason.as_str(), status, standard_updates));
    updates
}

/// The update for a `session.compaction.delta`.
pub fn chunk<'a>(started: Option<&Started>, text: &'a str, standard_updates: bool) -> Option<Update<'a>> {
    let started = started.filter(|_| standard_updates)?;
    let content = Content::Text { text: Cow::Borrowed(text) };
    Some(Kind::CompactionSummaryChunk { compaction_id: started.message_id.clone(), content }.into())
}

/// The update that ends a compaction a cancelled turn left open.
pub fn abandon(started: &Started, standard_updates: bool) -> Option<Update<'static>> {
    let error = json!({ "type": "aborted", "message": "Compaction cancelled" });
    let status = Status::Failed { error: Cow::Owned(error) };
    Some(update(&started.message_id, &started.reason, status, standard_updates))
}

/// The update for a stored compaction message. A running one is skipped: nothing on this connection
/// would settle it.
pub fn replay(message: &Value, standard_updates: bool) -> Option<Update<'_>> {
    let status = match message.get("status").and_then(Value::as_str) {
        Some("running") => return None,
        Some("failed") => Status::Failed { error: Cow::Borrowed(message.get("error").unwrap_or(&Value::Null)) },
        _ => Status::Completed { summary: text(message, "summary") },
    };
    Some(update(text(message, "id"), text(message, "reason"), status, standard_updates))
}

// Matches core's compaction message ID, so live and replayed compactions line up.
fn open(event_id: &str, input_id: Option<&SessionMessageID>, reason: &str) -> Started {
    let message_id = input_id.map_or_else(
        || event_id.strip_prefix("evt_").map_or_else(|| event_id.to_owned(), |rest| format!("msg_{rest}")),
        |id| id.0.clone(),
    );
    Started { message_id, reason: reason.to_owned() }
}

fn update<'a>(message_id: &str, reason: &str, status: Status<'a>, standard_updates: bool) -> Update<'a> {
    if !standard_updates {
        let (status, error) = match status {
            Status::Started => ("started", None),
            Status::Completed { .. } => ("completed", None),
            Status::Failed { error } => ("failed", Some(error)),
        };
        let marker = Marker { status, message_id: message_id.to_owned(), reason: reason.to_owned(), error };
        return Update { kind: Kind::SessionInfoUpdate {}, meta: Meta { compaction: Some(marker), ..Meta::default() } };
    }
    let (status, summary, error) = match status {
        Status::Started => ("in_progress", None, None),
        Status::Completed { summary } => {
            ("completed", Some((!summary.is_empty()).then_some([Content::Text { text: Cow::Borrowed(summary) }])), None)
        }
        Status::Failed { error } if matches!(text(&error, "type"), "aborted" | "compaction.interrupted") => {
            ("cancelled", Some(None), None)
        }
        Status::Failed { error } => ("failed", Some(None), Some(display_error(&error))),
    };
    Kind::CompactionUpdate(CompactionUpdate { compaction_id: message_id.to_owned(), status, summary, error }).into()
}

// Core reports a defect as `compaction.failed` with a multi-line pretty-printed cause.
fn display_error(error: &Value) -> String {
    let message = text(error, "message");
    let defect = text(error, "type") == "compaction.failed" && message.contains('\n');
    if message.is_empty() || defect {
        return "Compaction failed".to_owned();
    }
    message.to_owned()
}

fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value.get(key).and_then(Value::as_str).unwrap_or_default()
}
