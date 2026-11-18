//! Tasks: a handler that waits for a dialog's answer or a reply in a straight line, as TS awaits them
//! (`design/contract-ergonomics.md` 2.1).
//!
//! [`crate::Setup::tasks`] gives the plugin a [`Tasks`] handle, and a handler starts a task with it:
//!
//! ```
//! # use opencode_plugin_abi::*;
//! # use opencode_plugin_abi::task::Cx;
//! fn setup(setup: &mut Setup) -> Result<(), String> {
//!     let tasks = setup.tasks();
//!     setup.command(Command::new("x.clear").palette(), move |host, _| tasks.spawn(host, clear));
//!     Ok(())
//! }
//!
//! async fn clear(cx: Cx) {
//!     if cx.confirm(Confirm::ask("Clear?", "Clear the list?")).await != Some(true) {
//!         return;
//!     }
//!     match cx.fetch(Fetch::new("DELETE", "/api/x")).await {
//!         Ok(_) => cx.with(|host| host.toast(Toast::new(Variant::Success, "Cleared"))),
//!         Err(error) => cx.alert(Alert::new("Clear failed", error)).await,
//!     }
//! }
//! ```
//!
//! A task is a plain [`Future`], polled on the UI thread through real wakers, so other crates' combinators work on
//! it; [`join_all`] waits for several. It runs only inside a call the host makes to the plugin: the call that spawned
//! it, the reply it waits for, the dialog's answer, or the wake of a [`Cx::blocking`] thread. That call's budget,
//! containment and blame apply to what the task does in it, as they do to any handler, and the effects the task asks
//! for between two waits are that call's. A task that waits costs no time.
//!
//! [`Cx`] is the task's handle, `Clone + 'static`, so it moves into the task. Its waits are its own methods; the reads
//! and verbs are the [`Host`] of the call that polls the task, which [`Cx::with`] lends to a closure. Used outside its
//! task's poll (kept in the plugin's state and called from a plain handler, or from a render), or after the plugin was
//! disposed, every method panics, which fails the call.
//!
//! - The waits are eager, as a TS promise is: [`Cx::fetch`] sends at once, and [`Cx::select`] shows its dialog at once.
//! - A dialog closes with no answer as `None`: escape, the backdrop, another dialog that replaced it, the plugin's own
//!   included, or the host's refusal to open it. A [`Confirm`] answers `Some(false)` on escape, as the host's confirm
//!   runs its action with `false`. An answer reaches only the dialog it answers: each dialog's answer comes through the
//!   hidden command of its generation, `<id>.task.answer.<generation % 8>`.
//! - A task's requests are owned as any request of the call that sent it ([`Host::try_fetch`]): what it sends before
//!   its first wait is its starting call's, what it sends after is the activation's, as the call that resumed it is
//!   a reply's, an answer's or a wake's.
//! - A request a mount owns is cancelled when that mount closes before its reply: its wait goes on once, with the
//!   error [`CANCELLED`], and no reply comes after, also when the mount opens again.
//! - The plugin's disposal (it is disabled, fails, is replaced by a new build, or the client exits) drops every task:
//!   their destructors run, and none is polled again. A plugin has at most [`MAX_TASKS`] tasks at once; one more
//!   fails the call that spawns it.
//! - Two tasks interleave at their waits, as two TS `async` calls do.
//!
//! A plugin that never calls [`crate::Setup::tasks`] registers none of this and pays nothing.

use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, HashMap, VecDeque};
use std::future::Future;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::pin::Pin;
use std::rc::{Rc, Weak};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::task::{Context, Poll, Wake};
use std::thread::ThreadId;

use serde_json::Value;

use crate::{
    Action, Alert, Command, Confirm, Dialog, Fetch, Foreground, Host, Prompt, RequestId, Select, SelectOption, Setup,
    Spawner,
};

/// The most tasks a plugin has at once.
pub const MAX_TASKS: usize = 256;

/// The error of a [`Cx::fetch`] or [`Cx::foreground`] whose mount closed before its reply came: the host cancelled the
/// request ([`crate::Setup::on_cancelled`]).
pub const CANCELLED: &str = "cancelled";

/// Starts the plugin's tasks; from [`crate::Setup::tasks`].
#[derive(Clone)]
pub struct Tasks {
    shared: Weak<Shared>,
}

impl Tasks {
    /// Starts `task` with its [`Cx`], and polls it in this call until it first waits; `task` itself runs with `host`
    /// lent to the `Cx`. Called from a task, it starts once the running task waits.
    pub fn spawn<F: Future<Output = ()> + 'static>(&self, host: &dyn Host, task: impl FnOnce(Cx) -> F) {
        let Some(shared) = self.shared.upgrade() else { return };
        let cx = Cx { shared: self.shared.clone() };
        shared.enter(host, |shared| shared.spawn(Box::pin(task(cx))));
    }
}

/// How many generations of dialogs have a command of their own: the answer of a dialog reaches its task only through
/// the command of its generation, so an answer still on its way when the next dialog opens reaches nobody.
const ANSWERS: u64 = 8;

/// The most [`Cx::blocking`] threads a plugin runs at once.
pub const MAX_THREADS: usize = 4;

/// The host of a task: each method runs on the [`Host`] of the call that polls the task. See the [module](self).
#[derive(Clone)]
pub struct Cx {
    shared: Weak<Shared>,
}

impl Cx {
    /// Shows `select` and waits for the value of the option picked, or `None` when it closed without one. Its
    /// `action` is the task's, and it has no `key`: a keyed select stays open after a pick.
    pub fn select(&self, select: Select) -> Wait<Option<String>> {
        self.ask(|action| Dialog::Select(Select { action, key: None, ..select }))
    }

    /// Shows `prompt` and waits for its text, or `None` when it closed without one. Its `action` is the task's.
    pub fn prompt(&self, prompt: Prompt) -> Wait<Option<String>> {
        self.ask(|action| Dialog::Prompt(Prompt { action, ..prompt }))
    }

    /// Shows `confirm` and waits for its answer: `true` for its confirm button, `false` for its cancel button or
    /// escape, and `None` when another dialog replaced it. Its `action` is the task's.
    pub fn confirm(&self, confirm: Confirm) -> impl Future<Output = Option<bool>> + 'static {
        let answer = self.ask(|action| Dialog::Confirm(Confirm { action, ..confirm }));
        async move { answer.await.map(|value| value == "true") }
    }

    /// Shows `alert` and waits until it closes, however it closes. Its `action` does not run.
    pub fn alert(&self, alert: Alert) -> impl Future<Output = ()> + 'static {
        let closed = self.ask(|_| Dialog::Alert(Alert { action: None, ..alert }));
        async move {
            closed.await;
        }
    }

    /// Sends `fetch` and waits for its reply ([`Host::try_fetch`]): its body, or the error. A fetch the host did not
    /// take is that error at once; one its mount's close cancelled is [`CANCELLED`].
    pub fn fetch(&self, fetch: Fetch) -> Wait<Result<Value, String>> {
        self.request(|host| host.try_fetch(fetch))
    }

    /// Gives the terminal to `program` and waits until it exits ([`Host::try_foreground`]): `{ "code": … }`, or the
    /// error.
    pub fn foreground(&self, program: Foreground) -> Wait<Result<Value, String>> {
        self.request(|host| host.try_foreground(program))
    }

    /// Runs `run` on a thread of the plugin's ([`Spawner`]) and waits for its value, as decoding a large reply off the
    /// UI thread does. At most [`MAX_THREADS`] run at once a plugin; a later `run` waits for one of them to be free,
    /// and one that has not started when the plugin is disposed never runs. A panic on it fails the plugin. On a host
    /// that offers no [`crate::Waker`], or when no thread starts and none runs, `run` runs here, at once.
    pub fn blocking<T: Send + 'static>(
        &self,
        run: impl FnOnce() -> T + Send + 'static,
    ) -> impl Future<Output = T> + 'static {
        let shared = self.shared();
        let slot = Arc::new(Mutex::new(Done { value: None, waker: None }));
        if shared.queue.host.is_none() {
            lock(&slot).value = Some(run());
            return Blocking { slot };
        }
        let done = slot.clone();
        let job = move || {
            let value = run();
            let waker = {
                let mut done = lock(&done);
                done.value = Some(value);
                done.waker.take()
            };
            waker.into_iter().for_each(std::task::Waker::wake);
        };
        shared.pool.run(&shared.spawner, Box::new(job));
        Blocking { slot }
    }

    /// Starts another task, which runs once this one waits.
    pub fn spawn<F: Future<Output = ()> + 'static>(&self, task: impl FnOnce(Cx) -> F) {
        self.with(|_| ());
        let future = task(self.clone());
        self.shared().spawn(Box::pin(future));
    }

    /// Opens the dialog `dialog` builds around the task's answer action, so that its answer or its close goes to the
    /// task; a dialog of an earlier wait closes with no answer first. The answer action is the command of the dialog's
    /// generation ([`ANSWERS`]), and its close names the generation, so neither reaches a later dialog.
    fn ask(&self, dialog: impl FnOnce(Action) -> Dialog) -> Wait<Option<String>> {
        let shared = self.shared();
        let slot = Slot::new();
        let generation = shared.generation.get() + 1;
        let answer = Action::command(format!("{}.{}", shared.answer, generation % ANSWERS));
        let dismissed = Action::command(&shared.closed).input(generation.to_string());
        self.with(|host| host.dialog(Dialog::Dismissable { dialog: Box::new(dialog(answer)), dismissed }));
        shared.generation.set(generation);
        let earlier = shared.dialog.replace(Some((generation, slot.clone())));
        if let Some((_, earlier)) = earlier {
            earlier.fill(None);
        }
        Wait { slot }
    }

    fn request(&self, send: impl FnOnce(&dyn Host) -> Result<RequestId, String>) -> Wait<Result<Value, String>> {
        let slot = Slot::new();
        match self.with(send) {
            Ok(id) => {
                // The table holds what a wait still waits for: a wait dropped before its reply leaves no entry.
                let shared = self.shared();
                let mut replies = shared.replies.borrow_mut();
                replies.retain(|_, waiting| waiting.strong_count() > 0);
                replies.insert(id, Rc::downgrade(&slot));
            }
            Err(error) => slot.fill(Err(error)),
        }
        Wait { slot }
    }

    fn shared(&self) -> Rc<Shared> {
        self.shared.upgrade().expect("a task's Cx was used after its plugin was disposed")
    }

    /// Runs `f` with the [`Host`] of the call that polls the task: its reads and its verbs.
    ///
    /// The host is lent to `f` alone. `f` is a plain closure, so it cannot `.await`, and the host's lifetime is `f`'s
    /// own, so neither the host nor a borrow of it can be returned, kept in the task, or held across a wait, after which
    /// another call's host is the task's. A `Cx` kept in the plugin's state and used outside a poll, or after the
    /// plugin was disposed, panics here instead.
    ///
    /// ```compile_fail,E0521
    /// # use opencode_plugin_abi::{Host, task::Cx};
    /// async fn kept(cx: Cx) {
    ///     let mut kept: Option<&dyn Host> = None;
    ///     cx.with(|host| kept = Some(host));
    /// }
    /// ```
    pub fn with<R>(&self, f: impl FnOnce(&dyn Host) -> R) -> R {
        let shared = self.shared();
        let host = shared.host.get().expect(
            "a task's Cx was used outside its task: it reaches the host only while the task is polled, not from a \
             plain handler or a render",
        );
        // SAFETY: `enter` sets the pointer to the host of the call it runs in, and clears it as it returns or unwinds,
        // before that call's host can go; the reference does not leave `f`.
        f(unsafe { &*host })
    }
}

/// Waits for several futures and gives their outputs in their order, once all are done.
pub fn join_all<F: Future>(futures: impl IntoIterator<Item = F>) -> JoinAll<F> {
    let futures: Vec<_> = futures.into_iter().map(|future| Some(Box::pin(future))).collect();
    let outputs = futures.iter().map(|_| None).collect();
    JoinAll { futures, outputs }
}

/// The future of [`join_all`].
pub struct JoinAll<F: Future> {
    futures: Vec<Option<Pin<Box<F>>>>,
    outputs: Vec<Option<F::Output>>,
}

// The futures are boxed and the outputs are never pinned.
impl<F: Future> Unpin for JoinAll<F> {}

impl<F: Future> Future for JoinAll<F> {
    type Output = Vec<F::Output>;

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        let this = self.get_mut();
        for (future, output) in this.futures.iter_mut().zip(&mut this.outputs) {
            if let Some(running) = future
                && let Poll::Ready(value) = running.as_mut().poll(cx)
            {
                *output = Some(value);
                *future = None;
            }
        }
        if this.futures.iter().any(Option::is_some) {
            return Poll::Pending;
        }
        Poll::Ready(this.outputs.iter_mut().map(|output| output.take().expect("a joined output")).collect())
    }
}

/// A wait of [`Cx`]: a dialog's answer or a request's reply.
pub struct Wait<T> {
    slot: Rc<Slot<T>>,
}

impl<T> Future for Wait<T> {
    type Output = T;

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<T> {
        let mut state = self.slot.0.borrow_mut();
        match state.value.take() {
            Some(value) => Poll::Ready(value),
            None => {
                state.waker = Some(cx.waker().clone());
                Poll::Pending
            }
        }
    }
}

/// Where an answer waits for its task, on the UI thread.
struct Slot<T>(RefCell<Done<T>>);

struct Done<T> {
    value: Option<T>,
    waker: Option<std::task::Waker>,
}

impl<T> Slot<T> {
    fn new() -> Rc<Self> {
        Rc::new(Self(RefCell::new(Done { value: None, waker: None })))
    }

    fn fill(&self, value: T) {
        let waker = {
            let mut state = self.0.borrow_mut();
            state.value = Some(value);
            state.waker.take()
        };
        waker.into_iter().for_each(std::task::Waker::wake);
    }
}

/// The future of [`Cx::blocking`].
struct Blocking<T> {
    slot: Arc<Mutex<Done<T>>>,
}

impl<T> Future for Blocking<T> {
    type Output = T;

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<T> {
        let mut done = lock(&self.slot);
        match done.value.take() {
            Some(value) => Poll::Ready(value),
            None => {
                done.waker = Some(cx.waker().clone());
                Poll::Pending
            }
        }
    }
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

impl Select {
    /// A select of `options` titled `title`, for [`Cx::select`], which gives it its action.
    pub fn ask(title: impl Into<String>, options: Vec<SelectOption>) -> Self {
        Self::new(title, options, Action::command(""))
    }
}

impl Prompt {
    /// A text field under `title`, for [`Cx::prompt`], which gives it its action.
    pub fn ask(title: impl Into<String>) -> Self {
        Self::new(title, Action::command(""))
    }
}

impl Confirm {
    /// A question, for [`Cx::confirm`], which gives it its action.
    pub fn ask(title: impl Into<String>, message: impl Into<String>) -> Self {
        Self::new(title, message, Action::command(""))
    }
}

/// The plugin's tasks and what they wait for, which the handlers [`register`] holds.
pub(crate) struct Shared {
    /// The hidden commands a task's dialog runs: with its answer, one a generation modulo [`ANSWERS`] (`<answer>.<n>`),
    /// and as it closes, with its generation.
    answer: String,
    closed: String,
    tasks: RefCell<BTreeMap<u64, Task>>,
    next: Cell<u64>,
    /// The tasks spawned and not done, the one being polled included.
    live: Cell<usize>,
    queue: Arc<Queue>,
    /// The host of the call that polls, while it does.
    host: Cell<Option<*const (dyn Host + 'static)>>,
    /// The dialog a task waits on, by generation.
    dialog: RefCell<Option<(u64, Rc<Slot<Answer>>)>>,
    generation: Cell<u64>,
    replies: RefCell<HashMap<RequestId, Weak<Slot<Reply>>>>,
    spawner: Spawner,
    pool: Arc<Pool>,
    disposed: Cell<bool>,
}

/// A job of [`Cx::blocking`].
type Job = Box<dyn FnOnce() + Send>;

/// The plugin's [`Cx::blocking`] threads: at most [`MAX_THREADS`], each running the jobs that wait, in order, until
/// none waits.
#[derive(Default)]
struct Pool {
    state: Mutex<Jobs>,
    /// The plugin's tasks were dropped: the jobs that wait never run.
    closed: AtomicBool,
}

#[derive(Default)]
struct Jobs {
    waiting: VecDeque<Job>,
    threads: usize,
}

impl Pool {
    /// Runs `job` on a thread of the pool: a new one while fewer than [`MAX_THREADS`] run, else the next one free.
    /// When no thread starts and none runs, the jobs that wait run here.
    fn run(self: &Arc<Self>, spawner: &Spawner, job: Job) {
        let start = {
            let mut jobs = lock(&self.state);
            jobs.waiting.push_back(job);
            let start = jobs.threads < MAX_THREADS;
            jobs.threads += usize::from(start);
            start
        };
        let pool = self.clone();
        if !start || spawner.spawn("blocking", move |_| pool.work()).is_ok() {
            return;
        }
        let stranded = {
            let mut jobs = lock(&self.state);
            jobs.threads -= 1;
            if jobs.threads == 0 { std::mem::take(&mut jobs.waiting) } else { VecDeque::new() }
        };
        stranded.into_iter().for_each(|job| job());
    }

    /// A thread's loop: the next job that waits, until none does, or the plugin's tasks were dropped.
    fn work(&self) {
        loop {
            let job = {
                let mut jobs = lock(&self.state);
                if self.closed.load(Ordering::SeqCst) {
                    jobs.waiting.clear();
                }
                match jobs.waiting.pop_front() {
                    Some(job) => job,
                    None => {
                        jobs.threads -= 1;
                        return;
                    }
                }
            };
            job();
        }
    }
}

/// A dialog's answer: what it was given, or `None` when it closed without one.
type Answer = Option<String>;
/// A request's reply.
type Reply = Result<Value, String>;

struct Task {
    future: Pin<Box<dyn Future<Output = ()>>>,
    wake: Arc<TaskWake>,
}

/// The tasks that are ready, which a waker on any thread adds to.
struct Queue {
    ready: Mutex<VecDeque<u64>>,
    /// The thread that polls, while one does: a wake on it is seen by that poll.
    polling: Mutex<Option<ThreadId>>,
    /// Wakes the host from elsewhere, so that its wake polls the task.
    host: Option<crate::Waker>,
}

struct TaskWake {
    id: u64,
    queued: AtomicBool,
    queue: Arc<Queue>,
}

impl Wake for TaskWake {
    fn wake(self: Arc<Self>) {
        self.wake_by_ref();
    }

    fn wake_by_ref(self: &Arc<Self>) {
        if self.queued.swap(true, Ordering::SeqCst) {
            return;
        }
        lock(&self.queue.ready).push_back(self.id);
        let seen = *lock(&self.queue.polling) == Some(std::thread::current().id());
        if !seen && let Some(host) = &self.queue.host {
            host.wake();
        }
    }
}

/// Registers the plugin's tasks on `setup`: the hidden commands, a reply and a cancel handler, a wake handler and a
/// dispose callback.
pub(crate) fn register(setup: &mut Setup) -> Rc<Shared> {
    let id = setup.id().to_owned();
    let queue = Queue { ready: Mutex::new(VecDeque::new()), polling: Mutex::new(None), host: setup.waker() };
    let shared = Rc::new(Shared {
        answer: format!("{id}.task.answer"),
        closed: format!("{id}.task.closed"),
        tasks: RefCell::new(BTreeMap::new()),
        next: Cell::new(0),
        live: Cell::new(0),
        queue: Arc::new(queue),
        host: Cell::new(None),
        dialog: RefCell::new(None),
        generation: Cell::new(0),
        replies: RefCell::new(HashMap::new()),
        spawner: setup.spawner(),
        pool: Arc::default(),
        disposed: Cell::new(false),
    });
    // An answer reaches the dialog that waits only through the command of its generation: one still on its way from
    // an earlier dialog, which a later one replaced, is no answer to the later one.
    for at in 0..ANSWERS {
        let answered = shared.clone();
        setup.command(Command::new(format!("{}.{at}", shared.answer)), move |host, input| {
            answered.enter(host, |shared| {
                let waiting = shared.dialog.borrow().as_ref().is_some_and(|(generation, _)| generation % ANSWERS == at);
                if waiting && let Some((_, slot)) = shared.dialog.take() {
                    slot.fill(Some(input.unwrap_or_default().to_owned()));
                }
            });
        });
    }
    // A close names its dialog's generation: it is a close with no answer only while that dialog still waits.
    let closed = shared.clone();
    setup.command(Command::new(shared.closed.clone()), move |host, input| {
        closed.enter(host, |shared| {
            let generation = input.and_then(|input| input.parse::<u64>().ok());
            let waiting = shared.dialog.borrow().as_ref().is_some_and(|(at, _)| Some(*at) == generation);
            if waiting && let Some((_, slot)) = shared.dialog.take() {
                slot.fill(None);
            }
        });
    });
    let replied = shared.clone();
    setup.on_reply(move |host, id, reply| {
        replied.enter(host, |shared| {
            let slot = shared.replies.borrow_mut().remove(&id).and_then(|slot| slot.upgrade());
            if let Some(slot) = slot {
                slot.fill(reply);
            }
        });
    });
    // A request its mount's close cancelled gets no reply: its wait gets [`CANCELLED`] in its place, once.
    let cancelled = shared.clone();
    setup.on_cancelled(move |host, id| {
        cancelled.enter(host, |shared| {
            let slot = shared.replies.borrow_mut().remove(&id).and_then(|slot| slot.upgrade());
            if let Some(slot) = slot {
                slot.fill(Err(CANCELLED.to_owned()));
            }
        });
    });
    let woken = shared.clone();
    setup.on_wake(move |host| woken.enter(host, |_| {}));
    let disposed = shared.clone();
    setup.on_dispose(move |host| disposed.dispose(host));
    shared
}

/// The handle of [`crate::Setup::tasks`].
pub(crate) fn tasks(shared: &Rc<Shared>) -> Tasks {
    Tasks { shared: Rc::downgrade(shared) }
}

impl Shared {
    fn spawn(&self, future: Pin<Box<dyn Future<Output = ()>>>) {
        if self.disposed.get() {
            return;
        }
        if self.live.get() >= MAX_TASKS {
            panic!("a plugin has at most {MAX_TASKS} tasks at once: one more was spawned");
        }
        let id = self.next.get();
        self.next.set(id + 1);
        self.live.set(self.live.get() + 1);
        let wake = Arc::new(TaskWake { id, queued: AtomicBool::new(true), queue: self.queue.clone() });
        self.tasks.borrow_mut().insert(id, Task { future, wake });
        lock(&self.queue.ready).push_back(id);
    }

    /// Runs `deliver` and polls the tasks that are ready until none is, with `host` as their host. Inside a poll (a
    /// task that spawns), it only delivers: the poll that runs goes on with what is ready.
    fn enter(&self, host: &dyn Host, deliver: impl FnOnce(&Self)) {
        if self.host.get().is_some() {
            return deliver(self);
        }
        let _polling = Polling::new(self, host);
        deliver(self);
        self.poll();
    }

    fn poll(&self) {
        while !self.disposed.get() {
            let Some(id) = lock(&self.queue.ready).pop_front() else { return };
            let Some(mut task) = self.tasks.borrow_mut().remove(&id) else { continue };
            task.wake.queued.store(false, Ordering::SeqCst);
            let waker = std::task::Waker::from(task.wake.clone());
            match task.future.as_mut().poll(&mut Context::from_waker(&waker)) {
                Poll::Ready(()) => self.live.set(self.live.get() - 1),
                Poll::Pending => drop(self.tasks.borrow_mut().insert(id, task)),
            }
        }
    }

    /// Drops every task, with `host` as the host of their destructors, and takes no more.
    fn dispose(&self, host: &dyn Host) {
        let _polling = Polling::new(self, host);
        self.abandon();
    }

    /// Drops every task and takes no more. Each task drops on its own inside a catch, so a destructor that panics, such
    /// as one that uses its `Cx` with no host lent (a failed plugin's teardown), leaves the others to drop and never
    /// unwinds into the host.
    pub(crate) fn abandon(&self) {
        self.disposed.set(true);
        self.pool.closed.store(true, Ordering::SeqCst);
        let tasks = std::mem::take(&mut *self.tasks.borrow_mut());
        for task in tasks.into_values() {
            let _ = catch_unwind(AssertUnwindSafe(|| drop(task)));
        }
        self.replies.borrow_mut().clear();
        self.dialog.take();
        self.live.set(0);
    }
}

impl Drop for Shared {
    /// The plugin's registrations went without a dispose or an abandon: its tasks drop as [`Shared::abandon`] drops
    /// them.
    fn drop(&mut self) {
        self.abandon();
    }
}

/// Lends the call's host to the tasks it polls, until it drops, also on a panic.
struct Polling<'a> {
    shared: &'a Shared,
}

impl<'a> Polling<'a> {
    fn new(shared: &'a Shared, host: &dyn Host) -> Self {
        // SAFETY: only the lifetime is erased. The pointer is read only by `Cx::with`, while this guard lives, inside
        // the call that lent `host`; the guard clears it as it drops.
        let host = unsafe { std::mem::transmute::<*const (dyn Host + '_), *const (dyn Host + 'static)>(host) };
        shared.host.set(Some(host));
        *lock(&shared.queue.polling) = Some(std::thread::current().id());
        Self { shared }
    }
}

impl Drop for Polling<'_> {
    fn drop(&mut self) {
        self.shared.host.set(None);
        *lock(&self.shared.queue.polling) = None;
    }
}

#[cfg(test)]
mod tests {
    use std::panic::{AssertUnwindSafe, catch_unwind};
    use std::sync::atomic::AtomicUsize;
    use std::time::{Duration, Instant};

    use super::*;
    use crate::{Attention, Read, Registered, Rgba, Route, ThemeMode, Toast, Variant};

    /// A host that records the dialogs and toasts it is asked for, and numbers the fetches from 1.
    #[derive(Default)]
    struct Fake {
        dialogs: RefCell<Vec<Dialog>>,
        fetches: Cell<u64>,
        toasts: RefCell<Vec<String>>,
    }

    impl Read for Fake {
        fn theme_mode(&self) -> ThemeMode {
            ThemeMode::Dark
        }
        fn color(&self, _: &str) -> Option<Rgba> {
            None
        }
    }

    impl Host for Fake {
        fn storage_set(&self, _: &str, _: Value) {}
        fn dispatch(&self, _: &str, _: Option<&str>) {}
        fn toast(&self, toast: Toast) {
            self.toasts.borrow_mut().push(toast.message);
        }
        fn attention(&self, _: Attention) {}
        fn open_route(&self, _: &str) {}
        fn navigate(&self, _: Route) {}
        fn try_fetch(&self, _: Fetch) -> Result<RequestId, String> {
            self.fetches.set(self.fetches.get() + 1);
            Ok(RequestId(self.fetches.get()))
        }
        fn dialog(&self, dialog: Dialog) {
            self.dialogs.borrow_mut().push(dialog);
        }
        fn copy(&self, _: &str, _: Option<Action>) {}
    }

    impl Fake {
        /// The generation the last dialog's close names.
        fn generation(&self) -> String {
            match self.dialogs.borrow().last() {
                Some(Dialog::Dismissable { dismissed: Action::Command { input, .. }, .. }) => input.clone().unwrap(),
                other => panic!("no dismissable dialog: {other:?}"),
            }
        }
    }

    /// A plugin whose setup took its tasks, with a waker that counts the host's wakes.
    fn plugin() -> (Registered, Tasks, Arc<AtomicUsize>) {
        let mut registered = Registered::new("t", None);
        let woken = Arc::new(AtomicUsize::new(0));
        let counted = woken.clone();
        registered.set_waker(crate::Waker::new(move || {
            counted.fetch_add(1, Ordering::SeqCst);
        }));
        let tasks = registered.setup().tasks();
        (registered, tasks, woken)
    }

    fn run(registered: &Registered, host: &Fake, name: &str, input: Option<&str>) {
        let name = format!("t.task.{name}");
        let (_, command) = registered.commands().find(|(command, _)| command.name == name).unwrap();
        command(host, input);
    }

    /// Answers dialog `at` of those the host was asked for with `value`, through the action the dialog carries, as the
    /// host does.
    fn answer(registered: &Registered, host: &Fake, at: usize, value: &str) {
        let action = match &host.dialogs.borrow()[at] {
            Dialog::Dismissable { dialog, .. } => match &**dialog {
                Dialog::Select(select) => select.action.clone(),
                Dialog::Prompt(prompt) => prompt.action.clone(),
                Dialog::Confirm(confirm) => confirm.action.clone(),
                other => panic!("dialog {at} takes no answer: {other:?}"),
            },
            other => panic!("dialog {at} is not dismissable: {other:?}"),
        };
        let Action::Command { name, .. } = action;
        let (_, command) = registered.commands().find(|(command, _)| command.name == name).unwrap();
        command(host, Some(value));
    }

    fn reply(registered: &Registered, host: &Fake, id: u64, result: Result<Value, String>) {
        registered.replies().iter().for_each(|run| run(host, RequestId(id), result.clone()));
    }

    type Log = Rc<RefCell<Vec<String>>>;

    /// Counts the polls of a task.
    struct Counted {
        future: Pin<Box<dyn Future<Output = ()>>>,
        polls: Rc<Cell<u32>>,
    }

    impl Future for Counted {
        type Output = ();
        fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<()> {
            self.polls.set(self.polls.get() + 1);
            self.future.as_mut().poll(cx)
        }
    }

    #[test]
    fn a_reply_polls_only_the_task_that_waits_for_it() {
        let (registered, tasks, woken) = plugin();
        let host = Fake::default();
        let log = Log::default();
        let polls: Vec<_> = ["a", "b"]
            .into_iter()
            .map(|name| {
                let (polls, log) = (Rc::new(Cell::new(0)), log.clone());
                let counted = polls.clone();
                tasks.spawn(&host, move |cx| Counted {
                    future: Box::pin(async move {
                        let reply = cx.fetch(Fetch::new("GET", "/x")).await;
                        log.borrow_mut().push(format!("{name} {reply:?}"));
                    }),
                    polls: counted,
                });
                polls
            })
            .collect();
        let counts = || [polls[0].get(), polls[1].get()];
        assert_eq!(counts(), [1, 1], "each task ran to its wait");
        reply(&registered, &host, 2, Ok(Value::from(2)));
        assert_eq!(counts(), [1, 2], "the reply polled its task alone");
        reply(&registered, &host, 1, Err("boom".to_owned()));
        assert_eq!(*log.borrow(), ["b Ok(Number(2))", "a Err(\"boom\")"]);
        // A reply no task waits for polls none.
        reply(&registered, &host, 9, Ok(Value::Null));
        assert_eq!(counts(), [2, 2]);
        // A wake on the thread that polls is seen by that poll: the host was not woken for one.
        assert_eq!(woken.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn a_cancelled_request_gives_its_wait_the_cancel_once() {
        let (registered, tasks, _) = plugin();
        let host = Fake::default();
        let log = Log::default();
        for name in ["a", "b"] {
            let log = log.clone();
            tasks.spawn(&host, move |cx| async move {
                let reply = cx.fetch(Fetch::new("GET", "/x")).await;
                log.borrow_mut().push(format!("{name} {reply:?}"));
            });
        }
        let cancel = |id| registered.cancelled().iter().for_each(|run| run(&host, RequestId(id)));
        assert!(registered.manifest().cancelled, "the tasks did not ask to hear of a cancel");
        cancel(1);
        assert_eq!(*log.borrow(), ["a Err(\"cancelled\")"]);
        // Neither a second cancel nor the reply reaches it after; the other task waits on.
        cancel(1);
        reply(&registered, &host, 1, Ok(Value::Null));
        assert_eq!(*log.borrow(), ["a Err(\"cancelled\")"]);
        reply(&registered, &host, 2, Ok(Value::from(2)));
        assert_eq!(*log.borrow(), ["a Err(\"cancelled\")", "b Ok(Number(2))"]);
        // A cancel after the reply reaches nothing.
        cancel(2);
        assert_eq!(log.borrow().len(), 2);
        // The plain reply handlers never hear a cancel: the plugin's own `on_reply` sees only replies.
        assert_eq!(registered.replies().len(), 1);
    }

    #[test]
    fn a_dialog_that_closes_without_an_answer_gives_none() {
        let (registered, tasks, _) = plugin();
        let host = Fake::default();
        let log = Log::default();
        let into = log.clone();
        tasks.spawn(&host, move |cx| async move {
            let options = vec![SelectOption::new("A", "a"), SelectOption::new("B", "b")];
            let escaped = cx.select(Select::ask("Pick", options.clone())).await;
            let picked = cx.select(Select::ask("Pick", options)).await;
            let typed = cx.prompt(Prompt::ask("Name")).await;
            let declined = cx.confirm(Confirm::ask("Sure?", "Really?")).await;
            into.borrow_mut().push(format!("{escaped:?} {picked:?} {typed:?} {declined:?}"));
            cx.alert(Alert::new("Done", "done")).await;
            into.borrow_mut().push("alert closed".to_owned());
        });
        let first = host.generation();
        run(&registered, &host, "closed", Some(&first));
        // An answer runs its action, then its close: the close of a dialog that answered is no escape.
        let second = host.generation();
        answer(&registered, &host, 1, "b");
        run(&registered, &host, "closed", Some(&second));
        // A close of an earlier dialog, late, is not this one's.
        run(&registered, &host, "closed", Some(&first));
        answer(&registered, &host, 2, "Ada");
        answer(&registered, &host, 3, "false");
        assert_eq!(*log.borrow(), ["None Some(\"b\") Some(\"Ada\") Some(false)"]);
        assert!(
            matches!(&host.dialogs.borrow()[4], Dialog::Dismissable { dialog, .. } if matches!(**dialog, Dialog::Alert(_)))
        );
        run(&registered, &host, "closed", Some(&host.generation()));
        assert_eq!(log.borrow().last().unwrap(), "alert closed");
        // The dialogs ran the task's command, whatever action they were built with.
        let Dialog::Dismissable { dialog, .. } = &host.dialogs.borrow()[0] else { panic!() };
        let Dialog::Select(select) = &**dialog else { panic!() };
        assert_eq!(select.action, Action::command("t.task.answer.1"));
    }

    #[test]
    fn a_dialog_another_task_replaces_gives_none() {
        let (registered, tasks, _) = plugin();
        let host = Fake::default();
        let log = Log::default();
        for name in ["first", "second"] {
            let log = log.clone();
            tasks.spawn(&host, move |cx| async move {
                let answer = cx.prompt(Prompt::ask(name)).await;
                log.borrow_mut().push(format!("{name} {answer:?}"));
            });
        }
        assert_eq!(*log.borrow(), ["first None"]);
        // The replaced dialog's own close comes later, and is not the second's.
        run(&registered, &host, "closed", Some("1"));
        answer(&registered, &host, 1, "x");
        assert_eq!(*log.borrow(), ["first None", "second Some(\"x\")"]);
    }

    #[test]
    fn join_all_gives_every_output_in_order() {
        let (registered, tasks, _) = plugin();
        let host = Fake::default();
        let log = Log::default();
        let into = log.clone();
        tasks.spawn(&host, move |cx| async move {
            let replies = join_all((0..3).map(|_| cx.fetch(Fetch::new("GET", "/x")))).await;
            into.borrow_mut().push(format!("{replies:?}"));
        });
        assert_eq!(host.fetches.get(), 3, "the fetches went out at once");
        for id in [3, 1] {
            reply(&registered, &host, id, Ok(Value::from(id)));
            assert!(log.borrow().is_empty());
        }
        reply(&registered, &host, 2, Err("two".to_owned()));
        assert_eq!(*log.borrow(), ["[Ok(Number(1)), Err(\"two\"), Ok(Number(3))]"]);
    }

    /// Records its drop, and toasts with its task's host as it drops.
    struct Guard(Cx, Log);

    impl Drop for Guard {
        fn drop(&mut self) {
            self.0.with(|host| host.toast(Toast::new(Variant::Info, "dropped")));
            self.1.borrow_mut().push("dropped".to_owned());
        }
    }

    #[test]
    fn disposing_drops_the_parked_tasks_and_polls_none_after() {
        let (mut registered, tasks, _) = plugin();
        let host = Fake::default();
        let log = Log::default();
        let into = log.clone();
        tasks.spawn(&host, move |cx| async move {
            let _guard = Guard(cx.clone(), into.clone());
            let reply = cx.fetch(Fetch::new("GET", "/x")).await;
            into.borrow_mut().push(format!("{reply:?}"));
        });
        registered.dispose(Some(&host));
        assert_eq!(*log.borrow(), ["dropped"]);
        assert_eq!(*host.toasts.borrow(), ["dropped"], "a destructor has the dispose's host");
        reply(&registered, &host, 1, Ok(Value::Null));
        let spawned = log.clone();
        tasks.spawn(&host, move |_| async move { spawned.borrow_mut().push("spawned".to_owned()) });
        assert_eq!(*log.borrow(), ["dropped"], "a disposed plugin polls no task");
        drop(registered);
        let after = log.clone();
        tasks.spawn(&host, move |_| async move { after.borrow_mut().push("after".to_owned()) });
        assert_eq!(*log.borrow(), ["dropped"]);
    }

    #[test]
    fn a_cx_outside_its_task_fails_the_call() {
        let (registered, tasks, _) = plugin();
        let host = Fake::default();
        let kept = Rc::new(RefCell::new(None));
        let into = kept.clone();
        tasks.spawn(&host, move |cx| async move {
            *into.borrow_mut() = Some(cx.clone());
            drop(cx.fetch(Fetch::new("GET", "/x")).await);
        });
        let cx = kept.borrow().clone().unwrap();
        let failed = catch_unwind(AssertUnwindSafe(|| cx.with(|host| host.toast(Toast::new(Variant::Info, "late")))))
            .unwrap_err();
        assert!(crate::panic_message(&*failed).contains("outside its task"), "{}", crate::panic_message(&*failed));
        assert!(host.toasts.borrow().is_empty());
        // The task itself goes on.
        reply(&registered, &host, 1, Ok(Value::Null));
    }

    #[test]
    fn the_spawn_past_the_most_tasks_fails() {
        let (_registered, tasks, _) = plugin();
        let host = Fake::default();
        for _ in 0..MAX_TASKS {
            tasks.spawn(&host, |cx| async move { drop(cx.fetch(Fetch::new("GET", "/x")).await) });
        }
        let spawn = || tasks.spawn(&host, |_| async {});
        let failed = catch_unwind(AssertUnwindSafe(spawn)).unwrap_err();
        assert!(crate::panic_message(&*failed).contains("at most 256 tasks"), "{}", crate::panic_message(&*failed));
        assert_eq!(host.fetches.get(), MAX_TASKS as u64, "the task past them did not run");
    }

    #[test]
    fn a_task_that_ends_frees_its_place() {
        let (_registered, tasks, _) = plugin();
        let host = Fake::default();
        for _ in 0..MAX_TASKS + 1 {
            tasks.spawn(&host, |cx| async move { cx.with(|host| host.toast(Toast::new(Variant::Info, "done"))) });
        }
        assert_eq!(host.toasts.borrow().len(), MAX_TASKS + 1);
    }

    #[test]
    fn blocking_runs_on_a_thread_and_wakes_the_host() {
        let (registered, tasks, woken) = plugin();
        let host = Fake::default();
        let log = Log::default();
        let into = log.clone();
        tasks.spawn(&host, move |cx| async move {
            let thread = cx.blocking(|| std::thread::current().name().map(str::to_owned)).await;
            into.borrow_mut().push(format!("{thread:?}"));
        });
        let begun = Instant::now();
        while woken.load(Ordering::SeqCst) == 0 {
            assert!(begun.elapsed() < Duration::from_secs(10), "the thread never woke the host");
            std::thread::sleep(Duration::from_millis(1));
        }
        assert!(log.borrow().is_empty(), "the task waits for the host's wake");
        registered.wakes().iter().for_each(|wake| wake(&host));
        assert_eq!(*log.borrow(), ["Some(\"t:blocking\")"]);
    }

    #[test]
    fn blocking_without_a_waker_runs_at_once() {
        let mut registered = Registered::new("t", None);
        let tasks = registered.setup().tasks();
        let host = Fake::default();
        let log = Log::default();
        let into = log.clone();
        tasks.spawn(&host, move |cx| async move {
            let value = cx.blocking(|| 40 + 2).await;
            into.borrow_mut().push(value.to_string());
        });
        assert_eq!(*log.borrow(), ["42"]);
    }

    #[test]
    fn a_task_spawned_from_a_task_runs_once_that_one_waits() {
        let (registered, tasks, _) = plugin();
        let host = Fake::default();
        let log = Log::default();
        let into = log.clone();
        tasks.spawn(&host, move |cx| async move {
            let inner = into.clone();
            cx.spawn(move |cx| async move {
                inner.borrow_mut().push("inner".to_owned());
                drop(cx.fetch(Fetch::new("GET", "/inner")).await);
                inner.borrow_mut().push("inner replied".to_owned());
            });
            into.borrow_mut().push("outer".to_owned());
            drop(cx.fetch(Fetch::new("GET", "/outer")).await);
        });
        assert_eq!(*log.borrow(), ["outer", "inner"]);
        reply(&registered, &host, 2, Ok(Value::Null));
        assert_eq!(*log.borrow(), ["outer", "inner", "inner replied"]);
    }

    #[test]
    fn setup_registers_the_tasks_once() {
        let mut registered = Registered::new("t", None);
        let mut setup = registered.setup();
        drop((setup.tasks(), setup.tasks()));
        let names: Vec<_> = registered.commands().map(|(command, _)| command.name.clone()).collect();
        let answers = (0..ANSWERS).map(|at| format!("t.task.answer.{at}"));
        assert_eq!(names, answers.chain(["t.task.closed".to_owned()]).collect::<Vec<_>>());
        assert_eq!(registered.replies().len(), 1);
        assert!(registered.manifest().wake);
    }

    // Expected (carbon ar-1): an answer still on its way from a dialog that a later one replaced reaches neither: the
    // replaced dialog's task already went on with `None`, and the later dialog waits for its own answer.
    #[test]
    fn an_answer_reaches_only_the_dialog_it_answers() {
        let (registered, tasks, _) = plugin();
        let host = Fake::default();
        let log = Log::default();
        let (first, second) = (log.clone(), log.clone());
        tasks.spawn(&host, move |cx| async move {
            let answer = cx.confirm(Confirm::ask("Delete?", "Sure?")).await;
            first.borrow_mut().push(format!("confirm {answer:?}"));
        });
        // Another task opens its dialog before the host runs the confirm's answer, as a reply's task can.
        tasks.spawn(&host, move |cx| async move {
            let answer = cx.prompt(Prompt::ask("Name")).await;
            second.borrow_mut().push(format!("prompt {answer:?}"));
        });
        answer(&registered, &host, 0, "true");
        assert_eq!(*log.borrow(), ["confirm None"], "the confirm's answer reached the prompt");
        answer(&registered, &host, 1, "Ada");
        assert_eq!(*log.borrow(), ["confirm None", "prompt Some(\"Ada\")"]);
    }

    // Expected (carbon ar-1): a task's select has no key, so a pick closes it and answers the task.
    #[test]
    fn a_tasks_select_is_never_keyed() {
        let (_registered, tasks, _) = plugin();
        let host = Fake::default();
        tasks.spawn(&host, |cx| async move {
            drop(cx.select(Select::ask("Pick", vec![SelectOption::new("A", "a")]).key("rich")).await);
        });
        let Dialog::Dismissable { dialog, .. } = &host.dialogs.borrow()[0] else { panic!() };
        let Dialog::Select(select) = &**dialog else { panic!() };
        assert_eq!(select.key, None);
    }

    /// A task parked on a fetch whose two destructors use its `Cx`, as a guard that toasts does.
    fn guarded(tasks: &Tasks, host: &Fake, log: &Log) {
        for _ in 0..2 {
            let log = log.clone();
            tasks.spawn(host, move |cx| async move {
                let _guard = Guard(cx.clone(), log);
                drop(cx.fetch(Fetch::new("GET", "/x")).await);
            });
        }
    }

    // Expected (carbon ar-2): a failed plugin's abandon drops its tasks, each inside a catch: destructors that use
    // their `Cx` with no host fail alone, never unwind into the host, and nothing drops later outside a catch.
    #[test]
    fn abandoning_drops_the_tasks_under_a_catch() {
        let (mut registered, tasks, _) = plugin();
        let (host, log) = (Fake::default(), Log::default());
        guarded(&tasks, &host, &log);
        registered.abandon();
        assert!(log.borrow().is_empty(), "a destructor with no host lent ran on");
        reply(&registered, &host, 1, Ok(Value::Null));
        drop(registered);
        assert!(log.borrow().is_empty());
    }

    // Expected (carbon ar-2): registrations dropped with neither a dispose nor an abandon drop their tasks the same way.
    #[test]
    fn dropping_the_registrations_drops_the_tasks_under_a_catch() {
        let (registered, tasks, _) = plugin();
        let (host, log) = (Fake::default(), Log::default());
        guarded(&tasks, &host, &log);
        drop(registered);
        assert!(log.borrow().is_empty());
    }

    // Expected (carbon ar-3): the closure that builds a task runs with the host lent, as the task does.
    #[test]
    fn a_task_is_built_with_the_host_lent() {
        let (_registered, tasks, _) = plugin();
        let host = Fake::default();
        tasks.spawn(&host, |cx| {
            cx.with(|host| host.toast(Toast::new(Variant::Info, "built")));
            async {}
        });
        assert_eq!(*host.toasts.borrow(), ["built"]);
    }

    // Expected (carbon ar-3): a wait dropped before its reply leaves no entry behind; a reply to it reaches nobody.
    #[test]
    fn a_dropped_wait_leaves_no_entry() {
        let (registered, tasks, _) = plugin();
        let host = Fake::default();
        tasks.spawn(&host, |cx| async move {
            drop(cx.fetch(Fetch::new("GET", "/dropped")));
            drop(cx.fetch(Fetch::new("GET", "/kept")).await);
        });
        let replies = || registered.tasks.as_ref().unwrap().replies.borrow().len();
        assert_eq!(replies(), 1, "the dropped wait's entry stayed");
        reply(&registered, &host, 1, Ok(Value::Null));
        reply(&registered, &host, 2, Ok(Value::Null));
        assert_eq!(replies(), 0);
    }

    // Expected (carbon ar-3): at most MAX_THREADS blocking jobs run at once a plugin; the others wait their turn, and
    // every one gives its value.
    #[test]
    fn blocking_runs_at_most_its_threads_at_once() {
        let (registered, tasks, _) = plugin();
        let host = Fake::default();
        let (running, most) = (Arc::new(AtomicUsize::new(0)), Arc::new(AtomicUsize::new(0)));
        let log = Log::default();
        let (into, counted, top) = (log.clone(), running.clone(), most.clone());
        tasks.spawn(&host, move |cx| async move {
            let jobs = (0..MAX_THREADS + 3).map(|job| {
                let (running, most) = (counted.clone(), top.clone());
                cx.blocking(move || {
                    let now = running.fetch_add(1, Ordering::SeqCst) + 1;
                    most.fetch_max(now, Ordering::SeqCst);
                    std::thread::sleep(Duration::from_millis(30));
                    running.fetch_sub(1, Ordering::SeqCst);
                    job
                })
            });
            let done = join_all(jobs.collect::<Vec<_>>()).await;
            into.borrow_mut().push(format!("{done:?}"));
        });
        let begun = Instant::now();
        while log.borrow().is_empty() {
            assert!(begun.elapsed() < Duration::from_secs(10), "the jobs never finished");
            std::thread::sleep(Duration::from_millis(5));
            registered.wakes().iter().for_each(|wake| wake(&host));
        }
        assert_eq!(*log.borrow(), [format!("{:?}", (0..MAX_THREADS + 3).collect::<Vec<_>>())]);
        let most = most.load(Ordering::SeqCst);
        assert!(most <= MAX_THREADS, "{most} blocking jobs ran at once");
    }
}
