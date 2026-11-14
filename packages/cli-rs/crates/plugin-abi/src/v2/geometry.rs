//! Phase P3 of contract 2.0 (synthesis 3.5, 4.2, 4.4): scroll behaviors as node data, scroll verbs, geometry reads,
//! the `layout` call after the solve, and the published `Viewport::Transcript`.
//!
//! - **Behaviors** are node data the host resolves after each solve, with no plugin call: [`Edge`] on a box pins it
//!   to its scroll's edge while its parent is in view (CSS sticky); [`Anchor`] makes a node one of a named group a
//!   [`Scroll::Step`] or [`Read::top_anchor`](crate::Read::top_anchor) walks; a [`super::Node::Diff`] with `hunks`
//!   publishes the first row of each hunk as anchor `{id}#{index}`.
//! - **Verbs** ([`Scroll`]) are effects of a handler: they apply when the call returns. [`Scroll::To`] resolves after
//!   the solve of the frame, against its final geometry, again in each round until it moves nothing; the others
//!   resolve at once, against the last settled frame. A [`Scroll::Step`] reports where it landed as
//!   [`ScrollEvent::Landed`] before the next event is routed.
//! - **Reads** ([`ScrollState`], [`AnchorAt`], [`TranscriptView`]) answer from the last settled frame and the current
//!   offset, so a handler after a wheel step reads what is on screen.
//! - **`layout`** ([`super::Surface::layout`]) runs after geometry is final, only in a frame where something the
//!   surface named ([`Notify`]) changed. It returns paint-time properties ([`Paint`]) or asks for a view again; it
//!   cannot move anything, so it never starts another solve.

use serde::{Deserialize, Serialize};

use crate::Color;

/// An edge of a scroll's viewport.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Edge {
    #[default]
    Top,
    Bottom,
}

/// A node of a named group of a scroll; `variant` is the plugin's, which reads and `layout` hand back.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Anchor {
    pub group: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub variant: String,
}

impl Anchor {
    pub fn new(group: impl Into<String>, variant: impl Into<String>) -> Self {
        Self { group: group.into(), variant: variant.into() }
    }
}

/// A row of a box whose first child the user resizes by dragging the column after it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Split {
    /// The first child's width in cells until the user drags it.
    pub at: u16,
    /// The least width each side keeps.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub min: u16,
}

/// How an image takes its node's room.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Fit {
    /// Inside the node, keeping the aspect ratio.
    #[default]
    Contain,
    /// Over the whole node, keeping the aspect ratio and cropping.
    Cover,
    /// Stretched to the node.
    Fill,
}

/// One item of a [`super::Node::List`]: its node, which must have an id, and the rows the host assumes it takes
/// until it has been laid out.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ListItem {
    pub node: super::Node,
    #[serde(default = "one", skip_serializing_if = "is_one")]
    pub estimate: u16,
}

impl ListItem {
    pub fn new(node: super::Node, estimate: u16) -> Self {
        Self { node, estimate }
    }
}

/// Where a node goes when [`Scroll::To`] brings it into view.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum ScrollAlign {
    /// Its top at the viewport's top.
    #[default]
    Start,
    /// Where it is on screen now, across the reflow the same call makes (CSS scroll anchoring).
    Keep,
    /// The least move that shows the whole node below `inset` rows (`scrollIntoView` with a `scroll-padding-top`).
    Nearest {
        #[serde(default, skip_serializing_if = "is_zero")]
        inset: u16,
    },
}

/// A scroll verb, an effect of a handler. The host clamps it to the content. [`Scroll::Offset`], [`Scroll::By`] and
/// [`Scroll::Page`] count the host's rows: in a [`super::Node::List`] those of an item without widgets are its
/// estimate until it is laid out. The others name content, and land on it.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum Scroll {
    /// Brings node `node` into view after the solve, again in each round until it moves nothing.
    To {
        node: String,
        #[serde(default)]
        align: ScrollAlign,
    },
    /// To row `offset` of the content.
    Offset { offset: i32 },
    /// By `rows`, down when positive.
    By { rows: i32 },
    /// By `percent` of the viewport, at least a row; down when positive.
    Page { percent: i16 },
    /// To an edge of the content.
    Edge { edge: Edge },
    /// To the anchor `by` steps away in `group`, `inset` rows below the top: from the anchor the last step landed on
    /// while the offset has not moved since, else from the first anchor below (or the last above) `top + inset`. A
    /// step that finds no anchor, or of 0, moves nothing and keeps that memory.
    Step {
        group: String,
        by: i32,
        #[serde(default, skip_serializing_if = "is_zero")]
        inset: u16,
    },
    /// Drops the scroll's pending [`Scroll::To`] and the memory of its last step: its content was replaced.
    Forget,
}

/// What a verb or a read names: a scroll of one of the plugin's surfaces, or a viewport the host publishes.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum Target {
    /// The scroll (or list) with id `id` in the plugin's live mount of surface `surface`.
    Node { surface: String, id: String },
    /// The session's transcript (`Viewport::Transcript`): it takes [`Scroll::By`], [`Scroll::Offset`] and
    /// [`Scroll::Edge`], from a handler only.
    Transcript,
}

impl Target {
    pub fn node(surface: impl Into<String>, id: impl Into<String>) -> Self {
        Target::Node { surface: surface.into(), id: id.into() }
    }
}

/// Where a scroll is, in rows: its offset, its viewport's height and its content's.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ScrollState {
    pub offset: i32,
    pub viewport: i32,
    pub extent: i32,
}

/// An anchor and its row in its scroll's content. `id` is the anchored node's, or `{diff}#{index}` for a hunk;
/// `owner` is the anchored node's id, or the diff's.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct AnchorAt {
    pub id: String,
    pub owner: String,
    #[serde(default, skip_serializing_if = "is_zero_u32")]
    pub index: u32,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub variant: String,
    pub row: i32,
}

/// What the host tells a surface about its scrolls, as a plugin call with effects (a handler).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum ScrollEvent {
    /// Where a [`Scroll::Step`] of scroll `scroll` landed, in the dispatch that asked for it.
    Landed { scroll: String, anchor: AnchorAt },
    /// The user moved scroll `scroll` (the wheel, or its keys), when the scroll asks with `user_scroll`.
    UserScroll { scroll: String },
}

/// What a surface asks its `layout` call to be told about. A scroll's `notify_top` adds its top anchor.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum Notify {
    /// The rect of node `id`.
    Node { id: String },
    /// The offset, viewport and content of scroll `id`.
    Scroll { id: String },
    /// The anchors of `group` in scroll `scroll`.
    Group { scroll: String, group: String },
    /// The published transcript.
    Transcript,
}

/// A rect in the surface's own cells.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

/// The top anchor of a group in a scroll: the last of the group, in content order, at or above the viewport's top.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Top {
    pub scroll: String,
    pub group: String,
    pub anchor: Option<AnchorAt>,
}

/// What a `layout` call gets: this frame's geometry, after the host's behaviors, for what the surface named.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Geometry {
    /// The rects of the nodes it named.
    pub rects: Vec<(String, Rect)>,
    /// The scrolls it named, and those with a `notify_top`.
    pub scrolls: Vec<(String, ScrollState)>,
    /// The anchors of the groups it named, in content order.
    pub groups: Vec<(String, String, Vec<AnchorAt>)>,
    /// The top anchor of each scroll's `notify_top` group.
    pub tops: Vec<Top>,
    /// Only offsets moved since the last call: every rect and extent is what it was.
    pub moved_only: bool,
    /// The offset each scroll's pending [`Scroll::To`] reached in this frame.
    pub reached: Vec<(String, i32)>,
    /// The published transcript, when it named it and the session route shows.
    pub transcript: Option<TranscriptView>,
}

impl Geometry {
    pub fn rect(&self, id: &str) -> Option<Rect> {
        self.rects.iter().find(|(named, _)| named == id).map(|(_, rect)| *rect)
    }

    pub fn scroll(&self, id: &str) -> Option<ScrollState> {
        self.scrolls.iter().find(|(named, _)| named == id).map(|(_, state)| *state)
    }

    /// The top anchor of `group` in `scroll`.
    pub fn top(&self, scroll: &str, group: &str) -> Option<&AnchorAt> {
        self.tops.iter().find(|top| top.scroll == scroll && top.group == group)?.anchor.as_ref()
    }
}

/// A paint-time property `layout` sets on node `node`: a box's background. It changes no size.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Paint {
    pub node: String,
    pub bg: Color,
}

/// What a `layout` call returns.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct LayoutReply {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub paints: Vec<Paint>,
    /// Calls the view again in this frame, then the solve and `layout` once more; at most twice a frame.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub again: bool,
}

impl LayoutReply {
    pub fn paint(mut self, node: impl Into<String>, bg: impl Into<Color>) -> Self {
        self.paints.push(Paint { node: node.into(), bg: bg.into() });
        self
    }
}

/// `Viewport::Transcript`: the session transcript's scroll, as the host publishes it. It covers the mounted window,
/// the tail of the session the transcript has revealed; `above` counts the messages before it.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct TranscriptView {
    pub offset: i32,
    pub viewport: i32,
    pub extent: i32,
    /// New each time the mounted rows change.
    pub revision: u64,
    pub above: u32,
    pub rows: Vec<TranscriptRow>,
}

/// A mounted row of the transcript: its kind (`user`, `assistant`, `tool`, ...), its message, and where it is.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct TranscriptRow {
    pub kind: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub part: Option<String>,
    pub row: i32,
    pub height: i32,
}

/// A surface's `layout` call.
pub type LayoutFn = std::rc::Rc<dyn Fn(&Geometry) -> LayoutReply>;

fn is_zero(value: &u16) -> bool {
    *value == 0
}

fn is_zero_u32(value: &u32) -> bool {
    *value == 0
}

fn one() -> u16 {
    1
}

fn is_one(value: &u16) -> bool {
    *value == 1
}
