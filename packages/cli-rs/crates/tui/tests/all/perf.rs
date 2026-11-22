//! Performance scenarios: fixed workloads through the real TUI, store and decoders, each printing one `PERF`
//! line of JSON with the allocations, bytes and peak live heap of the measured thread and of every thread, the
//! instructions the measured thread retired, and the wall and process CPU time. They are ignored, so the normal test
//! run skips them; `bun run perf` in `packages/cli-rs` runs each in a process of its own and compares two runs. Mini's
//! scenario is in mini's own tests (`crates/mini/src/perf.rs`), which share `support::probe`.
//!
//! The measured thread is the test's: the TUI's UI thread, or the thread that decodes or runs the store. The fake
//! server answers with bodies serialized before the measure, so it adds little to the counts of every thread.

use crate::support::{self, WAIT};

use std::collections::HashMap;
use std::rc::Rc;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use bytes::Bytes;
use opencode_api::client::Client;
use opencode_api::events::Event;
use opencode_api::generated::{SessionID, V2Event};
use opencode_api::transport::{BoxFuture, Request, Response, Transport};
use opencode_store::{Data, LoadMore, Options as StoreOptions, Payload, Wanted};
use opencode_tui::{Deps, Route, Tui};
use opentui::testing::TestApp;
use serde_json::{Value, json};

use crate::support::probe::{LONG, PARTS, Probe, TURNS, long_messages};

const SHORT: &str = "ses_short";
const TEXT_DELTAS: usize = 20_000;
const TOOL_DELTAS: usize = 2_000;
const TOOL_PROGRESS: usize = 500;
/// Events per store batch while streaming, each batch one frame.
const BATCH: usize = 20;
const SESSIONS: usize = 2_000;
const PROVIDERS: usize = 40;
const MODELS_PER_PROVIDER: usize = 50;
const EVENTS: usize = 20_000;

#[test]
#[ignore = "performance scenario; run with `bun run perf`"]
fn startup() {
    let server = Server::new().sessions(20);
    let probe = Probe::start();
    let h = mount(server, Route::Home, 120, 40);
    let tui = h.tui.clone();
    let loaded =
        h.app.wait_until(WAIT, || tui.local.ready() && tui.local.catalog_ready() && tui.local.current().is_some());
    settle(&h.app);
    probe.finish("startup", 1);
    assert!(loaded, "the home never loaded:\n{}", h.app.text());
}

#[test]
#[ignore = "performance scenario; run with `bun run perf`"]
fn open_long() {
    let h = mount(Server::new().long(), Route::Home, 120, 40);
    let tui = h.tui.clone();
    assert!(h.app.wait_until(WAIT, || tui.local.ready() && tui.local.current().is_some()));
    settle(&h.app);
    let probe = Probe::start();
    tui.navigate(support::session_route(LONG));
    wait_tail(&h, LONG, TURNS);
    settle(&h.app);
    probe.finish("open_long", 1);
    let screen = h.app.text();
    assert!(screen.contains(&format!("Answer {TURNS}.{}", PARTS - 1)), "the tail never showed:\n{screen}");
}

#[test]
#[ignore = "performance scenario; run with `bun run perf`"]
fn page_back() {
    let h = mount(Server::new().long(), support::session_route(LONG), 120, 40);
    wait_tail(&h, LONG, TURNS);
    settle(&h.app);
    let probe = Probe::start();
    first(&h);
    probe.finish("page_back", 1);
    let screen = h.app.text();
    assert!(screen.contains("Question 1 "), "the head never showed:\n{screen}");
}

#[test]
#[ignore = "performance scenario; run with `bun run perf`"]
fn stream() {
    let h = mount(Server::new().short(), support::session_route(SHORT), 120, 40);
    let tui = h.tui.clone();
    wait_tail(&h, SHORT, 20);
    settle(&h.app);
    let events = streamed();
    let count = events.len() as u64;
    let batches: Vec<Vec<String>> = events.chunks(BATCH).map(<[_]>::to_vec).collect();
    let wanted = tui.data.remote().wanted();
    let probe = Probe::start();
    connected(
        batches,
        |batch| read(batch, &wanted),
        |mut batch| {
            tui.data.apply_payloads(&mut batch);
            h.app.wait_until(WAIT, || tui.synced());
            frame(&h.app);
        },
    );
    settle(&h.app);
    probe.finish("stream", count);
    let screen = h.app.text();
    assert!(screen.contains("done streaming"), "the reply never finished:\n{screen}");
}

#[test]
#[ignore = "performance scenario; run with `bun run perf`"]
fn scroll() {
    let h = mount(Server::new().long(), support::session_route(LONG), 120, 40);
    wait_tail(&h, LONG, TURNS);
    first(&h);
    let probe = Probe::start();
    let mut steps = 0;
    for command in std::iter::repeat_n("session.page.down", 200)
        .chain(std::iter::repeat_n("session.message.previous", 100))
        .chain(std::iter::repeat_n("session.half.page.up", 100))
        .chain(["session.last", "session.first", "session.last"])
    {
        h.dispatch(command);
        frame(&h.app);
        steps += 1;
    }
    settle(&h.app);
    probe.finish("scroll", steps);
}

#[test]
#[ignore = "performance scenario; run with `bun run perf`"]
fn resize() {
    let h = mount(Server::new().long(), support::session_route(LONG), 120, 40);
    wait_tail(&h, LONG, TURNS);
    first(&h);
    h.dispatch("session.last");
    settle(&h.app);
    let probe = Probe::start();
    let sizes = [(100, 40), (80, 30), (60, 24), (140, 50), (90, 40), (120, 40)];
    for _ in 0..5 {
        for (width, height) in sizes {
            h.app.resize(width, height);
            h.app.advance(Duration::from_millis(1));
            frame(&h.app);
        }
    }
    settle(&h.app);
    probe.finish("resize", 5 * sizes.len() as u64);
}

#[test]
#[ignore = "performance scenario; run with `bun run perf`"]
fn session_list() {
    let server = Server::new().sessions(SESSIONS);
    let searches = server.searches.clone();
    let h = mount(server, Route::Home, 120, 40);
    let tui = h.tui.clone();
    assert!(h.app.wait_until(WAIT, || tui.local.ready() && tui.local.current().is_some()));
    settle(&h.app);
    let probe = Probe::start();
    h.app.press("ctrl+x");
    h.app.press("l");
    h.app.wait_until(Duration::from_secs(2), || h.app.needs_frame());
    settle(&h.app);
    let query = "1999";
    for character in query.chars() {
        let before = searches.load(Ordering::SeqCst);
        h.app.type_text(&character.to_string());
        frame(&h.app);
        h.app.advance(Duration::from_millis(200));
        h.app.wait_until(WAIT, || searches.load(Ordering::SeqCst) > before);
        h.app.wait_until(Duration::from_secs(2), || h.app.needs_frame());
        settle(&h.app);
    }
    probe.finish("session_list", query.len() as u64);
    let screen = h.app.text();
    assert!(screen.contains("Task 1999"), "the search never showed:\n{screen}");
}

#[test]
#[ignore = "performance scenario; run with `bun run perf`"]
fn model_picker() {
    let h = mount(Server::new().models(), Route::Home, 120, 40);
    let tui = h.tui.clone();
    let local = tui.local.clone();
    let loaded = h.app.wait_until(WAIT, || {
        local.ready() && local.catalog_ready() && local.connected() && local.models(|models| models.len() > 1000)
    });
    assert!(loaded, "the catalog never loaded:\n{}", h.app.text());
    settle(&h.app);
    let probe = Probe::start();
    opencode_tui::dialogs::model::show(&local, None);
    settle(&h.app);
    let query = "model 4 7";
    for character in query.chars() {
        h.app.type_text(&character.to_string());
        frame(&h.app);
    }
    for _ in query.chars() {
        h.app.press("backspace");
        frame(&h.app);
    }
    settle(&h.app);
    probe.finish("model_picker", 2 * query.len() as u64);
    assert!(h.app.text().contains("Search models"), "the picker is not open:\n{}", h.app.text());
}

#[test]
#[ignore = "performance scenario; run with `bun run perf`"]
fn store_open() {
    let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build_local(Default::default()).unwrap();
    let server = Arc::new(Server::new().long());
    let client = Client::with_transport("http://opencode.local", server).unwrap();
    let id = SessionID(LONG.into());
    let probe = Probe::start();
    let options = StoreOptions { directory: support::DIRECTORY.into(), ..StoreOptions::default() };
    let data = runtime.block_on(async { Data::local(client, options) });
    runtime.block_on(async {
        data.message_sync(&id).await.unwrap();
        while data.read(|state| state.has_more_messages(&id)) {
            data.message_load_more(&id, LoadMore::default()).await.unwrap();
        }
    });
    probe.finish("store_open", 2 * TURNS as u64);
    assert_eq!(data.read(|state| state.messages(&id).len()), 2 * TURNS);
}

#[test]
#[ignore = "performance scenario; run with `bun run perf`"]
fn store_stream() {
    let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build_local(Default::default()).unwrap();
    let client = Client::with_transport("http://opencode.local", Arc::new(Server::new().short())).unwrap();
    let id = SessionID(SHORT.into());
    let options = StoreOptions { directory: support::DIRECTORY.into(), ..StoreOptions::default() };
    let data = runtime.block_on(async { Data::local(client, options) });
    runtime.block_on(async { data.message_sync(&id).await.unwrap() });
    let deltas = data.listen_deltas();
    let events = streamed();
    let count = events.len() as u64;
    let batches: Vec<Vec<String>> = events.chunks(BATCH).map(<[_]>::to_vec).collect();
    let wanted = data.remote().wanted();
    let probe = Probe::start();
    connected(
        batches,
        |batch| read(batch, &wanted),
        |mut batch| {
            data.apply_payloads(&mut batch);
            deltas.take(|_| ());
        },
    );
    probe.finish("store_stream", count);
    let text = data.read(|state| format!("{:?}", state.messages(&id).last()));
    assert!(text.contains("done streaming"), "{text}");
}

#[test]
#[ignore = "performance scenario; run with `bun run perf`"]
fn decode_events() {
    use futures_util::StreamExt;
    let runtime = tokio::runtime::Builder::new_current_thread().build().unwrap();
    let body = sse_body();
    let chunks: Vec<Result<Bytes, String>> =
        body.chunks(16 * 1024).map(|chunk| Ok(Bytes::copy_from_slice(chunk))).collect();
    let probe = Probe::start();
    let decoded = runtime.block_on(async {
        let stream = opencode_api::sse::events::<V2Event, _, _>(futures_util::stream::iter(chunks), || {});
        stream.fold(0u64, |count, event| async move { count + u64::from(event.is_ok()) }).await
    });
    probe.finish("decode_events", decoded);
    assert_eq!(decoded, EVENTS as u64);
}

#[test]
#[ignore = "performance scenario; run with `bun run perf`"]
fn decode_responses() {
    use opencode_api::generated::{MessageListInput, MessageListInputOrder, SessionListInput};
    let runtime = tokio::runtime::Builder::new_current_thread().build().unwrap();
    let server = Arc::new(Server::new().long().sessions(SESSIONS).models());
    let client = Client::with_transport("http://opencode.local", server).unwrap();
    let probe = Probe::start();
    let decoded = runtime.block_on(async {
        let input = MessageListInput {
            session_id: SessionID(LONG.into()),
            limit: Some(2 * TURNS as i64),
            order: Some(MessageListInputOrder::Desc),
            ..Default::default()
        };
        let messages = client.message_list(&input).await.unwrap().data.len();
        let sessions = client
            .session_list(&SessionListInput { limit: Some(SESSIONS as i64), ..Default::default() })
            .await
            .unwrap()
            .data
            .len();
        let models = client.model_list(&Default::default()).await.unwrap().data.len();
        messages + sessions + models
    });
    probe.finish("decode_responses", decoded as u64);
    assert_eq!(decoded, 2 * TURNS + SESSIONS + PROVIDERS * MODELS_PER_PROVIDER);
}

fn mount(server: Server, route: Route, width: u16, height: u16) -> support::Harness {
    let deps = Deps { config: support::config(support::still()), route, ..support::deps(Arc::new(server)) };
    let harness = support::mount(width, height, deps);
    harness.app.set_verify(false);
    harness
}

/// Paints a frame, as the app's loop does when something changed.
fn frame(app: &TestApp) {
    if app.needs_frame() {
        app.present().unwrap();
    }
}

/// Paints until nothing changes, for work that lands over a few frames (layout callbacks).
fn settle(app: &TestApp) {
    for _ in 0..20 {
        app.advance(Duration::from_millis(1));
        if !app.needs_frame() {
            return;
        }
        app.present().unwrap();
    }
}

/// Waits until the newest page of `session`, whose last turn is `turns`, is in the store and synced to the view.
fn wait_tail(h: &support::Harness, session: &str, turns: usize) {
    let tui: &Rc<Tui> = &h.tui;
    let id = SessionID(session.into());
    let last = format!("msg_{turns:04}b");
    let loaded = h.app.wait_until(WAIT, || {
        tui.synced() && tui.data.read(|state| state.messages(&id).iter().any(|message| message.id() == last))
    });
    assert!(loaded, "the tail never loaded:\n{}", h.app.text());
}

/// Jumps to the first message, which loads every older page, and paints until it shows.
fn first(h: &support::Harness) {
    let tui: &Rc<Tui> = &h.tui;
    let id = SessionID(LONG.into());
    h.dispatch("session.first");
    let loaded = h.app.wait_until(WAIT, || {
        tui.synced() && tui.data.read(|state| state.messages(&id).len() == 2 * TURNS && !state.messages_loading(&id))
    });
    assert!(loaded, "the history never loaded:\n{}", h.app.text());
    settle(&h.app);
}

/// A fake server whose answers are serialized up front, so serving one costs a copy.
#[derive(Default)]
struct Server {
    routes: HashMap<&'static str, Bytes>,
    /// Each session's messages, oldest first, each serialized.
    messages: HashMap<String, Vec<String>>,
    sessions: Vec<(String, String)>,
    searches: Arc<AtomicUsize>,
}

impl Server {
    fn new() -> Self {
        let directory = support::DIRECTORY;
        let model = json!({
            "id": "model-0-0", "modelID": "model-0-0", "providerID": "provider-0", "name": "Model 0 0",
            "status": "active", "enabled": true,
            "capabilities": { "input": ["text"], "output": ["text"], "tools": true },
            "cost": [{ "input": 3, "output": 15, "cache": { "read": 0, "write": 0 } }],
            "limit": { "context": 200000, "output": 32000 }, "time": { "released": 0 }, "variants": [],
        });
        let agent = json!({
            "id": "build", "name": "build", "description": "The default agent", "mode": "primary", "hidden": false,
            "permissions": [], "request": { "settings": {}, "headers": {}, "body": {} },
            "model": { "providerID": "provider-0", "id": "model-0-0" },
        });
        let integration = json!([{
            "id": "opencode", "name": "OpenCode Console",
            "methods": [{ "id": "device", "type": "oauth", "label": "Sign in with OpenCode" }],
            "connections": [{ "type": "credential", "id": "cred_1", "label": "Acme", "method": "oauth" }],
        }]);
        let mut server = Self::default();
        for (path, body) in [
            ("/api/location", support::location(directory)),
            ("/api/agent", support::list(directory, json!([agent]))),
            ("/api/model", support::list(directory, json!([model]))),
            ("/api/provider", support::list(directory, json!([provider(0)]))),
            ("/api/integration", support::list(directory, integration)),
            ("/api/config", json!([])),
            ("/api/experimental/migration/v1", json!({ "status": "completed" })),
            ("/api/session", json!({ "data": [], "cursor": {} })),
        ] {
            server.routes.insert(path, Bytes::from(body.to_string()));
        }
        server
    }

    /// `count` sessions, the newest first; session `n` is titled `Task n`.
    fn sessions(mut self, count: usize) -> Self {
        self.sessions = (0..count)
            .rev()
            .map(|index| {
                let mut session = support::session(&format!("ses_{index:05}"), &format!("Task {index}"));
                session["time"]["updated"] = json!(1_700_000_000_000_u64 + index as u64 * 60_000);
                session["agent"] = json!("build");
                (format!("task {index}"), session.to_string())
            })
            .collect();
        self
    }

    /// [`PROVIDERS`] providers of [`MODELS_PER_PROVIDER`] models each.
    fn models(mut self) -> Self {
        let directory = support::DIRECTORY;
        let providers: Vec<Value> = (0..PROVIDERS).map(provider).collect();
        let models: Vec<Value> = (0..PROVIDERS)
            .flat_map(|provider| {
                (0..MODELS_PER_PROVIDER).map(move |model| {
                    json!({
                        "id": format!("model-{provider}-{model}"), "modelID": format!("model-{provider}-{model}"),
                        "providerID": format!("provider-{provider}"), "name": format!("Model {provider} {model}"),
                        "status": "active", "enabled": true,
                        "capabilities": { "input": ["text", "image"], "output": ["text"], "tools": true },
                        "cost": [{ "input": 3, "output": 15, "cache": { "read": 0, "write": 0 } }],
                        "limit": { "context": 200000, "output": 32000 }, "time": { "released": 0 },
                        "variants": [{ "id": "low" }, { "id": "high" }],
                    })
                })
            })
            .collect();
        self.routes.insert("/api/provider", Bytes::from(support::list(directory, json!(providers)).to_string()));
        self.routes.insert("/api/model", Bytes::from(support::list(directory, json!(models)).to_string()));
        self
    }

    fn long(mut self) -> Self {
        let messages = long_messages(TURNS, PARTS).iter().map(Value::to_string).collect();
        self.messages.insert(LONG.into(), messages);
        self
    }

    fn short(mut self) -> Self {
        let messages = long_messages(20, 4).iter().map(Value::to_string).collect();
        self.messages.insert(SHORT.into(), messages);
        self
    }

    fn answer(&self, request: &Request) -> (u16, Bytes) {
        let path = request.url.path();
        let query: HashMap<String, String> = request.url.query_pairs().into_owned().collect();
        if let Some(body) = self.routes.get(path).filter(|_| path != "/api/session" || self.sessions.is_empty()) {
            return (200, body.clone());
        }
        if path == "/api/session" {
            return (200, self.session_page(&query));
        }
        let parts: Vec<&str> = path.trim_start_matches("/api/session/").split('/').collect();
        match parts.as_slice() {
            [id] => match self.session(id) {
                Some(session) => (200, Bytes::from(format!("{{\"data\":{session}}}"))),
                None => (404, Bytes::from_static(b"{}")),
            },
            [id, "message"] => match self.messages.get(*id) {
                Some(messages) => (200, message_page(messages, &query)),
                None => (200, Bytes::from_static(b"{\"data\":[],\"cursor\":{}}")),
            },
            [_, "inbox" | "permission" | "form"] => (200, Bytes::from_static(b"{\"data\":[]}")),
            _ if path.ends_with("/form") || path.ends_with("/permission") || path.ends_with("/request") => {
                (200, Bytes::from(support::list(support::DIRECTORY, json!([])).to_string()))
            }
            _ if ["/api/command", "/api/skill", "/api/reference", "/api/form"].contains(&path) => {
                (200, Bytes::from(support::list(support::DIRECTORY, json!([])).to_string()))
            }
            _ => (404, Bytes::from_static(b"{}")),
        }
    }

    fn session(&self, id: &str) -> Option<String> {
        if self.messages.contains_key(id) {
            let mut session = support::session(id, "A long session");
            session["agent"] = json!("build");
            session["model"] = json!({ "providerID": "provider-0", "id": "model-0-0" });
            return Some(session.to_string());
        }
        self.sessions
            .iter()
            .find(|(_, session)| session.contains(&format!("\"{id}\"")))
            .map(|(_, session)| session.clone())
    }

    fn session_page(&self, query: &HashMap<String, String>) -> Bytes {
        let limit = query.get("limit").and_then(|limit| limit.parse().ok()).unwrap_or(usize::MAX);
        let search = query.get("search").map(|search| search.to_lowercase());
        if search.is_some() {
            self.searches.fetch_add(1, Ordering::SeqCst);
        }
        let page: Vec<&str> = self
            .sessions
            .iter()
            .filter(|(title, _)| search.as_ref().is_none_or(|search| title.contains(search.as_str())))
            .take(limit)
            .map(|(_, session)| session.as_str())
            .collect();
        Bytes::from(format!("{{\"data\":[{}],\"cursor\":{{}}}}", page.join(",")))
    }
}

/// Messages newest first, `limit` at a time, with a cursor that counts the messages older than the page.
fn message_page(messages: &[String], query: &HashMap<String, String>) -> Bytes {
    let limit: usize = query.get("limit").map_or(20, |limit| limit.parse().unwrap());
    let end = query.get("cursor").map_or(messages.len(), |cursor| cursor.parse().unwrap());
    let start = end.saturating_sub(limit);
    let page: Vec<&str> = messages[start..end].iter().rev().map(String::as_str).collect();
    let next = if start > 0 { format!("\"{start}\"") } else { "null".into() };
    Bytes::from(format!("{{\"data\":[{}],\"cursor\":{{\"next\":{next}}}}}", page.join(",")))
}

impl Transport for Server {
    fn send(&self, request: Request) -> BoxFuture<'_, Result<Response, String>> {
        let (status, body) = self.answer(&request);
        Box::pin(async move {
            let body = if status == 204 { Bytes::new() } else { body };
            Ok(Response {
                status,
                headers: vec![("content-type".into(), "application/json".into())],
                body: Box::pin(futures_util::stream::iter([Ok(body)])),
            })
        })
    }
}

fn provider(index: usize) -> Value {
    json!({ "id": format!("provider-{index}"), "name": format!("Provider {index}"), "activation": "auto", "package": "@ai-sdk/test" })
}

/// A batch of the stream's payloads as the connection reads them, with what decoded there of adjacent deltas merged.
fn read(batch: Vec<String>, wanted: &Wanted) -> Vec<Payload> {
    let mut payloads: Vec<Payload> = Vec::with_capacity(batch.len());
    for text in batch {
        let payload = Payload::read(text, wanted).unwrap();
        if !payloads.last_mut().is_some_and(|last| last.merge(&payload)) {
            payloads.push(payload);
        }
    }
    payloads
}

/// Hands `apply` the stream's batches as the connection sends them to the store, each made by `connection` on a thread
/// of its own, as the connection's task runs: the probe's measured thread is the store's alone.
fn connected<T: Send>(batches: Vec<Vec<String>>, connection: impl Fn(Vec<String>) -> T + Send, apply: impl FnMut(T)) {
    let (send, receive) = std::sync::mpsc::sync_channel(1);
    std::thread::scope(|scope| {
        scope.spawn(move || {
            for batch in batches {
                if send.send(connection(batch)).is_err() {
                    return;
                }
            }
        });
        receive.iter().for_each(apply);
    });
}

/// [`TOOL_DELTAS`] deltas, [`TOOL_PROGRESS`] progress events of the running tool, then the end of the step, as the JSON
/// the event stream sends.
fn streamed() -> Vec<String> {
    let words =
        ["The ", "parser ", "now ", "handles ", "**nested** ", "groups ", "and ", "`escapes`", ".\n\n", "- item\n"];
    let message = "msg_live";
    let mut seq = 0;
    let mut event = |kind: &str, data: Value| {
        seq += 1;
        let mut data = data;
        data["sessionID"] = json!(SHORT);
        data["assistantMessageID"] = json!(message);
        json!({
            "id": format!("evt_{seq}"), "created": 10_000 + seq, "type": kind,
            "durable": { "aggregateID": SHORT, "seq": seq, "version": 1 },
            "data": data,
        })
        .to_string()
    };
    let mut events = vec![
        event(
            "session.step.started",
            json!({ "agent": "build", "model": { "providerID": "provider-0", "id": "model-0-0" }, "started": 1 }),
        ),
        event("session.text.started", json!({ "ordinal": 0 })),
    ];
    let mut text = String::new();
    for index in 0..TEXT_DELTAS {
        let delta = words[index % words.len()];
        text.push_str(delta);
        events.push(event("session.text.delta", json!({ "ordinal": 0, "delta": delta })));
    }
    text.push_str("done streaming");
    events.push(event("session.text.ended", json!({ "ordinal": 0, "text": text })));
    events.push(event("session.tool.input.started", json!({ "id": "call_live", "name": "write" })));
    let mut input = String::new();
    for index in 0..TOOL_DELTAS {
        let delta = if index == 0 { "{\"content\":\"".to_owned() } else { format!("line {index}\\n") };
        input.push_str(&delta);
        events.push(event("session.tool.input.delta", json!({ "id": "call_live", "delta": delta })));
    }
    events.push(event(
        "session.tool.called",
        json!({ "id": "call_live", "input": { "content": "lines", "filePath": "/project/out.txt" }, "executed": true }),
    ));
    for index in 0..TOOL_PROGRESS {
        let metadata = json!({ "output": format!("wrote line {index}\n"), "description": "Write the file" });
        events.push(event("session.tool.progress", json!({ "id": "call_live", "metadata": metadata })));
    }
    events.push(event(
        "session.tool.success",
        json!({ "id": "call_live", "executed": true, "content": [{ "type": "text", "text": "wrote" }] }),
    ));
    events.push(event(
        "session.step.ended",
        json!({
            "finish": "stop", "cost": 0,
            "tokens": { "input": 10, "output": 20, "reasoning": 0, "cache": { "read": 0, "write": 0 } },
        }),
    ));
    events
}

/// [`EVENTS`] server events as the event stream sends them: deltas mostly, with tool, step and session events.
fn sse_body() -> Vec<u8> {
    let mut body = Vec::new();
    for index in 0..EVENTS {
        let seq = index as u64 + 1;
        let (kind, data) = match index % 10 {
            0 => (
                "session.tool.input.delta",
                json!({ "assistantMessageID": "msg_a", "id": "call_1", "delta": "{\"path\":" }),
            ),
            1 => (
                "session.tool.success",
                json!({
                    "assistantMessageID": "msg_a", "id": "call_1", "executed": true,
                    "content": [{ "type": "text", "text": "fn main() {}\n" }],
                }),
            ),
            2 => ("session.renamed", json!({ "title": format!("Renamed {index}") })),
            _ => ("session.text.delta", json!({ "assistantMessageID": "msg_a", "ordinal": 0, "delta": "some words " })),
        };
        let mut data = data;
        data["sessionID"] = json!(SHORT);
        let event = json!({
            "id": format!("evt_{seq}"), "created": 10_000 + seq, "type": kind,
            "durable": { "aggregateID": SHORT, "seq": seq, "version": 1 },
            "data": data,
        });
        body.extend_from_slice(b"data: ");
        body.extend_from_slice(event.to_string().as_bytes());
        body.extend_from_slice(b"\n\n");
    }
    body
}
