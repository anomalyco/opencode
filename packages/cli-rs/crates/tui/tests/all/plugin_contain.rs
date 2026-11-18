//! Model containment on two real external plugins. A fault in one must leave the other usable and release the failed
//! activation's state.

use crate::support::model::{self, Failure, Model, Rng};
use crate::support::{self, Harness};

use std::cell::{Cell, RefCell};
use std::path::Path;
use std::rc::Rc;
use std::sync::Arc;
use std::time::{Duration, Instant};

use opencode_plugin::abi;
use opencode_plugin::contain::{Artifact, Crash, Handoff, Record, Snapshot, record};
use opencode_plugin::loader::native::loopback_described;
use opencode_plugin::loader::{Backend, Loader, entry_file};
use opencode_plugin::{Definition, ErrorFn, Host, Status};
use opencode_tui::plugins::contain::Contain;
use opencode_tui::plugins::host::host;
use opencode_tui::{Args, Deps, Route};
use opencode_ui::toast::ToastOptions;
use opentui::keymap::RunResult;
use opentui::prelude::*;
use opentui::testing::{Capture, TestApp};

const A: u8 = 1;
const B: u8 = 2;

fn id(plugin: u8) -> &'static str {
    if plugin == A { "model.a" } else { "model.b" }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Fault {
    Panic,
    Overrun,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Setup,
    Command,
    Render,
    Dispose,
}

impl Kind {
    fn name(self) -> &'static str {
        match self {
            Kind::Setup => "setup",
            Kind::Command => "run-command",
            Kind::Render => "render-slot",
            Kind::Dispose => "dispose",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Command {
    Run(u8),
    Frame,
    Type(char),
    ToggleB,
    Arm(Fault, Kind),
    Lag,
    Prompt(&'static str),
    Remount,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Call {
    world: usize,
    plugin: u8,
    kind: Kind,
    /// What the record named while the call ran.
    seen: Option<(String, String)>,
    frame: u64,
    took: Duration,
}

/// The world a call runs in: its record, its clock and its frame counter. Each world sets it before it steps.
#[derive(Clone)]
struct Current {
    world: usize,
    record: Arc<Record>,
    clock: Rc<Cell<Duration>>,
    frame: Rc<dyn Fn() -> u64>,
}

thread_local! {
    static LOG: RefCell<Vec<Call>> = const { RefCell::new(Vec::new()) };
    static CURRENT: RefCell<Option<Current>> = const { RefCell::new(None) };
    /// `model.a`'s armed fault, for world 0 only (the host; the twin is world 1).
    static ARMED: Cell<Option<(Fault, Kind)>> = const { Cell::new(None) };
    static LAG: Cell<bool> = const { Cell::new(false) };
    /// `model.a`'s next budgeted call in world 0 is its first after setup, which no overrun fails.
    static COLD: Cell<bool> = const { Cell::new(false) };
    /// Whether the probe injected a failure in the primary world.
    static FIRED: Cell<bool> = const { Cell::new(false) };
    /// Failure and slow-notice observations from the last run.
    static OUTCOME: Cell<(bool, bool)> = const { Cell::new((false, false)) };
}

fn probe<const P: u8>(setup: &mut abi::Setup) -> Result<(), String> {
    called(P, Kind::Setup);
    let count = Rc::new(Cell::new(0));
    let counted = count.clone();
    let command = abi::Command::new(format!("{}.run", id(P))).title(format!("{} run", id(P))).palette();
    setup.command(command, move |_, _| {
        called(P, Kind::Command);
        counted.set(counted.get() + 1);
    });
    // `model.a` takes the footer over; failed, it must give it back.
    let kind = if P == A { abi::SlotKind::Replace } else { abi::SlotKind::Append };
    setup.slot(abi::Placement::new(kind, "home.footer"), move |_, _, _| {
        called(P, Kind::Render);
        abi::Render::Show(abi::Node::text([abi::Span::new(format!("{} n{}", id(P), count.get()))]))
    });
    setup.on_dispose(move |_| called(P, Kind::Dispose));
    Ok(())
}

fn called(plugin: u8, kind: Kind) {
    let current = CURRENT.with_borrow(|current| current.clone()).expect("a world is current");
    let seen = current.record.running().and_then(|running| {
        Some((current.record.named(running.slot)?.id, record::KINDS.get(usize::from(running.kind))?.to_string()))
    });
    let mine = plugin == A && current.world == 0;
    let fault = ARMED.get().filter(|(_, armed)| mine && *armed == kind).map(|(fault, _)| fault);
    if fault.is_some() {
        ARMED.set(None);
    }
    if mine {
        match kind {
            Kind::Setup => COLD.set(true),
            Kind::Command | Kind::Render => {
                let cold = COLD.replace(false);
                if fault == Some(Fault::Panic) || (fault == Some(Fault::Overrun) && !cold) {
                    FIRED.set(true);
                }
            }
            Kind::Dispose => {}
        }
    }
    let took = match fault {
        Some(Fault::Overrun) => Duration::from_millis(101),
        _ if plugin == A && LAG.get() && matches!(kind, Kind::Command | Kind::Render) => Duration::from_millis(2),
        _ => Duration::ZERO,
    };
    current.clock.set(current.clock.get() + took);
    let world = current.world;
    LOG.with_borrow_mut(|log| log.push(Call { world, plugin, kind, seen, frame: (current.frame)(), took }));
    if fault == Some(Fault::Panic) {
        panic!("{} {kind:?} fault", id(plugin));
    }
}

struct Builds;

impl Backend for Builds {
    fn load(
        &self,
        host: &Rc<dyn Host>,
        library: &[u8],
        _: &std::path::Path,
        _: Option<&str>,
    ) -> Result<(Definition, ErrorFn), String> {
        match library {
            [A] => loopback_described(host, abi::export_plugin!(@loopback_described "model.a", probe::<A>)),
            [B] => loopback_described(host, abi::export_plugin!(@loopback_described "model.b", probe::<B>)),
            _ => Err("not a model build".to_owned()),
        }
    }
}

fn builds() -> opencode_util::temp::TempDir {
    let root = opencode_util::temp::tempdir().unwrap();
    for (name, build) in [("a", A), ("b", B)] {
        let dir = root.path().join("config").join("plugins").join(name);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(entry_file()), [build]).unwrap();
    }
    root
}

struct World {
    harness: Harness,
    current: Current,
    opened: Vec<ToastOptions>,
    loader: Loader,
    _root: opencode_util::temp::TempDir,
}

impl World {
    fn open(world: usize) -> Self {
        let root = builds();
        let record = Arc::new(Record::create(root.path()).unwrap());
        Self::mount(world, root, record, None)
    }

    fn mount(world: usize, root: opencode_util::temp::TempDir, record: Arc<Record>, home: Option<&Path>) -> Self {
        let config = root.path().join("config");
        let roots = home.and_then(|home| support::roots(support::home_paths(home), "test"));
        let deps = Deps { route: Route::Home, roots, ..support::deps(Arc::new(support::empty())) };
        let contain = Contain { record: Some(record), ..Contain::default() };
        let harness = support::mount_on(TestApp::new(100, 24), deps, Args { contain, ..Args::default() });
        let monitor = harness.tui.plugins.monitor().clone();
        let clock = Rc::new(Cell::new(Duration::ZERO));
        let (base, now) = (Instant::now(), clock.clone());
        monitor.set_clock(move || base + now.get());
        let app = harness.app.app().clone();
        let current = Current {
            world,
            record: monitor.record().expect("a record").clone(),
            clock,
            frame: Rc::new(move || app.frame_number()),
        };
        CURRENT.set(Some(current.clone()));
        let loader = Loader::new(Rc::new(Builds), config, root.path().to_path_buf(), Vec::new());
        loader.reconcile(&host(&harness.tui), &harness.tui.plugins);
        let mut world = Self { harness, current, opened: Vec::new(), loader, _root: root };
        world.opened = world.drain();
        world
    }

    fn enter(&self) {
        CURRENT.set(Some(self.current.clone()));
    }

    fn apply(&self, command: Command) {
        self.enter();
        let (app, tui) = (&self.harness.app, &self.harness.tui);
        match command {
            Command::Run(plugin) => {
                let ran = tui.keymap.dispatch(&format!("{}.run", id(plugin)), None);
                let _ = matches!(ran, RunResult::Ok);
            }
            Command::Frame => {
                app.advance(Duration::from_millis(16));
                app.render();
            }
            Command::Type(key) => app.type_text(&key.to_string()),
            Command::ToggleB => self.toggle(B),
            Command::Arm(fault, kind) => {
                if self.current.world == 0 {
                    ARMED.set(Some((fault, kind)));
                }
            }
            Command::Lag => {
                if self.current.world == 0 {
                    LAG.set(!LAG.get());
                }
            }
            Command::Prompt(name) => {
                let _ = tui.keymap.dispatch(name, None);
            }
            Command::Remount => tui.navigate(tui.route()),
        }
    }

    fn toggle(&self, plugin: u8) {
        self.enter();
        let tui = &self.harness.tui;
        let active = tui.plugins.entries().iter().any(|entry| entry.id == id(plugin) && entry.active);
        if let Some(Err(error)) = tui.plugins.toggle(&host(tui), id(plugin), !active) {
            tui.toasts.error(error);
        }
        tui.navigate(tui.route());
    }

    /// Runs what the command queued and drains the toasts; returns their titles.
    fn settle(&self) -> Vec<String> {
        self.drain().into_iter().map(|toast| toast.title.unwrap_or(toast.message)).collect()
    }

    /// Runs what the command queued and drains the toasts.
    fn drain(&self) -> Vec<ToastOptions> {
        self.enter();
        let (app, tui) = (&self.harness.app, &self.harness.tui);
        app.advance(Duration::from_millis(1));
        let mut toasts = Vec::new();
        while let Some(toast) = tui.toasts.current() {
            toasts.push(toast);
            tui.toasts.dismiss();
        }
        app.advance(Duration::from_millis(1));
        toasts
    }

    fn status(&self, plugin: u8) -> Option<Status> {
        self.harness.tui.plugins.entries().into_iter().find(|entry| entry.id == id(plugin)).map(|entry| entry.status)
    }

    fn failed(&self) -> bool {
        matches!(self.status(A), Some(Status::Failed(_)))
    }

    fn composer(&self) -> String {
        self.harness.tui.textarea.borrow().as_ref().map(|textarea| textarea.text()).unwrap_or_default()
    }

    fn frame(&self) -> Capture {
        self.enter();
        self.harness.app.render()
    }

    /// The composer's cells: its placeholder is random, so frames are compared without them.
    fn mask(&self) -> Option<(u32, u32, u32, u32)> {
        let textarea = self.harness.tui.textarea.borrow().clone()?;
        let rect = textarea.rect();
        Some((rect.screen_x as u32, rect.screen_y as u32, rect.width as u32, rect.height as u32))
    }
}

fn rows(frame: &Capture) -> Vec<String> {
    (0..frame.height)
        .map(|y| (0..frame.width).filter_map(|x| frame.cell(x, y)).map(|cell| cell.symbol.as_str()).collect())
        .collect()
}

const COUNT: &str = "⊙ 1 plugin failed /plugins";

/// The first row where `a` and `b` differ outside `mask`. In the row of `a` that holds the failure count, the count
/// alone is taken out, and the rest of the row must read as the twin's.
fn frame_diff(a: &Capture, b: &Capture, mask: Option<(u32, u32, u32, u32)>) -> Option<String> {
    let masked = |x: u32, y: u32| mask.is_some_and(|(mx, my, mw, mh)| x >= mx && x < mx + mw && y >= my && y < my + mh);
    let (ours, theirs) = (rows(a), rows(b));
    let words = |row: &str| row.split_whitespace().collect::<Vec<_>>().join(" ");
    (0..a.height.max(b.height)).find_map(|y| {
        let row = |rows: &[String]| rows.get(y as usize).cloned().unwrap_or_default();
        let differs = match row(&ours).contains(COUNT) {
            true => words(&row(&ours).replacen(COUNT, "", 1)) != words(&row(&theirs)),
            false => (0..a.width.max(b.width)).any(|x| !masked(x, y) && a.cell(x, y) != b.cell(x, y)),
        };
        differs.then(|| format!("row {y}:\n  {:?}\n  {:?}", row(&ours), row(&theirs)))
    })
}

/// The slow rule of 4.4 as code over the plugin's own log: its calls summed by the frame they ran in, a frame ending at
/// the paint after it (each paint starts the next frame), and slow when over 1 ms in more than 12 of the last 120
/// frames it ran in. It says when that first happens.
#[derive(Default)]
struct Slow {
    open: std::collections::BTreeMap<u64, Duration>,
    closed: Vec<bool>,
    told: bool,
}

impl Slow {
    fn add(&mut self, calls: &[&Call]) {
        for call in calls {
            *self.open.entry(call.frame).or_default() += call.took;
        }
    }

    /// Close completed frames and report the transition to slow.
    fn close(&mut self, frame: u64) -> bool {
        let open = self.open.split_off(&frame);
        let mut became = false;
        for sum in std::mem::replace(&mut self.open, open).into_values() {
            self.closed.push(sum > Duration::from_millis(1));
            let window = &self.closed[self.closed.len().saturating_sub(120)..];
            if window.iter().filter(|over| **over).count() > 12 && !self.told {
                self.told = true;
                became = true;
            }
        }
        became
    }
}

/// The composer commands the model runs: each replaces the text without a change event.
const PROMPT: [&str; 4] = ["prompt.clear", "prompt.history.previous", "prompt.stash", "prompt.stash.pop"];

pub struct ContainModel;

impl Model for ContainModel {
    type Command = Command;

    fn generate(&self, rng: &mut Rng, steps: usize) -> Vec<Command> {
        let kinds = [Kind::Command, Kind::Render];
        (0..steps)
            .map(|_| match rng.below(100) {
                0..30 => Command::Run(A),
                30..42 => Command::Run(B),
                42..62 => Command::Frame,
                62..68 => Command::Type(*rng.pick(&['a', 'b', ' '])),
                68..72 => Command::Prompt(rng.pick(&PROMPT)),
                72..74 => Command::Remount,
                74..78 => Command::ToggleB,
                78..82 => Command::Lag,
                _ => Command::Arm(*rng.pick(&[Fault::Panic, Fault::Overrun]), *rng.pick(&kinds)),
            })
            .collect()
    }

    fn run(&self, commands: &[Command]) -> Option<Failure> {
        run(commands)
    }

    fn simplify(&self, command: &Command) -> Vec<Command> {
        match command {
            Command::Arm(Fault::Overrun, kind) => vec![Command::Arm(Fault::Panic, *kind)],
            Command::Type(_) | Command::Prompt(_) | Command::Remount => vec![Command::Frame],
            Command::Run(B) => vec![Command::Frame],
            _ => Vec::new(),
        }
    }
}

/// The failure of `property` at check `site` when the check found `detail`, unless `MODEL_SKIP` turns the property off.
fn check(property: &'static str, site: &'static str, step: usize, detail: Option<String>) -> Option<Failure> {
    let detail = detail.filter(|_| !model::skipped(property))?;
    Some(Failure { property, site, step, detail })
}

fn take_calls() -> Vec<Call> {
    LOG.with_borrow_mut(std::mem::take)
}

fn only(calls: &[Call], world: usize) -> Vec<Call> {
    calls.iter().filter(|call| call.world == world).cloned().collect()
}

/// `draft-exact`: the record's snapshot holds what the composer shows, on home.
fn exact(world: &World) -> Option<String> {
    let snapshot = world.current.record.snapshot().unwrap_or_default();
    let composer = world.composer();
    (snapshot.draft != composer || snapshot.session.is_some() || snapshot.dropped)
        .then(|| format!("the composer holds {composer:?}, the record {snapshot:?}"))
}

/// Runs `commands` on the host and its twin, and checks the four properties after each.
fn run(commands: &[Command]) -> Option<Failure> {
    LOG.take();
    ARMED.set(None);
    LAG.set(false);
    FIRED.set(false);
    let world = World::open(0);
    let calls = take_calls();
    if let Some(failure) = check("record-balanced", "start", 0, balanced(&world, &calls)) {
        return Some(failure);
    }
    let twin = World::open(1);
    take_calls();
    let mut slow = Slow::default();
    let mut faulted = false;
    for (step, &command) in commands.iter().enumerate() {
        let failed = world.failed();
        world.apply(command);
        let reports = world.settle();
        let calls = take_calls();
        if let Some(failure) = check("draft-exact", "composer", step, exact(&world)) {
            return Some(failure);
        }
        twin.apply(command);
        // The fault log says when `model.a` fails; the user disables it in the twin at that step, and the host's
        // registry must agree.
        let failing = FIRED.take();
        let agrees = failing == (!failed && world.failed());
        let detail = (!agrees)
            .then(|| format!("the fault log says failing {failing}; the host lists model.a {:?}", world.status(A)));
        if let Some(failure) = check("reported-once", "fault-log", step, detail) {
            return Some(failure);
        }
        if failing {
            twin.toggle(A);
        }
        twin.settle();
        let twins = take_calls();
        if let Some(failure) = check("record-balanced", "calls", step, balanced(&world, &calls)) {
            return Some(failure);
        }
        let mine: Vec<&Call> = calls
            .iter()
            .filter(|call| call.world == 0 && call.plugin == A && matches!(call.kind, Kind::Command | Kind::Render))
            .collect();
        slow.add(&mine);
        // The news of a frame that ended after the plugin failed is the failure's to tell.
        let due = slow.close(world.harness.app.app().frame_number()) && !world.failed();
        if let Some(failure) = check("reported-once", "reports", step, reported(&world, &reports, failing, due)) {
            return Some(failure);
        }
        faulted |= failing;
        if !faulted {
            continue;
        }
        // A render is a function of the host's state, and the failure report is a change of it, so runs of renders
        // count as one, as in `reload-fresh`.
        let witness = |calls: &[Call]| -> Vec<Kind> {
            let mut kinds: Vec<Kind> = Vec::new();
            for call in calls.iter().filter(|call| call.plugin == B) {
                if !(call.kind == Kind::Render && kinds.last() == Some(&Kind::Render)) {
                    kinds.push(call.kind);
                }
            }
            kinds
        };
        let (calls, twins) = (only(&calls, 0), only(&twins, 1));
        let detail = (witness(&calls) != witness(&twins))
            .then(|| format!("model.b's calls: host {:?}, twin {:?}", witness(&calls), witness(&twins)));
        if let Some(failure) = check("isolation", "witness", step, detail) {
            return Some(failure);
        }
        let detail = (world.composer() != twin.composer())
            .then(|| format!("composer {:?} and {:?}", world.composer(), twin.composer()));
        if let Some(failure) = check("isolation", "composer", step, detail) {
            return Some(failure);
        }
        let detail =
            frame_diff(&world.frame(), &twin.frame(), world.mask()).map(|row| format!("the frames differ at {row}"));
        if let Some(failure) = check("isolation", "frame", step, detail) {
            return Some(failure);
        }
    }
    OUTCOME.set((faulted, slow.told));
    None
}

fn balanced(world: &World, calls: &[Call]) -> Option<String> {
    for call in calls.iter().filter(|call| call.world == 0) {
        let expected = Some((id(call.plugin).to_owned(), call.kind.name().to_owned()));
        if call.seen != expected {
            return Some(format!("inside {call:?} the record named {:?}", call.seen));
        }
    }
    let record = &world.current.record;
    if let Some(running) = record.running() {
        return Some(format!("after the command the record names {running:?}"));
    }
    let crash = record.crash();
    (crash != Crash::default()).then(|| format!("after the command the record names {crash:?}"))
}

/// `reported-once`: the toasts of this step, the footer's count and the manager's row, for a fault that failed the
/// plugin this step (`failing`) and the slow news that is due (`due`).
fn reported(world: &World, reports: &[String], failing: bool, due: bool) -> Option<String> {
    let count = |title: &str| reports.iter().filter(|report| *report == title).count();
    let (failures, slows) = (count("Plugin failed: model.a"), count("Plugin is slow: model.a"));
    let others = reports.iter().filter(|report| report.contains("model.b")).count();
    if failures != usize::from(failing) || slows != usize::from(due) || others != 0 {
        return Some(format!("failing {failing}, slow news due {due}; the toasts {reports:?}"));
    }
    let failed = world.failed();
    let footer = rows(&world.frame()).iter().filter(|row| row.contains("1 plugin failed")).count();
    if footer != usize::from(failed) {
        return Some(format!("the plugin failed: {failed}; the footer counts it {footer} times"));
    }
    let listed_slow = world.harness.tui.plugins.entries().iter().any(|entry| entry.id == id(A) && entry.slow.is_some());
    if failed && listed_slow {
        return Some("a failed model.a is listed slow".to_owned());
    }
    if !matches!(world.status(A), Some(Status::Failed(_)) | Some(Status::Active)) {
        return Some(format!("model.a is listed {:?}", world.status(A)));
    }
    match world.status(B) {
        Some(Status::Failed(error)) => Some(format!("model.b is listed failed: {error}")),
        _ => None,
    }
}

const OPEN: &[(&str, &str, &[Command])] = &[];

/// Fixed rows: each fault and report through the whole host, with whether `model.a` must fail and be told slow, so a
/// row cannot pass because its fault never fired.
fn fixed() -> Vec<(&'static str, Vec<Command>, (bool, bool))> {
    let lagged = |frames: usize| {
        let mut commands = vec![Command::Lag];
        for _ in 0..frames {
            commands.extend([Command::Run(A), Command::Frame]);
        }
        commands.push(Command::Run(A));
        commands
    };
    vec![
        ("a-panic-in-a-command", vec![Command::Arm(Fault::Panic, Kind::Command), Command::Run(A)], (true, false)),
        ("a-panic-in-a-render", vec![Command::Arm(Fault::Panic, Kind::Render), Command::Run(A)], (true, false)),
        ("an-overrun-in-a-command", vec![Command::Arm(Fault::Overrun, Kind::Command), Command::Run(A)], (true, false)),
        ("an-overrun-in-a-render", vec![Command::Arm(Fault::Overrun, Kind::Render), Command::Run(A)], (true, false)),
        (
            "the-witness-runs-on-after-a-fault",
            vec![
                Command::Arm(Fault::Panic, Kind::Command),
                Command::Run(A),
                Command::Run(B),
                Command::Type('a'),
                Command::ToggleB,
                Command::Frame,
                Command::ToggleB,
                Command::Run(B),
                Command::Run(A),
            ],
            (true, false),
        ),
        ("slow-is-told-once", lagged(40), (false, true)),
        (
            "slow-then-a-fault",
            [lagged(20), vec![Command::Arm(Fault::Panic, Kind::Command), Command::Run(A)]].concat(),
            (true, true),
        ),
        ("not-slow-at-twelve-frames", lagged(12), (false, false)),
        // The 13th slow frame is the one the fault ran in: it ends after the plugin failed, so slow is no news.
        (
            "slow-after-the-fault-is-no-news",
            [lagged(11), vec![Command::Arm(Fault::Panic, Kind::Command), Command::Run(A), Command::Frame]].concat(),
            (true, true),
        ),
    ]
}

#[test]
fn containment_holds_its_properties() {
    model::check(&ContainModel, 20, 64);
}

#[test]
fn the_fixed_rows_pass_and_the_open_rows_still_fail() {
    for (name, commands, outcome) in fixed() {
        assert_eq!(run(&commands), None, "{name}");
        assert_eq!(OUTCOME.get(), outcome, "{name}: (failed, told slow)");
    }
    for (name, property, commands) in OPEN {
        let failure = run(commands);
        assert_eq!(failure.as_ref().map(|failure| failure.property), Some(*property), "{name}: {failure:?}");
    }
}

#[test]
fn the_oracles_can_fail() {
    LOG.take();
    LAG.set(false);
    let world = World::open(0);
    assert!(world.opened.is_empty());
    ARMED.set(Some((Fault::Panic, Kind::Command)));
    world.apply(Command::Run(A));
    assert_eq!(world.settle(), ["Plugin failed: model.a"]);
    assert!(world.failed());
    assert!(rows(&world.frame()).iter().any(|row| row.contains("1 plugin failed")));
    let twin = World::open(1);
    assert!(frame_diff(&world.frame(), &twin.frame(), world.mask()).is_some());
    take_calls();
    let call = Call { world: 0, plugin: B, kind: Kind::Command, seen: None, frame: 0, took: Duration::ZERO };
    assert!(balanced(&world, &[call]).is_some());

    let slow = World::open(0);
    LAG.set(true);
    let mut toasts = Vec::new();
    for _ in 0..20 {
        slow.apply(Command::Run(A));
        toasts.extend(slow.drain());
        slow.apply(Command::Frame);
        toasts.extend(slow.drain());
    }
    LAG.set(false);
    let titles: Vec<_> = toasts.iter().filter_map(|toast| toast.title.clone()).collect();
    assert_eq!(titles, ["Plugin is slow: model.a"]);
    assert!(slow.harness.tui.plugins.entries().iter().any(|entry| entry.id == "model.a" && entry.slow.is_some()));
    let _ = slow.harness.tui.keymap.dispatch("plugins.list", None);
    slow.settle();
    let screen = rows(&slow.frame()).join("\n");
    assert!(screen.contains("slow: run-command"), "{screen}");
    (toasts[0].action.clone().expect("Disable").run)();
    slow.settle();
    assert_eq!(slow.status(A), Some(Status::Inactive));
    take_calls();
}

/// A client a parent started after a crash that named no plugin, handed `snapshot`.
fn restarted(snapshot: Option<Snapshot>) -> World {
    let root = builds();
    let record = Arc::new(Record::create(root.path()).unwrap());
    record.set_handoff(&Handoff { crash: Some(Crash::default()), safe: false });
    if let Some(snapshot) = &snapshot {
        record.publish(snapshot);
    }
    World::mount(0, root, record, None)
}

/// A client a parent started after `crash`, with its state in `root`.
fn after(root: opencode_util::temp::TempDir, crash: Crash) -> World {
    let home = root.path().join("home");
    after_in(root, crash, &home)
}

/// A client a parent started after `crash`, with its state in `home`.
fn after_in(root: opencode_util::temp::TempDir, crash: Crash, home: &Path) -> World {
    let record = Arc::new(Record::create(root.path()).unwrap());
    record.set_handoff(&Handoff { crash: Some(crash), safe: false });
    World::mount(0, root, record, Some(home))
}

fn crash_of(root: &opencode_util::temp::TempDir, id: &str) -> Crash {
    let name = if id == "model.a" { "a" } else { "b" };
    let target = root.path().join("config").join("plugins").join(name).to_string_lossy().into_owned();
    let probe = World::open(0);
    let digest = (0..record::NAMES as u16)
        .find_map(|slot| probe.current.record.named(slot).filter(|artifact| artifact.id == id))
        .and_then(|artifact| artifact.digest)
        .expect("named");
    drop(probe);
    take_calls();
    Crash {
        artifact: Some(Artifact::external(id, &target, &digest)),
        call: Some("render-slot".to_owned()),
        hang: false,
    }
}

fn crash_list(world: &World) -> serde_json::Value {
    let file = world.harness.tui.state_dir().expect("a state directory").join("plugin-crashes.json");
    serde_json::from_slice(&std::fs::read(file).unwrap_or_else(|_| b"[]".to_vec())).unwrap()
}

#[test]
fn a_crash_holds_the_build_until_its_toast_enables_it() {
    LOG.take();
    let root = builds();
    let crash = crash_of(&root, "model.a");
    let world = after(root, crash);
    assert!(take_calls().iter().all(|call| call.plugin != A), "the build that crashed ran");
    let reason = "crashed the client in `render-slot` and is disabled";
    assert_eq!(world.status(A), Some(Status::Failed(reason.to_owned())));
    assert_eq!(crash_list(&world).as_array().map(Vec::len), Some(1));
    let toast = world.opened.iter().find(|toast| toast.title.as_deref() == Some("Plugin failed: model.a")).unwrap();
    assert_eq!(world.opened.len(), 1);
    let action = toast.action.clone().expect("Enable again");
    assert_eq!(action.label, "Enable again");
    (action.run)();
    world.settle();
    world.loader.reconcile(&host(&world.harness.tui), &world.harness.tui.plugins);
    world.settle();
    assert_eq!(world.status(A), Some(Status::Active));
    assert!(take_calls().iter().any(|call| call.plugin == A && call.kind == Kind::Setup));
    assert_eq!(crash_list(&world), serde_json::json!([]));
}

#[test]
fn a_crash_in_a_builtin_is_told_as_a_host_bug() {
    LOG.take();
    let crash =
        Crash { artifact: Some(Artifact::builtin("opencode.home")), call: Some("render-slot".to_owned()), hang: false };
    let world = after(builds(), crash);
    let titles: Vec<_> = world.opened.iter().filter_map(|toast| toast.title.clone()).collect();
    assert_eq!(titles, ["Built-in plugin failed: opencode.home"]);
    assert_eq!(crash_list(&world), serde_json::json!([]));
    assert_eq!((world.status(A), world.status(B)), (Some(Status::Active), Some(Status::Active)));
    take_calls();
}

#[test]
fn a_restored_draft_survives_a_second_crash() {
    LOG.take();
    let draft = "half a thought\nand a second line é";
    let first = restarted(Some(Snapshot { session: None, draft: draft.to_owned(), dropped: false }));
    assert_eq!((first.composer().as_str(), exact(&first)), (draft, None));
    let second = restarted(first.current.record.snapshot());
    assert_eq!((second.composer().as_str(), exact(&second)), (draft, None));
    second.apply(Command::Prompt("prompt.clear"));
    second.settle();
    assert_eq!(exact(&second), None);
    let third = restarted(second.current.record.snapshot());
    assert_eq!(third.composer(), "");
    take_calls();
}

#[test]
fn the_draft_oracle_can_fail() {
    LOG.take();
    let world = World::open(0);
    world.apply(Command::Type('a'));
    world.settle();
    assert_eq!(exact(&world), None);
    world.current.record.publish(&Snapshot::default());
    assert!(exact(&world).is_some());
    take_calls();
}

#[test]
fn two_clients_keep_each_others_crash_entries() {
    LOG.take();
    let home = opencode_util::temp::tempdir().unwrap();
    let (one, two) = (builds(), builds());
    let (a, b) = (crash_of(&one, "model.a"), crash_of(&two, "model.b"));
    let first = after_in(one, a, home.path());
    let second = after_in(two, b, home.path());
    let ids = |world: &World| -> Vec<String> {
        let list = crash_list(world);
        list.as_array().unwrap().iter().map(|entry| entry["id"].as_str().unwrap().to_owned()).collect()
    };
    assert_eq!(ids(&second), ["model.a", "model.b"]);
    let action = first.opened.iter().find_map(|toast| toast.action.clone()).expect("Enable again");
    (action.run)();
    first.settle();
    assert_eq!(
        (ids(&first), second.status(B)),
        (
            vec!["model.b".to_owned()],
            Some(Status::Failed("crashed the client in `render-slot` and is disabled".to_owned()))
        )
    );
    take_calls();
}

#[cfg(target_os = "linux")]
#[test]
fn a_test_client_starts_no_watchdog() {
    LOG.take();
    let world = World::open(0);
    let names: Vec<String> = std::fs::read_dir("/proc/self/task")
        .unwrap()
        .filter_map(|task| std::fs::read_to_string(task.ok()?.path().join("comm")).ok())
        .collect();
    assert!(
        names.iter().all(|name| !name.starts_with("plugin-watchdog") && !name.starts_with("plugin-notice")),
        "{names:?}"
    );
    drop(world);
    take_calls();
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum At {
    SlotView,
    RouteView,
    Command,
}

thread_local! {
    static SURFACE_FAULT: Cell<Option<(At, Fault)>> = const { Cell::new(None) };
    /// What the record named and whether a panic would unwind to the host's catch, in each call of the plugin.
    static SURFACE_SEEN: RefCell<Vec<(At, Option<String>, bool)>> = const { RefCell::new(Vec::new()) };
    /// The generation of the route view's last mount.
    static SURFACE_MOUNT: Cell<u64> = const { Cell::new(0) };
    static SURFACE_CLOCK: Cell<Duration> = const { Cell::new(Duration::ZERO) };
    static SURFACE_RECORD: RefCell<Option<Arc<Record>>> = const { RefCell::new(None) };
}

fn surface_call(at: At) {
    let named = SURFACE_RECORD.with_borrow(|record| {
        let running = record.as_ref()?.running()?;
        record::KINDS.get(usize::from(running.kind)).map(|kind| (*kind).to_owned())
    });
    SURFACE_SEEN.with_borrow_mut(|seen| seen.push((at, named, opencode_plugin::contain::catching())));
    match SURFACE_FAULT.get().filter(|(armed, _)| *armed == at) {
        Some((_, Fault::Panic)) => {
            SURFACE_FAULT.set(None);
            panic!("2.0 fault at {at:?}");
        }
        Some((_, Fault::Overrun)) => {
            SURFACE_FAULT.set(None);
            SURFACE_CLOCK.set(SURFACE_CLOCK.get() + Duration::from_millis(150));
        }
        None => {}
    }
}

fn surfaces(setup: &mut abi::Setup) -> Result<(), String> {
    use abi::v2;
    let command = abi::Command::new("s2.go").title("go").scope(abi::Scope::Route("page".into()));
    setup.command(command, |_, _| surface_call(At::Command));
    setup.surface(v2::Surface::new("footer", v2::Place::Slot(abi::Placement::append("home.footer")), |cx| {
        surface_call(At::SlotView);
        let handle = cx.content("slot body");
        v2::Node::column(vec![v2::Node::Markdown { id: None, source: v2::Source::Content(handle) }])
    }));
    setup.surface(v2::Surface::new("page", v2::Place::Route("page".into()), |cx| {
        SURFACE_MOUNT.set(cx.mount.generation);
        surface_call(At::RouteView);
        v2::Node::text(vec![abi::Span::new("page body")])
    }));
    Ok(())
}

#[test]
fn a_2_0_surface_is_contained() {
    let root = opencode_util::temp::tempdir().unwrap();
    let record = Arc::new(Record::create(root.path()).unwrap());
    SURFACE_RECORD.set(Some(record.clone()));
    SURFACE_SEEN.take();
    SURFACE_FAULT.set(None);
    let deps = Deps {
        route: Route::Home,
        builtins: vec![abi::Plugin { id: "test.surfaces", setup: surfaces }.into()],
        ..support::deps(Arc::new(support::empty()))
    };
    let contain = Contain { record: Some(record), ..Contain::default() };
    let harness = support::mount_on(TestApp::new(100, 30), deps, Args { contain, ..Args::default() });
    let (app, tui) = (&harness.app, &harness.tui);
    let base = Instant::now();
    tui.plugins.monitor().set_clock(move || base + SURFACE_CLOCK.get());
    let overruns = tui.plugins.monitor().host_overruns();
    let settle = || {
        app.advance(Duration::from_millis(1));
        app.render();
        app.advance(Duration::from_millis(1));
    };
    let page = || Route::Plugin { id: "test.surfaces".to_owned(), name: "page".to_owned() };
    let status = || tui.plugins.entries().into_iter().find(|entry| entry.id == "test.surfaces").unwrap().status;
    let screen = || app.render().text();
    settle();
    assert!(screen().contains("slot body"), "{}", screen());

    tui.navigate(page());
    settle();
    SURFACE_FAULT.set(Some((At::Command, Fault::Overrun)));
    let _ = tui.keymap.dispatch("s2.go", None);
    SURFACE_FAULT.set(Some((At::RouteView, Fault::Overrun)));
    tui.navigate(page());
    settle();
    assert_eq!((tui.plugins.monitor().host_overruns() - overruns, status()), (2, opencode_plugin::Status::Active));
    assert!(screen().contains("page body"));
    let seen = SURFACE_SEEN.take();
    for at in [At::SlotView, At::RouteView, At::Command] {
        let kind = if at == At::Command { "run-command" } else { "view" };
        assert!(seen.contains(&(at, Some(kind.to_owned()), true)), "{at:?}: {seen:?}");
    }
    assert!(seen.iter().all(|(_, named, caught)| named.is_some() && *caught), "{seen:?}");

    let before = SURFACE_MOUNT.get();
    SURFACE_FAULT.set(Some((At::Command, Fault::Panic)));
    let _ = tui.keymap.dispatch("s2.go", None);
    settle();
    assert!(matches!(status(), opencode_plugin::Status::Failed(error) if error.contains("run-command panicked")));
    assert!(!screen().contains("page body"), "{}", screen());
    tui.navigate(Route::Home);
    settle();
    assert_eq!(opencode_plugin::surface::ledger_of("test.surfaces"), opencode_plugin::surface::Ledger::default());

    // Enabled again: a new activation, whose route mounts under a new generation; then a panic in its slot view.
    assert_eq!(tui.plugins.toggle(&host(tui), "test.surfaces", true), Some(Ok(())));
    settle();
    tui.navigate(page());
    settle();
    assert!(SURFACE_MOUNT.get() > before, "{} after {before}", SURFACE_MOUNT.get());
    tui.navigate(Route::Home);
    SURFACE_FAULT.set(Some((At::SlotView, Fault::Panic)));
    settle();
    assert!(matches!(status(), opencode_plugin::Status::Failed(error) if error.contains("view panicked")));
    assert!(!screen().contains("slot body"));
    assert_eq!(opencode_plugin::surface::ledger_of("test.surfaces").content, 0);
    assert_eq!(tui.plugins.monitor().record().unwrap().crash(), Crash::default(), "the record names nobody after");
    SURFACE_RECORD.set(None);
}
