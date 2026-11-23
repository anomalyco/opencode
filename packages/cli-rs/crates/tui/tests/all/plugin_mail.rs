//! Drive plugin worker threads and mailbox delivery through the TUI.

use crate::support::model::{self, Failure, Model, Rng};
use crate::support::{self, Harness};

use std::cell::RefCell;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use opencode_plugin::abi::{self, SendError};
use opencode_tui::plugins::host::host;
use opencode_tui::{Deps, Route};
use opentui::app::ProxyError;

const ID: &str = "test.mail";

type Note = (u32, u32);
const KEYED: u32 = 1000;
const FAILS: Note = (u32::MAX, 0);

#[derive(Default)]
struct Mail {
    sender: Option<abi::Sender<Note>>,
    spawner: Option<abi::Spawner>,
    waker: Option<abi::Waker>,
    arrived: Vec<Note>,
    refill: u32,
    woken: Vec<usize>,
}

thread_local! {
    static MAIL: RefCell<Mail> = RefCell::default();
}

fn mail<T>(f: impl FnOnce(&mut Mail) -> T) -> T {
    MAIL.with(|mail| f(&mut mail.borrow_mut()))
}

fn setup(setup: &mut abi::Setup) -> Result<(), String> {
    let sender = setup.messages(|_, note: Note| {
        assert!(note != FAILS, "a failing update");
        let refill = mail(|mail| {
            mail.arrived.push(note);
            let refill = mail.refill > 0;
            mail.refill -= u32::from(refill);
            refill.then(|| mail.sender.clone()).flatten()
        });
        if let Some(sender) = refill {
            let _ = sender.send((note.0, note.1 + 1));
        }
    })?;
    let spawner = setup.spawner();
    let waker = setup.waker();
    setup.on_wake(|_| mail(|mail| mail.woken.push(mail.arrived.len())));
    mail(|mail| (mail.sender, mail.spawner, mail.waker) = (Some(sender), Some(spawner), waker));
    Ok(())
}

fn open() -> Harness {
    mail(|mail| *mail = Mail::default());
    let deps = Deps {
        route: Route::Home,
        builtins: vec![abi::Plugin { id: ID, setup }.into()],
        ..support::deps(Arc::new(support::empty()))
    };
    let harness = support::mount(60, 20, deps);
    frame(&harness);
    harness
}

/// Advance frames until all work drains, including updates beyond a single frame's budget.
fn frame(harness: &Harness) {
    harness.app.advance(Duration::from_millis(1));
    harness.app.advance(Duration::from_millis(1));
    drain(harness);
}

/// Paints frames until no plugin has updates waiting for one.
pub(crate) fn drain(harness: &Harness) {
    for _ in 0..10_000 {
        if !opencode_plugin::schedule::busy(&harness.app) {
            return;
        }
        harness.app.render();
        harness.app.advance(Duration::from_millis(1));
    }
    panic!("the scheduler never drained");
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Command {
    Send(u32),
    Replace(u32, u32),
    /// The UI thread runs: what waits is delivered.
    Frame,
    Toggle,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Sent {
    Ok,
    Full,
    Closed,
}

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
                    Err(SendError::Unencodable(back)) => panic!("{back:?} did not encode"),
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

struct Backlog;

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
        let harness = open();
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

#[test]
fn a_mailbox_refuses_and_never_blocks() {
    model::check(&Backlog, 48, 32);
}

#[test]
fn a_flood_from_many_threads_keeps_its_order_and_bound() {
    let harness = open();
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
        assert_eq!(&own, accepted, "thread {from}");
    }
    assert_eq!(arrived.len(), abi::BOUND, "the first bound of sends fit, no more");
    let stats = opencode_plugin::mailbox::stats(ID).unwrap();
    assert_eq!((stats.high, stats.refused), (abi::BOUND, 80_000 - abi::BOUND as u64));

    let replacer =
        std::thread::spawn(move || (0..10_000u32).all(|number| sender.replace("progress", (KEYED, number)).is_ok()));
    assert!(replacer.join().unwrap(), "a replace was refused");
    frame(&harness);
    assert_eq!(mail(|mail| std::mem::take(&mut mail.arrived)), [(KEYED, 9_999)]);
}

#[test]
fn a_disabled_plugin_closes_its_mailbox() {
    let harness = open();
    let old = mail(|mail| mail.sender.clone()).unwrap();
    assert_eq!(old.send((1, 1)), Ok(()));
    let tui = &harness.tui;
    tui.plugins.toggle(&host(tui), ID, false);
    assert_eq!(old.send((1, 2)), Err(SendError::Closed((1, 2))));
    frame(&harness);
    assert!(mail(|mail| mail.arrived.is_empty()));
    tui.plugins.toggle(&host(tui), ID, true);
    assert_eq!(old.send((1, 3)), Err(SendError::Closed((1, 3))), "an old sender reopened");
    let new = mail(|mail| mail.sender.clone()).unwrap();
    assert_eq!(new.send((2, 1)), Ok(()));
    frame(&harness);
    assert_eq!(mail(|mail| std::mem::take(&mut mail.arrived)), [(2, 1)]);
}

#[test]
fn a_stop_flag_ends_a_thread_and_a_failure_closes_the_mailbox() {
    let harness = open();
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
    assert!(done.recv_timeout(Duration::from_millis(50)).is_err(), "it ended while active");
    tui.plugins.toggle(&host(tui), ID, false);
    assert!(done.recv_timeout(Duration::from_secs(10)).is_ok(), "it never saw the flag");
    tui.plugins.toggle(&host(tui), ID, true);
    let spawner = mail(|mail| mail.spawner.clone()).unwrap();
    // A failure stops the plugin's threads too, though nothing disposes it.
    let (ended, done) = std::sync::mpsc::channel();
    spawner
        .spawn("waits", move |stop| {
            while !stop.stopped() {
                std::thread::sleep(Duration::from_millis(1));
            }
            ended.send(()).unwrap();
        })
        .unwrap();
    spawner.spawn("boom", |_| panic!("a mail thread panicked")).unwrap();
    harness.wait("the panic failed the plugin", || {
        harness.app.advance(Duration::from_millis(1));
        harness.app.render();
        tui.plugins.entries().iter().any(|entry| entry.id == ID && entry.status != opencode_plugin::Status::Active)
    });
    let status = tui.plugins.entries().into_iter().find(|entry| entry.id == ID).unwrap().status;
    let expected = "thread boom panicked: a mail thread panicked".to_owned();
    assert_eq!(status, opencode_plugin::Status::Failed(expected));
    assert!(done.recv_timeout(Duration::from_secs(10)).is_ok(), "a thread ran on after the failure");
    let sender = mail(|mail| mail.sender.clone()).unwrap();
    assert_eq!(sender.send((3, 1)), Err(SendError::Closed((3, 1))));
    assert_eq!(opencode_plugin::mailbox::stats(ID), None);
    tui.plugins.toggle(&host(tui), ID, false);
    assert_eq!(opencode_plugin::mailbox::stats(ID), None);
}

/// A message whose serializer waits until the test lets it go, up to five seconds.
#[derive(Debug)]
struct Slow;

#[derive(Default)]
struct Senders {
    slow: Option<abi::Sender<Slow>>,
    wide: Option<abi::Sender<u128>>,
    arrived: Vec<u128>,
}

thread_local! {
    static SLOW: RefCell<Senders> = RefCell::default();
}

static SERIALIZING: std::sync::Mutex<Option<(std::sync::mpsc::Sender<()>, std::sync::mpsc::Receiver<()>)>> =
    std::sync::Mutex::new(None);

impl serde::Serialize for Slow {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        if let Some((started, release)) = SERIALIZING.lock().unwrap().take() {
            started.send(()).unwrap();
            let _ = release.recv_timeout(Duration::from_secs(5));
        }
        serializer.serialize_unit()
    }
}

impl<'de> serde::Deserialize<'de> for Slow {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        <()>::deserialize(deserializer).map(|()| Slow)
    }
}

fn slow_setup(setup: &mut abi::Setup) -> Result<(), String> {
    let sender = setup.messages(|_, _: Slow| {})?;
    SLOW.with(|slow| slow.borrow_mut().slow = Some(sender));
    Ok(())
}

fn wide_setup(setup: &mut abi::Setup) -> Result<(), String> {
    let sender = setup.messages(|_, number: u128| SLOW.with(|slow| slow.borrow_mut().arrived.push(number)))?;
    SLOW.with(|slow| slow.borrow_mut().wide = Some(sender));
    Ok(())
}

fn open_with(id: &'static str, setup: fn(&mut abi::Setup) -> Result<(), String>) -> Harness {
    let deps = Deps {
        route: Route::Home,
        builtins: vec![abi::Plugin { id, setup }.into()],
        ..support::deps(Arc::new(support::empty()))
    };
    let harness = support::mount(60, 20, deps);
    frame(&harness);
    harness
}

#[test]
fn disabling_does_not_wait_for_a_serializer() {
    let harness = open_with("test.slow", slow_setup);
    let sender = SLOW.with(|slow| slow.borrow().slow.clone()).unwrap();
    let (started, serializing) = std::sync::mpsc::channel();
    let (release, released) = std::sync::mpsc::channel();
    *SERIALIZING.lock().unwrap() = Some((started, released));
    let thread = std::thread::spawn(move || matches!(sender.send(Slow), Err(SendError::Closed(_))));
    serializing.recv_timeout(Duration::from_secs(10)).unwrap();
    let begun = std::time::Instant::now();
    harness.tui.plugins.toggle(&host(&harness.tui), "test.slow", false);
    let took = begun.elapsed();
    release.send(()).unwrap();
    assert!(took < Duration::from_secs(2), "disabling waited {took:?} for a serializer");
    assert!(thread.join().unwrap(), "a send after disabling was not Closed");
}

#[test]
fn a_wide_integer_arrives_as_itself_on_both_carriers() {
    SLOW.with(|slow| slow.borrow_mut().arrived.clear());
    let harness = open_with("test.wide", wide_setup);
    let sender = SLOW.with(|slow| slow.borrow().wide.clone()).unwrap();
    let wide = u128::from(u64::MAX) + 7;
    std::thread::spawn(move || sender.send(wide).unwrap()).join().unwrap();
    frame(&harness);
    assert_eq!(SLOW.with(|slow| slow.borrow().arrived.clone()), [wide]);
}

#[test]
fn an_empty_key_is_no_key_on_both_carriers() {
    let harness = open();
    let sender = mail(|mail| mail.sender.clone()).unwrap();
    std::thread::spawn(move || {
        sender.replace("", (1, 1)).unwrap();
        sender.replace("", (1, 2)).unwrap();
        sender.replace("k", (2, 1)).unwrap();
        sender.replace("k", (2, 2)).unwrap();
    })
    .join()
    .unwrap();
    frame(&harness);
    assert_eq!(mail(|mail| std::mem::take(&mut mail.arrived)), [(1, 1), (1, 2), (2, 2)]);
}

#[test]
fn an_update_that_fails_ends_its_batch() {
    let harness = open();
    let sender = mail(|mail| mail.sender.clone()).unwrap();
    std::thread::spawn(move || [(1, 1), FAILS, (1, 2)].into_iter().for_each(|note| sender.send(note).unwrap()))
        .join()
        .unwrap();
    frame(&harness);
    assert_eq!(mail(|mail| mail.arrived.clone()), [(1, 1)]);
    let status = harness.tui.plugins.entries().into_iter().find(|entry| entry.id == ID).unwrap().status;
    let failed = matches!(&status, opencode_plugin::Status::Failed(error) if error.contains("a failing update"));
    assert!(failed, "{status:?}");
}

#[test]
fn a_refilled_mailbox_holds_back_no_report_and_no_wake() {
    let harness = open();
    mail(|mail| mail.refill = u32::MAX);
    mail(|mail| mail.sender.clone()).unwrap().send((7, 0)).unwrap();
    mail(|mail| mail.waker.clone()).unwrap().wake();
    for _ in 0..20 {
        harness.app.advance(Duration::from_millis(1));
        harness.app.render();
    }
    let (woken, refill) = mail(|mail| (mail.woken.clone(), mail.refill));
    assert_eq!(woken.first(), Some(&1), "the wake ran after the messages {woken:?}");
    assert!(refill > 0, "the refills ended first");
    // A report: the thread's panic comes after one message, while the refills go on.
    let (panicked, done) = std::sync::mpsc::channel();
    mail(|mail| mail.spawner.clone())
        .unwrap()
        .spawn("boom", move |_| {
            panicked.send(()).unwrap();
            panic!("a mail thread panicked");
        })
        .unwrap();
    done.recv_timeout(Duration::from_secs(10)).unwrap();
    // Start the interval when the report enters the queue; a panicking thread can be descheduled before posting it.
    let before = {
        let begun = std::time::Instant::now();
        while !opencode_plugin::mailbox::stats(ID).is_some_and(|stats| stats.reported) {
            assert!(begun.elapsed() < Duration::from_secs(10), "no report was put in");
            std::thread::sleep(Duration::from_millis(1));
        }
        mail(|mail| mail.arrived.len())
    };
    harness.wait("the panic failed the plugin", || {
        harness.app.advance(Duration::from_millis(1));
        harness.app.render();
        harness
            .tui
            .plugins
            .entries()
            .iter()
            .any(|entry| entry.id == ID && entry.status != opencode_plugin::Status::Active)
    });
    let (after, refill) = mail(|mail| (mail.arrived.len(), mail.refill));
    assert!(after - before <= abi::BOUND + 1, "{} updates came before the report", after - before);
    assert!(refill > 0, "the refills ended before the report");
}

fn flood(count: u32) -> usize {
    let sender = mail(|mail| mail.sender.clone()).unwrap();
    std::thread::spawn(move || (0..count).filter(|number| sender.send((9, *number)).is_ok()).count()).join().unwrap()
}

#[test]
fn a_mailbox_full_at_the_end_of_13_frames_is_a_backlog() {
    let harness = open();
    let monitor = harness.tui.plugins.monitor().clone();
    // Each toast as it shows, taken off the screen so the next one shows.
    let told = std::cell::RefCell::new(Vec::new());
    let paint = || {
        harness.app.advance(Duration::from_millis(16));
        let frame = harness.app.render();
        while let Some(toast) = harness.tui.toasts.current() {
            told.borrow_mut().push(toast.title.unwrap_or(toast.message));
            harness.tui.toasts.dismiss();
        }
        frame
    };
    assert_eq!(flood(abi::BOUND as u32), abi::BOUND, "a burst to the bound");
    frame(&harness);
    mail(|mail| mail.refill = u32::MAX);
    assert_eq!(flood(abi::BOUND as u32 + 1), abi::BOUND, "one refused");
    for _ in 0..12 {
        paint();
    }
    let backlog = || monitor.report(ID).unwrap_or_default().contains("backlog");
    assert!(!backlog(), "a backlog after 12 full ends");
    paint();
    assert!(monitor.is_slow(ID) && backlog(), "no backlog after 13 full ends");
    let report = monitor.report(ID).unwrap_or_default();
    assert!(report.contains("backlog") && report.contains("1 sends refused"), "{report}");
    mail(|mail| mail.refill = 0);
    frame(&harness);
    for _ in 0..120 {
        paint();
    }
    let report = monitor.report(ID).unwrap_or_default();
    assert!(!report.contains("backlog"), "a backlog 120 frames after it ended: {report}");
    let host = opencode_tui::plugins::host::host(&harness.tui);
    harness.tui.plugins.toggle(&host, ID, false).unwrap().unwrap();
    harness.tui.plugins.toggle(&host, ID, true).unwrap().unwrap();
    frame(&harness);
    assert_eq!(flood(abi::BOUND as u32 + 1), abi::BOUND, "one refused after the enable");
    mail(|mail| mail.refill = u32::MAX);
    for _ in 0..14 {
        paint();
    }
    assert!(monitor.is_slow(ID) && backlog(), "no backlog after the enable");
    mail(|mail| mail.refill = 0);
    let slow = format!("Plugin is slow: {ID}");
    let told = told.take();
    assert_eq!(told.iter().filter(|title| **title == slow).count(), 1, "{told:?}");
}

#[test]
fn a_full_queue_starts_one_wake_thread_a_plugin() {
    let harness = open();
    let full = Arc::new(AtomicBool::new(true));
    let fillers: Vec<_> = (0..3)
        .map(|_| {
            let (full, proxy) = (full.clone(), harness.app.proxy());
            std::thread::spawn(
                move || while full.load(Ordering::Relaxed) && proxy.send(()) != Err(ProxyError::Closed) {},
            )
        })
        .collect();
    mail(|mail| mail.refill = u32::MAX);
    mail(|mail| mail.sender.clone()).unwrap().send((7, 0)).unwrap();
    let before = wake_threads();
    let mut most = 0;
    for _ in 0..60 {
        harness.app.advance(Duration::from_millis(1));
        harness.app.render();
        most = most.max(wake_threads().saturating_sub(before));
    }
    // One delivers the wake; one more may still be ending, having just delivered the one before.
    assert!(most <= 2, "{most} threads deliver one plugin's wake");
    full.store(false, Ordering::Relaxed);
    fillers.into_iter().for_each(|filler| filler.join().unwrap());
    mail(|mail| mail.refill = 0);
    harness.wait("the refills ended", || {
        harness.app.advance(Duration::from_millis(1));
        harness.app.render();
        !opencode_plugin::schedule::busy(&harness.app)
    });
    let arrived = mail(|mail| mail.arrived.len());
    mail(|mail| mail.sender.clone()).unwrap().send((8, 0)).unwrap();
    harness.wait("a send after the flood arrived", || {
        harness.app.advance(Duration::from_millis(1));
        harness.app.render();
        mail(|mail| mail.arrived.len()) > arrived
    });
}

/// The threads of this process that deliver a plugin's wake through a full UI queue.
fn wake_threads() -> usize {
    let tasks = std::fs::read_dir("/proc/self/task").into_iter().flatten().flatten();
    tasks
        .filter(|task| std::fs::read_to_string(task.path().join("comm")).is_ok_and(|name| name.trim() == "plugin-wake"))
        .count()
}
