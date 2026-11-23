//! [`Data`] runs the store on the thread that owns it: the [`State`], the tasks its requests run as, and what the
//! consumer has not taken yet. Requests fetch on a runtime and send their answers back through the store's mailbox,
//! which the owner drains on its own thread. So a read borrows the state, and a read inside a read borrows it again.

use std::cell::{Cell, Ref, RefCell, RefMut};
use std::collections::{HashMap, VecDeque};
use std::future::Future;
use std::rc::{Rc, Weak};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::FutureExt;
use futures_util::future::{BoxFuture, Shared};
use opencode_api::client::Client;
use opencode_api::generated::{EventKind, SessionInboxCompaction, V2Event};
use opencode_api::kinds::EventKinds;
use opencode_util::lock;
use tokio::runtime::Handle;
use tokio::sync::{Notify, Semaphore, TryAcquireError, oneshot};
use tokio::task::AbortHandle;

use crate::changes::Dirty;
use crate::core::{Completion, Delta, Effect, Ticket};
use crate::payload::{Kind, Payload, Wanted};
use crate::reads::{Read, Start};
use crate::state::{Error, MESSAGE_PAGE, Options, State, is_tag, session_not_found};

mod requests;

use requests::Fetch;
pub use requests::{Gate, LoadMore, Prompt};

/// The most streaming deltas kept for the [`DeltaListening`]s; past that, the oldest go.
pub const DELTAS: usize = 4096;
/// The most messages a store's mailbox holds for its owner. A sender waits for room past that, so a connection whose
/// owner stops draining stops reading batches, and its own queue fills.
pub const MAILBOX: usize = 4096;

/// A spawned request any number of callers can await.
pub type Task<T> = Shared<BoxFuture<'static, Result<T, Error>>>;

type ErrorHandler = Rc<dyn Fn(&Error)>;

/// Why a wake did not reach the thread that owns a store.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Unwoken {
    /// Its queue is full: the store asks again shortly.
    Busy,
    /// It has ended: the store drops its mail.
    Gone,
}

/// The store. Cheap to clone, and it stays on the thread that made it.
#[derive(Clone)]
pub struct Data {
    inner: Rc<Inner>,
}

struct Inner {
    remote: Remote,
    store: RefCell<Store>,
    /// Told when the consumer has something to take: changes, signals or deltas.
    changed: RefCell<Option<Rc<dyn Fn()>>>,
    /// How many [`Listening`]s want each event kind, by `kind as usize`.
    listened: [Cell<usize>; EventKind::COUNT],
    /// How many [`Listening`]s want each name of the kinds a listener names (`EventKind::named`).
    named: RefCell<HashMap<String, usize>>,
    /// The listened events of the batches applied since the consumer last took them.
    signals: RefCell<Vec<V2Event>>,
    deltas: Deltas,
    /// False while the event connection is not connected; follow-up reads are skipped then.
    online: Cell<bool>,
    /// The buffer adjacent deltas that came as JSON join in, kept between batches.
    joined: Cell<String>,
    disposed: Cell<bool>,
    on_error: RefCell<Option<ErrorHandler>>,
    /// The drained mail's buffer, kept between drains.
    drained: Cell<VecDeque<Mail>>,
}

impl Drop for Inner {
    fn drop(&mut self) {
        self.remote.close();
    }
}

impl Data {
    /// A store this thread owns. `wake` asks this thread to call [`Data::drain`] soon, from any thread; requests run on
    /// `runtime`.
    pub fn new(
        client: Client,
        options: Options,
        runtime: Handle,
        wake: impl Fn() -> Result<(), Unwoken> + Send + Sync + 'static,
    ) -> Self {
        let state = State::new(&options);
        let remote = Remote(Arc::new(Mailbox {
            client,
            runtime,
            head: options.initial_message_limit.unwrap_or(MESSAGE_PAGE),
            queue: Mutex::default(),
            room: Semaphore::new(MAILBOX),
            wake: Box::new(wake),
            wanted: Wanted::default(),
        }));
        Self {
            inner: Rc::new(Inner {
                remote,
                store: RefCell::new(Store { state, tasks: Tasks::default() }),
                changed: RefCell::new(None),
                listened: std::array::from_fn(|_| Cell::new(0)),
                named: RefCell::default(),
                signals: RefCell::default(),
                deltas: Deltas::default(),
                online: Cell::new(true),
                joined: Cell::default(),
                disposed: Cell::new(false),
                on_error: RefCell::new(None),
                drained: Cell::default(),
            }),
        }
    }

    /// A store this thread owns, drained by a task on the local runtime it runs in (`LocalRuntime`), which also runs
    /// its requests.
    pub fn local(client: Client, options: Options) -> Self {
        let notify = Arc::new(Notify::new());
        let wake = notify.clone();
        let data = Self::new(client, options, Handle::current(), move || {
            wake.notify_one();
            Ok(())
        });
        let owner = Rc::downgrade(&data.inner);
        tokio::task::spawn_local(async move {
            loop {
                notify.notified().await;
                let Some(inner) = owner.upgrade() else { return };
                Data { inner }.drain();
            }
        });
        data
    }

    pub fn client(&self) -> &Client {
        &self.inner.remote.0.client
    }

    /// The store as other threads reach it.
    pub fn remote(&self) -> Remote {
        self.inner.remote.clone()
    }

    /// Runs the mail other threads sent, in the order sent.
    pub fn drain(&self) {
        let mut mail = self.inner.drained.take();
        {
            let mut queue = lock(&self.inner.remote.0.queue);
            // Before the take, so mail sent from now on wakes the owner again.
            queue.woken = false;
            std::mem::swap(&mut queue.mail, &mut mail);
        }
        let count = mail.len();
        for item in mail.drain(..) {
            match item {
                Mail::Batch(mut payloads, online) => {
                    if let Some(online) = online {
                        self.set_online(online);
                    }
                    self.apply_payloads(&mut payloads);
                }
                Mail::Online(online) => self.set_online(online),
                Mail::Run(job) => job(self),
            }
        }
        self.inner.remote.0.room.add_permits(count);
        self.inner.drained.set(mail);
    }

    /// Calls `changed` whenever the consumer has something to take: after a flush, and when a batch kept signals or
    /// deltas. It runs outside the store's borrow.
    pub fn on_change(&self, changed: impl Fn() + 'static) {
        *self.inner.changed.borrow_mut() = Some(Rc::new(changed));
    }

    /// Receives failed event-driven reads (`onError`). Without it they are logged.
    pub fn on_error(&self, handler: impl Fn(&Error) + 'static) {
        *self.inner.on_error.borrow_mut() = Some(Rc::new(handler));
    }

    /// Stops follow-up reads, as disposing the TS owner does.
    pub fn dispose(&self) {
        self.inner.disposed.set(true);
        self.write_tasks(|state, tasks| {
            for (_, token) in state.settling.drain() {
                if let Some(timer) = tasks.timers.remove(&token) {
                    timer.abort();
                }
            }
        });
    }

    /// Borrows the state. Reads nest; a write while it is borrowed panics.
    pub fn state(&self) -> Ref<'_, State> {
        Ref::map(self.store(), |store| &store.state)
    }

    /// Reads the state; see [`Data::state`].
    pub fn read<R>(&self, f: impl FnOnce(&State) -> R) -> R {
        f(&self.state())
    }

    /// [`Data::read`] with the tasks.
    pub(crate) fn read_tasks<R>(&self, f: impl FnOnce(&State, &Tasks) -> R) -> R {
        let store = self.store();
        f(&store.state, &store.tasks)
    }

    fn store(&self) -> Ref<'_, Store> {
        self.inner.store.try_borrow().expect("store read inside a store write")
    }

    /// The revision of the last flush.
    pub fn revision(&self) -> u64 {
        self.state().log.revision()
    }

    /// Sends the events of each type in `kinds` to [`Data::take_signals`] until the returned guard drops.
    pub fn listen(&self, kinds: impl Into<EventKinds>) -> Listening {
        let kinds = kinds.into();
        let mut named = self.inner.named.borrow_mut();
        for name in kinds.names() {
            *named.entry(name.clone()).or_default() += 1;
        }
        for index in kinds.indices() {
            let listened = &self.inner.listened[index];
            listened.set(listened.get() + 1);
        }
        Listening { inner: Rc::downgrade(&self.inner), kinds }
    }

    /// Hands the consumer, in `into`, each event of a type a [`Listening`] wants, of the batches applied since it last
    /// took them, in order. Streaming deltas are never among them ([`DeltaListening::take`] has them).
    pub fn take_signals(&self, into: &mut Vec<V2Event>) {
        into.clear();
        std::mem::swap(&mut *self.inner.signals.borrow_mut(), into);
    }

    /// Keeps the streaming deltas (`session.*.delta`), which [`Data::take_signals`] never has, for
    /// [`DeltaListening::take`] from now until the returned guard drops: at most [`DELTAS`] it has not taken, the
    /// oldest dropped past that. A batch that kept one tells [`Data::on_change`] also when it changed nothing.
    pub fn listen_deltas(&self) -> DeltaListening {
        let deltas = &self.inner.deltas;
        let id = deltas.ids.get();
        deltas.ids.set(id + 1);
        deltas.cursors.borrow_mut().insert(id, deltas.next());
        self.inner.remote.0.wanted.set(true);
        DeltaListening { inner: Rc::downgrade(&self.inner), id }
    }

    /// Hands what changed since the last take to the one consumer, in `into`, and returns the revision of the last
    /// flush. `into`'s earlier changes go: the consumer is done with them. The records the changes name stay marked
    /// until the take, so the sweep before it frees none the consumer reads.
    pub fn take_changes(&self, into: &mut Dirty) -> u64 {
        self.lock().take(into)
    }

    /// Mutates the state and flushes its changes unless a batch is open.
    pub(crate) fn write<R>(&self, f: impl FnOnce(&mut State) -> R) -> R {
        let mut store = self.lock();
        let result = f(&mut store);
        self.flush(store);
        result
    }

    /// [`Data::write`] with the tasks.
    pub(crate) fn write_tasks<R>(&self, f: impl FnOnce(&mut State, &mut Tasks) -> R) -> R {
        let mut store = self.lock();
        let Store { state, tasks } = &mut *store.0;
        let result = f(state, tasks);
        self.flush(store);
        result
    }

    /// Borrows the state for a write. A write while the state is borrowed panics.
    pub(crate) fn lock(&self) -> Locked<'_> {
        Locked(self.inner.store.try_borrow_mut().expect("store write inside a store read or write"))
    }

    /// Ends the write `store`, numbering its changes unless a batch is open, and tells the consumer of them.
    pub(crate) fn flush(&self, mut store: Locked<'_>) {
        let flushed = store.batch == 0 && store.log.flush().is_some();
        drop(store);
        if flushed {
            self.changed();
        }
    }

    fn changed(&self) {
        let changed = self.inner.changed.borrow().clone();
        if let Some(changed) = changed {
            changed();
        }
    }

    pub(crate) fn runtime(&self) -> &Handle {
        &self.inner.remote.0.runtime
    }

    pub(crate) fn live(&self) -> bool {
        !self.inner.disposed.get() && self.inner.online.get()
    }

    /// Spawns `future` at once and shares its result.
    pub(crate) fn spawn<T: Clone + Send + Sync + 'static>(
        &self,
        future: impl Future<Output = Result<T, Error>> + Send + 'static,
    ) -> Task<T> {
        let handle = self.runtime().spawn(future);
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
    pub(crate) fn refresh<F>(&self, load: impl FnOnce(&Data) -> F)
    where
        F: Future<Output = Result<(), Error>> + Send + 'static,
    {
        if !self.live() {
            return;
        }
        let future = load(self);
        let remote = self.remote();
        self.runtime().spawn(async move {
            if let Err(error) = future.await {
                remote.post(move |data| data.refresh_failed(&error)).await;
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
        let handler = self.inner.on_error.borrow().clone();
        match handler {
            Some(handler) => handler(error),
            None => log::error!("failed to refresh client data: {error}"),
        }
    }

    /// Runs the keyed read `read` once per invalidation (`sync.run`): a caller joins the load in flight, or begins one.
    /// `begin` runs before this returns, or, for a reload that waits for the load it replaces, on this thread right
    /// after that wait. So no event after the call can miss what it registers (an overtake log, the deletion epoch).
    /// The fetch runs on the runtime, and its completion settles the load here.
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
        store.load_read(key, token, matches!(start, Begin::After(..)));
        let remote = self.remote();
        let task = self.spawn(async move {
            let request = match start {
                Begin::Begun(request) => request,
                Begin::After(wait, begin) => {
                    let _ = wait.await;
                    remote
                        .call(move |data| {
                            data.write(|state| {
                                state.resume_read(key, token);
                                begin(state, ticket)
                            })
                        })
                        .await?
                }
            };
            let completion = request.fetch(&remote).await;
            remote
                .call(move |data| {
                    data.finish(completion, |tasks| {
                        tasks.reads.remove(&token);
                    })
                })
                .await?
        });
        store.tasks().reads.insert(token, task.clone());
        task
    }

    /// Completes `completion`, where `release` drops the task it ends, and begins the reads it asks for.
    pub(crate) fn complete(&self, completion: Completion, release: impl FnOnce(&mut Tasks)) {
        self.write_effects(|store, effects| {
            let Store { state, tasks } = store;
            state.complete(completion, effects);
            release(tasks);
        });
    }

    /// Runs the write `f`, then the effects it asks for, under one flush: the consumer sees the reads they begin with
    /// the change that asked for them, never the read idle between the two.
    fn write_effects(&self, f: impl FnOnce(&mut Store, &mut Vec<Effect>)) {
        let mut effects = Vec::new();
        {
            let mut store = self.lock();
            store.batch += 1;
            f(&mut store.0, &mut effects);
        }
        self.run(effects);
        let mut store = self.lock();
        store.batch -= 1;
        self.flush(store);
    }

    /// [`Data::complete`], passing on the error the request failed with.
    fn finish(&self, completion: Completion, release: impl FnOnce(&mut Tasks)) -> Result<(), Error> {
        let result = completion.error().cloned().map_or(Ok(()), Err);
        self.complete(completion, release);
        result
    }

    /// Applies one batch of events under one flush. A delta that came as JSON, and that no listener wants, applies
    /// borrowed from it, adjacent deltas of one part joined first, as the connection's batches join
    /// decoded ones; the rest apply decoded. Then each streaming delta goes to the [`DeltaListening`]s, and each event of
    /// a listened type to [`Data::take_signals`], moved out of the batch.
    pub fn apply<P: Into<Payload>>(&self, batch: impl IntoIterator<Item = P>) {
        self.apply_payloads(&mut batch.into_iter().map(Into::into).collect::<Vec<_>>());
    }

    /// [`Data::apply`] on a batch as the connection sends it, which it empties.
    pub fn apply_payloads(&self, batch: &mut Vec<Payload>) {
        let mut text = self.inner.joined.take();
        self.write_effects(|store, effects| {
            let mut at = 0;
            while at < batch.len() {
                // A delta listener wants the owned events.
                if let Kind::Hot(hot, _) = batch[at].0
                    && self.inner.deltas.cursors.borrow().is_empty()
                {
                    let run = batch[at..].iter().take_while(|next| matches!(next.0, Kind::Hot(next, _) if next == hot));
                    let end = at + run.count();
                    store.state.apply_borrowed(hot, &batch[at..end], &mut text);
                    at = end;
                    continue;
                }
                if let Some(event) = batch[at].event() {
                    store.state.apply(event, effects);
                }
                at += 1;
            }
        });
        self.inner.joined.set(text);
        let mut told = false;
        for Payload(kind) in batch.drain(..) {
            let Kind::Event(event) = kind else { continue };
            if Delta::of(&event).is_some() {
                // A delta of a session whose messages are not loaded changes nothing, and is kept all the same.
                told |= self.inner.deltas.keep(event);
            } else if self.listens(&event) {
                self.inner.signals.borrow_mut().push(event);
                told = true;
            }
        }
        if told {
            self.changed();
        }
    }

    /// Whether a [`Listening`] wants `event`: of its kind, and of its name for a named kind.
    fn listens(&self, event: &V2Event) -> bool {
        let kind = event.kind();
        self.inner.listened[kind as usize].get() > 0
            && (!kind.named() || self.inner.named.borrow().contains_key(event.tag()))
    }

    /// Marks the connection up or down. Going down invalidates every cached read; the UI decides
    /// what to read again.
    pub fn set_online(&self, online: bool) {
        if self.inner.online.replace(online) && !online {
            self.write(State::invalidate_all);
        }
    }
}

/// How a keyed load starts: begun by the caller, or after the load it replaces.
enum Begin<R, B> {
    Begun(R),
    After(Task<()>, B),
}

/// What a write borrows: the state, and the tasks its requests run as.
pub(crate) struct Store {
    state: State,
    tasks: Tasks,
}

/// The tasks callers await, by the token the state keeps of their work. A task removes its entry when it settles, in
/// the write that settles its work in the state, so a token the state holds always finds its task.
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

/// The [`Store`] borrowed for a write; it derefs to the state.
pub(crate) struct Locked<'a>(RefMut<'a, Store>);

impl Locked<'_> {
    pub(crate) fn tasks(&mut self) -> &mut Tasks {
        &mut self.0.tasks
    }
}

impl std::ops::Deref for Locked<'_> {
    type Target = State;

    fn deref(&self) -> &State {
        &self.0.state
    }
}

impl std::ops::DerefMut for Locked<'_> {
    fn deref_mut(&mut self) -> &mut State {
        &mut self.0.state
    }
}

/// The store as other threads reach it: its client and runtime, and its mailbox, the bounded queue of what its owner
/// runs next. Cheap to clone.
#[derive(Clone)]
pub struct Remote(Arc<Mailbox>);

struct Mailbox {
    client: Client,
    runtime: Handle,
    /// The size of a session's first transcript read.
    head: i64,
    queue: Mutex<Queue>,
    /// Free places in the queue: a sender waits for one, and the owner gives them back as it drains.
    room: Semaphore,
    wake: Box<dyn Fn() -> Result<(), Unwoken> + Send + Sync>,
    /// Whether a listener wants the deltas owned, for the connection.
    wanted: Wanted,
}

#[derive(Default)]
struct Queue {
    mail: VecDeque<Mail>,
    /// The owner was asked to drain, and has not started since.
    woken: bool,
}

/// What other threads send the owner.
pub(crate) enum Mail {
    /// A batch of events, applied after marking the connection up or down when it says.
    Batch(Vec<Payload>, Option<bool>),
    Online(bool),
    Run(Box<dyn FnOnce(&Data) + Send>),
}

impl Mail {
    /// The events it carries.
    pub(crate) fn events(&self) -> usize {
        match self {
            Mail::Batch(events, _) => events.len(),
            _ => 0,
        }
    }
}

impl Remote {
    pub fn client(&self) -> &Client {
        &self.0.client
    }

    pub(crate) fn head(&self) -> i64 {
        self.0.head
    }

    /// Whether a listener wants the deltas owned: the connection reads its payloads with it ([`Payload::read`]).
    pub fn wanted(&self) -> Wanted {
        self.0.wanted.clone()
    }

    /// Queues `mail` for the owner once there is room, and wakes it if it is not awake. False once the store is gone.
    pub(crate) async fn send(&self, mail: Mail) -> bool {
        let Ok(permit) = self.0.room.acquire().await else { return false };
        permit.forget();
        self.push(mail)
    }

    /// [`Remote::send`] when there is room now; else the mail comes back, or nothing once the store is gone.
    pub(crate) fn try_send(&self, mail: Mail) -> Result<(), Option<Mail>> {
        match self.0.room.try_acquire() {
            Ok(permit) => permit.forget(),
            Err(TryAcquireError::NoPermits) => return Err(Some(mail)),
            Err(TryAcquireError::Closed) => return Err(None),
        }
        if self.push(mail) { Ok(()) } else { Err(None) }
    }

    /// Waits until the mailbox has room; false once the store is gone.
    pub(crate) async fn room(&self) -> bool {
        self.0.room.acquire().await.is_ok()
    }

    /// Queues `mail`, which has its place, and wakes the owner if it is not awake; false once the store is gone.
    fn push(&self, mail: Mail) -> bool {
        let wake = {
            let mut queue = lock(&self.0.queue);
            // Checked under the lock `close` takes the mail under, so no mail stays in a closed mailbox.
            if self.0.room.is_closed() {
                return false;
            }
            queue.mail.push_back(mail);
            !std::mem::replace(&mut queue.woken, true)
        };
        if wake {
            self.wake();
        }
        true
    }

    /// Asks the owner to drain. While its queue is full, a task asks again until it is not; senders meanwhile only
    /// queue, since one wake is out.
    fn wake(&self) {
        match (self.0.wake)() {
            Ok(()) => {}
            Err(Unwoken::Gone) => self.close(),
            Err(Unwoken::Busy) => {
                let remote = self.clone();
                self.0.runtime.spawn(async move {
                    let mut wait = Duration::from_millis(1);
                    loop {
                        tokio::time::sleep(wait).await;
                        if remote.0.room.is_closed() {
                            return;
                        }
                        match (remote.0.wake)() {
                            Ok(()) => return,
                            Err(Unwoken::Gone) => return remote.close(),
                            Err(Unwoken::Busy) => wait = (wait * 2).min(Duration::from_millis(50)),
                        }
                    }
                });
            }
        }
    }

    /// Ends the mailbox: senders stop, and the mail not run is dropped, ending the tasks that wait on it. The owner's
    /// wake follows, so a drain loop sees its store gone.
    fn close(&self) {
        if self.0.room.is_closed() {
            return;
        }
        let mail = {
            let mut queue = lock(&self.0.queue);
            self.0.room.close();
            std::mem::take(&mut queue.mail)
        };
        drop(mail);
        let _ = (self.0.wake)();
    }

    /// Runs `f` on the owner's thread. `f` is boxed at once, so a task that awaits this holds a pointer, not `f` and
    /// what it captures (often a whole completion).
    pub(crate) fn post(&self, f: impl FnOnce(&Data) + Send + 'static) -> impl Future<Output = ()> + Send + 'static {
        let (remote, mail) = (self.clone(), Mail::Run(Box::new(f)));
        async move {
            remote.send(mail).await;
        }
    }

    /// Runs `f` on the owner's thread and returns its answer, or an error once the store is gone: how a task asks the
    /// state something between two awaits. `f` is boxed at once, as for [`Remote::post`].
    pub fn call<R: Send + 'static>(
        &self,
        f: impl FnOnce(&Data) -> R + Send + 'static,
    ) -> impl Future<Output = Result<R, Error>> + Send + 'static {
        let (reply, answer) = oneshot::channel();
        let posted = self.post(move |data| {
            let _ = reply.send(f(data));
        });
        async move {
            posted.await;
            answer
                .await
                .map_err(|_| Arc::new(opencode_api::error::Error::Transport("store task failed: store gone".into())))
        }
    }
}

/// Event types [`Data::take_signals`] has while it lives; see [`Data::listen`].
#[must_use = "the types stop being sent when this drops"]
pub struct Listening {
    inner: Weak<Inner>,
    kinds: EventKinds,
}

impl Drop for Listening {
    fn drop(&mut self) {
        let Some(inner) = self.inner.upgrade() else { return };
        for index in self.kinds.indices() {
            let listened = &inner.listened[index];
            listened.set(listened.get() - 1);
        }
        let mut named = inner.named.borrow_mut();
        for name in self.kinds.names() {
            if let Some(count) = named.get_mut(name) {
                *count -= 1;
            }
        }
        named.retain(|_, count| *count > 0);
    }
}

/// The streaming deltas kept for the [`DeltaListening`]s, numbered in the order kept. A listener's take lends them,
/// and its callback may start or end listeners: neither touches what it lends.
#[derive(Default)]
struct Deltas {
    /// The deltas some listener has not taken.
    kept: RefCell<VecDeque<V2Event>>,
    /// The number of the first delta kept.
    first: Cell<u64>,
    /// Each listener's first delta not taken, by its ID.
    cursors: RefCell<HashMap<u64, u64>>,
    /// The ID of the next listener.
    ids: Cell<u64>,
}

impl Deltas {
    /// The number the next delta kept gets.
    fn next(&self) -> u64 {
        self.first.get() + self.kept.borrow().len() as u64
    }

    /// Keeps `event` while someone listens; whether it did.
    fn keep(&self, event: V2Event) -> bool {
        let mut kept = self.kept.borrow_mut();
        if self.cursors.borrow().is_empty() {
            // The last listener's drop left these.
            self.first.set(self.first.get() + kept.len() as u64);
            kept.clear();
            return false;
        }
        if kept.len() == DELTAS {
            kept.pop_front();
            self.first.set(self.first.get() + 1);
        }
        kept.push_back(event);
        true
    }

    /// Drops the deltas every listener has taken.
    fn trim(&self) {
        let next = self.next();
        let taken = self.cursors.borrow().values().min().copied().unwrap_or(next);
        let mut kept = self.kept.borrow_mut();
        let count = (taken.saturating_sub(self.first.get()) as usize).min(kept.len());
        kept.drain(..count);
        self.first.set(self.first.get() + count as u64);
    }
}

/// The streaming deltas kept for [`Self::take`] while it lives; see [`Data::listen_deltas`].
#[must_use = "the deltas stop being kept when this drops"]
pub struct DeltaListening {
    inner: Weak<Inner>,
    id: u64,
}

impl DeltaListening {
    /// Calls `f` with the streaming deltas the store applied since this listener last took them, or since it started,
    /// oldest first. `f` may start or end listeners. It must not take again, or apply a batch: either panics, as the
    /// deltas are lent to it.
    pub fn take<R>(&self, f: impl FnOnce(&[V2Event]) -> R) -> R {
        let Some(inner) = self.inner.upgrade() else { return f(&[]) };
        let deltas = &inner.deltas;
        let next = deltas.next();
        let Some(cursor) = deltas.cursors.borrow_mut().insert(self.id, next) else { return f(&[]) };
        let skip = cursor.saturating_sub(deltas.first.get()) as usize;
        deltas.kept.borrow_mut().make_contiguous();
        let result = {
            let kept = deltas.kept.borrow();
            let kept = kept.as_slices().0;
            f(&kept[skip.min(kept.len())..])
        };
        deltas.trim();
        result
    }
}

impl Drop for DeltaListening {
    fn drop(&mut self) {
        if let Some(inner) = self.inner.upgrade() {
            let mut cursors = inner.deltas.cursors.borrow_mut();
            cursors.remove(&self.id);
            inner.remote.0.wanted.set(!cursors.is_empty());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn data() -> (tokio::runtime::Runtime, Data) {
        let runtime = tokio::runtime::Builder::new_current_thread().build().unwrap();
        let client = Client::new("http://opencode.local").unwrap();
        let data = Data::new(client, Options::default(), runtime.handle().clone(), || Ok(()));
        (runtime, data)
    }

    #[test]
    #[should_panic(expected = "store read inside a store write")]
    fn a_read_inside_a_write_panics() {
        let (_runtime, data) = data();
        data.write(|_| data.read(|_| ()));
    }
}
