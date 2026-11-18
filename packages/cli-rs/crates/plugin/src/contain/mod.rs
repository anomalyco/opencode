//! Containment of plugin calls (synthesis 4.4 and 4.5, phase P4c). Every call into a plugin, on either path, runs
//! through [`Monitor::call`]: it reads the clock before and after, so the plugin cannot opt out and does not report its
//! own time, and while a run record is attached it names the call in the record for the watchdog and a restart. On
//! Linux the time the thread waited on a run queue meanwhile is not the plugin's: a loaded machine's, it is not charged.
//! The overrun is judged by the CPU time the thread used in the call ([`thread_cpu`]), where the OS can say: a page
//! fault served from swap or disk, a wait on a lock or a sleep is the machine's, not the plugin's work (FT-13). Wall
//! time stays the hang watchdog's.
//!
//! The budget acts after a call returns, because a call on the UI thread cannot be stopped:
//!
//! - **frame budget**: [`Limits::frame`] per plugin per frame, summed over its calls; [`Limits::all`] for all plugins
//!   together. A frame is what runs from one paint to the next: the host closes the open frames at the start of each
//!   paint ([`Monitor::close`]), and a call in a later frame closes its plugin's frame too.
//! - **slow**: over the frame budget in more than [`Limits::slow`] of the last [`Limits::window`] frames the plugin ran
//!   in. It informs only, once a session, because wall time on a loaded machine is noisy.
//! - **overrun**: one call that used more CPU than [`Limits::overrun`] (wall time less the run-queue wait where the OS
//!   tells no CPU time). The caller fails an external plugin; for a built-in it is a host
//!   bug, logged and counted ([`Monitor::host_overruns`]). A plugin's first call after `setup` is exempt, because its
//!   pages are cold. Loading a library, `setup` and `dispose` are timed and do not count: they are its load.
//!
//! Each build of a plugin has its own slot and statistics: a reload starts afresh.
//! - **hang**: a call not returned after [`Limits::hang`]; the watchdog acts ([`watchdog`]).

pub mod record;
pub mod watchdog;

use std::cell::{Cell, OnceCell, RefCell};
use std::collections::VecDeque;
use std::rc::Rc;
use std::sync::Arc;
use std::time::{Duration, Instant};

pub use record::{Artifact, Crash, Handoff, Record, Snapshot};

thread_local! {
    /// How many plugin calls on this thread run inside [`catch`]: a panic now is a plugin's, which its catch stops.
    static CATCHING: Cell<u32> = const { Cell::new(0) };
}

/// Runs `f`, a plugin's code, and catches its panic, which the host reports through the plugin's failure. While it
/// runs, the panic hooks let a panic unwind to here instead of ending the app ([`filter_panics`]).
pub fn catch<R>(f: impl FnOnce() -> R) -> std::thread::Result<R> {
    struct Leave;
    impl Drop for Leave {
        fn drop(&mut self) {
            CATCHING.with(|catching| catching.set(catching.get() - 1));
        }
    }
    CATCHING.with(|catching| catching.set(catching.get() + 1));
    let _leave = Leave;
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(f))
}

/// Whether a panic on this thread now unwinds to a plugin's [`catch`].
pub fn catching() -> bool {
    CATCHING.try_with(Cell::get).is_ok_and(|depth| depth > 0)
}

/// Wraps the panic hooks installed so far, so a plugin's panic that a [`catch`] stops is logged and left to unwind:
/// no hook installed before this one (the terminal's restore, the CLI's exit) takes it for the end of the app. Call it
/// after those hooks, once a process; later calls do nothing.
pub fn filter_panics() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        let previous = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            if catching() {
                log::error!("a plugin panicked: {info}");
                return;
            }
            previous(info);
        }));
    });
}

/// The limits of the budget. These are starting values (synthesis 7, decision 5); `OPENCODE_PLUGIN_LIMITS` changes
/// them ([`Limits::parse`]).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Limits {
    /// Per plugin per frame.
    pub frame: Duration,
    /// For all plugins together per frame.
    pub all: Duration,
    /// One call over it is an overrun.
    pub overrun: Duration,
    /// The frames the slow rule looks back on.
    pub window: usize,
    /// Over the frame budget in more of the window's frames than this is slow.
    pub slow: usize,
    /// The watchdog paints its notice.
    pub notice: Duration,
    /// The watchdog ends the client.
    pub hang: Duration,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            frame: Duration::from_millis(1),
            all: Duration::from_millis(4),
            overrun: Duration::from_millis(100),
            window: 120,
            slow: 12,
            notice: Duration::from_millis(500),
            hang: Duration::from_secs(2),
        }
    }
}

impl Limits {
    /// The defaults with the entries of `text` applied: `name=value` separated by commas, a duration in `us`, `ms` or
    /// `s` (`frame=2ms,overrun=250ms`), a count as a number (`window=60,slow=6`).
    pub fn parse(text: &str) -> Result<Limits, String> {
        let mut limits = Limits::default();
        for entry in text.split(',').map(str::trim).filter(|entry| !entry.is_empty()) {
            let (name, value) = entry.split_once('=').ok_or_else(|| format!("{entry}: not name=value"))?;
            let count = || value.parse::<usize>().map_err(|_| format!("{entry}: not a count"));
            match name {
                "frame" => limits.frame = duration(value)?,
                "all" => limits.all = duration(value)?,
                "overrun" => limits.overrun = duration(value)?,
                "notice" => limits.notice = duration(value)?,
                "hang" => limits.hang = duration(value)?,
                "window" => limits.window = count()?.max(1),
                "slow" => limits.slow = count()?,
                _ => return Err(format!("{name}: no such limit")),
            }
        }
        Ok(limits)
    }

    /// The limits `OPENCODE_PLUGIN_LIMITS` sets, or the defaults; a bad value is logged and the defaults stay.
    pub fn from_env() -> Limits {
        let Ok(text) = std::env::var("OPENCODE_PLUGIN_LIMITS") else { return Limits::default() };
        Limits::parse(&text).unwrap_or_else(|error| {
            log::warn!("OPENCODE_PLUGIN_LIMITS: {error}");
            Limits::default()
        })
    }
}

fn duration(value: &str) -> Result<Duration, String> {
    let (number, unit) = value.split_at(value.find(|c: char| c.is_ascii_alphabetic()).unwrap_or(value.len()));
    let number: f64 = number.parse().map_err(|_| format!("{value}: not a duration"))?;
    let seconds = match unit {
        "us" => number / 1e6,
        "ms" => number / 1e3,
        "s" => number,
        _ => return Err(format!("{value}: a duration needs us, ms or s")),
    };
    Duration::try_from_secs_f64(seconds).map_err(|_| format!("{value}: not a duration"))
}

/// One build of a plugin as the monitor knows it, for the life of the process.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Slot(u16);

/// What a call cost, and what the budget says about it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Timed {
    /// Wall time, less the time on a run queue where the OS tells it: what the frame budget counts.
    pub took: Duration,
    /// The CPU time the thread used in the call, where the OS can say: what the overrun judges.
    pub cpu: Option<Duration>,
    /// Over [`Limits::overrun`] (by `cpu`, else by `took`), and not exempt.
    pub overrun: bool,
    /// The plugin just became slow, for the first time this session: what it costs a frame.
    pub slow: Option<String>,
    /// The call opened a frame of its plugin, which the host closes at the next paint.
    pub opened: bool,
}

thread_local! {
    /// A frame's layout or draws run on this thread ([`in_frame`]).
    static IN_FRAME: Cell<bool> = const { Cell::new(false) };
}

/// Whether [`in_frame`] runs.
pub(crate) fn painting() -> bool {
    IN_FRAME.with(Cell::get)
}

/// Runs `work`, which runs inside a frame of OpenTUI's, after the paint counted its frame up: the plugin calls in it
/// count in the frame the paint started in ([`Monitor::frame`]).
pub(crate) fn in_frame<R>(work: impl FnOnce() -> R) -> R {
    let outer = IN_FRAME.with(|flag| flag.replace(true));
    let result = work();
    IN_FRAME.with(|flag| flag.set(outer));
    result
}

/// Times every plugin call and keeps the budget's state; the host owns one.
pub struct Monitor {
    limits: Cell<Limits>,
    clock: RefCell<Rc<dyn Fn() -> Instant>>,
    /// How long this thread has waited on a run queue so far ([`queued`]).
    queued: RefCell<Rc<dyn Fn() -> Duration>>,
    /// The CPU time this thread has used so far ([`thread_cpu`]), where the OS can say.
    cpu: RefCell<Rc<dyn Fn() -> Option<Duration>>>,
    /// A test set the clock: the record still takes the monotonic clock, which the watchdog reads.
    injected: Cell<bool>,
    frame: RefCell<Rc<dyn Fn() -> u64>>,
    /// The time of the calls and host work nested in each host work that runs, innermost last ([`Monitor::host`]).
    nested: RefCell<Vec<Duration>>,
    plugins: RefCell<Vec<Stats>>,
    /// The frame all plugins' calls are summed in, and their sum.
    all: Cell<Option<(u64, Duration)>>,
    over_all: Cell<u64>,
    host_overruns: Cell<u64>,
    /// A call runs: a call within it is part of it.
    depth: Cell<u32>,
    /// All plugins' calls in a frame of the host's count ([`Monitor::spent`]).
    counted: Cell<Option<(u64, Duration)>>,
    /// The host has a close at the next paint pending.
    closing: Cell<bool>,
    /// The frames that ended with no paint ([`Monitor::close_idle`]), which count on after the host's.
    idle: Cell<u64>,
    record: OnceCell<(Arc<Record>, Instant)>,
    /// Told when a call returns whose hang notice the watchdog painted: the plugin and how long the call took.
    on_notice: RefCell<Option<Rc<OnNotice>>>,
    /// The plugins whose slow news the user was told this session, by ID: once a plugin and session, whatever the
    /// cause and however often it is enabled again or rebuilt (4.14 `reported-once`; final review big-boi 10). Each
    /// build's state, counters and causes stay its own.
    told: RefCell<std::collections::HashSet<String>>,
}

/// What a host does when a call whose hang notice was painted returns.
type OnNotice = dyn Fn(&Artifact, Duration);

#[derive(Default)]
struct Stats {
    artifact: Artifact,
    /// The frame its calls are summed in, and their sum.
    window: Option<(u64, Duration)>,
    /// The sums of the last frames it ran in, newest last.
    frames: VecDeque<Duration>,
    slow: bool,
    told: bool,
    /// `slow` changed since the monitor last looked.
    flipped: bool,
    /// The next call is the first after a setup: exempt from overrun.
    cold: bool,
    load: Option<Duration>,
    setup: Option<Duration>,
    kinds: Vec<(&'static str, Samples)>,
    /// The host's own work for its nodes ([`Monitor::host`]), and all of it so far.
    host: Samples,
    host_total: Duration,
    /// All its calls since its setup, but the setup's.
    calls_total: Duration,
    /// Its calls in a frame of the host's count, whatever closed P4c's window: what the scheduler's budget reads.
    counted: Option<(u64, Duration)>,
    /// The frames at the end of which its mailbox was full, the last [`Limits::window`] (synthesis 4.2, reviews
    /// bigboi 10 and carbon 5.4); whether that was told; and the sends its mailbox refused so far.
    backlog: VecDeque<u64>,
    told_backlog: bool,
    refused: u64,
    /// Whether the backlog made it slow when the monitor last looked: a change of it is a change of slow too (review
    /// carbon-12).
    backlog_slow: bool,
}

#[derive(Default)]
struct Samples {
    recent: VecDeque<Duration>,
    worst: Duration,
}

impl Samples {
    fn add(&mut self, took: Duration) {
        if self.recent.len() == SAMPLES {
            self.recent.pop_front();
        }
        self.recent.push_back(took);
        self.worst = self.worst.max(took);
    }
}

/// The calls a kind keeps for its percentiles.
const SAMPLES: usize = 256;

impl Default for Monitor {
    fn default() -> Self {
        Self::new(Limits::default())
    }
}

#[cfg(feature = "luau")]
thread_local! {
    /// The thread's CPU time as the monitored call that runs began, when the monitor read the real clock.
    static CALL_CPU: Cell<Option<Duration>> = const { Cell::new(None) };
}

/// The thread's CPU time as the monitored call that runs on this thread began: one reading for the monitor and for a
/// Luau call's budget. `None` outside a monitored call, or when a test set the monitor's clock.
#[cfg(feature = "luau")]
pub(crate) fn call_cpu() -> Option<Duration> {
    CALL_CPU.with(Cell::get)
}

/// Publishes a monitored call's starting CPU time until it drops, also by unwinding.
#[cfg(feature = "luau")]
struct Published(Option<Duration>);

#[cfg(feature = "luau")]
impl Published {
    fn new(cpu: Option<Duration>) -> Self {
        Self(CALL_CPU.with(|call| call.replace(cpu)))
    }
}

#[cfg(feature = "luau")]
impl Drop for Published {
    fn drop(&mut self) {
        CALL_CPU.with(|call| call.set(self.0));
    }
}

/// Leaves the running call however the plugin's call ends, also by unwinding.
struct Leave<'a> {
    monitor: &'a Monitor,
    generation: Option<u64>,
}

impl Drop for Leave<'_> {
    fn drop(&mut self) {
        self.monitor.depth.set(0);
        let (Some(generation), Some((record, _))) = (self.generation, self.monitor.record.get()) else { return };
        if !record.leave(generation) {
            // The watchdog claimed this call and is ending the process: nothing may run as if it had returned.
            loop {
                std::thread::park();
            }
        }
    }
}

impl Monitor {
    /// A monitor on the monotonic clock, whose frames are counted by the host ([`Monitor::set_frames`]).
    pub fn new(limits: Limits) -> Self {
        Self {
            limits: Cell::new(limits),
            clock: RefCell::new(Rc::new(Instant::now)),
            queued: RefCell::new(Rc::new(queued)),
            cpu: RefCell::new(Rc::new(thread_cpu)),
            injected: Cell::new(false),
            frame: RefCell::new(Rc::new(|| 0)),
            nested: RefCell::default(),
            plugins: RefCell::default(),
            all: Cell::new(None),
            over_all: Cell::new(0),
            host_overruns: Cell::new(0),
            depth: Cell::new(0),
            counted: Cell::new(None),
            closing: Cell::new(false),
            idle: Cell::new(0),
            record: OnceCell::new(),
            on_notice: RefCell::default(),
            told: RefCell::default(),
        }
    }

    pub fn limits(&self) -> Limits {
        self.limits.get()
    }

    pub fn set_limits(&self, limits: Limits) {
        self.limits.set(limits);
    }

    /// Reads time from `clock`, which tests inject. The time on a run queue is then none, and an overrun is judged by
    /// `clock` alone.
    pub fn set_clock(&self, clock: impl Fn() -> Instant + 'static) {
        *self.clock.borrow_mut() = Rc::new(clock);
        *self.queued.borrow_mut() = Rc::new(|| Duration::ZERO);
        *self.cpu.borrow_mut() = Rc::new(|| None);
        self.injected.set(true);
    }

    /// The time on the monitor's clock.
    pub fn now(&self) -> Instant {
        (self.clock.borrow())()
    }

    /// Counts frames with `frame`: the host's painted frames.
    pub fn set_frames(&self, frame: impl Fn() -> u64 + 'static) {
        *self.frame.borrow_mut() = Rc::new(frame);
    }

    /// The frame calls count in now. OpenTUI counts a paint's frame up after its animations and deferred work and
    /// before its layout and draws; a call inside the frame ([`in_frame`]: `layout`, a canvas's draw) counts in the
    /// frame the paint started in. So a frame is a paint's calls and the calls since the paint before it (review
    /// carbon 4.1).
    pub fn frame(&self) -> u64 {
        self.painted().saturating_sub(u64::from(IN_FRAME.with(Cell::get)))
    }

    /// The host's painted frames, and the frames that ended with no paint.
    pub fn painted(&self) -> u64 {
        (self.frame.borrow())() + self.idle.get()
    }

    /// Ends the frame open now as a frame of its own when no paint came since `painted` ([`Monitor::painted`]), then
    /// closes as [`Monitor::close`] does: the calls of a timer's tick with nothing to paint count as one frame, not
    /// summed with every later tick until a paint comes.
    pub fn close_idle(&self, painted: u64) -> Vec<(String, String)> {
        if self.painted() == painted {
            self.idle.set(self.idle.get() + 1);
        }
        self.close()
    }

    /// Whether a frame open now is over a budget: a close must end it at a later paint, for the slow rule to see
    /// it; a frame under the budget ends with the next call that opens another.
    pub fn open_over(&self) -> bool {
        let limits = self.limits();
        self.all.get().is_some_and(|(_, sum)| sum > limits.all)
            || self.plugins.borrow().iter().any(|stats| {
                // A backlog that makes it slow ends with frames, which the closes must see (review carbon-12).
                stats.window.is_some_and(|(_, sum)| sum > limits.frame) || stats.backlog_slow
            })
    }

    /// Whether the user is to be told that plugin `id` is slow: the first time a session.
    fn tell(&self, id: &str) -> bool {
        self.told.borrow_mut().insert(id.to_owned())
    }

    /// Calls `notice` when a call returns whose hang notice the watchdog painted.
    pub fn set_on_notice(&self, notice: impl Fn(&Artifact, Duration) + 'static) {
        *self.on_notice.borrow_mut() = Some(Rc::new(notice));
    }

    /// Keeps the run record `record` from now on. Once per process: the record names the plugins known so far and those
    /// that come later.
    pub fn attach(&self, record: Arc<Record>) -> std::io::Result<()> {
        if self.record.set((record.clone(), Instant::now())).is_err() {
            return Err(std::io::Error::other("a record is attached already"));
        }
        for (slot, stats) in self.plugins.borrow().iter().enumerate() {
            record.name(slot as u16, &stats.artifact);
        }
        Ok(())
    }

    /// Starts the watchdog over the attached record, painting its notice on `terminal`. Only a client on a real
    /// terminal, under a parent, does this.
    pub fn watch(&self, terminal: Option<std::fs::File>) -> std::io::Result<()> {
        let (record, epoch) = self.record.get().ok_or_else(|| std::io::Error::other("no record"))?;
        watchdog::spawn(Arc::downgrade(record), *epoch, self.limits(), terminal)
    }

    pub fn record(&self) -> Option<&Arc<Record>> {
        self.record.get().map(|(record, _)| record)
    }

    /// The slot of `artifact`, made on first use: each build has its own. A library is opened (and its load timed)
    /// before its ID is known: its build keeps that one slot once it is named, so a crash in its load and in its
    /// activation names the same artifact (final review big-boi 11).
    pub fn slot(&self, artifact: &Artifact) -> Slot {
        let mut plugins = self.plugins.borrow_mut();
        if let Some(index) = plugins.iter().position(|stats| stats.artifact == *artifact) {
            return Slot(index as u16);
        }
        let build = |stats: &Stats| {
            artifact.target.is_some()
                && (stats.artifact.target.as_ref(), stats.artifact.digest.as_ref())
                    == (artifact.target.as_ref(), artifact.digest.as_ref())
                && (stats.artifact.id.is_empty() || artifact.id.is_empty())
        };
        if let Some(index) = plugins.iter().position(build) {
            let stats = &mut plugins[index];
            // Named once its ID is known. A record that cannot hold the longer name keeps the build's target and
            // digest, which name the artifact all the same.
            if stats.artifact.id.is_empty() && !artifact.id.is_empty() {
                if let Some((record, _)) = self.record.get() {
                    record.name(index as u16, artifact);
                }
                stats.artifact = artifact.clone();
            }
            return Slot(index as u16);
        }
        plugins.push(Stats { artifact: artifact.clone(), ..Stats::default() });
        let slot = (plugins.len() - 1) as u16;
        if let Some((record, _)) = self.record.get() {
            record.name(slot, artifact);
        }
        Slot(slot)
    }

    /// Whether a crash in a call of `slot` names its artifact: always without a record, as no parent restarts the
    /// client then. An external build is named by its build, its target and digest, whatever ID the record could hold
    /// beside them; a built-in by its ID. An external build the record cannot name is not admitted (final review
    /// big-boi 11; re-review: the same build loaded again after its ID was too long to hold).
    pub fn attributed(&self, slot: Slot) -> bool {
        let Some((record, _)) = self.record.get() else { return true };
        let plugins = self.plugins.borrow();
        let Some(stats) = plugins.get(usize::from(slot.0)) else { return false };
        record.named(slot.0).is_some_and(|named| match &stats.artifact.target {
            Some(_) => (&named.target, &named.digest) == (&stats.artifact.target, &stats.artifact.digest),
            None => named == stats.artifact,
        })
    }

    /// Runs `f` as call `kind` of the plugin in `slot`: timed, and named in the record while it runs. A call within a
    /// call is part of the outer one.
    pub fn call<R>(&self, slot: Slot, kind: &'static str, f: impl FnOnce() -> R) -> (R, Timed) {
        // The record names a call by its kind's index: an unlisted kind would leave a crash in it unnamed.
        debug_assert!(record::KINDS.contains(&kind), "call kind {kind} is not in the record's list");
        if self.depth.get() > 0 {
            return (f(), Timed::default());
        }
        let (clock, queued, cpu) =
            (self.clock.borrow().clone(), self.queued.borrow().clone(), self.cpu.borrow().clone());
        let (start, waited, used) = (clock(), queued(), cpu());
        // A Luau call arms its budget from this reading rather than taking its own ([`call_cpu`]).
        #[cfg(feature = "luau")]
        let _published = Published::new(used.filter(|_| !self.injected.get()));
        let generation = self.record.get().map(|(record, epoch)| {
            let now = if self.injected.get() { Instant::now() } else { start };
            record.enter(slot.0, record::kind(kind), now.saturating_duration_since(*epoch).as_millis() as u64)
        });
        self.depth.set(1);
        let leave = Leave { monitor: self, generation };
        let value = f();
        drop(leave);
        let took = clock().saturating_duration_since(start);
        // Runnable but not running is the machine's load, not the plugin's time.
        let charged = took.saturating_sub(queued().saturating_sub(waited));
        let cpu = used.zip(cpu()).map(|(before, after)| after.saturating_sub(before));
        let noticed =
            generation.zip(self.record.get()).is_some_and(|(generation, (record, _))| record.was_noticed(generation));
        if noticed && let Some(notice) = self.on_notice.borrow().clone() {
            let artifact = self.plugins.borrow()[usize::from(slot.0)].artifact.clone();
            notice(&artifact, took);
        }
        (value, self.account(slot, kind, charged, cpu))
    }

    /// Runs `work`, the host's own work for the plugin in `slot`'s nodes (building them, laying out a list's window,
    /// copying a decoded image in), timed apart from the plugin's calls: it is not in the plugin's frame budget, the
    /// limits of 4.2 bound it, and a slow plugin's details show it beside its calls (synthesis 4.4, "host time for
    /// plugin X").
    /// Work of another plugin nested in it (a nested slot's view and the host's work for its nodes) is that plugin's,
    /// and not this one's (review carbon 5.2).
    pub fn host(&self, slot: Slot, work: &mut dyn FnMut()) {
        let clock = self.clock.borrow().clone();
        self.nested.borrow_mut().push(Duration::ZERO);
        let start = clock();
        work();
        let took = clock().saturating_duration_since(start);
        let inner = self.nested.borrow_mut().pop().unwrap_or_default();
        self.nest(took);
        let own = took.saturating_sub(inner);
        let mut plugins = self.plugins.borrow_mut();
        let stats = &mut plugins[usize::from(slot.0)];
        stats.host.add(own);
        stats.host_total += own;
    }

    /// A call or host work of `took` ran: the host work it is nested in, if any, does not count it.
    fn nest(&self, took: Duration) {
        if let Some(outer) = self.nested.borrow_mut().last_mut() {
            *outer += took;
        }
    }

    /// What the plugin in `slot`'s calls took in the host's frame now, its handlers, views, `layout` and updates, and
    /// what all plugins' calls took: what the scheduler of updates budgets them by ([`crate::schedule`]).
    pub fn spent(&self, slot: Slot) -> (Duration, Duration) {
        let frame = self.frame();
        let now = |counted: Option<(u64, Duration)>| {
            counted.filter(|(open, _)| *open == frame).map_or(Duration::ZERO, |(_, took)| took)
        };
        let own = self.plugins.borrow().get(usize::from(slot.0)).map_or(Duration::ZERO, |stats| now(stats.counted));
        (own, now(self.counted.get()))
    }

    /// The host's time for plugin `id`'s newest build so far ([`Monitor::host`]).
    pub fn host_time(&self, id: &str) -> Duration {
        self.latest(id, |stats| stats.host_total).unwrap_or_default()
    }

    /// What plugin `id`'s newest build's calls took so far, its setup's apart: what its frame budget counts.
    pub fn calls_time(&self, id: &str) -> Duration {
        self.latest(id, |stats| stats.calls_total).unwrap_or_default()
    }

    /// What the budget makes of a call of `kind` that took `took`, of which it used `cpu` where the OS can say.
    fn account(&self, slot: Slot, kind: &'static str, took: Duration, cpu: Option<Duration>) -> Timed {
        self.nest(took);
        let limits = self.limits();
        let frame = self.frame();
        let mut plugins = self.plugins.borrow_mut();
        let stats = &mut plugins[usize::from(slot.0)];
        match kind {
            "load" => {
                stats.load = Some(took);
                return Timed { took, cpu, ..Timed::default() };
            }
            "setup" => {
                *stats = Stats { artifact: std::mem::take(&mut stats.artifact), load: stats.load, ..Stats::default() };
                stats.setup = Some(took);
                stats.cold = true;
                return Timed { took, cpu, ..Timed::default() };
            }
            "dispose" => return Timed { took, cpu, ..Timed::default() },
            _ => {}
        }
        let samples = match stats.kinds.iter().position(|(known, _)| *known == kind) {
            Some(index) => &mut stats.kinds[index].1,
            None => {
                stats.kinds.push((kind, Samples::default()));
                &mut stats.kinds.last_mut().expect("pushed").1
            }
        };
        samples.add(took);
        stats.calls_total += took;
        stats.counted = Some(add(stats.counted, frame, took));
        self.counted.set(Some(add(self.counted.get(), frame, took)));
        let cold = std::mem::take(&mut stats.cold);
        let overrun = cpu.unwrap_or(took) > limits.overrun && !cold;
        let (slow, opened) = stats.add(frame, took, &limits);
        let id = stats.artifact.id.clone();
        drop(plugins);
        let slow = slow.filter(|_| self.tell(&id));
        match self.all.get() {
            Some((open, sum)) if open == frame => self.all.set(Some((open, sum + took))),
            Some((_, sum)) => {
                self.close_all(sum, &limits);
                self.all.set(Some((frame, took)));
            }
            None => self.all.set(Some((frame, took))),
        }
        Timed { took, cpu, overrun, slow, opened }
    }

    /// A paint starts: every frame before the one now open ends; the open one goes on through the paint, so a paint
    /// does not cut one frame's calls in two, and ends at a later paint (review carbon 4.1). Returns the plugins that
    /// became slow, with what a slow frame costs.
    pub fn close(&self) -> Vec<(String, String)> {
        self.closing.set(false);
        let (limits, frame) = (self.limits(), self.frame());
        let mut news = Vec::new();
        for stats in self.plugins.borrow_mut().iter_mut() {
            if let Some((_, sum)) = stats.window.take_if(|(open, _)| *open < frame)
                && let Some(cost) = stats.close(sum, &limits)
            {
                news.push((stats.artifact.id.clone(), cost));
            }
            // A backlog that left the window, with no mail since to say so, stops the slow it caused.
            stats.look_at_backlog(&limits, frame);
        }
        news.retain(|(id, _)| self.tell(id));
        if let Some((_, sum)) = self.all.get().filter(|(open, _)| *open < frame) {
            self.all.set(None);
            self.close_all(sum, &limits);
        }
        news
    }

    /// Whether a plugin became slow or stopped being slow since the last call, which the plugin list shows (P6b).
    pub fn take_flipped(&self) -> bool {
        // Every plugin's flag is taken, not only up to the first that is set.
        let mut flipped = false;
        for stats in self.plugins.borrow_mut().iter_mut() {
            flipped |= std::mem::take(&mut stats.flipped);
        }
        flipped
    }

    /// Whether the host must close the open frames at the next paint; true once until [`Monitor::close`].
    pub fn wants_close(&self) -> bool {
        !self.closing.replace(true)
    }

    /// Ends the frame in which all plugins summed to `sum`.
    fn close_all(&self, sum: Duration, limits: &Limits) {
        if sum <= limits.all {
            return;
        }
        self.over_all.set(self.over_all.get() + 1);
        if self.over_all.get() == 1 {
            log::warn!("plugins took {:.1} ms in one frame, over {:?} for all of them", ms(sum), limits.all);
        }
    }

    /// A built-in overran: a host bug, which a performance test fails on.
    pub fn host_overran(&self) {
        self.host_overruns.set(self.host_overruns.get() + 1);
    }

    /// The overruns of built-ins so far.
    pub fn host_overruns(&self) -> u64 {
        self.host_overruns.get()
    }

    /// The newest build of plugin `id`.
    fn latest<T>(&self, id: &str, f: impl FnOnce(&Stats) -> T) -> Option<T> {
        self.plugins.borrow().iter().rev().find(|stats| stats.artifact.id == id).map(f)
    }

    /// Whether plugin `id`'s newest build is slow now: by its calls, or by its backlog.
    pub fn is_slow(&self, id: &str) -> bool {
        let (limits, now) = (self.limits(), self.frame());
        self.latest(id, |stats| stats.slow || stats.backlogged(&limits, now)).unwrap_or(false)
    }

    /// The end of a frame in which plugin `slot` had mail: whether its mailbox is `full`, and the sends it refused so
    /// far. A mailbox full at the end of more than [`Limits::slow`] of the last [`Limits::window`] frames makes its
    /// plugin slow, with the cause "backlog": the first time, the plugin's ID and the news, once a session.
    pub fn backlog(&self, slot: Slot, full: bool, refused: u64) -> Option<(String, String)> {
        let (limits, now) = (self.limits(), self.frame());
        let mut plugins = self.plugins.borrow_mut();
        let stats = &mut plugins[usize::from(slot.0)];
        stats.refused = refused;
        while stats.backlog.front().is_some_and(|frame| frame + limits.window as u64 <= now) {
            stats.backlog.pop_front();
        }
        if full && stats.backlog.back() != Some(&now) {
            stats.backlog.push_back(now);
        }
        stats.look_at_backlog(&limits, now);
        if !stats.backlog_slow || std::mem::replace(&mut stats.told_backlog, true) {
            return None;
        }
        log::warn!(
            "plugin {} is slow: its mailbox was full at the end of {} frames",
            stats.artifact.id,
            stats.backlog.len()
        );
        let id = stats.artifact.id.clone();
        drop(plugins);
        self.tell(&id).then(|| (id, format!("Its mailbox is full; {refused} sends refused")))
    }

    /// The frames all plugins together went over [`Limits::all`].
    pub fn frames_over_all(&self) -> u64 {
        self.over_all.get()
    }

    /// What `/plugins` shows for a slow plugin: p50, p99 and worst per call kind.
    pub fn report(&self, id: &str) -> Option<String> {
        let (limits, now) = (self.limits(), self.frame());
        self.latest(id, |stats| {
            let backlog = stats.backlogged(&limits, now).then(|| {
                let full = stats.backlog.iter().filter(|frame| *frame + limits.window as u64 > now).count();
                format!(
                    "backlog: full at the end of {full} of the last {} frames, {} sends refused",
                    limits.window, stats.refused
                )
            });
            if !stats.slow {
                return backlog;
            }
            stats.slow.then(|| {
                // The host's time for its nodes goes beside its own calls (4.4).
                let kinds: Vec<String> = stats
                    .kinds
                    .iter()
                    .map(|(kind, samples)| (*kind, samples))
                    .chain([("host", &stats.host)])
                    .filter(|(_, samples)| !samples.recent.is_empty())
                    .map(|(kind, samples)| {
                        let mut sorted: Vec<Duration> = samples.recent.iter().copied().collect();
                        sorted.sort_unstable();
                        let at = |q: f64| sorted[((sorted.len() - 1) as f64 * q).round() as usize];
                        format!("{kind} {:.1}/{:.1}/{:.1} ms", ms(at(0.5)), ms(at(0.99)), ms(samples.worst))
                    })
                    .collect();
                // How long it took to start, as the manager's details say it (4.4); a healthy row says nothing.
                let start: Vec<String> = [("load", stats.load), ("setup", stats.setup)]
                    .into_iter()
                    .filter_map(|(name, took)| Some(format!("{name} {:.1} ms", ms(took?))))
                    .collect();
                let start = if start.is_empty() { String::new() } else { format!("; {}", start.join(", ")) };
                let backlog = backlog.map(|backlog| format!("; {backlog}")).unwrap_or_default();
                format!("slow (p50/p99/worst): {}{start}{backlog}", kinds.join(", "))
            })
        })
        .flatten()
    }

    /// How long plugin `id`'s newest build took to load and to set up.
    pub fn load(&self, id: &str) -> (Option<Duration>, Option<Duration>) {
        self.latest(id, |stats| (stats.load, stats.setup)).unwrap_or_default()
    }
}

impl Stats {
    /// Takes whether its backlog makes it slow `now`, and marks a change of it as a change of slow.
    fn look_at_backlog(&mut self, limits: &Limits, now: u64) {
        let backlogged = self.backlogged(limits, now);
        self.flipped |= backlogged != self.backlog_slow;
        self.backlog_slow = backlogged;
    }

    /// Whether its mailbox was full at the end of more than [`Limits::slow`] of the [`Limits::window`] frames before
    /// `now`.
    fn backlogged(&self, limits: &Limits, now: u64) -> bool {
        self.backlog.iter().filter(|frame| *frame + limits.window as u64 > now).count() > limits.slow
    }

    /// Adds a call of `took` in `frame`; when that ends the frame before, the slow rule runs on it. Returns the news
    /// of a plugin that became slow for the first time, and whether the call opened a frame.
    fn add(&mut self, frame: u64, took: Duration, limits: &Limits) -> (Option<String>, bool) {
        let news = match self.window {
            Some((open, sum)) if open == frame => {
                self.window = Some((open, sum + took));
                return (None, false);
            }
            Some((_, sum)) => self.close(sum, limits),
            None => None,
        };
        self.window = Some((frame, took));
        (news, true)
    }

    fn close(&mut self, sum: Duration, limits: &Limits) -> Option<String> {
        if self.frames.len() >= limits.window {
            self.frames.pop_front();
        }
        self.frames.push_back(sum);
        let over: Vec<Duration> = self.frames.iter().copied().filter(|frame| *frame > limits.frame).collect();
        let slow = over.len() > limits.slow;
        self.flipped |= slow != self.slow;
        self.slow = slow;
        if !self.slow || std::mem::replace(&mut self.told, true) {
            return None;
        }
        let mut over = over;
        over.sort_unstable();
        let typical = over[over.len() / 2];
        log::warn!(
            "plugin {} is slow: {:.1} ms a frame in {} of {} frames",
            self.artifact.id,
            ms(typical),
            over.len(),
            self.frames.len()
        );
        Some(format!("{:.1} ms a frame", ms(typical)))
    }
}

/// `counted` with a call of `took` in `frame`: added in its frame, or the first of a new one.
fn add(counted: Option<(u64, Duration)>, frame: u64, took: Duration) -> (u64, Duration) {
    match counted {
        Some((open, sum)) if open == frame => (open, sum + took),
        _ => (frame, took),
    }
}

fn ms(duration: Duration) -> f64 {
    duration.as_secs_f64() * 1e3
}

/// How long this thread has waited on a run queue so far, runnable but not running: the second field of
/// `/proc/thread-self/schedstat`, in nanoseconds. None where the kernel does not tell.
#[cfg(target_os = "linux")]
fn queued() -> Duration {
    use std::os::unix::fs::FileExt;
    thread_local! {
        static SCHEDSTAT: Option<std::fs::File> = std::fs::File::open("/proc/thread-self/schedstat").ok();
    }
    SCHEDSTAT.with(|file| {
        let mut buffer = [0; 96];
        let read = file.as_ref().and_then(|file| file.read_at(&mut buffer, 0).ok()).unwrap_or(0);
        let text = std::str::from_utf8(&buffer[..read]).unwrap_or_default();
        Duration::from_nanos(text.split_whitespace().nth(1).and_then(|ns| ns.parse().ok()).unwrap_or(0))
    })
}

#[cfg(not(target_os = "linux"))]
fn queued() -> Duration {
    Duration::ZERO
}

/// The CPU time this thread has used so far, user and system: only while it ran, so neither a run queue, a sleep, a
/// lock nor a page fault served from swap or disk counts. Unix (Linux, macOS, the BSDs) reads
/// `CLOCK_THREAD_CPUTIME_ID`, to the nanosecond; Windows reads `GetThreadTimes`, which advances by the scheduler's
/// tick (about 15.6 ms). `None` where the OS does not tell.
#[cfg(unix)]
pub(crate) fn thread_cpu() -> Option<Duration> {
    let mut time = libc::timespec { tv_sec: 0, tv_nsec: 0 };
    // SAFETY: `time` outlives the call, which only writes it.
    #[allow(unsafe_code)]
    let read = unsafe { libc::clock_gettime(libc::CLOCK_THREAD_CPUTIME_ID, &mut time) };
    (read == 0).then(|| Duration::new(time.tv_sec as u64, time.tv_nsec as u32))
}

#[cfg(windows)]
pub(crate) fn thread_cpu() -> Option<Duration> {
    opencode_util::win::thread_cpu_time()
}

#[cfg(not(any(unix, windows)))]
pub(crate) fn thread_cpu() -> Option<Duration> {
    None
}

#[cfg(test)]
mod tests;
