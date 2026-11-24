//! Permission requests and completed edit diffs for the ACP client.

mod unified;

use std::borrow::Cow;
use std::sync::Arc;

use opencode_api::client::Client;
use opencode_api::generated::{PermissionAskedData, PermissionReply, PermissionReplyInput};
use opencode_api::tool::{ExternalDirectoryInput, SearchInput, ToolInput, ToolKind, WebFetchInput, WebSearchInput};
use serde::Serialize;
use serde_json::{Value, json};

use crate::child;
use crate::client::{check, is_declared};
use crate::connection::Connection;
use crate::error::Failure;
use crate::tools::{DiffSource, absolute_path, locations, patch, patch_hunks, pending_tool_call, tool_kind};
use crate::translate::Tool;
use crate::update::{Diff, Kind, Location, Meta, ToolCall, ToolCallContent, Update};

pub struct Input {
    pub client: Client,
    pub connection: Connection,
    pub ask: PermissionAskedData,
    pub client_session_id: String,
    pub cwd: String,
    pub tool: Option<Tool>,
    pub child: Option<Arc<child::Session>>,
}

/// The tool call of a permission request.
#[derive(Serialize)]
struct Asked<'a> {
    #[serde(flatten)]
    call: ToolCall<'a>,
    #[serde(rename = "_meta", skip_serializing_if = "Meta::is_empty")]
    meta: Meta<'a>,
}

/// Asks the client and returns the decision: `once`, `always`, or `reject`.
pub async fn ask(input: &Input) -> Result<String, Failure> {
    let ask = &input.ask;
    let tool_name = input.tool.as_ref().map_or(ask.action.as_str(), |tool| tool.name.as_str());
    let tool_input = input
        .tool
        .as_ref()
        .map_or_else(|| Arc::new(ask.metadata.clone().unwrap_or_default()), |tool| tool.input.clone());
    let fields = ToolInput::map(&tool_input);
    let previews = permission_previews(tool_name, fields, ask.metadata.as_ref(), &input.cwd).await.unwrap_or_default();
    let tool_id = input.tool.as_ref().and(ask.source.as_ref()).map_or(ask.id.as_str(), |source| source.id.as_str());
    let tool_call_id = child::tool_call_id(input.child.as_deref(), tool_id);
    let title = permission_title(tool_name, fields, &previews)
        .filter(|title| !title.is_empty())
        .map(|title| child::prefix_title(input.child.as_deref(), &title))
        .or_else(|| input.child.as_ref().and_then(|child| child.title.clone()));
    let mut call = pending_tool_call(Cow::Owned(tool_call_id), tool_name, &tool_input, title.as_deref(), &input.cwd);
    if input.tool.is_none() {
        call.name = None;
        call.raw_input = None;
    }
    call.locations = permission_locations(tool_name, fields, input, &input.cwd);
    call.content = previews.into_iter().map(ToolCallContent::Diff).collect();
    let meta = Meta { child: input.child.clone(), ..Meta::default() };
    let result = input
        .connection
        .request(
            "session/request_permission",
            json!({
                "sessionId": input.client_session_id,
                "toolCall": Asked { call, meta },
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
        .permission_reply(&PermissionReplyInput {
            session_id: input.ask.session_id.clone(),
            request_id: input.ask.id.clone(),
            decision: match decision {
                "once" => PermissionReply::Once,
                "always" => PermissionReply::Always,
                _ => PermissionReply::Reject,
            },
            message: None,
        })
        .await;
    match result {
        Err(error) if is_declared(&error, "PermissionNotFoundError") => Ok(()),
        result => check(result),
    }
}

/// Adds full-file diffs to a completed edit's update.
pub async fn add_completed_diffs(update: &mut Update<'_>, source: Option<&DiffSource>, cwd: &str) {
    let Some(source) = source else { return };
    let Kind::ToolCallUpdate(call) = &mut update.kind else { return };
    // A script lists each change it made, some without a diff, and the same file more than once; rebuilding them from
    // the file on disk would show its final text for every change.
    let kind = tool_kind(&source.tool_name);
    if kind == ToolKind::Execute {
        return;
    }
    let hunks = if kind == ToolKind::Patch { patch_hunks(ToolInput::map(&source.input)) } else { Vec::new() };
    for file in decode_files(source.metadata.as_ref().and_then(|metadata| metadata.get("files"))) {
        if let Some(diff) = completed_diff(&file, &hunks, cwd).await {
            call.content.get_or_insert_default().push(ToolCallContent::Diff(diff));
        }
    }
}

async fn completed_diff(file: &FileDiff, hunks: &[patch::Hunk], cwd: &str) -> Option<Diff> {
    let path = absolute_path(&file.file, cwd);
    let new_text = if file.status == FileStatus::Deleted { String::new() } else { read_text(&path).await? };
    if file.status == FileStatus::Added {
        return Some(Diff { path, old_text: None, new_text });
    }
    let recorded = unified::parse_first(&file.patch)?;
    if let Some(old_text) = unified::apply(&new_text, &unified::reverse(&recorded)) {
        return Some(Diff { path, old_text: Some(old_text), new_text });
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
    (unified::structured_ranges(&rebuilt, &new_text) == unified::ranges(&recorded)).then_some(Diff {
        path,
        old_text: Some(rebuilt),
        new_text,
    })
}

// Core trims the patch tool's diffs for display, which breaks `applyPatch`, so its previews come from its own hunks.
// Any failure drops every preview, as the TS `Effect.forEach` does.
async fn permission_previews(
    tool_name: &str,
    input: ToolInput<'_>,
    metadata: Option<&crate::update::Input>,
    cwd: &str,
) -> Option<Vec<Diff>> {
    if tool_kind(tool_name) == ToolKind::Patch {
        return patch_previews(input, cwd).await;
    }
    let mut previews = Vec::new();
    for file in decode_files(metadata.and_then(|metadata| metadata.get("files"))) {
        let path = absolute_path(&file.file, cwd);
        let old_text = if file.status == FileStatus::Added { None } else { Some(read_text(&path).await?) };
        let files = unified::parse(&file.patch)?;
        // `applyPatch` throws on a patch of more than one file.
        let [hunks] = files.as_slice() else { return None };
        if let Some(new_text) = unified::apply(old_text.as_deref().unwrap_or_default(), hunks) {
            previews.push(Diff { path, old_text, new_text });
        }
    }
    Some(previews)
}

async fn patch_previews(input: ToolInput<'_>, cwd: &str) -> Option<Vec<Diff>> {
    let mut previews = Vec::new();
    for hunk in patch_hunks(input) {
        let path = absolute_path(hunk.path(), cwd);
        let preview = match hunk {
            patch::Hunk::Add { contents, .. } => {
                let new_text =
                    if contents.is_empty() || contents.ends_with('\n') { contents } else { format!("{contents}\n") };
                Diff { path, old_text: None, new_text }
            }
            patch::Hunk::Delete { .. } => {
                Diff { old_text: Some(read_text(&path).await?), path, new_text: String::new() }
            }
            patch::Hunk::Update { path: from, move_path, chunks } => {
                let old_text = read_text(&path).await?;
                let derived = patch::derive(&from, &chunks, &old_text).ok()?;
                let target = move_path.map_or(path, |target| absolute_path(&target, cwd));
                Diff { path: target, old_text: Some(old_text), new_text: derived }
            }
        };
        previews.push(preview);
    }
    Some(previews)
}

fn permission_title(tool_name: &str, fields: ToolInput, previews: &[Diff]) -> Option<String> {
    if previews.len() > 1 {
        return Some(format!("{} files", previews.len()));
    }
    let dir = ExternalDirectoryInput(fields);
    let text = match tool_kind(tool_name) {
        ToolKind::ExternalDirectory => dir.description().str().or(dir.command().str()).or(dir.parent_dir().str()),
        ToolKind::WebFetch => WebFetchInput(fields).url().str(),
        ToolKind::WebSearch => WebSearchInput(fields).query().str(),
        ToolKind::Grep | ToolKind::Glob => SearchInput(fields).pattern().str(),
        ToolKind::Read | ToolKind::Edit | ToolKind::Write | ToolKind::Patch => {
            fields.file_path().or(previews.first().map(|preview| preview.path.as_str()))
        }
        _ => None,
    };
    text.map(str::to_owned)
}

fn permission_locations(tool_name: &str, fields: ToolInput, input: &Input, cwd: &str) -> Vec<Location> {
    let found = locations(tool_name, fields, cwd);
    if !found.is_empty() || !matches!(input.ask.action.as_str(), "read" | "edit" | "external_directory") {
        return found;
    }
    let paths = input
        .ask
        .resources
        .iter()
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
struct FileDiff {
    file: String,
    patch: String,
    status: FileStatus,
}

#[derive(PartialEq)]
enum FileStatus {
    Added,
    Deleted,
    Modified,
}

/// `Schema.decodeUnknownOption(Schema.Array(FileDiff.Info))`, with an invalid value as no files.
fn decode_files(value: Option<&Value>) -> Vec<FileDiff> {
    let Some(items) = value.and_then(Value::as_array) else { return Vec::new() };
    items.iter().map(decode_file).collect::<Option<Vec<_>>>().unwrap_or_default()
}

fn decode_file(value: &Value) -> Option<FileDiff> {
    let count =
        |key: &str| value.get(key).and_then(Value::as_f64).is_some_and(|number| number >= 0.0 && number.fract() == 0.0);
    let status = match value.get("status")?.as_str()? {
        "added" => FileStatus::Added,
        "deleted" => FileStatus::Deleted,
        "modified" => FileStatus::Modified,
        _ => return None,
    };
    if !count("additions") || !count("deletions") || value.get("more").is_some_and(|more| more != &json!(true)) {
        return None;
    }
    Some(FileDiff {
        file: value.get("file")?.as_str()?.to_owned(),
        patch: value.get("patch")?.as_str()?.to_owned(),
        status,
    })
}
