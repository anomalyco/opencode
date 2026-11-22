//! [`Data`] runs the store: it owns the [`State`] behind a lock, with the tasks its requests run as, and shares both
//! across handles. The lock never crosses an `.await`; requests run on the runtime captured at construction, including
//! those issued on the UI thread.

use std::collections::HashMap;
use std::future::Future;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use futures_util::FutureExt;
use futures_util::future::{BoxFuture, Shared};
use opencode_api::client::Client;
use opencode_api::generated::{SessionInboxCompaction, V2Event};
use opencode_api::kinds::EventKinds;
use opencode_util::lock;
use tokio::runtime::Handle;
use tokio::sync::{broadcast, watch};
use tokio::task::AbortHandle;

use crate::changes::Dirty;
use crate::core::{Completion, Ticket};
use crate::reads::{Read, Start};
use crate::state::{Error, Options, State, is_tag, session_not_found};

mod requests;

use requests::Fetch;
pub use requests::{Gate, LoadMore, Prompt};

/// How many [`Data::signals`] events a slow receiver may fall behind. One batch may hold hundreds of a listened type
/// (a burst of `filesystem.changed`).
const SIGNALS: usize = 1024;
/// The most streaming deltas kept for the [`DeltaListening`]s; past that, the oldest go.
pub const DELTAS: usize = 4096;

/// A spawned request any number of callers can await.
pub type Task<T> = Shared<BoxFuture<'static, Result<T, Error>>>;

type ErrorHandler = Arc<dyn Fn(&Error) + Send + Sync>;

/// The store handle. Cheap to clone.
#[derive(Clone)]
pub struct Data {
    pub(crate) inner: Arc<Inner>,
}

pub(crate) struct Inner {
    pub(crate) client: Client,
    pub(crate) options: Options,
    runtime: Handle,
    store: Mutex<Store>,
    revision: watch::Sender<u64>,
    /// The events views act on themselves, sent after their batch is applied.
    pub(crate) signals: broadcast::Sender<Arc<V2Event>>,
    /// How many [`Listening`]s want each event kind on [`Data::signals`], by `kind as usize`.
    pub(crate) listened: [AtomicUsize; opencode_api::generated::EventKind::COUNT],
    /// How many [`Listening`]s want each name of the kinds a listener names (`EventKind::named`).
    pub(crate) named: Mutex<HashMap<String, usize>>,
    /// The streaming deltas kept for the [`DeltaListening`]s.
    pub(crate) deltas: Mutex<Deltas>,
    /// How many [`DeltaListening`]s live, as `deltas` counts them: a hint the hot path reads without the lock.
    pub(crate) delta_listeners: AtomicUsize,
    /// False while the event connection is not connected; follow-up reads are skipped then.
    pub(crate) online: AtomicBool,
    disposed: AtomicBool,
    on_error: Mutex<Option<ErrorHandler>>,
}

impl Data {
    /// A store on `client`. Must be called inside a tokio runtime, which runs its requests.
    pub fn new(client: Client, options: Options) -> Self {
        Self::with_runtime(client, options, Handle::current())
    }

    pub fn with_runtime(client: Client, options: Options, runtime: Handle) -> Self {
        let state = State::new(&options);
        Self {
            inner: Arc::new(Inner {
                client,
                options,
                runtime,
                store: Mutex::new(Store { state, tasks: Tasks::default() }),
                revision: watch::channel(0).0,
                signals: broadcast::channel(SIGNALS).0,
                listened: std::array::from_fn(|_| AtomicUsize::new(0)),
                named: Mutex::default(),
                deltas: Mutex::default(),
                delta_listeners: AtomicUsize::new(0),
                online: AtomicBool::new(true),
                disposed: AtomicBool::new(false),
                on_error: Mutex::new(None),
            }),
        }
    }

    pub fn client(&self) -> &Client {
        &self.inner.client
    }

    /// Receives failed event-driven reads (`onError`). Without it they are logged.
    pub fn on_error(&self, handler: impl Fn(&Error) + Send + Sync + 'static) {
        *lock(&self.inner.on_error) = Some(Arc::new(handler));
    }

    /// Stops follow-up reads, as disposing the TS owner does.
    pub fn dispose(&self) {
        self.inner.disposed.store(true, Ordering::SeqCst);
        self.write_tasks(|state, tasks| {
            for (_, token) in state.settling.drain() {
                if let Some(timer) = tasks.timers.remove(&token) {
                    timer.abort();
                }
            }
        });
    }

    /// Reads the state. Keep `f` short: it holds the store lock. A `read` inside `f` on the same thread reuses the
    /// outer guard, so code that runs under a read (a keymap condition during a row render) may read again.
    pub fn read<R>(&self, f: impl FnOnce(&State) -> R) -> R {
        self.read_tasks(|state, _| f(state))
    }

    /// [`Data::read`] with the tasks.
    #[allow(unsafe_code)]
    pub(crate) fn read_tasks<R>(&self, f: impl FnOnce(&State, &Tasks) -> R) -> R {
        let key = self.key();
        if let Some(store) = held(key) {
            assert!(!store.is_null(), "store read inside a store write on this thread");
            // SAFETY: the outer `read` on this thread holds the guard until this call returns, and lends only `&Store`.
            let store = unsafe { &*store };
            return f(&store.state, &store.tasks);
        }
        let guard = lock(&self.inner.store);
        let _held = Held::enter(key, &*guard);
        f(&guard.state, &guard.tasks)
    }

    /// The revision of the last flush.
    pub fn revision(&self) -> u64 {
        *self.inner.revision.borrow()
    }

    /// Wakes on every flush with its revision.
    pub fn subscribe(&self) -> watch::Receiver<u64> {
        self.inner.revision.subscribe()
    }

    /// Receives the events of each type a [`Listening`] wants, for the views that handle one themselves (`tui.*`,
    /// `session.deleted`) and the plugins' `on_event`, after the store applied their batch. Streaming deltas are never
    /// sent ([`DeltaListening::take`] has them). A receiver that falls behind skips the oldest.
    pub fn signals(&self) -> broadcast::Receiver<Arc<V2Event>> {
        self.inner.signals.subscribe()
    }

    /// Sends the events of each type in `kinds` on [`Data::signals`] until the returned guard drops.
    pub fn listen(&self, kinds: impl Into<EventKinds>) -> Listening {
        let kinds = kinds.into();
        let mut named = lock(&self.inner.named);
        for name in kinds.names() {
            *named.entry(name.clone()).or_default() += 1;
        }
        for index in kinds.indices() {
            self.inner.listened[index].fetch_add(1, Ordering::SeqCst);
        }
        Listening { inner: Arc::downgrade(&self.inner), kinds }
    }

    /// Keeps the streaming deltas (`session.*.delta`), which [`Data::signals`] never sends, for
    /// [`DeltaListening::take`] from now until the returned guard drops: at most [`DELTAS`] it has not taken, the
    /// oldest dropped past that. A batch that kept one wakes [`Data::subscribe`] also when it changed nothing.
    pub fn listen_deltas(&self) -> DeltaListening {
        let mut deltas = lock(&self.inner.deltas);
        let id = deltas.ids;
        deltas.ids += 1;
        let next = deltas.next;
        deltas.cursors.insert(id, next);
        self.inner.delta_listeners.store(deltas.cursors.len(), Ordering::SeqCst);
        DeltaListening { inner: Arc::downgrade(&self.inner), id }
    }

    /// Keeps `events`, one batch, for the [`DeltaListening`]s, all under one lock so a take gets all or none of
    /// them; whether it kept any.
    pub(crate) fn keep_deltas<'a>(&self, events: impl Iterator<Item = &'a V2Event>) -> bool {
        let mut events = events.peekable();
        if self.inner.delta_listeners.load(Ordering::SeqCst) == 0 || events.peek().is_none() {
            return false;
        }
        let mut deltas = lock(&self.inner.deltas);
        // Checked again under the lock: the last listener may have gone since.
        if deltas.cursors.is_empty() {
            return false;
        }
        for event in events {
            if deltas.kept.len() == DELTAS {
                deltas.kept.pop_front();
            }
            deltas.kept.push_back(event.clone());
            deltas.next += 1;
        }
        true
    }

    /// Wakes [`Data::subscribe`] with the revision it has, for deltas kept without a change.
    pub(crate) fn wake_deltas(&self) {
        self.inner.revision.send_modify(|_| {});
    }

    /// Hands what changed since the last take to the one consumer, in `into`, and returns the revision of the last
    /// flush. `into`'s earlier changes go: the consumer is done with them. The records the changes name stay marked
    /// until the take, so the sweep before it frees none the consumer reads.
    pub fn take_changes(&self, into: &mut Dirty) -> u64 {
        self.lock().take(into)
    }

    /// Mutates the state and flushes its changes unless a batch is open.
    pub(crate) fn write<R>(&self, f: impl FnOnce(&mut State) -> R) -> R {
        let mut state = self.lock();
        let result = f(&mut state);
        self.flush(&mut state);
        result
    }

    /// [`Data::write`] with the tasks.
    pub(crate) fn write_tasks<R>(&self, f: impl FnOnce(&mut State, &mut Tasks) -> R) -> R {
        let mut store = self.lock();
        let Store { state, tasks } = &mut *store.guard;
        let result = f(state, tasks);
        self.flush(state);
        result
    }

    /// Locks the state for a write. Locking it while this thread reads or writes it panics instead of deadlocking.
    pub(crate) fn lock(&self) -> Locked<'_> {
        let key = self.key();
        assert!(held(key).is_none(), "store write inside a store read or write on this thread");
        let guard = lock(&self.inner.store);
        Locked { _held: Held::enter(key, std::ptr::null()), guard }
    }

    fn key(&self) -> usize {
        Arc::as_ptr(&self.inner) as usize
    }

    pub(crate) fn flush(&self, state: &mut State) {
        if state.batch > 0 {
            return;
        }
        if let Some(revision) = state.log.flush() {
            self.inner.revision.send_replace(revision);
        }
    }

    pub(crate) fn runtime(&self) -> &Handle {
        &self.inner.runtime
    }

    pub(crate) fn live(&self) -> bool {
        !self.inner.disposed.load(Ordering::SeqCst) && self.inner.online.load(Ordering::SeqCst)
    }

    /// Spawns `future` at once and shares its result.
    pub(crate) fn spawn<T: Clone + Send + Sync + 'static>(
        &self,
        future: impl Future<Output = Result<T, Error>> + Send + 'static,
    ) -> Task<T> {
        let handle = self.inner.runtime.spawn(future);
        async move {
            handle.await.unwrap_or_else(|error| {
                Err(Arc::new(opencode_api::error::Error::Transport(format!("store task failed: {error}"))))
            })
        }
        .boxed()
        .shared()
    }

    /// Runs a follow-up read unless offline or disposed (`refresh`). A `SessionNotFoundError`
    /// marks the session deleted; other failures go to [`Data::on_error`].
    ///
    /// Store reads start when they are built, so `load` builds the read only after the check, as
    /// the TS `refresh` calls its `load` only when connected.
    pub(crate) fn refresh<F>(&self, load: impl FnOnce(Data) -> F)
    where
        F: Future<Output = Result<(), Error>> + Send + 'static,
    {
        if !self.live() {
            return;
        }
        let future = load(self.clone());
        let data = self.clone();
        self.inner.runtime.spawn(async move {
            if let Err(error) = future.await {
                data.refresh_failed(&error);
            }
        });
    }

    /// Handles a failed follow-up read (`refreshFailed`).
    pub(crate) fn refresh_failed(&self, error: &Error) {
        if !self.live() {
            return;
        }
        if let Some(id) = session_not_found(error) {
            self.complete(Completion::Missing(id), |_| {});
            return;
        }
        if is_tag(error, "MessageNotFoundError") {
            return;
        }
        let handler = lock(&self.inner.on_error).clone();
        match handler {
            Some(handler) => handler(error),
            None => log::error!("failed to refresh client data: {error}"),
        }
    }

    /// Runs the keyed read `read` once per invalidation (`sync.run`): a caller joins the load in flight, or begins one.
    /// `begin` runs under the store lock before this returns, or, for a reload that waits for the load it replaces,
    /// under the lock right after that wait. So no event after the call can miss what it registers (an overtake log,
    /// the deletion epoch). The fetch runs outside the lock, and its completion settles the load.
    fn sync<R: Fetch>(&self, read: Read, begin: impl FnOnce(&mut State, Ticket) -> R + Send + 'static) -> Task<()> {
        let mut store = self.lock();
        let key = store.read_key(read);
        let (token, wait) = match store.start_read(key) {
            Start::Done => return futures_util::future::ready(Ok(())).boxed().shared(),
            Start::Join(token) => return store.tasks().reads[&token].clone(),
            Start::Run(token) => (token, None),
            Start::After(token, stale) => (token, Some(store.tasks().reads[&stale].clone())),
        };
        let ticket = Ticket { key, token };
        let start = match wait {
            None => Begin::Begun(begin(&mut store, ticket)),
            Some(wait) => Begin::After(wait, begin),
        };
        let data = self.clone();
        // Spawned under the lock, so its settlement cannot run before its state exists.
        let task = self.spawn(async move {
            let request = match start {
                Begin::Begun(request) => request,
                Begin::After(wait, begin) => {
                    let _ = wait.await;
                    data.write(|state| {
                        state.resume_read(key, token);
                        begin(state, ticket)
                    })
                }
            };
            let completion = request.fetch(&data).await;
            data.finish(completion, |tasks| {
                tasks.reads.remove(&token);
            })
        });
        store.tasks().reads.insert(token, task.clone());
        task
    }

    /// Completes `completion` under the lock, where `release` drops the task it ends, then runs the effects it asks
    /// for.
    pub(crate) fn complete(&self, completion: Completion, release: impl FnOnce(&mut Tasks)) {
        let mut effects = Vec::new();
        self.write_tasks(|state, tasks| {
            state.complete(completion, &mut effects);
            release(tasks);
        });
        self.run(effects);
    }

    /// [`Data::complete`], passing on the error the request failed with.
    fn finish(&self, completion: Completion, release: impl FnOnce(&mut Tasks)) -> Result<(), Error> {
        let result = completion.error().cloned().map_or(Ok(()), Err);
        self.complete(completion, release);
        result
    }
}

/// How a keyed load starts: begun under the caller's lock, or after the load it replaces.
enum Begin<R, B> {
    Begun(R),
    After(Task<()>, B),
}

thread_local! {
    /// The stores whose state this thread holds locked, innermost last: the store a read lends, or null for a write.
    static HOLDING: std::cell::RefCell<Vec<(usize, *const Store)>> = const { std::cell::RefCell::new(Vec::new()) };
}

/// What this thread holds of the store `key`.
fn held(key: usize) -> Option<*const Store> {
    HOLDING.with_borrow(|holding| holding.iter().rev().find(|(held, _)| *held == key).map(|(_, state)| *state))
}

/// One entry of [`HOLDING`], removed on drop.
struct Held(usize);

impl Held {
    fn enter(key: usize, store: *const Store) -> Self {
        HOLDING.with_borrow_mut(|holding| holding.push((key, store)));
        Held(key)
    }
}

impl Drop for Held {
    fn drop(&mut self) {
        HOLDING.with_borrow_mut(|holding| {
            if let Some(index) = holding.iter().rposition(|(key, _)| *key == self.0) {
                holding.remove(index);
            }
        });
    }
}

/// What the lock guards: the state, and the tasks its requests run as.
pub(crate) struct Store {
    state: State,
    tasks: Tasks,
}

/// The tasks callers await, by the token the state keeps of their work. A task removes its entry when it settles, under
/// the lock that settles its work in the state, so a token the state holds always finds its task.
#[derive(Default)]
pub(crate) struct Tasks {
    /// Keyed loads.
    pub(crate) reads: HashMap<u64, Task<()>>,
    /// Optimistic creations: what admissions to the session wait for.
    pub(crate) creations: HashMap<u64, Task<()>>,
    /// Admissions: what the next admission of the session waits for.
    pub(crate) sends: HashMap<u64, Task<()>>,
    /// Older-page loads.
    pub(crate) loads: HashMap<u64, Task<bool>>,
    /// Compactions: a second gesture returns the same request.
    pub(crate) compactions: HashMap<u64, Task<SessionInboxCompaction>>,
    /// Trailing refetch timers.
    pub(crate) timers: HashMap<u64, AbortHandle>,
}

/// The locked [`Store`]; it derefs to the state.
pub(crate) struct Locked<'a> {
    _held: Held,
    guard: MutexGuard<'a, Store>,
}

impl Locked<'_> {
    pub(crate) fn tasks(&mut self) -> &mut Tasks {
        &mut self.guard.tasks
    }
}

impl std::ops::Deref for Locked<'_> {
    type Target = State;

    fn deref(&self) -> &State {
        &self.guard.state
    }
}

impl std::ops::DerefMut for Locked<'_> {
    fn deref_mut(&mut self) -> &mut State {
        &mut self.guard.state
    }
}

/// Event types [`Data::signals`] sends while it lives; see [`Data::listen`].
#[must_use = "the types stop being sent when this drops"]
pub struct Listening {
    inner: std::sync::Weak<Inner>,
    kinds: EventKinds,
}

impl Drop for Listening {
    fn drop(&mut self) {
        let Some(inner) = self.inner.upgrade() else { return };
        let mut named = lock(&inner.named);
        for index in self.kinds.indices() {
            inner.listened[index].fetch_sub(1, Ordering::SeqCst);
        }
        for name in self.kinds.names() {
            if let Some(count) = named.get_mut(name) {
                *count -= 1;
            }
        }
        named.retain(|_, count| *count > 0);
    }
}

/// The streaming deltas kept for the [`DeltaListening`]s, numbered in the order kept.
#[derive(Default)]
pub(crate) struct Deltas {
    /// The number the next delta kept gets.
    next: u64,
    /// The deltas some listener has not taken, the last numbered `next - 1`.
    kept: std::collections::VecDeque<V2Event>,
    /// Each listener's first delta not taken, by its ID.
    cursors: HashMap<u64, u64>,
    /// The ID of the next listener.
    ids: u64,
}

impl Deltas {
    /// Drops the deltas every listener has taken.
    fn trim(&mut self) {
        let first = self.next - self.kept.len() as u64;
        let taken = self.cursors.values().min().copied().unwrap_or(self.next);
        self.kept.drain(..taken.saturating_sub(first) as usize);
    }
}

/// The streaming deltas kept for [`Self::take`] while it lives; see [`Data::listen_deltas`].
#[must_use = "the deltas stop being kept when this drops"]
pub struct DeltaListening {
    inner: std::sync::Weak<Inner>,
    id: u64,
}

impl DeltaListening {
    /// The streaming deltas the store applied since this listener last took them, or since it started, oldest first.
    pub fn take(&self) -> Vec<V2Event> {
        let Some(inner) = self.inner.upgrade() else { return Vec::new() };
        let mut deltas = lock(&inner.deltas);
        let first = deltas.next - deltas.kept.len() as u64;
        let next = deltas.next;
        let Some(cursor) = deltas.cursors.insert(self.id, next) else { return Vec::new() };
        let events = deltas.kept.iter().skip(cursor.saturating_sub(first) as usize).cloned().collect();
        deltas.trim();
        events
    }
}

impl Drop for DeltaListening {
    fn drop(&mut self) {
        let Some(inner) = self.inner.upgrade() else { return };
        let mut deltas = lock(&inner.deltas);
        deltas.cursors.remove(&self.id);
        inner.delta_listeners.store(deltas.cursors.len(), Ordering::SeqCst);
        deltas.trim();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn data() -> (tokio::runtime::Runtime, Data) {
        let runtime = tokio::runtime::Builder::new_current_thread().build().unwrap();
        let client = Client::new("http://opencode.local").unwrap();
        let data = Data::with_runtime(client, Options::default(), runtime.handle().clone());
        (runtime, data)
    }

    #[test]
    #[should_panic(expected = "store read inside a store write")]
    fn a_read_inside_a_write_panics() {
        let (_runtime, data) = data();
        data.write(|_| data.read(|_| ()));
    }
}
