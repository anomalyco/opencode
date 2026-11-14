//! Wakes are scheduled, not only queued (synthesis 4.2, phase Pl). A wake marks its plugin's activation ready, once
//! however many messages its mailbox holds. The UI thread then hands the ready plugins their `update` calls in turn,
//! one a plugin a round, under the frame budget of P4c's monitor: a plugin gets at least one a frame, and more while
//! its updates in the frame stay under [`contain::Limits::frame`] and all plugins' under [`contain::Limits::all`]. What
//! is left waits for the next frame, which the scheduler asks for and drains as its paint starts.
//!
//! Input comes before any `update`: OpenTUI routes a turn's input before the wakes it delivers and before the paint,
//! so every update runs after the input that came before it. So a plugin that floods its mailbox delays its own
//! messages, and no key and no other plugin (`backlog`).

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::rc::{Rc, Weak};
use std::time::Duration;

use opentui::prelude::*;

use crate::activation::{Activation, Step};
use crate::contain;

thread_local! {
    static QUEUE: RefCell<Queue> = RefCell::default();
}

#[derive(Default)]
struct Queue {
    /// The activations with work, in turn order, each with its app.
    ready: Vec<(usize, Weak<Activation>)>,
    /// The apps whose next paint drains what is left.
    waiting: HashSet<usize>,
    /// What each activation's updates took in a frame: by its address, the app's frame, the updates and their time.
    spent: HashMap<usize, (u64, u32, Duration)>,
    /// What all plugins' updates of an app took in a frame.
    all: HashMap<usize, (u64, Duration)>,
}

/// The updates the scheduler ran and the frames it asked for, counted since the thread started, for the tests.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Work {
    pub updates: u64,
    /// Drains that left work for the next frame.
    pub deferred: u64,
}

thread_local! {
    static WORK: std::cell::Cell<Work> = std::cell::Cell::new(Work::default());
}

/// What the scheduler did on this thread so far.
pub fn work() -> Work {
    WORK.with(std::cell::Cell::get)
}

fn key(app: &App) -> usize {
    std::ptr::from_ref(app.session()) as usize
}

fn address(activation: &Rc<Activation>) -> usize {
    Rc::as_ptr(activation) as usize
}

/// Whether a plugin of `app` has updates waiting for a frame.
pub fn busy(app: &App) -> bool {
    let app = key(app);
    QUEUE.with(|queue| queue.borrow().ready.iter().any(|(of, activation)| *of == app && activation.strong_count() > 0))
}

/// `activation` has work: its mailbox has messages, a thread's report or a wake of its waker waits.
pub(crate) fn ready(app: &App, activation: &Rc<Activation>) {
    let (app, this) = (key(app), Rc::downgrade(activation));
    QUEUE.with(|queue| {
        let mut queue = queue.borrow_mut();
        if !queue.ready.iter().any(|(_, known)| known.ptr_eq(&this)) {
            queue.ready.push((app, this));
        }
    });
}

/// Runs the ready plugins of `app` in turn under the frame budget; what is left runs as the next paint starts.
pub(crate) fn drain(app: &App) {
    let (app_key, frame) = (key(app), app.frame_number());
    loop {
        let round: Vec<Rc<Activation>> = QUEUE.with(|queue| {
            let mut queue = queue.borrow_mut();
            queue.ready.retain(|(_, activation)| activation.strong_count() > 0);
            queue.ready.iter().filter(|(of, _)| *of == app_key).filter_map(|(_, known)| known.upgrade()).collect()
        });
        let mut ran = false;
        for activation in &round {
            let (limits, clock) = activation.budget();
            let (updates, spent, all) = QUEUE.with(|queue| {
                let queue = queue.borrow();
                let (updates, spent) = match queue.spent.get(&address(activation)) {
                    Some((open, updates, spent)) if *open == frame => (*updates, *spent),
                    _ => (0, Duration::ZERO),
                };
                let all =
                    queue.all.get(&app_key).filter(|(open, _)| *open == frame).map_or(Duration::ZERO, |(_, all)| *all);
                (updates, spent, all)
            });
            // At least one a frame; then while its own and all plugins' updates stay under the budget.
            if updates > 0 && (spent >= limits.frame || all >= limits.all) {
                continue;
            }
            let start = clock();
            let step = activation.step();
            let took = clock().saturating_duration_since(start);
            QUEUE.with(|queue| {
                let mut queue = queue.borrow_mut();
                queue.spent.insert(address(activation), (frame, updates + 1, spent + took));
                queue.all.insert(app_key, (frame, all + took));
                if step == Step::Idle {
                    let this = Rc::downgrade(activation);
                    queue.ready.retain(|(_, known)| !known.ptr_eq(&this));
                    queue.spent.remove(&address(activation));
                }
            });
            if step == Step::Ran {
                WORK.with(|work| work.set(Work { updates: work.get().updates + 1, ..work.get() }));
                ran = true;
            }
        }
        if !ran {
            break;
        }
    }
    let left = QUEUE.with(|queue| {
        let mut queue = queue.borrow_mut();
        // The plugin served first now goes last, so each one's turn comes round when all plugins' budget binds.
        if let Some(first) = queue.ready.iter().position(|(of, _)| *of == app_key) {
            let served = queue.ready.remove(first);
            queue.ready.push(served);
        }
        let left = queue.ready.iter().any(|(of, _)| *of == app_key);
        left && queue.waiting.insert(app_key)
    });
    if left {
        WORK.with(|work| work.set(Work { deferred: work.get().deferred + 1, ..work.get() }));
        // Animations run as a paint starts, after the turn's input and before the frame is counted.
        app.animate(move |cx, _| {
            QUEUE.with(|queue| queue.borrow_mut().waiting.remove(&app_key));
            drain(cx.app());
            false
        });
    }
}

/// The frame budget and the clock of P4c's monitor, or the defaults while the host has set none.
pub(crate) fn default_budget() -> (contain::Limits, Rc<dyn Fn() -> std::time::Instant>) {
    (contain::Limits::default(), Rc::new(std::time::Instant::now))
}
