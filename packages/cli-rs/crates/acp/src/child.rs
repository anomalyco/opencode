//! Child-session updates (`packages/cli/src/acp/child.ts`).

use serde_json::{Map, Value, json};

pub const UPDATE_METHOD: &str = "opencode/session/child_update";

#[derive(Debug, Clone, PartialEq)]
pub struct Session {
    pub id: String,
    pub parent_id: String,
    pub depth: u64,
    pub title: Option<String>,
}

impl Session {
    /// The title when it is set and non-empty, as JS truthiness reads it.
    fn title(&self) -> Option<&str> {
        self.title.as_deref().filter(|title| !title.is_empty())
    }
}

/// A child status event: `{ type: "status", status, error? }`.
pub fn status(status: &str, error: Option<Value>) -> Value {
    let mut event = Map::new();
    event.insert("type".to_owned(), json!("status"));
    event.insert("status".to_owned(), json!(status));
    if let Some(error) = error {
        event.insert("error".to_owned(), error);
    }
    Value::Object(event)
}

/// A child update event: `{ type: "update", update }`.
pub fn update_event(update: Value) -> Value {
    json!({ "type": "update", "update": update })
}

/// The `opencode/session/child_update` params for `event`.
pub fn update(root_session_id: &str, child: &Session, event: Value) -> Value {
    let mut update = Map::new();
    update.insert("rootSessionId".to_owned(), json!(root_session_id));
    update.insert("childSessionId".to_owned(), json!(child.id));
    update.insert("parentSessionId".to_owned(), json!(child.parent_id));
    update.insert("depth".to_owned(), json!(child.depth));
    if let Some(title) = child.title() {
        update.insert("title".to_owned(), json!(title));
    }
    if let Value::Object(event) = event {
        update.extend(event);
    }
    Value::Object(update)
}

/// A child's update as the parent session shows it: child metadata, and tool IDs and titles prefixed.
pub fn project(mut update: Value, child: &Session) -> Value {
    let Some(object) = update.as_object_mut() else {
        return update;
    };
    let mut merged = object
        .get("_meta")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    if let Value::Object(own) = meta(child) {
        merged.extend(own);
    }
    object.insert("_meta".to_owned(), Value::Object(merged));
    let kind = object.get("sessionUpdate").and_then(Value::as_str);
    if matches!(kind, Some("tool_call" | "tool_call_update")) {
        if let Some(id) = object.get("toolCallId").and_then(Value::as_str) {
            let id = tool_call_id(Some(child), id);
            object.insert("toolCallId".to_owned(), json!(id));
        }
        if let Some(title) = object
            .get("title")
            .and_then(Value::as_str)
            .filter(|title| !title.is_empty())
        {
            let title = prefix_title(Some(child), title);
            object.insert("title".to_owned(), json!(title));
        }
    }
    update
}

pub fn meta(child: &Session) -> Value {
    let mut session = Map::new();
    session.insert("id".to_owned(), json!(child.id));
    session.insert("parentID".to_owned(), json!(child.parent_id));
    session.insert("depth".to_owned(), json!(child.depth));
    if let Some(title) = child.title() {
        session.insert("title".to_owned(), json!(title));
    }
    json!({ "opencode/child-session": session })
}

pub fn tool_call_id(child: Option<&Session>, id: &str) -> String {
    match child {
        Some(child) => format!("{}:{id}", child.id),
        None => id.to_owned(),
    }
}

pub fn prefix_title(child: Option<&Session>, value: &str) -> String {
    match child.and_then(Session::title) {
        Some(title) => format!("{title}: {value}"),
        None => value.to_owned(),
    }
}
