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

use crate::node::{Act, abi_mode};
use crate::reconcile::{Env, Refused, Tree};
use crate::{Claimed, Host, SlotInput, slot};

/// Runs a view as one call of the plugin: `false` when it panicked, which fails the plugin.
pub(crate) type Call = Rc<dyn Fn(&dyn Host, &mut dyn FnMut(&dyn abi::Read)) -> bool>;
/// Fails the plugin with the error.
pub(crate) type Fail = Rc<dyn Fn(String)>;
/// A route's commands, bound to one mount: what they ask for ends with the mount.
pub(crate) type Commands = Rc<dyn Fn(&Weak<()>) -> Vec<opencode_ui::keymap::TuiCommand>>;

/// The content handles of every mount: a handle is never given twice, so one a closed mount gave names nothing in
/// another, also one opened again under the same key.
static CONTENT: AtomicU64 = AtomicU64::new(1);

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
    root: View,
    owner: Weak<dyn Host>,
    view: v2::ViewFn,
    call: Call,
    fail: Fail,
    /// The slot it renders in; empty for a route.
    path: String,
    slot_input: SlotInput,
    palette: bool,
    id: v2::MountId,
    /// Lives as long as the mount; what its route's commands asked for checks it before it arrives.
    alive: Rc<()>,
    /// A route's surface fills the page; a slot's takes its node's layout, as a 1.x claim's root does.
    fills: bool,
    /// The layout a slot's root took last.
    layout: Cell<Option<abi::Layout>>,
    /// The size the last view was given, and how many views in a row a change of it called.
    seen: Cell<(u16, u16)>,
    resized: Cell<u8>,
    state: RefCell<State>,
    live: RefCell<Option<Rc<slot::Live>>>,
    watch: RefCell<Option<Disposer>>,
}

/// What one call of the view returned and asked for; the host takes it only with its tree.
struct Called {
    nodes: Vec<Node>,
    staged: Staged,
    memo: v2::Memo,
    /// The memo values the mount held before the call.
    held: i64,
}

/// The content a view gave, which goes with its tree when the host refuses it.
#[derive(Default)]
struct Staged {
    given: HashMap<ContentRef, Rc<[u8]>>,
}

#[derive(Default)]
struct State {
    tree: Tree,
    memo: v2::Memo,
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
        surface: &v2::Surface,
        key: &str,
        path: &str,
        slot_input: &SlotInput,
        call: Call,
        fail: Fail,
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
            owner: owner.clone(),
            view: surface.view.clone(),
            call,
            fail,
            path: path.to_owned(),
            slot_input: slot_input.clone(),
            palette: surface.palette,
            id,
            alive: Rc::new(()),
            fills,
            layout: Cell::new(None),
            seen: Cell::new((0, 0)),
            resized: Cell::new(0),
            state: RefCell::default(),
            live: RefCell::new(None),
            watch: RefCell::new(None),
        });
        book(|ledger| ledger.mounts += 1);
        let weak = Rc::downgrade(&mounted);
        // The host's own state and the terminal's size change outside change batches.
        let watch = host.watch(Rc::new(move |_| {
            if let (Some(mounted), Some(host)) = (weak.upgrade(), owner.upgrade()) {
                mounted.draw(host.as_ref());
            }
        }));
        *mounted.watch.borrow_mut() = watch;
        // The room the surface is given decides its input: a view runs again, after the frame, once its root is laid
        // out at another size than the view saw. A slot's root follows its content, so at most two of these run in a
        // row before another cause draws it.
        let (weak, app) = (Rc::downgrade(&mounted), host.app().clone());
        mounted.root.on_resize(move |_, rect| {
            let Some(mounted) = weak.upgrade() else { return };
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
        mounted.draw(host);
        mounted
    }

    /// Calls the view and adopts its tree, for a cause other than its size.
    pub fn draw(&self, host: &dyn Host) {
        self.resized.set(0);
        self.draw_sized(host);
    }

    /// What stands for the mount while it lives.
    pub fn alive(&self) -> Weak<()> {
        Rc::downgrade(&self.alive)
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
            let (mut memo, held) = (called.memo, called.held);
            let result = self.adopt(host, &theme, called.nodes, &called.staged, full);
            let mut state = self.state.borrow_mut();
            match result {
                Ok(()) => {
                    if let Some(last) = &state.last {
                        memo.finish(last);
                    }
                    book(|ledger| ledger.memo_entries += memo.len() as i64 - held);
                    state.memo = memo;
                    state.refused = false;
                    return;
                }
                Err(refused) => {
                    // Nothing of the refused call stays: the content it gave is dropped, its releases with it, and
                    // the memo values go, as the next view builds whole.
                    memo.clear();
                    book(|ledger| ledger.memo_entries -= held);
                    state.memo = memo;
                    if state.refused {
                        drop(state);
                        self.wipe();
                        (self.fail)(format!("{} refused twice in a row: {refused}", self.id.surface));
                        return;
                    }
                    log::warn!("surface {}: {refused}; asking for a whole tree", self.id.surface);
                    state.refused = true;
                }
            }
        }
    }

    /// Drops all the mount holds but itself: its plugin failed, so it shows nothing more.
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
        let palette = self.palette_of(host, theme);
        let rect = self.root.rect();
        // Before its first frame a surface has no size of its own; the terminal's stands in.
        let (width, height) = match (rect.width as u16, rect.height as u16) {
            (0, _) | (_, 0) => host.app().size(),
            size => size,
        };
        self.seen.set((width, height));
        let input = v2::SurfaceInput { width, height, palette, full };
        // The view works on the mount's table; what it stages there the host keeps only with its tree.
        let mut memo = std::mem::take(&mut self.state.borrow_mut().memo);
        let held = memo.len() as i64;
        let mut staged = Staged::default();
        let mut node = None;
        let view = self.view.clone();
        let called = (self.call)(host, &mut |read| {
            let given = RefCell::new(HashMap::new());
            let mut content = |bytes: Vec<u8>| {
                let handle = ContentRef(CONTENT.fetch_add(1, Ordering::Relaxed));
                given.borrow_mut().insert(handle, Rc::from(bytes));
                handle
            };
            // A release is the plugin's word that it names the handle no more, so it holds also when the tree is
            // refused: the plugin forgot the handle either way.
            let mut release = |handle| {
                if given.borrow_mut().remove(&handle).is_none()
                    && let Some(bytes) = self.state.borrow_mut().content.remove(&handle)
                {
                    book(|ledger| {
                        ledger.content -= 1;
                        ledger.content_bytes -= bytes.len() as i64;
                    });
                }
            };
            node = Some(view(&mut v2::View::new(read, &input, &self.id, &mut memo, &mut content, &mut release)));
            staged = Staged { given: given.take() };
        });
        if !called {
            self.state.borrow_mut().memo = memo;
            return None;
        }
        Some(Called { nodes: vec![node?], staged, memo, held })
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
            && let Some(Node::Box { layout, .. } | Node::Text { layout, .. } | Node::Scroll { layout, .. }) =
                nodes.first_mut()
            && crate::reconcile::sizes_ok(layout)
        {
            taken = Some(crate::node::take_layout(layout));
        }
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
        let mut state = self.state.borrow_mut();
        let State { tree, content, last, .. } = &mut *state;
        let bytes = |handle: &ContentRef| content.get(handle).or_else(|| staged.given.get(handle));
        let source = |source: &Source| match source {
            Source::Text(text) => Some(Rc::from(text.as_str())),
            Source::Content(handle) => bytes(handle).map(|bytes| Rc::from(String::from_utf8_lossy(bytes).as_ref())),
            Source::PartOutput(part) => part_output(host, part).map(|text| Rc::from(text.as_str())),
        };
        let has = |handle: ContentRef| bytes(&handle).is_some();
        let env = Env { host, theme, act: &act, slot: &slot, source: &source, content: &has, full };
        tree.apply(&env, &self.root, &nodes)?;
        if !self.fills {
            if let Some(taken) = taken {
                if self.layout.get() != Some(taken) {
                    crate::node::root_layout(&self.root, &taken);
                    self.layout.set(Some(taken));
                }
                if let Some(Node::Box { layout, .. } | Node::Text { layout, .. } | Node::Scroll { layout, .. }) =
                    nodes.first_mut()
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
        let live = self.live.borrow().clone();
        if let (true, Some(live)) = (slots_changed, live) {
            crate::settle(host, &live);
        }
        host.app().request_redraw();
        Ok(())
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
