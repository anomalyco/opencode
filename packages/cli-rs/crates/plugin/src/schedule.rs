//! Wakes are scheduled, not only queued (synthesis 4.2, phase Pl). A wake marks its plugin's activation ready, once
//! however many messages its mailbox holds. The UI thread then hands the ready plugins their `update` calls in turn,
//! one a plugin a round, under the frame budget of P4c's monitor: a plugin gets at least one a frame, and more while
//! its updates in the frame stay under [`contain::Limits::frame`] and all plugins' under [`contain::Limits::all`]. What
//! is left waits for the next frame.
//!
//! Input comes before any `update`: a wake only marks its plugin ready and asks for one drain of its app, which runs
//! as the next paint starts. OpenTUI's poll hands a wake and the input read with it in one batch, the wake first
//! (review bigboi 1), and the paint comes after the whole batch, so every update runs after the input that came
//! before it. An app has at most one drain asked for at a time, however many wakes come (review bigboi 7). So a
//! plugin that floods its mailbox delays its own messages, and no key and no other plugin (`backlog`).

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::{Rc, Weak};

use opentui::prelude::*;

use crate::activation::{Activation, Step};

thread_local! {
    static QUEUE: RefCell<Queue> = RefCell::default();
}

#[derive(Default)]
struct Queue {
    /// The activations with work, in turn order.
    ready: Vec<Weak<Activation>>,
    /// The apps a drain is asked for, by [`key`]: alive while the drain's animation holds its token, which it drops
    /// as it starts, and which goes with an app dropped before its paint, whose address another app may get.
    armed: HashMap<usize, Weak<()>>,
}

/// The updates the scheduler ran, the drains that left work for the next frame, and the drains it asked for and ran,
/// counted since the thread started, for the tests.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Work {
    pub updates: u64,
    pub deferred: u64,
    pub armed: u64,
    pub drains: u64,
    /// Wakes that reached the UI thread.
    pub wakes: u64,
}

thread_local! {
    static WORK: std::cell::Cell<Work> = std::cell::Cell::new(Work::default());
    /// A drain runs: it is a paint's start, so a view now lands in that paint.
    static DRAINING: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// Whether a drain runs now, at the start of a paint, before its layout.
pub(crate) fn draining() -> bool {
    DRAINING.get()
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
    WORK.with(|work| work.set(Work { wakes: work.get().wakes + 1, ..work.get() }));
    let this = Rc::downgrade(activation);
    QUEUE.with(|queue| {
        let mut queue = queue.borrow_mut();
        if !queue.ready.iter().any(|known| known.ptr_eq(&this)) {
            queue.ready.push(this);
        }
    });
}

/// Asks for one drain of `app` as its next paint starts, unless one is asked for already.
pub(crate) fn arm(app: &App) {
    let token = Rc::new(());
    let fresh = QUEUE.with(|queue| {
        let mut queue = queue.borrow_mut();
        queue.armed.retain(|_, armed| armed.strong_count() > 0);
        let fresh = !queue.armed.contains_key(&key(app));
        if fresh {
            queue.armed.insert(key(app), Rc::downgrade(&token));
        }
        fresh
    });
    if !fresh {
        return;
    }
    WORK.with(|work| work.set(Work { armed: work.get().armed + 1, ..work.get() }));
    // Animations run as a paint starts, after the turn's input and before the frame is counted.
    let mut token = Some(token);
    app.animate(move |cx, _| {
        // From here on a wake asks for another drain.
        drop(token.take());
        let outer = DRAINING.replace(true);
        drain(cx.app());
        DRAINING.set(outer);
        false
    });
}

/// Runs the ready plugins of `app` in turn under the frame budget; what is left asks for the next frame's drain.
fn drain(app: &App) {
    WORK.with(|work| work.set(Work { drains: work.get().drains + 1, ..work.get() }));
    let app_key = key(app);
    QUEUE.with(|queue| queue.borrow_mut().ready.retain(|activation| activation.strong_count() > 0));
    // An app drains once a paint ([`arm`]): the updates each plugin had in this one, by its activation's ID.
    let mut updates: HashMap<u64, u32> = HashMap::new();
    loop {
        let round = QUEUE.with(|queue| of(&queue.borrow(), app_key));
        let mut ran = false;
        for activation in &round {
            let limits = activation.limits();
            let had = match updates.get(&activation.id()) {
                Some(had) => *had,
                None => {
                    activation.take_wake();
                    updates.insert(activation.id(), 0);
                    0
                }
            };
            // What the monitor counted of the plugin's calls in the frame: its handlers, views, `layout`, draws and
            // updates; and all plugins' calls.
            let (counted, counted_all) = activation.spent().unwrap_or_default();
            // At least one a frame; then while its own and all plugins' calls stay under the budget.
            if had > 0 && (counted >= limits.frame || counted_all >= limits.all) {
                continue;
            }
            let step = activation.step();
            // A step that found nothing to do made no update and spent nothing of the budget.
            match step {
                Step::Ran => {
                    updates.insert(activation.id(), had + 1);
                    WORK.with(|work| work.set(Work { updates: work.get().updates + 1, ..work.get() }));
                    ran = true;
                }
                Step::Idle => {
                    let this = Rc::downgrade(activation);
                    QUEUE.with(|queue| queue.borrow_mut().ready.retain(|known| !known.ptr_eq(&this)));
                }
            }
        }
        if !ran {
            break;
        }
    }
    let left = QUEUE.with(|queue| {
        let mut queue = queue.borrow_mut();
        // The plugin served first goes last, so when the total budget binds each one's turn to go first comes round
        // (review carbon 4.3).
        if let Some(first) =
            queue.ready.iter().position(|known| known.upgrade().and_then(|known| known.app()) == Some(app_key))
        {
            let served = queue.ready.remove(first);
            queue.ready.push(served);
        }
        !of(&queue, app_key).is_empty()
    });
    // The frame's updates are done: whether each mailbox with mail is full at its end (the backlog cause of slow).
    QUEUE.with(|queue| of(&queue.borrow(), app_key)).iter().for_each(|activation| activation.sample_backlog());
    if left {
        WORK.with(|work| work.set(Work { deferred: work.get().deferred + 1, ..work.get() }));
        arm(app);
    }
}
