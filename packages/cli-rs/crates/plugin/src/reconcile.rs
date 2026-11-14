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
    /// Patches parsed for a [`Node::Diff`].
    pub parses: u64,
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
/// and Markdown a few levels of its own.
fn weight(node: &Node) -> u16 {
    match node {
        Node::Box { .. } | Node::Text { .. } | Node::Spinner { .. } | Node::Slot { .. } => 1,
        Node::Scroll { .. } | Node::Diff { .. } | Node::Markdown { .. } => 4,
        Node::Keep { .. } => 0,
    }
}

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
    /// A scroll without an id: a node with state must have one (synthesis 4.2), or another scroll's offset could
    /// pass to it.
    Unkeyed,
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
            Refused::Unkeyed => write!(f, "a scroll has no id"),
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
    /// Whether the mount holds content `ContentRef`.
    pub content: &'a dyn Fn(ContentRef) -> bool,
    /// The host asked for a whole tree, after a refusal: a keep names a subtree the view did not vouch for again.
    pub full: bool,
}

/// A mounted tree: the widgets of the last accepted tree, in a parent the owner gives each call.
#[derive(Default)]
pub struct Tree {
    nodes: Vec<Mounted>,
    theme: Option<Theme>,
    /// Every id the tree holds.
    ids: HashMap<String, Held>,
    /// Slots mounted or dropped by the last apply.
    slots_changed: bool,
}

/// What the tree holds under an id: the nearest ancestor with an id, and the layout levels its subtree takes.
#[derive(Clone, Debug)]
struct Held {
    above: Option<String>,
    depth: u16,
}

struct Mounted {
    /// The node as it was adopted; a box's and a scroll's children are in `children`, not here.
    node: Node,
    /// The widget it put in its parent; `None` for a slot, whose claims go into the parent itself.
    widget: Option<AnyWidget>,
    children: Vec<Mounted>,
    extra: Extra,
    /// It or a node under it shows a tool call's output, which the host reads again each revision.
    dynamic: bool,
}

enum Extra {
    Box {
        view: View,
        click: Option<Rc<RefCell<abi::Click>>>,
    },
    Text {
        text: Rc<Text>,
        click: Option<Rc<RefCell<abi::Click>>>,
        hover: Option<Rc<Hover>>,
    },
    Spinner(opencode_ui::motion::Spinner),
    Scroll(ScrollBox),
    /// The patch, and the text it shows.
    Diff(Patch, Rc<str>),
    /// The Markdown, and the text it shows.
    Markdown(opentui::widget::Markdown, Rc<str>),
    Slot(Option<SlotMount>),
    /// In the tree before, a subtree that the tree being adopted holds again; its widget moved to wherever the tree
    /// has its id now.
    Taken,
}

/// The ids of the tree before that a tree being adopted holds again: the ones it keeps, and the ones it has a node
/// for.
struct Plan {
    keeps: HashSet<String>,
    moves: HashSet<String>,
}

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
}

impl Tree {
    /// Adopts `nodes` into `parent`, which holds this tree's widgets and nothing else, or refuses it and changes
    /// nothing.
    pub fn apply(&mut self, env: &Env<'_>, parent: &View, nodes: &[Node]) -> Result<(), Refused> {
        let plan = self.validate(env, nodes)?;
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
        // A widget moved within its parent is detached and attached again, which takes the focus from it (OpenTUI's
        // `subtree_removed`): it gets it back, or the widget that took over from it does.
        if app.focused().is_none()
            && let Some(widget) = pass.refocus.take().or(focused.filter(|widget| attached(app, widget)))
        {
            app.focus(&widget);
        }
        self.theme = Some(env.theme.clone());
        self.slots_changed = pass.slots_changed;
        self.ids.clear();
        collect_ids(&self.nodes, None, &mut self.ids);
        Ok(())
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
        self.slots_changed = changed;
    }

    /// Whether the tree's widgets are painted in `theme`: true for an empty tree, which paints nothing.
    pub fn styled_in(&self, theme: &Theme) -> bool {
        self.nodes.is_empty() || self.theme.as_ref() == Some(theme)
    }

    /// Whether the last apply or clear mounted or dropped a nested slot.
    pub fn slots_changed(&self) -> bool {
        self.slots_changed
    }

    /// Calls `f` with each nested slot the tree mounts.
    pub fn each_slot(&self, f: &mut dyn FnMut(&SlotMount)) {
        fn walk(nodes: &[Mounted], f: &mut dyn FnMut(&SlotMount)) {
            for node in nodes {
                if let Extra::Slot(Some(slot)) = &node.extra {
                    f(slot);
                }
                walk(&node.children, f);
            }
        }
        walk(&self.nodes, f);
    }

    /// Calls `f` with the source of each Markdown and Diff the tree shows, kept subtrees included.
    pub fn each_source(&self, f: &mut dyn FnMut(&Source)) {
        fn walk(nodes: &[Mounted], f: &mut dyn FnMut(&Source)) {
            for node in nodes {
                if let Node::Markdown { source, .. } | Node::Diff { content: source, .. } = &node.node {
                    f(source);
                }
                walk(&node.children, f);
            }
        }
        walk(&self.nodes, f);
    }

    /// Where the scroll with id `id` is scrolled, as of the last frame.
    pub fn scroll_position(&self, id: &str) -> Option<(f64, f64)> {
        fn find<'a>(nodes: &'a [Mounted], id: &str) -> Option<&'a Mounted> {
            nodes.iter().find_map(|node| if node.node.id() == Some(id) { Some(node) } else { find(&node.children, id) })
        }
        match &find(&self.nodes, id)?.extra {
            Extra::Scroll(scroll) => Some(scroll.scroll_position()),
            _ => None,
        }
    }

    /// The ids the tree holds.
    pub fn ids(&self) -> impl Iterator<Item = &str> {
        self.ids.keys().map(String::as_str)
    }

    /// Whether the tree holds no node.
    pub fn is_empty(&self) -> bool {
        self.nodes.is_empty()
    }

    /// Checks `nodes` against the contract and returns what it holds of this tree. The walk stops at the depth
    /// bound, so a deeper tree costs no more than one at the bound.
    fn validate(&self, env: &Env<'_>, nodes: &[Node]) -> Result<Plan, Refused> {
        struct Walk<'a, 'b> {
            tree: &'a Tree,
            env: &'a Env<'b>,
            ids: HashSet<&'a str>,
            keeps: HashSet<&'a str>,
            moves: HashSet<&'a str>,
        }
        impl<'a> Walk<'a, '_> {
            fn nodes(&mut self, nodes: &'a [Node], above: u16) -> Result<(), Refused> {
                for node in nodes {
                    if let Node::Keep { key } = node {
                        if self.env.full {
                            return Err(Refused::Kept(key.clone()));
                        }
                        let held = self.tree.ids.get(key).ok_or_else(|| Refused::Unknown(key.clone()))?;
                        if !self.keeps.insert(key) || self.ids.contains(key.as_str()) {
                            return Err(Refused::Duplicate(key.clone()));
                        }
                        if above + held.depth > MAX_DEPTH {
                            return Err(Refused::Deep);
                        }
                        continue;
                    }
                    let depth = above + weight(node);
                    if depth > MAX_DEPTH {
                        return Err(Refused::Deep);
                    }
                    if let Some(id) = node.id() {
                        if !self.ids.insert(id) || self.keeps.contains(id) {
                            return Err(Refused::Duplicate(id.to_owned()));
                        }
                        // A node of another kind under the id is built new where the subtree is reconciled.
                        if self.tree.ids.contains_key(id) {
                            self.moves.insert(id);
                        }
                    }
                    match node {
                        Node::Scroll { id: None, .. } => return Err(Refused::Unkeyed),
                        Node::Box { layout, .. } | Node::Text { layout, .. } | Node::Scroll { layout, .. }
                            if !sizes_ok(layout) =>
                        {
                            return Err(Refused::Number);
                        }
                        Node::Markdown { source: Source::Content(content), .. }
                        | Node::Diff { content: Source::Content(content), .. }
                            if !(self.env.content)(*content) =>
                        {
                            return Err(Refused::Content(*content));
                        }
                        _ => {}
                    }
                    self.nodes(node.children(), depth)?;
                }
                Ok(())
            }
        }
        let mut walk = Walk { tree: self, env, ids: HashSet::new(), keeps: HashSet::new(), moves: HashSet::new() };
        walk.nodes(nodes, 0)?;
        let moves = walk.moves.iter().map(|id| (*id).to_owned()).collect();
        if walk.keeps.is_empty() {
            return Ok(Plan { keeps: HashSet::new(), moves });
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
        Ok(Plan { keeps: walk.keeps.into_iter().map(str::to_owned).collect(), moves })
    }
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
            };
            pool.insert(id, std::mem::replace(node, taken));
        }
    }
}

/// Records every id of `nodes`, under `above`; returns the layout levels the deepest of them takes.
fn collect_ids(nodes: &[Mounted], above: Option<&str>, ids: &mut HashMap<String, Held>) -> u16 {
    let mut deepest = 0;
    for node in nodes {
        let id = node.node.id();
        let depth = weight(&node.node) + collect_ids(&node.children, id.or(above), ids);
        if let Some(id) = id {
            ids.insert(id.to_owned(), Held { above: above.map(str::to_owned), depth });
        }
        deepest = deepest.max(depth);
    }
    deepest
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
        let slots = old.iter().any(|node| matches!(node.node, Node::Slot { .. }))
            || new.iter().any(|node| matches!(node, Node::Slot { .. }));
        if slots && !self.stays(&old, new) {
            // A nested slot puts its claims straight into the parent, where nothing else can place them: build all
            // of the parent's children again. The old slots go first, so a claim hears it unmounts before it mounts
            // again; the other old widgets go once the subtrees under them that are held again have moved.
            parent.clear();
            for mut node in old {
                self.release_slots(&mut node);
                self.doom(node);
            }
            return new.iter().map(|node| self.placed(parent, node)).collect();
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
        let matched = matches(&old, new);
        let mut olds: Vec<Option<Mounted>> = old.into_iter().map(Some).collect();
        let mut out = Vec::with_capacity(new.len());
        // Whether each child's widget is one the tree had before.
        let mut reused = Vec::with_capacity(new.len());
        for (node, found) in new.iter().zip(matched) {
            let held = match node.id() {
                Some(id) => self.pool.remove(id),
                None => found.and_then(|index| olds[index].take()),
            };
            let (mounted, kept) = match held {
                Some(old) => self.adopt(old, node),
                None => (self.build(node), false),
            };
            out.push(mounted);
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
    fn stays(&self, old: &[Mounted], new: &[Node]) -> bool {
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
                        let Extra::Box { view, click } = &old.extra else { unreachable!() };
                        if bg_of(&old.node) != bg_of(new) {
                            view.bg(fill(theme, bg_of(new)));
                        }
                        if let (Some(cell), Some(next)) = (click, click_of(new)) {
                            *cell.borrow_mut() = next.clone();
                        }
                        old.node = shell(new);
                        if self.restyle {
                            self.restyle(&old);
                        }
                        count(|work| work.set += 1);
                    }
                    Change::Replace => {
                        // Its own widget is built again; the children move into it as they are reconciled.
                        let mut built = self.shell(new);
                        let Extra::Box { view, .. } = &built.extra else { unreachable!() };
                        let view = view.clone();
                        built.children = self.children(&view, std::mem::take(&mut old.children), children);
                        built.dynamic = built.children.iter().any(|child| child.dynamic);
                        return Err(Box::new((old, built)));
                    }
                }
                let Extra::Box { view, .. } = &old.extra else { unreachable!() };
                let view = view.clone();
                let olds = std::mem::take(&mut old.children);
                old.children = self.children(&view, olds, children);
                old.dynamic = old.children.iter().any(|child| child.dynamic);
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
                    built.children = self.children(&content, std::mem::take(&mut old.children), children);
                    built.dynamic = built.children.iter().any(|child| child.dynamic);
                    return Err(Box::new((old, built)));
                }
                if was != height || followed != follow {
                    if let Some(height) = height {
                        scroll.height(*height);
                    }
                    scroll.sticky(*follow);
                    old.node = shell(new);
                    count(|work| work.set += 1);
                }
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
            (Node::Diff { .. }, Node::Diff { .. }) | (Node::Markdown { .. }, Node::Markdown { .. }) => {
                // Both change in place: a patch or Markdown shows its new text, a patch its new view.
                let text = match (&old.node, new) {
                    (Node::Diff { content: was, filetype: had, .. }, Node::Diff { content: source, filetype, .. })
                        if was == source && had == filetype && !matches!(source, Source::PartOutput(_)) =>
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
                let filetype_changed = matches!((&old.node, new),
                    (Node::Diff { filetype: had, .. }, Node::Diff { filetype, .. }) if had != filetype);
                let view_changed = matches!((&old.node, new),
                    (Node::Diff { view: had, .. }, Node::Diff { view, .. }) if had != view);
                old.node = new.clone();
                old.dynamic = dynamic(new, &[]);
                self.show(&mut old, text, filetype_changed, view_changed);
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
            (Node::Diff { view, filetype, .. }, Extra::Diff(patch, shown)) => {
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
                            WrapMode::Word,
                            0,
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
            _ if self.restyle => self.restyle(mounted),
            _ => {}
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
            (Node::Box { bg, border, .. }, Extra::Box { view, .. }) => {
                if bg.is_some() {
                    view.bg(fill(theme, bg.as_ref()));
                }
                if let Some(border) = border {
                    bordered(view, theme, border);
                }
            }
            (Node::Text { .. }, Extra::Text { .. }) => paint_text(mounted, theme),
            (Node::Spinner { .. }, Extra::Spinner(spinner)) => spinner.set_color(theme.interactive().step(200)),
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
        match (node, &mounted.extra) {
            (Node::Box { children, .. }, Extra::Box { view, .. }) => {
                let view = view.clone();
                mounted.children = self.children(&view, Vec::new(), children);
            }
            (Node::Scroll { children, .. }, Extra::Scroll(scroll)) => {
                let content = scroll.content_view().clone();
                mounted.children = self.children(&content, Vec::new(), children);
            }
            _ => {}
        }
        mounted.dynamic = dynamic(node, &mounted.children);
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
                ..
            } => {
                let view = View::new(app);
                if *row {
                    view.row();
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
                let click = on_click.clone().map(|click| clickable(&view, click, env.act));
                lay_out(&view, layout);
                (view.as_any(), Extra::Box { view, click })
            }
            Node::Text { spans, fg, wrap, truncate, selectable, hover_fg, layout, on_click, .. } => {
                let base = color(theme, fg.as_ref()).unwrap_or(theme.text.base);
                let text = Text::new(app, spans.iter().map(|span| styled(theme, span, None)).collect::<Vec<_>>())
                    .fg(base)
                    .wrap(match wrap {
                        abi::Wrap::Word => WrapMode::Word,
                        abi::Wrap::Char => WrapMode::Char,
                        abi::Wrap::None => WrapMode::None,
                    })
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
                lay_out(&text, layout);
                (text.as_any(), Extra::Text { text: held, click, hover })
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
            Node::Diff { content, view, filetype, .. } => {
                let text = self.text(content);
                let patch = Patch::new(
                    app,
                    theme,
                    &self.syntax(),
                    &text,
                    diff_view(*view),
                    filetype.as_deref(),
                    WrapMode::Word,
                    0,
                );
                count(|work| work.parses += 1);
                (patch.view().as_any(), Extra::Diff(patch, text))
            }
            Node::Slot { .. } | Node::Keep { .. } => unreachable!("a slot is placed, and a keep is held"),
        };
        Mounted { node: shell(node), widget: Some(widget), children: Vec::new(), extra, dynamic: false }
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

    /// Drops `node` once every subtree held again has moved out of it. A placeholder of one drops nothing.
    fn doom(&mut self, node: Mounted) {
        if matches!(node.extra, Extra::Taken) {
            return;
        }
        self.doomed.push(node);
    }
}

/// Puts the widgets of `out` in `parent` in their order. OpenTUI paints siblings of one z-index in the order they
/// were attached, not by their index (`paintLessThan` in its `scene.zig`), and a move within a parent keeps that
/// order. So a widget is never inserted before a sibling: from the first child out of place on, every child is
/// attached again, in order, and the children paint as a fresh mount's do where they overlap.
fn place(parent: &View, out: &[Mounted], reused: &[bool]) {
    let widgets: Vec<(&AnyWidget, bool)> = out
        .iter()
        .zip(reused)
        .filter_map(|(node, reused)| node.widget.as_ref().map(|widget| (widget, *reused)))
        .collect();
    let wanted: HashSet<u32> = widgets.iter().map(|(widget, _)| widget.id()).collect();
    let present: Vec<u32> = parent.children().iter().map(Widget::id).filter(|id| wanted.contains(id)).collect();
    let first = widgets
        .iter()
        .zip(&present)
        .position(|((widget, _), id)| widget.id() != *id)
        .unwrap_or(present.len().min(widgets.len()));
    let here: HashSet<u32> = present[first.min(present.len())..].iter().copied().collect();
    // Detached last first, each from the end of the parent's list.
    for (widget, _) in widgets[first..].iter().rev() {
        if here.contains(&widget.id()) {
            widget.detach();
        }
    }
    for (widget, reused) in &widgets[first..] {
        parent.add(*widget);
        if *reused {
            count(|work| work.moved += 1);
        }
    }
}

/// For each of `new` without an id, the index of the child of `old` it is reconciled with: the next one without an
/// id, of its kind. A child with an id comes from the subtrees held again.
fn matches(old: &[Mounted], new: &[Node]) -> Vec<Option<usize>> {
    let mut cursor: HashMap<std::mem::Discriminant<Node>, usize> = HashMap::new();
    new.iter()
        .map(|node| {
            if node.id().is_some() {
                return None;
            }
            let kind = std::mem::discriminant(node);
            let start = cursor.get(&kind).copied().unwrap_or(0);
            let found = (start..old.len())
                .find(|&index| old[index].node.id().is_none() && std::mem::discriminant(&old[index].node) == kind);
            cursor.insert(kind, found.map_or(old.len(), |index| index + 1));
            found
        })
        .collect()
}

/// Whether `node`, with `children` under it, shows a tool call's output.
fn dynamic(node: &Node, children: &[Mounted]) -> bool {
    matches!(
        node,
        Node::Diff { content: Source::PartOutput(_), .. } | Node::Markdown { source: Source::PartOutput(_), .. }
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
    node.children.iter().for_each(count_removed);
}

fn has_slot(node: &Mounted) -> bool {
    matches!(node.extra, Extra::Slot(_)) || node.children.iter().any(has_slot)
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
        },
        Node::Scroll { id, height, follow, layout, .. } => {
            Node::Scroll { id: id.clone(), height: *height, follow: *follow, layout: *layout, children: Vec::new() }
        }
        _ => node.clone(),
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

/// A box changes in place when only its background and its click (one to another) change; its children are
/// reconciled apart.
fn box_change(old: &Node, new: &Node) -> Change {
    let (Node::Box { bg, on_click, .. }, Node::Box { bg: bg2, on_click: on_click2, .. }) = (old, new) else {
        return Change::Replace;
    };
    // Everything but the background and the click, children aside, must stay.
    let rest = |node: &Node| match node {
        Node::Box { id, row, gap, padding, justify, align, layout, border, padding_sides, wrap, overflow, .. } => {
            Some((
                id.clone(),
                *row,
                *gap,
                *padding,
                *justify,
                *align,
                *layout,
                border.clone(),
                *padding_sides,
                *wrap,
                *overflow,
            ))
        }
        _ => None,
    };
    if rest(old) != rest(new) || on_click.is_some() != on_click2.is_some() {
        return Change::Replace;
    }
    if bg == bg2 && on_click == on_click2 { Change::Same } else { Change::InPlace }
}

/// A text changes in place when its spans, its color and its click (one to another) change, and nothing else;
/// a text whose pointer color changes or that gains or loses a click is built again.
fn text_change(old: &Node, new: &Node) -> Change {
    let (
        Node::Text { id, spans, fg, wrap, truncate, selectable, hover_fg, layout, on_click },
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
        },
    ) = (old, new)
    else {
        return Change::Replace;
    };
    if (id, wrap, truncate, selectable, hover_fg, layout) != (id2, wrap2, truncate2, selectable2, hover2, layout2)
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
struct Hover {
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
