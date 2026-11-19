//! Host functions a program calls as globals, the counterpart of the reference's `Host` (`host-function.ts`): plain
//! functions ([`HostFunction`], `Host.fn`), functions whose work keeps running across a suspend ([`DurableFunction`],
//! `Host.durableFn`), lazy path-addressed objects of functions ([`Namespace`], `Host.namespace`), and failures with
//! their own diagnostic kind ([`Failure`], `Host.fail` and `Host.missing`).
//!
//! Every value crossing in either direction is a copy ([`HostValue`]), never shared: plain data, `Date`, `Map`, `Set`,
//! `Uint8Array`, `URL`, `Headers` and errors. A function inside a result is callable too. Work a host function does is
//! a future instead of the reference's Effect.

use std::fmt;
use std::future::Future;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use crate::exec::BoxFuture;
use crate::host::RunId;
use crate::{Data, Json};

/// A string crossing the boundary: any string a program can hold, including one with an unpaired surrogate, which
/// has no UTF-8 form. It keeps such a string's UTF-16 code units, so a host sees and returns exactly what the program
/// had; [`HostString::to_string_lossy`] gives a Rust `String` when one is wanted, with U+FFFD for each unpaired
/// surrogate.
#[derive(Clone, Default, PartialEq, Eq, Hash)]
pub struct HostString(Text);

#[derive(Clone, PartialEq, Eq, Hash)]
enum Text {
    Utf8(String),
    /// Code units holding at least one unpaired surrogate.
    Utf16(Box<[u16]>),
}

impl Default for Text {
    fn default() -> Self {
        Text::Utf8(String::new())
    }
}

impl HostString {
    /// The string of UTF-16 code units, well formed or not.
    pub fn from_utf16(units: &[u16]) -> Self {
        match String::from_utf16(units) {
            Ok(s) => HostString(Text::Utf8(s)),
            Err(_) => HostString(Text::Utf16(units.into())),
        }
    }

    /// The string as UTF-8, when it has no unpaired surrogate.
    pub fn as_str(&self) -> Option<&str> {
        match &self.0 {
            Text::Utf8(s) => Some(s),
            Text::Utf16(_) => None,
        }
    }

    /// Whether it has no unpaired surrogate, so it has a UTF-8 form.
    pub fn is_well_formed(&self) -> bool {
        matches!(self.0, Text::Utf8(_))
    }

    /// The string as UTF-8, with U+FFFD for each unpaired surrogate.
    pub fn to_string_lossy(&self) -> std::borrow::Cow<'_, str> {
        match &self.0 {
            Text::Utf8(s) => std::borrow::Cow::Borrowed(s),
            Text::Utf16(units) => std::borrow::Cow::Owned(String::from_utf16_lossy(units)),
        }
    }

    /// The string's UTF-16 code units.
    pub fn to_utf16(&self) -> std::borrow::Cow<'_, [u16]> {
        match &self.0 {
            Text::Utf8(s) => std::borrow::Cow::Owned(s.encode_utf16().collect()),
            Text::Utf16(units) => std::borrow::Cow::Borrowed(units),
        }
    }

    /// The string as UTF-8 when it is well formed, or itself.
    pub fn into_string(self) -> Result<String, Self> {
        match self.0 {
            Text::Utf8(s) => Ok(s),
            text => Err(HostString(text)),
        }
    }

    /// The text a run's string has (its carrier form: see `strings`).
    pub(crate) fn from_run_text(text: &str) -> Self {
        if !crate::strings::has_mark(text) {
            return HostString(Text::Utf8(text.to_owned()));
        }
        Self::from_utf16(&crate::strings::units_of(text))
    }

    /// The string as a run's text: its carrier form when it has an unpaired surrogate or a `MARK`.
    pub(crate) fn to_run_text(&self) -> String {
        match &self.0 {
            Text::Utf8(s) => crate::strings::external_text(s.clone()),
            Text::Utf16(units) => crate::strings::from_units(units),
        }
    }
}

impl From<String> for HostString {
    fn from(s: String) -> Self {
        HostString(Text::Utf8(s))
    }
}

impl From<&str> for HostString {
    fn from(s: &str) -> Self {
        HostString(Text::Utf8(s.to_owned()))
    }
}

impl From<&String> for HostString {
    fn from(s: &String) -> Self {
        HostString(Text::Utf8(s.clone()))
    }
}

impl PartialEq<str> for HostString {
    fn eq(&self, other: &str) -> bool {
        self.as_str() == Some(other)
    }
}

impl PartialEq<&str> for HostString {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == Some(*other)
    }
}

impl PartialEq<String> for HostString {
    fn eq(&self, other: &String) -> bool {
        self.as_str() == Some(other.as_str())
    }
}

impl fmt::Display for HostString {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.to_string_lossy())
    }
}

impl fmt::Debug for HostString {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.0 {
            Text::Utf8(s) => fmt::Debug::fmt(s, f),
            Text::Utf16(units) => write!(f, "HostString::from_utf16(&{units:?})"),
        }
    }
}

/// A value on the host's side of the boundary.
#[derive(Clone, Debug, Default)]
pub enum HostValue {
    #[default]
    Undefined,
    Null,
    Bool(bool),
    Number(f64),
    String(HostString),
    /// `None` is a hole.
    Array(Vec<Option<HostValue>>),
    Object(Vec<(HostString, HostValue)>),
    Map(Vec<(HostValue, HostValue)>),
    Set(Vec<HostValue>),
    Function(HostFunction),
    /// A durable function, among a runtime's globals.
    Durable(DurableFunction),
    /// A namespace of functions, among a runtime's globals.
    Namespace(Namespace),
    Error(Box<HostError>),
    /// A failure with its own diagnostic kind, which a host function throws: see [`Failure`].
    Failure(Failure),
    /// Milliseconds since the epoch; `NaN` is an invalid date.
    Date(f64),
    RegExp {
        source: HostString,
        flags: String,
    },
    /// A URL by its `href`.
    Url(String),
    /// `URLSearchParams` by its name-value pairs.
    SearchParams(Vec<(String, String)>),
    /// `Headers` by its entries.
    Headers(Vec<(String, String)>),
    /// A `Uint8Array`, or an `ArrayBuffer`'s bytes.
    Bytes(Vec<u8>),
    /// A Node `Buffer`.
    Buffer(Vec<u8>),
    /// A live HTTP response whose body the host streams, the reference's `StreamingResponse`.
    Response(crate::streaming::StreamingResponse),
    /// What a host function throws (`Err(HostValue::Interrupt)`) to interrupt the whole run, as the reference's
    /// host functions do with `Effect.interrupt`: the run ends with [`Interrupted`](crate::Interrupted).
    Interrupt,
}

impl HostValue {
    pub fn object<K: Into<HostString>>(fields: impl IntoIterator<Item = (K, HostValue)>) -> Self {
        HostValue::Object(fields.into_iter().map(|(k, v)| (k.into(), v)).collect())
    }

    pub fn array(items: impl IntoIterator<Item = HostValue>) -> Self {
        HostValue::Array(items.into_iter().map(Some).collect())
    }

    /// A field of an object, if it is one.
    pub fn get(&self, key: &str) -> Option<&HostValue> {
        match self {
            HostValue::Object(fields) => fields.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            HostValue::String(s) => s.as_str(),
            _ => None,
        }
    }

    /// The string, when the value is one, unpaired surrogates kept.
    pub fn as_host_string(&self) -> Option<HostString> {
        match self {
            HostValue::String(s) => Some(s.clone()),
            _ => None,
        }
    }

    pub fn as_f64(&self) -> Option<f64> {
        match self {
            HostValue::Number(n) => Some(*n),
            _ => None,
        }
    }

    /// Plain JSON data as a host value.
    pub fn from_json(json: &Json) -> Self {
        match json {
            Json::Null => HostValue::Null,
            Json::Bool(b) => HostValue::Bool(*b),
            Json::Number(n) => HostValue::Number(n.as_f64().unwrap_or(f64::NAN)),
            Json::String(s) => HostValue::String(s.into()),
            Json::Array(items) => HostValue::array(items.iter().map(HostValue::from_json)),
            Json::Object(map) => HostValue::Object(
                map.iter()
                    .map(|(k, v)| (k.into(), HostValue::from_json(v)))
                    .collect(),
            ),
        }
    }

    /// The value as JSON, the way `JSON.stringify` would see it: functions and `undefined` vanish.
    pub fn to_json(&self) -> Option<Json> {
        Some(match self {
            HostValue::Undefined
            | HostValue::Function(_)
            | HostValue::Durable(_)
            | HostValue::Namespace(_)
            | HostValue::Interrupt => return None,
            HostValue::Null => Json::Null,
            HostValue::Bool(b) => Json::Bool(*b),
            HostValue::Number(n) if n.fract() == 0.0 && n.abs() < 9.0e15 => Json::from(*n as i64),
            HostValue::Number(n) => {
                serde_json::Number::from_f64(*n).map_or(Json::Null, Json::Number)
            }
            HostValue::String(s) => Json::String(s.to_string_lossy().into_owned()),
            HostValue::Array(items) => Json::Array(
                items
                    .iter()
                    .map(|i| {
                        i.as_ref()
                            .and_then(HostValue::to_json)
                            .unwrap_or(Json::Null)
                    })
                    .collect(),
            ),
            HostValue::Set(items) => Json::Array(
                items
                    .iter()
                    .map(|i| i.to_json().unwrap_or(Json::Null))
                    .collect(),
            ),
            HostValue::Object(fields) => Json::Object(
                fields
                    .iter()
                    .filter_map(|(k, v)| v.to_json().map(|j| (k.to_string_lossy().into_owned(), j)))
                    .collect(),
            ),
            HostValue::Map(_)
            | HostValue::RegExp { .. }
            | HostValue::SearchParams(_)
            | HostValue::Headers(_) => Json::Object(Default::default()),
            HostValue::Response(r) => {
                serde_json::json!({ "response": {}, "redirected": r.redirected })
            }
            HostValue::Date(t) => match t.is_finite() {
                true => Json::String(crate::builtins::date::iso_string(*t)),
                false => Json::Null,
            },
            HostValue::Url(href) => Json::String(href.clone()),
            HostValue::Bytes(data) => Json::Object(
                data.iter()
                    .enumerate()
                    .map(|(i, b)| (i.to_string(), Json::from(*b)))
                    .collect(),
            ),
            HostValue::Buffer(data) => serde_json::json!({ "type": "Buffer", "data": data }),
            HostValue::Error(e) => {
                let mut map = serde_json::Map::new();
                map.insert(
                    "name".into(),
                    Json::String(e.name.to_string_lossy().into_owned()),
                );
                map.insert(
                    "message".into(),
                    Json::String(e.message.to_string_lossy().into_owned()),
                );
                Json::Object(map)
            }
            HostValue::Failure(f) => {
                let lossy = |s: &HostString| Json::String(s.to_string_lossy().into_owned());
                serde_json::json!({
                    "kind": f.kind,
                    "message": lossy(&f.message),
                    "suggestions": f.suggestions.iter().map(lossy).collect::<Vec<_>>(),
                })
            }
        })
    }
}

impl From<&str> for HostValue {
    fn from(s: &str) -> Self {
        HostValue::String(s.into())
    }
}

impl From<String> for HostValue {
    fn from(s: String) -> Self {
        HostValue::String(s.into())
    }
}

impl From<f64> for HostValue {
    fn from(n: f64) -> Self {
        HostValue::Number(n)
    }
}

impl From<bool> for HostValue {
    fn from(b: bool) -> Self {
        HostValue::Bool(b)
    }
}

impl From<HostFunction> for HostValue {
    fn from(f: HostFunction) -> Self {
        HostValue::Function(f)
    }
}

impl From<DurableFunction> for HostValue {
    fn from(f: DurableFunction) -> Self {
        HostValue::Durable(f)
    }
}

impl From<Namespace> for HostValue {
    fn from(n: Namespace) -> Self {
        HostValue::Namespace(n)
    }
}

impl From<HostError> for HostValue {
    fn from(e: HostError) -> Self {
        HostValue::Error(Box::new(e))
    }
}

impl From<Failure> for HostValue {
    fn from(f: Failure) -> Self {
        HostValue::Failure(f)
    }
}

/// An error crossing the boundary: its name (`TypeError`, ...), message, cause, and own data such as Node's `code`.
#[derive(Clone, Debug, Default)]
pub struct HostError {
    pub name: HostString,
    pub message: HostString,
    pub cause: Option<Box<HostValue>>,
    pub fields: Vec<(HostString, HostValue)>,
}

impl HostError {
    /// An `Error`.
    pub fn new(message: impl Into<HostString>) -> Self {
        Self::named("Error", message)
    }

    /// An error of a built-in type: `TypeError`, `RangeError`, `SyntaxError`, ... Other names become `Error`.
    pub fn named(name: impl Into<HostString>, message: impl Into<HostString>) -> Self {
        Self {
            name: name.into(),
            message: message.into(),
            cause: None,
            fields: Vec::new(),
        }
    }

    pub fn with_cause(mut self, cause: impl Into<HostValue>) -> Self {
        self.cause = Some(Box::new(cause.into()));
        self
    }

    pub fn with_field(mut self, key: impl Into<HostString>, value: impl Into<HostValue>) -> Self {
        self.fields.push((key.into(), value.into()));
        self
    }
}

impl fmt::Display for HostError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.message == "" {
            write!(f, "{}", self.name)
        } else {
            write!(f, "{}: {}", self.name, self.message)
        }
    }
}

impl std::error::Error for HostError {}

/// A failure with its own diagnostic `kind` and `suggestions`, the reference's `Host.fail` and `Host.missing`: a host
/// function throws it (`Err(failure.into())`), and a namespace resolves a path with no function to it. Uncaught, the
/// run fails with that kind, message and suggestions.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Failure {
    pub kind: String,
    pub message: HostString,
    pub suggestions: Vec<HostString>,
}

impl Failure {
    /// `Host.fail(kind, message)`.
    pub fn new(kind: impl Into<String>, message: impl Into<HostString>) -> Self {
        Self {
            kind: kind.into(),
            message: message.into(),
            suggestions: Vec::new(),
        }
    }

    /// `Host.missing(message)`: what a namespace gives for a path with no function, an `ExecutionFailure` unless
    /// [`Failure::kind`] says otherwise.
    pub fn missing(message: impl Into<HostString>) -> Self {
        Self::new("ExecutionFailure", message)
    }

    pub fn kind(mut self, kind: impl Into<String>) -> Self {
        self.kind = kind.into();
        self
    }

    pub fn suggestions<S: Into<HostString>>(
        mut self,
        suggestions: impl IntoIterator<Item = S>,
    ) -> Self {
        self.suggestions = suggestions.into_iter().map(Into::into).collect();
        self
    }
}

impl fmt::Display for Failure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message.to_string_lossy())
    }
}

impl std::error::Error for Failure {}

/// What a host function gives back: a value, or a value it throws (a [`HostValue::Error`] or [`HostValue::Failure`]).
pub type HostResult = Result<HostValue, HostValue>;

/// What a synchronous host function returns, the forms the reference's `Host.fn` result takes.
pub enum Returned {
    /// Its outcome now: a value, or what it throws.
    Now(HostResult),
    /// Work still pending, which reaches the program as a promise, the reference's returned Promise. It starts at the
    /// run's next handover, as the reference queues it.
    Pending(BoxFuture<'static, HostResult>),
    /// Work the program waits for before its next statement, the reference's returned Effect: the run's queued host
    /// calls start first and keep running meanwhile, and a suspend is refused until it completes. Its value reaches
    /// the program as `Now`'s does.
    Block(BoxFuture<'static, HostResult>),
}

impl From<HostResult> for Returned {
    fn from(r: HostResult) -> Self {
        Returned::Now(r)
    }
}

impl From<HostValue> for Returned {
    fn from(v: HostValue) -> Self {
        Returned::Now(Ok(v))
    }
}

/// What every call of a host function gets.
#[derive(Clone)]
pub struct Call {
    run_id: RunId,
    call: u64,
    suspending: Arc<AtomicBool>,
}

impl Call {
    pub(crate) fn new(run_id: RunId, call: u64, suspending: Arc<AtomicBool>) -> Self {
        Self {
            run_id,
            call,
            suspending,
        }
    }

    /// The call's key, `<runId>:<callId>`: the same across a suspended run's resumes.
    pub fn key(&self) -> String {
        crate::host::call_key(&self.run_id, self.call)
    }

    /// Whether the run is being suspended: an interruption now detaches the call instead of ending it.
    pub fn suspending(&self) -> bool {
        self.suspending.load(Ordering::Relaxed)
    }
}

impl fmt::Debug for Call {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Call({})", self.key())
    }
}

/// What every call of a durable function gets: also the arguments it was called with, as they crossed.
#[derive(Clone, Debug)]
pub struct DurableCall {
    pub call: Call,
    pub args: Vec<HostValue>,
}

impl std::ops::Deref for DurableCall {
    type Target = Call;
    fn deref(&self) -> &Call {
        &self.call
    }
}

type SyncFn = dyn Fn(Vec<HostValue>, &Call) -> Returned + Send + Sync;
type AsyncFn = dyn Fn(Vec<HostValue>, Call) -> BoxFuture<'static, HostResult> + Send + Sync;

#[derive(Clone)]
pub(crate) enum Body {
    Sync(Arc<SyncFn>),
    Async(Arc<AsyncFn>),
    /// A function a resumed run lost: calling it throws this message at the call.
    Lost(Arc<str>),
}

/// How a call of a host function reaches the program, the reference's `Host.Type`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CallType {
    /// The program waits for the function: its value, or a promise for work it left pending.
    Sync,
    /// The program gets a promise at once, and the function runs once the program's current step ends.
    Async,
    /// As `Sync`, and an object result also has hidden `then`, `catch` and `finally`.
    SyncThenable,
}

/// A host function, the reference's `Host.fn`: it gets the program's arguments, as they crossed, and the call.
///
/// A synchronous function returns before the next statement, like `fs.readFileSync`, and may block the thread to do
/// so; work it leaves pending reaches the program as a promise. An asynchronous one hands the program a promise, and
/// its future runs on whatever drives the program.
#[derive(Clone)]
pub struct HostFunction {
    pub(crate) name: Arc<str>,
    pub(crate) length: u8,
    pub(crate) body: Body,
    pub(crate) thenable: bool,
    pub(crate) idempotent: bool,
    pub(crate) constructible: bool,
    pub(crate) takes_functions: bool,
    pub(crate) snapshot: Option<SnapshotHooks>,
    /// Whether its name is its own, even when empty; otherwise an unnamed function is named by where it is.
    pub(crate) own_name: bool,
}

impl HostFunction {
    /// A synchronous function: the program waits for it. It returns a [`HostResult`], a [`HostValue`], or a
    /// [`Returned::Pending`] future, which the program holds as a promise.
    pub fn new<R: Into<Returned>>(
        f: impl Fn(Vec<HostValue>, &Call) -> R + Send + Sync + 'static,
    ) -> Self {
        Self::with_body(Body::Sync(Arc::new(move |args, call| f(args, call).into())))
    }

    /// An asynchronous function: the program gets a promise at once.
    pub fn new_async<F>(f: impl Fn(Vec<HostValue>, Call) -> F + Send + Sync + 'static) -> Self
    where
        F: Future<Output = HostResult> + Send + 'static,
    {
        Self::with_body(Body::Async(Arc::new(move |args, call| {
            Box::pin(f(args, call))
        })))
    }

    /// A function the crate makes for its own globals (a streaming response's methods), named and with a `length`.
    pub(crate) fn internal(
        name: &str,
        length: u8,
        f: impl Fn(Vec<HostValue>) -> HostResult + Send + Sync + 'static,
    ) -> Self {
        let mut made = Self::new(move |args, _: &Call| f(args));
        made.name = name.into();
        made.length = length;
        made.own_name = true;
        made
    }

    pub(crate) fn internal_async<F>(
        name: &str,
        length: u8,
        f: impl Fn(Vec<HostValue>) -> F + Send + Sync + 'static,
    ) -> Self
    where
        F: Future<Output = HostResult> + Send + 'static,
    {
        // A plain function of the reference that returns a promise: it runs at the call, and its work reaches the
        // program as a promise.
        let mut made = Self::new(move |args, _: &Call| Returned::Pending(Box::pin(f(args))));
        made.name = name.into();
        made.length = length;
        made.own_name = true;
        made
    }

    fn with_body(body: Body) -> Self {
        Self {
            name: Arc::from(""),
            length: 0,
            body,
            thenable: false,
            idempotent: false,
            constructible: false,
            takes_functions: false,
            snapshot: None,
            own_name: false,
        }
    }

    /// A function a resumed run lost: calling it throws `message`.
    pub(crate) fn lost(name: &str, message: String) -> Self {
        let mut made = Self::with_body(Body::Lost(message.into()));
        made.name = name.into();
        made.own_name = true;
        made
    }

    /// The name the program reads as the function's `name`; by default, the last part of where it is
    /// (`readFile` for `fs.readFile`).
    pub fn named(mut self, name: impl Into<String>) -> Self {
        self.name = Arc::from(name.into());
        self.own_name = true;
        self
    }

    /// What the program reads as the function's `length`.
    pub fn length(mut self, length: u8) -> Self {
        self.length = length;
        self
    }

    /// The reference's `"sync-thenable"` type: as a synchronous function, and an object result also has hidden
    /// `then`, `catch` and `finally`, so the program can use it directly or await it.
    ///
    /// # Panics
    ///
    /// On an asynchronous function.
    pub fn thenable(mut self) -> Self {
        assert!(
            !matches!(self.body, Body::Async(_)),
            "A sync-thenable function is synchronous."
        );
        self.thenable = true;
        self
    }

    /// Safe to run twice: a suspend interrupts a call in progress, and the resumed run calls it again with the same
    /// key. Without it, a suspend fails while a call is in progress.
    ///
    /// # Panics
    ///
    /// On a synchronous function: idempotent applies only to asynchronous ones, as in the reference.
    pub fn idempotent(mut self) -> Self {
        assert!(
            matches!(self.body, Body::Async(_)),
            "idempotent applies only to async functions."
        );
        self.idempotent = true;
        self
    }

    /// Lets a program call the function with `new`, as it would a class. `new` calls it the same way a plain call
    /// does, and the program gets what it returns.
    pub fn constructible(mut self) -> Self {
        self.constructible = true;
        self
    }

    /// Lets the program pass back a function that was inside a result, on its own or inside an argument: it arrives as
    /// the host function itself, and the run can't be suspended until the call completes. Without it, such a function
    /// is treated like any other function in an argument (see [`Translate`](crate::Translate)).
    pub fn takes_functions(mut self) -> Self {
        self.takes_functions = true;
        self
    }

    /// Lets a saved run keep the functions inside values this function returned: `encode` gets such a value and gives
    /// plain data (JSON values and bytes); `decode` gets that data back on resume and gives a value of the same shape,
    /// whose functions the program's copies call from then on. Without it, those functions are lost on resume.
    pub fn snapshot(
        mut self,
        encode: impl Fn(&HostValue) -> Result<HostValue, HostError> + Send + Sync + 'static,
        decode: impl Fn(HostValue) -> HostValue + Send + Sync + 'static,
    ) -> Self {
        self.snapshot = Some(SnapshotHooks {
            encode: Arc::new(encode),
            decode: Arc::new(decode),
        });
        self
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    /// How its calls reach the program.
    pub fn call_type(&self) -> CallType {
        match (&self.body, self.thenable) {
            (Body::Async(_), _) => CallType::Async,
            (_, true) => CallType::SyncThenable,
            _ => CallType::Sync,
        }
    }

    pub fn is_async(&self) -> bool {
        matches!(self.body, Body::Async(_))
    }

    pub fn is_idempotent(&self) -> bool {
        self.idempotent
    }

    pub fn is_constructible(&self) -> bool {
        self.constructible
    }

    pub fn accepts_functions(&self) -> bool {
        self.takes_functions
    }
}

impl fmt::Debug for HostFunction {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[Function {}]", self.name)
    }
}

/// A host function's `snapshot` hooks; see [`HostFunction::snapshot`].
#[derive(Clone)]
pub struct SnapshotHooks {
    pub(crate) encode: Arc<SnapshotEncode>,
    pub(crate) decode: Arc<SnapshotDecode>,
}

pub type SnapshotEncode = dyn Fn(&HostValue) -> Result<HostValue, HostError> + Send + Sync;
pub type SnapshotDecode = dyn Fn(HostValue) -> HostValue + Send + Sync;

impl fmt::Debug for SnapshotHooks {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("SnapshotHooks")
    }
}

type StartFn =
    dyn Fn(Vec<HostValue>, Call) -> BoxFuture<'static, Result<Data, HostValue>> + Send + Sync;
type WaitFn = dyn Fn(Data, DurableCall) -> BoxFuture<'static, HostResult> + Send + Sync;
type CancelFn = dyn Fn(Data, DurableCall) -> BoxFuture<'static, ()> + Send + Sync;

/// A host function whose work keeps running across a suspend, the reference's `Host.durableFn`. `start` begins it
/// and gives JSON data, kept in a saved run; `wait(data)` runs right after, and again after a resume, for the result.
/// `cancel(data)` runs only when the run is interrupted, or ends with the work still running. The program always gets
/// a promise.
#[derive(Clone)]
pub struct DurableFunction {
    pub(crate) start: Arc<StartFn>,
    pub(crate) wait: Arc<WaitFn>,
    pub(crate) cancel: Arc<CancelFn>,
}

impl DurableFunction {
    pub fn new<S, W, C>(
        start: impl Fn(Vec<HostValue>, Call) -> S + Send + Sync + 'static,
        wait: impl Fn(Data, DurableCall) -> W + Send + Sync + 'static,
        cancel: impl Fn(Data, DurableCall) -> C + Send + Sync + 'static,
    ) -> Self
    where
        S: Future<Output = Result<Data, HostValue>> + Send + 'static,
        W: Future<Output = HostResult> + Send + 'static,
        C: Future<Output = ()> + Send + 'static,
    {
        Self {
            start: Arc::new(move |args, call| Box::pin(start(args, call))),
            wait: Arc::new(move |data, call| Box::pin(wait(data, call))),
            cancel: Arc::new(move |data, call| Box::pin(cancel(data, call))),
        }
    }
}

impl fmt::Debug for DurableFunction {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("[DurableFunction]")
    }
}

/// What a namespace gives for a path: the function a call reaches, or the failure the call throws.
pub enum Resolved {
    Function(HostFunction),
    Durable(DurableFunction),
    Missing(Failure),
}

impl From<HostFunction> for Resolved {
    fn from(f: HostFunction) -> Self {
        Resolved::Function(f)
    }
}

impl From<DurableFunction> for Resolved {
    fn from(f: DurableFunction) -> Self {
        Resolved::Durable(f)
    }
}

impl From<Failure> for Resolved {
    fn from(f: Failure) -> Self {
        Resolved::Missing(f)
    }
}

type KeysFn = dyn Fn(&[HostString]) -> Result<Vec<HostString>, HostValue> + Send + Sync;
type ResolveFn = dyn Fn(&[HostString]) -> Resolved + Send + Sync;

/// A lazy object of host functions, for sets of functions too large to build as objects, the reference's `Host.namespace`.
/// `keys(path)` lists the names under a path, for `Object.keys` and `for...in`, or fails with what `Object.keys` then
/// throws (a [`Failure`], say); `resolve(path)` gives the function a call reaches, or a failure (see
/// [`Failure::missing`]) the call throws. Any path can be read, so `ns.a.b` is a path
/// whether or not anything is there.
#[derive(Clone)]
pub struct Namespace {
    pub(crate) keys: Arc<KeysFn>,
    pub(crate) resolve: Arc<ResolveFn>,
}

impl Namespace {
    pub fn new<R: Into<Resolved>>(
        keys: impl Fn(&[HostString]) -> Result<Vec<HostString>, HostValue> + Send + Sync + 'static,
        resolve: impl Fn(&[HostString]) -> R + Send + Sync + 'static,
    ) -> Self {
        Self {
            keys: Arc::new(keys),
            resolve: Arc::new(move |path| resolve(path).into()),
        }
    }
}

impl fmt::Debug for Namespace {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("[Namespace]")
    }
}
