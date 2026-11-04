//! Client MCP socket (E.13b, row A05): a port of `packages/client/src/mcp.ts`.
//!
//! The client serves tools to the opencode server: it opens a WebSocket to `/api/experimental/client-mcp` and
//! answers MCP JSON-RPC over it, one message per text frame, so the server is the MCP client. [`connect`] keeps the
//! socket open and reconnects with backoff until the [`Connection`] closes or drops.

use std::sync::Arc;
use std::time::Duration;

use futures_util::stream::FuturesUnordered;
use futures_util::{SinkExt, StreamExt};
use serde_json::{Map, Value, json};
use tokio::sync::{mpsc, oneshot};
use url::Url;

use crate::pty::{BoxFuture, Incoming, QUEUE};
use crate::ws;

const SESSION_ID_META_KEY: &str = "ai.opencode/sessionID";
pub const PROTOCOL_VERSION: &str = "2025-11-25";
pub const RECONNECT_MIN: Duration = Duration::from_millis(500);
pub const RECONNECT_MAX: Duration = Duration::from_secs(10);

/// `connectClientMcp`'s options.
#[derive(Clone)]
pub struct Options {
    /// The opencode server's base URL. Its query is kept.
    pub url: Url,
    /// `[a-zA-Z0-9_-]+`. The model sees the tools as `<name>_<tool>`.
    pub name: String,
    /// Sent as `location[directory]`.
    pub directory: Option<String>,
    /// Handshake headers, such as `authorization`.
    pub headers: Vec<(String, String)>,
    pub tools: Vec<Tool>,
}

/// Runs a tool with its arguments; an `Err` becomes an `isError` result with the message.
pub type Handler =
    Arc<dyn Fn(Map<String, Value>, Context) -> BoxFuture<Result<ToolResult, String>> + Send + Sync>;

#[derive(Clone)]
pub struct Tool {
    pub name: String,
    pub description: Option<String>,
    /// JSON Schema of the arguments; `type: "object"` is always set. Arguments are not validated.
    pub input_schema: Map<String, Value>,
    pub handler: Handler,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Context {
    /// The opencode session that called the tool.
    pub session_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Content {
    Text(String),
    Image { data: String, mime_type: String },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ToolResult {
    pub content: Vec<Content>,
    pub is_error: bool,
}

impl ToolResult {
    pub fn text(text: impl Into<String>) -> Self {
        Self {
            content: vec![Content::Text(text.into())],
            is_error: false,
        }
    }

    pub fn error(text: impl Into<String>) -> Self {
        Self {
            is_error: true,
            ..Self::text(text)
        }
    }

    fn to_value(&self) -> Value {
        let content = self
            .content
            .iter()
            .map(|content| match content {
                Content::Text(text) => json!({ "type": "text", "text": text }),
                Content::Image { data, mime_type } => {
                    json!({ "type": "image", "data": data, "mimeType": mime_type })
                }
            })
            .collect::<Vec<_>>();
        let mut value = json!({ "content": content });
        if self.is_error {
            value["isError"] = json!(true);
        }
        value
    }
}

/// An open socket as two bounded queues of text frames. Dropping `outgoing` closes it with code 1000.
pub struct Socket {
    pub outgoing: mpsc::Sender<String>,
    pub incoming: mpsc::Receiver<Incoming>,
}

/// The far end of [`pair`], for fake servers in tests.
pub struct Remote {
    pub sent: mpsc::Receiver<String>,
    pub deliver: mpsc::Sender<Incoming>,
}

/// A connected socket and its far end, joined by queues.
pub fn pair() -> (Socket, Remote) {
    let (outgoing, sent) = mpsc::channel(QUEUE);
    let (deliver, incoming) = mpsc::channel(QUEUE);
    (Socket { outgoing, incoming }, Remote { sent, deliver })
}

/// Opens sockets with handshake headers: [`Tungstenite`] on the network, a closure in tests.
pub trait Connector: Send + Sync {
    fn open(&self, url: Url, headers: Vec<(String, String)>) -> BoxFuture<Result<Socket, String>>;
}

impl<F> Connector for F
where
    F: Fn(Url, Vec<(String, String)>) -> Result<Socket, String> + Send + Sync,
{
    fn open(&self, url: Url, headers: Vec<(String, String)>) -> BoxFuture<Result<Socket, String>> {
        let result = self(url, headers);
        Box::pin(async move { result })
    }
}

/// Opens the socket with tokio-tungstenite; two tasks move frames between it and the queues.
pub struct Tungstenite;

impl Connector for Tungstenite {
    fn open(&self, url: Url, headers: Vec<(String, String)>) -> BoxFuture<Result<Socket, String>> {
        Box::pin(async move {
            let socket = ws::connect(&url, &headers)
                .await
                .map_err(|error| error.to_string())?;
            let (mut sink, mut stream) = socket.split();
            let (socket, mut remote) = pair();
            let deliver = remote.deliver.clone();
            tokio::spawn(async move {
                while let Some(message) = stream.next().await {
                    let incoming = match message {
                        Ok(ws::Message::Text(text)) => Incoming::Text(text.as_str().to_owned()),
                        Ok(ws::Message::Binary(data)) => Incoming::Binary(data.to_vec()),
                        Ok(ws::Message::Close(_)) => break,
                        Ok(_) => continue,
                        Err(error) => {
                            let _ = deliver.send(Incoming::Failed(error.to_string())).await;
                            return;
                        }
                    };
                    if deliver.send(incoming).await.is_err() {
                        return;
                    }
                }
                let _ = deliver.send(Incoming::Closed).await;
            });
            tokio::spawn(async move {
                while let Some(text) = remote.sent.recv().await {
                    if sink.send(ws::Message::text(text)).await.is_err() {
                        return;
                    }
                }
                let close = tokio_tungstenite::tungstenite::protocol::CloseFrame {
                    code:
                        tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode::Normal,
                    reason: "".into(),
                };
                let _ = sink.send(ws::Message::Close(Some(close))).await;
                let _ = sink.close().await;
            });
            Ok(socket)
        })
    }
}

/// The socket URL: `location[directory]` and `name` set on the base URL's query.
pub fn endpoint(options: &Options) -> Url {
    let mut query = Vec::new();
    if let Some(directory) = options.directory.as_deref().filter(|dir| !dir.is_empty()) {
        query.push(("location[directory]", directory));
    }
    query.push(("name", options.name.as_str()));
    ws::url(&options.url, "api/experimental/client-mcp", &query)
}

/// A running connection. [`Connection::close`] or dropping it closes the socket and cancels a pending reconnect.
pub struct Connection {
    stop: Option<oneshot::Sender<()>>,
}

impl Connection {
    pub fn close(mut self) {
        self.stop.take();
    }
}

impl Drop for Connection {
    fn drop(&mut self) {
        self.stop.take();
    }
}

/// `connectClientMcp`: opens the socket on the current tokio runtime and answers the server until closed.
pub fn connect(options: Options, connector: Arc<dyn Connector>) -> Connection {
    let (stop, mut stopped) = oneshot::channel::<()>();
    tokio::spawn(async move {
        let url = endpoint(&options);
        let mut delay = RECONNECT_MIN;
        loop {
            let opened = tokio::select! {
                _ = &mut stopped => return,
                opened = connector.open(url.clone(), options.headers.clone()) => opened,
            };
            match opened {
                Ok(socket) => {
                    if serve(&options, socket, &mut delay, &mut stopped).await {
                        return;
                    }
                }
                Err(error) => log::debug!("client MCP connection failed: {error}"),
            }
            tokio::select! {
                _ = &mut stopped => return,
                _ = tokio::time::sleep(delay) => {}
            }
            delay = (delay * 2).min(RECONNECT_MAX);
        }
    });
    Connection { stop: Some(stop) }
}

/// Answers requests on one socket until it ends (false) or the connection stops (true). Replies go out in the order
/// their handlers finish, as in TS.
async fn serve(
    options: &Options,
    mut socket: Socket,
    delay: &mut Duration,
    stopped: &mut oneshot::Receiver<()>,
) -> bool {
    let mut pending = FuturesUnordered::new();
    loop {
        tokio::select! {
            _ = &mut *stopped => return true,
            Some(reply) = pending.next(), if !pending.is_empty() => {
                if socket.outgoing.send(reply).await.is_err() {
                    return false;
                }
            }
            incoming = socket.incoming.recv() => {
                let text = match incoming {
                    Some(Incoming::Text(text)) => text,
                    Some(Incoming::Binary(_)) => continue,
                    Some(Incoming::Closed | Incoming::Failed(_)) | None => return false,
                };
                let Some(message) = parse(&text) else { continue };
                let method = message.get("method").and_then(Value::as_str);
                // Reset backoff only once the opencode server finished initializing, so a failed attach keeps
                // backing off.
                if method == Some("notifications/initialized") {
                    *delay = RECONNECT_MIN;
                }
                // Notifications and responses need no reply.
                let id = match message.get("id") {
                    Some(id @ (Value::String(_) | Value::Number(_))) => id.clone(),
                    _ => continue,
                };
                let Some(method) = method.map(str::to_owned) else { continue };
                let params = message.get("params").cloned().unwrap_or(Value::Null);
                let options = options.clone();
                pending.push(async move {
                    let mut reply = Map::from_iter([("jsonrpc".to_owned(), json!("2.0")), ("id".to_owned(), id)]);
                    reply.extend(respond(&options, &method, &params).await);
                    Value::Object(reply).to_string()
                });
            }
        }
    }
}

/// The `result` or `error` member of the reply to `method`.
pub async fn respond(options: &Options, method: &str, params: &Value) -> Map<String, Value> {
    let result = |value: Value| Map::from_iter([("result".to_owned(), value)]);
    let error = |code: i64, message: String| {
        Map::from_iter([(
            "error".to_owned(),
            json!({ "code": code, "message": message }),
        )])
    };
    match method {
        "initialize" => result(json!({
            // The opencode server only offers versions it supports, so echo its choice.
            "protocolVersion": params
                .get("protocolVersion")
                .and_then(Value::as_str)
                .unwrap_or(PROTOCOL_VERSION),
            "capabilities": { "tools": {} },
            "serverInfo": { "name": options.name, "version": "1.0.0" },
        })),
        "ping" => result(json!({})),
        "tools/list" => result(json!({
            "tools": options.tools.iter().map(|tool| {
                let mut schema = Map::from_iter([("type".to_owned(), json!("object"))]);
                schema.extend(tool.input_schema.clone());
                let mut entry = Map::from_iter([("name".to_owned(), json!(tool.name))]);
                if let Some(description) = &tool.description {
                    entry.insert("description".to_owned(), json!(description));
                }
                entry.insert("inputSchema".to_owned(), Value::Object(schema));
                Value::Object(entry)
            }).collect::<Vec<_>>(),
        })),
        "tools/call" => {
            let name = params.get("name");
            let Some(tool) = options
                .tools
                .iter()
                .find(|tool| name.and_then(Value::as_str) == Some(tool.name.as_str()))
            else {
                let name = match name {
                    Some(Value::String(name)) => name.clone(),
                    None => "undefined".to_owned(),
                    Some(other) => other.to_string(),
                };
                return error(-32602, format!("Unknown tool: {name}"));
            };
            let arguments = params
                .get("arguments")
                .and_then(Value::as_object)
                .cloned()
                .unwrap_or_default();
            let context = Context {
                session_id: params
                    .get("_meta")
                    .and_then(|meta| meta.get(SESSION_ID_META_KEY))
                    .and_then(Value::as_str)
                    .map(str::to_owned),
            };
            let outcome = (tool.handler)(arguments, context)
                .await
                .unwrap_or_else(ToolResult::error);
            result(outcome.to_value())
        }
        _ => error(-32601, format!("Method not found: {method}")),
    }
}

fn parse(text: &str) -> Option<Map<String, Value>> {
    match serde_json::from_str(text).ok()? {
        Value::Object(object) => Some(object),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tokio::net::TcpListener;
    use tokio_tungstenite::tungstenite::handshake::server::{Request, Response};

    fn tool(
        name: &str,
        handler: impl Fn(Map<String, Value>, Context) -> Result<ToolResult, String>
        + Send
        + Sync
        + 'static,
    ) -> Tool {
        let handler = Arc::new(handler);
        Tool {
            name: name.into(),
            description: None,
            input_schema: Map::new(),
            handler: Arc::new(move |args, context| {
                let result = handler(args, context);
                Box::pin(async move { result })
            }),
        }
    }

    /// One accepted socket on the server side, with the handshake request's URI and `authorization` header.
    struct Peer {
        uri: String,
        authorization: Option<String>,
        socket: tokio_tungstenite::WebSocketStream<tokio::net::TcpStream>,
        next: i64,
    }

    impl Peer {
        async fn accept(listener: &TcpListener) -> Self {
            let (stream, _) = listener.accept().await.unwrap();
            let seen = Arc::new(Mutex::new((String::new(), None)));
            let record = seen.clone();
            #[allow(clippy::result_large_err)]
            let callback = move |request: &Request, response: Response| {
                *record.lock().unwrap() = (
                    request.uri().to_string(),
                    request
                        .headers()
                        .get("authorization")
                        .map(|value| value.to_str().unwrap().to_owned()),
                );
                Ok(response)
            };
            let socket = tokio_tungstenite::accept_hdr_async(stream, callback)
                .await
                .unwrap();
            let (uri, authorization) = seen.lock().unwrap().clone();
            Self {
                uri,
                authorization,
                socket,
                next: 0,
            }
        }

        async fn send(&mut self, value: Value) {
            self.socket
                .send(ws::Message::text(value.to_string()))
                .await
                .unwrap();
        }

        /// Sends a request and returns the reply with the same ID.
        async fn request(&mut self, method: &str, params: Value) -> Value {
            self.next += 1;
            let id = self.next;
            self.send(json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }))
                .await;
            loop {
                match self.socket.next().await.unwrap().unwrap() {
                    ws::Message::Text(text) => {
                        let reply: Value = serde_json::from_str(text.as_str()).unwrap();
                        if reply["id"] == json!(id) {
                            assert_eq!(reply["jsonrpc"], "2.0");
                            return reply;
                        }
                    }
                    _ => continue,
                }
            }
        }

        /// The MCP client handshake: `initialize`, then `notifications/initialized`.
        async fn initialize(&mut self) -> Value {
            let reply = self
                .request(
                    "initialize",
                    json!({ "protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": { "name": "opencode", "version": "1.0.0" } }),
                )
                .await;
            self.send(json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }))
                .await;
            reply
        }

        async fn call(&mut self, params: Value) -> Value {
            self.request("tools/call", params).await
        }
    }

    async fn listen() -> (TcpListener, Url) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = Url::parse(&format!("http://{}/", listener.local_addr().unwrap())).unwrap();
        (listener, url)
    }

    #[tokio::test]
    async fn serves_registered_tools_to_the_opencode_server() {
        let (listener, base) = listen().await;
        let mut url = base.clone();
        url.set_query(Some("ticket=t1"));
        let connection = connect(
            Options {
                url,
                name: "tui".into(),
                directory: Some("/repo".into()),
                headers: vec![("authorization".into(), "Basic secret".into())],
                tools: vec![
                    Tool {
                        description: Some("Return the calling session".into()),
                        ..tool("whoami", |_, context| {
                            Ok(ToolResult::text(context.session_id.unwrap_or("none".into())))
                        })
                    },
                    Tool {
                        input_schema: json!({ "properties": { "text": { "type": "string" } }, "required": ["text"] })
                            .as_object()
                            .unwrap()
                            .clone(),
                        ..tool("echo", |args, _| {
                            Ok(ToolResult::text(args["text"].as_str().unwrap_or_default()))
                        })
                    },
                    tool("fail", |_, _| Err("boom".into())),
                ],
            },
            Arc::new(Tungstenite),
        );
        let mut peer = Peer::accept(&listener).await;
        let uri = Url::parse(&format!("http://host{}", peer.uri)).unwrap();
        assert_eq!(uri.path(), "/api/experimental/client-mcp");
        let query: Vec<(String, String)> = uri.query_pairs().into_owned().collect();
        assert_eq!(
            query,
            [
                ("ticket".into(), "t1".into()),
                ("location[directory]".into(), "/repo".into()),
                ("name".into(), "tui".into())
            ]
        );
        assert_eq!(peer.authorization.as_deref(), Some("Basic secret"));

        let initialized = peer.initialize().await;
        assert_eq!(
            initialized["result"],
            json!({ "protocolVersion": "2025-06-18", "capabilities": { "tools": {} }, "serverInfo": { "name": "tui", "version": "1.0.0" } })
        );
        assert_eq!(peer.request("ping", json!({})).await["result"], json!({}));
        assert_eq!(
            peer.request("tools/list", json!({})).await["result"]["tools"],
            json!([
                { "name": "whoami", "description": "Return the calling session", "inputSchema": { "type": "object" } },
                { "name": "echo", "inputSchema": { "type": "object", "properties": { "text": { "type": "string" } }, "required": ["text"] } },
                { "name": "fail", "inputSchema": { "type": "object" } },
            ])
        );
        assert_eq!(
            peer.call(json!({ "name": "whoami", "arguments": {}, "_meta": { "ai.opencode/sessionID": "ses_1" } }))
                .await["result"],
            json!({ "content": [{ "type": "text", "text": "ses_1" }] })
        );
        assert_eq!(
            peer.call(json!({ "name": "whoami", "arguments": {} }))
                .await["result"],
            json!({ "content": [{ "type": "text", "text": "none" }] })
        );
        assert_eq!(
            peer.call(json!({ "name": "echo", "arguments": { "text": "hi" } }))
                .await["result"],
            json!({ "content": [{ "type": "text", "text": "hi" }] })
        );
        assert_eq!(
            peer.call(json!({ "name": "fail", "arguments": {} })).await["result"],
            json!({ "content": [{ "type": "text", "text": "boom" }], "isError": true })
        );
        assert_eq!(
            peer.call(json!({ "name": "missing", "arguments": {} }))
                .await["error"],
            json!({ "code": -32602, "message": "Unknown tool: missing" })
        );
        assert_eq!(
            peer.request("resources/list", json!({})).await["error"],
            json!({ "code": -32601, "message": "Method not found: resources/list" })
        );

        connection.close();
        match peer.socket.next().await {
            Some(Ok(ws::Message::Close(Some(frame)))) => assert_eq!(u16::from(frame.code), 1000),
            other => panic!("expected a close frame, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn reconnects_after_the_server_drops_the_socket() {
        let (listener, url) = listen().await;
        let _connection = connect(
            Options {
                url,
                name: "tui".into(),
                directory: None,
                headers: Vec::new(),
                tools: vec![tool("ping", |_, _| Ok(ToolResult::text("pong")))],
            },
            Arc::new(Tungstenite),
        );
        let mut first = Peer::accept(&listener).await;
        assert!(!first.uri.contains("location"));
        first.initialize().await;
        let tools = first.request("tools/list", json!({})).await;
        assert_eq!(tools["result"]["tools"].as_array().unwrap().len(), 1);

        first
            .socket
            .close(Some(tokio_tungstenite::tungstenite::protocol::CloseFrame {
                code: 1011.into(),
                reason: "internal".into(),
            }))
            .await
            .unwrap();
        let mut second = Peer::accept(&listener).await;
        assert_eq!(
            second
                .call(json!({ "name": "ping", "arguments": {} }))
                .await["result"],
            json!({ "content": [{ "type": "text", "text": "pong" }] })
        );
    }

    /// A connector that counts the sockets it opened and hands their far ends to the test.
    fn tracked() -> (
        Arc<dyn Connector>,
        Arc<AtomicUsize>,
        mpsc::UnboundedReceiver<Remote>,
    ) {
        let opened = Arc::new(AtomicUsize::new(0));
        let (remotes, receiver) = mpsc::unbounded_channel();
        let count = opened.clone();
        let connector = move |_: Url, _: Vec<(String, String)>| {
            count.fetch_add(1, Ordering::SeqCst);
            let (socket, remote) = pair();
            let _ = remotes.send(remote);
            Ok(socket)
        };
        (Arc::new(connector), opened, receiver)
    }

    fn quiet() -> Options {
        Options {
            url: Url::parse("http://opencode.local").unwrap(),
            name: "tui".into(),
            directory: None,
            headers: Vec::new(),
            tools: Vec::new(),
        }
    }

    /// Lets the connection task run until it waits on a timer or a queue.
    async fn settle() {
        for _ in 0..10 {
            tokio::task::yield_now().await;
        }
    }

    #[tokio::test(start_paused = true)]
    async fn close_cancels_a_pending_reconnect() {
        let (connector, opened, mut remotes) = tracked();
        let connection = connect(quiet(), connector);
        let remote = remotes.recv().await.unwrap();
        remote.deliver.send(Incoming::Closed).await.unwrap();
        settle().await;
        connection.close();
        tokio::time::advance(Duration::from_secs(10)).await;
        settle().await;
        assert_eq!(opened.load(Ordering::SeqCst), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn keeps_backing_off_while_the_opencode_server_never_initializes() {
        let (connector, opened, mut remotes) = tracked();
        let _connection = connect(quiet(), connector);
        let drop_socket = async |remotes: &mut mpsc::UnboundedReceiver<Remote>| {
            let remote = remotes.recv().await.unwrap();
            remote
                .deliver
                .send(Incoming::Text("not json".into()))
                .await
                .unwrap();
            remote.deliver.send(Incoming::Closed).await.unwrap();
            settle().await;
        };
        drop_socket(&mut remotes).await;
        assert_eq!(opened.load(Ordering::SeqCst), 1);
        tokio::time::advance(Duration::from_millis(500)).await;
        settle().await;
        assert_eq!(opened.load(Ordering::SeqCst), 2);
        drop_socket(&mut remotes).await;
        tokio::time::advance(Duration::from_millis(999)).await;
        settle().await;
        assert_eq!(opened.load(Ordering::SeqCst), 2);
        tokio::time::advance(Duration::from_millis(1)).await;
        settle().await;
        assert_eq!(opened.load(Ordering::SeqCst), 3);
    }

    #[tokio::test(start_paused = true)]
    async fn the_initialized_notification_resets_the_backoff() {
        let (connector, opened, mut remotes) = tracked();
        let _connection = connect(quiet(), connector);
        for expected in [2, 3] {
            let remote = remotes.recv().await.unwrap();
            remote.deliver.send(Incoming::Closed).await.unwrap();
            settle().await;
            tokio::time::advance(Duration::from_millis(500) * (expected - 1)).await;
            settle().await;
            assert_eq!(opened.load(Ordering::SeqCst), expected as usize);
        }
        let remote = remotes.recv().await.unwrap();
        remote
            .deliver
            .send(Incoming::Text(
                json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }).to_string(),
            ))
            .await
            .unwrap();
        remote.deliver.send(Incoming::Closed).await.unwrap();
        settle().await;
        tokio::time::advance(Duration::from_millis(500)).await;
        settle().await;
        assert_eq!(opened.load(Ordering::SeqCst), 4);
    }
}
