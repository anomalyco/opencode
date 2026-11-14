//! `backlog` under a flood (synthesis 4.2 "Wakes are scheduled", 4.14; phase Pl), in the real TUI, linked and through
//! the C ABI's byte shims.
//!
//! Two test plugins, `test.flood.a` and `test.flood.b`, each take messages from a thread and log each update; `a` also
//! has a key on its route, whose handler logs it. Every update costs [`COST`] and the key's handler [`KEY_COST`] on the
//! monitor's clock, which nothing else moves, so the frame budget is exact. The oracles are the plugins' own log, a list
//! of what each send was accepted, and the 4.2 rule written here over that log, frame by frame:
//!
//! - what got `Ok` arrives once, in its thread's order; nothing else arrives;
//! - a plugin with mail when a frame starts gets at least one update in it; each update after its first in the frame
//!   starts while its own calls in the frame (its handler's too) are under the per-plugin budget and all plugins'
//!   under the total;
//! - a plugin with mail left after a frame stopped for the budget: its own, or all plugins';
//! - a key's handler runs before the updates of its turn;
//! - while the total budget is not reached, everything `b` sees equals a twin run in which `a` sent nothing.

use crate::plugin_surface::{CARRIERS, Carrier, builtin};
use crate::support::model::{self, Failure, Model, Rng};
use crate::support::{self, Harness};

use std::cell::{Cell, RefCell};
use std::sync::Arc;
use std::time::{Duration, Instant};

use opencode_plugin::abi::{self, v2};
use opencode_tui::{Deps, Route};

const PLUGINS: [&str; 2] = ["test.flood.a", "test.flood.b"];
/// What one update costs on the monitor's clock: a plugin's millisecond takes four.
const COST: Duration = Duration::from_micros(300);
/// What the key's handler costs on the monitor's clock: it counts in its plugin's frame budget.
const KEY_COST: Duration = Duration::from_micros(400);
const FRAME: Duration = Duration::from_millis(1);

/// What the plugins logged, in order, and the frames the test painted.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Event {
    Update(usize, u32),
    Key,
    Frame,
}

thread_local! {
    static LOG: RefCell<Vec<Event>> = const { RefCell::new(Vec::new()) };
    /// The monitor's clock, past its start: only updates and the key's handler move it.
    static CLOCK: Cell<Duration> = const { Cell::new(Duration::ZERO) };
    static SENDERS: RefCell<[Option<abi::Sender<u32>>; 2]> = const { RefCell::new([None, None]) };
}

fn log(event: Event) {
    LOG.with(|log| log.borrow_mut().push(event));
}

fn update(plugin: usize) -> impl Fn(&dyn abi::Host, u32) {
    move |_, number| {
        log(Event::Update(plugin, number));
        CLOCK.with(|clock| clock.set(clock.get() + COST));
    }
}

fn setup_a(setup: &mut abi::Setup) -> Result<(), String> {
    let sender = setup.messages(update(0))?;
    SENDERS.with(|senders| senders.borrow_mut()[0] = Some(sender));
    let key = abi::Command {
        name: "flood.key".into(),
        keybind: Some("k".into()),
        scope: abi::Scope::Route("flood".into()),
        ..abi::Command::default()
    };
    setup.command(key, |_, _| {
        log(Event::Key);
        CLOCK.with(|clock| clock.set(clock.get() + KEY_COST));
    });
    setup.surface(v2::Surface::new("flood", v2::Place::Route("flood".into()), |_| {
        v2::Node::text(vec![abi::Span::new("flood")])
    }));
    Ok(())
}

fn setup_b(setup: &mut abi::Setup) -> Result<(), String> {
    let sender = setup.messages(update(1))?;
    SENDERS.with(|senders| senders.borrow_mut()[1] = Some(sender));
    Ok(())
}

fn open(carrier: Carrier, all: Duration) -> Harness {
    LOG.with(|log| log.borrow_mut().clear());
    CLOCK.with(|clock| clock.set(Duration::ZERO));
    let deps = Deps {
        route: Route::Home,
        builtins: vec![
            builtin(carrier, abi::Plugin { id: PLUGINS[0], setup: setup_a }),
            builtin(carrier, abi::Plugin { id: PLUGINS[1], setup: setup_b }),
        ],
        ..support::deps(Arc::new(support::empty()))
    };
    let harness = support::mount(60, 20, deps);
    let monitor = harness.tui.plugins.monitor().clone();
    let start = Instant::now();
    monitor.set_clock(move || start + CLOCK.with(Cell::get));
    monitor.set_limits(opencode_plugin::contain::Limits { frame: FRAME, all, ..monitor.limits() });
    harness.tui.navigate(Route::Plugin { id: PLUGINS[0].to_owned(), name: "flood".to_owned() });
    harness.app.advance(Duration::from_millis(1));
    harness.app.render();
    LOG.with(|log| log.borrow_mut().clear());
    harness
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Command {
    /// Plugin `0`'s thread sends `1` numbered messages, and is joined.
    Send(usize, u32),
    /// The user presses the key of `a`'s route.
    Key,
    /// The UI thread paints a frame.
    Frame,
}

/// What a run saw: for each frame, `b`'s updates; and the first check that failed.
struct Run {
    frames_of_b: Vec<Vec<u32>>,
    failure: Option<Failure>,
}

struct Flood {
    carrier: Carrier,
    /// The total budget: under it two plugins never reach it, at it they do.
    all: Duration,
}

impl Flood {
    fn run_all(&self, commands: &[Command]) -> Run {
        let harness = open(self.carrier, self.all);
        // What each plugin's sends were accepted and has not arrived yet.
        let mut waiting: [std::collections::VecDeque<u32>; 2] = Default::default();
        // Each plugin numbers its own messages, so a twin without another plugin's sends numbers them alike.
        let mut numbers = [0u32; 2];
        let mut frames_of_b = vec![Vec::new()];
        let mut seen = 0;
        let fail = |property: &'static str, step: usize, detail: String| Run {
            frames_of_b: Vec::new(),
            failure: Some(Failure { property, site: property, step, detail }),
        };
        // What each plugin's calls took in the frame now open, and its updates in it.
        let (mut spent, mut updates) = ([Duration::ZERO; 2], [0usize; 2]);
        // After the commands, frames until the scheduler has handed everything over: the first takes the wakes still
        // waiting for the UI thread.
        let mut more = 0;
        let drained = std::iter::from_fn(|| {
            more += 1;
            (more == 1 || more < 10_000 && opencode_plugin::schedule::busy(&harness.app)).then_some(Command::Frame)
        });
        for (step, command) in commands.iter().copied().chain(drained).enumerate() {
            match command {
                Command::Send(plugin, count) => {
                    let Some(sender) = SENDERS.with(|senders| senders.borrow()[plugin].clone()) else { continue };
                    let sent: Vec<u32> = (0..count).map(|offset| numbers[plugin] + offset).collect();
                    numbers[plugin] += count;
                    let accepted: Vec<u32> = std::thread::spawn(move || {
                        sent.into_iter().filter(|number| sender.send(*number).is_ok()).collect()
                    })
                    .join()
                    .unwrap();
                    waiting[plugin].extend(accepted);
                }
                Command::Key => harness.app.press("k"),
                Command::Frame => {
                    harness.app.render();
                    log(Event::Frame);
                }
            }
            // Check what the step logged.
            let events: Vec<Event> = LOG.with(|log| log.borrow()[seen..].to_vec());
            seen += events.len();
            if command == Command::Key && events.first() != Some(&Event::Key) {
                return fail("backlog", step, format!("the key's turn logged {events:?}: an update before its input"));
            }
            for event in events {
                match event {
                    Event::Update(plugin, number) => {
                        if waiting[plugin].pop_front() != Some(number) {
                            let detail =
                                format!("plugin {plugin} got {number}, expected {:?}", waiting[plugin].front());
                            return fail("backlog", step, detail);
                        }
                        // The update was allowed when it started: the plugin's first in the frame, or with its own
                        // and all plugins' calls in the frame under their budgets.
                        let (own, all) = (spent[plugin], spent[0] + spent[1]);
                        if updates[plugin] > 0 && (own >= FRAME || all >= self.all) {
                            let detail = format!(
                                "plugin {plugin}'s update {number} started at {own:?} of its own, {all:?} of all"
                            );
                            return fail("budget", step, detail);
                        }
                        spent[plugin] += COST;
                        updates[plugin] += 1;
                        if plugin == 1 {
                            frames_of_b.last_mut().unwrap().push(number);
                        }
                    }
                    Event::Frame => {
                        for plugin in 0..2 {
                            let (own, all) = (spent[plugin], spent[0] + spent[1]);
                            // Every send woke the UI thread before this frame's paint, which drained it.
                            if !waiting[plugin].is_empty() && updates[plugin] == 0 {
                                return fail("budget", step, format!("plugin {plugin} had mail and got no update"));
                            }
                            if !waiting[plugin].is_empty() && own < FRAME && all < self.all {
                                let detail = format!(
                                    "plugin {plugin} kept {} messages under the budget ({own:?} of its own, {all:?} of all)",
                                    waiting[plugin].len()
                                );
                                return fail("budget", step, detail);
                            }
                        }
                        (spent, updates) = ([Duration::ZERO; 2], [0; 2]);
                        frames_of_b.push(Vec::new());
                    }
                    Event::Key if command == Command::Key => spent[0] += KEY_COST,
                    Event::Key => return fail("backlog", step, "a key outside its own turn".to_owned()),
                }
            }
            for plugin in PLUGINS {
                let stats = opencode_plugin::mailbox::stats(plugin).unwrap_or_default();
                if stats.high > abi::BOUND {
                    return fail("backlog", step, format!("{plugin}'s mailbox held {} entries", stats.high));
                }
            }
        }
        if let Some(plugin) = (0..2).find(|plugin| !waiting[*plugin].is_empty()) {
            let detail = format!("plugin {plugin} never got {:?}", waiting[plugin]);
            return fail("backlog", commands.len(), detail);
        }
        Run { frames_of_b, failure: None }
    }
}

impl Model for Flood {
    type Command = Command;

    fn generate(&self, rng: &mut Rng, steps: usize) -> Vec<Command> {
        (0..steps)
            .map(|_| match rng.below(100) {
                0..40 => Command::Send(rng.below(2), *rng.pick(&[1, 3, 10, 40, 300])),
                40..55 => Command::Key,
                _ => Command::Frame,
            })
            .collect()
    }

    fn run(&self, commands: &[Command]) -> Option<Failure> {
        let run = self.run_all(commands);
        if run.failure.is_some() {
            return run.failure;
        }
        // Under the total budget, `a`'s flood changes nothing `b` sees: a twin without `a`'s sends.
        if self.all > 2 * (FRAME + COST) + KEY_COST {
            let quiet: Vec<Command> =
                commands.iter().filter(|command| !matches!(command, Command::Send(0, _))).copied().collect();
            let twin = self.run_all(&quiet);
            if twin.failure.is_some() {
                return twin.failure;
            }
            // The frames `a` alone needed to drain come after everything `b` saw.
            let trimmed = |frames: &[Vec<u32>]| {
                let end = frames.iter().rposition(|frame| !frame.is_empty()).map_or(0, |last| last + 1);
                frames[..end].to_vec()
            };
            if trimmed(&twin.frames_of_b) != trimmed(&run.frames_of_b) {
                let detail = format!("b's frames {:?}\nwithout a's sends {:?}", run.frames_of_b, twin.frames_of_b);
                return Some(Failure { property: "isolation", site: "isolation", step: commands.len(), detail });
            }
        }
        None
    }

    fn simplify(&self, command: &Command) -> Vec<Command> {
        match *command {
            Command::Send(plugin, count) if count > 1 => vec![Command::Send(plugin, count / 2)],
            _ => Vec::new(),
        }
    }
}

// Expected (`backlog` under a flood, 4.2): sends never block and what got `Ok` arrives once and in order; each frame
// hands every plugin with mail at least one update and more only under its own and the total budget, and leaves mail
// waiting only once a budget is spent; a key is handled before the updates of its turn; and while the total is not
// reached, a plugin's flood changes nothing another plugin sees. On both carriers, with the total out of reach and
// at a total two plugins reach.
#[test]
fn a_flood_drains_in_turn_under_the_frame_budget() {
    for carrier in CARRIERS {
        model::check(&Flood { carrier, all: Duration::from_millis(4) }, 24, 32);
        model::check(&Flood { carrier, all: Duration::from_micros(1500) }, 24, 32);
    }
}
