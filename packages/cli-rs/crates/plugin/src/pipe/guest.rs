//! One TypeScript plugin's activation on the pipe carrier: its registrations, as its setup on the JS host listed them,
//! its calls, the effects they answered with, the reads it watches, and its surfaces' mounts.

use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::rc::{Rc, Weak};
use std::sync::Arc;

use opencode_plugin_abi::interact::{Event, Handled};
use opencode_plugin_abi::v2::{self, ContentRef};
use opencode_plugin_abi::{HostRequest, InputTo, Manifest, Request, Span};
use opencode_ui::keymap::TuiCommand;
use opentui::keymap::Disposer;

use super::proto::{Down, Revision};
use super::{Call, Scripts, Waiting, count};
use crate::activation::{Activation, Wake};
use crate::interact::{Deliver, Owner};
use crate::limits;
use crate::loader::native::{Answers, Ctx, To, apply, handle};
use crate::mailbox::Mailbox;
use crate::surface::{self, Viewed, Viewing};
use crate::{Definition, ErrorFn, Host, Owners, Setup, behave, route, tui_command};

/// The reads a plugin watches at most (FT-9: opencode-tokscope watches about 80, a store each of its 64 history shards
/// and a dozen others). What they push is charged to the plugin's content, which bounds their memory.
const WATCHES: usize = 128;
/// The bytes of JSON a watched read pushes at most: what one control frame carries.
const READ: usize = super::wire::CONTROL_CAP;

/// The bytes of a value's JSON and their hash, written without keeping them.
#[derive(Default)]
struct Measure {
    hasher: std::hash::DefaultHasher,
    bytes: usize,
}

impl Measure {
    fn of(value: &serde_json::Value) -> Self {
        let mut measure = Self::default();
        let _ = serde_json::to_writer(&mut measure, value);
        measure
    }
}

impl std::io::Write for Measure {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        std::hash::Hasher::write(&mut self.hasher, bytes);
        self.bytes += bytes.len();
        Ok(bytes.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
/// The effects one call, setup or batch asks for at most.
const EFFECTS: usize = 256;

/// What a load answered: the plugin, what its setup registered, and the effects setup asked for, which the first
/// activation applies (the setup ran already); a later activation runs setup again.
pub(crate) struct Loaded {
    pub id: String,
    pub target: String,
    pub dir: PathBuf,
    /// `dir` is a project plugin's approved copy (P8), what its imports must stay in.
    pub confined: bool,
    pub options: Option<String>,
    /// The load whose setup the JS host ran.
    pub seq: u64,
    pub manifest: Manifest,
    pub holds: Vec<String>,
    pub effects: RefCell<Option<Vec<HostRequest>>>,
    /// The reads a handed-over activation watched, which it goes on watching (P8).
    pub watches: RefCell<Vec<(String, HostRequest)>>,
    /// The registry's first activation of the chain a reload handed this JS host's activation on from, whose
    /// dialogs stay (FT-4).
    pub continues: Option<u64>,
    /// Where the replies to the handed-over activation's requests go, which the new guest keeps ([`Relay`]).
    pub relay: RefCell<Option<Rc<Relay>>>,
}

/// Where the replies to the requests of one activation of the JS host go: the guest that runs it when the reply comes.
/// A reload of the plugin's registrations replaces the guest while the activation goes on (an async setup's slot, a
/// command registered later), and a reply to a request the old guest sent then reaches the new one (win11-runs D1:
/// session-usage's setup fetch, asked for as the JS host started again, was lost, and its slot never came back). A
/// reply for an activation that ended reaches nobody.
pub(crate) struct Relay {
    scripts: Weak<Scripts>,
    host: Weak<dyn Host>,
    id: String,
    js: u64,
}

impl Relay {
    fn new(scripts: &Weak<Scripts>, host: &Weak<dyn Host>, id: &str, js: u64) -> Rc<Self> {
        Rc::new(Self { scripts: scripts.clone(), host: host.clone(), id: id.to_owned(), js })
    }

    /// The guest that runs the activation now.
    fn guest(&self) -> Option<Rc<Guest>> {
        let scripts = self.scripts.upgrade()?;
        let guest = scripts.guests.borrow().get(&self.id)?.upgrade()?;
        (guest.js.get() == self.js).then_some(guest)
    }
}

impl Answers for Relay {
    fn live(&self) -> bool {
        self.guest().is_some_and(|guest| guest.live())
    }

    fn running(&self) -> bool {
        self.guest().is_some_and(|guest| guest.running())
    }

    fn owner(&self) -> Weak<dyn Host> {
        self.host.clone()
    }

    fn answer(self: Rc<Self>, request: Request) {
        if let Some(guest) = self.guest() {
            guest.answer(request);
        }
    }

    fn cancel(self: Rc<Self>, request: opencode_plugin_abi::RequestId) {
        if let Some(guest) = self.guest() {
            guest.cancel(request);
        }
    }
}

/// The definition of the plugin `loaded` names, whose setup registers what it listed.
pub(crate) fn define(scripts: &Rc<Scripts>, loaded: Rc<Loaded>) -> (Definition, ErrorFn) {
    let current: Rc<RefCell<Rc<RefCell<Option<String>>>>> = Rc::default();
    let weak = Rc::downgrade(scripts);
    let definition = Definition::fallible(loaded.id.clone(), {
        let current = current.clone();
        move |setup: &mut Setup<'_>| {
            let scripts = weak.upgrade().ok_or("the JS host is gone")?;
            let failure: Rc<RefCell<Option<String>>> = Rc::default();
            *current.borrow_mut() = failure.clone();
            let failed = failure.clone();
            setup.failure(Rc::new(move || failed.borrow().clone()));
            setup.continues(loaded.continues);
            let wake = Arc::new(Wake::new(Some(setup.host().app().proxy())));
            let mailbox = Mailbox::new(setup.id(), wake);
            mailbox.refuse_messages();
            let activation = Activation::new(setup.host(), mailbox);
            let relay = loaded.relay.take().filter(|relay| relay.js == loaded.seq);
            let relay = relay.unwrap_or_else(|| {
                Relay::new(&Rc::downgrade(&scripts), &Rc::downgrade(setup.host()), &loaded.id, loaded.seq)
            });
            let guest = Rc::new(Guest {
                relay: RefCell::new(relay),
                owners: Owners::new(setup.id(), Rc::downgrade(setup.host()), &activation),
                scripts: Rc::downgrade(&scripts),
                host: Rc::downgrade(setup.host()),
                loaded: loaded.clone(),
                js: Cell::new(loaded.seq),
                handed_over: Cell::new(false),
                keys: RefCell::new(loaded.manifest.storage.iter().take(crate::storage::KEYS).cloned().collect()),
                generation: setup.generation(),
                failure,
                revoked: RefCell::default(),
                activation,
                viewers: RefCell::default(),
                watches: RefCell::default(),
                pushed: RefCell::default(),
                watcher: RefCell::default(),
                disposed: Cell::new(false),
            });
            register(setup, &guest);
            scripts.guests.borrow_mut().insert(loaded.id.clone(), Rc::downgrade(&guest));
            scripts.registered(&loaded.id);
            for (key, request) in loaded.watches.take() {
                guest.watch(key, request);
            }
            // The first activation's setup ran on the JS host as it loaded; a later one runs it again.
            match loaded.effects.borrow_mut().take() {
                Some(effects) => guest.effects("setup", effects, false, "setup"),
                None => guest.setup_again(),
            }
            Ok(())
        }
    });
    let error: ErrorFn = Rc::new(move || current.borrow().borrow().clone());
    (definition, error)
}

pub(crate) struct Guest {
    scripts: Weak<Scripts>,
    host: Weak<dyn Host>,
    loaded: Rc<Loaded>,
    /// The load whose setup made the JS host's activation of the plugin, which a deactivation names.
    js: Cell<u64>,
    /// Where the replies to this activation's requests go.
    relay: RefCell<Rc<Relay>>,
    /// A reload of its registrations handed its activation of the JS host to the guest that replaces it, whose end
    /// deactivates it; this one's does not (carbon-2: a flag, not a zeroed `js`, as a second reload reads `js`).
    handed_over: Cell<bool>,
    /// The storage keys it may read and write: its manifest's, and the ones it declared since (carbon-2: a V2 store
    /// made after setup declares its key at once, where it waited for a reload and its first writes failed).
    keys: RefCell<Vec<String>>,
    /// The registry's activation, which owns the dialogs it asks for.
    generation: u64,
    failure: Rc<RefCell<Option<String>>>,
    /// What a failure revokes at once: the commands' layer and the event subscriptions.
    revoked: RefCell<Vec<Disposer>>,
    activation: Rc<Activation>,
    /// What it holds of the input (P2): its setup's layers, and its mounts' as its surfaces show.
    owners: Rc<Owners>,
    viewers: RefCell<Vec<Rc<Viewer>>>,
    /// The reads it watches, by its key, with the value last pushed.
    watches: RefCell<BTreeMap<String, (HostRequest, Option<u64>)>>,
    /// The bytes of each read last pushed, charged to the plugin's content while it is watched (4.2, phase Pl).
    pushed: RefCell<BTreeMap<String, u64>>,
    watcher: RefCell<Option<Disposer>>,
    disposed: Cell<bool>,
}

impl Guest {
    pub fn id(&self) -> &str {
        &self.loaded.id
    }

    pub(crate) fn target(&self) -> &str {
        &self.loaded.target
    }

    /// The JS host's activation of the plugin this one answers to.
    pub(crate) fn activation(&self) -> u64 {
        self.js.get()
    }

    pub(crate) fn ended(&self) -> bool {
        self.disposed.get() || self.failure.borrow().is_some()
    }

    fn send(&self, message: Down, waiting: Option<Waiting>) {
        if let Some(scripts) = self.scripts.upgrade() {
            scripts.send(message, waiting);
        }
    }

    /// Runs a handler of the plugin on the JS host, after the snapshots of what it reads.
    fn call(self: &Rc<Self>, export: &'static str, request: Request, hold: bool) {
        self.call_for(export, request, hold, (None, None));
    }

    /// [`Guest::call`] for an input event of an input owner, or a command of a route mount, whose effects are theirs.
    fn call_for(self: &Rc<Self>, export: &'static str, request: Request, hold: bool, owner: super::Owning) {
        if self.ended() {
            return;
        }
        self.refresh();
        if let Some(scripts) = self.scripts.upgrade() {
            scripts.call(self, export, request, hold, owner);
        }
    }

    /// The handler of P2's input `to` on the JS host. A key, a paste or a press cannot wait for the handler's answer,
    /// so the host answers from what the plugin declared: a [`Bind`](opencode_plugin_abi::interact::Bind)'s key, a
    /// paste of a layer that takes pastes and a pointer event on a node that asks for them are consumed; a key of a
    /// listener of every key goes on, which the handler only hears; the others' answer does not matter. The handler's
    /// own answer is advisory (synthesis 3.7). A `hold` bind holds the keys after it until the plugin's `release_keys`
    /// effect, or [`opencode_plugin_abi::interact::HOLD`].
    fn deliver(self: &Rc<Self>, to: To) -> Deliver {
        let guest = Rc::downgrade(self);
        Rc::new(move |_: &dyn Host, owner: &Rc<Owner>, event: &Event| {
            let Some(guest) = guest.upgrade().filter(|guest| !guest.ended()) else { return Handled::Pass };
            let to = match to {
                To::Surface(surface) => InputTo::Surface { surface, mount: owner.id().cloned() },
                To::Layer(layer) => InputTo::Layer { layer },
            };
            let request = Request::Input { to, event: event.clone() };
            guest.call_for("handle", request, false, (Some(Rc::downgrade(owner)), owner.mounted()));
            match event {
                Event::Key(key) if key.bind.is_some() => Handled::Consume,
                Event::Paste { .. } => Handled::Consume,
                Event::Pointer(_) => Handled::Consume,
                _ => Handled::Pass,
            }
        })
    }

    /// Runs the plugin's setup again on the JS host, for a new activation or after the JS host started again.
    pub(crate) fn setup_again(self: &Rc<Self>) {
        let Some(scripts) = self.scripts.upgrade() else { return };
        let seq = scripts.next();
        self.js.set(seq);
        // A new activation: what the last one asked for answers nobody.
        *self.relay.borrow_mut() = Relay::new(&self.scripts, &self.host, self.id(), seq);
        let load = Down::Load {
            seq,
            target: self.loaded.target.clone(),
            dir: self.loaded.dir.to_string_lossy().into_owned(),
            options: self.loaded.options.as_deref().and_then(|options| serde_json::from_str(options).ok()),
            setup: true,
            confined: self.loaded.confined,
            seed: super::proto::seed(&self.host, self.id()),
        };
        self.send(load, Some(Waiting::Activate(Rc::downgrade(self))));
    }

    /// The JS host ended: the plugin is set up again on the next one, and its mounts are told again. Their surfaces keep
    /// their last trees until new ones come.
    pub(crate) fn restart(self: &Rc<Self>) {
        if self.ended() {
            return;
        }
        // The JS state that set a mode is gone: each of its owners leaves its mode.
        if let Some(host) = self.host.upgrade() {
            for owner in self.activation.owners() {
                owner.set_mode(&*host, None);
            }
        }
        // The new activation watches what its setup asks for again; a watch of the last one's handlers is gone with it.
        self.watches.borrow_mut().clear();
        self.setup_again();
        let viewers = self.viewers.borrow().clone();
        viewers.iter().for_each(|viewer| viewer.restart(self));
    }

    /// The setup again returned. Registrations other than the ones this activation has take a reload.
    pub(crate) fn activated(self: &Rc<Self>, manifest: Manifest, holds: Vec<String>, effects: Vec<HostRequest>) {
        if self.ended() {
            return;
        }
        self.effects("setup", effects, false, "setup");
        if manifest == self.loaded.manifest && holds == self.loaded.holds {
            return;
        }
        let Some(scripts) = self.scripts.upgrade() else { return };
        if scripts.reloaded(self.id(), std::time::Instant::now()) {
            let (count, window) = (super::RELOADS, super::RELOAD_WINDOW.as_secs());
            self.fail(format!("it changed its registrations more than {count} times in {window} s, and never settled"));
            return;
        }
        // Only the load this activation runs as is changed: a version that load replaced, still running, does not
        // overwrite it (big-boi's catalog review).
        let current =
            scripts.loads.borrow().get(&self.loaded.target).is_some_and(|load| load.runs(&self.loaded, self.js.get()));
        if !current {
            log::warn!("plugin {}: a reload of registrations its load no longer runs; ignored", self.id());
            return;
        }
        // The replacement adopts this activation of the JS host: this guest's end must not deactivate it (review
        // carbon-2). Its mounts still end on the JS host, which keeps them for the activation (P8).
        let handed = self.js.get();
        self.handed_over.set(true);
        for viewer in self.viewers.borrow().iter() {
            viewer.handed.set(handed);
        }
        let mut loads = scripts.loads.borrow_mut();
        if let Some(load) = loads.get_mut(&self.loaded.target) {
            // What the activation watches it keeps watching.
            let watches =
                self.watches.borrow().iter().map(|(key, (request, _))| (key.clone(), request.clone())).collect();
            let loaded = Loaded {
                id: self.loaded.id.clone(),
                target: self.loaded.target.clone(),
                dir: self.loaded.dir.clone(),
                confined: self.loaded.confined,
                options: self.loaded.options.clone(),
                seq: handed,
                manifest,
                holds,
                effects: RefCell::new(Some(Vec::new())),
                watches: RefCell::new(watches),
                continues: Some(self.loaded.continues.unwrap_or(self.generation)),
                relay: RefCell::new(Some(self.relay.borrow().clone())),
            };
            (load.state, load.registered) = (super::Loading::Loaded(Rc::new(loaded)), false);
        }
        drop(loads);
        scripts.reconcile();
    }

    /// The handler `seq` returned: its effects apply, or it threw, which fails the plugin with none.
    pub(crate) fn done(self: &Rc<Self>, seq: u64, call: &Call, effects: Vec<HostRequest>, error: Option<String>) {
        if self.ended() {
            return;
        }
        if let Some(error) = error {
            self.fail(error);
            return;
        }
        let owner = call.owner.as_ref().and_then(Weak::upgrade);
        let key = format!("c{seq}");
        let apply = || match &call.mount {
            Some(alive) => self.owners.owned_by(alive, || self.effects(&key, effects, call.user, call.export)),
            None => self.effects(&key, effects, call.user, call.export),
        };
        match owner {
            Some(owner) => self.owners.as_owner(&owner, apply),
            None => apply(),
        }
    }

    /// Applies `effects`, as a call of kind `export` (for the user's input when `user`) would have asked for them, and
    /// tells the JS host what they answered under `key`. More than [`EFFECTS`] at once fail the plugin: each runs on the
    /// UI thread (review carbon-8).
    pub(crate) fn effects(self: &Rc<Self>, key: &str, effects: Vec<HostRequest>, user: bool, export: &str) {
        if effects.is_empty() || self.ended() {
            return;
        }
        if effects.len() > EFFECTS {
            self.fail(format!("{export} asked for {} effects at once, over {EFFECTS}", effects.len()));
            return;
        }
        let mut ctx = Ctx::new(self.host.clone(), self.id(), self.keys.borrow().clone());
        // Setup holds nothing of the input, as in process.
        ctx.owners = (export != "setup").then(|| self.owners.clone());
        let results: Vec<serde_json::Value> = effects
            .into_iter()
            .map(|request| {
                behave::as_user(user, || behave::calling(export, || handle(&mut ctx, request))).unwrap_or_else(
                    |error| {
                        log::warn!("plugin {}: {error}", self.id());
                        serde_json::Value::Null
                    },
                )
            })
            .collect();
        *self.keys.borrow_mut() = ctx.keys.clone();
        let (effects, _) = ctx.take();
        // Replies go to the activation, through whichever guest runs it when they come.
        let relay: Rc<dyn Answers> = self.relay.borrow().clone();
        let weak = Rc::downgrade(&relay);
        apply(&self.host, self.id().to_owned(), weak, Some(self.generation), effects);
        // What they asked for may move the focus or set a mode, which no host change announces: the reads it watches go
        // again once they applied (P2).
        let applied = Rc::downgrade(self);
        crate::defer(&self.host, move |_| {
            if let Some(guest) = applied.upgrade() {
                guest.refresh();
            }
        });
        self.send(Down::Answered { id: self.id().to_owned(), key: key.to_owned(), results }, None);
    }

    /// Fails the plugin with `error`: it is not called again, and the host says so once.
    pub(crate) fn fail(self: &Rc<Self>, error: String) {
        if self.failure.borrow().is_some() {
            return;
        }
        crate::fail(&self.host, self.id(), &self.failure, self.revoked.take(), &self.activation, error);
        self.release_reads();
        self.deactivate();
    }

    fn deactivate(&self) {
        if self.handed_over.get() {
            return;
        }
        if let Some(scripts) = self.scripts.upgrade() {
            let seq = scripts.next();
            let message = Down::Deactivate { seq, id: self.id().to_owned(), activation: self.js.get() };
            scripts.send(message, None);
        }
    }

    fn dispose(self: &Rc<Self>) {
        if self.disposed.replace(true) {
            return;
        }
        if let Some(watcher) = self.watcher.take() {
            watcher.dispose();
        }
        self.release_reads();
        if self.failure.borrow().is_none() {
            self.deactivate();
        }
        self.activation.dispose();
        if let Some(scripts) = self.scripts.upgrade() {
            let mut guests = scripts.guests.borrow_mut();
            if guests.get(self.id()).is_some_and(|known| std::ptr::eq(known.as_ptr(), Rc::as_ptr(self))) {
                guests.remove(self.id());
            }
        }
    }

    /// A revision for one of its mounts.
    pub(crate) fn tree(self: &Rc<Self>, tree: Box<Revision>) {
        if self.ended() {
            count(|crossed| crossed.dropped += 1);
            return;
        }
        let viewers = self.viewers.borrow().clone();
        match viewers.iter().find(|viewer| viewer.has(&tree.mount)) {
            Some(viewer) => {
                if viewer.take(self, tree) {
                    self.activation.invalidate();
                }
            }
            None => count(|crossed| crossed.dropped += 1),
        }
    }

    /// Pushes the value of `request` under `key` now, and each time it changes. A plugin watches at most [`WATCHES`]
    /// reads, each evaluated on the UI thread as the host changes (review carbon-8).
    pub(crate) fn watch(self: &Rc<Self>, key: String, request: HostRequest) {
        if self.ended() {
            return;
        }
        let mut watches = self.watches.borrow_mut();
        if !watches.contains_key(&key) && watches.len() >= WATCHES {
            log::warn!("plugin {}: a watch of {key} is over {WATCHES} reads; it is not watched", self.id());
            drop(watches);
            // Answered as a failed read, so what waits for it ends (bigboi P8-2).
            let error = Some(format!("the plugin watches {WATCHES} reads already"));
            self.send(Down::Snapshot { id: self.id().to_owned(), key, value: serde_json::Value::Null, error }, None);
            return;
        }
        let (value, hash) = self.evaluate(&request);
        watches.insert(key.clone(), (request, Some(hash)));
        drop(watches);
        self.push(key, value);
    }

    /// Pushes the value of the read `key` watches: as a failed read when it is over [`READ`] bytes of JSON, past the
    /// content its plugin may hold beside what it holds (4.2, phase Pl), or when its snapshot is larger than a frame the
    /// JS host takes, which the plugin reads as nothing, and can ask why; the plugin goes on (review: bound each read).
    /// What it pushes is charged to its content while it watches it.
    fn push(&self, key: String, value: serde_json::Value) {
        let bytes = Measure::of(&value).bytes;
        let held = self.pushed.borrow().get(&key).copied().unwrap_or(0);
        let snapshot = Down::Snapshot { id: self.id().to_owned(), key: key.clone(), value, error: None };
        let error = if bytes > READ {
            Some(format!("the read is {bytes} bytes, over {READ}"))
        } else if bytes as u64 > limits::room(self.id(), limits::Kind::Content, held) {
            Some(format!("the read is {bytes} bytes, past what the plugin may hold"))
        } else {
            // The cap is the frame's, the snapshot whole: a read just under the bound is past it (bigboi's pipe
            // sign-off). Sent as it is, the frame would be refused, and the plugin would keep the value before.
            let unsendable = self.scripts.upgrade().and_then(|scripts| scripts.unsendable(&snapshot));
            unsendable.map(|size| format!("the read's snapshot is {size} bytes, more than the JS host takes"))
        };
        let charged = if error.is_some() { 0 } else { bytes as u64 };
        limits::recharge(self.id(), limits::Kind::Content, held, charged);
        self.pushed.borrow_mut().insert(key.clone(), charged);
        let snapshot = match error {
            Some(error) => {
                log::warn!("plugin {}: the read it watches as {key}: {error}", self.id());
                Down::Snapshot { id: self.id().to_owned(), key, value: serde_json::Value::Null, error: Some(error) }
            }
            None => snapshot,
        };
        self.send(snapshot, None);
    }

    /// Gives back what the reads it watched charged.
    fn release_reads(&self) {
        let pushed = std::mem::take(&mut *self.pushed.borrow_mut());
        limits::release(self.id(), limits::Kind::Content, pushed.values().sum());
    }

    /// The read's value now, and a hash of its JSON, which tells a change without keeping the value.
    fn evaluate(&self, request: &HostRequest) -> (serde_json::Value, u64) {
        let keys = self.keys.borrow().clone();
        let value = super::evaluate(&self.host, self.id(), keys, Some(self.owners.clone()), request);
        let hash = std::hash::Hasher::finish(&Measure::of(&value).hasher);
        (value, hash)
    }

    /// The route as a call carries it ([`super::proto::Down::Call`]): only when the plugin does not watch it, as then
    /// its snapshot is already the JS host's.
    pub(crate) fn unwatched_route(&self) -> Option<serde_json::Value> {
        let watched = self.watches.borrow().values().any(|(request, _)| matches!(request, HostRequest::Route));
        (!watched).then(|| self.evaluate(&HostRequest::Route).0)
    }

    /// The snapshot of `key` went as a failed read ([`super::Scripts::refuse`]): the plugin holds nothing of it, and
    /// is charged nothing for it, as for a read [`Guest::push`] fails itself.
    pub(crate) fn unpushed(&self, key: &str) {
        let charged = self.pushed.borrow_mut().get_mut(key).map(std::mem::take);
        if let Some(charged) = charged {
            limits::release(self.id(), limits::Kind::Content, charged);
        }
    }

    pub(crate) fn unwatch(&self, key: &str) {
        self.watches.borrow_mut().remove(key);
        if let Some(charged) = self.pushed.borrow_mut().remove(key) {
            limits::release(self.id(), limits::Kind::Content, charged);
        }
    }

    /// Pushes each watched read whose value changed.
    fn refresh(&self) {
        if self.ended() {
            return;
        }
        let changed: Vec<(String, serde_json::Value)> = {
            let mut watches = self.watches.borrow_mut();
            watches
                .iter_mut()
                .filter_map(|(key, (request, last))| {
                    let (value, hash) = self.evaluate(request);
                    (*last != Some(hash)).then(|| {
                        *last = Some(hash);
                        (key.clone(), value)
                    })
                })
                .collect()
        };
        for (key, value) in changed {
            self.push(key, value);
        }
    }
}

impl Answers for Guest {
    fn live(&self) -> bool {
        !self.disposed.get() && !self.activation.disposed()
    }

    fn running(&self) -> bool {
        !self.ended()
    }

    fn owner(&self) -> Weak<dyn Host> {
        self.host.clone()
    }

    fn answer(self: Rc<Self>, request: Request) {
        self.call("on-reply", request, false);
    }

    fn cancel(self: Rc<Self>, request: opencode_plugin_abi::RequestId) {
        if !self.ended() {
            self.send(Down::Cancelled { activation: self.activation(), request }, None);
        }
    }
}

/// Registers what the plugin's setup listed, each calling it on the JS host.
fn register(setup: &mut Setup<'_>, guest: &Rc<Guest>) {
    let manifest = &guest.loaded.manifest;
    let disposed = guest.clone();
    setup.on_dispose(move || disposed.dispose());
    let commands: Vec<(opencode_plugin_abi::Scope, TuiCommand)> = manifest
        .commands
        .iter()
        .map(|command| {
            let called = guest.clone();
            let name = command.name.clone();
            let hold = guest.loaded.holds.contains(&name);
            let run = tui_command(command, move |input| {
                let request = Request::Command { name: name.clone(), input: input.map(str::to_owned) };
                called.call("run-command", request, hold);
            });
            (command.scope.clone(), run)
        })
        .collect();
    // A V2 layer's commands keep to the base mode unless it opts out, as TS's (bigboi P8-4). A route's commands are
    // bound to each of its mounts below.
    let (layers, _) = route::split(commands);
    for layer in layers.into_iter().filter(|layer| !layer.commands.is_empty()) {
        match setup.host().keymap().layer(layer) {
            Ok(disposer) => guest.revoked.borrow_mut().push(disposer),
            Err(error) => log::error!("plugin {} keymap layer: {error}", setup.id()),
        }
    }
    {
        let guest = guest.clone();
        setup.on_dispose(move || guest.revoked.take().into_iter().for_each(Disposer::dispose));
    }
    for (handler, types) in manifest.events.iter().enumerate() {
        let (called, kinds) = (Rc::downgrade(guest), types.clone());
        let subscription = setup.host().on_event(
            types,
            Rc::new(move |event| {
                if let Some(called) = called.upgrade().filter(|_| kinds.iter().any(|kind| kind == event.tag())) {
                    called.call("on-event", Request::Event { handler, event: Box::new(event.clone()) }, false);
                }
            }),
        );
        guest.revoked.borrow_mut().extend(subscription);
    }
    // P2: the layers of setup, each with its own handler, the activation's. Searches answer at once, which the JS host
    // cannot: it registers none.
    for (index, layer) in manifest.layers.iter().enumerate() {
        let deliver = guest.deliver(To::Layer(index));
        guest.owners.input.register(&**setup.host(), std::slice::from_ref(layer), &deliver);
    }
    for (index, claim) in manifest.surfaces.iter().enumerate() {
        let at: v2::Place = (&claim.place).into();
        // A route's commands are bound to the mount they run for, as in process: what they ask for is that mount's.
        let commands: surface::Commands = match &at {
            v2::Place::Route(name) => {
                let routed = crate::loader::native::routed(manifest, name);
                let guest = guest.clone();
                Rc::new(move |alive: &Weak<()>| {
                    let command = |command: &opencode_plugin_abi::Command| {
                        let (called, alive, name) = (guest.clone(), alive.clone(), command.name.clone());
                        let hold = guest.loaded.holds.contains(&name);
                        tui_command(command, move |input| {
                            let request = Request::Command { name: name.clone(), input: input.map(str::to_owned) };
                            called.call_for("run-command", request, hold, (None, Some(alive.clone())));
                        })
                    };
                    routed.iter().map(command).collect()
                })
            }
            v2::Place::Slot(_) | v2::Place::Panel(_) | v2::Place::Overlay(_) => Rc::new(|_| Vec::new()),
        };
        let failing = Rc::downgrade(guest);
        let fail: surface::Fail = Rc::new(move |error| {
            if let Some(guest) = failing.upgrade() {
                guest.fail(error);
            }
        });
        let place =
            surface::Place { name: claim.name.clone(), at, palette: claim.palette, notify: claim.notify.clone() };
        // No `layout` crosses the pipe: no frame waits for the JS host (3.7). A scroll event reaches the handler as the
        // others do.
        let calls = behave::Calls {
            plugin: setup.id().to_owned(),
            layout: None,
            ended: Some({
                let guest = Rc::downgrade(guest);
                Rc::new(move || guest.upgrade().is_none_or(|guest| guest.ended())) as Rc<dyn Fn() -> bool>
            }),
        };
        let input = Rc::new(surface::Input {
            plugin: setup.id().to_owned(),
            deliver: claim.handler.then(|| guest.deliver(To::Surface(index))),
            layers: claim.layers.clone(),
            panel: matches!(place.at, v2::Place::Panel(_)),
            mounts: claim.mounts,
            activation: guest.owners.input.clone(),
        });
        let viewer = Viewer::new(guest, index);
        guest.viewers.borrow_mut().push(viewer.clone());
        setup.surface(place, viewer, commands, fail, calls, &guest.owners, input);
    }
    let watching = Rc::downgrade(guest);
    let watcher = setup.host().watch(Rc::new(move |_: &opencode_plugin_abi::Changed| {
        if let Some(guest) = watching.upgrade() {
            guest.refresh();
            if let Some(scripts) = guest.scripts.upgrade() {
                scripts.theme();
            }
        }
    }));
    *guest.watcher.borrow_mut() = watcher;
}

/// A surface of a plugin on the JS host: each mount shows the last revision the host adopted, a placeholder before the
/// first, or what a new one brings. The view call never waits: it tells the JS host what changed in the mount's input,
/// and takes a revision that arrived.
pub(crate) struct Viewer {
    this: Weak<Viewer>,
    guest: Weak<Guest>,
    /// The plugin and its JS host, which a mount's end is told to after the guest went.
    id: String,
    scripts: Weak<Scripts>,
    /// The JS host's activation a reload handed over, whose mounts of this surface end with this viewer's (P8).
    handed: Cell<u64>,
    index: usize,
    mounts: RefCell<HashMap<v2::MountId, Mount>>,
    /// The height each key's mount had with a tree, which a placeholder of a mount of that key keeps (review F1).
    heights: RefCell<HashMap<String, u16>>,
}

#[derive(Default)]
struct Mount {
    /// The JS host was told of the mount.
    started: bool,
    /// The sequence of the mount or input it was told last: its layout epoch. A revision that saw an older one was
    /// built for another size and is refused (review bigboi-7).
    epoch: u64,
    /// The input it was told last, without `full`.
    sent: Option<v2::SurfaceInput>,
    pending: Option<Box<Revision>>,
    /// The revision offered to the surface, and the plugin's handles it added, until it is adopted or refused.
    offered: Option<(u64, Vec<u64>)>,
    adopted: u64,
    /// The host's handle of each of the plugin's.
    handles: HashMap<u64, ContentRef>,
    /// The handles of a JS host that ended, which the tree on screen still shows: they go when the next one's first
    /// tree is offered (review carbon-7).
    retired: Vec<ContentRef>,
    /// Something shows: a placeholder or a tree.
    shown: bool,
    /// A tree of the plugin's was adopted.
    real: bool,
}

impl Viewer {
    fn new(guest: &Rc<Guest>, index: usize) -> Rc<Self> {
        Rc::new_cyclic(|this| Self {
            this: this.clone(),
            guest: Rc::downgrade(guest),
            id: guest.id().to_owned(),
            scripts: guest.scripts.clone(),
            handed: Cell::new(0),
            index,
            mounts: RefCell::default(),
            heights: RefCell::default(),
        })
    }

    fn has(&self, mount: &v2::MountId) -> bool {
        self.mounts.borrow().contains_key(mount)
    }

    /// Takes revision `tree` for its mount: whether the mount has something new to show. A revision that does not
    /// build on what the host adopted, or comes while another waits, is dropped; the first kind is refused, so the
    /// JS host sends a whole one.
    fn take(&self, guest: &Guest, tree: Box<Revision>) -> bool {
        let mut mounts = self.mounts.borrow_mut();
        let Some(mount) = mounts.get_mut(&tree.mount) else {
            count(|crossed| crossed.dropped += 1);
            return false;
        };
        if mount.pending.is_some() || mount.offered.is_some() {
            count(|crossed| crossed.dropped += 1);
            return false;
        }
        let stale = tree.epoch < mount.epoch;
        if tree.base != mount.adopted || stale {
            count(|crossed| crossed.dropped += 1);
            let (rev, adopted) = (tree.rev, mount.adopted);
            drop(mounts);
            let error = match stale {
                true => format!("revision {rev} was built for an input the host has replaced"),
                false => format!("revision {rev} builds on {}, and the host shows {adopted}", tree.base),
            };
            guest.send(Down::Refused { id: guest.id().to_owned(), mount: tree.mount, rev, adopted, error }, None);
            return false;
        }
        mount.pending = Some(tree);
        true
    }

    /// The offered revision of `mount` was adopted, or refused: the JS host is told, and builds the next on it.
    fn settle(&self, id: &v2::MountId, adopted: bool) {
        let Some(guest) = self.guest.upgrade() else { return };
        let mut mounts = self.mounts.borrow_mut();
        let Some(mount) = mounts.get_mut(id) else { return };
        let Some((rev, fresh)) = mount.offered.take() else { return };
        if guest.ended() {
            return;
        }
        let message = match adopted {
            true => {
                (mount.adopted, mount.real) = (rev, true);
                count(|crossed| crossed.adopted += 1);
                Down::Adopted { id: guest.id().to_owned(), mount: id.clone(), rev }
            }
            false => {
                for handle in &fresh {
                    mount.handles.remove(handle);
                }
                count(|crossed| crossed.refused += 1);
                let error = "the host refused it".to_owned();
                Down::Refused { id: guest.id().to_owned(), mount: id.clone(), rev, adopted: mount.adopted, error }
            }
        };
        drop(mounts);
        guest.send(message, None);
    }

    /// The JS host started again: each mount is told again, and builds whole.
    fn restart(&self, guest: &Guest) {
        let ids: Vec<v2::MountId> = self.mounts.borrow().keys().cloned().collect();
        for id in ids {
            let input = {
                let mut mounts = self.mounts.borrow_mut();
                let Some(mount) = mounts.get_mut(&id) else { continue };
                (mount.pending, mount.offered, mount.adopted) = (None, None, 0);
                let handles: Vec<ContentRef> = mount.handles.drain().map(|(_, given)| given).collect();
                mount.retired.extend(handles);
                mount.sent.clone()
            };
            let Some(input) = input else { continue };
            self.tell(guest, &id, input, true);
        }
    }

    /// Tells the JS host of `mount`'s input: a mount when `mount` is new to it, else an input. A revision that waits
    /// and saw an older input is refused now: its geometry is not the mount's any more.
    fn tell(&self, guest: &Guest, id: &v2::MountId, input: v2::SurfaceInput, new: bool) {
        let Some(scripts) = guest.scripts.upgrade() else { return };
        let seq = scripts.next();
        let stale = match self.mounts.borrow_mut().get_mut(id) {
            Some(mount) => {
                (mount.started, mount.sent, mount.epoch) = (true, Some(input.clone()), seq);
                mount.pending.take_if(|tree| tree.epoch < seq).map(|tree| (tree.rev, mount.adopted))
            }
            None => None,
        };
        let (plugin, mount) = (guest.id().to_owned(), id.clone());
        let message = match new {
            true => {
                Down::Mount { seq, id: plugin.clone(), activation: guest.js.get(), surface: self.index, mount, input }
            }
            false => Down::Input { seq, id: plugin.clone(), activation: guest.js.get(), mount, input },
        };
        scripts.send(message, Some(Waiting::View(self.guest.clone())));
        if let Some((rev, adopted)) = stale {
            count(|crossed| crossed.dropped += 1);
            let error = format!("revision {rev} was built for an input the host has replaced");
            scripts.send(Down::Refused { id: plugin, mount: id.clone(), rev, adopted, error }, None);
        }
    }
}

impl surface::Viewer for Viewer {
    fn view(&self, host: &dyn Host, viewing: Viewing<'_>) -> Option<Viewed> {
        let guest = self.guest.upgrade().filter(|guest| !guest.ended())?;
        let id = viewing.mount;
        // A view with `full` after an offer: the surface refused it.
        let offered = self.mounts.borrow().get(id).and_then(|mount| mount.offered.clone());
        if offered.is_some() {
            self.settle(id, !viewing.input.full);
        }
        // What changed since the last view is not the JS host's input (P6a): its views run again as what they watch
        // changes, and an input it is told is a new layout epoch, which a tree in flight would be refused for. A change
        // of the host's data reaches the plugin only here, as the host watches only its own state: the reads it
        // watches go again once the view returned (FT-7).
        let changed = &viewing.input.changed;
        let data = changed.all
            || !changed.sessions.is_empty()
            || !changed.lists.is_empty()
            || !changed.messages.is_empty()
            || !changed.locations.is_empty();
        if data {
            let refreshing = Rc::downgrade(&guest);
            crate::defer(&guest.host, move |_| {
                if let Some(guest) = refreshing.upgrade() {
                    guest.refresh();
                }
            });
        }
        let input = v2::SurfaceInput { full: false, changed: Default::default(), ..viewing.input.clone() };
        let (started, sent, real) = {
            let mut mounts = self.mounts.borrow_mut();
            let mount = mounts.entry(id.clone()).or_default();
            (mount.started, mount.sent.clone(), mount.real)
        };
        // The height it was laid out at, not the input's, which stands in the screen's before a solve (review carbon-7).
        if let (true, Some(laid)) = (real, viewing.laid) {
            self.heights.borrow_mut().insert(id.key.clone(), laid);
        }
        if !started || sent.as_ref() != Some(&input) {
            self.tell(&guest, id, input, !started);
        }
        let mut mounts = self.mounts.borrow_mut();
        let mount = mounts.get_mut(id)?;
        // A surface that asks for a whole tree refuses one that is not: the JS host builds whole (review carbon-7).
        if let Some(tree) = mount.pending.take_if(|tree| viewing.input.full && !tree.whole) {
            let (rev, adopted) = (tree.rev, mount.adopted);
            drop(mounts);
            let error = "the host asked for a whole tree".to_owned();
            guest.send(Down::Refused { id: guest.id().to_owned(), mount: id.clone(), rev, adopted, error }, None);
            return Some(Viewed { node: None, memo: None });
        }
        if let Some(tree) = mount.pending.take() {
            let tree = *tree;
            for given in mount.retired.drain(..) {
                (viewing.release)(given);
            }
            let mut fresh = Vec::new();
            for (handle, bytes) in tree.content {
                let given = ContentRef(surface::next_content());
                surface::took_content(given.0, 1);
                // A handle given again replaces the one it named.
                if let Some(old) = mount.handles.insert(handle.0, given) {
                    (viewing.release)(old);
                }
                fresh.push(handle.0);
                (viewing.give)(given, bytes.0);
            }
            for handle in tree.released {
                if let Some(given) = mount.handles.remove(&handle.0) {
                    (viewing.release)(given);
                }
            }
            let mut node = tree.node;
            let node = super::timed(|| {
                rehandle(&mut node, &mount.handles);
                serde_json::from_value::<v2::Node>(node)
            });
            let node = match node {
                // A memo table holds a value for each subtree it built or kept by key, and for each memo a keep holds
                // again, as a library's does.
                Ok(node) if tree.memo > crate::loader::native::keyed(&node, viewing.kept) => {
                    Err(format!("a memo table of {} values for a tree of fewer keyed nodes", tree.memo))
                }
                Ok(node) => Ok(node),
                Err(error) => Err(format!("view returned a tree the host cannot read: {error}")),
            };
            let node = match node {
                Ok(node) => node,
                Err(error) => {
                    drop(mounts);
                    guest.fail(error);
                    return None;
                }
            };
            mount.offered = Some((tree.rev, fresh));
            mount.shown = true;
            drop(mounts);
            // Adopted unless the surface refuses it in this same draw, which asks again with `full` at once.
            let (viewer, owner, id) = (self.this.clone(), guest.host.clone(), id.clone());
            crate::defer(&owner, move |_| {
                if let Some(viewer) = viewer.upgrade() {
                    viewer.settle(&id, true);
                }
            });
            return Some(Viewed { node: Some(node), memo: Some(tree.memo) });
        }
        if !mount.shown {
            mount.shown = true;
            let height = self.heights.borrow().get(&id.key).copied().unwrap_or(1);
            let _ = host;
            return Some(Viewed { node: Some(placeholder(height)), memo: Some(0) });
        }
        Some(Viewed { node: None, memo: None })
    }

    fn forget(&self, _host: &dyn Host, id: &v2::MountId) {
        let Some(mount) = self.mounts.borrow_mut().remove(id) else { return };
        let guest = self.guest.upgrade().filter(|guest| !guest.ended());
        // A guest that handed its activation to a reload leaves its mounts to the replacement, which mounts its own.
        if guest.as_ref().is_some_and(|guest| guest.handed_over.get()) {
            return;
        }
        let running = guest.map(|guest| guest.js.get());
        let Some(activation) = running.or(Some(self.handed.get()).filter(|handed| *handed != 0)) else { return };
        if !mount.started {
            return;
        }
        let Some(scripts) = self.scripts.upgrade() else { return };
        let seq = scripts.next();
        scripts.send(Down::Unmount { seq, id: self.id.clone(), activation, mount: id.clone() }, None);
    }
}

/// What a mount shows before the JS host's first tree: the rows its key had, or one (review F1).
fn placeholder(height: u16) -> v2::Node {
    let layout = opencode_plugin_abi::Layout {
        height: Some(opencode_plugin_abi::Width::Cells(height)),
        ..opencode_plugin_abi::Layout::default()
    };
    // A mount that showed nothing reserves nothing.
    if height == 0 {
        return v2::Node::column(Vec::new()).layout(layout);
    }
    v2::Node::text(vec![Span::new("…")]).fg("text.muted").layout(layout)
}

/// Gives each content source of `node` (`{"content": n}`) the host's handle of the plugin's `n`. A handle the mount does
/// not hold names none, so the host refuses the tree as foreign content.
fn rehandle(node: &mut serde_json::Value, handles: &HashMap<u64, ContentRef>) {
    match node {
        serde_json::Value::Object(map) => {
            if map.len() == 1
                && let Some(serde_json::Value::Number(number)) = map.get("content")
                && let Some(handle) = number.as_u64()
            {
                let given = handles.get(&handle).map_or(u64::MAX, |given| given.0);
                map.insert("content".to_owned(), serde_json::Value::from(given));
                return;
            }
            map.values_mut().for_each(|value| rehandle(value, handles));
        }
        serde_json::Value::Array(items) => items.iter_mut().for_each(|value| rehandle(value, handles)),
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Expected: a content source takes the host's handle, one the mount does not hold takes none the host gave, and
    // nothing else that holds a number named `content` changes.
    #[test]
    fn content_sources_take_the_hosts_handles() {
        let handles = HashMap::from([(1, ContentRef(41)), (2, ContentRef(42))]);
        let mut node = serde_json::json!({
            "type": "box",
            "children": [
                {"type": "diff", "content": {"content": 1}},
                {"type": "markdown", "source": {"content": 2}},
                {"type": "diff", "content": {"content": 7}},
                {"type": "text", "spans": [{"text": "content"}], "content": 3, "other": 1},
            ],
        });
        rehandle(&mut node, &handles);
        let children = &node["children"];
        assert_eq!(children[0]["content"], serde_json::json!({"content": 41}));
        assert_eq!(children[1]["source"], serde_json::json!({"content": 42}));
        assert_eq!(children[2]["content"], serde_json::json!({"content": u64::MAX}));
        assert_eq!(children[3]["content"], serde_json::json!(3));
    }
}
