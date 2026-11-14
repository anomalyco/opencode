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
use opencode_ui::theme::{Paints, Theme};
use opentui::input::{MouseButton, MouseEventKind};
use opentui::prelude::*;
use opentui::style::Color;

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
    /// A node shows content the mount does not have.
    Content(ContentRef),
    /// The widgets the tree would hold nest deeper than [`MAX_DEPTH`], kept subtrees included; OpenTUI's layout
    /// fails the whole TUI past its own limit.
    Deep,
    /// A size in percent that is not a finite number of 0 or more, which OpenTUI's layout refuses with an error that
    /// ends the TUI.
    Number,
}
impl std::fmt::Display for Refused {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Refused::Duplicate(id) => write!(f, "the id {id:?} is in the tree twice"),
            Refused::Unknown(id) => write!(f, "a keep names {id:?}, which the host does not hold"),
            Refused::Content(content) => write!(f, "content {} is not the mount's", content.0),
            Refused::Deep => write!(f, "the tree nests deeper than {MAX_DEPTH} layout levels"),
            Refused::Number => write!(f, "a size in percent is not a finite number of 0 or more"),
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
}

enum Extra {
    None,
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
    Diff(Paints),
    Slot(Option<SlotMount>),
    /// In the tree before, a subtree that the tree being adopted keeps; its widget moved to wherever the keep is.
    Taken,
}

/// What a reconcile is doing: the kept subtrees not yet placed, the widgets to drop once every kept one is placed, and
/// whether the theme changed.
struct Pass<'a, 'b> {
    env: &'a Env<'b>,
    kept: HashMap<String, Mounted>,
    doomed: Vec<Mounted>,
    restyle: bool,
    slots_changed: bool,
}

impl Tree {
    /// Adopts `nodes` into `parent`, which holds this tree's widgets and nothing else, or refuses it and changes
    /// nothing.
    pub fn apply(&mut self, env: &Env<'_>, parent: &View, nodes: &[Node]) -> Result<(), Refused> {
        let keeps = self.validate(env, nodes)?;
        let restyle = self.theme.as_ref().is_some_and(|theme| theme != env.theme);
        let mut pass = Pass { env, kept: HashMap::new(), doomed: Vec::new(), restyle, slots_changed: false };
        take(&mut self.nodes, &keeps, &mut pass.kept);
        let old = std::mem::take(&mut self.nodes);
        self.nodes = pass.children(parent, old, nodes);
        debug_assert!(pass.kept.is_empty(), "every kept subtree is placed");
        for doomed in pass.doomed.drain(..) {
            drop_mounted(doomed, &mut pass.slots_changed);
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

    /// The ids the tree holds.
    pub fn ids(&self) -> impl Iterator<Item = &str> {
        self.ids.keys().map(String::as_str)
    }

    /// Whether the tree holds no node.
    pub fn is_empty(&self) -> bool {
        self.nodes.is_empty()
    }

    /// Checks `nodes` against the contract and returns the ids it keeps. The walk stops at the depth bound, so a
    /// deeper tree costs no more than one at the bound.
    fn validate(&self, env: &Env<'_>, nodes: &[Node]) -> Result<HashSet<String>, Refused> {
        struct Walk<'a, 'b> {
            tree: &'a Tree,
            env: &'a Env<'b>,
            ids: HashSet<&'a str>,
            keeps: HashSet<&'a str>,
        }
        impl<'a> Walk<'a, '_> {
            fn nodes(&mut self, nodes: &'a [Node], above: u16) -> Result<(), Refused> {
                for node in nodes {
                    if let Node::Keep { key } = node {
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
                    if let Some(id) = node.id()
                        && (!self.ids.insert(id) || self.keeps.contains(id))
                    {
                        return Err(Refused::Duplicate(id.to_owned()));
                    }
                    match node {
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
        let mut walk = Walk { tree: self, env, ids: HashSet::new(), keeps: HashSet::new() };
        walk.nodes(nodes, 0)?;
        if walk.keeps.is_empty() {
            return Ok(HashSet::new());
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
        Ok(walk.keeps.into_iter().map(str::to_owned).collect())
    }
}

/// Moves each subtree with an id in `keys` from `nodes` into `kept`, leaving a [`Extra::Taken`] in its place.
fn take(nodes: &mut [Mounted], keys: &HashSet<String>, kept: &mut HashMap<String, Mounted>) {
    if keys.is_empty() {
        return;
    }
    for node in nodes {
        if let Some(id) = node.node.id().filter(|id| keys.contains(*id)) {
            let id = id.to_owned();
            let taken = Mounted {
                node: Node::Keep { key: id.clone() },
                widget: node.widget.clone(),
                children: Vec::new(),
                extra: Extra::Taken,
            };
            kept.insert(id, std::mem::replace(node, taken));
            continue;
        }
        take(&mut node.children, keys, kept);
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

impl Pass<'_, '_> {
    /// The children `new` of `parent` reconciled with `old`, in place.
    ///
    /// OpenTUI paints siblings of one z-index in the order they were attached, not by their index (`paintLessThan`
    /// in its `scene.zig`), and a move within a parent keeps that order. So a widget is never inserted before a
    /// sibling: from the first child out of place on, every child is attached again, in order, and the children
    /// paint as a fresh mount's do where they overlap.
    fn children(&mut self, parent: &View, mut old: Vec<Mounted>, new: &[Node]) -> Vec<Mounted> {
        let same_shape = old.len() == new.len() && old.iter().zip(new).all(|(old, new)| same_slot(&old.node, new));
        let slots = old.iter().any(|node| matches!(node.node, Node::Slot { .. }))
            || new.iter().any(|node| matches!(node, Node::Slot { .. }));
        if slots && !(same_shape && old.iter().zip(new).all(|(old, new)| !self.replaces(&old.node, new))) {
            // A nested slot puts its claims straight into the parent, where nothing else can place them: build all
            // of the parent's children again. The old widgets go once the kept subtrees under them have moved.
            parent.clear();
            let built = new.iter().map(|node| self.placed(parent, node)).collect();
            old.into_iter().for_each(|node| self.doom(node));
            return built;
        }
        let matched: Vec<Option<usize>> =
            if same_shape { (0..new.len()).map(Some).collect() } else { matches(&old, new) };
        let mut olds: Vec<Option<Mounted>> = old.drain(..).map(Some).collect();
        let mut out = Vec::with_capacity(new.len());
        // Whether each child kept its widget from this parent.
        let mut stayed = Vec::with_capacity(new.len());
        for (node, found) in new.iter().zip(&matched) {
            let mounted = match found.and_then(|index| olds[index].take()) {
                Some(old) => match self.reconcile(old, node) {
                    Ok(mounted) => {
                        stayed.push(true);
                        mounted
                    }
                    Err(replaced) => {
                        let (old, built) = *replaced;
                        self.doom(old);
                        stayed.push(false);
                        built
                    }
                },
                None => {
                    stayed.push(false);
                    self.build(node)
                }
            };
            out.push(mounted);
        }
        olds.into_iter().flatten().for_each(|node| self.doom(node));
        if same_shape && stayed.iter().all(|stayed| *stayed) {
            return out;
        }
        // The children attached here now that stay, in their order; the first child that is not the next of them is
        // out of place, and so is everything after it.
        let wanted: HashSet<u32> = out.iter().filter_map(|node| node.widget.as_ref().map(Widget::id)).collect();
        let present: Vec<u32> = parent.children().iter().map(Widget::id).filter(|id| wanted.contains(id)).collect();
        let first = out
            .iter()
            .zip(&present)
            .position(|(node, id)| node.widget.as_ref().map(Widget::id) != Some(*id))
            .unwrap_or(present.len().min(out.len()));
        for (node, stayed) in out.iter().zip(&stayed).skip(first) {
            let Some(widget) = &node.widget else { continue };
            if present.contains(&widget.id()) {
                widget.detach();
                if *stayed {
                    count(|work| work.moved += 1);
                }
            }
            parent.add(widget);
        }
        out
    }

    /// Whether `new` builds a new widget in place of `old`'s.
    fn replaces(&self, old: &Node, new: &Node) -> bool {
        match (old, new) {
            (_, Node::Keep { .. }) => false,
            (Node::Box { .. }, Node::Box { .. }) => matches!(box_change(old, new), Change::Replace),
            (Node::Text { .. }, Node::Text { .. }) => matches!(text_change(old, new), Change::Replace),
            (Node::Scroll { .. }, Node::Scroll { .. }) => !same_scroll(old, new),
            (Node::Diff { .. }, Node::Diff { .. }) => old != new,
            (Node::Markdown { .. }, Node::Markdown { .. }) => old != new || self.restyle,
            (Node::Spinner { .. }, Node::Spinner { .. }) => false,
            (Node::Slot { path }, Node::Slot { path: next }) => path != next,
            _ => true,
        }
    }

    /// Reconciles in place, or returns the old node with a new one built instead, for the caller to place.
    fn reconcile(&mut self, mut old: Mounted, new: &Node) -> Result<Mounted, Box<(Mounted, Mounted)>> {
        if let Node::Keep { key } = new {
            let kept = self.kept.remove(key).expect("a validated keep names a held subtree");
            count(|work| work.kept += 1);
            // In a new theme the kept subtree is reconciled with itself, which restyles it; a Markdown in it, which
            // takes its theme as it is built, is built again.
            if self.restyle {
                let node = unfold(&kept);
                return self.reconcile(kept, &node);
            }
            // The kept subtree's widget is where the placeholder was.
            return Ok(kept);
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
                            restyle(&old, self.env);
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
                        count(|work| work.set += 1);
                    }
                    Change::Replace => {
                        let built = self.build(new);
                        return Err(Box::new((old, built)));
                    }
                }
                let Extra::Box { view, .. } = &old.extra else { unreachable!() };
                let view = view.clone();
                let olds = std::mem::take(&mut old.children);
                old.children = self.children(&view, olds, children);
                Ok(old)
            }
            (Node::Scroll { .. }, Node::Scroll { children, .. }) => {
                if !same_scroll(&old.node, new) {
                    let built = self.build(new);
                    return Err(Box::new((old, built)));
                }
                let Extra::Scroll(scroll) = &old.extra else { unreachable!() };
                let content = scroll.content_view().clone();
                let olds = std::mem::take(&mut old.children);
                old.children = self.children(&content, olds, children);
                Ok(old)
            }
            (Node::Text { .. }, Node::Text { .. }) => match text_change(&old.node, new) {
                Change::Same => {
                    if self.restyle {
                        restyle(&old, self.env);
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
                    restyle(&old, self.env);
                }
                Ok(old)
            }
            (Node::Diff { .. }, Node::Diff { .. }) => {
                if old.node != *new {
                    let built = self.build(new);
                    return Err(Box::new((old, built)));
                }
                if self.restyle {
                    restyle(&old, self.env);
                }
                Ok(old)
            }
            (Node::Markdown { .. }, Node::Markdown { .. }) => {
                // The host's Markdown takes the theme as it is built.
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

    /// `node` built and added to `parent`.
    fn placed(&mut self, parent: &View, node: &Node) -> Mounted {
        if let Node::Slot { path } = node {
            let slot = (self.env.slot)(parent, path);
            self.slots_changed = true;
            return Mounted { node: node.clone(), widget: None, children: Vec::new(), extra: Extra::Slot(slot) };
        }
        let mounted = self.build(node);
        if let Some(widget) = &mounted.widget {
            parent.add(widget);
        }
        mounted
    }

    /// `node` built, not yet in a parent. A slot needs its parent and is never built here: a parent with a slot is
    /// built through [`Pass::placed`].
    fn build(&mut self, node: &Node) -> Mounted {
        let env = self.env;
        let theme = env.theme;
        let app = env.host.app();
        if let Node::Keep { key } = node {
            // A keep in a parent that is built again: the subtree moves into the new widgets.
            let kept = self.kept.remove(key).expect("a validated keep names a held subtree");
            count(|work| work.kept += 1);
            if !self.restyle {
                return kept;
            }
            let node = unfold(&kept);
            return match self.reconcile(kept, &node) {
                Ok(mounted) => mounted,
                Err(replaced) => {
                    let (old, built) = *replaced;
                    self.doom(old);
                    built
                }
            };
        }
        count(|work| work.created += 1);
        let (widget, extra, children): (AnyWidget, Extra, Vec<Mounted>) = match node {
            Node::Box {
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
                let built = children.iter().map(|child| self.placed(&view, child)).collect();
                let click = on_click.clone().map(|click| clickable(&view, click, env.act));
                lay_out(&view, layout);
                (view.as_any(), Extra::Box { view, click }, built)
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
                (text.as_any(), Extra::Text { text: held, click, hover }, Vec::new())
            }
            Node::Spinner { label, .. } => {
                let spinner =
                    opencode_ui::motion::Spinner::new(app).color(theme.interactive().step(200)).label(label.clone());
                (spinner.as_any(), Extra::Spinner(spinner), Vec::new())
            }
            Node::Markdown { source, .. } => {
                let text = (env.source)(source).unwrap_or_default();
                (env.host.markdown(&text), Extra::None, Vec::new())
            }
            Node::Scroll { height, follow, layout, children, .. } => {
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
                let content = scroll.content_view().clone();
                let built = children.iter().map(|child| self.placed(&content, child)).collect();
                (scroll.as_any(), Extra::Scroll(scroll), built)
            }
            Node::Diff { content, view, filetype, .. } => {
                let patch = (env.source)(content).unwrap_or_default();
                let syntax = opencode_ui::code::syntax_theme(theme);
                let paints = Paints::default();
                let view = match view {
                    DiffView::Unified => opentui::widget::DiffView::Unified,
                    DiffView::Split => opentui::widget::DiffView::Split,
                };
                let widget = opencode_ui::diff::view_painted(
                    app,
                    theme,
                    &syntax,
                    &patch,
                    view,
                    filetype.as_deref(),
                    WrapMode::Word,
                    0,
                    &paints,
                );
                count(|work| work.parses += 1);
                (widget.as_any(), Extra::Diff(paints), Vec::new())
            }
            Node::Slot { .. } | Node::Keep { .. } => unreachable!("built above"),
        };
        Mounted { node: shell(node), widget: Some(widget), children, extra }
    }

    /// Drops `node` once every kept subtree has moved out of it. A placeholder of a kept subtree drops nothing.
    fn doom(&mut self, node: Mounted) {
        if matches!(node.extra, Extra::Taken) {
            return;
        }
        self.doomed.push(node);
    }
}

/// For each of `new`, the index of the child of `old` it is reconciled with: the one of its id and kind, or for a node
/// without an id the next one without an id of its kind.
fn matches(old: &[Mounted], new: &[Node]) -> Vec<Option<usize>> {
    let mut by_id: HashMap<&str, usize> = HashMap::new();
    for (index, node) in old.iter().enumerate() {
        if let Some(id) = node.node.id() {
            by_id.insert(id, index);
        }
    }
    let mut cursor: HashMap<std::mem::Discriminant<Node>, usize> = HashMap::new();
    new.iter()
        .map(|node| match node.id() {
            Some(id) => by_id.get(id).copied().filter(|&index| same_slot(&old[index].node, node)),
            None => {
                let kind = std::mem::discriminant(node);
                let start = cursor.get(&kind).copied().unwrap_or(0);
                let found = (start..old.len())
                    .find(|&index| old[index].node.id().is_none() && std::mem::discriminant(&old[index].node) == kind);
                if let Some(index) = found {
                    cursor.insert(kind, index + 1);
                }
                found
            }
        })
        .collect()
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

/// Whether `new` can be reconciled into `old` where it is: a keep of its id, or the same kind and id.
fn same_slot(old: &Node, new: &Node) -> bool {
    match new {
        Node::Keep { key } => old.id() == Some(key),
        Node::Slot { path } => matches!(old, Node::Slot { path: was } if was == path),
        _ => same_kind(old, new) && old.id() == new.id(),
    }
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

/// Whether two scrolls differ only in their children.
fn same_scroll(old: &Node, new: &Node) -> bool {
    matches!(
        (old, new),
        (
            Node::Scroll { id, height, follow, layout, .. },
            Node::Scroll { id: id2, height: height2, follow: follow2, layout: layout2, .. },
        ) if (id, height, follow, layout) == (id2, height2, follow2, layout2)
    )
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

/// Paints the node's own colors again, for a new theme.
fn restyle(mounted: &Mounted, env: &Env<'_>) {
    let theme = env.theme;
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
        (Node::Diff { .. }, Extra::Diff(paints)) => paints.restyle(theme),
        _ => return,
    }
    count(|work| work.set += 1);
}

/// The node a mounted subtree shows, children included.
fn unfold(mounted: &Mounted) -> Node {
    let mut node = mounted.node.clone();
    if let Node::Box { children, .. } | Node::Scroll { children, .. } = &mut node {
        *children = mounted.children.iter().map(unfold).collect();
    }
    node
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
