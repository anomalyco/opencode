//! Long-running programs driven on one thread, by the host's event loop: a [`LiveRun`] has these host functions under
//! `__host`, beside the input function:
//!
//! - `__host.post(message)` (sync): queues `message`, as JSON, in the run's outbox.
//! - `await __host.receive()` (async, idempotent): the next message [`LiveRun::deliver`] queued, in order.
//! - `await __host.sleep(ms)` (async, idempotent): resolves after `ms` (clamped to >= 0) of running time.
//! - `__host.now()` (sync): milliseconds the program has been running, paused time left out.
//! - `await __host.fetch(request)` (async): an HTTPS request, checked here (see `fetch`) and queued in the outbox for
//!   the host to carry out and answer with [`LiveRun::fetch_done`] or [`LiveRun::fetch_failed`].
//!
//! Nothing runs by itself: the host calls [`LiveRun::pump`] when something happened (a delivery, a timer, a fetch
//! answer, a resume) and again as it asks, then takes [`LiveRun::take_outbox`]. In a browser the language yields every
//! millisecond or so of compute, so `pump` returns within its time slice and the event loop stays responsive; a
//! stretch of compute longer than the slice budget, with no wait on the host in between, stops the run.

use std::collections::{HashMap, VecDeque};
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::task::{Context, Poll, Wake, Waker};
use std::time::Duration;

use psychoscript::{
    Compiled, HostError, HostFunction, HostResult, HostString, HostValue, Interrupted, Limits,
    ProgramOptions, RunOutcome, Runtime, Translate, TranslateFunctions, TranslatePromises,
    TypedKind,
};

use crate::draw;
use crate::error::Error;
use crate::fetch::{self, Rejection, Request};
use crate::json::{self, Input};
use crate::program::uri_error;
use crate::time::Instant;
use crate::tree::{Drawn, Walk, WalkError};

/// A live run's budgets and capabilities.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LiveOptions {
    /// Longest the program may compute without waiting on its host; past it the run stops with `SliceBudget`.
    pub slice_budget_ms: u64,
    /// A native run's post rate (widgets-live.md, "Post rate"): its token bucket refills at this many tokens a second.
    pub max_posts_per_second: u32,
    /// The `https` capability: hosts `__host.fetch` may reach (exact names, `*.` suffixes, `*` for any). `None`:
    /// every fetch is rejected with `CapabilityDenied`.
    pub https_hosts: Option<Vec<String>>,
    /// Dev mode (widgets-live.md, "Local network in dev mode"): `fetch` may also reach loopback, private and
    /// link-local destinations and local names, over `http:` too, when the widget template declares them (not through `*`).
    /// Off by default.
    pub allow_local_network: bool,
    /// A native run (`__widget_live(__input(), true)`, widgets.md, "Native hosts"): functions cross as markers; a posted
    /// `render` carries the view as built, which goes out as the tree clients get, and `post` returns whether it has
    /// handlers; a `draw` names its canvas by `key`, mapped to the canvas's id from the last render. A render whose view
    /// breaks a rule of views (or that the prelude found too deep to post, `{ type: "render", node: null, failure }`)
    /// ends the run at once with [`Error::View`]. A function anywhere else in a host call's argument fails the call.
    /// `render` and `draw` posts go out under the post rate ([`Rate`]); a `draw` without a string `key` ends the run.
    pub native: bool,
}

impl Default for LiveOptions {
    fn default() -> Self {
        LiveOptions {
            slice_budget_ms: 50,
            max_posts_per_second: 240,
            https_hosts: None,
            allow_local_network: false,
            native: false,
        }
    }
}

/// How a live run ended.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LiveExit {
    /// The program returned: its completion value as JSON.
    Finished { result_json: String },
    /// It threw, or went over a budget.
    Failed { error: Error },
    /// [`LiveRun::stop`] ended it.
    Stopped,
}

impl LiveExit {
    /// `{ type: "finished", result }`, `{ type: "failed", error }` or `{ type: "stopped" }`, as JSON.
    pub fn to_json(&self) -> String {
        match self {
            LiveExit::Finished { result_json } => {
                format!(r#"{{"type":"finished","result":{result_json}}}"#)
            }
            LiveExit::Failed { error } => {
                format!(r#"{{"type":"failed","error":{}}}"#, error.to_json())
            }
            LiveExit::Stopped => r#"{"type":"stopped"}"#.to_owned(),
        }
    }
}

/// What [`LiveRun::pump`] left the run doing.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Pump {
    /// Still computing: pump again soon (after letting the event loop run).
    Again,
    /// Waiting on the host: pump after a delivery, a fetch answer, a resume, or this many ms for its next timer.
    Wait(Option<f64>),
    /// It ended: [`LiveRun::exit`] says how.
    Ended,
}

type RunFuture = Pin<Box<dyn Future<Output = Result<RunOutcome, Interrupted>>>>;

/// A program running on its host's event loop, talking to it through `__host` (see the module docs).
pub struct LiveRun {
    shared: Arc<Mutex<Shared>>,
    future: Option<RunFuture>,
    woken: Arc<Flag>,
    waker: Waker,
    options: LiveOptions,
    exit: Option<LiveExit>,
}

impl std::fmt::Debug for LiveRun {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("LiveRun")
    }
}

#[derive(Default)]
struct Flag(AtomicBool);

impl Wake for Flag {
    fn wake(self: Arc<Self>) {
        self.0.store(true, Ordering::SeqCst);
    }

    fn wake_by_ref(self: &Arc<Self>) {
        self.0.store(true, Ordering::SeqCst);
    }
}

struct Sleep {
    /// Running time it ends at.
    deadline: f64,
    waker: Option<Waker>,
}

#[derive(Default)]
struct FetchSlot {
    result: Option<HostResult>,
    waker: Option<Waker>,
}

struct Shared {
    input: Arc<str>,
    native: bool,
    /// Native runs: the last render's canvases by `String(key)`: id, and how it is drawn.
    canvases: HashMap<String, (String, Drawn)>,
    /// The bytes of the GPU batches in the outbox, which their posts name by `[offset, length]` ([`LiveRun::take_bytes`]).
    bytes: Vec<u8>,
    /// `None`: no https capability.
    policy: Option<fetch::Policy>,
    /// Native runs: the post rate.
    rate: Rate,
    inbox: VecDeque<HostValue>,
    receive: Option<Waker>,
    sleeps: HashMap<String, Sleep>,
    fetches: HashMap<u64, FetchSlot>,
    budget: fetch::Budget,
    next_fetch: u64,
    /// Running time: `offset_ms`, plus the time since `base` unless paused.
    base: Instant,
    offset_ms: f64,
    paused: Option<Instant>,
    /// The outbox: comma-separated JSON envelopes.
    out: String,
    /// When the current stretch of compute began, or `None` while waiting on the host.
    slice: Option<Instant>,
    stopping: bool,
    /// Why a native post ended the run.
    failed: Option<Error>,
}

/// A native run's post rate (widgets-live.md, "Post rate"): a token bucket of [`BURST`] tokens refilled at `per_second`
/// by the monotonic clock, paused or not. A `render` or `draw` post takes a token and goes out at once when nothing
/// waits; otherwise it waits, in place of the waiting post of its kind (the render, or the draw for its canvas key),
/// and the waiting posts go out in order, one per token, as tokens come; all at once when the run ends, unless the
/// client stopped it. A post carrying a GPU batch takes no token, but never overtakes a waiting post: it waits behind
/// them and goes out right after the one before it.
struct Rate {
    per_second: f64,
    tokens: f64,
    at: Instant,
    /// The waiting posts, oldest first.
    waiting: Vec<(Slot, Post)>,
}

/// What a waiting post is, for coalescing: a render, a canvas's draw, or a GPU batch in its place in the order.
#[derive(PartialEq)]
enum Slot {
    Render,
    Draw(String),
    Batch,
}

/// A post on its way to the outbox: its envelope, and a GPU batch's bytes, whose `[offset, length]` in the byte outbox
/// go between `head` and `tail` once it is there.
struct Post {
    head: String,
    bytes: Option<Vec<u8>>,
    tail: &'static str,
}

/// The post rate's burst, and the tolerance for its fractional tokens.
const BURST: f64 = 8.0;
const EPSILON: f64 = 1e-9;

impl Rate {
    fn refill(&mut self) {
        let now = Instant::now();
        let elapsed = now.duration_since(self.at).as_secs_f64();
        self.tokens = (self.tokens + elapsed * self.per_second).min(BURST);
        self.at = now;
    }

    /// Takes a token when one is there.
    fn take(&mut self) -> bool {
        self.refill();
        if self.tokens < 1.0 - EPSILON {
            return false;
        }
        self.tokens -= 1.0;
        true
    }

    /// Ms until the next waiting post may go out, while one waits (a batch never waits at the front).
    fn due(&mut self) -> Option<f64> {
        if self.waiting.is_empty() {
            return None;
        }
        self.refill();
        Some(((1.0 - self.tokens) * 1000.0 / self.per_second).max(0.0))
    }
}

impl Shared {
    fn now_ms(&self) -> f64 {
        match self.paused {
            Some(_) => self.offset_ms,
            None => self.offset_ms + self.base.elapsed().as_secs_f64() * 1000.0,
        }
    }

    fn push(&mut self, envelope: &str) {
        if !self.out.is_empty() {
            self.out.push(',');
        }
        self.out.push_str(envelope);
    }

    /// Takes a posted message; a native `render` returns whether its view has handlers, a native `draw` with an unknown
    /// or GPU canvas's key throws. A function where none may go throws; a render that breaks a rule of views, or a draw
    /// without a string key, ends the run. All of it is checked now, whether the post goes out now or waits.
    fn post(&mut self, message: &HostValue) -> HostResult {
        let mut reply = HostValue::Undefined;
        let mut native = None;
        // Native `render` and `draw` posts: counted, with what they coalesce by; or a GPU batch's post.
        let mut counted = None;
        let mut batch = None;
        if self.native {
            match message.get("type").and_then(HostValue::as_str) {
                Some("render") => {
                    if let Some(HostValue::String(failure)) = message.get("failure") {
                        return Err(self.fail(Error::View {
                            reason: failure.to_string_lossy().into_owned(),
                        }));
                    }
                    let mut node = String::new();
                    let mut out = String::from(r#"{"type":"render""#);
                    for (name, value) in fields(message) {
                        if name == "type" || name == "node" || name == "failure" {
                            continue;
                        }
                        let value =
                            json::write_checked(value).ok_or_else(|| json::carried(1, POST))?;
                        out.push(',');
                        out.push_str(&serde_json::Value::from(name.to_string_lossy()).to_string());
                        out.push(':');
                        out.push_str(&value);
                    }
                    let walked = Walk::new().run(
                        message.get("node").unwrap_or(&HostValue::Undefined),
                        &mut node,
                    );
                    let tree = match walked {
                        Ok(tree) => tree,
                        Err(WalkError::View(reason)) => {
                            return Err(self.fail(Error::View {
                                reason: reason.to_owned(),
                            }));
                        }
                        Err(WalkError::Function) => {
                            return Err(json::carried(1, POST));
                        }
                        Err(WalkError::Uri) => return Err(uri_error()),
                    };
                    reply = HostValue::Bool(tree.has_handlers);
                    self.canvases = tree.canvases;
                    out.push_str(r#","node":"#);
                    out.push_str(&node);
                    // The GPU canvases' ids by key, for the client's replay to find each context's canvas by
                    // (widgets-gpu.md, Transport).
                    let mut first = true;
                    for (key, (id, drawn)) in &self.canvases {
                        if *drawn != Drawn::Gpu {
                            continue;
                        }
                        out.push_str(if std::mem::take(&mut first) {
                            r#","gpu":{"#
                        } else {
                            ","
                        });
                        out.push_str(&serde_json::Value::from(key.as_str()).to_string());
                        out.push(':');
                        out.push_str(&serde_json::Value::from(id.as_str()).to_string());
                    }
                    if !first {
                        out.push('}');
                    }
                    out.push('}');
                    native = Some(out);
                    counted = Some(Slot::Render);
                }
                Some("draw") => {
                    let Some(key) = message.get("key").and_then(HostValue::as_str) else {
                        return Err(self.fail(Error::Runtime {
                            kind: "InvalidPost".into(),
                            reason: "A draw post needs a string key".into(),
                            line: None,
                            column: None,
                        }));
                    };
                    let id = match self.canvases.get(key) {
                        None => {
                            return Err(error(
                                "Error",
                                &format!(r#"No canvas with key "{key}" in the rendered view"#),
                            ));
                        }
                        Some((_, Drawn::Wgsl)) => {
                            return Err(error(
                                "Error",
                                &format!(
                                    r#"Canvas "{key}" is drawn by its wgsl; it takes no draw commands"#
                                ),
                            ));
                        }
                        Some((_, Drawn::Gpu)) => {
                            return Err(error(
                                "Error",
                                &format!(
                                    r#"Canvas "{key}" is drawn by the GPU; it takes no draw commands"#
                                ),
                            ));
                        }
                        Some((id, Drawn::Commands)) => id,
                    };
                    // The client gets the canvas's id and the normalised commands, nothing else. A function in them
                    // fails the call; an invalid draw is an invalid post: the run ends with a program error in phase
                    // `draw` (widgets.md, Canvas, "Draw command checks").
                    let commands = message.get("commands").unwrap_or(&HostValue::Undefined);
                    json::unmarked(std::slice::from_ref(commands), POST, 0)?;
                    let written = match draw::check(commands) {
                        Ok(written) => written,
                        Err(reason) => return Err(self.fail(Error::Draw { reason })),
                    };
                    let out = format!(
                        r#"{{"type":"draw","id":{},"commands":{written}}}"#,
                        serde_json::Value::from(id.as_str())
                    );
                    native = Some(out);
                    counted = Some(Slot::Draw(key.to_owned()));
                }
                // GPU batches (widgets-gpu.md, Transport): in a frame request, or on their own; never counted.
                Some("frame") => {
                    if let Some(gpu) = message
                        .get("gpu")
                        .filter(|b| !matches!(b, HostValue::Undefined))
                    {
                        let head = r#"{"type":"post","message":{"type":"frame","gpu":"#;
                        batch = Some(self.batch_post(gpu, head)?);
                    }
                }
                // `{ type: "gpu", ops, bytes }`: the message is the batch (only its `ops` and `bytes` are read).
                Some("gpu") => {
                    let head = r#"{"type":"post","message":{"type":"gpu","batch":"#;
                    batch = Some(self.batch_post(message, head)?);
                }
                // An answer goes out after what waits for the rate.
                Some("submit" | "dismiss") => self.release(),
                _ => {}
            }
        }
        // A GPU batch never overtakes a waiting post (it may name a canvas a waiting render adds).
        if let Some(post) = batch {
            if self.rate.waiting.is_empty() {
                self.send(post);
            } else {
                self.rate.waiting.push((Slot::Batch, post));
            }
            return Ok(reply);
        }
        let message = match native {
            Some(message) => message,
            None => json::write_checked(message).ok_or_else(|| json::carried(1, POST))?,
        };
        let envelope = format!(r#"{{"type":"post","message":{message}}}"#);
        match counted {
            Some(by) => self.counted(by, envelope),
            None => self.push(&envelope),
        }
        Ok(reply)
    }

    /// Puts `post` in the outbox, its batch's bytes in the byte outbox.
    fn send(&mut self, post: Post) {
        let Some(bytes) = post.bytes else {
            return self.push(&post.head);
        };
        let start = self.bytes.len();
        if start == 0 {
            self.bytes = bytes;
        } else {
            self.bytes.extend_from_slice(&bytes);
        }
        let envelope = format!(
            "{}[{start},{}]{}",
            post.head,
            self.bytes.len() - start,
            post.tail
        );
        self.push(&envelope);
    }

    /// A GPU batch's post, its envelope opened by `head`.
    fn batch_post(&self, batch: &HostValue, head: &str) -> Result<Post, HostValue> {
        let mut head = head.to_owned();
        Ok(match self.batch(batch, &mut head)? {
            Some(bytes) => Post {
                head,
                bytes: Some(bytes),
                tail: "}}}",
            },
            None => {
                head.push_str("}}");
                Post {
                    head,
                    bytes: None,
                    tail: "",
                }
            }
        })
    }

    /// Writes a GPU batch as it is, for the client's checks (widgets-gpu.md, Host checks): an object as `{"ops":...,
    /// "bytes":` with its bytes given (an `ArrayBuffer`'s, read in place), their `[offset, length]` and `}` to follow
    /// once it is in the outbox; else whole, `bytes` `null` when they aren't an `ArrayBuffer`. Its ops' non-finite
    /// numbers, written `null`, are listed in `nonFinite` too ([`json::write_ops`]). A function in it fails the call.
    fn batch(&self, batch: &HostValue, out: &mut String) -> Result<Option<Vec<u8>>, HostValue> {
        let carried = || json::carried(1, POST);
        let HostValue::Object(_) = batch else {
            out.push_str(&json::write_checked(batch).ok_or_else(carried)?);
            return Ok(None);
        };
        out.push('{');
        if let Some(ops) = batch
            .get("ops")
            .filter(|o| !matches!(o, HostValue::Undefined))
        {
            let (ops, non_finite) = json::write_ops(ops).ok_or_else(carried)?;
            out.push_str(r#""ops":"#);
            out.push_str(&ops);
            out.push(',');
            // Numbers stay as they are: the non-finite ones, written null, by path (the client puts them back).
            if let Some(list) = non_finite {
                out.push_str(r#""nonFinite":"#);
                out.push_str(&list);
                out.push(',');
            }
        }
        out.push_str(r#""bytes":"#);
        match batch.get("bytes") {
            Some(HostValue::TypedArray(t)) if t.kind() == TypedKind::ArrayBuffer => {
                Ok(Some(t.to_vec()))
            }
            _ => {
                out.push_str("null}");
                Ok(None)
            }
        }
    }

    /// A `render` (`by` `None`) or a canvas's `draw` under the post rate: out now, or waiting in place of the waiting
    /// post of its kind, else at the end of the queue.
    fn counted(&mut self, by: Slot, envelope: String) {
        if self.rate.waiting.is_empty() && self.rate.take() {
            return self.push(&envelope);
        }
        let post = Post {
            head: envelope,
            bytes: None,
            tail: "",
        };
        match self.rate.waiting.iter_mut().find(|(k, _)| *k == by) {
            Some(waiting) => waiting.1 = post,
            None => self.rate.waiting.push((by, post)),
        }
    }

    /// Sends the waiting posts the bucket has tokens for, in order: a batch at the front takes none.
    fn drain(&mut self) {
        while let Some((slot, _)) = self.rate.waiting.first() {
            if *slot != Slot::Batch && !self.rate.take() {
                break;
            }
            let (_, post) = self.rate.waiting.remove(0);
            self.send(post);
        }
    }

    /// Sends every waiting post now, in order.
    fn release(&mut self) {
        for (_, post) in std::mem::take(&mut self.rate.waiting) {
            self.send(post);
        }
    }

    /// Ends the run with `error`: what `post` throws, which the program can't catch.
    fn fail(&mut self, error: Error) -> HostValue {
        self.failed = Some(error);
        self.stopping = true;
        HostValue::Interrupt
    }

    fn begin_slice(&mut self) {
        self.slice = Some(Instant::now());
    }
}

/// An object's fields; none for anything else.
fn fields(v: &HostValue) -> &[(HostString, HostValue)] {
    match v {
        HostValue::Object(fields) => fields,
        _ => &[],
    }
}

/// What the program called `__host.post` as, for its errors.
const POST: &str = "__host.post";

/// An error the program can catch, thrown from a host call, located at the call.
fn error(name: &str, message: &str) -> HostValue {
    HostError::located(name, message)
}

fn lock(m: &Mutex<Shared>) -> MutexGuard<'_, Shared> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

/// A `fetch` the program awaits: its answer arrives in the slot; dropped unanswered (the run stopped), it is
/// cancelled.
struct Fetching {
    id: u64,
    shared: Arc<Mutex<Shared>>,
    done: bool,
}

impl Future for Fetching {
    type Output = HostResult;

    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<HostResult> {
        let mut s = lock(&self.shared);
        if s.stopping {
            return Poll::Ready(Err(HostValue::Interrupt));
        }
        let paused = s.paused.is_some();
        let id = self.id;
        let Some(slot) = s.fetches.get_mut(&id) else {
            drop(s);
            self.done = true;
            return Poll::Ready(Err(
                Rejection::new("Network", "the request was lost").value()
            ));
        };
        match slot.result.take() {
            Some(result) if !paused => {
                s.fetches.remove(&id);
                s.begin_slice();
                drop(s);
                self.done = true;
                Poll::Ready(result)
            }
            held => {
                slot.result = held;
                slot.waker = Some(cx.waker().clone());
                Poll::Pending
            }
        }
    }
}

impl Drop for Fetching {
    fn drop(&mut self) {
        if self.done {
            return;
        }
        let mut s = lock(&self.shared);
        if s.fetches.remove(&self.id).is_some() {
            s.budget.in_flight = s.budget.in_flight.saturating_sub(1);
            let envelope = format!(r#"{{"type":"cancel","id":{}}}"#, self.id);
            s.push(&envelope);
        }
    }
}

impl LiveRun {
    pub(crate) fn start(
        compiled: Compiled,
        input_name: String,
        input_json: &str,
        options: LiveOptions,
    ) -> Result<LiveRun, Error> {
        Input::parse(input_json)
            .map_err(|e| Error::invalid_input(format!("the input isn't JSON: {e}")))?;
        let now = Instant::now();
        let shared = Arc::new(Mutex::new(Shared {
            input: input_json.into(),
            native: options.native,
            canvases: HashMap::new(),
            bytes: Vec::new(),
            policy: options.https_hosts.clone().map(|hosts| fetch::Policy {
                hosts,
                local_network: options.allow_local_network,
            }),
            rate: Rate {
                per_second: f64::from(options.max_posts_per_second.max(1)),
                tokens: BURST,
                at: now,
                waiting: Vec::new(),
            },
            inbox: VecDeque::new(),
            receive: None,
            sleeps: HashMap::new(),
            fetches: HashMap::new(),
            budget: fetch::Budget::default(),
            next_fetch: 1,
            base: now,
            offset_ms: 0.0,
            paused: None,
            out: String::new(),
            slice: None,
            stopping: false,
            failed: None,
        }));
        let mut runtime = runtime(&shared, input_name);
        if options.native {
            // A native (widget) run posts views as built: handler functions cross as markers, 100 levels of view deep.
            runtime = runtime.translate(MARK).limits(Limits {
                max_value_depth: Some(WIDGET_DEPTH),
                ..Limits::default()
            });
        }
        let future: RunFuture = Box::pin(async move {
            let program = runtime.program(&compiled, &ProgramOptions::new());
            program.run_resumable_async().await
        });
        let woken = Arc::new(Flag::default());
        let waker = Waker::from(woken.clone());
        Ok(LiveRun {
            shared,
            future: Some(future),
            woken,
            waker,
            options,
            exit: None,
        })
    }

    /// Runs the program until it waits on the host, ends, or has computed for `max_ms` in this call (then
    /// [`Pump::Again`]). Stops it with `SliceBudget` once a stretch of compute without a wait passes the budget.
    pub fn pump(&mut self, max_ms: f64) -> Pump {
        let Some(future) = self.future.as_mut() else {
            return Pump::Ended;
        };
        let started = Instant::now();
        let budget = Duration::from_millis(self.options.slice_budget_ms.max(1));
        let wakers = {
            let mut s = lock(&self.shared);
            if s.slice.is_none() {
                s.slice = Some(started);
            }
            s.drain();
            due_sleeps(&mut s)
        };
        for w in wakers {
            w.wake();
        }
        let mut cx = Context::from_waker(&self.waker);
        loop {
            self.woken.0.store(false, Ordering::SeqCst);
            match future.as_mut().poll(&mut cx) {
                Poll::Ready(result) => {
                    let failed = lock(&self.shared).failed.take();
                    let exit = match (failed, result) {
                        (Some(error), _) => LiveExit::Failed { error },
                        (None, Ok(RunOutcome::Done(outcome))) => match outcome.result {
                            Ok(data) => LiveExit::Finished {
                                result_json: data.to_json_string(),
                            },
                            Err(d) => LiveExit::Failed {
                                error: Error::from_diagnostic(d, None),
                            },
                        },
                        (None, Ok(RunOutcome::Suspended(_)) | Err(_)) => LiveExit::Stopped,
                    };
                    self.end(exit);
                    return Pump::Ended;
                }
                Poll::Pending if self.woken.0.load(Ordering::SeqCst) => {
                    let over = lock(&self.shared)
                        .slice
                        .is_some_and(|at| at.elapsed() > budget);
                    if over {
                        let budget_ms = self.options.slice_budget_ms;
                        self.end(LiveExit::Failed {
                            error: Error::SliceBudget {
                                reason: format!(
                                    "the program computed for more than {budget_ms} ms without waiting"
                                ),
                                budget_ms,
                            },
                        });
                        return Pump::Ended;
                    }
                    if started.elapsed().as_secs_f64() * 1000.0 >= max_ms {
                        lock(&self.shared).drain();
                        return Pump::Again;
                    }
                }
                Poll::Pending => {
                    let mut s = lock(&self.shared);
                    s.slice = None;
                    s.drain();
                    return Pump::Wait(next_timer(&mut s));
                }
            }
        }
    }

    /// Whether something woke the run since it last stopped (natively, a stretch of compute coming back from its
    /// worker thread): pump it again.
    pub fn woken(&self) -> bool {
        self.woken.0.load(Ordering::SeqCst)
    }

    /// Queues a JSON message for `__host.receive()`; held while paused. Pump afterwards.
    pub fn deliver(&mut self, message_json: &str) -> Result<(), Error> {
        let message = Input::parse(message_json)
            .map_err(|e| Error::invalid_input(format!("the message isn't JSON: {e}")))?;
        if self.future.is_none() {
            return Err(ended());
        }
        let waker = {
            let mut s = lock(&self.shared);
            s.inbox.push_back(message);
            s.receive.take()
        };
        if let Some(w) = waker {
            w.wake();
        }
        Ok(())
    }

    /// The bytes of the GPU batches in the outbox [`LiveRun::take_outbox`] just gave, which their posts name by
    /// `[offset, length]`: take them right after it.
    pub fn take_bytes(&mut self) -> Vec<u8> {
        std::mem::take(&mut lock(&self.shared).bytes)
    }

    /// The outbox since the last call, as a JSON array of `{ type: "post", message }`, `{ type: "warning", message }`,
    /// `{ type: "fetch", id, url, method, headers, body? | body64?, timeoutMs, maxResponseBytes }` and
    /// `{ type: "cancel", id }`.
    pub fn take_outbox(&mut self) -> String {
        let mut s = lock(&self.shared);
        if s.out.is_empty() {
            return "[]".to_owned();
        }
        let out = std::mem::take(&mut s.out);
        format!("[{out}]")
    }

    /// Answers fetch `id` with the browser's response: `meta_json` is `{ status, url, headers }` (the final URL after
    /// redirects), `body` the body's bytes. Pump afterwards.
    pub fn fetch_done(&mut self, id: u64, meta_json: &str, body: Vec<u8>) {
        let s = lock(&self.shared);
        let policy = s.policy.clone().unwrap_or_default();
        let result = fetch::response(meta_json, body, &policy).map_err(Rejection::value);
        answer(s, id, result);
    }

    /// Fails fetch `id`: `kind` is `Network`, `Timeout` or `TooLarge`. Pump afterwards.
    pub fn fetch_failed(&mut self, id: u64, kind: &str, message: &str) {
        let s = lock(&self.shared);
        answer(s, id, Err(Rejection::transport(kind, message).value()));
    }

    /// Pauses the run: `sleep` timers freeze with their remaining time, `now()` stops, delivered messages and fetch
    /// answers are held. A stretch of compute in progress finishes first. No-op when already paused.
    pub fn pause(&mut self) -> Result<(), Error> {
        if self.future.is_none() {
            return Err(ended());
        }
        let mut s = lock(&self.shared);
        if s.paused.is_none() {
            s.offset_ms += s.base.elapsed().as_secs_f64() * 1000.0;
            s.paused = Some(Instant::now());
        }
        Ok(())
    }

    /// Continues a paused run; the program first receives `{ type: "resumed", pausedMs }`. Pump afterwards.
    pub fn resume(&mut self) -> Result<(), Error> {
        if self.future.is_none() {
            return Err(ended());
        }
        let wakers = {
            let mut s = lock(&self.shared);
            let Some(at) = s.paused.take() else {
                return Err(Error::InvalidState {
                    reason: "the run isn't paused".into(),
                });
            };
            s.base = Instant::now();
            let paused_ms = (at.elapsed().as_secs_f64() * 1000.0).round();
            s.inbox.push_front(HostValue::object([
                ("type", HostValue::String("resumed".into())),
                ("pausedMs", HostValue::Number(paused_ms)),
            ]));
            let mut wakers: Vec<Waker> = s.receive.take().into_iter().collect();
            wakers.extend(s.sleeps.values_mut().filter_map(|s| s.waker.take()));
            wakers.extend(s.fetches.values_mut().filter_map(|f| f.waker.take()));
            wakers
        };
        for w in wakers {
            w.wake();
        }
        Ok(())
    }

    pub fn is_paused(&self) -> bool {
        lock(&self.shared).paused.is_some()
    }

    /// Milliseconds the program has been running, paused time left out.
    pub fn now_ms(&self) -> f64 {
        lock(&self.shared).now_ms()
    }

    /// Ends the run (exit `Stopped`) whatever it's doing; fetches in flight are cancelled (see the outbox).
    pub fn stop(&mut self) {
        if self.future.is_some() {
            self.end(LiveExit::Stopped);
        }
    }

    /// How the run ended, once it has.
    pub fn exit(&self) -> Option<&LiveExit> {
        self.exit.as_ref()
    }

    fn end(&mut self, exit: LiveExit) {
        {
            let mut s = lock(&self.shared);
            s.stopping = true;
            // The last view is never lost: what waits for the post rate goes out, unless the client stopped the run.
            match exit {
                LiveExit::Stopped => s.rate.waiting.clear(),
                _ => s.release(),
            }
        }
        // Dropping the run interrupts it and drops its host calls, which cancel their fetches.
        drop(self.future.take());
        let mut s = lock(&self.shared);
        s.receive = None;
        s.sleeps.clear();
        s.slice = None;
        drop(s);
        self.exit = Some(exit);
    }
}

impl Drop for LiveRun {
    fn drop(&mut self) {
        self.stop();
    }
}

fn ended() -> Error {
    Error::InvalidState {
        reason: "the run has ended".into(),
    }
}

fn answer(mut s: MutexGuard<'_, Shared>, id: u64, result: HostResult) {
    let Some(slot) = s.fetches.get_mut(&id) else {
        return;
    };
    if slot.result.is_some() {
        return;
    }
    slot.result = Some(result);
    let waker = slot.waker.take();
    s.budget.in_flight = s.budget.in_flight.saturating_sub(1);
    drop(s);
    if let Some(w) = waker {
        w.wake();
    }
}

/// The wakers of sleeps whose time has come (none while paused).
fn due_sleeps(s: &mut Shared) -> Vec<Waker> {
    if s.paused.is_some() {
        return Vec::new();
    }
    let now = s.now_ms();
    s.sleeps
        .values_mut()
        .filter(|sleep| sleep.deadline <= now)
        .filter_map(|sleep| sleep.waker.take())
        .collect()
}

/// Ms until the earliest sleep ends (unless paused) or the next post waiting for the post rate may go out.
fn next_timer(s: &mut Shared) -> Option<f64> {
    // Posts waiting for the post rate go out while paused too.
    let posts = s.rate.due();
    if s.paused.is_some() {
        return posts;
    }
    let now = s.now_ms();
    s.sleeps
        .values()
        .map(|sleep| (sleep.deadline - now).max(0.0))
        .chain(posts)
        .min_by(f64::total_cmp)
}

/// The boundary value depth of widget runs (widgets.md, "Native hosts"): the deepest value of a view of 100 levels in
/// a live `{ type: "render", node }`, 1 + 2 x 99 + 3.
pub(crate) const WIDGET_DEPTH: usize = 202;

/// How a native run's functions cross into posts and results: as markers (widgets.md, "Native hosts").
pub(crate) const MARK: Translate = Translate {
    functions: TranslateFunctions::Mark,
    promises: TranslatePromises::Error,
};

/// The runtime for one run: the input function and `__host`.
fn runtime(shared: &Arc<Mutex<Shared>>, input_name: String) -> Runtime {
    let shared = shared.clone();
    Runtime::make().globals(move |_run| {
        let s = shared.clone();
        let name = input_name.clone();
        let input = HostFunction::new(move |args: Vec<HostValue>, _call| -> HostResult {
            json::unmarked(&args, &name, 0)?;
            let text = lock(&s).input.clone();
            Ok(Input::parse(&text).unwrap_or_default())
        });
        let s = shared.clone();
        let post = HostFunction::new(move |args: Vec<HostValue>, _call| -> HostResult {
            let mut s = lock(&s);
            if s.stopping {
                return Err(HostValue::Interrupt);
            }
            json::unmarked(&args, POST, 1)?;
            s.post(args.first().unwrap_or(&HostValue::Undefined))
        });
        let s = shared.clone();
        let now = HostFunction::new(move |args: Vec<HostValue>, _call| -> HostResult {
            json::unmarked(&args, "__host.now", 0)?;
            Ok(HostValue::Number(lock(&s).now_ms()))
        });
        let s = shared.clone();
        let receive = HostFunction::new_async(move |args: Vec<HostValue>, _call| {
            let s = s.clone();
            let mut checked = Some(json::unmarked(&args, "__host.receive", 0));
            std::future::poll_fn(move |cx| {
                if let Some(Err(e)) = checked.take() {
                    return Poll::Ready(Err(e));
                }
                let mut s = lock(&s);
                if s.stopping {
                    return Poll::Ready(Err(HostValue::Interrupt));
                }
                let next = if s.paused.is_some() {
                    None
                } else {
                    s.inbox.pop_front()
                };
                match next {
                    Some(message) => {
                        s.begin_slice();
                        Poll::Ready(Ok(message))
                    }
                    None => {
                        s.receive = Some(cx.waker().clone());
                        Poll::Pending
                    }
                }
            })
        })
        .idempotent();
        let s = shared.clone();
        let sleep = HostFunction::new_async(move |args: Vec<HostValue>, call| {
            let s = s.clone();
            let ms = args
                .first()
                .and_then(HostValue::as_f64)
                .filter(|n| !n.is_nan())
                .unwrap_or(0.0)
                .max(0.0);
            let key = call.key();
            let mut checked = Some(json::unmarked(&args, "__host.sleep", 0));
            std::future::poll_fn(move |cx| {
                if let Some(Err(e)) = checked.take() {
                    return Poll::Ready(Err(e));
                }
                let mut s = lock(&s);
                if s.stopping {
                    return Poll::Ready(Err(HostValue::Interrupt));
                }
                let paused = s.paused.is_some();
                let now = s.now_ms();
                let sleep = s.sleeps.entry(key.clone()).or_insert(Sleep {
                    deadline: now + ms,
                    waker: None,
                });
                if now >= sleep.deadline && !paused {
                    s.sleeps.remove(&key);
                    s.begin_slice();
                    return Poll::Ready(Ok(HostValue::Undefined));
                }
                sleep.waker = Some(cx.waker().clone());
                Poll::Pending
            })
        })
        .idempotent();
        let s = shared.clone();
        let fetch = HostFunction::new_async(move |args: Vec<HostValue>, _call| {
            let started = json::unmarked(&args, "__host.fetch", 0)
                .map_err(Err)
                .and_then(|()| start_fetch(&s, args.first()).map_err(Ok));
            async move {
                match started {
                    Ok(fetching) => fetching.await,
                    Err(Ok(rejection)) => Err(rejection.value()),
                    Err(Err(thrown)) => Err(thrown),
                }
            }
        });
        let host = HostValue::object([
            ("post", HostValue::Function(post.named("post").length(1))),
            ("receive", HostValue::Function(receive.named("receive"))),
            ("sleep", HostValue::Function(sleep.named("sleep").length(1))),
            ("now", HostValue::Function(now.named("now"))),
            ("fetch", HostValue::Function(fetch.named("fetch").length(1))),
        ]);
        [
            (
                input_name.clone(),
                HostValue::Function(input.named(input_name.clone())),
            ),
            ("__host".to_owned(), host),
        ]
    })
}

/// Checks a fetch against the capability, the rules and the budget, and queues it for the host.
fn start_fetch(
    shared: &Arc<Mutex<Shared>>,
    request: Option<&HostValue>,
) -> Result<Fetching, Rejection> {
    let mut s = lock(shared);
    let Some(policy) = s.policy.clone() else {
        return Err(Rejection::denied("this widget has no https capability"));
    };
    let request = Request::parse(request, &policy)?;
    s.budget.admit()?;
    let id = s.next_fetch;
    s.next_fetch += 1;
    s.fetches.insert(id, FetchSlot::default());
    let envelope = request.to_json(id);
    s.push(&envelope);
    Ok(Fetching {
        id,
        shared: shared.clone(),
        done: false,
    })
}
