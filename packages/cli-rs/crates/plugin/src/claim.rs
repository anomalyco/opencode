//! The host's side of renderer claims ([`abi::claim`], synthesis 4.11, phase Pr): each part a claim draws is a
//! [`Mount`] of its own, with a generation, a reconciled tree ([`Tree`]), and the content and memo values its views
//! gave. The owner of the part asks [`Mount::show`] with each revision of the part, and draws its own row whenever
//! that says no: a tool row draws the host's view of the call, and a fence the claim took keeps its block and shows
//! the host's code view in it.
//!
//! The claim shows a part only while its view accepts it. The host's own row comes back:
//!
//! - for a revision the view declines (returns `None`);
//! - once a view of it took longer than the overrun limit, or returned a tree the host refused (a keep the host does
//!   not hold is asked for once more as a whole tree, any other refusal is the plugin's error): for the rest of the
//!   part's mount, which a remount ends, and for a fence a new theme too, as Markdown builds the block again;
//! - for every part of the plugin, once a view panicked: the plugin fails, and the host mounts the route again
//!   without its claims, as it does when the user disables or reloads it.
//!
//! A revision that changes the part's phase ([`abi::claim::Phase`]) is viewed at once, as is a part's first. One that
//! only streams new content is viewed as the next paint starts, with the newest content then, and the row that shows
//! stays until then; a wake of the plugin or a handler of it that ran before that paint joins that one view, which
//! sees the plugin's state as it is then (final re-review big-boi 12). So a part gets at most one view a frame while it
//! streams, besides its first, a phase change and the whole tree asked for after a refusal, and what changed before a
//! paint shows in that paint. A view at the paint that changes which row shows the part tells the owner
//! ([`Mount::on_switch`]), which swaps its rows in that paint.
//!
//! A theme change restyles a tool call's tree in place with no call, unless the claim reads the palette: then it is
//! viewed again, also where it declined the revision. Markdown builds a claimed fence again in the new theme, once for
//! each style it sets: the claim takes the last build only, so a fence is a new mount and gets one view.
//!
//! What a part holds is its plugin's, as a surface's mount (review bigboi 1, carbon-3): its nodes, its content and its
//! decoded images are charged to the plugin and to the total ([`crate::limits`]), content past the plugin's share is
//! not kept, an image decodes on a worker within its reservation and goes with its content's release, and the host's
//! work for the part is the plugin's host time. Over a limit a node is a placeholder, as in a surface; only a fault of
//! the view itself falls the part back.

use std::cell::{Cell, RefCell};
use std::collections::{HashMap, HashSet};
use std::rc::{Rc, Weak};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

pub use opencode_plugin_abi::claim::{FencePart, Part, State, ToolPart};
use opencode_plugin_abi::v2::{self, ContentRef, Node, Source};
use opencode_plugin_abi::{self as abi};
use opencode_ui::theme::Theme;
use opentui::prelude::*;

use crate::Host;
use crate::activation::{Activation, Drawn};
use crate::limits;
use crate::node::{Act, abi_mode};
use crate::reconcile::{Env, Tree};
use crate::surface::{self, HostTime, ImageKey, Pictures, Shows, Viewing};

/// Runs a claim's view in process as one call of its plugin.
pub(crate) type Call = Rc<dyn Fn(&dyn Host, &v2::MountId, &mut dyn FnMut(&dyn abi::Read)) -> Called>;

/// How a call of a claim's view in process ended.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Called {
    Returned,
    /// It returned after the overrun limit.
    Overran,
    /// It panicked, or its plugin is no longer called.
    Failed,
}

/// Runs a claim's view for one part, on either carrier.
pub(crate) trait Viewer {
    /// One call of the view on `part`.
    fn view(&self, host: &dyn Host, viewing: Viewing<'_>, part: &Part) -> Viewed;
    /// The part's mount ended.
    fn forget(&self, _host: &dyn Host, _mount: &v2::MountId) {}
}

/// How one call of a claim's view ended.
pub(crate) enum Viewed {
    /// Its tree, or `None` where it declines, and the values the memo table of a library holds after it (`None` for a
    /// table in the host).
    Returned(Option<Box<Node>>, Option<usize>),
    /// It returned after the overrun limit: the part falls back. (A library that overruns fails, in its guest.)
    Overran,
    /// It panicked, its result was refused, or its plugin is no longer called.
    Failed,
}

/// A claim's view in process: the plugin's own function, as one call of it, on the mount's memo table in the host.
pub(crate) struct Linked {
    view: abi::claim::ClaimFn,
    call: Call,
}

impl Linked {
    pub(crate) fn new(view: abi::claim::ClaimFn, call: Call) -> Self {
        Self { view, call }
    }
}

impl Viewer for Linked {
    fn view(&self, host: &dyn Host, viewing: Viewing<'_>, part: &Part) -> Viewed {
        let Viewing { mount, input, memo, give, release, .. } = viewing;
        let mut node = None;
        let called = (self.call)(host, mount, &mut |read| {
            let mut content = |bytes: Vec<u8>| {
                let handle = surface::new_content();
                give(handle, bytes);
                handle
            };
            node = Some((self.view)(&mut v2::View::new(read, input, mount, memo, &mut content, release), part));
        });
        match (called, node) {
            (Called::Returned, Some(node)) => Viewed::Returned(node.map(Box::new), None),
            (Called::Overran, _) => Viewed::Overran,
            _ => Viewed::Failed,
        }
    }
}

/// What the parts claims draw hold now, and the views they ran, counted per thread outside any mount.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Ledger {
    pub mounts: i64,
    pub content: i64,
    pub content_bytes: i64,
    pub memo_entries: i64,
    /// Views called, ever.
    pub views: u64,
}

thread_local! {
    static LEDGER: Cell<Ledger> = Cell::new(Ledger::default());
    /// A claimed part's tree is being adopted: its Markdown builds now, and draws its fences as code.
    static ADOPTING: Cell<u32> = const { Cell::new(0) };
    /// The width of the Markdown that builds now, which a new fence takes until it is laid out.
    static FENCE_WIDTH: Cell<Option<u16>> = const { Cell::new(None) };
    static LIVE: RefCell<Vec<Weak<Core>>> = const { RefCell::new(Vec::new()) };
}

/// What the claimed parts hold on this thread now.
pub fn ledger() -> Ledger {
    LEDGER.with(Cell::get)
}

fn book(f: impl FnOnce(&mut Ledger)) {
    LEDGER.with(|cell| {
        let mut ledger = cell.get();
        f(&mut ledger);
        cell.set(ledger);
    });
}

/// A claimed part as the host holds it now: its mount, where its tree was laid out in the last frame, and whether
/// its tree shows.
#[derive(Clone, Debug, PartialEq)]
pub struct Shown {
    pub id: v2::MountId,
    pub rect: Rect,
    pub shows: bool,
}

/// Runs `build`, which builds Markdown `width` cells wide: a fence claimed there gets that width before its layout,
/// rather than the terminal's, so its first view is at its own width. A width of 0 is not known.
pub fn with_fence_width<T>(width: u16, build: impl FnOnce() -> T) -> T {
    let outer = FENCE_WIDTH.replace((width > 0).then_some(width));
    let built = build();
    FENCE_WIDTH.set(outer);
    built
}

/// Every claimed part mounted on this thread, oldest first.
pub fn mounted() -> Vec<Shown> {
    LIVE.with_borrow(|live| {
        live.iter()
            .filter_map(Weak::upgrade)
            .map(|core| Shown { id: core.id.clone(), rect: core.root.rect(), shows: core.shows.get() })
            .collect()
    })
}

/// The entries of the registry [`mounted`] reads: one a live part.
#[doc(hidden)]
pub fn registered() -> usize {
    LIVE.with_borrow(Vec::len)
}

/// One claim of an active plugin, which its parts share.
pub(crate) struct Registered {
    entry: abi::claim::Entry,
    owner: Weak<dyn Host>,
    /// The plugin's ID, which what its parts hold is charged to.
    plugin: Rc<str>,
    /// Times the host's own work for its parts' nodes, as the plugin's host time.
    host_time: HostTime,
    /// What a claim's view holds of the input (P2): its plugin's activation's, as a claim has no handler of its own.
    input: Rc<crate::interact::Owner>,
    viewer: Rc<dyn Viewer>,
    /// Draws the plugin's parts again when it is woken or a handler of it ran.
    activation: Rc<Activation>,
    /// The palette of the theme the last view saw.
    palette: RefCell<Option<(Theme, v2::Palette)>>,
}

impl Registered {
    pub(crate) fn new(
        entry: abi::claim::Entry,
        owner: Weak<dyn Host>,
        (plugin, host_time): (Rc<str>, HostTime),
        viewer: Rc<dyn Viewer>,
        input: Rc<crate::interact::Owner>,
        activation: Rc<Activation>,
    ) -> Rc<Self> {
        Rc::new(Self { entry, owner, plugin, host_time, viewer, input, activation, palette: RefCell::default() })
    }

    fn palette(&self, host: &dyn Host, theme: &Theme) -> v2::Palette {
        let mut cached = self.palette.borrow_mut();
        if let Some((seen, palette)) = &*cached
            && seen == theme
        {
            return palette.clone();
        }
        let colors = theme
            .list()
            .into_iter()
            .map(|(token, color)| (token, abi::Rgba::new(color.r, color.g, color.b, color.a)))
            .collect();
        let palette = v2::Palette { mode: abi_mode(host.theme_mode()).into(), colors };
        *cached = Some((theme.clone(), palette.clone()));
        palette
    }

    fn name(&self) -> &str {
        match &self.entry.target {
            abi::claim::Target::Tool(name) | abi::claim::Target::Fence(name) => name,
        }
    }
}

/// The tool claims of the active plugins, as the transcript took them when it mounted.
#[derive(Clone, Default)]
pub struct ToolClaims(Vec<(String, Rc<Registered>)>);

impl ToolClaims {
    pub(crate) fn new(claims: Vec<(String, Rc<Registered>)>) -> Self {
        Self(claims)
    }

    /// The claim of the calls of tool `name`, by the name as the transcript has it or as the host names the tool. At
    /// one tool the plugin last in activation order wins.
    pub fn find(&self, name: &str) -> Option<ToolClaim> {
        let canonical = opencode_ui::tool_info::canonical_tool_name(name);
        let (_, claim) = self.0.iter().rev().find(|(claimed, _)| {
            claimed == name || opencode_ui::tool_info::canonical_tool_name(claimed) == canonical
        })?;
        Some(ToolClaim(claim.clone()))
    }
}

/// A claim of one tool's calls.
pub struct ToolClaim(Rc<Registered>);

impl ToolClaim {
    /// A mount for the call `key`, whose views get `width` until it is laid out. Nothing is viewed until
    /// [`Mount::show`].
    pub fn mount(&self, app: &App, key: &str, width: u16) -> Mount {
        Mount(Core::new(self.0.clone(), app, key, width))
    }
}

/// One claimed part.
pub struct Mount(Rc<Core>);

impl Mount {
    /// What the part draws in, while its tree shows.
    pub fn root(&self) -> &View {
        &self.0.root
    }

    /// Shows `part`: whether the claim draws it, else the host's own row must.
    pub fn show(&self, part: Part) -> bool {
        self.0.show(part)
    }

    /// Runs `switched` when a view at a paint changed whether the claim draws the part: the owner then asks
    /// [`Self::show`] again, with the part as it has it, and swaps its rows.
    pub fn on_switch(&self, switched: impl Fn() + 'static) {
        *self.0.switch.borrow_mut() = Some(Rc::new(switched));
    }

    /// The width the part's row has while the claim's tree does not show, which its views get then.
    pub fn width(&self, width: u16) {
        self.0.hint.set(width);
    }

    /// Takes the page theme in place: the last tree again in it, with no call, unless the claim reads the palette. The
    /// owner asks [`Self::show`] next: which row shows may have changed.
    pub fn restyle(&self) {
        self.0.restyle();
    }
}

struct Core {
    claim: Rc<Registered>,
    id: v2::MountId,
    root: View,
    this: Weak<Core>,
    state: RefCell<Held>,
    /// The images its content and inline sources decode to, a source each, as a surface holds them.
    images: Pictures,
    part: RefCell<Option<Part>>,
    /// The frame of the last view ([`App::frame_number`]).
    viewed: Cell<Option<u64>>,
    /// A view of the newest content waits for the next paint.
    waiting: Cell<bool>,
    /// The width the views get while the tree does not show, and the width the last one got.
    hint: Cell<u16>,
    width: Cell<u16>,
    /// The owner's word that a view at a paint changed which row shows the part.
    switch: RefCell<Option<Rc<dyn Fn()>>>,
    /// The part shows the host's row for the rest of its life.
    fallen: Cell<bool>,
    /// The last revision the host decided shows the claim's tree.
    shows: Cell<bool>,
    /// A fence's code view, which a [`Node::Fence`] of its tree shows; `None` for a tool call, whose tree may hold none.
    fence: RefCell<Option<Rc<FenceCode>>>,
}

#[derive(Default)]
struct Held {
    tree: Tree,
    memo: v2::Memo,
    /// The content the accepted views gave and did not release, each charged to the plugin.
    content: HashMap<ContentRef, Arc<[u8]>>,
    /// The content the accepted views gave past what the plugin may hold, and did not release: the host keeps none
    /// of it, and a node that shows it is a placeholder.
    dropped: HashSet<ContentRef>,
    /// What the content costs, read once a handle.
    measures: crate::reconcile::Measures,
    /// The last accepted tree, keeps as they came.
    last: Option<Vec<Node>>,
    /// The values a library's memo table holds for the mount, as its last accepted view said.
    remote: usize,
}

impl Held {
    /// The memo values the mount holds, in the host or in its library.
    fn memo_entries(&self) -> i64 {
        (self.memo.len() + self.remote) as i64
    }
}

/// What one call of the view returned and asked for; the host takes it only with its tree.
struct Attempt {
    viewed: Viewed,
    given: HashMap<ContentRef, Arc<[u8]>>,
    memo: v2::Memo,
    /// The memo values the mount held before the call.
    held: i64,
}

impl Core {
    fn new(claim: Rc<Registered>, app: &App, key: &str, hint: u16) -> Rc<Self> {
        let root = View::new(app).column().shrink(0.0);
        let id =
            v2::MountId { surface: claim.name().to_owned(), key: key.to_owned(), generation: surface::generation() };
        let images = Pictures::new(claim.plugin.clone());
        let core = Rc::new_cyclic(|this| Self {
            claim,
            id,
            root,
            this: this.clone(),
            state: RefCell::default(),
            images,
            part: RefCell::default(),
            viewed: Cell::new(None),
            waiting: Cell::new(false),
            hint: Cell::new(hint),
            width: Cell::new(0),
            switch: RefCell::default(),
            fallen: Cell::new(false),
            shows: Cell::new(false),
            fence: RefCell::default(),
        });
        book(|ledger| ledger.mounts += 1);
        LIVE.with(|live| live.borrow_mut().push(Rc::downgrade(&core)));
        core.claim.activation.track(Rc::downgrade(&core) as Weak<dyn Drawn>);
        // A view gets the part's own width: one laid out at another width than the last view saw views again.
        let weak = Rc::downgrade(&core);
        core.root.on_resize(move |_, rect| {
            if let Some(core) = weak.upgrade()
                && core.shows.get()
                && rect.width as u16 != core.width.get()
            {
                core.wait();
            }
        });
        core
    }

    fn show(self: &Rc<Self>, part: Part) -> bool {
        let part = without_result(part);
        // The newest revision is kept also where the host's row draws it: a fence's owner draws it from here.
        let previous = self.part.replace(Some(part.clone()));
        if self.fallen.get() {
            return false;
        }
        let Some(host) = self.claim.owner.upgrade() else { return false };
        // The same part at the width the last view got is answered: a view of it would see nothing new.
        if previous.as_ref() == Some(&part) && self.input_width() == self.width.get() {
            return self.shows.get();
        }
        // A part that streams is viewed as the next paint starts, whichever row shows it: once, with the newest content
        // and what the plugin's handlers changed meanwhile.
        if previous.is_some_and(|previous| previous.phase() == part.phase()) {
            self.wait();
            return self.shows.get();
        }
        self.draw(&*host)
    }

    /// The width a view gets now: the tree's, while it shows and is laid out, else the row's.
    fn input_width(&self) -> u16 {
        let rect = self.root.rect();
        match self.shows.get() && rect.width > 0.0 {
            true => rect.width as u16,
            false => self.hint.get(),
        }
    }

    /// Views the newest revision at the next paint that is not this one's frame. When that changes which row shows
    /// the part, the owner hears of it in the same paint.
    fn wait(self: &Rc<Self>) {
        if self.waiting.replace(true) {
            return;
        }
        let Some(host) = self.claim.owner.upgrade() else { return };
        let weak = Rc::downgrade(self);
        // Animations run as a paint starts, before its layout: the view lands in that paint.
        host.app().animate(move |cx, _| {
            let Some(core) = weak.upgrade() else { return false };
            // A view since took the newest revision at its width.
            if !core.waiting.get() {
                return false;
            }
            if core.viewed.get() == Some(cx.app().frame_number()) {
                return true;
            }
            if let (false, Some(host)) = (core.fallen.get(), core.claim.owner.upgrade()) {
                let before = core.shows.get();
                if core.draw(&*host) != before {
                    let switch = core.switch.borrow().clone();
                    switch.iter().for_each(|switched| switched());
                }
            }
            false
        });
    }

    /// Calls the view on the part and adopts its tree; whether the claim shows the part.
    fn draw(&self, host: &dyn Host) -> bool {
        // This view takes the newest revision at its width: one held back for the paint is owed no more.
        self.waiting.set(false);
        let theme = host.theme();
        self.viewed.set(Some(host.app().frame_number()));
        let whole = self.state.borrow().last.is_none();
        for full in [whole, true] {
            let attempt = self.call_view(host, &theme, full);
            let accepted = match attempt.viewed {
                Viewed::Failed => None,
                Viewed::Overran => {
                    log::warn!("claim {} took over the call limit on part {}", self.id.surface, self.id.key);
                    None
                }
                Viewed::Returned(node, remote) => Some((node, remote)),
            };
            let Some((node, remote)) = accepted else {
                self.state.borrow_mut().memo = attempt.memo;
                return self.fall();
            };
            let Some(node) = node else {
                // A declined revision: the host's row draws it, and an accepted one later builds whole. The memo
                // values stay, in the host's table as in a library's.
                let mut memo = attempt.memo;
                memo.discard();
                let mut state = self.state.borrow_mut();
                state.memo = memo;
                state.remote = remote.unwrap_or(state.remote);
                let entries = state.memo_entries();
                drop(state);
                book(|ledger| ledger.memo_entries += entries - attempt.held);
                self.wipe();
                self.shows.set(false);
                return false;
            };
            let (mut memo, held) = (attempt.memo, attempt.held);
            match self.adopt(host, &theme, vec![*node], &attempt.given, full) {
                Ok(()) => {
                    let mut state = self.state.borrow_mut();
                    if let Some(last) = &state.last {
                        memo.finish(last);
                    }
                    state.memo = memo;
                    state.remote = remote.unwrap_or(0);
                    let entries = state.memo_entries();
                    book(|ledger| ledger.memo_entries += entries - held);
                    self.shows.set(true);
                    return true;
                }
                Err(refused) => {
                    // The host's table forgets the view; a library's holds what it said, as it takes its tree.
                    memo.clear();
                    let mut state = self.state.borrow_mut();
                    (state.memo, state.remote) = (memo, remote.unwrap_or(0));
                    let entries = state.memo_entries();
                    book(|ledger| ledger.memo_entries += entries - held);
                    log::warn!("claim {} refused a tree for part {}: {refused}", self.id.surface, self.id.key);
                    // Only a keep the host does not hold is mended by a whole tree, once; any other refusal is the
                    // plugin's error, and the part falls back at once.
                    if full
                        || !matches!(
                            refused,
                            crate::reconcile::Refused::Unknown(_) | crate::reconcile::Refused::Kept(_)
                        )
                    {
                        break;
                    }
                }
            }
        }
        self.fall()
    }

    /// The part shows the host's row from now on.
    fn fall(&self) -> bool {
        self.fallen.set(true);
        self.wipe();
        self.shows.set(false);
        false
    }

    /// Takes the theme without a call, unless the claim reads the palette: then the new palette is a new input, and
    /// a revision it declined is asked again too.
    fn restyle(&self) {
        let palette = self.claim.entry.palette;
        if self.fallen.get() || !(self.shows.get() || palette) || self.part.borrow().is_none() {
            return;
        }
        let Some(host) = self.claim.owner.upgrade() else { return };
        let last = self.state.borrow().last.clone();
        match last {
            Some(last) if !palette => {
                if let Err(refused) = self.adopt(&*host, &host.theme(), last, &HashMap::new(), false) {
                    log::error!("claim {}: its last tree again: {refused}", self.id.surface);
                }
            }
            // One view a frame here too: a part viewed in this frame takes the new palette at the next paint.
            _ if self.viewed.get() == Some(host.app().frame_number()) => {
                if let Some(core) = self.this.upgrade() {
                    core.wait();
                }
            }
            _ => {
                self.draw(&*host);
            }
        }
    }

    fn call_view(&self, host: &dyn Host, theme: &Theme, full: bool) -> Attempt {
        let part = self.part.borrow().clone().expect("a part to view");
        let width = self.input_width();
        self.width.set(width);
        // Only a claim that declares the palette gets it, as a surface (P4): it is most of a request's bytes.
        let palette = match self.claim.entry.palette {
            true => self.claim.palette(host, theme),
            false => v2::Palette::default(),
        };
        // A part is as tall as its tree: a claim gets no height, which a resize could leave stale.
        let changed = abi::Changed::everything();
        let input = v2::SurfaceInput { width, height: 0, palette, full, panel: None, changed, slot: None };
        let (held, remote, mut memo) = {
            let mut state = self.state.borrow_mut();
            (state.memo_entries(), state.remote, std::mem::take(&mut state.memo))
        };
        book(|ledger| ledger.views += 1);
        let staged = RefCell::new(HashMap::new());
        let mut give = |handle, bytes: Vec<u8>| drop(staged.borrow_mut().insert(handle, Arc::from(bytes)));
        // A release holds also when the tree is refused: the plugin forgot the handle either way. Its picture goes
        // with it.
        let mut release = |handle| {
            self.images.release(ImageKey::Content(handle));
            if staged.borrow_mut().remove(&handle).is_some() {
                return;
            }
            let mut state = self.state.borrow_mut();
            state.dropped.remove(&handle);
            if let Some(bytes) = state.content.remove(&handle) {
                drop(state);
                self.release_content(&bytes);
            }
        };
        // Counted once, at the view's first keep.
        let counts = std::cell::OnceCell::new();
        let kept = |key: &str| {
            let state = self.state.borrow();
            if let Some(whole) = state.tree.held_whole(key) {
                return whole;
            }
            let counts = counts.get_or_init(|| state.tree.held_counts());
            counts.get(key).copied().unwrap_or(0)
        };
        let viewing = Viewing {
            mount: &self.id,
            owner: &self.claim.input,
            input: &input,
            memo: &mut memo,
            give: &mut give,
            release: &mut release,
            kept: &kept,
            held: remote,
            // A claim keeps no placeholder height of its own.
            laid: None,
        };
        let viewed = self.claim.viewer.view(host, viewing, &part);
        Attempt { viewed, given: staged.take(), memo, held }
    }

    /// Adopts `nodes`, with the content `given` adds, or refuses them and changes nothing.
    fn adopt(
        &self,
        host: &dyn Host,
        theme: &Theme,
        nodes: Vec<Node>,
        given: &HashMap<ContentRef, Arc<[u8]>>,
        full: bool,
    ) -> Result<(), crate::reconcile::Refused> {
        let owner = self.claim.owner.clone();
        let act: Act = Rc::new(move |action| crate::node::act(&owner, action));
        let slot = |_: &View, path: &str| {
            log::warn!("claim {} cannot show slot {path}: a part has no slots", self.id.surface);
            None
        };
        let plugin = &self.claim.plugin;
        let mut state = self.state.borrow_mut();
        // Content past what the plugin may hold is not kept: a node that shows it is a placeholder (4.2).
        let (admitted, over) = surface::admit_content(plugin, given);
        let Held { tree, content, last, measures, dropped, .. } = &mut *state;
        let unheld: HashSet<ContentRef> = dropped.union(&over).copied().collect();
        let bytes = |handle: &ContentRef| content.get(handle).or_else(|| given.get(handle));
        let source = |source: &Source| match source {
            Source::Text(text) => Some(Rc::from(text.as_str())),
            Source::Content(handle) => bytes(handle).map(|bytes| Rc::from(String::from_utf8_lossy(bytes).as_ref())),
            Source::PartOutput(part) => crate::surface::part_output(host, part).map(|text| Rc::from(text.as_str())),
        };
        let measure = |source: &Source| match source {
            Source::Content(handle) => bytes(handle).map(|bytes| measures.of(*handle, bytes)).unwrap_or_default(),
            Source::Text(text) => crate::reconcile::measure(text),
            Source::PartOutput(part) => {
                crate::surface::part_output(host, part).map(|text| crate::reconcile::measure(&text)).unwrap_or_default()
            }
        };
        // An image is admitted and decoded on a worker once a source, as in a surface (Pl).
        let image = |source: &Source| {
            let mount = self.this.clone() as Weak<dyn Shows>;
            self.images.of(host.app(), source, |handle| bytes(handle).cloned(), mount)
        };
        let has = |handle: ContentRef| bytes(&handle).is_some() || unheld.contains(&handle);
        let gone = |handle: ContentRef| unheld.contains(&handle);
        // A fence claim's tree may show the host's code view of its part once, with the newest revision.
        // Read as the node is built, with no copy of the part: a tool call's mount has no code view.
        let code = self.fence.borrow().clone();
        let fence_view = || match (&code, &*self.part.borrow()) {
            (Some(code), Some(Part::Fence(fence))) => Some(code.show(fence).as_any()),
            _ => None,
        };
        let fence: Option<&dyn Fn() -> Option<AnyWidget>> = code.is_some().then_some(&fence_view);
        // A claim has no draw call (P5): a canvas in its tree draws nothing. It has no handler (P2): a box's pointer
        // and hover events reach none, and its clicks run through `act` (P1).
        let env = Env {
            host,
            theme,
            act: &act,
            slot: &slot,
            source: &source,
            measure: &measure,
            content: &has,
            dropped: &gone,
            image: &image,
            full,
            draw: None,
            owner: None,
            plugin: Some(plugin),
            item: false,
            fence,
        };
        let mut applied = Ok(());
        ADOPTING.set(ADOPTING.get() + 1);
        (self.claim.host_time)(&mut || applied = tree.apply(&env, &self.root, &nodes));
        ADOPTING.set(ADOPTING.get() - 1);
        let attempt = self.images.take_attempt();
        if let Err(refused) = applied {
            // A refused view's content is not the part's: neither are the pictures it started.
            attempt.into_iter().for_each(|key| self.images.release(key));
            return Err(refused);
        }
        self.images.keep_shown(tree);
        *last = Some(tree.admitted(nodes));
        for (handle, bytes) in given {
            if over.contains(handle) {
                dropped.insert(*handle);
                continue;
            }
            book(|ledger| {
                ledger.content += 1;
                ledger.content_bytes += bytes.len() as i64;
            });
            content.insert(*handle, bytes.clone());
        }
        limits::recharge(plugin, limits::Kind::Content, 0, admitted);
        measures.retain(|handle| content.contains_key(handle));
        host.app().request_redraw();
        Ok(())
    }

    /// Gives back what content `bytes` held: the ledger's count and the plugin's charge.
    fn release_content(&self, bytes: &[u8]) {
        limits::release(&self.claim.plugin, limits::Kind::Content, bytes.len() as u64);
        book(|ledger| {
            ledger.content -= 1;
            ledger.content_bytes -= bytes.len() as i64;
        });
    }

    /// Whether the last accepted tree shows the fence's code view ([`Node::Fence`]).
    fn holds_fence(&self) -> bool {
        self.state.borrow().tree.holds_fence()
    }

    /// Drops the tree, so a later view builds whole, and the pictures of inline images, which only the tree named.
    /// The content handles and memo values its views gave stay with the mount until it ends or the plugin releases
    /// them (4.2), as a library keeps its table: a later view may name them again.
    fn wipe(&self) {
        let mut state = self.state.borrow_mut();
        state.tree.clear(&self.root);
        state.last = None;
        self.images.keep_shown(&state.tree);
    }
}

impl Shows for Core {
    fn pictures(&self) -> &Pictures {
        &self.images
    }

    fn host_time(&self) -> &HostTime {
        &self.claim.host_time
    }

    fn show(&self, key: ImageKey, image: &opentui::native::Image) {
        self.state.borrow().tree.each_image(&mut |source, view| {
            if ImageKey::of(source) == Some(key) {
                view.image(Some(image.clone()));
            }
        });
    }
}

/// A wake of the plugin, or a handler of it that ran, draws the part again: the plugin's own state may have changed
/// what its view returns. A part the host's row shows for the rest of its mount is not asked. A part viewed in this
/// frame already, by a revision or another wake, is viewed at the next paint with what is newest then, as a revision
/// that streams is (review bigboi 12): one view a frame, whichever way it is asked for. A part whose view waits for
/// the paint already gets the plugin's change there. A handler that ran between paints is viewed as the next paint
/// starts, as a streaming revision is, so the two share one view in the first paint in either order; a wake drained
/// at a paint's start is viewed at once, in that paint.
impl Drawn for Core {
    fn woken(&self, host: &dyn Host) {
        // A view that waits for the paint sees the plugin's state then.
        if self.fallen.get() || self.part.borrow().is_none() || self.waiting.get() {
            return;
        }
        // Between paints a handler's change waits for the next one too, so a revision that streams before then joins
        // that one view, whichever came first (re-review final pass, big-boi 12). A wake's drain is the paint's start
        // already: a view now lands in that paint.
        if !crate::schedule::draining() || self.viewed.get() == Some(host.app().frame_number()) {
            if let Some(core) = self.this.upgrade() {
                core.wait();
            }
            return;
        }
        let before = self.shows.get();
        if self.draw(host) != before {
            let switch = self.switch.borrow().clone();
            switch.iter().for_each(|switched| switched());
        }
    }
}

/// `part` as a claim's view gets it: a call without what it returned, which its output reference names, and without
/// metadata over [`abi::claim::METADATA_BYTES`], so a request stays small whatever the call returned.
fn without_result(part: Part) -> Part {
    use opencode_plugin_abi::types::SessionMessageAssistantToolState as ToolState;
    fn bounded<T: serde::Serialize + Default>(metadata: &mut T) {
        if serde_json::to_vec(metadata).is_ok_and(|bytes| bytes.len() > abi::claim::METADATA_BYTES) {
            *metadata = T::default();
        }
    }
    let Part::Tool(mut tool) = part else { return part };
    match &mut tool.tool.state {
        ToolState::Running(running) => bounded(&mut running.metadata),
        ToolState::Completed(done) => {
            done.content.clear();
            done.metadata.iter_mut().for_each(bounded);
        }
        ToolState::Error(failed) => {
            failed.content = None;
            failed.metadata.iter_mut().for_each(bounded);
        }
        ToolState::Streaming(_) | ToolState::Unknown(_) => {}
    }
    Part::Tool(tool)
}

impl Drop for Core {
    fn drop(&mut self) {
        // The part leaves the registry as it goes; a part dropped while the registry is read leaves it at the next.
        LIVE.with(|live| {
            if let Ok(mut live) = live.try_borrow_mut() {
                live.retain(|core| core.strong_count() > 0);
            }
        });
        if let Some(host) = self.claim.owner.upgrade() {
            self.claim.viewer.forget(&*host, &self.id);
        }
        self.images.release_all();
        let state = self.state.get_mut();
        let bytes: usize = state.content.values().map(|bytes| bytes.len()).sum();
        limits::release(&self.claim.plugin, limits::Kind::Content, bytes as u64);
        let (content, memo) = (state.content.len() as i64, state.memo_entries());
        book(|ledger| {
            ledger.mounts -= 1;
            ledger.content -= content;
            ledger.content_bytes -= bytes as i64;
            ledger.memo_entries -= memo;
        });
    }
}

/// The Markdown renderer of a fence claim. Each fence it takes is a mount held by the widget it gives Markdown, so the
/// mount goes when Markdown drops the block's widget. The block keeps that widget for its life: it shows the claim's
/// tree, or the host's code view of the fence while the claim does not draw it, so a fence that falls back stays the
/// same block and keeps its mount.
pub(crate) fn fence(claim: Rc<Registered>) -> crate::CodeBlockRender {
    let fences: Rc<RefCell<HashMap<u32, Weak<Fence>>>> = Rc::default();
    Rc::new(move |block, theme| {
        static KEYS: AtomicU64 = AtomicU64::new(1);
        // A fence in a claimed part's own Markdown is code: a claim inside a claim could nest without bound. A restyle
        // builds the block again more than once; the claim takes the last build, so it is viewed once.
        if ADOPTING.get() > 0 || opencode_ui::markdown::restyling() {
            return None;
        }
        let part = Part::Fence(FencePart {
            language: block.language.to_owned(),
            info: block.info.to_owned(),
            code: block.code.to_owned(),
            streaming: block.streaming,
            closed: block.closed,
        });
        let held = block.previous.and_then(|previous| {
            let fence = fences.borrow().get(&previous.id())?.upgrade()?;
            Some((previous.clone(), fence))
        });
        let (widget, fence) = match held {
            Some(held) => held,
            None => {
                let key = format!("fence-{}", KEYS.fetch_add(1, Ordering::Relaxed));
                let width = FENCE_WIDTH.get().unwrap_or(block.app.size().0);
                let core = Core::new(claim.clone(), block.app, &key, width);
                // The fence holds the widget's children and not the widget, whose handlers hold the fence.
                let slot = View::new(block.app).column().shrink(0.0).visible(false);
                let widget = View::new(block.app).column().shrink(0.0).child(&core.root).child(&slot);
                let code = FenceCode::new(block.app, (theme.clone(), block.conceal));
                core.fence.replace(Some(code.clone()));
                let fence = Rc::new(Fence { slot, core, code });
                let held = fence.clone();
                widget.on_focus(move |_, _| {
                    let _ = &held;
                });
                // A view gets the block's width; one the claim declined is asked again at another.
                let weak = Rc::downgrade(&fence);
                widget.on_resize(move |_, rect| {
                    if let Some(fence) = weak.upgrade() {
                        fence.core.hint.set(rect.width as u16);
                        if !fence.core.shows.get() && rect.width as u16 != fence.core.width.get() {
                            fence.core.wait();
                        }
                    }
                });
                let weak = Rc::downgrade(&fence);
                fence.core.switch.replace(Some(Rc::new(move || {
                    if let Some(fence) = weak.upgrade() {
                        fence.place();
                    }
                })));
                // The fences whose widgets Markdown freed go as another comes.
                let mut fences = fences.borrow_mut();
                fences.retain(|_, fence| fence.strong_count() > 0);
                fences.insert(widget.id(), Rc::downgrade(&fence));
                drop(fences);
                (widget.as_any(), fence)
            }
        };
        *fence.code.look.borrow_mut() = (theme.clone(), block.conceal);
        fence.core.show(part);
        fence.place();
        Some(widget)
    })
}

/// A fence a claim took: the two children of the widget Markdown holds for the block, the claim's tree and the
/// host's code view, and what they show.
struct Fence {
    /// Holds the host's code view of the fence while the claim does not draw it.
    slot: View,
    core: Rc<Core>,
    code: Rc<FenceCode>,
}

/// The host's code view of a claimed fence: the fence again as Markdown has it, in a document of its own, in the
/// theme and the concealment Markdown last rendered the block in. One holder keeps it for the fence's life: the
/// block's slot shows it while the claim does not draw the fence, and a [`Node::Fence`] of the claim's tree while it
/// does. Either way it follows the newest revision with no view.
struct FenceCode {
    app: App,
    holder: View,
    look: RefCell<(Theme, bool)>,
    code: RefCell<Option<Code>>,
}

/// The source a code view shows, in a theme and a concealment.
struct Code {
    markdown: opentui::widget::Markdown,
    source: String,
    look: (Theme, bool),
}

impl FenceCode {
    fn new(app: &App, look: (Theme, bool)) -> Rc<Self> {
        Rc::new(Self {
            app: app.clone(),
            holder: View::new(app).column().shrink(0.0),
            look: RefCell::new(look),
            code: RefCell::default(),
        })
    }

    /// The holder, showing `fence` in the last look.
    fn show(&self, fence: &FencePart) -> View {
        let marker = delimiter(&fence.info, &fence.code);
        let close = if fence.closed { format!("\n{marker}") } else { String::new() };
        let source = format!("{marker}{}\n{}{close}", fence.info, fence.code);
        let look = self.look.borrow().clone();
        let mut code = self.code.borrow_mut();
        match code.as_mut() {
            Some(code) if code.look == look => {
                if code.source != source {
                    code.markdown.set_markdown(source.clone());
                    code.source = source;
                }
                code.markdown.streaming(fence.streaming);
            }
            _ => {
                let (theme, conceal) = &look;
                let syntax = opencode_ui::code::syntax_theme(theme);
                let renderers = opencode_ui::markdown::CodeBlockRenderers::default();
                let markdown = opencode_ui::markdown::view(&self.app, theme, &syntax, &renderers, *conceal, true)
                    .set_markdown(source.clone())
                    .streaming(fence.streaming);
                self.holder.clear();
                self.holder.add(&markdown);
                *code = Some(Code { markdown, source, look });
            }
        }
        self.holder.clone()
    }

    /// Drops the code view: nothing shows it.
    fn hide(&self) {
        if self.code.take().is_some() {
            self.holder.clear();
        }
    }
}

/// A fence's delimiter that no line of `code` closes early, per CommonMark: backticks one longer than its longest run
/// of them, at least three; tildes so for an `info` that holds a backtick, which a backtick fence's may not (carbon
/// c2a-2). OpenTUI's block does not say which delimiter opened the fence; this is it whenever that was three backticks
/// and the code holds no such run.
fn delimiter(info: &str, code: &str) -> String {
    let mark = if info.contains('`') { '~' } else { '`' };
    let longest = code.split(|c| c != mark).map(str::len).max().unwrap_or(0);
    mark.to_string().repeat((longest + 1).max(3))
}

impl Fence {
    /// Shows the claim's tree while the claim draws the fence, else the host's code view of its newest revision. A
    /// fence node of the tree shows that code view too, current with each revision, whether a view ran or not.
    fn place(&self) {
        let shows = self.core.shows.get();
        self.core.root.visible(shows);
        self.slot.visible(!shows);
        // A tree without a fence node shows no code view, and reads nothing of the part.
        if shows && !self.core.holds_fence() {
            return self.code.hide();
        }
        let part = self.core.part.borrow();
        let Some(Part::Fence(fence)) = &*part else { return };
        let holder = self.code.show(fence);
        if shows {
            return;
        }
        if !self.slot.children().iter().any(|child| child.id() == holder.id()) {
            self.slot.clear();
            self.slot.add(&holder);
        }
    }
}
