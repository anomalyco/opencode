//! Permission asks as `session/request_permission`, and completed edits as diffs
//! (`packages/cli/src/acp/permission.ts`).

mod unified;

use opencode_api::client::{Client, RequestOptions};
use opencode_api::generated::{PermissionID, PermissionReply, PermissionReplyInput, SessionID};
use serde_json::{Value, json};

use crate::child;
use crate::client::{check, is_declared};
use crate::connection::Connection;
use crate::error::Failure;
use crate::tools::{
    DiffSource, absolute_path, canonical_name, file_path, locations, patch, patch_hunks, pending_tool_call, text,
};
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

/// A `diff` tool call content item.
#[derive(Debug, Clone, PartialEq)]
struct Diff {
    path: String,
    old_text: Option<String>,
    new_text: String,
}

impl Diff {
    fn new(path: String, old_text: Option<String>, new_text: String) -> Self {
        Self { path, old_text, new_text }
    }

    fn json(&self) -> Value {
        json!({ "type": "diff", "path": self.path, "oldText": self.old_text, "newText": self.new_text })
    }
}

/// Asks the client and returns the decision: `once`, `always`, or `reject`.
pub async fn ask(input: &Input) -> Result<String, Failure> {
    let tool_name = input.tool.as_ref().map_or_else(
        || input.data("action").and_then(Value::as_str).unwrap_or_default().to_owned(),
        |tool| tool.name.clone(),
    );
    let tool_input = input
        .tool
        .as_ref()
        .map(|tool| tool.input.clone())
        .or_else(|| input.data("metadata").cloned())
        .unwrap_or_else(|| json!({}));
    let previews =
        permission_previews(&tool_name, &tool_input, input.data("metadata"), &input.cwd).await.unwrap_or_default();
    let request_id = input.data("id").and_then(Value::as_str).unwrap_or_default();
    let tool_call_id =
        child::tool_call_id(input.child.as_ref(), input.tool.as_ref().map_or(request_id, |tool| tool.id.as_str()));
    let title = permission_title(&tool_name, &tool_input, &previews)
        .filter(|title| !title.is_empty())
        .map(|title| child::prefix_title(input.child.as_ref(), &title))
        .or_else(|| input.child.as_ref().and_then(|child| child.title.clone()));
    let mut tool_call = pending_tool_call(&tool_call_id, &tool_name, &tool_input, title.as_deref(), &input.cwd);
    if let Some(object) = tool_call.as_object_mut() {
        if input.tool.is_none() {
            object.shift_remove("name");
            object.shift_remove("rawInput");
        }
        object.insert("locations".to_owned(), json!(permission_locations(&tool_name, &tool_input, input, &input.cwd)));
        if !previews.is_empty() {
            object.insert("content".to_owned(), json!(previews.iter().map(Diff::json).collect::<Vec<_>>()));
        }
        if let Some(child) = &input.child {
            object.insert("_meta".to_owned(), child::meta(child));
        }
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
    let selected = (outcome.and_then(|outcome| outcome.get("outcome")).and_then(Value::as_str) == Some("selected"))
        .then(|| outcome.and_then(|outcome| outcome.get("optionId")).and_then(Value::as_str))
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
                request_id: PermissionID(input.data("id").and_then(Value::as_str).unwrap_or_default().to_owned()),
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
pub async fn with_completed_diffs(update: Value, source: Option<&DiffSource>, cwd: &str) -> Value {
    let Some(source) = source else { return update };
    if update.get("sessionUpdate").and_then(Value::as_str) != Some("tool_call_update") {
        return update;
    }
    let hunks = if canonical_name(&source.tool_name) == "patch" { patch_hunks(&source.input) } else { Vec::new() };
    let mut diffs = Vec::new();
    for file in decode_files(source.metadata.as_ref().and_then(|metadata| metadata.get("files"))) {
        diffs.extend(completed_diff(&file, &hunks, cwd).await);
    }
    if diffs.is_empty() {
        return update;
    }
    let mut update = update;
    let mut content = update.get("content").and_then(Value::as_array).cloned().unwrap_or_default();
    content.extend(diffs.iter().map(Diff::json));
    update["content"] = Value::Array(content);
    update
}

async fn completed_diff(file: &FileDiff, hunks: &[patch::Hunk], cwd: &str) -> Option<Diff> {
    let path = absolute_path(&file.file, cwd);
    let new_text = match file.status.as_str() {
        "deleted" => String::new(),
        _ => read_text(&path).await?,
    };
    if file.status == "added" {
        return Some(Diff::new(path, None, new_text));
    }
    let recorded = unified::parse_first(&file.patch)?;
    if let Some(old_text) = unified::apply(&new_text, &unified::reverse(&recorded)) {
        return Some(Diff::new(path, Some(old_text), new_text));
    }
    // Core trims indentation from patch-tool diffs, so rebuild those from its hunks and keep them if the ranges agree.
    let chunks = hunks.iter().find_map(|hunk| match hunk {
        patch::Hunk::Update { path: from, move_path, chunks }
            if absolute_path(move_path.as_deref().unwrap_or(from), cwd) == path =>
        {
            Some((from, chunks))
        }
        _ => None,
    });
    let (from, chunks) = chunks?;
    if chunks.iter().any(|chunk| chunk.old_lines.is_empty() || chunk.new_lines.is_empty()) {
        return None;
    }
    let reversed: Vec<patch::Chunk> = chunks
        .iter()
        .map(|chunk| patch::Chunk {
            old_lines: chunk.new_lines.clone(),
            new_lines: chunk.old_lines.clone(),
            ..chunk.clone()
        })
        .collect();
    let rebuilt = patch::derive(from, &reversed, &new_text).ok()?;
    (unified::structured_ranges(&rebuilt, &new_text) == unified::ranges(&recorded))
        .then(|| Diff::new(path, Some(rebuilt), new_text))
}

// Core trims the patch tool's diffs for display, which breaks `applyPatch`, so its previews come from its own hunks.
// Any failure drops every preview, as the TS `Effect.forEach` does.
async fn permission_previews(tool_name: &str, input: &Value, metadata: Option<&Value>, cwd: &str) -> Option<Vec<Diff>> {
    if canonical_name(tool_name) == "patch" {
        return patch_previews(input, cwd).await;
    }
    let mut previews = Vec::new();
    for file in decode_files(metadata.and_then(|metadata| metadata.get("files"))) {
        let path = absolute_path(&file.file, cwd);
        let old_text = match file.status.as_str() {
            "added" => None,
            _ => Some(read_text(&path).await?),
        };
        let files = unified::parse(&file.patch)?;
        // `applyPatch` throws on a patch of more than one file.
        let [hunks] = files.as_slice() else {
            return None;
        };
        if let Some(new_text) = unified::apply(old_text.as_deref().unwrap_or_default(), hunks) {
            previews.push(Diff::new(path, old_text, new_text));
        }
    }
    Some(previews)
}

async fn patch_previews(input: &Value, cwd: &str) -> Option<Vec<Diff>> {
    let mut previews = Vec::new();
    for hunk in patch_hunks(input) {
        let path = absolute_path(hunk.path(), cwd);
        let preview = match hunk {
            patch::Hunk::Add { contents, .. } => {
                let new_text =
                    if contents.is_empty() || contents.ends_with('\n') { contents } else { format!("{contents}\n") };
                Diff::new(path, None, new_text)
            }
            patch::Hunk::Delete { .. } => Diff::new(path.clone(), Some(read_text(&path).await?), String::new()),
            patch::Hunk::Update { path: from, move_path, chunks } => {
                let old_text = read_text(&path).await?;
                let derived = patch::derive(&from, &chunks, &old_text).ok()?;
                let target = move_path.map_or(path, |target| absolute_path(&target, cwd));
                Diff::new(target, Some(old_text), derived)
            }
        };
        previews.push(preview);
    }
    Some(previews)
}

fn permission_title(tool_name: &str, input: &Value, previews: &[Diff]) -> Option<String> {
    if previews.len() > 1 {
        return Some(format!("{} files", previews.len()));
    }
    match canonical_name(tool_name).as_str() {
        "external_directory" => {
            text(input, "description").or_else(|| text(input, "command")).or_else(|| text(input, "parentDir"))
        }
        "webfetch" => text(input, "url"),
        "websearch" => text(input, "query"),
        "grep" | "glob" => text(input, "pattern"),
        "read" | "edit" | "write" | "patch" => {
            file_path(input).or_else(|| previews.first().map(|preview| preview.path.clone()))
        }
        _ => None,
    }
}

fn permission_locations(tool_name: &str, tool_input: &Value, input: &Input, cwd: &str) -> Vec<Value> {
    let found = locations(tool_name, tool_input, cwd);
    let action = input.data("action").and_then(Value::as_str);
    if !found.is_empty() || !matches!(action, Some("read" | "edit" | "external_directory")) {
        return found;
    }
    let paths = input
        .data("resources")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(|resource| resource.strip_suffix("/*").unwrap_or(resource))
        .filter(|path| !path.is_empty() && !path.contains(['*', '?']))
        .map(|path| Some(absolute_path(path, cwd)));
    crate::tools::location_from(cwd, paths)
}

/// `Bun.file(path).text()`: UTF-8 with replacement characters and without a leading BOM.
async fn read_text(path: &str) -> Option<String> {
    let bytes = tokio::fs::read(path).await.ok()?;
    let text = String::from_utf8_lossy(&bytes);
    Some(text.strip_prefix('\u{feff}').unwrap_or(&text).to_owned())
}

/// One `FileDiff.Info`.
#[derive(Debug, Clone, PartialEq)]
struct FileDiff {
    file: String,
    patch: String,
    status: String,
}

/// `Schema.decodeUnknownOption(Schema.Array(FileDiff.Info))`, with an invalid value as no files.
fn decode_files(value: Option<&Value>) -> Vec<FileDiff> {
    let Some(items) = value.and_then(Value::as_array) else {
        return Vec::new();
    };
    items.iter().map(decode_file).collect::<Option<Vec<_>>>().unwrap_or_default()
}

fn decode_file(value: &Value) -> Option<FileDiff> {
    let count =
        |key: &str| value.get(key).and_then(Value::as_f64).is_some_and(|number| number >= 0.0 && number.fract() == 0.0);
    let status = value.get("status")?.as_str()?;
    let more = value.get("more");
    if !count("additions")
        || !count("deletions")
        || !matches!(status, "added" | "deleted" | "modified")
        || more.is_some_and(|more| more != &json!(true))
    {
        return None;
    }
    Some(FileDiff {
        file: value.get("file")?.as_str()?.to_owned(),
        patch: value.get("patch")?.as_str()?.to_owned(),
        status: status.to_owned(),
    })
}
