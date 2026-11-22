//! [`Data`] shares a locked [`State`] across handles. The lock never crosses an `.await`; requests run on the runtime
//! captured at construction, including those issued on the UI thread.

use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::hash::Hash;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use futures_util::FutureExt;
use futures_util::future::{BoxFuture, Shared};
use indexmap::{IndexMap, IndexSet};
use opencode_api::client::Client;
use opencode_api::generated::{JobInfo, Project, ProjectID, SessionID, SessionInboxCompaction, SessionMessageID};
use opencode_api::kinds::EventKinds;
use opencode_util::lock;
use tokio::runtime::Handle;
use tokio::sync::{broadcast, watch};
use tokio::task::AbortHandle;

use crate::changes::{Log, Touched};
use crate::forms::Form;
use crate::location::{Location, LocationData};
use crate::reads::{Phase, Read, ReadKey, ReadState};
use crate::sessions::{SessionKey, Sessions};

/// How many [`Data::signals`] events a slow receiver may fall behind. One batch may hold hundreds of a listened type
/// (a burst of `filesystem.changed`).
const SIGNALS: usize = 1024;
/// The most streaming deltas kept for the [`DeltaListening`]s; past that, the oldest go.
pub const DELTAS: usize = 4096;

/// A store error. Shared, because one keyed read answers every caller.
pub type Error = Arc<opencode_api::error::Error>;

/// A spawned request any number of callers can await.
pub type Task<T> = Shared<BoxFuture<'static, Result<T, Error>>>;

/// Raw messages of the first transcript read (`messagePageLimit`).
pub(crate) const MESSAGE_PAGE: i64 = 20;

/// Remembered deletions (`DELETED_SESSION_LIMIT`).
const DELETED_LIMIT: usize = 512;

#[derive(Debug, Clone, Default)]
pub struct Options {
    /// The default location directory (`CreateDataInput.directory`).
    pub directory: String,
    /// Raw messages of the first transcript read; later pages keep their size.
    pub initial_message_limit: Option<i64>,
    /// Drops inline `data:` payloads of tool-result files before they enter the store. Change it later with
    /// [`Data::set_omit_tool_file_data`].
    pub omit_tool_file_data: bool,
}

/// `DataSessionStatus`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionStatus {
    Idle,
    Running,
}

/// The store contents and its bookkeeping. Read it through [`Data::read`].
#[derive(Default)]
pub struct State {
    pub(crate) sessions: Sessions,
    /// Pending forms of [`crate::forms::GLOBAL`]; `None` until read or created. A session's own are in its record.
    pub(crate) global_forms: Option<Vec<Form>>,
    /// In insertion order, as the TS store's keys: projects that sort equal keep it.
    pub(crate) projects: IndexMap<ProjectID, Project>,
    pub(crate) locations: HashMap<Location, LocationData>,
    pub(crate) default_location: Location,
    pub(crate) omit_file_data: bool,

    pub(crate) log: Log,
    /// A `server.connected` arrived before; the next one is a reconnect.
    pub(crate) connected: bool,
    /// The keyed reads that belong to no session; a session's are in its record.
    pub(crate) reads: HashMap<ReadKey, ReadState>,
    /// The locations a keyed read or a change names, by [`crate::reads::LocationKey`].
    pub(crate) read_locations: IndexSet<Location>,
    /// Batches being applied; flushes wait for the outermost.
    pub(crate) batch: u32,
    next_token: u64,
    /// Status events received while a `session.active` snapshot is in flight, by connection.
    pub(crate) active_updates: Option<(u64, StatusUpdates)>,
    /// Inbox IDs of optimistic admissions the server has not acknowledged.
    pub(crate) outbox: HashSet<String>,
    pub(crate) deletion_epoch: u64,
    /// The newest [`DELETED_LIMIT`] deletions, oldest first: the sessions whose [`crate::sessions::Life`] holds a deletion
    /// epoch.
    deleted: IndexSet<SessionKey>,
    /// The sessions whose transcript window ended last (deleted, evicted or reverted), oldest first: the newest
    /// [`DELETED_LIMIT`], the only ones with an incarnation.
    ended: IndexSet<SessionKey>,
    /// Trailing refetch timers by the read they refetch, with the token of the newest.
    pub(crate) settling: HashMap<ReadKey, (u64, AbortHandle)>,
    /// The form read in flight per owner (and location, for [`crate::forms::GLOBAL`]), with the
    /// forms created and settled that overtook it.
    pub(crate) form_reads: HashMap<crate::forms::FormRead, Overlay<Form>>,
    /// Running background jobs by ID, of the trees synced and of job events since (`store.job`).
    pub(crate) jobs: IndexMap<String, JobInfo>,
    /// The session and position of the message an event edited last.
    pub(crate) last_edited: Option<(SessionKey, usize)>,
    /// The `durable.seq` of the event being applied, for the rows it creates.
    pub(crate) event_seq: Option<i64>,
}

/// Maximum changes retained by one in-flight list read.
pub(crate) const OVERLAY_LIMIT: usize = 1024;

/// Changes that overtake a list read, keyed by ID in arrival order. Only the current ticket can publish. Beyond
/// [`OVERLAY_LIMIT`], retry instead of losing an item.
#[derive(Debug, Clone)]
pub(crate) struct Overlay<V> {
    ticket: u64,
    /// `None` once overflowed.
    changes: Option<IndexMap<String, Option<V>>>,
}

impl<V> Overlay<V> {
    pub(crate) fn new(ticket: u64) -> Self {
        Self { ticket, changes: Some(IndexMap::new()) }
    }

    /// The ticket of the read this overlay belongs to.
    pub(crate) fn ticket(&self) -> u64 {
        self.ticket
    }

    /// Ends the read `ticket` of `key`: its overlay, while that read is still the current one.
    pub(crate) fn take<K: Hash + Eq>(reads: &mut HashMap<K, Self>, key: &K, ticket: u64) -> Option<Self> {
        if reads.get(key)?.ticket != ticket {
            return None;
        }
        reads.remove(key)
    }

    pub(crate) fn record(&mut self, id: &str, change: Option<V>) {
        let Some(changes) = &mut self.changes else { return };
        changes.insert(id.to_owned(), change);
        if changes.len() > OVERLAY_LIMIT {
            self.changes = None;
        }
    }

    /// Applies the changes over the snapshot `list`, keeping its order and appending new items in
    /// arrival order. `None` when the overlay overflowed.
    pub(crate) fn apply(self, mut list: Vec<V>, id: impl Fn(&V) -> &str) -> Option<Vec<V>> {
        for (key, change) in self.changes? {
            match change {
                Some(item) if list.iter().all(|old| id(old) != key) => list.push(item),
                Some(_) => {}
                None => list.retain(|old| id(old) != key),
            }
        }
        Some(list)
    }

    /// The changes by ID in arrival order, for a caller that applies them itself. `None` when the
    /// overlay overflowed.
    pub(crate) fn into_changes(self) -> Option<IndexMap<String, Option<V>>> {
        self.changes
    }
}

type ErrorHandler = Arc<dyn Fn(&Error) + Send + Sync>;

/// Status events by session; `None` removes the session.
pub(crate) type StatusUpdates = HashMap<SessionID, Option<SessionStatus>>;

/// An in-flight compaction admission (`compacting`).
pub(crate) struct Compacting {
    pub(crate) id: SessionMessageID,
    /// Inbox IDs consumed or echoed while the request runs, so its response cannot resurrect them.
    pub(crate) observed: HashSet<String>,
    pub(crate) request: Task<SessionInboxCompaction>,
}

impl State {
    pub(crate) fn token(&mut self) -> u64 {
        self.next_token += 1;
        self.next_token
    }

    pub(crate) fn clear_deleted(&mut self, key: SessionKey) {
        if self.sessions[key].life.undelete() {
            self.deleted.shift_remove(&key);
            self.touch_key(key, Touched::INFO);
        }
    }

    pub(crate) fn mark_deleted(&mut self, id: &SessionID) {
        if self.sessions.get(id).is_some_and(|session| session.life.unacknowledged()) {
            return;
        }
        let key = self.sessions.entry(id);
        self.deleted.shift_remove(&key);
        self.deletion_epoch += 1;
        self.deleted.insert(key);
        if self.deleted.len() > DELETED_LIMIT
            && let Some(oldest) = self.deleted.shift_remove_index(0)
        {
            self.sessions[oldest].life.undelete();
        }
        self.sessions[key].life.delete(self.deletion_epoch);
        self.remove_session(id);
    }

    /// True when `id` was deleted after the epoch a read started at.
    pub(crate) fn deleted_since(&self, id: &SessionID, started: u64) -> bool {
        self.sessions.get(id).and_then(|session| session.life.deleted()).unwrap_or(0) > started
    }

    /// The incarnation of `id`'s transcript window. A completion publishes into the window only while it is the
    /// incarnation the completion began in (models M2 rule 5, deviation O6-held-message-read).
    pub(crate) fn incarnation(&self, id: &SessionID) -> u64 {
        self.sessions.get(id).map_or(0, |session| session.incarnation)
    }

    /// Ends a transcript window, so completions that began in it publish nothing. The token counter never
    /// repeats, so a later window never matches an earlier incarnation.
    pub(crate) fn end_transcript(&mut self, key: SessionKey) {
        let token = self.token();
        self.ended.shift_remove(&key);
        self.ended.insert(key);
        self.sessions[key].incarnation = token;
        if self.ended.len() > DELETED_LIMIT
            && let Some(oldest) = self.ended.shift_remove_index(0)
        {
            self.sessions[oldest].incarnation = 0;
        }
    }
}

/// The store handle. Cheap to clone.
#[derive(Clone)]
pub struct Data {
    pub(crate) inner: Arc<Inner>,
}

pub(crate) struct Inner {
    pub(crate) client: Client,
    pub(crate) options: Options,
    runtime: Handle,
    state: Mutex<State>,
    revision: watch::Sender<u64>,
    /// The events views act on themselves, sent after their batch is applied.
    pub(crate) signals: broadcast::Sender<Arc<opencode_api::generated::V2Event>>,
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
        let state = State {
            omit_file_data: options.omit_tool_file_data,
            default_location: Location::new(options.directory.clone()),
            ..State::default()
        };
        Self {
            inner: Arc::new(Inner {
                client,
                options,
                runtime,
                state: Mutex::new(state),
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
        for (_, (_, timer)) in self.lock().settling.drain() {
            timer.abort();
        }
    }

    /// Reads the state. Keep `f` short: it holds the store lock. A `read` inside `f` on the same thread reuses the
    /// outer guard, so code that runs under a read (a keymap condition during a row render) may read again.
    #[allow(unsafe_code)]
    pub fn read<R>(&self, f: impl FnOnce(&State) -> R) -> R {
        let key = self.key();
        if let Some(state) = held(key) {
            assert!(!state.is_null(), "store read inside a store write on this thread");
            // SAFETY: the outer `read` on this thread holds the guard until this call returns, and lends only `&State`.
            return f(unsafe { &*state });
        }
        let guard = lock(&self.inner.state);
        let _held = Held::enter(key, &*guard);
        f(&guard)
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
    pub fn signals(&self) -> broadcast::Receiver<Arc<opencode_api::generated::V2Event>> {
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
    pub(crate) fn keep_deltas<'a>(&self, events: impl Iterator<Item = &'a opencode_api::generated::V2Event>) -> bool {
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

    /// Mutates the state and flushes its changes unless a batch is open.
    pub(crate) fn write<R>(&self, f: impl FnOnce(&mut State) -> R) -> R {
        let mut state = self.lock();
        let result = f(&mut state);
        self.flush(&mut state);
        result
    }

    /// Locks the state for a write. Locking it while this thread reads or writes it panics instead of deadlocking.
    pub(crate) fn lock(&self) -> Locked<'_> {
        let key = self.key();
        assert!(held(key).is_none(), "store write inside a store read or write on this thread");
        let guard = lock(&self.inner.state);
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
            self.write(|state| state.mark_deleted(&id));
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

    /// Runs `load` once per key until invalidated (`sync.run`).
    pub(crate) fn sync_run<F>(&self, read: Keyed, load: impl FnOnce(Data) -> F + Send + 'static) -> Task<()>
    where
        F: Future<Output = Result<(), Error>> + Send + 'static,
    {
        self.sync_start(read, |_, _| (), move |data, ()| load(data))
    }

    /// Locks the state and finds the key of `read`, for [`Data::sync_start`].
    pub(crate) fn keyed(&self, read: Read) -> Keyed<'_> {
        let mut state = self.lock();
        let key = state.read_key(read);
        (state, key)
    }

    /// [`Data::sync_run`] with a synchronous start, as the part of a TS load before its first
    /// `await`. `begin` runs under the store lock before this returns, or, for a reload that waits
    /// for the load it replaces, under the lock right after that wait. So no event after the call
    /// can miss what it registers (an overtake log, the deletion epoch). `load` builds the read
    /// from what `begin` returned, outside the lock.
    pub(crate) fn sync_start<R, F>(
        &self,
        (mut state, key): Keyed,
        begin: impl FnOnce(&mut State, ReadKey) -> R + Send + 'static,
        load: impl FnOnce(Data, R) -> F + Send + 'static,
    ) -> Task<()>
    where
        R: Send + 'static,
        F: Future<Output = Result<(), Error>> + Send + 'static,
    {
        let wait = match state.read_state_mut(key) {
            Some(ReadState::Done) => return futures_util::future::ready(Ok(())).boxed().shared(),
            Some(ReadState::Loading { task, phase: Phase::Stale, .. }) => Some(task.clone()),
            Some(ReadState::Loading { task, .. }) => return task.clone(),
            _ => None,
        };
        let token = state.token();
        let phase = if wait.is_some() { Phase::Queued } else { Phase::Running };
        let start = match wait {
            None => Start::Begun(begin(&mut state, key)),
            Some(wait) => Start::After(wait, begin),
        };
        let data = self.clone();
        // Spawned under the lock, so its settlement cannot run before its state exists.
        let task = self.spawn(async move {
            let begun = match start {
                Start::Begun(begun) => begun,
                Start::After(wait, begin) => {
                    let _ = wait.await;
                    data.write(|state| {
                        if let Some(ReadState::Loading { token: current, phase, .. }) = state.read_state_mut(key)
                            && *current == token
                        {
                            *phase = Phase::Running;
                        }
                        begin(state, key)
                    })
                }
            };
            let result = load(data.clone(), begun).await;
            data.write(|state| {
                if let Some(read) = state.read_state_mut(key) {
                    read.settle(token, result.is_ok());
                }
            });
            result
        });
        if let Some(state) = state.read_state_mut(key) {
            *state = ReadState::Loading { token, task: task.clone(), phase };
        }
        task
    }

    /// Fetches a list and applies its overlay before publishing. Discard superseded reads and reads for deleted
    /// sessions. An overflow invalidates the read and schedules another.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn overlay_sync<K, V, T, F>(
        &self,
        sync: Keyed,
        session: SessionID,
        read: K,
        open: fn(&mut State, &K, Overlay<V>),
        close: fn(&mut State, &K, u64) -> Option<Overlay<V>>,
        id: fn(&V) -> &str,
        fetch: impl FnOnce(Data) -> F + Send + 'static,
        publish: impl FnOnce(&mut State, &K, Vec<V>, T) + Send + 'static,
        again: impl FnOnce(Data) -> Task<()> + Send + 'static,
    ) -> Task<()>
    where
        K: Clone + Send + 'static,
        V: Send + 'static,
        T: Send + 'static,
        F: Future<Output = Result<(Vec<V>, T), Error>> + Send + 'static,
    {
        let begin = read.clone();
        self.sync_start(
            sync,
            move |state, key| {
                let ticket = state.token();
                open(state, &begin, Overlay::new(ticket));
                (state.deletion_epoch, ticket, key)
            },
            move |data, (started, ticket, key)| async move {
                let (list, extra) = match fetch(data.clone()).await {
                    Ok(fetched) => fetched,
                    Err(error) => {
                        data.write(|state| close(state, &read, ticket));
                        return Err(error);
                    }
                };
                let reread = data.write(|state| {
                    let Some(overlay) = close(state, &read, ticket) else { return false };
                    if state.deleted_since(&session, started) {
                        return false;
                    }
                    let Some(list) = overlay.apply(list, id) else {
                        state.invalidate_key(key);
                        return true;
                    };
                    publish(state, &read, list, extra);
                    false
                });
                if reread {
                    data.refresh(again);
                }
                Ok(())
            },
        )
    }
}

/// The locked state and the key of a read, for [`Data::sync_start`].
pub(crate) type Keyed<'a> = (Locked<'a>, ReadKey);

/// How a keyed load starts: begun under the caller's lock, or after the load it replaces.
enum Start<R, B> {
    Begun(R),
    After(Task<()>, B),
}

thread_local! {
    /// The stores whose state this thread holds locked, innermost last: the state a read lends, or null for a write.
    static HOLDING: std::cell::RefCell<Vec<(usize, *const State)>> = const { std::cell::RefCell::new(Vec::new()) };
}

/// What this thread holds of the store `key`.
fn held(key: usize) -> Option<*const State> {
    HOLDING.with_borrow(|holding| holding.iter().rev().find(|(held, _)| *held == key).map(|(_, state)| *state))
}

/// One entry of [`HOLDING`], removed on drop.
struct Held(usize);

impl Held {
    fn enter(key: usize, state: *const State) -> Self {
        HOLDING.with_borrow_mut(|holding| holding.push((key, state)));
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

/// The locked [`State`].
pub(crate) struct Locked<'a> {
    _held: Held,
    guard: MutexGuard<'a, State>,
}

impl std::ops::Deref for Locked<'_> {
    type Target = State;

    fn deref(&self) -> &State {
        &self.guard
    }
}

impl std::ops::DerefMut for Locked<'_> {
    fn deref_mut(&mut self) -> &mut State {
        &mut self.guard
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
    kept: std::collections::VecDeque<opencode_api::generated::V2Event>,
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
    pub fn take(&self) -> Vec<opencode_api::generated::V2Event> {
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

pub(crate) fn is_tag(error: &Error, tag: &str) -> bool {
    error.declared().is_some_and(|declared| declared.tag.as_deref() == Some(tag))
}

/// The session of a `SessionNotFoundError`.
pub(crate) fn session_not_found(error: &Error) -> Option<SessionID> {
    let declared = error.declared()?;
    if declared.tag.as_deref() != Some("SessionNotFoundError") {
        return None;
    }
    declared.body.get("sessionID").and_then(serde_json::Value::as_str).map(|id| SessionID(id.to_owned()))
}

/// Marks a missing session deleted and passes the error on (`evictMissing`).
pub(crate) fn evict_missing(data: &Data, error: opencode_api::error::Error) -> Error {
    let error = Arc::new(error);
    if let Some(id) = session_not_found(&error) {
        data.write(|state| state.mark_deleted(&id));
    }
    error
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
