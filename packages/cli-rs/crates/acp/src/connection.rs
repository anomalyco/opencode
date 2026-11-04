//! JSON-RPC over newline-delimited JSON (`packages/cli/src/acp/connection.ts`, and the parts of the ACP
//! SDK's `ndJsonStream` and `Connection` the agent relies on).
//!
//! The reader runs each message's synchronous part inline, so a `session/cancel` that follows a
//! `session/prompt` always finds the turn the prompt registered. Responses and notifications go through
//! one writer queue, so they reach the client in the order they were sent.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use futures_util::future::BoxFuture;
use serde_json::{Map, Value, json};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::sync::{mpsc, oneshot};
use tokio_util::sync::CancellationToken;

use crate::error::{Failure, RpcError};

/// The SDK's default limit for one incoming message (`DEFAULT_MAX_MESSAGE_BYTES`).
pub const MAX_MESSAGE_BYTES: usize = 32 * 1024 * 1024;

const CANCEL_REQUEST: &str = "$/cancel_request";

/// Why the connection closed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Closed {
    /// The client closed its end (stdin EOF).
    Eof,
    /// One incoming line exceeded [`MAX_MESSAGE_BYTES`].
    TooLarge(usize),
    Read(String),
    Write(String),
}

/// What the agent does with incoming messages. Both methods run on the reader; a request returns the
/// rest of its work as a future, which runs as its own task.
pub trait Handler: Send + Sync + 'static {
    /// `None` when the method is unknown.
    fn request(
        &self,
        method: &str,
        params: Value,
        context: RequestContext,
    ) -> Option<BoxFuture<'static, Result<Value, RpcError>>>;

    /// Unknown notifications are ignored.
    fn notification(&self, method: &str, params: Value);
}

/// Per-request state a handler may use.
pub struct RequestContext {
    /// Cancelled by `$/cancel_request` for this request and when the connection closes.
    pub cancel: CancellationToken,
    pub responded: Responded,
}

/// Resolves once this request's response is written (`ACPConnection.Responded`): `true` for a result,
/// `false` for an error. A notification has no response and resolves at once.
pub struct Responded(Option<oneshot::Receiver<bool>>);

impl Responded {
    pub fn immediate() -> Self {
        Self(None)
    }

    pub async fn wait(self) -> bool {
        match self.0 {
            None => true,
            Some(receiver) => receiver.await.unwrap_or(false),
        }
    }
}

struct Outgoing {
    message: Value,
    response_to: Option<(String, bool)>,
}

/// The agent's side of the connection. Cheap to clone.
#[derive(Clone)]
pub struct Connection {
    inner: Arc<Inner>,
}

struct Inner {
    out: mpsc::UnboundedSender<Outgoing>,
    pending: Mutex<HashMap<String, oneshot::Sender<Result<Value, RpcError>>>>,
    responded: Mutex<HashMap<String, oneshot::Sender<bool>>>,
    incoming: Mutex<HashMap<String, CancellationToken>>,
    next_id: AtomicU64,
    closed: CancellationToken,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn key(id: &Value) -> String {
    id.to_string()
}

/// The writer half of a connection that [`run`] drives.
pub struct Writer(mpsc::UnboundedReceiver<Outgoing>);

impl Connection {
    pub fn new() -> (Self, Writer) {
        let (out, receiver) = mpsc::unbounded_channel();
        let connection = Self {
            inner: Arc::new(Inner {
                out,
                pending: Mutex::default(),
                responded: Mutex::default(),
                incoming: Mutex::default(),
                next_id: AtomicU64::new(0),
                closed: CancellationToken::new(),
            }),
        };
        (connection, Writer(receiver))
    }

    /// Cancelled when the connection closes.
    pub fn closed(&self) -> CancellationToken {
        self.inner.closed.clone()
    }

    fn send(&self, message: Value, response_to: Option<(String, bool)>) -> Result<(), Failure> {
        if self.inner.closed.is_cancelled() {
            return Err(closed_failure());
        }
        self.inner
            .out
            .send(Outgoing {
                message,
                response_to,
            })
            .map_err(|_| closed_failure())
    }

    pub fn notify(&self, method: &str, params: Value) -> Result<(), Failure> {
        self.send(
            json!({ "jsonrpc": "2.0", "method": method, "params": params }),
            None,
        )
    }

    /// `session/update`.
    pub fn session_update(&self, session_id: &str, update: Value) -> Result<(), Failure> {
        self.notify(
            "session/update",
            json!({ "sessionId": session_id, "update": update }),
        )
    }

    /// Sends a request to the client. Dropping the future before the answer sends
    /// `$/cancel_request`, as an aborted `cancellationSignal` does.
    pub async fn request(&self, method: &str, params: Value) -> Result<Value, Failure> {
        let id = self.inner.next_id.fetch_add(1, Ordering::Relaxed);
        let id_key = key(&json!(id));
        let (sender, receiver) = oneshot::channel();
        lock(&self.inner.pending).insert(id_key.clone(), sender);
        let guard = CancelGuard {
            connection: self.clone(),
            id,
            key: id_key,
            done: false,
        };
        self.send(
            json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }),
            None,
        )?;
        let mut guard = guard;
        let result = tokio::select! {
            result = receiver => result,
            () = self.inner.closed.cancelled() => {
                guard.done = true;
                return Err(closed_failure());
            }
        };
        guard.done = true;
        match result {
            Ok(Ok(value)) => Ok(value),
            Ok(Err(error)) => Err(Failure::Rpc(error)),
            Err(_) => Err(closed_failure()),
        }
    }

    fn respond(&self, id: &Value, result: Result<Value, RpcError>) {
        let ok = result.is_ok();
        let message = match result {
            Ok(value) => json!({ "jsonrpc": "2.0", "id": id, "result": value }),
            Err(error) => json!({ "jsonrpc": "2.0", "id": id, "error": error.to_json() }),
        };
        lock(&self.inner.incoming).remove(&key(id));
        // A closed connection drops the response, as the SDK does.
        let _ = self.send(message, Some((key(id), ok)));
    }

    fn protocol_error(&self, error: &RpcError) {
        let _ = self.send(
            json!({ "jsonrpc": "2.0", "id": null, "error": error.to_json() }),
            None,
        );
    }

    fn close(&self) {
        if self.inner.closed.is_cancelled() {
            return;
        }
        self.inner.closed.cancel();
        lock(&self.inner.pending).clear();
        for (_, token) in lock(&self.inner.incoming).drain() {
            token.cancel();
        }
    }

    fn receive(&self, handler: &Arc<dyn Handler>, message: Value) {
        if let Value::Array(batch) = message {
            // Batches are answered message by message (deviation: the SDK answers with one batch).
            if batch.is_empty() {
                self.protocol_error(&RpcError::invalid_request(Value::Array(batch)));
                return;
            }
            for message in batch {
                self.receive(handler, message);
            }
            return;
        }
        let Value::Object(object) = &message else {
            self.protocol_error(&RpcError::invalid_request(message));
            return;
        };
        let method = object.get("method").and_then(Value::as_str);
        let envelope = object.get("jsonrpc").and_then(Value::as_str) == Some("2.0");
        let id = object.get("id");
        let valid_id = id.is_some_and(|id| id.is_null() || id.is_string() || id.is_number());
        let is_request = envelope && method.is_some() && valid_id;
        let is_notification = envelope && method.is_some() && id.is_none();
        let response_shaped = !object.contains_key("method")
            && (object.contains_key("id")
                || object.contains_key("result")
                || object.contains_key("error"));
        if !is_request && !is_notification && !response_shaped {
            self.protocol_error(&RpcError::invalid_request(message.clone()));
            return;
        }
        let params = object.get("params").cloned().unwrap_or(Value::Null);
        if let Some(method) = method {
            let Some(id) = id else {
                if method == CANCEL_REQUEST {
                    self.cancel_incoming(&params);
                }
                handler.notification(method, params);
                return;
            };
            self.dispatch(handler, method, id.clone(), params);
            return;
        }
        if let Some(id) = id {
            self.answer(id, object);
            return;
        }
        log::warn!("ACP received an invalid message");
    }

    fn dispatch(&self, handler: &Arc<dyn Handler>, method: &str, id: Value, params: Value) {
        let cancel = self.inner.closed.child_token();
        lock(&self.inner.incoming).insert(key(&id), cancel.clone());
        let (sender, receiver) = oneshot::channel();
        lock(&self.inner.responded).insert(key(&id), sender);
        let context = RequestContext {
            cancel,
            responded: Responded(Some(receiver)),
        };
        let Some(work) = handler.request(method, params, context) else {
            self.respond(&id, Err(RpcError::method_not_found(method)));
            return;
        };
        let connection = self.clone();
        tokio::spawn(async move {
            let result = work.await;
            connection.respond(&id, result);
        });
    }

    fn cancel_incoming(&self, params: &Value) {
        let Some(id) = params
            .get("requestId")
            .filter(|id| id.is_null() || id.is_string() || id.is_number())
        else {
            return;
        };
        if let Some(token) = lock(&self.inner.incoming).get(&key(id)) {
            token.cancel();
        }
    }

    fn answer(&self, id: &Value, object: &Map<String, Value>) {
        let Some(pending) = lock(&self.inner.pending).remove(&key(id)) else {
            log::warn!(id = id.to_string().as_str(); "Got response to unknown request");
            return;
        };
        let error = object.get("error");
        let has_result = object.contains_key("result");
        let valid_error = error.is_some_and(|error| {
            error.get("code").is_some_and(Value::is_i64)
                && error.get("message").is_some_and(Value::is_string)
        });
        let result = match (has_result, error) {
            (true, None) => Ok(object.get("result").cloned().unwrap_or(Value::Null)),
            (false, Some(error)) if valid_error => Err(RpcError::new(
                error
                    .get("code")
                    .and_then(Value::as_i64)
                    .unwrap_or_default(),
                error
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
                error.get("data").cloned(),
            )),
            _ => Err(RpcError::invalid_request(Value::Object(object.clone()))),
        };
        let _ = pending.send(result);
    }
}

fn closed_failure() -> Failure {
    Failure::Defect {
        name: Some("Error".to_owned()),
        detail: "ACP connection closed".to_owned(),
    }
}

struct CancelGuard {
    connection: Connection,
    id: u64,
    key: String,
    done: bool,
}

impl Drop for CancelGuard {
    fn drop(&mut self) {
        if self.done {
            return;
        }
        lock(&self.connection.inner.pending).remove(&self.key);
        let _ = self
            .connection
            .notify(CANCEL_REQUEST, json!({ "requestId": self.id }));
    }
}

/// Reads messages from `reader` and writes queued messages to `writer` until either side ends.
pub async fn run<R, W>(
    connection: Connection,
    writer: Writer,
    reader: R,
    output: W,
    handler: Arc<dyn Handler>,
) -> Closed
where
    R: AsyncRead + Unpin + Send + 'static,
    W: AsyncWrite + Unpin + Send + 'static,
{
    let (closed_sender, mut closed_receiver) = mpsc::unbounded_channel::<Closed>();
    let write = tokio::spawn(write_loop(
        connection.clone(),
        writer,
        output,
        closed_sender.clone(),
    ));
    let read = tokio::spawn(read_loop(
        connection.clone(),
        reader,
        handler,
        closed_sender,
    ));
    let reason = closed_receiver.recv().await.unwrap_or(Closed::Eof);
    connection.close();
    read.abort();
    write.abort();
    reason
}

async fn write_loop<W: AsyncWrite + Unpin>(
    connection: Connection,
    mut writer: Writer,
    mut output: W,
    closed: mpsc::UnboundedSender<Closed>,
) {
    while let Some(outgoing) = writer.0.recv().await {
        let mut line = outgoing.message.to_string();
        line.push('\n');
        let written = async {
            output.write_all(line.as_bytes()).await?;
            output.flush().await
        }
        .await;
        if let Err(error) = written {
            let _ = closed.send(Closed::Write(error.to_string()));
            return;
        }
        if let Some((id, ok)) = outgoing.response_to
            && let Some(sender) = lock(&connection.inner.responded).remove(&id)
        {
            let _ = sender.send(ok);
        }
    }
}

async fn read_loop<R: AsyncRead + Unpin>(
    connection: Connection,
    mut reader: R,
    handler: Arc<dyn Handler>,
    closed: mpsc::UnboundedSender<Closed>,
) {
    let mut pending: Vec<u8> = Vec::new();
    let mut chunk = vec![0_u8; 64 * 1024];
    loop {
        let read = match reader.read(&mut chunk).await {
            Ok(read) => read,
            Err(error) => {
                let _ = closed.send(Closed::Read(error.to_string()));
                return;
            }
        };
        if read == 0 {
            if !pending.is_empty() {
                let line = std::mem::take(&mut pending);
                receive_line(&connection, &handler, strip_cr(&line));
            }
            let _ = closed.send(Closed::Eof);
            return;
        }
        let mut rest = &chunk[..read];
        while let Some(newline) = rest.iter().position(|byte| *byte == b'\n') {
            if line_length(&pending, &rest[..newline]) > MAX_MESSAGE_BYTES {
                let _ = closed.send(Closed::TooLarge(MAX_MESSAGE_BYTES));
                return;
            }
            pending.extend_from_slice(&rest[..newline]);
            let line = std::mem::take(&mut pending);
            receive_line(&connection, &handler, strip_cr(&line));
            rest = &rest[newline + 1..];
        }
        if line_length(&pending, rest) > MAX_MESSAGE_BYTES {
            let _ = closed.send(Closed::TooLarge(MAX_MESSAGE_BYTES));
            return;
        }
        pending.extend_from_slice(rest);
    }
}

/// The length a line would have, not counting a trailing carriage return (`LineBuffer.#checkLine`).
fn line_length(pending: &[u8], tail: &[u8]) -> usize {
    let last = tail.last().or(pending.last());
    pending.len() + tail.len() - usize::from(last == Some(&b'\r'))
}

fn strip_cr(line: &[u8]) -> &[u8] {
    line.strip_suffix(b"\r").unwrap_or(line)
}

fn receive_line(connection: &Connection, handler: &Arc<dyn Handler>, line: &[u8]) {
    let text = String::from_utf8_lossy(line);
    let text = text.trim();
    if text.is_empty() {
        return;
    }
    let Ok(message) = serde_json::from_str::<Value>(text) else {
        connection.protocol_error(&RpcError::parse_error());
        return;
    };
    if !message.is_object() && !message.is_array() {
        connection.protocol_error(&RpcError::invalid_request(message));
        return;
    }
    connection.receive(handler, message);
}
