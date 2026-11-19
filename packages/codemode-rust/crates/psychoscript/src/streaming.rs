//! Streaming HTTP responses an extension hands a program, the counterpart of the reference's
//! `Extension.StreamingResponse`.
//!
//! The program gets a plain object with the response's fields, a live `bodyUsed`, the reading methods (`text`,
//! `json`, `bytes`, `arrayBuffer`) and a `body` with a live `locked`, `cancel`, `getReader` and async iteration. The
//! host supplies the body as chunks through [`HttpBody`]; reading, locking and cancelling follow the reference's host
//! runtime, `ReadableStream` errors included.
//!
//! The reference hands the program the response's methods as plain functions inside a result, which it calls at once:
//! a read or cancel the program starts takes effect when it is called, so `locked` and `bodyUsed` change right away.

use std::collections::VecDeque;
use std::fmt;
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::task::{Context, Poll, Waker};

use rustc_hash::FxHashMap;

use crate::host_function::{HostError, HostFunction, HostResult, HostValue};
use crate::object::Atom;
use crate::value::Value;

/// A response body the host streams to the program.
pub trait HttpBody: Send + 'static {
    /// The next chunk: `Ready(None)` at the end of the body, `Ready(Some(Err(reason)))` when it failed, and the
    /// program sees `reason` as the read's error.
    fn poll_chunk(&mut self, cx: &mut Context<'_>) -> Poll<Option<Result<Vec<u8>, HostValue>>>;

    /// The program cancelled the body with `reason`; no chunk is read after this.
    fn cancel(&mut self, reason: HostValue) {
        let _ = reason;
    }
}

/// A live HTTP response whose body the host streams for as long as the program holds it. Clones share the body.
#[derive(Clone)]
pub struct StreamingResponse {
    pub url: String,
    pub status: u16,
    pub status_text: String,
    /// Header pairs; names are lowercased and repeated ones combined as `Headers` does.
    pub headers: Vec<(String, String)>,
    pub redirected: bool,
    pub(crate) body: Option<Arc<Mutex<Stream>>>,
}

impl StreamingResponse {
    /// A response with this status and body; `None` is a response without one, such as a 204.
    pub fn new(status: u16, body: Option<Box<dyn HttpBody>>) -> Self {
        Self {
            url: String::new(),
            status,
            status_text: String::new(),
            headers: Vec::new(),
            redirected: false,
            body: body.map(|body| Arc::new(Mutex::new(Stream::new(body)))),
        }
    }

    pub fn with_url(mut self, url: impl Into<String>) -> Self {
        self.url = url.into();
        self
    }

    pub fn with_status_text(mut self, text: impl Into<String>) -> Self {
        self.status_text = text.into();
        self
    }

    pub fn with_header(mut self, name: impl Into<String>, value: impl Into<String>) -> Self {
        self.headers.push((name.into(), value.into()));
        self
    }

    pub fn with_redirected(mut self, redirected: bool) -> Self {
        self.redirected = redirected;
        self
    }

    pub fn ok(&self) -> bool {
        (200..300).contains(&self.status)
    }

    pub fn has_body(&self) -> bool {
        self.body.is_some()
    }
}

impl fmt::Debug for StreamingResponse {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "StreamingResponse({} {:?})", self.status, self.url)
    }
}

/// The getter of a host accessor: an own, read-only, non-enumerable property whose value the host answers live.
pub type Getter = Arc<dyn Fn() -> Value + Send + Sync>;

/// An object with host accessors, such as a streaming response and its body. Deleting an accessor leaves an
/// ordinary object behind.
pub struct Live {
    pub accessors: Vec<(Atom, Getter)>,
}

impl Live {
    pub fn getter(&self, key: Atom) -> Option<Getter> {
        self.accessors
            .iter()
            .find(|(k, _)| *k == key)
            .map(|(_, g)| g.clone())
    }

    pub fn has(&self, key: Atom) -> bool {
        self.accessors.iter().any(|(k, _)| *k == key)
    }

    pub fn remove(&mut self, key: Atom) -> bool {
        let before = self.accessors.len();
        self.accessors.retain(|(k, _)| *k != key);
        self.accessors.len() != before
    }
}

/// Counts the points where queued host calls start: a new job, or the end of a synchronous extension call.
pub type Epoch = Arc<AtomicU64>;

// ---------- the stream ----------

const CONSUMER: u64 = u64::MAX;

enum Flow {
    Readable,
    Closed,
    Errored(HostValue),
}

#[derive(Clone, Copy)]
pub(crate) enum Consume {
    Text,
    Json,
    Bytes,
    ArrayBuffer,
}

enum Op {
    Consume(Consume),
    Read(u64),
    CancelReader(u64, HostValue),
    CancelStream(HostValue),
    Next(u64),
    Return(u64),
}

enum Progress {
    Done(HostResult),
    Read { reader: u64, iter: Option<u64> },
    Consume { kind: Consume, buf: Vec<u8> },
}

struct Iter {
    reader: u64,
    finished: bool,
}

pub(crate) struct Stream {
    body: Box<dyn HttpBody>,
    flow: Flow,
    disturbed: bool,
    reader: Option<u64>,
    next_id: u64,
    /// Calls not started yet, with the epoch they were made in.
    queued: VecDeque<(u64, u64, Op)>,
    started: FxHashMap<u64, Progress>,
    /// Started calls that wait for chunks, served in order.
    reading: VecDeque<u64>,
    iters: FxHashMap<u64, Iter>,
    wakers: Vec<Waker>,
}

fn type_error(message: &str) -> HostValue {
    HostValue::Error(Box::new(HostError::named("TypeError", message)))
}

fn locked() -> HostValue {
    type_error("Invalid state: ReadableStream is locked")
}

fn detached() -> HostValue {
    type_error("Invalid state: The reader is not attached to a stream")
}

fn step(value: HostValue, done: bool) -> HostValue {
    HostValue::object([("value", value), ("done", HostValue::Bool(done))])
}

impl Stream {
    fn new(body: Box<dyn HttpBody>) -> Self {
        Self {
            body,
            flow: Flow::Readable,
            disturbed: false,
            reader: None,
            next_id: 0,
            queued: VecDeque::new(),
            started: FxHashMap::default(),
            reading: VecDeque::new(),
            iters: FxHashMap::default(),
            wakers: Vec::new(),
        }
    }

    fn id(&mut self) -> u64 {
        self.next_id += 1;
        self.next_id
    }

    fn wake(&mut self) {
        for w in self.wakers.drain(..) {
            w.wake();
        }
    }

    /// Starts every call made before epoch `now`, as the reference would have by then.
    fn observe(&mut self, now: u64) {
        while self
            .queued
            .front()
            .is_some_and(|(_, epoch, _)| *epoch < now)
        {
            let (ticket, _, op) = self.queued.pop_front().unwrap();
            self.start(ticket, op);
        }
    }

    /// Starts every call up to and including `ticket`.
    fn start_through(&mut self, ticket: u64) {
        while let Some((t, _, _)) = self.queued.front() {
            let t = *t;
            let (_, _, op) = self.queued.pop_front().unwrap();
            self.start(t, op);
            if t == ticket {
                break;
            }
        }
    }

    fn enqueue(&mut self, now: u64, op: Op) -> u64 {
        self.observe(now);
        let ticket = self.id();
        self.queued.push_back((ticket, now, op));
        ticket
    }

    fn start(&mut self, ticket: u64, op: Op) {
        let progress = match op {
            Op::Consume(kind) => {
                if self.disturbed {
                    Progress::Done(Err(type_error("Body already used")))
                } else if self.reader.is_some() {
                    Progress::Done(Err(locked()))
                } else {
                    self.reader = Some(CONSUMER);
                    self.disturbed = true;
                    self.reading.push_back(ticket);
                    Progress::Consume {
                        kind,
                        buf: Vec::new(),
                    }
                }
            }
            Op::Read(reader) => {
                if self.reader != Some(reader) {
                    Progress::Done(Err(detached()))
                } else {
                    self.disturbed = true;
                    self.reading.push_back(ticket);
                    Progress::Read { reader, iter: None }
                }
            }
            Op::CancelReader(reader, reason) => {
                if self.reader != Some(reader) {
                    Progress::Done(Err(detached()))
                } else {
                    Progress::Done(self.cancel(reason))
                }
            }
            Op::CancelStream(reason) => {
                if self.reader.is_some() {
                    Progress::Done(Err(locked()))
                } else {
                    Progress::Done(self.cancel(reason))
                }
            }
            Op::Next(iter) => match self.iters.get(&iter) {
                Some(it) if !it.finished => {
                    let reader = it.reader;
                    self.disturbed = true;
                    self.reading.push_back(ticket);
                    Progress::Read {
                        reader,
                        iter: Some(iter),
                    }
                }
                _ => Progress::Done(Ok(step(HostValue::Undefined, true))),
            },
            Op::Return(iter) => match self.iters.get_mut(&iter) {
                Some(it) if !it.finished => {
                    it.finished = true;
                    let reader = it.reader;
                    let cancelled = self.cancel(HostValue::Undefined);
                    self.release(reader);
                    Progress::Done(cancelled.map(|_| step(HostValue::Undefined, true)))
                }
                _ => Progress::Done(Ok(step(HostValue::Undefined, true))),
            },
        };
        self.started.insert(ticket, progress);
        self.wake();
    }

    fn cancel(&mut self, reason: HostValue) -> HostResult {
        self.disturbed = true;
        match &self.flow {
            Flow::Closed => Ok(HostValue::Undefined),
            Flow::Errored(e) => Err(e.clone()),
            Flow::Readable => {
                self.flow = Flow::Closed;
                self.body.cancel(reason);
                self.wake();
                Ok(HostValue::Undefined)
            }
        }
    }

    /// Detaches `reader`, failing the reads it still waits on.
    fn release(&mut self, reader: u64) {
        if self.reader != Some(reader) {
            return;
        }
        self.reader = None;
        let started = &mut self.started;
        self.reading.retain(|t| match started.get(t) {
            Some(Progress::Read { reader: r, .. }) if *r == reader => {
                started.insert(
                    *t,
                    Progress::Done(Err(type_error("Invalid state: Releasing reader"))),
                );
                false
            }
            _ => true,
        });
        self.wake();
    }

    fn attach(&mut self) -> Result<u64, HostValue> {
        if self.reader.is_some() {
            return Err(locked());
        }
        let id = self.id();
        self.reader = Some(id);
        Ok(id)
    }

    /// Drives a started call: the front reader of `reading` pulls chunks for itself.
    fn pump(&mut self, ticket: u64, cx: &mut Context<'_>) -> Poll<HostResult> {
        loop {
            if let Some(Progress::Done(_)) = self.started.get(&ticket) {
                let Some(Progress::Done(result)) = self.started.remove(&ticket) else {
                    unreachable!()
                };
                return Poll::Ready(result);
            }
            if self.reading.front() != Some(&ticket) {
                self.wakers.push(cx.waker().clone());
                return Poll::Pending;
            }
            let chunk = match &self.flow {
                Flow::Closed => None,
                Flow::Errored(e) => Some(Err(e.clone())),
                Flow::Readable => match self.body.poll_chunk(cx) {
                    Poll::Pending => return Poll::Pending,
                    Poll::Ready(None) => {
                        self.flow = Flow::Closed;
                        None
                    }
                    Poll::Ready(Some(Err(e))) => {
                        self.flow = Flow::Errored(e.clone());
                        Some(Err(e))
                    }
                    Poll::Ready(Some(Ok(b))) => Some(Ok(b)),
                },
            };
            let progress = self.started.get_mut(&ticket).expect("a started call");
            let done = match progress {
                Progress::Consume { kind, buf } => match chunk {
                    Some(Ok(b)) => {
                        buf.extend_from_slice(&b);
                        continue;
                    }
                    None => consumed(*kind, std::mem::take(buf)),
                    Some(Err(e)) => Err(e),
                },
                Progress::Read { iter, .. } => {
                    let iter = *iter;
                    let ended = !matches!(chunk, Some(Ok(_)));
                    let result = match chunk {
                        Some(Ok(b)) => Ok(step(HostValue::Bytes(b), false)),
                        None => Ok(step(HostValue::Undefined, true)),
                        Some(Err(e)) => Err(e),
                    };
                    if ended
                        && let Some(iter) = iter
                        && let Some(it) = self.iters.get_mut(&iter)
                    {
                        it.finished = true;
                        let reader = it.reader;
                        self.release(reader);
                    }
                    result
                }
                Progress::Done(_) => unreachable!(),
            };
            self.reading.pop_front();
            self.started.insert(ticket, Progress::Done(done));
            self.wake();
        }
    }
}

/// What a reading method answers with the whole body.
fn consumed(kind: Consume, buf: Vec<u8>) -> HostResult {
    match kind {
        Consume::Bytes | Consume::ArrayBuffer => Ok(HostValue::Bytes(buf)),
        Consume::Text => Ok(HostValue::String(decode(&buf).into())),
        Consume::Json => parse_json(&decode(&buf)),
    }
}

/// UTF-8 decoding as `Response.text` does it: a leading byte order mark dropped, bad sequences replaced.
fn decode(buf: &[u8]) -> String {
    let text = String::from_utf8_lossy(buf);
    text.strip_prefix('\u{feff}').unwrap_or(&text).to_owned()
}

/// A call on the stream, started where the reference would start it.
struct Call {
    stream: Arc<Mutex<Stream>>,
    ticket: u64,
    polled: bool,
}

fn lock(stream: &Mutex<Stream>) -> MutexGuard<'_, Stream> {
    stream.lock().unwrap_or_else(|e| e.into_inner())
}

impl Future for Call {
    type Output = HostResult;

    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<HostResult> {
        let this = &mut *self;
        let mut s = lock(&this.stream);
        if s.queued.iter().any(|(t, _, _)| *t == this.ticket) {
            if !this.polled {
                // The call was just made: it starts when the run next hands calls over, unless observed first.
                this.polled = true;
                cx.waker().wake_by_ref();
                return Poll::Pending;
            }
            s.start_through(this.ticket);
        }
        s.pump(this.ticket, cx)
    }
}

// ---------- what the program holds ----------

/// The functions and accessors of a streaming response, made once when it crosses to the program.
pub(crate) struct Surface {
    /// `text`, `json`, `bytes`, `arrayBuffer`.
    pub methods: Vec<(&'static str, HostFunction)>,
    pub body_used: Getter,
    /// `cancel`, `getReader`, and the `Symbol.asyncIterator` method, with the `locked` getter.
    pub body: Option<(HostFunction, HostFunction, HostFunction, Getter)>,
}

fn op_call(stream: &Arc<Mutex<Stream>>, epoch: &Epoch, op: Op) -> Call {
    let now = epoch.load(Ordering::Relaxed);
    // The reference's response methods are plain functions, which the host calls at once: the operation starts now.
    let ticket = {
        let mut s = lock(stream);
        let ticket = s.enqueue(now, op);
        s.start_through(ticket);
        ticket
    };
    Call {
        stream: stream.clone(),
        ticket,
        polled: false,
    }
}

fn observed<'s>(stream: &'s Arc<Mutex<Stream>>, epoch: &Epoch) -> MutexGuard<'s, Stream> {
    let mut s = lock(stream);
    s.observe(epoch.load(Ordering::Relaxed));
    s
}

fn first(args: Vec<HostValue>) -> HostValue {
    args.into_iter().next().unwrap_or_default()
}

pub(crate) fn surface(response: &StreamingResponse, epoch: &Epoch) -> Surface {
    let kinds = [
        ("text", Consume::Text),
        ("json", Consume::Json),
        ("bytes", Consume::Bytes),
        ("arrayBuffer", Consume::ArrayBuffer),
    ];
    let methods = kinds
        .into_iter()
        .map(|(key, kind)| {
            let stream = response.body.clone();
            let epoch = epoch.clone();
            let f = HostFunction::internal_async("", 0, move |_| {
                let call = stream
                    .as_ref()
                    .map(|s| op_call(s, &epoch, Op::Consume(kind)));
                async move {
                    match call {
                        Some(call) => call.await,
                        None => match kind {
                            Consume::Json => Err(HostValue::Error(Box::new(HostError::named(
                                "SyntaxError",
                                "Unexpected end of JSON input",
                            )))),
                            kind => consumed(kind, Vec::new()),
                        },
                    }
                }
            });
            (key, f)
        })
        .collect();
    let Some(stream) = response.body.clone() else {
        return Surface {
            methods,
            body_used: Arc::new(|| Value::Bool(false)),
            body: None,
        };
    };
    let body_used = {
        let (stream, epoch) = (stream.clone(), epoch.clone());
        Arc::new(move || Value::Bool(observed(&stream, &epoch).disturbed)) as Getter
    };
    let is_locked = {
        let (stream, epoch) = (stream.clone(), epoch.clone());
        Arc::new(move || Value::Bool(observed(&stream, &epoch).reader.is_some())) as Getter
    };
    let cancel = {
        let (stream, epoch) = (stream.clone(), epoch.clone());
        HostFunction::internal_async("", 1, move |args| {
            op_call(&stream, &epoch, Op::CancelStream(first(args)))
        })
    };
    let get_reader = {
        let (stream, epoch) = (stream.clone(), epoch.clone());
        HostFunction::internal("", 1, move |args| {
            if let Some(HostValue::Object(fields)) = args.first()
                && fields
                    .iter()
                    .any(|(k, v)| k == "mode" && !matches!(v, HostValue::Undefined))
            {
                return Err(type_error("Only the default stream reader is supported."));
            }
            let reader = observed(&stream, &epoch).attach()?;
            Ok(reader_object(&stream, &epoch, reader))
        })
    };
    let iterate = {
        let (stream, epoch) = (stream.clone(), epoch.clone());
        HostFunction::internal("", 0, move |_| {
            let mut s = observed(&stream, &epoch);
            let reader = s.attach()?;
            let iter = s.id();
            s.iters.insert(
                iter,
                Iter {
                    reader,
                    finished: false,
                },
            );
            drop(s);
            let next = {
                let (stream, epoch) = (stream.clone(), epoch.clone());
                HostFunction::internal_async("next", 0, move |_| {
                    op_call(&stream, &epoch, Op::Next(iter))
                })
            };
            let ret = {
                let (stream, epoch) = (stream.clone(), epoch.clone());
                HostFunction::internal_async("return", 0, move |_| {
                    op_call(&stream, &epoch, Op::Return(iter))
                })
            };
            Ok(HostValue::object([
                ("next", HostValue::Function(next)),
                ("return", HostValue::Function(ret)),
            ]))
        })
    };
    Surface {
        methods,
        body_used,
        body: Some((cancel, get_reader, iterate, is_locked)),
    }
}

fn reader_object(stream: &Arc<Mutex<Stream>>, epoch: &Epoch, reader: u64) -> HostValue {
    let read = {
        let (stream, epoch) = (stream.clone(), epoch.clone());
        HostFunction::internal_async("read", 0, move |_| {
            op_call(&stream, &epoch, Op::Read(reader))
        })
    };
    let cancel = {
        let (stream, epoch) = (stream.clone(), epoch.clone());
        HostFunction::internal_async("cancel", 1, move |args| {
            op_call(&stream, &epoch, Op::CancelReader(reader, first(args)))
        })
    };
    let release = {
        let (stream, epoch) = (stream.clone(), epoch.clone());
        HostFunction::internal("releaseLock", 0, move |_| {
            observed(&stream, &epoch).release(reader);
            Ok(HostValue::Undefined)
        })
    };
    HostValue::object([
        ("read", HostValue::Function(read)),
        ("cancel", HostValue::Function(cancel)),
        ("releaseLock", HostValue::Function(release)),
    ])
}

// ---------- `json()` ----------

/// Why the reference's host runtime can't parse `text` as JSON, as its `JSON.parse` says it (`JSON Parse error: ...`).
pub(crate) fn json_parse_error(text: &str) -> String {
    match parse_json(text) {
        Err(HostValue::Error(e)) => e.message.to_string_lossy().into_owned(),
        _ => "JSON Parse error: Unable to parse JSON string".into(),
    }
}

/// Parses a body as the reference's host runtime does for `Response.json`, with its error messages.
fn parse_json(text: &str) -> HostResult {
    let mut p = Json {
        s: text.as_bytes(),
        text,
        i: 0,
    };
    let fail = |m: String| {
        HostValue::Error(Box::new(HostError::named(
            "SyntaxError",
            format!("JSON Parse error: {m}"),
        )))
    };
    let tok = p.lex().map_err(fail)?;
    let value = p.value(tok).map_err(fail)?;
    match p.lex() {
        Ok(Tok::Eof) => Ok(value),
        _ => Err(fail("Unable to parse JSON string".into())),
    }
}

enum Tok {
    Eof,
    Punct(u8),
    Str(String),
    Num(f64),
    Lit(HostValue),
    Ident(String),
}

struct Json<'s> {
    s: &'s [u8],
    text: &'s str,
    i: usize,
}

type J<T> = Result<T, String>;

impl Json<'_> {
    fn lex(&mut self) -> J<Tok> {
        while self.i < self.s.len() && matches!(self.s[self.i], b' ' | b'\t' | b'\n' | b'\r') {
            self.i += 1;
        }
        let Some(&c) = self.s.get(self.i) else {
            return Ok(Tok::Eof);
        };
        match c {
            b'{' | b'}' | b'[' | b']' | b',' | b':' | b'.' => {
                self.i += 1;
                Ok(Tok::Punct(c))
            }
            b'"' => self.string().map(Tok::Str),
            b'\'' => Err("Single quotes (') are not allowed in JSON".into()),
            b'-' | b'0'..=b'9' => self.number().map(Tok::Num),
            c if c.is_ascii_alphabetic() || c == b'_' || c == b'$' => {
                let rest = &self.text[self.i..];
                for (word, value) in [
                    ("true", HostValue::Bool(true)),
                    ("false", HostValue::Bool(false)),
                    ("null", HostValue::Null),
                ] {
                    if rest.starts_with(word) {
                        self.i += word.len();
                        return Ok(Tok::Lit(value));
                    }
                }
                let end = rest
                    .find(|c: char| !(c.is_ascii_alphanumeric() || c == '_' || c == '$'))
                    .unwrap_or(rest.len());
                self.i += end;
                Ok(Tok::Ident(rest[..end].to_owned()))
            }
            _ => {
                let c = self.text[self.i..].chars().next().unwrap_or(' ');
                Err(format!("Unrecognized token '{c}'"))
            }
        }
    }

    /// A string as run text: lone surrogates from `\u` escapes kept in carrier form.
    fn string(&mut self) -> J<String> {
        self.i += 1;
        let mut units: Vec<u16> = Vec::new();
        let mut buf = [0u16; 2];
        loop {
            let Some(&c) = self.s.get(self.i) else {
                return Err("Unterminated string".into());
            };
            match c {
                b'"' => {
                    self.i += 1;
                    return Ok(crate::strings::from_units(&units));
                }
                0..=0x1f => return Err("Unterminated string".into()),
                b'\\' => {
                    let Some(&e) = self.s.get(self.i + 1) else {
                        return Err("Unterminated string".into());
                    };
                    self.i += 2;
                    let simple = match e {
                        b'"' => Some('"'),
                        b'\\' => Some('\\'),
                        b'/' => Some('/'),
                        b'b' => Some('\u{8}'),
                        b'f' => Some('\u{c}'),
                        b'n' => Some('\n'),
                        b'r' => Some('\r'),
                        b't' => Some('\t'),
                        _ => None,
                    };
                    if let Some(ch) = simple {
                        units.extend_from_slice(ch.encode_utf16(&mut buf));
                        continue;
                    }
                    if e != b'u' {
                        let ch = self.text[self.i - 1..].chars().next().unwrap_or(' ');
                        return Err(format!("Invalid escape character {ch}"));
                    }
                    let hex = self.s.get(self.i..self.i + 4);
                    let Some(unit) = hex
                        .filter(|h| h.iter().all(u8::is_ascii_hexdigit))
                        .and_then(|h| u16::from_str_radix(std::str::from_utf8(h).ok()?, 16).ok())
                    else {
                        return Err("\\u must be followed by 4 hex digits".into());
                    };
                    self.i += 4;
                    units.push(unit);
                }
                _ => {
                    let ch = self.text[self.i..].chars().next().unwrap_or(' ');
                    self.i += ch.len_utf8();
                    units.extend_from_slice(ch.encode_utf16(&mut buf));
                }
            }
        }
    }

    fn number(&mut self) -> J<f64> {
        let start = self.i;
        let digits = |p: &mut Self| {
            let from = p.i;
            while p.s.get(p.i).is_some_and(u8::is_ascii_digit) {
                p.i += 1;
            }
            p.i - from
        };
        if self.s[self.i] == b'-' {
            self.i += 1;
        }
        match self.s.get(self.i) {
            Some(b'0') => self.i += 1,
            Some(b'1'..=b'9') => {
                digits(self);
            }
            _ => return Err("Invalid number".into()),
        }
        if self.s.get(self.i) == Some(&b'.') {
            self.i += 1;
            if digits(self) == 0 {
                return Err("Invalid digits after decimal point".into());
            }
        }
        if matches!(self.s.get(self.i), Some(b'e' | b'E')) {
            let mut at = self.i + 1;
            if matches!(self.s.get(at), Some(b'+' | b'-')) {
                at += 1;
            }
            if self.s.get(at).is_some_and(u8::is_ascii_digit) {
                self.i = at;
                digits(self);
            }
        }
        Ok(self.text[start..self.i].parse().unwrap_or(f64::NAN))
    }

    fn value(&mut self, tok: Tok) -> J<HostValue> {
        match tok {
            Tok::Eof => Err("Unexpected EOF".into()),
            Tok::Str(s) => Ok(HostValue::String(crate::HostString::from_run_text(&s))),
            Tok::Num(n) => Ok(HostValue::Number(n)),
            Tok::Lit(v) => Ok(v),
            Tok::Ident(name) => Err(format!("Unexpected identifier \"{name}\"")),
            Tok::Punct(b'[') => {
                let mut items = Vec::new();
                let mut tok = self.lex()?;
                if matches!(tok, Tok::Punct(b']')) {
                    return Ok(HostValue::Array(items));
                }
                loop {
                    items.push(Some(self.value(tok)?));
                    match self.lex()? {
                        Tok::Punct(b',') => {
                            tok = self.lex()?;
                            if matches!(tok, Tok::Punct(b']')) {
                                return Err(
                                    "Unexpected comma at the end of array expression".into()
                                );
                            }
                        }
                        Tok::Punct(b']') => return Ok(HostValue::Array(items)),
                        _ => return Err("Expected ']'".into()),
                    }
                }
            }
            Tok::Punct(b'{') => {
                let mut fields: Vec<(crate::HostString, HostValue)> = Vec::new();
                let mut key = match self.lex()? {
                    Tok::Punct(b'}') => return Ok(HostValue::Object(fields)),
                    Tok::Str(s) => crate::HostString::from_run_text(&s),
                    _ => return Err("Expected '}'".into()),
                };
                loop {
                    if !matches!(self.lex()?, Tok::Punct(b':')) {
                        return Err(
                            "Expected ':' before value in object property definition".into()
                        );
                    }
                    let tok = self.lex()?;
                    let value = self.value(tok)?;
                    match fields.iter_mut().find(|(k, _)| *k == key) {
                        Some(slot) => slot.1 = value,
                        None => fields.push((key, value)),
                    }
                    match self.lex()? {
                        Tok::Punct(b',') => match self.lex()? {
                            Tok::Str(s) => key = crate::HostString::from_run_text(&s),
                            _ => return Err("Property name must be a string literal".into()),
                        },
                        Tok::Punct(b'}') => return Ok(HostValue::Object(fields)),
                        _ => return Err("Expected '}'".into()),
                    }
                }
            }
            Tok::Punct(c) => Err(format!("Unexpected token '{}'", c as char)),
        }
    }
}
