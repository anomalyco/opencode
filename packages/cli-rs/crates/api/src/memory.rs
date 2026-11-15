//! In-memory transport that serves recorded responses and events (H.2, `docs/H.2.md`).
//!
//! [`Memory`] answers each request from the first [`Route`] that matches, streams `/api/event` from
//! [`Memory::emit`], and logs every request. P-APP builds it from a recording; other tests can use it as a
//! small fixture server.

use std::collections::{BTreeMap, HashSet};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use bytes::Bytes;
use futures_util::StreamExt;
use tokio::sync::Notify;
use tokio::sync::mpsc::{UnboundedSender, unbounded_channel};

use crate::transport::{BoxFuture, Request, Response, Transport};

/// A decoded query: each name with its values, names sorted.
pub type Query = BTreeMap<String, Vec<String>>;

/// One canned response.
#[derive(Clone, Debug)]
pub struct Route {
    pub method: String,
    /// An exact path, or a pattern where a `:name` segment matches any one segment.
    pub path: String,
    /// `None` matches any query.
    pub query: Option<Query>,
    pub status: u16,
    pub content_type: Option<String>,
    pub body: Bytes,
    /// Answers only once [`Memory::release`] names its path.
    pub held: bool,
}

impl Route {
    /// A JSON response.
    pub fn json(method: &str, path: &str, status: u16, body: &serde_json::Value) -> Self {
        Self {
            method: method.to_owned(),
            path: path.to_owned(),
            query: None,
            status,
            content_type: Some("application/json".to_owned()),
            body: Bytes::from(serde_json::to_vec(body).expect("JSON values serialize")),
            held: false,
        }
    }

    /// A response with a body of any type, or none.
    pub fn body(method: &str, path: &str, status: u16, content_type: Option<&str>, body: impl Into<Bytes>) -> Self {
        Self {
            method: method.to_owned(),
            path: path.to_owned(),
            query: None,
            status,
            content_type: content_type.map(str::to_owned),
            body: body.into(),
            held: false,
        }
    }

    /// Answers only once [`Memory::release`] names its path.
    pub fn held(mut self) -> Self {
        self.held = true;
        self
    }

    /// Matches only this exact query.
    pub fn with_query(mut self, query: Query) -> Self {
        self.query = Some(query);
        self
    }

    fn matches(&self, method: &str, path: &str, query: &Query) -> bool {
        let (want, have) = (self.path.split('/'), path.split('/'));
        self.method.eq_ignore_ascii_case(method)
            && want.clone().count() == have.clone().count()
            && want.zip(have).all(|(want, have)| want.starts_with(':') || want == have)
            && self.query.as_ref().is_none_or(|want| want == query)
    }
}

/// One request the client sent.
#[derive(Clone, Debug, PartialEq)]
pub struct Logged {
    pub method: String,
    pub path: String,
    pub query: Query,
    /// The JSON body, or the body as a string when it is not JSON.
    pub body: Option<serde_json::Value>,
    /// No route answered; the client got a 404.
    pub unmatched: bool,
}

/// The transport. Clones share routes, log, and event streams.
#[derive(Clone, Default)]
pub struct Memory {
    inner: Arc<Inner>,
}

#[derive(Default)]
struct Inner {
    routes: Vec<Route>,
    log: Mutex<Vec<Logged>>,
    streams: Mutex<Streams>,
    in_flight: AtomicUsize,
    /// The paths of held routes that answer now, and the requests that wait for one.
    released: Mutex<HashSet<String>>,
    release: Notify,
}

#[derive(Default)]
struct Streams {
    open: Vec<UnboundedSender<Bytes>>,
    /// Events emitted while no stream was open, sent to the next one.
    pending: Vec<Bytes>,
}

const EVENT_PATH: &str = "/api/event";
const CONNECTED: &str = r#"{"id":"evt_connected","type":"server.connected","data":{}}"#;

impl Memory {
    /// Routes are tried in order.
    pub fn new(routes: Vec<Route>) -> Self {
        Self { inner: Arc::new(Inner { routes, ..Inner::default() }) }
    }

    /// Sends one event on every open `/api/event` stream, or queues it for the next stream.
    pub fn emit(&self, event: &serde_json::Value) {
        let frame = frame(&serde_json::to_string(event).expect("JSON values serialize"));
        let mut streams = self.inner.streams.lock().expect("streams lock");
        streams.open.retain(|stream| !stream.is_closed());
        if streams.open.is_empty() {
            streams.pending.push(frame);
            return;
        }
        for stream in &streams.open {
            let _ = stream.send(frame.clone());
        }
    }

    /// Every request so far, in the order sent. The event stream is not logged.
    pub fn requests(&self) -> Vec<Logged> {
        self.inner.log.lock().expect("log lock").clone()
    }

    /// Answers the requests that a held route of `path` keeps waiting, and the ones that come after.
    pub fn release(&self, path: &str) {
        self.inner.released.lock().expect("released lock").insert(path.to_owned());
        self.inner.release.notify_waiters();
    }

    /// Holds the requests of a held route of `path` that come from now on, until it is released again.
    pub fn hold(&self, path: &str) {
        self.inner.released.lock().expect("released lock").remove(path);
    }

    /// Requests answered but whose response the client has not taken yet: a request a held route keeps waiting does
    /// not count until it is released. Zero means the client is idle.
    pub fn in_flight(&self) -> usize {
        self.inner.in_flight.load(Ordering::SeqCst)
    }

    fn events(&self) -> Response {
        // Unbounded: events are test data, a handful per scenario.
        let (sender, mut receiver) = unbounded_channel();
        let _ = sender.send(frame(CONNECTED));
        let mut streams = self.inner.streams.lock().expect("streams lock");
        for queued in streams.pending.drain(..) {
            let _ = sender.send(queued);
        }
        streams.open.push(sender);
        let body = futures_util::stream::poll_fn(move |cx| receiver.poll_recv(cx).map(|frame| frame.map(Ok)));
        Response {
            status: 200,
            headers: vec![("content-type".into(), "text/event-stream".into())],
            body: Box::pin(body),
        }
    }
}

impl Transport for Memory {
    fn send(&self, request: Request) -> BoxFuture<'_, Result<Response, String>> {
        let path = request.url.path().to_owned();
        if request.method == "GET" && path == EVENT_PATH {
            let response = self.events();
            return Box::pin(async move { Ok(response) });
        }
        let mut query = Query::new();
        for (name, value) in request.url.query_pairs() {
            query.entry(name.into_owned()).or_default().push(value.into_owned());
        }
        let route = self.inner.routes.iter().find(|route| route.matches(request.method, &path, &query)).cloned();
        self.inner.log.lock().expect("log lock").push(Logged {
            method: request.method.to_owned(),
            body: request.body.as_ref().filter(|body| !body.is_empty()).map(|body| {
                serde_json::from_slice(body)
                    .unwrap_or_else(|_| serde_json::Value::String(String::from_utf8_lossy(body).into_owned()))
            }),
            unmatched: route.is_none(),
            path: path.clone(),
            query,
        });
        let route = route.unwrap_or_else(|| {
            let message = format!("memory transport: no route for {} {path}", request.method);
            Route::json("", "", 404, &serde_json::json!({ "_tag": "NotFound", "message": message }))
        });
        // A request counts from now; a held one only once it is released.
        let inner = self.inner.clone();
        let counted = (!route.held).then(|| InFlight::new(&inner));
        Box::pin(async move {
            let guard = match counted {
                Some(guard) => guard,
                None => loop {
                    let released = inner.release.notified();
                    if inner.released.lock().expect("released lock").contains(&route.path) {
                        break InFlight::new(&inner);
                    }
                    released.await;
                },
            };
            // The body holds the guard, so the request counts until the client has read or dropped it.
            let body = futures_util::stream::iter([Ok(route.body)]).map(move |chunk| {
                let _ = &guard;
                chunk
            });
            Ok(Response {
                status: route.status,
                headers: route.content_type.map(|value| vec![("content-type".to_owned(), value)]).unwrap_or_default(),
                body: Box::pin(body),
            })
        })
    }
}

/// Counts a request until its response body is dropped.
struct InFlight(Arc<Inner>);

impl InFlight {
    fn new(inner: &Arc<Inner>) -> Self {
        inner.in_flight.fetch_add(1, Ordering::SeqCst);
        Self(inner.clone())
    }
}

impl Drop for InFlight {
    fn drop(&mut self) {
        self.0.in_flight.fetch_sub(1, Ordering::SeqCst);
    }
}

fn frame(json: &str) -> Bytes {
    Bytes::from(format!("data: {json}\n\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(method: &'static str, url: &str) -> Request {
        Request { method, url: crate::js::parse_url(url).unwrap(), headers: Vec::new(), body: None }
    }

    #[tokio::test]
    async fn serves_the_first_matching_route_and_logs_misses() {
        let exact: Query = [("limit".to_owned(), vec!["1".to_owned()])].into();
        let memory = Memory::new(vec![
            Route::json("GET", "/api/session", 200, &serde_json::json!("exact")).with_query(exact.clone()),
            Route::json("GET", "/api/session", 200, &serde_json::json!("any")),
            Route::body("POST", "/api/session/:id/abort", 204, None, Bytes::new()),
        ]);
        let body = |response: Response| async { String::from_utf8(response.bytes().await.unwrap().to_vec()).unwrap() };
        let first = memory.send(request("GET", "http://x/api/session?limit=1")).await.unwrap();
        assert_eq!(body(first).await, "\"exact\"");
        let second = memory.send(request("GET", "http://x/api/session?limit=2")).await.unwrap();
        assert_eq!(body(second).await, "\"any\"");
        let abort = memory.send(request("POST", "http://x/api/session/ses_1/abort")).await.unwrap();
        assert_eq!(abort.status, 204);
        let missing = memory.send(request("GET", "http://x/api/nope")).await.unwrap();
        assert_eq!(missing.status, 404);
        // Unread bodies count as in flight.
        assert_eq!(memory.in_flight(), 2);
        drop((abort, missing));
        let log = memory.requests();
        assert_eq!(log.len(), 4);
        assert_eq!(log[0].query, exact);
        assert!(log[3].unmatched && !log[2].unmatched);
        assert_eq!(memory.in_flight(), 0);
    }

    // Expected: a held route answers once its path is released, and counts as in flight only from then; a request
    // after the release is answered at once.
    #[tokio::test]
    async fn a_held_route_answers_once_released() {
        let memory =
            Memory::new(vec![Route::json("POST", "/api/session/:id/generate", 200, &serde_json::json!(1)).held()]);
        let held = memory.send(request("POST", "http://x/api/session/ses_1/generate"));
        let mut held = Box::pin(held);
        let waker = futures_util::task::noop_waker();
        let mut cx = std::task::Context::from_waker(&waker);
        assert!(held.as_mut().poll(&mut cx).is_pending());
        assert_eq!(memory.in_flight(), 0);
        memory.release("/api/session/:id/generate");
        let response = held.await.unwrap();
        assert_eq!(memory.in_flight(), 1);
        drop(response);
        let after = memory.send(request("POST", "http://x/api/session/ses_2/generate")).await.unwrap();
        assert_eq!(after.status, 200);
    }

    #[tokio::test]
    async fn the_event_stream_starts_connected_and_receives_queued_and_later_events() {
        let memory = Memory::new(Vec::new());
        memory.emit(&serde_json::json!({ "type": "early" }));
        let mut body = memory.send(request("GET", "http://x/api/event")).await.unwrap().body;
        memory.emit(&serde_json::json!({ "type": "late" }));
        let mut frames = Vec::new();
        for _ in 0..3 {
            frames.push(String::from_utf8(body.next().await.unwrap().unwrap().to_vec()).unwrap());
        }
        assert!(frames[0].contains("server.connected"), "{frames:?}");
        assert!(frames[1].contains("early") && frames[2].contains("late"), "{frames:?}");
        assert!(memory.requests().is_empty());
    }
}
