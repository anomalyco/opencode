use std::borrow::Cow;
use std::sync::Arc;

use serde::ser::SerializeMap;
use serde::{Serialize, Serializer};

use crate::update::{self, Kind};

pub const UPDATE_METHOD: &str = "opencode/session/child_update";
pub const META_KEY: &str = "opencode/child-session";

/// A child session; it serializes as its `opencode/child-session` meta.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Session {
    pub id: String,
    #[serde(rename = "parentID")]
    pub parent_id: String,
    pub depth: u64,
    #[serde(skip_serializing_if = "untitled")]
    pub title: Option<String>,
    /// The inbox item of the prompt turn that started the family, if a prompt turn did.
    #[serde(skip)]
    pub turn_id: Option<String>,
}

impl Session {
    /// The title when it is set and non-empty, as JS truthiness reads it.
    fn title(&self) -> Option<&str> {
        self.title.as_deref().filter(|title| !title.is_empty())
    }
}

fn untitled(title: &Option<String>) -> bool {
    title.as_deref().is_none_or(str::is_empty)
}

/// The `opencode/session/child_update` params.
#[derive(Debug, Clone)]
pub struct Update<'a> {
    pub root_session_id: &'a str,
    pub child: Arc<Session>,
    pub event: Event<'a>,
}

#[derive(Debug, Clone)]
#[allow(clippy::large_enum_variant, reason = "built and written at once, never stored")]
pub enum Event<'a> {
    Status(&'static str, Option<&'a serde_json::Value>),
    Update(update::Update<'a>),
}

impl Serialize for Update<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(None)?;
        map.serialize_entry("rootSessionId", self.root_session_id)?;
        map.serialize_entry("childSessionId", &self.child.id)?;
        map.serialize_entry("parentSessionId", &self.child.parent_id)?;
        map.serialize_entry("depth", &self.child.depth)?;
        if let Some(title) = self.child.title() {
            map.serialize_entry("title", title)?;
        }
        match &self.event {
            Event::Status(status, error) => {
                map.serialize_entry("type", "status")?;
                map.serialize_entry("status", status)?;
                if let Some(error) = error {
                    map.serialize_entry("error", error)?;
                }
            }
            Event::Update(update) => {
                map.serialize_entry("type", "update")?;
                map.serialize_entry("update", update)?;
            }
        }
        map.end()
    }
}

/// A child's update as the parent session shows it: child metadata, and tool IDs and titles prefixed.
pub fn project(update: &mut update::Update, child: &Arc<Session>) {
    update.meta.child = Some(child.clone());
    let (id, title) = match &mut update.kind {
        Kind::ToolCall(call) => (&mut call.tool_call_id, Some(&mut call.title)),
        Kind::ToolCallUpdate(call) => (&mut call.tool_call_id, call.title.as_mut()),
        _ => return,
    };
    *id = Cow::Owned(tool_call_id(Some(&**child), id));
    if let Some(title) = title.filter(|title| !title.is_empty()) {
        *title = prefix_title(Some(&**child), title);
    }
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
