//! One activation of a plugin of the one API (O-67), on either path: the claims and routes it has mounted, which the
//! host renders again with [`abi::Changed::woken`] when the plugin's thread wakes it, and after each of its commands
//! and event handlers, whose state a render may show.

use std::cell::{Cell, RefCell};
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::rc::{Rc, Weak};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;

use opentui::app::ProxyError;
use opentui::prelude::*;

use crate::node::Mount;
use crate::{Host, abi, defer};

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
    claims: RefCell<Vec<Weak<dyn Drawn>>>,
    /// An invalidation waits on the effect queue.
    queued: Cell<bool>,
    /// The handler of this activation's [`Woken`].
    handler: HandlerId,
    /// The plugin was disposed: its pending replies are dropped.
    disposed: Cell<bool>,
    /// Runs the plugin's wake handlers, which invalidate its claims; without, a wake only redraws them.
    on_wake: RefCell<Option<Rc<dyn Fn()>>>,
}

impl Activation {
    pub fn new(host: &Rc<dyn Host>, wake: Arc<Wake>) -> Rc<Self> {
        Rc::new_cyclic(|this: &Weak<Self>| {
            let (this, id) = (this.clone(), wake.id);
            let handler = host.app().on_message(move |_, message: &Woken| {
                crate::flush();
                if let Some(activation) = this.upgrade().filter(|_| message.0 == id) {
                    activation.woken();
                }
            });
            Self {
                host: Rc::downgrade(host),
                wake,
                claims: RefCell::default(),
                queued: Cell::new(false),
                handler,
                disposed: Cell::new(false),
                on_wake: RefCell::default(),
            }
        })
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
        // The wake handlers hold what holds the activation.
        self.on_wake.borrow_mut().take();
    }

    pub fn disposed(&self) -> bool {
        self.disposed.get()
    }

    /// Sets what a wake runs before the claims render again: the plugin's wake handlers, which invalidate them.
    pub fn on_wake(&self, run: Rc<dyn Fn()>) {
        *self.on_wake.borrow_mut() = Some(run);
    }

    /// A wake arrived: runs the plugin's wake handlers, or renders the claims again at once.
    fn woken(&self) {
        let run = self.on_wake.borrow().clone();
        if self.disposed() {
            return self.wake.pending.store(false, Ordering::Release);
        }
        match run {
            Some(run) => {
                self.wake.pending.store(false, Ordering::Release);
                run();
            }
            None => self.redraw(),
        }
    }

    pub fn track(&self, claim: Weak<dyn Drawn>) {
        let mut claims = self.claims.borrow_mut();
        claims.retain(|claim| claim.strong_count() > 0);
        claims.push(claim);
    }

    /// Renders the mounted claims and routes again.
    pub fn redraw(&self) {
        self.wake.pending.store(false, Ordering::Release);
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

/// An activation's wakes, from any thread: `pending` while a [`Woken`] waits for the UI thread, so a burst posts one.
pub(crate) struct Wake {
    id: u64,
    pending: AtomicBool,
    /// The activation ended or failed: a wake posts nothing. A failed C ABI instance is kept, not destroyed, so its
    /// own waker is never revoked; this is.
    revoked: AtomicBool,
    proxy: Option<AppProxy>,
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
        let id = WAKES.fetch_add(1, Ordering::Relaxed);
        Self { id, pending: AtomicBool::new(false), revoked: AtomicBool::new(false), proxy }
    }

    /// Whether a [`Woken`] waits for the UI thread.
    #[cfg(test)]
    pub(crate) fn pending(&self) -> bool {
        self.pending.load(Ordering::Acquire)
    }

    /// Posts one [`Woken`] until the UI thread handles it, unless the activation ended. Catches its own panics.
    pub fn post(&self) {
        let _ = catch_unwind(AssertUnwindSafe(|| {
            if self.revoked.load(Ordering::Acquire) || self.pending.swap(true, Ordering::AcqRel) {
                return;
            }
            let Some(proxy) = &self.proxy else {
                self.pending.store(false, Ordering::Release);
                return;
            };
            match proxy.send(Woken(self.id)) {
                Ok(()) => {}
                Err(ProxyError::Closed) => self.pending.store(false, Ordering::Release),
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
                        self.pending.store(false, Ordering::Release);
                    }
                }
            }
        }));
    }
}
