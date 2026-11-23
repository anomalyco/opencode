pub mod patch;

use std::borrow::Cow;
use std::sync::{Arc, LazyLock};

use indexmap::IndexSet;
use opencode_api::generated::ToolContent;
use opencode_api::tool::{
    ExternalDirectoryInput, Field, PatchInput, ShellInput, ToolInput, ToolKind, read_display_text,
};
use regex::Regex;
use serde_json::{Value, json};

use crate::paths;
use crate::update::{Content, Input, Location, RawOutput, ToolCall, ToolCallContent, ToolCallUpdate};

/// What a completed tool call's diffs are rebuilt from (`DiffSource`).
#[derive(Debug, Clone, PartialEq)]
pub struct DiffSource {
    pub tool_name: String,
    pub input: Arc<Input>,
    pub metadata: Option<Input>,
}

/// A part of a tool's result, as ACP reads it.
#[derive(Debug, Clone, Copy)]
pub enum Part<'a> {
    Text(&'a str),
    Uri(&'a str),
    Other,
}

impl<'a> Part<'a> {
    pub fn of(content: &'a ToolContent) -> Self {
        match content {
            ToolContent::Text(text) => Self::Text(&text.text),
            ToolContent::File(file) => Self::Uri(&file.uri),
            ToolContent::Unknown(value) => Self::json(value),
        }
    }

    pub fn json(value: &'a Value) -> Self {
        let text = |key| value.get(key).and_then(Value::as_str);
        match (text("type"), text("uri")) {
            (Some("text"), _) => Self::Text(text("text").unwrap_or_default()),
            (_, Some(uri)) => Self::Uri(uri),
            _ => Self::Other,
        }
    }
}

pub fn pending_tool_call<'a>(
    id: Cow<'a, str>,
    tool_name: &'a str,
    input: &Arc<Input>,
    title: Option<&str>,
    cwd: &str,
) -> ToolCall<'a> {
    ToolCall {
        tool_call_id: id,
        name: Some(tool_name),
        title: tool_title(tool_name, input, title),
        kind: kind(tool_name),
        status: "pending",
        locations: locations(tool_name, ToolInput::map(input), cwd),
        raw_input: Some(raw_input(tool_name, input, cwd)),
        content: Vec::new(),
    }
}

pub fn running_tool_update<'a>(id: Cow<'a, str>, tool_name: &str, input: &Arc<Input>, cwd: &str) -> ToolCallUpdate<'a> {
    ToolCallUpdate {
        tool_call_id: id,
        status: "in_progress",
        kind: Some(kind(tool_name)),
        title: Some(tool_title(tool_name, input, None)),
        locations: locations(tool_name, ToolInput::map(input), cwd),
        raw_input: Some(raw_input(tool_name, input, cwd)),
        content: None,
        raw_output: None,
    }
}

pub fn completed_tool_update<'a>(
    id: Cow<'a, str>,
    tool_name: &str,
    input: &Input,
    parts: &[Part<'a>],
    metadata: Option<Cow<'a, Input>>,
    cwd: &str,
) -> ToolCallUpdate<'a> {
    let first_text = parts.iter().find_map(|part| match part {
        Part::Text(text) => Some(*text),
        _ => None,
    });
    let read = first_text.filter(|_| tool_kind(tool_name) == ToolKind::Read).and_then(read_display_text);
    let (images, others): (Vec<_>, Vec<_>) = tool_content(parts)
        .into_iter()
        .partition(|part| matches!(part, ToolCallContent::Content { content: Content::Image { .. } }));
    let mut content = match read {
        Some(text) => vec![ToolCallContent::text(Cow::Owned(text))],
        None => others,
    };
    content.extend(images);
    ToolCallUpdate {
        tool_call_id: id,
        status: "completed",
        kind: None,
        title: None,
        locations: locations(tool_name, ToolInput::map(input), cwd),
        raw_input: None,
        content: Some(content),
        raw_output: Some(RawOutput { metadata, error: None }),
    }
}

pub fn error_tool_update<'a>(
    id: Cow<'a, str>,
    tool_name: &str,
    input: &Arc<Input>,
    parts: &[Part<'a>],
    metadata: Option<Cow<'a, Input>>,
    error: &'a str,
    cwd: &str,
) -> ToolCallUpdate<'a> {
    let mut content = tool_content(parts);
    content.push(ToolCallContent::text(Cow::Borrowed(error)));
    let raw_output = Some(RawOutput { metadata, error: Some(error) });
    ToolCallUpdate {
        status: "failed",
        content: Some(content),
        raw_output,
        ..running_tool_update(id, tool_name, input, cwd)
    }
}

/// What a tool is: ACP reads its name in any case.
pub fn tool_kind(tool_name: &str) -> ToolKind {
    ToolKind::of(&tool_name.to_lowercase())
}

fn kind(tool_name: &str) -> &'static str {
    match tool_kind(tool_name) {
        ToolKind::Shell => "execute",
        ToolKind::WebFetch => "fetch",
        ToolKind::Edit | ToolKind::Patch | ToolKind::Write => "edit",
        ToolKind::Grep | ToolKind::Glob | ToolKind::Context => "search",
        ToolKind::Read => "read",
        ToolKind::Subagent => "think",
        _ => "other",
    }
}

/// `toLocations`: the files and directories a tool call touches, absolute against `cwd`.
pub fn locations(tool_name: &str, fields: ToolInput, cwd: &str) -> Vec<Location> {
    let owned = |text: Option<&str>| text.map(str::to_owned);
    let values: Vec<Option<String>> = match tool_kind(tool_name) {
        ToolKind::Shell => {
            let shell = ShellInput(fields);
            vec![Some(shell.workdir().str().or(shell.cwd().str()).unwrap_or(cwd).to_owned())]
        }
        ToolKind::Read | ToolKind::Edit | ToolKind::Write => vec![owned(fields.file_path())],
        ToolKind::Patch => patch_hunks(fields)
            .into_iter()
            .flat_map(|hunk| {
                let target = match &hunk {
                    patch::Hunk::Update { move_path, .. } => move_path.clone(),
                    _ => None,
                };
                [Some(hunk.path().to_owned()), target]
            })
            .collect(),
        ToolKind::ExternalDirectory => vec![owned(ExternalDirectoryInput(fields).filepath().str())],
        ToolKind::Grep | ToolKind::Glob | ToolKind::Context => vec![owned(fields.path().str())],
        _ => Vec::new(),
    };
    location_from(cwd, values)
}

/// Unique, non-empty paths as ACP locations, in order.
pub fn location_from(cwd: &str, values: impl IntoIterator<Item = Option<String>>) -> Vec<Location> {
    values
        .into_iter()
        .flatten()
        .filter(|value| !value.is_empty())
        .map(|value| absolute_path(&value, cwd))
        .collect::<IndexSet<_>>()
        .into_iter()
        .map(|path| Location { path })
        .collect()
}

/// The hunks of a patch tool's `patchText`, empty when it is missing or does not parse.
pub fn patch_hunks(input: ToolInput) -> Vec<patch::Hunk> {
    PatchInput(input).patch_text().non_empty().and_then(patch::parse).unwrap_or_default()
}

/// `absolutePath`: absolute paths stay as they are; relative ones resolve against `cwd`.
pub fn absolute_path(path: &str, cwd: &str) -> String {
    if paths::is_absolute(path) {
        return path.to_owned();
    }
    paths::resolve_from(cwd, path)
}

fn tool_title(tool_name: &str, input: &Input, fallback: Option<&str>) -> String {
    if tool_kind(tool_name) == ToolKind::Shell {
        let shell = ShellInput(ToolInput::map(input));
        return shell.command().str().or(shell.cmd().str()).or(fallback).unwrap_or(tool_name).to_owned();
    }
    fallback.filter(|title| !title.is_empty()).unwrap_or(tool_name).to_owned()
}

fn raw_input(tool_name: &str, input: &Arc<Input>, cwd: &str) -> Arc<Input> {
    let shell = ShellInput(ToolInput::map(input));
    let set =
        |field: Field| field.value().is_some_and(|value| !value.is_null() && value != "" && value != &json!(false));
    if tool_kind(tool_name) != ToolKind::Shell || set(shell.cwd()) || set(shell.workdir()) {
        return input.clone();
    }
    let mut input = Input::clone(input);
    input.insert("cwd".to_owned(), cwd.into());
    Arc::new(input)
}

static DATA_IMAGE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^data:([^;,]+)(?:;[^,]*)*;base64,(.*)$").expect("data URL pattern"));

/// Text parts as text content, and `data:image/...;base64` file parts as images.
fn tool_content<'a>(parts: &[Part<'a>]) -> Vec<ToolCallContent<'a>> {
    parts
        .iter()
        .filter_map(|part| {
            let uri = match *part {
                Part::Text(text) => return Some(ToolCallContent::text(Cow::Borrowed(text))),
                Part::Uri(uri) => uri,
                Part::Other => return None,
            };
            let captures = DATA_IMAGE.captures(uri)?;
            let mime = captures.get(1)?.as_str();
            if !mime.starts_with("image/") {
                return None;
            }
            Some(ToolCallContent::Content {
                content: Content::Image { mime_type: mime, data: captures.get(2)?.as_str() },
            })
        })
        .collect()
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
        let parts: Vec<Part> = content.as_array().unwrap().iter().map(Part::json).collect();
        let input = serde_json::from_value(json!({ "path": "a.ts" })).unwrap();
        let update = completed_tool_update("c".into(), "read", &input, &parts, None, "/w");
        let update = serde_json::to_value(update).unwrap();
        assert_eq!(
            update["content"],
            json!([
                { "type": "content", "content": { "type": "text", "text": "hello" } },
                { "type": "content", "content": { "type": "image", "mimeType": "image/png", "data": "AAAA" } },
            ])
        );
        assert_eq!(update["locations"], json!([{ "path": paths::resolve_from("/w", "a.ts") }]));
    }

    #[test]
    fn locates_tool_paths() {
        // `path.resolve("/w", "a.ts")`: `/w/a.ts`, and on Windows `D:\w\a.ts` on the working directory's drive.
        let at = |path: &str| Location { path: paths::resolve_from("/w", path) };
        let locate = |name, input| locations(name, ToolInput::json(&input), "/w");
        let patch = "*** Begin Patch\n*** Update File: a.ts\n*** Move to: b.ts\n@@\n-x\n+y\n*** Add File: a.ts\n+z\n*** End Patch";
        assert_eq!(locate("apply_patch", json!({ "patchText": patch })), vec![at("a.ts"), at("b.ts")]);
        assert_eq!(locate("bash", json!({ "cwd": "sub" })), vec![at("sub")]);
        assert_eq!(locate("glob", json!({ "path": "/abs/../x" })), vec![Location { path: "/abs/../x".to_owned() }]);
        assert!(locate("webfetch", json!({ "url": "x" })).is_empty());
    }
}
