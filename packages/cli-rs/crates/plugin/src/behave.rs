//! Host behaviors of contract 2.0 (synthesis 3.5, 4.2, 4.4; phase P3): what the host resolves after the solve, with
//! this frame's geometry and no plugin call, and the `layout` call that follows.
//!
//! **The hook.** OpenTUI's `App` calls the host between solve and paint only for a resize, so the hook is a node
//! (spike S0): an absolute box of no height, the app root's last child, whose width [`arm`] flips between 1 and 2.
//! The next solve resizes it, and its resize handler runs the behaviors of every live 2.0 mount. The stepper walks
//! the tree in order and a rect reads the new solve once the walk has passed its node, so the hook is kept last. When
//! a behavior changes something it reads (an offset, a mounted chunk or list item), the hook arms again and the
//! stepper solves another round in the same frame, at most [`ROUNDS`] times. Then geometry is final: sticky
//! translates, then each surface's `layout` call when something it named changed, at most [`DELIVERIES`] a frame.
//!
//! **What arms it** (4.4): a new tree, a verb, the wheel on a scroll of a mount, a resize of a scroll or its content,
//! any key while a mount lives, and the published transcript's moves. Arming forces one solve in that frame.
//!
//! **What a mount holds** (4.2): its pending [`Scroll::To`] and the memory of each scroll's last [`Scroll::Step`],
//! the paints of its last `layout`, and the signature of what that call was told. All of it goes with the mount.

use std::cell::{Cell, RefCell};
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::rc::{Rc, Weak};

use opencode_plugin_abi::v2::{
    self, AnchorAt, Edge, Geometry, LayoutFn, LayoutReply, Node, Notify, Scroll, ScrollEvent, ScrollState, Split,
    Target, Top, TranscriptView,
};
use opentui::input::MouseEventKind;
use opentui::prelude::*;

use crate::reconcile::{Extra, Mounted};
use crate::surface::Surface;

/// Rounds of the behaviors in one frame; OpenTUI's stepper allows 8, and other widgets need some.
pub const ROUNDS: u32 = 4;
/// `layout` deliveries a frame: one, and one more after a view it asked for with `again`.
pub const DELIVERIES: u32 = 2;

/// What a mount's plugin calls, outside its view: `layout`, and its handler of scroll events. Each runs as one call
/// of the plugin.
#[derive(Clone, Default)]
pub(crate) struct Calls {
    pub plugin: String,
    pub layout: Option<LayoutFn>,
    pub scrolled: Option<Scrolls>,
}

/// A surface's handler of its scrolls' events, as one call of the plugin.
pub(crate) type Scrolls = Rc<dyn Fn(&ScrollEvent)>;

/// What the behaviors of one mount hold.
#[derive(Default)]
pub(crate) struct State {
    /// Each scroll's pending `To`: the node, and where it goes.
    pending: HashMap<String, (String, Aim)>,
    /// Each scroll's last step: group, anchor id, and the offset it left.
    steps: HashMap<String, (String, String, i32)>,
    /// The offset each pending `To` reached in this frame, for `layout`.
    reached: Vec<(String, i32)>,
    /// The translate each sticky node has now, by widget.
    translated: HashMap<u32, f64>,
    /// The scroll widgets whose wheel and resize arm the hook.
    hooked: HashSet<u32>,
    /// The signature of what the last `layout` call was told.
    seen: Option<Signature>,
    index: Option<Rc<Index>>,
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

/// Where a pending `To` goes in this round.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Resolve {
    To(i32),
    /// Its node has no layout yet: another round.
    Unsolved,
    /// Its node left the tree.
    Gone,
}

#[derive(Clone, Debug)]
enum Aim {
    /// The node's top this many rows below the viewport's top.
    Row(i32),
    Nearest(i32),
}

/// The behaviors of a mounted tree, found by walking it: its scrolls and lists, and its nodes by id.
#[derive(Default)]
pub(crate) struct Index {
    scrolls: HashMap<String, Scrolled>,
    /// Each mounted node with an id: its widget, and the scroll it is in.
    nodes: HashMap<String, (AnyWidget, Option<String>)>,
    boxes: HashMap<String, View>,
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
    list: bool,
}

impl Scrolled {
    fn state(&self) -> ScrollState {
        ScrollState {
            offset: self.widget.scroll_position().1.round() as i32,
            viewport: self.widget.rect().height as i32,
            extent: self.widget.content_view().rect().height as i32,
        }
    }

    /// Rows from the content's top to `widget`, once it is laid out.
    fn y(&self, widget: &impl Widget) -> Option<i32> {
        let rect = widget.rect();
        (rect.height > 0.0).then(|| (rect.screen_y - self.widget.content_view().rect().screen_y).round() as i32)
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
            let id = mounted.node.id();
            if let (Some(id), Some(widget)) = (id, &mounted.widget) {
                self.nodes.insert(id.to_owned(), (widget.clone(), scroll.map(str::to_owned)));
            }
            match (&mounted.node, &mounted.extra) {
                (Node::Box { sticky, anchor, .. }, Extra::Box { view, .. }) => {
                    if let Some(id) = id {
                        self.boxes.insert(id.to_owned(), view.clone());
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
                    self.scrolls.insert(id.to_owned(), scrolled(widget, notify_top.clone(), *user_scroll, false));
                    self.walk(&mounted.children, Some(id), Some(&widget.content_view().as_any()));
                }
                (Node::List { notify_top, user_scroll, .. }, Extra::List(list)) => {
                    let Some(id) = id else { continue };
                    self.scrolls.insert(id.to_owned(), scrolled(&list.scroll, notify_top.clone(), *user_scroll, true));
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
                (Node::Diff { hunks, .. }, Extra::Chunked(chunked)) => {
                    let Some(scrolled) = scroll.and_then(|scroll| self.scrolls.get_mut(scroll)) else { continue };
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

fn scrolled(widget: &ScrollBox, notify_top: Option<String>, user_scroll: bool, list: bool) -> Scrolled {
    Scrolled {
        widget: widget.clone(),
        anchors: Vec::new(),
        stickies: Vec::new(),
        chunked: Vec::new(),
        notify_top,
        user_scroll,
        list,
    }
}

// The hook.

struct Hook {
    app: App,
    node: View,
    /// The width the last solve gave the node; arming asks for the other one.
    seen: Cell<u32>,
    runs: Cell<u32>,
    deliveries: Cell<u32>,
    frame: Cell<u64>,
    mounts: RefCell<Vec<Weak<Surface>>>,
    key: Cell<Option<opentui::app::HandlerId>>,
}

thread_local! {
    static HOOKS: RefCell<HashMap<u32, Rc<Hook>>> = RefCell::default();
    /// Each plugin's live mount of each surface, for verbs and reads.
    static MOUNTS: RefCell<HashMap<(String, String), Weak<Surface>>> = RefCell::default();
    /// Whether the plugin call that runs is a handler of input.
    static HANDLER: Cell<bool> = const { Cell::new(false) };
    static TRANSCRIPT: RefCell<Option<(u64, Published)>> = const { RefCell::new(None) };
    static COUNTS: Cell<Counts> = Cell::new(Counts::default());
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
}

impl Counts {
    pub fn since(self, before: Counts) -> Counts {
        Counts {
            resolves: self.resolves - before.resolves,
            layouts: self.layouts - before.layouts,
            arms: self.arms - before.arms,
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

/// Makes `surface` one of the mounts the hook of its app resolves, and plugin `plugin`'s live mount of its surface.
pub(crate) fn attach(app: &App, plugin: &str, surface: &Rc<Surface>) {
    let hook = HOOKS.with(|hooks| hooks.borrow_mut().entry(app.root().id()).or_insert_with(|| Hook::new(app)).clone());
    hook.mounts.borrow_mut().retain(|mount| mount.strong_count() > 0);
    hook.mounts.borrow_mut().push(Rc::downgrade(surface));
    MOUNTS.with(|mounts| {
        let mut mounts = mounts.borrow_mut();
        mounts.retain(|_, mount| mount.strong_count() > 0);
        mounts.insert((plugin.to_owned(), surface.id.surface.clone()), Rc::downgrade(surface));
    });
}

/// Drops the hook of `app` once no mount is left, so a client without 2.0 surfaces has none.
pub(crate) fn detach(app: &App) {
    let root = app.root().id();
    let gone = HOOKS.with(|hooks| {
        let mut hooks = hooks.borrow_mut();
        let empty = hooks.get(&root).is_some_and(|hook| {
            hook.mounts.borrow_mut().retain(|mount| mount.strong_count() > 0);
            hook.mounts.borrow().is_empty()
        });
        if empty { hooks.remove(&root) } else { None }
    });
    if let Some(hook) = gone {
        hook.node.detach();
        if let Some(key) = hook.key.take() {
            hook.app.remove_handler(key);
        }
    }
}

/// Runs the behaviors after the next solve of `app`, if a mount lives there: in this frame's next round inside a
/// frame, else in the next frame.
pub(crate) fn arm(app: &App) {
    let hook = HOOKS.with(|hooks| hooks.borrow().get(&app.root().id()).cloned());
    if let Some(hook) = hook {
        hook.arm();
    }
}

impl Hook {
    fn new(app: &App) -> Rc<Self> {
        let node = View::new(app).absolute().width(1).height(0).shrink(0.0);
        let hook = Rc::new(Hook {
            app: app.clone(),
            node,
            seen: Cell::new(1),
            runs: Cell::new(0),
            deliveries: Cell::new(0),
            frame: Cell::new(u64::MAX),
            mounts: RefCell::default(),
            key: Cell::new(None),
        });
        let weak = Rc::downgrade(&hook);
        hook.node.on_resize(move |_, rect| {
            if let Some(hook) = weak.upgrade() {
                hook.seen.set(rect.width as u32);
                hook.run();
            }
        });
        // Any key may scroll: a key the host routes to a focused scroll, or a handler's verb.
        let weak = Rc::downgrade(&hook);
        hook.key.set(Some(app.on_key_capture(move |_, _| {
            if let Some(hook) = weak.upgrade() {
                hook.arm();
            }
        })));
        hook
    }

    fn arm(&self) {
        tally(|counts| counts.arms += 1);
        let root = self.app.root();
        if root.children().last().is_none_or(|last| last.id() != self.node.id()) {
            self.node.detach();
            root.add(&self.node);
        }
        self.node.width(if self.seen.get() == 2 { 1 } else { 2 });
        self.app.request_redraw();
    }

    /// One round: every mount's behaviors; another round while one changed what it reads, then the `layout` calls.
    fn run(&self) {
        let frame = self.app.frame_number();
        if self.frame.replace(frame) != frame {
            self.runs.set(0);
            self.deliveries.set(0);
        }
        let mounts: Vec<Rc<Surface>> = self.mounts.borrow().iter().filter_map(Weak::upgrade).collect();
        let mut changed = false;
        for mount in &mounts {
            changed |= mount.resolve();
        }
        tally(|counts| counts.resolves += 1);
        if changed && self.runs.get() + 1 < ROUNDS {
            self.runs.set(self.runs.get() + 1);
            self.arm();
            return;
        }
        // Geometry is final.
        self.runs.set(0);
        if self.deliveries.get() >= DELIVERIES {
            return;
        }
        let again: Vec<&Rc<Surface>> = mounts.iter().filter(|mount| mount.deliver()).collect();
        if !again.is_empty() {
            self.deliveries.set(self.deliveries.get() + 1);
            for mount in again {
                mount.draw_again();
            }
        }
    }
}

// Handlers and the transcript.

/// Runs `f` as a call of kind `export`; a verb on the transcript is taken only from a handler of input.
pub(crate) fn calling<R>(export: &str, f: impl FnOnce() -> R) -> R {
    let outer = HANDLER.with(|handler| handler.replace(matches!(export, "run-command" | "on-scroll")));
    let out = f();
    HANDLER.with(|handler| handler.set(outer));
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
pub fn publish_transcript(published: Published) -> Publication {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    let id = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    TRANSCRIPT.with(|transcript| *transcript.borrow_mut() = Some((id, published)));
    Publication(id)
}

/// The transcript stays published while it lives, or until a newer one is.
pub struct Publication(u64);

impl Drop for Publication {
    fn drop(&mut self) {
        TRANSCRIPT.with(|transcript| {
            let mut transcript = transcript.borrow_mut();
            if transcript.as_ref().is_some_and(|(id, _)| *id == self.0) {
                *transcript = None;
            }
        });
    }
}

/// The transcript moved or changed size: a surface told about it hears of it in this frame.
pub fn transcript_moved(app: &App) {
    arm(app);
}

/// What the published transcript is now.
pub(crate) fn transcript() -> Option<TranscriptView> {
    let read =
        TRANSCRIPT.with(|transcript| transcript.borrow().as_ref().map(|(_, published)| published.read.clone()))?;
    Some(read())
}

// Verbs and reads, by plugin.

fn mount(plugin: &str, surface: &str) -> Option<Rc<Surface>> {
    MOUNTS.with(|mounts| mounts.borrow().get(&(plugin.to_owned(), surface.to_owned()))?.upgrade())
}

/// Applies plugin `plugin`'s verb to `target`, as the effect of its call.
pub(crate) fn scroll(plugin: &str, target: &Target, verb: &Scroll) {
    match target {
        Target::Transcript => {
            let scroll = TRANSCRIPT.with(|transcript| transcript.borrow().as_ref().map(|(_, it)| it.scroll.clone()));
            match (scroll, verb) {
                (Some(scroll), Scroll::By { .. } | Scroll::Offset { .. } | Scroll::Edge { .. }) => scroll(verb),
                (Some(_), _) => log::warn!("plugin {plugin}: the transcript takes By, Offset and Edge only"),
                (None, _) => {}
            }
        }
        Target::Node { surface, id } => {
            let Some(mounted) = mount(plugin, surface) else { return };
            let landed = mounted.verb(id, verb);
            if let (Some(anchor), Some(scrolled)) = (landed, mounted.calls.scrolled.clone()) {
                scrolled(&ScrollEvent::Landed { scroll: id.clone(), anchor });
            }
        }
    }
}

pub(crate) fn scroll_state(plugin: &str, target: &Target) -> Option<ScrollState> {
    match target {
        Target::Transcript => {
            transcript().map(|view| ScrollState { offset: view.offset, viewport: view.viewport, extent: view.extent })
        }
        Target::Node { surface, id } => {
            mount(plugin, surface)?.with_index(|index, _| Some(index.scrolls.get(id)?.state()))
        }
    }
}

pub(crate) fn anchors(plugin: &str, target: &Target, group: &str) -> Vec<AnchorAt> {
    let Target::Node { surface, id } = target else { return Vec::new() };
    mount(plugin, surface).map(|mounted| mounted.anchors(id, group)).unwrap_or_default()
}

pub(crate) fn top_anchor(plugin: &str, target: &Target, group: &str, inset: u16) -> Option<AnchorAt> {
    let state = scroll_state(plugin, target)?;
    let line = state.offset + i32::from(inset);
    anchors(plugin, target, group).into_iter().rfind(|anchor| anchor.row <= line)
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

    /// The tree or a window changed: the index is built again when next read.
    pub(crate) fn reindex(&self) {
        self.behave.borrow_mut().index = None;
    }

    /// Makes the wheel and a resize of each scroll arm the hook, once a widget.
    fn hook_scrolls(&self, index: &Index) {
        for (id, scrolled) in &index.scrolls {
            if !self.behave.borrow_mut().hooked.insert(scrolled.widget.id()) {
                continue;
            }
            let (weak, app, scroll, user) = (self.weak(), self.app().clone(), id.clone(), scrolled.user_scroll);
            scrolled.widget.on_mouse(move |_, event| {
                if !matches!(event.kind, MouseEventKind::ScrollUp | MouseEventKind::ScrollDown) {
                    return;
                }
                arm(&app);
                let Some(mounted) = weak.upgrade() else { return };
                // The user's move ends what a verb left pending.
                let mut behave = mounted.behave.borrow_mut();
                behave.pending.remove(&scroll);
                behave.steps.remove(&scroll);
                drop(behave);
                if let (true, Some(scrolled)) = (user, mounted.calls.scrolled.clone()) {
                    scrolled(&ScrollEvent::UserScroll { scroll: scroll.clone() });
                }
            });
            for resized in [scrolled.widget.as_any(), scrolled.widget.content_view().as_any()] {
                let app = self.app().clone();
                resized.on_resize(move |_, _| arm(&app));
            }
        }
    }

    /// Applies `verb` to scroll `id` now; where a step landed.
    fn verb(&self, id: &str, verb: &Scroll) -> Option<AnchorAt> {
        let anchors = matches!(verb, Scroll::Step { .. }).then(|| self.anchors(id, step_group(verb)));
        let landed = self.with_index(|index, behave| {
            let scrolled = index.scrolls.get(id)?;
            behave.pending.remove(id);
            let step = behave.steps.remove(id);
            let state = scrolled.state();
            match verb {
                Scroll::To { node, align } => {
                    let aim = match align {
                        v2::ScrollAlign::Start => Aim::Row(0),
                        v2::ScrollAlign::Nearest { inset } => Aim::Nearest(i32::from(*inset)),
                        v2::ScrollAlign::Keep => {
                            let (widget, _) = index.nodes.get(node)?;
                            let at = (widget.rect().screen_y - scrolled.widget.rect().screen_y).round() as i32;
                            Aim::Row(at)
                        }
                    };
                    behave.pending.insert(id.to_owned(), (node.clone(), aim));
                    None
                }
                Scroll::Offset { offset } => {
                    scrolled.widget.scroll_to(0.0, f64::from(*offset));
                    None
                }
                Scroll::By { rows } => {
                    scrolled.widget.scroll_by(0.0, f64::from(*rows));
                    None
                }
                Scroll::Page { percent } => {
                    let rows = (state.viewport * i32::from(*percent) / 100).max(1).max(-state.viewport);
                    let rows = if *percent < 0 { -rows.abs().max(1) } else { rows };
                    scrolled.widget.scroll_by(0.0, f64::from(rows));
                    None
                }
                Scroll::Edge { edge: Edge::Top } => {
                    scrolled.widget.scroll_to(0.0, 0.0);
                    None
                }
                Scroll::Edge { edge: Edge::Bottom } => {
                    scrolled.widget.scroll_to_bottom();
                    None
                }
                Scroll::Forget => None,
                Scroll::Step { group, by, inset } => {
                    let anchors = anchors.unwrap_or_default();
                    let (top, inset) = (state.offset, i32::from(*inset));
                    let from = step
                        .filter(|(stepped, _, left)| stepped == group && *left == top)
                        .and_then(|(_, anchor, _)| anchors.iter().position(|at| at.id == anchor));
                    let next = match from {
                        Some(at) => usize::try_from(at as i64 + i64::from(*by)).ok().and_then(|at| anchors.get(at)),
                        None if *by > 0 => anchors.iter().find(|at| at.row > top + inset),
                        None => anchors.iter().rev().find(|at| at.row < top + inset),
                    }?;
                    let target = (next.row - inset).clamp(0, (state.extent - state.viewport).max(0));
                    scrolled.widget.scroll_to(0.0, f64::from(target));
                    behave.steps.insert(id.to_owned(), (group.clone(), next.id.clone(), target));
                    Some(next.clone())
                }
            }
        });
        arm(self.app());
        landed
    }

    /// The anchors of `group` in scroll `id`, in content order: those with widgets at their rows, and for a list,
    /// the anchor of each item without widgets at the row the host assumes for it.
    pub(crate) fn anchors(&self, id: &str, group: &str) -> Vec<AnchorAt> {
        let mut found = self
            .with_index(|index, _| {
                let scrolled = index.scrolls.get(id)?;
                let anchors: Vec<AnchorAt> = scrolled
                    .anchors
                    .iter()
                    .filter(|(of, _, _)| of == group)
                    .filter_map(|(_, anchor, widget)| Some(AnchorAt { row: scrolled.y(widget)?, ..anchor.clone() }))
                    .collect();
                Some(anchors)
            })
            .unwrap_or_default();
        self.each_list(id, |list| {
            for (index, item) in list.items.iter().enumerate() {
                if item.mounted.is_some() {
                    continue;
                }
                if let Node::Box { id: Some(key), anchor: Some(anchor), .. } = &item.node
                    && anchor.group == group
                {
                    found.push(AnchorAt {
                        id: key.clone(),
                        owner: key.clone(),
                        index: 0,
                        variant: anchor.variant.clone(),
                        row: list.row_of(index).round() as i32,
                    });
                }
            }
        });
        found.sort_by_key(|anchor| anchor.row);
        found
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

    /// The behaviors after a solve: list windows, pending `To`s, chunks near the view, then sticky nodes. Whether it
    /// changed something it reads, so the solve runs again.
    pub(crate) fn resolve(&self) -> bool {
        let mut changed = self.windows();
        if changed {
            self.reindex();
        }
        changed |= self
            .with_index(|index, behave| {
                let mut changed = false;
                behave.reached.retain(|_| false);
                for (id, scrolled) in &index.scrolls {
                    let before = scrolled.widget.scroll_position().1.round() as i32;
                    let viewport = scrolled.widget.rect();
                    let aim = behave.pending.get(id).cloned().map(|(node, aim)| {
                        let found = index.nodes.get(&node).filter(|(_, scroll)| scroll.as_deref() == Some(id));
                        let Some((widget, _)) = found else {
                            // A node of a list item without widgets: to the item's row, which mounts it. A node
                            // that has left the tree drops the verb.
                            return self.item_row(id, &node).map_or(Resolve::Gone, Resolve::To);
                        };
                        let Some(y) = scrolled.y(widget) else { return Resolve::Unsolved };
                        let height = widget.rect().height as i32;
                        Resolve::To(match aim {
                            Aim::Row(row) => y - row,
                            Aim::Nearest(inset) if y - inset < before => y - inset,
                            Aim::Nearest(_) if y + height > before + viewport.height as i32 => {
                                y + height - viewport.height as i32
                            }
                            Aim::Nearest(_) => before,
                        })
                    });
                    match aim {
                        Some(Resolve::To(target)) => drop(scrolled.widget.scroll_to(0.0, f64::from(target))),
                        Some(Resolve::Gone) => drop(behave.pending.remove(id)),
                        Some(Resolve::Unsolved) | None => {}
                    }
                    let top = scrolled.widget.scroll_position().1.round() as i32;
                    // A step's memory holds while the offset has not moved: once a solve shows another, it is gone,
                    // also if the offset comes back later.
                    if behave.steps.get(id).is_some_and(|(_, _, left)| *left != top) {
                        behave.steps.remove(id);
                    }
                    if matches!(aim, Some(Resolve::To(_))) && top == before {
                        behave.pending.remove(id);
                        behave.reached.push((id.clone(), top));
                    }
                    // A tree adopted earlier in this round has not been solved yet. A node a verb waits for that has
                    // no rows after a solve is empty or hidden: the verb waits for the next frame that arms the hook.
                    changed |= top != before || (viewport.width == 0.0 && !scrolled.list);
                    let content = scrolled.widget.content_view().rect();
                    for chunked in &scrolled.chunked {
                        let y = (chunked.root().rect().screen_y - content.screen_y).round() as i64;
                        changed |= chunked.show(i64::from(top) - y, viewport.height as i64);
                    }
                    for (node, parent, edge) in &scrolled.stickies {
                        let shift = sticky(scrolled, node, parent, *edge, top, behave.translated.get(&node.id()));
                        if behave.translated.get(&node.id()) != Some(&shift) {
                            node.translate(0.0, shift);
                            behave.translated.insert(node.id(), shift);
                        }
                    }
                }
                Some(changed)
            })
            .unwrap_or(false);
        changed
    }

    /// The row of the list item whose data holds `node`, in list `list`.
    fn item_row(&self, list: &str, node: &str) -> Option<i32> {
        let mut row = None;
        self.each_list(list, |found| {
            row = found.owner(node).map(|item| found.row_of(item).round() as i32);
        });
        row
    }

    /// Calls `layout` when something it was told about changed; whether it asked for a view again.
    pub(crate) fn deliver(&self) -> bool {
        let Some(layout) = self.calls.layout.clone() else { return false };
        let Some((geometry, signature)) = self.geometry() else { return false };
        let mut behave = self.behave.borrow_mut();
        if behave.seen.is_some_and(|seen| seen.calls(&signature)) {
            return false;
        }
        // A top anchor that changed because the offset moved is an offset's change, not a rect's.
        let moved_only = behave.seen.is_some_and(|seen| seen.rects == signature.rects && seen.shape == signature.shape);
        behave.seen = Some(signature);
        let reached = std::mem::take(&mut behave.reached);
        drop(behave);
        let geometry = Geometry { moved_only, reached, ..geometry };
        tally(|counts| counts.layouts += 1);
        let reply: LayoutReply = layout(&geometry);
        self.with_index(|index, _| {
            let theme = self.theme()?;
            for paint in &reply.paints {
                match (index.boxes.get(&paint.node), crate::node::color_of(&theme, &paint.bg)) {
                    (Some(view), Some(color)) => drop(view.bg(color)),
                    _ => log::warn!("surface {}: a paint names no box: {}", self.id.surface, paint.node),
                }
            }
            Some(())
        });
        reply.again
    }

    /// This frame's geometry of what the surface named, and its signature.
    fn geometry(&self) -> Option<(Geometry, Signature)> {
        let notify = self.notify.clone();
        let transcript = notify.contains(&Notify::Transcript).then(transcript).flatten();
        let mut tops = Vec::new();
        let tops_of: Vec<(String, String)> = self
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
        for (scroll, group) in &tops_of {
            let anchor = self.top_of(scroll, group);
            tops.push(Top { scroll: scroll.clone(), group: group.clone(), anchor });
        }
        let groups: Vec<(String, String, Vec<AnchorAt>)> = notify
            .iter()
            .filter_map(|watch| match watch {
                Notify::Group { scroll, group } => Some((scroll.clone(), group.clone(), self.anchors(scroll, group))),
                _ => None,
            })
            .collect();
        let root = self.root.rect();
        self.with_index(|index, _| {
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
                        let content = scroll.as_ref().and_then(|scroll| index.scrolls.get(scroll));
                        let y = content.and_then(|scrolled| scrolled.y(widget)).unwrap_or(at.y);
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
                (scroll, group, anchors.iter().map(|anchor| (&anchor.id, anchor.row)).collect::<Vec<_>>())
                    .hash(&mut rects);
                if let Some(scrolled) = index.scrolls.get(scroll) {
                    scrolled.state().offset.hash(&mut offsets);
                }
            }
            for top in &tops {
                (&top.scroll, &top.group, top.anchor.as_ref().map(|anchor| (&anchor.id, &anchor.variant)))
                    .hash(&mut topped);
            }
            if let Some(view) = &transcript {
                (view.viewport, view.extent, view.revision, &view.rows).hash(&mut rects);
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

    /// The top anchor of `group` in `scroll`: the last at or above its viewport's top.
    fn top_of(&self, scroll: &str, group: &str) -> Option<AnchorAt> {
        let offset = self.with_index(|index, _| Some(index.scrolls.get(scroll)?.state().offset))?;
        self.anchors(scroll, group).into_iter().rfind(|anchor| anchor.row <= offset)
    }
}

fn hashers() -> (impl Hasher, impl Hasher, impl Hasher) {
    (
        std::collections::hash_map::DefaultHasher::new(),
        std::collections::hash_map::DefaultHasher::new(),
        std::collections::hash_map::DefaultHasher::new(),
    )
}

fn step_group(verb: &Scroll) -> &str {
    match verb {
        Scroll::Step { group, .. } => group,
        _ => "",
    }
}

/// The translate that pins `node` to `edge` of `scrolled` at offset `top`, inside its parent: CSS sticky.
fn sticky(scrolled: &Scrolled, node: &AnyWidget, parent: &AnyWidget, edge: Edge, top: i32, now: Option<&f64>) -> f64 {
    let (Some(above), Some(at)) = (scrolled.y(parent), scrolled.y(node)) else { return now.copied().unwrap_or(0.0) };
    // Where the node is without its translate.
    let natural = f64::from(at) - now.copied().unwrap_or(0.0);
    let (height, room) = (node.rect().height as f64, f64::from(above) + parent.rect().height as f64);
    match edge {
        Edge::Top => (f64::from(top) - natural).clamp(0.0, (room - height - natural).max(0.0)),
        Edge::Bottom => {
            let bottom = f64::from(top) + scrolled.widget.rect().height as f64;
            (bottom - (natural + height)).clamp((f64::from(above) - natural).min(0.0), 0.0)
        }
    }
}

// Splits.

/// The width of a split's first child, which the user's drag sets, and the drag.
pub(crate) struct SplitState {
    width: Cell<u16>,
    min: u16,
    dragged: Cell<bool>,
    dragging: Cell<bool>,
    view: View,
    first: RefCell<Option<AnyWidget>>,
}

impl SplitState {
    /// The split of `view`, whose first child starts `split.at` wide; a press on the column after it starts a drag.
    pub(crate) fn attach(view: &View, split: Split) -> Rc<Self> {
        let state = Rc::new(SplitState {
            width: Cell::new(split.at.max(split.min)),
            min: split.min,
            dragged: Cell::new(false),
            dragging: Cell::new(false),
            view: view.clone(),
            first: RefCell::default(),
        });
        let weak = Rc::downgrade(&state);
        view.on_mouse(move |cx, event| {
            let Some(state) = weak.upgrade() else { return };
            let rect = state.view.rect();
            let column = i32::from(event.x) - rect.screen_x.round() as i32;
            match event.kind {
                MouseEventKind::Down(opentui::input::MouseButton::Left) if column == i32::from(state.width.get()) => {
                    state.dragging.set(true);
                    cx.prevent_default();
                    cx.stop_propagation();
                }
                MouseEventKind::Drag(opentui::input::MouseButton::Left) if state.dragging.get() => {
                    let most = (rect.width as i32 - 1 - i32::from(state.min)).max(i32::from(state.min));
                    let width = column.clamp(i32::from(state.min), most) as u16;
                    if width != state.width.get() {
                        state.width.set(width);
                        state.dragged.set(true);
                        state.size();
                        cx.app().request_redraw();
                    }
                    cx.stop_propagation();
                }
                MouseEventKind::Up(_) if state.dragging.get() => {
                    state.dragging.set(false);
                    cx.stop_propagation();
                }
                _ => {}
            }
        });
        state
    }

    /// Sizes the first child, `widget`, to the split's width.
    pub(crate) fn first(&self, widget: Option<AnyWidget>) {
        *self.first.borrow_mut() = widget;
        self.size();
    }

    fn size(&self) {
        if let Some(first) = &*self.first.borrow() {
            first.width(u32::from(self.width.get())).shrink(0.0);
        }
    }

    /// Keeps the width `other` was dragged to, when it was.
    pub(crate) fn take_from(&self, other: &SplitState) {
        if other.dragged.get() {
            self.width.set(other.width.get());
            self.dragged.set(true);
        }
    }
}
