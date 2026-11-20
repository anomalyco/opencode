//! The event stream, from the bytes a server sends to the store, against a reference model of TS's
//! `createClientConnection`. A case is a script of what the server answers each stream with: a refusal, an error
//! status or content type, a response or first event that comes late or never, then a stream that closes, fails, cuts
//! its last event short, sends one that is not JSON, goes silent or is resynced. Every stream arrives cut at random
//! points, and carries events of a newer server that this client does not know.
//!
//! The model predicts when each stream opens and what the connection history records. After each case:
//! - at most one stream was open at any time, and only `GET`s were sent;
//! - the client ends connected, and the store read `session.active` after the last `server.connected`;
//! - dropping the connection closes its stream and ends its tasks: nothing else holds the transport.
//!
//! `MODEL_SEED` (default 1) and `MODEL_CASES` (default 30) set the search; a failure prints its shrunk script.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use bytes::Bytes;
use opencode_api::client::Client;
use opencode_api::events::{self, RecordStatus, Status};
use opencode_api::transport::{BoxFuture, Request, Response, Transport};
use opencode_store::{Data, Options};
use opencode_util::rng::SplitMix64;
use tokio::time::Instant;

const CONNECT: u64 = 2_000;
const DELAY: u64 = 1_000;
const IDLE: u64 = 45_000;
/// How long past the idle deadline Rust waits before it calls a stream stalled (deviation A09-stall-grace).
const GRACE: u64 = 1_000;
const KEEPALIVE: u64 = 15_000;

#[derive(Debug, Clone)]
struct Stream {
    /// Milliseconds before the response, or the refusal.
    head: u64,
    answer: Answer,
}

#[derive(Debug, Clone)]
enum Answer {
    Refused,
    Status(u16),
    ContentType(&'static str),
    /// The first event after `first` ms, or never; later events after their gaps; the end `after` ms past the last.
    Events {
        first: Option<u64>,
        opening: Opening,
        gaps: Vec<u64>,
        end: End,
        after: u64,
        crlf: bool,
    },
}

#[derive(Debug, Clone, Copy)]
enum Opening {
    Connected,
    Other,
    Garbage,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum End {
    Close,
    Cut,
    Reset,
    Malformed,
    Stall,
    Resync,
    /// The healthy stream that ends every case: keepalives until the client lets go.
    Open,
}

fn healthy() -> Stream {
    let answer = Answer::Events {
        first: Some(0),
        opening: Opening::Connected,
        gaps: Vec::new(),
        end: End::Open,
        after: 0,
        crlf: false,
    };
    Stream { head: 0, answer }
}

fn pick<T: Copy>(rng: &mut SplitMix64, items: &[T]) -> T {
    items[rng.below(items.len() as u64) as usize]
}

fn generate(rng: &mut SplitMix64) -> (Vec<Stream>, Vec<bool>) {
    let streams = (0..rng.below(8))
        .map(|_| {
            // No sum of `head` and `first` is the connect timeout, which would race it.
            let head = pick(rng, &[0, 0, 40, 900, 2_600]);
            let answer = match rng.below(10) {
                0 => Answer::Refused,
                1 => Answer::Status(pick(rng, &[400, 401, 429, 500, 503])),
                2 => Answer::ContentType(pick(rng, &["text/html", ""])),
                _ => {
                    let end = pick(rng, &[End::Close, End::Cut, End::Reset, End::Malformed, End::Stall, End::Resync]);
                    Answer::Events {
                        first: pick(rng, &[Some(0), Some(0), Some(15), Some(800), Some(1_500), Some(3_000), None]),
                        opening: pick(
                            rng,
                            &[
                                Opening::Connected,
                                Opening::Connected,
                                Opening::Connected,
                                Opening::Other,
                                Opening::Garbage,
                            ],
                        ),
                        gaps: (0..rng.below(5)).map(|_| pick(rng, &[0, 10, 3_000, 20_000])).collect(),
                        after: pick(rng, &[5, 20_000]) * u64::from(end == End::Resync || rng.below(3) > 0),
                        end,
                        crlf: rng.below(2) == 0,
                    }
                }
            };
            Stream { head, answer }
        })
        .collect();
    let resolved = (0..rng.below(10)).map(|_| rng.below(3) == 0).collect();
    (streams, resolved)
}

/// The record a stream left, as `(status, attempt, error)`.
type Entry = (RecordStatus, u32, Option<String>);

#[derive(Debug, Default, PartialEq)]
struct Expected {
    opens: Vec<u64>,
    records: Vec<Entry>,
    resyncs: Vec<u64>,
}

/// TS's `runStream` and `connect` over the script, with Rust's stall grace.
fn predict(script: &[Stream], resolved: &[bool]) -> Expected {
    let mut expected = Expected::default();
    let (mut at, mut attempt) = (0, 0);
    let mut answers = resolved.iter().copied();
    for stream in script.iter().cloned().chain([healthy()]) {
        expected.opens.push(at);
        let status = if attempt == 0 { RecordStatus::Connecting } else { RecordStatus::Reconnecting };
        expected.records.push((status, attempt, None));
        let head = at + stream.head;
        let late = stream.head >= CONNECT;
        let timeout = (at + CONNECT, None, "Timed out connecting to server".to_owned(), false);
        let (end, connected, error, forced) = match stream.answer {
            _ if late => timeout,
            Answer::Refused => (head, None, "Transport: connection refused".to_owned(), false),
            Answer::Status(status) => {
                let error = match status {
                    401 => "no".to_owned(),
                    400 => String::new(),
                    status => format!("UnexpectedStatus: {status}"),
                };
                (head, None, error, false)
            }
            Answer::ContentType("") => (head, None, "UnsupportedContentType".to_owned(), false),
            Answer::ContentType(kind) => (head, None, format!("UnsupportedContentType: {kind}"), false),
            Answer::Events { first: None, .. } => timeout,
            Answer::Events { first: Some(first), .. } if head + first >= at + CONNECT => timeout,
            Answer::Events { first: Some(first), opening, gaps, end, after, .. } => {
                let first = head + first;
                match opening {
                    Opening::Other => {
                        (first, None, "Event stream did not start with server.connected".to_owned(), false)
                    }
                    Opening::Garbage => (first, None, "MalformedResponse:".to_owned(), false),
                    Opening::Connected => {
                        expected.records.push((RecordStatus::Connected, attempt, None));
                        let last = first + gaps.iter().sum::<u64>();
                        let ended = last + after;
                        let connected = Some(first);
                        match end {
                            End::Open => return expected,
                            End::Close => (ended, connected, "Event stream disconnected".to_owned(), false),
                            End::Cut | End::Malformed => (ended, connected, "MalformedResponse:".to_owned(), false),
                            End::Reset => (ended, connected, "Transport: socket reset".to_owned(), false),
                            End::Stall => (last + IDLE + GRACE, connected, "Event stream stalled".to_owned(), false),
                            End::Resync => {
                                expected.resyncs.push(ended);
                                (ended, connected, "Network connection restored".to_owned(), true)
                            }
                        }
                    }
                }
            }
        };
        if connected.is_some_and(|connected| end - connected >= DELAY) {
            attempt = 0;
        }
        attempt += 1;
        expected.records.push((RecordStatus::Disconnected, attempt, Some(error)));
        let resolved = answers.next().unwrap_or(false);
        at = end + if (resolved && attempt == 1) || forced { 0 } else { DELAY };
    }
    unreachable!("the healthy stream ends the script")
}

// The server -------------------------------------------------------------------------------------------------------

struct Server {
    start: Instant,
    script: Mutex<VecDeque<Stream>>,
    resolved: Mutex<VecDeque<bool>>,
    opens: Mutex<Vec<u64>>,
    active: Mutex<Vec<u64>>,
    writes: Mutex<Vec<String>>,
    live: Arc<AtomicUsize>,
    most: Arc<AtomicUsize>,
    cuts: Mutex<SplitMix64>,
}

/// Counts a stream from its request until its body is dropped.
struct Live(Arc<AtomicUsize>);

impl Drop for Live {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

enum Piece {
    Bytes(Bytes),
    Fail(&'static str),
    End,
}

impl Server {
    fn elapsed(&self) -> u64 {
        self.start.elapsed().as_millis() as u64
    }

    /// The pieces of a stream's body, each at its offset from the response, every block cut at random points.
    fn body(
        &self,
        first: Option<u64>,
        opening: Opening,
        gaps: &[u64],
        end: End,
        after: u64,
        crlf: bool,
    ) -> Vec<(u64, Piece)> {
        let Some(first) = first else { return Vec::new() };
        let newline = if crlf { "\r\n" } else { "\n" };
        let block = |lines: &[&str]| {
            format!("{}{newline}", lines.iter().map(|line| format!("{line}{newline}")).collect::<String>())
        };
        let opening = match opening {
            Opening::Connected => block(&[r#"data: {"id":"evt_c","created":1,"type":"server.connected","data":{}}"#]),
            Opening::Other => block(&[r#"data: {"id":"evt_o","created":1,"type":"future.started","data":{}}"#]),
            Opening::Garbage => block(&["data: {nope"]),
        };
        // A newer server's events: an unknown type, and a known one with a value its schema allows.
        let later = [
            block(&[r#"data: {"id":"evt_f","created":2,"type":"future.thing","data":{"x":[1]}}"#]),
            block(&[
                "id: 7",
                "event: message",
                "retry: 10",
                r#"data: {"id":"evt_s","created":3,"type":"skill.updated","#,
                r#"data: "data":"x"}"#,
            ]),
            block(&[": keepalive"]),
        ];
        let mut rng = self.cuts.lock().unwrap();
        let mut pieces = Vec::new();
        let mut cut = |at: u64, text: &str, pieces: &mut Vec<(u64, Piece)>| {
            let mut rest = text.as_bytes();
            while !rest.is_empty() {
                let length = if rng.below(3) == 0 { rest.len() } else { 1 + rng.below(rest.len() as u64) as usize };
                pieces.push((at, Piece::Bytes(Bytes::copy_from_slice(&rest[..length]))));
                rest = &rest[length..];
            }
        };
        let mut at = first;
        cut(at, &opening, &mut pieces);
        for (index, gap) in gaps.iter().enumerate() {
            at += gap;
            cut(at, &later[index % later.len()], &mut pieces);
        }
        at += after;
        match end {
            End::Close => pieces.push((at, Piece::End)),
            End::Cut => {
                cut(at, r#"data: {"type":"x"#, &mut pieces);
                pieces.push((at, Piece::End));
            }
            End::Reset => pieces.push((at, Piece::Fail("socket reset"))),
            End::Malformed => cut(at, &block(&["data: {oops}"]), &mut pieces),
            End::Stall | End::Resync => {}
            End::Open => {
                for beat in 1..=20 {
                    cut(at + beat * KEEPALIVE, &block(&[": keepalive"]), &mut pieces);
                }
            }
        }
        pieces
    }
}

fn response(
    status: u16,
    content_type: &str,
    body: impl futures_util::Stream<Item = Result<Bytes, String>> + Send + 'static,
) -> Response {
    Response { status, headers: vec![("content-type".to_owned(), content_type.to_owned())], body: Box::pin(body) }
}

impl Transport for Server {
    fn send(&self, request: Request) -> BoxFuture<'_, Result<Response, String>> {
        if request.method != "GET" {
            self.writes.lock().unwrap().push(format!("{} {}", request.method, request.url.path()));
        }
        match request.url.path() {
            "/api/event" => {}
            "/api/session/active" => {
                self.active.lock().unwrap().push(self.elapsed());
                let body = futures_util::stream::iter([Ok(Bytes::from(r#"{"data":{}}"#))]);
                return Box::pin(async { Ok(response(200, "application/json", body)) });
            }
            _ => return Box::pin(async { Ok(response(404, "text/plain", futures_util::stream::empty())) }),
        }
        let stream = self.script.lock().unwrap().pop_front().unwrap_or_else(healthy);
        self.opens.lock().unwrap().push(self.elapsed());
        let live = self.live.fetch_add(1, Ordering::SeqCst) + 1;
        self.most.fetch_max(live, Ordering::SeqCst);
        let guard = Live(self.live.clone());
        let pieces = match &stream.answer {
            Answer::Events { first, opening, gaps, end, after, crlf } => {
                self.body(*first, *opening, gaps, *end, *after, *crlf)
            }
            _ => Vec::new(),
        };
        Box::pin(async move {
            tokio::time::sleep(Duration::from_millis(stream.head)).await;
            let head = Instant::now();
            let text = |status, body: &'static str, kind| {
                Ok(response(status, kind, futures_util::stream::iter([Ok(Bytes::from(body))])))
            };
            match stream.answer {
                Answer::Refused => Err("connection refused".to_owned()),
                Answer::Status(401) => text(401, r#"{"_tag":"Unauthorized","message":"no"}"#, "application/json"),
                Answer::Status(400) => text(400, r#"{"_tag":"BadRequest"}"#, "application/json"),
                Answer::Status(status) => text(status, "down", "text/plain"),
                Answer::ContentType(kind) => text(200, "<p>", kind),
                Answer::Events { .. } => {
                    let state = (VecDeque::from(pieces), guard);
                    let body = futures_util::stream::unfold(state, move |(mut pieces, guard)| async move {
                        let Some((at, piece)) = pieces.pop_front() else {
                            return futures_util::future::pending().await;
                        };
                        tokio::time::sleep_until(head + Duration::from_millis(at)).await;
                        match piece {
                            Piece::Bytes(bytes) => Some((Ok(bytes), (pieces, guard))),
                            Piece::Fail(error) => Some((Err(error.to_owned()), (VecDeque::new(), guard))),
                            Piece::End => None,
                        }
                    });
                    Ok(response(200, "text/event-stream", body))
                }
            }
        })
    }

    fn reconnect(&self) -> BoxFuture<'_, bool> {
        let resolved = self.resolved.lock().unwrap().pop_front().unwrap_or(false);
        Box::pin(async move { resolved })
    }
}

// Running one case -------------------------------------------------------------------------------------------------

async fn run(script: &[Stream], resolved: &[bool], cuts: u64) -> Result<(), String> {
    let expected = predict(script, resolved);
    let server = Arc::new(Server {
        start: Instant::now(),
        script: Mutex::new(script.iter().cloned().collect()),
        resolved: Mutex::new(resolved.iter().copied().collect()),
        opens: Mutex::default(),
        active: Mutex::default(),
        writes: Mutex::default(),
        live: Arc::default(),
        most: Arc::default(),
        cuts: Mutex::new(SplitMix64(cuts)),
    });
    let client = Client::with_transport("http://opencode.local", server.clone()).unwrap();
    let data = Data::new(client, Options { directory: "/project".to_owned(), ..Options::default() });
    let holders = Arc::strong_count(&server);
    let (connection, task) = opencode_store::connection::connect(&data, events::Options::default());

    for at in &expected.resyncs {
        tokio::time::sleep_until(server.start + Duration::from_millis(*at)).await;
        connection.resync("Network connection restored");
    }
    let last = *expected.opens.last().unwrap();
    tokio::time::sleep_until(server.start + Duration::from_millis(last + 70_000)).await;

    let opens = server.opens.lock().unwrap().clone();
    let records: Vec<Entry> = connection
        .history()
        .into_iter()
        .map(|record| {
            let error = record.error.map(|error| match error.starts_with("MalformedResponse:") {
                true => "MalformedResponse:".to_owned(),
                false => error,
            });
            (record.status, record.attempt, error)
        })
        .collect();
    let mut failures = Vec::new();
    if (&opens, &records) != (&expected.opens, &expected.records) {
        failures.push(format!(
            "opens {opens:?}\n  expected {:?}\nrecords {records:?}\n  expected {:?}",
            expected.opens, expected.records
        ));
    }
    if connection.state().status != Status::Connected {
        failures.push(format!("ends {:?}", connection.state()));
    }
    if !server.active.lock().unwrap().iter().any(|at| *at >= last) {
        failures.push(format!("no session.active read after {last}: {:?}", server.active.lock().unwrap()));
    }
    if server.most.load(Ordering::SeqCst) > 1 {
        failures.push(format!("{} streams open at once", server.most.load(Ordering::SeqCst)));
    }
    if !server.writes.lock().unwrap().is_empty() {
        failures.push(format!("writes {:?}", server.writes.lock().unwrap()));
    }
    drop(connection);
    if tokio::time::timeout(Duration::from_secs(5), task).await.is_err() {
        failures.push("the store's task outlived the connection".to_owned());
    }
    tokio::time::sleep(Duration::from_secs(5)).await;
    let (live, holders) = (server.live.load(Ordering::SeqCst), Arc::strong_count(&server) - holders);
    if live != 0 || holders != 0 {
        failures.push(format!("leaked: {live} streams, {holders} holders of the transport"));
    }
    match failures.is_empty() {
        true => Ok(()),
        false => Err(failures.join("\n")),
    }
}

fn env(name: &str, default: u64) -> u64 {
    std::env::var(name).ok().and_then(|value| value.parse().ok()).unwrap_or(default)
}

#[tokio::test(start_paused = true)]
async fn the_connection_follows_any_server_to_a_resynced_store() {
    let seed = env("MODEL_SEED", 1);
    let mut rng = SplitMix64(seed);
    for case in 0..env("MODEL_CASES", 30) {
        let (mut script, resolved) = generate(&mut rng);
        let cuts = rng.below(u64::MAX);
        let Err(mut failure) = run(&script, &resolved, cuts).await else { continue };
        // Drops streams while the case still fails.
        let mut index = 0;
        while index < script.len() {
            let mut shorter = script.clone();
            shorter.remove(index);
            match run(&shorter, &resolved, cuts).await {
                Err(error) => (script, failure) = (shorter, error),
                Ok(()) => index += 1,
            }
        }
        panic!("MODEL_SEED={seed} case {case} cuts {cuts}\nscript {script:#?}\nresolved {resolved:?}\n{failure}");
    }
}
