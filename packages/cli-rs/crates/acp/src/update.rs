//! The updates of `session/update`, serialized straight to the connection's buffer, each field in its wire order.

use std::borrow::Cow;
use std::sync::Arc;

use indexmap::IndexMap;
use serde::{Serialize, Serializer};
use serde_json::Value;

use crate::child;
use crate::compaction::{CompactionUpdate, Marker};
use crate::translate::Retry;

/// A tool call's input or metadata: open data, in the order it arrived.
pub type Input = IndexMap<String, Value>;

#[derive(Debug, Clone, Serialize)]
pub struct Update<'a> {
    #[serde(flatten)]
    pub kind: Kind<'a>,
    #[serde(rename = "_meta", skip_serializing_if = "Meta::is_empty")]
    pub meta: Meta<'a>,
}

impl<'a> From<Kind<'a>> for Update<'a> {
    fn from(kind: Kind<'a>) -> Self {
        Self { kind, meta: Meta::default() }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "sessionUpdate", rename_all = "snake_case")]
pub enum Kind<'a> {
    AgentMessageChunk(Chunk<'a>),
    AgentThoughtChunk(Chunk<'a>),
    ToolCall(ToolCall<'a>),
    ToolCallUpdate(ToolCallUpdate<'a>),
    SessionInfoUpdate {},
    CompactionUpdate(CompactionUpdate<'a>),
    CompactionSummaryChunk {
        #[serde(rename = "compactionId")]
        compaction_id: String,
        content: Content<'a>,
    },
    /// A replayed update built as JSON, with its own `sessionUpdate`.
    #[serde(untagged)]
    Json(Value),
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct Meta<'a> {
    /// `Some(None)` clears the retry.
    #[serde(rename = "opencode/retry", skip_serializing_if = "Option::is_none")]
    pub retry: Option<Option<Retry>>,
    #[serde(rename = "opencode/compaction", skip_serializing_if = "Option::is_none")]
    pub compaction: Option<Marker<'a>>,
    #[serde(rename = "opencode/child-session", skip_serializing_if = "Option::is_none", serialize_with = "shared")]
    pub child: Option<Arc<child::Session>>,
}

impl Meta<'_> {
    pub fn is_empty(&self) -> bool {
        self.retry.is_none() && self.compaction.is_none() && self.child.is_none()
    }
}

fn shared<S: Serializer, T: Serialize>(value: &Option<Arc<T>>, serializer: S) -> Result<S::Ok, S::Error> {
    value.as_deref().serialize(serializer)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Chunk<'a> {
    pub message_id: Id<'a>,
    pub content: Content<'a>,
}

/// A chunk's message ID.
#[derive(Debug, Clone)]
pub enum Id<'a> {
    Message(&'a str),
    /// A reasoning part's chunks: `{message}:reasoning:{ordinal}`.
    Reasoning(&'a str, i64),
}

impl Serialize for Id<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Message(id) => serializer.serialize_str(id),
            Self::Reasoning(message, ordinal) => serializer.collect_str(&format_args!("{message}:reasoning:{ordinal}")),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Content<'a> {
    Text {
        text: Cow<'a, str>,
    },
    Image {
        #[serde(rename = "mimeType")]
        mime_type: &'a str,
        data: &'a str,
    },
}

/// A `tool_call`, or the tool call of a permission request.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCall<'a> {
    pub tool_call_id: Cow<'a, str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<&'a str>,
    pub title: String,
    pub kind: &'static str,
    pub status: &'static str,
    pub locations: Vec<Location>,
    #[serde(skip_serializing_if = "Option::is_none", serialize_with = "shared")]
    pub raw_input: Option<Arc<Input>>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub content: Vec<ToolCallContent<'a>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallUpdate<'a> {
    pub tool_call_id: Cow<'a, str>,
    pub status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub locations: Vec<Location>,
    #[serde(skip_serializing_if = "Option::is_none", serialize_with = "shared")]
    pub raw_input: Option<Arc<Input>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<Vec<ToolCallContent<'a>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_output: Option<RawOutput<'a>>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Location {
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct RawOutput<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Cow<'a, Input>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<&'a str>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ToolCallContent<'a> {
    Content { content: Content<'a> },
    Diff(Diff),
}

impl<'a> ToolCallContent<'a> {
    pub fn text(text: Cow<'a, str>) -> Self {
        Self::Content { content: Content::Text { text } }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diff {
    pub path: String,
    pub old_text: Option<String>,
    pub new_text: String,
}
