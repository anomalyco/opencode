//! One TypeScript plugin's activation on the pipe carrier: its registrations, as its setup on the JS host listed them,
//! its calls, the effects they answered with, the reads it watches, and its surfaces' mounts.

use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::rc::{Rc, Weak};
use std::sync::Arc;

use opencode_plugin_abi::interact::{Event, Handled};
use opencode_plugin_abi::v2::{self, ContentRef};
use opencode_plugin_abi::{HostRequest, InputTo, Manifest, Request, Scope, Span};
use opencode_ui::keymap::TuiCommand;
use opentui::keymap::Disposer;

use super::proto::{Down, Listener, Revision};
use super::{Call, Scripts, Waiting, count};
use crate::activation::{Activation, Wake};
use crate::interact::{Deliver, Owner};
use crate::limits;
use crate::loader::native::{Answers, Ctx, To, apply, handle};
use crate::mailbox::Mailbox;
use crate::surface::{self, Viewed, Viewing};
use crate::{Definition, ErrorFn, Host, Owners, Setup, behave, keyed_command, route};

/// The reads a plugin watches at most (FT-9: opencode-tokscope watches about 80, a store each of its 64 history shards
/// and a dozen others). What they push is charged to the plugin's content, which bounds their memory.
const WATCHES: usize = 128;
/// Frames in a row in which a mount's watched rects changed, with no other cause between, past which the host holds
/// the plugin's rect pushes until another cause comes (contract 2.x, addition 1, R3): a layout that follows its own
/// size without end.
const RECT_ROUNDS: u32 = crate::behave::STALLED;

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
    /// The states the handed-over activation set its commands to after it handed on, which the new guest takes over its
    /// manifest's (carbon ce-5: a `set-enabled` that came while the reload waited changed the guest that went).
    pub states: RefCell<Vec<(String, bool)>>,
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

    fn cancels(&self) -> bool {
        true
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
            // An activation that sent more than the host keeps before it was registered applies nothing it sent, also
            // not what its setup registered or asked for in its load: it fails here, before any of it (big-boi's
            // catalog review: a storage write of its setup persisted).
            if scripts.spilled_by(&loaded.id, loaded.seq) {
                scripts.spill_load(&loaded);
                return Err(format!(
                    "it sent more than {} messages before the host registered it, and lost some",
                    super::EARLY
                ));
            }
            // The setup already ran on the JS host for the first activation and for a reload's handover, which go
            // on from the chain the handover names; a later activation runs a fresh setup, which owns its own
            // generation alone, not the dialogs of the activations before it (big-boi's catalog recheck).
            let effects = loaded.effects.borrow_mut().take();
            let continues = effects.as_ref().and(loaded.continues);
            setup.continues(continues);
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
                continues,
                handed_over: Cell::new(false),
                keys: RefCell::new(loaded.manifest.storage.iter().take(crate::storage::KEYS).cloned().collect()),
                generation: setup.generation(),
                failure,
                revoked: RefCell::default(),
                commands: RefCell::new((loaded.manifest.commands.clone(), loaded.holds.clone())),
                layers: RefCell::default(),
                activation,
                viewers: RefCell::default(),
                claims: RefCell::default(),
                over_cap: Cell::new(false),
                watches: RefCell::default(),
                pushed: RefCell::default(),
                failures: RefCell::default(),
                watcher: RefCell::default(),
                disposed: Cell::new(false),
                rects: Cell::new((u64::MAX, 0)),
            });
            register(setup, &guest);
            scripts.guests.borrow_mut().insert(loaded.id.clone(), Rc::downgrade(&guest));
            scripts.registered(&loaded.id);
            for (key, request) in loaded.watches.take() {
                guest.watch(key, request);
            }
            // The first activation's setup ran on the JS host as it loaded; a later one runs it again.
            match effects {
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
    /// The first activation of the chain it goes on from, as a handover named it; none for a fresh setup.
    continues: Option<u64>,
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
    /// What a failure revokes at once: the event subscriptions; the commands' layers are [`Guest::layers`].
    revoked: RefCell<Vec<Disposer>>,
    /// The commands and holds the JS host last told: its load's, or what a change of commands alone made them since
    /// ([`Guest::activated`]).
    commands: RefCell<(Vec<opencode_plugin_abi::Command>, Vec<String>)>,
    /// The keymap layers of `commands` outside a route, which a change of commands alone replaces.
    layers: RefCell<Vec<Disposer>>,
    activation: Rc<Activation>,
    /// What it holds of the input (P2): its setup's layers, and its mounts' as its surfaces show.
    owners: Rc<Owners>,
    viewers: RefCell<Vec<Rc<Viewer>>>,
    /// Its renderer claims' viewers, as its manifest lists them (contract 2.x, step D).
    claims: RefCell<Vec<Rc<ClaimViewer>>>,
    /// A fence over [`FENCE_BYTES`] kept the host's code view, which the log said once.
    over_cap: Cell<bool>,
    /// The reads it watches, by its key, with the value last pushed.
    watches: RefCell<BTreeMap<String, (HostRequest, Option<u64>)>>,
    /// The bytes of each read last pushed, charged to the plugin's content while it is watched (4.2, phase Pl).
    pushed: RefCell<BTreeMap<String, u64>>,
    /// Why each read that failed last failed, as the JS host was told: a retry that fails the same way tells it nothing
    /// again (big-boi's `cg4-8` retries a failed read at each refresh).
    failures: RefCell<BTreeMap<String, String>>,
    watcher: RefCell<Option<Disposer>>,
    disposed: Cell<bool>,
    /// The frame its watched rects were last compared in, and how many frames in a row they changed with no other
    /// cause ([`Guest::laid_out`]).
    rects: Cell<(u64, u32)>,
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
        self.call_keyed(export, request, hold, owner, None);
    }

    /// [`Guest::call_for`] of a command a key ran, which goes on to the host if the command declines.
    fn call_keyed(
        self: &Rc<Self>,
        export: &'static str,
        request: Request,
        hold: bool,
        owner: super::Owning,
        key: Option<super::Keyed>,
    ) {
        if self.ended() {
            return;
        }
        self.caused();
        self.refresh();
        if let Some(scripts) = self.scripts.upgrade() {
            scripts.call(self, export, request, hold, owner, key);
        }
    }

    /// The handler of P2's input `to` on the JS host. A paste or a press cannot wait for the handler's answer, so the
    /// host answers from what the plugin declared: a [`Bind`](opencode_plugin_abi::interact::Bind)'s key, a paste of a
    /// layer that takes pastes and a pointer event on a node that asks for them are consumed; the others' answer does
    /// not matter. A key of a listener of every key that can take one now ([`Guest::taking`]) is taken and held as a
    /// key command's is ([`js_command`]): if the handler did not take it (TS's `preventDefault`), it goes on once the
    /// JS host answers, below this listener (contract gaps 2). One that cannot only hears it, and it goes on at once
    /// (cg2-1). A `hold` bind holds the keys after it until the plugin's `release_keys` effect, or
    /// [`opencode_plugin_abi::interact::HOLD`].
    fn deliver(self: &Rc<Self>, to: To) -> Deliver {
        let guest = Rc::downgrade(self);
        let listener = match to {
            To::Surface(surface) => Listener::Surface(surface),
            To::Layer(layer) => Listener::Layer(layer),
        };
        Rc::new(move |host: &dyn Host, owner: &Rc<Owner>, event: &Event| {
            let Some(guest) = guest.upgrade().filter(|guest| !guest.ended()) else { return Handled::Pass };
            let Some(scripts) = guest.scripts.upgrade() else { return Handled::Pass };
            // A setup layer's listener (TS's `keyInput`) only hears what the user types into the composer or another
            // text input: their typing never waits on the JS host (cg2-1, as FT-14 keeps a global bind off it).
            let typed = |key: &opencode_plugin_abi::interact::Key| {
                matches!(listener, Listener::Layer(_)) && crate::interact::printable(&key.key) && owner.typing()
            };
            let listened = match event {
                Event::Key(key) if key.bind.is_none() && guest.takes(&scripts, listener) && !typed(key) => {
                    host.router().and_then(|router| router.listened())
                }
                _ => None,
            };
            let to = match to {
                To::Surface(surface) => InputTo::Surface { surface, mount: owner.id().cloned() },
                To::Layer(layer) => InputTo::Layer { layer },
            };
            let request = Request::Input { to, event: event.clone() };
            let owning = (Some(Rc::downgrade(owner)), owner.mounted());
            if let Some((key, heard)) = listened {
                let field = matches!(listener, Listener::Surface(_)).then(|| guest.id());
                let keyed = super::Keyed::new(key, &scripts, heard, owner.mounted(), field);
                guest.call_keyed("handle", request, true, owning, Some(keyed));
                return Handled::Consume;
            }
            guest.call_for("handle", request, false, owning);
            match event {
                Event::Key(key) if key.bind.is_some() => Handled::Consume,
                Event::Paste { .. } => Handled::Consume,
                Event::Pointer(_) => Handled::Consume,
                _ => Handled::Pass,
            }
        })
    }

    /// Its listener `listener` can take a key now (`on`), or only hears it (cg2-1).
    pub(crate) fn taking(&self, listener: Listener, on: bool) {
        let Some(scripts) = self.scripts.upgrade() else { return };
        let mut taking = scripts.taking.borrow_mut();
        let listeners = taking.entry(self.id().to_owned()).or_default();
        match on {
            true => listeners.insert(listener),
            false => listeners.remove(&listener),
        };
    }

    fn takes(&self, scripts: &Scripts, listener: Listener) -> bool {
        scripts.taking.borrow().get(self.id()).is_some_and(|listeners| listeners.contains(&listener))
    }

    /// Runs the plugin's setup again on the JS host, for a new activation or after the JS host started again.
    pub(crate) fn setup_again(self: &Rc<Self>) {
        let Some(scripts) = self.scripts.upgrade() else { return };
        // A new JS activation says again what can take keys.
        scripts.taking.borrow_mut().remove(self.id());
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
        // Its claimed parts are sent again as they are drawn next; what shows stays until their trees come.
        let claims = self.claims.borrow().clone();
        claims.iter().for_each(|claim| claim.restart());
        if !claims.is_empty() {
            self.activation.invalidate();
        }
    }

    /// The JS host's queue refused the part of `mount` that one of its claims sent: it is sent again as its part is
    /// drawn after the queue drained ([`Scripts::reoffer`]), until then the host's row or the last tree shows.
    pub(crate) fn claim_refused(self: &Rc<Self>, mount: &v2::MountId) {
        let claims = self.claims.borrow().clone();
        if claims.iter().any(|claim| claim.unsent(mount))
            && let Some(scripts) = self.scripts.upgrade()
        {
            scripts.reoffer(self);
        }
    }

    /// The queue drained: the parts it refused are drawn again, oldest first, and sent as they are.
    pub(crate) fn reoffer(&self) {
        if !self.ended() {
            self.activation.invalidate();
        }
    }

    /// The setup again returned, or the plugin's registrations changed. A change of its commands alone outside a route
    /// (a component's key layer, enabled or disabled, retitled, or gone with its mount) replaces their keymap layers in
    /// place, as TS's keymap follows a layer; any other change takes a reload, which mounts its surfaces again. A
    /// reload for a layer remounted the plugin's route, so what the user typed in its field until the new mount's field
    /// took the focus was lost (`ports_trio`'s session-manager search lost a letter).
    pub(crate) fn activated(self: &Rc<Self>, manifest: Manifest, holds: Vec<String>, effects: Vec<HostRequest>) {
        if self.ended() {
            return;
        }
        self.effects("setup", effects, false, "setup");
        // The commands' states are the JS host's now, also when its manifest is the last one's: a setup run again after
        // a restart, where the last activation had set them otherwise (carbon ce-5).
        self.activation.commands(&manifest.commands);
        // A guest that handed its activation to a reload not yet registered changes that reload's registrations: the
        // replacement registers what it carries.
        let commands_only = !self.handed_over.get() && self.commands_only(&manifest, &holds);
        let same = |(commands, held): &(Vec<opencode_plugin_abi::Command>, Vec<String>)| {
            stateless(commands) == stateless(&manifest.commands) && *held == holds
        };
        if commands_only && same(&self.commands.borrow()) {
            *self.commands.borrow_mut() = (manifest.commands, holds);
            return;
        }
        if !commands_only && manifest == self.loaded.manifest && holds == self.loaded.holds {
            return;
        }
        let Some(scripts) = self.scripts.upgrade() else { return };
        match scripts.admit_reload(&self.loaded, self.js.get(), std::time::Instant::now()) {
            super::Reload::Take => {}
            super::Reload::Stale => {
                log::warn!("plugin {}: a reload of registrations its load no longer runs; ignored", self.id());
                return;
            }
            super::Reload::Churning => {
                let (count, window) = (super::RELOADS, super::RELOAD_WINDOW.as_secs());
                self.fail(format!(
                    "it changed its registrations more than {count} times in {window} s, and never settled"
                ));
                return;
            }
        }
        if commands_only {
            *self.commands.borrow_mut() = (manifest.commands, holds);
            if let Some(host) = self.host.upgrade() {
                self.layer_commands(&*host);
            }
            return;
        }
        // The replacement adopts this activation of the JS host: this guest's end must not deactivate it (review
        // carbon-2). Its mounts still end on the JS host, which keeps them for the activation (P8).
        let handed = self.js.get();
        self.handed_over.set(true);
        for viewer in self.viewers.borrow().iter() {
            viewer.handed.set(handed);
        }
        for claim in self.claims.borrow().iter() {
            claim.handed.set(handed);
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
                continues: Some(self.continues.unwrap_or(self.generation)),
                relay: RefCell::new(Some(self.relay.borrow().clone())),
                states: RefCell::default(),
            };
            (load.state, load.registered) = (super::Loading::Loaded(Rc::new(loaded)), false);
        }
        drop(loads);
        scripts.reconcile();
    }

    /// Whether `manifest` and `holds` change only the commands outside a route of what this activation registered, or
    /// a command's state: a route's commands are bound to each of its mounts as it mounts.
    fn commands_only(&self, manifest: &Manifest, holds: &[String]) -> bool {
        let routed = |manifest: &Manifest, holds: &[String]| -> (Vec<opencode_plugin_abi::Command>, Vec<bool>) {
            let commands: Vec<_> =
                manifest.commands.iter().filter(|command| matches!(command.scope, Scope::Route(_))).cloned().collect();
            let held = commands.iter().map(|command| holds.contains(&command.name)).collect();
            (stateless(&commands), held)
        };
        let loaded = &self.loaded;
        Manifest { commands: loaded.manifest.commands.clone(), ..manifest.clone() } == loaded.manifest
            && routed(manifest, holds) == routed(&loaded.manifest, &loaded.holds)
    }

    /// Registers the keymap layers of its commands outside a route, in place of the ones it had.
    fn layer_commands(self: &Rc<Self>, host: &dyn Host) {
        self.layers.take().into_iter().for_each(Disposer::dispose);
        let commands: Vec<(Scope, TuiCommand)> = self
            .commands
            .borrow()
            .0
            .iter()
            .map(|command| (command.scope.clone(), js_command(self, command, None)))
            .collect();
        // A V2 layer's commands keep to the base mode unless it opts out, as TS's (bigboi P8-4).
        let (layers, _) = route::split(commands);
        for layer in layers.into_iter().filter(|layer| !layer.commands.is_empty()) {
            match host.keymap().layer(layer) {
                Ok(disposer) => self.layers.borrow_mut().push(disposer),
                Err(error) => log::error!("plugin {} keymap layer: {error}", self.id()),
            }
        }
    }

    /// The handler `seq` returned: its effects apply, or it threw, which fails the plugin with none.
    pub(crate) fn done(
        self: &Rc<Self>,
        seq: u64,
        call: &Call,
        effects: Vec<HostRequest>,
        mounts: Vec<Option<v2::MountId>>,
        error: Option<String>,
    ) {
        if self.ended() {
            return;
        }
        if let Some(error) = error {
            self.fail(error);
            return;
        }
        if effects.is_empty() {
            return;
        }
        if effects.len() > EFFECTS {
            self.fail(format!("{} asked for {} effects at once, over {EFFECTS}", call.export, effects.len()));
            return;
        }
        // In the call's order, each run as the mount it is of (carbon c2b-1): `dialog.clear()` then a field's focus.
        let mut runs: Vec<(Option<v2::MountId>, Vec<HostRequest>)> = Vec::new();
        for (effect, mount) in effects.into_iter().zip(mounts.into_iter().chain(std::iter::repeat(None))) {
            match runs.last_mut() {
                Some((of, run)) if *of == mount => run.push(effect),
                _ => runs.push((mount, vec![effect])),
            }
        }
        let owner = call.owner.as_ref().and_then(Weak::upgrade);
        let own = |run: Vec<HostRequest>| {
            let apply = || match &call.mount {
                Some(alive) => self.owners.owned_by(alive, || self.applied(run, call.user, call.export)),
                None => self.applied(run, call.user, call.export),
            };
            match &owner {
                Some(owner) => self.owners.as_owner(owner, apply),
                None => apply(),
            }
        };
        let results: Vec<serde_json::Value> = runs
            .into_iter()
            .flat_map(|(mount, run)| match mount {
                Some(mount) => self.applied_as(&mount, run, call.export),
                None => own(run),
            })
            .collect();
        self.answered(&format!("c{seq}"), results);
    }

    /// Applies `effects` the JS host sent outside a call as `mount`'s, as that mount's call would have asked for them: to
    /// it, or, once it closed, nowhere, answering each with nothing (the ownership rule of 2.8).
    pub(crate) fn mount_effects(self: &Rc<Self>, key: &str, mount: &v2::MountId, effects: Vec<HostRequest>) {
        if effects.is_empty() || self.ended() {
            return;
        }
        let results = self.applied_as(mount, effects, "update");
        self.answered(key, results);
    }

    /// [`Guest::applied`] as `mount`'s: to it, or nowhere once it closed, each answered with nothing.
    fn applied_as(
        self: &Rc<Self>,
        mount: &v2::MountId,
        effects: Vec<HostRequest>,
        export: &str,
    ) -> Vec<serde_json::Value> {
        let owner = self.activation.owners().into_iter().find(|owner| owner.id() == Some(mount));
        let Some(owner) = owner else {
            log::debug!("plugin {}: effects of mount {mount:?}, which closed, apply nowhere", self.id());
            return vec![serde_json::Value::Null; effects.len()];
        };
        let apply = || self.applied(effects, false, export);
        self.owners.as_owner(&owner, || match owner.mounted() {
            Some(alive) => self.owners.owned_by(&alive, apply),
            None => apply(),
        })
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
        let results = self.applied(effects, user, export);
        self.answered(key, results);
    }

    /// Queues `effects` on the effect queue, as a call of kind `export` (for the user's input when `user`) would have
    /// asked for them, and what each answered.
    fn applied(self: &Rc<Self>, effects: Vec<HostRequest>, user: bool, export: &str) -> Vec<serde_json::Value> {
        if self.handed_over.get() {
            self.carry(&effects);
        }
        let mut ctx = Ctx::new(self.host.clone(), self.id(), self.keys.borrow().clone());
        // Setup holds nothing of the input, as in process.
        ctx.owners = (export != "setup").then(|| self.owners.clone());
        let results: Vec<serde_json::Value> = effects
            .into_iter()
            .map(|request| {
                // A JS plugin keeps its own timers (`setTimeout`). The pipe answers no timer, so it gives no ID for one
                // whose reply would never come (big-boi tm-3).
                if matches!(request, HostRequest::Timer { .. }) {
                    log::warn!(
                        "plugin {}: a JS plugin keeps time with setTimeout: the host refuses a timer",
                        self.id()
                    );
                    return serde_json::Value::Null;
                }
                // A store's write answers whether it was kept: refused, it says why, and the layer's update rejects
                // and shows what is stored, where a null left the plugin showing a value the host refused.
                let write = matches!(request, HostRequest::StorageSet { .. } | HostRequest::StorageMerge { .. });
                match behave::as_user(user, || behave::calling(export, || handle(&mut ctx, request))) {
                    Ok(_) if write => serde_json::Value::Bool(true),
                    Ok(value) => value,
                    Err(error) => {
                        log::warn!("plugin {}: {error}", self.id());
                        if write { serde_json::json!({ "error": error }) } else { serde_json::Value::Null }
                    }
                }
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
        results
    }

    /// The states `effects` set the commands to, which a guest that handed its activation on gives the one that takes it
    /// over, as the pending load's manifest does not hold them (carbon ce-5).
    fn carry(&self, effects: &[HostRequest]) {
        let Some(scripts) = self.scripts.upgrade() else { return };
        let loads = scripts.loads.borrow();
        let Some(super::Loading::Loaded(loaded)) = loads.get(&self.loaded.target).map(|load| &load.state) else {
            return;
        };
        let set = effects.iter().filter_map(|effect| match effect {
            HostRequest::SetEnabled { name, enabled } => Some((name.clone(), *enabled)),
            _ => None,
        });
        loaded.states.borrow_mut().extend(set);
    }

    /// Tells the JS host what the effects it sent under `key` answered.
    fn answered(&self, key: &str, results: Vec<serde_json::Value>) {
        let activation = self.js.get();
        let (id, key) = (self.id().to_owned(), key.to_owned());
        self.send(Down::Answered { id, activation, key, results, parted: false, dropped: Vec::new() }, None);
    }

    /// Fails the plugin with `error`: it is not called again, and the host says so once.
    pub(crate) fn fail(self: &Rc<Self>, error: String) {
        if self.failure.borrow().is_some() {
            return;
        }
        let revoked = self.layers.take().into_iter().chain(self.revoked.take()).collect();
        crate::fail(&self.host, self.id(), &self.failure, revoked, &self.activation, error);
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
        if let Some(viewer) = viewers.iter().find(|viewer| viewer.has(&tree.mount)) {
            if viewer.take(self, tree) {
                self.activation.invalidate();
            }
            return;
        }
        // A claimed part's: its parts are drawn again, and the one it is for takes it (contract 2.x, step D).
        let claims = self.claims.borrow().clone();
        match claims.iter().find(|claim| claim.has(&tree.mount)) {
            Some(claim) => {
                if claim.take(tree) {
                    self.activation.invalidate();
                }
            }
            None => count(|crossed| crossed.dropped += 1),
        }
    }

    /// A frame's geometry is final and laid out one of its mounts (contract 2.x, addition 1, R2): the rects it watches
    /// that changed go to the JS host now, in place of a timer after each tree. A node's layout changes
    /// with no change of the host's data, which is what refreshes the other reads. A push may draw, lay out and push
    /// again, one round a frame: past [`RECT_ROUNDS`] frames in a row of it with no other cause, the pushes wait for
    /// one, and the log says so once (R3).
    pub(crate) fn laid_out(&self, frame: u64) {
        let (last, rounds) = self.rects.get();
        if rounds > RECT_ROUNDS || self.ended() {
            return;
        }
        if !self.refresh_where(|request| matches!(request, HostRequest::Rect { .. })) {
            // A frame that changed none settles the count; a later round of the same frame that did counts once.
            if last != frame {
                self.rects.set((frame, 0));
            }
            return;
        }
        let rounds = if last == frame { rounds.max(1) } else { rounds + 1 };
        if rounds > RECT_ROUNDS {
            log::warn!(
                "plugin {}: its layout changed in {RECT_ROUNDS} frames in a row and never settled; its rects wait for \
                 another cause",
                self.id()
            );
        }
        self.rects.set((frame, rounds));
    }

    /// Another cause than a layout came (a call: an input or an event; a new input of a mount): the rects are pushed
    /// again.
    pub(crate) fn caused(&self) {
        let (frame, _) = self.rects.get();
        self.rects.set((frame, 0));
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
            let (id, activation) = (self.id().to_owned(), self.js.get());
            self.send(
                Down::Snapshot { id, activation, key, value: serde_json::Value::Null, error, parted: false },
                None,
            );
            return;
        }
        let (value, hash) = self.evaluate(&request);
        watches.insert(key.clone(), (request, Some(hash)));
        drop(watches);
        if !self.push(key.clone(), value) {
            self.undelivered(&key);
        }
    }

    /// The last value of `key` did not reach the JS host: its next refresh pushes it again, though it did not change
    /// (big-boi's `cg4-8`: a read refused while the plugin's content room was full stayed failed once room came back).
    fn undelivered(&self, key: &str) {
        if let Some((_, last)) = self.watches.borrow_mut().get_mut(key) {
            *last = None;
        }
    }

    /// Pushes the value of the read `key` watches: as a failed read when it is past the content its plugin may hold
    /// beside what it holds (4.2, phase Pl), or when its snapshot is more than the JS host takes now, in one frame or in
    /// parts (CT-36), which the plugin reads as nothing, and can ask why; the plugin goes on (review: bound each read).
    /// What it pushes is charged to its content while it watches it. Whether it went.
    fn push(&self, key: String, value: serde_json::Value) -> bool {
        let bytes = Measure::of(&value).bytes;
        let held = self.pushed.borrow().get(&key).copied().unwrap_or(0);
        let activation = self.js.get();
        let snapshot = Down::Snapshot {
            id: self.id().to_owned(),
            activation,
            key: key.clone(),
            value,
            error: None,
            parted: false,
        };
        let error = if bytes as u64 > limits::room(self.id(), limits::Kind::Content, held) {
            Some(format!("the read is {bytes} bytes, past what the plugin may hold"))
        } else {
            // Sent as it is, a frame the queue refuses would leave the plugin with the value before (bigboi's pipe
            // sign-off): what goes in neither one frame nor the parts the overflow has room for fails now.
            let untaken = self.scripts.upgrade().and_then(|scripts| scripts.untaken(&snapshot));
            untaken.map(|size| format!("the read's snapshot is {size} bytes, more than the JS host takes"))
        };
        let charged = if error.is_some() { 0 } else { bytes as u64 };
        limits::recharge(self.id(), limits::Kind::Content, held, charged);
        self.pushed.borrow_mut().insert(key.clone(), charged);
        if error.is_none() {
            self.failures.borrow_mut().remove(&key);
        }
        let snapshot = match error {
            Some(error) if self.failures.borrow().get(&key) == Some(&error) => return false,
            Some(error) => {
                log::warn!("plugin {}: the read it watches as {key}: {error}", self.id());
                self.failures.borrow_mut().insert(key.clone(), error.clone());
                let id = self.id().to_owned();
                Down::Snapshot {
                    id,
                    activation,
                    key,
                    value: serde_json::Value::Null,
                    error: Some(error),
                    parted: false,
                }
            }
            None => snapshot,
        };
        let pushed = matches!(snapshot, Down::Snapshot { error: None, .. });
        self.send(snapshot, None);
        pushed
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
        self.undelivered(key);
    }

    pub(crate) fn unwatch(&self, key: &str) {
        self.watches.borrow_mut().remove(key);
        self.failures.borrow_mut().remove(key);
        if let Some(charged) = self.pushed.borrow_mut().remove(key) {
            limits::release(self.id(), limits::Kind::Content, charged);
        }
    }

    /// Pushes each watched read whose value changed.
    fn refresh(&self) {
        self.refresh_where(|_| true);
    }

    /// Pushes what changed of the watched reads `which` picks: whether any did.
    fn refresh_where(&self, which: impl Fn(&HostRequest) -> bool) -> bool {
        if self.ended() {
            return false;
        }
        let changed: Vec<(String, serde_json::Value)> = {
            let mut watches = self.watches.borrow_mut();
            watches
                .iter_mut()
                .filter(|(_, (request, _))| which(request))
                .filter_map(|(key, (request, last))| {
                    let (value, hash) = self.evaluate(request);
                    (*last != Some(hash)).then(|| {
                        *last = Some(hash);
                        (key.clone(), value)
                    })
                })
                .collect()
        };
        let any = !changed.is_empty();
        for (key, value) in changed {
            if !self.push(key.clone(), value) {
                self.undelivered(&key);
            }
        }
        any
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

    // The JS host settles the promise that waits.
    fn cancels(&self) -> bool {
        true
    }
}

/// `commands` without their states, which change by `set-enabled` and take no reload.
fn stateless(commands: &[opencode_plugin_abi::Command]) -> Vec<opencode_plugin_abi::Command> {
    let enable = |command: &opencode_plugin_abi::Command| {
        let mut command = command.clone();
        command.enabled = true;
        command
    };
    commands.iter().map(enable).collect()
}

/// A command of the plugin's, which runs on the JS host; a route's runs for the mount `alive`. A key that runs it holds
/// the keys after it until the JS host answers, as TS runs a command before the next key. If the command declines (it
/// returned `false`, or it is disabled), the key goes on to the host, the whole chord that ran it, and this command
/// passes it on as it comes again, as TS binds no disabled command and lets a declined key fall through (CT-8, CT-19,
/// ce-4).
fn js_command(guest: &Rc<Guest>, command: &opencode_plugin_abi::Command, alive: Option<Weak<()>>) -> TuiCommand {
    let (called, name) = (guest.clone(), command.name.clone());
    let hold = guest.commands.borrow().1.contains(&name);
    let entry = format!("{}\u{0}{name}", guest.id());
    let scripts = guest.scripts.clone();
    // Disabled (contract ergonomics 2.5). A key it declined passes it as it runs, not by this condition, which the
    // palette reads too (ce-4).
    let enabled = crate::command_enabled(&guest.activation, &name);
    // A key it declines goes on once the JS host answers, as the hold routes it again; the command took it until then.
    keyed_command(guest.id(), command, enabled, move |input, key| {
        let Some(scripts) = scripts.upgrade() else { return opencode_plugin_abi::interact::Handled::Pass };
        if key.is_some() && scripts.stepped_aside(&entry) {
            return opencode_plugin_abi::interact::Handled::Pass;
        }
        let request = Request::Command { name: name.clone(), input: input.map(str::to_owned) };
        let key = key.map(|key| super::Keyed::chord(*key, &scripts, &entry));
        called.call_keyed("run-command", request, hold || key.is_some(), (None, alive.clone()), key);
        opencode_plugin_abi::interact::Handled::Consume
    })
}

/// Registers what the plugin's setup listed, each calling it on the JS host.
fn register(setup: &mut Setup<'_>, guest: &Rc<Guest>) {
    let manifest = &guest.loaded.manifest;
    guest.activation.commands(&manifest.commands);
    for (name, enabled) in guest.loaded.states.take() {
        guest.activation.set_enabled(guest.id(), &name, enabled);
    }
    let disposed = guest.clone();
    setup.on_dispose(move || disposed.dispose());
    // A route's commands are bound to each of its mounts below.
    guest.layer_commands(&**setup.host());
    {
        let guest = guest.clone();
        setup.on_dispose(move || {
            guest.layers.take().into_iter().chain(guest.revoked.take()).for_each(Disposer::dispose);
        });
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
                    routed.iter().map(|command| js_command(&guest, command, Some(alive.clone()))).collect()
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
    // Contract 2.x, step D: its renderer claims, whose views run on the JS host and answer after the frame. Past
    // [`CLAIMS`] the rest are not taken, which the log says.
    for (index, entry) in manifest.claims.iter().enumerate().take(CLAIMS) {
        let viewer = ClaimViewer::new(guest, index);
        guest.claims.borrow_mut().push(viewer.clone());
        setup.renderer_claim(entry.clone(), viewer, &guest.owners);
    }
    if manifest.claims.len() > CLAIMS {
        log::warn!(
            "plugin {}: {} renderer claims; the host takes the first {CLAIMS}",
            setup.id(),
            manifest.claims.len()
        );
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
        // A slot's first view before a solve sees the terminal's size, which stands in for its room: its placeholder
        // shows, and the JS host hears of the mount once a solve laid that out, with the room as its first input
        // (contract 2.x, addition 1, R1), so a plugin that sizes itself from it at once sizes right. The surface views
        // again after that first solve ([`surface::Viewer::waits_for_room`]).
        if !started && viewing.laid.is_none() && viewing.input.slot.is_some() {
            let mut mounts = self.mounts.borrow_mut();
            let mount = mounts.get_mut(id)?;
            mount.shown = true;
            let height = self.heights.borrow().get(&id.key).copied().unwrap_or(1);
            return Some(Viewed { node: Some(placeholder(height)), memo: Some(0) });
        }
        // The height it was laid out at, not the input's, which stands in the screen's before a solve (review carbon-7).
        if let (true, Some(laid)) = (real, viewing.laid) {
            self.heights.borrow_mut().insert(id.key.clone(), laid);
        }
        if !started || sent.as_ref() != Some(&input) {
            guest.caused();
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

    fn waits_for_room(&self) -> bool {
        true
    }

    fn laid_out(&self, mount: &v2::MountId, frame: u64) {
        if let Some(guest) = self.guest.upgrade().filter(|_| self.has(mount)) {
            guest.laid_out(frame);
        }
    }

    fn forget(&self, _host: &dyn Host, id: &v2::MountId, focused: Option<String>) {
        let Some(mount) = self.mounts.borrow_mut().remove(id) else { return };
        let guest = self.guest.upgrade().filter(|guest| !guest.ended());
        // A guest that handed its activation to a reload leaves its mounts to the replacement, which mounts its own.
        if guest.as_ref().is_some_and(|guest| guest.handed_over.get()) {
            return;
        }
        let running = guest.map(|guest| guest.js.get());
        // A mount of an activation a reload handed on ends as the reload's replacement mounts its own (CT-21).
        let handover = running.is_none();
        let Some(activation) = running.or(Some(self.handed.get()).filter(|handed| *handed != 0)) else { return };
        if !mount.started {
            return;
        }
        let Some(scripts) = self.scripts.upgrade() else { return };
        let seq = scripts.next();
        let message = Down::Unmount { seq, id: self.id.clone(), activation, mount: id.clone(), handover, focused };
        scripts.send(message, None);
    }
}

/// The renderer claims a plugin on the JS host may hold (contract 2.x, step D, host policy as O-161's): good-fences
/// registers about 60. TS has no bound.
pub(crate) const CLAIMS: usize = 256;

/// The longest fence code the host sends the JS host: past it, a part would not fit the JS host's frame
/// ([`super::wire::CONTROL_CAP`]), and the fence keeps the host's code view, which the log says once a plugin.
pub(crate) const FENCE_BYTES: usize = 256 << 10;

/// A renderer claim of a plugin on the JS host (contract 2.x, step D). A view never waits: it sends the part to the
/// JS host when the JS host has not seen it, and answers "not yet" ([`crate::claim::Viewed::Pending`]) until the
/// JS host's tree for the part's mount arrives, which wakes the plugin's parts; the next view takes it. The JS host
/// draws one part a mount at a time, and the newest part it was sent once the host adopted the last tree.
pub(crate) struct ClaimViewer {
    this: Weak<ClaimViewer>,
    guest: Weak<Guest>,
    /// The plugin and its JS host, which a part's end is told to after the guest went.
    id: String,
    scripts: Weak<Scripts>,
    index: usize,
    mounts: RefCell<HashMap<v2::MountId, ClaimMount>>,
    /// The JS host's activation the guest handed to a reload: its parts' mounts still end there (carbon c2d-1).
    handed: Cell<u64>,
}

#[derive(Default)]
struct ClaimMount {
    /// A part of it was sent: the JS host has the mount, whose end it is told.
    started: bool,
    /// A digest of the part the JS host was sent last ([`digest`]), with no copy of it: a fence's may be 256 KiB.
    sent: Option<u64>,
    pending: Option<Box<Revision>>,
    /// The revision offered to the claim, until it is adopted or refused.
    offered: Option<u64>,
    adopted: u64,
}

impl ClaimViewer {
    fn new(guest: &Rc<Guest>, index: usize) -> Rc<Self> {
        Rc::new_cyclic(|this| Self {
            this: this.clone(),
            guest: Rc::downgrade(guest),
            id: guest.id().to_owned(),
            scripts: guest.scripts.clone(),
            index,
            mounts: RefCell::default(),
            handed: Cell::new(0),
        })
    }

    fn has(&self, mount: &v2::MountId) -> bool {
        self.mounts.borrow().contains_key(mount)
    }

    /// Takes revision `tree` for its part: whether the part has something new to show. One that comes while another
    /// waits for a view is dropped, as the JS host keeps one in flight.
    fn take(&self, tree: Box<Revision>) -> bool {
        let mut mounts = self.mounts.borrow_mut();
        let Some(mount) = mounts.get_mut(&tree.mount) else { return false };
        if mount.pending.is_some() || mount.offered.is_some() {
            count(|crossed| crossed.dropped += 1);
            return false;
        }
        mount.pending = Some(tree);
        true
    }

    /// The offered revision of `mount` was adopted, or refused: the JS host is told, and draws the newest part next.
    fn settle(&self, id: &v2::MountId, adopted: bool) {
        let Some(guest) = self.guest.upgrade().filter(|guest| !guest.ended()) else { return };
        let mut mounts = self.mounts.borrow_mut();
        let Some(mount) = mounts.get_mut(id) else { return };
        let Some(rev) = mount.offered.take() else { return };
        let message = match adopted {
            true => {
                mount.adopted = rev;
                count(|crossed| crossed.adopted += 1);
                Down::Adopted { id: guest.id().to_owned(), mount: id.clone(), rev }
            }
            false => {
                count(|crossed| crossed.refused += 1);
                let error = "the host refused it".to_owned();
                Down::Refused { id: guest.id().to_owned(), mount: id.clone(), rev, adopted: mount.adopted, error }
            }
        };
        drop(mounts);
        guest.send(message, None);
    }

    /// The part the JS host was sent for `mount` never reached it: whether this claim holds the mount.
    fn unsent(&self, mount: &v2::MountId) -> bool {
        let mut mounts = self.mounts.borrow_mut();
        let Some(mount) = mounts.get_mut(mount) else { return false };
        mount.sent = None;
        true
    }

    /// Ends a part's mount: it is not viewed again, and ends on the JS host too, also one of a guest that handed its
    /// activation to a reload, whose replacement claims its parts in mounts of its own: the JS host would hold the old
    /// one in flight for good, and its `ping` would never settle (carbon c2d-1). A tree for it that comes later is
    /// dropped.
    fn end(&self, id: &v2::MountId) {
        let Some(mount) = self.mounts.borrow_mut().remove(id) else { return };
        if !mount.started {
            return;
        }
        let running = self.guest.upgrade().filter(|guest| !guest.ended()).map(|guest| guest.js.get());
        let Some(activation) = running.or(Some(self.handed.get()).filter(|handed| *handed != 0)) else { return };
        let Some(scripts) = self.scripts.upgrade() else { return };
        let seq = scripts.next();
        let message =
            Down::Unmount { seq, id: self.id.clone(), activation, mount: id.clone(), handover: false, focused: None };
        scripts.send(message, None);
    }

    /// The JS host started again: each part is sent again as it is drawn next.
    fn restart(&self) {
        for mount in self.mounts.borrow_mut().values_mut() {
            *mount = ClaimMount::default();
        }
    }

    /// Sends `part` of `mount` to the JS host, unless what the host sent waits in its overflow: then it is sent as it
    /// is drawn after the overflow drained, oldest first, so a transcript that mounts many fences at once neither
    /// floods the queue nor loses one (contract 2.x, step D). Meanwhile the host's row or the last tree shows.
    fn tell(&self, guest: &Rc<Guest>, id: &v2::MountId, part: &opencode_plugin_abi::claim::Part) {
        let Some(scripts) = guest.scripts.upgrade() else { return };
        if scripts.backed_up() {
            count(|crossed| crossed.deferred_parts += 1);
            return scripts.reoffer(guest);
        }
        let seq = scripts.next();
        if let Some(mount) = self.mounts.borrow_mut().get_mut(id) {
            (mount.started, mount.sent) = (true, Some(digest(part)));
        }
        guest.caused();
        let message = Down::Claim {
            seq,
            id: guest.id().to_owned(),
            activation: guest.js.get(),
            claim: self.index,
            mount: id.clone(),
            part: part.clone(),
        };
        // The queue may refuse it here, which marks the part unsent ([`Guest::claim_refused`]): no borrow is held.
        scripts.send(message, Some(Waiting::View(self.guest.clone())));
    }
}

impl crate::claim::Viewer for ClaimViewer {
    fn view(
        &self,
        _: &dyn Host,
        viewing: Viewing<'_>,
        part: &opencode_plugin_abi::claim::Part,
    ) -> crate::claim::Viewed {
        use crate::claim::Viewed;
        let Some(guest) = self.guest.upgrade().filter(|guest| !guest.ended()) else { return Viewed::Failed };
        let id = viewing.mount;
        if let opencode_plugin_abi::claim::Part::Fence(fence) = part
            && fence.code.len() > FENCE_BYTES
        {
            if !guest.over_cap.replace(true) {
                log::warn!("plugin {}: a fence of {} bytes keeps the host's code view", guest.id(), fence.code.len());
            }
            // One that grew past it while a tree was in flight ends its mount on the JS host, which drops that tree and
            // holds nothing in flight for it (carbon c2d-2).
            self.end(id);
            return Viewed::Returned(None, Some(0));
        }
        // A view with `full` after an offer: the claim refused the tree it took.
        if self.mounts.borrow().get(id).is_some_and(|mount| mount.offered.is_some()) {
            self.settle(id, !viewing.input.full);
        }
        let (taken, unsent) = {
            let mut mounts = self.mounts.borrow_mut();
            let mount = mounts.entry(id.clone()).or_default();
            (mount.pending.take(), mount.sent != Some(digest(part)))
        };
        // The renderer threw, or gave what the host cannot read: the part falls back for its mount, which ends on the
        // JS host ([`ClaimViewer::fell`]); the plugin goes on. No newer part goes to it first (carbon c2d-2).
        let tree = match taken.map(|tree| (tree.rev, tree.error, tree.node)) {
            Some((_, Some(error), _)) => {
                log::warn!("plugin {}: the renderer of part {} threw: {error}", guest.id(), id.key);
                return Viewed::Failed;
            }
            Some((rev, None, node)) if node.is_null() => Some((rev, None)),
            Some((rev, None, node)) => match super::timed(|| serde_json::from_value::<v2::Node>(node)) {
                Ok(node) => Some((rev, Some(Box::new(node)))),
                Err(error) => {
                    log::warn!("plugin {}: a tree for part {} the host cannot read: {error}", guest.id(), id.key);
                    return Viewed::Failed;
                }
            },
            None => None,
        };
        // The newest part goes now, also beside a tree that was drawn for an older one: the JS host draws it next.
        if unsent {
            self.tell(&guest, id, part);
        }
        let Some((rev, node)) = tree else { return Viewed::Pending };
        if let Some(mount) = self.mounts.borrow_mut().get_mut(id) {
            mount.offered = Some(rev);
        }
        // Adopted unless the claim refuses it in this same draw, which asks again with `full` at once, or falls back,
        // which ends the mount and leaves nothing to settle.
        let (viewer, owner, id) = (self.this.clone(), guest.host.clone(), id.clone());
        crate::defer(&owner, move |_| {
            if let Some(viewer) = viewer.upgrade() {
                viewer.settle(&id, true);
            }
        });
        Viewed::Returned(node, Some(0))
    }

    fn forget(&self, _: &dyn Host, id: &v2::MountId) {
        self.end(id);
    }

    fn fell(&self, _: &dyn Host, id: &v2::MountId) {
        self.end(id);
    }
}

/// A digest of `part`: its JSON as the JS host would read it, hashed as it is written, so no copy of it is made (carbon
/// c2d-3). Two parts with the same digest are taken for one: 64 bits make another part's the same by chance negligible.
fn digest(part: &opencode_plugin_abi::claim::Part) -> u64 {
    use std::hash::Hasher;
    struct Hashing(std::collections::hash_map::DefaultHasher);
    impl std::io::Write for Hashing {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0.write(bytes);
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    let mut hashing = Hashing(std::collections::hash_map::DefaultHasher::new());
    let _ = serde_json::to_writer(&mut hashing, part);
    hashing.0.finish()
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
