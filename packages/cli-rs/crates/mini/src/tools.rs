//! Tool rendering in the scrollback (`tool.ts`, `stream-v2.subagent.ts`): M.4.
//!
//! M.1 leaves the signatures the writer and the transcript call. Until M.4, tool parts print nothing, which is
//! what `mini.tools = "hide"`, the default, shows.

use opencode_api::generated::SessionMessageAssistantTool;
use opentui::prelude::*;
use serde_json::Value;

use crate::scrollback::{Body, BodyOptions, Commit};
use crate::theme::RunTheme;

/// A structured tool body (`ToolSnapshot`).
#[derive(Clone, Debug, PartialEq)]
pub enum Snapshot {
    Code { title: String, content: String, file: Option<String> },
    Diff { items: Vec<DiffItem> },
    Task { title: String, rows: Vec<String>, tail: String },
    Todo { items: Vec<Value> },
    Question { items: Vec<(String, String)>, tail: String },
}

#[derive(Clone, Debug, PartialEq)]
pub struct DiffItem {
    pub title: String,
    pub diff: String,
    pub file: Option<String>,
    pub deletions: Option<u64>,
}

/// The commits of one tool part of a listed assistant message (`renderTool`, `toolCommit`).
pub fn commits(_message_id: &str, _part: &SessionMessageAssistantTool) -> Vec<Commit> {
    Vec::new()
}

/// `toolEntryBody`: what a tool commit draws.
pub fn entry_body(_commit: &Commit, _raw: &str, _options: BodyOptions) -> Option<Body> {
    None
}

/// `toolStructuredFinal`: whether a final tool commit draws a structured body, which groups on its own.
pub fn structured_final(_commit: &Commit) -> bool {
    false
}

/// The widget of a structured body (`RunEntryContent`'s snapshot cases).
pub fn structured_widget(app: &App, _snapshot: &Snapshot, _theme: &RunTheme, _mono: bool) -> AnyWidget {
    Text::new(app, "").as_any()
}
