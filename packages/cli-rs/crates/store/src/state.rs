//! Store state (F.7): the shared handle, the locked state, keyed reads, and follow-up refreshes.
//!
//! `Data` ports `createData` (`packages/client/src/solid/data.ts`). It is a cheap `Clone` handle
//! around one locked [`State`]. The lock is never held across an `.await`. Requests run on the
//! tokio runtime captured by [`Data::new`], so the handle also works from the UI thread.

use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use futures_util::FutureExt;
use futures_util::future::{BoxFuture, Shared};
use indexmap::IndexMap;
use opencode_api::client::Client;
use opencode_api::generated::{
    PermissionRequest, PermissionSavedInfo, Project, ProjectID, SessionID, SessionInboxCompaction, SessionInboxInfo,
    SessionInfo, SessionMessageID,
};
use tokio::runtime::Handle;
use tokio::sync::{broadcast, watch};
use tokio::task::AbortHandle;

use crate::changes::{Changes, Log};
use crate::forms::Form;
use crate::inbox::PendingUpdate;
use crate::location::{Location, LocationData};
use crate::messages::Transcript;

/// How many [`Data::signals`] events a slow receiver may fall behind.
const SIGNALS: usize = 64;

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
    /// Drops inline `data:` payloads of tool-result files before they enter the store.
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
    pub(crate) info: HashMap<SessionID, SessionInfo>,
    pub(crate) missing: HashSet<SessionID>,
    /// Family index keyed by a family's root, or by its furthest known ancestor while the root is
    /// not loaded. Each value lists every session of the family, the key included once loaded.
    pub(crate) family: HashMap<SessionID, Vec<SessionID>>,
    pub(crate) active: HashMap<SessionID, SessionStatus>,
    pub(crate) messages: HashMap<SessionID, Transcript>,
    pub(crate) cursor: HashMap<SessionID, String>,
    pub(crate) loading: HashSet<SessionID>,
    pub(crate) pending: HashMap<SessionID, Vec<SessionInboxInfo>>,
    pub(crate) permission: HashMap<SessionID, Vec<PermissionRequest>>,
    /// Pending forms by owner: a session ID or [`crate::forms::GLOBAL`].
    pub(crate) forms: HashMap<String, Vec<Form>>,
    pub(crate) projects: HashMap<ProjectID, Project>,
    pub(crate) project_permissions: HashMap<ProjectID, Vec<PermissionSavedInfo>>,
    pub(crate) locations: HashMap<Location, LocationData>,
    pub(crate) default_location: Location,
    pub(crate) omit_file_data: bool,

    pub(crate) log: Log,
    /// A `server.connected` arrived before; the next one is a reconnect.
    pub(crate) connected: bool,
    pub(crate) syncs: Syncs,
    /// Batches being applied; flushes wait for the outermost.
    pub(crate) batch: u32,
    next_token: u64,
    /// Status events received while a `session.active` snapshot is in flight, by connection.
    pub(crate) active_updates: Option<(u64, StatusUpdates)>,
    /// Inbox events received while an inbox read is in flight, by read.
    pub(crate) pending_updates: HashMap<SessionID, (u64, IndexMap<String, PendingUpdate>)>,
    /// Inbox IDs of optimistic admissions the server has not acknowledged.
    pub(crate) outbox: HashSet<String>,
    /// Session IDs of optimistic creations the server has not acknowledged.
    pub(crate) session_outbox: HashSet<SessionID>,
    /// In-flight optimistic creations; prompts to the session wait for them.
    pub(crate) creating: HashMap<SessionID, (u64, Task<()>)>,
    /// The per-session admission chain: each admission waits for the previous one to settle.
    pub(crate) sending: HashMap<SessionID, (u64, Task<()>)>,
    pub(crate) message_loads: HashMap<SessionID, (u64, Task<bool>)>,
    pub(crate) compacting: HashMap<SessionID, Compacting>,
    pub(crate) deletion_epoch: u64,
    /// Deleted sessions by deletion epoch, oldest first.
    pub(crate) deleted_at: IndexMap<SessionID, u64>,
    /// Trailing refetch timers by key, with the token of the newest.
    pub(crate) settling: HashMap<String, (u64, AbortHandle)>,
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

    /// The revision of the last flush.
    pub fn revision(&self) -> u64 {
        self.log.revision()
    }

    /// The current revision and what changed after `seen`. Inside [`Data::read`], a view gets
    /// the changes and the state they describe under one lock, so no flush lands in between.
    pub fn changes_since(&self, seen: u64) -> (u64, Changes) {
        (self.log.revision(), self.log.since(seen))
    }

    pub(crate) fn clear_deleted(&mut self, id: &SessionID) {
        self.deleted_at.shift_remove(id);
        if self.missing.remove(id) {
            self.log.session(id);
        }
    }

    pub(crate) fn mark_deleted(&mut self, id: &SessionID) {
        if self.session_outbox.contains(id) {
            return;
        }
        self.deleted_at.shift_remove(id);
        self.deletion_epoch += 1;
        self.deleted_at.insert(id.clone(), self.deletion_epoch);
        if self.deleted_at.len() > DELETED_LIMIT
            && let Some((oldest, _)) = self.deleted_at.shift_remove_index(0)
        {
            self.missing.remove(&oldest);
        }
        self.missing.insert(id.clone());
        self.remove_session(id);
    }

    /// True when `id` was deleted after the epoch a read started at.
    pub(crate) fn deleted_since(&self, id: &SessionID, started: u64) -> bool {
        self.deleted_at.get(id).copied().unwrap_or(0) > started
    }
}

/// A keyed read (`createSync`): one spawned load per key shared by every caller, with the TS
/// invalidation rules.
#[derive(Default)]
pub(crate) struct Syncs {
    entries: HashMap<String, Entry>,
}

enum Entry {
    Done,
    Pending {
        token: u64,
        task: Task<()>,
        invalidated: bool,
        /// False while a reload waits for the load it replaces; invalidations then are covered.
        started: Arc<AtomicBool>,
    },
}

impl Syncs {
    pub(crate) fn complete(&mut self, key: &str) {
        self.entries.entry(key.to_owned()).or_insert(Entry::Done);
    }

    pub(crate) fn has(&self, key: &str) -> bool {
        self.entries.contains_key(key)
    }

    pub(crate) fn pending(&self, key: &str) -> bool {
        matches!(self.entries.get(key), Some(Entry::Pending { .. }))
    }

    pub(crate) fn invalidate(&mut self, key: &str) {
        match self.entries.get_mut(key) {
            Some(Entry::Done) => {
                self.entries.remove(key);
            }
            Some(Entry::Pending { invalidated, started, .. }) if started.load(Ordering::SeqCst) => *invalidated = true,
            _ => {}
        }
    }

    /// Invalidates every key that starts with `prefix` (every key for `""`).
    pub(crate) fn invalidate_prefix(&mut self, prefix: &str) {
        self.entries.retain(|key, entry| {
            if !key.starts_with(prefix) {
                return true;
            }
            match entry {
                Entry::Done => false,
                Entry::Pending { invalidated, started, .. } => {
                    if started.load(Ordering::SeqCst) {
                        *invalidated = true;
                    }
                    true
                }
            }
        });
    }

    /// Settles the load `token` of `key`: done when it succeeded and was not invalidated.
    fn settle(&mut self, key: &str, token: u64, ok: bool) {
        let Some(Entry::Pending { token: current, invalidated, .. }) = self.entries.get(key) else {
            return;
        };
        if *current != token {
            return;
        }
        if ok && !*invalidated {
            self.entries.insert(key.to_owned(), Entry::Done);
            return;
        }
        self.entries.remove(key);
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
    pub(crate) signals: broadcast::Sender<opencode_api::generated::V2Event>,
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

    /// Receives the events a view handles itself (`tui.*`, `session.deleted`, `session.moved`),
    /// after the store applied their batch. A receiver that falls behind skips the oldest.
    pub fn signals(&self) -> broadcast::Receiver<opencode_api::generated::V2Event> {
        self.inner.signals.subscribe()
    }

    /// The current revision and what changed after `seen`.
    pub fn changes_since(&self, seen: u64) -> (u64, Changes) {
        self.read(|state| state.changes_since(seen))
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
            let Err(error) = future.await else {
                return;
            };
            if !data.live() {
                return;
            }
            if let Some(id) = session_not_found(&error) {
                data.write(|state| state.mark_deleted(&id));
                return;
            }
            if is_tag(&error, "MessageNotFoundError") {
                return;
            }
            let handler = lock(&data.inner.on_error).clone();
            match handler {
                Some(handler) => handler(&error),
                None => log::error!("failed to refresh client data: {error}"),
            }
        });
    }

    /// Runs `load` once per key until invalidated (`sync.run`).
    pub(crate) fn sync_run<F>(&self, key: String, load: impl FnOnce(Data) -> F + Send + 'static) -> Task<()>
    where
        F: Future<Output = Result<(), Error>> + Send + 'static,
    {
        self.sync_start(key, |_| (), move |data, ()| load(data))
    }

    /// [`Data::sync_run`] with a synchronous start, as the part of a TS load before its first
    /// `await`. `begin` runs under the store lock before this returns, or, for a reload that waits
    /// for the load it replaces, under the lock right after that wait. So no event after the call
    /// can miss what it registers (an overtake log, the deletion epoch). `load` builds the read
    /// from what `begin` returned, outside the lock.
    pub(crate) fn sync_start<R, F>(
        &self,
        key: String,
        begin: impl FnOnce(&mut State) -> R + Send + 'static,
        load: impl FnOnce(Data, R) -> F + Send + 'static,
    ) -> Task<()>
    where
        R: Send + 'static,
        F: Future<Output = Result<(), Error>> + Send + 'static,
    {
        let mut state = self.lock();
        let wait = match state.syncs.entries.get(&key) {
            Some(Entry::Done) => return futures_util::future::ready(Ok(())).boxed().shared(),
            Some(Entry::Pending { task, invalidated, .. }) => {
                if !*invalidated {
                    return task.clone();
                }
                Some(task.clone())
            }
            None => None,
        };
        let token = state.token();
        let started = Arc::new(AtomicBool::new(wait.is_none()));
        let start = match wait {
            None => Start::Begun(begin(&mut state)),
            Some(wait) => Start::After(wait, begin),
        };
        let data = self.clone();
        let flag = started.clone();
        let settle = key.clone();
        // Spawned under the lock, so its settlement cannot run before the entry exists.
        let task = self.spawn(async move {
            let begun = match start {
                Start::Begun(begun) => begun,
                Start::After(wait, begin) => {
                    let _ = wait.await;
                    data.write(|state| {
                        flag.store(true, Ordering::SeqCst);
                        begin(state)
                    })
                }
            };
            let result = load(data.clone(), begun).await;
            data.write(|state| state.syncs.settle(&settle, token, result.is_ok()));
            result
        });
        state.syncs.entries.insert(key, Entry::Pending { token, task: task.clone(), invalidated: false, started });
        task
    }
}

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

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
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
    fn a_nested_read_reuses_the_outer_guard() {
        let (_runtime, data) = data();
        let revision = data.read(|outer| data.read(|inner| (std::ptr::eq(outer, inner), inner.revision())));
        assert_eq!(revision, (true, 0));
        // The guard is gone after the outer read: a write locks again.
        data.write(|state| state.batch = 0);
    }

    #[test]
    #[should_panic(expected = "store write inside a store read")]
    fn a_write_inside_a_read_panics() {
        let (_runtime, data) = data();
        data.read(|_| data.write(|_| ()));
    }

    #[test]
    #[should_panic(expected = "store read inside a store write")]
    fn a_read_inside_a_write_panics() {
        let (_runtime, data) = data();
        data.write(|_| data.read(|_| ()));
    }
}
