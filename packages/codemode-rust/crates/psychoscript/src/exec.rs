//! The small amount of executor a run needs without depending on one: a set of host futures woken individually,
//! a thread-parking `block_on`, and one shared timer thread that wakes runs at their deadline.

use crate::offload::Home;
use std::collections::BinaryHeap;
use std::future::Future;
use std::pin::pin;
use std::sync::{Arc, Condvar, Mutex, OnceLock};
use std::task::{Context, Poll, Wake, Waker};
use std::time::Instant;

/// A boxed future a host hands the runtime. `Send`, so a run can move between threads.
pub type BoxFuture<'a, T> = std::pin::Pin<Box<dyn std::future::Future<Output = T> + Send + 'a>>;

// ---------- block_on ----------

struct Parker {
    woken: Mutex<bool>,
    signal: Condvar,
}

impl Wake for Parker {
    fn wake(self: Arc<Self>) {
        self.wake_by_ref();
    }

    fn wake_by_ref(self: &Arc<Self>) {
        let mut woken = self.woken.lock().unwrap_or_else(|e| e.into_inner());
        *woken = true;
        self.signal.notify_one();
    }
}

/// Drives a future to completion on the calling thread, parking it while the future waits.
pub fn block_on<F: Future>(future: F) -> F::Output {
    let mut future = pin!(future);
    let parker = Arc::new(Parker {
        woken: Mutex::new(false),
        signal: Condvar::new(),
    });
    let waker = Waker::from(parker.clone());
    let mut cx = Context::from_waker(&waker);
    loop {
        if let Poll::Ready(v) = future.as_mut().poll(&mut cx) {
            return v;
        }
        let mut woken = parker.woken.lock().unwrap_or_else(|e| e.into_inner());
        while !*woken {
            woken = parker.signal.wait(woken).unwrap_or_else(|e| e.into_inner());
        }
        *woken = false;
    }
}

// ---------- the task set ----------

/// Which tasks were woken since the run last looked, and the run's own waker to pass the news on.
#[derive(Default)]
struct Shared {
    ready: Vec<usize>,
    parent: Option<Waker>,
}

struct TaskWaker {
    index: usize,
    shared: Arc<Mutex<Shared>>,
}

impl Wake for TaskWaker {
    fn wake(self: Arc<Self>) {
        self.wake_by_ref();
    }

    fn wake_by_ref(self: &Arc<Self>) {
        let parent = {
            let mut shared = self.shared.lock().unwrap_or_else(|e| e.into_inner());
            shared.ready.push(self.index);
            shared.parent.clone()
        };
        if let Some(parent) = parent {
            parent.wake();
        }
    }
}

struct ParentWaker(Arc<Mutex<Shared>>);

impl Wake for ParentWaker {
    fn wake(self: Arc<Self>) {
        self.wake_by_ref();
    }

    fn wake_by_ref(self: &Arc<Self>) {
        let parent = self
            .0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .parent
            .clone();
        if let Some(parent) = parent {
            parent.wake();
        }
    }
}

struct Slot<'a, T> {
    future: BoxFuture<'a, T>,
    waker: Waker,
    tag: u32,
}

/// The host futures a run has in flight. Each has its own waker, so only woken ones are polled again. Dropping the
/// set drops, and so cancels, every one of them.
pub struct Tasks<'a, T> {
    slots: Vec<Option<Slot<'a, T>>>,
    free: Vec<usize>,
    live: usize,
    shared: Arc<Mutex<Shared>>,
}

impl<'a, T> Default for Tasks<'a, T> {
    fn default() -> Self {
        Self {
            slots: Vec::new(),
            free: Vec::new(),
            live: 0,
            shared: Arc::default(),
        }
    }
}

impl<'a, T> Tasks<'a, T> {
    pub fn is_empty(&self) -> bool {
        self.live == 0
    }

    /// Starts a future: it is polled once now, so its work begins at the call. `Ready` means it finished already.
    /// While the run computes on a worker thread, that poll happens back `home`, where the run is driven.
    pub fn spawn(&mut self, tag: u32, future: BoxFuture<'a, T>, home: Option<&Home>) -> Poll<T>
    where
        'a: 'static,
        T: Send + 'static,
    {
        let index = self.free.pop().unwrap_or_else(|| {
            self.slots.push(None);
            self.slots.len() - 1
        });
        let waker = Waker::from(Arc::new(TaskWaker {
            index,
            shared: self.shared.clone(),
        }));
        let first = |mut future: BoxFuture<'a, T>, waker: &Waker| {
            let poll = future.as_mut().poll(&mut Context::from_waker(waker));
            (future, poll)
        };
        let started = match home {
            None => Some(first(future, &waker)),
            Some(home) => {
                let waker = waker.clone();
                home.run(move || first(future, &waker))
            }
        };
        let future = match started {
            Some((_, Poll::Ready(v))) => {
                self.free.push(index);
                return Poll::Ready(v);
            }
            Some((future, Poll::Pending)) => future,
            // The run is being dropped: the future went with the request.
            None => {
                self.free.push(index);
                return Poll::Pending;
            }
        };
        self.slots[index] = Some(Slot { future, waker, tag });
        self.live += 1;
        Poll::Pending
    }

    /// Polls every task woken since the last call; returns the finished ones with their tags, in completion order.
    pub fn poll_ready(&mut self) -> Vec<(u32, T)> {
        let ready = {
            let mut shared = self.shared.lock().unwrap_or_else(|e| e.into_inner());
            std::mem::take(&mut shared.ready)
        };
        let mut done = Vec::new();
        for index in ready {
            let Some(Some(slot)) = self.slots.get_mut(index) else {
                continue;
            };
            let mut cx = Context::from_waker(&slot.waker);
            if let Poll::Ready(v) = slot.future.as_mut().poll(&mut cx) {
                let tag = slot.tag;
                self.slots[index] = None;
                self.free.push(index);
                self.live -= 1;
                done.push((tag, v));
            }
        }
        done
    }

    /// Whether some task was woken and waits to be polled.
    pub fn has_ready(&self) -> bool {
        !self
            .shared
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .ready
            .is_empty()
    }

    /// The waker to wake when a task becomes ready; `None` when nobody waits.
    pub fn set_parent(&self, waker: Option<&Waker>) {
        let mut shared = self.shared.lock().unwrap_or_else(|e| e.into_inner());
        shared.parent = waker.cloned();
    }

    /// A waker that wakes whoever waits on the set when it fires, even if that changes after it was made.
    pub fn parent_waker(&self) -> Waker {
        Waker::from(Arc::new(ParentWaker(self.shared.clone())))
    }

    /// Cancels every task by dropping it.
    pub fn clear(&mut self) {
        self.slots.clear();
        self.free.clear();
        self.live = 0;
    }
}

// ---------- the timer ----------

struct Timer {
    queue: Mutex<BinaryHeap<Deadline>>,
    signal: Condvar,
}

struct Deadline {
    at: Instant,
    waker: Waker,
}

impl PartialEq for Deadline {
    fn eq(&self, other: &Self) -> bool {
        self.at == other.at
    }
}

impl Eq for Deadline {}

impl PartialOrd for Deadline {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Deadline {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        other.at.cmp(&self.at)
    }
}

/// Wakes `waker` at `at`, from one timer thread shared by every run, started the first time a run waits with a
/// timeout. A run that already ended just gets a spurious wake.
pub fn wake_at(at: Instant, waker: &Waker) {
    static TIMER: OnceLock<Option<Arc<Timer>>> = OnceLock::new();
    let timer = TIMER.get_or_init(|| {
        let timer = Arc::new(Timer {
            queue: Mutex::new(BinaryHeap::new()),
            signal: Condvar::new(),
        });
        let worker = timer.clone();
        std::thread::Builder::new()
            .name("psychoscript-timer".into())
            .spawn(move || run_timer(&worker))
            .ok()
            .map(|_| timer)
    });
    match timer {
        Some(timer) => {
            let mut queue = timer.queue.lock().unwrap_or_else(|e| e.into_inner());
            queue.push(Deadline {
                at,
                waker: waker.clone(),
            });
            timer.signal.notify_one();
        }
        // No thread to wait on: wake now, so the run polls again and finds its deadline.
        None => waker.wake_by_ref(),
    }
}

fn run_timer(timer: &Timer) {
    let mut queue = timer.queue.lock().unwrap_or_else(|e| e.into_inner());
    loop {
        let now = Instant::now();
        while queue.peek().is_some_and(|d| d.at <= now) {
            if let Some(d) = queue.pop() {
                d.waker.wake();
            }
        }
        queue = match queue.peek().map(|d| d.at) {
            Some(at) => {
                timer
                    .signal
                    .wait_timeout(queue, at.saturating_duration_since(now))
                    .unwrap_or_else(|e| e.into_inner())
                    .0
            }
            None => timer.signal.wait(queue).unwrap_or_else(|e| e.into_inner()),
        };
    }
}
