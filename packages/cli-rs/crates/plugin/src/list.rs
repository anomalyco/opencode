//! A windowed [`Node::List`] (synthesis 3.4, 3.5; P3): the host scrolls the list and builds widgets only for the
//! items near its viewport. An item that has no widgets keeps its node as data and takes the rows it took when it was
//! last laid out, or the plugin's estimate, in a spacer; so opening, toggling or resizing a list of a thousand cards
//! builds and lays out the few on screen, not the thousand.
//!
//! An item is the unit of reconcile. Each item with widgets has a [`Tree`] of its own, reconciled with the item's
//! node, so a node inside it keeps its widget while its id stays; a [`Node::Keep`] item keeps the item whole, with
//! no work. An item's data is its node with every keep written out, so the host can build it whenever it comes into
//! view.
//!
//! The window is resolved after the solve, with this frame's offset (the behavior pass of [`crate::behave`]); a
//! change of it mounts or unmounts items and asks for another round. When an item above the reading position takes
//! another height than the host assumed for it, the offset moves by the difference, so what is on screen stays.

use std::collections::HashMap;
use std::ops::Range;

use opencode_plugin_abi::v2::{ListItem, Node};
use opentui::prelude::*;

use crate::reconcile::{Env, Held, Tree, count_kept, weight_of};

/// One item of a list.
pub(crate) struct Item {
    pub key: String,
    /// The node, with every keep written out.
    pub node: Node,
    estimate: u16,
    /// The rows it took when it was last laid out, while the width stays.
    measured: Option<f32>,
    /// The rows the spacers assume for it now.
    used: f32,
    pub mounted: Option<Mounted>,
}

/// The widgets of an item near the view.
pub(crate) struct Mounted {
    pub wrapper: View,
    pub tree: Tree,
}

pub(crate) struct List {
    pub scroll: ScrollBox,
    row: bool,
    /// The rows of the items before and after the window.
    before: View,
    after: View,
    pub items: Vec<Item>,
    /// Each id in an item's data, with its item.
    owners: HashMap<String, usize>,
    window: Range<usize>,
    /// The rows the spacers before and after the window were given.
    spacers: (u32, u32),
    /// The viewport's width the measures were taken at.
    width: f32,
}

impl List {
    pub fn new(app: &App, row: bool) -> Self {
        let scroll = ScrollBox::new(app).scrollbars(false).min_height(0);
        let (before, after) = (View::new(app).shrink(0.0), View::new(app).shrink(0.0));
        if row {
            scroll.axes(true, false);
            scroll.content_view().row();
        } else {
            scroll.content_view().add(&before).add(&after);
        }
        Self {
            scroll,
            row,
            before: before.height(0),
            after: after.height(0),
            items: Vec::new(),
            owners: HashMap::new(),
            window: 0..0,
            spacers: (0, 0),
            width: 0.0,
        }
    }

    /// Adopts `items`, validated by the tree: a keep item keeps the item of its key; every other item's data is its
    /// node with keeps written out, and an item with widgets reconciles its tree with it. Then the window.
    pub fn reconcile(&mut self, env: &Env<'_>, items: &[ListItem], restyle: bool) {
        let mut old: HashMap<String, Item> = self.items.drain(..).map(|item| (item.key.clone(), item)).collect();
        for item in items {
            let key = item.node.id().unwrap_or_default().to_owned();
            let next = match (old.remove(&key), &item.node) {
                (Some(mut held), Node::Keep { .. }) => {
                    count_kept();
                    held.estimate = item.estimate;
                    if restyle && let Some(mounted) = &mut held.mounted {
                        let node = held.node.clone();
                        apply(env, mounted, &node);
                    }
                    held
                }
                (Some(mut held), node) => {
                    let written = write_out(node, &held.node);
                    if let Some(mounted) = &mut held.mounted {
                        apply(env, mounted, node);
                    }
                    if written != held.node {
                        held.measured = None;
                    }
                    held.node = written;
                    held.estimate = item.estimate;
                    held
                }
                // Validation refuses a keep of an item the list does not hold.
                (None, node) => Item {
                    key: key.clone(),
                    node: node.clone(),
                    estimate: item.estimate,
                    measured: None,
                    used: f32::from(item.estimate),
                    mounted: None,
                },
            };
            self.items.push(next);
        }
        for (_, gone) in old {
            if let Some(mounted) = gone.mounted {
                unmount(mounted);
            }
        }
        self.owners.clear();
        for (index, item) in self.items.iter().enumerate() {
            ids(&item.node, &mut |id| {
                self.owners.insert(id.to_owned(), index);
            });
        }
        for item in &mut self.items {
            item.used = item.measured.unwrap_or(f32::from(item.estimate));
        }
        // The window as the last frame's offset puts it, so the first frame shows the items.
        self.window = self.items.iter().position(|item| item.mounted.is_some()).map_or(0..0, |first| first..first);
        self.place(env);
    }

    /// Restyles the items with widgets in `env`'s theme.
    pub fn restyle(&mut self, env: &Env<'_>) {
        for item in &mut self.items {
            if let Some(mounted) = &mut item.mounted {
                let node = item.node.clone();
                apply(env, mounted, &node);
            }
        }
    }

    /// After the solve: takes the items' laid-out heights, keeps the reading position, and mounts the items near the
    /// view. Whether it changed something the solve must lay out again.
    pub fn resolve(&mut self, env: &Env<'_>) -> bool {
        let viewport = self.scroll.rect();
        if viewport.width != self.width {
            // At another width every item wraps again: a height measured at the old one is a guess no better than
            // the estimate.
            self.width = viewport.width;
            for item in &mut self.items {
                if item.mounted.is_none() {
                    item.measured = None;
                }
            }
        }
        let top = self.scroll.scroll_position().1 as f32;
        let reading = self.at(top);
        let mut moved = 0.0;
        for (index, item) in self.items.iter_mut().enumerate() {
            let Some(mounted) = &item.mounted else {
                item.used = item.measured.unwrap_or(f32::from(item.estimate));
                continue;
            };
            let rect = mounted.wrapper.rect();
            if rect.width <= 0.0 {
                continue;
            }
            let height = if self.row { rect.width } else { rect.height };
            if height != item.used && index < reading {
                moved += height - item.used;
            }
            item.used = height;
            item.measured = Some(height);
        }
        if moved != 0.0 && !self.row {
            self.scroll.scroll_to(0.0, f64::from(top + moved));
        }
        self.place(env) || moved != 0.0
    }

    /// Mounts the items the viewport and one viewport on each side reach, unmounts the others, and sizes the
    /// spacers; whether anything changed.
    fn place(&mut self, env: &Env<'_>) -> bool {
        let want = if self.row { 0..self.items.len() } else { self.wanted(env) };
        let mut changed = want != self.window;
        for (index, item) in self.items.iter_mut().enumerate() {
            match (want.contains(&index), item.mounted.is_some()) {
                (true, false) => {
                    let wrapper = View::new(env.host.app()).column().shrink(0.0);
                    let mut mounted = Mounted { wrapper, tree: Tree::default() };
                    apply(env, &mut mounted, &item.node);
                    item.mounted = Some(mounted);
                    changed = true;
                }
                (false, true) => {
                    if let Some(mounted) = item.mounted.take() {
                        unmount(mounted);
                    }
                    changed = true;
                }
                _ => {}
            }
        }
        self.window = want.clone();
        let content = self.scroll.content_view();
        let mut order: Vec<AnyWidget> = Vec::with_capacity(want.len() + 2);
        if !self.row {
            order.push(self.before.as_any());
        }
        order.extend(self.items[want.clone()].iter().filter_map(|item| Some(item.mounted.as_ref()?.wrapper.as_any())));
        if !self.row {
            order.push(self.after.as_any());
        }
        let present: Vec<u32> = content.children().iter().map(Widget::id).collect();
        if !order.iter().map(Widget::id).eq(present.iter().copied()) {
            let first = order.iter().zip(&present).position(|(widget, id)| widget.id() != *id).unwrap_or(present.len());
            for child in content.children().iter().skip(first) {
                child.detach();
            }
            for widget in &order[first.min(order.len())..] {
                content.add(widget);
            }
            changed = true;
        }
        if !self.row {
            let rows = |range: Range<usize>| self.items[range].iter().map(|item| item.used).sum::<f32>().round() as u32;
            // What the spacers were given, not their rects: an empty spacer's rect is not 0 rows.
            let spacers = (rows(0..want.start), rows(want.end..self.items.len()));
            if spacers != self.spacers {
                self.before.height(spacers.0);
                self.after.height(spacers.1);
                self.spacers = spacers;
                changed = true;
            }
        }
        changed
    }

    /// The items the viewport and one viewport on each side reach, at the current offset.
    fn wanted(&self, env: &Env<'_>) -> Range<usize> {
        let rect = self.scroll.rect();
        // Before its first solve the list has no size; the terminal's height stands in.
        let height = if rect.height > 0.0 { rect.height } else { f32::from(env.host.app().size().1) };
        let top = self.scroll.scroll_position().1 as f32;
        let (from, to) = (top - height, top + 2.0 * height);
        let (mut start, mut end, mut y) = (self.items.len(), 0, 0.0);
        for (index, item) in self.items.iter().enumerate() {
            let bottom = y + item.used;
            if bottom > from && y < to {
                start = start.min(index);
                end = index + 1;
            }
            y = bottom;
        }
        if start >= end { 0..0 } else { start..end }
    }

    /// The item at row `row` of the content.
    fn at(&self, row: f32) -> usize {
        let mut y = 0.0;
        for (index, item) in self.items.iter().enumerate() {
            y += item.used;
            if y > row {
                return index;
            }
        }
        self.items.len()
    }

    /// The row the host assumes item `index` starts at.
    pub fn row_of(&self, index: usize) -> f32 {
        self.items[..index.min(self.items.len())].iter().map(|item| item.used).sum()
    }

    /// The item whose data holds id `id`.
    pub fn owner(&self, id: &str) -> Option<usize> {
        self.owners.get(id).copied()
    }

    /// Records every id of the items' data, under the list `list`, as [`Tree`]'s validation reads them.
    pub fn collect_ids(&self, list: &str, ids: &mut HashMap<String, Held>) -> u16 {
        let mut deepest = 0;
        for item in &self.items {
            let depth = held_ids(&item.node, Some(list), &item.key, list, ids);
            deepest = deepest.max(depth);
        }
        deepest
    }

    /// Counts the widgets of every item as removed.
    pub fn count_removed(&self) {
        for item in &self.items {
            if let Some(mounted) = &item.mounted {
                mounted.tree.count_removed();
            }
        }
    }
}

/// Reconciles an item's tree with `node`; validation has checked it whole.
fn apply(env: &Env<'_>, mounted: &mut Mounted, node: &Node) {
    let item = Env { full: false, ..*env };
    if let Err(refused) = mounted.tree.apply(&item, &mounted.wrapper, std::slice::from_ref(node)) {
        log::error!("a list item the tree took was refused: {refused}");
    }
}

fn unmount(mut mounted: Mounted) {
    mounted.tree.clear(&mounted.wrapper);
    mounted.wrapper.detach();
}

/// `node` with each keep replaced by the subtree of `last` with its key.
fn write_out(node: &Node, last: &Node) -> Node {
    fn find<'a>(node: &'a Node, id: &str) -> Option<&'a Node> {
        if node.id() == Some(id) && !matches!(node, Node::Keep { .. }) {
            return Some(node);
        }
        let inside = match node {
            Node::List { items, .. } => items.iter().find_map(|item| find(&item.node, id)),
            _ => None,
        };
        inside.or_else(|| node.children().iter().find_map(|child| find(child, id)))
    }
    fn walk(node: &Node, last: &Node) -> Node {
        match node {
            Node::Keep { key } => find(last, key).cloned().unwrap_or_else(|| node.clone()),
            Node::Box { children, .. } | Node::Scroll { children, .. } => {
                let mut out = node.clone();
                if let Node::Box { children: written, .. } | Node::Scroll { children: written, .. } = &mut out {
                    *written = children.iter().map(|child| walk(child, last)).collect();
                }
                out
            }
            Node::List { items, .. } => {
                let mut out = node.clone();
                if let Node::List { items: written, .. } = &mut out {
                    *written = items
                        .iter()
                        .map(|item| ListItem { node: walk(&item.node, last), estimate: item.estimate })
                        .collect();
                }
                out
            }
            _ => node.clone(),
        }
    }
    walk(node, last)
}

/// Calls `f` with every id of `node`'s subtree, nested lists included.
fn ids(node: &Node, f: &mut dyn FnMut(&str)) {
    if let Some(id) = node.id() {
        f(id);
    }
    for child in node.children() {
        ids(child, f);
    }
    if let Node::List { items, .. } = node {
        for item in items {
            ids(&item.node, f);
        }
    }
}

/// Records the ids of `node`, in item `item` of list `list`, under `above`; the layout levels it takes.
fn held_ids(node: &Node, above: Option<&str>, item: &str, list: &str, held: &mut HashMap<String, Held>) -> u16 {
    let id = node.id();
    let mut deepest = 0;
    for child in node.children() {
        deepest = deepest.max(held_ids(child, id.or(above), item, list, held));
    }
    if let (Node::List { items, .. }, Some(inner)) = (node, id) {
        for nested in items {
            let key = nested.node.id().unwrap_or_default();
            deepest = deepest.max(held_ids(&nested.node, Some(inner), key, inner, held));
        }
    }
    let depth = weight_of(node) + deepest;
    if let Some(id) = id {
        held.insert(
            id.to_owned(),
            Held { above: above.map(str::to_owned), depth, item: Some((list.to_owned(), item.to_owned())) },
        );
    }
    depth
}
