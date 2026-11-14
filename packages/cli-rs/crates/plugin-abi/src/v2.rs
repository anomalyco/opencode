//! Contract 2.0 of the rich-plugin design (`rich-plugins/synthesis.md` 4.1 to 4.6), as phase P1 builds it: a keyed
//! tree of host-owned widgets per surface, which the host reconciles by key ([`Node`], [`Node::Keep`]), mounts with
//! generations ([`MountId`]), content by handle ([`Source`]), a host-scrolled [`Node::Scroll`], and the palette in a
//! surface's input ([`SurfaceInput`]). P5 adds [`Node::Canvas`], drawn by a retained display list
//! ([`crate::canvas`]) that [`Surface::draw`] returns.
//!
//! P1 runs it on the linked path only: a built-in registers a surface with [`crate::Setup::surface`] and the host
//! calls its view with Rust values. The C ABI of 2.0 is P4's; until then a surface of an external plugin is never
//! mounted. The leaf types (colors, spans, layout, clicks) are those of ABI 1.x.
//!
//! The schema of these types is generated from them (`bun script/gen/plugin-schema.ts`, which runs the `schema`
//! example) into `crates/plugin-abi/schema/v2.json`.

use std::any::Any;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::rc::Rc;

use serde::{Deserialize, Serialize};

use crate::interact::{HandlerFn, Interact, Layer, PanelInput};
use crate::{
    Align, Border, Changed, Click, Color, Edges, Justify, Layout, Overflow, Read, Rgba, SlotInput, Span, ThemeMode,
    Wrap,
};

mod geometry;
pub use geometry::*;

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
        /// P3: pinned to this edge of its scroll while its parent is in view, never past the parent's end.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        sticky: Option<geometry::Edge>,
        /// P3: one of a group of its scroll's anchors; it needs an id.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        anchor: Option<Anchor>,
        /// P3: a row whose first child the user resizes by dragging; it needs an id, which keeps the width.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        split: Option<Split>,
        /// Focus, pointer and hover ([`crate::interact`]); its fields sit beside the box's own.
        #[serde(default, flatten)]
        interact: Interact,
        /// P6a: `false` hides the box and all it holds, which then take no room, not even a gap (TS `visible`). A slot
        /// surface whose root box is hidden shows nothing in its slot, as a 1.x claim's `Render::Hide`.
        #[serde(default = "yes", skip_serializing_if = "is_true")]
        visible: bool,
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
        /// The pointer entering and leaving the text come as [`crate::interact::Event::Hover`], as on a box with
        /// [`Interact::hover_events`] (TS `onMouseOver` and `onMouseOut` on a `text`); it needs an id.
        #[serde(default, skip_serializing_if = "is_false")]
        hover_events: bool,
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
        /// P3: `layout` is called when the top anchor of this group changes.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        notify_top: Option<String>,
        /// P3: the surface hears [`ScrollEvent::UserScroll`] when the user moves it.
        #[serde(default, skip_serializing_if = "is_false")]
        user_scroll: bool,
    },
    /// A patch in the host's diff view: its own highlighting, colors and line numbers. An added file over 3,000
    /// lines mounts its chunks near the view.
    Diff {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        id: Option<String>,
        content: Source,
        #[serde(default, skip_serializing_if = "is_unified")]
        view: DiffView,
        /// The language to highlight as, such as `rust`.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        filetype: Option<String>,
        /// P3: the first row of each hunk is anchor `{id}#{index}` of this group; it needs an id.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        hunks: Option<String>,
    },
    /// P3: a text field whose text and cursor are the host's. With an id, the surface's handler hears
    /// [`crate::interact::Event::Change`] with the text after each edit, and [`crate::interact::Event::Submit`] on
    /// enter (one line) or the submit key. A changed `value` replaces the text.
    Input {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        id: Option<String>,
        #[serde(default, skip_serializing_if = "String::is_empty")]
        value: String,
        #[serde(default, skip_serializing_if = "String::is_empty")]
        placeholder: String,
        /// Rows of a field of many lines; one line when `None`.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        lines: Option<u16>,
        #[serde(default, skip_serializing_if = "is_default_layout")]
        layout: Layout,
    },
    /// P3: a list the host scrolls and windows: only the items near the view have widgets. An item is the unit of
    /// reconcile: a [`Node::Keep`] in a list names one of its items or a node inside the same item.
    List {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        id: Option<String>,
        /// Items left to right (a tab strip), which the host does not window; top to bottom by default.
        #[serde(default, skip_serializing_if = "is_false")]
        row: bool,
        #[serde(default)]
        items: Vec<ListItem>,
        #[serde(default, skip_serializing_if = "is_default_layout")]
        layout: Layout,
        /// As a scroll's: `layout` is called when the top anchor of this group changes.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        notify_top: Option<String>,
        /// As a scroll's: the surface hears [`ScrollEvent::UserScroll`].
        #[serde(default, skip_serializing_if = "is_false")]
        user_scroll: bool,
    },
    /// P3: source code in the host's code view, highlighted as `filetype` with the host's grammars and theme.
    Code {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        id: Option<String>,
        content: Source,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        filetype: Option<String>,
        /// Line numbers in a gutter.
        #[serde(default, skip_serializing_if = "is_false")]
        numbers: bool,
        #[serde(default, skip_serializing_if = "is_default_layout")]
        layout: Layout,
    },
    /// P3: an image from content bytes (PNG, JPEG, WebP or GIF), in the host's image view.
    Image {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        id: Option<String>,
        content: Source,
        #[serde(default, skip_serializing_if = "is_contain")]
        fit: Fit,
        #[serde(default, skip_serializing_if = "is_default_layout")]
        layout: Layout,
    },
    /// The subtree last adopted under id `key` in this mount, unchanged ([`View::memo`]). A key the host does not
    /// hold in the last accepted tree is a contract error: the host refuses the tree whole.
    Keep { key: String },
    /// Cells the plugin draws itself (P5): its surface's [`Surface::draw`] returns a display list
    /// ([`crate::canvas`]), which the host keeps under the canvas's id while the id stays in the mount and replays on
    /// every frame it paints. The host asks for a list as it paints the canvas, at the canvas's size in that frame: when
    /// it first shows, when its size or `version` changed, and once a frame while `animate` is set; never while it is
    /// hidden, out of view or of no size, and what it missed meanwhile it asks for in the frame that shows it. Its
    /// cells cannot be selected or copied. A canvas must have an id.
    Canvas {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        id: Option<String>,
        #[serde(default, skip_serializing_if = "is_default_layout")]
        layout: Layout,
        /// The plugin's own count of what the canvas shows: a change asks for a list in the next frame.
        #[serde(default, skip_serializing_if = "is_zero_version")]
        version: u64,
        #[serde(default, skip_serializing_if = "is_false")]
        animate: bool,
    },
}

/// What a surface's [`Surface::draw`] gets: the host's reads, the mount, the canvas's id and the frame it draws for.
pub struct Draw<'a> {
    pub read: &'a dyn Read,
    pub mount: &'a MountId,
    pub canvas: &'a str,
    pub frame: Frame,
}

/// The frame a canvas draws for.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Frame {
    /// The canvas's size in cells, as laid out in this frame, also where it shows only in part.
    pub width: u16,
    pub height: u16,
    pub cause: Cause,
    /// The time since the last frame of the canvas's animation, when this draw is one: a resize or a version in a
    /// frame of the animation carries it too. The time the canvas was hidden, or did not animate, is not counted.
    /// Zero for a draw outside the animation.
    pub dt: std::time::Duration,
}

/// Why the host asks a canvas for a list.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Cause {
    /// The canvas shows for the first time.
    First,
    /// Its size changed since its last draw.
    Resized,
    /// Its [`Node::Canvas`] `version` changed.
    Version,
    /// A frame of its animation.
    Animate,
}

/// A surface's canvas draw: the list for the canvas [`Draw::canvas`] names, or `None` to keep the one the host holds.
pub type DrawFn = Rc<dyn Fn(&mut Draw<'_>) -> Option<crate::canvas::List>>;

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
    /// A panel surface's presentation; `None` elsewhere. A change of it calls the view again.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub panel: Option<PanelInput>,
    /// P6a: what changed since the mount's last view, as a 1.x render hears it: `all` on its first view and on a
    /// whole tree ([`Self::full`]), the change batch that called it, `local` or `size` for a change of the host's own
    /// state or of the room, and `woken` after the plugin's own handlers, a wake, or a `layout` that asked to draw
    /// again. A view that reads the host's state may answer [`Node::Keep`] of its last tree's root when nothing it read
    /// changed: the host then keeps the mount as it is, with no work. A claim's view always hears `all`.
    #[serde(default, skip_serializing_if = "is_unchanged")]
    pub changed: Changed,
    /// P6a: a slot surface's input, as a 1.x claim gets it (the session, the prompt's state); `None` elsewhere. Its
    /// size is [`Self::width`] and [`Self::height`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub slot: Option<SlotInput>,
}

fn is_unchanged(changed: &Changed) -> bool {
    *changed == Changed::default()
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

/// Where a surface shows: a route of the plugin, or a slot claim (P1); a docked panel or an overlay, which the plugin
/// opens with [`crate::Host::open_panel`] and [`crate::Host::overlay`] (P2).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Place {
    Route(String),
    Slot(crate::Placement),
    /// The session's side panel, or the whole screen: the name the plugin opens it by.
    Panel(String),
    /// Over everything but the host's dialogs, anchored: the name the plugin opens it by.
    Overlay(String),
}

/// A surface as [`crate::Setup::surface`] registers it.
#[derive(Clone)]
pub struct Surface {
    pub name: String,
    pub place: Place,
    /// The view reads [`SurfaceInput::palette`], so a theme change calls it again.
    pub palette: bool,
    pub view: ViewFn,
    /// Draws the surface's canvases ([`Node::Canvas`]); without it a canvas shows nothing.
    pub draw: Option<DrawFn>,
    /// P3: called after geometry is final, in a frame where something in `notify` changed.
    pub layout: Option<LayoutFn>,
    pub notify: Vec<Notify>,
    /// What its events come to: its layers' keys, its nodes' pointer and hover, an overlay's close.
    pub handler: Option<HandlerFn>,
    /// The key layers each mount of it registers, which end with the mount.
    pub layers: Vec<Layer>,
    /// P6a: its handler hears [`crate::interact::Event::Mount`] as each mount begins and ends.
    pub mounts: bool,
}

impl Surface {
    pub fn new(name: impl Into<String>, place: Place, view: impl Fn(&mut View<'_>) -> Node + 'static) -> Self {
        Self {
            name: name.into(),
            place,
            palette: false,
            view: Rc::new(view),
            draw: None,
            layout: None,
            notify: Vec::new(),
            handler: None,
            layers: Vec::new(),
            mounts: false,
        }
    }

    /// The surface whose handler hears each mount begin and end ([`crate::interact::Event::Mount`]).
    pub fn mounts(self) -> Self {
        Self { mounts: true, ..self }
    }

    /// The surface whose view reads the palette.
    pub fn palette(self) -> Self {
        Self { palette: true, ..self }
    }

    /// The surface whose canvases `draw` draws.
    pub fn draw(self, draw: impl Fn(&mut Draw<'_>) -> Option<crate::canvas::List> + 'static) -> Self {
        Self { draw: Some(Rc::new(draw)), ..self }
    }

    /// The surface with a `layout` call, told about `notify` and each scroll's `notify_top`.
    pub fn layout(self, notify: Vec<Notify>, layout: impl Fn(&Geometry) -> LayoutReply + 'static) -> Self {
        Self { layout: Some(Rc::new(layout)), notify, ..self }
    }

    /// The surface whose events come to `handler`.
    pub fn on(
        self,
        handler: impl Fn(&dyn crate::Host, &crate::interact::Event) -> crate::interact::Handled + 'static,
    ) -> Self {
        Self { handler: Some(Rc::new(handler)), ..self }
    }

    /// The surface whose mounts take the keys of `layers`.
    pub fn layers(self, layers: Vec<Layer>) -> Self {
        Self { layers, ..self }
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
        // A view that answered a keep of its whole tree (P6a: it heard nothing it shows change, whether or not its memos
        // ran) leaves the table as it was: every subtree its values built is still in the tree, and none it built now
        // is (review carbon-2).
        if let [Node::Keep { .. }] = accepted {
            self.staged.clear();
            self.hits.clear();
            self.used.clear();
            return;
        }
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
                        if let Node::List { items, .. } = node {
                            for item in items {
                                walk(std::slice::from_ref(&item.node), staged, keeps, built);
                            }
                        }
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
            sticky: None,
            anchor: None,
            split: None,
            interact: Interact::default(),
            visible: true,
        }
    }

    /// A box with `value`'s focus, pointer and hover; anything else is unchanged.
    pub fn interact(mut self, value: Interact) -> Self {
        if let Node::Box { interact, .. } = &mut self {
            *interact = value;
        }
        self
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
            hover_events: false,
        }
    }

    /// A text whose hover comes as events ([`Node::Text`]'s `hover_events`); anything else is unchanged.
    pub fn hover_events(mut self) -> Self {
        if let Node::Text { hover_events, .. } = &mut self {
            *hover_events = true;
        }
        self
    }

    /// A scroll box of `children`.
    pub fn scroll(children: Vec<Node>) -> Self {
        Node::Scroll {
            id: None,
            height: None,
            follow: false,
            layout: Layout::default(),
            children,
            notify_top: None,
            user_scroll: false,
        }
    }

    /// A list of `items` top to bottom, windowed by the host.
    pub fn list(items: Vec<ListItem>) -> Self {
        Node::List { id: None, row: false, items, layout: Layout::default(), notify_top: None, user_scroll: false }
    }

    /// The scroll or list with `layout` told about its top anchor of `group`, and the surface about the user's
    /// moves; anything else is unchanged.
    pub fn watched(mut self, group: impl Into<String>) -> Self {
        if let Node::Scroll { notify_top, user_scroll, .. } | Node::List { notify_top, user_scroll, .. } = &mut self {
            *notify_top = Some(group.into());
            *user_scroll = true;
        }
        self
    }

    /// A patch of `content` in the unified view.
    pub fn diff(content: Source) -> Self {
        Node::Diff { id: None, content, view: DiffView::Unified, filetype: None, hunks: None }
    }

    /// A one-line text field showing `value`.
    pub fn input(value: impl Into<String>) -> Self {
        Node::Input {
            id: None,
            value: value.into(),
            placeholder: String::new(),
            lines: None,
            layout: Layout::default(),
        }
    }

    /// The box pinned to `edge` of its scroll while its parent is in view; anything else is unchanged.
    pub fn sticky(mut self, edge: Edge) -> Self {
        if let Node::Box { sticky, .. } = &mut self {
            *sticky = Some(edge);
        }
        self
    }

    /// The box as an anchor of `group` with `variant`; anything else is unchanged.
    pub fn anchor(mut self, group: impl Into<String>, variant: impl Into<String>) -> Self {
        if let Node::Box { anchor, .. } = &mut self {
            *anchor = Some(Anchor::new(group, variant));
        }
        self
    }

    /// A canvas with id `id`, still and at version 0.
    pub fn canvas(id: impl Into<String>) -> Self {
        Node::Canvas { id: Some(id.into()), layout: Layout::default(), version: 0, animate: false }
    }

    /// A canvas at `value`: a new version asks for a list. Anything else is unchanged.
    pub fn version(mut self, value: u64) -> Self {
        if let Node::Canvas { version, .. } = &mut self {
            *version = value;
        }
        self
    }

    /// A canvas that animates while `on`. Anything else is unchanged.
    pub fn animate(mut self, on: bool) -> Self {
        if let Node::Canvas { animate, .. } = &mut self {
            *animate = on;
        }
        self
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
            | Node::Diff { id, .. }
            | Node::Canvas { id, .. }
            | Node::Input { id, .. }
            | Node::List { id, .. }
            | Node::Code { id, .. }
            | Node::Image { id, .. } => id.as_deref(),
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
            | Node::Diff { id, .. }
            | Node::Canvas { id, .. }
            | Node::Input { id, .. }
            | Node::List { id, .. }
            | Node::Code { id, .. }
            | Node::Image { id, .. } => Some(id),
            Node::Keep { .. } | Node::Slot { .. } => None,
        }
    }

    /// The layout of a node that has one.
    pub fn layout_of(&self) -> Option<&Layout> {
        match self {
            Node::Box { layout, .. }
            | Node::Text { layout, .. }
            | Node::Scroll { layout, .. }
            | Node::Input { layout, .. }
            | Node::List { layout, .. }
            | Node::Code { layout, .. }
            | Node::Image { layout, .. }
            | Node::Canvas { layout, .. } => Some(layout),
            _ => None,
        }
    }

    /// The layout of a node that has one, to change.
    pub fn layout_mut(&mut self) -> Option<&mut Layout> {
        match self {
            Node::Box { layout, .. }
            | Node::Text { layout, .. }
            | Node::Scroll { layout, .. }
            | Node::Input { layout, .. }
            | Node::List { layout, .. }
            | Node::Code { layout, .. }
            | Node::Image { layout, .. }
            | Node::Canvas { layout, .. } => Some(layout),
            _ => None,
        }
    }

    /// The children of a box or a scroll.
    pub fn children(&self) -> &[Node] {
        match self {
            Node::Box { children, .. } | Node::Scroll { children, .. } => children,
            _ => &[],
        }
    }

    /// The node with `layout`, when it has one.
    pub fn layout(mut self, value: Layout) -> Self {
        if let Some(layout) = self.layout_mut() {
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

    /// A box with `cells` between its children; anything else is unchanged.
    pub fn gap(mut self, cells: u16) -> Self {
        if let Node::Box { gap, .. } = &mut self {
            *gap = cells;
        }
        self
    }

    /// A box with `x` cells inside its left and right edges and `y` inside its top and bottom; anything else is
    /// unchanged.
    pub fn padding(mut self, x: u16, y: u16) -> Self {
        if let Node::Box { padding, .. } = &mut self {
            *padding = (x, y);
        }
        self
    }

    /// A box whose children share the room left as `value` says; anything else is unchanged.
    pub fn justify(mut self, value: Justify) -> Self {
        if let Node::Box { justify, .. } = &mut self {
            *justify = value;
        }
        self
    }

    /// A box whose children sit across it as `value` says; anything else is unchanged.
    pub fn align(mut self, value: Align) -> Self {
        if let Node::Box { align, .. } = &mut self {
            *align = value;
        }
        self
    }

    /// A box shown or hidden; anything else is unchanged.
    pub fn visible(mut self, value: bool) -> Self {
        if let Node::Box { visible, .. } = &mut self {
            *visible = value;
        }
        self
    }

    /// Text in `color` while the pointer is over it; anything else is unchanged.
    pub fn hover_fg(mut self, color: impl Into<Color>) -> Self {
        if let Node::Text { hover_fg, .. } = &mut self {
            *hover_fg = Some(color.into());
        }
        self
    }

    /// Text that wraps as `value` says; anything else is unchanged.
    pub fn wrap(mut self, value: Wrap) -> Self {
        if let Node::Text { wrap, .. } = &mut self {
            *wrap = value;
        }
        self
    }

    /// Text the mouse cannot select; anything else is unchanged.
    pub fn unselectable(mut self) -> Self {
        if let Node::Text { selectable, .. } = &mut self {
            *selectable = false;
        }
        self
    }

    /// Text that cuts lines that do not fit; anything else is unchanged.
    pub fn truncate(mut self) -> Self {
        if let Node::Text { truncate, .. } = &mut self {
            *truncate = true;
        }
        self
    }

    /// Whether the node is a box hidden with [`Node::visible`].
    pub fn is_hidden(&self) -> bool {
        matches!(self, Node::Box { visible: false, .. })
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
                sticky: None,
                anchor: None,
                split: None,
                interact: Interact::default(),
                visible: true,
            },
            crate::Node::Text { spans, fg, wrap, truncate, selectable, hover_fg, layout, on_click } => Node::Text {
                id: None,
                spans,
                fg,
                wrap,
                truncate,
                selectable,
                hover_fg,
                layout,
                on_click,
                hover_events: false,
            },
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

fn is_zero_version(value: &u64) -> bool {
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

fn is_contain(value: &Fit) -> bool {
    *value == Fit::Contain
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
                hunks: None,
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
