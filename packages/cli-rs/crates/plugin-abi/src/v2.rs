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
use std::collections::{BTreeMap, HashMap, HashSet};
use std::rc::Rc;

use serde::{Deserialize, Serialize};

use crate::{Align, Border, Click, Color, Edges, Justify, Layout, Overflow, Read, Rgba, Span, ThemeMode, Wrap};

/// What a surface draws: a node of a keyed tree. A node may carry an `id`, unique in its mount; the host keeps the
/// widget of a node whose id and kind stay, and writes only what changed. Without an id a node is matched by its kind
/// and place among the siblings without one.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
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
#[serde(rename_all = "kebab-case")]
pub enum Source {
    Text(String),
    Content(ContentRef),
    PartOutput(PartRef),
}

/// A handle to bytes the plugin gave the host once, in this mount.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct ContentRef(pub u64);

/// A part of a session's transcript by its id: a tool call, whose output it names.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct PartRef {
    pub session: String,
    /// The call's id, as the transcript has it (`call_…`).
    pub part: String,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DiffView {
    #[default]
    Unified,
    Split,
}

/// What a surface's view gets besides the plugin's own state.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
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
    release: &'a mut dyn FnMut(ContentRef),
}

impl<'a> View<'a> {
    #[doc(hidden)]
    pub fn new(
        read: &'a dyn Read,
        input: &'a SurfaceInput,
        mount: &'a MountId,
        memo: &'a mut Memo,
        content: &'a mut dyn FnMut(Vec<u8>) -> ContentRef,
        release: &'a mut dyn FnMut(ContentRef),
    ) -> Self {
        if input.full {
            memo.entries.clear();
        }
        memo.discard();
        Self { read, input, mount, memo, content, release }
    }

    /// Gives the host `bytes` once; a [`Source::Content`] of the handle shows them. The handle lives until the mount
    /// ends or the plugin releases it, so a plugin may keep it in its model while no tree shows it. Content a view
    /// gave is dropped with its tree when the host refuses it; the host then asks for a whole tree
    /// ([`SurfaceInput::full`]), which gives it again.
    pub fn content(&mut self, bytes: impl Into<Vec<u8>>) -> ContentRef {
        (self.content)(bytes.into())
    }

    /// Lets the host drop the content `handle` names, at once: no tree may name it from now on. A handle the mount
    /// does not hold is ignored.
    pub fn release(&mut self, handle: ContentRef) {
        (self.release)(handle)
    }

    /// The subtree `build` makes, with id `key`; or, when `value` equals the one it was last built from in this
    /// mount, [`Node::Keep`] of `key`, and `build` does not run (Elm's `lazy`). The host then neither compares nor
    /// touches that subtree. The value is remembered only once the host accepts a tree that holds what `build` made
    /// under `key`: a node `build` makes that cannot carry an id (a slot or a keep), or one the view leaves out or
    /// swaps for another, is built again next time.
    pub fn memo<V: PartialEq + 'static>(
        &mut self,
        key: impl Into<String>,
        value: V,
        build: impl FnOnce(&mut Self) -> Node,
    ) -> Node {
        let key = key.into();
        if let Some((_, inner)) = self.memo.building.last_mut() {
            inner.push(key.clone());
        }
        if !self.memo.used.insert(key.clone()) {
            // A second memo of one key in one view: the first named the subtree, so this one builds.
            return build(self);
        }
        let same = self
            .memo
            .entries
            .get(&key)
            .and_then(|last| last.value.downcast_ref::<V>())
            .is_some_and(|last| *last == value);
        if same {
            self.memo.hits.push(key.clone());
            return Node::Keep { key };
        }
        self.memo.building.push((key.clone(), Vec::new()));
        let node = build(self).with_id(key.clone());
        let (_, inner) = self.memo.building.pop().unwrap_or_default();
        if node.id() == Some(key.as_str()) && !matches!(node, Node::Keep { .. }) {
            self.memo.staged.insert(key, Entry { value: Box::new(value), print: print(&node), inner });
        }
        node
    }
}

/// The SDK's table of [`View::memo`] values, one per mount, empty in a new one. A view's values are staged and kept
/// by [`Memo::finish`] only for what the host accepted, so a [`Node::Keep`] always names the subtree its value built.
#[derive(Default)]
pub struct Memo {
    entries: HashMap<String, Entry>,
    /// What the running view built, and the keys it kept.
    staged: HashMap<String, Entry>,
    hits: Vec<String>,
    used: HashSet<String>,
    /// The memos building now, innermost last, each with the keys memoized inside it.
    building: Vec<(String, Vec<String>)>,
}

struct Entry {
    value: Box<dyn Any>,
    /// A fingerprint of the node built from the value.
    print: u64,
    /// The keys memoized inside it: they stay while it is kept.
    inner: Vec<String>,
}

impl Memo {
    /// Keeps, of the view that returned `accepted`, each value whose node `accepted` holds as built, and each kept
    /// value whose [`Node::Keep`] it holds, with the values inside it; the rest goes. The host calls it once it
    /// accepted the view's tree.
    pub fn finish(&mut self, accepted: &[Node]) {
        fn walk<'a>(
            nodes: &'a [Node],
            staged: &HashMap<String, Entry>,
            keeps: &mut HashSet<&'a str>,
            built: &mut HashMap<&'a str, &'a Node>,
        ) {
            for node in nodes {
                match node {
                    Node::Keep { key } => {
                        keeps.insert(key);
                    }
                    _ => {
                        if let Some(id) = node.id().filter(|id| staged.contains_key(*id)) {
                            built.insert(id, node);
                        }
                        walk(node.children(), staged, keeps, built);
                    }
                }
            }
        }
        let (mut keeps, mut built) = (HashSet::new(), HashMap::new());
        walk(accepted, &self.staged, &mut keeps, &mut built);
        let mut entries = HashMap::new();
        let mut kept: Vec<String> = self.hits.drain(..).filter(|key| keeps.contains(key.as_str())).collect();
        while let Some(key) = kept.pop() {
            if let Some(entry) = self.entries.remove(&key) {
                kept.extend(entry.inner.iter().cloned());
                entries.insert(key, entry);
            }
        }
        for (key, entry) in self.staged.drain() {
            if built.get(key.as_str()).is_some_and(|node| print(node) == entry.print) {
                entries.insert(key, entry);
            }
        }
        self.entries = entries;
        self.used.clear();
    }

    /// Drops what the running view staged: the host refused its tree, or it failed.
    pub fn discard(&mut self) {
        self.staged.clear();
        self.hits.clear();
        self.used.clear();
        self.building.clear();
    }

    /// Forgets every value: the host refused the tree, so the next view builds whole.
    pub fn clear(&mut self) {
        self.entries.clear();
        self.discard();
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

/// A fingerprint of `node` and all it holds.
fn print(node: &Node) -> u64 {
    struct Hashing(std::collections::hash_map::DefaultHasher);
    impl std::io::Write for Hashing {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            std::hash::Hasher::write(&mut self.0, bytes);
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    let mut hashing = Hashing(Default::default());
    // Writing to a hasher does not fail, and a node always serializes.
    let _ = serde_json::to_writer(&mut hashing, node);
    std::hash::Hasher::finish(&hashing.0)
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

pub use crate::schema::schema;

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
        let node = view(&mut View::new(&NoRead, &input, &mount, memo, &mut content, &mut |_| {}));
        memo.finish(std::slice::from_ref(&node));
        node
    }

    // Expected (`keep-full`): memo remembers a value only for the node the accepted tree holds: a candidate the view
    // built and left out for another node with its id, a slot, which carries no id, and a duplicate key all build
    // again. A memo inside a kept one stays with it, so after the outer value changes an unchanged inner one keeps.
    #[test]
    fn memo_remembers_only_what_the_host_accepted() {
        let text = |text: &str| Node::text(vec![Span::new(text)]);
        let mut memo = Memo::default();
        let swapped = |cx: &mut View<'_>| {
            let _candidate = cx.memo("pane", 1, |_| text("EXPECTED"));
            text("OTHER").with_id("pane")
        };
        view(&mut memo, false, swapped);
        let pane = view(&mut memo, false, |cx| cx.memo("pane", 1, |_| text("EXPECTED")));
        assert!(matches!(pane, Node::Text { .. }), "a swapped candidate was kept: {pane:?}");
        assert_eq!(
            view(&mut memo, false, |cx| cx.memo("pane", 1, |_| text("EXPECTED"))),
            Node::Keep { key: "pane".into() }
        );

        let mut memo = Memo::default();
        let slot = |cx: &mut View<'_>| cx.memo("slot", 1, |_| Node::Slot { path: "home.footer".into() });
        view(&mut memo, false, slot);
        assert!(matches!(view(&mut memo, false, slot), Node::Slot { .. }), "a slot was kept");
        assert!(memo.is_empty());

        let mut memo = Memo::default();
        let twice =
            |cx: &mut View<'_>| Node::column(vec![cx.memo("a", 1, |_| text("1")), cx.memo("a", 1, |_| text("2"))]);
        view(&mut memo, false, twice);
        let Node::Box { children, .. } = view(&mut memo, false, twice) else { panic!() };
        assert_eq!(children[0], Node::Keep { key: "a".into() });
        assert!(matches!(&children[1], Node::Text { id: None, .. }), "a second memo of a key kept: {:?}", children[1]);

        let mut memo = Memo::default();
        let day = |outer: u32| {
            move |cx: &mut View<'_>| {
                cx.memo("day", outer, |cx| Node::column(vec![cx.memo("commit", 7, |_| text("commit")), text("day")]))
            }
        };
        view(&mut memo, false, day(1));
        assert_eq!(view(&mut memo, false, day(1)), Node::Keep { key: "day".into() });
        let Node::Box { children, .. } = view(&mut memo, false, day(2)) else { panic!() };
        assert_eq!(children[0], Node::Keep { key: "commit".into() }, "the inner memo was dropped with its kept parent");
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
