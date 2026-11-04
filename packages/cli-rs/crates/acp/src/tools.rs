//! Tool calls as ACP `tool_call` and `tool_call_update` (`packages/cli/src/acp/tool.ts`).
//!
//! C.12 (`rs-acp-rest`) owns this file. C.11 left the signatures the turn translation calls, with
//! bodies that report the tool's ID, status, title, kind, input, and text output. C.12 adds locations,
//! read-tool display text, image content, and patch hunks.

use serde_json::{Map, Value, json};

/// What a completed tool call's diffs are rebuilt from (`DiffSource`).
#[derive(Debug, Clone, PartialEq)]
pub struct DiffSource {
    pub tool_name: String,
    pub input: Value,
    pub metadata: Option<Value>,
}

pub fn pending_tool_call(
    tool_call_id: &str,
    tool_name: &str,
    input: &Value,
    title: Option<&str>,
    cwd: &str,
) -> Value {
    json!({
        "toolCallId": tool_call_id,
        "name": tool_name,
        "title": tool_title(tool_name, input, title),
        "kind": kind(tool_name),
        "status": "pending",
        "locations": locations(tool_name, input, cwd),
        "rawInput": raw_input(tool_name, input, cwd),
    })
}

pub fn running_tool_update(tool_call_id: &str, tool_name: &str, input: &Value, cwd: &str) -> Value {
    json!({
        "toolCallId": tool_call_id,
        "status": "in_progress",
        "kind": kind(tool_name),
        "title": tool_title(tool_name, input, None),
        "locations": locations(tool_name, input, cwd),
        "rawInput": raw_input(tool_name, input, cwd),
    })
}

pub fn completed_tool_update(
    tool_call_id: &str,
    tool_name: &str,
    input: &Value,
    content: &Value,
    metadata: Option<&Value>,
    cwd: &str,
) -> Value {
    json!({
        "toolCallId": tool_call_id,
        "status": "completed",
        "locations": locations(tool_name, input, cwd),
        "content": tool_content(content),
        "rawOutput": raw_output(metadata, None),
    })
}

#[allow(clippy::too_many_arguments)]
pub fn error_tool_update(
    tool_call_id: &str,
    tool_name: &str,
    input: &Value,
    content: &Value,
    metadata: Option<&Value>,
    error: &str,
    cwd: &str,
) -> Value {
    let mut parts = tool_content(content);
    parts.push(json!({ "type": "content", "content": { "type": "text", "text": error } }));
    json!({
        "toolCallId": tool_call_id,
        "status": "failed",
        "kind": kind(tool_name),
        "title": tool_title(tool_name, input, None),
        "locations": locations(tool_name, input, cwd),
        "rawInput": raw_input(tool_name, input, cwd),
        "content": parts,
        "rawOutput": raw_output(metadata, Some(error)),
    })
}

pub fn canonical_name(tool_name: &str) -> String {
    let name = tool_name.to_lowercase();
    match name.as_str() {
        "bash" => "shell".to_owned(),
        "task" => "subagent".to_owned(),
        "apply_patch" => "patch".to_owned(),
        _ => name,
    }
}

fn kind(tool_name: &str) -> &'static str {
    match canonical_name(tool_name).as_str() {
        "shell" => "execute",
        "webfetch" => "fetch",
        "edit" | "patch" | "write" => "edit",
        "grep"
        | "glob"
        | "context"
        | "context7_resolve_library_id"
        | "context7_get_library_docs" => "search",
        "read" => "read",
        "subagent" => "think",
        _ => "other",
    }
}

// C.12 fills in the per-tool locations of `toLocations`.
fn locations(_tool_name: &str, _input: &Value, _cwd: &str) -> Vec<Value> {
    Vec::new()
}

fn is_shell(tool_name: &str) -> bool {
    canonical_name(tool_name) == "shell"
}

fn text(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(str::to_owned)
}

fn tool_title(tool_name: &str, input: &Value, fallback: Option<&str>) -> String {
    if is_shell(tool_name) {
        return text(input, "command")
            .or_else(|| text(input, "cmd"))
            .or_else(|| fallback.map(str::to_owned))
            .unwrap_or_else(|| tool_name.to_owned());
    }
    fallback
        .filter(|title| !title.is_empty())
        .unwrap_or(tool_name)
        .to_owned()
}

fn raw_input(tool_name: &str, input: &Value, cwd: &str) -> Value {
    let truthy = |key: &str| {
        input
            .get(key)
            .is_some_and(|value| !value.is_null() && value != "" && value != &json!(false))
    };
    if !is_shell(tool_name) || truthy("cwd") || truthy("workdir") {
        return input.clone();
    }
    let mut object = input.as_object().cloned().unwrap_or_default();
    object.insert("cwd".to_owned(), json!(cwd));
    Value::Object(object)
}

fn raw_output(metadata: Option<&Value>, error: Option<&str>) -> Value {
    let mut output = Map::new();
    if let Some(metadata) = metadata {
        output.insert("metadata".to_owned(), metadata.clone());
    }
    if let Some(error) = error {
        output.insert("error".to_owned(), json!(error));
    }
    Value::Object(output)
}

fn tool_content(content: &Value) -> Vec<Value> {
    content
        .as_array()
        .into_iter()
        .flatten()
        .filter(|part| part.get("type").and_then(Value::as_str) == Some("text"))
        .map(|part| {
            json!({
                "type": "content",
                "content": { "type": "text", "text": part.get("text").cloned().unwrap_or(json!("")) },
            })
        })
        .collect()
}
