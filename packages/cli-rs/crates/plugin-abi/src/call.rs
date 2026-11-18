//! Typed calls: a request from [`crate::client`] sent as a [`Fetch`] and its reply decoded as the operation's output
//! (`design/contract-ergonomics.md` 2.2 B). [`Cx::call`], [`Cx::call_on_thread`] and [`Cx::send`] send them.
//!
//! ```
//! # use opencode_plugin_abi::*;
//! # use opencode_plugin_abi::task::Cx;
//! # use opencode_plugin_abi::types::{SessionInboxListInput, SessionID};
//! async fn pending(cx: Cx, session: SessionID) -> Result<usize, String> {
//!     let input = SessionInboxListInput { session_id: session };
//!     let items = cx.call(client::session_inbox_list(&input)).await?;
//!     Ok(items.len())
//! }
//! ```

use std::future::Future;

use opencode_api_types::call::{Body, Call, Reply};
use serde::de::DeserializeOwned;
use serde_json::Value;

use crate::Fetch;
use crate::task::Cx;

/// The [`Fetch`] that sends `call` through the host: its method, path, query and JSON body, and `bytes` for a call that
/// answers with bytes. A call the host's fetch cannot carry is the error: one with headers, a byte body or a stream of
/// events, or an input that did not serialize.
pub fn fetch_of<T>(call: &Call<T>) -> Result<Fetch, String> {
    if let Some(error) = &call.error {
        return Err(error.clone());
    }
    if call.reply == Reply::Sse {
        return Err(format!("{} {} streams events, which a plugin's fetch does not read", call.method, call.path));
    }
    if let Some((name, _)) = call.headers.first() {
        return Err(format!("a plugin's fetch sends no headers, and {} {} sets {name}", call.method, call.path));
    }
    let body = match &call.body {
        None => None,
        Some(Body::Json(value)) => Some(value.clone()),
        Some(Body::Bytes(_)) => return Err(format!("a plugin's fetch sends no byte body, which {} takes", call.path)),
    };
    Ok(Fetch {
        method: call.method.to_owned(),
        path: call.path.clone(),
        query: call.query.clone(),
        body,
        bytes: call.reply == Reply::Binary,
    })
}

impl Cx {
    /// Sends `call`, a request of [`crate::client`], and waits for its output: the reply decoded as the operation's
    /// output type (its `data` where the operation answers in `data`), or the error ([`Cx::fetch`]'s, or why the reply
    /// does not decode). It sends at once, as [`Cx::fetch`] does, so several calls made before an `.await` go out
    /// together.
    pub fn call<T: DeserializeOwned + 'static>(
        &self,
        call: Call<T>,
    ) -> impl Future<Output = Result<T, String>> + 'static {
        let sent = fetch_of(&call).map(|fetch| self.fetch(fetch));
        async move { decode(&call, sent?.await?) }
    }

    /// [`Cx::call`], with the reply's bytes decoded on one of the plugin's threads ([`Cx::blocking`]), not on the UI
    /// thread: for a large reply, such as a page of a hundred messages with their content.
    pub fn call_on_thread<T: DeserializeOwned + Send + 'static>(
        &self,
        call: Call<T>,
    ) -> impl Future<Output = Result<T, String>> + 'static {
        let sent = fetch_of(&call).map(|fetch| self.fetch(Fetch { bytes: true, ..fetch }));
        let cx = self.clone();
        async move {
            let Value::String(text) = sent?.await? else { return Err("the reply is not bytes".to_owned()) };
            cx.blocking(move || {
                let bytes = crate::base64::decode(&text).ok_or("the reply is not base64")?;
                if call.reply == Reply::Binary {
                    return serde_json::from_value(Value::from(bytes)).map_err(|error| error.to_string());
                }
                if bytes.is_empty() {
                    return call.decode(Value::Null);
                }
                call.decode(serde_json::from_slice(&bytes).map_err(|error| format!("MalformedResponse: {error}"))?)
            })
            .await
        }
    }

    /// Sends `call` and waits for its answer, reading only whether it succeeded: for a request whose output the plugin
    /// does not use, as TS awaits `client.session.prompt(…)` and drops its value. Unlike [`Cx::call`], a reply of
    /// another shape than the operation's output is no error.
    pub fn send<T>(&self, call: Call<T>) -> impl Future<Output = Result<(), String>> + 'static {
        let sent = fetch_of(&call).map(|fetch| self.fetch(fetch));
        async move { sent?.await.map(drop) }
    }
}

/// The output of `call` from the reply `body` of its [`Fetch`]: the JSON body, its `data`, or the bytes of a call that
/// answers with bytes (the body is their base64).
fn decode<T: DeserializeOwned>(call: &Call<T>, body: Value) -> Result<T, String> {
    if call.reply != Reply::Binary {
        return call.decode(body);
    }
    let Value::String(text) = body else { return Err("the reply is not bytes".to_owned()) };
    let bytes = crate::base64::decode(&text).ok_or("the reply is not base64")?;
    serde_json::from_value(Value::from(bytes)).map_err(|error| error.to_string())
}
