//! Check mailbox fairness and per-frame work under repeated wakes on both native carriers.

use crate::plugin_surface::{CARRIERS, Carrier, builtin};
use crate::support::model::{self, Failure, Model, Rng};
use crate::support::{self, Harness};

use std::cell::{Cell, RefCell};
use std::sync::Arc;
use std::time::{Duration, Instant};

use opencode_plugin::abi::{self, v2};
use opencode_tui::{Deps, Route};

const PLUGINS: [&str; 2] = ["test.flood.a", "test.flood.b"];
const COST: Duration = Duration::from_micros(300);
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
    static WAKER_B: RefCell<Option<abi::Waker>> = const { RefCell::new(None) };
    static DRAW_COST: Cell<Duration> = const { Cell::new(Duration::ZERO) };
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
    let key = abi::Command::new("flood.key").keybind("k").scope(abi::Scope::Route("flood".into()));
    setup.command(key, |_, _| {
        log(Event::Key);
        CLOCK.with(|clock| clock.set(clock.get() + KEY_COST));
    });
    // A key on every route, for the rows that time a key beside a canvas; the model never presses it.
    let anywhere = abi::Command::new("flood.anywhere").keybind("j");
    setup.command(anywhere, |_, _| CLOCK.with(|clock| clock.set(clock.get() + KEY_COST)));
    setup.surface(v2::Surface::new("flood", v2::Place::Route("flood".into()), |_| {
        v2::Node::text(vec![abi::Span::new("flood")])
    }));
    // A canvas that draws once a frame, at [`DRAW_COST`].
    let canvas = |_: &mut v2::View<'_>| {
        let size = Some(abi::Width::Cells(4));
        v2::Node::canvas("c").animate(true).layout(abi::Layout { width: size, height: size, ..abi::Layout::default() })
    };
    setup.surface(v2::Surface::new("drawn", v2::Place::Route("drawn".into()), canvas).draw(|_| {
        CLOCK.with(|clock| clock.set(clock.get() + DRAW_COST.with(Cell::get)));
        Some(abi::canvas::List::new())
    }));
    Ok(())
}

fn setup_b(setup: &mut abi::Setup) -> Result<(), String> {
    let sender = setup.messages(update(1))?;
    SENDERS.with(|senders| senders.borrow_mut()[1] = Some(sender));
    WAKER_B.with(|waker| *waker.borrow_mut() = setup.waker());
    setup.on_wake(|host| host.toast(abi::Toast::new(abi::Variant::Info, "b woke")));
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
    Send(usize, u32),
    /// The user presses the key of `a`'s route, read by the poll that also hands the wakes waiting: the wake first.
    Key,
    /// A poll hands the wakes waiting, with no input.
    Poll,
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
        let mut waiting: [std::collections::VecDeque<u32>; 2] = Default::default();
        // Each plugin numbers its own messages, so a twin without another plugin's sends numbers them alike.
        let mut numbers = [0u32; 2];
        let mut frames_of_b = vec![Vec::new()];
        let mut seen = 0;
        let mut drains = opencode_plugin::schedule::work().drains;
        let fail = |property: &'static str, step: usize, detail: String| Run {
            frames_of_b: Vec::new(),
            failure: Some(Failure { property, site: property, step, detail }),
        };
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
                Command::Key => {
                    harness.app.app().dispatch(opentui::prelude::Event::Wake);
                    harness.app.press("k");
                }
                Command::Poll => harness.app.event(opentui::prelude::Event::Wake),
                Command::Frame => {
                    harness.app.render();
                    log(Event::Frame);
                }
            }
            // A drain runs only as a paint starts, once a frame.
            let ran = opencode_plugin::schedule::work().drains - drains;
            drains += ran;
            if ran > u64::from(command == Command::Frame) {
                return fail("backlog", step, format!("{command:?} ran {ran} drains"));
            }
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
                        // Admission uses the budget at call start.
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
                55..65 => Command::Poll,
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

#[test]
fn a_flood_drains_in_turn_under_the_frame_budget() {
    for carrier in CARRIERS {
        model::check(&Flood { carrier, all: Duration::from_millis(4) }, 24, 32);
        model::check(&Flood { carrier, all: Duration::from_micros(1500) }, 24, 32);
    }
}

#[test]
fn a_plugin_that_went_idle_keeps_its_spend_for_the_frame() {
    let commands = [Command::Send(0, 1), Command::Key, Command::Key, Command::Send(0, 1), Command::Frame];
    for carrier in CARRIERS {
        let failure = Flood { carrier, all: Duration::from_millis(4) }.run(&commands);
        assert_eq!(failure, None, "{carrier:?}");
    }
}

#[test]
fn a_key_read_with_a_wake_runs_before_the_update() {
    for carrier in CARRIERS {
        let failure = Flood { carrier, all: Duration::from_millis(4) }.run(&[Command::Send(0, 1), Command::Key]);
        assert_eq!(failure, None, "{carrier:?}");
    }
}

#[test]
fn wakes_before_a_paint_ask_for_one_drain() {
    let mut commands = vec![Command::Send(0, 40), Command::Frame];
    commands.extend((0..30).flat_map(|_| [Command::Send(0, 1), Command::Poll]));
    commands.push(Command::Frame);
    for carrier in CARRIERS {
        let failure = Flood { carrier, all: Duration::from_millis(4) }.run(&commands);
        assert_eq!(failure, None, "{carrier:?}");
    }
}

fn send(plugin: usize, count: u32) {
    let sender = SENDERS.with(|senders| senders.borrow()[plugin].clone()).unwrap();
    std::thread::spawn(move || (0..count).for_each(|number| drop(sender.send(number)))).join().unwrap();
}

#[test]
fn a_paint_does_not_cut_the_frame_open() {
    for carrier in CARRIERS {
        let harness = open(carrier, Duration::from_millis(4));
        harness.tui.navigate(Route::Plugin { id: PLUGINS[0].to_owned(), name: "drawn".to_owned() });
        harness.app.render();
        DRAW_COST.with(|cost| cost.set(Duration::from_micros(800)));
        for _ in 0..40 {
            send(0, 1);
            harness.app.advance(Duration::from_millis(16));
            harness.app.render();
        }
        DRAW_COST.with(|cost| cost.set(Duration::ZERO));
        let slow = harness.tui.plugins.monitor().is_slow(PLUGINS[0]);
        assert!(slow, "{carrier:?}: 1.1 ms a paint was not slow");
    }
}

#[test]
fn a_key_between_paints_is_in_the_next_paints_frame() {
    for carrier in CARRIERS {
        let harness = open(carrier, Duration::from_millis(4));
        harness.tui.navigate(Route::Plugin { id: PLUGINS[0].to_owned(), name: "drawn".to_owned() });
        harness.app.render();
        DRAW_COST.with(|cost| cost.set(Duration::from_micros(400)));
        for _ in 0..40 {
            send(0, 1);
            harness.app.app().dispatch(opentui::prelude::Event::Wake);
            harness.app.press("j");
            harness.app.advance(Duration::from_millis(16));
            harness.app.render();
        }
        DRAW_COST.with(|cost| cost.set(Duration::ZERO));
        assert!(harness.tui.plugins.monitor().is_slow(PLUGINS[0]), "{carrier:?}: 1.1 ms a frame was not slow");
    }
}

#[test]
fn a_paints_draws_leave_the_next_paints_updates_their_budget() {
    for carrier in CARRIERS {
        let harness = open(carrier, Duration::from_millis(4));
        harness.tui.navigate(Route::Plugin { id: PLUGINS[0].to_owned(), name: "drawn".to_owned() });
        harness.app.render();
        DRAW_COST.with(|cost| cost.set(Duration::from_micros(900)));
        send(0, 100);
        let mut per_paint = Vec::new();
        for _ in 0..6 {
            let before = LOG.with(|log| log.borrow().len());
            harness.app.render();
            per_paint.push(LOG.with(|log| log.borrow().len()) - before);
        }
        DRAW_COST.with(|cost| cost.set(Duration::ZERO));
        assert!(per_paint[1..].iter().all(|updates| *updates == 4), "{carrier:?}: updates a paint {per_paint:?}");
    }
}

#[test]
fn plugins_take_turns_to_go_first() {
    for carrier in CARRIERS {
        let harness = open(carrier, Duration::from_micros(1500));
        send(0, 100);
        send(1, 100);
        for _ in 0..10 {
            harness.app.render();
        }
        let updates = LOG.with(|log| {
            let log = log.borrow();
            [0, 1]
                .map(|plugin| log.iter().filter(|event| matches!(event, Event::Update(of, _) if *of == plugin)).count())
        });
        assert!(updates[0].abs_diff(updates[1]) <= 1, "{carrier:?}: updates {updates:?}");
    }
}

#[test]
fn sends_between_paints_wake_the_ui_thread_once() {
    for carrier in CARRIERS {
        let harness = open(carrier, Duration::from_millis(4));
        for round in 0..2 {
            let before = opencode_plugin::schedule::work().wakes;
            for _ in 0..25 {
                send(0, 1);
                harness.app.event(opentui::prelude::Event::Wake);
            }
            let wakes = opencode_plugin::schedule::work().wakes - before;
            assert_eq!(wakes, 1, "{carrier:?}, round {round}: wakes between two paints");
            harness.app.render();
        }
    }
}

#[test]
fn the_last_frame_over_the_budget_ends_without_a_call() {
    for carrier in CARRIERS {
        let harness = open(carrier, Duration::from_millis(4));
        for _ in 0..13 {
            for _ in 0..3 {
                harness.app.press("j");
            }
            harness.app.advance(Duration::from_millis(16));
            harness.app.render();
        }
        assert!(!harness.tui.plugins.monitor().is_slow(PLUGINS[0]), "{carrier:?}: slow before its 13th frame ended");
        for _ in 0..2 {
            harness.app.advance(Duration::from_millis(16));
            harness.app.render();
        }
        assert!(harness.tui.plugins.monitor().is_slow(PLUGINS[0]), "{carrier:?}: the 13th frame never ended");
    }
}

#[test]
fn a_wake_handlers_toast_shows_in_the_frame_that_ran_it() {
    for carrier in CARRIERS {
        let harness = open(carrier, Duration::from_millis(4));
        WAKER_B.with(|waker| waker.borrow().as_ref().unwrap().wake());
        harness.app.event(opentui::prelude::Event::Wake);
        let toast = || harness.tui.toasts.current().is_some_and(|toast| toast.message == "b woke");
        assert!(!toast(), "{carrier:?}: the wake ran before a paint");
        let frame = harness.app.render().text();
        assert!(frame.contains("b woke"), "{carrier:?}: no toast in the frame that ran the wake\n{frame}");
    }
}
