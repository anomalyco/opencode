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

use std::cell::{Cell, RefCell};
use std::collections::{HashMap, HashSet};
use std::ops::Range;

use opencode_plugin_abi::v2::{AnchorAt, ListItem, Node, Source};
use opentui::prelude::*;

use crate::behave::visited;
use crate::reconcile::{Env, Held, Tree, count_item, count_kept, weight_of};

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

/// A move of the list: the frame a solve sees it in, whether it follows the end, and where a verb meant it to go.
type Moving = (u64, bool, Option<Option<f64>>);

/// A reading position: an item, the rows into it, and whether they stay inside it when it takes fewer rows. What was
/// on screen stays in its item; a verb's offset is rows, which go on into the items after.
type Reading = (String, f64, bool);

/// The widgets of an item near the view.
pub(crate) struct Mounted {
    pub wrapper: View,
    pub tree: Tree,
}

pub(crate) struct List {
    /// The frame the list last mounted an item in: in a frame with no rows left, it mounts one if it mounted none.
    mounted_in: Cell<Option<(usize, u64)>>,
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
    reading: RefCell<Option<Reading>>,
    /// A verb or the user moved the list: where the move goes is the reading position; a move to the end follows the
    /// end through its frame, as OpenTUI's scroll does. The frame it is solved in (`u64::MAX` until a solve sees
    /// it), whether it follows the end, and where a verb meant it to go: an offset, or the end (`Some(None)`); a
    /// user's move goes where the first solve after it shows.
    moving: Cell<Option<Moving>>,
    /// A user's move no solve has seen, as the items were before a change: the reading at its top, and the rows they
    /// summed to, by which the solve judges whether it is at the end.
    unsolved: RefCell<Option<(Option<Reading>, f64)>>,
    /// Rows the offset moved to hold the reading position since the behaviors last read it: the view did not move,
    /// so what they keep at an offset (a step's memory) moves with it.
    shifted: Cell<f64>,
    /// The end clamped a restore since the behaviors last read it: the view did move.
    clamped: Cell<bool>,
    /// Where the restore last put a reading it still holds: its shift counts from there, not from where a solve then
    /// clamped the offset.
    restored: Cell<Option<f64>>,
    /// What the user typed into the inputs of items that lost their widgets, by input id.
    drafts: crate::reconcile::Drafts,
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
            mounted_in: Cell::new(None),
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
            moving: Cell::new(None),
            unsolved: RefCell::default(),
            shifted: Cell::new(0.0),
            clamped: Cell::new(false),
            restored: Cell::new(None),
            drafts: HashMap::new(),
            carried: None,
        }
    }

    /// Adopts `items`, validated by the tree: a keep item keeps the item of its key; every other item's data is its
    /// node with keeps written out, or the placeholder that stands for it in `over`, and an item with widgets
    /// reconciles its tree with it. Then the window.
    pub fn reconcile(
        &mut self,
        env: &Env<'_>,
        items: &[ListItem],
        restyle: bool,
        over: &HashMap<*const Node, Option<Node>>,
    ) {
        // Where the reader is, before any height changes; a reading an earlier change took and no solve has given
        // back yet stays. A move no solve has seen yet went by the sums the items have now, which an item built again
        // gives up for its estimate (a view a resize asked for runs before the solve's behaviors): a verb's row becomes
        // the reading here, and a user's move keeps the reading and the end it saw for its solve.
        match self.moving.get() {
            Some((u64::MAX, _, Some(Some(row)))) => {
                *self.reading.get_mut() = self.at_row(row).map(|(key, rows, _)| (key, rows, false));
                self.restored.set(Some(row));
                self.moving.set(None);
            }
            Some((u64::MAX, _, None)) if self.unsolved.get_mut().is_none() => {
                *self.unsolved.get_mut() = Some((self.at_top(), self.prefix[self.items.len()]));
            }
            Some((u64::MAX, ..)) => {}
            _ if self.reading.borrow().is_none() => {
                *self.reading.get_mut() = self.at_top();
                // A solve may clamp the offset before the restore: the shift counts from where the reading was.
                self.restored.set(Some(self.top()));
            }
            _ => {}
        }
        let mut old: HashMap<String, Item> = self.items.drain(..).map(|item| (item.key.clone(), item)).collect();
        for item in items {
            let key = item.node.id().unwrap_or_default().to_owned();
            let estimate = item.estimate.max(1);
            // An item a placeholder absorbed is not the list's.
            let node = match over.get(&std::ptr::from_ref(&item.node)) {
                Some(Some(placeholder)) => placeholder,
                Some(None) => continue,
                None => &item.node,
            };
            let next = match (old.remove(&key), node) {
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
                    count_item();
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
                (None, node) => {
                    count_item();
                    Item {
                        key: key.clone(),
                        node: node.clone(),
                        estimate,
                        measured: None,
                        used: f64::from(estimate),
                        anchors: logical(node, env),
                        dynamic: reads_output(node),
                        mounted: None,
                    }
                }
            };
            self.items.push(next);
        }
        for (_, gone) in old {
            if let Some(mounted) = gone.mounted {
                unmount(mounted, &mut HashMap::new());
            }
        }
        // A draft goes with its input: once the input's item went, or the plugin gave it another value, which would
        // replace the text of a mounted input (review carbon-11).
        let mut values = HashMap::new();
        for item in &self.items {
            inputs(&item.node, &mut values);
        }
        self.drafts.retain(|id, (given, _)| values.get(id.as_str()) == Some(&given.as_str()));
        self.owners.clear();
        for (index, item) in self.items.iter().enumerate() {
            ids(&item.node, &mut |id| {
                self.owners.insert(id.to_owned(), index);
            });
        }
        self.groups = self.items.iter().flat_map(|item| item.anchors.iter().map(|(group, _)| group.clone())).collect();
        // An item with widgets is measured again after the next solve: until then the rows it took stand for it, nearer
        // than its estimate (a view a resize asked for builds every card again, before the solve's behaviors).
        for item in &mut self.items {
            item.used = match (&item.mounted, item.measured) {
                (_, Some(measured)) => measured,
                (Some(_), None) => item.used,
                (None, None) => f64::from(item.estimate),
            };
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
        let frame = env.host.app().frame_number();
        // A verb's offset, taken before this solve's heights are in the sums: a view that ran after it may have
        // mounted an item its estimate made taller, and the solve clamped the offset to an end it does not have.
        // Where a verb meant the offset to be, which the solve may have clamped: what the restore shifts from.
        let mut meant = None;
        let (follows, first) = match self.moving.get() {
            Some((u64::MAX, _, intent)) => {
                meant = intent.flatten();
                let (follows, reading) = match intent {
                    Some(None) => (true, None),
                    Some(Some(row)) => (false, self.at_row(row).map(|(key, rows, _)| (key, rows, false))),
                    // The end as the move saw it: this solve may already lay out an item it mounted, shorter than
                    // its estimate, and clamp the offset to an end the reader never reached.
                    None => {
                        let (top, total) =
                            self.unsolved.take().unwrap_or_else(|| (self.at_top(), self.prefix[self.items.len()]));
                        let most = total - f64::from(self.scroll.rect().height);
                        let follows = most > 0.0 && self.top() >= most - 0.5;
                        (follows, if follows { None } else { top })
                    }
                };
                self.moving.set(Some((frame, follows, intent)));
                (follows, Some(reading))
            }
            Some((solved, follows, _)) if solved == frame => (follows, None),
            _ => {
                self.moving.set(None);
                (false, None)
            }
        };
        let kept = match (follows, &first) {
            (false, None) => self.reading.take(),
            _ => None,
        };
        if kept.is_none() {
            self.restored.set(None);
        }
        let reading = match (follows, first) {
            (true, _) => None,
            (false, Some(reading)) => reading,
            (false, None) => kept.or_else(|| self.at_top()),
        };
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
        let held = reading.clone();
        if let Some((key, within, inside)) = reading
            && let Some(&index) = self.owners.get(&key)
        {
            // As far as the content reaches with the heights just taken: past it the scroll clamps, and the restore
            // would move it again every round.
            let most = (self.prefix[self.items.len()] - f64::from(viewport.height)).max(0.0);
            let within = if inside { within.min((self.items[index].used - 1.0).max(0.0)) } else { within };
            let wanted = self.prefix[index] + within;
            if wanted > most + 0.5 {
                self.clamped.set(true);
            }
            let target = wanted.min(most);
            let (x, top) = self.scroll.scroll_position();
            let from = self.restored.get().or(meant).unwrap_or(top);
            if (target - from).abs() >= 0.5 {
                self.shifted.set(self.shifted.get() + target - from);
            }
            self.restored.set(Some(target));
            if (target - top).abs() >= 0.5 {
                self.scroll.scroll_to(x, target);
                moved = true;
            }
        }
        // Items this round mounts are laid out by the next solve, before their heights are in the sums: the same
        // reading holds until the list settles.
        let changed = self.place(env) || moved;
        if changed {
            *self.reading.get_mut() = held;
        }
        changed
    }

    /// The rows the offset moved to hold the reading position since the last call, and whether the end clamped it.
    pub fn take_shift(&self) -> (f64, bool) {
        (self.shifted.replace(0.0), self.clamped.replace(false))
    }

    /// A verb or the user moves the list: where it goes is the reading position.
    pub fn moved(&self) {
        self.reading.take();
        self.unsolved.take();
        self.moving.set(Some((u64::MAX, false, None)));
    }

    /// A verb moved the list to row `row`, or to the end when `None`.
    pub fn intend(&self, row: Option<f64>) {
        self.moving.set(Some((u64::MAX, false, Some(row))));
    }

    /// The item at the viewport's top and the rows into it.
    fn at_top(&self) -> Option<Reading> {
        if self.row {
            return None;
        }
        self.at_row(self.top())
    }

    /// The item at row `row` and the rows into it, which stay inside it.
    fn at_row(&self, row: f64) -> Option<Reading> {
        if self.items.is_empty() {
            return None;
        }
        let index = self.at(row);
        Some((self.items[index].key.clone(), row - self.prefix[index], true))
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
    /// spacers; whether anything changed. Items are mounted from the first in view outwards while the frame has rows
    /// left, and one a frame without: the others are mounted in the frames after (review bigboi 3, carbon 2.1).
    fn place(&mut self, env: &Env<'_>) -> bool {
        let wanted = if self.row { 0..self.items.len() } else { self.wanted(env) };
        let top = if self.row { 0.0 } else { self.top() };
        let pivot = self.prefix[1..].partition_point(|end| *end <= top).clamp(wanted.start, wanted.end);
        let mut mounted_now = 0;
        let mut ensure = |list: &mut Self, index: usize| {
            if list.items[index].mounted.is_some() {
                return true;
            }
            let frame = crate::limits::frame_of(env.host.app());
            if list.mounted_in.replace(Some(frame)) == Some(frame) && !crate::limits::frame_room(env.host.app(), 1) {
                return false;
            }
            let wrapper = View::new(env.host.app()).column().shrink(0.0);
            let mut mounted = Mounted { wrapper, tree: Tree::default() };
            apply(env, &mut mounted, &list.items[index].node);
            mounted.tree.restore_drafts(&mut list.drafts);
            list.items[index].mounted = Some(mounted);
            mounted_now += 1;
            true
        };
        let mut end = pivot;
        while end < wanted.end && ensure(self, end) {
            end += 1;
        }
        let mut start = pivot;
        while start > wanted.start && ensure(self, start - 1) {
            start -= 1;
        }
        let want = start..end;
        if want != wanted {
            // The rest of the window mounts in the next frames.
            Tree::defer();
            env.host.app().animate(|cx, _| {
                crate::behave::arm(cx.app());
                false
            });
        }
        let mut changed = want != self.window || mounted_now > 0;
        let mut heights = false;
        visited(self.window.len() + want.len());
        for index in self.window.start.min(want.start)..self.window.end.max(want.end) {
            if want.contains(&index) {
                continue;
            }
            let item = &mut self.items[index];
            if let Some(mounted) = item.mounted.take() {
                unmount(mounted, &mut self.drafts);
                changed = true;
                // Built again and not laid out since: without widgets it takes its estimate.
                if item.measured.is_none() && item.used != f64::from(item.estimate) {
                    item.used = f64::from(item.estimate);
                    heights = true;
                }
            }
        }
        if heights {
            self.sum();
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

    /// Records every id of the items' data, under the list `list`, as [`Tree`]'s validation reads them; the layout
    /// levels the deepest takes, and the nodes of all of them.
    pub fn collect_ids(&self, list: &str, ids: &mut HashMap<String, Held>) -> (u16, u64) {
        let (mut deepest, mut count) = (0, 0);
        for item in &self.items {
            let (depth, nodes) = held_ids(&item.node, Some(list), &item.key, list, ids);
            (deepest, count) = (deepest.max(depth), count + nodes);
        }
        (deepest, count)
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
    let item = Env { full: false, item: true, ..*env };
    if let Err(refused) = mounted.tree.apply(&item, &mounted.wrapper, std::slice::from_ref(node)) {
        log::error!("a list item the tree took was refused: {refused}");
    }
}

/// Drops an item's widgets, keeping what the user typed into its inputs in `drafts`.
fn unmount(mut mounted: Mounted, drafts: &mut crate::reconcile::Drafts) {
    mounted.tree.take_drafts(drafts);
    mounted.tree.clear(&mounted.wrapper);
    mounted.wrapper.detach();
}

/// The anchors of `node`'s data, in content order: each anchored box, and each hunk of a diff with `hunks`, counted
/// from its text. A scroll or list in it has anchors of its own.
fn logical(node: &Node, env: &Env<'_>) -> Vec<(String, AnchorAt)> {
    fn walk(node: &Node, env: &Env<'_>, out: &mut Vec<(String, AnchorAt)>) {
        match node {
            // A hidden box shows nothing, so nothing in it is an anchor (review carbon-5).
            Node::Box { .. } if node.is_hidden() => return,
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
                // A patch past one node's text or hunks, or whose content its plugin could not hold, is a placeholder
                // once it mounts: it has no hunks (review carbon 2.2). Its text is read once a handle.
                let limits = crate::limits::get();
                let text = match content {
                    Source::Content(handle) if (env.dropped)(*handle) => Default::default(),
                    source => (env.measure)(source),
                };
                let past = text.bytes > limits.text || text.hunks > limits.hunks;
                let hunks = if past { 0 } else { text.hunks.max(1) as usize };
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

/// The value of each input with an id in `node`'s subtree, nested lists included.
fn inputs<'a>(node: &'a Node, values: &mut HashMap<&'a str, &'a str>) {
    if let Node::Input { id: Some(id), value, .. } = node {
        values.insert(id, value);
    }
    for child in node.children() {
        inputs(child, values);
    }
    if let Node::List { items, .. } = node {
        for item in items {
            inputs(&item.node, values);
        }
    }
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

/// Records the ids of `node`, in item `item` of list `list`, under `above`; the layout levels it takes and its nodes.
fn held_ids(node: &Node, above: Option<&str>, item: &str, list: &str, held: &mut HashMap<String, Held>) -> (u16, u64) {
    let id = node.id();
    let (mut deepest, mut nodes) = (0, 1);
    for child in node.children() {
        let (depth, inner) = held_ids(child, id.or(above), item, list, held);
        (deepest, nodes) = (deepest.max(depth), nodes + inner);
    }
    if let (Node::List { items, .. }, Some(inner)) = (node, id) {
        for nested in items {
            let key = nested.node.id().unwrap_or_default();
            let (depth, within) = held_ids(&nested.node, Some(inner), key, inner, held);
            (deepest, nodes) = (deepest.max(depth), nodes + within);
        }
    }
    let depth = weight_of(node) + deepest;
    if let Some(id) = id {
        let item = Some((list.to_owned(), item.to_owned()));
        held.insert(id.to_owned(), Held { above: above.map(str::to_owned), depth, nodes, item });
    }
    (depth, nodes)
}
