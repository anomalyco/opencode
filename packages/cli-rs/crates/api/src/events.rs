//! Event subscription and the connection loop (F.3).
//!
//! Both are generic over the event type, so the generated event union plugs in through [`Event`].
//!
//! - [`SharedEvents`] ports `packages/client/src/shared-events.ts`: subscribers share one upstream
//!   stream, filter by type (`server.connected` always passes), a late subscriber gets the latest
//!   `server.connected`, and a subscriber that falls 4,096 events behind fails alone.
//! - [`connect`] ports `createClientConnection` (`packages/client/src/solid/connection.ts`): the stream
//!   must start with `server.connected` within 2 s, any received bytes count as activity, 45 s of
//!   silence replaces the stream, a disconnect reconnects after 1 s, and events reach the consumer in
//!   10 ms batches with adjacent deltas merged. The batch queue is bounded: when it is full the loop
//!   drops the stream and reconnects, and the consumer resynchronizes on the next `server.connected`
//!   (deviation `parity/deviations/A09-bounded-queue.md`).

use std::collections::{HashMap, HashSet, VecDeque};
use std::fmt;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use futures_util::StreamExt;
use futures_util::future::BoxFuture;
use futures_util::stream::BoxStream;
use tokio::sync::{Notify, mpsc, watch};
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;

/// The event every stream starts with, and the one that tells consumers to resynchronize.
pub const CONNECTED: &str = "server.connected";

/// How many events a [`SharedEvents`] subscriber may hold unread before it fails.
pub const CAPACITY: usize = 4_096;

/// A server event.
pub trait Event: Clone + Send + 'static {
    /// The wire `type` tag.
    fn kind(&self) -> &str;

    /// Folds `next` into `self` when both continue the same delta stream (for example two text deltas
    /// of one message part), and reports whether it did. Only adjacent events of one batch merge.
    fn merge(&mut self, _next: &Self) -> bool {
        false
    }
}

impl Event for serde_json::Value {
    fn kind(&self) -> &str {
        self.get("type")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default()
    }
}

/// Reports transport activity, including keepalive comments that carry no event.
pub type Activity = Arc<dyn Fn() + Send + Sync>;

/// Opens one upstream event stream. The token is cancelled when the stream is no longer wanted.
pub type Connect<E, X> =
    Arc<dyn Fn(CancellationToken, Activity) -> BoxStream<'static, Result<E, X>> + Send + Sync>;

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

// ---------------------------------------------------------------------------------------------------
// Shared subscription

#[derive(Debug, thiserror::Error)]
pub enum SubscribeError<X> {
    /// The upstream failed; every subscriber gets the same error.
    #[error("{0}")]
    Source(Arc<X>),
    #[error("Event subscriber exceeded its {CAPACITY}-event capacity")]
    Overflow,
}

impl<X> Clone for SubscribeError<X> {
    fn clone(&self) -> Self {
        match self {
            Self::Source(error) => Self::Source(error.clone()),
            Self::Overflow => Self::Overflow,
        }
    }
}

/// One upstream shared by any number of subscriptions, opened by the first read and closed when the
/// last subscription ends.
pub struct SharedEvents<E, X> {
    hub: Arc<Mutex<Hub<E, X>>>,
    connect: Connect<E, X>,
}

impl<E, X> Clone for SharedEvents<E, X> {
    fn clone(&self) -> Self {
        Self {
            hub: self.hub.clone(),
            connect: self.connect.clone(),
        }
    }
}

struct Hub<E, X> {
    next: u64,
    current: Option<u64>,
    upstreams: HashMap<u64, Upstream<E, X>>,
}

struct Upstream<E, X> {
    cancel: CancellationToken,
    subscribers: Vec<Arc<Subscriber<E, X>>>,
    connected: Option<E>,
}

struct Subscriber<E, X> {
    types: Option<HashSet<String>>,
    activity: Option<Activity>,
    state: Mutex<Inbox<E, X>>,
    notify: Notify,
}

struct Inbox<E, X> {
    queue: VecDeque<E>,
    completion: Option<Option<SubscribeError<X>>>,
}

impl<E: Event, X> Subscriber<E, X> {
    /// Queues `event` if selected; returns false when the subscriber overflowed and must be removed.
    fn push(&self, event: &E) -> bool {
        let selected = self
            .types
            .as_ref()
            .is_none_or(|types| event.kind() == CONNECTED || types.contains(event.kind()));
        let mut inbox = lock(&self.state);
        if inbox.completion.is_some() || !selected {
            return true;
        }
        if inbox.queue.len() == CAPACITY {
            inbox.queue.clear();
            inbox.completion = Some(Some(SubscribeError::Overflow));
            drop(inbox);
            self.notify.notify_one();
            return false;
        }
        inbox.queue.push_back(event.clone());
        drop(inbox);
        self.notify.notify_one();
        true
    }

    fn finish(&self, completion: Option<SubscribeError<X>>, discard: bool) {
        let mut inbox = lock(&self.state);
        if inbox.completion.is_none() {
            inbox.completion = Some(completion);
        }
        if discard {
            inbox.queue.clear();
        }
        drop(inbox);
        self.notify.notify_one();
    }
}

impl<E: Event, X: Send + Sync + 'static> SharedEvents<E, X> {
    pub fn new(connect: Connect<E, X>) -> Self {
        Self {
            hub: Arc::new(Mutex::new(Hub {
                next: 0,
                current: None,
                upstreams: HashMap::new(),
            })),
            connect,
        }
    }

    /// A lazy subscription: nothing opens until its first [`Subscription::next`]. With `types`, only
    /// those events and `server.connected` come through.
    pub fn subscribe(
        &self,
        types: Option<&[&str]>,
        activity: Option<Activity>,
    ) -> Subscription<E, X> {
        let types = types
            .filter(|types| !types.is_empty())
            .map(|types| types.iter().map(|kind| (*kind).to_owned()).collect());
        Subscription {
            shared: self.clone(),
            subscriber: Arc::new(Subscriber {
                types,
                activity,
                state: Mutex::new(Inbox {
                    queue: VecDeque::new(),
                    completion: None,
                }),
                notify: Notify::new(),
            }),
            upstream: None,
        }
    }

    fn start(&self, subscriber: &Arc<Subscriber<E, X>>) -> u64 {
        let mut hub = lock(&self.hub);
        let fresh = hub.current.is_none();
        let id = match hub.current {
            Some(id) => id,
            None => {
                let id = hub.next;
                hub.next += 1;
                hub.current = Some(id);
                hub.upstreams.insert(
                    id,
                    Upstream {
                        cancel: CancellationToken::new(),
                        subscribers: Vec::new(),
                        connected: None,
                    },
                );
                id
            }
        };
        let upstream = hub
            .upstreams
            .get_mut(&id)
            .expect("the current upstream is registered");
        upstream.subscribers.push(subscriber.clone());
        if let Some(connected) = &upstream.connected {
            subscriber.push(connected);
        }
        let cancel = upstream.cancel.clone();
        drop(hub);
        if fresh {
            tokio::spawn(self.clone().run(id, cancel));
        }
        id
    }

    async fn run(self, id: u64, cancel: CancellationToken) {
        let hub = Arc::downgrade(&self.hub);
        let activity: Activity = Arc::new(move || {
            let Some(hub) = hub.upgrade() else { return };
            let callbacks = lock(&hub)
                .upstreams
                .get(&id)
                .map(|upstream| {
                    upstream
                        .subscribers
                        .iter()
                        .filter_map(|subscriber| subscriber.activity.clone())
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            callbacks.iter().for_each(|callback| callback());
        });
        let mut stream = (self.connect)(cancel.clone(), activity);
        let completion = loop {
            let item = tokio::select! {
                _ = cancel.cancelled() => break None,
                item = stream.next() => item,
            };
            match item {
                None => break None,
                Some(Err(error)) => break Some(SubscribeError::Source(Arc::new(error))),
                Some(Ok(event)) => {
                    let mut hub = lock(&self.hub);
                    let Some(upstream) = hub.upstreams.get_mut(&id) else {
                        break None;
                    };
                    if event.kind() == CONNECTED {
                        upstream.connected = Some(event.clone());
                    }
                    upstream
                        .subscribers
                        .retain(|subscriber| subscriber.push(&event));
                    if upstream.subscribers.is_empty() {
                        Self::stop(&mut hub, id);
                    }
                }
            }
        };
        let subscribers = {
            let mut hub = lock(&self.hub);
            Self::stop(&mut hub, id);
            hub.upstreams
                .remove(&id)
                .map(|upstream| upstream.subscribers)
                .unwrap_or_default()
        };
        drop(stream);
        subscribers
            .iter()
            .for_each(|subscriber| subscriber.finish(completion.clone(), false));
    }

    /// Detaches an upstream: new subscriptions open a replacement while this one winds down.
    fn stop(hub: &mut Hub<E, X>, id: u64) {
        if hub.current == Some(id) {
            hub.current = None;
        }
        if let Some(upstream) = hub.upstreams.get_mut(&id) {
            upstream.connected = None;
            upstream.cancel.cancel();
        }
    }

    fn leave(&self, id: u64, subscriber: &Arc<Subscriber<E, X>>) {
        let mut hub = lock(&self.hub);
        let Some(upstream) = hub.upstreams.get_mut(&id) else {
            return;
        };
        let before = upstream.subscribers.len();
        upstream
            .subscribers
            .retain(|other| !Arc::ptr_eq(other, subscriber));
        if before != upstream.subscribers.len() && upstream.subscribers.is_empty() {
            Self::stop(&mut hub, id);
        }
    }
}

/// One consumer of a [`SharedEvents`]. Dropping it, or [`Subscription::close`], leaves the upstream.
pub struct Subscription<E: Event, X: Send + Sync + 'static> {
    shared: SharedEvents<E, X>,
    subscriber: Arc<Subscriber<E, X>>,
    upstream: Option<u64>,
}

impl<E: Event, X: Send + Sync + 'static> Subscription<E, X> {
    /// The next event; `None` once the subscription or the upstream ended. A failure repeats on every
    /// later call, as the TypeScript iterator rejects every later `next()`.
    pub async fn next(&mut self) -> Option<Result<E, SubscribeError<X>>> {
        loop {
            {
                let mut inbox = lock(&self.subscriber.state);
                if let Some(event) = inbox.queue.pop_front() {
                    return Some(Ok(event));
                }
                if let Some(completion) = &inbox.completion {
                    return completion.clone().map(Err);
                }
            }
            if self.upstream.is_none() {
                self.upstream = Some(self.shared.start(&self.subscriber));
                continue;
            }
            self.subscriber.notify.notified().await;
        }
    }

    pub fn close(&mut self) {
        self.subscriber.finish(None, true);
        if let Some(id) = self.upstream {
            self.shared.leave(id, &self.subscriber);
        }
    }
}

impl<E: Event, X: Send + Sync + 'static> Drop for Subscription<E, X> {
    fn drop(&mut self) {
        self.close();
    }
}

// ---------------------------------------------------------------------------------------------------
// Connection loop

/// Where the connection loop gets its streams.
pub trait Source<E>: Send + 'static {
    type Error: fmt::Display + Send;

    /// Opens a new event stream; `activity` must run for every received chunk.
    fn open(&mut self, activity: Activity) -> BoxStream<'static, Result<E, Self::Error>>;

    /// Runs after each disconnect, before the reconnect delay, to resolve the server again (the TS
    /// `reconnect` option). Returns true when a new server was resolved; the first reconnect after a
    /// fresh resolution then skips the delay.
    fn reconnect(&mut self) -> BoxFuture<'_, bool> {
        Box::pin(async { false })
    }
}

#[derive(Debug, Clone)]
pub struct Options {
    pub flush_interval: Duration,
    pub idle_timeout: Duration,
    pub connect_timeout: Duration,
    pub reconnect_delay: Duration,
    /// Batches the consumer may hold unread before the loop drops the stream and reconnects.
    pub queue: usize,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            flush_interval: Duration::from_millis(10),
            idle_timeout: Duration::from_secs(45),
            connect_timeout: Duration::from_secs(2),
            reconnect_delay: Duration::from_secs(1),
            queue: 256,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    Connecting,
    Connected,
    Reconnecting,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct State {
    pub status: Status,
    pub attempt: u32,
    pub error: Option<String>,
}

/// One entry of the connection history, as the TS `client.connection` event.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Record {
    pub created: i64,
    pub status: RecordStatus,
    pub attempt: u32,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecordStatus {
    Connecting,
    Connected,
    Disconnected,
    Reconnecting,
}

const HISTORY_LIMIT: usize = 50;

/// A running connection loop. Dropping it stops the loop and closes the stream.
pub struct Connection {
    cancel: CancellationToken,
    state: watch::Receiver<State>,
    history: Arc<Mutex<VecDeque<Record>>>,
    resync: Arc<Resync>,
}

struct Resync {
    reason: Mutex<Option<String>>,
    notify: Notify,
}

impl Connection {
    pub fn state(&self) -> State {
        self.state.borrow().clone()
    }

    /// A receiver that wakes on every state change.
    pub fn watch(&self) -> watch::Receiver<State> {
        self.state.clone()
    }

    /// The last 50 connection records, oldest first.
    pub fn history(&self) -> Vec<Record> {
        lock(&self.history).iter().cloned().collect()
    }

    /// Drops the live stream so the loop replaces it now, without the reconnect delay. Ignored unless
    /// connected.
    pub fn resync(&self, reason: &str) {
        if self.state.borrow().status != Status::Connected {
            return;
        }
        *lock(&self.resync.reason) = Some(reason.to_owned());
        self.resync.notify.notify_one();
    }
}

impl Drop for Connection {
    fn drop(&mut self) {
        self.cancel.cancel();
    }
}

/// Starts the connection loop on the current tokio runtime. Batches arrive on the returned receiver;
/// dropping the receiver stops the loop.
pub fn connect<E: Event, S: Source<E>>(
    source: S,
    options: Options,
) -> (Connection, mpsc::Receiver<Vec<E>>) {
    let (batches, receiver) = mpsc::channel(options.queue.max(1));
    let (state, watcher) = watch::channel(State {
        status: Status::Connecting,
        attempt: 0,
        error: None,
    });
    let connection = Connection {
        cancel: CancellationToken::new(),
        state: watcher,
        history: Arc::new(Mutex::new(VecDeque::new())),
        resync: Arc::new(Resync {
            reason: Mutex::new(None),
            notify: Notify::new(),
        }),
    };
    let runner = Runner {
        source,
        options,
        batches,
        state,
        history: connection.history.clone(),
        resync: connection.resync.clone(),
        cancel: connection.cancel.clone(),
        pending: Vec::new(),
    };
    tokio::spawn(runner.run());
    (connection, receiver)
}

struct Runner<E, S> {
    source: S,
    options: Options,
    batches: mpsc::Sender<Vec<E>>,
    state: watch::Sender<State>,
    history: Arc<Mutex<VecDeque<Record>>>,
    resync: Arc<Resync>,
    cancel: CancellationToken,
    pending: Vec<E>,
}

/// Why one stream ended.
enum End {
    /// The loop was stopped or the consumer is gone.
    Stopped,
    Failed {
        error: String,
        connected_at: Option<Instant>,
        forced: bool,
    },
}

impl<E: Event, S: Source<E>> Runner<E, S> {
    async fn run(mut self) {
        let mut attempt = 0;
        loop {
            self.state.send_modify(|state| {
                state.status = if attempt == 0 {
                    Status::Connecting
                } else {
                    Status::Reconnecting
                };
                state.attempt = attempt;
            });
            let End::Failed {
                error,
                connected_at,
                forced,
            } = self.stream(attempt).await
            else {
                return;
            };
            if connected_at.is_some_and(|at| at.elapsed() >= self.options.reconnect_delay) {
                attempt = 0;
            }
            attempt += 1;
            self.record(RecordStatus::Disconnected, attempt, Some(error.clone()));
            log::info!("event stream disconnected: attempt {attempt}: {error}");
            self.state.send_replace(State {
                status: Status::Reconnecting,
                attempt,
                error: Some(error),
            });

            let resolved = tokio::select! {
                _ = self.cancel.cancelled() => return,
                resolved = self.source.reconnect() => resolved,
            };
            if (resolved && attempt == 1) || forced {
                continue;
            }
            tokio::select! {
                _ = self.cancel.cancelled() => return,
                _ = tokio::time::sleep(self.options.reconnect_delay) => {}
            }
        }
    }

    async fn stream(&mut self, attempt: u32) -> End {
        let activity = Arc::new(Notify::new());
        let touch = activity.clone();
        self.record(
            if attempt == 0 {
                RecordStatus::Connecting
            } else {
                RecordStatus::Reconnecting
            },
            attempt,
            None,
        );
        log::info!("event stream connecting: attempt {attempt}");
        let mut stream = self.source.open(Arc::new(move || touch.notify_one()));
        let failed = |error: &str, connected_at| End::Failed {
            error: error.to_owned(),
            connected_at,
            forced: false,
        };

        let first = tokio::select! {
            _ = self.cancel.cancelled() => return End::Stopped,
            _ = tokio::time::sleep(self.options.connect_timeout) => return failed("Timed out connecting to server", None),
            first = stream.next() => first,
        };
        let first = match first {
            None => return failed("Event stream disconnected", None),
            Some(Err(error)) => return failed(&error.to_string(), None),
            Some(Ok(first)) if first.kind() != CONNECTED => {
                return failed("Event stream did not start with server.connected", None);
            }
            Some(Ok(first)) => first,
        };
        self.record(RecordStatus::Connected, attempt, None);
        let connected_at = Some(Instant::now());
        log::info!("event stream connected");
        self.state.send_replace(State {
            status: Status::Connected,
            attempt: 0,
            error: None,
        });
        // A resync requested before this stream connected is stale.
        lock(&self.resync.reason).take();
        let mut idle = Instant::now() + self.options.idle_timeout;
        let mut flush = Some(Instant::now() + self.options.flush_interval);
        self.pending.push(first);

        let end = loop {
            tokio::select! {
                _ = self.cancel.cancelled() => break End::Stopped,
                _ = activity.notified() => idle = Instant::now() + self.options.idle_timeout,
                _ = tokio::time::sleep_until(idle) => break failed("Event stream stalled", connected_at),
                _ = self.resync.notify.notified() => {
                    if let Some(reason) = lock(&self.resync.reason).take() {
                        log::info!("event stream resync: {reason}");
                        break End::Failed { error: reason, connected_at, forced: true };
                    }
                }
                _ = tokio::time::sleep_until(flush.unwrap_or(idle)), if flush.is_some() => {
                    flush = None;
                    if let Some(end) = self.flush(connected_at) {
                        break end;
                    }
                }
                item = stream.next() => match item {
                    None => break failed("Event stream disconnected", connected_at),
                    Some(Err(error)) => break failed(&error.to_string(), connected_at),
                    Some(Ok(event)) => {
                        idle = Instant::now() + self.options.idle_timeout;
                        self.pending.push(event);
                        flush.get_or_insert_with(|| Instant::now() + self.options.flush_interval);
                    }
                },
            }
        };
        drop(stream);
        match self.flush(connected_at) {
            Some(End::Stopped) => End::Stopped,
            _ => end,
        }
    }

    /// Sends the pending events as one batch with adjacent deltas merged.
    fn flush(&mut self, connected_at: Option<Instant>) -> Option<End> {
        if self.pending.is_empty() {
            return None;
        }
        let mut batch: Vec<E> = Vec::with_capacity(self.pending.len());
        for event in self.pending.drain(..) {
            if batch.last_mut().is_some_and(|last| last.merge(&event)) {
                continue;
            }
            batch.push(event);
        }
        match self.batches.try_send(batch) {
            Ok(()) => None,
            Err(mpsc::error::TrySendError::Closed(_)) => Some(End::Stopped),
            Err(mpsc::error::TrySendError::Full(_)) => Some(End::Failed {
                error: "Event queue full".to_owned(),
                connected_at,
                forced: false,
            }),
        }
    }

    fn record(&self, status: RecordStatus, attempt: u32, error: Option<String>) {
        let created = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |elapsed| elapsed.as_millis() as i64);
        let mut history = lock(&self.history);
        history.push_back(Record {
            created,
            status,
            attempt,
            error,
        });
        if history.len() > HISTORY_LIMIT {
            history.pop_front();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

    #[derive(Debug, Clone, PartialEq)]
    struct Ev {
        kind: &'static str,
        value: i64,
        text: String,
    }

    fn ev(kind: &'static str, value: i64) -> Ev {
        Ev {
            kind,
            value,
            text: String::new(),
        }
    }

    fn delta(value: i64, text: &str) -> Ev {
        Ev {
            kind: "session.text.delta",
            value,
            text: text.to_owned(),
        }
    }

    impl Event for Ev {
        fn kind(&self) -> &str {
            self.kind
        }

        fn merge(&mut self, next: &Self) -> bool {
            if self.kind != "session.text.delta"
                || next.kind != self.kind
                || next.value != self.value
            {
                return false;
            }
            self.text.push_str(&next.text);
            true
        }
    }

    #[derive(Debug, PartialEq)]
    struct Failure(&'static str);

    impl fmt::Display for Failure {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            f.write_str(self.0)
        }
    }

    /// One fake upstream: the test pushes events into it, and `dropped` reports that its reader let go.
    struct Upstream {
        sender: Mutex<Option<mpsc::UnboundedSender<Result<Ev, Failure>>>>,
        activity: Activity,
        cancel: CancellationToken,
        dropped: Arc<AtomicBool>,
    }

    impl Upstream {
        fn push(&self, event: Ev) {
            if let Some(sender) = lock(&self.sender).as_ref() {
                let _ = sender.send(Ok(event));
            }
        }

        fn fail(&self, failure: &'static str) {
            if let Some(sender) = lock(&self.sender).take() {
                let _ = sender.send(Err(Failure(failure)));
            }
        }

        fn close(&self) {
            lock(&self.sender).take();
        }

        fn dropped(&self) -> bool {
            self.dropped.load(Ordering::SeqCst)
        }
    }

    struct DropFlag(Arc<AtomicBool>);

    impl Drop for DropFlag {
        fn drop(&mut self) {
            self.0.store(true, Ordering::SeqCst);
        }
    }

    #[derive(Clone, Default)]
    struct Fake {
        opened: Arc<Mutex<Vec<Arc<Upstream>>>>,
    }

    impl Fake {
        fn open(
            &self,
            cancel: CancellationToken,
            activity: Activity,
        ) -> BoxStream<'static, Result<Ev, Failure>> {
            let (sender, receiver) = mpsc::unbounded_channel();
            let dropped = Arc::new(AtomicBool::new(false));
            let flag = DropFlag(dropped.clone());
            lock(&self.opened).push(Arc::new(Upstream {
                sender: Mutex::new(Some(sender)),
                activity,
                cancel,
                dropped,
            }));
            futures_util::stream::unfold((receiver, flag), |(mut receiver, flag)| async move {
                receiver.recv().await.map(|item| (item, (receiver, flag)))
            })
            .boxed()
        }

        fn count(&self) -> usize {
            lock(&self.opened).len()
        }

        fn at(&self, index: usize) -> Arc<Upstream> {
            lock(&self.opened)[index].clone()
        }

        fn shared(&self) -> SharedEvents<Ev, Failure> {
            let fake = self.clone();
            SharedEvents::new(Arc::new(move |cancel, activity| {
                fake.open(cancel, activity)
            }))
        }
    }

    impl Source<Ev> for Fake {
        type Error = Failure;

        fn open(&mut self, activity: Activity) -> BoxStream<'static, Result<Ev, Failure>> {
            Fake::open(self, CancellationToken::new(), activity)
        }
    }

    /// Lets spawned tasks run until they block.
    async fn settle() {
        for _ in 0..20 {
            tokio::task::yield_now().await;
        }
    }

    /// Advances paused time in 1 ms steps until `check` holds.
    async fn until(mut check: impl FnMut() -> bool) {
        for _ in 0..20_000 {
            if check() {
                return;
            }
            tokio::time::sleep(Duration::from_millis(1)).await;
        }
        panic!("timed out waiting for condition");
    }

    type Read = tokio::task::JoinHandle<(
        Subscription<Ev, Failure>,
        Option<Result<Ev, SubscribeError<Failure>>>,
    )>;

    /// Starts a read in the background, as an unawaited `next()` promise in the TS tests.
    fn read(mut subscription: Subscription<Ev, Failure>) -> Read {
        tokio::spawn(async move {
            let item = subscription.next().await;
            (subscription, item)
        })
    }

    async fn next(
        subscription: &mut Subscription<Ev, Failure>,
    ) -> Option<Result<Ev, SubscribeError<Failure>>> {
        tokio::time::timeout(Duration::from_secs(1), subscription.next())
            .await
            .expect("next() hung")
    }

    fn value(item: Option<Result<Ev, SubscribeError<Failure>>>) -> Ev {
        item.expect("an event").expect("not an error")
    }

    // Ports of packages/client/test/shared-events.test.ts.

    #[tokio::test]
    async fn creation_subscription_and_idle_subscriptions_are_lazy() {
        let fake = Fake::default();
        let shared = fake.shared();
        let mut idle = shared.subscribe(None, None);
        settle().await;
        assert_eq!(fake.count(), 0);
        idle.close();
        assert!(next(&mut idle).await.is_none());
        assert_eq!(fake.count(), 0);

        let active = read(shared.subscribe(None, None));
        settle().await;
        assert_eq!(fake.count(), 1);
        fake.at(0).push(ev(CONNECTED, 0));
        let (active, item) = active.await.unwrap();
        assert_eq!(value(item), ev(CONNECTED, 0));
        drop(active);
        settle().await;
        assert!(fake.at(0).dropped());
    }

    #[tokio::test]
    async fn a_subscription_dropped_before_its_first_read_opens_nothing() {
        let fake = Fake::default();
        drop(fake.shared().subscribe(None, None));
        settle().await;
        assert_eq!(fake.count(), 0);
    }

    #[tokio::test]
    async fn consumers_share_one_source_and_receive_native_and_rpc_events() {
        let fake = Fake::default();
        let shared = fake.shared();
        let (mut first, mut second) = (shared.subscribe(None, None), shared.subscribe(None, None));
        for event in [
            ev(CONNECTED, 0),
            ev("session.updated", 0),
            ev("rpc.example.updated", 1),
        ] {
            let reads = (read(first), read(second));
            settle().await;
            fake.at(0).push(event.clone());
            let (one, a) = reads.0.await.unwrap();
            let (two, b) = reads.1.await.unwrap();
            assert_eq!((value(a), value(b)), (event.clone(), event));
            (first, second) = (one, two);
        }
        assert_eq!(fake.count(), 1);
        first.close();
        assert!(!fake.at(0).cancel.is_cancelled());
        let pending = read(second);
        settle().await;
        fake.at(0).push(ev("rpc.example.updated", 2));
        let (second, item) = pending.await.unwrap();
        assert_eq!(value(item), ev("rpc.example.updated", 2));
        drop(second);
        settle().await;
        assert!(fake.at(0).cancel.is_cancelled());
        assert!(fake.at(0).dropped());
    }

    #[tokio::test]
    async fn a_types_filter_delivers_only_the_requested_types_plus_server_connected() {
        let fake = Fake::default();
        let mut filtered = fake.shared().subscribe(Some(&["session.updated"]), None);
        let connected = read(filtered);
        settle().await;
        for kind in [
            CONNECTED,
            "permission.asked",
            "rpc.example.updated",
            "session.updated",
        ] {
            fake.at(0).push(ev(kind, 0));
        }
        let item;
        (filtered, item) = connected.await.unwrap();
        assert_eq!(value(item), ev(CONNECTED, 0));
        assert_eq!(value(next(&mut filtered).await), ev("session.updated", 0));
    }

    #[tokio::test]
    async fn a_slow_or_idle_consumer_does_not_stall_other_subscribers() {
        let fake = Fake::default();
        let shared = fake.shared();
        let mut slow = shared.subscribe(None, None);
        let mut fast = shared.subscribe(None, None);
        let reads = (read(slow), read(fast));
        settle().await;
        fake.at(0).push(ev(CONNECTED, 0));
        (slow, _) = reads.0.await.unwrap();
        (fast, _) = reads.1.await.unwrap();

        fake.at(0).push(ev("permission.asked", 1));
        assert_eq!(value(next(&mut fast).await), ev("permission.asked", 1));
        fake.at(0).push(ev("session.updated", 2));
        assert_eq!(value(next(&mut fast).await), ev("session.updated", 2));

        assert_eq!(value(next(&mut slow).await), ev("permission.asked", 1));
        assert_eq!(value(next(&mut slow).await), ev("session.updated", 2));
    }

    #[tokio::test]
    async fn an_idle_consumer_fails_instead_of_buffering_without_bound() {
        let fake = Fake::default();
        let mut idle = fake.shared().subscribe(None, None);
        let connected = read(idle);
        settle().await;
        fake.at(0).push(ev(CONNECTED, 0));
        (idle, _) = connected.await.unwrap();

        (0..=CAPACITY as i64).for_each(|value| fake.at(0).push(ev("session.updated", value)));
        // The last subscriber overflowed, so the source closes.
        until(|| fake.at(0).dropped()).await;
        let error = next(&mut idle).await.unwrap().unwrap_err();
        assert!(matches!(error, SubscribeError::Overflow));
        assert_eq!(
            error.to_string(),
            "Event subscriber exceeded its 4096-event capacity"
        );
    }

    #[tokio::test]
    async fn source_completion_preserves_events_already_buffered() {
        let fake = Fake::default();
        let mut idle = fake.shared().subscribe(None, None);
        let connected = read(idle);
        settle().await;
        fake.at(0).push(ev(CONNECTED, 0));
        (idle, _) = connected.await.unwrap();
        fake.at(0).push(ev("session.updated", 1));
        fake.at(0).push(ev("session.updated", 2));
        fake.at(0).close();
        settle().await;
        assert!(fake.at(0).dropped());

        assert_eq!(value(next(&mut idle).await), ev("session.updated", 1));
        assert_eq!(value(next(&mut idle).await), ev("session.updated", 2));
        assert!(next(&mut idle).await.is_none());
    }

    #[tokio::test]
    async fn late_consumers_receive_the_latest_connection_marker_but_no_replay() {
        let fake = Fake::default();
        let shared = fake.shared();
        let mut first = shared.subscribe(None, None);
        let mut idle = shared.subscribe(None, None);
        let pending = read(first);
        settle().await;
        fake.at(0).push(ev(CONNECTED, 1));
        (first, _) = pending.await.unwrap();
        for event in [ev(CONNECTED, 2), ev("rpc.example.updated", 3)] {
            fake.at(0).push(event.clone());
            assert_eq!(value(next(&mut first).await), event);
        }

        assert_eq!(value(next(&mut idle).await), ev(CONNECTED, 2));
        let pending = read(idle);
        settle().await;
        fake.at(0).push(ev("rpc.example.updated", 4));
        assert_eq!(
            value(pending.await.unwrap().1),
            ev("rpc.example.updated", 4)
        );
        assert_eq!(fake.count(), 1);
    }

    #[tokio::test]
    async fn closing_removes_only_its_subscriber_and_the_last_close_ends_the_source() {
        let fake = Fake::default();
        let shared = fake.shared();
        let first = read(shared.subscribe(None, None));
        let second = read(shared.subscribe(None, None));
        settle().await;
        first.abort();
        settle().await;
        assert!(!fake.at(0).cancel.is_cancelled());

        second.abort();
        settle().await;
        assert!(fake.at(0).cancel.is_cancelled());
        assert!(fake.at(0).dropped());
    }

    #[tokio::test]
    async fn rapid_resubscription_opens_a_replacement() {
        let fake = Fake::default();
        let shared = fake.shared();
        let mut first = shared.subscribe(None, None);
        let pending = read(first);
        settle().await;
        fake.at(0).push(ev(CONNECTED, 1));
        (first, _) = pending.await.unwrap();
        // The old upstream has not finished cleaning up when the replacements subscribe.
        first.close();
        let second = read(shared.subscribe(None, None));
        let third = read(shared.subscribe(None, None));
        let cancelled = read(shared.subscribe(None, None));
        settle().await;
        cancelled.abort();
        assert_eq!(fake.count(), 2);

        fake.at(1).push(ev(CONNECTED, 2));
        assert_eq!(value(second.await.unwrap().1), ev(CONNECTED, 2));
        assert_eq!(value(third.await.unwrap().1), ev(CONNECTED, 2));
        assert!(fake.at(0).dropped());
    }

    #[tokio::test]
    async fn source_eof_finishes_all_consumers_and_permits_a_fresh_subscription() {
        let fake = Fake::default();
        let shared = fake.shared();
        let reads = (
            read(shared.subscribe(None, None)),
            read(shared.subscribe(None, None)),
        );
        settle().await;
        fake.at(0).push(ev(CONNECTED, 1));
        let (mut first, _) = reads.0.await.unwrap();
        let (mut second, _) = reads.1.await.unwrap();
        fake.at(0).push(ev("rpc.example.updated", 2));
        assert_eq!(value(next(&mut first).await), ev("rpc.example.updated", 2));
        assert_eq!(value(next(&mut second).await), ev("rpc.example.updated", 2));
        fake.at(0).close();
        assert!(next(&mut first).await.is_none());
        assert!(next(&mut second).await.is_none());
        assert_eq!(fake.count(), 1);

        let fresh = read(shared.subscribe(None, None));
        settle().await;
        fake.at(1).push(ev(CONNECTED, 3));
        assert_eq!(value(fresh.await.unwrap().1), ev(CONNECTED, 3));
    }

    #[tokio::test]
    async fn source_failures_reach_every_consumer_as_the_same_error() {
        let fake = Fake::default();
        let shared = fake.shared();
        let reads = (
            read(shared.subscribe(None, None)),
            read(shared.subscribe(None, None)),
        );
        settle().await;
        fake.at(0).fail("actual source failure");
        let (mut first, a) = reads.0.await.unwrap();
        let (_second, b) = reads.1.await.unwrap();
        let (Some(Err(SubscribeError::Source(a))), Some(Err(SubscribeError::Source(b)))) = (a, b)
        else {
            panic!("both consumers fail");
        };
        assert!(Arc::ptr_eq(&a, &b));
        assert_eq!(*a, Failure("actual source failure"));
        let Some(Err(SubscribeError::Source(again))) = next(&mut first).await else {
            panic!("the failure repeats")
        };
        assert!(Arc::ptr_eq(&a, &again));
        assert_eq!(fake.count(), 1);

        let fresh = read(shared.subscribe(None, None));
        settle().await;
        fake.at(1).push(ev(CONNECTED, 0));
        assert_eq!(value(fresh.await.unwrap().1), ev(CONNECTED, 0));
    }

    #[tokio::test]
    async fn a_source_that_fails_to_open_rejects_subscribers_without_retry() {
        let attempts = Arc::new(Mutex::new(Vec::<CancellationToken>::new()));
        let recorded = attempts.clone();
        let shared: SharedEvents<Ev, Failure> = SharedEvents::new(Arc::new(move |cancel, _| {
            lock(&recorded).push(cancel);
            futures_util::stream::once(async { Err(Failure("connect failed")) }).boxed()
        }));
        let error = next(&mut shared.subscribe(None, None)).await;
        assert!(
            matches!(error, Some(Err(SubscribeError::Source(ref failure))) if **failure == Failure("connect failed"))
        );
        settle().await;
        assert_eq!(lock(&attempts).len(), 1);
        assert!(lock(&attempts)[0].is_cancelled());
        assert!(matches!(
            next(&mut shared.subscribe(None, None)).await,
            Some(Err(_))
        ));
        assert_eq!(lock(&attempts).len(), 2);
    }

    #[tokio::test]
    async fn source_activity_fans_out_to_every_subscriber_that_asked_for_it() {
        let fake = Fake::default();
        let shared = fake.shared();
        let count = Arc::new(AtomicUsize::new(0));
        let counter = count.clone();
        let first = read(shared.subscribe(
            None,
            Some(Arc::new(move || {
                counter.fetch_add(1, Ordering::SeqCst);
            })),
        ));
        let second = read(shared.subscribe(None, None));
        settle().await;
        (fake.at(0).activity)();
        (fake.at(0).activity)();
        fake.at(0).push(ev(CONNECTED, 0));
        first.await.unwrap();
        second.await.unwrap();
        assert_eq!(count.load(Ordering::SeqCst), 2);
    }

    // Ports of packages/client/test/solid-connection.test.ts, plus the A09 batching and queue rules.

    fn options(idle: u64) -> Options {
        Options {
            flush_interval: Duration::ZERO,
            idle_timeout: Duration::from_millis(idle),
            ..Options::default()
        }
    }

    fn disconnected(attempt: u32, error: &str) -> (RecordStatus, u32, Option<String>) {
        (RecordStatus::Disconnected, attempt, Some(error.to_owned()))
    }

    fn records(connection: &Connection) -> Vec<(RecordStatus, u32, Option<String>)> {
        connection
            .history()
            .into_iter()
            .map(|record| (record.status, record.attempt, record.error))
            .collect()
    }

    async fn drain(receiver: &mut mpsc::Receiver<Vec<Ev>>, events: &mut Vec<Ev>) {
        settle().await;
        while let Ok(batch) = receiver.try_recv() {
            events.extend(batch);
        }
    }

    #[tokio::test(start_paused = true)]
    async fn a_stream_that_goes_silent_past_the_idle_timeout_is_replaced() {
        let fake = Fake::default();
        let (connection, mut batches) = connect(fake.clone(), options(60));
        until(|| fake.count() == 1).await;
        fake.at(0).push(ev(CONNECTED, 1));
        until(|| connection.state().status == Status::Connected).await;

        until(|| fake.count() == 2).await;
        assert!(fake.at(0).dropped());
        assert!(records(&connection).contains(&disconnected(1, "Event stream stalled")));

        fake.at(1).push(ev(CONNECTED, 2));
        until(|| connection.state().status == Status::Connected).await;
        let mut events = Vec::new();
        drain(&mut batches, &mut events).await;
        assert_eq!(events, vec![ev(CONNECTED, 1), ev(CONNECTED, 2)]);
        assert_eq!(connection.state().error, None);
    }

    #[tokio::test(start_paused = true)]
    async fn keepalive_activity_holds_a_quiet_stream_open() {
        let fake = Fake::default();
        let (connection, mut batches) = connect(fake.clone(), options(60));
        until(|| fake.count() == 1).await;
        fake.at(0).push(ev(CONNECTED, 1));
        until(|| connection.state().status == Status::Connected).await;

        for _ in 0..12 {
            tokio::time::sleep(Duration::from_millis(20)).await;
            (fake.at(0).activity)();
        }
        assert_eq!(fake.count(), 1);
        assert!(!fake.at(0).dropped());
        assert_eq!(connection.state().status, Status::Connected);
        let mut events = Vec::new();
        drain(&mut batches, &mut events).await;
        assert_eq!(events.len(), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn a_forced_resync_replaces_the_stream_immediately_and_only_while_connected() {
        let fake = Fake::default();
        let (connection, _batches) = connect(fake.clone(), options(10_000));
        connection.resync("too early");
        until(|| fake.count() == 1).await;
        settle().await;
        assert!(!fake.at(0).dropped());
        fake.at(0).push(ev(CONNECTED, 1));
        until(|| connection.state().status == Status::Connected).await;

        let started = Instant::now();
        connection.resync("Network connection restored");
        until(|| fake.count() == 2).await;
        assert!(started.elapsed() < Duration::from_millis(500));
        assert!(fake.at(0).dropped());
        assert!(records(&connection).contains(&disconnected(1, "Network connection restored")));
        fake.at(1).push(ev(CONNECTED, 2));
        until(|| connection.state().status == Status::Connected).await;
    }

    #[tokio::test(start_paused = true)]
    async fn a_stream_the_server_closes_or_fails_reconnects_and_reports_the_disconnect() {
        for (fail, message) in [
            (false, "Event stream disconnected"),
            (true, "Transport: contract failure"),
        ] {
            let fake = Fake::default();
            let (connection, _batches) = connect(fake.clone(), options(10_000));
            until(|| fake.count() == 1).await;
            fake.at(0).push(ev(CONNECTED, 1));
            until(|| connection.state().status == Status::Connected).await;

            if fail {
                fake.at(0).fail("Transport: contract failure")
            } else {
                fake.at(0).close()
            }
            until(|| connection.state().status == Status::Reconnecting).await;
            assert_eq!(connection.state().error.as_deref(), Some(message));
            let disconnected_at = Instant::now();
            until(|| fake.count() == 2).await;
            assert!(
                disconnected_at.elapsed() >= Duration::from_secs(1),
                "reconnects after the delay"
            );
        }
    }

    #[tokio::test(start_paused = true)]
    async fn the_stream_must_start_with_server_connected_within_the_connect_timeout() {
        let fake = Fake::default();
        let (connection, _batches) = connect(fake.clone(), options(10_000));
        until(|| fake.count() == 2).await;
        assert_eq!(
            records(&connection)[1],
            disconnected(1, "Timed out connecting to server")
        );

        fake.at(1).push(ev("session.updated", 0));
        until(|| fake.count() == 3).await;
        assert_eq!(
            records(&connection)[3],
            disconnected(2, "Event stream did not start with server.connected")
        );
        assert_eq!(connection.state().attempt, 2);
    }

    #[tokio::test(start_paused = true)]
    async fn batches_merge_adjacent_deltas() {
        let fake = Fake::default();
        let (connection, mut batches) = connect(
            fake.clone(),
            Options {
                flush_interval: Duration::from_millis(10),
                ..Options::default()
            },
        );
        until(|| fake.count() == 1).await;
        for event in [
            ev(CONNECTED, 0),
            delta(1, "a"),
            delta(1, "b"),
            delta(2, "c"),
            ev("session.updated", 0),
            delta(1, "d"),
        ] {
            fake.at(0).push(event);
        }
        let batch = tokio::time::timeout(Duration::from_secs(1), batches.recv())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            batch,
            vec![
                ev(CONNECTED, 0),
                delta(1, "ab"),
                delta(2, "c"),
                ev("session.updated", 0),
                delta(1, "d")
            ]
        );
        assert_eq!(connection.state().status, Status::Connected);
    }

    #[tokio::test(start_paused = true)]
    async fn a_full_queue_drops_the_stream_and_reconnects() {
        let fake = Fake::default();
        let (connection, mut batches) = connect(
            fake.clone(),
            Options {
                queue: 1,
                ..options(10_000)
            },
        );
        until(|| fake.count() == 1).await;
        fake.at(0).push(ev(CONNECTED, 0));
        until(|| connection.state().status == Status::Connected).await;
        fake.at(0).push(ev("session.updated", 1));
        until(|| fake.count() == 2).await;
        assert!(fake.at(0).dropped());
        assert!(records(&connection).contains(&disconnected(1, "Event queue full")));
        assert_eq!(batches.recv().await.unwrap(), vec![ev(CONNECTED, 0)]);
    }

    #[tokio::test(start_paused = true)]
    async fn a_resolved_server_reconnects_without_the_delay() {
        #[derive(Clone)]
        struct Resolving(Fake, Arc<AtomicUsize>);
        impl Source<Ev> for Resolving {
            type Error = Failure;
            fn open(&mut self, activity: Activity) -> BoxStream<'static, Result<Ev, Failure>> {
                self.0.open(CancellationToken::new(), activity)
            }
            fn reconnect(&mut self) -> BoxFuture<'_, bool> {
                self.1.fetch_add(1, Ordering::SeqCst);
                Box::pin(async { true })
            }
        }
        let fake = Fake::default();
        let resolved = Arc::new(AtomicUsize::new(0));
        let (connection, _batches) =
            connect(Resolving(fake.clone(), resolved.clone()), options(10_000));
        until(|| fake.count() == 1).await;
        fake.at(0).push(ev(CONNECTED, 0));
        until(|| connection.state().status == Status::Connected).await;
        tokio::time::sleep(Duration::from_secs(2)).await;
        fake.at(0).close();
        let closed = Instant::now();
        until(|| fake.count() == 2).await;
        assert!(closed.elapsed() < Duration::from_millis(100));
        assert_eq!(resolved.load(Ordering::SeqCst), 1);
        assert_eq!(
            connection.state().attempt,
            1,
            "a stream that stayed up resets the attempt count"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn dropping_the_connection_closes_the_stream() {
        let fake = Fake::default();
        let (connection, _batches) = connect(fake.clone(), options(10_000));
        until(|| fake.count() == 1).await;
        fake.at(0).push(ev(CONNECTED, 0));
        until(|| connection.state().status == Status::Connected).await;
        drop(connection);
        until(|| fake.at(0).dropped()).await;
        tokio::time::sleep(Duration::from_secs(5)).await;
        assert_eq!(fake.count(), 1);
    }

    /// Opt-in live check (`OPENCODE_LIVE=1`): subscribes to the running service's event stream through
    /// the SSE reader and the connection loop, and prints the first event types. The URL and password
    /// come from `opencode service status` and `opencode service get password`, as `script/live.sh` does.
    #[tokio::test]
    async fn live_event_stream() {
        if std::env::var("OPENCODE_LIVE").as_deref() != Ok("1") {
            return;
        }
        let command = |args: &[&str]| {
            let output = std::process::Command::new("opencode")
                .args(args)
                .output()
                .expect("opencode runs");
            assert!(output.status.success(), "opencode {args:?} failed");
            String::from_utf8(output.stdout).unwrap().trim().to_owned()
        };
        let server = command(&["service", "status"]);
        let password = command(&["service", "get", "password"]);

        struct Live {
            client: reqwest::Client,
            url: String,
            password: String,
        }
        impl Source<serde_json::Value> for Live {
            type Error = crate::sse::Error;
            fn open(
                &mut self,
                activity: Activity,
            ) -> BoxStream<'static, Result<serde_json::Value, Self::Error>> {
                let request = self
                    .client
                    .get(&self.url)
                    .basic_auth("opencode", Some(&self.password))
                    .send();
                futures_util::stream::once(async move {
                    match request.await.and_then(reqwest::Response::error_for_status) {
                        Ok(response) => {
                            crate::sse::events(response.bytes_stream(), move || activity()).boxed()
                        }
                        Err(error) => futures_util::stream::once(async move {
                            Err(crate::sse::Error::Transport(error.to_string()))
                        })
                        .boxed(),
                    }
                })
                .flatten()
                .boxed()
            }
        }
        let url = format!("{}/api/event", server.trim_end_matches('/'));
        let (connection, mut batches) = connect(
            Live {
                client: reqwest::Client::new(),
                url,
                password,
            },
            Options::default(),
        );
        let mut kinds = Vec::new();
        let deadline = Instant::now() + Duration::from_secs(20);
        while kinds.len() < 5 {
            let Ok(Some(batch)) = tokio::time::timeout_at(deadline, batches.recv()).await else {
                break;
            };
            kinds.extend(batch.iter().map(|event| event.kind().to_owned()));
        }
        println!("live: {server} state {:?}", connection.state());
        println!(
            "live: event types {}",
            serde_json::to_string(&kinds).unwrap()
        );
        assert_eq!(kinds.first().map(String::as_str), Some(CONNECTED));
    }
}
