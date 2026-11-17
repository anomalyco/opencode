//! The host's side of contract 2.0's input (synthesis 3.8 and 4.2, phase P2): who owns a key layer, a mode, a
//! pointer capture, a hold and an overlay, and how a key, a paste or a pointer event reaches a plugin's handler.
//!
//! An [`Owner`] is one mount of a surface, or one activation of a plugin (the layers of its setup). Each of its
//! layers is a layer of the TUI's keymap, whose binds call its handler: [`Handled::Pass`] rejects the key and the
//! keymap tries the next candidate. Listeners of every key and of pastes ([`Layer::any`], [`Layer::paste`]) are in
//! the [`Router`]'s list, which a key intercept of the keymap reads before any layer. When the owner ends, everything
//! it owns goes with it.
//!
//! The machine, which P2's `delivery` and `ledger` check:
//!
//! | State | Event | Next | The host |
//! | --- | --- | --- | --- |
//! | any | the reserved chord | the same | before the hold, the selection and every layer: every plugin mode ends, a hold's input is dropped, the plugins' layers stop holding where the focus is until it moves; the chord goes on to the host |
//! | any | a key, not held | the same | the intercept: the listeners in order (priority, then newest) until one consumes; else the keymap's layers |
//! | any | a handler returns | the same | its effects apply before the next event of the batch (the TUI flushes after each key) |
//! | free | a consumed [`Bind::hold`] key | held | the keys and pastes after it wait behind it, at most [`HOLD_LIMIT`] |
//! | held | its owner's `release_keys`, its own [`input::HOLD`] timer, [`HOLD_LIMIT`], the owner ends | free | what waited is routed in order after the event; what was meant for a focus that something else moved (a press, a command) is dropped |
//! | no mode | `set_mode(m)` | mode m | the keymap's mode is the plugin's `m` while no host dialog is open: its layers of `m` hold, base layers do not |
//! | mode m | a move of the focus out of the owner's scope, the reserved chord, `set_mode(None)`, the owner ends | no mode | the mode is gone for good |
//! | no capture | a press on a pointer node, consumed | captured | its drags reach it |
//! | captured | release, the owner ends, the node leaves its tree, a move of the focus, a host dialog opens, a resize | no capture | |
//! | any | the owner ends | gone | its layers, listeners, mode, capture, hold and overlays go |

use std::any::Any;
use std::cell::{Cell, RefCell};
use std::collections::VecDeque;
use std::rc::{Rc, Weak};

use opencode_plugin_abi::interact::{
    self as input, Anchor, Bind, Button, Event, Handled, Interact, Layer, LayerScope, Pointer, PointerKind,
};
use opencode_ui::keymap::{BASE_MODE, KeymapLayer, TuiCommand};
use opentui::input::{Event as Input, KeyCode, KeyEvent, Modifiers, MouseButton, MouseEvent, MouseEventKind};
use opentui::keymap::{Condition, Disposer, Stroke};
use opentui::prelude::*;

use crate::Host;

/// The host commands no plugin bind may name: the plugin manager's, the user's way back from any plugin.
const RESERVED_COMMANDS: [&str; 2] = ["plugins.list", "plugins.toggle"];

/// Calls a handler as one call of its plugin: [`Handled::Pass`] when the plugin is not called.
pub(crate) type Deliver = Rc<dyn Fn(&dyn Host, &Rc<Owner>, &Event) -> Handled>;
/// The widget of a node of the owner's tree, by id.
pub(crate) type Lookup = Rc<dyn Fn(&str) -> Option<AnyWidget>>;
/// Of the owner's nodes whose widgets are on a path of widget ids, nearest first, the id of the nearest.
pub(crate) type Nearest = Rc<dyn Fn(&[u32]) -> Option<String>>;

/// What one owner holds of the input.
pub struct Owner {
    plugin: String,
    /// The surface a mount shows; empty for an activation.
    surface: String,
    host: Weak<dyn Host>,
    /// The mount's handler, which its nodes' pointer and hover and its overlays' closes reach; `None` for an
    /// activation, whose layers each have their own.
    deliver: Option<Deliver>,
    /// The mount's surface root; `None` for an activation.
    root: Option<View>,
    /// Where a layer of its surface's own scope holds (`LayerScope::Surface`).
    held: RefCell<Held>,
    lookup: Option<Lookup>,
    nearest: Option<Nearest>,
    alive: Cell<bool>,
    /// What it held is gone.
    ended: Cell<bool>,
    /// It has a layer of the composer, so its mode holds while the composer has the focus.
    composer: Cell<bool>,
    layers: RefCell<Vec<Disposer>>,
    mode: RefCell<Option<Mode>>,
    /// The ids of its tree's nodes, and of its focusable ones.
    ids: RefCell<Vec<String>>,
    focusable: RefCell<Vec<String>>,
    /// The mount it holds the input of, as long as it lives; `None` for an activation.
    mount: Option<Weak<()>>,
    /// That mount's ID, which a call for it names to the plugin (big-boi 4).
    id: Option<opencode_plugin_abi::v2::MountId>,
}

struct Mode {
    name: String,
    /// Where the focus was as the mode was set: the composer, the surface, or everywhere for an activation.
    scope: LayerScope,
    ended: Rc<Cell<bool>>,
    disposer: Disposer,
}

/// Where a surface's own scope holds: while the focus is in a view (a panel, an overlay's frame, a slot's root), or,
/// for a route, while it shows and no dialog of the host is over it (the route of synthesis 4.2's `Scope::Route`).
enum Held {
    Within(View),
    Route,
}

/// A listener of every key or of pastes, with its handler.
struct Listener {
    owner: Weak<Owner>,
    layer: Layer,
    deliver: Deliver,
}

/// How many events a hold keeps; at the limit it is released, and what it kept goes on in order.
pub const HOLD_LIMIT: usize = 256;

struct Hold {
    owner: Weak<Owner>,
    /// New with every hold: a release or a timer of an earlier one does nothing to it.
    generation: u64,
    /// The input after the hold key, in arrival order, each with the focus it came to: keys and pastes. OpenTUI gives
    /// a press to its widget before any host code sees it, so a press cannot wait.
    events: VecDeque<(Input, Option<u32>)>,
    timer: Option<TimerId>,
    /// Released: what it kept is being routed again.
    draining: bool,
}

struct Capture {
    owner: Weak<Owner>,
    node: String,
    /// The focus when the capture began; a move of it ends the capture.
    focus: Option<u32>,
}

/// An overlay on screen.
struct Shown {
    plugin: String,
    surface: String,
    /// The owner whose call opened it, which hears it closed.
    opener: Weak<Owner>,
    frame: View,
    backdrop: View,
    /// Where it was asked to show, and its size, which a resize clamps to the screen again.
    anchor: Anchor,
    size: (u16, u16),
    /// Escape, which closes it unless a layer of the overlay above priority 1 takes the key.
    _escape: Option<Disposer>,
    mount: Box<dyn crate::Claimed>,
}

/// The input registrations of one host: the listeners, the hold, the capture and the overlays. The TUI keeps one.
#[derive(Default)]
pub struct Router {
    listeners: RefCell<Vec<Listener>>,
    owners: RefCell<Vec<Weak<Owner>>>,
    hold: RefCell<Option<Hold>>,
    capture: RefCell<Option<Capture>>,
    overlays: RefCell<Vec<Shown>>,
    /// The intercept of the keymap, once a plugin registers input.
    intercept: RefCell<Option<Disposer>>,
    host: RefCell<Option<Weak<dyn Host>>>,
    replaying: Cell<bool>,
    holds: Cell<u64>,
    /// After the reserved chord, the focus where the plugins' layers stop holding until it moves.
    suspended: Cell<Option<Option<u32>>>,
}

/// What the input registrations hold now, read from the registries the host routes by (`ledger`, 4.14).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Ledger {
    /// The keymap's layers, the host's own included.
    pub layers: usize,
    /// The keymap's pushed modes, the host's own included.
    pub modes: usize,
    pub listeners: usize,
    /// The widgets in the host's overlay layer.
    pub overlays: usize,
    pub capture: bool,
    /// A hold is active, and the events it keeps.
    pub holding: bool,
    pub held: usize,
    /// Pending hold timers.
    pub timers: usize,
}

/// The input registrations of `host` now; reading them changes nothing.
pub fn ledger(host: &dyn Host) -> Ledger {
    let keymap = host.keymap();
    let mut ledger = Ledger { layers: keymap.layer_count(), modes: keymap.mode_count(), ..Ledger::default() };
    ledger.overlays = host.overlay_layer().map_or(0, |layer| layer.children().len());
    if let Some(router) = host.router() {
        ledger.listeners = router.listeners.borrow().len();
        ledger.capture = router.capture.borrow().is_some();
        let hold = router.hold.borrow();
        ledger.holding = hold.is_some();
        ledger.held = hold.as_ref().map_or(0, |hold| hold.events.len());
        ledger.timers = hold.as_ref().map_or(0, |hold| usize::from(hold.timer.is_some()));
    }
    ledger
}

impl Owner {
    /// A mount's owner: its surface, its root, its tree's lookups and its handler.
    pub(crate) fn mount(
        plugin: &str,
        surface: &str,
        host: Weak<dyn Host>,
        root: View,
        (lookup, nearest): (Lookup, Nearest),
        deliver: Option<Deliver>,
        (id, mount): (opencode_plugin_abi::v2::MountId, Weak<()>),
    ) -> Rc<Self> {
        let mut owner = Self::new(plugin, surface, host, Some(root), Some((lookup, nearest)), deliver, Some(mount));
        owner.id = Some(id);
        Rc::new(owner)
    }

    /// An activation's owner, which has no surface.
    pub(crate) fn activation(plugin: &str, host: Weak<dyn Host>) -> Rc<Self> {
        Rc::new(Self::new(plugin, "", host, None, None, None, None))
    }

    fn new(
        plugin: &str,
        surface: &str,
        host: Weak<dyn Host>,
        root: Option<View>,
        lookups: Option<(Lookup, Nearest)>,
        deliver: Option<Deliver>,
        mount: Option<Weak<()>>,
    ) -> Self {
        let (lookup, nearest) = lookups.unzip();
        Self {
            plugin: plugin.to_owned(),
            surface: surface.to_owned(),
            host,
            deliver,
            held: RefCell::new(root.clone().map_or(Held::Route, Held::Within)),
            root,
            lookup,
            nearest,
            alive: Cell::new(true),
            ended: Cell::new(false),
            composer: Cell::new(false),
            layers: RefCell::default(),
            mode: RefCell::default(),
            ids: RefCell::default(),
            focusable: RefCell::default(),
            mount,
            id: None,
        }
    }

    pub fn alive(&self) -> bool {
        self.alive.get()
    }

    /// The scope of the surface is the focus in `view`, the container the host shows it in: a panel, an overlay.
    pub(crate) fn hold_in(&self, view: View) {
        blurs(&view, &self.host);
        self.pastes_in(&view);
        *self.held.borrow_mut() = Held::Within(view);
    }

    /// The scope of the surface is the focus in its root: a slot claim.
    pub(crate) fn hold_root(&self) {
        if let Some(root) = self.root.clone() {
            self.hold_in(root);
        }
    }

    /// The scope of the surface is its route's showing; a paste in it is its.
    pub(crate) fn hold_route(&self) {
        if let Some(root) = &self.root {
            self.pastes_in(root);
        }
        *self.held.borrow_mut() = Held::Route;
    }

    /// A paste in `view` goes to the layers that declare pastes, before the host's paste route.
    fn pastes_in(&self, view: &View) {
        let host = self.host.clone();
        view.on_paste(move |cx, text| {
            if let Some(host) = host.upgrade()
                && let Some(router) = host.router()
                && router.paste(&*host, text, Pasted::Surface)
            {
                cx.prevent_default();
                cx.stop_propagation();
            }
        });
    }

    /// The view whose focus is the surface's, if its scope is one.
    fn within(&self) -> Option<View> {
        match &*self.held.borrow() {
            Held::Within(view) if self.root.is_some() => Some(view.clone()),
            _ => None,
        }
    }

    /// Whether the focus is in the surface's scope, or its route shows with no dialog or overlay over it.
    fn in_surface(&self, host: &dyn Host) -> bool {
        match (&*self.held.borrow(), &self.root) {
            (_, None) => false,
            (Held::Within(view), Some(_)) => focus_within(host.app(), view.id()),
            (Held::Route, Some(_)) => !host.modal_open() && !host.router().is_some_and(|router| router.overlaid(host)),
        }
    }

    /// The view the focus is in while it is in the surface: its container, or its root.
    fn scope_view(&self) -> Option<View> {
        self.within().or_else(|| self.root.clone())
    }

    /// Registers `layers`, whose keys reach `deliver`.
    pub(crate) fn register(self: &Rc<Self>, host: &dyn Host, layers: &[Layer], deliver: &Deliver) {
        let Some(router) = host.router() else {
            if !layers.is_empty() {
                log::warn!("plugin {}: this host routes no plugin input", self.plugin);
            }
            return;
        };
        router.install(host, &self.host);
        let me = Rc::downgrade(self);
        if !router.owners.borrow().iter().any(|owner| owner.ptr_eq(&me)) {
            router.owners.borrow_mut().push(me.clone());
        }
        for layer in layers {
            if matches!((&layer.scope, &self.root), (LayerScope::Surface | LayerScope::Node(_), None)) {
                log::warn!("plugin {}: a layer of setup has no surface; use the composer or global scope", self.plugin);
                continue;
            }
            if layer.scope == LayerScope::Composer {
                self.composer.set(true);
            }
            if layer.any || layer.paste {
                let listener = Listener { owner: me.clone(), layer: layer.clone(), deliver: deliver.clone() };
                router.listeners.borrow_mut().push(listener);
            }
            // The reserved chord stops every plugin layer before the keymap sees it (`Router::escape`), so a bind of it
            // never runs.
            // A printable key of a global layer is the text's while the composer or another text input has the focus
            // (FT-14): a plugin's `h` must not take the user's typing. It reaches the plugin everywhere else.
            let (typed, other): (Vec<&Bind>, Vec<&Bind>) = layer
                .keys
                .iter()
                .filter(|bind| self.takes(bind))
                .partition(|bind| layer.scope == LayerScope::Global && printable(&bind.key));
            for (binds, typed) in [(other, false), (typed, true)] {
                if binds.is_empty() {
                    continue;
                }
                let commands: Vec<TuiCommand> = binds.into_iter().map(|bind| self.command(bind, deliver)).collect();
                let (owner, scope) = (me.clone(), layer.scope.clone());
                let enabled = Condition::when(move || {
                    owner.upgrade().is_some_and(|owner| owner.holds(&scope) && !(typed && owner.typing()))
                });
                let declared = KeymapLayer::new(commands)
                    .priority(layer.priority)
                    .enabled(enabled)
                    .mode(self.mode_key(layer.mode.as_deref()));
                match host.keymap().layer(declared) {
                    Ok(disposer) => self.layers.borrow_mut().push(disposer),
                    Err(error) => log::error!("plugin {} keymap layer: {error}", self.plugin),
                }
            }
        }
    }

    /// Whether the composer or another text input has the focus.
    fn typing(&self) -> bool {
        self.host.upgrade().is_some_and(|host| {
            host.composer_focused() || host.app().focused().is_some_and(|widget| widget.element().is_editor())
        })
    }

    /// Whether the keymap can take `bind`: one with no key and no name would fail its whole layer, and one named after
    /// the plugin manager's commands would take `/plugins` from the user (carbon's review of P6c, 5).
    fn takes(&self, bind: &Bind) -> bool {
        let named = bind.command.as_deref().filter(|name| !name.is_empty());
        if named.is_none() && (bind.key.is_empty() || bind.command.is_some()) {
            log::warn!("plugin {}: a bind with no key and no name is left out", self.plugin);
            return false;
        }
        if named.is_some_and(|name| RESERVED_COMMANDS.contains(&name)) {
            log::warn!("plugin {}: a bind may not take the host's {}", self.plugin, named.unwrap_or_default());
            return false;
        }
        true
    }

    /// The keymap command of `bind`, which calls the handler and holds the keys after it if it asks.
    fn command(self: &Rc<Self>, declared: &Bind, deliver: &Deliver) -> TuiCommand {
        let (owner, deliver, bind) = (Rc::downgrade(self), deliver.clone(), declared.clone());
        let run = move |_: Option<&str>, pressed: Option<&KeyEvent>| {
            let Some(owner) = owner.upgrade().filter(|owner| owner.alive()) else { return false };
            let Some(host) = owner.host.upgrade() else { return false };
            // The stroke that matched; a run with no key (none today) names the bind's keys.
            let (key, text) = pressed.map_or_else(|| (bind.key.clone(), None), key_of);
            let event = Event::Key(input::Key { bind: Some(bind.name.clone()), key, text });
            let handled = delivered(&deliver, &*host, &owner, &event) == Handled::Consume;
            if handled
                && bind.hold
                && let Some(router) = host.router()
            {
                router.hold(&*host, &owner);
            }
            handled
        };
        // A bind of the user's keybind takes its keys by name (P6c), as a host command of that name does.
        let mut command = match (&declared.command, declared.key.is_empty()) {
            (Some(name), true) => TuiCommand::new(name.clone(), run),
            (Some(name), false) => {
                TuiCommand::new(name.clone(), run).bind(opencode_ui::keymap::Bind::Key(declared.key.clone()))
            }
            (None, _) => TuiCommand::inline(declared.key.clone(), run),
        };
        if let Some(title) = &declared.title {
            command = command.title(title.clone()).group("Plugin");
        }
        command
    }

    /// The keymap mode a layer of mode `mode` needs: the base mode, or the plugin's own, apart from every other
    /// plugin's and the host's.
    fn mode_key(&self, mode: Option<&str>) -> String {
        match mode {
            Some(mode) => format!("{}:{mode}", self.plugin),
            None => BASE_MODE.to_owned(),
        }
    }

    /// Whether `scope` holds for this owner now: never where the reserved chord left the focus, until it moves.
    fn holds(&self, scope: &LayerScope) -> bool {
        if !self.alive() {
            return false;
        }
        let Some(host) = self.host.upgrade() else { return false };
        if host.router().is_some_and(|router| router.suspended(&*host)) {
            return false;
        }
        match scope {
            // Another plugin's overlay with the focus is the input's, as a dialog is.
            LayerScope::Global => !host.router().is_some_and(|router| router.overlaid_by_other(&*host, &self.plugin)),
            LayerScope::Composer => host.composer_focused(),
            LayerScope::Surface => self.in_surface(&*host),
            LayerScope::Node(id) => {
                let node = self.lookup.as_ref().and_then(|lookup| lookup(id));
                node.is_some_and(|node| focus_within(host.app(), node.id()))
            }
        }
    }

    /// The scope a mode set now holds in: the surface while the focus is in it, else the composer for an owner with a
    /// layer there while it has the focus, else everywhere for an activation with no composer layer.
    fn mode_scope(&self) -> Option<LayerScope> {
        match (&self.root, self.composer.get()) {
            (Some(_), _) if self.holds(&LayerScope::Surface) => Some(LayerScope::Surface),
            (_, true) if self.holds(&LayerScope::Composer) => Some(LayerScope::Composer),
            (None, false) if self.holds(&LayerScope::Global) => Some(LayerScope::Global),
            _ => None,
        }
    }

    /// Whether the owner's mode holds: the scope it was set in holds.
    fn mode_holds(&self) -> bool {
        self.mode.borrow().as_ref().is_some_and(|mode| self.holds(&mode.scope))
    }

    /// The owner's mode, unless the host ended it.
    pub fn mode(&self) -> Option<String> {
        let mode = self.mode.borrow();
        mode.as_ref().filter(|mode| !mode.ended.get() && self.mode_holds()).map(|mode| mode.name.clone())
    }

    /// Sets the owner's mode, or ends it.
    pub(crate) fn set_mode(self: &Rc<Self>, host: &dyn Host, mode: Option<&str>) {
        if let Some(old) = self.mode.borrow_mut().take() {
            old.disposer.dispose();
        }
        let Some((name, scope)) = mode.filter(|_| self.alive()).zip(self.mode_scope()) else { return };
        let ended = Rc::new(Cell::new(false));
        let (owner, flag) = (Rc::downgrade(self), ended.clone());
        // A move of the focus out of its scope ends it (`Router::refocus`, `blurs`), so a focus that comes back does
        // not bring it back. A host dialog's mode stays above it, whenever the dialog opened.
        let active = Condition::when(move || {
            !flag.get()
                && owner.upgrade().is_some_and(|owner| {
                    owner.mode_holds() && !owner.host.upgrade().is_some_and(|host| host.modal_open())
                })
        });
        let disposer = host.keymap().push_mode(&self.mode_key(Some(name)), active);
        *self.mode.borrow_mut() = Some(Mode { name: name.to_owned(), scope, ended, disposer });
        if let Some(router) = host.router() {
            let me = Rc::downgrade(self);
            if !router.owners.borrow().iter().any(|owner| owner.ptr_eq(&me)) {
                router.owners.borrow_mut().push(me);
            }
        }
    }

    /// Drops a mode the host ended, so the keymap's stack holds no entry of it.
    fn prune_mode(&self) {
        let ended = self.mode.borrow().as_ref().is_some_and(|mode| mode.ended.get() || !self.mode_holds());
        if ended && let Some(mode) = self.mode.borrow_mut().take() {
            mode.disposer.dispose();
        }
    }

    /// Where the node with id `id` is.
    pub fn rect(&self, id: &str) -> Option<input::Rect> {
        let widget = self.lookup.as_ref()?(id)?;
        let rect = widget.rect();
        Some(input::Rect {
            x: rect.screen_x as i32,
            y: rect.screen_y as i32,
            width: rect.width as u32,
            height: rect.height as u32,
        })
    }

    /// Where the focus is, for this owner.
    pub fn focused(&self) -> input::Focused {
        let (Some(host), Some(_), Some(nearest)) = (self.host.upgrade(), &self.root, &self.nearest) else {
            return input::Focused::default();
        };
        let path: Vec<u32> =
            std::iter::successors(host.app().focused(), |widget| widget.parent()).map(|widget| widget.id()).collect();
        // The nearest node with an id that holds the focus.
        let node = nearest(&path);
        input::Focused { node, surface: self.scope_view().is_some_and(|view| path.contains(&view.id())) }
    }

    /// Puts back a focus the mount's new tree took away (OpenTUI drops the focus of a widget it detaches): on node
    /// `node` if the tree still holds it focusable, else on the surface's container, else the composer.
    pub(crate) fn restore_focus(&self, host: &dyn Host, node: Option<&str>) {
        if host.app().focused().is_some() {
            return;
        }
        let kept = node.filter(|id| self.focusable.borrow().iter().any(|known| known == id));
        match kept.and_then(|id| self.lookup.as_ref()?(id)) {
            Some(widget) => host.app().focus(&widget),
            None => {
                if let Some(view) = self.within() {
                    host.app().focus(&view);
                }
            }
        }
        if host.app().focused().is_none() {
            host.focus_composer();
        }
    }

    /// Records the ids of the tree's nodes, and of the focusable ones, which [`Owner::focus`] may focus. A capture of
    /// a node the tree no longer holds ends with it.
    pub(crate) fn set_tree(&self, ids: Vec<String>, focusable: Vec<String>) {
        if let Some(host) = self.host.upgrade()
            && let Some(router) = host.router()
        {
            let gone = router
                .capture
                .borrow()
                .as_ref()
                .is_some_and(|capture| std::ptr::eq(capture.owner.as_ptr(), self) && !ids.contains(&capture.node));
            if gone {
                router.capture.borrow_mut().take();
            }
        }
        *self.ids.borrow_mut() = ids;
        *self.focusable.borrow_mut() = focusable;
    }

    /// Gives the focus to the owner's node `id`, if it is focusable and no host dialog is open.
    pub(crate) fn focus(&self, host: &dyn Host, id: &str) {
        if host.modal_open() {
            log::warn!("plugin {}: a dialog of the host has the focus", self.plugin);
            return;
        }
        let focusable = self.focusable.borrow().iter().any(|known| known == id);
        match self.lookup.as_ref().and_then(|lookup| lookup(id)).filter(|_| focusable && self.alive()) {
            Some(widget) => refocus(host, || host.app().focus(&widget)),
            None => log::warn!("plugin {}: {id:?} is not a focusable node of its mount", self.plugin),
        }
    }

    /// Gives the composer the focus, if the owner's surface has it.
    pub(crate) fn blur(&self, host: &dyn Host) {
        if self.scope_view().is_some_and(|view| focus_within(host.app(), view.id())) {
            host.focus_composer();
        }
    }

    /// Whether its tree holds a node with id `id`.
    pub(crate) fn has(&self, id: &str) -> bool {
        self.ids.borrow().iter().any(|known| known == id)
    }

    /// The mount it holds the input of; `None` for an activation.
    pub(crate) fn mounted(&self) -> Option<Weak<()>> {
        self.mount.clone()
    }

    /// The ID of the mount it holds the input of; `None` for an activation.
    pub(crate) fn id(&self) -> Option<&opencode_plugin_abi::v2::MountId> {
        self.id.as_ref()
    }

    /// Calls the mount's handler with what one of its widgets or scrolls sends (P3): an edit, a scroll.
    pub(crate) fn hear(self: &Rc<Self>, event: &Event) {
        if let Some(host) = self.host.upgrade() {
            self.send(&*host, event);
        }
    }

    /// Calls the mount's handler with `event`.
    fn send(self: &Rc<Self>, host: &dyn Host, event: &Event) -> Handled {
        match (&self.deliver, self.alive()) {
            // What the handler asks for is one deeper than what made the router send it (review carbon new-1).
            (Some(deliver), true) => crate::deeper(|| delivered(deliver, host, self, event)),
            _ => Handled::Pass,
        }
    }

    /// Stops the owner's handlers at once: its plugin failed or left `active`. [`Owner::end`] follows once the event
    /// that ended it is handled.
    pub(crate) fn revoke(&self) {
        self.alive.set(false);
    }

    /// Ends the owner: everything it holds of the input goes. The host gives a focus that was inside it to the
    /// composer as it mounts the route again, and an overlay's close does too.
    pub(crate) fn end(self: &Rc<Self>) {
        self.alive.set(false);
        if self.ended.replace(true) {
            return;
        }
        let Some(host) = self.host.upgrade() else { return };
        let host = &*host;
        self.layers.take().into_iter().for_each(Disposer::dispose);
        if let Some(mode) = self.mode.borrow_mut().take() {
            mode.disposer.dispose();
        }
        if let Some(router) = host.router() {
            let me = Rc::downgrade(self);
            router.listeners.borrow_mut().retain(|listener| !listener.owner.ptr_eq(&me));
            router.owners.borrow_mut().retain(|owner| !owner.ptr_eq(&me) && owner.strong_count() > 0);
            let capture = router.capture.borrow().as_ref().is_some_and(|capture| capture.owner.ptr_eq(&me));
            if capture {
                router.capture.borrow_mut().take();
            }
            let held = router.hold.borrow().as_ref().filter(|hold| hold.owner.ptr_eq(&me)).map(|hold| hold.generation);
            if let Some(generation) = held {
                // What it held goes on as if it had not been there.
                router.release(generation);
            }
            let owned: Vec<(String, String)> = router
                .overlays
                .borrow()
                .iter()
                .filter(|shown| shown.opener.ptr_eq(&me))
                .map(|shown| (shown.plugin.clone(), shown.surface.clone()))
                .collect();
            for (plugin, surface) in owned {
                router.close(host, &plugin, &surface, false);
            }
        }
    }
}

impl Drop for Owner {
    fn drop(&mut self) {
        self.layers.take().into_iter().for_each(Disposer::dispose);
        if let Some(mode) = self.mode.get_mut().take() {
            mode.disposer.dispose();
        }
    }
}

impl Router {
    /// Installs the keymap intercept the listeners, the hold and the reserved chord need, once.
    fn install(&self, host: &dyn Host, weak: &Weak<dyn Host>) {
        if self.intercept.borrow().is_some() {
            return;
        }
        *self.host.borrow_mut() = Some(weak.clone());
        let keyed = weak.clone();
        // Below the JS host's hold (`pipe::Scripts`, at the top): a key it holds reaches no listener until it is put
        // back, and then once (CT-19).
        let disposer = host.keymap().keymap().intercept_key(i32::MAX - 1, false, move |context| {
            let Some(host) = keyed.upgrade() else { return };
            let Some(router) = host.router() else { return };
            if router.intercept(&*host, &context.event) {
                context.consume();
            }
        });
        *self.intercept.borrow_mut() = Some(disposer);
        // A resize ends the capture: it may squeeze the node off the screen or under another, which no cheap read of
        // the layout tells from a node that shows.
        let resized = weak.clone();
        host.app().on_resize(move |_, _, _| {
            if let Some(host) = resized.upgrade()
                && let Some(router) = host.router()
            {
                router.capture.borrow_mut().take();
                router.reclamp(&*host);
            }
        });
        let weak = weak.clone();
        host.app().on_paste(move |cx, text| {
            if let Some(host) = weak.upgrade()
                && let Some(router) = host.router()
                && router.paste(&*host, text, Pasted::Elsewhere)
            {
                cx.prevent_default();
                cx.stop_propagation();
            }
        });
    }

    /// What the intercept does with a key: whether it is taken.
    fn intercept(&self, host: &dyn Host, event: &KeyEvent) -> bool {
        if !self.replaying.get() && self.held(Input::Key(*event)) {
            return true;
        }
        let current = host.keymap().mode();
        // Listeners by priority, the newest first among equals.
        let mut listeners: Vec<(i32, usize, Rc<Owner>, Deliver)> = self
            .listeners
            .borrow()
            .iter()
            .enumerate()
            .filter(|(_, listener)| listener.layer.any)
            .filter_map(|(index, listener)| {
                let owner = listener.owner.upgrade()?;
                let mode = owner.mode_key(listener.layer.mode.as_deref());
                (owner.holds(&listener.layer.scope) && mode == current)
                    .then(|| (listener.layer.priority, index, owner, listener.deliver.clone()))
            })
            .collect();
        listeners.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.cmp(&a.1)));
        let (key, text) = key_of(event);
        let event = Event::Key(input::Key { bind: None, key, text });
        listeners
            .into_iter()
            .any(|(_, _, owner, deliver)| delivered(&deliver, host, &owner, &event) == Handled::Consume)
    }

    /// The reserved chord (synthesis 3.8): every plugin mode ends, what a hold kept is dropped, as a terminal's interrupt
    /// drops typed-ahead input, and the plugins' layers stop holding where the focus is until it moves. The chord goes
    /// on to the host. The host calls it before anything else sees the key: its selection, the hold and the keymap.
    pub fn escape(&self, host: &dyn Host) {
        for owner in self.owners.borrow().iter().filter_map(Weak::upgrade) {
            if let Some(mode) = &*owner.mode.borrow() {
                mode.ended.set(true);
            }
        }
        // The keymap's intercept prunes them before the chord reaches any layer, so the host's own handler of it runs in
        // the base mode.
        let timer = self.hold.borrow_mut().take().and_then(|held| held.timer);
        if let Some(timer) = timer {
            host.app().cancel_timer(timer);
        }
        self.suspended.set(Some(focused(host.app())));
    }

    /// Whether the reserved chord left the focus where it is now; the first look after it moved ends that.
    fn suspended(&self, host: &dyn Host) -> bool {
        let Some(at) = self.suspended.get() else { return false };
        if at == focused(host.app()) {
            return true;
        }
        self.suspended.set(None);
        false
    }

    /// Keeps `event` behind a hold that is not being released; whether it did. At [`HOLD_LIMIT`] the hold is released.
    fn held(&self, event: Input) -> bool {
        let Some(host) = self.host.borrow().as_ref().and_then(Weak::upgrade) else { return false };
        let full = {
            let mut hold = self.hold.borrow_mut();
            let Some(held) = hold.as_mut().filter(|held| !held.draining) else { return false };
            held.events.push_back((event, focused(host.app())));
            (held.events.len() >= HOLD_LIMIT).then_some(held.generation)
        };
        if let Some(generation) = full {
            self.release(generation);
        }
        true
    }

    /// Holds the input after a consumed hold key of `owner`, until it releases it or [`input::HOLD`] passes. A hold key
    /// routed again from a hold being released starts its own hold, with the input after it.
    fn hold(&self, host: &dyn Host, owner: &Rc<Owner>) {
        let rest = match self.hold.borrow_mut().as_mut() {
            Some(held) if !held.draining => return,
            Some(held) => std::mem::take(&mut held.events),
            None => VecDeque::new(),
        };
        let generation = self.holds.get() + 1;
        self.holds.set(generation);
        let weak = owner.host.clone();
        let timer = host.app().set_timeout(input::HOLD, move |_| {
            if let Some(host) = weak.upgrade()
                && let Some(router) = host.router()
            {
                router.release(generation);
            }
        });
        *self.hold.borrow_mut() =
            Some(Hold { owner: Rc::downgrade(owner), generation, events: rest, timer: Some(timer), draining: false });
    }

    /// The owner of the hold of `plugin` lets it go: what it kept is routed again. A hold of another plugin stays.
    pub(crate) fn release_for(&self, plugin: &str) {
        let generation = self.hold.borrow().as_ref().and_then(|held| {
            let owner = held.owner.upgrade().filter(|owner| owner.alive() && owner.plugin == plugin)?;
            drop(owner);
            Some(held.generation)
        });
        if let Some(generation) = generation {
            self.release(generation);
        }
    }

    /// Releases hold `generation`: what it kept is routed in order after the event that runs now. A release of another
    /// hold, or a timer of an earlier one, does nothing.
    pub(crate) fn release(&self, generation: u64) {
        let Some(host) = self.host.borrow().as_ref().and_then(Weak::upgrade) else { return };
        let timer = {
            let mut hold = self.hold.borrow_mut();
            let Some(held) = hold.as_mut().filter(|held| held.generation == generation && !held.draining) else {
                return;
            };
            held.draining = true;
            held.timer.take()
        };
        if let Some(timer) = timer {
            host.app().cancel_timer(timer);
        }
        let weak = Rc::downgrade(&host);
        host.app().defer(move |_| {
            let Some(host) = weak.upgrade() else { return };
            let Some(router) = host.router() else { return };
            loop {
                let next = {
                    let mut hold = router.hold.borrow_mut();
                    match hold.as_mut().filter(|held| held.generation == generation) {
                        Some(held) => match held.events.pop_front() {
                            Some(next) => Some(next),
                            None => {
                                hold.take();
                                None
                            }
                        },
                        // Another hold took the rest, or the reserved chord dropped it.
                        None => None,
                    }
                };
                let Some((event, meant)) = next else { break };
                // Input never reaches a focus other than the one it came to: a press or a command moved it since.
                if focused(host.app()) != meant {
                    log::warn!("a held {event:?} is dropped: the focus it was meant for moved");
                    continue;
                }
                router.replaying.set(true);
                host.app().dispatch(event);
                router.replaying.set(false);
            }
        });
    }

    /// Offers `text`, pasted at `at`, to the paste listeners that hold there now, the newest first; whether one took
    /// it. Its effects apply before the paste returns. A global layer hears a paste wherever it lands: in the composer
    /// and in the plugins' surfaces before the host, as in TS, and elsewhere only once no host widget took it
    /// (`Pasted::Elsewhere`), since OpenTUI routes a paste to the focused widget before anything else.
    pub fn paste(&self, host: &dyn Host, text: &str, at: Pasted) -> bool {
        // Behind a hold, it waits for the keys before it.
        if !self.replaying.get() && self.held(Input::Paste(text.to_owned())) {
            return true;
        }
        if at == Pasted::Elsewhere && self.offered(host) {
            return false;
        }
        let current = host.keymap().mode();
        // By priority, the newest first among equals, as the listeners of keys.
        let mut listeners: Vec<(i32, usize, Rc<Owner>, Deliver)> = self
            .listeners
            .borrow()
            .iter()
            .enumerate()
            .filter(|(_, listener)| {
                listener.layer.paste
                    && match (at, &listener.layer.scope) {
                        (_, LayerScope::Global) => true,
                        (Pasted::Composer, scope) => *scope == LayerScope::Composer,
                        (Pasted::Surface, scope) => *scope != LayerScope::Composer,
                        (Pasted::Elsewhere, _) => false,
                    }
            })
            .filter_map(|(index, listener)| {
                let owner = listener.owner.upgrade()?;
                let mode = owner.mode_key(listener.layer.mode.as_deref());
                (owner.holds(&listener.layer.scope) && mode == current)
                    .then(|| (listener.layer.priority, index, owner, listener.deliver.clone()))
            })
            .collect();
        listeners.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.cmp(&a.1)));
        let event = Event::Paste { text: text.to_owned() };
        let taken = listeners
            .into_iter()
            .any(|(_, _, owner, deliver)| delivered(&deliver, host, &owner, &event) == Handled::Consume);
        crate::flush();
        taken
    }

    /// Whether a paste with the focus where it is now was offered already, in a plugin's surface. One in the composer
    /// never gets this far: the composer takes every paste.
    fn offered(&self, host: &dyn Host) -> bool {
        self.owners
            .borrow()
            .iter()
            .filter_map(Weak::upgrade)
            .filter(|owner| owner.alive())
            .filter_map(|owner| owner.scope_view())
            .any(|view| focus_within(host.app(), view.id()))
    }

    /// Whether an overlay has the focus.
    fn overlaid(&self, host: &dyn Host) -> bool {
        self.overlays.borrow().iter().any(|shown| focus_within(host.app(), shown.frame.id()))
    }

    /// Whether an overlay of a plugin other than `plugin` has the focus.
    fn overlaid_by_other(&self, host: &dyn Host, plugin: &str) -> bool {
        self.overlays.borrow().iter().any(|shown| shown.plugin != plugin && focus_within(host.app(), shown.frame.id()))
    }

    /// The overlays on screen take the host's theme in place.
    pub fn restyle(&self, host: &dyn Host) {
        self.overlays.borrow().iter().for_each(|shown| {
            shown.mount.restyle(host);
        });
    }

    /// Clamps every overlay to the screen again, from where it was asked to show.
    fn reclamp(&self, host: &dyn Host) {
        for shown in self.overlays.borrow().iter() {
            let Some(opener) = shown.opener.upgrade() else { continue };
            let Some((x, y, w, h)) = self.place(host, &shown.plugin, &shown.anchor, shown.size, &opener) else {
                continue;
            };
            shown.frame.position(opentui::layout::Edge::Left, x).position(opentui::layout::Edge::Top, y);
            shown.frame.width(w).height(h);
        }
        host.app().request_redraw();
    }

    /// The focus left widget `id`: a capture that began with the focus there ends, and so do the modes whose scope
    /// the focus is not in now.
    pub fn blurred(&self, id: u32) {
        let lost = self.capture.borrow().as_ref().is_some_and(|capture| capture.focus == Some(id));
        if lost {
            self.capture.borrow_mut().take();
        }
        self.prune();
    }

    /// The plugin's node a drag from `source` started on, if it is one of `plugin`'s mounts'.
    fn dragged(&self, plugin: &str, source: &AnyWidget) -> Option<input::Dragged> {
        let path: Vec<u32> =
            std::iter::successors(Some(source.clone()), |widget| widget.parent()).map(|widget| widget.id()).collect();
        let owners: Vec<Rc<Owner>> = self.owners.borrow().iter().filter_map(Weak::upgrade).collect();
        owners.into_iter().filter(|owner| owner.alive() && owner.plugin == plugin).find_map(|owner| {
            let node = owner.nearest.as_ref()?(&path)?;
            Some(input::Dragged { surface: owner.surface.clone(), node })
        })
    }

    /// The area of `plugin`'s surface `surface` on the screen, if it shows.
    fn area(&self, plugin: &str, surface: &str) -> Option<(u16, u16, u16, u16)> {
        let owners: Vec<Rc<Owner>> = self.owners.borrow().iter().filter_map(Weak::upgrade).collect();
        let owner =
            owners.into_iter().find(|owner| owner.alive() && owner.plugin == plugin && owner.surface == surface)?;
        let view = owner.within().or_else(|| owner.root.clone())?;
        let rect = view.rect();
        let clamp = |value: f64| value.max(0.0).min(f64::from(u16::MAX)) as u16;
        Some((clamp(rect.screen_x), clamp(rect.screen_y), clamp(f64::from(rect.width)), clamp(f64::from(rect.height))))
    }

    /// Drops the modes the host ended, before the next key is routed.
    pub fn prune(&self) {
        let owners: Vec<Rc<Owner>> = self.owners.borrow().iter().filter_map(Weak::upgrade).collect();
        owners.iter().for_each(|owner| owner.prune_mode());
    }

    /// Ends a capture whose owner, node or focus went, or that a host dialog took.
    fn prune_capture(&self, host: &dyn Host) {
        let stale = self.capture.borrow().as_ref().is_some_and(|capture| {
            let owner = capture.owner.upgrade().filter(|owner| owner.alive());
            let node = owner.and_then(|owner| owner.lookup.as_ref().and_then(|lookup| lookup(&capture.node)));
            node.is_none() || host.modal_open() || host.app().focused().map(|widget| widget.id()) != capture.focus
        });
        if stale {
            self.capture.borrow_mut().take();
        }
    }

    /// Opens `overlay` of plugin `plugin` for `opener`, built by `build` into its frame; it replaces the plugin's
    /// overlay on screen.
    pub(crate) fn open(
        &self,
        host: &dyn Host,
        plugin: &str,
        overlay: &input::Overlay,
        opener: &Rc<Owner>,
        build: impl FnOnce(&View) -> Option<Box<dyn crate::Claimed>>,
    ) {
        let Some(layer) = host.overlay_layer() else {
            log::warn!("plugin {plugin}: this host shows no overlay");
            return;
        };
        if host.modal_open() {
            log::warn!("plugin {plugin}: a dialog of the host has the focus, so its overlay does not open");
            return;
        }
        self.close_all(host, plugin, true);
        // The opener heard the overlay it replaces close, and may have failed doing so.
        if !opener.alive() {
            return;
        }
        let app = host.app();
        let size = (overlay.width, overlay.height);
        let Some((x, y, w, h)) = self.place(host, plugin, &overlay.anchor, size, opener) else { return };
        let backdrop = View::new(app).absolute().width(Length::percent(100.0)).height(Length::percent(100.0));
        let frame = View::new(app)
            .absolute()
            .position(opentui::layout::Edge::Left, x)
            .position(opentui::layout::Edge::Top, y)
            .width(w)
            .height(h)
            .focusable(true);
        // Building runs no view: the first waits for the frame's first layout.
        let Some(mount) = build(&frame) else { return };
        self.show(host, plugin, overlay, opener, layer, backdrop, frame, mount);
    }

    /// Where an overlay of `plugin` anchored at `anchor`, of `size`, shows now: its cell and size, on the screen.
    fn place(
        &self,
        host: &dyn Host,
        plugin: &str,
        anchor: &Anchor,
        size: (u16, u16),
        opener: &Rc<Owner>,
    ) -> Option<(u16, u16, u16, u16)> {
        let (width, height) = host.app().size();
        let (w, h) = (size.0.clamp(1, width.max(1)), size.1.clamp(1, height.max(1)));
        let (x, y) = match anchor {
            Anchor::Point { x, y } => (*x, *y),
            Anchor::Node { node } => opener
                .rect(node)
                .map_or((0, 0), |rect| (rect.x.max(0) as u16, (rect.y + rect.height as i32).max(0) as u16)),
            Anchor::Edge(input::Edge::Top) => (width.saturating_sub(w) / 2, 0),
            Anchor::Edge(input::Edge::Bottom) => (width.saturating_sub(w) / 2, height.saturating_sub(h)),
            Anchor::Edge(input::Edge::Left) => (0, height.saturating_sub(h) / 2),
            Anchor::Edge(input::Edge::Right) => (width.saturating_sub(w), height.saturating_sub(h) / 2),
            Anchor::Surface { surface, edge } => {
                let Some((left, top, across, down)) = self.area(plugin, surface) else {
                    log::warn!("plugin {plugin}: its overlay is anchored to {surface:?}, which does not show");
                    return None;
                };
                let (middle_x, middle_y) = (left + across.saturating_sub(w) / 2, top + down.saturating_sub(h) / 2);
                match edge {
                    input::Edge::Top => (middle_x, top),
                    input::Edge::Bottom => (middle_x, (top + down).saturating_sub(h)),
                    input::Edge::Left => (left, middle_y),
                    input::Edge::Right => ((left + across).saturating_sub(w), middle_y),
                }
            }
        };
        Some((x.min(width.saturating_sub(w)), y.min(height.saturating_sub(h)), w, h))
    }

    /// Opens the overlay the open arguments describe; split from [`Router::open`] for its frame.
    #[allow(clippy::too_many_arguments)]
    fn show(
        &self,
        host: &dyn Host,
        plugin: &str,
        overlay: &input::Overlay,
        opener: &Rc<Owner>,
        layer: View,
        backdrop: View,
        frame: View,
        mount: Box<dyn crate::Claimed>,
    ) {
        let app = host.app();
        // A press or a wheel outside the overlay closes it and goes no further, as a menu's does.
        let (closing, surface, owner) = (opener.host.clone(), overlay.surface.clone(), plugin.to_owned());
        backdrop.on_mouse(move |cx, event| {
            if !matches!(event.kind, MouseEventKind::Down(_) | MouseEventKind::ScrollUp | MouseEventKind::ScrollDown) {
                return;
            }
            cx.stop_propagation();
            let (closing, surface, owner) = (closing.clone(), surface.clone(), owner.clone());
            cx.app().defer(move |_| {
                if let Some(host) = closing.upgrade()
                    && let Some(router) = host.router()
                {
                    router.close(&*host, &owner, &surface, true);
                }
            });
        });
        let (closing, surface, owner) = (opener.host.clone(), overlay.surface.clone(), plugin.to_owned());
        let escape = TuiCommand::inline("escape", move |_, _| {
            let (closing, surface, owner) = (closing.clone(), surface.clone(), owner.clone());
            // After the key: the layer that runs it goes with the overlay.
            if let Some(host) = closing.upgrade() {
                host.app().defer(move |_| {
                    if let Some(host) = closing.upgrade()
                        && let Some(router) = host.router()
                    {
                        router.close(&*host, &owner, &surface, true);
                    }
                });
            }
        });
        // In every mode: a mode of the overlay without its own escape keeps this one.
        let escape = host.keymap().layer(KeymapLayer::global(vec![escape]).priority(1).target(frame.id()));
        layer.add(&backdrop);
        layer.add(&frame);
        layer.visible(true);
        refocus(host, || app.focus(&frame));
        self.overlays.borrow_mut().push(Shown {
            plugin: plugin.to_owned(),
            surface: overlay.surface.clone(),
            opener: Rc::downgrade(opener),
            frame,
            backdrop,
            anchor: overlay.anchor.clone(),
            size: (overlay.width, overlay.height),
            _escape: escape.map_err(|error| log::error!("plugin {plugin} overlay keymap layer: {error}")).ok(),
            mount,
        });
        app.request_redraw();
    }

    /// Closes plugin `plugin`'s overlay `surface`; `tell` sends its opener [`Event::Closed`].
    /// Closes the overlay that has the focus, telling its opener, as the reserved chord does; whether one had it.
    pub fn close_focused(&self, host: &dyn Host) -> bool {
        let focused = self
            .overlays
            .borrow()
            .iter()
            .find(|shown| focus_within(host.app(), shown.frame.id()))
            .map(|shown| (shown.plugin.clone(), shown.surface.clone()));
        let Some((plugin, surface)) = focused else { return false };
        self.close(host, &plugin, &surface, true);
        true
    }

    pub(crate) fn close(&self, host: &dyn Host, plugin: &str, surface: &str, tell: bool) {
        let shown = {
            let mut overlays = self.overlays.borrow_mut();
            let at = overlays.iter().position(|shown| shown.plugin == plugin && shown.surface == surface);
            at.map(|at| overlays.remove(at))
        };
        let Some(shown) = shown else { return };
        let had_focus = focus_within(host.app(), shown.frame.id());
        shown.frame.detach();
        shown.backdrop.detach();
        if let Some(layer) = host.overlay_layer() {
            layer.visible(!layer.children().is_empty());
        }
        let opener = shown.opener.upgrade().filter(|opener| opener.alive());
        drop(shown);
        // The focus goes to the overlay on top, else back to where this one was opened from.
        let top = self.overlays.borrow().last().map(|shown| shown.frame.clone());
        let back = top.or_else(|| opener.as_ref().and_then(|opener| opener.within()));
        match back {
            Some(view) if had_focus => refocus(host, || host.app().focus(&view)),
            None if had_focus => host.focus_composer(),
            _ => {}
        }
        if let (Some(opener), true) = (opener, tell) {
            opener.send(host, &Event::Closed { surface: surface.to_owned() });
        }
        host.app().request_redraw();
    }

    /// Closes every overlay of plugin `plugin`; `tell` sends their openers [`Event::Closed`].
    pub(crate) fn close_all(&self, host: &dyn Host, plugin: &str, tell: bool) {
        let open: Vec<String> =
            self.overlays.borrow().iter().filter(|shown| shown.plugin == plugin).map(|s| s.surface.clone()).collect();
        for surface in open {
            self.close(host, plugin, &surface, tell);
        }
    }
}

/// Ends, as `view` loses the focus, a capture that began with the focus there and the modes whose scope the focus
/// is not in now, before any key comes.
fn blurs(view: &impl Widget, host: &Weak<dyn Host>) {
    let (host, id) = (host.clone(), view.id());
    view.on_focus(move |_, focused| {
        if !focused
            && let Some(host) = host.upgrade()
            && let Some(router) = host.router()
        {
            router.blurred(id);
        }
    });
}

/// Moves the focus with `move_focus`, and ends at the move the modes whose scope it leaves and a capture it moves away
/// from: OpenTUI tells a widget of its focus after the event, when a second move may have brought the focus back.
pub fn refocus(host: &dyn Host, move_focus: impl FnOnce()) {
    let Some(router) = host.router() else {
        move_focus();
        return host.focus_moved();
    };
    let owners: Vec<Rc<Owner>> = router.owners.borrow().iter().filter_map(Weak::upgrade).collect();
    let moded: Vec<Rc<Owner>> =
        owners.into_iter().filter(|owner| owner.mode.borrow().is_some() && owner.mode_holds()).collect();
    move_focus();
    host.focus_moved();
    for owner in moded.iter().filter(|owner| !owner.mode_holds()) {
        if let Some(mode) = &*owner.mode.borrow() {
            mode.ended.set(true);
        }
    }
    let now = focused(host.app());
    let moved = router.capture.borrow().as_ref().is_some_and(|capture| capture.focus != now);
    if moved {
        router.capture.borrow_mut().take();
    }
}

/// The stroke of `event` as the keymap names it, and the text it types: a chord types nothing, only shift may be held.
pub(crate) fn key_of(event: &KeyEvent) -> (String, Option<String>) {
    let plain = event.modifiers.without_locks().bits() & !Modifiers::SHIFT.bits() == 0;
    let text = match event.code {
        KeyCode::Char(character) if plain => Some(character.to_string()),
        _ => None,
    };
    (Stroke::from_event(event).to_string(), text)
}

/// The id of the focused widget.
fn focused(app: &App) -> Option<u32> {
    app.focused().map(|widget| widget.id())
}

/// Calls `deliver` with `event`, as the user's input when the user caused it ([`Event::by_user`]), which a verb on the
/// transcript needs (P3's rule), on either carrier; a hover or a close keeps what the code that sent it is.
fn delivered(deliver: &Deliver, host: &dyn Host, owner: &Rc<Owner>, event: &Event) -> Handled {
    match event.by_user() {
        Some(user) => crate::behave::as_user(user, || deliver(host, owner, event)),
        None => deliver(host, owner, event),
    }
}

/// Whether key `key` is or holds the reserved chord, however it is spelled (`ctrl+c`, `Control + C`).
pub fn reserved(host: &dyn Host, key: &str) -> bool {
    let keymap = host.keymap();
    let Ok(chord) = keymap.keymap().parse_key(input::RESERVED) else { return false };
    keymap.keymap().parse_key_sequence(key).is_ok_and(|parts| parts.iter().any(|part| part.stroke == chord.stroke))
}

/// Where a paste landed, which decides the paste listeners it is offered to.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Pasted {
    /// The composer, before its own route.
    Composer,
    /// A plugin's panel or overlay, before the host's route.
    Surface,
    /// Anywhere else, once no widget took it.
    Elsewhere,
}

/// Whether the focus is in the widget with id `id`.
/// Whether `key` (the host's keybind syntax) types text in an input: an alternative whose first stroke is one character
/// or `space`, with no modifier but Shift.
fn printable(key: &str) -> bool {
    key.split(',').filter_map(|alternative| alternative.split_whitespace().next()).any(|stroke| {
        let (modifiers, name) = match stroke.strip_suffix("++") {
            Some(modifiers) => (modifiers, "+"),
            None => stroke.rsplit_once('+').unwrap_or(("", stroke)),
        };
        let name = if name.is_empty() { "+" } else { name };
        let plain = modifiers.split('+').filter(|part| !part.is_empty()).all(|part| part.eq_ignore_ascii_case("shift"));
        let typed =
            name.eq_ignore_ascii_case("space") || (name.chars().count() == 1 && !name.chars().any(char::is_control));
        plain && typed
    })
}

fn focus_within(app: &App, id: u32) -> bool {
    std::iter::successors(app.focused(), |widget| widget.parent()).any(|widget| widget.id() == id)
}

/// A wired box's colors off and under the pointer, and whether the pointer is over it.
pub(crate) struct Wired {
    /// The widget, which its handlers reach weakly, so it drops with its node.
    _widget: Rc<dyn Any>,
    pub base: Cell<Color>,
    pub hover: Cell<Option<Color>>,
    pub over: Cell<bool>,
}

impl Wired {
    /// The color the box shows now.
    pub fn shown(&self) -> Color {
        match (self.over.get(), self.hover.get()) {
            (true, Some(hover)) => hover,
            _ => self.base.get(),
        }
    }
}

/// Wires `view`, a box or a text with id `id`, for `interact`: focus on a press, pointer events, the hover background
/// (`paint` sets it) and its events, all reaching `owner`'s handler.
pub(crate) fn wire<W: Widget + Clone + 'static>(
    view: &W,
    paint: fn(&W, Color),
    id: Option<&str>,
    interact: &Interact,
    owner: Option<&Weak<Owner>>,
    base: Color,
    hover: Option<Color>,
) -> Rc<Wired> {
    let widget = Rc::new(view.clone());
    let this = Rc::downgrade(&widget);
    let wired =
        Rc::new(Wired { _widget: widget, base: Cell::new(base), hover: Cell::new(hover), over: Cell::new(false) });
    let node = id.map(str::to_owned);
    if interact.focusable && node.is_some() {
        view.focusable(true);
        if let Some(owner) = owner.and_then(Weak::upgrade) {
            blurs(view, &owner.host);
        }
    }
    if interact.hover.is_some() || interact.hover_events {
        let (state, this, owner, node) = (Rc::downgrade(&wired), this.clone(), owner.cloned(), node.clone());
        let events = interact.hover_events;
        view.on_hover(move |cx, inside| {
            let Some(state) = state.upgrade() else { return };
            state.over.set(inside);
            if let (Some(_), Some(this)) = (state.hover.get(), this.upgrade()) {
                paint(&this, state.shown());
                cx.app().request_redraw();
            }
            let owner = owner.as_ref().and_then(Weak::upgrade);
            if let (true, Some(owner), Some(node)) = (events, owner, &node)
                && let Some(host) = owner.host.upgrade()
            {
                owner.send(&*host, &Event::Hover { node: node.clone(), inside });
                crate::flush();
            }
        });
    }
    let (Some(owner), Some(node)) = (owner.cloned(), node) else { return wired };
    if interact.pointer || interact.focusable {
        let (pointer, focusable, this, owner, node) =
            (interact.pointer, interact.focusable, this, owner.clone(), node.clone());
        view.on_mouse(move |cx, event| {
            let Some(owner) = owner.upgrade().filter(|owner| owner.alive()) else { return };
            let (Some(host), Some(this)) = (owner.host.upgrade(), this.upgrade()) else { return };
            if focusable && matches!(event.kind, MouseEventKind::Down(_)) {
                cx.app().focus(&*this);
            }
            if pointer && pointed(&*host, &owner, &node, &*this, event) == Handled::Consume {
                cx.stop_propagation();
                cx.prevent_default();
            }
        });
    }
    if interact.pointer {
        view.on_drop(move |cx, source, event| {
            let Some(owner) = owner.upgrade().filter(|owner| owner.alive()) else { return };
            // A host dialog's backdrop takes a drop over it, so none lands here under one.
            let Some(host) = owner.host.upgrade() else { return };
            // A drop counts only from a node of the plugin's, in this mount or another of its mounts.
            let Some(from) = host.router().and_then(|router| router.dragged(&owner.plugin, source)) else { return };
            let rect = owner.rect(&node).unwrap_or_default();
            let event = Event::Pointer(Pointer {
                node: node.clone(),
                kind: PointerKind::Drop,
                button: None,
                x: i32::from(event.x) - rect.x,
                y: i32::from(event.y) - rect.y,
                screen_x: event.x,
                screen_y: event.y,
                from: Some(from),
            });
            if owner.send(&*host, &event) == Handled::Consume {
                cx.stop_propagation();
            }
            crate::flush();
        });
    }
    wired
}

/// Routes a mouse event on node `node` of `owner`; drags reach it only while it holds the capture.
fn pointed(host: &dyn Host, owner: &Rc<Owner>, node: &str, view: &impl Widget, event: &MouseEvent) -> Handled {
    let Some(router) = host.router() else { return Handled::Pass };
    router.prune_capture(host);
    // A dialog of the host over it: a release or a drag that OpenTUI still sends to the pressed node is not the plugin's.
    if host.modal_open() {
        return Handled::Pass;
    }
    let me = Rc::downgrade(owner);
    let captured =
        || router.capture.borrow().as_ref().is_some_and(|capture| capture.owner.ptr_eq(&me) && capture.node == node);
    let (kind, button) = match event.kind {
        MouseEventKind::Down(button) => (PointerKind::Down, Some(button)),
        MouseEventKind::Up(button) => (PointerKind::Up, Some(button)),
        MouseEventKind::Drag(button) if captured() => (PointerKind::Drag, Some(button)),
        MouseEventKind::ScrollUp => (PointerKind::WheelUp, None),
        MouseEventKind::ScrollDown => (PointerKind::WheelDown, None),
        _ => return Handled::Pass,
    };
    let rect = view.rect();
    let pointer = Pointer {
        node: node.to_owned(),
        kind,
        button: button.and_then(|button| match button {
            MouseButton::Left => Some(Button::Left),
            MouseButton::Middle => Some(Button::Middle),
            MouseButton::Right => Some(Button::Right),
            _ => None,
        }),
        x: i32::from(event.x) - rect.screen_x as i32,
        y: i32::from(event.y) - rect.screen_y as i32,
        screen_x: event.x,
        screen_y: event.y,
        from: None,
    };
    let handled = owner.send(host, &Event::Pointer(pointer));
    // What the handler asked for, a focus among it, applies before the capture records the focus.
    crate::flush();
    match kind {
        PointerKind::Down if handled == Handled::Consume => {
            // The press is the plugin's: no selection of the text under it starts, and a surface that does not have
            // the focus takes it, unless the handler gave it to a node.
            host.app().clear_selection();
            // An overlay the handler opened keeps the focus it took (review carbon-1).
            if let Some(view) = owner.within().filter(|view| !focus_within(host.app(), view.id()))
                && !router.overlaid(host)
            {
                refocus(host, || host.app().focus(&view));
            }
            let focus = host.app().focused().map(|widget| widget.id());
            *router.capture.borrow_mut() = Some(Capture { owner: me.clone(), node: node.to_owned(), focus });
        }
        PointerKind::Up if captured() => drop(router.capture.borrow_mut().take()),
        _ => {}
    }
    handled
}

#[cfg(test)]
mod tests {
    // Expected (FT-14): a key types text when one of its alternatives starts with a character or `space` and no
    // modifier but Shift.
    #[test]
    fn a_printable_key_types_text() {
        for key in ["h", "H", "shift+h", "?", "]", "+", "space", "ctrl+a,h", "g g"] {
            assert!(super::printable(key), "{key}");
        }
        for key in ["ctrl+h", "alt+h", "meta+h", "super+h", "escape", "f6", "return", "<leader>h", "ctrl++", ""] {
            assert!(!super::printable(key), "{key}");
        }
    }
}
