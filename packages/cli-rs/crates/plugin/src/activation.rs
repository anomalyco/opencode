//! One activation of a plugin of the one API (O-67), on either path: the claims and routes it has mounted, which the
//! host renders again with [`abi::Changed::woken`] when the plugin's thread wakes it, and after each of its commands
//! and event handlers, whose state a render may show.

use std::cell::{Cell, RefCell};
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::rc::{Rc, Weak};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU8, AtomicU64, Ordering};
use std::time::Duration;

use opentui::app::ProxyError;
use opentui::prelude::*;

use crate::mailbox::Mailbox;
use crate::node::Mount;
use crate::{Host, abi, defer};
use opencode_plugin_abi::mail::Message;

/// A mounted claim or route that a wake or an invalidation renders again.
pub(crate) trait Drawn {
    fn woken(&self, host: &dyn Host);
}

impl Drawn for Mount {
    fn woken(&self, host: &dyn Host) {
        self.draw(host, &abi::Changed { woken: true, ..abi::Changed::default() });
    }
}

pub(crate) struct Activation {
    host: Weak<dyn Host>,
    wake: Arc<Wake>,
    /// What the plugin's threads send, and their panic reports.
    pub mailbox: Arc<Mailbox>,
    claims: RefCell<Vec<Weak<dyn Drawn>>>,
    /// An invalidation waits on the effect queue.
    queued: Cell<bool>,
    /// The handler of this activation's [`Woken`].
    handler: HandlerId,
    /// The plugin was disposed: its pending replies are dropped.
    disposed: Cell<bool>,
    /// Runs the plugin's wake handlers, which invalidate its claims; without, a wake only redraws them.
    on_wake: RefCell<Option<Rc<dyn Fn()>>>,
    /// Runs the plugin's message handler with one message.
    on_message: RefCell<Option<Deliver>>,
    /// Fails the plugin after a thread of it panicked.
    on_panic: RefCell<Option<Report>>,
    /// What holds input for it: its mounts and itself (P2). They end with it.
    owners: RefCell<Vec<Weak<crate::interact::Owner>>>,
    /// A wake of the plugin's waker waits for its wake handlers, which run once the messages put in before it are
    /// handed over, and before those put in later: the place it took in the mailbox.
    hinted: Cell<Option<u64>>,
    /// Times its updates against the frame budget ([`crate::schedule`]); the defaults until the host sets it.
    monitor: RefCell<Option<(Rc<crate::contain::Monitor>, crate::contain::Slot)>>,
}

/// What one [`Activation::step`] did.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Step {
    /// It made one update: a message, or the wake handlers.
    Ran,
    /// It has nothing left to do, or ended.
    Idle,
}

/// Hands one message to the plugin.
pub(crate) type Deliver = Rc<dyn Fn(Message)>;
/// Fails the plugin with a thread's panic report.
pub(crate) type Report = Rc<dyn Fn(String)>;

impl Activation {
    pub fn new(host: &Rc<dyn Host>, mailbox: Arc<Mailbox>) -> Rc<Self> {
        let wake = mailbox.wake().clone();
        Rc::new_cyclic(|this: &Weak<Self>| {
            let (this, wake_id) = (this.clone(), wake.id);
            let handler = host.app().on_message(move |_, message: &Woken| {
                crate::flush();
                if let Some(activation) = this.upgrade().filter(|_| message.0 == wake_id) {
                    activation.woken();
                }
            });
            Self {
                host: Rc::downgrade(host),
                mailbox,
                wake,
                claims: RefCell::default(),
                queued: Cell::new(false),
                handler,
                disposed: Cell::new(false),
                on_wake: RefCell::default(),
                on_message: RefCell::default(),
                on_panic: RefCell::default(),
                owners: RefCell::default(),
                hinted: Cell::new(None),
                monitor: RefCell::default(),
            }
        })
    }

    /// Schedules its updates by `monitor`, which times the plugin's calls in `slot`: its frame budget and clock, and
    /// what the plugin's calls took in a frame.
    pub fn set_monitor(&self, monitor: Rc<crate::contain::Monitor>, slot: crate::contain::Slot) {
        *self.monitor.borrow_mut() = Some((monitor, slot));
    }

    /// What the plugin's calls took in the frame now (its handlers, views, `layout` and updates), and all plugins'
    /// calls, as the monitor counts them; `None` while the host has set no monitor.
    pub(crate) fn spent(&self) -> Option<(std::time::Duration, std::time::Duration)> {
        self.monitor.borrow().as_ref().map(|(monitor, slot)| monitor.spent(*slot))
    }

    /// Its ID, which no other activation gets.
    pub(crate) fn id(&self) -> u64 {
        self.wake.id
    }

    /// The app its host runs in, while the host lives ([`crate::schedule::key`]).
    pub(crate) fn app(&self) -> Option<usize> {
        self.host.upgrade().map(|host| crate::schedule::key(host.app()))
    }

    /// The frame budget its updates are scheduled by.
    pub(crate) fn limits(&self) -> crate::contain::Limits {
        self.monitor.borrow().as_ref().map_or_else(crate::contain::Limits::default, |(monitor, _)| monitor.limits())
    }

    /// Sets what a delivered message runs, and what a thread's panic report runs.
    pub fn on_mail(&self, message: Deliver, panic: Report) {
        *self.on_message.borrow_mut() = Some(message);
        *self.on_panic.borrow_mut() = Some(panic);
    }

    /// What wakes this activation from any thread, for a plugin that runs in process. It keeps the activation's `Wake`,
    /// so it never reaches freed memory; disposing the plugin revokes it.
    pub fn waker(&self) -> abi::Waker {
        let wake = self.wake.clone();
        abi::Waker::new(move || wake.post())
    }

    /// Ends the activation: a wake from the plugin's threads posts nothing from now on, and nothing of it is called.
    pub fn dispose(&self) {
        self.disposed.set(true);
        self.wake.revoked.store(true, Ordering::Release);
        // An ended activation keeps no wake posted.
        self.wake.consume();
        self.mailbox.retire();
        // The wake and mail handlers hold what holds the activation.
        self.on_wake.borrow_mut().take();
        self.on_message.borrow_mut().take();
        self.on_panic.borrow_mut().take();
        // Its input stops at once, and goes once the event that ended it is handled: a key layer may be the one that
        // runs now.
        let owners: Vec<_> = self.owners.take().iter().filter_map(Weak::upgrade).collect();
        owners.iter().for_each(|owner| owner.revoke());
        if !owners.is_empty() {
            defer(&self.host, move |_| owners.iter().for_each(|owner| owner.end()));
        }
    }

    /// The live owners of input it holds: its mounts', newest last, and its own.
    pub fn owners(&self) -> Vec<Rc<crate::interact::Owner>> {
        self.owners.borrow().iter().filter_map(Weak::upgrade).filter(|owner| owner.alive()).collect()
    }

    /// Records `owner`, which ends with the activation.
    pub fn own(&self, owner: &Rc<crate::interact::Owner>) {
        let mut owners = self.owners.borrow_mut();
        owners.retain(|owner| owner.strong_count() > 0);
        owners.push(Rc::downgrade(owner));
    }

    pub fn disposed(&self) -> bool {
        self.disposed.get()
    }

    /// Sets what a wake runs before the claims render again: the plugin's wake handlers, which invalidate them.
    pub fn on_wake(&self, run: Rc<dyn Fn()>) {
        *self.on_wake.borrow_mut() = Some(run);
    }

    /// A wake arrived: the activation is ready, and as the next paint starts, after the input read with the wake, the
    /// scheduler hands the plugin what its threads sent, in order, one `update` a message under the frame budget, then
    /// a thread's panic report; then, for an [`abi::Waker`]'s wake, runs the plugin's wake handlers, or renders the
    /// claims again ([`Activation::step`], [`crate::schedule`]).
    ///
    fn woken(self: &Rc<Self>) {
        if self.disposed() {
            return;
        }
        let Some(host) = self.host.upgrade() else { return };
        crate::schedule::ready(self);
        crate::schedule::arm(host.app());
    }

    /// The scheduler's drain takes the wake, as the plugin's first turn in it starts: until then the wake stays
    /// posted, so a thread's sends and replaces post no other and wake the UI thread once a drain at most (review
    /// carbon 4.2). A send or a wake from now on posts another, so none is lost between what this one sees and what it
    /// handles.
    pub(crate) fn take_wake(&self) {
        let hinted = self.wake.consume();
        between(0);
        // The first wake not handled yet keeps its place.
        if hinted && self.hinted.get().is_none() {
            self.hinted.set(Some(self.mailbox.placed()));
        }
    }

    /// One update of the scheduler's turn: the next message to the message handler; once none waits, a thread's panic
    /// report; then a wake of the waker, to the wake handlers or a redraw. Once the plugin has failed, by a message or
    /// by a report, nothing more reaches it: the first cause is the one reported.
    pub(crate) fn step(&self) -> Step {
        if self.disposed() {
            return Step::Idle;
        }
        // A thread's report, or a wake, goes before the messages put in after it, so a thread that sends as fast as
        // the updates run does not hold either back (review bigboi 8).
        let message = self.mailbox.take_one(self.hinted.get());
        between(1);
        if let Some(message) = message {
            let deliver = self.on_message.borrow().clone();
            // A failing update closed the mailbox, which dropped what waited.
            if let (Some(deliver), false) = (deliver, self.mailbox.closed()) {
                deliver(message);
            }
            between(2);
            return Step::Ran;
        }
        between(2);
        // Failing is first-cause-wins, so a report after a failing update changes nothing. Bound first: failing
        // disposes the activation, which takes the handler.
        let fail = self.on_panic.borrow().clone();
        if let (Some(panic), Some(fail)) = (self.mailbox.take_panic(), fail) {
            fail(panic);
        }
        between(3);
        if self.hinted.take().is_none() || self.disposed() || self.mailbox.closed() {
            return Step::Idle;
        }
        let run = self.on_wake.borrow().clone();
        match run {
            Some(run) => run(),
            None => self.redraw(),
        }
        Step::Ran
    }

    /// The end of a frame in which the plugin had mail: the monitor counts whether its mailbox is full, and tells the
    /// user once it is slow by its backlog.
    pub(crate) fn sample_backlog(&self) {
        let Some((monitor, slot)) = self.monitor.borrow().clone() else { return };
        if let Some((id, news)) = monitor.backlog(slot, self.mailbox.full(), self.mailbox.stats().refused) {
            crate::defer(&self.host, move |host| host.slow(&id, &news));
        }
    }

    pub fn track(&self, claim: Weak<dyn Drawn>) {
        let mut claims = self.claims.borrow_mut();
        claims.retain(|claim| claim.strong_count() > 0);
        claims.push(claim);
    }

    /// Renders the mounted claims and routes again. It leaves the wake alone: only handling a posted wake consumes it.
    pub fn redraw(&self) {
        let Some(host) = self.host.upgrade() else { return };
        let claims: Vec<Rc<dyn Drawn>> = self.claims.borrow().iter().filter_map(Weak::upgrade).collect();
        claims.iter().for_each(|claim| claim.woken(&*host));
    }

    /// Queues one redraw on the effect queue, after the effects queued so far: a handler of the plugin ran, and
    /// what it changed may show. Handlers that run before it is drained share it.
    pub fn invalidate(self: &Rc<Self>) {
        if self.queued.replace(true) {
            return;
        }
        let this = Rc::downgrade(self);
        defer(&self.host, move |_| {
            if let Some(activation) = this.upgrade() {
                activation.queued.set(false);
                activation.redraw();
            }
        });
    }
}

impl Drop for Activation {
    fn drop(&mut self) {
        if let Some(host) = self.host.upgrade() {
            host.app().remove_handler(self.handler);
        }
    }
}

/// An activation's wakes, from any thread, in one atomic state: [`PENDING`] while a [`Woken`] waits for the UI thread,
/// so a burst posts one, and [`HINTED`] when a wake of the plugin's [`abi::Waker`] is among them (a send to its mailbox
/// is not). Every change is one atomic operation on both bits, so no interleaving of a sender and the UI thread can
/// clear a bit that a later wake set without posting again.
pub(crate) struct Wake {
    id: u64,
    state: AtomicU8,
    /// The activation ended or failed: a wake posts nothing. A failed C ABI instance is kept, not destroyed, so its
    /// own waker is never revoked; this is.
    revoked: AtomicBool,
    proxy: Option<AppProxy>,
    /// The `Woken`s posted and handled, for the model that holds at most one in flight.
    #[cfg(test)]
    pub posted: std::sync::atomic::AtomicUsize,
    #[cfg(test)]
    pub handled: std::sync::atomic::AtomicUsize,
}

/// A [`Woken`] waits for the UI thread.
const PENDING: u8 = 1;
/// The plugin's waker woke the host since the UI thread last consumed the state.
const HINTED: u8 = 2;

/// What the model runs at a step of [`Activation::woken`].
#[cfg(test)]
pub(crate) type Between = Box<dyn FnMut(usize)>;

#[cfg(test)]
thread_local! {
    /// Runs between the steps of [`Activation::woken`], for the model that puts sends and wakes in each gap.
    pub(crate) static BETWEEN: RefCell<Option<Between>> = RefCell::new(None);
}

/// The test hook between the steps of [`Activation::woken`].
fn between(_step: usize) {
    #[cfg(test)]
    {
        let hook = BETWEEN.with(|hook| hook.borrow_mut().take());
        if let Some(mut hook) = hook {
            hook(_step);
            BETWEEN.with(|slot| {
                slot.borrow_mut().get_or_insert(hook);
            });
        }
    }
}

#[cfg(test)]
thread_local! {
    /// The wakes dropped on this thread, which tests compare across a disposal.
    pub(crate) static FREED: Cell<usize> = const { Cell::new(0) };
}

#[cfg(test)]
impl Drop for Wake {
    fn drop(&mut self) {
        FREED.with(|freed| freed.set(freed.get() + 1));
    }
}

/// Posted by a wake: the activation whose claims draw again.
struct Woken(u64);

impl Wake {
    pub fn new(proxy: Option<AppProxy>) -> Self {
        static WAKES: AtomicU64 = AtomicU64::new(0);
        Self {
            id: WAKES.fetch_add(1, Ordering::Relaxed),
            state: AtomicU8::new(0),
            revoked: AtomicBool::new(false),
            proxy,
            #[cfg(test)]
            posted: Default::default(),
            #[cfg(test)]
            handled: Default::default(),
        }
    }

    /// The plugin's waker woke the host: its wake handlers run, or its claims draw again.
    pub fn post(&self) {
        self.raise(PENDING | HINTED);
    }

    /// Whether a [`Woken`] waits for the UI thread.
    #[cfg(test)]
    pub(crate) fn pending(&self) -> bool {
        self.state.load(Ordering::Acquire) & PENDING != 0
    }

    /// Posts one [`Woken`] until the UI thread handles it, unless the activation ended.
    pub fn ring(&self) {
        self.raise(PENDING);
    }

    /// The UI thread handles a [`Woken`]: the state goes back to nothing in one step; whether the waker was among it.
    fn consume(&self) -> bool {
        let state = self.state.swap(0, Ordering::AcqRel);
        #[cfg(test)]
        if state & PENDING != 0 {
            self.handled.fetch_add(1, Ordering::SeqCst);
        }
        state & HINTED != 0
    }

    /// Sets `bits`, and posts a [`Woken`] when none waits. Catches its own panics.
    fn raise(&self, bits: u8) {
        let _ = catch_unwind(AssertUnwindSafe(|| {
            if self.revoked.load(Ordering::Acquire) || self.state.fetch_or(bits, Ordering::AcqRel) & PENDING != 0 {
                return;
            }
            let Some(proxy) = &self.proxy else {
                self.state.store(0, Ordering::Release);
                return;
            };
            #[cfg(test)]
            self.posted.fetch_add(1, Ordering::SeqCst);
            match proxy.send(Woken(self.id)) {
                Ok(()) => {}
                Err(ProxyError::Closed) => self.state.store(0, Ordering::Release),
                // The UI thread is behind. The wake stays pending, so later ones join it, and a thread delivers it
                // once the queue has room, as `App::spawn` does with a completion. That thread holds no pointer into
                // the plugin, so it may outlive it; a `Woken` for a disposed activation finds no handler.
                Err(ProxyError::Full) => {
                    let (proxy, id) = (proxy.clone(), self.id);
                    let retry = std::thread::Builder::new().name("plugin-wake".to_owned()).spawn(move || {
                        while proxy.send(Woken(id)) == Err(ProxyError::Full) {
                            std::thread::sleep(Duration::from_millis(1));
                        }
                    });
                    if retry.is_err() {
                        self.state.store(0, Ordering::Release);
                    }
                }
            }
        }));
    }
}
