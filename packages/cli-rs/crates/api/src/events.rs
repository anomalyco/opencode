//! The event stream: one-shot reads and the reconnecting connection loop. On overflow the connection drops the stream
//! rather than silently losing deltas; consumers resynchronize on the next `server.connected`.

use std::collections::VecDeque;
use std::fmt;
use std::panic::AssertUnwindSafe;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use futures_util::StreamExt;
use futures_util::future::BoxFuture;
use futures_util::stream::BoxStream;
use opencode_util::lock;
use tokio::sync::{Notify, mpsc, watch};
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;

/// The event every stream starts with, and the one that tells consumers to resynchronize.
pub const CONNECTED: &str = "server.connected";

/// A server event.
pub trait Event: Send + 'static {
    /// Whether it is the event every stream starts with ([`CONNECTED`]).
    fn connected(&self) -> bool;

    /// Folds `next` into `self` when both continue the same delta stream (for example two text deltas
    /// of one message part), and reports whether it did. Only adjacent events of one batch merge.
    fn merge(&mut self, _next: &Self) -> bool {
        false
    }
}

impl Event for serde_json::Value {
    fn connected(&self) -> bool {
        self.get("type").and_then(serde_json::Value::as_str) == Some(CONNECTED)
    }
}

/// One `GET /api/event` stream with each event decoded as `T`, for clients without the reconnecting
/// [`connect`] loop (mini, ACP). A failure to open the stream is its first item.
pub fn raw<T: serde::de::DeserializeOwned + Send + 'static>(
    client: &crate::client::Client,
) -> BoxStream<'static, Result<T, crate::error::Error>> {
    let client = client.clone();
    futures_util::stream::once(async move {
        client.event_subscribe(&crate::generated::EventSubscribeInput::default()).await
    })
    .flat_map(|opened| match opened {
        Ok(response) => crate::transport::SseResponse::<T>::new(response.response).events(|| {}).boxed(),
        Err(error) => futures_util::stream::once(async move { Err(error) }).boxed(),
    })
    .boxed()
}

/// Reports transport activity, including keepalive comments that carry no event.
pub type Activity = Arc<dyn Fn() + Send + Sync>;

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

/// How long a stream past its idle deadline may still deliver before it counts as stalled.
const STALL_GRACE: Duration = Duration::from_secs(1);

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
pub fn connect<E: Event, S: Source<E>>(source: S, options: Options) -> (Connection, mpsc::Receiver<Vec<E>>) {
    let (batches, receiver) = mpsc::channel(options.queue.max(1));
    let (state, watcher) = watch::channel(State { status: Status::Connecting, attempt: 0, error: None });
    let connection = Connection {
        cancel: CancellationToken::new(),
        state: watcher,
        history: Arc::new(Mutex::new(VecDeque::new())),
        resync: Arc::new(Resync { reason: Mutex::new(None), notify: Notify::new() }),
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
                state.status = if attempt == 0 { Status::Connecting } else { Status::Reconnecting };
                state.attempt = attempt;
            });
            let End::Failed { error, connected_at, forced } = self.stream(attempt).await else { return };
            if connected_at.is_some_and(|at| at.elapsed() >= self.options.reconnect_delay) {
                attempt = 0;
            }
            attempt += 1;
            self.record(RecordStatus::Disconnected, attempt, Some(error.clone()));
            log::info!("event stream disconnected: attempt {attempt}: {error}");
            self.state.send_replace(State { status: Status::Reconnecting, attempt, error: Some(error) });

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
        self.record(if attempt == 0 { RecordStatus::Connecting } else { RecordStatus::Reconnecting }, attempt, None);
        log::info!("event stream connecting: attempt {attempt}");
        // A reader that panics ends its stream like a failed one, so the loop reconnects.
        let mut stream =
            AssertUnwindSafe(self.source.open(Arc::new(move || touch.notify_one()))).catch_unwind().map(|item| {
                match item {
                    Ok(item) => item.map_err(|error| error.to_string()),
                    Err(payload) => {
                        let message = payload
                            .downcast_ref::<&str>()
                            .map(|message| message.to_string())
                            .or_else(|| payload.downcast_ref::<String>().cloned())
                            .unwrap_or_default();
                        log::error!("event stream reader panicked: {message}");
                        Err(format!("Event stream reader panicked: {message}"))
                    }
                }
            });
        let failed = |error: &str, connected_at| End::Failed { error: error.to_owned(), connected_at, forced: false };

        let first = tokio::select! {
            _ = self.cancel.cancelled() => return End::Stopped,
            _ = tokio::time::sleep(self.options.connect_timeout) => return failed("Timed out connecting to server", None),
            first = stream.next() => first,
        };
        let first = match first {
            None => return failed("Event stream disconnected", None),
            Some(Err(error)) => return failed(&error.to_string(), None),
            Some(Ok(first)) if !first.connected() => {
                return failed("Event stream did not start with server.connected", None);
            }
            Some(Ok(first)) => first,
        };
        self.record(RecordStatus::Connected, attempt, None);
        let connected_at = Some(Instant::now());
        log::info!("event stream connected");
        self.state.send_replace(State { status: Status::Connected, attempt: 0, error: None });
        // A resync requested before this stream connected is stale.
        lock(&self.resync.reason).take();
        let mut idle = Instant::now() + self.options.idle_timeout;
        // Set once the idle deadline passed and the stream got its grace to deliver what is buffered.
        let mut probing = false;
        let mut flush = Some(Instant::now() + self.options.flush_interval);
        self.pending.push(first);

        let end = loop {
            tokio::select! {
                _ = self.cancel.cancelled() => break End::Stopped,
                _ = activity.notified() => {
                    idle = Instant::now() + self.options.idle_timeout;
                    probing = false;
                }
                // The clock keeps counting while the process is stopped (Ctrl+Z), so on resume the
                // deadline can fire before the runtime sees the events buffered in the socket.
                _ = tokio::time::sleep_until(idle) => {
                    if probing {
                        break failed("Event stream stalled", connected_at);
                    }
                    probing = true;
                    idle = Instant::now() + STALL_GRACE;
                }
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
                        probing = false;
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
            Err(mpsc::error::TrySendError::Full(_)) => {
                Some(End::Failed { error: "Event queue full".to_owned(), connected_at, forced: false })
            }
        }
    }

    fn record(&self, status: RecordStatus, attempt: u32, error: Option<String>) {
        let created = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |elapsed| elapsed.as_millis() as i64);
        let mut history = lock(&self.history);
        history.push_back(Record { created, status, attempt, error });
        if history.len() > HISTORY_LIMIT {
            history.pop_front();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};

    #[derive(Debug, Clone, PartialEq)]
    struct Ev {
        kind: &'static str,
        value: i64,
        text: String,
    }

    fn ev(kind: &'static str, value: i64) -> Ev {
        Ev { kind, value, text: String::new() }
    }

    fn delta(value: i64, text: &str) -> Ev {
        Ev { kind: "session.text.delta", value, text: text.to_owned() }
    }

    impl Event for Ev {
        fn connected(&self) -> bool {
            self.kind == CONNECTED
        }

        fn merge(&mut self, next: &Self) -> bool {
            if self.kind != "session.text.delta" || next.kind != self.kind || next.value != self.value {
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
        dropped: Arc<AtomicBool>,
        activity: Activity,
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

    impl Source<Ev> for Fake {
        type Error = Failure;

        fn open(&mut self, activity: Activity) -> BoxStream<'static, Result<Ev, Failure>> {
            let (sender, receiver) = mpsc::unbounded_channel();
            let dropped = Arc::new(AtomicBool::new(false));
            let flag = DropFlag(dropped.clone());
            lock(&self.opened).push(Arc::new(Upstream { sender: Mutex::new(Some(sender)), dropped, activity }));
            futures_util::stream::unfold((receiver, flag), |(mut receiver, flag)| async move {
                receiver.recv().await.map(|item| (item, (receiver, flag)))
            })
            .boxed()
        }
    }

    impl Fake {
        fn count(&self) -> usize {
            lock(&self.opened).len()
        }

        fn at(&self, index: usize) -> Arc<Upstream> {
            lock(&self.opened)[index].clone()
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

    fn options(idle: u64) -> Options {
        Options { flush_interval: Duration::ZERO, idle_timeout: Duration::from_millis(idle), ..Options::default() }
    }

    fn disconnected(attempt: u32, error: &str) -> (RecordStatus, u32, Option<String>) {
        (RecordStatus::Disconnected, attempt, Some(error.to_owned()))
    }

    fn records(connection: &Connection) -> Vec<(RecordStatus, u32, Option<String>)> {
        connection.history().into_iter().map(|record| (record.status, record.attempt, record.error)).collect()
    }

    async fn drain(receiver: &mut mpsc::Receiver<Vec<Ev>>, events: &mut Vec<Ev>) {
        settle().await;
        while let Ok(batch) = receiver.try_recv() {
            events.extend(batch);
        }
    }

    // A process resuming from suspension may have both an expired idle timer and buffered socket events.
    #[tokio::test(start_paused = true)]
    async fn events_buffered_while_stopped_survive_an_elapsed_idle_deadline() {
        let fake = Fake::default();
        let (connection, mut batches) = connect(fake.clone(), options(60));
        until(|| fake.count() == 1).await;
        fake.at(0).push(ev(CONNECTED, 1));
        until(|| connection.state().status == Status::Connected).await;

        tokio::time::advance(Duration::from_secs(90)).await;
        settle().await;
        fake.at(0).push(ev("session.updated", 2));
        fake.at(0).push(ev("session.updated", 3));
        let mut events = Vec::new();
        drain(&mut batches, &mut events).await;
        assert_eq!(events, vec![ev(CONNECTED, 1), ev("session.updated", 2), ev("session.updated", 3)]);
        assert_eq!(fake.count(), 1);
        assert!(!fake.at(0).dropped());
        assert!(!records(&connection).contains(&disconnected(1, "Event stream stalled")));

        // A stream that stays silent through the grace still counts as stalled.
        let silent = Instant::now();
        until(|| fake.count() == 2).await;
        assert!(silent.elapsed() >= Duration::from_millis(60) + STALL_GRACE);
        assert!(records(&connection).contains(&disconnected(1, "Event stream stalled")));
    }

    // Each failed stream is recorded and replaced after the delay; a stream that stayed up resets the attempt count.
    #[tokio::test(start_paused = true)]
    async fn failed_streams_reconnect_after_the_delay_and_record_why() {
        let fake = Fake::default();
        let (connection, _batches) = connect(fake.clone(), options(10_000));
        until(|| fake.count() == 2).await;
        fake.at(1).push(ev("session.updated", 0));
        until(|| fake.count() == 3).await;
        fake.at(2).push(ev(CONNECTED, 1));
        tokio::time::sleep(Duration::from_secs(2)).await;
        fake.at(2).close();
        let closed = Instant::now();
        until(|| fake.count() == 4).await;
        assert!(closed.elapsed() >= Duration::from_secs(1));
        fake.at(3).push(ev(CONNECTED, 2));
        fake.at(3).fail("Transport: contract failure");
        until(|| fake.count() == 5).await;
        let records = records(&connection);
        for (attempt, error) in [
            (1, "Timed out connecting to server"),
            (2, "Event stream did not start with server.connected"),
            (1, "Event stream disconnected"),
            (2, "Transport: contract failure"),
        ] {
            assert!(records.contains(&disconnected(attempt, error)), "{error}: {records:?}");
        }
    }

    #[tokio::test(start_paused = true)]
    async fn keepalives_hold_a_quiet_stream_and_dropping_the_connection_closes_it() {
        let fake = Fake::default();
        let (connection, _batches) = connect(fake.clone(), options(60));
        until(|| fake.count() == 1).await;
        fake.at(0).push(ev(CONNECTED, 1));
        // Past the idle timeout and its stall grace.
        for _ in 0..100 {
            tokio::time::sleep(Duration::from_millis(20)).await;
            (fake.at(0).activity)();
        }
        assert_eq!((fake.count(), connection.state().status), (1, Status::Connected));
        drop(connection);
        until(|| fake.at(0).dropped()).await;
        tokio::time::sleep(Duration::from_secs(5)).await;
        assert_eq!(fake.count(), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn a_resolved_server_reconnects_without_the_delay() {
        #[derive(Clone)]
        struct Resolving(Fake);
        impl Source<Ev> for Resolving {
            type Error = Failure;
            fn open(&mut self, activity: Activity) -> BoxStream<'static, Result<Ev, Failure>> {
                self.0.open(activity)
            }
            fn reconnect(&mut self) -> BoxFuture<'_, bool> {
                Box::pin(async { true })
            }
        }
        let fake = Fake::default();
        let (_connection, _batches) = connect(Resolving(fake.clone()), options(10_000));
        until(|| fake.count() == 1).await;
        fake.at(0).push(ev(CONNECTED, 0));
        settle().await;
        fake.at(0).close();
        let closed = Instant::now();
        until(|| fake.count() == 2).await;
        assert!(closed.elapsed() < Duration::from_millis(100));
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
    async fn a_reader_that_fails_or_panics_once_reconnects_and_keeps_delivering() {
        #[derive(Clone)]
        struct Panicking(Fake);
        impl Source<Ev> for Panicking {
            type Error = Failure;
            fn open(&mut self, activity: Activity) -> BoxStream<'static, Result<Ev, Failure>> {
                self.0
                    .open(activity)
                    .map(|item| {
                        if item.as_ref().is_ok_and(|event| event.kind == "panic") {
                            panic!("reader bug");
                        }
                        item
                    })
                    .boxed()
            }
        }
        for (panic, error) in [(true, "Event stream reader panicked: reader bug"), (false, "Transport: reader failure")]
        {
            let fake = Fake::default();
            let (connection, mut batches) = connect(Panicking(fake.clone()), options(10_000));
            until(|| fake.count() == 1).await;
            fake.at(0).push(ev(CONNECTED, 1));
            fake.at(0).push(ev("session.updated", 1));
            until(|| connection.state().status == Status::Connected).await;
            if panic {
                fake.at(0).push(ev("panic", 0));
            } else {
                fake.at(0).fail("Transport: reader failure");
            }
            until(|| fake.count() == 2).await;
            assert!(records(&connection).contains(&disconnected(1, error)));

            fake.at(1).push(ev(CONNECTED, 2));
            fake.at(1).push(ev("session.updated", 2));
            until(|| connection.state().status == Status::Connected).await;
            let mut events = Vec::new();
            drain(&mut batches, &mut events).await;
            assert_eq!(
                events,
                vec![ev(CONNECTED, 1), ev("session.updated", 1), ev(CONNECTED, 2), ev("session.updated", 2)],
                "{error}"
            );
        }
    }

    #[tokio::test(start_paused = true)]
    async fn batches_merge_adjacent_deltas() {
        let fake = Fake::default();
        let (connection, mut batches) =
            connect(fake.clone(), Options { flush_interval: Duration::from_millis(10), ..Options::default() });
        until(|| fake.count() == 1).await;
        for event in
            [ev(CONNECTED, 0), delta(1, "a"), delta(1, "b"), delta(2, "c"), ev("session.updated", 0), delta(1, "d")]
        {
            fake.at(0).push(event);
        }
        let batch = tokio::time::timeout(Duration::from_secs(1), batches.recv()).await.unwrap().unwrap();
        assert_eq!(
            batch,
            vec![ev(CONNECTED, 0), delta(1, "ab"), delta(2, "c"), ev("session.updated", 0), delta(1, "d")]
        );
        assert_eq!(connection.state().status, Status::Connected);
    }

    #[tokio::test(start_paused = true)]
    async fn a_full_queue_drops_the_stream_and_reconnects() {
        let fake = Fake::default();
        let (connection, mut batches) = connect(fake.clone(), Options { queue: 1, ..options(10_000) });
        until(|| fake.count() == 1).await;
        fake.at(0).push(ev(CONNECTED, 0));
        until(|| connection.state().status == Status::Connected).await;
        fake.at(0).push(ev("session.updated", 1));
        until(|| fake.count() == 2).await;
        assert!(fake.at(0).dropped());
        assert!(records(&connection).contains(&disconnected(1, "Event queue full")));
        assert_eq!(batches.recv().await.unwrap(), vec![ev(CONNECTED, 0)]);
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
            let output = std::process::Command::new("opencode").args(args).output().expect("opencode runs");
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
            fn open(&mut self, activity: Activity) -> BoxStream<'static, Result<serde_json::Value, Self::Error>> {
                let request =
                    crate::transport::fetch(self.client.get(&self.url).basic_auth("opencode", Some(&self.password)));
                futures_util::stream::once(async move {
                    let response = request.await.map_err(|error| error.to_string());
                    match response.and_then(|response| response.error_for_status().map_err(|error| error.to_string())) {
                        Ok(response) => crate::sse::events(response.bytes_stream(), move || activity()).boxed(),
                        Err(error) => {
                            futures_util::stream::once(async move { Err(crate::sse::Error::Transport(error)) }).boxed()
                        }
                    }
                })
                .flatten()
                .boxed()
            }
        }
        let url = format!("{}/api/event", server.trim_end_matches('/'));
        let (connection, mut batches) =
            connect(Live { client: crate::transport::http_client(), url, password }, Options::default());
        let mut kinds = Vec::new();
        let deadline = Instant::now() + Duration::from_secs(20);
        while kinds.len() < 5 {
            let Ok(Some(batch)) = tokio::time::timeout_at(deadline, batches.recv()).await else { break };
            kinds.extend(batch.iter().map(|event| event["type"].as_str().unwrap_or_default().to_owned()));
        }
        println!("live: {server} state {:?}", connection.state());
        println!("live: event types {}", serde_json::to_string(&kinds).unwrap());
        assert_eq!(kinds.first().map(String::as_str), Some(CONNECTED));
    }
}
