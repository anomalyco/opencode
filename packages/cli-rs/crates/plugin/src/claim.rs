//! The host's side of renderer claims ([`abi::claim`], synthesis 4.11, phase Pr): each part a claim draws is a
//! [`Mount`] of its own, with a generation, a reconciled tree ([`Tree`]), and the content and memo values its views
//! gave. The owner of the part (a tool row, or Markdown for a fence) asks [`Mount::show`] with each revision of the
//! part, and draws its own row whenever that says no.
//!
//! The claim shows a part only while its view accepts it. The host's own row comes back:
//!
//! - for a revision the view declines (returns `None`);
//! - once a view of it took longer than the overrun limit, or returned a tree the host refused twice in a row (once,
//!   then once more as a whole tree): a tool call for the rest of its mount, a fence for that revision of its code, as
//!   Markdown keeps no handle to a fence it shows as code;
//! - for every part of the plugin, once a view panicked: the plugin fails, and the host mounts the route again
//!   without its claims, as it does when the user disables or reloads it.
//!
//! A revision that changes the part's phase ([`abi::claim::Phase`]) is viewed at once, so the owner knows which row
//! shows it. One that only streams new content is viewed at once too, unless this part had a view in this frame
//! already: then the newest content waits for the next paint, and the last accepted tree stays until then. So a part
//! gets at most one view a frame while it streams.
//!
//! A theme change restyles a tool call's tree in place with no call, unless the claim reads the palette. Markdown
//! builds a claimed fence again in the new theme, so a fence is a new mount and gets a view.

use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::rc::{Rc, Weak};
use std::sync::atomic::{AtomicU64, Ordering};

pub use opencode_plugin_abi::claim::{FencePart, Part, State, ToolPart};
use opencode_plugin_abi::v2::{self, ContentRef, Node, Source};
use opencode_plugin_abi::{self as abi};
use opencode_ui::theme::Theme;
use opentui::prelude::*;

use crate::Host;
use crate::node::{Act, abi_mode};
use crate::reconcile::{Env, Tree};
use crate::surface::{self, Viewing};

/// Runs a claim's view in process as one call of its plugin.
pub(crate) type Call = Rc<dyn Fn(&dyn Host, &mut dyn FnMut(&dyn abi::Read)) -> Called>;

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
        let called = (self.call)(host, &mut |read| {
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

/// Every claimed part mounted on this thread, oldest first.
pub fn mounted() -> Vec<Shown> {
    LIVE.with(|live| {
        let mut live = live.borrow_mut();
        live.retain(|core| core.strong_count() > 0);
        live.iter()
            .filter_map(Weak::upgrade)
            .map(|core| Shown { id: core.id.clone(), rect: core.root.rect(), shows: core.shows.get() })
            .collect()
    })
}

/// One claim of an active plugin, which its parts share.
pub(crate) struct Registered {
    entry: abi::claim::Entry,
    owner: Weak<dyn Host>,
    /// What a claim's view holds of the input (P2): its plugin's activation's, as a claim has no handler of its own.
    input: Rc<crate::interact::Owner>,
    viewer: Rc<dyn Viewer>,
    /// The palette of the theme the last view saw.
    palette: RefCell<Option<(Theme, v2::Palette)>>,
}

impl Registered {
    pub(crate) fn new(
        entry: abi::claim::Entry,
        owner: Weak<dyn Host>,
        viewer: Rc<dyn Viewer>,
        input: Rc<crate::interact::Owner>,
    ) -> Rc<Self> {
        Rc::new(Self { entry, owner, viewer, input, palette: RefCell::default() })
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
        let (_, claim) = self.0.iter().rev().find(|(claimed, _)| claimed == name || claimed == canonical)?;
        Some(ToolClaim(claim.clone()))
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
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

    /// Takes the page theme in place: the last tree again in it, with no call, unless the claim reads the palette.
    pub fn restyle(&self) {
        self.0.restyle();
    }
}

struct Core {
    claim: Rc<Registered>,
    id: v2::MountId,
    root: View,
    state: RefCell<Held>,
    part: RefCell<Option<Part>>,
    /// The frame of the last view ([`App::frame_number`]).
    viewed: Cell<Option<u64>>,
    /// A view of the newest content waits for the next paint.
    waiting: Cell<bool>,
    /// The width the views get until the part is laid out, and the width the last one got.
    hint: u16,
    width: Cell<u16>,
    /// The part shows the host's row for the rest of its life.
    fallen: Cell<bool>,
    /// The last revision the host decided shows the claim's tree.
    shows: Cell<bool>,
}

#[derive(Default)]
struct Held {
    tree: Tree,
    memo: v2::Memo,
    /// The content the accepted views gave and did not release.
    content: HashMap<ContentRef, Rc<[u8]>>,
    /// The images content decoded to, a handle each, as a surface keeps them (P3).
    images: RefCell<HashMap<ContentRef, Option<opentui::native::Image>>>,
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
    given: HashMap<ContentRef, Rc<[u8]>>,
    memo: v2::Memo,
    /// The memo values the mount held before the call.
    held: i64,
}

impl Core {
    fn new(claim: Rc<Registered>, app: &App, key: &str, hint: u16) -> Rc<Self> {
        let root = View::new(app).column().shrink(0.0);
        let id =
            v2::MountId { surface: claim.name().to_owned(), key: key.to_owned(), generation: surface::generation() };
        let core = Rc::new(Self {
            claim,
            id,
            root,
            state: RefCell::default(),
            part: RefCell::default(),
            viewed: Cell::new(None),
            waiting: Cell::new(false),
            hint,
            width: Cell::new(0),
            fallen: Cell::new(false),
            shows: Cell::new(false),
        });
        book(|ledger| ledger.mounts += 1);
        LIVE.with(|live| live.borrow_mut().push(Rc::downgrade(&core)));
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
        if self.fallen.get() {
            return false;
        }
        let Some(host) = self.claim.owner.upgrade() else { return false };
        let previous = self.part.replace(Some(part.clone()));
        if previous.as_ref() == Some(&part) {
            return self.shows.get();
        }
        let streams = previous.is_some_and(|previous| previous.phase() == part.phase());
        if streams && self.shows.get() && self.viewed.get() == Some(host.app().frame_number()) {
            self.wait();
            return true;
        }
        self.draw(&*host, false)
    }

    /// Views the newest revision at the next paint that is not this one's frame.
    fn wait(self: &Rc<Self>) {
        if self.waiting.replace(true) {
            return;
        }
        let Some(host) = self.claim.owner.upgrade() else { return };
        let weak = Rc::downgrade(self);
        // Animations run as a paint starts, before its layout: the view lands in that paint.
        host.app().animate(move |cx, _| {
            let Some(core) = weak.upgrade() else { return false };
            if core.viewed.get() == Some(cx.app().frame_number()) {
                return true;
            }
            core.waiting.set(false);
            if let (true, Some(host)) = (core.shows.get() && !core.fallen.get(), core.claim.owner.upgrade()) {
                core.draw(&*host, true);
            }
            false
        });
    }

    /// Calls the view on the part and adopts its tree; whether the claim shows the part. A view held back for the
    /// paint (`waiting`) leaves the last tree up when it cannot show the part: the owner decides at its next revision.
    fn draw(&self, host: &dyn Host, waited: bool) -> bool {
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
                return self.fall(waited);
            };
            let Some(node) = node else {
                // A declined revision: the host's row draws it, and an accepted one later builds whole.
                self.state.borrow_mut().memo = attempt.memo;
                if !waited {
                    self.wipe();
                    self.shows.set(false);
                }
                return self.shows.get();
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
                    memo.clear();
                    book(|ledger| ledger.memo_entries -= held);
                    let mut state = self.state.borrow_mut();
                    (state.memo, state.remote) = (memo, 0);
                    log::warn!("claim {} refused a tree for part {}: {refused}", self.id.surface, self.id.key);
                }
            }
        }
        self.fall(waited)
    }

    /// The part shows the host's row from now on; a view held back for the paint leaves the last tree up until then.
    fn fall(&self, waited: bool) -> bool {
        self.fallen.set(true);
        if !waited {
            self.wipe();
            self.shows.set(false);
        }
        false
    }

    /// Takes the theme without a call, unless the claim reads the palette.
    fn restyle(&self) {
        if !self.shows.get() || self.fallen.get() {
            return;
        }
        let Some(host) = self.claim.owner.upgrade() else { return };
        let last = self.state.borrow().last.clone();
        match last {
            Some(last) if !self.claim.entry.palette => {
                if let Err(refused) = self.adopt(&*host, &host.theme(), last, &HashMap::new(), false) {
                    log::error!("claim {}: its last tree again: {refused}", self.id.surface);
                }
            }
            _ => {
                self.draw(&*host, false);
            }
        }
    }

    fn call_view(&self, host: &dyn Host, theme: &Theme, full: bool) -> Attempt {
        let part = self.part.borrow().clone().expect("a part to view");
        let rect = self.root.rect();
        let width = if rect.width > 0.0 { rect.width as u16 } else { self.hint };
        self.width.set(width);
        // Only a claim that declares the palette gets it, as a surface (P4): it is most of a request's bytes.
        let palette = match self.claim.entry.palette {
            true => self.claim.palette(host, theme),
            false => v2::Palette::default(),
        };
        let input = v2::SurfaceInput { width, height: host.app().size().1, palette, full, panel: None };
        let (held, mut memo) = {
            let mut state = self.state.borrow_mut();
            (state.memo_entries(), std::mem::take(&mut state.memo))
        };
        book(|ledger| ledger.views += 1);
        let staged = RefCell::new(HashMap::new());
        let mut give = |handle, bytes: Vec<u8>| drop(staged.borrow_mut().insert(handle, Rc::from(bytes)));
        // A release holds also when the tree is refused: the plugin forgot the handle either way.
        let mut release = |handle| {
            if staged.borrow_mut().remove(&handle).is_none()
                && let Some(bytes) = self.state.borrow_mut().content.remove(&handle)
            {
                book(|ledger| {
                    ledger.content -= 1;
                    ledger.content_bytes -= bytes.len() as i64;
                });
            }
        };
        let viewing = Viewing {
            mount: &self.id,
            owner: &self.claim.input,
            input: &input,
            memo: &mut memo,
            give: &mut give,
            release: &mut release,
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
        given: &HashMap<ContentRef, Rc<[u8]>>,
        full: bool,
    ) -> Result<(), crate::reconcile::Refused> {
        let owner = self.claim.owner.clone();
        let act: Act = Rc::new(move |action| crate::node::act(&owner, action));
        let slot = |_: &View, path: &str| {
            log::warn!("claim {} cannot show slot {path}: a part has no slots", self.id.surface);
            None
        };
        let mut state = self.state.borrow_mut();
        let Held { tree, content, last, images, .. } = &mut *state;
        let bytes = |handle: &ContentRef| content.get(handle).or_else(|| given.get(handle));
        let source = |source: &Source| match source {
            Source::Text(text) => Some(Rc::from(text.as_str())),
            Source::Content(handle) => bytes(handle).map(|bytes| Rc::from(String::from_utf8_lossy(bytes).as_ref())),
            Source::PartOutput(part) => crate::surface::part_output(host, part).map(|text| Rc::from(text.as_str())),
        };
        // An image decodes once a handle, as in a surface (P3).
        let image = |source: &Source| match source {
            Source::Content(handle) => {
                if let Some(image) = images.borrow().get(handle) {
                    return image.clone();
                }
                let image = crate::surface::decode(host.app(), bytes(handle)?);
                images.borrow_mut().insert(*handle, image.clone());
                image
            }
            Source::Text(text) => crate::surface::decode(host.app(), text.as_bytes()),
            Source::PartOutput(_) => None,
        };
        let has = |handle: ContentRef| bytes(&handle).is_some();
        // A claim has no draw call (P5): a canvas in its tree draws nothing. It has no handler (P2): a box's pointer
        // and hover events reach none, and its clicks run through `act` (P1).
        let env = Env {
            host,
            theme,
            act: &act,
            slot: &slot,
            source: &source,
            content: &has,
            image: &image,
            full,
            draw: None,
            owner: None,
        };
        tree.apply(&env, &self.root, &nodes)?;
        *last = Some(nodes);
        for (handle, bytes) in given {
            book(|ledger| {
                ledger.content += 1;
                ledger.content_bytes += bytes.len() as i64;
            });
            content.insert(*handle, bytes.clone());
        }
        host.app().request_redraw();
        Ok(())
    }

    /// Drops the tree and what its views gave.
    fn wipe(&self) {
        let mut state = self.state.borrow_mut();
        state.tree.clear(&self.root);
        state.last = None;
        let (content, memo) = (std::mem::take(&mut state.content), state.memo_entries());
        state.memo.clear();
        state.remote = 0;
        book(|ledger| {
            ledger.content -= content.len() as i64;
            ledger.content_bytes -= content.values().map(|bytes| bytes.len() as i64).sum::<i64>();
            ledger.memo_entries -= memo;
        });
    }
}

impl Drop for Core {
    fn drop(&mut self) {
        if let Some(host) = self.claim.owner.upgrade() {
            self.claim.viewer.forget(&*host, &self.id);
        }
        let state = self.state.get_mut();
        let bytes: usize = state.content.values().map(|bytes| bytes.len()).sum();
        let (content, memo) = (state.content.len() as i64, state.memo_entries());
        book(|ledger| {
            ledger.mounts -= 1;
            ledger.content -= content;
            ledger.content_bytes -= bytes as i64;
            ledger.memo_entries -= memo;
        });
    }
}

/// The Markdown renderer of a fence claim. Each fence it shows is a mount, held by the widget it gives Markdown, so
/// the mount goes when Markdown drops the block's widget.
pub(crate) fn fence(claim: Rc<Registered>) -> crate::CodeBlockRender {
    let mounts: Rc<RefCell<HashMap<u32, Weak<Core>>>> = Rc::default();
    // Markdown keeps no handle to a fence that shows its code view, and may render one revision more than once: the
    // revisions that fell back, by their info and code, so each stays with the host. The next revision is claimed
    // afresh.
    let fallen: RefCell<std::collections::VecDeque<(String, String)>> = RefCell::default();
    Rc::new(move |block, _| {
        static KEYS: AtomicU64 = AtomicU64::new(1);
        if fallen.borrow().iter().any(|(info, code)| info == block.info && code == block.code) {
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
            let core = mounts.borrow().get(&previous.id())?.upgrade()?;
            Some((previous.clone(), core))
        });
        let (widget, core) = match held {
            Some(held) => held,
            None => {
                let key = format!("fence-{}", KEYS.fetch_add(1, Ordering::Relaxed));
                let core = Core::new(claim.clone(), block.app, &key, block.app.size().0);
                // The mount draws inside the widget Markdown holds, whose handler holds the mount: a handler of the
                // mount's own root would keep that root alive.
                let widget = View::new(block.app).column().shrink(0.0).child(&core.root);
                let (held, forget) = (core.clone(), Forget { mounts: Rc::downgrade(&mounts), id: widget.id() });
                widget.on_focus(move |_, _| {
                    let _ = (&held, &forget);
                });
                mounts.borrow_mut().insert(widget.id(), Rc::downgrade(&core));
                (widget.as_any(), core)
            }
        };
        if core.show(part) {
            return Some(widget);
        }
        if core.fallen.get() {
            let mut fallen = fallen.borrow_mut();
            fallen.push_back((block.info.to_owned(), block.code.to_owned()));
            if fallen.len() > FALLEN {
                fallen.pop_front();
            }
        }
        None
    })
}

/// The fence revisions a claim keeps with the host, newest last.
const FALLEN: usize = 16;

/// Forgets a fence's mount once the widget that holds it is freed.
struct Forget {
    mounts: Weak<RefCell<HashMap<u32, Weak<Core>>>>,
    id: u32,
}

impl Drop for Forget {
    fn drop(&mut self) {
        if let Some(mounts) = self.mounts.upgrade()
            && let Ok(mut mounts) = mounts.try_borrow_mut()
        {
            mounts.remove(&self.id);
        }
    }
}
