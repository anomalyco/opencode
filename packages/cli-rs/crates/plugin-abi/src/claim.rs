//! A renderer claim draws a tool call or fenced block as a keyed tree. The host shows its own row if the claim
//! declines or fails. If a keep refers to a missing subtree, the host asks once for a complete tree.
//!
//! Each part owns its mount, content handles and memo values. Its width comes from the transcript; its height
//! comes from its tree. Streaming revisions within one phase coalesce to the newest value per frame.

use std::rc::Rc;

use serde::{Deserialize, Serialize};

use crate::types::SessionMessageAssistantTool;
use crate::v2::{self, Node, PartRef, Source};

/// What a claim draws: one tool's calls, by the tool's name as the transcript has it or as the host names it
/// (`bash` and `shell` are one tool), or one fence language, as Markdown resolves a fence's info string. On the wire
/// `{"type": "tool", "name": "bash"}`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", content = "name", rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum Target {
    Tool(String),
    Fence(String),
}

/// A renderer claim as [`crate::Setup::claim`] registers it.
#[derive(Clone)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct Claim {
    pub target: Target,
    /// The view reads [`v2::SurfaceInput::palette`], so a theme change calls it again for each part it shows.
    pub palette: bool,
    pub view: ClaimFn,
}

/// A claim as [`crate::Manifest::claims`] lists it ([`Claim`] without its view); [`crate::Request::Claim`] names it by
/// its index there.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct Entry {
    pub target: Target,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub palette: bool,
}

impl From<&Claim> for Entry {
    fn from(claim: &Claim) -> Self {
        Self { target: claim.target.clone(), palette: claim.palette }
    }
}

/// What [`crate::Request::Claim`] returns: the view's tree, or `None` where it declines, the content it gave the host with
/// its handles, the handles it released, and how many values the mount's [`v2::Memo`] table holds after the view.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct Reply {
    #[serde(default)]
    pub node: Option<Node>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub content: Vec<(v2::ContentRef, crate::Blob)>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub released: Vec<v2::ContentRef>,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub memo: usize,
}

fn is_zero(value: &usize) -> bool {
    *value == 0
}

/// A claim's view: the tree that draws `part`, or `None` to leave the part to the host's own row.
pub type ClaimFn = Rc<dyn Fn(&mut v2::View<'_>, &Part) -> Option<Node>>;

impl Claim {
    /// A claim of the calls of tool `name`.
    pub fn tool(name: impl Into<String>, view: impl Fn(&mut v2::View<'_>, &Part) -> Option<Node> + 'static) -> Self {
        Self { target: Target::Tool(name.into()), palette: false, view: Rc::new(view) }
    }

    /// A claim of the Markdown fences of `language`.
    pub fn fence(
        language: impl Into<String>,
        view: impl Fn(&mut v2::View<'_>, &Part) -> Option<Node> + 'static,
    ) -> Self {
        Self { target: Target::Fence(language.into()), palette: false, view: Rc::new(view) }
    }

    /// The claim whose view reads the palette.
    pub fn palette(self) -> Self {
        Self { palette: true, ..self }
    }
}

/// A claimed part as it is now.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum Part {
    Tool(Box<ToolPart>),
    Fence(FencePart),
}

impl Part {
    /// The part's phase. Revisions within one phase stream; a revision that changes the phase is never held back.
    pub fn phase(&self) -> Phase {
        match self {
            Part::Tool(tool) => Phase::Tool(tool.state, tool.permission),
            Part::Fence(fence) => Phase::Fence { streaming: fence.streaming, closed: fence.closed },
        }
    }
}

/// What a part's revisions keep while it streams: a tool call's state and whether it waits for a permission, or a
/// fence's.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum Phase {
    Tool(State, bool),
    Fence { streaming: bool, closed: bool },
}

/// A tool call in an assistant message.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct ToolPart {
    pub session: String,
    pub message: String,
    pub state: State,
    /// The session's first permission request waits on this call.
    pub permission: bool,
    /// The call as the transcript has it, its name and its input (text while it streams), without what the call
    /// returned: [`Self::output`] names that, and the host reads it. Metadata of more than [`METADATA_BYTES`] bytes
    /// of JSON is left out too. A view that needs those bytes reads the session's messages.
    pub tool: SessionMessageAssistantTool,
}

/// The most bytes of JSON a call's metadata takes in a [`ToolPart`]; more is left out, so a request stays small
/// whatever the call streams into it.
pub const METADATA_BYTES: usize = 4096;

impl ToolPart {
    /// The call's output as the transcript shows it, which the host reads and the plugin never copies.
    pub fn output(&self) -> Source {
        Source::PartOutput(PartRef { session: self.session.clone(), part: self.tool.id.clone() })
    }
}

/// A tool call's state: its input streams (`Pending`), it runs and may stream its output in its metadata
/// (`Running`), or it ended.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum State {
    Pending,
    Running,
    Completed,
    Error,
}

/// A fenced code block in Markdown the transcript shows.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct FencePart {
    /// The language it was claimed for.
    pub language: String,
    /// The fence's info string, such as `rust,no_run`.
    pub info: String,
    pub code: String,
    /// The message still streams.
    pub streaming: bool,
    /// The closing fence has arrived.
    pub closed: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    // Expected: a part on the wire is tagged by its kind, and reads back equal.
    #[test]
    fn a_part_reads_back_as_it_was_written() {
        let fence = Part::Fence(FencePart {
            language: "rust".into(),
            info: "rust,no_run".into(),
            code: "fn main() {}".into(),
            streaming: true,
            closed: false,
        });
        let json = serde_json::to_string(&fence).unwrap();
        assert_eq!(
            json,
            r#"{"type":"fence","language":"rust","info":"rust,no_run","code":"fn main() {}","streaming":true,"closed":false}"#
        );
        assert_eq!(serde_json::from_str::<Part>(&json).unwrap(), fence);
        let tool: SessionMessageAssistantTool = serde_json::from_value(serde_json::json!({
            "type": "tool", "id": "call_1", "name": "bash",
            "state": { "status": "streaming", "input": "{\"comm" }, "time": { "created": 1 }
        }))
        .unwrap();
        let tool = Part::Tool(Box::new(ToolPart {
            session: "ses_1".into(),
            message: "msg_1".into(),
            state: State::Pending,
            permission: false,
            tool,
        }));
        let json = serde_json::to_string(&tool).unwrap();
        assert_eq!(serde_json::from_str::<Part>(&json).unwrap(), tool);
        assert_eq!(tool.phase(), Phase::Tool(State::Pending, false));
        let entry = Entry { target: Target::Fence("latex".into()), palette: false };
        assert_eq!(serde_json::to_string(&entry).unwrap(), r#"{"target":{"type":"fence","name":"latex"}}"#);
        let declined = Reply { node: None, content: Vec::new(), released: Vec::new(), memo: 0 };
        assert_eq!(serde_json::to_string(&declined).unwrap(), r#"{"node":null}"#);
        assert_eq!(serde_json::from_str::<Reply>("{}").unwrap(), declined);
    }
}
