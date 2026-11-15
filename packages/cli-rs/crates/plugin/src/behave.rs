//! Host behaviors of contract 2.0 (synthesis 3.5, 4.2, 4.4; phase P3): what the host resolves after the solve, with
//! this frame's geometry and no plugin call, and the `layout` call that follows.
//!
//! **The hook.** OpenTUI's `App` calls the host between solve and paint only for a resize, so the hook is a node
//! (spike S0): an absolute box of no height whose width [`arm`] flips between 1 and 2. The next solve resizes it, and
//! its resize handler runs the behaviors of every live 2.0 mount of its app. A layout round walks the tree depth first
//! in paint order, z-index then child order, and a rect reads the new solve once the walk has passed its node, so the
//! hook is walked last: it has the highest z-index and is the root's last child, put in once and never moved (a node
//! added or moved in a frame is resized before its siblings in it), and every root child added after it goes in
//! before it ([`opencode_ui::root::add`]). Arming only flips its width. When a
//! behavior changes something it reads (an offset, a mounted chunk or list item), the hook arms again and the stepper
//! solves another round in the same frame. Then geometry is final: the landings of steps, then each surface's
//! `layout` call when something it named changed. A view a resize asked for (a mount's root laid out at another size
//! than its view saw) runs first in a round, with the room that solve gave, and the next round solves its tree, so the
//! first frame after a resize shows the view of the new size (`settled-first`).
//!
//! **Budgets.** A frame runs at most [`ROUNDS`] rounds of the hook (OpenTUI's stepper fails the frame past 8 solves,
//! and other widgets need some), and a mount gets at most [`DELIVERIES`] `layout` calls a frame, of which only the
//! first may run its view again in the frame. Work left when a budget runs out (behaviors that have not settled, a
//! delivery or a view `layout` asked for) goes on in the next frame, which the hook asks for; `layout` is never told
//! a geometry the behaviors have not settled. After [`STALLED`] frames in a row with work left, the hook stops asking
//! and waits for another cause.
//!
//! **What arms it** (4.4): a new tree, a verb, the wheel on a scroll of a mount, a resize of a scroll, its content or
//! a mount's root, any key while a mount lives, and the published transcript's moves. Arming forces one solve in that
//! frame.
//!
//! **What a mount holds** (4.2): its pending [`Scroll::To`]s and the memory of each scroll's last [`Scroll::Step`],
//! the paints of its `layout` calls, and the signature of what the last call was told. All of it goes with the mount.
//!
//! **Whose it is.** Each app has its own hook, mounts and transcript. A verb belongs to the mount whose handler asked
//! for it, found when it is asked for: when that mount is gone when the verb applies, it is dropped. A verb on the
//! transcript is taken only from a handler of the user's input: a key, a click, the palette, the wheel; not a
//! command the plugin dispatched, a reply, a wake or the report of its own verb.

use std::cell::{Cell, RefCell};
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::rc::{Rc, Weak};

use opencode_plugin_abi::v2::{
    self, AnchorAt, Edge, Geometry, LayoutFn, LayoutReply, Node, Notify, Scroll, ScrollEvent, ScrollState, Split,
    Target, Top, TranscriptView,
};
use opencode_plugin_abi::{self as abi};
use opentui::input::MouseEventKind;
use opentui::prelude::*;
use opentui::widget::ScrollCause;

use crate::reconcile::{Extra, Mounted};
use crate::surface::Surface;

/// Rounds of the hook in one frame. OpenTUI's stepper allows 8 solves a frame, and other widgets need some.
pub const ROUNDS: u32 = 6;
/// `layout` calls a mount gets in a frame: one, and one more after the view the first asked for with `again`.
pub const DELIVERIES: u32 = 2;
/// Frames in a row that may end with work left before the hook waits for another cause.
pub const STALLED: u32 = 8;

/// What a mount's plugin calls, outside its view: `layout`, and its handler of scroll events. Each runs as one call
/// of the plugin.
#[derive(Clone, Default)]
pub(crate) struct Calls {
    pub plugin: String,
    pub layout: Option<LayoutFn>,
    /// Whether the plugin failed or its activation ended: its mounts then leave the behaviors.
    pub ended: Option<Rc<dyn Fn() -> bool>>,
}

impl Calls {
    fn ended(&self) -> bool {
        self.ended.as_ref().is_some_and(|ended| ended())
    }
}

/// What the behaviors of one mount hold.
#[derive(Default)]
pub(crate) struct State {
    /// Each scroll's pending `To`.
    pending: HashMap<String, Pending>,
    /// Each scroll's last step: group, anchor id, and the offset it left.
    steps: HashMap<String, (String, String, i32)>,
    /// The offset each `To` reached since the last `layout` call.
    reached: Vec<(String, i32)>,
    /// Steps that landed in the behaviors, to report once geometry is final.
    landed: Vec<(String, AnchorAt)>,
    /// The translate each sticky node has now, by widget.
    translated: HashMap<u32, f64>,
    /// The scroll widgets whose wheel and resize arm the hook.
    hooked: HashSet<u32>,
    /// The signature of what the last `layout` call was told.
    seen: Option<Signature>,
    /// The frame of the last `layout` call, and how many the mount had in it.
    delivered: (u64, u32),
    /// The backgrounds `layout` painted, by node.
    paints: HashMap<String, Painted>,
    index: Option<Rc<Index>>,
}

/// A pending [`Scroll::To`]: the node it brings into view, the node whose list item holds it, where it goes, and,
/// for a step to an anchor without widgets, the step to report once it lands.
#[derive(Clone, Debug)]
struct Pending {
    node: String,
    owner: String,
    aim: Aim,
    step: Option<(String, AnchorAt)>,
}

/// A background `layout` painted: the color, the box's own background when it did, and the widget it painted.
struct Painted {
    bg: abi::Color,
    declared: Option<abi::Color>,
    widget: u32,
}

/// Hashes of what a `layout` call was told: the rects and sizes of what it named, their offsets, the top anchors of
/// `notify_top` scrolls, and those scrolls' sizes.
#[derive(Clone, Copy, PartialEq, Eq)]
struct Signature {
    rects: u64,
    offsets: u64,
    tops: u64,
    shape: u64,
}

impl Signature {
    /// Whether a call told `self` must be told `next` too: nothing it named changed. A `notify_top` scroll's size
    /// alone does not call.
    fn calls(&self, next: &Signature) -> bool {
        (self.rects, self.offsets, self.tops) == (next.rects, next.offsets, next.tops)
    }
}

/// What a mount's delivery did.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Delivered {
    /// Nothing it named changed, or it has no `layout`.
    Nothing,
    Told,
    /// It was told, and asked for a view again.
    Again,
    /// It has something to be told, past its deliveries of this frame.
    Capped,
}

/// Where a pending `To` goes in this round.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Resolve {
    To(i32),
    /// Its node has no rows: it waits.
    Unsolved,
    /// Its node left the tree.
    Gone,
}

#[derive(Clone, Debug)]
enum Aim {
    /// The node's top this many rows below the viewport's top.
    Row(i32),
    /// The least move from the offset the verb was asked at, below this many rows: the rounds that mount the node
    /// move the offset on the way, and the move is the user's view of then.
    Nearest { inset: i32, from: i32 },
}

/// The behaviors of a mounted tree, found by walking it: its scrolls and lists, and its nodes by id.
#[derive(Default)]
pub(crate) struct Index {
    scrolls: HashMap<String, Scrolled>,
    /// Each mounted node with an id: its widget, and the scroll it is in.
    nodes: HashMap<String, (AnyWidget, Option<String>)>,
    /// Each box with an id: its view and its own background.
    boxes: HashMap<String, (View, Option<abi::Color>)>,
}

struct Scrolled {
    widget: ScrollBox,
    /// Each anchor with widgets: its group, itself, and its widget.
    anchors: Vec<(String, AnchorAt, AnyWidget)>,
    /// A sticky node, its parent, and its edge.
    stickies: Vec<(AnyWidget, AnyWidget, Edge)>,
    chunked: Vec<Rc<opencode_ui::diff::Chunked>>,
    notify_top: Option<String>,
    user_scroll: bool,
    /// A list of items in a row: its offset is horizontal.
    row: bool,
    /// Where a verb's last move meant to go: a row, or the end (`None`).
    went: Cell<Option<Option<f64>>>,
}

impl Scrolled {
    fn state(&self) -> ScrollState {
        let (viewport, content) = (self.widget.rect(), self.widget.content_view().rect());
        let (viewport, extent) = match self.row {
            true => (viewport.width, content.width),
            false => (viewport.height, content.height),
        };
        ScrollState { offset: self.offset(), viewport: viewport as i32, extent: extent as i32 }
    }

    /// The offset along the scroll's axis.
    fn offset(&self) -> i32 {
        let (x, y) = self.widget.scroll_position();
        (if self.row { x } else { y }).round() as i32
    }

    /// Scrolls to `offset` along its axis; the other stays. An offset at or past the end is the end.
    fn go(&self, offset: i64) {
        let most = i64::from((self.state().extent - self.state().viewport).max(0));
        self.went.set(Some((offset < most || most == 0).then(|| offset.clamp(0, most) as f64)));
        let offset = offset.clamp(0, i64::from(i32::MAX)) as f64;
        let (x, y) = self.widget.scroll_position();
        match self.row {
            true => drop(self.widget.scroll_to(offset, y)),
            false => drop(self.widget.scroll_to(x, offset)),
        }
    }

    /// Rows from the content's start to `widget`, once it is laid out, where it is without the translates of sticky
    /// nodes: the row it has in the content.
    fn y(&self, widget: &impl Widget, translated: &HashMap<u32, f64>) -> Option<i32> {
        let rect = widget.rect();
        let content = self.widget.content_view();
        let (at, start, size) = match self.row {
            true => (rect.screen_x, content.rect().screen_x, rect.width),
            false => (rect.screen_y, content.rect().screen_y, rect.height),
        };
        if size <= 0.0 {
            return None;
        }
        let mut shift = 0.0;
        if !translated.is_empty() && !self.row {
            let mut node = Some(widget.as_any());
            while let Some(at) = node.filter(|at| at.id() != content.id()) {
                shift += translated.get(&at.id()).copied().unwrap_or(0.0);
                node = at.parent();
            }
        }
        Some((at - shift - start).round() as i32)
    }
}

impl Index {
    fn build(nodes: &[Mounted]) -> Self {
        let mut index = Index::default();
        index.walk(nodes, None, None);
        index
    }

    fn walk(&mut self, nodes: &[Mounted], scroll: Option<&str>, parent: Option<&AnyWidget>) {
        for mounted in nodes {
            // A hidden box shows nothing: what is in it is no anchor, sticky or scroll of the moment (review carbon-5).
            if mounted.node.is_hidden() {
                continue;
            }
            let id = mounted.node.id();
            if let (Some(id), Some(widget)) = (id, &mounted.widget) {
                self.nodes.insert(id.to_owned(), (widget.clone(), scroll.map(str::to_owned)));
            }
            match (&mounted.node, &mounted.extra) {
                (Node::Box { sticky, anchor, bg, .. }, Extra::Box { view, .. }) => {
                    if let Some(id) = id {
                        self.boxes.insert(id.to_owned(), (view.clone(), bg.clone()));
                    }
                    if let Some(scrolled) = scroll.and_then(|scroll| self.scrolls.get_mut(scroll)) {
                        if let (Some(edge), Some(parent)) = (sticky, parent) {
                            scrolled.stickies.push((view.as_any(), parent.clone(), *edge));
                        }
                        if let (Some(anchor), Some(id)) = (anchor, id) {
                            let at = AnchorAt {
                                id: id.to_owned(),
                                owner: id.to_owned(),
                                index: 0,
                                variant: anchor.variant.clone(),
                                row: 0,
                            };
                            scrolled.anchors.push((anchor.group.clone(), at, view.as_any()));
                        }
                    }
                    self.walk(&mounted.children, scroll, Some(&view.as_any()));
                }
                (Node::Scroll { notify_top, user_scroll, .. }, Extra::Scroll(widget)) => {
                    let Some(id) = id else { continue };
                    let scrolled = scrolled(widget, notify_top.clone(), *user_scroll, false);
                    self.scrolls.insert(id.to_owned(), scrolled);
                    self.walk(&mounted.children, Some(id), Some(&widget.content_view().as_any()));
                }
                (Node::List { notify_top, user_scroll, row, .. }, Extra::List(list)) => {
                    let Some(id) = id else { continue };
                    let scrolled = scrolled(&list.scroll, notify_top.clone(), *user_scroll, *row);
                    self.scrolls.insert(id.to_owned(), scrolled);
                    for item in &list.items {
                        if let Some(mounted) = &item.mounted {
                            self.walk(&mounted.tree.nodes, Some(id), Some(&mounted.wrapper.as_any()));
                        }
                    }
                }
                (Node::Diff { hunks: Some(group), .. }, Extra::Diff(patch, _)) => {
                    let (Some(id), Some(scrolled)) = (id, scroll.and_then(|scroll| self.scrolls.get_mut(scroll)))
                    else {
                        continue;
                    };
                    for (index, row) in patch.hunk_rows().into_iter().enumerate() {
                        let at = AnchorAt {
                            id: format!("{id}#{index}"),
                            owner: id.to_owned(),
                            index: index as u32,
                            variant: String::new(),
                            row: 0,
                        };
                        scrolled.anchors.push((group.clone(), at, row));
                    }
                }
                (Node::Diff { hunks, .. }, Extra::Chunked(chunked, _)) => {
                    // Outside a scroll every row of it shows: all its chunks are mounted.
                    let Some(scrolled) = scroll.and_then(|scroll| self.scrolls.get_mut(scroll)) else {
                        chunked.show(0, i64::from(i32::MAX));
                        continue;
                    };
                    scrolled.chunked.push(chunked.clone());
                    if let (Some(group), Some(id)) = (hunks, id) {
                        let at = AnchorAt { id: format!("{id}#0"), owner: id.to_owned(), ..AnchorAt::default() };
                        scrolled.anchors.push((group.clone(), at, chunked.root().as_any()));
                    }
                }
                _ => self.walk(&mounted.children, scroll, mounted.widget.as_ref().or(parent)),
            }
        }
    }
}

fn scrolled(widget: &ScrollBox, notify_top: Option<String>, user_scroll: bool, row: bool) -> Scrolled {
    Scrolled {
        widget: widget.clone(),
        anchors: Vec::new(),
        stickies: Vec::new(),
        chunked: Vec::new(),
        notify_top,
        user_scroll,
        row,
        went: Cell::new(None),
    }
}

// The hook.

struct Hook {
    app: App,
    node: View,
    /// The width the last solve gave the node; arming asks for the other one.
    seen: Cell<u32>,
    /// This frame, and the rounds the hook ran in it.
    frame: Cell<u64>,
    rounds: Cell<u32>,
    /// A frame runs: from the hook's first round in it until its deferred work.
    in_frame: Cell<bool>,
    /// This frame left work for the next.
    frame_owed: Cell<bool>,
    mounts: RefCell<Vec<Weak<Surface>>>,
    /// Work waits for the next frame, whose arm is queued.
    owed: Cell<bool>,
    /// The mounts whose view `layout` asked for, past the frame's budget.
    views: RefCell<Vec<Weak<Surface>>>,
    /// Frames in a row that ended with work left.
    stalled: Cell<u32>,
    this: Weak<Hook>,
}

thread_local! {
    /// Each app's hook, by [`key`].
    static HOOKS: RefCell<HashMap<usize, Rc<Hook>>> = RefCell::default();
    /// Each app's published transcript, by [`key`].
    static TRANSCRIPTS: RefCell<HashMap<usize, (u64, Published)>> = RefCell::default();
    /// Whether the code that runs handles the user's input: a key, a click, the palette, the wheel.
    static USER: Cell<bool> = const { Cell::new(false) };
    /// Whether the plugin call that runs is a handler of the user's input.
    static HANDLER: Cell<bool> = const { Cell::new(false) };
    static COUNTS: Cell<Counts> = Cell::new(Counts::default());
}

/// The key of `app` in the tables of each app: the address of its session, which lives as long as the app. Every
/// entry under it goes before the app does: the hook with the app's last mount, the transcript with its route.
fn key(app: &App) -> usize {
    std::ptr::from_ref(app.session()) as usize
}

fn hook(app: &App) -> Option<Rc<Hook>> {
    HOOKS.with(|hooks| hooks.borrow().get(&key(app)).cloned())
}

/// What a plugin's live mount of a surface holds of the input, for the tests: its generation, the node it focuses,
/// and each scroll's offset, by id.
#[doc(hidden)]
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct MountState {
    pub generation: u64,
    pub focused: Option<String>,
    pub offsets: Vec<(String, i32)>,
}

/// The live mounts of plugin `plugin`'s surface `surface` in `app`, oldest first, for the tests.
#[doc(hidden)]
pub fn mounts(app: &App, plugin: &str, surface: &str) -> Vec<MountState> {
    let Some(hook) = hook(app) else { return Vec::new() };
    let mut mounts = hook.live();
    mounts.retain(|mount| mount.calls.plugin == plugin && mount.id.surface == surface);
    mounts
        .iter()
        .map(|mount| {
            let mut offsets = mount
                .with_index(|index, _| {
                    Some(index.scrolls.iter().map(|(id, scrolled)| (id.clone(), scrolled.state().offset)).collect())
                })
                .unwrap_or_else(Vec::new);
            offsets.sort();
            let focused = mount.holder().and_then(|owner| owner.focused().node);
            MountState { generation: mount.id.generation, focused, offsets }
        })
        .collect()
}

/// Focuses node `node` of plugin `plugin`'s newest live mount of `surface`, as the user would, for the tests: a mount
/// that holds the focus before a verb applies. Whether such a mount was found.
#[doc(hidden)]
pub fn focus(host: &dyn crate::Host, plugin: &str, surface: &str, node: &str) -> bool {
    let Some(hook) = hook(host.app()) else { return false };
    let mut mounts = hook.live();
    mounts.retain(|mount| mount.calls.plugin == plugin && mount.id.surface == surface);
    let Some(owner) = mounts.pop().and_then(|mount| mount.holder()) else { return false };
    owner.focus(host, node);
    true
}

/// What the behaviors did, counted per thread outside any mount (`work`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Counts {
    /// Runs of the behaviors: one a round.
    pub resolves: u64,
    /// `layout` calls.
    pub layouts: u64,
    /// Times the hook was armed.
    pub arms: u64,
    /// Times a hook was put in its root: once a hook.
    pub placed: u64,
    /// List items the behaviors and reads visited.
    pub visits: u64,
}

impl Counts {
    pub fn since(self, before: Counts) -> Counts {
        Counts {
            resolves: self.resolves - before.resolves,
            layouts: self.layouts - before.layouts,
            arms: self.arms - before.arms,
            placed: self.placed - before.placed,
            visits: self.visits - before.visits,
        }
    }
}

/// What the behaviors did on this thread so far.
pub fn counts() -> Counts {
    COUNTS.with(Cell::get)
}

fn tally(f: impl FnOnce(&mut Counts)) {
    COUNTS.with(|cell| {
        let mut counts = cell.get();
        f(&mut counts);
        cell.set(counts);
    });
}

/// Counts `items` list items visited.
pub(crate) fn visited(items: usize) {
    tally(|counts| counts.visits += items as u64);
}

/// Makes `surface` one of the mounts the hook of its app resolves.
pub(crate) fn attach(app: &App, surface: &Rc<Surface>) {
    let hook = HOOKS.with(|hooks| hooks.borrow_mut().entry(key(app)).or_insert_with(|| Hook::new(app)).clone());
    let mut mounts = hook.mounts.borrow_mut();
    mounts.retain(|mount| mount.strong_count() > 0);
    mounts.push(Rc::downgrade(surface));
}

/// Takes `surface` out of the mounts of its app, as its plugin failed or it went, and drops the hook once no mount
/// is left, so a client without 2.0 surfaces has none.
pub(crate) fn detach(app: &App, surface: *const Surface) {
    let root = key(app);
    let gone = HOOKS.with(|hooks| {
        let mut hooks = hooks.borrow_mut();
        let empty = hooks.get(&root).is_some_and(|hook| {
            let mut mounts = hook.mounts.borrow_mut();
            mounts.retain(|mount| mount.strong_count() > 0 && !std::ptr::eq(mount.as_ptr(), surface));
            mounts.is_empty()
        });
        if empty { hooks.remove(&root) } else { None }
    });
    if let Some(hook) = gone {
        opencode_ui::root::release(&hook.app);
    }
}

/// Runs the behaviors after the next solve of `app`, if a mount lives there: in this frame's next round inside a
/// frame, else in the next frame.
pub(crate) fn arm(app: &App) {
    if let Some(hook) = hook(app) {
        hook.arm();
    }
}

impl Hook {
    fn new(app: &App) -> Rc<Self> {
        let node = View::new(app).absolute().width(1).height(0).shrink(0.0).z_index(i32::MAX);
        let hook = Rc::new_cyclic(|this| Hook {
            app: app.clone(),
            node,
            seen: Cell::new(1),
            frame: Cell::new(u64::MAX),
            rounds: Cell::new(0),
            in_frame: Cell::new(false),
            frame_owed: Cell::new(false),
            mounts: RefCell::default(),
            owed: Cell::new(false),
            views: RefCell::default(),
            stalled: Cell::new(0),
            this: this.clone(),
        });
        opencode_ui::root::keep_last(app, &hook.node);
        tally(|counts| counts.placed += 1);
        let weak = Rc::downgrade(&hook);
        hook.node.on_resize(move |_, rect| {
            if let Some(hook) = weak.upgrade() {
                hook.seen.set(rect.width as u32);
                crate::contain::in_frame(|| hook.run());
            }
        });
        hook
    }

    fn arm(&self) {
        tally(|counts| counts.arms += 1);
        match self.in_frame.get() {
            // A solve past the frame's rounds would fail the frame: it goes to the next.
            true if self.rounds.get() >= ROUNDS => return self.owe(),
            true => {}
            // A cause outside a frame starts afresh.
            false => self.stalled.set(0),
        }
        self.node.width(if self.seen.get() == 2 { 1 } else { 2 });
        self.app.request_redraw();
    }

    /// The live mounts, newest last. A mount whose plugin failed leaves first, with what its behaviors held: its
    /// pending verbs, its steps' memory and its paints (P4c's containment).
    fn live(&self) -> Vec<Rc<Surface>> {
        let (live, ended): (Vec<Rc<Surface>>, Vec<Rc<Surface>>) =
            self.mounts.borrow().iter().filter_map(Weak::upgrade).partition(|mount| !mount.calls.ended());
        for mount in ended {
            mount.retire();
        }
        live
    }

    /// One round: every mount's behaviors; another round while one changed what it reads, then the landings and the
    /// `layout` calls.
    fn run(&self) {
        let frame = self.app.frame_number();
        if self.frame.replace(frame) != frame {
            self.rounds.set(0);
            if !self.frame_owed.replace(false) {
                self.stalled.set(0);
            }
            self.in_frame.set(true);
            let hook = self.this.clone();
            self.app.defer(move |_| {
                if let Some(hook) = hook.upgrade() {
                    hook.in_frame.set(false);
                }
            });
        }
        self.rounds.set(self.rounds.get() + 1);
        tally(|counts| counts.resolves += 1);
        let live = self.live();
        // The views resizes asked for run first, on the room this solve gave: the next round solves their trees. Past
        // the rounds they wait for the next frame's first round.
        let mut owed = live.iter().any(|mount| mount.sized());
        if owed && self.rounds.get() < ROUNDS {
            live.iter().for_each(|mount| mount.draw_solved());
            return self.again();
        }
        let mut changed = false;
        for mount in live {
            changed |= mount.resolve();
        }
        if changed {
            return self.again();
        }
        // Geometry is final. A mount a call before it ends is not called.
        let mounts: Vec<Weak<Surface>> = self.mounts.borrow().clone();
        for mount in mounts {
            // A mount whose root no solve has laid out yet has no geometry to tell: it is told once one does.
            let Some(mount) = mount.upgrade().filter(|mount| mount.laid()) else { continue };
            mount.report();
            match mount.deliver(frame) {
                Delivered::Nothing | Delivered::Told => {}
                Delivered::Again if self.rounds.get() < ROUNDS => mount.draw_again(),
                Delivered::Again => {
                    self.views.borrow_mut().push(mount.weak());
                    owed = true;
                }
                Delivered::Capped => owed = true,
            }
        }
        if owed {
            self.owe();
        }
    }

    /// Another round in this frame, or the next frame once its rounds ran out.
    fn again(&self) {
        if self.rounds.get() < ROUNDS {
            self.arm();
        } else {
            self.owe();
        }
    }

    /// Goes on in the next frame: the views `layout` asked for, then the behaviors; not past [`STALLED`] frames in a
    /// row that left work.
    fn owe(&self) {
        if !self.frame_owed.replace(true) {
            self.stalled.set(self.stalled.get() + 1);
        }
        if self.stalled.get() > STALLED {
            if !self.owed.get() {
                log::warn!("plugin behaviors did not settle in {STALLED} frames; waiting for another cause");
            }
            self.views.borrow_mut().clear();
            return;
        }
        if self.owed.replace(true) {
            return;
        }
        let hook = self.this.clone();
        self.app.defer(move |_| {
            let Some(hook) = hook.upgrade() else { return };
            hook.owed.set(false);
            let views = std::mem::take(&mut *hook.views.borrow_mut());
            views.iter().filter_map(Weak::upgrade).for_each(|mount| mount.draw_again());
            hook.arm();
        });
        self.app.request_redraw();
    }
}

// Handlers and the transcript.

/// Runs `f` as code that handles the user's input, or as code that does not.
pub(crate) fn as_user<R>(user: bool, f: impl FnOnce() -> R) -> R {
    let outer = USER.with(|cell| cell.replace(user));
    let out = f();
    USER.with(|cell| cell.set(outer));
    out
}

/// Whether the code that runs handles the user's input: the pipe carrier carries it to where a call's effects apply.
pub(crate) fn user() -> bool {
    USER.with(Cell::get)
}

/// Runs `f` as a call of kind `export`: a command or a scroll handler that runs for the user's input is a handler of
/// it, which a verb on the transcript is taken from.
pub(crate) fn calling<R>(export: &str, f: impl FnOnce() -> R) -> R {
    let handler = USER.with(Cell::get) && matches!(export, "run-command" | "handle");
    let outer = HANDLER.with(|cell| cell.replace(handler));
    let out = f();
    HANDLER.with(|cell| cell.set(outer));
    out
}

/// Whether the running plugin call handles the user's input.
pub(crate) fn in_handler() -> bool {
    HANDLER.with(Cell::get)
}

/// The session transcript, as its route publishes it (`Viewport::Transcript`).
pub struct Published {
    /// What the view is now.
    pub read: Rc<dyn Fn() -> TranscriptView>,
    /// Moves the transcript through its own scroll path, the one its wheel takes: `By`, `Offset` or `Edge`.
    pub scroll: Rc<dyn Fn(&Scroll)>,
}

/// Publishes the transcript of `app` while the returned guard lives. Its moves and resizes arm the hook through
/// [`transcript_moved`].
pub fn publish_transcript(app: &App, published: Published) -> Publication {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    let id = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let key = key(app);
    TRANSCRIPTS.with(|transcripts| transcripts.borrow_mut().insert(key, (id, published)));
    Publication { key, id }
}

/// The transcript stays published while it lives, or until a newer one of its app is.
pub struct Publication {
    key: usize,
    id: u64,
}

impl Drop for Publication {
    fn drop(&mut self) {
        TRANSCRIPTS.with(|transcripts| {
            let mut transcripts = transcripts.borrow_mut();
            if transcripts.get(&self.key).is_some_and(|(id, _)| *id == self.id) {
                transcripts.remove(&self.key);
            }
        });
    }
}

/// The transcript moved or changed: a surface told about it hears of it in this frame.
pub fn transcript_moved(app: &App) {
    arm(app);
}

/// What the published transcript of `app` is now.
pub(crate) fn transcript(app: &App) -> Option<TranscriptView> {
    let read = TRANSCRIPTS.with(|transcripts| transcripts.borrow().get(&key(app)).map(|(_, it)| it.read.clone()))?;
    Some(read())
}

// Verbs and reads, by plugin.

/// Who asks: the app, the plugin, and the mount whose call runs, when one does.
pub(crate) struct Caller<'a> {
    pub app: &'a App,
    pub plugin: &'a str,
    pub mount: Option<Weak<()>>,
}

/// Plugin `caller`'s mount of `surface`: the one whose call runs when it shows that surface, else the newest live.
fn mount(caller: &Caller<'_>, surface: &str) -> Option<Rc<Surface>> {
    let hook = hook(caller.app)?;
    let mut mounts = hook.live();
    mounts.retain(|mount| mount.calls.plugin == caller.plugin && mount.id.surface == surface);
    let own = caller.mount.as_ref().and_then(|own| mounts.iter().rposition(|mount| Weak::ptr_eq(&mount.alive(), own)));
    match own {
        Some(at) => Some(mounts.swap_remove(at)),
        // A call of a mount that closed: its verb ends with it, and never reaches a mount opened since (carbon own-1).
        None if caller.mount.as_ref().is_some_and(|own| own.upgrade().is_none()) => None,
        None => mounts.pop(),
    }
}

/// The effect of plugin `caller`'s verb on `target`: the mount it names is found now, and the verb applies to it
/// only while it lives.
pub(crate) fn scroll(caller: &Caller<'_>, target: Target, verb: Scroll) -> Box<dyn FnOnce()> {
    match target {
        Target::Transcript => {
            let (key, plugin) = (key(caller.app), caller.plugin.to_owned());
            Box::new(move || {
                let scroll =
                    TRANSCRIPTS.with(|transcripts| transcripts.borrow().get(&key).map(|(_, it)| it.scroll.clone()));
                match (scroll, &verb) {
                    (Some(scroll), Scroll::By { .. } | Scroll::Offset { .. } | Scroll::Edge { .. }) => scroll(&verb),
                    (Some(_), _) => log::warn!("plugin {plugin}: the transcript takes By, Offset and Edge only"),
                    (None, _) => {}
                }
            })
        }
        Target::Node { surface, id } => {
            let mounted = mount(caller, &surface).map(|mount| mount.weak());
            Box::new(move || {
                let Some(mounted) = mounted.and_then(|mount| mount.upgrade()).filter(|mount| !mount.calls.ended())
                else {
                    return;
                };
                if let Some(anchor) = mounted.verb(&id, &verb) {
                    mounted.landed(&id, anchor);
                }
            })
        }
    }
}

pub(crate) fn scroll_state(caller: &Caller<'_>, target: &Target) -> Option<ScrollState> {
    match target {
        Target::Transcript => transcript(caller.app).map(|view| ScrollState {
            offset: view.offset,
            viewport: view.viewport,
            extent: view.extent,
        }),
        Target::Node { surface, id } => {
            mount(caller, surface)?.with_index(|index, _| Some(index.scrolls.get(id)?.state()))
        }
    }
}

pub(crate) fn anchors(caller: &Caller<'_>, target: &Target, group: &str) -> Vec<AnchorAt> {
    let Target::Node { surface, id } = target else { return Vec::new() };
    mount(caller, surface).map(|mounted| mounted.anchors(id, group)).unwrap_or_default()
}

pub(crate) fn top_anchor(caller: &Caller<'_>, target: &Target, group: &str, inset: u16) -> Option<AnchorAt> {
    let Target::Node { surface, id } = target else { return None };
    mount(caller, surface)?.top_of(id, group, i64::from(inset))
}

// A mount's behaviors.

impl Surface {
    /// Calls `f` with the mount's index, built again after a tree or a window changed.
    pub(crate) fn with_index<R>(&self, f: impl FnOnce(&Index, &mut State) -> Option<R>) -> Option<R> {
        let index = {
            let mut behave = self.behave.borrow_mut();
            match &behave.index {
                Some(index) => index.clone(),
                None => {
                    let built = Rc::new(Index::build(&self.state.borrow().tree.nodes));
                    behave.index = Some(built.clone());
                    built
                }
            }
        };
        self.hook_scrolls(&index);
        f(&index, &mut self.behave.borrow_mut())
    }

    /// Leaves the behaviors, as its plugin failed: what they held for it goes, and its app's hook with its last mount.
    pub(crate) fn retire(&self) {
        detach(self.app(), self);
        *self.behave.borrow_mut() = State::default();
    }

    /// The tree or a window changed: the index is built again when next read.
    pub(crate) fn reindex(&self) {
        self.behave.borrow_mut().index = None;
    }

    /// Makes a move and a resize of each scroll arm the hook, once a widget. A move by the wheel, a key or the pointer
    /// is the user's; the behaviors' own moves and a verb's arm where they are made.
    fn hook_scrolls(&self, index: &Index) {
        for (id, scrolled) in &index.scrolls {
            if !self.behave.borrow_mut().hooked.insert(scrolled.widget.id()) {
                continue;
            }
            let (weak, app, scroll) = (self.weak(), self.app().clone(), id.clone());
            scrolled.widget.on_scroll(move |_, event| match event.cause {
                // Reported before the frame's layout: what the plugin's handler asks for, and the view after it,
                // go into this frame.
                ScrollCause::Wheel | ScrollCause::Key | ScrollCause::Pointer => {
                    if let Some(mounted) = weak.upgrade() {
                        mounted.each_list(&scroll, crate::list::List::moved);
                        mounted.user_moved(&scroll);
                    }
                    crate::flush();
                    arm(&app);
                }
                ScrollCause::Layout => arm(&app),
                ScrollCause::Program => {}
            });
            for resized in [scrolled.widget.as_any(), scrolled.widget.content_view().as_any()] {
                let app = self.app().clone();
                resized.on_resize(move |_, _| arm(&app));
            }
        }
    }

    /// The user moved scroll `scroll`: what a verb left pending ends, and the surface hears of it when the scroll
    /// asks with `user_scroll` now.
    fn user_moved(&self, scroll: &str) {
        let user = self.with_index(|index, behave| {
            behave.pending.remove(scroll);
            behave.steps.remove(scroll);
            Some(index.scrolls.get(scroll)?.user_scroll)
        });
        if let (Some(true), Some(owner)) = (user, self.holder()) {
            owner.hear(&abi::interact::Event::Scroll { event: ScrollEvent::UserScroll { scroll: scroll.to_owned() } });
        }
    }

    /// Reports where a step of scroll `scroll` landed: a result of the plugin's own verb, not the user's input.
    fn landed(&self, scroll: &str, anchor: AnchorAt) {
        if let Some(owner) = self.holder() {
            owner.hear(&abi::interact::Event::Scroll {
                event: ScrollEvent::Landed { scroll: scroll.to_owned(), anchor },
            });
        }
    }

    /// Reports the steps that landed in the behaviors.
    fn report(&self) {
        let landed = std::mem::take(&mut self.behave.borrow_mut().landed);
        for (scroll, anchor) in landed {
            self.landed(&scroll, anchor);
        }
    }

    /// Applies `verb` to scroll `id` now; where a step landed.
    fn verb(&self, id: &str, verb: &Scroll) -> Option<AnchorAt> {
        let anchors = matches!(verb, Scroll::Step { .. }).then(|| self.anchors(id, step_group(verb)));
        // A step that finds no anchor is no move of the list either: a resize in its batch holds the reading.
        let mut moves = !matches!(verb, Scroll::Forget | Scroll::Step { by: 0, .. });
        let landed = self.with_index(|index, behave| {
            let scrolled = index.scrolls.get(id)?;
            scrolled.went.take();
            let state = scrolled.state();
            let (top, viewport, most) =
                (i64::from(state.offset), i64::from(state.viewport), i64::from(state.extent - state.viewport).max(0));
            // A step that finds no anchor moves nothing: what was pending and the memory of the last step stay.
            if !matches!(verb, Scroll::Step { .. }) {
                behave.pending.remove(id);
                behave.steps.remove(id);
            }
            match verb {
                Scroll::To { node, align } => {
                    let aim = match align {
                        v2::ScrollAlign::Start => Aim::Row(0),
                        v2::ScrollAlign::Nearest { inset } => {
                            Aim::Nearest { inset: i32::from(*inset), from: state.offset }
                        }
                        v2::ScrollAlign::Keep => {
                            let (widget, _) = index.nodes.get(node)?;
                            Aim::Row(scrolled.y(widget, &behave.translated)?.saturating_sub(state.offset))
                        }
                    };
                    let owner = node.clone();
                    behave.pending.insert(id.to_owned(), Pending { node: node.clone(), owner, aim, step: None });
                    None
                }
                Scroll::Offset { offset } => {
                    scrolled.go(i64::from(*offset));
                    None
                }
                Scroll::By { rows } => {
                    scrolled.go(top + i64::from(*rows));
                    None
                }
                Scroll::Page { percent } => {
                    // At least a row in the direction asked, as a page of a tiny viewport.
                    let rows = viewport * i64::from(*percent) / 100;
                    scrolled.go(top + if rows == 0 { i64::from(percent.signum()) } else { rows });
                    None
                }
                Scroll::Edge { edge: Edge::Top } => {
                    scrolled.go(0);
                    None
                }
                Scroll::Edge { edge: Edge::Bottom } if scrolled.row => {
                    scrolled.go(most);
                    None
                }
                Scroll::Edge { edge: Edge::Bottom } => {
                    scrolled.widget.scroll_to_bottom();
                    scrolled.went.set(Some(None));
                    None
                }
                Scroll::Forget => None,
                Scroll::Step { by: 0, .. } => None,
                Scroll::Step { group, by, inset } => {
                    let anchors = anchors.unwrap_or_default();
                    let line = top + i64::from(*inset);
                    let from = behave
                        .steps
                        .get(id)
                        .filter(|(stepped, _, left)| stepped == group && i64::from(*left) == top)
                        .and_then(|(_, anchor, _)| anchors.iter().position(|at| at.id == *anchor));
                    let next = match from {
                        Some(at) => usize::try_from(at as i64 + i64::from(*by)).ok().and_then(|at| anchors.get(at)),
                        None if *by > 0 => anchors.iter().find(|at| i64::from(at.row) > line),
                        None => anchors.iter().rev().find(|at| i64::from(at.row) < line),
                    };
                    let Some(next) = next else {
                        moves = false;
                        return None;
                    };
                    behave.pending.remove(id);
                    // An anchor of a list item without widgets: the item is mounted where the host assumes it, and
                    // the step lands, and reports, once its own rows are known.
                    if !scrolled.anchors.iter().any(|(_, at, _)| at.id == next.id) {
                        let pending = Pending {
                            node: next.id.clone(),
                            owner: next.owner.clone(),
                            aim: Aim::Row(i32::from(*inset)),
                            step: Some((group.clone(), next.clone())),
                        };
                        behave.pending.insert(id.to_owned(), pending);
                        behave.steps.remove(id);
                        return None;
                    }
                    let target = (i64::from(next.row) - i64::from(*inset)).clamp(0, most);
                    scrolled.go(target);
                    behave.steps.insert(id.to_owned(), (group.clone(), next.id.clone(), target as i32));
                    Some(next.clone())
                }
            }
        });
        if moves {
            self.each_list(id, crate::list::List::moved);
        }
        // A list holds the reading position from where the move meant to go, not where a solve clamps it.
        if let Some(went) = self.with_index(|index, _| index.scrolls.get(id)?.went.take()) {
            self.each_list(id, |list| list.intend(went));
        }
        arm(self.app());
        landed
    }

    /// The anchors of `group` in scroll `id`, in content order: those with widgets at their rows, and for a list,
    /// the anchors of each item without widgets at the row the host assumes for the item.
    pub(crate) fn anchors(&self, id: &str, group: &str) -> Vec<AnchorAt> {
        let mut found = self
            .with_index(|index, behave| {
                let scrolled = index.scrolls.get(id)?;
                let anchors: Vec<AnchorAt> = scrolled
                    .anchors
                    .iter()
                    .filter(|(of, _, _)| of == group)
                    .filter_map(|(_, anchor, widget)| {
                        Some(AnchorAt { row: scrolled.y(widget, &behave.translated)?, ..anchor.clone() })
                    })
                    .collect();
                Some(anchors)
            })
            .unwrap_or_default();
        self.each_list(id, |list| found.extend(list.unmounted_anchors(group, 0..list.items.len())));
        found.sort_by_key(|anchor| anchor.row);
        found
    }

    /// The top anchor of `group` in scroll `scroll`: the last at or above `inset` rows below its offset. A list's
    /// is found from the item at that row back, not from the whole group.
    fn top_of(&self, scroll: &str, group: &str, inset: i64) -> Option<AnchorAt> {
        let (line, mounted) = self.with_index(|index, behave| {
            let scrolled = index.scrolls.get(scroll)?;
            let line = i64::from(scrolled.offset()) + inset;
            let mounted = scrolled
                .anchors
                .iter()
                .filter(|(of, _, _)| of == group)
                .filter_map(|(_, anchor, widget)| {
                    Some(AnchorAt { row: scrolled.y(widget, &behave.translated)?, ..anchor.clone() })
                })
                .filter(|anchor| i64::from(anchor.row) <= line)
                .max_by_key(|anchor| anchor.row);
            Some((line, mounted))
        })?;
        let mut unmounted = None;
        self.each_list(scroll, |list| unmounted = list.anchor_above(group, line));
        [mounted, unmounted].into_iter().flatten().max_by_key(|anchor| anchor.row)
    }

    /// Calls `f` with list `id` of the tree, if it is one.
    fn each_list(&self, id: &str, f: impl FnOnce(&crate::list::List)) {
        fn find<'a>(nodes: &'a [Mounted], id: &str) -> Option<&'a crate::list::List> {
            nodes.iter().find_map(|node| match &node.extra {
                Extra::List(list) if node.node.id() == Some(id) => Some(&**list),
                Extra::List(list) => list.items.iter().find_map(|item| find(&item.mounted.as_ref()?.tree.nodes, id)),
                _ => find(&node.children, id),
            })
        }
        let state = self.state.borrow();
        if let Some(list) = find(&state.tree.nodes, id) {
            f(list);
        }
    }

    /// The behaviors after a solve: list windows, then, once they hold, pending `To`s, chunks near the view and sticky
    /// nodes. Whether it changed something it reads, so the solve runs again.
    pub(crate) fn resolve(&self) -> bool {
        // Items mounted or unmounted move what the solve laid out: the rest waits for the next round's solve.
        if self.windows() {
            self.reindex();
            return true;
        }
        let (changed, jumped) = self
            .with_index(|index, behave| {
                let (mut changed, mut jumped) = (false, false);
                let mut scrolls: Vec<(&String, &Scrolled)> = index.scrolls.iter().collect();
                scrolls.sort_by_key(|(id, _)| *id);
                for (id, scrolled) in scrolls {
                    let before = scrolled.offset();
                    let viewport = scrolled.state().viewport;
                    let pending = behave.pending.get(id).cloned();
                    let mut decided = None;
                    let aim = pending.as_ref().map(|pending| {
                        let found = index
                            .nodes
                            .get(&pending.node)
                            .filter(|(_, scroll)| scroll.as_deref() == Some(id.as_str()))
                            .map(|(widget, _)| widget.clone())
                            .or_else(|| {
                                let hunk = scrolled.anchors.iter().find(|(_, at, _)| at.id == pending.node);
                                hunk.map(|(_, _, widget)| widget.clone())
                            });
                        let laid = found.is_some();
                        let (y, height) = match found {
                            Some(widget) => {
                                let Some(y) = scrolled.y(&widget, &behave.translated) else { return Resolve::Unsolved };
                                let rect = widget.rect();
                                (y, if scrolled.row { rect.width } else { rect.height } as i32)
                            }
                            // A node of a list item without widgets: where the host assumes the item is, which
                            // mounts it; the next round has its own rows. A node that has left drops the verb.
                            None => match self.item_row(id, &pending.owner) {
                                Some(assumed) => assumed,
                                None => return Resolve::Gone,
                            },
                        };
                        Resolve::To(match pending.aim {
                            Aim::Row(row) => y.saturating_sub(row),
                            // Decided once the node has rows, from the offset it was asked at; then the node keeps its
                            // row in the view, as a list's corrections move both.
                            Aim::Nearest { inset, from } => {
                                let target = nearest(y, height, from, viewport, inset);
                                if laid {
                                    decided = Some(Aim::Row(y.saturating_sub(target)));
                                }
                                target
                            }
                        })
                    });
                    if let (Some(aim), Some(pending)) = (decided, behave.pending.get_mut(id)) {
                        pending.aim = aim;
                    }
                    match aim {
                        Some(Resolve::To(target)) => scrolled.go(i64::from(target)),
                        Some(Resolve::Gone) => drop(behave.pending.remove(id)),
                        Some(Resolve::Unsolved) | None => {}
                    }
                    let top = scrolled.offset();
                    // A list that held its reading position moved the offset, not the view; unless the end clamped it.
                    let (mut shift, mut clamped) = (0.0, false);
                    self.each_list(id, |list| (shift, clamped) = list.take_shift());
                    if let Some((_, _, left)) = behave.steps.get_mut(id) {
                        *left = left.saturating_add(shift.round() as i32);
                    }
                    if clamped {
                        behave.steps.remove(id);
                    }
                    // A step's memory holds while the view has not moved: once a solve shows another offset, it is
                    // gone, also if the offset comes back later.
                    if behave.steps.get(id).is_some_and(|(_, _, left)| *left != top) {
                        behave.steps.remove(id);
                    }
                    if matches!(aim, Some(Resolve::To(_))) && top == before {
                        let pending = behave.pending.remove(id);
                        behave.reached.push((id.clone(), top));
                        if let Some((group, anchor)) = pending.and_then(|pending| pending.step) {
                            let row = self.anchor_row(index, behave, scrolled, &anchor.id).unwrap_or(anchor.row);
                            behave.steps.insert(id.clone(), (group, anchor.id.clone(), top));
                            behave.landed.push((id.clone(), AnchorAt { row, ..anchor }));
                        }
                    }
                    changed |= top != before;
                    jumped |= matches!(aim, Some(Resolve::To(_))) && top != before;
                    let content = scrolled.widget.content_view().rect();
                    for chunked in &scrolled.chunked {
                        let y = (chunked.root().rect().screen_y - content.screen_y).round() as i64;
                        changed |= chunked.show(i64::from(top) - y, i64::from(viewport));
                    }
                    for (node, parent, edge) in &scrolled.stickies {
                        let now = behave.translated.get(&node.id()).copied();
                        let shift = sticky(scrolled, node, parent, *edge, top, &behave.translated)
                            .unwrap_or(now.unwrap_or(0.0));
                        if now != Some(shift) {
                            node.translate(0.0, shift);
                            behave.translated.insert(node.id(), shift);
                        }
                    }
                }
                Some((changed, jumped))
            })
            .unwrap_or((false, false));
        // A jump mounts the items around where it went in its own round, not the next.
        if jumped && self.windows() {
            self.reindex();
        }
        changed
    }

    /// The row of anchor `id` of scroll `scrolled`, when it has widgets.
    fn anchor_row(&self, index: &Index, behave: &State, scrolled: &Scrolled, id: &str) -> Option<i32> {
        let widget = index
            .nodes
            .get(id)
            .map(|(widget, _)| widget)
            .or_else(|| scrolled.anchors.iter().find(|(_, at, _)| at.id == id).map(|(_, _, widget)| widget))?;
        scrolled.y(widget, &behave.translated)
    }

    /// The row and the rows the host assumes for the list item whose data holds `node`, in list `list`.
    fn item_row(&self, list: &str, node: &str) -> Option<(i32, i32)> {
        let mut row = None;
        self.each_list(list, |found| {
            row = found.owner(node).map(|item| (clamp_row(found.row_of(item)), clamp_row(found.rows_of(item))));
        });
        row
    }

    /// Calls `layout` when something it was told about changed, or a `To` reached its place, at most
    /// [`DELIVERIES`] times in frame `frame`.
    pub(crate) fn deliver(&self, frame: u64) -> Delivered {
        let Some(layout) = self.calls.layout.clone() else {
            self.behave.borrow_mut().reached.clear();
            return Delivered::Nothing;
        };
        let Some((geometry, signature)) = self.geometry() else { return Delivered::Nothing };
        let mut behave = self.behave.borrow_mut();
        if behave.reached.is_empty() && behave.seen.is_some_and(|seen| seen.calls(&signature)) {
            return Delivered::Nothing;
        }
        if behave.delivered.0 != frame {
            behave.delivered = (frame, 0);
        }
        if behave.delivered.1 >= DELIVERIES {
            return Delivered::Capped;
        }
        behave.delivered.1 += 1;
        let first = behave.delivered.1 == 1;
        // A top anchor that changed because the offset moved is an offset's change, not a rect's.
        let moved_only = behave.seen.is_some_and(|seen| seen.rects == signature.rects && seen.shape == signature.shape);
        behave.seen = Some(signature);
        let reached = std::mem::take(&mut behave.reached);
        drop(behave);
        let geometry = Geometry { mount: Some(self.id.clone()), moved_only, reached, ..geometry };
        tally(|counts| counts.layouts += 1);
        let reply: LayoutReply = layout(&geometry);
        self.with_index(|index, behave| {
            let theme = self.theme()?;
            for paint in &reply.paints {
                match (index.boxes.get(&paint.node), crate::node::color_of(&theme, &paint.bg)) {
                    (Some((view, declared)), Some(color)) => {
                        view.bg(color);
                        let painted = Painted { bg: paint.bg.clone(), declared: declared.clone(), widget: view.id() };
                        behave.paints.insert(paint.node.clone(), painted);
                    }
                    _ => log::warn!("surface {}: a paint names no box: {}", self.id.surface, paint.node),
                }
            }
            Some(())
        });
        match (reply.again, first) {
            (false, _) => Delivered::Told,
            (true, true) => Delivered::Again,
            // A second view in a frame waits for the next.
            (true, false) => {
                self.app().defer({
                    let mount = self.weak();
                    move |_| {
                        if let Some(mount) = mount.upgrade() {
                            mount.draw_again();
                        }
                    }
                });
                Delivered::Told
            }
        }
    }

    /// Paints again what `layout` painted, after a tree was adopted: on a box built again, and on every box in a new
    /// theme (`restyled`). A box whose own background changed takes it, and the paint goes.
    pub(crate) fn repaint(&self, restyled: bool) {
        if self.behave.borrow().paints.is_empty() {
            return;
        }
        let Some(theme) = self.theme() else { return };
        self.with_index(|index, behave| {
            behave.paints.retain(|node, painted| {
                let Some((view, declared)) = index.boxes.get(node) else { return false };
                if *declared != painted.declared {
                    return false;
                }
                if restyled || view.id() != painted.widget {
                    if let Some(color) = crate::node::color_of(&theme, &painted.bg) {
                        view.bg(color);
                    }
                    painted.widget = view.id();
                }
                true
            });
            Some(())
        });
    }

    /// This frame's geometry of what the surface named, and its signature. What it hashes is in a stable order.
    fn geometry(&self) -> Option<(Geometry, Signature)> {
        let notify = self.notify.clone();
        let transcript = notify.contains(&Notify::Transcript).then(|| transcript(self.app())).flatten();
        let mut tops_of: Vec<(String, String)> = self
            .with_index(|index, _| {
                Some(
                    index
                        .scrolls
                        .iter()
                        .filter_map(|(id, scrolled)| Some((id.clone(), scrolled.notify_top.clone()?)))
                        .collect(),
                )
            })
            .unwrap_or_default();
        tops_of.sort();
        let tops: Vec<Top> = tops_of
            .iter()
            .map(|(scroll, group)| Top {
                scroll: scroll.clone(),
                group: group.clone(),
                anchor: self.top_of(scroll, group, 0),
            })
            .collect();
        let groups: Vec<(String, String, Vec<AnchorAt>)> = notify
            .iter()
            .filter_map(|watch| match watch {
                Notify::Group { scroll, group } => Some((scroll.clone(), group.clone(), self.anchors(scroll, group))),
                _ => None,
            })
            .collect();
        let root = self.root.rect();
        self.with_index(|index, behave| {
            let (mut rects, mut offsets, mut topped) = hashers();
            let mut geometry = Geometry::default();
            for watch in &notify {
                match watch {
                    Notify::Node { id } => {
                        let Some((widget, scroll)) = index.nodes.get(id) else { continue };
                        let rect = widget.rect();
                        let at = v2::Rect {
                            x: (rect.screen_x - root.screen_x).round() as i32,
                            y: (rect.screen_y - root.screen_y).round() as i32,
                            width: rect.width as i32,
                            height: rect.height as i32,
                        };
                        // Its row in its scroll's content, which a sticky node's pin does not change.
                        let content = scroll.as_ref().and_then(|scroll| index.scrolls.get(scroll));
                        let y = content.and_then(|scrolled| scrolled.y(widget, &behave.translated)).unwrap_or(at.y);
                        (id, at.x, y, at.width, at.height).hash(&mut rects);
                        at.y.hash(&mut offsets);
                        geometry.rects.push((id.clone(), at));
                    }
                    Notify::Scroll { id } => {
                        let Some(scrolled) = index.scrolls.get(id) else { continue };
                        let state = scrolled.state();
                        (id, state.viewport, state.extent).hash(&mut rects);
                        state.offset.hash(&mut offsets);
                        geometry.scrolls.push((id.clone(), state));
                    }
                    Notify::Group { .. } | Notify::Transcript => {}
                }
            }
            // A scroll's `notify_top` asks about its top anchor only; its size says whether more than offsets moved.
            let mut shape = std::collections::hash_map::DefaultHasher::new();
            for (scroll, _) in &tops_of {
                let Some(scrolled) = index.scrolls.get(scroll) else { continue };
                let state = scrolled.state();
                (scroll, state.viewport, state.extent).hash(&mut shape);
                if !geometry.scrolls.iter().any(|(id, _)| id == scroll) {
                    geometry.scrolls.push((scroll.clone(), state));
                }
            }
            for (scroll, group, anchors) in &groups {
                (scroll, group, anchors).hash(&mut rects);
                if let Some(scrolled) = index.scrolls.get(scroll) {
                    scrolled.offset().hash(&mut offsets);
                }
            }
            for top in &tops {
                (&top.scroll, &top.group, top.anchor.as_ref().map(|anchor| (&anchor.id, &anchor.variant)))
                    .hash(&mut topped);
            }
            if let Some(view) = &transcript {
                (view.viewport, view.extent, view.revision, view.above, &view.rows).hash(&mut rects);
                view.offset.hash(&mut offsets);
            }
            geometry.groups = groups.clone();
            geometry.tops = tops.clone();
            geometry.transcript = transcript.clone();
            let signature = Signature {
                rects: rects.finish(),
                offsets: offsets.finish(),
                tops: topped.finish(),
                shape: shape.finish(),
            };
            Some((geometry, signature))
        })
    }
}

/// A row of a list, in the `i32` of the contract.
fn clamp_row(row: f64) -> i32 {
    row.round().clamp(0.0, f64::from(i32::MAX)) as i32
}

fn hashers() -> (impl Hasher, impl Hasher, impl Hasher) {
    (
        std::collections::hash_map::DefaultHasher::new(),
        std::collections::hash_map::DefaultHasher::new(),
        std::collections::hash_map::DefaultHasher::new(),
    )
}

/// The offset `scrollIntoView({ block: "nearest" })` gives rows `y..y + height` from offset `top`, below `inset` rows of
/// a `viewport`: no move when the node is inside, or covers the view from above and below; otherwise the edge that is
/// out comes in, but a node taller than the view shows its start (OpenTUI's `scroll_into_view` does the same).
fn nearest(y: i32, height: i32, top: i32, viewport: i32, inset: i32) -> i32 {
    let (y, height, top, viewport, inset) =
        (i64::from(y), i64::from(height), i64::from(top), i64::from(viewport), i64::from(inset));
    let (start, end, view) = (top + inset, top + viewport, viewport - inset);
    let target = match (y < start, y + height > end) {
        (true, true) | (false, false) => top,
        (true, false) if height < view => y - inset,
        (false, true) if height > view => y - inset,
        _ => y + height - viewport,
    };
    target.clamp(0, i64::from(i32::MAX)) as i32
}

fn step_group(verb: &Scroll) -> &str {
    match verb {
        Scroll::Step { group, .. } => group,
        _ => "",
    }
}

/// The translate that pins `node` to `edge` of `scrolled` at offset `top`, inside its parent: CSS sticky. `None`
/// while either has no rows.
fn sticky(
    scrolled: &Scrolled,
    node: &AnyWidget,
    parent: &AnyWidget,
    edge: Edge,
    top: i32,
    translated: &HashMap<u32, f64>,
) -> Option<f64> {
    let (above, natural) = (f64::from(scrolled.y(parent, translated)?), f64::from(scrolled.y(node, translated)?));
    let (height, room) = (node.rect().height as f64, above + parent.rect().height as f64);
    Some(match edge {
        Edge::Top => (f64::from(top) - natural).clamp(0.0, (room - height - natural).max(0.0)),
        Edge::Bottom => {
            let bottom = f64::from(top) + scrolled.widget.rect().height as f64;
            (bottom - (natural + height)).clamp((above - natural).min(0.0), 0.0)
        }
    })
}

// Splits.

/// The width of a split's first child, which the user's drag sets, and its handle.
pub(crate) struct SplitState {
    /// The width the user wants: `split.at`, or where they dragged it. The first child takes it as far as the
    /// split's room allows.
    width: Cell<u16>,
    min: u16,
    dragged: Cell<bool>,
    dragging: Cell<bool>,
    hovered: Cell<bool>,
    /// The bar's color while the pointer is over the handle or drags it.
    highlight: Cell<Color>,
    view: View,
    /// TS's `PaneResizeHandle`: an absolute box two columns wide over the boundary, above the children, which the
    /// press lands on, so it never starts a text selection; and the one-column bar it lights.
    handle: View,
    bar: View,
    first: RefCell<Option<AnyWidget>>,
}

impl SplitState {
    /// The split of `view`, whose first child starts `split.at` wide; a press on its handle, the last column of the
    /// first child and the column after it, starts a drag.
    pub(crate) fn attach(app: &App, view: &View, split: Split, theme: &opencode_ui::theme::Theme) -> Rc<Self> {
        let bar = View::new(app).width(1).height(Length::percent(100.0));
        let handle = View::new(app)
            .absolute()
            .position(opentui::layout::Edge::Top, 0)
            .width(2)
            .height(Length::percent(100.0))
            .z_index(10)
            .child(&bar);
        let state = Rc::new(SplitState {
            width: Cell::new(split.at.max(split.min)),
            min: split.min,
            dragged: Cell::new(false),
            dragging: Cell::new(false),
            hovered: Cell::new(false),
            highlight: Cell::new(theme.background.raised.high),
            view: view.clone(),
            handle,
            bar,
            first: RefCell::default(),
        });
        view.add(&state.handle);
        let weak = Rc::downgrade(&state);
        state.handle.on_hover(move |cx, hovered| {
            if let Some(state) = weak.upgrade() {
                state.hovered.set(hovered);
                state.paint();
                cx.app().request_redraw();
            }
        });
        let weak = Rc::downgrade(&state);
        state.handle.on_mouse(move |cx, event| {
            let Some(state) = weak.upgrade() else { return };
            let rect = state.view.rect();
            let column = i32::from(event.x) - rect.screen_x.round() as i32;
            match event.kind {
                MouseEventKind::Down(opentui::input::MouseButton::Left) => {
                    state.dragging.set(true);
                    state.paint();
                }
                MouseEventKind::Drag(opentui::input::MouseButton::Left) if state.dragging.get() => {
                    let width = state.fit(column, rect.width);
                    if width != state.width.get() {
                        state.width.set(width);
                        state.dragged.set(true);
                        state.size();
                    }
                }
                MouseEventKind::Up(_) if state.dragging.get() => {
                    state.dragging.set(false);
                    state.paint();
                }
                _ => return,
            }
            cx.prevent_default();
            cx.stop_propagation();
            cx.app().request_redraw();
        });
        // The room changes with the terminal and the tree: the first child takes what the split can give.
        let weak = Rc::downgrade(&state);
        view.on_resize(move |_, _| {
            if let Some(state) = weak.upgrade() {
                state.size();
            }
        });
        state
    }

    /// `width` within the room of a split `room` wide: each side keeps its minimum, the first child before the
    /// second, and the handle's column stays inside.
    fn fit(&self, width: i32, room: f32) -> u16 {
        let most = (room as i32 - 1 - i32::from(self.min)).max(i32::from(self.min));
        width.clamp(i32::from(self.min), most).clamp(0, i32::from(u16::MAX)) as u16
    }

    /// Sizes the first child, `widget`, to the split's width, and keeps the handle on the boundary, above the
    /// children the reconcile placed.
    pub(crate) fn first(&self, widget: Option<AnyWidget>) {
        *self.first.borrow_mut() = widget;
        if self.handle.parent().is_none_or(|parent| parent.id() != self.view.id()) {
            self.view.add(&self.handle);
        }
        self.size();
    }

    /// The first child's width now: the one the user wants, within the room the split has once it is laid out.
    fn size(&self) {
        let room = self.view.rect().width;
        let wanted = self.width.get();
        let width = if room > 0.0 { self.fit(i32::from(wanted), room) } else { wanted };
        if let Some(first) = &*self.first.borrow() {
            first.width(u32::from(width)).shrink(0.0);
        }
        self.handle.position(opentui::layout::Edge::Left, width.saturating_sub(1));
    }

    fn paint(&self) {
        let lit = self.hovered.get() || self.dragging.get();
        self.bar.bg(if lit { self.highlight.get() } else { Color::rgba(0, 0, 0, 0) });
    }

    /// Takes `theme`'s highlight.
    pub(crate) fn restyle(&self, theme: &opencode_ui::theme::Theme) {
        self.highlight.set(theme.background.raised.high);
        self.paint();
    }

    /// Keeps the width `other` was dragged to, when it was.
    pub(crate) fn take_from(&self, other: &SplitState) {
        if other.dragged.get() {
            self.width.set(other.width.get().max(self.min));
            self.dragged.set(true);
        }
    }
}
