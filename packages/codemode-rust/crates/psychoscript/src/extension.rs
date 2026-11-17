//! Extensions: host functions and objects of functions a program reaches directly as globals, like `fetch` or `fs`.
//!
//! Every value crossing in either direction is a copy ([`HostValue`]), never shared. A function inside a result
//! becomes a program function that crosses the same way. Extension calls are not tool calls: they are not in the
//! catalog and do not count against `max_tool_calls`.

use std::fmt;
use std::future::Future;
use std::sync::Arc;

use crate::tool::BoxFuture;

/// A value on the host's side of the boundary.
#[derive(Clone, Debug, Default)]
pub enum HostValue {
    #[default]
    Undefined,
    Null,
    Bool(bool),
    Number(f64),
    String(String),
    /// `None` is a hole.
    Array(Vec<Option<HostValue>>),
    Object(Vec<(String, HostValue)>),
    Map(Vec<(HostValue, HostValue)>),
    Set(Vec<HostValue>),
    Function(HostFunction),
    Error(Box<HostError>),
    /// Milliseconds since the epoch; `NaN` is an invalid date.
    Date(f64),
    RegExp {
        source: String,
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
}

impl HostValue {
    pub fn object<K: Into<String>>(fields: impl IntoIterator<Item = (K, HostValue)>) -> Self {
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
            HostValue::String(s) => Some(s),
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
    pub fn from_json(json: &crate::Json) -> Self {
        use crate::Json;
        match json {
            Json::Null => HostValue::Null,
            Json::Bool(b) => HostValue::Bool(*b),
            Json::Number(n) => HostValue::Number(n.as_f64().unwrap_or(f64::NAN)),
            Json::String(s) => HostValue::String(s.clone()),
            Json::Array(items) => HostValue::array(items.iter().map(HostValue::from_json)),
            Json::Object(map) => HostValue::Object(
                map.iter()
                    .map(|(k, v)| (k.clone(), HostValue::from_json(v)))
                    .collect(),
            ),
        }
    }

    /// The value as JSON, the way `JSON.stringify` would see it: functions and `undefined` vanish.
    pub fn to_json(&self) -> Option<crate::Json> {
        use crate::Json;
        Some(match self {
            HostValue::Undefined | HostValue::Function(_) => return None,
            HostValue::Null => Json::Null,
            HostValue::Bool(b) => Json::Bool(*b),
            HostValue::Number(n) if n.fract() == 0.0 && n.abs() < 9.0e15 => Json::from(*n as i64),
            HostValue::Number(n) => {
                serde_json::Number::from_f64(*n).map_or(Json::Null, Json::Number)
            }
            HostValue::String(s) => Json::String(s.clone()),
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
                    .filter_map(|(k, v)| v.to_json().map(|j| (k.clone(), j)))
                    .collect(),
            ),
            HostValue::Map(_)
            | HostValue::RegExp { .. }
            | HostValue::SearchParams(_)
            | HostValue::Headers(_) => Json::Object(Default::default()),
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
                map.insert("name".into(), Json::String(e.name.clone()));
                map.insert("message".into(), Json::String(e.message.clone()));
                Json::Object(map)
            }
        })
    }
}

impl From<&str> for HostValue {
    fn from(s: &str) -> Self {
        HostValue::String(s.to_owned())
    }
}

impl From<String> for HostValue {
    fn from(s: String) -> Self {
        HostValue::String(s)
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

impl From<HostError> for HostValue {
    fn from(e: HostError) -> Self {
        HostValue::Error(Box::new(e))
    }
}

/// An error crossing the boundary: its name (`TypeError`, ...), message, cause, and own data such as Node's `code`.
#[derive(Clone, Debug, Default)]
pub struct HostError {
    pub name: String,
    pub message: String,
    pub cause: Option<Box<HostValue>>,
    pub fields: Vec<(String, HostValue)>,
}

impl HostError {
    /// An `Error`.
    pub fn new(message: impl Into<String>) -> Self {
        Self::named("Error", message)
    }

    /// An error of a built-in type: `TypeError`, `RangeError`, `SyntaxError`, ... Other names become `Error`.
    pub fn named(name: impl Into<String>, message: impl Into<String>) -> Self {
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

    pub fn with_field(mut self, key: impl Into<String>, value: impl Into<HostValue>) -> Self {
        self.fields.push((key.into(), value.into()));
        self
    }
}

impl fmt::Display for HostError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.message.is_empty() {
            f.write_str(&self.name)
        } else {
            write!(f, "{}: {}", self.name, self.message)
        }
    }
}

impl std::error::Error for HostError {}

/// What a host function gives back: a value, or a value it throws (usually a [`HostValue::Error`]).
pub type HostResult = Result<HostValue, HostValue>;

type SyncFn = dyn Fn(Vec<HostValue>) -> HostResult + Send + Sync;
type AsyncFn = dyn Fn(Vec<HostValue>) -> BoxFuture<'static, HostResult> + Send + Sync;

#[derive(Clone)]
pub(crate) enum Body {
    Sync(Arc<SyncFn>),
    Async(Arc<AsyncFn>),
}

/// A host function the program can call.
///
/// A synchronous function returns before the next statement, like `fs.readFileSync`; it may block the thread to do
/// so. An asynchronous one hands the program a promise, and its future runs on whatever drives the program. A denied
/// call fails the way the function would: an asynchronous function rejects its promise, a synchronous one throws.
#[derive(Clone)]
pub struct HostFunction {
    pub(crate) name: String,
    pub(crate) length: u8,
    pub(crate) body: Body,
}

impl HostFunction {
    /// `length` is what the program reads as the function's `length`.
    pub fn new(
        name: impl Into<String>,
        length: u8,
        f: impl Fn(Vec<HostValue>) -> HostResult + Send + Sync + 'static,
    ) -> Self {
        Self {
            name: name.into(),
            length,
            body: Body::Sync(Arc::new(f)),
        }
    }

    pub fn new_async<F>(
        name: impl Into<String>,
        length: u8,
        f: impl Fn(Vec<HostValue>) -> F + Send + Sync + 'static,
    ) -> Self
    where
        F: Future<Output = HostResult> + Send + 'static,
    {
        Self {
            name: name.into(),
            length,
            body: Body::Async(Arc::new(move |args| Box::pin(f(args)))),
        }
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn is_async(&self) -> bool {
        matches!(self.body, Body::Async(_))
    }
}

impl fmt::Debug for HostFunction {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[Function {}]", self.name)
    }
}

/// A named group of globals, the counterpart of the reference's `Extension.make`. Programs can also load a global
/// by its Node module name with `import`, `require` and `import()`.
#[derive(Clone, Debug)]
pub struct Extension {
    name: String,
    globals: Vec<(String, HostValue)>,
    snapshot: Option<SnapshotHooks>,
}

/// An extension's `snapshot` hooks, which keep the functions inside its results across a suspend: `encode` turns a
/// value one of its functions returned into plain data (JSON values), and `decode` turns that data back into a host
/// value of the same shape.
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

impl Extension {
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            globals: Vec::new(),
            snapshot: None,
        }
    }

    /// The `snapshot` hooks: without them, functions inside this extension's results are lost on resume, and calling
    /// one throws a `TypeError`. A state saved with them resumes only where this extension has hooks too.
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

    pub(crate) fn snapshot_hooks(&self) -> Option<&SnapshotHooks> {
        self.snapshot.as_ref()
    }

    /// A global function.
    pub fn function(mut self, name: impl Into<String>, f: HostFunction) -> Self {
        self.globals.push((name.into(), HostValue::Function(f)));
        self
    }

    /// A global object, such as `fs`. Every function reachable from it is an entry point named by its path
    /// (`fs.readFile`, `fs.promises.readFile`), so calls fire the extension hooks.
    ///
    /// # Panics
    ///
    /// When `value` is not an object, as the reference throws from `Extension.make`.
    pub fn object(mut self, name: impl Into<String>, value: HostValue) -> Self {
        let name = name.into();
        assert!(
            matches!(value, HostValue::Object(_)),
            "Extension \"{}\" global \"{name}\" must be a function or an object.",
            self.name
        );
        self.globals.push((name, value));
        self
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn globals(&self) -> &[(String, HostValue)] {
        &self.globals
    }
}
