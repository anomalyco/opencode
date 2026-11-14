//! A mount of a contract 2.0 surface ([`v2::Surface`], synthesis 4.2): one showing of a plugin's route or slot claim,
//! with a generation that is new every time. What it holds is its own and goes with it: the reconciled widgets, the
//! SDK's [`v2::Memo`] table, and the content handles the view gave the host. A view whose tree the host refuses
//! changes nothing; the host asks at once for a whole tree, and a second refusal in a row fails the plugin.
//!
//! A theme change restyles the widgets in place with no call, unless the surface reads the palette.

use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::rc::{Rc, Weak};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use opencode_plugin_abi::v2::{self, ContentRef, Node, Source};
use opencode_plugin_abi::{self as abi};
use opencode_ui::theme::Theme;
use opentui::keymap::Disposer;
use opentui::prelude::*;

use crate::canvas;
use crate::image::Picture;
use crate::interact::{self, Owner};
use crate::limits;
use crate::node::{Act, abi_mode};
use crate::reconcile::{Env, Refused, Tree};
use crate::{Claimed, Host, SlotInput, behave, slot};

/// Runs a view or a canvas draw as one call of the plugin, named for its report, for the mount `Owner` stands for:
/// `false` when it panicked, which fails the plugin.
pub(crate) type Call = Rc<dyn Fn(&'static str, &dyn Host, &Rc<Owner>, &mut dyn FnMut(&dyn abi::Read)) -> bool>;

/// What a mount routes of the input (P2): its plugin, its handler, the layers each mount registers, and whether it is
/// a panel, whose view gets [`v2::SurfaceInput::panel`].
pub(crate) struct Input {
    pub plugin: String,
    pub deliver: Option<interact::Deliver>,
    pub layers: Vec<abi::interact::Layer>,
    pub panel: bool,
    /// Its handler hears each mount begin and end ([`abi::interact::Event::Mount`], P6a).
    pub mounts: bool,
    /// The activation's own input owner, which hears the mount events: what they ask for is the plugin's, and ends
    /// with the activation (review carbon-3).
    pub activation: Rc<Owner>,
}
/// Adds what `from` says changed to `into`.
fn merge(into: &mut abi::Changed, from: &abi::Changed) {
    into.all |= from.all;
    into.local |= from.local;
    into.size |= from.size;
    into.woken |= from.woken;
    into.sessions.extend(from.sessions.iter().cloned());
    into.lists.extend(from.lists.iter().cloned());
    into.messages.extend(from.messages.iter().cloned());
    into.locations.extend(from.locations.iter().cloned());
}

/// Fails the plugin with the error.
pub(crate) type Fail = Rc<dyn Fn(String)>;
/// A route's commands, bound to one mount: what they ask for ends with the mount.
pub(crate) type Commands = Rc<dyn Fn(&Weak<()>) -> Vec<opencode_ui::keymap::TuiCommand>>;

/// The content handles of every mount: a handle is never given twice, so one a closed mount gave names nothing in
/// another, also one opened again under the same key.
static CONTENT: AtomicU64 = AtomicU64::new(1);

/// The handle the next content gets, for a view in a library, which numbers its content from it.
pub(crate) fn next_content() -> u64 {
    CONTENT.load(Ordering::Relaxed)
}

/// A handle for content a view in process gives.
pub(crate) fn new_content() -> ContentRef {
    ContentRef(CONTENT.fetch_add(1, Ordering::Relaxed))
}

/// A new mount's generation, never given twice: a library keeps a memo table by it, for surfaces and claimed parts
/// alike.
pub(crate) fn generation() -> u64 {
    static GENERATION: AtomicU64 = AtomicU64::new(1);
    GENERATION.fetch_add(1, Ordering::Relaxed)
}

/// A library numbered `count` handles from [`next_content`]: none is given again.
pub(crate) fn took_content(from: u64, count: u64) {
    CONTENT.fetch_max(from.saturating_add(count), Ordering::Relaxed);
}

/// A surface as the host mounts it: its name, where it shows, and whether its view reads the palette.
#[derive(Clone)]
pub(crate) struct Place {
    pub name: String,
    pub at: v2::Place,
    pub palette: bool,
    /// P3: what its `layout` call is told about.
    pub notify: Vec<v2::Notify>,
}

/// Runs a surface's view for one mount, on either carrier.
pub(crate) trait Viewer {
    /// One call of the view: its tree, or `None` when the call failed, which failed the plugin.
    fn view(&self, host: &dyn Host, viewing: Viewing<'_>) -> Option<Viewed>;
    /// Whether the surface has a draw, which its canvases call.
    fn draws(&self) -> bool {
        false
    }
    /// One call of the draw for `canvas` of `mount` at `frame` ([`canvas::Draw`]): `None` when the plugin did not
    /// run, else the list's bytes, or `None` to keep the list.
    fn draw(
        &self,
        _host: &dyn Host,
        _owner: &Rc<Owner>,
        _mount: &v2::MountId,
        _canvas: &str,
        _frame: v2::Frame,
    ) -> Option<Option<Vec<u8>>> {
        None
    }
    /// The mount ended.
    fn forget(&self, _host: &dyn Host, _mount: &v2::MountId) {}
}

/// What a view is given: the mount and its input, the mount's memo table in the host, and where the content it gives
/// and releases goes.
pub(crate) struct Viewing<'a> {
    pub mount: &'a v2::MountId,
    /// What the mount holds of the input: a view in process runs as its call, so its reads are the mount's.
    pub owner: &'a Rc<Owner>,
    pub input: &'a v2::SurfaceInput,
    pub memo: &'a mut v2::Memo,
    pub give: &'a mut dyn FnMut(ContentRef, Vec<u8>),
    pub release: &'a mut dyn FnMut(ContentRef),
    /// The keyed nodes the mount's tree holds at a key and under it, which a [`Node::Keep`] of the key holds again.
    pub kept: &'a dyn Fn(&str) -> usize,
    /// The values a library's memo table held after the mount's last view: a claim's view that returns no tree drops
    /// only what it staged, so its table holds no more.
    pub held: usize,
    /// The height a solve laid the mount's root out at, 0 included; `None` before the first, when the input's size is
    /// the screen's stand-in.
    pub laid: Option<u16>,
}

/// What a view returned.
pub(crate) struct Viewed {
    /// `None` from a carrier whose plugin answers later (the pipe's): nothing new, and the mount keeps its tree.
    pub node: Option<Node>,
    /// The values the memo table of a library holds after the view; `None` for a table in the host.
    pub memo: Option<usize>,
}

/// A view in process: the plugin's own function, as one call of it, on the mount's memo table in the host; and the
/// surface's draw, if it has one.
pub(crate) struct Linked {
    view: v2::ViewFn,
    draw: Option<v2::DrawFn>,
    call: Call,
}

impl Linked {
    pub fn new(view: v2::ViewFn, draw: Option<v2::DrawFn>, call: Call) -> Self {
        Self { view, draw, call }
    }
}

impl Viewer for Linked {
    fn view(&self, host: &dyn Host, viewing: Viewing<'_>) -> Option<Viewed> {
        let Viewing { mount, owner, input, memo, give, release, .. } = viewing;
        let mut node = None;
        let called = (self.call)("view", host, owner, &mut |read| {
            let mut content = |bytes: Vec<u8>| {
                let handle = new_content();
                give(handle, bytes);
                handle
            };
            node = Some((self.view)(&mut v2::View::new(read, input, mount, memo, &mut content, release)));
        });
        called.then_some(())?;
        Some(Viewed { node: Some(node?), memo: None })
    }

    fn draws(&self) -> bool {
        self.draw.is_some()
    }

    fn draw(
        &self,
        host: &dyn Host,
        owner: &Rc<Owner>,
        mount: &v2::MountId,
        canvas: &str,
        frame: v2::Frame,
    ) -> Option<Option<Vec<u8>>> {
        let draw = self.draw.as_ref()?;
        let (mut ran, mut list) = (false, None);
        // A call that panicked set no list; one that was refused did not run.
        (self.call)("draw", host, owner, &mut |read| {
            ran = true;
            list = draw(&mut v2::Draw { read, mount, canvas, frame });
        });
        ran.then(|| list.map(abi::canvas::List::into_bytes))
    }
}

/// What the mounts of 2.0 surfaces hold now, counted per thread and per plugin outside any mount.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Ledger {
    pub mounts: i64,
    pub content: i64,
    pub content_bytes: i64,
    pub memo_entries: i64,
}

thread_local! {
    static LEDGER: RefCell<HashMap<Rc<str>, Ledger>> = RefCell::default();
    static ADOPTED: Cell<u64> = const { Cell::new(0) };
}

/// How many trees the mounts on this thread adopted, a keep of a root that is taken as it is not counted: a view's tree
/// that equals the last costs the host no reconcile work, but is adopted (review carbon-7).
pub fn adopted() -> u64 {
    ADOPTED.get()
}

/// What the mounts of every plugin hold on this thread now.
pub fn ledger() -> Ledger {
    LEDGER.with(|ledgers| {
        ledgers.borrow().values().fold(Ledger::default(), |sum, ledger| Ledger {
            mounts: sum.mounts + ledger.mounts,
            content: sum.content + ledger.content,
            content_bytes: sum.content_bytes + ledger.content_bytes,
            memo_entries: sum.memo_entries + ledger.memo_entries,
        })
    })
}

/// What the mounts of `plugin` hold on this thread now (P6a: the built-ins' own mounts show beside another plugin's).
pub fn ledger_of(plugin: &str) -> Ledger {
    LEDGER.with(|ledgers| ledgers.borrow().get(plugin).copied().unwrap_or_default())
}

/// How many plugins the ledger holds a row for: one that holds nothing has none.
pub fn ledger_rows() -> usize {
    LEDGER.with(|ledgers| ledgers.borrow().len())
}

fn book(plugin: &Rc<str>, f: impl FnOnce(&mut Ledger)) {
    LEDGER.with(|ledgers| {
        let mut ledgers = ledgers.borrow_mut();
        let ledger = match ledgers.get_mut(plugin) {
            Some(ledger) => ledger,
            None => ledgers.entry(plugin.clone()).or_default(),
        };
        f(ledger);
        if *ledger == Ledger::default() {
            ledgers.remove(plugin);
        }
    });
}

/// One mount of a surface.
pub(crate) struct Surface {
    pub(crate) root: View,
    app: App,
    owner: Weak<dyn Host>,
    /// The plugin's ID, which its canvases' lists are charged to.
    plugin: Rc<str>,
    viewer: Rc<dyn Viewer>,
    /// How its canvases call the surface's draw.
    drawer: std::cell::OnceCell<Rc<canvas::Drawer>>,
    fail: Fail,
    /// The slot it renders in; empty for a route.
    path: String,
    slot_input: SlotInput,
    palette: bool,
    pub(crate) id: v2::MountId,
    /// P3: the plugin's `layout` and scroll handler, what `layout` is told about, and what the behaviors hold.
    pub(crate) calls: behave::Calls,
    pub(crate) notify: Vec<v2::Notify>,
    pub(crate) behave: RefCell<behave::State>,
    this: RefCell<Weak<Surface>>,
    /// Lives as long as the mount; what its route's commands asked for checks it before it arrives.
    alive: Rc<()>,
    /// A route's surface fills the page; a slot's takes its node's layout, as a 1.x claim's root does.
    fills: bool,
    /// The layout a slot's root took last.
    layout: Cell<Option<abi::Layout>>,
    /// The size the last view was given, and how many views in a row a change of it called.
    seen: Cell<(u16, u16)>,
    /// A solve has laid its root out.
    laid: Cell<bool>,
    resized: Cell<u8>,
    pub(crate) state: RefCell<State>,
    live: RefCell<Option<Rc<slot::Live>>>,
    watch: RefCell<Option<Disposer>>,
    /// The host's [`Host::local_revision`] when the view last ran.
    revision: Cell<Option<u64>>,
    /// The input the view last got, refilled for the next.
    viewed: RefCell<v2::SurfaceInput>,
    /// What the content the mount holds costs, read once a handle.
    measures: crate::reconcile::Measures,
    /// A view waits for the next frame's rows, with what changed for it ([`Surface::draw_next_frame`]).
    deferred: RefCell<Option<abi::Changed>>,
    /// Each image source's picture, admitted and decoded once however many nodes show it, and the decoded bytes it
    /// charges to the plugin, or the job that holds them until it is done.
    images: RefCell<HashMap<ImageKey, (Picture, Charge)>>,
    /// A panel or an overlay before its first layout: it draws first as that layout gives it its room, so a change
    /// before it draws nothing (it would draw at a size and a showing the panel does not have yet).
    pending: Cell<bool>,
    input: Rc<Input>,
    /// What the mount holds of the input; it ends with the mount.
    holder: RefCell<Option<Rc<Owner>>>,
    /// Times the host's own work for the mount's nodes, as the plugin's host time.
    host_time: HostTime,
}

/// The decoded bytes of an image source: held by the mount, or by the job decoding it, by its number.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Charge {
    Held(u64),
    Job(u64),
}

thread_local! {
    /// The image jobs started on this thread, which number the next.
    static JOB: Cell<u64> = const { Cell::new(0) };
}

/// Runs the host's own work for a plugin's nodes, timed as its host time (synthesis 4.4).
pub(crate) type HostTime = Rc<dyn Fn(&mut dyn FnMut())>;

/// An image's source: content by its handle, inline bytes by their hash.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
enum ImageKey {
    Content(ContentRef),
    Text(u64),
}

impl ImageKey {
    fn of(source: &Source) -> Option<ImageKey> {
        match source {
            Source::Content(handle) => Some(ImageKey::Content(*handle)),
            Source::Text(text) => {
                use std::hash::{Hash, Hasher};
                let mut hasher = std::collections::hash_map::DefaultHasher::new();
                text.hash(&mut hasher);
                Some(ImageKey::Text(hasher.finish()))
            }
            Source::PartOutput(_) => None,
        }
    }
}

/// What one call of the view returned and asked for; the host takes it only with its tree.
struct Called {
    /// `None` when the carrier's plugin answers later: nothing new.
    node: Option<Node>,
    staged: Staged,
    memo: v2::Memo,
    /// The values a library's own table holds after the call; `None` when the table is `memo`.
    remote: Option<usize>,
}

/// The content a view gave, which goes with its tree when the host refuses it.
#[derive(Default)]
struct Staged {
    given: HashMap<ContentRef, Arc<[u8]>>,
}

#[derive(Default)]
pub(crate) struct State {
    pub(crate) tree: Tree,
    memo: v2::Memo,
    /// The memo values the ledger counts for the mount, in the host's table or the library's.
    booked: i64,
    /// The content the accepted views gave and did not release, each charged to the plugin.
    content: HashMap<ContentRef, Arc<[u8]>>,
    /// The content the accepted views gave past what the plugin may hold, and did not release: the host keeps none
    /// of it, and a node that shows it is a placeholder.
    dropped: HashSet<ContentRef>,
    /// The last accepted tree, keeps as they came.
    last: Option<Vec<Node>>,
    /// The last tree was refused, so the next view builds whole.
    refused: bool,
    palette: Option<(Theme, v2::Palette)>,
}

impl Surface {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        host: &dyn Host,
        owner: Weak<dyn Host>,
        plugin: Rc<str>,
        surface: &Place,
        (key, path): (&str, &str),
        slot_input: &SlotInput,
        alive: Rc<()>,
        viewer: Rc<dyn Viewer>,
        fail: Fail,
        calls: behave::Calls,
        input: Rc<Input>,
        host_time: HostTime,
    ) -> Rc<Self> {
        let id = v2::MountId { surface: surface.name.clone(), key: key.to_owned(), generation: generation() };
        let fills = path.is_empty();
        let root = match fills {
            true => View::new(host.app()).column().width(Length::percent(100.0)).height(Length::percent(100.0)),
            false => View::new(host.app()).column().shrink(0.0).visible(false),
        };
        let mounted = Rc::new(Self {
            root,
            app: host.app().clone(),
            calls,
            notify: surface.notify.clone(),
            behave: RefCell::default(),
            this: RefCell::default(),
            owner: owner.clone(),
            plugin,
            viewer,
            drawer: std::cell::OnceCell::new(),
            fail,
            path: path.to_owned(),
            slot_input: slot_input.clone(),
            palette: surface.palette,
            id,
            alive,
            fills,
            layout: Cell::new(None),
            seen: Cell::new((0, 0)),
            laid: Cell::new(false),
            resized: Cell::new(0),
            state: RefCell::default(),
            live: RefCell::new(None),
            watch: RefCell::new(None),
            revision: Cell::new(host.local_revision()),
            viewed: RefCell::default(),
            images: RefCell::default(),
            measures: crate::reconcile::Measures::default(),
            deferred: RefCell::new(None),
            pending: Cell::new(matches!(surface.at, v2::Place::Panel(_) | v2::Place::Overlay(_))),
            input: input.clone(),
            holder: RefCell::new(None),
            host_time,
        });
        book(&mounted.plugin, |ledger| ledger.mounts += 1);
        if mounted.viewer.draws() {
            let (weak, fail) = (Rc::downgrade(&mounted), mounted.fail.clone());
            let drawer = canvas::Drawer {
                owner: mounted.plugin.clone(),
                draw: Box::new(move |id, frame| weak.upgrade()?.draw_canvas(id, frame)),
                fail: Box::new(move |error| fail(error)),
            };
            let _ = mounted.drawer.set(Rc::new(drawer));
        }
        *mounted.this.borrow_mut() = Rc::downgrade(&mounted);
        behave::attach(host.app(), &mounted);
        // Its input: a node's widget is found in the tree of the moment, so one built again is found too.
        let found = Rc::downgrade(&mounted);
        let lookup: interact::Lookup =
            Rc::new(move |id: &str| found.upgrade().and_then(|mounted| mounted.state.borrow().tree.widget(id)));
        let owned = Owner::mount(
            &input.plugin,
            &surface.name,
            owner.clone(),
            mounted.root.clone(),
            lookup,
            input.deliver.clone(),
            mounted.alive(),
        );
        let deliver: interact::Deliver =
            input.deliver.clone().unwrap_or_else(|| Rc::new(|_, _, _| abi::interact::Handled::Pass));
        owned.register(host, &input.layers, &deliver);
        // A surface that asks hears its mount begin before its first view, as a 1.x claim's `on_mount` (P6a).
        mounted.tell_mount(host, true);
        *mounted.holder.borrow_mut() = Some(owned);
        let weak = Rc::downgrade(&mounted);
        // The host's own state and the terminal's size change outside change batches. A view that ran after the last
        // change of the host's state has seen it: a notice of it, which comes later, calls no view (review bigboi-7).
        let watch = host.watch(Rc::new(move |changed: &abi::Changed| {
            if let (Some(mounted), Some(host)) = (weak.upgrade(), owner.upgrade()) {
                let seen = host.local_revision().is_some_and(|now| mounted.revision.get() == Some(now));
                if changed.size || !seen {
                    mounted.draw(host.as_ref(), changed);
                }
            }
        }));
        *mounted.watch.borrow_mut() = watch;
        // The room the surface is given decides its input: a view runs again, after the frame, once its root is laid
        // out at another size than the view saw. A slot's root follows its content, so at most two of these run in a
        // row before another cause draws it.
        let (weak, app) = (Rc::downgrade(&mounted), host.app().clone());
        mounted.root.on_resize(move |_, rect| {
            let Some(mounted) = weak.upgrade() else { return };
            // What `layout` named may have moved with it, also when it is first laid out.
            mounted.laid.set(true);
            behave::arm(&app);
            // Only a slot's root follows its content; a surface that fills its room follows every resize of it, as a
            // splitter drag gives.
            let latched = !mounted.fills && mounted.resized.get() >= 2;
            if (rect.width as u16, rect.height as u16) == mounted.seen.get() || latched {
                return;
            }
            mounted.resized.set(mounted.resized.get() + 1);
            mounted.pending.set(false);
            let weak = Rc::downgrade(&mounted);
            app.defer(move |_| {
                if let (Some(mounted), Some(host)) = (weak.upgrade(), mounted_owner(&weak)) {
                    mounted.draw_sized(host.as_ref(), &abi::Changed { size: true, ..abi::Changed::default() });
                }
            });
        });
        // A panel's and an overlay's first view runs as their first layout gives them their room, once the host shows
        // them: it sees how they show (`SurfaceInput::panel`) and their size, so one view draws them.
        match fills {
            true if mounted.pending.get() => {}
            // A route's first view runs once the page it replaces is gone, whose keymap layers go in this turn's
            // deferred work, before the next frame: the view sees the keymap the route has (review bigboi-7).
            true => {
                let weak = Rc::downgrade(&mounted);
                host.app().defer(move |_| {
                    if let (Some(mounted), Some(host)) = (weak.upgrade(), mounted_owner(&weak)) {
                        mounted.draw(host.as_ref(), &abi::Changed::everything());
                    }
                });
            }
            false => mounted.draw(host, &abi::Changed::everything()),
        }
        mounted
    }

    /// Calls the view and adopts its tree, for a cause other than its size: `changed` is what the view hears changed
    /// ([`v2::SurfaceInput::changed`]).
    pub fn draw(&self, host: &dyn Host, changed: &abi::Changed) {
        if self.pending.get() {
            return;
        }
        self.resized.set(0);
        self.draw_sized(host, changed);
    }

    /// What the mount holds of the input.
    pub fn holder(&self) -> Option<Rc<Owner>> {
        self.holder.borrow().clone()
    }

    /// Calls the view and adopts its tree; on a refusal, once more for a whole tree. A revision the frame has no rows
    /// left for, by what the last one built, waits for the next frame; a first view does not (review bigboi 3).
    fn draw_sized(&self, host: &dyn Host, changed: &abi::Changed) {
        let estimate = {
            let state = self.state.borrow();
            state.last.is_some().then(|| state.tree.rows())
        };
        if let Some(estimate) = estimate
            && !limits::frame_room(host.app(), estimate)
        {
            return self.draw_next_frame(host.app(), changed);
        }
        let theme = host.theme();
        for _ in 0..2 {
            let full = {
                let state = self.state.borrow();
                state.last.is_none() || state.refused
            };
            let Some(called) = self.call_view(host, &theme, full, changed) else {
                self.wipe();
                return;
            };
            let Some(node) = called.node else {
                self.state.borrow_mut().memo = called.memo;
                return;
            };
            let (mut memo, remote) = (called.memo, called.remote);
            // A keep of the last tree's root keeps the mount as it is: nothing to adopt and no frame (P6a), when the
            // pass would change nothing: no node shows what the host reads again (a tool call's output), and the tree
            // is in the theme of the moment. The memo table stays as it is: the next view discards what this one staged.
            if !full && called.staged.given.is_empty() && self.keeps_root(&node) && self.settled(&theme) {
                let mut state = self.state.borrow_mut();
                let size = remote.unwrap_or(memo.len()) as i64;
                book(&self.plugin, |ledger| ledger.memo_entries += size - state.booked);
                (state.memo, state.booked) = (memo, size);
                return;
            }
            let result = self.adopt(host, &theme, vec![node], &called.staged, full);
            let mut state = self.state.borrow_mut();
            match result {
                Ok(()) => {
                    if let Some(last) = &state.last {
                        memo.finish(last);
                    }
                    let size = remote.unwrap_or(memo.len()) as i64;
                    book(&self.plugin, |ledger| ledger.memo_entries += size - state.booked);
                    (state.memo, state.booked, state.refused) = (memo, size, false);
                    return;
                }
                Err(refused) => {
                    // Nothing of the refused call stays: the content it gave is dropped, its releases with it, and
                    // the memo values go, as the next view builds whole (a library's own table too, as it is asked
                    // for a whole tree).
                    memo.clear();
                    book(&self.plugin, |ledger| ledger.memo_entries -= state.booked);
                    (state.memo, state.booked) = (memo, 0);
                    if state.refused {
                        drop(state);
                        self.wipe();
                        (self.fail)(format!("{} refused twice in a row: {refused}", self.id.surface));
                        return;
                    }
                    // Only a keep the host does not hold is mended by a whole tree; any other refusal is the plugin's
                    // error, and fails it at once (3.4).
                    if !matches!(refused, Refused::Unknown(_) | Refused::Kept(_)) {
                        drop(state);
                        self.wipe();
                        (self.fail)(format!("{} broke the contract: {refused}", self.id.surface));
                        return;
                    }
                    log::warn!("surface {}: {refused}; asking for a whole tree", self.id.surface);
                    state.refused = true;
                }
            }
        }
    }

    /// Tells the plugin of a surface that asks that this mount began or is ending. The plugin hears it, not the mount:
    /// what it starts is the plugin's and outlives the mount, as a 1.x `on_mount`'s does (a read the next mount shows),
    /// and it ends with the plugin's activation, as a command's does.
    fn tell_mount(&self, host: &dyn Host, mounted: bool) {
        let Some(deliver) = self.input.deliver.as_ref().filter(|_| self.input.mounts) else { return };
        deliver(host, &self.input.activation, &self.mount_event(mounted));
    }

    /// [`abi::interact::Event::Mount`] for this mount, with a slot surface's input.
    fn mount_event(&self, mounted: bool) -> abi::interact::Event {
        let slot = (!self.path.is_empty()).then(|| abi::SlotInput {
            session_id: self.slot_input.session_id.clone(),
            prompt: self
                .slot_input
                .prompt
                .as_ref()
                .map(|prompt| abi::PromptInput { shell: prompt.shell, show_details: prompt.show_details }),
            ..abi::SlotInput::default()
        });
        abi::interact::Event::Mount { mount: self.id.clone(), mounted, slot }
    }

    /// Whether a pass over the tree as it is would change nothing: no node shows a tool call's output, which the host
    /// reads again each revision, and its widgets are painted in `theme`.
    fn settled(&self, theme: &Theme) -> bool {
        let state = self.state.borrow();
        state.tree.is_static() && state.tree.styled_in(theme)
    }

    /// Whether `node` is a keep of the root of the tree (the last accepted tree may itself be that keep).
    fn keeps_root(&self, node: &Node) -> bool {
        let Node::Keep { key } = node else { return false };
        self.state.borrow().tree.nodes.first().and_then(|root| root.node.id()) == Some(key.as_str())
    }

    /// Calls the view as the next paint starts, once however many causes ask for it, with what each said changed.
    fn draw_next_frame(&self, app: &App, changed: &abi::Changed) {
        if let Some(waiting) = self.deferred.borrow_mut().as_mut() {
            return merge(waiting, changed);
        }
        *self.deferred.borrow_mut() = Some(changed.clone());
        crate::reconcile::Tree::defer();
        let weak = self.weak();
        app.animate(move |_, _| {
            if let (Some(mounted), Some(host)) = (weak.upgrade(), mounted_owner(&weak)) {
                let changed = mounted.deferred.borrow_mut().take().unwrap_or_default();
                mounted.draw_sized(host.as_ref(), &changed);
            }
            false
        });
    }

    /// Drops all the mount holds but itself: its plugin failed, so it shows nothing more and the behaviors leave it.
    fn wipe(&self) {
        behave::detach(&self.app, self);
        *self.behave.borrow_mut() = behave::State::default();
        self.release_images();
        let mut state = self.state.borrow_mut();
        state.tree.clear(&self.root);
        state.last = None;
        state.dropped.clear();
        let (content, memo) = (std::mem::take(&mut state.content), std::mem::take(&mut state.booked));
        state.memo.clear();
        self.release_content(&content);
        book(&self.plugin, |ledger| ledger.memo_entries -= memo);
    }

    /// Gives back what `content` held: the ledger's count and the plugin's charge.
    fn release_content(&self, content: &HashMap<ContentRef, Arc<[u8]>>) {
        let bytes: u64 = content.values().map(|bytes| bytes.len() as u64).sum();
        limits::release(&self.plugin, limits::Kind::Content, bytes);
        book(&self.plugin, |ledger| {
            ledger.content -= content.len() as i64;
            ledger.content_bytes -= bytes as i64;
        });
    }

    /// Drops every picture the mount holds and gives back what they charged; a job gives back its own.
    fn release_images(&self) {
        let held = self.images.borrow_mut().drain().map(|(_, (_, charge))| charge).collect::<Vec<_>>();
        held.into_iter().for_each(|charge| self.release_charge(charge));
    }

    /// Drops the picture of `key`, if the mount holds one, and gives back what it charged; a job gives back its own.
    fn release_image(&self, key: ImageKey) {
        let held = self.images.borrow_mut().remove(&key);
        if let Some((_, charge)) = held {
            self.release_charge(charge);
        }
    }

    fn release_charge(&self, charge: Charge) {
        if let Charge::Held(bytes) = charge {
            limits::release(&self.plugin, limits::Kind::Images, bytes);
        }
    }

    /// Takes the theme without a call: the last tree is adopted again in it. A surface that reads the palette
    /// gets a view instead.
    pub fn restyle(&self, host: &dyn Host) {
        let last = self.state.borrow().last.clone();
        match last {
            Some(last) if !self.palette => {
                let theme = host.theme();
                if let Err(refused) = self.adopt(host, &theme, last, &Staged::default(), false) {
                    log::error!("surface {}: its last tree again: {refused}", self.id.surface);
                }
            }
            _ => self.draw(host, &abi::Changed::everything()),
        }
    }

    /// What the view returned and asked for; `None` when the call failed.
    fn call_view(&self, host: &dyn Host, theme: &Theme, full: bool, changed: &abi::Changed) -> Option<Called> {
        // Only a surface that says it reads the palette gets it, on either carrier.
        let palette = if self.palette { self.palette_of(host, theme) } else { v2::Palette::default() };
        let rect = self.root.rect();
        // Before its first frame a surface has no size of its own; the terminal's stands in, which is a route's: a
        // plugin route shows no tabs and fills the page.
        let (width, height) = match (rect.width as u16, rect.height as u16) {
            (0, _) | (_, 0) => host.app().size(),
            size => size,
        };
        // The host's own state changed since the last view: this view hears it as `local`, as its notice, which
        // comes later, calls no view once this one ran.
        let revision = host.local_revision();
        let local = revision != self.revision.replace(revision);
        self.seen.set((width, height));
        let panel = match self.input.panel {
            true => host.panel_input(&self.input.plugin, &self.id.surface),
            false => None,
        };
        // The input is refilled in place, so a view call allocates nothing for it in the steady state.
        let mut input = std::mem::take(&mut *self.viewed.borrow_mut());
        (input.width, input.height, input.palette, input.full, input.panel) = (width, height, palette, full, panel);
        input.changed.clone_from(changed);
        input.changed.all |= full;
        input.changed.local |= local;
        if !self.path.is_empty() {
            let slot = input.slot.get_or_insert_with(abi::SlotInput::default);
            slot.session_id.clone_from(&self.slot_input.session_id);
            slot.prompt = self
                .slot_input
                .prompt
                .as_ref()
                .map(|prompt| abi::PromptInput { shell: prompt.shell, show_details: prompt.show_details });
            (slot.width, slot.height) = (width, height);
        }
        let owner = self.holder().unwrap_or_else(|| Owner::activation(&self.input.plugin, self.owner.clone()));
        // The view works on the mount's table; what it stages there the host keeps only with its tree.
        let mut memo = std::mem::take(&mut self.state.borrow_mut().memo);
        let given = RefCell::new(HashMap::new());
        let mut give = |handle, bytes: Vec<u8>| {
            given.borrow_mut().insert(handle, Arc::from(bytes));
        };
        // A release is the plugin's word that it names the handle no more, so it holds also when the tree is
        // refused: the plugin forgot the handle either way.
        let mut release = |handle| {
            self.release_image(ImageKey::Content(handle));
            if given.borrow_mut().remove(&handle).is_some() {
                return;
            }
            let mut state = self.state.borrow_mut();
            state.dropped.remove(&handle);
            if let Some(bytes) = state.content.remove(&handle) {
                drop(state);
                self.release_content(&HashMap::from([(handle, bytes)]));
            }
        };
        let kept = |key: &str| self.state.borrow().tree.held_under(key);
        let viewing = Viewing {
            mount: &self.id,
            owner: &owner,
            input: &input,
            memo: &mut memo,
            give: &mut give,
            release: &mut release,
            kept: &kept,
            held: 0,
            laid: self.laid.get().then(|| self.root.rect().height as u16),
        };
        let viewed = self.viewer.view(host, viewing);
        *self.viewed.borrow_mut() = input;
        let Some(viewed) = viewed else {
            self.state.borrow_mut().memo = memo;
            return None;
        };
        let staged = Staged { given: given.take() };
        Some(Called { node: viewed.node, staged, memo, remote: viewed.memo })
    }

    /// Adopts `nodes`, with the content `staged` gives, or refuses them and changes nothing.
    fn adopt(
        &self,
        host: &dyn Host,
        theme: &Theme,
        mut nodes: Vec<Node>,
        staged: &Staged,
        full: bool,
    ) -> Result<(), Refused> {
        ADOPTED.set(ADOPTED.get() + 1);
        // A slot's root takes its node's layout, and the node fills the root (`node::Mount` does the same). The tree
        // is kept as it came, so a later adoption of it takes the same.
        let mut taken = None;
        if !self.fills
            && let Some(
                Node::Box { layout, .. }
                | Node::Text { layout, .. }
                | Node::Scroll { layout, .. }
                | Node::Canvas { layout, .. },
            ) = nodes.first_mut()
            && crate::reconcile::sizes_ok(layout)
        {
            taken = Some(crate::node::take_layout(layout));
        }
        // A focus in the mount that the new tree takes away (a node gone, or built again) comes back after it.
        let focused =
            self.holder().map(|owner| owner.focused()).filter(|focused| focused.surface || focused.node.is_some());
        let mut state = self.state.borrow_mut();
        // Content past what the plugin may hold is not kept: a node that shows it is a placeholder (4.2).
        let (admitted, over) = admit_content(&self.plugin, staged);
        let State { tree, content, last, dropped, .. } = &mut *state;
        let restyled = !tree.styled_in(theme);
        let unheld: HashSet<ContentRef> = dropped.union(&over).copied().collect();
        let mut result = Ok(());
        (self.host_time)(&mut || {
            result = self.reconciling(host, theme, tree, content, staged, &unheld, full, |env, tree| {
                tree.apply(env, &self.root, &nodes)
            });
        });
        if let Err(refused) = result {
            drop(state);
            // A refused view's content is not the mount's: neither are the pictures it started.
            staged.given.keys().for_each(|handle| self.release_image(ImageKey::Content(*handle)));
            return Err(refused);
        }
        if let Some(owner) = self.holder() {
            owner.set_tree(tree.ids().map(str::to_owned).collect(), tree.focusable());
        }
        self.reindex();
        behave::arm(host.app());
        if !self.fills {
            if let Some(taken) = taken {
                if self.layout.get() != Some(taken) {
                    crate::node::root_layout(&self.root, &taken);
                    self.layout.set(Some(taken));
                }
                if let Some(
                    Node::Box { layout, .. }
                    | Node::Text { layout, .. }
                    | Node::Scroll { layout, .. }
                    | Node::Canvas { layout, .. },
                ) = nodes.first_mut()
                {
                    *layout = taken;
                }
            }
            // A hidden root box shows nothing in the slot, not even the gap the slot's parent puts before it.
            self.root.visible(!tree.is_empty() && !tree.nodes.first().is_some_and(|root| root.node.is_hidden()));
        }
        *last = Some(tree.admitted(nodes));
        for (handle, bytes) in &staged.given {
            if over.contains(handle) {
                dropped.insert(*handle);
                continue;
            }
            book(&self.plugin, |ledger| {
                ledger.content += 1;
                ledger.content_bytes += bytes.len() as i64;
            });
            content.insert(*handle, bytes.clone());
        }
        limits::recharge(&self.plugin, limits::Kind::Content, 0, admitted);
        self.measures.retain(|handle| content.contains_key(handle));
        let slots_changed = tree.slots_changed();
        drop(state);
        self.repaint(restyled);
        if let (Some(owner), Some(focused)) = (self.holder(), focused) {
            owner.restore_focus(host, focused.node.as_deref());
        }
        let live = self.live.borrow().clone();
        if let (true, Some(live)) = (slots_changed, live) {
            crate::settle(host, &live);
        }
        host.app().request_redraw();
        Ok(())
    }

    /// One call of the surface's draw for canvas `id` at `frame` ([`canvas::Draw`]).
    fn draw_canvas(&self, id: &str, frame: v2::Frame) -> Option<Option<Vec<u8>>> {
        self.viewer.draw(&*self.owner.upgrade()?, &self.holder()?, &self.id, id, frame)
    }

    /// Calls `f` with what a reconcile of `tree` builds with: the content the mount holds and the view staged, and the
    /// content it was given and could not hold (`unheld`).
    #[allow(clippy::too_many_arguments)]
    fn reconciling<R>(
        &self,
        host: &dyn Host,
        theme: &Theme,
        tree: &mut Tree,
        content: &HashMap<ContentRef, Arc<[u8]>>,
        staged: &Staged,
        unheld: &HashSet<ContentRef>,
        full: bool,
        f: impl FnOnce(&Env<'_>, &mut Tree) -> R,
    ) -> R {
        let owner = self.owner.clone();
        let act: Act = Rc::new(move |action| crate::node::act(&owner, action));
        let slot = |parent: &View, path: &str| {
            if self.path.is_empty() || !slot::PATHS.contains(&path) || !slot::contains(&self.path, path) {
                log::warn!("surface {} cannot show slot {path}: it is not a slot inside its own", self.id.surface);
                return None;
            }
            let mounted = host.slot(parent, path, &self.slot_input)?;
            if let Some(live) = mounted.live() {
                *self.live.borrow_mut() = Some(live.clone());
            }
            Some(mounted)
        };
        let held = |handle: &ContentRef| content.get(handle).or_else(|| staged.given.get(handle));
        let source = |source: &Source| match source {
            Source::Text(text) => Some(Rc::from(text.as_str())),
            Source::Content(handle) => held(handle).map(|bytes| Rc::from(String::from_utf8_lossy(bytes).as_ref())),
            Source::PartOutput(part) => part_output(host, part).map(|text| Rc::from(text.as_str())),
        };
        let measure = |source: &Source| match source {
            Source::Content(handle) => held(handle).map(|bytes| self.measures.of(*handle, bytes)).unwrap_or_default(),
            Source::Text(text) => crate::reconcile::measure(text),
            Source::PartOutput(part) => {
                part_output(host, part).map(|text| crate::reconcile::measure(&text)).unwrap_or_default()
            }
        };
        // An image is admitted and decoded once a source: nodes that show the same content share it.
        let image = |source: &Source| {
            let Some(key) = ImageKey::of(source) else { return Picture::Pending };
            if let Some((picture, _)) = self.images.borrow().get(&key) {
                return picture.clone();
            }
            let bytes: Arc<[u8]> = match source {
                Source::Content(handle) => match held(handle) {
                    Some(bytes) => bytes.clone(),
                    None => return Picture::Pending,
                },
                Source::Text(text) => Arc::from(text.as_bytes()),
                Source::PartOutput(_) => return Picture::Pending,
            };
            self.admit_image(host.app(), key, bytes)
        };
        let has = |handle: ContentRef| held(&handle).is_some() || unheld.contains(&handle);
        let dropped = |handle: ContentRef| unheld.contains(&handle);
        let owner = self.holder().map(|owner| Rc::downgrade(&owner));
        let env = Env {
            host,
            theme,
            act: &act,
            slot: &slot,
            source: &source,
            measure: &measure,
            content: &has,
            dropped: &dropped,
            image: &image,
            full,
            draw: self.drawer.get(),
            owner: owner.as_ref(),
            plugin: Some(&self.plugin),
            item: false,
        };
        f(&env, tree)
    }

    /// Admits the image of `bytes` under `key` by its header: within the bytes and the width and height of one image,
    /// and the decoded bytes the plugin and all plugins may hold, which its job reserves. An admitted image decodes on
    /// a worker; bytes that are no image show nothing, as before.
    fn admit_image(&self, app: &App, key: ImageKey, bytes: Arc<[u8]>) -> Picture {
        let Some((width, height)) = crate::image::size(&bytes) else {
            log::warn!("an image node's bytes are not a PNG, GIF, JPEG or WebP image");
            self.images.borrow_mut().insert(key, (Picture::Pending, Charge::Held(0)));
            return Picture::Pending;
        };
        let limits = limits::get();
        let decoded = (u64::from(width) * u64::from(height)).saturating_mul(4);
        let admitted = bytes.len() as u64 <= limits.image_bytes
            && u64::from(width.max(height)) <= limits.image_side
            && limits::charge(&self.plugin, limits::Kind::Images, decoded);
        if !admitted {
            log::warn!(
                "an image node of {width}x{height} pixels in {} bytes is past what the host decodes",
                bytes.len()
            );
            self.images.borrow_mut().insert(key, (Picture::Over, Charge::Held(0)));
            return Picture::Over;
        }
        let job = JOB.with(|job| job.replace(job.get() + 1));
        self.images.borrow_mut().insert(key, (Picture::Pending, Charge::Job(job)));
        crate::reconcile::count_decoded();
        let mut reserved = crate::image::Reservation::new(self.plugin.clone(), decoded);
        let plugin = self.plugin.to_string();
        let decoding = app.runtime().spawn_blocking(move || {
            crate::image::wait_held(&plugin);
            crate::image::decode(&bytes)
        });
        let weak = self.weak();
        app.spawn(async move { decoding.await.ok().flatten() }, move |cx, pixels| {
            if let Some(mounted) = weak.upgrade() {
                mounted.decoded(cx.app(), key, job, pixels, &mut reserved);
            }
        });
        Picture::Pending
    }

    /// Job `job` decoded the image of `key`: the host copies its pixels into the app's context, as host time, shows it
    /// in every image node of the source, and holds what the job reserved. One the mount released meanwhile, or that
    /// did not decode, is dropped, and the job gives back what it reserved.
    fn decoded(
        &self,
        app: &App,
        key: ImageKey,
        job: u64,
        pixels: Option<crate::image::Pixels>,
        reserved: &mut crate::image::Reservation,
    ) {
        if self.images.borrow().get(&key).is_none_or(|(_, charge)| *charge != Charge::Job(job)) {
            return;
        }
        let mut image = None;
        (self.host_time)(&mut || {
            image = pixels.as_ref().and_then(|pixels| {
                let context = app.session().context();
                opentui::native::Image::from_rgba(context, pixels.width, pixels.height, &pixels.rgba)
                    .map_err(|error| log::warn!("an image node does not decode: {error}"))
                    .ok()
            });
        });
        let Some(image) = image else {
            log::warn!("an image node's bytes do not decode");
            self.images.borrow_mut().insert(key, (Picture::Pending, Charge::Held(0)));
            return;
        };
        self.images.borrow_mut().insert(key, (Picture::Ready(image.clone()), Charge::Held(reserved.take())));
        self.state.borrow().tree.each_image(&mut |source, view| {
            if ImageKey::of(source) == Some(key) {
                view.image(Some(image.clone()));
            }
        });
        app.request_redraw();
    }

    /// After a solve: the windows of the tree's lists. Whether one changed.
    pub(crate) fn windows(&self) -> bool {
        let Some(host) = self.owner.upgrade() else { return false };
        let theme = host.theme();
        let mut state = self.state.borrow_mut();
        let State { tree, content, dropped, .. } = &mut *state;
        if !tree.has_lists() {
            return false;
        }
        let mut changed = false;
        (self.host_time)(&mut || {
            changed = self.reconciling(
                host.as_ref(),
                &theme,
                tree,
                content,
                &Staged::default(),
                dropped,
                false,
                |env, tree| tree.resolve_lists(env),
            );
        });
        if changed {
            host.app().request_redraw();
        }
        changed
    }

    /// Calls the view again, as `layout` asked.
    pub(crate) fn draw_again(&self) {
        if let Some(host) = self.owner.upgrade() {
            self.draw(host.as_ref(), &abi::Changed { woken: true, ..abi::Changed::default() });
        }
    }

    /// What stands for the mount while it lives: what its route's commands and its scroll handler ask for ends with it.
    pub(crate) fn alive(&self) -> Weak<()> {
        Rc::downgrade(&self.alive)
    }

    /// Whether a solve has laid its root out.
    pub(crate) fn laid(&self) -> bool {
        self.laid.get()
    }

    /// The mount, weakly.
    pub(crate) fn weak(&self) -> Weak<Surface> {
        self.this.borrow().clone()
    }

    pub(crate) fn app(&self) -> &App {
        &self.app
    }

    /// The page theme.
    pub(crate) fn theme(&self) -> Option<Theme> {
        self.owner.upgrade().map(|host| host.theme())
    }

    /// The palette of `theme`, kept while the theme stays.
    fn palette_of(&self, host: &dyn Host, theme: &Theme) -> v2::Palette {
        let mut state = self.state.borrow_mut();
        if let Some((cached, palette)) = &state.palette
            && cached == theme
        {
            return palette.clone();
        }
        let colors: BTreeMap<String, abi::Rgba> = theme
            .list()
            .into_iter()
            .map(|(token, color)| (token, abi::Rgba::new(color.r, color.g, color.b, color.a)))
            .collect();
        let palette = v2::Palette { mode: abi_mode(host.theme_mode()).into(), colors };
        state.palette = Some((theme.clone(), palette.clone()));
        palette
    }
}

impl Drop for Surface {
    fn drop(&mut self) {
        // The plugin hears the mount end; a failed or disabled one's calls are refused and hear nothing.
        if let Some(host) = self.owner.upgrade() {
            self.tell_mount(&*host, false);
            self.viewer.forget(&*host, &self.id);
        }
        behave::detach(&self.app, self);
        if let Some(owner) = self.holder.get_mut().take() {
            owner.end();
        }
        self.release_images();
        let state = self.state.get_mut();
        let (content, memo) = (std::mem::take(&mut state.content), state.booked);
        self.release_content(&content);
        book(&self.plugin, |ledger| {
            ledger.mounts -= 1;
            ledger.memo_entries -= memo;
        });
    }
}

impl Claimed for Rc<Surface> {
    fn root(&self) -> View {
        self.root.clone()
    }

    fn sync(&self, host: &dyn Host, changed: &abi::Changed) {
        self.draw(host, changed);
        self.state.borrow().tree.each_slot(&mut |slots| slots.sync(host, Some(changed)));
    }

    fn restyle(&self, host: &dyn Host) -> bool {
        Surface::restyle(self, host);
        // The slots it shows keep their claims; they take the theme as their own.
        let mut done = true;
        self.state.borrow().tree.each_slot(&mut |slots| done &= slots.restyle(host));
        done
    }
}

impl crate::activation::Drawn for Surface {
    fn woken(&self, host: &dyn Host) {
        // A mount whose first view is still to come (a route's runs after the turn) sees the plugin's state then.
        if self.state.borrow().last.is_none() {
            return;
        }
        self.draw(host, &abi::Changed { woken: true, ..abi::Changed::default() });
    }
}

/// The host of the mount `weak` names.
fn mounted_owner(weak: &Weak<Surface>) -> Option<Rc<dyn Host>> {
    weak.upgrade()?.owner.upgrade()
}

/// The text tool call `part` returned, as the transcript shows it: its content items, a file by its name; nothing
/// while it streams its input or runs, and `None` while the host has not loaded it.
pub(crate) fn part_output(host: &dyn Host, part: &v2::PartRef) -> Option<String> {
    use opencode_plugin_abi::types::{SessionMessageAssistantContentItem, SessionMessageInfo, ToolContent};
    let mut found = None;
    host.read(&mut |read| {
        read.messages(&part.session, &mut |messages| {
            let tool = messages.iter().rev().find_map(|message| match message {
                SessionMessageInfo::Assistant(assistant) => assistant.content.iter().find_map(|item| match item {
                    SessionMessageAssistantContentItem::Tool(tool) if tool.id == part.part => Some(tool),
                    _ => None,
                }),
                _ => None,
            });
            found = tool.map(|tool| {
                opencode_ui::tool_info::tool_display_content(&tool.state)
                    .iter()
                    .filter_map(|content| match content {
                        ToolContent::Text(text) => Some(text.text.clone()),
                        ToolContent::File(file) => {
                            Some(file.name.clone().flatten().unwrap_or_else(|| file.uri.clone()))
                        }
                        ToolContent::Unknown(_) => None,
                    })
                    .collect::<Vec<_>>()
                    .join("\n")
            });
        });
    });
    found
}

/// The image `bytes` decode to in the frame, for a 1.x claim's part, which has no plugin in the host to charge: within
/// one image's limits (4.2), else the placeholder; bytes that are no image, or do not decode, show nothing.
pub(crate) fn decode(app: &App, bytes: &[u8]) -> Picture {
    let Some((width, height)) = crate::image::size(bytes) else {
        log::warn!("an image node's bytes are not a PNG, GIF, JPEG or WebP image");
        return Picture::Pending;
    };
    let limits = limits::get();
    if bytes.len() as u64 > limits.image_bytes || u64::from(width.max(height)) > limits.image_side {
        log::warn!("an image node of {width}x{height} pixels in {} bytes is past what the host decodes", bytes.len());
        return Picture::Over;
    }
    crate::reconcile::count_decoded();
    opentui::native::Image::decode(app.session().context(), bytes)
        .map_or_else(|error| (log::warn!("an image node does not decode: {error}"), Picture::Pending).1, Picture::Ready)
}

/// Which content of `staged` plugin `plugin` may hold beside what it holds, in the order the view gave it: the bytes
/// admitted, and the handles past its share or the total (4.2), which the host does not keep.
fn admit_content(plugin: &str, staged: &Staged) -> (u64, HashSet<ContentRef>) {
    let mut room = limits::room(plugin, limits::Kind::Content, 0);
    let mut given: Vec<(&ContentRef, &Arc<[u8]>)> = staged.given.iter().collect();
    given.sort_by_key(|(handle, _)| handle.0);
    let (mut admitted, mut over) = (0, HashSet::new());
    for (handle, bytes) in given {
        let size = bytes.len() as u64;
        match room.checked_sub(size) {
            Some(left) => (room, admitted) = (left, admitted + size),
            None => drop(over.insert(*handle)),
        }
    }
    (admitted, over)
}
