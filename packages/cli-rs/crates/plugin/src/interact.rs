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
//! | any | a key, not held | the same | the intercept: the reserved chord ends every plugin mode and goes on; else the listeners in order (priority, then newest) until one consumes; else the keymap's layers |
//! | any | a handler returns | the same | its effects apply before the next event of the batch (the TUI flushes after each key) |
//! | free | a consumed [`Bind::hold`] key | held | the keys after it are buffered until `release_keys` or [`input::HOLD`] |
//! | held | release or [`input::HOLD`] | free | the buffered keys are routed in order, after the batch |
//! | no mode | `set_mode(m)` | mode m | the keymap's mode is the plugin's `m`: its layers of `m` hold, base layers do not |
//! | mode m | the owner's scope loses the focus, the reserved chord, `set_mode(None)`, the owner ends | no mode | the mode is gone for good |
//! | no capture | a press on a pointer node, consumed | captured | its drags reach it |
//! | captured | release, the owner ends, the node leaves its tree, the focus moves, a host dialog opens | no capture | |
//! | any | the owner ends | gone | its layers, listeners, mode, capture, hold and overlays go |

use std::any::Any;
use std::cell::{Cell, RefCell};
use std::rc::{Rc, Weak};

use opencode_plugin_abi::interact::{
    self as input, Anchor, Bind, Button, Event, Handled, Interact, Layer, LayerScope, Pointer, PointerKind,
};
use opencode_ui::keymap::{BASE_MODE, KeymapLayer, TuiCommand};
use opentui::input::{KeyCode, KeyEvent, Modifiers, MouseButton, MouseEvent, MouseEventKind};
use opentui::keymap::{Condition, Disposer, Stroke};
use opentui::prelude::*;

use crate::Host;

/// Calls a handler as one call of its plugin: [`Handled::Pass`] when the plugin is not called.
pub(crate) type Deliver = Rc<dyn Fn(&dyn Host, &Rc<Owner>, &Event) -> Handled>;
/// The widget of a node of the owner's tree, by id.
pub(crate) type Lookup = Rc<dyn Fn(&str) -> Option<AnyWidget>>;

/// What one owner holds of the input.
pub struct Owner {
    plugin: String,
    host: Weak<dyn Host>,
    /// The mount's handler, which its nodes' pointer and hover and its overlays' closes reach; `None` for an
    /// activation, whose layers each have their own.
    deliver: Option<Deliver>,
    /// The mount's surface root; `None` for an activation.
    root: Option<View>,
    /// Where a layer of its surface's own scope holds (`LayerScope::Surface`).
    held: RefCell<Held>,
    lookup: Option<Lookup>,
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
}

struct Mode {
    name: String,
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

struct Hold {
    owner: Weak<Owner>,
    keys: Vec<KeyEvent>,
    /// Released: the keys are being routed again, after the batch.
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
    /// Escape, which closes it unless a layer of the overlay above priority 1 takes the key.
    _escape: Option<Disposer>,
    _mount: Box<dyn Any>,
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
    replaying: Cell<bool>,
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
    pub held: usize,
}

/// The input registrations of `host` now.
pub fn ledger(host: &dyn Host) -> Ledger {
    let keymap = host.keymap();
    let mut ledger = Ledger { layers: keymap.layer_count(), modes: keymap.mode_count(), ..Ledger::default() };
    ledger.overlays = host.overlay_layer().map_or(0, |layer| layer.children().len());
    if let Some(router) = host.router() {
        router.prune_capture(host);
        ledger.listeners = router.listeners.borrow().len();
        ledger.capture = router.capture.borrow().is_some();
        ledger.held = router.hold.borrow().as_ref().map_or(0, |hold| hold.keys.len());
    }
    ledger
}

impl Owner {
    /// A mount's owner: its surface root, its tree's lookup and its handler.
    pub(crate) fn mount(
        plugin: &str,
        host: Weak<dyn Host>,
        root: View,
        lookup: Lookup,
        deliver: Option<Deliver>,
    ) -> Rc<Self> {
        Rc::new(Self::new(plugin, host, Some(root), Some(lookup), deliver))
    }

    /// An activation's owner, which has no surface.
    pub(crate) fn activation(plugin: &str, host: Weak<dyn Host>) -> Rc<Self> {
        Rc::new(Self::new(plugin, host, None, None, None))
    }

    fn new(
        plugin: &str,
        host: Weak<dyn Host>,
        root: Option<View>,
        lookup: Option<Lookup>,
        deliver: Option<Deliver>,
    ) -> Self {
        Self {
            plugin: plugin.to_owned(),
            host,
            deliver,
            held: RefCell::new(root.clone().map_or(Held::Route, Held::Within)),
            root,
            lookup,
            alive: Cell::new(true),
            ended: Cell::new(false),
            composer: Cell::new(false),
            layers: RefCell::default(),
            mode: RefCell::default(),
            ids: RefCell::default(),
            focusable: RefCell::default(),
        }
    }

    pub fn alive(&self) -> bool {
        self.alive.get()
    }

    /// The scope of the surface is the focus in `view`, the container the host shows it in: a panel, an overlay.
    pub(crate) fn hold_in(&self, view: View) {
        blurs(&view, &self.host);
        // A paste in it goes to the layers that declare pastes, before the host's paste route.
        let host = self.host.clone();
        view.on_paste(move |cx, text| {
            if let Some(host) = host.upgrade()
                && let Some(router) = host.router()
                && router.paste(&*host, text, false)
            {
                cx.prevent_default();
                cx.stop_propagation();
            }
        });
        *self.held.borrow_mut() = Held::Within(view);
    }

    /// The scope of the surface is its route's showing.
    pub(crate) fn hold_route(&self) {
        *self.held.borrow_mut() = Held::Route;
    }

    /// The view whose focus is the surface's, if its scope is one.
    fn within(&self) -> Option<View> {
        match &*self.held.borrow() {
            Held::Within(view) if self.root.is_some() => Some(view.clone()),
            _ => None,
        }
    }

    /// Whether the focus is in the surface's scope, or its route shows with no dialog over it.
    fn in_surface(&self, host: &dyn Host) -> bool {
        match (&*self.held.borrow(), &self.root) {
            (_, None) => false,
            (Held::Within(view), Some(_)) => focus_within(host.app(), view.id()),
            (Held::Route, Some(_)) => !host.modal_open(),
        }
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
            let commands: Vec<TuiCommand> = layer
                .keys
                .iter()
                .filter(|bind| {
                    let reserved = same_key(&bind.key, input::RESERVED);
                    if reserved {
                        log::warn!("plugin {}: no layer may bind {}", self.plugin, input::RESERVED);
                    }
                    !reserved
                })
                .map(|bind| self.command(bind, deliver))
                .collect();
            if commands.is_empty() {
                continue;
            }
            let (owner, scope) = (me.clone(), layer.scope.clone());
            let enabled = Condition::when(move || owner.upgrade().is_some_and(|owner| owner.holds(&scope)));
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

    /// The keymap command of `bind`, which calls the handler and holds the keys after it if it asks.
    fn command(self: &Rc<Self>, bind: &Bind, deliver: &Deliver) -> TuiCommand {
        let (owner, deliver, bind) = (Rc::downgrade(self), deliver.clone(), bind.clone());
        let mut command = TuiCommand::inline(bind.key.clone(), move |_, _| {
            let Some(owner) = owner.upgrade().filter(|owner| owner.alive()) else { return false };
            let Some(host) = owner.host.upgrade() else { return false };
            let event = Event::Key(input::Key { bind: Some(bind.name.clone()), key: bind.key.clone(), text: None });
            let handled = deliver(&*host, &owner, &event) == Handled::Consume;
            if handled
                && bind.hold
                && let Some(router) = host.router()
            {
                router.hold(&*host, &owner);
            }
            handled
        });
        if let Some(title) = &bind.title {
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

    /// Whether `scope` holds for this owner now.
    fn holds(&self, scope: &LayerScope) -> bool {
        if !self.alive() {
            return false;
        }
        let Some(host) = self.host.upgrade() else { return false };
        match scope {
            LayerScope::Global => true,
            LayerScope::Composer => host.composer_focused(),
            LayerScope::Surface => self.in_surface(&*host),
            LayerScope::Node(id) => {
                let node = self.lookup.as_ref().and_then(|lookup| lookup(id));
                node.is_some_and(|node| focus_within(host.app(), node.id()))
            }
        }
    }

    /// The scope a mode of this owner holds in: the composer for an owner with a layer there, else its surface,
    /// else everywhere.
    fn mode_holds(&self) -> bool {
        match (self.composer.get(), &self.root) {
            (true, _) => self.holds(&LayerScope::Composer),
            (false, Some(_)) => self.holds(&LayerScope::Surface),
            (false, None) => self.alive(),
        }
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
        let Some(name) = mode.filter(|_| self.alive() && self.mode_holds()) else { return };
        let ended = Rc::new(Cell::new(false));
        let (owner, flag) = (Rc::downgrade(self), ended.clone());
        // A blur of its scope prunes it (`blurs`), so a focus that comes back does not bring it back.
        let active = Condition::when(move || !flag.get() && owner.upgrade().is_some_and(|owner| owner.mode_holds()));
        let disposer = host.keymap().push_mode(&self.mode_key(Some(name)), active);
        *self.mode.borrow_mut() = Some(Mode { name: name.to_owned(), ended, disposer });
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
        let (Some(host), Some(_), Some(lookup)) = (self.host.upgrade(), &self.root, &self.lookup) else {
            return input::Focused::default();
        };
        let path: Vec<u32> =
            std::iter::successors(host.app().focused(), |widget| widget.parent()).map(|widget| widget.id()).collect();
        // The nearest node with an id that holds the focus.
        let node = self
            .ids
            .borrow()
            .iter()
            .filter_map(|id| {
                let at = lookup(id).and_then(|widget| path.iter().position(|step| *step == widget.id()))?;
                Some((at, id.clone()))
            })
            .min_by_key(|(at, _)| *at)
            .map(|(_, id)| id);
        input::Focused { node, surface: self.within().is_some_and(|view| path.contains(&view.id())) }
    }

    /// Records the ids of the tree's nodes, and of the focusable ones, which [`Owner::focus`] may focus.
    pub(crate) fn set_tree(&self, ids: Vec<String>, focusable: Vec<String>) {
        *self.ids.borrow_mut() = ids;
        *self.focusable.borrow_mut() = focusable;
    }

    /// Gives the focus to the owner's node `id`, if it is focusable.
    pub(crate) fn focus(&self, host: &dyn Host, id: &str) {
        let focusable = self.focusable.borrow().iter().any(|known| known == id);
        match self.lookup.as_ref().and_then(|lookup| lookup(id)).filter(|_| focusable && self.alive()) {
            Some(widget) => host.app().focus(&widget),
            None => log::warn!("plugin {}: {id:?} is not a focusable node of its mount", self.plugin),
        }
    }

    /// Gives the composer the focus, if the owner's surface has it.
    pub(crate) fn blur(&self, host: &dyn Host) {
        if self.within().is_some_and(|view| focus_within(host.app(), view.id())) {
            host.focus_composer();
        }
    }

    /// Whether its tree holds a node with id `id`.
    pub(crate) fn has(&self, id: &str) -> bool {
        self.ids.borrow().iter().any(|known| known == id)
    }

    /// Calls the mount's handler with `event`.
    fn send(self: &Rc<Self>, host: &dyn Host, event: &Event) -> Handled {
        match (&self.deliver, self.alive()) {
            (Some(deliver), true) => deliver(host, self, event),
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
            let held = router.hold.borrow().as_ref().is_some_and(|hold| hold.owner.ptr_eq(&me));
            if held {
                // The keys it held go on as if it had not been there.
                router.release(&self.host);
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
        let weak = weak.clone();
        let disposer = host.keymap().keymap().intercept_key(i32::MAX, false, move |context| {
            let Some(host) = weak.upgrade() else { return };
            let Some(router) = host.router() else { return };
            if router.intercept(&*host, &context.event, &context.stroke) {
                context.consume();
            }
        });
        *self.intercept.borrow_mut() = Some(disposer);
    }

    /// What the intercept does with a key: whether it is taken.
    fn intercept(&self, host: &dyn Host, event: &KeyEvent, stroke: &Stroke) -> bool {
        if !self.replaying.get()
            && let Some(held) = self.hold.borrow_mut().as_mut()
        {
            held.keys.push(*event);
            return true;
        }
        let key = stroke.to_string();
        if same_key(&key, input::RESERVED) {
            // Every plugin mode ends; the chord goes on to the app.
            for owner in self.owners.borrow().iter().filter_map(Weak::upgrade) {
                if let Some(mode) = &*owner.mode.borrow() {
                    mode.ended.set(true);
                }
            }
            return false;
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
        let text = match event.code {
            KeyCode::Char(character) if !event.modifiers.contains(Modifiers::CTRL) => Some(character.to_string()),
            _ => None,
        };
        let event = Event::Key(input::Key { bind: None, key, text });
        listeners.into_iter().any(|(_, _, owner, deliver)| deliver(host, &owner, &event) == Handled::Consume)
    }

    /// Holds the keys after a consumed hold key of `owner`, until it releases them or [`input::HOLD`] passes.
    fn hold(&self, host: &dyn Host, owner: &Rc<Owner>) {
        if self.hold.borrow().is_some() {
            return;
        }
        *self.hold.borrow_mut() = Some(Hold { owner: Rc::downgrade(owner), keys: Vec::new(), draining: false });
        let weak = owner.host.clone();
        host.app().set_timeout(input::HOLD, move |_| {
            if let Some(host) = weak.upgrade()
                && let Some(router) = host.router()
            {
                router.release(&weak);
            }
        });
    }

    /// Routes the held keys in order, after the batch that runs now.
    pub(crate) fn release(&self, weak: &Weak<dyn Host>) {
        let Some(host) = weak.upgrade() else { return };
        {
            let mut hold = self.hold.borrow_mut();
            match hold.as_mut() {
                Some(held) if !held.draining => held.draining = true,
                _ => return,
            }
        }
        let weak = weak.clone();
        host.app().defer(move |_| {
            let Some(host) = weak.upgrade() else { return };
            let Some(router) = host.router() else { return };
            // Keys that arrive while these are routed again join the end, so the order holds.
            loop {
                let next = {
                    let mut hold = router.hold.borrow_mut();
                    match hold.as_mut() {
                        Some(held) if !held.keys.is_empty() => Some(held.keys.remove(0)),
                        _ => {
                            hold.take();
                            None
                        }
                    }
                };
                let Some(key) = next else { break };
                router.replaying.set(true);
                host.app().dispatch(opentui::input::Event::Key(key));
                router.replaying.set(false);
            }
        });
    }

    /// Offers `text` to the paste listeners of the composer (`composer`), or of the focused surfaces, that hold now,
    /// the newest first; whether one took it. Its effects apply before the paste returns.
    pub fn paste(&self, host: &dyn Host, text: &str, composer: bool) -> bool {
        let current = host.keymap().mode();
        let listeners: Vec<(Rc<Owner>, Deliver)> = self
            .listeners
            .borrow()
            .iter()
            .rev()
            .filter(|listener| listener.layer.paste && (listener.layer.scope == LayerScope::Composer) == composer)
            .filter_map(|listener| {
                let owner = listener.owner.upgrade()?;
                let mode = owner.mode_key(listener.layer.mode.as_deref());
                (owner.holds(&listener.layer.scope) && mode == current).then(|| (owner, listener.deliver.clone()))
            })
            .collect();
        let event = Event::Paste { text: text.to_owned() };
        let taken = listeners.into_iter().any(|(owner, deliver)| deliver(host, &owner, &event) == Handled::Consume);
        crate::flush();
        taken
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
        build: impl FnOnce(&View) -> Option<Box<dyn Any>>,
    ) {
        let Some(layer) = host.overlay_layer() else {
            log::warn!("plugin {plugin}: this host shows no overlay");
            return;
        };
        self.close_all(host, plugin, true);
        let app = host.app();
        let (width, height) = app.size();
        let (w, h) = (overlay.width.clamp(1, width.max(1)), overlay.height.clamp(1, height.max(1)));
        let (x, y) = match &overlay.anchor {
            Anchor::Point { x, y } => (*x, *y),
            Anchor::Node { node } => opener
                .rect(node)
                .map_or((0, 0), |rect| (rect.x.max(0) as u16, (rect.y + rect.height as i32).max(0) as u16)),
            Anchor::Edge(input::Edge::Top) => (width.saturating_sub(w) / 2, 0),
            Anchor::Edge(input::Edge::Bottom) => (width.saturating_sub(w) / 2, height.saturating_sub(h)),
            Anchor::Edge(input::Edge::Left) => (0, height.saturating_sub(h) / 2),
            Anchor::Edge(input::Edge::Right) => (width.saturating_sub(w), height.saturating_sub(h) / 2),
        };
        let (x, y) = (x.min(width.saturating_sub(w)), y.min(height.saturating_sub(h)));
        let backdrop = View::new(app).absolute().width(Length::percent(100.0)).height(Length::percent(100.0));
        let frame = View::new(app)
            .absolute()
            .position(opentui::layout::Edge::Left, x)
            .position(opentui::layout::Edge::Top, y)
            .width(w)
            .height(h)
            .focusable(true);
        let Some(mount) = build(&frame) else { return };
        // A press outside the overlay closes it and goes no further, as a menu's does.
        let (closing, surface, owner) = (opener.host.clone(), overlay.surface.clone(), plugin.to_owned());
        backdrop.on_mouse(move |cx, event| {
            if !matches!(event.kind, MouseEventKind::Down(_)) {
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
        let escape = host.keymap().layer(KeymapLayer::new(vec![escape]).priority(1).target(frame.id()));
        layer.add(&backdrop);
        layer.add(&frame);
        layer.visible(true);
        app.focus(&frame);
        self.overlays.borrow_mut().push(Shown {
            plugin: plugin.to_owned(),
            surface: overlay.surface.clone(),
            opener: Rc::downgrade(opener),
            frame,
            backdrop,
            _escape: escape.map_err(|error| log::error!("plugin {plugin} overlay keymap layer: {error}")).ok(),
            _mount: mount,
        });
        app.request_redraw();
    }

    /// Closes plugin `plugin`'s overlay `surface`; `tell` sends its opener [`Event::Closed`].
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
        match opener {
            Some(opener) => {
                // The focus goes back to where the overlay was opened from.
                if had_focus && let Some(view) = opener.within() {
                    host.app().focus(&view);
                } else if had_focus {
                    host.focus_composer();
                }
                if tell {
                    opener.send(host, &Event::Closed { surface: surface.to_owned() });
                }
            }
            None if had_focus => host.focus_composer(),
            None => {}
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

/// Ends the modes whose scope `view` was when it loses the focus, before any key comes: a focus that leaves a mode's
/// scope and comes back between two keys does not bring the mode back.
fn blurs(view: &View, host: &Weak<dyn Host>) {
    let host = host.clone();
    view.on_focus(move |_, focused| {
        if !focused
            && let Some(host) = host.upgrade()
            && let Some(router) = host.router()
        {
            router.prune();
        }
    });
}

/// Whether the focus is in the widget with id `id`.
fn focus_within(app: &App, id: u32) -> bool {
    std::iter::successors(app.focused(), |widget| widget.parent()).any(|widget| widget.id() == id)
}

/// Whether two shortcuts name the same key, such as `Ctrl+C` and `ctrl+c`.
fn same_key(a: &str, b: &str) -> bool {
    a.trim().eq_ignore_ascii_case(b.trim())
}

/// A wired box's colors off and under the pointer, and whether the pointer is over it.
pub(crate) struct Wired {
    /// The box, which its handlers reach weakly, so it drops with its node.
    view: Rc<View>,
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

/// Wires box `view`, with id `id`, for `interact`: focus on a press, pointer events, the hover color and its events,
/// all reaching `owner`'s handler.
pub(crate) fn wire(
    view: &View,
    id: Option<&str>,
    interact: &Interact,
    owner: Option<&Weak<Owner>>,
    base: Color,
    hover: Option<Color>,
) -> Rc<Wired> {
    let wired = Rc::new(Wired {
        view: Rc::new(view.clone()),
        base: Cell::new(base),
        hover: Cell::new(hover),
        over: Cell::new(false),
    });
    let node = id.map(str::to_owned);
    if interact.focusable && node.is_some() {
        view.focusable(true);
        if let Some(owner) = owner.and_then(Weak::upgrade) {
            blurs(view, &owner.host);
        }
    }
    if interact.hover.is_some() || interact.hover_events {
        let (state, this, owner, node) =
            (Rc::downgrade(&wired), Rc::downgrade(&wired.view), owner.cloned(), node.clone());
        let events = interact.hover_events;
        view.on_hover(move |cx, inside| {
            let Some(state) = state.upgrade() else { return };
            state.over.set(inside);
            if let (Some(_), Some(this)) = (state.hover.get(), this.upgrade()) {
                this.bg(state.shown());
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
            (interact.pointer, interact.focusable, Rc::downgrade(&wired.view), owner.clone(), node.clone());
        view.on_mouse(move |cx, event| {
            let Some(owner) = owner.upgrade().filter(|owner| owner.alive()) else { return };
            let (Some(host), Some(this)) = (owner.host.upgrade(), this.upgrade()) else { return };
            if focusable && matches!(event.kind, MouseEventKind::Down(_)) {
                cx.app().focus(&*this);
            }
            if pointer && pointed(&*host, &owner, &node, &this, event) == Handled::Consume {
                cx.stop_propagation();
                cx.prevent_default();
            }
        });
    }
    if interact.pointer {
        view.on_drop(move |cx, source, event| {
            let Some(owner) = owner.upgrade().filter(|owner| owner.alive()) else { return };
            let Some(host) = owner.host.upgrade() else { return };
            // A drop counts only from a node of the same mount.
            let root = owner.root.as_ref().map(View::id);
            if !std::iter::successors(Some(source.clone()), |widget| widget.parent()).any(|w| Some(w.id()) == root) {
                return;
            }
            let rect = owner.rect(&node).unwrap_or_default();
            let event = Event::Pointer(Pointer {
                node: node.clone(),
                kind: PointerKind::Drop,
                button: None,
                x: i32::from(event.x) - rect.x,
                y: i32::from(event.y) - rect.y,
                screen_x: event.x,
                screen_y: event.y,
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
fn pointed(host: &dyn Host, owner: &Rc<Owner>, node: &str, view: &View, event: &MouseEvent) -> Handled {
    let Some(router) = host.router() else { return Handled::Pass };
    router.prune_capture(host);
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
    };
    let handled = owner.send(host, &Event::Pointer(pointer));
    match kind {
        PointerKind::Down if handled == Handled::Consume => {
            let focus = host.app().focused().map(|widget| widget.id());
            *router.capture.borrow_mut() = Some(Capture { owner: me.clone(), node: node.to_owned(), focus });
        }
        PointerKind::Up if captured() => drop(router.capture.borrow_mut().take()),
        _ => {}
    }
    crate::flush();
    handled
}
