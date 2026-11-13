//! A mount of a contract 2.0 surface ([`v2::Surface`], synthesis 4.2): one showing of a plugin's route or slot claim,
//! with a generation that is new every time. What it holds is its own and goes with it: the reconciled widgets, the
//! SDK's [`v2::Memo`] table, and the content handles the view gave the host. A view whose tree the host refuses
//! changes nothing; the host asks at once for a whole tree, and a second refusal in a row fails the plugin.
//!
//! A theme change restyles the widgets in place with no call, unless the surface reads the palette.

use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, HashMap, HashSet};
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
    state: RefCell<State>,
    live: RefCell<Option<Rc<slot::Live>>>,
    watch: RefCell<Option<Disposer>>,
}

#[derive(Default)]
struct State {
    tree: Tree,
    memo: v2::Memo,
    /// The content handles, each with the revision it was given in.
    content: HashMap<ContentRef, (Rc<str>, u64)>,
    next: u64,
    /// The last accepted tree, keeps as they came.
    last: Option<Vec<Node>>,
    revision: u64,
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
        let root = View::new(host.app()).column().shrink(0.0);
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
        mounted.draw(host);
        mounted
    }

    /// Calls the view and adopts its tree; on a refusal, once more for a whole tree.
    pub fn draw(&self, host: &dyn Host) {
        let theme = host.theme();
        for _ in 0..2 {
            let full = {
                let state = self.state.borrow();
                state.last.is_none() || state.refused
            };
            let Some(nodes) = self.call_view(host, &theme, full) else { return };
            match self.adopt(host, &theme, nodes) {
                Ok(()) => {
                    self.state.borrow_mut().refused = false;
                    return;
                }
                Err(refused) => {
                    // Nothing of the refused call stays: no tree names the content it gave, so the next adoption
                    // releases it, and its memo values go.
                    let mut state = self.state.borrow_mut();
                    let cleared = state.memo.len() as i64;
                    state.memo.clear();
                    book(|ledger| ledger.memo_entries -= cleared);
                    if state.refused {
                        drop(state);
                        (self.fail)(format!("{} refused twice in a row: {refused}", self.id.surface));
                        return;
                    }
                    log::warn!("surface {}: {refused}; asking for a whole tree", self.id.surface);
                    state.refused = true;
                }
            }
        }
    }

    /// Takes the theme without a call: the last tree is adopted again in it. A surface that reads the palette
    /// gets a view instead.
    pub fn restyle(&self, host: &dyn Host) {
        let last = self.state.borrow().last.clone();
        match last {
            Some(last) if !self.palette => {
                let theme = host.theme();
                if let Err(refused) = self.adopt(host, &theme, last) {
                    log::error!("surface {}: its last tree again: {refused}", self.id.surface);
                }
            }
            _ => self.draw(host),
        }
    }

    /// The view's tree; `None` when the call failed.
    fn call_view(&self, host: &dyn Host, theme: &Theme, full: bool) -> Option<Vec<Node>> {
        let palette = self.palette_of(host, theme);
        let rect = self.root.rect();
        // Before its first frame a surface has no size of its own; the terminal's stands in.
        let (width, height) = match (rect.width as u16, rect.height as u16) {
            (0, _) | (_, 0) => host.app().size(),
            size => size,
        };
        let input = v2::SurfaceInput { width, height, palette, full };
        let mut memo = std::mem::take(&mut self.state.borrow_mut().memo);
        let held = memo.len() as i64;
        let (mut next, revision) = {
            let state = self.state.borrow();
            (state.next, state.revision)
        };
        let mut given: Vec<(ContentRef, Rc<str>)> = Vec::new();
        let mut node = None;
        let view = self.view.clone();
        let called = (self.call)(host, &mut |read| {
            let mut content = |bytes: Vec<u8>| {
                next += 1;
                let handle = ContentRef(next);
                given.push((handle, Rc::from(String::from_utf8_lossy(&bytes).as_ref())));
                handle
            };
            node = Some(view(&mut v2::View::new(read, &input, &self.id, &mut memo, &mut content)));
        });
        memo.finish();
        let mut state = self.state.borrow_mut();
        book(|ledger| ledger.memo_entries += memo.len() as i64 - held);
        state.memo = memo;
        if !called {
            return None;
        }
        state.next = next;
        for (handle, text) in given {
            book(|ledger| {
                ledger.content += 1;
                ledger.content_bytes += text.len() as i64;
            });
            state.content.insert(handle, (text, revision + 1));
        }
        Some(vec![node?])
    }

    /// Adopts `nodes`, or refuses them and changes nothing.
    fn adopt(&self, host: &dyn Host, theme: &Theme, nodes: Vec<Node>) -> Result<(), Refused> {
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
        let State { tree, content, last, revision, .. } = &mut *state;
        let source = |source: &Source| match source {
            Source::Text(text) => Some(Rc::from(text.as_str())),
            Source::Content(handle) => content.get(handle).map(|(text, _)| text.clone()),
            Source::PartOutput(part) => part_output(host, part).map(|text| Rc::from(text.as_str())),
        };
        let has = |handle: ContentRef| content.contains_key(&handle);
        let env = Env { host, theme, act: &act, slot: &slot, source: &source, content: &has };
        tree.apply(&env, &self.root, &nodes)?;
        *revision += 1;
        *last = Some(nodes);
        // Content no tree of this mount names any more goes, once the revision it was given for is adopted.
        let mut named = HashSet::new();
        tree.each_source(&mut |source| {
            if let Source::Content(handle) = source {
                named.insert(*handle);
            }
        });
        let revision = *revision;
        content.retain(|handle, (text, given)| {
            let keep = named.contains(handle) || *given > revision;
            if !keep {
                book(|ledger| {
                    ledger.content -= 1;
                    ledger.content_bytes -= text.len() as i64;
                });
            }
            keep
        });
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
        let bytes: usize = state.content.values().map(|(text, _)| text.len()).sum();
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
        true
    }
}

impl crate::activation::Drawn for Surface {
    fn woken(&self, host: &dyn Host) {
        self.draw(host);
    }
}

/// The text tool call `part` returned, or the text of a part with that id; `None` while the host has not loaded it.
fn part_output(host: &dyn Host, part: &v2::PartRef) -> Option<String> {
    fn find(value: &serde_json::Value, id: &str) -> Option<String> {
        match value {
            serde_json::Value::Object(object) => {
                if object.get("id").and_then(|found| found.as_str()) == Some(id) {
                    if let Some(text) = object.get("text").and_then(|text| text.as_str()) {
                        return Some(text.to_owned());
                    }
                    let content = object.get("state").and_then(|state| state.get("content"))?.as_array()?;
                    let texts = content.iter().filter_map(|item| item.get("text").and_then(|text| text.as_str()));
                    return Some(texts.collect::<Vec<_>>().join("\n"));
                }
                object.values().find_map(|value| find(value, id))
            }
            serde_json::Value::Array(items) => items.iter().find_map(|value| find(value, id)),
            _ => None,
        }
    }
    let mut found = None;
    host.read(&mut |read| {
        read.messages(&part.session, &mut |messages| {
            found = messages
                .iter()
                .rev()
                .find_map(|message| serde_json::to_value(message).ok().and_then(|value| find(&value, &part.part)));
        });
    });
    found
}
