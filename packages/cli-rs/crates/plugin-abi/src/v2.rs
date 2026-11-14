//! Contract 2.0 of the rich-plugin design (`rich-plugins/synthesis.md` 4.1 to 4.6), as phase P1 builds it: a keyed
//! tree of host-owned widgets per surface, which the host reconciles by key ([`Node`], [`Node::Keep`]), mounts with
//! generations ([`MountId`]), content by handle ([`Source`]), a host-scrolled [`Node::Scroll`], and the palette in a
//! surface's input ([`SurfaceInput`]).
//!
//! P1 runs it on the linked path only: a built-in registers a surface with [`crate::Setup::surface`] and the host
//! calls its view with Rust values. The C ABI of 2.0 is P4's; until then a surface of an external plugin is never
//! mounted. The leaf types (colors, spans, layout, clicks) are those of ABI 1.x.
//!
//! The schema of these types is generated from them (`cargo run -p opencode-plugin-abi --features schema --example
//! schema`) into `crates/plugin-abi/schema/v2.json`.

use std::any::Any;
use std::collections::{BTreeMap, HashMap};
use std::rc::Rc;

use serde::{Deserialize, Serialize};

use crate::{Align, Border, Click, Color, Edges, Justify, Layout, Overflow, Read, Rgba, Span, ThemeMode, Wrap};

/// What a surface draws: a node of a keyed tree. A node may carry an `id`, unique in its mount; the host keeps the
/// widget of a node whose id and kind stay, and writes only what changed. Without an id a node is matched by its kind
/// and place among the siblings without one.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum Node {
    /// A box that lays out its children in a column, or in a row.
    Box {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        id: Option<String>,
        #[serde(default, skip_serializing_if = "is_false")]
        row: bool,
        #[serde(default, skip_serializing_if = "is_zero")]
        gap: u16,
        /// Left and right, then top and bottom.
        #[serde(default, skip_serializing_if = "is_no_padding")]
        padding: (u16, u16),
        #[serde(default, skip_serializing_if = "is_start")]
        justify: Justify,
        #[serde(default, skip_serializing_if = "is_stretch")]
        align: Align,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        bg: Option<Color>,
        #[serde(default, skip_serializing_if = "is_default_layout")]
        layout: Layout,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        on_click: Option<Click>,
        #[serde(default)]
        children: Vec<Node>,
        /// A border on the box's edge, inside its size and outside its padding.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        border: Option<std::boxed::Box<Border>>,
        /// Cells inside each edge, instead of `padding`. A negative side counts as 0.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        padding_sides: Option<Edges>,
        /// Children that do not fit go on to another row or column.
        #[serde(default, skip_serializing_if = "is_false")]
        wrap: bool,
        /// Whether what does not fit in the box draws outside it.
        #[serde(default, skip_serializing_if = "is_visible")]
        overflow: Overflow,
    },
    /// Styled text; `fg` draws spans without their own, by default `text.base`.
    Text {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        id: Option<String>,
        spans: Vec<Span>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        fg: Option<Color>,
        #[serde(default, skip_serializing_if = "is_word")]
        wrap: Wrap,
        #[serde(default, skip_serializing_if = "is_false")]
        truncate: bool,
        #[serde(default = "yes", skip_serializing_if = "is_true")]
        selectable: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        hover_fg: Option<Color>,
        #[serde(default, skip_serializing_if = "is_default_layout")]
        layout: Layout,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        on_click: Option<Click>,
    },
    /// The claims of a published slot inside the surface's own, in place.
    Slot { path: String },
    /// Markdown, drawn as the host draws a message.
    Markdown {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        id: Option<String>,
        source: Source,
    },
    /// A spinner with `label`, in the host's spinner color.
    Spinner {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        id: Option<String>,
        label: String,
    },
    /// A box the host scrolls: the wheel, and its own keys while it has focus. Its offset is the host's and stays
    /// across revisions while its id does. `height` in cells; without one it takes its layout's room, and with
    /// [`Layout::grow`] the room its siblings leave, never more than its parent has.
    Scroll {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        height: Option<u16>,
        /// Stays at the bottom while it is there, as content grows.
        #[serde(default, skip_serializing_if = "is_false")]
        follow: bool,
        #[serde(default, skip_serializing_if = "is_default_layout")]
        layout: Layout,
        #[serde(default)]
        children: Vec<Node>,
    },
    /// A patch in the host's diff view: its own highlighting, colors and line numbers.
    Diff {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        id: Option<String>,
        content: Source,
        #[serde(default, skip_serializing_if = "is_unified")]
        view: DiffView,
        /// The language to highlight as, such as `rust`.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        filetype: Option<String>,
    },
    /// The subtree last adopted under id `key` in this mount, unchanged ([`View::memo`]). A key the host does not
    /// hold in the last accepted tree is a contract error: the host refuses the tree whole.
    Keep { key: String },
}

/// What a text-bearing node shows: text inline, content sent once ([`View::content`]), or a transcript part's own
/// output, which never crosses to the plugin.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "kebab-case")]
pub enum Source {
    Text(String),
    Content(ContentRef),
    PartOutput(PartRef),
}

/// A handle to bytes the plugin gave the host once, in this mount.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
pub struct ContentRef(pub u64);

/// A part of a session's transcript by its id: a tool call, whose output it names.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
pub struct PartRef {
    pub session: String,
    /// The call's id, as the transcript has it (`call_…`).
    pub part: String,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "kebab-case")]
pub enum DiffView {
    #[default]
    Unified,
    Split,
}

/// What a surface's view gets besides the plugin's own state.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
pub struct SurfaceInput {
    /// The surface's own size in cells.
    pub width: u16,
    pub height: u16,
    /// The page theme's colors, for a plugin that computes its own. A node that names a token is restyled by the host
    /// with no call; a surface that reads the palette ([`Surface::palette`]) gets a view call on a theme change.
    pub palette: Palette,
    /// The host refused the last tree, or holds none: [`Node::Keep`] has nothing to name. [`View::memo`] builds.
    #[serde(default, skip_serializing_if = "is_false")]
    pub full: bool,
}

/// Every token of the page theme, by its path (`text.muted`, `background.panel`).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
pub struct Palette {
    pub mode: Mode,
    pub colors: BTreeMap<String, Rgba>,
}

impl Palette {
    pub fn get(&self, token: &str) -> Option<Rgba> {
        self.colors.get(token).copied()
    }
}

/// [`ThemeMode`] on the wire.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "kebab-case")]
pub enum Mode {
    #[default]
    Dark,
    Light,
}

impl From<ThemeMode> for Mode {
    fn from(mode: ThemeMode) -> Self {
        match mode {
            ThemeMode::Dark => Mode::Dark,
            ThemeMode::Light => Mode::Light,
        }
    }
}

/// One showing of one surface: the plugin's surface, the key it chose, and a generation that is new every time. A
/// surface closed and opened again has the same key and a new generation; what the first showing owned ends with it.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
pub struct MountId {
    pub surface: String,
    pub key: String,
    pub generation: u64,
}

/// Where a surface shows in P1: a route of the plugin, or a slot claim.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Place {
    Route(String),
    Slot(crate::Placement),
}

/// A surface as [`crate::Setup::surface`] registers it.
#[derive(Clone)]
pub struct Surface {
    pub name: String,
    pub place: Place,
    /// The view reads [`SurfaceInput::palette`], so a theme change calls it again.
    pub palette: bool,
    pub view: ViewFn,
}

impl Surface {
    pub fn new(name: impl Into<String>, place: Place, view: impl Fn(&mut View<'_>) -> Node + 'static) -> Self {
        Self { name: name.into(), place, palette: false, view: Rc::new(view) }
    }

    /// The surface whose view reads the palette.
    pub fn palette(self) -> Self {
        Self { palette: true, ..self }
    }
}

/// A registered surface view.
pub type ViewFn = Rc<dyn Fn(&mut View<'_>) -> Node>;

/// What a surface's view gets: the host's reads, the surface's input and mount, and the mount's [`Memo`] table.
pub struct View<'a> {
    pub read: &'a dyn Read,
    pub input: &'a SurfaceInput,
    pub mount: &'a MountId,
    memo: &'a mut Memo,
    content: &'a mut dyn FnMut(Vec<u8>) -> ContentRef,
}

impl<'a> View<'a> {
    #[doc(hidden)]
    pub fn new(
        read: &'a dyn Read,
        input: &'a SurfaceInput,
        mount: &'a MountId,
        memo: &'a mut Memo,
        content: &'a mut dyn FnMut(Vec<u8>) -> ContentRef,
    ) -> Self {
        if input.full {
            memo.entries.clear();
        }
        memo.used.clear();
        Self { read, input, mount, memo, content }
    }

    /// Gives the host `bytes` once; a [`Source::Content`] of the handle shows them. The handle lives while a tree of
    /// this mount names it.
    pub fn content(&mut self, bytes: impl Into<Vec<u8>>) -> ContentRef {
        (self.content)(bytes.into())
    }

    /// The subtree `build` makes, with id `key`; or, when `value` equals the one it was last built from in this
    /// mount, [`Node::Keep`] of `key`, and `build` does not run (Elm's `lazy`). The host then neither compares nor
    /// touches that subtree.
    pub fn memo<V: PartialEq + 'static>(
        &mut self,
        key: impl Into<String>,
        value: V,
        build: impl FnOnce(&mut Self) -> Node,
    ) -> Node {
        let key = key.into();
        let same =
            self.memo.entries.get(&key).and_then(|last| last.downcast_ref::<V>()).is_some_and(|last| *last == value);
        if !self.memo.used.insert(key.clone()) {
            // A second memo of one key in one view: the first named the subtree, so this one builds.
            return build(self);
        }
        if same {
            return Node::Keep { key };
        }
        let node = build(self).with_id(key.clone());
        self.memo.entries.insert(key, Box::new(value));
        node
    }
}

/// The SDK's table of [`View::memo`] values, one per mount, empty in a new one. After a view only the keys it used
/// stay, so a [`Node::Keep`] always names a subtree of the tree the view before returned.
#[derive(Default)]
pub struct Memo {
    entries: HashMap<String, Box<dyn Any>>,
    used: std::collections::HashSet<String>,
}

impl Memo {
    /// Drops what the last view did not use. The host calls it once a view returned.
    pub fn finish(&mut self) {
        let used = &self.used;
        self.entries.retain(|key, _| used.contains(key));
    }

    /// Forgets every value: the host refused the tree, so the next view builds whole.
    pub fn clear(&mut self) {
        self.entries.clear();
        self.used.clear();
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

impl Node {
    /// A box of `children` in a column.
    pub fn column(children: Vec<Node>) -> Self {
        Node::Box {
            id: None,
            row: false,
            gap: 0,
            padding: (0, 0),
            justify: Justify::Start,
            align: Align::Stretch,
            bg: None,
            layout: Layout::default(),
            on_click: None,
            children,
            border: None,
            padding_sides: None,
            wrap: false,
            overflow: Overflow::Visible,
        }
    }

    /// A box of `children` in a row.
    pub fn row(children: Vec<Node>) -> Self {
        let mut node = Self::column(children);
        if let Node::Box { row, .. } = &mut node {
            *row = true;
        }
        node
    }

    /// Selectable text of `spans` that wraps at words.
    pub fn text(spans: impl Into<Vec<Span>>) -> Self {
        Node::Text {
            id: None,
            spans: spans.into(),
            fg: None,
            wrap: Wrap::Word,
            truncate: false,
            selectable: true,
            hover_fg: None,
            layout: Layout::default(),
            on_click: None,
        }
    }

    /// A scroll box of `children`.
    pub fn scroll(children: Vec<Node>) -> Self {
        Node::Scroll { id: None, height: None, follow: false, layout: Layout::default(), children }
    }

    /// The node with id `key`; a slot and a keep are unchanged.
    pub fn with_id(mut self, key: impl Into<String>) -> Self {
        if let Some(id) = self.id_mut() {
            *id = Some(key.into());
        }
        self
    }

    /// The node's id, or the key a [`Node::Keep`] names.
    pub fn id(&self) -> Option<&str> {
        match self {
            Node::Box { id, .. }
            | Node::Text { id, .. }
            | Node::Markdown { id, .. }
            | Node::Spinner { id, .. }
            | Node::Scroll { id, .. }
            | Node::Diff { id, .. } => id.as_deref(),
            Node::Keep { key } => Some(key),
            Node::Slot { .. } => None,
        }
    }

    fn id_mut(&mut self) -> Option<&mut Option<String>> {
        match self {
            Node::Box { id, .. }
            | Node::Text { id, .. }
            | Node::Markdown { id, .. }
            | Node::Spinner { id, .. }
            | Node::Scroll { id, .. }
            | Node::Diff { id, .. } => Some(id),
            Node::Keep { .. } | Node::Slot { .. } => None,
        }
    }

    /// The children of a box or a scroll.
    pub fn children(&self) -> &[Node] {
        match self {
            Node::Box { children, .. } | Node::Scroll { children, .. } => children,
            _ => &[],
        }
    }

    /// The node with `layout`; only a box, a text and a scroll have one.
    pub fn layout(mut self, value: Layout) -> Self {
        if let Node::Box { layout, .. } | Node::Text { layout, .. } | Node::Scroll { layout, .. } = &mut self {
            *layout = value;
        }
        self
    }

    /// A box on `color`; anything else is unchanged.
    pub fn bg(mut self, color: impl Into<Color>) -> Self {
        if let Node::Box { bg, .. } = &mut self {
            *bg = Some(color.into());
        }
        self
    }

    /// Text in `color` where its spans have none; anything else is unchanged.
    pub fn fg(mut self, color: impl Into<Color>) -> Self {
        if let Node::Text { fg, .. } = &mut self {
            *fg = Some(color.into());
        }
        self
    }

    /// The node with `click`; only a box and a text take one.
    pub fn on_click(mut self, click: Click) -> Self {
        if let Node::Box { on_click, .. } | Node::Text { on_click, .. } = &mut self {
            *on_click = Some(click);
        }
        self
    }
}

impl From<crate::Node> for Node {
    /// A node of ABI 1.x, which has no ids.
    fn from(node: crate::Node) -> Self {
        match node {
            crate::Node::Box {
                row,
                gap,
                padding,
                justify,
                align,
                bg,
                layout,
                on_click,
                children,
                border,
                padding_sides,
                wrap,
                overflow,
            } => Node::Box {
                id: None,
                row,
                gap,
                padding,
                justify,
                align,
                bg,
                layout,
                on_click,
                children: children.into_iter().map(Node::from).collect(),
                border,
                padding_sides,
                wrap,
                overflow,
            },
            crate::Node::Text { spans, fg, wrap, truncate, selectable, hover_fg, layout, on_click } => {
                Node::Text { id: None, spans, fg, wrap, truncate, selectable, hover_fg, layout, on_click }
            }
            crate::Node::Slot { path } => Node::Slot { path },
            crate::Node::Markdown { text } => Node::Markdown { id: None, source: Source::Text(text) },
            crate::Node::Spinner { label } => Node::Spinner { id: None, label },
        }
    }
}

/// [`Rgba`] is `#rrggbbaa` on the wire.
#[cfg(feature = "schema")]
impl schemars::JsonSchema for Rgba {
    fn schema_name() -> std::borrow::Cow<'static, str> {
        "Rgba".into()
    }

    fn json_schema(_: &mut schemars::SchemaGenerator) -> schemars::Schema {
        schemars::json_schema!({ "type": "string", "pattern": "^#[0-9a-f]{8}$" })
    }
}

/// The JSON Schema of contract 2.0: every type a surface sends or gets, under `$defs`.
#[cfg(feature = "schema")]
pub fn schema() -> serde_json::Value {
    let mut generator = schemars::SchemaGenerator::default();
    generator.subschema_for::<Node>();
    generator.subschema_for::<SurfaceInput>();
    generator.subschema_for::<MountId>();
    let defs: serde_json::Map<String, serde_json::Value> = generator.take_definitions(true);
    serde_json::json!({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": "opencode plugin contract 2.0",
        "description": "Generated from opencode_plugin_abi::v2 by `examples/schema.rs`. Do not edit.",
        "$defs": defs,
    })
}

fn is_false(value: &bool) -> bool {
    !value
}

fn is_true(value: &bool) -> bool {
    *value
}

fn yes() -> bool {
    true
}

fn is_zero(value: &u16) -> bool {
    *value == 0
}

fn is_no_padding(value: &(u16, u16)) -> bool {
    *value == (0, 0)
}

fn is_start(value: &Justify) -> bool {
    *value == Justify::Start
}

fn is_stretch(value: &Align) -> bool {
    *value == Align::Stretch
}

fn is_word(value: &Wrap) -> bool {
    *value == Wrap::Word
}

fn is_unified(value: &DiffView) -> bool {
    *value == DiffView::Unified
}

fn is_visible(value: &Overflow) -> bool {
    *value == Overflow::Visible
}

fn is_default_layout(value: &Layout) -> bool {
    *value == Layout::default()
}

#[cfg(test)]
mod tests {
    use super::*;

    struct NoRead;

    impl Read for NoRead {
        fn theme_mode(&self) -> ThemeMode {
            ThemeMode::Dark
        }

        fn color(&self, _: &str) -> Option<Rgba> {
            None
        }
    }

    /// Runs `view` as the host would, with `memo` and `full`.
    fn view(memo: &mut Memo, full: bool, mut view: impl FnMut(&mut View<'_>) -> Node) -> Node {
        let input = SurfaceInput { full, ..SurfaceInput::default() };
        let mount = MountId { surface: "s".into(), key: "k".into(), generation: 1 };
        let mut next = 0;
        let mut content = |_: Vec<u8>| {
            next += 1;
            ContentRef(next)
        };
        let node = view(&mut View::new(&NoRead, &input, &mount, memo, &mut content));
        memo.finish();
        node
    }

    // Expected: memo builds on first use and keeps while the value is equal; a changed value, a full input, or a key
    // the view before did not use builds again, with the key as the subtree's id.
    #[test]
    fn memo_keeps_an_equal_value_and_builds_otherwise() {
        let mut memo = Memo::default();
        let card = |value: u32| move |cx: &mut View<'_>| cx.memo("card", value, |_| Node::text(vec![Span::new("x")]));
        let built = view(&mut memo, false, card(1));
        assert_eq!(built.id(), Some("card"));
        assert!(matches!(built, Node::Text { .. }));
        assert_eq!(view(&mut memo, false, card(1)), Node::Keep { key: "card".into() });
        assert!(matches!(view(&mut memo, false, card(2)), Node::Text { .. }));
        assert!(matches!(view(&mut memo, true, card(2)), Node::Text { .. }), "a full view builds");
        assert_eq!(view(&mut memo, false, card(2)), Node::Keep { key: "card".into() });
        view(&mut memo, false, |_| Node::column(Vec::new()));
        assert!(memo.is_empty(), "a key the view did not use stays");
        assert!(matches!(view(&mut memo, false, card(2)), Node::Text { .. }));
    }

    // Expected: a 2.0 tree on the wire leaves defaults out, and reads back equal.
    #[test]
    fn a_tree_reads_back_as_it_was_written() {
        let tree = Node::column(vec![
            Node::Keep { key: "a".into() },
            Node::Diff {
                id: Some("d".into()),
                content: Source::Content(ContentRef(3)),
                view: DiffView::Split,
                filetype: Some("rust".into()),
            },
            Node::scroll(vec![Node::Markdown {
                id: None,
                source: Source::PartOutput(PartRef { session: "s".into(), part: "p".into() }),
            }]),
        ])
        .with_id("root");
        let json = serde_json::to_string(&tree).unwrap();
        assert_eq!(
            json,
            r#"{"type":"box","id":"root","children":[{"type":"keep","key":"a"},{"type":"diff","id":"d","content":{"content":3},"view":"split","filetype":"rust"},{"type":"scroll","children":[{"type":"markdown","source":{"part-output":{"session":"s","part":"p"}}}]}]}"#
        );
        assert_eq!(serde_json::from_str::<Node>(&json).unwrap(), tree);
    }
}
