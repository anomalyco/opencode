//! The keyed reconcile (synthesis 3.4, P1): a tree a plugin returns is adopted into the widgets of the tree before it,
//! not mounted again. A node whose id and kind stay keeps its widget, and the host writes only what changed; a
//! [`Node::Keep`] adopts the subtree last mounted under that id as it is. A tree that breaks the contract (an id twice,
//! a keep of an id the host does not hold, content the mount does not have) is refused whole and changes nothing.
//!
//! Every widget the reconcile creates, removes, writes or moves is counted in [`work`], per thread and outside any
//! mount, so a test can bound the work of a revision whatever replaced the mount.

use std::cell::{Cell, RefCell};
use std::collections::{HashMap, HashSet};
use std::rc::{Rc, Weak};

use opencode_plugin_abi::v2::{ContentRef, DiffView, Node, Source};
use opencode_plugin_abi::{self as abi};
use opencode_ui::diff::Patch;
use opencode_ui::theme::Theme;
use opentui::input::{MouseButton, MouseEventKind};
use opentui::prelude::*;
use opentui::style::Color;
use opentui::syntax::SyntaxTheme;

use crate::canvas::{Canvas, Drawer};
use crate::image::Picture;
use crate::limits::{self, Over};
use crate::list::List;
use crate::node::{Act, bordered, color, edges_of, lay_out, styled};
use crate::{Host, SlotMount};

/// What reconciling did to widgets, counted since the thread started.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Work {
    /// Widgets built, one a node.
    pub created: u64,
    /// Widgets dropped, one a node.
    pub removed: u64,
    /// Widgets of kept nodes written in place, one a node.
    pub set: u64,
    /// Widgets of kept nodes moved to another place.
    pub moved: u64,
    /// Subtrees adopted through [`Node::Keep`].
    pub kept: u64,
    /// Patches parsed for a [`Node::Diff`], code highlighted for a [`Node::Code`], and images decoded.
    pub parses: u64,
    /// Nodes adopted as a placeholder, over a limit ([`crate::limits`]).
    pub placeholders: u64,
    /// Revisions and list items left for a later frame, past the rows of a frame ([`limits::Limits::frame_rows`]).
    pub deferred: u64,
    /// Bytes of text read to measure what it costs ([`measure`]).
    pub scanned: u64,
    /// Ids visited to count what a library's keeps hold again ([`Tree::held_counts`]).
    pub held: u64,
    /// List items a view gave whole, not as a keep of the item the list holds: what the plugin built again of a list.
    pub items: u64,
}

impl Work {
    /// What happened between `before` and `self`.
    pub fn since(self, before: Work) -> Work {
        Work {
            created: self.created - before.created,
            removed: self.removed - before.removed,
            set: self.set - before.set,
            moved: self.moved - before.moved,
            kept: self.kept - before.kept,
            parses: self.parses - before.parses,
            placeholders: self.placeholders - before.placeholders,
            deferred: self.deferred - before.deferred,
            scanned: self.scanned - before.scanned,
            held: self.held - before.held,
            items: self.items - before.items,
        }
    }

    /// Widgets created, removed, set and moved.
    pub fn touched(self) -> u64 {
        self.created + self.removed + self.set + self.moved
    }
}

thread_local! {
    static WORK: Cell<Work> = Cell::new(Work::default());
}

/// The work counted on this thread so far.
pub fn work() -> Work {
    WORK.with(Cell::get)
}

fn count(f: impl FnOnce(&mut Work)) {
    WORK.with(|cell| {
        let mut work = cell.get();
        f(&mut work);
        cell.set(work);
    });
}

/// The deepest a plugin's tree may nest, in OpenTUI layout levels. OpenTUI refuses a node past 256 levels with an
/// error that ends the TUI; the host's own views take the levels above a surface, and a nested slot's claims nest
/// their own trees, each held to this bound, below it.
pub const MAX_DEPTH: u16 = 64;

/// The layout levels a node's own widget takes: a scroll box is four views, a patch a column of diffs of code views,
/// and Markdown a few levels of its own; a list is a scroll box and a wrapper per item.
fn weight(node: &Node) -> u16 {
    match node {
        Node::Box { .. }
        | Node::Text { .. }
        | Node::Spinner { .. }
        | Node::Slot { .. }
        | Node::Canvas { .. }
        | Node::Image { .. } => 1,
        Node::Input { .. } | Node::Code { .. } => 2,
        Node::Scroll { .. } | Node::Diff { .. } | Node::Markdown { .. } => 4,
        Node::List { .. } => 5,
        // A box, and the holder of the host's code view of the fence, which is Markdown's levels.
        Node::Fence { .. } => 6,
        Node::Keep { .. } => 0,
    }
}

/// [`weight`], for the list's data.
pub(crate) fn weight_of(node: &Node) -> u16 {
    weight(node)
}

/// Counts a subtree adopted through a keep.
pub(crate) fn count_kept() {
    count(|work| work.kept += 1);
}

/// Counts a list item given whole.
pub(crate) fn count_item() {
    count(|work| work.items += 1);
}

/// Counts an image decoded.
pub(crate) fn count_decoded() {
    count(|work| work.parses += 1);
}

/// The most rows a list's estimates may add up to. OpenTUI lays out in `f32`, which holds whole rows exactly up to
/// 2^24: past it rows would collide, and the window would never settle.
pub const MAX_ROWS: u64 = 1 << 24;

/// Whether every size of `layout` in percent is a finite number of 0 or more.
pub fn sizes_ok(layout: &abi::Layout) -> bool {
    [layout.width, layout.height, layout.min_height, layout.max_height]
        .into_iter()
        .flatten()
        .all(|size| !matches!(size, abi::Width::Percent(percent) if !percent.is_finite() || percent < 0.0))
}

/// Why a tree was refused. Nothing of it was adopted.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Refused {
    /// Two nodes of the tree, or a node and a node of a kept subtree, have this id.
    Duplicate(String),
    /// A keep names an id the last accepted tree does not hold.
    Unknown(String),
    /// A whole tree, asked for after a refusal, keeps this id.
    Kept(String),
    /// A node shows content the mount does not have.
    Content(ContentRef),
    /// The widgets the tree would hold nest deeper than [`MAX_DEPTH`], kept subtrees included; OpenTUI's layout
    /// fails the whole TUI past its own limit.
    Deep,
    /// A size in percent that is not a finite number of 0 or more, which OpenTUI's layout refuses with an error that
    /// ends the TUI.
    Number,
    /// A node with state, verbs or events without an id (synthesis 4.2): a scroll, a canvas, a list or its item, an
    /// input, an anchor, a split, a diff with hunks. Without one another node's state could pass to it.
    Unkeyed,
    /// A split on a box that is not a row: the user drags the width of its first child.
    Split,
    /// An image of a tool call's output, which is text: an image shows content or bytes.
    Output,
    /// A list whose estimates add up to more than [`MAX_ROWS`].
    Rows,
    /// A fence node ([`Node::Fence`]) outside a fence claim's tree, or a second one in a tree: the host's code view of
    /// a fence is one widget, and a second would double the host's work for it.
    Fence,
}
impl std::fmt::Display for Refused {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Refused::Duplicate(id) => write!(f, "the id {id:?} is in the tree twice"),
            Refused::Unknown(id) => write!(f, "a keep names {id:?}, which the host does not hold"),
            Refused::Kept(id) => write!(f, "a whole tree keeps {id:?}"),
            Refused::Content(content) => write!(f, "content {} is not the mount's", content.0),
            Refused::Deep => write!(f, "the tree nests deeper than {MAX_DEPTH} layout levels"),
            Refused::Number => write!(f, "a size in percent is not a finite number of 0 or more"),
            Refused::Unkeyed => write!(f, "a node with state has no id"),
            Refused::Split => write!(f, "a split is not a row"),
            Refused::Output => write!(f, "an image shows a tool call's output"),
            Refused::Rows => write!(f, "a list's estimates add up to more than {MAX_ROWS} rows"),
            Refused::Fence => write!(f, "a fence node is outside a fence claim's tree, or in it twice"),
        }
    }
}

/// What a reconcile builds with: the host, the theme, how a click runs, how a nested slot mounts, and the text of a
/// [`Source`].
pub struct Env<'a> {
    pub host: &'a dyn Host,
    pub theme: &'a Theme,
    pub act: &'a Act,
    /// Mounts a nested slot into the parent; `None` for a path the claim may not show.
    pub slot: &'a dyn Fn(&View, &str) -> Option<SlotMount>,
    /// The text of a source; `None` when the host has none yet, which draws empty.
    pub source: &'a dyn Fn(&Source) -> Option<Rc<str>>,
    /// What a source's text costs the host: its bytes, and its lines and hunks when it is within one node's text
    /// ([`Measure`]).
    pub measure: &'a dyn Fn(&Source) -> Measure,
    /// Whether the mount holds content `ContentRef`.
    pub content: &'a dyn Fn(ContentRef) -> bool,
    /// Whether the view gave content `ContentRef` and its plugin could not hold it ([`crate::limits`]): a node that
    /// shows it is a placeholder.
    pub dropped: &'a dyn Fn(ContentRef) -> bool,
    /// What an image of a source shows: admitted by its header and decoding on a worker, decoded, or over a limit.
    pub image: &'a dyn Fn(&Source) -> Picture,
    /// The host asked for a whole tree, after a refusal: a keep names a subtree the view did not vouch for again.
    pub full: bool,
    /// How the mount's canvases call their plugin; `None` where nothing draws them.
    pub draw: Option<&'a Rc<Drawer>>,
    /// The mount whose handler a box's pointer and hover events reach ([`crate::interact`]).
    pub owner: Option<&'a Weak<crate::interact::Owner>>,
    /// The plugin the tree's nodes are charged to; `None` for a 1.x claim, which the tree's own limits hold.
    pub plugin: Option<&'a str>,
    /// The tree is a list item's: the list's tree counted its nodes, so it counts only the rows it builds.
    pub item: bool,
    /// The host's own code view of the claimed fence, for a [`Node::Fence`] of a fence claim's tree, which the host
    /// keeps current with no view; `None` elsewhere, where the host refuses a fence node.
    pub fence: Option<&'a dyn Fn() -> Option<AnyWidget>>,
}

/// A mounted tree: the widgets of the last accepted tree, in a parent the owner gives each call.
#[derive(Default)]
pub struct Tree {
    pub(crate) nodes: Vec<Mounted>,
    theme: Option<Theme>,
    /// Every id the tree holds.
    ids: HashMap<String, Held>,
    /// Slots mounted or dropped by the last apply.
    slots_changed: bool,
    /// The plugin its nodes are charged to, and how many.
    charged: Option<(Rc<str>, u64)>,
    /// What the last apply put placeholders in place of, for [`Tree::admitted`].
    over: Placeholders,
    /// What a keep of each id stands for, beside the nodes the tree holds under it ([`Admitted`]).
    admitted: Admitted,
    /// The rows the last apply built.
    rows: u64,
}

/// What a keep of an id of the tree stands for, as validation admitted its nodes: a keep is admitted as the subtree it
/// stands for would be (reviews bigboi 5, carbon 1).
#[derive(Clone, Debug, Default)]
struct Admitted {
    /// The ids of nodes past the tree's nodes or rows, whose subtree no widget holds: one a placeholder took, one in
    /// the run it stands for, or one inside either; with the nodes and rows of their subtree.
    missing: HashMap<String, (u64, u64)>,
    /// The ids of the nodes opened to admit their children one by one, with the nodes and rows of their whole subtree.
    opened: HashMap<String, (u64, u64)>,
    /// The rows the subtree under each id built.
    rows: HashMap<String, u64>,
    /// The fence nodes the subtree under each id holds, kept subtrees and list items' data included: a keep of the id
    /// counts them as its spelled-out subtree would (bigboi's review of contract 2.x).
    fences: HashMap<String, u32>,
}

/// What the tree holds under an id: the nearest ancestor with an id, the layout levels its subtree takes, the nodes
/// in it, and the list and item whose data holds it, for an id inside a list.
#[derive(Clone, Debug)]
pub(crate) struct Held {
    pub above: Option<String>,
    pub depth: u16,
    pub nodes: u64,
    pub item: Option<(String, String)>,
}

impl Drop for Tree {
    fn drop(&mut self) {
        self.uncharge();
    }
}

pub(crate) struct Mounted {
    /// The node as it was adopted; a box's and a scroll's children are in `children`, not here, and a list's items
    /// in its [`List`].
    pub node: Node,
    /// The widget it put in its parent; `None` for a slot, whose claims go into the parent itself.
    pub widget: Option<AnyWidget>,
    pub children: Vec<Mounted>,
    pub extra: Extra,
    /// It or a node under it shows a tool call's output, which the host reads again each revision.
    dynamic: bool,
    /// The node that reads a tool call's output this placeholder stands for: a keep reads the output again
    /// (review bigboi 4).
    stood: Option<Box<Node>>,
}

pub(crate) enum Extra {
    Box {
        view: View,
        click: Option<Rc<RefCell<abi::Click>>>,
        /// The split's width, which the user's drag sets; it stays while the box's id does.
        split: Option<Rc<crate::behave::SplitState>>,
        /// Its focus, pointer and hover, when it has any.
        wired: Option<Rc<crate::interact::Wired>>,
    },
    Text {
        text: Rc<Text>,
        click: Option<Rc<RefCell<abi::Click>>>,
        hover: Option<Rc<Hover>>,
        /// Its hover events, when it has them.
        _wired: Option<Rc<crate::interact::Wired>>,
    },
    Spinner(opencode_ui::motion::Spinner),
    Scroll(ScrollBox),
    /// The patch, and the text it shows.
    Diff(Patch, Rc<str>),
    /// An added file over 3,000 lines, in chunks mounted near the view, and the text it shows.
    Chunked(Rc<opencode_ui::diff::Chunked>, Rc<str>),
    /// The Markdown, and the text it shows.
    Markdown(opentui::widget::Markdown, Rc<str>),
    Slot(Option<SlotMount>),
    Canvas(Canvas),
    /// The field, and the value the tree gave it last.
    Input(Field, RefCell<String>),
    List(Box<List>),
    /// The code and the text it shows.
    Code(opentui::widget::Code, Rc<str>),
    /// The box that holds the host's code view of the claimed fence: its background restyles with the theme.
    Fence(View),
    /// The image.
    Image(opentui::widget::ImageView),
    /// In the tree before, a subtree that the tree being adopted holds again; its widget moved to wherever the tree
    /// has its id now.
    Taken,
}

/// An input of one line or many.
#[derive(Clone)]
pub(crate) enum Field {
    Line(opentui::widget::Input),
    Lines(opentui::widget::Textarea),
}

impl Field {
    fn set(&self, text: &str) {
        match self {
            Field::Line(input) => drop(input.set_value(text)),
            Field::Lines(area) => drop(area.set_text(text)),
        }
    }

    fn widget(&self) -> AnyWidget {
        match self {
            Field::Line(input) => input.as_any(),
            Field::Lines(area) => area.as_any(),
        }
    }

    /// The text the field shows and its cursor.
    fn draft(&self) -> (String, (u32, u32)) {
        let (text, buffer) = match self {
            Field::Line(input) => (input.value(), input.buffer()),
            Field::Lines(area) => (area.text(), area.buffer()),
        };
        (text, buffer.info().map_or((0, 0), |info| info.cursor))
    }

    /// Shows `text` with the cursor at `cursor`.
    fn restore(&self, (text, cursor): &(String, (u32, u32))) {
        self.set(text);
        let buffer = match self {
            Field::Line(input) => input.buffer(),
            Field::Lines(area) => area.buffer(),
        };
        if let Err(error) = buffer.set_cursor(cursor.0, cursor.1) {
            log::warn!("an input's cursor: {error}");
        }
    }
}

/// The ids of the tree before that a tree being adopted holds again: the ones it keeps, and the ones it has a node
/// for.
struct Plan {
    keeps: HashSet<String>,
    moves: HashSet<String>,
    /// The nodes over a limit, each with the placeholder that stands for it.
    over: Placeholders,
    /// The nodes the tree holds, as charged to its plugin.
    nodes: u64,
    /// What a keep of each id stands for.
    admitted: Admitted,
    /// The rows the tree builds.
    rows: u64,
}

/// The nodes of a tree being adopted that are over a limit, by address, each with the placeholder that stands for
/// it. The tree outlives the reconcile, so the addresses stay valid through it.
type Placeholders = Rc<HashMap<*const Node, Option<Node>>>;

/// What the user typed into inputs whose widgets went, by input id: the value the tree gave the input then, and the
/// text and selection typed over it.
pub(crate) type Drafts = HashMap<String, (String, (String, (u32, u32)))>;

/// What a reconcile is doing: the subtrees of the tree before that the new one holds again, not yet placed, the
/// widgets to drop once every one of them is placed, and whether the theme changed.
struct Pass<'a, 'b> {
    env: &'a Env<'b>,
    pool: HashMap<String, Mounted>,
    doomed: Vec<Mounted>,
    restyle: bool,
    slots_changed: bool,
    syntax: std::cell::OnceCell<Rc<SyntaxTheme>>,
    /// The widget that took over from a focused one built again.
    refocus: Option<AnyWidget>,
    over: Placeholders,
}

impl Tree {
    /// Adopts `nodes` into `parent`, which holds this tree's widgets and nothing else, or refuses it and changes
    /// nothing. A node over a limit is adopted as its placeholder.
    pub fn apply(&mut self, env: &Env<'_>, parent: &View, nodes: &[Node]) -> Result<(), Refused> {
        let plan = self.validate(env, nodes)?;
        count(|work| work.placeholders += plan.over.values().filter(|node| node.is_some()).count() as u64);
        limits::spend_frame(env.host.app(), plan.rows);
        self.rows = plan.rows;
        // Validation admitted the nodes against what the plugin holds without this tree's last charge.
        if let Some(plugin) = env.plugin.filter(|_| !env.item) {
            self.uncharge();
            limits::recharge(plugin, limits::Kind::Nodes, 0, plan.nodes);
            self.charged = Some((Rc::from(plugin), plan.nodes));
        }
        let restyle = self.theme.as_ref().is_some_and(|theme| theme != env.theme);
        let app = env.host.app();
        let focused = app.focused();
        let mut pass = Pass {
            env,
            pool: HashMap::new(),
            doomed: Vec::new(),
            restyle,
            slots_changed: false,
            syntax: std::cell::OnceCell::new(),
            refocus: None,
            over: plan.over.clone(),
        };
        if !plan.keeps.is_empty() || !plan.moves.is_empty() {
            take(&mut self.nodes, &plan, &mut pass.pool);
        }
        let old = std::mem::take(&mut self.nodes);
        self.nodes = pass.children(parent, old, nodes);
        debug_assert!(pass.pool.is_empty(), "every subtree held again is placed");
        for doomed in pass.doomed.drain(..) {
            drop_mounted(doomed, &mut pass.slots_changed);
        }
        // A parent with a slot is cleared and its held subtrees attached again, which takes the focus from them
        // (OpenTUI's `subtree_removed`): it comes back, or goes to the widget that took over from a focused one.
        if app.focused().is_none()
            && let Some(widget) = pass.refocus.take().or(focused.filter(|widget| attached(app, widget)))
        {
            app.focus(&widget);
        }
        self.theme = Some(env.theme.clone());
        self.slots_changed = pass.slots_changed;
        self.ids.clear();
        collect_ids(&self.nodes, None, &mut self.ids);
        (self.over, self.admitted) = (plan.over, plan.admitted);
        Ok(())
    }

    /// `nodes`, which the last apply adopted, as it adopted them: each node over a limit is its placeholder, and the
    /// nodes a placeholder stands for are gone. An owner keeps this, not the tree it was offered, so what a limit
    /// refused is not held (review bigboi 5).
    pub fn admitted(&mut self, mut nodes: Vec<Node>) -> Vec<Node> {
        let over = std::mem::take(&mut self.over);
        if !over.is_empty() {
            project(&mut nodes, &over);
        }
        nodes
    }

    /// The rows the last apply built: what the next revision is taken to build ([`limits::frame_room`]).
    pub(crate) fn rows(&self) -> u64 {
        self.rows
    }

    /// Counts a revision or a list item left for a later frame.
    pub(crate) fn defer() {
        count(|work| work.deferred += 1);
    }

    /// Whether the tree holds a list.
    pub(crate) fn has_lists(&self) -> bool {
        fn any(nodes: &[Mounted]) -> bool {
            nodes.iter().any(|node| matches!(node.extra, Extra::List(_)) || any(&node.children))
        }
        any(&self.nodes)
    }

    /// After a solve: each list's window, nested lists included. Whether one changed.
    pub(crate) fn resolve_lists(&mut self, env: &Env<'_>) -> bool {
        fn walk(nodes: &mut [Mounted], env: &Env<'_>) -> bool {
            let mut changed = false;
            for node in nodes {
                if let Extra::List(list) = &mut node.extra {
                    changed |= list.resolve(env);
                    for item in &mut list.items {
                        if let Some(mounted) = &mut item.mounted {
                            changed |= walk(&mut mounted.tree.nodes, env);
                        }
                    }
                }
                changed |= walk(&mut node.children, env);
            }
            changed
        }
        walk(&mut self.nodes, env)
    }

    /// Counts every widget of the tree as removed, for a parent dropped whole.
    pub(crate) fn count_removed(&self) {
        self.nodes.iter().for_each(count_removed);
    }

    /// Removes every widget of the tree from `parent`.
    pub fn clear(&mut self, parent: &View) {
        let mut changed = false;
        if !self.nodes.is_empty() {
            parent.clear();
        }
        for node in self.nodes.drain(..) {
            count_removed(&node);
            changed |= has_slot(&node);
        }
        self.ids.clear();
        self.admitted = Admitted::default();
        self.slots_changed = changed;
        self.uncharge();
    }

    /// Gives back the nodes charged to the tree's plugin.
    fn uncharge(&mut self) {
        if let Some((plugin, nodes)) = self.charged.take() {
            limits::release(&plugin, limits::Kind::Nodes, nodes);
        }
    }

    /// Calls `f` with each image widget the tree shows and its source, in the items of its lists too.
    pub(crate) fn each_image(&self, f: &mut dyn FnMut(&Source, &opentui::widget::ImageView)) {
        each(&self.nodes, &mut |node| {
            if let (Node::Image { content, .. }, Extra::Image(image)) = (&node.node, &node.extra) {
                f(content, image);
            }
        });
    }

    /// Whether nothing in the tree shows what the host reads again each revision (a tool call's output): a keep of
    /// its root then changes nothing, and the host may skip the pass (P6a).
    pub fn is_static(&self) -> bool {
        !self.nodes.iter().any(|node| node.dynamic)
    }

    /// Whether the tree's widgets are painted in `theme`: true for an empty tree, which paints nothing.
    pub fn styled_in(&self, theme: &Theme) -> bool {
        self.nodes.is_empty() || self.theme.as_ref() == Some(theme)
    }

    /// Whether the last apply or clear mounted or dropped a nested slot.
    pub fn slots_changed(&self) -> bool {
        self.slots_changed
    }

    /// Calls `f` with each nested slot the tree mounts, in the items of its lists too.
    pub fn each_slot(&self, f: &mut dyn FnMut(&SlotMount)) {
        each(&self.nodes, &mut |node| {
            if let Extra::Slot(Some(slot)) = &node.extra {
                f(slot);
            }
        });
    }

    /// Calls `f` with the source of each Markdown, Diff and Code the tree shows, kept subtrees and the items of its
    /// lists with widgets included.
    pub fn each_source(&self, f: &mut dyn FnMut(&Source)) {
        each(&self.nodes, &mut |node| {
            if let Node::Markdown { source, .. }
            | Node::Diff { content: source, .. }
            | Node::Code { content: source, .. } = &node.node
            {
                f(source);
            }
        });
    }

    /// Moves what the user typed into the tree's inputs, where it is not the value the tree gave, into `drafts`,
    /// with that value.
    pub(crate) fn take_drafts(&self, drafts: &mut Drafts) {
        each(&self.nodes, &mut |node| {
            if let (Some(id), Extra::Input(field, given)) = (node.node.id(), &node.extra) {
                let draft = field.draft();
                if draft.0 != *given.borrow() {
                    drafts.insert(id.to_owned(), (given.borrow().clone(), draft));
                }
            }
        });
    }

    /// Shows in the tree's inputs what the user typed into them before their widgets went, taking it from `drafts`:
    /// where the tree gives the input the value the draft was typed over. A new value replaces the text, as it does
    /// in a mounted input (review carbon-11).
    pub(crate) fn restore_drafts(&self, drafts: &mut Drafts) {
        if drafts.is_empty() {
            return;
        }
        each(&self.nodes, &mut |node| {
            if let (Some(id), Extra::Input(field, given)) = (node.node.id(), &node.extra)
                && let Some((over, draft)) = drafts.remove(id)
                && over == *given.borrow()
            {
                field.restore(&draft);
            }
        });
    }

    /// Where the scroll with id `id` is scrolled, as of the last frame.
    pub fn scroll_position(&self, id: &str) -> Option<(f64, f64)> {
        fn find<'a>(nodes: &'a [Mounted], id: &str) -> Option<&'a Mounted> {
            nodes.iter().find_map(|node| if node.node.id() == Some(id) { Some(node) } else { find(&node.children, id) })
        }
        match &find(&self.nodes, id)?.extra {
            Extra::Scroll(scroll) => Some(scroll.scroll_position()),
            Extra::List(list) => Some(list.scroll.scroll_position()),
            _ => None,
        }
    }

    /// The widget of the node with id `id`, kept subtrees included.
    pub fn widget(&self, id: &str) -> Option<AnyWidget> {
        let mut found = None;
        each(&self.nodes, &mut |node| {
            if found.is_none() && node.node.id() == Some(id) {
                found = Some(node.widget.clone());
            }
        });
        found.flatten()
    }

    /// Of the nodes whose widgets are on `path`, widget ids from the nearest, the id of the nearest, kept subtrees and
    /// the mounted items of lists included: one walk, where [`Self::widget`] for each id would be one walk an id.
    pub fn nearest(&self, path: &[u32]) -> Option<String> {
        let mut best: Option<(usize, String)> = None;
        each(&self.nodes, &mut |node| {
            if let (Some(id), Some(widget)) = (node.node.id(), &node.widget)
                && let Some(at) = path.iter().position(|step| *step == widget.id())
                && best.as_ref().is_none_or(|(nearest, _)| at < *nearest)
            {
                best = Some((at, id.to_owned()));
            }
        });
        best.map(|(_, id)| id)
    }

    /// The ids of the boxes and the fields that can take the focus, in the mounted items of lists too: none in a hidden box, which
    /// OpenTUI focuses not (review carbon-5).
    pub fn focusable(&self) -> Vec<String> {
        let field = crate::loader::native::serves(abi::FOCUS_INPUT);
        fn walk(nodes: &[Mounted], field: bool, out: &mut Vec<String>) {
            for node in nodes.iter().filter(|node| !node.node.is_hidden()) {
                // A box that asks for it, and a field with an id, which takes the focus as a click gives it
                // (`abi::FOCUS_INPUT`).
                let focusable = match &node.node {
                    Node::Box { id: Some(id), interact, .. } if interact.focusable => Some(id),
                    Node::Input { id: Some(id), .. } if field => Some(id),
                    _ => None,
                };
                out.extend(focusable.cloned());
                if let Extra::List(list) = &node.extra {
                    list.items.iter().filter_map(|item| item.mounted.as_ref()).for_each(|mounted| {
                        walk(&mounted.tree.nodes, field, out);
                    });
                }
                walk(&node.children, field, out);
            }
        }
        let mut out = Vec::new();
        walk(&self.nodes, field, &mut out);
        out
    }

    /// The ids the tree holds, when `key` is its only root: what a keep of the whole tree holds again, with no count.
    pub fn held_whole(&self, key: &str) -> Option<usize> {
        matches!(&self.nodes[..], [root] if root.node.id() == Some(key)).then_some(self.ids.len())
    }

    /// Whether a widget of the tree shows the host's code view of a claimed fence ([`Node::Fence`]).
    pub fn holds_fence(&self) -> bool {
        let mut found = false;
        each(&self.nodes, &mut |node| found |= matches!(node.extra, Extra::Fence(_)));
        found
    }

    /// For each id, the ids the tree holds at it and under it: what a node that keeps it holds again. One walk up
    /// from each id, so a view that keeps every card costs one pass, not one a keep.
    pub fn held_counts(&self) -> HashMap<String, usize> {
        let mut counts: HashMap<&str, usize> = HashMap::with_capacity(self.ids.len());
        let mut visits = 0;
        for key in self.ids.keys() {
            let mut at = Some(key.as_str());
            while let Some(id) = at {
                *counts.entry(id).or_default() += 1;
                visits += 1;
                at = self.ids.get(id).and_then(|held| held.above.as_deref());
            }
        }
        count(|work| work.held += visits);
        counts.into_iter().map(|(id, count)| (id.to_owned(), count)).collect()
    }

    /// The ids the tree holds.
    pub fn ids(&self) -> impl Iterator<Item = &str> {
        self.ids.keys().map(String::as_str)
    }

    /// Whether the tree holds no node.
    pub fn is_empty(&self) -> bool {
        self.nodes.is_empty()
    }

    /// Checks `nodes` against the contract and the limits ([`crate::limits`]), and returns what it holds of this tree
    /// and which nodes stand as placeholders. The walk stops at the depth bound, so a deeper tree costs no more than
    /// one at the bound.
    ///
    /// A node is over a limit by itself (its text, its hunks, its content, its image), or when it would take the tree
    /// past its nodes or its rows with all its subtree: the first such node in tree order is a placeholder, and the
    /// walk goes on, so a later, smaller sibling may still fit. A subtree a placeholder stands for is checked against
    /// the contract all the same: a malformed tree is refused whole, wherever it is malformed.
    fn validate(&self, env: &Env<'_>, nodes: &[Node]) -> Result<Plan, Refused> {
        struct Walk<'a, 'b> {
            tree: &'a Tree,
            env: &'a Env<'b>,
            ids: HashSet<&'a str>,
            /// Every keep, for the checks; `held` are the ones adopted, outside every placeholder.
            keeps: HashSet<&'a str>,
            held: HashSet<&'a str>,
            moves: HashSet<&'a str>,
            costs: Vec<Cost>,
            at: usize,
            /// The fence nodes seen: one at most, in a fence claim's tree only.
            fences: u32,
            limits: limits::Limits,
            /// The nodes and rows the tree may take, and has taken so far.
            room: (u64, u64),
            used: (u64, u64),
            over: HashMap<*const Node, Option<Node>>,
            admitted: Admitted,
        }
        impl<'a> Walk<'a, '_> {
            /// `item` is the list and the item whose data the nodes are in: a keep there names a node of that item,
            /// and an id there is reconciled within the item. `mode`: how the nodes are counted. `absorbing`: a run
            /// of siblings past the tree's nodes or rows shows one placeholder, the first's, so the host builds one
            /// for each parent at most; the siblings are the nodes, or a list's items.
            fn nodes(
                &mut self,
                nodes: &'a [Node],
                above: u16,
                item: Option<(&'a str, &'a str)>,
                mode: Mode,
                absorbing: &mut bool,
            ) -> Result<(), Refused> {
                for node in nodes {
                    let cost = self.costs[self.at];
                    self.at += 1;
                    let built = item.is_none();
                    if let Node::Keep { key } = node {
                        if self.env.full {
                            return Err(Refused::Kept(key.clone()));
                        }
                        let missing = self.tree.admitted.missing.get(key.as_str()).copied();
                        let held = self.tree.ids.get(key);
                        if held.is_none() && missing.is_none() {
                            return Err(Refused::Unknown(key.clone()));
                        }
                        if let Some(held) = held {
                            if held.item.as_ref().map(|(list, item)| (list.as_str(), item.as_str())) != item {
                                return Err(Refused::Unknown(key.clone()));
                            }
                            if above + held.depth > MAX_DEPTH {
                                return Err(Refused::Deep);
                            }
                        }
                        if self.keeps.contains(key.as_str()) || self.ids.contains(key.as_str()) {
                            return Err(Refused::Duplicate(key.clone()));
                        }
                        // The fence nodes it stands for count as written out: one a tree, in a fence claim's only.
                        let kept = self.tree.admitted.fences.get(key.as_str()).copied().unwrap_or(0);
                        self.fence(kept)?;
                        self.admitted.fences.insert(key.clone(), kept);
                        // A keep inside a placeholder's subtree is checked and not held again.
                        if mode == Mode::Dropped {
                            self.keeps.insert(key);
                            self.admitted.missing.insert(key.clone(), missing.unwrap_or((cost.nodes, cost.rows)));
                            continue;
                        }
                        // A node a placeholder stood for, or a subtree opened, that would fit whole now is asked for
                        // again: the tree holds no widget of what it stands for.
                        let opened = self.tree.admitted.opened.get(key.as_str()).copied();
                        if let Some((nodes, rows)) = missing.or(opened)
                            && (mode == Mode::Admitted || self.fits(&Cost { nodes, rows, ..cost }, built))
                        {
                            return Err(Refused::Unknown(key.clone()));
                        }
                        // What the tree holds under the id, as it holds it, with the tool call outputs under it as
                        // they are now: one admitted otherwise than it shows asks for a whole tree (review bigboi 4).
                        let mut rows = self.tree.admitted.rows.get(key.as_str()).copied().unwrap_or(0);
                        if let (true, None) = (built, missing)
                            && let Some(kept) = find(&self.tree.nodes, key).filter(|kept| kept.dynamic)
                        {
                            let (shown, now, changed) = outputs(self.env, kept, &self.limits);
                            if changed {
                                return Err(Refused::Unknown(key.clone()));
                            }
                            rows = (rows + now).saturating_sub(shown);
                        }
                        let mounted = held.map(|held| Cost { nodes: held.nodes, rows, ..cost });
                        if let (None, Some(mounted)) = (missing, mounted)
                            && (mode == Mode::Admitted || self.fits(&mounted, built))
                        {
                            self.keeps.insert(key);
                            self.held.insert(key);
                            if mode == Mode::Count {
                                self.used.0 += mounted.nodes;
                                self.used.1 += if built { mounted.rows } else { 0 };
                            }
                            self.admitted.rows.insert(key.clone(), mounted.rows);
                            if let Some(opened) = opened {
                                self.admitted.opened.insert(key.clone(), opened);
                            }
                            continue;
                        }
                        // Past the nodes or rows: the first of a run is the placeholder, under the id, and the subtree
                        // the tree had goes where it was; the others are in its run.
                        self.ids.insert(key);
                        let stands = !std::mem::replace(absorbing, true);
                        if stands && built && held.is_some_and(|held| held.item.is_none()) {
                            self.moves.insert(key);
                        }
                        self.admitted.missing.insert(key.clone(), missing.unwrap_or((cost.nodes, cost.rows)));
                        let over = if self.used.0 + cost.nodes > self.room.0 { Over::Nodes } else { Over::Rows };
                        let placeholder = stands.then(|| placeholder(Some(key), &over));
                        self.over.insert(std::ptr::from_ref(node), placeholder);
                        continue;
                    }
                    let depth = above + weight(node);
                    if depth > MAX_DEPTH {
                        return Err(Refused::Deep);
                    }
                    if let Some(id) = node.id()
                        && (!self.ids.insert(id) || self.keeps.contains(id))
                    {
                        return Err(Refused::Duplicate(id.to_owned()));
                    }
                    let unkeyed = node.id().is_none()
                        && match node {
                            Node::Scroll { .. } | Node::Canvas { .. } | Node::List { .. } | Node::Input { .. } => true,
                            Node::Box { anchor, split, .. } => anchor.is_some() || split.is_some(),
                            Node::Diff { hunks, .. } => hunks.is_some(),
                            _ => false,
                        };
                    if unkeyed {
                        return Err(Refused::Unkeyed);
                    }
                    if node.layout_of().is_some_and(|layout| !sizes_ok(layout)) {
                        return Err(Refused::Number);
                    }
                    if let Node::Box { row: false, split: Some(_), .. } = node {
                        return Err(Refused::Split);
                    }
                    if let Node::Image { content: Source::PartOutput(_), .. } = node {
                        return Err(Refused::Output);
                    }
                    let fences = self.fences;
                    if let Node::Fence { .. } = node {
                        self.fence(1)?;
                    }
                    if let Node::List { items, .. } = node
                        && items.iter().map(|item| u64::from(item.estimate.max(1))).sum::<u64>() > MAX_ROWS
                    {
                        return Err(Refused::Rows);
                    }
                    let source = match node {
                        Node::Markdown { source, .. }
                        | Node::Diff { content: source, .. }
                        | Node::Code { content: source, .. }
                        | Node::Image { content: source, .. } => Some(source),
                        _ => None,
                    };
                    if let Some(Source::Content(content)) = source
                        && !(self.env.content)(*content)
                    {
                        return Err(Refused::Content(*content));
                    }
                    let start = self.used.1;
                    let (inner, stands) = match mode {
                        Mode::Dropped => {
                            if let Some(id) = node.id() {
                                self.admitted.missing.insert(id.to_owned(), (cost.nodes, cost.rows));
                            }
                            (Mode::Dropped, false)
                        }
                        _ => match self.admit(node, source, &cost, built, mode) {
                            Ok(inner) => (inner, true),
                            Err(over) => {
                                // A placeholder costs a node and a row while the tree has them, and none past them.
                                let counted = matches!(over, Over::Nodes | Over::Rows)
                                    || !self.fits(&Cost { nodes: 1, rows: 1, ..cost }, built);
                                let stands = !(counted && std::mem::replace(absorbing, true));
                                // An admitted subtree counted the node already.
                                if stands && !counted && mode == Mode::Count {
                                    self.used.0 += 1;
                                    self.used.1 += u64::from(built);
                                }
                                if let (true, Some(id)) = (counted, node.id()) {
                                    self.admitted.missing.insert(id.to_owned(), (cost.nodes, cost.rows));
                                }
                                self.over
                                    .insert(std::ptr::from_ref(node), stands.then(|| placeholder(node.id(), &over)));
                                (Mode::Dropped, stands)
                            }
                        },
                    };
                    // A node of another kind under the id is built new where the subtree is reconciled. A node in a
                    // list's item is reconciled within its item, and one that was is built new elsewhere. A
                    // placeholder keeps the id of the node it stands for; a node it absorbs goes.
                    if let Some(id) = node.id()
                        && stands
                        && built
                        && self.tree.ids.get(id).is_some_and(|held| held.item.is_none())
                    {
                        self.moves.insert(id);
                    }
                    self.nodes(node.children(), depth, item, inner, &mut false)?;
                    if let (Node::List { items, .. }, Some(list)) = (node, node.id()) {
                        let mut absorbing = false;
                        for entry in items {
                            let key = entry.node.id().ok_or(Refused::Unkeyed)?;
                            let entry = std::slice::from_ref(&entry.node);
                            self.nodes(entry, depth, Some((list, key)), inner, &mut absorbing)?;
                        }
                    }
                    if let Some(id) = node.id() {
                        self.admitted.fences.insert(id.to_owned(), self.fences - fences);
                    }
                    // What a keep of the id stands for: a node opened stands for its whole subtree, and the subtree
                    // under an id built the rows its nodes took.
                    if let (Some(id), true) = (node.id(), stands) {
                        if mode == Mode::Count && inner == Mode::Count {
                            self.admitted.opened.insert(id.to_owned(), (cost.nodes, cost.rows));
                        }
                        let rows = if mode == Mode::Count { self.used.1 - start } else { cost.rows };
                        self.admitted.rows.insert(id.to_owned(), rows);
                    }
                }
                Ok(())
            }

            /// Counts `count` more fence nodes: a tree holds one at most, and only a fence claim's.
            fn fence(&mut self, count: u32) -> Result<(), Refused> {
                self.fences += count;
                match count > 0 && (self.env.fence.is_none() || self.fences > 1) {
                    true => Err(Refused::Fence),
                    false => Ok(()),
                }
            }

            /// Admits `node`, with `cost`, and returns how its children are counted; or why it is over a limit.
            /// `built`: the host builds it now, not a list's item data. Over a limit by itself (its text, its hunks,
            /// its content, its image) it is a placeholder. Counted, it is taken whole when its subtree fits in what
            /// the tree has left; else a node the host builds that has children is opened, taking its own share, and
            /// each child is admitted in turn; else it is a placeholder, which costs nothing.
            fn admit(
                &mut self,
                node: &Node,
                source: Option<&Source>,
                cost: &Cost,
                built: bool,
                mode: Mode,
            ) -> Result<Mode, Over> {
                if built {
                    if cost.text > self.limits.text {
                        return Err(Over::Text(cost.text));
                    }
                    if cost.hunks > self.limits.hunks {
                        return Err(Over::Hunks(cost.hunks));
                    }
                    if let Some(Source::Content(content)) = source
                        && (self.env.dropped)(*content)
                    {
                        return Err(Over::Content);
                    }
                }
                let inner = match mode {
                    Mode::Count if self.fits(cost, built) => {
                        self.used.0 += cost.nodes;
                        self.used.1 += if built { cost.rows } else { 0 };
                        Mode::Admitted
                    }
                    Mode::Count
                        if built
                            && opens(node)
                            && self.fits(&Cost { nodes: 1, rows: cost.own_rows, ..*cost }, built) =>
                    {
                        self.used.0 += 1;
                        self.used.1 += cost.own_rows;
                        Mode::Count
                    }
                    Mode::Count if self.used.0 + cost.nodes > self.room.0 => return Err(Over::Nodes),
                    Mode::Count => return Err(Over::Rows),
                    mode => mode,
                };
                // An image is admitted by its header once the tree has room for it, which starts its decode.
                if let (true, Node::Image { content, .. }) = (built, node)
                    && matches!((self.env.image)(content), Picture::Over)
                {
                    return Err(Over::Image);
                }
                Ok(inner)
            }

            /// Whether a subtree of `cost` fits in what the tree has left.
            fn fits(&self, cost: &Cost, built: bool) -> bool {
                self.used.0 + cost.nodes <= self.room.0 && (!built || self.used.1 + cost.rows <= self.room.1)
            }
        }

        let limits = limits::get();
        // What the tree holds now is given back when it is replaced.
        let nodes_room = match (env.item, env.plugin) {
            (true, _) => u64::MAX,
            (false, None) => limits.nodes,
            (false, Some(plugin)) => {
                let own = self.charged.as_ref().filter(|(owner, _)| **owner == *plugin).map_or(0, |(_, held)| *held);
                limits.nodes.min(limits::room(plugin, limits::Kind::Nodes, own))
            }
        };
        let mut costs = Vec::new();
        for node in nodes {
            self.measure(env, node, 0, true, &mut costs);
        }
        let mut walk = Walk {
            tree: self,
            env,
            ids: HashSet::new(),
            keeps: HashSet::new(),
            held: HashSet::new(),
            moves: HashSet::new(),
            costs,
            at: 0,
            fences: 0,
            limits,
            room: (nodes_room, limits.rows),
            used: (0, 0),
            over: HashMap::new(),
            admitted: Admitted::default(),
        };
        walk.nodes(nodes, 0, None, Mode::Count, &mut false)?;
        let moves = walk.moves.iter().map(|id| (*id).to_owned()).collect();
        let (over, used) = (Rc::new(std::mem::take(&mut walk.over)), walk.used.0);
        let (admitted, rows) = (std::mem::take(&mut walk.admitted), walk.used.1);
        if walk.keeps.is_empty() {
            return Ok(Plan { keeps: HashSet::new(), moves, over, nodes: used, admitted, rows });
        }
        // An id of the tree, or a keep, may not be one inside a subtree it keeps. Each ancestor is checked once.
        let mut clear: HashSet<&str> = HashSet::new();
        for id in walk.ids.iter().chain(&walk.keeps) {
            let mut chain = Vec::new();
            let mut above = self.ids.get(*id).and_then(|held| held.above.as_deref());
            while let Some(ancestor) = above {
                if clear.contains(ancestor) {
                    break;
                }
                if walk.keeps.contains(ancestor) {
                    return Err(Refused::Duplicate((*id).to_owned()));
                }
                chain.push(ancestor);
                above = self.ids.get(ancestor).and_then(|held| held.above.as_deref());
            }
            clear.extend(chain);
        }
        let keeps = walk.held.into_iter().map(str::to_owned).collect();
        Ok(Plan { keeps, moves, over, nodes: used, admitted, rows })
    }

    /// Pushes the cost of `node` and of each node under it, in the order [`Tree::validate`] walks them, and returns
    /// the nodes and rows of its subtree. `built`: the host builds it now, not a list's item data, which counts no
    /// rows and whose text is not read. Past the depth bound it stops: validation refuses the node there.
    fn measure(&self, env: &Env<'_>, node: &Node, above: u16, built: bool, costs: &mut Vec<Cost>) -> (u64, u64) {
        let index = costs.len();
        costs.push(Cost::default());
        // A keep costs what it stands for: a node a placeholder stood for, or a subtree opened, its whole subtree;
        // else what the tree holds under it.
        if let Node::Keep { key } = node {
            let admitted = &self.admitted;
            let held =
                || (self.ids.get(key).map_or(1, |held| held.nodes), admitted.rows.get(key).copied().unwrap_or(0));
            let (nodes, rows) = admitted.missing.get(key).or(admitted.opened.get(key)).copied().unwrap_or_else(held);
            costs[index] = Cost { nodes, rows, ..Cost::default() };
            return (nodes, if built { rows } else { 0 });
        }
        let mut cost = if built { text_cost(env, node) } else { Cost::default() };
        let depth = above + weight(node);
        let (mut nodes, mut rows) = (1, cost.own_rows);
        if depth <= MAX_DEPTH {
            for child in node.children() {
                let (inner, built_rows) = self.measure(env, child, depth, built, costs);
                (nodes, rows) = (nodes + inner, rows + built_rows);
            }
            if let Node::List { items, .. } = node {
                for item in items {
                    nodes += self.measure(env, &item.node, depth, false, costs).0;
                }
            }
        }
        (cost.nodes, cost.rows) = (nodes, rows);
        costs[index] = cost;
        (nodes, rows)
    }
}

/// How validation counts nodes against the tree's limits.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Mode {
    /// Each node is admitted in turn.
    Count,
    /// An ancestor was taken whole, so its subtree is counted.
    Admitted,
    /// A placeholder stands for the nodes: they are checked against the contract only.
    Dropped,
}

/// Whether a node the host builds can be opened to admit its children one by one.
fn opens(node: &Node) -> bool {
    match node {
        Node::List { items, .. } => !items.is_empty(),
        node => !node.children().is_empty(),
    }
}

/// What a node costs the host: the nodes and the rows built at once of its subtree, its own rows, and its text and
/// hunks.
#[derive(Clone, Copy, Debug, Default)]
struct Cost {
    nodes: u64,
    rows: u64,
    own_rows: u64,
    text: u64,
    hunks: u64,
}

/// The bytes of a node's text that cost the host a row, however its lines break: a line of 1 MiB wraps and lays out
/// as about 1,024 rows do (review carbon 2.3; `steps/plugins-pl.md`, 4 ms for a text of 1 MiB).
const ROW_BYTES: u64 = 1024;
/// What a patch's hunk costs the host, in rows: each is a diff view of its own, with its code views, and costs about
/// what 30 texts do (`steps/plugins-pl.md`, the probe of `plugin_limits.rs`).
const HUNK_ROWS: u64 = 30;
/// What a line of code costs the host, in rows: its first frame highlights it.
const CODE_ROWS: u64 = 2;
/// The lines of an added file over 3,000 lines that the host builds at once: it mounts only the chunks near the view
/// (`opencode_ui::diff::Chunked`), four of 128 lines, each a hunk.
const CHUNKED_ROWS: u64 = 512 + 4 * HUNK_ROWS;

/// A node's own text and rows, by what each costs the host (the probe of `plugin_limits.rs`): a node is one row, a
/// text's or Markdown's line one more, a line of code two, a patch's line one and its hunk [`HUNK_ROWS`].
fn text_cost(env: &Env<'_>, node: &Node) -> Cost {
    let read = |source: &Source| match source {
        Source::Content(content) if (env.dropped)(*content) => Measure::default(),
        source => (env.measure)(source),
    };
    let (text, rows, hunks) = match node {
        Node::Diff { content: source, .. } | Node::Code { content: source, .. } | Node::Markdown { source, .. } => {
            let text = read(source);
            (text.bytes, rows_of(node, text) - 1, if matches!(node, Node::Diff { .. }) { text.hunks } else { 0 })
        }
        Node::Text { spans, .. } => {
            let bytes: u64 = spans.iter().map(|span| span.text.len() as u64).sum();
            let breaks: u64 =
                spans.iter().map(|span| span.text.bytes().filter(|byte| *byte == b'\n').count() as u64).sum();
            (bytes, breaks + bytes / ROW_BYTES, 0)
        }
        Node::Input { value, .. } => (value.len() as u64, value.len() as u64 / ROW_BYTES, 0),
        _ => (0, 0, 0),
    };
    Cost { own_rows: 1 + rows, text, hunks, ..Cost::default() }
}

/// The rows a patch, code or Markdown node builds for text that measures `text`, its own row included: a line of
/// code two, a patch's line one and its hunk [`HUNK_ROWS`]; an added file over 3,000 lines builds its chunks near the
/// view, and validation reads no chunk.
fn rows_of(node: &Node, text: Measure) -> u64 {
    1 + text.bytes / ROW_BYTES
        + match node {
            Node::Diff { .. } if text.chunked => CHUNKED_ROWS,
            Node::Diff { .. } => text.lines + HUNK_ROWS * text.hunks,
            Node::Code { .. } => CODE_ROWS * text.lines,
            _ => text.lines,
        }
}

/// What a source's text costs the host: its bytes; and, within one node's text, its lines, the hunks it has as a
/// patch, and whether the renderer shows it as an added file in chunks (`opencode_ui::diff::chunks`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Measure {
    pub bytes: u64,
    pub lines: u64,
    pub hunks: u64,
    pub chunked: bool,
}

/// What `text` costs: past one node's text it is not read (review bigboi 2), else it is, and counted.
pub fn measure(text: &str) -> Measure {
    let bytes = text.len() as u64;
    if bytes > limits::get().text {
        return Measure { bytes, ..Measure::default() };
    }
    count(|work| work.scanned += bytes);
    // A last line without its line break is a line too.
    let lines = text.bytes().filter(|byte| *byte == b'\n').count() as u64 + u64::from(!text.ends_with('\n'));
    let hunks = opencode_ui::diff::hunk_count(text) as u64;
    Measure { bytes, lines, hunks, chunked: opencode_ui::diff::chunks(text) }
}

/// What a mount's content costs, by handle: content never changes, so each handle's bytes are read once a mount, and
/// those past one node's text never (review bigboi 2).
#[derive(Default)]
pub(crate) struct Measures(RefCell<HashMap<ContentRef, Measure>>);

impl Measures {
    pub(crate) fn of(&self, handle: ContentRef, bytes: &[u8]) -> Measure {
        if bytes.len() as u64 > limits::get().text {
            return Measure { bytes: bytes.len() as u64, ..Measure::default() };
        }
        if let Some(measure) = self.0.borrow().get(&handle) {
            return *measure;
        }
        let measure = measure(&String::from_utf8_lossy(bytes));
        self.0.borrow_mut().insert(handle, measure);
        measure
    }

    /// Forgets the handles `keep` does not keep.
    pub(crate) fn retain(&self, keep: impl Fn(&ContentRef) -> bool) {
        self.0.borrow_mut().retain(|handle, _| keep(handle));
    }
}

/// The placeholder that stands for a node over a limit: one muted row that says why, under the node's id.
fn placeholder(id: Option<&str>, over: &Over) -> Node {
    let mut node = Node::text(vec![abi::Span::new(format!("⋯ {over}"))]);
    if let Node::Text { id: own, fg, selectable, .. } = &mut node {
        *own = id.map(str::to_owned);
        *fg = Some(abi::Color::from("text.muted"));
        *selectable = false;
    }
    node
}

/// Puts in `nodes` each placeholder of `over` in place of its node, and drops the nodes a placeholder stands for.
fn project(nodes: &mut Vec<Node>, over: &Placeholders) {
    let kept: Vec<bool> = nodes.iter_mut().map(|node| substitute(node, over)).collect();
    let mut kept = kept.into_iter();
    nodes.retain(|_| kept.next().unwrap_or(true));
}

/// Puts the placeholder of `node` in its place, or projects what is under it; `false` for a node a placeholder stands
/// for. Moving a node leaves the nodes under it where they are, so their addresses still find them.
fn substitute(node: &mut Node, over: &Placeholders) -> bool {
    match over.get(&std::ptr::from_ref(node)) {
        Some(Some(placeholder)) => *node = placeholder.clone(),
        Some(None) => return false,
        None => match node {
            Node::Box { children, .. } | Node::Scroll { children, .. } => project(children, over),
            Node::List { items, .. } => {
                let kept: Vec<bool> = items.iter_mut().map(|item| substitute(&mut item.node, over)).collect();
                let mut kept = kept.into_iter();
                items.retain(|_| kept.next().unwrap_or(true));
            }
            _ => {}
        },
    }
    true
}

/// Moves each subtree `plan` holds again from `nodes` into `pool`, leaving an [`Extra::Taken`] in its place: a kept
/// one whole, and one held by id with each subtree under it that is held again taken out too.
fn take(nodes: &mut [Mounted], plan: &Plan, pool: &mut HashMap<String, Mounted>) {
    for node in nodes {
        if matches!(node.extra, Extra::Taken) {
            continue;
        }
        let Some(id) = node.node.id().map(str::to_owned) else {
            take(&mut node.children, plan, pool);
            continue;
        };
        let kept = plan.keeps.contains(&id);
        if !kept {
            take(&mut node.children, plan, pool);
        }
        if kept || plan.moves.contains(&id) {
            let taken = Mounted {
                node: Node::Keep { key: id.clone() },
                widget: node.widget.clone(),
                children: Vec::new(),
                extra: Extra::Taken,
                dynamic: false,
                stood: None,
            };
            pool.insert(id, std::mem::replace(node, taken));
        }
    }
}

/// Records every id of `nodes`, under `above`; returns the layout levels the deepest of them takes, and the nodes
/// of their subtrees, lists' item data included.
fn collect_ids(nodes: &[Mounted], above: Option<&str>, ids: &mut HashMap<String, Held>) -> (u16, u64) {
    let (mut deepest, mut count) = (0, 0);
    for node in nodes {
        let id = node.node.id();
        let (mut inner, mut within) = collect_ids(&node.children, id.or(above), ids);
        if let (Extra::List(list), Some(id)) = (&node.extra, id) {
            let (depth, items) = list.collect_ids(id, ids);
            (inner, within) = (inner.max(depth), within + items);
        }
        let (depth, nodes) = (weight(&node.node) + inner, 1 + within);
        if let Some(id) = id {
            ids.insert(id.to_owned(), Held { above: above.map(str::to_owned), depth, nodes, item: None });
        }
        (deepest, count) = (deepest.max(depth), count + nodes);
    }
    (deepest, count)
}

/// The node of `nodes`' subtrees under id `id`, outside their lists' items.
fn find<'a>(nodes: &'a [Mounted], id: &str) -> Option<&'a Mounted> {
    nodes.iter().find_map(|node| if node.node.id() == Some(id) { Some(node) } else { find(&node.children, id) })
}

/// Calls `f` with each node of `nodes`' subtrees, the items of their lists with widgets included.
fn each(nodes: &[Mounted], f: &mut dyn FnMut(&Mounted)) {
    for node in nodes {
        f(node);
        if let Extra::List(list) = &node.extra {
            for item in &list.items {
                if let Some(mounted) = &item.mounted {
                    each(&mounted.tree.nodes, f);
                }
            }
        }
        each(&node.children, f);
    }
}

/// Whether `widget` is in the app's tree.
fn attached(app: &App, widget: &AnyWidget) -> bool {
    let root = app.root().id();
    let mut at = widget.clone();
    while let Some(parent) = at.parent() {
        at = parent;
    }
    at.id() == root
}

impl Pass<'_, '_> {
    /// The children `new` of `parent` reconciled with `old`, in place. A child with an id is the subtree the tree
    /// before held under that id, wherever it was; one without is the next child of `old` without one, of its kind.
    fn children(&mut self, parent: &View, old: Vec<Mounted>, new: &[Node]) -> Vec<Mounted> {
        // A node over a limit is its placeholder from here on.
        let over = self.over.clone();
        let (new, stood): (Vec<&Node>, Vec<Option<&Node>>) = new
            .iter()
            .filter_map(|node| match over.get(&std::ptr::from_ref(node)) {
                Some(placeholder) => placeholder.as_ref().map(|placeholder| (placeholder, Some(node))),
                None => Some((node, None)),
            })
            .unzip();
        let slots = old.iter().any(|node| matches!(node.node, Node::Slot { .. }))
            || new.iter().any(|node| matches!(node, Node::Slot { .. }));
        if slots && !self.stays(&old, &new) {
            // A nested slot puts its claims straight into the parent, where nothing else can place them: build all
            // of the parent's children again. The old slots go first, so a claim hears it unmounts before it mounts
            // again; the other old widgets go once the subtrees under them that are held again have moved.
            parent.clear();
            for mut node in old {
                self.release_slots(&mut node);
                self.doom(node);
            }
            return new.iter().zip(&stood).map(|(node, stood)| stands_for(self.placed(parent, node), *stood)).collect();
        }
        // The widgets as they are in `parent`, when they are there: the children of a box built again are in the
        // old one.
        let here = old
            .iter()
            .find_map(|node| node.widget.as_ref())
            .is_none_or(|widget| widget.parent().is_some_and(|above| above.id() == parent.id()));
        let before: Vec<Option<u32>> = match here {
            true => old.iter().map(|node| node.widget.as_ref().map(Widget::id)).collect(),
            false => Vec::new(),
        };
        let matched = matches(&old, &new);
        let mut olds: Vec<Option<Mounted>> = old.into_iter().map(Some).collect();
        let mut out = Vec::with_capacity(new.len());
        // Whether each child's widget is one the tree had before.
        let mut reused = Vec::with_capacity(new.len());
        for ((node, found), stood) in new.iter().zip(matched).zip(&stood) {
            let held = match node.id() {
                Some(id) => self.pool.remove(id),
                None => found.and_then(|index| olds[index].take()),
            };
            let (mounted, kept) = match held {
                Some(old) => self.adopt(old, node),
                None => (self.build(node), false),
            };
            out.push(stands_for(mounted, *stood));
            reused.push(kept);
        }
        olds.into_iter().flatten().for_each(|node| self.doom(node));
        if out.iter().map(|node| node.widget.as_ref().map(Widget::id)).eq(before) {
            return out;
        }
        place(parent, &out, &reused);
        out
    }

    /// Whether `new` keeps every child of `old` where it is, with its widget: a parent with a slot can be
    /// reconciled in place only then. A child with an id may come from anywhere, so it does not.
    fn stays(&self, old: &[Mounted], new: &[&Node]) -> bool {
        old.len() == new.len()
            && old.iter().zip(new).all(|(old, new)| {
                let node = &old.node;
                new.id().is_none()
                    && same_kind(node, new)
                    && match (node, new) {
                        (Node::Box { .. }, Node::Box { .. }) => !matches!(box_change(node, new), Change::Replace),
                        (Node::Text { .. }, Node::Text { .. }) => !matches!(text_change(node, new), Change::Replace),
                        (Node::Slot { path }, Node::Slot { path: next }) => path == next,
                        _ => true,
                    }
            })
    }

    /// `old` reconciled with `node`, and whether it kept its widget; a replaced one is dropped.
    fn adopt(&mut self, old: Mounted, node: &Node) -> (Mounted, bool) {
        match self.reconcile(old, node) {
            Ok(mounted) => (mounted, true),
            Err(replaced) => {
                let (old, built) = *replaced;
                self.doom(old);
                (built, false)
            }
        }
    }

    /// Reconciles in place, or returns the old node with a new one built instead, for the caller to place. A box or
    /// a scroll built again takes the children of the old one, reconciled.
    fn reconcile(&mut self, mut old: Mounted, new: &Node) -> Result<Mounted, Box<(Mounted, Mounted)>> {
        if let Node::Keep { .. } = new {
            count(|work| work.kept += 1);
            self.revisit(&mut old);
            return Ok(old);
        }
        if !same_kind(&old.node, new) {
            let built = self.build(new);
            return Err(Box::new((old, built)));
        }
        let theme = self.env.theme;
        match (&old.node, new) {
            (Node::Box { .. }, Node::Box { children, .. }) => {
                match box_change(&old.node, new) {
                    Change::Same => {
                        if self.restyle {
                            self.restyle(&old);
                        }
                    }
                    Change::InPlace => {
                        let Extra::Box { view, click, wired, .. } = &old.extra else { unreachable!() };
                        if bg_of(&old.node) != bg_of(new) {
                            match wired {
                                Some(wired) => {
                                    wired.base.set(fill(theme, bg_of(new)));
                                    view.bg(wired.shown());
                                }
                                None => drop(view.bg(fill(theme, bg_of(new)))),
                            }
                        }
                        if let (Some(cell), Some(next)) = (click, click_of(new)) {
                            *cell.borrow_mut() = next.clone();
                        }
                        // Shown or hidden on the widget it has: its children, and the claims a slot of it put in
                        // it, stay where they are (P6a review, big-boi).
                        if old.node.is_hidden() != new.is_hidden() {
                            view.visible(!new.is_hidden());
                        }
                        old.node = shell(new);
                        if self.restyle {
                            self.restyle(&old);
                        }
                        count(|work| work.set += 1);
                    }
                    Change::Replace => {
                        // Its own widget is built again; the children move into it as they are reconciled. A split
                        // keeps the width the user dragged it to.
                        let mut built = self.shell(new);
                        if let (Extra::Box { split: Some(was), .. }, Extra::Box { split: Some(now), .. }) =
                            (&old.extra, &built.extra)
                        {
                            now.take_from(was);
                        }
                        let Extra::Box { view, split, .. } = &built.extra else { unreachable!() };
                        let (view, split) = (view.clone(), split.clone());
                        let olds = self.movable(std::mem::take(&mut old.children));
                        built.children = self.children(&view, olds, children);
                        built.dynamic = built.children.iter().any(|child| child.dynamic);
                        if let Some(split) = split {
                            split.first(built.children.first().and_then(|child| child.widget.clone()));
                        }
                        return Err(Box::new((old, built)));
                    }
                }
                let Extra::Box { view, split, .. } = &old.extra else { unreachable!() };
                let (view, split) = (view.clone(), split.clone());
                let olds = std::mem::take(&mut old.children);
                old.children = self.children(&view, olds, children);
                old.dynamic = old.children.iter().any(|child| child.dynamic);
                if let Some(split) = split {
                    split.first(old.children.first().and_then(|child| child.widget.clone()));
                }
                Ok(old)
            }
            (Node::Scroll { .. }, Node::Scroll { height, follow, children, .. }) => {
                let Extra::Scroll(scroll) = &old.extra else { unreachable!() };
                let scroll = scroll.clone();
                let Node::Scroll { height: was, follow: followed, layout, .. } = &old.node else { unreachable!() };
                let Node::Scroll { layout: next, .. } = new else { unreachable!() };
                if layout != next || was.is_some() != height.is_some() {
                    // Built again, it keeps where it was scrolled and the focus.
                    let mut built = self.shell(new);
                    let Extra::Scroll(next) = &built.extra else { unreachable!() };
                    let (x, y) = scroll.scroll_position();
                    next.scroll_to(x, y);
                    if self.env.host.app().focused().is_some_and(|focused| focused.id() == scroll.id()) {
                        self.refocus = Some(next.as_any());
                    }
                    let content = next.content_view().clone();
                    let olds = self.movable(std::mem::take(&mut old.children));
                    built.children = self.children(&content, olds, children);
                    built.dynamic = built.children.iter().any(|child| child.dynamic);
                    return Err(Box::new((old, built)));
                }
                if was != height || followed != follow {
                    if let Some(height) = height {
                        scroll.height(*height);
                    }
                    scroll.sticky(*follow);
                    count(|work| work.set += 1);
                }
                // `notify_top` and `user_scroll` are the behaviors' to read; no widget holds them.
                old.node = shell(new);
                let content = scroll.content_view().clone();
                let olds = std::mem::take(&mut old.children);
                old.children = self.children(&content, olds, children);
                old.dynamic = old.children.iter().any(|child| child.dynamic);
                Ok(old)
            }
            (Node::Text { .. }, Node::Text { .. }) => match text_change(&old.node, new) {
                Change::Same => {
                    if self.restyle {
                        self.restyle(&old);
                    }
                    Ok(old)
                }
                Change::InPlace => {
                    old.node = new.clone();
                    paint_text(&old, theme);
                    if let (Extra::Text { click: Some(cell), .. }, Some(next)) = (&old.extra, click_of(new)) {
                        *cell.borrow_mut() = next.clone();
                    }
                    count(|work| work.set += 1);
                    Ok(old)
                }
                Change::Replace => {
                    let built = self.build(new);
                    Err(Box::new((old, built)))
                }
            },
            (Node::Spinner { label: was, .. }, Node::Spinner { label, id }) => {
                if was != label {
                    if let Extra::Spinner(spinner) = &old.extra {
                        spinner.set_label(Some(label.clone()));
                    }
                    old.node = Node::Spinner { id: id.clone(), label: label.clone() };
                    count(|work| work.set += 1);
                }
                if self.restyle {
                    self.restyle(&old);
                }
                Ok(old)
            }
            // A patch that is or becomes chunked takes new text in place while it stays a large added file, and is
            // built again otherwise; a theme restyles it in place.
            (
                Node::Diff { content: was, filetype: had, padding: padded, .. },
                Node::Diff { content, filetype, padding, .. },
            ) if matches!(old.extra, Extra::Chunked(..))
                || ((was != content || had != filetype || matches!(content, Source::PartOutput(_)))
                    && opencode_ui::diff::chunks(&self.text(content))) =>
            {
                let text = (was != content || matches!(content, Source::PartOutput(_))).then(|| self.text(content));
                let syntax = self.syntax();
                if let (Extra::Chunked(chunked, shown), true) = (&mut old.extra, (had, padded) == (filetype, padding)) {
                    match text.filter(|text| text != shown) {
                        None => {}
                        Some(text) if chunked.set_patch(&text) => {
                            *shown = text;
                            count(|work| {
                                work.parses += 1;
                                work.set += 1;
                            });
                        }
                        Some(_) => {
                            let built = self.build(new);
                            return Err(Box::new((old, built)));
                        }
                    }
                    if self.restyle {
                        chunked.restyle(self.env.theme, &syntax);
                        count(|work| work.set += 1);
                    }
                    old.node = new.clone();
                    old.dynamic = dynamic(new, &[]);
                    return Ok(old);
                }
                let built = self.build(new);
                Err(Box::new((old, built)))
            }
            (Node::Input { lines: had, layout: laid, .. }, Node::Input { value, placeholder, lines, layout, .. }) => {
                if had != lines || laid != layout {
                    // Built again, it keeps what the user typed, where the value stays, and the focus.
                    let built = self.build(new);
                    let (Extra::Input(was, given), Extra::Input(field, ..)) = (&old.extra, &built.extra) else {
                        unreachable!()
                    };
                    let draft = was.draft();
                    if *given.borrow() == *value && draft.0 != *value {
                        field.restore(&draft);
                    }
                    if self.env.host.app().focused().is_some_and(|focused| focused.id() == was.widget().id()) {
                        self.refocus = Some(field.widget());
                    }
                    return Err(Box::new((old, built)));
                }
                let Node::Input { placeholder: shown, .. } = &old.node else { unreachable!() };
                let placeholder_changed = shown != placeholder;
                let Extra::Input(field, given) = &old.extra else { unreachable!() };
                // The text is the host's: a value the tree did not change leaves what the user typed.
                if *given.borrow() != *value {
                    field.set(value);
                    *given.borrow_mut() = value.clone();
                    count(|work| work.set += 1);
                }
                if placeholder_changed {
                    match field {
                        Field::Line(input) => drop(input.placeholder(placeholder)),
                        Field::Lines(area) => drop(area.placeholder(placeholder)),
                    }
                    count(|work| work.set += 1);
                }
                old.node = new.clone();
                if self.restyle {
                    self.restyle(&old);
                }
                Ok(old)
            }
            (Node::List { row: was, layout: laid, .. }, Node::List { row, layout, items, .. }) => {
                let restyle = self.restyle;
                if was != row || laid != layout {
                    // Built again, it takes the old one's items, their widgets and measures, its offset and the
                    // reading position, so a keep of an item still holds; and the focus.
                    let mut built = self.shell(new);
                    let (Extra::List(was), Extra::List(list)) = (&mut old.extra, &mut built.extra) else {
                        unreachable!()
                    };
                    list.take_from(was);
                    if self.env.host.app().focused().is_some_and(|focused| focused.id() == was.scroll.id()) {
                        self.refocus = Some(list.scroll.as_any());
                    }
                    list.reconcile(self.env, items, restyle, &self.over);
                    built.dynamic = list.dynamic();
                    return Err(Box::new((old, built)));
                }
                let Extra::List(list) = &mut old.extra else { unreachable!() };
                list.reconcile(self.env, items, restyle, &self.over);
                old.dynamic = list.dynamic();
                old.node = shell(new);
                Ok(old)
            }
            (
                Node::Code { content: was, filetype: had, numbers: numbered, layout: laid, .. },
                Node::Code { content, filetype, numbers, layout, .. },
            ) => {
                if laid != layout {
                    let built = self.build(new);
                    return Err(Box::new((old, built)));
                }
                let reread = was != content || matches!(content, Source::PartOutput(_));
                let (filetype_changed, numbers_changed) = (had != filetype, numbered != numbers);
                let text = reread.then(|| self.text(content));
                let Extra::Code(code, shown) = &mut old.extra else { unreachable!() };
                if filetype_changed {
                    code.filetype(filetype.as_deref());
                    count(|work| {
                        work.parses += 1;
                        work.set += 1;
                    });
                }
                if numbers_changed {
                    code.line_numbers(*numbers);
                    count(|work| work.set += 1);
                }
                if let Some(text) = text.filter(|text| text != shown) {
                    code.set_code(text.to_string());
                    *shown = text;
                    count(|work| {
                        work.parses += 1;
                        work.set += 1;
                    });
                }
                old.node = new.clone();
                old.dynamic = dynamic(new, &[]);
                if self.restyle {
                    self.restyle(&old);
                }
                Ok(old)
            }
            (Node::Image { content: was, fit: had, layout: laid, .. }, Node::Image { content, fit, layout, .. }) => {
                if laid != layout {
                    let built = self.build(new);
                    return Err(Box::new((old, built)));
                }
                let (reread, fit_changed) = (was != content, had != fit);
                let Extra::Image(image) = &mut old.extra else { unreachable!() };
                if fit_changed {
                    image.fit(image_fit(*fit));
                    count(|work| work.set += 1);
                }
                if reread {
                    image.image(decoded(self.env, content));
                    count(|work| work.set += 1);
                }
                old.node = new.clone();
                Ok(old)
            }
            (Node::Diff { .. }, Node::Diff { .. }) | (Node::Markdown { .. }, Node::Markdown { .. }) => {
                // Both change in place: a patch or Markdown shows its new text, a patch its new view.
                let text = match (&old.node, new) {
                    (
                        Node::Diff { content: was, filetype: had, wrap: wrapped, padding: padded, .. },
                        Node::Diff { content: source, filetype, wrap, padding, .. },
                    ) if was == source
                        && (had, wrapped, padded) == (filetype, wrap, padding)
                        && !matches!(source, Source::PartOutput(_)) =>
                    {
                        None
                    }
                    (Node::Markdown { source: was, .. }, Node::Markdown { source, .. })
                        if was == source && !matches!(source, Source::PartOutput(_)) =>
                    {
                        None
                    }
                    (_, Node::Diff { content: source, .. } | Node::Markdown { source, .. }) => Some(self.text(source)),
                    _ => unreachable!(),
                };
                // A patch whose language, wrap or padding changes shows its lines again.
                let filetype_changed = matches!((&old.node, new),
                    (Node::Diff { filetype: had, wrap: wrapped, padding: padded, .. },
                        Node::Diff { filetype, wrap, padding, .. })
                        if (had, wrapped, padded) != (filetype, wrap, padding));
                let view_changed = matches!((&old.node, new),
                    (Node::Diff { view: had, .. }, Node::Diff { view, .. }) if had != view);
                old.node = new.clone();
                old.dynamic = dynamic(new, &[]);
                self.show(&mut old, text, filetype_changed, view_changed);
                Ok(old)
            }
            (Node::Canvas { layout: was, .. }, Node::Canvas { layout, version, animate, .. }) => {
                let Extra::Canvas(canvas) = &old.extra else { unreachable!() };
                if was != layout {
                    // Built again alone, it keeps its list, its version and its animation.
                    let built = canvas.rebuilt(self.env.host.app());
                    built.set(*version, *animate);
                    lay_out(&built.widget(), layout);
                    count(|work| work.created += 1);
                    let built = Mounted {
                        node: new.clone(),
                        widget: Some(built.widget()),
                        children: Vec::new(),
                        extra: Extra::Canvas(built),
                        dynamic: false,
                        stood: None,
                    };
                    return Err(Box::new((old, built)));
                }
                if old.node != *new {
                    canvas.set(*version, *animate);
                    old.node = new.clone();
                    count(|work| work.set += 1);
                }
                Ok(old)
            }
            (Node::Fence { .. }, Node::Fence { .. }) => {
                // Its code is the host's, current with no view: only its box changes, built again with the code view
                // moved into it.
                if old.node != *new || self.restyle {
                    let built = self.build(new);
                    return Err(Box::new((old, built)));
                }
                Ok(old)
            }
            (Node::Slot { path: was }, Node::Slot { path }) => {
                // A slot's claims restyle as they render; a slot of another path is built where it is.
                debug_assert_eq!(was, path, "a parent with a slot changes only in place");
                Ok(old)
            }
            _ => unreachable!("same_kind matched the kinds"),
        }
    }

    /// Shows a patch's or a Markdown's node in its widget: `text` when it is new, else its view when it changed and
    /// its theme. OpenTUI's diff builds its lines again on any setter, so nothing unchanged is set.
    fn show(&mut self, mounted: &mut Mounted, text: Option<Rc<str>>, rebuild: bool, view_changed: bool) {
        let env = self.env;
        let syntax = self.syntax();
        match (&mounted.node, &mut mounted.extra) {
            (Node::Diff { view, filetype, wrap, padding, .. }, Extra::Diff(patch, shown)) => {
                let text = text.filter(|text| rebuild || text != shown);
                match text {
                    Some(text) => {
                        patch.set_patch(
                            env.host.app(),
                            env.theme,
                            &syntax,
                            &text,
                            diff_view(*view),
                            filetype.as_deref(),
                            wrap_mode(*wrap),
                            u32::from(*padding),
                        );
                        *shown = text;
                        count(|work| {
                            work.parses += 1;
                            work.set += 1;
                        });
                    }
                    None => {
                        if view_changed {
                            patch.set_view(diff_view(*view));
                            count(|work| work.set += 1);
                        }
                        if self.restyle {
                            patch.restyle(env.theme, &syntax);
                            count(|work| work.set += 1);
                        }
                    }
                }
            }
            (Node::Diff { .. }, Extra::Chunked(chunked, shown)) => {
                // A kept large added file whose new text is not one stays as it was.
                match text.filter(|text| text != shown) {
                    Some(text) if chunked.set_patch(&text) => {
                        *shown = text;
                        count(|work| {
                            work.parses += 1;
                            work.set += 1;
                        });
                    }
                    Some(_) => log::warn!("a kept patch is no longer a large added file; it shows its old text"),
                    None => {}
                }
                if self.restyle {
                    chunked.restyle(env.theme, &syntax);
                    count(|work| work.set += 1);
                }
            }
            (Node::Markdown { .. }, Extra::Markdown(markdown, shown)) => {
                if self.restyle {
                    let colors = opencode_ui::markdown::view_colors(env.theme, &syntax);
                    opencode_ui::markdown::restyle(markdown, colors, &syntax);
                    count(|work| work.set += 1);
                }
                if let Some(text) = text.filter(|text| text != shown) {
                    markdown.set_markdown(&*text);
                    *shown = text;
                    count(|work| work.set += 1);
                }
            }
            _ => {}
        }
    }

    /// Restyles a subtree held again in a new theme, and shows the tool call output a node of it reads as it is now.
    fn revisit(&mut self, mounted: &mut Mounted) {
        match &mounted.node {
            Node::Diff { content: source, .. } | Node::Markdown { source, .. } => {
                let text = matches!(source, Source::PartOutput(_)).then(|| self.text(source));
                self.show(mounted, text, false, false);
            }
            Node::Code { content: source @ Source::PartOutput(_), .. } => {
                let text = self.text(source);
                if let Extra::Code(code, shown) = &mut mounted.extra
                    && text != *shown
                {
                    code.set_code(text.to_string());
                    *shown = text;
                    count(|work| {
                        work.parses += 1;
                        work.set += 1;
                    });
                }
                if self.restyle {
                    self.restyle(mounted);
                }
            }
            _ if self.restyle => self.restyle(mounted),
            _ => {}
        }
        let dynamic = mounted.dynamic;
        if let (true, Extra::List(list)) = (self.restyle || dynamic, &mut mounted.extra) {
            list.revisit(self.env, self.restyle);
        }
        let restyle = self.restyle;
        for child in &mut mounted.children {
            if restyle || child.dynamic {
                self.revisit(child);
            }
        }
    }

    /// Paints a node's own colors again, for a new theme.
    fn restyle(&mut self, mounted: &Mounted) {
        let theme = self.env.theme;
        match (&mounted.node, &mounted.extra) {
            (Node::Box { bg, border, interact, .. }, Extra::Box { view, split, wired, .. }) => {
                match wired {
                    Some(wired) => {
                        wired.base.set(fill(theme, bg.as_ref()));
                        wired.hover.set(color(theme, interact.hover.as_ref()));
                        view.bg(wired.shown());
                    }
                    None if bg.is_some() => drop(view.bg(fill(theme, bg.as_ref()))),
                    None => {}
                }
                if let Some(border) = border {
                    bordered(view, theme, border);
                }
                if let Some(split) = split {
                    split.restyle(theme);
                }
            }
            (Node::Text { .. }, Extra::Text { .. }) => paint_text(mounted, theme),
            (Node::Spinner { .. }, Extra::Spinner(spinner)) => spinner.set_color(theme.interactive().step(200)),
            (Node::Input { .. }, Extra::Input(field, ..)) => paint_field(field, theme),
            (Node::Code { .. }, Extra::Code(code, _)) => {
                code.fg(theme.text.base).line_number_fg(theme.text.muted).syntax_theme((*self.syntax()).clone());
            }
            // Under a keep too: the code view in it is the host's, which restyles with its fence (carbon c2a-3).
            (Node::Fence { bg: Some(bg), .. }, Extra::Fence(view)) => drop(view.bg(fill(theme, Some(bg)))),
            _ => return,
        }
        count(|work| work.set += 1);
    }

    /// The text of `source`; empty while the host has none.
    fn text(&self, source: &Source) -> Rc<str> {
        (self.env.source)(source).unwrap_or_else(|| Rc::from(""))
    }

    /// The syntax theme of the pass's theme, made once.
    fn syntax(&self) -> Rc<SyntaxTheme> {
        self.syntax.get_or_init(|| Rc::new(opencode_ui::code::syntax_theme(self.env.theme))).clone()
    }

    /// `node` built and added to `parent`.
    fn placed(&mut self, parent: &View, node: &Node) -> Mounted {
        if let Node::Slot { path } = node {
            let slot = (self.env.slot)(parent, path);
            self.slots_changed = true;
            return Mounted {
                node: node.clone(),
                widget: None,
                children: Vec::new(),
                extra: Extra::Slot(slot),
                dynamic: false,
                stood: None,
            };
        }
        let mounted = self.build(node);
        if let Some(widget) = &mounted.widget {
            parent.add(widget);
        }
        mounted
    }

    /// `node` built, not yet in a parent; or, for an id the tree before held, that subtree reconciled. A slot needs
    /// its parent and is never built here: a parent with a slot is built through [`Pass::placed`].
    fn build(&mut self, node: &Node) -> Mounted {
        if let Some(held) = node.id().and_then(|id| self.pool.remove(id)) {
            return self.adopt(held, node).0;
        }
        let mut mounted = self.shell(node);
        let mut listed = false;
        match (node, &mut mounted.extra) {
            (Node::Box { children, .. }, Extra::Box { view, split, .. }) => {
                let (view, split) = (view.clone(), split.clone());
                mounted.children = self.children(&view, Vec::new(), children);
                if let Some(split) = split {
                    split.first(mounted.children.first().and_then(|child| child.widget.clone()));
                }
            }
            (Node::Scroll { children, .. }, Extra::Scroll(scroll)) => {
                let content = scroll.content_view().clone();
                mounted.children = self.children(&content, Vec::new(), children);
            }
            (Node::List { items, .. }, Extra::List(list)) => {
                list.reconcile(self.env, items, false, &self.over);
                listed = list.dynamic();
            }
            _ => {}
        }
        mounted.dynamic = listed || dynamic(node, &mounted.children);
        mounted
    }

    /// The widget of `node` alone, without its children.
    fn shell(&mut self, node: &Node) -> Mounted {
        let env = self.env;
        let theme = env.theme;
        let app = env.host.app();
        count(|work| work.created += 1);
        let (widget, extra): (AnyWidget, Extra) = match node {
            Node::Box {
                row,
                gap,
                padding,
                justify,
                align,
                bg,
                layout,
                on_click,
                border,
                padding_sides,
                wrap,
                overflow,
                split,
                interact,
                id,
                visible,
                sticky,
                ..
            } => {
                let view = View::new(app);
                if *row {
                    view.row();
                }
                // P6c: a sticky box paints over the siblings it is pinned above, as CSS's sticky stacks.
                if sticky.is_some() {
                    view.z_index(1);
                }
                if !*visible {
                    view.visible(false);
                }
                if *gap > 0 {
                    view.gap(*gap);
                }
                match padding_sides {
                    Some(edges) => {
                        for (edge, cells) in edges_of(edges) {
                            view.padding_edge(edge, cells.max(0));
                        }
                    }
                    None => {
                        if padding.0 > 0 {
                            view.padding_x(padding.0);
                        }
                        if padding.1 > 0 {
                            view.padding_y(padding.1);
                        }
                    }
                }
                if let Some(border) = border {
                    bordered(&view, theme, border);
                }
                if *wrap {
                    view.flex_wrap(opentui::layout::Wrap::Wrap);
                }
                if *overflow == abi::Overflow::Hidden {
                    view.overflow(opentui::layout::Overflow::Hidden);
                }
                match justify {
                    abi::Justify::Start => {}
                    abi::Justify::End => drop(view.justify(Justify::End)),
                    abi::Justify::Center => drop(view.justify(Justify::Center)),
                    abi::Justify::SpaceBetween => drop(view.justify(Justify::SpaceBetween)),
                    abi::Justify::SpaceAround => drop(view.justify(Justify::SpaceAround)),
                }
                match align {
                    abi::Align::Stretch => {}
                    abi::Align::Start => drop(view.align_items(Align::Start)),
                    abi::Align::Center => drop(view.align_items(Align::Center)),
                    abi::Align::End => drop(view.align_items(Align::End)),
                }
                if let Some(bg) = color(theme, bg.as_ref()) {
                    view.bg(bg);
                }
                let wired = (!interact.is_none()).then(|| {
                    let hover = color(theme, interact.hover.as_ref());
                    let (base, paint): (_, fn(&View, Color)) =
                        (fill(theme, bg.as_ref()), |view, color| drop(view.bg(color)));
                    crate::interact::wire(&view, paint, id.as_deref(), interact, env.owner, base, hover)
                });
                // After the pointer handler: a press it consumes runs no click, one it passes does.
                let click = on_click.clone().map(|click| clickable(&view, click, env.act));
                lay_out(&view, layout);
                let split = split.map(|split| crate::behave::SplitState::attach(app, &view, split, theme));
                (view.as_any(), Extra::Box { view, click, split, wired })
            }
            Node::Text { id, spans, fg, wrap, truncate, selectable, hover_fg, layout, on_click, hover_events } => {
                let base = color(theme, fg.as_ref()).unwrap_or(theme.text.base);
                let text = Text::new(app, spans.iter().map(|span| styled(theme, span, None)).collect::<Vec<_>>())
                    .fg(base)
                    .wrap(wrap_mode(*wrap))
                    .truncate(*truncate)
                    .selectable(*selectable);
                let held = Rc::new(text.clone());
                // A pointer color the theme lacks is the text's own, so another theme can have it.
                let hover = hover_fg.as_ref().map(|over| {
                    let over = color(theme, Some(over)).unwrap_or(base);
                    let hover = Rc::new(Hover { colors: Cell::new((base, over)), over: Cell::new(false) });
                    hoverable(&held, hover.clone());
                    hover
                });
                let click = on_click.clone().map(|click| clickable(&text, click, env.act));
                let events = abi::interact::Interact { hover_events: true, ..Default::default() };
                let wired = hover_events.then(|| {
                    let paint: fn(&Text, Color) = |_, _| {};
                    crate::interact::wire(&text, paint, id.as_deref(), &events, env.owner, base, None)
                });
                lay_out(&text, layout);
                (text.as_any(), Extra::Text { text: held, click, hover, _wired: wired })
            }
            Node::Spinner { label, .. } => {
                let spinner =
                    opencode_ui::motion::Spinner::new(app).color(theme.interactive().step(200)).label(label.clone());
                (spinner.as_any(), Extra::Spinner(spinner))
            }
            Node::Markdown { source, .. } => {
                let text = self.text(source);
                let markdown = env.host.markdown(&text);
                (markdown.as_any(), Extra::Markdown(markdown, text))
            }
            Node::Scroll { height, follow, layout, .. } => {
                // A scroll may be smaller than its content, as CSS's `overflow` makes `min-height: auto` zero; one that
                // cannot shrink below its content takes the content's height, and every row is laid out and painted.
                let scroll = ScrollBox::new(app).scrollbars(false).min_height(0);
                if let Some(height) = height {
                    scroll.height(*height).shrink(0.0);
                }
                if *follow {
                    scroll.sticky(true);
                }
                lay_out(&scroll, layout);
                // A growing scroll starts from nothing, as CSS's `flex: 1`, so it takes the room its siblings leave
                // and never squeezes them to fit its content.
                if layout.grow {
                    scroll.basis(0);
                }
                (scroll.as_any(), Extra::Scroll(scroll))
            }
            Node::Input { id, value, placeholder, lines, layout } => {
                let field = match lines {
                    None => Field::Line(opentui::widget::Input::new(app).placeholder(placeholder).set_value(value)),
                    Some(rows) => Field::Lines(
                        opentui::widget::Textarea::new(app)
                            .placeholder(placeholder)
                            .set_text(value)
                            .height(u32::from(*rows))
                            .shrink(0.0),
                    ),
                };
                paint_field(&field, theme);
                // With an id, its edits reach the mount's handler. The id stays while the field does: another builds it
                // again.
                if let (Some(id), Some(owner)) = (id.clone(), env.owner.cloned()) {
                    let hear = |submit: bool| {
                        let (node, owner) = (id.clone(), owner.clone());
                        move |_: &mut Cx<'_>, text: &str| {
                            let (node, text) = (node.clone(), text.to_owned());
                            let event = match submit {
                                true => abi::interact::Event::Submit { node, text },
                                false => abi::interact::Event::Change { node, text },
                            };
                            if let Some(owner) = owner.upgrade() {
                                owner.hear(&event);
                            }
                        }
                    };
                    match &field {
                        Field::Line(input) => drop(input.on_change(hear(false)).on_submit(hear(true))),
                        Field::Lines(area) => drop(area.on_change(hear(false)).on_submit(hear(true))),
                    }
                }
                let widget = field.widget();
                lay_out(&widget, layout);
                (widget, Extra::Input(field, RefCell::new(value.clone())))
            }
            Node::List { row, layout, .. } => {
                let list = List::new(app, *row);
                lay_out(&list.scroll, layout);
                if layout.grow {
                    list.scroll.basis(0);
                }
                (list.scroll.as_any(), Extra::List(Box::new(list)))
            }
            Node::Code { content, filetype, numbers, layout, .. } => {
                let text = self.text(content);
                let code = opencode_ui::code::view(app, theme, &self.syntax(), filetype.as_deref(), &text)
                    .line_numbers(*numbers)
                    .line_number_fg(theme.text.muted);
                lay_out(&code, layout);
                count(|work| work.parses += 1);
                (code.as_any(), Extra::Code(code, text))
            }
            Node::Image { content, fit, layout, .. } => {
                let image = opentui::widget::ImageView::new(app).fit(image_fit(*fit)).image(decoded(env, content));
                lay_out(&image, layout);
                (image.as_any(), Extra::Image(image))
            }
            Node::Diff { content, view, filetype, wrap, padding, .. } => {
                let text = self.text(content);
                count(|work| work.parses += 1);
                let syntax = self.syntax();
                let padding = u32::from(*padding);
                match opencode_ui::diff::Chunked::new(app, theme, &syntax, &text, filetype.as_deref(), padding) {
                    Some(chunked) => (chunked.root().as_any(), Extra::Chunked(Rc::new(chunked), text)),
                    None => {
                        let view = diff_view(*view);
                        let wrap = wrap_mode(*wrap);
                        let patch = Patch::new(app, theme, &syntax, &text, view, filetype.as_deref(), wrap, padding);
                        (patch.view().as_any(), Extra::Diff(patch, text))
                    }
                }
            }
            Node::Canvas { id, layout, version, animate } => {
                let canvas = Canvas::new(app, id.as_deref().unwrap_or_default(), env.draw.cloned(), *version, *animate);
                lay_out(&canvas.widget(), layout);
                (canvas.widget(), Extra::Canvas(canvas))
            }
            Node::Fence { bg, layout, .. } => {
                let view = View::new(app).column().shrink(0.0);
                if let Some(bg) = color(theme, bg.as_ref()) {
                    view.bg(bg);
                }
                lay_out(&view, layout);
                // Validation admitted the node only where the host has the fence's code view.
                if let Some(code) = env.fence.and_then(|fence| fence()) {
                    view.add(&code);
                }
                (view.as_any(), Extra::Fence(view))
            }
            Node::Slot { .. } | Node::Keep { .. } => unreachable!("a slot is placed, and a keep is held"),
        };
        Mounted { node: shell(node), widget: Some(widget), children: Vec::new(), extra, dynamic: false, stood: None }
    }

    /// Drops the nested slots of `node` now, outside the subtrees held again.
    fn release_slots(&mut self, node: &mut Mounted) {
        match &mut node.extra {
            Extra::Taken => return,
            Extra::Slot(slot) => {
                if slot.take().is_some() {
                    self.slots_changed = true;
                }
            }
            _ => {}
        }
        node.children.iter_mut().for_each(|child| self.release_slots(child));
    }

    /// The children of a widget built again, to move into the new one: none when one is a slot, whose claims sit in
    /// the old widget and nothing can move, so all of them are built again there, the slots first going (as
    /// [`Self::children`] does for a slot that does not stay).
    fn movable(&mut self, old: Vec<Mounted>) -> Vec<Mounted> {
        if !old.iter().any(|node| matches!(node.node, Node::Slot { .. })) {
            return old;
        }
        for mut node in old {
            self.release_slots(&mut node);
            self.doom(node);
        }
        Vec::new()
    }

    /// Drops `node` once every subtree held again has moved out of it. A placeholder of one drops nothing.
    fn doom(&mut self, node: Mounted) {
        if matches!(node.extra, Extra::Taken) {
            return;
        }
        self.doomed.push(node);
    }
}

/// Puts the widgets of `out` in `parent` in their order, moving only those out of place. OpenTUI paints and hit-tests
/// siblings of one z-index in child order, so they paint as a fresh mount's do where they overlap. The parent's other
/// children are the old ones that go after the pass; they are stepped over.
fn place(parent: &View, out: &[Mounted], reused: &[bool]) {
    let widgets: Vec<(&AnyWidget, bool)> = out
        .iter()
        .zip(reused)
        .filter_map(|(node, reused)| node.widget.as_ref().map(|widget| (widget, *reused)))
        .collect();
    let wanted: HashSet<u32> = widgets.iter().map(|(widget, _)| widget.id()).collect();
    let mut children: Vec<u32> = parent.children().iter().map(Widget::id).collect();
    let mut at = 0;
    for (widget, reused) in widgets {
        while children.get(at).is_some_and(|id| !wanted.contains(id)) {
            at += 1;
        }
        if children.get(at) != Some(&widget.id()) {
            // Not yet placed, so it is after `at` or in another parent; OpenTUI's index counts the other children.
            children.retain(|id| *id != widget.id());
            children.insert(at, widget.id());
            parent.insert(at, widget);
            if reused {
                count(|work| work.moved += 1);
            }
        }
        at += 1;
    }
}

/// For each of `new` without an id, the index of the child of `old` it is reconciled with: the next one without an
/// id, of its kind. A child with an id comes from the subtrees held again.
fn matches(old: &[Mounted], new: &[&Node]) -> Vec<Option<usize>> {
    let mut cursor: HashMap<std::mem::Discriminant<Node>, usize> = HashMap::new();
    new.iter()
        .map(|node| {
            if node.id().is_some() {
                return None;
            }
            let kind = std::mem::discriminant(*node);
            let start = cursor.get(&kind).copied().unwrap_or(0);
            let found = (start..old.len())
                .find(|&index| old[index].node.id().is_none() && std::mem::discriminant(&old[index].node) == kind);
            cursor.insert(kind, found.map_or(old.len(), |index| index + 1));
            found
        })
        .collect()
}

/// `mounted`, a placeholder for `stood`, remembering a node that reads a tool call's output; or `mounted` as it is.
fn stands_for(mut mounted: Mounted, stood: Option<&Node>) -> Mounted {
    mounted.stood = stood.filter(|stood| dynamic(stood, &[])).map(|stood| Box::new(stood.clone()));
    mounted.dynamic |= mounted.stood.is_some();
    mounted
}

/// What the tool call outputs under `mounted` cost now, as [`Tree::validate`] admits a keep of it: the rows of the
/// nodes that show one, as they show it and as it is now; and whether one would be admitted otherwise than it shows,
/// over a limit by itself now, or a placeholder for one within its limits now.
fn outputs(env: &Env<'_>, mounted: &Mounted, limits: &limits::Limits) -> (u64, u64, bool) {
    let over = |cost: &Cost| cost.text > limits.text || cost.hunks > limits.hunks;
    let (mut shown, mut now, mut changed) = (0, 0, false);
    match (&mounted.stood, &mounted.extra) {
        (Some(stood), _) => changed |= !over(&text_cost(env, stood)),
        (None, Extra::Diff(_, text) | Extra::Chunked(_, text) | Extra::Markdown(_, text) | Extra::Code(_, text))
            if dynamic(&mounted.node, &[]) =>
        {
            let cost = text_cost(env, &mounted.node);
            changed |= over(&cost);
            (shown, now) = (rows_of(&mounted.node, measure(text)), cost.own_rows);
        }
        _ => {}
    }
    for child in mounted.children.iter().filter(|child| child.dynamic) {
        let (inner_shown, inner_now, inner_changed) = outputs(env, child, limits);
        (shown, now, changed) = (shown + inner_shown, now + inner_now, changed || inner_changed);
    }
    (shown, now, changed)
}

/// Whether `node`, with `children` under it, shows a tool call's output.
fn dynamic(node: &Node, children: &[Mounted]) -> bool {
    matches!(
        node,
        Node::Diff { content: Source::PartOutput(_), .. }
            | Node::Markdown { source: Source::PartOutput(_), .. }
            | Node::Code { content: Source::PartOutput(_), .. }
    ) || children.iter().any(|child| child.dynamic)
}

fn diff_view(view: DiffView) -> opentui::widget::DiffView {
    match view {
        DiffView::Unified => opentui::widget::DiffView::Unified,
        DiffView::Split => opentui::widget::DiffView::Split,
    }
}

/// Drops `node` and its widgets, counting them; a slot's claims go with it.
fn drop_mounted(node: Mounted, slots_changed: &mut bool) {
    if let Some(widget) = &node.widget {
        widget.detach();
    }
    *slots_changed |= has_slot(&node);
    count_removed(&node);
}

fn count_removed(node: &Mounted) {
    if matches!(node.extra, Extra::Taken) {
        return;
    }
    if !matches!(node.extra, Extra::Slot(_)) {
        count(|work| work.removed += 1);
    }
    if let Extra::List(list) = &node.extra {
        list.count_removed();
    }
    node.children.iter().for_each(count_removed);
}

fn has_slot(node: &Mounted) -> bool {
    let mut found = false;
    each(std::slice::from_ref(node), &mut |node| found |= matches!(node.extra, Extra::Slot(_)));
    found
}

fn same_kind(old: &Node, new: &Node) -> bool {
    std::mem::discriminant(old) == std::mem::discriminant(new)
}

/// The node without its children, which are kept apart.
fn shell(node: &Node) -> Node {
    match node {
        Node::Box {
            id,
            row,
            gap,
            padding,
            justify,
            align,
            bg,
            layout,
            on_click,
            border,
            padding_sides,
            wrap,
            overflow,
            sticky,
            anchor,
            split,
            interact,
            visible,
            ..
        } => Node::Box {
            id: id.clone(),
            row: *row,
            gap: *gap,
            padding: *padding,
            justify: *justify,
            align: *align,
            bg: bg.clone(),
            layout: *layout,
            on_click: on_click.clone(),
            children: Vec::new(),
            border: border.clone(),
            padding_sides: *padding_sides,
            wrap: *wrap,
            overflow: *overflow,
            sticky: *sticky,
            anchor: anchor.clone(),
            split: *split,
            interact: interact.clone(),
            visible: *visible,
        },
        Node::Scroll { id, height, follow, layout, notify_top, user_scroll, .. } => Node::Scroll {
            id: id.clone(),
            height: *height,
            follow: *follow,
            layout: *layout,
            children: Vec::new(),
            notify_top: notify_top.clone(),
            user_scroll: *user_scroll,
        },
        Node::List { id, row, layout, notify_top, user_scroll, .. } => Node::List {
            id: id.clone(),
            row: *row,
            items: Vec::new(),
            layout: *layout,
            notify_top: notify_top.clone(),
            user_scroll: *user_scroll,
        },
        _ => node.clone(),
    }
}

/// OpenTUI's wrap of `wrap`.
fn wrap_mode(wrap: abi::Wrap) -> WrapMode {
    match wrap {
        abi::Wrap::Word => WrapMode::Word,
        abi::Wrap::Char => WrapMode::Char,
        abi::Wrap::None => WrapMode::None,
    }
}

/// How a node of the same kind and id changes.
enum Change {
    Same,
    InPlace,
    Replace,
}

fn bg_of(node: &Node) -> Option<&abi::Color> {
    match node {
        Node::Box { bg, .. } => bg.as_ref(),
        _ => None,
    }
}

fn click_of(node: &Node) -> Option<&abi::Click> {
    match node {
        Node::Box { on_click, .. } | Node::Text { on_click, .. } => on_click.as_ref(),
        _ => None,
    }
}

/// A box changes in place when only its background, its click (one to another), its anchor and whether it shows
/// change; its children are reconciled apart.
fn box_change(old: &Node, new: &Node) -> Change {
    let (
        Node::Box { bg, on_click, anchor, visible, .. },
        Node::Box { bg: bg2, on_click: on_click2, anchor: anchor2, visible: visible2, .. },
    ) = (old, new)
    else {
        return Change::Replace;
    };
    // Everything but the background, the click, the anchor and whether it shows, children aside, must stay.
    let rest = |node: &Node| match node {
        Node::Box {
            id,
            row,
            gap,
            padding,
            justify,
            align,
            layout,
            border,
            padding_sides,
            wrap,
            overflow,
            sticky,
            split,
            interact,
            ..
        } => Some((
            (id.clone(), *row, *gap, *padding, *justify, *align, *layout),
            (border.clone(), *padding_sides, *wrap, *overflow, *sticky, *split),
            interact.clone(),
        )),
        _ => None,
    };
    if rest(old) != rest(new) || on_click.is_some() != on_click2.is_some() {
        return Change::Replace;
    }
    match bg == bg2 && on_click == on_click2 && anchor == anchor2 && visible == visible2 {
        true => Change::Same,
        false => Change::InPlace,
    }
}

/// Paints an input in `theme`'s form field colors.
fn paint_field(field: &Field, theme: &Theme) {
    let (text, background) = (&theme.text.formfield, &theme.background.formfield);
    match field {
        Field::Line(input) => drop(
            input
                .colors(text.base, background.base)
                .focused_colors(text.focused, background.focused)
                .placeholder_color(theme.text.muted),
        ),
        Field::Lines(area) => drop(
            area.colors(text.base, background.base)
                .focused_colors(text.focused, background.focused)
                .placeholder_color(theme.text.muted),
        ),
    }
}

/// The image `source` decoded to, once its worker is done.
fn decoded(env: &Env<'_>, source: &Source) -> Option<opentui::native::Image> {
    match (env.image)(source) {
        Picture::Ready(image) => Some(image),
        Picture::Pending | Picture::Over => None,
    }
}

fn image_fit(fit: opencode_plugin_abi::v2::Fit) -> opentui::native::ImageFit {
    match fit {
        opencode_plugin_abi::v2::Fit::Contain => opentui::native::ImageFit::Contain,
        opencode_plugin_abi::v2::Fit::Cover => opentui::native::ImageFit::Cover,
        opencode_plugin_abi::v2::Fit::Fill => opentui::native::ImageFit::Fill,
    }
}

/// A text changes in place when its spans, its color and its click (one to another) change, and nothing else;
/// a text whose pointer color changes or that gains or loses a click is built again.
fn text_change(old: &Node, new: &Node) -> Change {
    let (
        Node::Text { id, spans, fg, wrap, truncate, selectable, hover_fg, layout, on_click, hover_events },
        Node::Text {
            id: id2,
            spans: spans2,
            fg: fg2,
            wrap: wrap2,
            truncate: truncate2,
            selectable: selectable2,
            hover_fg: hover2,
            layout: layout2,
            on_click: on_click2,
            hover_events: events2,
        },
    ) = (old, new)
    else {
        return Change::Replace;
    };
    if (id, wrap, truncate, selectable, hover_fg, layout, hover_events)
        != (id2, wrap2, truncate2, selectable2, hover2, layout2, events2)
        || on_click.is_some() != on_click2.is_some()
    {
        return Change::Replace;
    }
    if spans == spans2 && fg == fg2 && on_click == on_click2 { Change::Same } else { Change::InPlace }
}

/// A box's fill: its color, or none. A view cannot drop its fill, so none is a transparent one, which paints as no
/// fill does.
fn fill(theme: &Theme, bg: Option<&abi::Color>) -> Color {
    color(theme, bg).unwrap_or(Color::rgba(0, 0, 0, 0))
}

/// Paints a text's spans and color from its node in `theme`.
fn paint_text(mounted: &Mounted, theme: &Theme) {
    let (Node::Text { spans, fg, hover_fg, .. }, Extra::Text { text, hover, .. }) = (&mounted.node, &mounted.extra)
    else {
        return;
    };
    let base = color(theme, fg.as_ref()).unwrap_or(theme.text.base);
    text.set_text(spans.iter().map(|span| styled(theme, span, None)).collect::<Vec<_>>());
    let over = color(theme, hover_fg.as_ref()).unwrap_or(base);
    match hover {
        Some(hover) => {
            hover.colors.set((base, over));
            text.fg(if hover.over.get() { over } else { base });
        }
        None => drop(text.fg(base)),
    }
}

/// Shows the hand over `widget` and runs the click in the cell it returns on the press or the release of the left
/// button; writing the cell changes the click in place.
fn clickable(widget: &impl Widget, click: abi::Click, act: &Act) -> Rc<RefCell<abi::Click>> {
    let cell = Rc::new(RefCell::new(click));
    let (held, act) = (cell.clone(), act.clone());
    widget.mouse_pointer(MousePointer::POINTER).on_mouse(move |_, event| {
        let click = held.borrow().clone();
        let hit = match event.kind {
            MouseEventKind::Down(MouseButton::Left) => click.on == abi::Press::Down,
            MouseEventKind::Up(MouseButton::Left) => click.on == abi::Press::Up,
            _ => false,
        };
        if hit {
            act(&click.action);
        }
    });
    cell
}

/// A text's colors off and under the pointer, and whether the pointer is over it, which a text written in place
/// keeps.
pub(crate) struct Hover {
    colors: Cell<(Color, Color)>,
    over: Cell<bool>,
}

/// Paints `text` in its pointer color while the pointer is over it. The text owns its handler, which holds it weakly
/// so the text drops with its node.
fn hoverable(text: &Rc<Text>, hover: Rc<Hover>) {
    let this: Weak<Text> = Rc::downgrade(text);
    text.on_hover(move |cx, hovered| {
        if let Some(this) = this.upgrade() {
            hover.over.set(hovered);
            let (base, over) = hover.colors.get();
            this.fg(if hovered { over } else { base });
            cx.app().request_redraw();
        }
    });
}
