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
use std::collections::HashMap;
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
    /// The activations with work, in turn order.
    ready: Vec<Weak<Activation>>,
    /// What each activation's updates took in a frame of its app, also once it went idle, so mail that comes later
    /// in the frame finds the budget spent: by its ID, which no other activation gets, the frame, the updates and
    /// their time.
    spent: HashMap<u64, (Weak<Activation>, u64, u32, Duration)>,
}

/// The updates the scheduler ran and the drains that left work for the next frame, counted since the thread started,
/// for the tests.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Work {
    pub updates: u64,
    pub deferred: u64,
}

thread_local! {
    static WORK: std::cell::Cell<Work> = std::cell::Cell::new(Work::default());
}

/// What the scheduler did on this thread so far.
pub fn work() -> Work {
    WORK.with(std::cell::Cell::get)
}

/// An app, while it lives: the address of its session.
pub(crate) fn key(app: &App) -> usize {
    std::ptr::from_ref(app.session()) as usize
}

/// The ready activations of the app `app`, in turn order: those whose host's app it is now.
fn of(queue: &Queue, app: usize) -> Vec<Rc<Activation>> {
    queue.ready.iter().filter_map(Weak::upgrade).filter(|activation| activation.app() == Some(app)).collect()
}

/// Whether a plugin of `app` has updates waiting for a frame.
pub fn busy(app: &App) -> bool {
    QUEUE.with(|queue| !of(&queue.borrow(), key(app)).is_empty())
}

/// `activation` has work: its mailbox has messages, a thread's report or a wake of its waker waits.
pub(crate) fn ready(activation: &Rc<Activation>) {
    let this = Rc::downgrade(activation);
    QUEUE.with(|queue| {
        let mut queue = queue.borrow_mut();
        if !queue.ready.iter().any(|known| known.ptr_eq(&this)) {
            queue.ready.push(this);
        }
    });
}

/// Runs the ready plugins of `app` in turn under the frame budget, or only `woken`, which a wake of its own made
/// ready, so one plugin's wake never moves another's updates; what is left runs in turn as the next paint starts.
pub(crate) fn drain(app: &App, woken: Option<&Rc<Activation>>) {
    let (app_key, frame) = (key(app), app.frame_number());
    QUEUE.with(|queue| {
        let mut queue = queue.borrow_mut();
        queue.ready.retain(|activation| activation.strong_count() > 0);
        // What the app's earlier frames spent is past, and an activation that ended spends nothing.
        queue.spent.retain(|_, (activation, open, ..)| {
            activation.upgrade().is_some_and(|activation| activation.app() != Some(app_key) || *open == frame)
        });
    });
    loop {
        let mut round = QUEUE.with(|queue| of(&queue.borrow(), app_key));
        if let Some(woken) = woken {
            round.retain(|activation| Rc::ptr_eq(activation, woken));
        }
        let mut ran = false;
        for activation in &round {
            let (limits, clock) = activation.budget();
            let (updates, spent, all) = QUEUE.with(|queue| {
                let queue = queue.borrow();
                let (updates, spent) = match queue.spent.get(&activation.id()) {
                    Some((_, open, updates, spent)) if *open == frame => (*updates, *spent),
                    _ => (0, Duration::ZERO),
                };
                let all = queue
                    .spent
                    .values()
                    .filter(|(known, open, ..)| {
                        *open == frame && known.upgrade().and_then(|known| known.app()) == Some(app_key)
                    })
                    .map(|(.., spent)| *spent)
                    .sum::<Duration>();
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
                // A step that found nothing to do made no update and spent nothing of the budget.
                match step {
                    Step::Ran => {
                        let entry = (Rc::downgrade(activation), frame, updates + 1, spent + took);
                        queue.spent.insert(activation.id(), entry);
                    }
                    Step::Idle => {
                        let this = Rc::downgrade(activation);
                        queue.ready.retain(|known| !known.ptr_eq(&this));
                    }
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
        // After a round, the plugin served first goes last, so each one's turn comes round when all plugins' budget
        // binds.
        let first = queue.ready.iter().position(|known| known.upgrade().and_then(|known| known.app()) == Some(app_key));
        if let (Some(first), None) = (first, woken) {
            let served = queue.ready.remove(first);
            queue.ready.push(served);
        }
        !of(&queue, app_key).is_empty()
    });
    if left {
        WORK.with(|work| work.set(Work { deferred: work.get().deferred + 1, ..work.get() }));
        // Animations run as a paint starts, after the turn's input and before the frame is counted. A drain the
        // budget stops asks for one; the frame's spend holds for all of them.
        app.animate(move |cx, _| {
            drain(cx.app(), None);
            false
        });
    }
}

/// The frame budget and the clock of P4c's monitor, or the defaults while the host has set none.
pub(crate) fn default_budget() -> (contain::Limits, Rc<dyn Fn() -> std::time::Instant>) {
    (contain::Limits::default(), Rc::new(std::time::Instant::now))
}
