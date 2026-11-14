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

/// Runs a claim's view as one call of its plugin.
pub(crate) type Call = Rc<dyn Fn(&dyn Host, &mut dyn FnMut(&dyn abi::Read)) -> Called>;

/// How a call of a claim's view ended.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Called {
    Returned,
    /// It returned after the overrun limit.
    Overran,
    /// It panicked, or its plugin is no longer called.
    Failed,
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
    claim: abi::claim::Claim,
    owner: Weak<dyn Host>,
    call: Call,
    /// The palette of the theme the last view saw.
    palette: RefCell<Option<(Theme, v2::Palette)>>,
}

impl Registered {
    pub(crate) fn new(claim: abi::claim::Claim, owner: Weak<dyn Host>, call: Call) -> Rc<Self> {
        Rc::new(Self { claim, owner, call, palette: RefCell::default() })
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
        match &self.claim.target {
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
    /// The last accepted tree, keeps as they came.
    last: Option<Vec<Node>>,
}

/// What one call of the view returned and asked for; the host takes it only with its tree.
struct Viewed {
    called: Called,
    node: Option<Node>,
    given: HashMap<ContentRef, Rc<[u8]>>,
    memo: v2::Memo,
    /// The memo values the mount held before the call.
    held: i64,
}

/// The content handles of every claimed part: a handle is never given twice.
static CONTENT: AtomicU64 = AtomicU64::new(1);

impl Core {
    fn new(claim: Rc<Registered>, app: &App, key: &str, hint: u16) -> Rc<Self> {
        static GENERATION: AtomicU64 = AtomicU64::new(1);
        let root = View::new(app).column().shrink(0.0);
        let id = v2::MountId {
            surface: claim.name().to_owned(),
            key: key.to_owned(),
            generation: GENERATION.fetch_add(1, Ordering::Relaxed),
        };
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
            let viewed = self.call_view(host, &theme, full);
            let accepted = match viewed.called {
                Called::Failed => None,
                Called::Overran => {
                    log::warn!("claim {} took over the call limit on part {}", self.id.surface, self.id.key);
                    None
                }
                Called::Returned => Some(viewed.node),
            };
            let Some(node) = accepted else {
                self.state.borrow_mut().memo = viewed.memo;
                return self.fall(waited);
            };
            let Some(node) = node else {
                // A declined revision: the host's row draws it, and an accepted one later builds whole.
                self.state.borrow_mut().memo = viewed.memo;
                if !waited {
                    self.wipe();
                    self.shows.set(false);
                }
                return self.shows.get();
            };
            let (mut memo, held) = (viewed.memo, viewed.held);
            match self.adopt(host, &theme, vec![node], &viewed.given, full) {
                Ok(()) => {
                    let mut state = self.state.borrow_mut();
                    if let Some(last) = &state.last {
                        memo.finish(last);
                    }
                    book(|ledger| ledger.memo_entries += memo.len() as i64 - held);
                    state.memo = memo;
                    self.shows.set(true);
                    return true;
                }
                Err(refused) => {
                    memo.clear();
                    book(|ledger| ledger.memo_entries -= held);
                    self.state.borrow_mut().memo = memo;
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
            Some(last) if !self.claim.claim.palette => {
                if let Err(refused) = self.adopt(&*host, &host.theme(), last, &HashMap::new(), false) {
                    log::error!("claim {}: its last tree again: {refused}", self.id.surface);
                }
            }
            _ => {
                self.draw(&*host, false);
            }
        }
    }

    fn call_view(&self, host: &dyn Host, theme: &Theme, full: bool) -> Viewed {
        let part = self.part.borrow().clone().expect("a part to view");
        let rect = self.root.rect();
        let width = if rect.width > 0.0 { rect.width as u16 } else { self.hint };
        self.width.set(width);
        let input =
            v2::SurfaceInput { width, height: host.app().size().1, palette: self.claim.palette(host, theme), full };
        let mut memo = std::mem::take(&mut self.state.borrow_mut().memo);
        let held = memo.len() as i64;
        let (mut node, mut given) = (None, HashMap::new());
        let view = self.claim.claim.view.clone();
        book(|ledger| ledger.views += 1);
        let called = (self.claim.call)(host, &mut |read| {
            let staged = RefCell::new(HashMap::new());
            let mut content = |bytes: Vec<u8>| {
                let handle = ContentRef(CONTENT.fetch_add(1, Ordering::Relaxed));
                staged.borrow_mut().insert(handle, Rc::from(bytes));
                handle
            };
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
            let mut cx = v2::View::new(read, &input, &self.id, &mut memo, &mut content, &mut release);
            node = view(&mut cx, &part);
            given = staged.take();
        });
        Viewed { called, node, given, memo, held }
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
        let Held { tree, content, last, .. } = &mut *state;
        let bytes = |handle: &ContentRef| content.get(handle).or_else(|| given.get(handle));
        let source = |source: &Source| match source {
            Source::Text(text) => Some(Rc::from(text.as_str())),
            Source::Content(handle) => bytes(handle).map(|bytes| Rc::from(String::from_utf8_lossy(bytes).as_ref())),
            Source::PartOutput(part) => crate::surface::part_output(host, part).map(|text| Rc::from(text.as_str())),
        };
        let has = |handle: ContentRef| bytes(&handle).is_some();
        let env = Env { host, theme, act: &act, slot: &slot, source: &source, content: &has, full };
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
        let (content, memo) = (std::mem::take(&mut state.content), state.memo.len() as i64);
        state.memo.clear();
        book(|ledger| {
            ledger.content -= content.len() as i64;
            ledger.content_bytes -= content.values().map(|bytes| bytes.len() as i64).sum::<i64>();
            ledger.memo_entries -= memo;
        });
    }
}

impl Drop for Core {
    fn drop(&mut self) {
        let state = self.state.get_mut();
        let bytes: usize = state.content.values().map(|bytes| bytes.len()).sum();
        let (content, memo) = (state.content.len() as i64, state.memo.len() as i64);
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
