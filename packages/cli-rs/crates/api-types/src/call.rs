//! A request as the generated builders describe it ([`crate::client`]), typed by what it answers and with no transport:
//! `opencode-api`'s client sends it with its credentials, and a plugin sends it as a `Fetch` through its host
//! (`design/contract-ergonomics.md` 2.2 B). The encodings are the TypeScript client's: the query's brackets
//! (`appendQuery`, `packages/client/src/promise/generated/client.ts:2795-2810`) and `encodeURIComponent` for a path's
//! parameters.

use std::marker::PhantomData;

use bytes::Bytes;
use percent_encoding::{AsciiSet, NON_ALPHANUMERIC, utf8_percent_encode};
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::Value;

use crate::js::js_string;

/// One request of the API, whose reply decodes as `T` ([`Call::decode`]). A builder never fails: an input that does not
/// serialize is kept as [`Call::error`], which whoever sends the call reports instead of sending it.
#[derive(Debug)]
pub struct Call<T> {
    pub method: &'static str,
    pub path: String,
    /// Query pairs, bracket-encoded and not yet percent-encoded ([`encode`] does that).
    pub query: Vec<(String, String)>,
    pub headers: Vec<(String, String)>,
    pub body: Option<Body>,
    pub reply: Reply,
    pub success_status: u16,
    pub declared_statuses: &'static [u16],
    /// Why the call cannot be sent: a part of its input that did not serialize.
    pub error: Option<String>,
    output: PhantomData<fn() -> T>,
}

/// A request's body.
#[derive(Debug)]
pub enum Body {
    Json(Value),
    Bytes(Bytes),
}

/// How a call's reply reads.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Reply {
    /// The JSON body is the output.
    Json,
    /// The JSON body is `{ "data": output }`.
    Data,
    /// No body (204).
    Empty,
    /// The body's bytes.
    Binary,
    /// A stream of server-sent events, which only `opencode-api`'s client reads.
    Sse,
}

/// The output type of a call that streams events of `T`: it is no value, so a plugin's `cx.call` refuses it at build
/// time.
pub struct Sse<T>(PhantomData<T>);

impl<T> Call<T> {
    pub fn new(
        method: &'static str,
        path: String,
        reply: Reply,
        success_status: u16,
        declared_statuses: &'static [u16],
    ) -> Self {
        Self {
            method,
            path,
            query: Vec::new(),
            headers: Vec::new(),
            body: None,
            reply,
            success_status,
            declared_statuses,
            error: None,
            output: PhantomData,
        }
    }

    /// A path parameter: `String(value)` encoded like `encodeURIComponent`.
    pub fn param<V: Serialize + ?Sized>(&mut self, value: &V) -> String {
        self.value(value)
            .map(|value| utf8_percent_encode(&js_string(&value), COMPONENT).to_string())
            .unwrap_or_default()
    }

    /// Adds a query value, bracket-encoded like `appendQuery`.
    pub fn query<V: Serialize + ?Sized>(&mut self, key: &str, value: &V) {
        if let Some(value) = self.value(value) {
            append(&mut self.query, key, &value);
        }
    }

    /// Sets a header from an input field; `null` is skipped.
    pub fn header<V: Serialize + ?Sized>(&mut self, name: &str, value: &V) {
        if let Some(value) = self.value(value).filter(|value| !value.is_null()) {
            let name = name.to_ascii_lowercase();
            self.headers.retain(|(key, _)| *key != name);
            self.headers.push((name, js_string(&value)));
        }
    }

    /// Starts a JSON object body; [`Call::field`] fills it.
    pub fn object(&mut self) {
        self.body = Some(Body::Json(Value::Object(serde_json::Map::new())));
    }

    pub fn field<V: Serialize + ?Sized>(&mut self, key: &str, value: &V) {
        if let Some(value) = self.value(value)
            && let Some(Body::Json(Value::Object(map))) = &mut self.body
        {
            map.insert(key.to_owned(), value);
        }
    }

    /// Sets the whole JSON body, for a payload that is not flattened into fields.
    pub fn json<V: Serialize + ?Sized>(&mut self, value: &V) {
        if let Some(value) = self.value(value) {
            self.body = Some(Body::Json(value));
        }
    }

    pub fn bytes(&mut self, value: Bytes) {
        self.body = Some(Body::Bytes(value));
    }

    /// The same request, its output read as `U`.
    pub fn cast<U>(self) -> Call<U> {
        Call {
            method: self.method,
            path: self.path,
            query: self.query,
            headers: self.headers,
            body: self.body,
            reply: self.reply,
            success_status: self.success_status,
            declared_statuses: self.declared_statuses,
            error: self.error,
            output: PhantomData,
        }
    }

    fn value<V: Serialize + ?Sized>(&mut self, value: &V) -> Option<Value> {
        serde_json::to_value(value)
            .map_err(|error| {
                self.error.get_or_insert_with(|| format!("encode request: {error}"));
            })
            .ok()
    }
}

impl<T: DeserializeOwned> Call<T> {
    /// The output of the JSON reply `body`: the body itself, or its `data` for a call that answers in `data` (no body
    /// reads as `null`, which is `()`).
    pub fn decode(&self, body: Value) -> Result<T, String> {
        let body = match (self.reply, body) {
            (Reply::Data, Value::Object(mut fields)) => fields.remove("data").ok_or("the reply has no data")?,
            (Reply::Data, _) => return Err("the reply is not an object with data".to_owned()),
            (_, body) => body,
        };
        serde_json::from_value(body).map_err(|error| format!("MalformedResponse: {error}"))
    }
}

/// Appends `value` under `key`: `null` as `"null"`, arrays as repeated keys, objects as `key[child]`, and scalars as
/// JavaScript's `String(value)` would write them.
pub fn append(pairs: &mut Vec<(String, String)>, key: &str, value: &Value) {
    match value {
        Value::Array(items) => items.iter().for_each(|item| append(pairs, key, item)),
        Value::Object(map) => map.iter().for_each(|(child, item)| append(pairs, &format!("{key}[{child}]"), item)),
        _ => pairs.push((key.to_owned(), js_string(value))),
    }
}

/// The `application/x-www-form-urlencoded` form of `pairs`, as `URLSearchParams` serializes it.
pub fn encode(pairs: &[(String, String)]) -> String {
    let mut serializer = url::form_urlencoded::Serializer::new(String::new());
    for (key, value) in pairs {
        serializer.append_pair(key, value);
    }
    serializer.finish()
}

/// A path parameter: `String(value)` encoded like `encodeURIComponent`.
pub fn path_param<V: Serialize + ?Sized>(value: &V) -> Result<String, String> {
    let value = serde_json::to_value(value).map_err(|error| format!("encode request: {error}"))?;
    Ok(utf8_percent_encode(&js_string(&value), COMPONENT).to_string())
}

/// A trailing wildcard path, each segment encoded like `encodeURIComponent`.
pub fn path_wildcard(value: &str) -> String {
    value.split('/').map(|segment| utf8_percent_encode(segment, COMPONENT).to_string()).collect::<Vec<_>>().join("/")
}

/// The characters `encodeURIComponent` escapes: everything except `A-Z a-z 0-9 - _ . ! ~ * ' ( )`.
const COMPONENT: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'_')
    .remove(b'.')
    .remove(b'!')
    .remove(b'~')
    .remove(b'*')
    .remove(b'\'')
    .remove(b'(')
    .remove(b')');
