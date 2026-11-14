//! A windowed [`Node::List`] (synthesis 3.4, 3.5; P3): the host scrolls the list and builds widgets only for the
//! items near its viewport. An item that has no widgets keeps its node as data and takes the rows it took when it was
//! last laid out, or the plugin's estimate (at least a row), in a spacer; so opening, toggling or resizing a list of a
//! thousand cards builds and lays out the few on screen, not the thousand.
//!
//! An item is the unit of reconcile. Each item with widgets has a [`Tree`] of its own, reconciled with the item's
//! node, so a node inside it keeps its widget while its id stays; a [`Node::Keep`] item keeps the item whole, with
//! no work. An item's data is its node with every keep written out, so the host can build it whenever it comes into
//! view; its anchors stand for it while it has no widgets, so a step can reach them.
//!
//! The window is resolved after the solve, with this frame's offset (the behavior pass of [`crate::behave`]); a
//! change of it mounts or unmounts items and asks for another round. The list holds the reading position: the item
//! at the viewport's top and the rows into it, taken before any height, order or width changes and given back after
//! the solve, so what the reader looked at stays on screen. The rows before each item are kept as sums, so finding
//! the window, an item's row or the top anchor takes no walk of the whole list.

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::ops::Range;

use opencode_plugin_abi::v2::{AnchorAt, ListItem, Node, Source};
use opentui::prelude::*;

use crate::behave::visited;
use crate::reconcile::{Env, Held, Tree, count_kept, weight_of};

/// One item of a list.
pub(crate) struct Item {
    pub key: String,
    /// The node, with every keep written out.
    pub node: Node,
    estimate: u16,
    /// The rows it took when it was last laid out, while the width stays.
    measured: Option<f64>,
    /// The rows the spacers assume for it now.
    used: f64,
    /// The anchors of its data, by group, which stand for it while it has no widgets.
    anchors: Vec<(String, AnchorAt)>,
    /// Its data shows a tool call's output, which its widgets read again each revision.
    dynamic: bool,
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
    /// The items with widgets lie in it.
    window: Range<usize>,
    /// The rows the spacers before and after the window were given.
    spacers: (u32, u32),
    /// The viewport's width the measures were taken at.
    width: f64,
    /// The rows before each item, and after the last: `prefix[i]` is where item `i` starts.
    prefix: Vec<f64>,
    /// The groups of the items' anchors.
    groups: HashSet<String>,
    /// The item at the viewport's top and the rows into it, taken before a change of the items: the solve after it
    /// shows them again, unless a verb or the user moves the list first.
    reading: RefCell<Option<(String, f64)>>,
    /// What the user typed into the inputs of items that lost their widgets, by input id.
    drafts: HashMap<String, (String, (u32, u32))>,
    /// The offset of the list this one was built again from, until its first solve: the scroll box takes it once it
    /// has laid its content out, and reads 0 until then.
    carried: Option<(f64, f64)>,
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
            prefix: vec![0.0],
            groups: HashSet::new(),
            reading: RefCell::default(),
            drafts: HashMap::new(),
            carried: None,
        }
    }

    /// Adopts `items`, validated by the tree: a keep item keeps the item of its key; every other item's data is its
    /// node with keeps written out, and an item with widgets reconciles its tree with it. Then the window.
    pub fn reconcile(&mut self, env: &Env<'_>, items: &[ListItem], restyle: bool) {
        // Where the reader is, before any height changes; a reading an earlier change took and no solve has given
        // back yet stays.
        if self.reading.borrow().is_none() {
            *self.reading.get_mut() = self.at_top();
        }
        let mut old: HashMap<String, Item> = self.items.drain(..).map(|item| (item.key.clone(), item)).collect();
        for item in items {
            let key = item.node.id().unwrap_or_default().to_owned();
            let estimate = item.estimate.max(1);
            let next = match (old.remove(&key), &item.node) {
                (Some(mut held), Node::Keep { .. }) => {
                    count_kept();
                    held.estimate = estimate;
                    if (restyle || held.dynamic)
                        && let Some(mounted) = &mut held.mounted
                    {
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
                        held.anchors = logical(&written, env);
                        held.dynamic = reads_output(&written);
                    }
                    held.node = written;
                    held.estimate = estimate;
                    held
                }
                // Validation refuses a keep of an item the list does not hold.
                (None, node) => Item {
                    key: key.clone(),
                    node: node.clone(),
                    estimate,
                    measured: None,
                    used: f64::from(estimate),
                    anchors: logical(node, env),
                    dynamic: reads_output(node),
                    mounted: None,
                },
            };
            self.items.push(next);
        }
        for (_, gone) in old {
            if let Some(mounted) = gone.mounted {
                unmount(mounted, &mut HashMap::new());
            }
        }
        self.owners.clear();
        for (index, item) in self.items.iter().enumerate() {
            ids(&item.node, &mut |id| {
                self.owners.insert(id.to_owned(), index);
            });
        }
        self.groups = self.items.iter().flat_map(|item| item.anchors.iter().map(|(group, _)| group.clone())).collect();
        for item in &mut self.items {
            item.used = item.measured.unwrap_or(f64::from(item.estimate));
        }
        self.sum();
        self.window = self.mounted_range();
        self.place(env);
    }

    /// Takes over the items, their measures and the reading position of `old`, the list of the same id built
    /// again with another layout or axis. Items with widgets keep them on the same axis.
    pub fn take_from(&mut self, old: &mut List) {
        *self.reading.get_mut() = old.reading.take().or_else(|| old.at_top());
        let (x, y) = old.carried.unwrap_or_else(|| old.scroll.scroll_position());
        self.scroll.scroll_to(x, y);
        self.carried = Some((x, y));
        let same = self.row == old.row;
        for item in &mut old.items {
            if let Some(mounted) = item.mounted.take() {
                match same {
                    true => {
                        mounted.wrapper.detach();
                        item.mounted = Some(mounted);
                    }
                    false => unmount(mounted, &mut old.drafts),
                }
            }
            if !same {
                item.measured = None;
            }
        }
        self.items = std::mem::take(&mut old.items);
        self.owners = std::mem::take(&mut old.owners);
        self.groups = std::mem::take(&mut old.groups);
        self.drafts = std::mem::take(&mut old.drafts);
        self.width = if same { old.width } else { 0.0 };
    }

    /// Restyles the items with widgets in `env`'s theme, and shows what the tool calls they read show now.
    pub fn revisit(&mut self, env: &Env<'_>, restyle: bool) {
        for item in &mut self.items {
            if let (true, Some(mounted)) = (restyle || item.dynamic, &mut item.mounted) {
                let node = item.node.clone();
                apply(env, mounted, &node);
            }
        }
    }

    /// Whether an item's data shows a tool call's output.
    pub fn dynamic(&self) -> bool {
        self.items.iter().any(|item| item.dynamic)
    }

    /// After the solve: takes the items' laid-out heights, gives the reading position back, and mounts the items
    /// near the view. Whether it changed something the solve must lay out again.
    pub fn resolve(&mut self, env: &Env<'_>) -> bool {
        self.carried = None;
        if self.row {
            return self.place(env);
        }
        let reading = self.reading.take().or_else(|| self.at_top());
        let viewport = self.scroll.rect();
        let mut heights = false;
        if f64::from(viewport.width) != self.width {
            // At another width every item wraps again: a height measured at the old one is a guess no better than
            // the estimate.
            self.width = f64::from(viewport.width);
            visited(self.items.len());
            for item in &mut self.items {
                if item.mounted.is_none() && item.measured.take().is_some() {
                    item.used = f64::from(item.estimate);
                    heights = true;
                }
            }
        }
        visited(self.window.len());
        for item in &mut self.items[self.window.clone()] {
            let Some(mounted) = &item.mounted else { continue };
            let rect = mounted.wrapper.rect();
            if rect.width <= 0.0 {
                continue;
            }
            let height = f64::from(rect.height);
            if height != item.used {
                item.used = height;
                heights = true;
            }
            item.measured = Some(height);
        }
        if heights {
            self.sum();
        }
        let mut moved = false;
        if let Some((key, within)) = reading
            && let Some(&index) = self.owners.get(&key)
        {
            let target = self.prefix[index] + within.min((self.items[index].used - 1.0).max(0.0));
            let (x, top) = self.scroll.scroll_position();
            if (target - top).abs() >= 0.5 {
                self.scroll.scroll_to(x, target);
                moved = true;
            }
        }
        self.place(env) || moved
    }

    /// A verb or the user moves the list: where it goes is the reading position.
    pub fn moved(&self) {
        self.reading.take();
    }

    /// The item at the viewport's top and the rows into it. `None` at the end, which follows the end (OpenTUI's
    /// scroll at its end stays there as the content changes).
    fn at_top(&self) -> Option<(String, f64)> {
        if self.items.is_empty() || self.row {
            return None;
        }
        let top = self.top();
        let most = f64::from(self.scroll.content_view().rect().height - self.scroll.rect().height);
        if most > 0.0 && top >= most - 0.5 {
            return None;
        }
        let index = self.at(top);
        Some((self.items[index].key.clone(), top - self.prefix[index]))
    }

    /// The offset: the one carried from the list this one was built again from, until its first solve.
    fn top(&self) -> f64 {
        self.carried.map_or_else(|| self.scroll.scroll_position().1, |(_, y)| y)
    }

    /// The item whose rows hold row `row`: the first that ends past it, or the last.
    fn at(&self, row: f64) -> usize {
        self.prefix[1..].partition_point(|end| *end <= row).min(self.items.len().saturating_sub(1))
    }

    /// The rows before each item, again.
    fn sum(&mut self) {
        visited(self.items.len());
        self.prefix.clear();
        self.prefix.push(0.0);
        let mut y = 0.0;
        for item in &self.items {
            y += item.used;
            self.prefix.push(y);
        }
    }

    /// The range of the items with widgets.
    fn mounted_range(&self) -> Range<usize> {
        let first = self.items.iter().position(|item| item.mounted.is_some());
        let last = self.items.iter().rposition(|item| item.mounted.is_some());
        match (first, last) {
            (Some(first), Some(last)) => first..last + 1,
            _ => 0..0,
        }
    }

    /// Mounts the items the viewport and one viewport on each side reach, unmounts the others, and sizes the
    /// spacers; whether anything changed.
    fn place(&mut self, env: &Env<'_>) -> bool {
        let want = if self.row { 0..self.items.len() } else { self.wanted(env) };
        let mut changed = want != self.window;
        visited(self.window.len() + want.len());
        for index in self.window.clone() {
            if want.contains(&index) {
                continue;
            }
            if let Some(mounted) = self.items[index].mounted.take() {
                unmount(mounted, &mut self.drafts);
                changed = true;
            }
        }
        for index in want.clone() {
            let item = &mut self.items[index];
            if item.mounted.is_some() {
                continue;
            }
            let wrapper = View::new(env.host.app()).column().shrink(0.0);
            let mut mounted = Mounted { wrapper, tree: Tree::default() };
            apply(env, &mut mounted, &item.node);
            mounted.tree.restore_drafts(&mut self.drafts);
            item.mounted = Some(mounted);
            changed = true;
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
            let rows = |rows: f64| rows.round().clamp(0.0, f64::from(u32::MAX)) as u32;
            let total = self.prefix[self.items.len()];
            // What the spacers were given, not their rects: an empty spacer's rect is not 0 rows.
            let spacers = (rows(self.prefix[want.start]), rows(total - self.prefix[want.end]));
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
        let height = if rect.height > 0.0 { f64::from(rect.height) } else { f64::from(env.host.app().size().1) };
        let top = self.top();
        let (from, to) = (top - height, top + 2.0 * height);
        let len = self.items.len();
        let start = self.prefix[1..].partition_point(|end| *end <= from);
        let end = self.prefix[..len].partition_point(|start| *start < to);
        if start >= end { 0..0 } else { start..end }
    }

    /// The row the host assumes item `index` starts at.
    pub fn row_of(&self, index: usize) -> f64 {
        self.prefix[index.min(self.items.len())]
    }

    /// The rows the host assumes item `index` takes.
    pub fn rows_of(&self, index: usize) -> f64 {
        self.items.get(index).map_or(0.0, |item| item.used)
    }

    /// The anchors of `group` of the items of `range` without widgets, at the rows the host assumes for them.
    pub fn unmounted_anchors(&self, group: &str, range: Range<usize>) -> Vec<AnchorAt> {
        if !self.groups.contains(group) {
            return Vec::new();
        }
        visited(range.len());
        self.items[range.clone()]
            .iter()
            .zip(range)
            .filter(|(item, _)| item.mounted.is_none())
            .flat_map(|(item, index)| {
                let row = self.row_of(index).round().clamp(0.0, f64::from(i32::MAX)) as i32;
                let anchors = item.anchors.iter().filter(|(of, _)| of == group);
                anchors.map(move |(_, anchor)| AnchorAt { row, ..anchor.clone() })
            })
            .collect()
    }

    /// The last anchor of `group` of an item without widgets at or above row `line`: found from the item there back.
    pub fn anchor_above(&self, group: &str, line: i64) -> Option<AnchorAt> {
        if !self.groups.contains(group) || self.items.is_empty() || line < 0 {
            return None;
        }
        let from = self.at(line as f64);
        let mut seen = 0;
        let found = (0..=from).rev().find_map(|index| {
            seen += 1;
            let item = &self.items[index];
            if item.mounted.is_some() || self.prefix[index] > line as f64 {
                return None;
            }
            self.unmounted_anchors(group, index..index + 1).pop()
        });
        visited(seen);
        found
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

/// Drops an item's widgets, keeping what the user typed into its inputs in `drafts`.
fn unmount(mut mounted: Mounted, drafts: &mut HashMap<String, (String, (u32, u32))>) {
    mounted.tree.take_drafts(drafts);
    mounted.tree.clear(&mounted.wrapper);
    mounted.wrapper.detach();
}

/// The anchors of `node`'s data, in content order: each anchored box, and each hunk of a diff with `hunks`, counted
/// from its text. A scroll or list in it has anchors of its own.
fn logical(node: &Node, env: &Env<'_>) -> Vec<(String, AnchorAt)> {
    fn walk(node: &Node, env: &Env<'_>, out: &mut Vec<(String, AnchorAt)>) {
        match node {
            Node::Box { id: Some(id), anchor: Some(anchor), .. } => {
                let at = AnchorAt {
                    id: id.clone(),
                    owner: id.clone(),
                    variant: anchor.variant.clone(),
                    ..AnchorAt::default()
                };
                out.push((anchor.group.clone(), at));
            }
            Node::Diff { id: Some(id), hunks: Some(group), content, .. } => {
                let hunks = opencode_ui::diff::hunk_count(&(env.source)(content).unwrap_or_default());
                out.extend((0..hunks).map(|index| {
                    let at = AnchorAt {
                        id: format!("{id}#{index}"),
                        owner: id.clone(),
                        index: index as u32,
                        ..AnchorAt::default()
                    };
                    (group.clone(), at)
                }));
            }
            Node::Scroll { .. } | Node::List { .. } => return,
            _ => {}
        }
        for child in node.children() {
            walk(child, env, out);
        }
    }
    let mut out = Vec::new();
    walk(node, env, &mut out);
    out
}

/// Whether `node`'s subtree shows a tool call's output.
fn reads_output(node: &Node) -> bool {
    matches!(
        node,
        Node::Diff { content: Source::PartOutput(_), .. }
            | Node::Markdown { source: Source::PartOutput(_), .. }
            | Node::Code { content: Source::PartOutput(_), .. }
    ) || node.children().iter().any(reads_output)
        || matches!(node, Node::List { items, .. } if items.iter().any(|item| reads_output(&item.node)))
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
