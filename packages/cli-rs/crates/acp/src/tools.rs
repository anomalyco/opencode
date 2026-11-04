//! Tool calls as ACP `tool_call` and `tool_call_update` (`packages/cli/src/acp/tool.ts`).

pub mod patch;

use std::sync::LazyLock;

use indexmap::IndexSet;
use regex::Regex;
use serde_json::{Map, Value, json};

use crate::paths;

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
    let normalized = tool_content(content);
    let first_text = content
        .as_array()
        .into_iter()
        .flatten()
        .find(|part| part.get("type").and_then(Value::as_str) == Some("text"));
    let read = first_text
        .filter(|_| canonical_name(tool_name) == "read")
        .and_then(|part| read_display_text(part.get("text").and_then(Value::as_str)?));
    let (images, others): (Vec<Value>, Vec<Value>) = normalized
        .into_iter()
        .partition(|part| part["content"]["type"] == "image");
    let mut parts = match read {
        Some(text) => {
            vec![json!({ "type": "content", "content": { "type": "text", "text": text } })]
        }
        None => others,
    };
    parts.extend(images);
    json!({
        "toolCallId": tool_call_id,
        "status": "completed",
        "locations": locations(tool_name, input, cwd),
        "content": parts,
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

/// `toLocations`: the files and directories a tool call touches, absolute against `cwd`.
pub fn locations(tool_name: &str, input: &Value, cwd: &str) -> Vec<Value> {
    let values: Vec<Option<String>> = match canonical_name(tool_name).as_str() {
        "shell" => vec![Some(
            text(input, "workdir")
                .or_else(|| text(input, "cwd"))
                .unwrap_or_else(|| cwd.to_owned()),
        )],
        "read" | "edit" | "write" => vec![file_path(input)],
        "patch" => patch_hunks(input)
            .into_iter()
            .flat_map(|hunk| {
                let target = match &hunk {
                    patch::Hunk::Update { move_path, .. } => move_path.clone(),
                    _ => None,
                };
                [Some(hunk.path().to_owned()), target]
            })
            .collect(),
        "external_directory" => vec![text(input, "filepath")],
        "grep"
        | "glob"
        | "context"
        | "context7_resolve_library_id"
        | "context7_get_library_docs" => vec![text(input, "path")],
        _ => Vec::new(),
    };
    location_from(cwd, values)
}

/// Unique, non-empty paths as ACP locations, in order.
pub fn location_from(cwd: &str, values: impl IntoIterator<Item = Option<String>>) -> Vec<Value> {
    values
        .into_iter()
        .flatten()
        .filter(|value| !value.is_empty())
        .map(|value| absolute_path(&value, cwd))
        .collect::<IndexSet<_>>()
        .into_iter()
        .map(|path| json!({ "path": path }))
        .collect()
}

// Sessions migrated from V1 keep their original `filePath` tool inputs.
pub fn file_path(input: &Value) -> Option<String> {
    text(input, "path").or_else(|| text(input, "filePath"))
}

/// The hunks of a patch tool's `patchText`, empty when it is missing or does not parse.
pub fn patch_hunks(input: &Value) -> Vec<patch::Hunk> {
    text(input, "patchText")
        .filter(|text| !text.is_empty())
        .and_then(|text| patch::parse(&text))
        .unwrap_or_default()
}

/// `absolutePath`: absolute paths stay as they are; relative ones resolve against `cwd`.
pub fn absolute_path(path: &str, cwd: &str) -> String {
    if paths::is_absolute(path) {
        return path.to_owned();
    }
    paths::resolve_from(cwd, path)
}

fn is_shell(tool_name: &str) -> bool {
    canonical_name(tool_name) == "shell"
}

pub fn text(value: &Value, key: &str) -> Option<String> {
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

static DATA_IMAGE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^data:([^;,]+)(?:;[^,]*)*;base64,(.*)$").expect("data URL pattern")
});

/// Text parts as text content, and `data:image/...;base64` file parts as images.
fn tool_content(content: &Value) -> Vec<Value> {
    content
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|part| {
            if part.get("type").and_then(Value::as_str) == Some("text") {
                return Some(json!({
                    "type": "content",
                    "content": { "type": "text", "text": part.get("text").cloned().unwrap_or(Value::Null) },
                }));
            }
            let captures = DATA_IMAGE.captures(part.get("uri")?.as_str()?)?;
            let mime = captures.get(1)?.as_str();
            if !mime.starts_with("image/") {
                return None;
            }
            Some(json!({
                "type": "content",
                "content": { "type": "image", "mimeType": mime, "data": captures.get(2)?.as_str() },
            }))
        })
        .collect()
}

/// `readDisplayText` (`packages/tui/src/mini/tool.ts`): the human-facing text of read's JSON page
/// envelope.
fn read_display_text(text: &str) -> Option<String> {
    if !text.starts_with('{') {
        return None;
    }
    let envelope = serde_json::from_str::<Value>(text)
        .ok()
        .filter(Value::is_object)
        .unwrap_or_else(|| json!({}));
    if let Some(content) = envelope.get("content").and_then(Value::as_str)
        && (envelope.get("type").and_then(Value::as_str) == Some("text-page")
            || envelope.get("encoding").and_then(Value::as_str) == Some("utf8"))
    {
        return Some(content.to_owned());
    }
    let entries = envelope.get("entries")?.as_array()?;
    let lines: Vec<&str> = entries
        .iter()
        .filter_map(|entry| entry.as_str().or_else(|| entry.get("path")?.as_str()))
        .collect();
    Some(lines.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_display_text_and_keeps_images_last() {
        let content = json!([
            { "type": "file", "uri": "data:image/png;base64,AAAA", "mime": "image/png" },
            { "type": "text", "text": "{\"type\":\"text-page\",\"content\":\"hello\"}" },
            { "type": "file", "uri": "data:text/plain;base64,AAAA" },
        ]);
        let update = completed_tool_update(
            "c",
            "read",
            &json!({ "path": "a.ts" }),
            &content,
            None,
            "/w",
        );
        assert_eq!(
            update["content"],
            json!([
                { "type": "content", "content": { "type": "text", "text": "hello" } },
                { "type": "content", "content": { "type": "image", "mimeType": "image/png", "data": "AAAA" } },
            ])
        );
        assert_eq!(update["locations"], json!([{ "path": "/w/a.ts" }]));
        assert_eq!(
            read_display_text("{\"entries\":[\"a\",{\"path\":\"b\"},3]}").as_deref(),
            Some("a\nb")
        );
        assert_eq!(read_display_text("plain"), None);
    }

    #[test]
    fn locates_tool_paths() {
        let patch = "*** Begin Patch\n*** Update File: a.ts\n*** Move to: b.ts\n@@\n-x\n+y\n*** Add File: a.ts\n+z\n*** End Patch";
        assert_eq!(
            locations("apply_patch", &json!({ "patchText": patch }), "/w"),
            json!([{ "path": "/w/a.ts" }, { "path": "/w/b.ts" }])
                .as_array()
                .unwrap()
                .clone()
        );
        assert_eq!(
            locations("bash", &json!({ "cwd": "sub" }), "/w"),
            vec![json!({ "path": "/w/sub" })]
        );
        assert_eq!(
            locations("glob", &json!({ "path": "/abs/../x" }), "/w"),
            vec![json!({ "path": "/abs/../x" })]
        );
        assert!(locations("webfetch", &json!({ "url": "x" }), "/w").is_empty());
    }
}
