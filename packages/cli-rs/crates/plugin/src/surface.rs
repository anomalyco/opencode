//! A mount of a contract 2.0 surface ([`v2::Surface`], synthesis 4.2): one showing of a plugin's route or slot claim,
//! with a generation that is new every time. What it holds is its own and goes with it: the reconciled widgets, the
//! SDK's [`v2::Memo`] table, and the content handles the view gave the host. A view whose tree the host refuses
//! changes nothing; the host asks at once for a whole tree, and a second refusal in a row fails the plugin.
//!
//! A theme change restyles the widgets in place with no call, unless the surface reads the palette.

use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, HashMap};
use std::rc::{Rc, Weak};
use std::sync::atomic::{AtomicU64, Ordering};

use opencode_plugin_abi::v2::{self, ContentRef, Node, Source};
use opencode_plugin_abi::{self as abi};
use opencode_ui::theme::Theme;
use opentui::keymap::Disposer;
use opentui::prelude::*;

use crate::canvas;
use crate::node::{Act, abi_mode};
use crate::reconcile::{Env, Refused, Tree};
use crate::{Claimed, Host, SlotInput, behave, slot};

/// Runs a view or a canvas draw as one call of the plugin, named for its report: `false` when it panicked, which
/// fails the plugin.
pub(crate) type Call = Rc<dyn Fn(&'static str, &dyn Host, &mut dyn FnMut(&dyn abi::Read)) -> bool>;
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
    pub input: &'a v2::SurfaceInput,
    pub memo: &'a mut v2::Memo,
    pub give: &'a mut dyn FnMut(ContentRef, Vec<u8>),
    pub release: &'a mut dyn FnMut(ContentRef),
}

/// What a view returned.
pub(crate) struct Viewed {
    pub node: Node,
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
        let Viewing { mount, input, memo, give, release } = viewing;
        let mut node = None;
        let called = (self.call)("view", host, &mut |read| {
            let mut content = |bytes: Vec<u8>| {
                let handle = ContentRef(CONTENT.fetch_add(1, Ordering::Relaxed));
                give(handle, bytes);
                handle
            };
            node = Some((self.view)(&mut v2::View::new(read, input, mount, memo, &mut content, release)));
        });
        called.then_some(())?;
        Some(Viewed { node: node?, memo: None })
    }

    fn draws(&self) -> bool {
        self.draw.is_some()
    }

    fn draw(&self, host: &dyn Host, mount: &v2::MountId, canvas: &str, frame: v2::Frame) -> Option<Option<Vec<u8>>> {
        let draw = self.draw.as_ref()?;
        let (mut ran, mut list) = (false, None);
        // A call that panicked set no list; one that was refused did not run.
        (self.call)("draw", host, &mut |read| {
            ran = true;
            list = draw(&mut v2::Draw { read, mount, canvas, frame });
        });
        ran.then(|| list.map(abi::canvas::List::into_bytes))
    }
}

/// What the mounts of 2.0 surfaces hold now, counted per thread outside any mount.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Ledger {
    pub mounts: i64,
    pub content: i64,
    pub content_bytes: i64,
    pub memo_entries: i64,
}

thread_local! {
    static LEDGER: Cell<Ledger> = Cell::new(Ledger::default());
}

/// What the mounts hold on this thread now.
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
    /// Each content handle's image, decoded once however many nodes show it; `None` when it does not decode.
    images: RefCell<HashMap<ContentRef, Option<opentui::native::Image>>>,
}

/// What one call of the view returned and asked for; the host takes it only with its tree.
struct Called {
    nodes: Vec<Node>,
    staged: Staged,
    memo: v2::Memo,
    /// The values a library's own table holds after the call; `None` when the table is `memo`.
    remote: Option<usize>,
}

/// The content a view gave, which goes with its tree when the host refuses it.
#[derive(Default)]
struct Staged {
    given: HashMap<ContentRef, Rc<[u8]>>,
}

#[derive(Default)]
pub(crate) struct State {
    pub(crate) tree: Tree,
    memo: v2::Memo,
    /// The memo values the ledger counts for the mount, in the host's table or the library's.
    booked: i64,
    /// The content the accepted views gave and did not release.
    content: HashMap<ContentRef, Rc<[u8]>>,
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
    ) -> Rc<Self> {
        static GENERATION: AtomicU64 = AtomicU64::new(1);
        let id = v2::MountId {
            surface: surface.name.clone(),
            key: key.to_owned(),
            generation: GENERATION.fetch_add(1, Ordering::Relaxed),
        };
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
            revision: Cell::new(None),
            images: RefCell::default(),
        });
        book(|ledger| ledger.mounts += 1);
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
        let weak = Rc::downgrade(&mounted);
        // The host's own state and the terminal's size change outside change batches. A view that ran after the last
        // change of the host's state has seen it: a notice of it, which comes later, calls no view (review bigboi-7).
        let watch = host.watch(Rc::new(move |changed: &abi::Changed| {
            if let (Some(mounted), Some(host)) = (weak.upgrade(), owner.upgrade()) {
                let seen = host.local_revision().is_some_and(|now| mounted.revision.get() == Some(now));
                if changed.size || !seen {
                    mounted.draw(host.as_ref());
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
            if (rect.width as u16, rect.height as u16) == mounted.seen.get() || mounted.resized.get() >= 2 {
                return;
            }
            mounted.resized.set(mounted.resized.get() + 1);
            let weak = Rc::downgrade(&mounted);
            app.defer(move |_| {
                if let (Some(mounted), Some(host)) = (weak.upgrade(), mounted_owner(&weak)) {
                    mounted.draw_sized(host.as_ref());
                }
            });
        });
        match fills {
            // A route's first view runs once the page it replaces is gone, whose keymap layers go in this turn's
            // deferred work, before the next frame: the view sees the keymap the route has (review bigboi-7).
            true => {
                let weak = Rc::downgrade(&mounted);
                host.app().defer(move |_| {
                    if let (Some(mounted), Some(host)) = (weak.upgrade(), mounted_owner(&weak)) {
                        mounted.draw(host.as_ref());
                    }
                });
            }
            false => mounted.draw(host),
        }
        mounted
    }

    /// Calls the view and adopts its tree, for a cause other than its size.
    pub fn draw(&self, host: &dyn Host) {
        self.resized.set(0);
        self.draw_sized(host);
    }

    /// Calls the view and adopts its tree; on a refusal, once more for a whole tree.
    fn draw_sized(&self, host: &dyn Host) {
        let theme = host.theme();
        for _ in 0..2 {
            let full = {
                let state = self.state.borrow();
                state.last.is_none() || state.refused
            };
            let Some(called) = self.call_view(host, &theme, full) else {
                self.wipe();
                return;
            };
            let (mut memo, remote) = (called.memo, called.remote);
            let result = self.adopt(host, &theme, called.nodes, &called.staged, full);
            let mut state = self.state.borrow_mut();
            match result {
                Ok(()) => {
                    if let Some(last) = &state.last {
                        memo.finish(last);
                    }
                    let size = remote.unwrap_or(memo.len()) as i64;
                    book(|ledger| ledger.memo_entries += size - state.booked);
                    (state.memo, state.booked, state.refused) = (memo, size, false);
                    return;
                }
                Err(refused) => {
                    // Nothing of the refused call stays: the content it gave is dropped, its releases with it, and
                    // the memo values go, as the next view builds whole (a library's own table too, as it is asked
                    // for a whole tree).
                    memo.clear();
                    book(|ledger| ledger.memo_entries -= state.booked);
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

    /// Drops all the mount holds but itself: its plugin failed, so it shows nothing more and the behaviors leave it.
    fn wipe(&self) {
        behave::detach(&self.app, self);
        *self.behave.borrow_mut() = behave::State::default();
        self.images.borrow_mut().clear();
        let mut state = self.state.borrow_mut();
        state.tree.clear(&self.root);
        state.last = None;
        let (content, memo) = (std::mem::take(&mut state.content), std::mem::take(&mut state.booked));
        state.memo.clear();
        book(|ledger| {
            ledger.content -= content.len() as i64;
            ledger.content_bytes -= content.values().map(|bytes| bytes.len() as i64).sum::<i64>();
            ledger.memo_entries -= memo;
        });
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
            _ => self.draw(host),
        }
    }

    /// What the view returned and asked for; `None` when the call failed.
    fn call_view(&self, host: &dyn Host, theme: &Theme, full: bool) -> Option<Called> {
        // Only a surface that says it reads the palette gets it, on either carrier.
        let palette = if self.palette { self.palette_of(host, theme) } else { v2::Palette::default() };
        let rect = self.root.rect();
        // Before its first frame a surface has no size of its own; the terminal's stands in, which is a route's: a
        // plugin route shows no tabs and fills the page.
        let (width, height) = match (rect.width as u16, rect.height as u16) {
            (0, _) | (_, 0) => host.app().size(),
            size => size,
        };
        self.revision.set(host.local_revision());
        self.seen.set((width, height));
        let input = v2::SurfaceInput { width, height, palette, full };
        // The view works on the mount's table; what it stages there the host keeps only with its tree.
        let mut memo = std::mem::take(&mut self.state.borrow_mut().memo);
        let given = RefCell::new(HashMap::new());
        let mut give = |handle, bytes: Vec<u8>| {
            given.borrow_mut().insert(handle, Rc::from(bytes));
        };
        // A release is the plugin's word that it names the handle no more, so it holds also when the tree is
        // refused: the plugin forgot the handle either way.
        let mut release = |handle| {
            self.images.borrow_mut().remove(&handle);
            if given.borrow_mut().remove(&handle).is_none()
                && let Some(bytes) = self.state.borrow_mut().content.remove(&handle)
            {
                book(|ledger| {
                    ledger.content -= 1;
                    ledger.content_bytes -= bytes.len() as i64;
                });
            }
        };
        let viewing =
            Viewing { mount: &self.id, input: &input, memo: &mut memo, give: &mut give, release: &mut release };
        let viewed = self.viewer.view(host, viewing);
        let Some(viewed) = viewed else {
            self.state.borrow_mut().memo = memo;
            return None;
        };
        let staged = Staged { given: given.take() };
        Some(Called { nodes: vec![viewed.node], staged, memo, remote: viewed.memo })
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
        let mut state = self.state.borrow_mut();
        let State { tree, content, last, .. } = &mut *state;
        let restyled = !tree.styled_in(theme);
        self.reconciling(host, theme, tree, content, staged, full, |env, tree| tree.apply(env, &self.root, &nodes))?;
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
            self.root.visible(!tree.is_empty());
        }
        *last = Some(nodes);
        for (handle, bytes) in &staged.given {
            book(|ledger| {
                ledger.content += 1;
                ledger.content_bytes += bytes.len() as i64;
            });
            content.insert(*handle, bytes.clone());
        }
        let slots_changed = tree.slots_changed();
        drop(state);
        self.repaint(restyled);
        let live = self.live.borrow().clone();
        if let (true, Some(live)) = (slots_changed, live) {
            crate::settle(host, &live);
        }
        host.app().request_redraw();
        Ok(())
    }

    /// One call of the surface's draw for canvas `id` at `frame` ([`canvas::Draw`]).
    fn draw_canvas(&self, id: &str, frame: v2::Frame) -> Option<Option<Vec<u8>>> {
        self.viewer.draw(&*self.owner.upgrade()?, &self.id, id, frame)
    }

    /// Calls `f` with what a reconcile of `tree` builds with: the content the mount holds and the view staged.
    #[allow(clippy::too_many_arguments)]
    fn reconciling<R>(
        &self,
        host: &dyn Host,
        theme: &Theme,
        tree: &mut Tree,
        content: &HashMap<ContentRef, Rc<[u8]>>,
        staged: &Staged,
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
        // An image decodes once a handle: nodes that show the same content share it.
        let image = |source: &Source| match source {
            Source::Content(handle) => {
                if let Some(image) = self.images.borrow().get(handle) {
                    return image.clone();
                }
                let image = decode(host.app(), held(handle)?);
                self.images.borrow_mut().insert(*handle, image.clone());
                image
            }
            Source::Text(text) => decode(host.app(), text.as_bytes()),
            Source::PartOutput(_) => None,
        };
        let has = |handle: ContentRef| held(&handle).is_some();
        let env = Env {
            host,
            theme,
            act: &act,
            slot: &slot,
            source: &source,
            content: &has,
            image: &image,
            full,
            draw: self.drawer.get(),
        };
        f(&env, tree)
    }

    /// After a solve: the windows of the tree's lists. Whether one changed.
    pub(crate) fn windows(&self) -> bool {
        let Some(host) = self.owner.upgrade() else { return false };
        let theme = host.theme();
        let mut state = self.state.borrow_mut();
        let State { tree, content, .. } = &mut *state;
        if !tree.has_lists() {
            return false;
        }
        let changed = self.reconciling(host.as_ref(), &theme, tree, content, &Staged::default(), false, |env, tree| {
            tree.resolve_lists(env)
        });
        if changed {
            host.app().request_redraw();
        }
        changed
    }

    /// Calls the view again, as `layout` asked.
    pub(crate) fn draw_again(&self) {
        if let Some(host) = self.owner.upgrade() {
            self.draw(host.as_ref());
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
        if let Some(host) = self.owner.upgrade() {
            self.viewer.forget(&*host, &self.id);
        }
        behave::detach(&self.app, self);
        let state = self.state.get_mut();
        let bytes: usize = state.content.values().map(|bytes| bytes.len()).sum();
        let (content, memo) = (state.content.len() as i64, state.booked);
        book(|ledger| {
            ledger.mounts -= 1;
            ledger.content -= content;
            ledger.content_bytes -= bytes as i64;
            ledger.memo_entries -= memo;
        });
    }
}

impl Claimed for Rc<Surface> {
    fn root(&self) -> View {
        self.root.clone()
    }

    fn sync(&self, host: &dyn Host, changed: &abi::Changed) {
        self.draw(host);
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
        self.draw(host);
    }
}

/// The host of the mount `weak` names.
fn mounted_owner(weak: &Weak<Surface>) -> Option<Rc<dyn Host>> {
    weak.upgrade()?.owner.upgrade()
}

/// The text tool call `part` returned, as the transcript shows it: its content items, a file by its name; nothing
/// while it streams its input or runs, and `None` while the host has not loaded it.
fn part_output(host: &dyn Host, part: &v2::PartRef) -> Option<String> {
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

/// The bytes of an image the host decodes, at most: a header that names more pixels, or more bytes, show nothing
/// (decoding runs on the UI thread until a worker does it, phase Pl).
const IMAGE_BYTES: usize = 16 << 20;
const IMAGE_PIXELS: u64 = 4096 * 4096;

/// The image `bytes` decode to, when their header names a PNG, GIF, JPEG or WebP image within the host's bounds.
fn decode(app: &App, bytes: &[u8]) -> Option<opentui::native::Image> {
    let Some((width, height)) = image_size(bytes) else {
        log::warn!("an image node's bytes are not a PNG, GIF, JPEG or WebP image");
        return None;
    };
    if bytes.len() > IMAGE_BYTES || u64::from(width) * u64::from(height) > IMAGE_PIXELS {
        log::warn!("an image node of {width}x{height} pixels in {} bytes is past what the host decodes", bytes.len());
        return None;
    }
    crate::reconcile::count_decoded();
    opentui::native::Image::decode(app.session().context(), bytes)
        .map_err(|error| log::warn!("an image node does not decode: {error}"))
        .ok()
}

/// The width and height the header of a PNG, GIF, JPEG or WebP image names.
fn image_size(bytes: &[u8]) -> Option<(u32, u32)> {
    let at = |from: usize, len: usize| bytes.get(from..from + len);
    let be = |from: usize, len: usize| Some(at(from, len)?.iter().fold(0u32, |n, byte| n << 8 | u32::from(*byte)));
    let le =
        |from: usize, len: usize| Some(at(from, len)?.iter().rev().fold(0u32, |n, byte| n << 8 | u32::from(*byte)));
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some((be(16, 4)?, be(20, 4)?));
    }
    if bytes.starts_with(b"GIF8") {
        return Some((le(6, 2)?, le(8, 2)?));
    }
    if bytes.starts_with(b"RIFF") && at(8, 4) == Some(b"WEBP") {
        return match at(12, 4)? {
            b"VP8 " => Some((le(26, 2)? & 0x3fff, le(28, 2)? & 0x3fff)),
            b"VP8L" => {
                let bits = le(21, 4)?;
                Some(((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1))
            }
            b"VP8X" => Some((le(24, 3)? + 1, le(27, 3)? + 1)),
            _ => None,
        };
    }
    if !bytes.starts_with(&[0xff, 0xd8]) {
        return None;
    }
    // JPEG: the segments up to the first start of frame, which holds the size.
    let mut from = 2;
    loop {
        if *bytes.get(from)? != 0xff {
            return None;
        }
        let marker = *bytes.get(from + 1)?;
        if (0xc0..=0xcf).contains(&marker) && ![0xc4, 0xc8, 0xcc].contains(&marker) {
            return Some((be(from + 7, 2)?, be(from + 5, 2)?));
        }
        from += 2 + be(from + 2, 2)? as usize;
    }
}
