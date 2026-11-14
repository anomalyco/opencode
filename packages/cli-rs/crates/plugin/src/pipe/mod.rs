//! The pipe carrier (rich-plugins synthesis 3.3, 3.7, 4.3; phase P7): contract 2.0 over a process pipe, to one shared
//! JS host that runs every TypeScript TUI plugin (`host.ts`, on Bun). It is the second timing tier: no frame waits for
//! the JS host, so what a plugin returns arrives a paint late or more.
//!
//! - **Events** carry a sequence. The JS host acknowledges each on receipt and answers a handler with its effects when
//!   it returned ([`proto::Up::Done`]). Effects apply in that order; a handler that threw has none and fails its
//!   plugin, as on the other carriers.
//! - **Trees** are revisions of a mount ([`proto::Revision`]): a generation (the mount's), a base, a new revision and a
//!   layout epoch. A mount has at most one tree in flight: the host adopts or refuses it, says so, and the JS host
//!   sends the next. A surface shows a whole adopted revision, a placeholder that keeps the room its key had, or the
//!   fallback; never part of one.
//! - **Reads** are snapshots the host pushes for what the plugin watches, before the event that may read them.
//! - **Hold:** a command that declares it holds the keys typed after it until its handler returned, or 50 ms.
//! - **Supervision** ([`child`]): bounded queues, a hang rule on acknowledgements, a memory budget, cleanup of the
//!   process group. A JS host that ends, hangs or goes over its budget is ended and started again; the plugin whose
//!   handler ran fails, and the others are set up again, their surfaces keeping their last trees meanwhile. Three ends
//!   in a minute fail every plugin on it.
//!
//! The JS host runs only when [`Config::from_env`] finds it asked for (`OPENCODE_PLUGIN_JS=1`): until the V2
//! compatibility layer (P8) maps their UI, most TypeScript plugins would fail on it.

pub mod child;
mod guest;
pub mod proto;
pub mod wire;

use std::cell::{Cell, RefCell};
use std::collections::{HashMap, VecDeque};
use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::{Path, PathBuf};
use std::rc::{Rc, Weak};
use std::time::{Duration, Instant};

use opencode_plugin_abi::HostRequest;
use opentui::keymap::Disposer;
use opentui::prelude::*;

use crate::{Definition, ErrorFn, Host};
use child::Child;
pub use child::Limits;
use guest::Guest;
use proto::{Down, Up};

/// The JS host's source, written to a private directory and run by Bun.
const SOURCE: &str = include_str!("host.ts");

/// How the JS host runs.
#[derive(Clone, Debug)]
pub struct Config {
    /// The Bun executable.
    pub bun: PathBuf,
    /// Bun's arguments before the script.
    pub args: Vec<String>,
    pub limits: Limits,
    /// Ends of the JS host within [`Config::window`] after which it is not started again.
    pub ends: usize,
    pub window: Duration,
    /// How long a holding command holds the keys after it.
    pub hold: Duration,
}

impl Config {
    pub fn new(bun: PathBuf) -> Self {
        Self {
            bun,
            args: Vec::new(),
            limits: Limits::default(),
            ends: 3,
            window: Duration::from_secs(60),
            hold: Duration::from_millis(50),
        }
    }

    /// The JS host, when `OPENCODE_PLUGIN_JS` is `1` and Bun is found: `OPENCODE_BUN`, or `bun` on the path.
    pub fn from_env() -> Option<Self> {
        if std::env::var("OPENCODE_PLUGIN_JS").ok().as_deref() != Some("1") {
            return None;
        }
        let bun = std::env::var_os("OPENCODE_BUN").map(PathBuf::from).or_else(|| find("bun"))?;
        Some(Self::new(bun))
    }
}

/// `name` on the `PATH`.
pub fn find(name: &str) -> Option<PathBuf> {
    let file = format!("{name}{}", std::env::consts::EXE_SUFFIX);
    std::env::split_paths(&std::env::var_os("PATH")?).map(|dir| dir.join(&file)).find(|path| path.is_file())
}

/// What crossed the pipe, counted outside any plugin and any mount (4.14, `work`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Crossed {
    /// Messages and bytes the host sent.
    pub sent: u64,
    pub sent_bytes: u64,
    /// Messages, trees among them, and bytes the host received, and of them in trees.
    pub received: u64,
    pub trees: u64,
    pub received_bytes: u64,
    pub tree_bytes: u64,
    /// Revisions adopted, refused, and dropped as stale or for a mount that ended.
    pub adopted: u64,
    pub refused: u64,
    pub dropped: u64,
    /// JS hosts started.
    pub started: u64,
    /// Messages the host had no room for, not sent.
    pub refused_sends: u64,
    /// Time the UI thread spent in the carrier's own code: encoding and queueing what it sends, taking what came, and
    /// reading a revision's tree. Not the host's work on the tree, which every carrier has.
    pub host: Duration,
}

thread_local! {
    static CROSSED: Cell<Crossed> = const { Cell::new(Crossed {
        sent: 0, sent_bytes: 0, received: 0, trees: 0, received_bytes: 0, tree_bytes: 0, adopted: 0, refused: 0,
        dropped: 0, started: 0, refused_sends: 0, host: Duration::ZERO,
    }) };
}

/// What crossed the pipe on this thread so far.
pub fn crossed() -> Crossed {
    CROSSED.with(Cell::get)
}

/// Runs `f`, counting its time as the carrier's own.
fn timed<R>(f: impl FnOnce() -> R) -> R {
    let begun = Instant::now();
    let out = f();
    let took = begun.elapsed();
    count(|crossed| crossed.host += took);
    out
}

fn count(f: impl FnOnce(&mut Crossed)) {
    CROSSED.with(|cell| {
        let mut crossed = cell.get();
        f(&mut crossed);
        cell.set(crossed);
    });
}

/// Where a loader's target stands on the JS host.
pub(crate) enum Step {
    /// Its load is on its way.
    Starting,
    /// It loaded: register it.
    Ready(Definition, ErrorFn, u64),
    /// Registered already, and unchanged.
    Same,
    /// It has no TUI module.
    Unsupported,
    Failed(String, u64),
}

/// A target's load.
struct Load {
    dir: PathBuf,
    options: Option<String>,
    digest: u64,
    state: Loading,
    registered: bool,
}

enum Loading {
    Waiting(u64),
    Loaded(Rc<guest::Loaded>),
    Unsupported,
    Failed(String),
}

/// What a sequence awaits; a message that is only acknowledged (an unmount, a deactivation) awaits nothing here.
enum Waiting {
    /// A load of the target.
    Load(String),
    /// A setup again, for an activation.
    Activate(Weak<Guest>),
    /// A handler, kept whole: one the JS host did not start when it ended is sent again to the next one.
    Call(Call),
    /// A mount's or an input's view.
    View(Weak<Guest>),
    Ping,
}

/// A handler's call as the host sent it.
struct Call {
    guest: Weak<Guest>,
    export: &'static str,
    /// It answers the user's input.
    user: bool,
    request: opencode_plugin_abi::Request,
    /// The input owner of a handler's event (P2): its effects are that mount's, as in process.
    owner: Option<Weak<crate::interact::Owner>>,
}

/// Whom an end of the JS host names.
enum Blame {
    /// The work the JS host said it started and did not finish.
    Running,
    /// Nobody: the JS host as a whole (its memory).
    Nobody,
    /// A plugin that flooded it.
    Plugin(String),
}

/// A fault the next handler's message suffers on its way to the JS host (4.14's pipe operators), for the tests.
#[doc(hidden)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Fault {
    Drop,
    Repeat,
    /// Sent after the message that follows it.
    Swap,
}

/// A fault the next revision from the JS host suffers, for the tests.
#[doc(hidden)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tamper {
    /// It is kept, so [`Scripts::replay`] can deliver it again later, when it is stale.
    Keep,
    /// Its tree is a keep of a key the host does not hold.
    UnknownKeep,
}

/// Posted by a reader thread: the JS host of `Scripts` sent something.
struct Woken(u64);

/// The JS host and the TypeScript plugins on it, on the UI thread.
pub struct Scripts {
    this: Weak<Scripts>,
    config: Config,
    host: Weak<dyn Host>,
    id: u64,
    child: RefCell<Option<Child>>,
    /// The directory of the written script, while the JS host may run.
    script: RefCell<Option<opencode_util::temp::TempDir>>,
    seq: Cell<u64>,
    /// The bytes read from the running JS host, and of them in trees, as last counted.
    read: Cell<(u64, u64)>,
    loads: RefCell<HashMap<String, Load>>,
    /// Each plugin's running activation, by ID.
    guests: RefCell<HashMap<String, Weak<Guest>>>,
    /// What a plugin sent after its setup was answered and before the loader registered it: its watches, its effects.
    early: RefCell<HashMap<String, Vec<Up>>>,
    waiting: RefCell<HashMap<u64, Waiting>>,
    /// The sequences the running JS host said it started.
    started: RefCell<std::collections::HashSet<u64>>,
    /// Messages the running JS host's queue had no room for yet, in order, and their bytes: they go once it reads.
    overflow: RefCell<(VecDeque<(Down, usize)>, usize)>,
    reconcile: RefCell<Option<Rc<dyn Fn()>>>,
    ends: RefCell<VecDeque<Instant>>,
    /// Why the JS host is not started again.
    stopped: RefCell<Option<String>>,
    /// The ping last answered, and whether a tree waited then.
    pong: Cell<Option<(u64, bool)>>,
    hold: RefCell<Hold>,
    /// The fault armed for the next handler's message, and a message a swap holds back.
    fault: Cell<Option<Fault>>,
    swapped: RefCell<Option<Down>>,
    tamper: Cell<Option<Tamper>>,
    kept: RefCell<Option<Box<proto::Revision>>>,
    _handler: Cell<Option<HandlerId>>,
    _intercepts: RefCell<Vec<Disposer>>,
}

/// Keys held for a command that holds them.
#[derive(Default)]
struct Hold {
    /// The command's sequence, while it holds.
    seq: Option<u64>,
    keys: VecDeque<KeyEvent>,
    timer: Option<TimerId>,
    /// Keys put back now, which the intercept lets through.
    replaying: bool,
}

/// The most keys a hold keeps; past it the oldest goes, and the log says so.
const HELD: usize = 64;

impl Scripts {
    pub fn new(config: Config, host: &Rc<dyn Host>) -> Rc<Self> {
        static IDS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
        let id = IDS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let scripts = Rc::new_cyclic(|this| Self {
            this: this.clone(),
            config,
            host: Rc::downgrade(host),
            id,
            child: RefCell::default(),
            script: RefCell::default(),
            seq: Cell::new(0),
            read: Cell::new((0, 0)),
            loads: RefCell::default(),
            guests: RefCell::default(),
            early: RefCell::default(),
            waiting: RefCell::default(),
            started: RefCell::default(),
            overflow: RefCell::default(),
            reconcile: RefCell::default(),
            ends: RefCell::default(),
            stopped: RefCell::default(),
            pong: Cell::new(None),
            hold: RefCell::default(),
            fault: Cell::new(None),
            swapped: RefCell::default(),
            tamper: Cell::new(None),
            kept: RefCell::default(),
            _handler: Cell::new(None),
            _intercepts: RefCell::default(),
        });
        let weak = Rc::downgrade(&scripts);
        let handler = host.app().on_message(move |_, woken: &Woken| {
            if let Some(scripts) = weak.upgrade().filter(|scripts| scripts.id == woken.0) {
                scripts.woken();
            }
        });
        scripts._handler.set(Some(handler));
        let keymap = host.keymap().keymap();
        let intercepts = [false, true].map(|release| {
            let weak = Rc::downgrade(&scripts);
            keymap.intercept_key(i32::MAX, release, move |cx| {
                if let Some(scripts) = weak.upgrade() {
                    scripts.intercept(cx.event, || cx.consume());
                }
            })
        });
        scripts._intercepts.borrow_mut().extend(intercepts);
        scripts
    }

    /// Runs `reconcile` when a target's load is answered, or a plugin's registrations changed: the loader takes them.
    pub fn on_reconcile(&self, reconcile: Rc<dyn Fn()>) {
        *self.reconcile.borrow_mut() = Some(reconcile);
    }

    /// The JS host's process ID, while it runs.
    pub fn pid(&self) -> Option<u32> {
        self.child.borrow().as_ref().map(Child::pid)
    }

    /// The JS host's resident set, while it runs.
    pub fn resident(&self) -> Option<u64> {
        self.child.borrow().as_ref().and_then(Child::resident)
    }

    /// Asks the JS host to answer once it handled everything sent so far; [`Scripts::ponged`] tells when it did.
    pub fn ping(&self) -> u64 {
        let seq = self.next();
        self.send(Down::Ping { seq }, Some(Waiting::Ping));
        seq
    }

    /// Whether ping `seq` was answered, and if so whether a tree waited for the host then.
    pub fn ponged(&self, seq: u64) -> Option<bool> {
        self.pong.get().filter(|(answered, _)| *answered >= seq).map(|(_, waiting)| waiting)
    }

    /// Whether nothing waits for the JS host: no load, setup, handler or view is unanswered (a ping is left out).
    pub fn idle(&self) -> bool {
        self.waiting.borrow().values().all(|waiting| matches!(waiting, Waiting::Ping))
    }

    /// How many answers the host waits for, pings included.
    #[doc(hidden)]
    pub fn waiting(&self) -> usize {
        self.waiting.borrow().len()
    }

    /// Arms `fault` for the next handler's message.
    #[doc(hidden)]
    pub fn fault(&self, fault: Fault) {
        self.fault.set(Some(fault));
    }

    /// Arms `tamper` for the next revision.
    #[doc(hidden)]
    pub fn tamper(&self, tamper: Tamper) {
        self.tamper.set(Some(tamper));
    }

    /// Delivers again the revision [`Tamper::Keep`] kept.
    #[doc(hidden)]
    pub fn replay(&self) {
        let kept = self.kept.borrow_mut().take();
        if let Some(tree) = kept {
            match self.guest(&tree.id) {
                Some(guest) => guest.tree(tree),
                None => count(|crossed| crossed.dropped += 1),
            }
        }
    }

    /// Ends the JS host as a crash would, for tests of what follows.
    pub fn kill(&self) {
        if let Some(child) = self.child.borrow().as_ref() {
            child.kill();
        }
    }

    fn next(&self) -> u64 {
        self.seq.set(self.seq.get() + 1);
        self.seq.get()
    }

    /// Where `target`, the plugin directory `dir` with `options`, stands; sends its load when it is new or changed.
    pub(crate) fn step(self: &Rc<Self>, target: &str, dir: &Path, options: Option<&str>) -> Step {
        if let Some(stopped) = self.stopped.borrow().clone() {
            return Step::Failed(stopped, 0);
        }
        let digest = digest(dir, options);
        let mut loads = self.loads.borrow_mut();
        if let Some(load) = loads.get_mut(target).filter(|load| load.digest == digest) {
            return match &load.state {
                Loading::Waiting(_) => Step::Starting,
                Loading::Loaded(loaded) if !load.registered => {
                    load.registered = true;
                    let (definition, error) = guest::define(self, loaded.clone());
                    Step::Ready(definition, error, digest)
                }
                Loading::Loaded(_) => Step::Same,
                Loading::Unsupported => Step::Unsupported,
                Loading::Failed(error) => Step::Failed(error.clone(), digest),
            };
        }
        let seq = self.next();
        let options_text = options.map(str::to_owned);
        loads.insert(
            target.to_owned(),
            Load {
                dir: dir.to_owned(),
                options: options_text,
                digest,
                state: Loading::Waiting(seq),
                registered: false,
            },
        );
        drop(loads);
        let options = options.and_then(|options| serde_json::from_str(options).ok());
        let load = Down::Load { seq, target: target.to_owned(), dir: dir.to_string_lossy().into_owned(), options };
        self.send(load, Some(Waiting::Load(target.to_owned())));
        Step::Starting
    }

    /// Forgets `target`, which the loader removed.
    pub(crate) fn forget(&self, target: &str) {
        let removed = self.loads.borrow_mut().remove(target);
        if let Some(Loading::Loaded(loaded)) = removed.map(|load| load.state) {
            self.early.borrow_mut().remove(&loaded.id);
        }
    }

    /// Sends `message` and records what its sequence awaits. A full queue is back-pressure, not a fault (review
    /// bigboi-4): the message waits in the host's overflow, in order, until the JS host reads; past the overflow's bound
    /// it is refused. A JS host that reads nothing is ended by the progress rule ([`child`]), once.
    fn send(&self, message: Down, waiting: Option<Waiting>) {
        let seq = message.seq();
        if let (Some(seq), Some(waiting)) = (seq, waiting) {
            self.waiting.borrow_mut().insert(seq, waiting);
        }
        if self.stopped.borrow().is_some() || !self.started(seq.map_or(self.seq.get(), |seq| seq - 1)) {
            return;
        }
        if matches!(message, Down::Call { .. })
            && let Some(fault) = self.fault.take()
        {
            match fault {
                Fault::Drop => return,
                Fault::Repeat => self.write(&message),
                Fault::Swap => {
                    *self.swapped.borrow_mut() = Some(message);
                    return;
                }
            }
        }
        self.write(&message);
        if seq.is_some()
            && let Some(swapped) = self.swapped.borrow_mut().take()
        {
            self.write(&swapped);
        }
    }

    /// Writes `message` to the JS host, after what waits in the overflow.
    fn write(&self, message: &Down) {
        if !self.overflow.borrow().0.is_empty() {
            self.overflowed(message.clone(), serde_json::to_vec(message).map_or(0, |bytes| bytes.len()));
            return;
        }
        if !timed(|| self.encode(message)) {
            self.overflowed(message.clone(), serde_json::to_vec(message).map_or(0, |bytes| bytes.len()));
        }
    }

    /// Keeps `message`, of `size` bytes, for when the queue has room; past the bound, refuses it.
    fn overflowed(&self, message: Down, size: usize) {
        let mut overflow = self.overflow.borrow_mut();
        if overflow.1 + size > self.config.limits.inbox {
            drop(overflow);
            self.refuse(&message, size);
            return;
        }
        overflow.1 += size;
        overflow.0.push_back((message, size));
    }

    /// Writes what waits in the overflow while the queue takes it.
    fn drain(&self) {
        loop {
            let Some((message, size)) = self.overflow.borrow_mut().0.pop_front() else { return };
            self.overflow.borrow_mut().1 -= size;
            if !timed(|| self.encode(&message)) {
                let mut overflow = self.overflow.borrow_mut();
                overflow.1 += size;
                overflow.0.push_front((message, size));
                return;
            }
        }
    }

    /// Refuses `message`, of `size` bytes, which no queue holds: it is not sent, its sequence goes so the stream has no
    /// gap, and a handler's call is answered with nothing, as one that asked for nothing.
    fn refuse(&self, message: &Down, size: usize) {
        log::warn!("a message of {size} bytes for the JS host has no room; it is not sent");
        count(|crossed| crossed.refused_sends += 1);
        let seq = message.seq();
        if let Some(seq) = seq {
            // In the message's place: after what waits before it.
            let skipped = Down::Skipped { seq };
            if !self.overflow.borrow().0.is_empty() || !self.encode(&skipped) {
                self.overflow.borrow_mut().0.push_back((skipped, 0));
            }
        }
        let call = seq.and_then(|seq| self.waiting.borrow_mut().remove(&seq));
        if let (Some(seq), Some(Waiting::Call(_))) = (seq, call) {
            self.release_hold(seq);
        }
    }

    /// Queues `message`; false when the queue has no room for it now.
    fn encode(&self, message: &Down) -> bool {
        let seq = message.seq();
        let payload = serde_json::to_vec(message).unwrap_or_default();
        log::trace!("js host -> {}", String::from_utf8_lossy(&payload));
        let wait = match message {
            Down::Load { .. } => child::Wait::Setup,
            Down::Call { .. } | Down::Ping { .. } | Down::Mount { .. } | Down::Input { .. } => child::Wait::Answer,
            _ => child::Wait::Ack,
        };
        let sent = self.child.borrow().as_ref().map(|child| child.send(wire::CONTROL, &payload, seq, wait));
        match &sent {
            Some(Ok(())) => count(|crossed| {
                crossed.sent += 1;
                crossed.sent_bytes += payload.len() as u64 + 5;
            }),
            Some(Err(child::Refused::Full)) => return false,
            Some(Err(child::Refused::TooLarge(size))) => self.refuse(message, *size),
            None => {}
        }
        true
    }

    /// Starts the JS host when none runs, its stream after sequence `after`; whether one runs.
    fn started(&self, after: u64) -> bool {
        if self.child.borrow().is_some() {
            return true;
        }
        let Some(host) = self.host.upgrade() else { return false };
        match self.spawn(&host) {
            Ok(child) => {
                count(|crossed| crossed.started += 1);
                let hello = serde_json::to_vec(&Down::Hello { version: proto::VERSION, after }).unwrap_or_default();
                let _ = child.send(wire::CONTROL, &hello, None, child::Wait::Ack);
                *self.child.borrow_mut() = Some(child);
                self.read.set((0, 0));
                *self.overflow.borrow_mut() = Default::default();
                self.started.borrow_mut().clear();
                true
            }
            Err(error) => {
                let error = format!("cannot start the JS host ({}): {error}", self.config.bun.display());
                log::error!("{error}");
                *self.stopped.borrow_mut() = Some(error);
                self.fail_loads();
                false
            }
        }
    }

    fn spawn(&self, host: &Rc<dyn Host>) -> std::io::Result<Child> {
        if self.script.borrow().is_none() {
            let dir = opencode_util::temp::tempdir()?;
            std::fs::write(dir.path().join("host.ts"), SOURCE)?;
            *self.script.borrow_mut() = Some(dir);
        }
        let script = self.script.borrow().as_ref().map(|dir| dir.path().join("host.ts")).unwrap_or_default();
        let mut command = std::process::Command::new(&self.config.bun);
        command.args(&self.config.args).arg(script);
        let proxy = host.app().proxy();
        let id = self.id;
        Child::spawn(command, self.config.limits, move || post(&proxy, id))
    }

    /// Takes what the JS host sent.
    fn woken(self: &Rc<Self>) {
        // It read something, which made room.
        self.drain();
        let taken = timed(|| self.child.borrow().as_ref().map(|child| (child.take(), child.read())));
        let Some((events, read)) = taken else { return };
        let (seen, seen_trees) = self.read.replace(read);
        count(|crossed| {
            crossed.received_bytes += read.0.saturating_sub(seen);
            crossed.tree_bytes += read.1.saturating_sub(seen_trees);
        });
        for event in events {
            log::trace!("js host <- {event:?}");
            match event {
                child::Event::Up(up) => {
                    count(|crossed| crossed.received += 1);
                    self.up(*up);
                }
                child::Event::Tree(mut tree) => {
                    match self.tamper.take() {
                        Some(Tamper::Keep) => *self.kept.borrow_mut() = Some(tree.clone()),
                        Some(Tamper::UnknownKeep) => {
                            tree.node = serde_json::json!({ "type": "keep", "key": "no-such" })
                        }
                        None => {}
                    }
                    count(|crossed| {
                        crossed.received += 1;
                        crossed.trees += 1;
                    });
                    match self.guest(&tree.id) {
                        Some(guest) => guest.tree(tree),
                        None => count(|crossed| crossed.dropped += 1),
                    }
                }
                // A plugin that flooded the host fails, and nothing else is blamed.
                child::Event::Gone(why, flooded) => {
                    self.ended(why, flooded.map_or(Blame::Running, Blame::Plugin));
                    return;
                }
                child::Event::Hung { seq } => {
                    let limit = self.config.limits.ack.as_millis();
                    self.ended(
                        format!("the JS host sent nothing for {limit} ms while event {seq} waited"),
                        Blame::Running,
                    );
                    return;
                }
                child::Event::Memory(bytes) => {
                    let why = format!(
                        "the JS host used {} MiB, over its budget of {} MiB",
                        bytes >> 20,
                        self.config.limits.memory >> 20
                    );
                    self.ended(why, Blame::Nobody);
                    return;
                }
            }
        }
    }

    fn guest(&self, id: &str) -> Option<Rc<Guest>> {
        self.guests.borrow().get(id).and_then(Weak::upgrade)
    }

    fn up(self: &Rc<Self>, up: Up) {
        match up {
            Up::Hello { .. } | Up::Ack { .. } => {}
            Up::Started { seq } => {
                if self.waiting.borrow().contains_key(&seq) {
                    self.started.borrow_mut().insert(seq);
                }
            }
            Up::Loaded { seq, id, manifest, holds, effects } => match self.take_waiting(seq) {
                Some(Waiting::Load(target)) => {
                    let mut loads = self.loads.borrow_mut();
                    if let Some(load) =
                        loads.get_mut(&target).filter(|load| matches!(load.state, Loading::Waiting(at) if at == seq))
                    {
                        let loaded = guest::Loaded {
                            id,
                            target: target.clone(),
                            dir: load.dir.clone(),
                            options: load.options.clone(),
                            seq,
                            manifest,
                            holds,
                            effects: RefCell::new(Some(effects)),
                        };
                        (load.state, load.registered) = (Loading::Loaded(Rc::new(loaded)), false);
                        drop(loads);
                        self.reconcile();
                    }
                }
                Some(Waiting::Activate(guest)) => {
                    if let Some(guest) = guest.upgrade() {
                        guest.activated(manifest, holds, effects);
                    }
                }
                _ => {}
            },
            Up::Unsupported { seq } => self.answered_load(seq, Loading::Unsupported),
            Up::Done { seq, effects, error } => {
                self.started.borrow_mut().remove(&seq);
                let waiting = self.waiting.borrow_mut().remove(&seq);
                match waiting {
                    Some(Waiting::Load(_)) => {
                        self.answered_load(seq, Loading::Failed(error.unwrap_or_else(|| "setup failed".to_owned())));
                    }
                    Some(Waiting::Activate(guest)) => {
                        if let Some(guest) = guest.upgrade() {
                            guest.fail(error.unwrap_or_else(|| "setup failed".to_owned()));
                        }
                    }
                    Some(Waiting::Call(call)) => {
                        if let Some(guest) = call.guest.upgrade() {
                            guest.done(seq, &call, effects, error);
                        }
                        // The keys it held go on once its effects applied: they are deferred, and so is this, after
                        // them (review bigboi-5).
                        let this = self.this.clone();
                        if let Some(host) = self.host.upgrade() {
                            host.app().defer(move |_| {
                                if let Some(scripts) = this.upgrade() {
                                    scripts.release_hold(seq);
                                }
                            });
                        }
                    }
                    Some(Waiting::View(_) | Waiting::Ping) | None => {}
                }
            }
            Up::Effects { ref id, .. } | Up::Watch { ref id, .. } if self.guest(id).is_none() => self.keep(up),
            Up::Effects { id, seq, effects } => {
                if let Some(guest) = self.guest(&id) {
                    guest.effects(&format!("b{seq}"), effects, false, "update");
                }
            }
            Up::Watch { id, key, request } => {
                if let Some(guest) = self.guest(&id) {
                    guest.watch(key, request);
                }
            }
            Up::Unwatch { id, key } => {
                if let Some(guest) = self.guest(&id) {
                    guest.unwatch(&key);
                }
            }
            Up::Fail { id, error } => {
                if let Some(guest) = self.guest(&id) {
                    guest.fail(error);
                }
            }
            Up::Manifest { id, manifest, holds } => {
                if let Some(guest) = self.guest(&id) {
                    guest.activated(manifest, holds, Vec::new());
                }
            }
            Up::Pong { seq, waiting } => {
                self.take_waiting(seq);
                self.pong.set(Some((seq, waiting)));
            }
            Up::Log { id, level, message } => {
                let level = match level {
                    opencode_plugin_abi::Level::Debug => log::Level::Debug,
                    opencode_plugin_abi::Level::Info => log::Level::Info,
                    opencode_plugin_abi::Level::Warn => log::Level::Warn,
                    opencode_plugin_abi::Level::Error => log::Level::Error,
                };
                log::log!(level, "plugin {}: {message}", id.as_deref().unwrap_or("(js host)"));
            }
            Up::Tree(tree) => match self.guest(&tree.id) {
                Some(guest) => guest.tree(tree),
                None => count(|crossed| crossed.dropped += 1),
            },
        }
    }

    /// Keeps `up` of a plugin the loader has not registered yet, for its activation.
    fn keep(&self, up: Up) {
        const EARLY: usize = 256;
        let (Up::Effects { id, .. } | Up::Watch { id, .. }) = &up else { return };
        let mut early = self.early.borrow_mut();
        let kept = early.entry(id.clone()).or_default();
        match kept.len() < EARLY {
            true => kept.push(up),
            false => log::warn!("plugin {id}: over {EARLY} messages before it was registered; dropped"),
        }
    }

    /// What plugin `id` sent before its activation `guest` was registered.
    fn registered(self: &Rc<Self>, id: &str) {
        let early = self.early.borrow_mut().remove(id).unwrap_or_default();
        early.into_iter().for_each(|up| self.up(up));
    }

    /// What `seq` waited for, now answered.
    fn take_waiting(&self, seq: u64) -> Option<Waiting> {
        self.started.borrow_mut().remove(&seq);
        self.waiting.borrow_mut().remove(&seq)
    }

    /// The load `seq` was answered with `state`.
    fn answered_load(&self, seq: u64, state: Loading) {
        self.take_waiting(seq);
        let mut loads = self.loads.borrow_mut();
        let Some(load) = loads.values_mut().find(|load| matches!(load.state, Loading::Waiting(at) if at == seq)) else {
            return;
        };
        (load.state, load.registered) = (state, false);
        drop(loads);
        self.reconcile();
    }

    fn reconcile(&self) {
        let reconcile = self.reconcile.borrow().clone();
        if let Some(reconcile) = reconcile {
            let host = self.host.clone();
            crate::defer(&host, move |_| reconcile());
        }
    }

    /// The JS host ended, hung, broke the protocol, was flooded, or went over its budget: it is ended with its process
    /// group. `blame` names whom: the work it said it started and did not finish (its plugin fails), a plugin that
    /// flooded it, or nobody (memory). Every other plugin is set up again on a new JS host, and its surfaces keep their
    /// last trees until new ones come; a restart resets every plugin's JS state, as the process is one (3.7). The calls
    /// the JS host received and did not start are sent again, in order, after the setups: they never ran. One it started
    /// and did not finish is not: it may have done what it does, so it is never run twice (at most once). Past the limit
    /// of ends, every plugin on it fails.
    fn ended(self: &Rc<Self>, why: String, blame: Blame) {
        drop(self.child.borrow_mut().take());
        *self.overflow.borrow_mut() = Default::default();
        log::error!("{why}");
        // A ping on its way is lost with it: answered, as one a tree waits behind, so its sender asks again.
        self.pong.set(Some((self.seq.get(), true)));
        let started = std::mem::take(&mut *self.started.borrow_mut());
        let mut waiting: Vec<(u64, Waiting)> = self.waiting.borrow_mut().drain().collect();
        waiting.sort_by_key(|(seq, _)| *seq);
        let ran = waiting.iter().find(|(seq, _)| started.contains(seq)).map(|(seq, _)| *seq);
        match blame {
            Blame::Plugin(id) => {
                if let Some(guest) = self.guest(&id) {
                    guest.fail(format!("flooded the host with effects: {why}"));
                }
            }
            Blame::Running => match waiting.iter().find(|(seq, _)| Some(*seq) == ran).map(|(_, waiting)| waiting) {
                Some(Waiting::Call(call)) => {
                    if let Some(guest) = call.guest.upgrade() {
                        guest.fail(format!("{} ended the JS host: {why}", call.export));
                    }
                }
                Some(Waiting::Activate(guest) | Waiting::View(guest)) => {
                    if let Some(guest) = guest.upgrade() {
                        guest.fail(format!("setup or a view ended the JS host: {why}"));
                    }
                }
                Some(Waiting::Load(target)) => {
                    if let Some(load) = self.loads.borrow_mut().get_mut(target) {
                        (load.state, load.registered) =
                            (Loading::Failed(format!("setup ended the JS host: {why}")), false);
                    }
                }
                Some(Waiting::Ping) | None => {}
            },
            Blame::Nobody => {}
        }
        if let Some(seq) = ran
            && let Some((_, Waiting::Call(call))) = waiting.iter().find(|(known, _)| *known == seq)
        {
            let plugin = call.guest.upgrade().map(|guest| guest.id().to_owned()).unwrap_or_default();
            log::warn!("{} of plugin {plugin} ran when the JS host ended; it is not run again", call.export);
        }
        let mut again = Vec::new();
        let mut calls = Vec::new();
        for (seq, waiting) in waiting {
            match waiting {
                Waiting::Load(target) if Some(seq) != ran => again.push(target),
                Waiting::Call(call) if Some(seq) != ran => calls.push(call),
                _ => {}
            }
        }
        let now = Instant::now();
        let mut ends = self.ends.borrow_mut();
        ends.push_back(now);
        while ends.front().is_some_and(|at| now.duration_since(*at) > self.config.window) {
            ends.pop_front();
        }
        let over = ends.len() >= self.config.ends;
        drop(ends);
        self.release_all_holds();
        if over {
            let stopped =
                format!("the JS host ended {} times in {} s: {why}", self.config.ends, self.config.window.as_secs());
            *self.stopped.borrow_mut() = Some(stopped.clone());
            let guests: Vec<Rc<Guest>> = self.guests.borrow().values().filter_map(Weak::upgrade).collect();
            guests.iter().for_each(|guest| guest.fail(stopped.clone()));
            self.fail_loads();
            self.reconcile();
            return;
        }
        for target in again {
            if let Some(load) = self.loads.borrow_mut().get_mut(&target) {
                load.digest = 0;
            }
        }
        // Every running plugin is set up again on a new JS host, then gets the calls that never ran, in order.
        let guests: Vec<Rc<Guest>> = self.guests.borrow().values().filter_map(Weak::upgrade).collect();
        for guest in guests {
            guest.restart();
        }
        for call in calls {
            if let Some(guest) = call.guest.upgrade().filter(|guest| !guest.ended()) {
                self.call_as(&guest, call.export, call.request, false, call.user, call.owner);
            }
        }
        self.reconcile();
    }

    /// Every load that waits fails: the JS host is not started again.
    fn fail_loads(&self) {
        let stopped = self.stopped.borrow().clone().unwrap_or_default();
        for load in self.loads.borrow_mut().values_mut() {
            if matches!(load.state, Loading::Waiting(_)) {
                (load.state, load.registered) = (Loading::Failed(stopped.clone()), false);
            }
        }
    }

    /// Runs a call of `guest`: a command, an event, an input event of `owner`. A command in `holds` holds the keys
    /// after it.
    fn call(
        self: &Rc<Self>,
        guest: &Rc<Guest>,
        export: &'static str,
        request: opencode_plugin_abi::Request,
        hold: bool,
        owner: Option<Weak<crate::interact::Owner>>,
    ) {
        self.call_as(guest, export, request, hold, crate::behave::user(), owner);
    }

    /// [`Scripts::call`] for the user's input when `user`.
    fn call_as(
        self: &Rc<Self>,
        guest: &Rc<Guest>,
        export: &'static str,
        request: opencode_plugin_abi::Request,
        hold: bool,
        user: bool,
        owner: Option<Weak<crate::interact::Owner>>,
    ) {
        let seq = self.next();
        let message =
            Down::Call { seq, id: guest.id().to_owned(), activation: guest.activation(), call: request.clone() };
        let call = Call { guest: Rc::downgrade(guest), export, user, request, owner };
        self.send(message, Some(Waiting::Call(call)));
        if hold {
            self.start_hold(seq);
        }
    }

    // Hold.

    fn intercept(&self, key: KeyEvent, consume: impl FnOnce()) {
        let mut hold = self.hold.borrow_mut();
        if hold.seq.is_none() || hold.replaying {
            return;
        }
        consume();
        if hold.keys.len() == HELD {
            hold.keys.pop_front();
            log::warn!("a held key was dropped: over {HELD} keys held");
        }
        hold.keys.push_back(key);
    }

    fn start_hold(self: &Rc<Self>, seq: u64) {
        let Some(host) = self.host.upgrade() else { return };
        let weak = Rc::downgrade(self);
        let timer = host.app().set_timeout(self.config.hold, move |_| {
            if let Some(scripts) = weak.upgrade() {
                scripts.release_hold(seq);
            }
        });
        let mut hold = self.hold.borrow_mut();
        if let Some(old) = hold.timer.replace(timer) {
            host.app().cancel_timer(old);
        }
        hold.seq = Some(seq);
    }

    /// The command `seq` returned, or its time ran out: the keys it held go on, in order. One that holds again keeps
    /// the rest held.
    fn release_hold(&self, seq: u64) {
        if self.hold.borrow().seq != Some(seq) {
            return;
        }
        self.release_all_holds();
    }

    fn release_all_holds(&self) {
        let Some(host) = self.host.upgrade() else { return };
        let mut hold = self.hold.borrow_mut();
        hold.seq = None;
        if let Some(timer) = hold.timer.take() {
            host.app().cancel_timer(timer);
        }
        drop(hold);
        loop {
            let key = {
                let mut hold = self.hold.borrow_mut();
                if hold.seq.is_some() {
                    break;
                }
                let Some(key) = hold.keys.pop_front() else { break };
                hold.replaying = true;
                key
            };
            host.app().dispatch(opentui::prelude::Event::Key(key));
            self.hold.borrow_mut().replaying = false;
        }
    }
}

impl Drop for Scripts {
    fn drop(&mut self) {
        if let (Some(host), Some(handler)) = (self.host.upgrade(), self._handler.get()) {
            host.app().remove_handler(handler);
        }
        self._intercepts.take().into_iter().for_each(Disposer::dispose);
    }
}

/// Posts a [`Woken`], from the reader thread; a full queue is retried on a thread of its own, as a plugin's wake is.
fn post(proxy: &AppProxy, id: u64) {
    if proxy.send(Woken(id)) == Err(opentui::app::ProxyError::Full) {
        let proxy = proxy.clone();
        let _ = std::thread::Builder::new().name("js-host-wake".to_owned()).spawn(move || {
            while proxy.send(Woken(id)) == Err(opentui::app::ProxyError::Full) {
                std::thread::sleep(Duration::from_millis(1));
            }
        });
    }
}

/// The build of a plugin directory: what its files hold ([`crate::loader::approval::Artifact::tree`], the hash an
/// approval names), and the options. A save that changes nothing loads nothing, as TS compares a local module's content;
/// Bun loads a changed module afresh, as a generation of its own.
fn digest(dir: &Path, options: Option<&str>) -> u64 {
    let mut hasher = DefaultHasher::new();
    match crate::loader::approval::Artifact::tree(dir) {
        Ok(artifact) => artifact.sha256.hash(&mut hasher),
        Err(error) => error.hash(&mut hasher),
    }
    options.unwrap_or_default().hash(&mut hasher);
    hasher.finish()
}

/// What a read the plugin watches is now, as [`HostRequest`]'s result: P2's reads are of its newest mount.
pub(crate) fn evaluate(
    host: &Weak<dyn Host>,
    id: &str,
    owners: Option<Rc<crate::Owners>>,
    request: &HostRequest,
) -> serde_json::Value {
    let mut ctx = crate::loader::native::Ctx::new(host.clone(), id, Vec::new());
    (ctx.read_only, ctx.owners) = (true, owners);
    match crate::loader::native::handle(&mut ctx, request.clone()) {
        Ok(value) => value,
        Err(error) => {
            log::warn!("plugin {id}: a watched read failed: {error}");
            serde_json::Value::Null
        }
    }
}
