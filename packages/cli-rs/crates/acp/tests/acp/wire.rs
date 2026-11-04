//! A fake OpenCode server and an in-process ACP client, ported from
//! `packages/cli/test/acp/wire-fixture.ts`. The server is a transport, so no socket is opened; the agent
//! runs over in-memory pipes.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use bytes::Bytes;
use futures_util::future::BoxFuture;
use opencode_api::client::Client;
use opencode_api::transport::{Request, Response, Transport};
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{Notify, mpsc, oneshot};
use tokio_util::sync::CancellationToken;

pub fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

// ---------------------------------------------------------------------------------------------------
// Events

fn durable(version: u64, kind: &str, data: Value) -> Value {
    json!({ "id": "", "created": 0, "type": kind, "durable": { "aggregateID": "test", "seq": 0, "version": version }, "data": data })
}

pub fn durable_event(kind: &str, data: Value) -> Value {
    durable(1, kind, data)
}

pub fn ephemeral_event(kind: &str, data: Value) -> Value {
    json!({ "id": "", "created": 0, "type": kind, "data": data })
}

pub fn delivered(session_id: &str, inbox_id: &str) -> Value {
    durable_event(
        "session.inbox.delivered",
        json!({ "sessionID": session_id, "inboxID": inbox_id }),
    )
}

pub fn succeeded(session_id: &str) -> Value {
    durable_event(
        "session.execution.succeeded",
        json!({ "sessionID": session_id }),
    )
}

pub fn interrupted(session_id: &str) -> Value {
    durable_event(
        "session.execution.interrupted",
        json!({ "sessionID": session_id, "reason": "user" }),
    )
}

pub fn failed(session_id: &str, error: Value) -> Value {
    durable_event(
        "session.execution.failed",
        json!({ "sessionID": session_id, "error": error }),
    )
}

pub fn turn(session_id: &str, inbox_id: &str, events: Vec<Value>) -> Vec<Value> {
    let mut all = vec![delivered(session_id, inbox_id)];
    all.extend(events);
    all.push(succeeded(session_id));
    all
}

pub fn text_delta(session_id: &str, message_id: &str, delta: &str, ordinal: u64) -> Value {
    ephemeral_event(
        "session.text.delta",
        json!({ "sessionID": session_id, "assistantMessageID": message_id, "ordinal": ordinal, "delta": delta }),
    )
}

pub fn reasoning_delta(session_id: &str, message_id: &str, delta: &str, ordinal: u64) -> Value {
    ephemeral_event(
        "session.reasoning.delta",
        json!({ "sessionID": session_id, "assistantMessageID": message_id, "ordinal": ordinal, "delta": delta }),
    )
}

pub fn tokens(value: u64) -> Value {
    json!({ "input": value, "output": value, "reasoning": 0, "cache": { "read": 0, "write": 0 } })
}

pub fn usage(input: u64, output: u64, reasoning: u64, read: u64, write: u64) -> Value {
    json!({ "input": input, "output": output, "reasoning": reasoning, "cache": { "read": read, "write": write } })
}

pub fn step_ended(session_id: &str, message_id: &str, finish: &str, tokens: Value) -> Value {
    durable_event(
        "session.step.ended",
        json!({ "sessionID": session_id, "assistantMessageID": message_id, "finish": finish, "cost": 0, "tokens": tokens }),
    )
}

pub fn child_created(session_id: &str, parent_id: &str, title: &str) -> Value {
    durable_event(
        "session.created",
        json!({
            "sessionID": session_id, "slug": session_id, "projectID": "project",
            "location": { "directory": "/workspace" }, "parentID": parent_id, "title": title, "version": "test",
        }),
    )
}

pub fn tool_started(session_id: &str, id: &str, name: &str) -> Value {
    durable_event(
        "session.tool.input.started",
        json!({ "sessionID": session_id, "assistantMessageID": "msg_tools", "id": id, "name": name }),
    )
}

pub fn tool_called(session_id: &str, id: &str, input: Value) -> Value {
    durable_event(
        "session.tool.called",
        json!({ "sessionID": session_id, "assistantMessageID": "msg_tools", "id": id, "input": input, "executed": false }),
    )
}

pub fn tool_progress(session_id: &str, id: &str, metadata: Value) -> Value {
    ephemeral_event(
        "session.tool.progress",
        json!({ "sessionID": session_id, "assistantMessageID": "msg_tools", "id": id, "metadata": metadata }),
    )
}

pub fn tool_succeeded(session_id: &str, id: &str, metadata: Value, text: &str) -> Value {
    durable(
        2,
        "session.tool.success",
        json!({
            "sessionID": session_id, "assistantMessageID": "msg_tools", "id": id, "metadata": metadata,
            "content": [{ "type": "text", "text": text }], "executed": true,
        }),
    )
}

pub fn tool_failed(session_id: &str, id: &str, input: Value) -> Value {
    let mut data = json!({ "sessionID": session_id, "assistantMessageID": "msg_tools", "id": id, "executed": true });
    if let (Some(data), Value::Object(input)) = (data.as_object_mut(), input) {
        data.extend(input);
    }
    durable(2, "session.tool.failed", data)
}

pub fn permission_asked(session_id: &str, id: &str, input: Value) -> Value {
    let mut data = json!({
        "id": id,
        "sessionID": session_id,
        "action": input.get("action").cloned().unwrap_or(json!("shell")),
        "resources": input.get("resources").cloned().unwrap_or(json!(["*"])),
        "metadata": input.get("metadata").cloned().unwrap_or(json!({ "command": "printf hello" })),
    });
    if let (Some(source), Some(data)) = (input.get("source"), data.as_object_mut()) {
        data.insert("source".to_owned(), source.clone());
    }
    ephemeral_event("permission.asked", data)
}

// ---------------------------------------------------------------------------------------------------
// Catalog fixtures

pub fn model(id: &str, name: &str, variants: &[&str], context: u64) -> Value {
    json!({
        "id": id, "modelID": id, "providerID": "test", "name": name,
        "capabilities": { "tools": true, "input": ["text"], "output": ["text"] },
        "variants": variants.iter().map(|id| json!({ "id": id })).collect::<Vec<_>>(),
        "time": { "released": 0 }, "cost": [], "status": "active", "enabled": true,
        "limit": { "context": context, "output": 10_000 },
    })
}

pub fn test_model() -> Value {
    model("test-model", "Test Model", &["default", "high"], 100_000)
}

pub fn second_model() -> Value {
    model("second-model", "Second Model", &["low", "medium"], 200_000)
}

fn agent(id: &str, name: &str, description: Option<&str>) -> Value {
    let mut agent = json!({
        "id": id, "name": name, "request": { "settings": {}, "headers": {}, "body": {} },
        "mode": "primary", "hidden": false, "permissions": [],
    });
    if let Some(description) = description {
        agent["description"] = json!(description);
    }
    agent
}

pub fn review_command() -> Value {
    json!({ "name": "review", "description": "Review changes" })
}

pub fn make_session(id: &str, cwd: &str) -> Value {
    json!({
        "id": id, "projectID": "global", "cost": 0, "tokens": tokens(0),
        "time": { "created": 0, "updated": 0 }, "title": format!("Session {id}"),
        "location": { "directory": cwd },
    })
}

// ---------------------------------------------------------------------------------------------------
// Server

/// Answers a `session/request_permission`.
pub type Answer = Arc<dyn Fn(&Value) -> Value + Send + Sync>;

pub type Hook<I> = Arc<dyn Fn(I) -> BoxFuture<'static, Vec<Value>> + Send + Sync>;

pub struct PromptCall {
    pub session_id: String,
    pub id: String,
    pub text: String,
    /// Prompts submitted so far, this one included.
    pub count: usize,
    /// Cancelled when the agent abandons the request.
    pub aborted: CancellationToken,
}

#[derive(Clone, Default)]
pub struct WireOptions {
    pub on_prompt: Option<Hook<PromptCall>>,
    pub on_interrupt: Option<Hook<String>>,
    pub on_form_cancel: Option<Hook<(String, String)>>,
    pub permission: Option<Answer>,
    pub drain_timeout: Option<Duration>,
}

#[derive(Default)]
pub struct State {
    pub sessions: indexmap::IndexMap<String, Value>,
    pub submissions: Vec<Value>,
    pub selections: Vec<Value>,
    pub interrupts: Vec<String>,
    pub replies: Vec<Value>,
    pub cancelled_forms: Vec<Value>,
    pub mcp: Vec<Value>,
    /// Method and path of every request.
    pub requests: Vec<(String, String)>,
    pub models: Vec<Value>,
    pub agents: Vec<Value>,
    pub commands: Vec<Value>,
}

impl State {
    pub fn prompts(&self) -> Vec<Value> {
        self.submissions
            .iter()
            .filter(|item| item["kind"] == "prompt")
            .cloned()
            .collect()
    }
}

pub struct Server {
    pub state: Mutex<State>,
    streams: Mutex<Vec<mpsc::UnboundedSender<Result<Bytes, String>>>>,
    events: AtomicU64,
    sessions: AtomicU64,
    stopped: AtomicBool,
    changed: Arc<Notify>,
    options: WireOptions,
}

impl Server {
    fn new(options: WireOptions, changed: Arc<Notify>) -> Arc<Self> {
        Arc::new(Self {
            state: Mutex::new(State {
                models: vec![test_model(), second_model()],
                agents: vec![
                    agent("build", "Build", None),
                    agent("plan", "Plan", Some("Plan first")),
                ],
                commands: vec![review_command()],
                ..State::default()
            }),
            streams: Mutex::default(),
            events: AtomicU64::new(0),
            sessions: AtomicU64::new(0),
            stopped: AtomicBool::new(false),
            changed,
            options,
        })
    }

    pub fn state(&self) -> MutexGuard<'_, State> {
        lock(&self.state)
    }

    /// Stamps ids and sequence numbers and sends `events` on every open event stream.
    pub fn send(&self, events: &[Value]) {
        for event in events {
            let seq = self.events.fetch_add(1, Ordering::SeqCst) + 1;
            let mut stamped = event.clone();
            stamped["id"] = json!(format!("evt_{seq}"));
            stamped["created"] = json!(seq);
            if let Some(durable) = stamped.get_mut("durable") {
                durable["seq"] = json!(seq);
            }
            let chunk = Bytes::from(format!("data: {stamped}\n\n"));
            lock(&self.streams).retain(|stream| stream.send(Ok(chunk.clone())).is_ok());
        }
    }

    /// Ends every open event stream while the server keeps answering requests.
    pub fn close_events(&self) {
        lock(&self.streams).clear();
    }

    /// Drops the connection of every open event stream.
    pub fn drop_events(&self) {
        for stream in lock(&self.streams).drain(..) {
            let _ = stream.send(Err("connection reset".to_owned()));
        }
    }

    pub fn stop(&self) {
        self.stopped.store(true, Ordering::SeqCst);
        self.close_events();
    }

    fn changed(&self) {
        self.changed.notify_waiters();
    }

    async fn handle(
        self: Arc<Self>,
        request: Request,
        aborted: CancellationToken,
    ) -> Result<Response, String> {
        if self.stopped.load(Ordering::SeqCst) {
            return Err("connection refused".to_owned());
        }
        let path = request.url.path().to_owned();
        let query: HashMap<String, String> = request.url.query_pairs().into_owned().collect();
        let body: Value = request
            .body
            .as_ref()
            .and_then(|body| serde_json::from_slice(body).ok())
            .unwrap_or(Value::Null);
        self.state()
            .requests
            .push((request.method.to_owned(), path.clone()));
        self.changed();
        let segments: Vec<&str> = path.trim_start_matches('/').split('/').collect();
        let response = match (request.method, segments.as_slice()) {
            ("GET", ["api", "event"]) => return Ok(self.events_stream()),
            ("GET", ["api", "model"]) => catalog(&query, json!(self.state().models)),
            ("GET", ["api", "model", "default"]) => catalog(
                &query,
                self.state().models.first().cloned().unwrap_or(Value::Null),
            ),
            ("GET", ["api", "agent"]) => catalog(&query, json!(self.state().agents)),
            ("GET", ["api", "command"]) => catalog(&query, json!(self.state().commands)),
            ("GET", ["api", "plugin"]) => catalog(
                &query,
                json!([{
                    "id": "opencode.models.dev", "source": { "type": "builtin" },
                    "features": { "server": true }, "state": { "status": "active" },
                }]),
            ),
            ("GET", ["api", "session"]) => {
                let sessions: Vec<Value> = self
                    .state()
                    .sessions
                    .values()
                    .filter(|session| {
                        query
                            .get("directory")
                            .is_none_or(|directory| session["location"]["directory"] == *directory)
                    })
                    .cloned()
                    .collect();
                json_response(200, json!({ "data": sessions, "cursor": {} }))
            }
            ("POST", ["api", "session"]) => {
                let id = format!("ses_{}", self.sessions.fetch_add(1, Ordering::SeqCst) + 1);
                let mut session = make_session(
                    &id,
                    body["location"]["directory"].as_str().unwrap_or_default(),
                );
                for key in ["permissions", "metadata"] {
                    if let Some(value) = body.get(key) {
                        session[key] = value.clone();
                    }
                }
                self.state().sessions.insert(id, session.clone());
                json_response(200, json!({ "data": session }))
            }
            ("GET", ["api", "session", id]) => match self.state().sessions.get(*id) {
                Some(session) => json_response(200, json!({ "data": session })),
                None => not_found(id),
            },
            ("PATCH", ["api", "session", id]) => {
                let mut state = self.state();
                match state.sessions.get_mut(*id) {
                    Some(session) => {
                        for key in ["permissions", "metadata"] {
                            if let Some(value) = body.get(key) {
                                session[key] = value.clone();
                            }
                        }
                        no_content()
                    }
                    None => not_found(id),
                }
            }
            ("DELETE", ["api", "session", id]) => match self.state().sessions.shift_remove(*id) {
                Some(_) => no_content(),
                None => not_found(id),
            },
            ("POST", ["api", "session", id, "fork"]) => {
                let source = self.state().sessions.get(*id).cloned();
                match source {
                    Some(mut session) => {
                        let forked =
                            format!("ses_{}", self.sessions.fetch_add(1, Ordering::SeqCst) + 1);
                        session["id"] = json!(forked);
                        self.state().sessions.insert(forked, session.clone());
                        json_response(200, json!({ "data": session }))
                    }
                    None => not_found(id),
                }
            }
            ("POST", ["api", "session", id, "model"]) => {
                self.state()
                    .selections
                    .push(json!({ "sessionID": id, "model": body["model"] }));
                no_content()
            }
            ("POST", ["api", "session", id, "agent"]) => {
                self.state()
                    .selections
                    .push(json!({ "sessionID": id, "agent": body["agent"] }));
                no_content()
            }
            ("POST", ["api", "session", id, "prompt"]) => {
                let session_id = (*id).to_owned();
                let mut submission = json!({ "kind": "prompt", "sessionID": session_id });
                merge(&mut submission, &body);
                let count = {
                    let mut state = self.state();
                    state.submissions.push(submission);
                    state.prompts().len()
                };
                self.changed();
                let inbox = body["id"].as_str().unwrap_or_default().to_owned();
                let events = match &self.options.on_prompt {
                    Some(hook) => {
                        hook(PromptCall {
                            session_id: session_id.clone(),
                            id: inbox.clone(),
                            text: body["text"].as_str().unwrap_or_default().to_owned(),
                            count,
                            aborted,
                        })
                        .await
                    }
                    None => turn(&session_id, &inbox, Vec::new()),
                };
                self.send(&events);
                enqueued(&session_id, &inbox, "user", json!({ "text": body["text"] }))
            }
            ("POST", ["api", "session", id, "command"]) => {
                let mut submission = json!({ "kind": "command", "sessionID": id });
                merge(&mut submission, &body);
                self.state().submissions.push(submission);
                no_content()
            }
            ("POST", ["api", "session", id, "compact"]) => {
                let mut submission = json!({ "kind": "compact", "sessionID": id });
                merge(&mut submission, &body);
                self.state().submissions.push(submission);
                let inbox = body["id"].as_str().unwrap_or_default().to_owned();
                self.send(&turn(id, &inbox, Vec::new()));
                enqueued(id, &inbox, "compaction", json!({}))
            }
            ("POST", ["api", "session", id, "synthetic"]) => {
                let mut submission = json!({ "kind": "synthetic", "sessionID": id });
                merge(&mut submission, &body);
                self.state().submissions.push(submission);
                enqueued(
                    id,
                    "msg_synthetic",
                    "synthetic",
                    json!({ "text": body["text"] }),
                )
            }
            ("POST", ["api", "session", id, "interrupt"]) => {
                let session_id = (*id).to_owned();
                let known = {
                    let mut state = self.state();
                    state.interrupts.push(session_id.clone());
                    state.sessions.contains_key(&session_id)
                };
                self.changed();
                if !known {
                    not_found(id)
                } else {
                    let events = match &self.options.on_interrupt {
                        Some(hook) => hook(session_id).await,
                        None => Vec::new(),
                    };
                    self.send(&events);
                    json_response(200, json!({ "interrupted": !events.is_empty() }))
                }
            }
            ("POST", ["api", "session", id, "permission", request_id, "reply"]) => {
                self.state().replies.push(json!({
                    "sessionID": id, "requestID": request_id, "decision": body["decision"],
                }));
                no_content()
            }
            ("DELETE", ["api", "session", id, "form", form_id]) => {
                let mut form = json!({ "sessionID": id, "formID": form_id });
                if let Some(message) = query.get("message") {
                    form["message"] = json!(message);
                }
                self.state().cancelled_forms.push(form);
                let events = match &self.options.on_form_cancel {
                    Some(hook) => hook(((*id).to_owned(), (*form_id).to_owned())).await,
                    None => Vec::new(),
                };
                self.send(&events);
                no_content()
            }
            ("PUT", ["api", "experimental", "mcp", name]) => {
                self.state().mcp.push(json!({
                    "name": name,
                    "directory": query.get("location[directory]"),
                    "config": body["config"],
                }));
                no_content()
            }
            _ => Response {
                status: 404,
                headers: Vec::new(),
                body: Box::pin(futures_util::stream::empty()),
            },
        };
        self.changed();
        Ok(response)
    }

    fn events_stream(&self) -> Response {
        let (sender, receiver) = mpsc::unbounded_channel();
        let _ = sender.send(Ok(Bytes::from(
            "data: {\"id\":\"evt_connected\",\"type\":\"server.connected\",\"data\":{}}\n\n",
        )));
        lock(&self.streams).push(sender);
        let body = futures_util::stream::unfold(receiver, |mut receiver| async move {
            receiver.recv().await.map(|item| (item, receiver))
        });
        Response {
            status: 200,
            headers: vec![("content-type".to_owned(), "text/event-stream".to_owned())],
            body: Box::pin(body),
        }
    }
}

fn merge(target: &mut Value, source: &Value) {
    if let (Some(target), Some(source)) = (target.as_object_mut(), source.as_object()) {
        for (key, value) in source {
            target.insert(key.clone(), value.clone());
        }
    }
}

fn json_response(status: u16, body: Value) -> Response {
    let bytes = Bytes::from(body.to_string());
    Response {
        status,
        headers: vec![("content-type".to_owned(), "application/json".to_owned())],
        body: Box::pin(futures_util::stream::once(async move { Ok(bytes) })),
    }
}

fn no_content() -> Response {
    Response {
        status: 204,
        headers: Vec::new(),
        body: Box::pin(futures_util::stream::empty()),
    }
}

fn not_found(id: &str) -> Response {
    json_response(
        404,
        json!({ "_tag": "SessionNotFoundError", "sessionID": id, "message": "session not found" }),
    )
}

fn catalog(query: &HashMap<String, String>, data: Value) -> Response {
    let directory = query
        .get("location[directory]")
        .cloned()
        .unwrap_or_else(|| "/workspace".to_owned());
    json_response(
        200,
        json!({ "location": { "directory": directory, "project": { "id": "global", "directory": directory } }, "data": data }),
    )
}

/// The response to a submission the server admitted to the session inbox.
fn enqueued(session_id: &str, id: &str, kind: &str, payload: Value) -> Response {
    json_response(
        200,
        json!({ "data": { "id": id, "sessionID": session_id, "time": { "created": 0 }, "type": kind, "payload": payload, "delivery": "steer" } }),
    )
}

struct FakeTransport(Arc<Server>);

impl Transport for FakeTransport {
    fn send(&self, request: Request) -> BoxFuture<'_, Result<Response, String>> {
        let server = self.0.clone();
        Box::pin(async move {
            let aborted = CancellationToken::new();
            let guard = aborted.clone().drop_guard();
            let response = server.handle(request, aborted).await;
            guard.disarm();
            response
        })
    }
}

// ---------------------------------------------------------------------------------------------------
// Client

#[derive(Debug, Clone, PartialEq)]
pub struct RpcError {
    pub code: i64,
    pub message: String,
    pub data: Value,
}

impl RpcError {
    pub fn json(&self) -> Value {
        json!({ "code": self.code, "message": self.message, "data": self.data })
    }
}

type Pending = Mutex<HashMap<u64, oneshot::Sender<Result<Value, RpcError>>>>;

pub struct Wire {
    pub server: Arc<Server>,
    outbox: mpsc::UnboundedSender<Value>,
    pending: Arc<Pending>,
    pub received: Arc<Mutex<Vec<Value>>>,
    pub updates: Arc<Mutex<Vec<Value>>>,
    pub child_updates: Arc<Mutex<Vec<Value>>>,
    pub permissions: Arc<Mutex<Vec<Value>>>,
    pub elicitations: Arc<Mutex<Vec<Value>>>,
    next_id: AtomicU64,
    changed: Arc<Notify>,
    agent: tokio::task::JoinHandle<opencode_acp::Closed>,
    pub session_id: String,
}

impl Drop for Wire {
    fn drop(&mut self) {
        self.agent.abort();
    }
}

pub async fn start_wire(options: WireOptions) -> Wire {
    let changed = Arc::new(Notify::new());
    let server = Server::new(options.clone(), changed.clone());
    let client =
        Client::with_transport("http://fake.test", Arc::new(FakeTransport(server.clone())))
            .expect("client");
    let (client_end, agent_end) = tokio::io::duplex(1 << 22);
    let (agent_read, agent_write) = tokio::io::split(agent_end);
    let mut acp_options = opencode_acp::Options::new("test");
    if let Some(timeout) = options.drain_timeout {
        acp_options.drain_timeout = timeout;
    }
    let agent = tokio::spawn(opencode_acp::serve(
        client,
        agent_read,
        agent_write,
        acp_options,
    ));
    let (client_read, mut client_write) = tokio::io::split(client_end);
    let (outbox, mut outgoing) = mpsc::unbounded_channel::<Value>();
    tokio::spawn(async move {
        while let Some(message) = outgoing.recv().await {
            if client_write
                .write_all(format!("{message}\n").as_bytes())
                .await
                .is_err()
            {
                return;
            }
            let _ = client_write.flush().await;
        }
    });
    let wire = Wire {
        server,
        outbox: outbox.clone(),
        pending: Arc::default(),
        received: Arc::default(),
        updates: Arc::default(),
        child_updates: Arc::default(),
        permissions: Arc::default(),
        elicitations: Arc::default(),
        next_id: AtomicU64::new(1),
        changed,
        agent,
        session_id: String::new(),
    };
    let reader = Reader {
        pending: wire.pending.clone(),
        received: wire.received.clone(),
        updates: wire.updates.clone(),
        child_updates: wire.child_updates.clone(),
        permissions: wire.permissions.clone(),
        elicitations: wire.elicitations.clone(),
        changed: wire.changed.clone(),
        permission: options.permission.clone(),
    };
    tokio::spawn(async move {
        let mut lines = BufReader::new(client_read).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let Ok(message) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            reader.receive(message, &outbox);
        }
    });
    wire
}

/// `startSession`: a wire with an initialized connection and one new session.
pub async fn start_session(options: WireOptions, capabilities: Value) -> Wire {
    let mut wire = start_wire(options).await;
    wire.initialize(capabilities).await;
    let session = wire
        .new_session("/workspace", json!([]))
        .await
        .expect("session/new");
    wire.session_id = session["sessionId"].as_str().expect("sessionId").to_owned();
    wire
}

struct Reader {
    pending: Arc<Pending>,
    received: Arc<Mutex<Vec<Value>>>,
    updates: Arc<Mutex<Vec<Value>>>,
    child_updates: Arc<Mutex<Vec<Value>>>,
    permissions: Arc<Mutex<Vec<Value>>>,
    elicitations: Arc<Mutex<Vec<Value>>>,
    changed: Arc<Notify>,
    permission: Option<Answer>,
}

impl Reader {
    fn receive(&self, message: Value, answers: &mpsc::UnboundedSender<Value>) {
        lock(&self.received).push(message.clone());
        let params = message.get("params").cloned().unwrap_or(Value::Null);
        match (
            message.get("method").and_then(Value::as_str),
            message.get("id"),
        ) {
            (Some("session/update"), None) => lock(&self.updates).push(params),
            (Some("opencode/session/child_update"), None) => lock(&self.child_updates).push(params),
            (Some("session/request_permission"), Some(id)) => {
                let result = self.permission.as_ref().map_or_else(
                    || json!({ "outcome": { "outcome": "cancelled" } }),
                    |answer| answer(&params),
                );
                lock(&self.permissions).push(params);
                let _ = answers.send(json!({ "jsonrpc": "2.0", "id": id, "result": result }));
            }
            (Some("elicitation/create"), Some(id)) => {
                lock(&self.elicitations).push(params);
                let _ = answers
                    .send(json!({ "jsonrpc": "2.0", "id": id, "result": { "action": "cancel" } }));
            }
            (None, Some(id)) => {
                let Some(sender) = id.as_u64().and_then(|id| lock(&self.pending).remove(&id))
                else {
                    return;
                };
                let result = match message.get("error") {
                    Some(error) => Err(RpcError {
                        code: error["code"].as_i64().unwrap_or_default(),
                        message: error["message"].as_str().unwrap_or_default().to_owned(),
                        data: error.get("data").cloned().unwrap_or(Value::Null),
                    }),
                    None => Ok(message.get("result").cloned().unwrap_or(Value::Null)),
                };
                let _ = sender.send(result);
            }
            _ => {}
        }
        self.changed.notify_waiters();
    }
}

impl Wire {
    pub fn send(&self, message: Value) {
        let _ = self.outbox.send(message);
    }

    pub async fn request(&self, method: &str, params: Value) -> Result<Value, RpcError> {
        self.request_with(method, params, None).await
    }

    /// Sends a request; cancelling `cancel` sends `$/cancel_request` for it.
    pub async fn request_with(
        &self,
        method: &str,
        params: Value,
        cancel: Option<CancellationToken>,
    ) -> Result<Value, RpcError> {
        self.begin(method, params, cancel).await
    }

    /// Sends a request at once and returns the wait for its answer.
    pub fn begin(
        &self,
        method: &str,
        params: Value,
        cancel: Option<CancellationToken>,
    ) -> impl std::future::Future<Output = Result<Value, RpcError>> + Send + 'static {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (sender, receiver) = oneshot::channel();
        lock(&self.pending).insert(id, sender);
        self.send(json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }));
        if let Some(cancel) = cancel {
            let outbox = self.outbox.clone();
            tokio::spawn(async move {
                cancel.cancelled().await;
                let _ = outbox.send(json!({ "jsonrpc": "2.0", "method": "$/cancel_request", "params": { "requestId": id } }));
            });
        }
        let method = method.to_owned();
        async move {
            tokio::time::timeout(Duration::from_secs(20), receiver)
                .await
                .unwrap_or_else(|_| panic!("timed out waiting for {method}"))
                .expect("response")
        }
    }

    /// `session/prompt` with one text block, sent at once.
    pub fn begin_prompt(
        &self,
        text: &str,
    ) -> impl std::future::Future<Output = Result<Value, RpcError>> + Send + 'static {
        self.begin(
            "session/prompt",
            json!({ "sessionId": self.session_id, "prompt": [{ "type": "text", "text": text }] }),
            None,
        )
    }

    pub fn notify(&self, method: &str, params: Value) {
        self.send(json!({ "jsonrpc": "2.0", "method": method, "params": params }));
    }

    pub async fn initialize(&self, capabilities: Value) -> Value {
        self.request(
            "initialize",
            json!({ "protocolVersion": 1, "clientCapabilities": capabilities, "clientInfo": { "name": "test", "version": "1" } }),
        )
        .await
        .expect("initialize")
    }

    pub async fn new_session(&self, cwd: &str, mcp_servers: Value) -> Result<Value, RpcError> {
        self.request(
            "session/new",
            json!({ "cwd": cwd, "mcpServers": mcp_servers }),
        )
        .await
    }

    pub async fn prompt(&self, session_id: &str, text: &str) -> Result<Value, RpcError> {
        self.prompt_blocks(session_id, json!([{ "type": "text", "text": text }]))
            .await
    }

    pub async fn prompt_blocks(&self, session_id: &str, prompt: Value) -> Result<Value, RpcError> {
        self.request(
            "session/prompt",
            json!({ "sessionId": session_id, "prompt": prompt }),
        )
        .await
    }

    /// Waits until `read` returns a value.
    pub async fn until<T>(&self, description: &str, mut read: impl FnMut() -> Option<T>) -> T {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
        loop {
            let notified = self.changed.notified();
            if let Some(value) = read() {
                return value;
            }
            if tokio::time::timeout_at(deadline, notified).await.is_err() {
                if let Some(value) = read() {
                    return value;
                }
                panic!("timed out waiting for {description}");
            }
        }
    }

    pub async fn wait_for_update(
        &self,
        description: &str,
        predicate: impl Fn(&Value) -> bool,
    ) -> Value {
        self.until(description, || {
            lock(&self.updates)
                .iter()
                .find(|item| predicate(item))
                .cloned()
        })
        .await
    }

    pub fn updates(&self) -> Vec<Value> {
        lock(&self.updates).clone()
    }

    /// Updates other than available commands and usage.
    pub fn turn_updates(&self) -> Vec<Value> {
        self.updates()
            .into_iter()
            .filter(|item| {
                !matches!(
                    item["update"]["sessionUpdate"].as_str(),
                    Some("available_commands_update" | "usage_update")
                )
            })
            .collect()
    }
}

/// `toMatchObject`: every key of `expected` matches; arrays match element by element.
pub fn matches(actual: &Value, expected: &Value) -> bool {
    match (actual, expected) {
        (Value::Object(actual), Value::Object(expected)) => expected.iter().all(|(key, value)| {
            actual
                .get(key)
                .map_or(value.is_null(), |item| matches(item, value))
        }),
        (Value::Array(actual), Value::Array(expected)) => {
            actual.len() == expected.len()
                && actual.iter().zip(expected).all(|(a, e)| matches(a, e))
        }
        _ => actual == expected,
    }
}

#[track_caller]
pub fn assert_matches(actual: &Value, expected: &Value) {
    assert!(
        matches(actual, expected),
        "expected to match:\n  actual:   {actual}\n  expected: {expected}"
    );
}

/// A hook that answers with fixed events.
pub fn events(
    build: impl Fn(&PromptCall) -> Vec<Value> + Send + Sync + 'static,
) -> Hook<PromptCall> {
    Arc::new(move |call| {
        let events = build(&call);
        Box::pin(async move { events })
    })
}
