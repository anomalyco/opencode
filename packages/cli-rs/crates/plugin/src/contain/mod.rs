//! Containment of plugin calls (synthesis 4.4 and 4.5, phase P4c). Every call into a plugin, on either path, runs
//! through [`Monitor::call`]: it reads the clock before and after, so the plugin cannot opt out and does not report its
//! own time, and while a run record is attached it names the call in the record for the watchdog and a restart.
//!
//! The budget acts after a call returns, because a call on the UI thread cannot be stopped:
//!
//! - **frame budget**: [`Limits::frame`] per plugin per frame, summed over its calls; [`Limits::all`] for all plugins
//!   together. A frame is one value of the host's frame counter: a paint and what runs after it until the next.
//! - **slow**: over the frame budget in more than [`Limits::slow`] of the last [`Limits::window`] frames the plugin ran
//!   in. It informs only, once a session, because wall time on a loaded machine is noisy.
//! - **overrun**: one call over [`Limits::overrun`]. The caller fails an external plugin; for a built-in it is a host
//!   bug, logged. A library's first call after `setup` is exempt, because its pages are cold. `setup` and `dispose`
//!   are timed and do not count: `setup` is shown as the plugin's load.
//! - **hang**: a call not returned after [`Limits::hang`]; the watchdog acts ([`watchdog`]).

pub mod record;
pub mod watchdog;

use std::cell::{Cell, OnceCell, RefCell};
use std::collections::VecDeque;
use std::rc::Rc;
use std::sync::Arc;
use std::time::{Duration, Instant};

pub use record::{Left, Record};

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

/// One plugin as the monitor knows it, for the life of the process.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Slot(u16);

/// What a call cost, and what the budget says about it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Timed {
    pub took: Duration,
    /// Over [`Limits::overrun`], and not exempt.
    pub overrun: bool,
    /// The plugin just became slow, for the first time this session: what it costs a frame.
    pub slow: Option<String>,
}

/// Times every plugin call and keeps the budget's state; the host owns one.
pub struct Monitor {
    limits: Cell<Limits>,
    clock: RefCell<Rc<dyn Fn() -> Instant>>,
    frame: RefCell<Rc<dyn Fn() -> u64>>,
    plugins: RefCell<Vec<Stats>>,
    /// The frame all plugins' calls are summed in, and their sum.
    all: Cell<(u64, Duration)>,
    over_all: Cell<u64>,
    /// A call runs: a call within it is part of it.
    depth: Cell<u32>,
    record: OnceCell<(Arc<Record>, Instant)>,
}

#[derive(Default)]
struct Stats {
    id: String,
    /// The frame its calls are summed in, and their sum.
    window: Option<(u64, Duration)>,
    /// The sums of the last frames it ran in, newest last.
    frames: VecDeque<Duration>,
    slow: bool,
    told: bool,
    /// The next call is the first after a load: exempt from overrun.
    cold: bool,
    load: Option<Duration>,
    kinds: Vec<(&'static str, Samples)>,
}

#[derive(Default)]
struct Samples {
    recent: VecDeque<Duration>,
    worst: Duration,
}

/// The calls a kind keeps for its percentiles.
const SAMPLES: usize = 256;

impl Default for Monitor {
    fn default() -> Self {
        Self::new(Limits::default())
    }
}

impl Monitor {
    /// A monitor on the monotonic clock, whose frames are counted by the host ([`Monitor::set_frames`]).
    pub fn new(limits: Limits) -> Self {
        Self {
            limits: Cell::new(limits),
            clock: RefCell::new(Rc::new(Instant::now)),
            frame: RefCell::new(Rc::new(|| 0)),
            plugins: RefCell::default(),
            all: Cell::default(),
            over_all: Cell::new(0),
            depth: Cell::new(0),
            record: OnceCell::new(),
        }
    }

    pub fn limits(&self) -> Limits {
        self.limits.get()
    }

    pub fn set_limits(&self, limits: Limits) {
        self.limits.set(limits);
    }

    /// Reads time from `clock`, which tests inject.
    pub fn set_clock(&self, clock: impl Fn() -> Instant + 'static) {
        *self.clock.borrow_mut() = Rc::new(clock);
    }

    /// Counts frames with `frame`: the host's painted frames.
    pub fn set_frames(&self, frame: impl Fn() -> u64 + 'static) {
        *self.frame.borrow_mut() = Rc::new(frame);
    }

    /// Keeps the run record at `path` from now on, with the watchdog over it. Once per process: the record names the
    /// plugins known so far and those that come later.
    pub fn attach_record(&self, path: &std::path::Path) -> std::io::Result<Arc<Record>> {
        let record = Arc::new(Record::create(path)?);
        let epoch = (self.clock.borrow())();
        if self.record.set((record.clone(), epoch)).is_err() {
            return Err(std::io::Error::other("a record is attached already"));
        }
        for (slot, stats) in self.plugins.borrow().iter().enumerate() {
            record.name(slot as u16, &stats.id);
        }
        Ok(record)
    }

    /// Starts the watchdog over the attached record, painting on `terminal`.
    pub fn watch(&self, terminal: Option<std::fs::File>) {
        if let Some((record, epoch)) = self.record.get() {
            watchdog::spawn(record.clone(), *epoch, self.limits(), terminal);
        }
    }

    pub fn record(&self) -> Option<&Arc<Record>> {
        self.record.get().map(|(record, _)| record)
    }

    /// The slot of plugin `id`, made on first use.
    pub fn slot(&self, id: &str) -> Slot {
        let mut plugins = self.plugins.borrow_mut();
        if let Some(index) = plugins.iter().position(|stats| stats.id == id) {
            return Slot(index as u16);
        }
        plugins.push(Stats { id: id.to_owned(), ..Stats::default() });
        let slot = (plugins.len() - 1) as u16;
        if let Some((record, _)) = self.record.get() {
            record.name(slot, id);
        }
        Slot(slot)
    }

    /// Runs `f` as call `kind` of the plugin in `slot`: timed, and named in the record while it runs. A call within a
    /// call is part of the outer one.
    pub fn call<R>(&self, slot: Slot, kind: &'static str, f: impl FnOnce() -> R) -> (R, Timed) {
        if self.depth.get() > 0 {
            return (f(), Timed::default());
        }
        let clock = self.clock.borrow().clone();
        let start = clock();
        if let Some((record, epoch)) = self.record.get() {
            record.enter(slot.0, record::kind(kind), start.saturating_duration_since(*epoch).as_millis() as u64);
        }
        self.depth.set(1);
        let value = f();
        self.depth.set(0);
        let took = clock().saturating_duration_since(start);
        if let Some((record, _)) = self.record.get() {
            record.leave();
        }
        (value, self.account(slot, kind, took))
    }

    /// What the budget makes of a call of `kind` that took `took`.
    fn account(&self, slot: Slot, kind: &'static str, took: Duration) -> Timed {
        let limits = self.limits();
        let frame = (self.frame.borrow())();
        let mut plugins = self.plugins.borrow_mut();
        let stats = &mut plugins[usize::from(slot.0)];
        match kind {
            "setup" => {
                stats.load = Some(took);
                stats.cold = true;
                return Timed { took, ..Timed::default() };
            }
            "dispose" => return Timed { took, ..Timed::default() },
            _ => {}
        }
        let samples = match stats.kinds.iter().position(|(known, _)| *known == kind) {
            Some(index) => &mut stats.kinds[index].1,
            None => {
                stats.kinds.push((kind, Samples::default()));
                &mut stats.kinds.last_mut().expect("pushed").1
            }
        };
        if samples.recent.len() == SAMPLES {
            samples.recent.pop_front();
        }
        samples.recent.push_back(took);
        samples.worst = samples.worst.max(took);
        let overrun = took > limits.overrun && !std::mem::take(&mut stats.cold);
        let slow = stats.add(frame, took, &limits);
        let (all, sum) = self.all.get();
        if all != frame {
            self.close_all(sum, &limits);
        }
        self.all.set((frame, if all == frame { sum + took } else { took }));
        Timed { took, overrun, slow }
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

    /// Whether plugin `id` is slow now.
    pub fn is_slow(&self, id: &str) -> bool {
        self.plugins.borrow().iter().any(|stats| stats.id == id && stats.slow)
    }

    /// The frames all plugins together went over [`Limits::all`].
    pub fn frames_over_all(&self) -> u64 {
        self.over_all.get()
    }

    /// What `/plugins` shows for a slow plugin: p50, p99 and worst per call kind.
    pub fn report(&self, id: &str) -> Option<String> {
        let plugins = self.plugins.borrow();
        let stats = plugins.iter().find(|stats| stats.id == id && stats.slow)?;
        let kinds: Vec<String> = stats
            .kinds
            .iter()
            .filter(|(_, samples)| !samples.recent.is_empty())
            .map(|(kind, samples)| {
                let mut sorted: Vec<Duration> = samples.recent.iter().copied().collect();
                sorted.sort_unstable();
                let at = |q: f64| sorted[((sorted.len() - 1) as f64 * q).round() as usize];
                format!("{kind} {:.1}/{:.1}/{:.1} ms", ms(at(0.5)), ms(at(0.99)), ms(samples.worst))
            })
            .collect();
        Some(format!("slow (p50/p99/worst): {}", kinds.join(", ")))
    }

    /// How long plugin `id`'s last `setup` took.
    pub fn load(&self, id: &str) -> Option<Duration> {
        self.plugins.borrow().iter().find(|stats| stats.id == id).and_then(|stats| stats.load)
    }
}

impl Stats {
    /// Adds a call of `took` in `frame`; when that ends the frame before, the slow rule runs on it. Returns the news
    /// of a plugin that became slow for the first time.
    fn add(&mut self, frame: u64, took: Duration, limits: &Limits) -> Option<String> {
        let news = match self.window {
            Some((open, sum)) if open == frame => {
                self.window = Some((open, sum + took));
                return None;
            }
            Some((_, sum)) => self.close(sum, limits),
            None => None,
        };
        self.window = Some((frame, took));
        news
    }

    fn close(&mut self, sum: Duration, limits: &Limits) -> Option<String> {
        if self.frames.len() >= limits.window {
            self.frames.pop_front();
        }
        self.frames.push_back(sum);
        let over: Vec<Duration> = self.frames.iter().copied().filter(|frame| *frame > limits.frame).collect();
        self.slow = over.len() > limits.slow;
        if !self.slow || std::mem::replace(&mut self.told, true) {
            return None;
        }
        let mut over = over;
        over.sort_unstable();
        let typical = over[over.len() / 2];
        log::warn!(
            "plugin {} is slow: {:.1} ms a frame in {} of {} frames",
            self.id,
            ms(typical),
            over.len(),
            self.frames.len()
        );
        Some(format!("{:.1} ms a frame", ms(typical)))
    }
}

fn ms(duration: Duration) -> f64 {
    duration.as_secs_f64() * 1e3
}

#[cfg(test)]
mod tests;
