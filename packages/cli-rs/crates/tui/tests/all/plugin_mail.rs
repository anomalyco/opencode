//! A plugin's threads and its mailbox (P4, synthesis 4.2 "When a queue is full", 4.14 `backlog`), in the real TUI,
//! linked and through the C ABI's byte shims.
//!
//! The test plugin `test.mail` registers a message handler that writes what arrives to its own log, and keeps its
//! sender where the test reaches it. The model's threads send from outside the UI thread, each joined before the
//! next command, so a `send` that blocks is a test that never ends; each writes what every send returned. The oracle
//! is those two logs and a reference written here, a list with the mailbox's rules: an entry per ordered message and
//! one per key, at most [`abi::BOUND`], nothing once the plugin left `active`. It shares no code with the host.
//!
//! What it checks after every command: each send returned what the reference allows (`Full` only when the reference
//! holds the bound and no entry of its key, `Closed` only after the plugin left); at a frame, exactly the messages the
//! reference holds arrive, once, in its order, with the last value under each key; and the host's high-water count
//! never passes the bound.

use crate::plugin_surface::{CARRIERS, Carrier, builtin};
use crate::support::model::{self, Failure, Model, Rng};
use crate::support::{self, Harness};

use std::cell::RefCell;
use std::sync::Arc;
use std::time::Duration;

use opencode_plugin::abi::{self, SendError};
use opencode_tui::plugins::host::host;
use opencode_tui::{Deps, Route};

const ID: &str = "test.mail";

/// A message: who sent it (a thread, or a key from [`KEYED`] on) and its number.
type Note = (u32, u32);
const KEYED: u32 = 1000;

#[derive(Default)]
struct Mail {
    sender: Option<abi::Sender<Note>>,
    spawner: Option<abi::Spawner>,
    arrived: Vec<Note>,
}

thread_local! {
    static MAIL: RefCell<Mail> = RefCell::default();
}

fn mail<T>(f: impl FnOnce(&mut Mail) -> T) -> T {
    MAIL.with(|mail| f(&mut mail.borrow_mut()))
}

fn setup(setup: &mut abi::Setup) -> Result<(), String> {
    let sender = setup.messages(|_, note: Note| mail(|mail| mail.arrived.push(note)));
    let spawner = setup.spawner();
    mail(|mail| (mail.sender, mail.spawner) = (Some(sender), Some(spawner)));
    Ok(())
}

fn open(carrier: Carrier) -> Harness {
    mail(|mail| *mail = Mail::default());
    let deps = Deps {
        route: Route::Home,
        builtins: vec![builtin(carrier, abi::Plugin { id: ID, setup })],
        ..support::deps(Arc::new(support::empty()))
    };
    let harness = support::mount(60, 20, deps);
    frame(&harness);
    harness
}

fn frame(harness: &Harness) {
    harness.app.advance(Duration::from_millis(1));
    harness.app.advance(Duration::from_millis(1));
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Command {
    /// A thread sends `count` numbered messages, and is joined.
    Send(u32),
    /// A thread replaces under key `key` `count` times, and is joined.
    Replace(u32, u32),
    /// The UI thread runs: what waits is delivered.
    Frame,
    /// The plugin manager's toggle.
    Toggle,
}

/// What one send returned.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Sent {
    Ok,
    Full,
    Closed,
}

/// Runs `sends` on a thread of its own with the plugin's sender, and joins it.
fn on_thread(sends: Vec<(Option<u32>, Note)>) -> Vec<Sent> {
    let Some(sender) = mail(|mail| mail.sender.clone()) else { return vec![Sent::Closed; sends.len()] };
    std::thread::spawn(move || {
        sends
            .into_iter()
            .map(|(key, note)| {
                let sent = match key {
                    Some(key) => sender.replace(&key.to_string(), note),
                    None => sender.send(note),
                };
                match sent {
                    Ok(()) => Sent::Ok,
                    Err(SendError::Full(back)) => {
                        assert_eq!(back, note, "Full gave back another message");
                        Sent::Full
                    }
                    Err(SendError::Closed(back)) => {
                        assert_eq!(back, note, "Closed gave back another message");
                        Sent::Closed
                    }
                }
            })
            .collect()
    })
    .join()
    .unwrap()
}

/// The reference: what the mailbox holds, by the rule of 4.2, written apart from the host's.
#[derive(Default)]
struct Reference {
    entries: Vec<(Option<u32>, Note)>,
    closed: bool,
}

impl Reference {
    /// What a send may return, and what it does when it is `Ok`.
    fn send(&mut self, key: Option<u32>, note: Note, sent: Sent) -> Result<(), String> {
        let expected = if self.closed {
            Sent::Closed
        } else if key.is_some_and(|key| self.entries.iter().any(|(known, _)| *known == Some(key))) {
            Sent::Ok
        } else if self.entries.len() >= abi::BOUND {
            Sent::Full
        } else {
            Sent::Ok
        };
        if sent != expected {
            return Err(format!("{note:?} under {key:?} returned {sent:?}, expected {expected:?}"));
        }
        if sent == Sent::Ok {
            match key.and_then(|key| self.entries.iter_mut().find(|(known, _)| *known == Some(key))) {
                Some(entry) => entry.1 = note,
                None => self.entries.push((key, note)),
            }
        }
        Ok(())
    }
}

struct Backlog(Carrier);

impl Model for Backlog {
    type Command = Command;

    fn generate(&self, rng: &mut Rng, steps: usize) -> Vec<Command> {
        (0..steps)
            .map(|_| match rng.below(100) {
                0..35 => Command::Send(*rng.pick(&[1, 3, 40, 120, 300])),
                35..60 => Command::Replace(rng.below(4) as u32, *rng.pick(&[1, 2, 30])),
                60..92 => Command::Frame,
                _ => Command::Toggle,
            })
            .collect()
    }

    fn run(&self, commands: &[Command]) -> Option<Failure> {
        let harness = open(self.0);
        let mut reference = Reference::default();
        let mut active = true;
        let mut numbers = 0;
        for (step, command) in commands.iter().enumerate() {
            let fail = |property, detail: String| Some(Failure { property, site: property, step, detail });
            match *command {
                Command::Send(count) | Command::Replace(_, count) => {
                    let key = match *command {
                        Command::Replace(key, _) => Some(key),
                        _ => None,
                    };
                    let from = key.map_or(step as u32, |key| KEYED + key);
                    let sends: Vec<(Option<u32>, Note)> = (0..count)
                        .map(|_| {
                            numbers += 1;
                            (key, (from, numbers))
                        })
                        .collect();
                    let results = on_thread(sends.clone());
                    for ((key, note), sent) in sends.into_iter().zip(results) {
                        if let Err(detail) = reference.send(key, note, sent) {
                            return fail("backlog", detail);
                        }
                    }
                }
                Command::Frame => {
                    frame(&harness);
                    let arrived = mail(|mail| std::mem::take(&mut mail.arrived));
                    let expected: Vec<Note> = reference.entries.drain(..).map(|(_, note)| note).collect();
                    if arrived != expected {
                        return fail("backlog", format!("arrived {arrived:?}\nexpected {expected:?}"));
                    }
                }
                Command::Toggle => {
                    let tui = &harness.tui;
                    tui.plugins.toggle(&host(tui), ID, !active);
                    active = !active;
                    // Leaving `active` drops what waited; a new activation has a new, empty mailbox.
                    reference = Reference { entries: Vec::new(), closed: !active };
                    frame(&harness);
                    let arrived = mail(|mail| std::mem::take(&mut mail.arrived));
                    if !arrived.is_empty() {
                        return fail("backlog", format!("{arrived:?} arrived across a toggle"));
                    }
                }
            }
            let stats = opencode_plugin::mailbox::stats(ID).unwrap_or_default();
            if stats.high > abi::BOUND {
                return fail("backlog", format!("the mailbox held {} entries", stats.high));
            }
        }
        None
    }

    fn simplify(&self, command: &Command) -> Vec<Command> {
        match *command {
            Command::Send(count) if count > 1 => vec![Command::Send(count / 2)],
            Command::Replace(key, count) if count > 1 => vec![Command::Replace(key, count / 2)],
            _ => Vec::new(),
        }
    }
}

// Expected (`backlog`): sends return at once while the UI thread stands still; what got `Ok` arrives once, in order,
// with the last value under a key and nothing older after it; nothing that got `Full` or `Closed` arrives; and the
// mailbox never holds more than its bound. On both carriers.
#[test]
fn a_mailbox_refuses_and_never_blocks() {
    for carrier in CARRIERS {
        model::check(&Backlog(carrier), 48, 32);
    }
}

// Expected (`backlog`, fixed rows with real concurrency): 8 threads send 10,000 messages each at once; every send
// returns, each thread's `Ok` messages arrive once and in its order, no refused one arrives, and the bound holds.
// 10,000 replaces under one key from one thread leave one entry, whose last value arrives last.
#[test]
fn a_flood_from_many_threads_keeps_its_order_and_bound() {
    for carrier in CARRIERS {
        let harness = open(carrier);
        let sender = mail(|mail| mail.sender.clone()).unwrap();
        let threads: Vec<_> = (0..8u32)
            .map(|from| {
                let sender = sender.clone();
                std::thread::spawn(move || {
                    (0..10_000u32).filter(|number| sender.send((from, *number)).is_ok()).collect::<Vec<u32>>()
                })
            })
            .collect();
        let accepted: Vec<Vec<u32>> = threads.into_iter().map(|thread| thread.join().unwrap()).collect();
        frame(&harness);
        let arrived = mail(|mail| std::mem::take(&mut mail.arrived));
        for (from, accepted) in accepted.iter().enumerate() {
            let own: Vec<u32> = arrived.iter().filter(|(sender, _)| *sender == from as u32).map(|(_, n)| *n).collect();
            assert_eq!(&own, accepted, "{carrier:?}: thread {from}");
        }
        assert_eq!(arrived.len(), abi::BOUND, "{carrier:?}: the first bound of sends fit, no more");
        let stats = opencode_plugin::mailbox::stats(ID).unwrap();
        assert_eq!((stats.high, stats.refused), (abi::BOUND, 80_000 - abi::BOUND as u64), "{carrier:?}");

        let replacer = std::thread::spawn(move || {
            (0..10_000u32).all(|number| sender.replace("progress", (KEYED, number)).is_ok())
        });
        assert!(replacer.join().unwrap(), "{carrier:?}: a replace was refused");
        frame(&harness);
        assert_eq!(mail(|mail| std::mem::take(&mut mail.arrived)), [(KEYED, 9_999)], "{carrier:?}");
    }
}

// Expected (`backlog`, `Closed`): once the plugin is disabled every send is `Closed` with its message back, what
// waited never arrives, and a sender of the next activation works.
#[test]
fn a_disabled_plugin_closes_its_mailbox() {
    for carrier in CARRIERS {
        let harness = open(carrier);
        let old = mail(|mail| mail.sender.clone()).unwrap();
        assert_eq!(old.send((1, 1)), Ok(()));
        let tui = &harness.tui;
        tui.plugins.toggle(&host(tui), ID, false);
        assert_eq!(old.send((1, 2)), Err(SendError::Closed((1, 2))));
        frame(&harness);
        assert!(mail(|mail| mail.arrived.is_empty()), "{carrier:?}");
        tui.plugins.toggle(&host(tui), ID, true);
        assert_eq!(old.send((1, 3)), Err(SendError::Closed((1, 3))), "{carrier:?}: an old sender reopened");
        let new = mail(|mail| mail.sender.clone()).unwrap();
        assert_eq!(new.send((2, 1)), Ok(()));
        frame(&harness);
        assert_eq!(mail(|mail| std::mem::take(&mut mail.arrived)), [(2, 1)], "{carrier:?}");
    }
}

// Expected (`backlog`, `Closed`, and 4.2's stop flag): a thread the spawner started sees its stop flag only once the
// plugin is disabled, and then ends; after a panic on another thread failed the plugin, every send is `Closed`.
#[test]
fn a_stop_flag_ends_a_thread_and_a_failure_closes_the_mailbox() {
    for carrier in CARRIERS {
        let harness = open(carrier);
        let tui = &harness.tui;
        let spawner = mail(|mail| mail.spawner.clone()).unwrap();
        let (ended, done) = std::sync::mpsc::channel();
        let waits = move |stop: abi::Stop| {
            while !stop.stopped() {
                std::thread::sleep(Duration::from_millis(1));
            }
            ended.send(()).unwrap();
        };
        spawner.spawn("waits", waits).unwrap();
        frame(&harness);
        assert!(done.recv_timeout(Duration::from_millis(50)).is_err(), "{carrier:?}: it ended while active");
        tui.plugins.toggle(&host(tui), ID, false);
        assert!(done.recv_timeout(Duration::from_secs(10)).is_ok(), "{carrier:?}: it never saw the flag");
        tui.plugins.toggle(&host(tui), ID, true);
        let spawner = mail(|mail| mail.spawner.clone()).unwrap();
        spawner.spawn("boom", |_| panic!("a mail thread panicked")).unwrap();
        harness.wait("the panic failed the plugin", || {
            harness.app.advance(Duration::from_millis(1));
            tui.plugins.entries().iter().any(|entry| entry.id == ID && entry.status != opencode_plugin::Status::Active)
        });
        let status = tui.plugins.entries().into_iter().find(|entry| entry.id == ID).unwrap().status;
        let expected = "thread boom panicked: a mail thread panicked".to_owned();
        assert_eq!(status, opencode_plugin::Status::Failed(expected), "{carrier:?}");
        let sender = mail(|mail| mail.sender.clone()).unwrap();
        assert_eq!(sender.send((3, 1)), Err(SendError::Closed((3, 1))), "{carrier:?}");
    }
}
