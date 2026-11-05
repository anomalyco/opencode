//! The composer, the shell output dialog, and the client MCP tools (E.13b) through the whole TUI, over the in-memory
//! transport, for the paths the P-APP scenario `E.13b/composer` does not reach: the client MCP experiment and its
//! tools, interrupting a subagent, picking a terminal, the queued dock, and the output text.

use crate::support::WAIT;

use std::path::PathBuf;
use std::rc::Rc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use opencode_api::client::{Auth, Client};
use opencode_api::client_mcp;
use opencode_api::generated::SessionID;
use opencode_api::memory::{Logged, Memory, Route as MemoryRoute};
use opencode_api::pty::{self, Incoming};
use opencode_api::transport::{BoxFuture, Request, Response, Transport};
use opencode_local::cli_config::{self, Resolved};
use opencode_local::paths::Paths;
use opencode_tui::app::Roots;
use opencode_tui::{Deps, Route, Tui};
use opentui::testing::TestApp;
use serde_json::{Value, json};

const CHANNEL: &str = "test";

fn session(id: &str, parent: Option<&str>, title: &str, updated: u32) -> Value {
    json!({
        "id": id, "parentID": parent, "title": title, "projectID": "proj_test", "cost": 0,
        "tokens": { "input": 0, "output": 0, "reasoning": 0, "cache": { "read": 0, "write": 0 } },
        "time": { "created": updated, "updated": updated },
        "location": { "directory": "/project" },
    })
}

fn terminal() -> Value {
    json!({
        "id": "pty_1", "title": "Terminal", "command": "/bin/sh", "args": [], "cwd": "/project",
        "status": "running", "pid": 42, "sessionID": "ses_a", "foregroundProcess": "vim",
        "size": { "cols": 80, "rows": 24 }, "output": { "head": 0, "tail": 0 },
    })
}

fn shell() -> Value {
    json!({
        "id": "sh_1", "status": "running", "command": "make watch", "cwd": "/project", "shell": "/bin/sh",
        "file": "/tmp/sh_1.log", "pid": 7, "metadata": { "sessionID": "ses_a" }, "time": { "started": 1 },
    })
}

fn routes() -> Vec<MemoryRoute> {
    let location = json!({ "directory": "/project", "project": { "id": "proj_test", "directory": "/project" } });
    let mut routes = vec![
        MemoryRoute::json("GET", "/api/location", 200, &location),
        MemoryRoute::json(
            "GET",
            "/api/info",
            200,
            &json!({ "version": "test", "pid": 0, "urls": [], "paths": { "tmp": "/tmp" },
                     "capabilities": { "persistentPty": true } }),
        ),
        MemoryRoute::json(
            "GET",
            "/api/session/ses_a",
            200,
            &json!({ "data": session("ses_a", None, "Fix the parser", 3) }),
        ),
        MemoryRoute::json(
            "GET",
            "/api/session/ses_other",
            200,
            &json!({ "data": session("ses_other", None, "Elsewhere", 1) }),
        ),
        MemoryRoute::json(
            "GET",
            "/api/session",
            200,
            &json!({ "data": [session("ses_a", None, "Fix the parser", 3), session("ses_c", Some("ses_a"), "Scan (@explore subagent)", 2)], "cursor": {} }),
        ),
        MemoryRoute::json("GET", "/api/session/active", 200, &json!({ "data": { "ses_c": { "type": "running" } } })),
        MemoryRoute::json("POST", "/api/session/ses_c/interrupt", 200, &json!({ "interrupted": true })),
        MemoryRoute::json("GET", "/api/session/ses_a/message", 200, &json!({ "data": [], "cursor": {} })),
        MemoryRoute::json(
            "GET",
            "/api/session/ses_a/inbox",
            200,
            &json!({ "data": [{ "id": "msg_q", "sessionID": "ses_a", "type": "user", "payload": { "text": "Later" },
                                "delivery": "queue", "time": { "created": 5 } }] }),
        ),
        MemoryRoute::json("GET", "/api/experimental/session/ses_a/terminal", 200, &json!({ "data": [terminal()] })),
        MemoryRoute::json("GET", "/api/shell", 200, &json!({ "location": location, "data": [shell()] })),
        MemoryRoute::json("GET", "/api/shell/sh_1", 200, &json!({ "location": location, "data": shell() })),
        MemoryRoute::json(
            "GET",
            "/api/shell/sh_1/output",
            200,
            &json!({ "location": location,
                     "data": { "output": "hello \u{1b}[31mred\u{1b}[0m\r\nworld", "cursor": 20, "size": 20, "truncated": false } }),
        ),
    ];
    for list in ["permission", "form"] {
        routes.push(MemoryRoute::json("GET", &format!("/api/session/ses_a/{list}"), 200, &json!({ "data": [] })));
    }
    routes
}

/// The far end of the client MCP socket and the URL and headers it opened with.
type Opened = Arc<Mutex<Vec<(String, Vec<(String, String)>, client_mcp::Remote)>>>;

struct Harness {
    app: TestApp,
    tui: Rc<Tui>,
    memory: Memory,
    opened: Opened,
    state: PathBuf,
    next: std::cell::Cell<i64>,
    _home: tempfile::TempDir,
}

fn mount() -> Harness {
    mount_with(None)
}

/// Where sockets open, and with which credentials.
type Endpoint = Arc<Mutex<(url::Url, Option<Auth>)>>;

/// A transport whose socket endpoint moves, as a managed service's does when it restarts.
struct Moving {
    memory: Memory,
    endpoint: Endpoint,
}

impl Transport for Moving {
    fn send(&self, request: Request) -> BoxFuture<'_, Result<Response, String>> {
        self.memory.send(request)
    }

    fn endpoint(&self, _: url::Url, _: Option<&Auth>) -> (url::Url, Option<Auth>) {
        self.endpoint.lock().unwrap().clone()
    }
}

fn mount_with(endpoint: Option<Endpoint>) -> Harness {
    mount_routes(endpoint, routes())
}

/// Three running subagents of `ses_a`, listed in this order.
fn mount_family() -> Harness {
    let children = [("ses_c", "Scan"), ("ses_d", "Lint"), ("ses_e", "Test")];
    let mut sessions = vec![session("ses_a", None, "Fix the parser", 3)];
    sessions.extend(
        children.iter().map(|(id, title)| session(id, Some("ses_a"), &format!("{title} (@explore subagent)"), 2)),
    );
    let running: serde_json::Map<String, Value> =
        children.iter().map(|(id, _)| ((*id).to_owned(), json!({ "type": "running" }))).collect();
    let mut routes = vec![
        MemoryRoute::json("GET", "/api/session", 200, &json!({ "data": sessions, "cursor": {} })),
        MemoryRoute::json("GET", "/api/session/active", 200, &json!({ "data": running })),
    ];
    routes.extend(self::routes());
    mount_routes(None, routes)
}

fn mount_routes(endpoint: Option<Endpoint>, routes: Vec<MemoryRoute>) -> Harness {
    let home = tempfile::tempdir().unwrap();
    let root = home.path().to_owned();
    let paths = Paths::from_vars(|name| (name == "HOME").then(|| root.clone().into_os_string())).unwrap();
    let state = paths.state.clone();
    let memory = Memory::new(routes);
    let transport: Arc<dyn Transport> = match endpoint {
        Some(endpoint) => Arc::new(Moving { memory: memory.clone(), endpoint }),
        None => Arc::new(memory.clone()),
    };
    let client = Client::with_transport("http://opencode.local", transport).unwrap();
    let app = TestApp::new(100, 30);
    let info = cli_config::decode_text(r#"{"animations":false}"#).unwrap();
    let tui = opencode_tui::mount(
        &app,
        Deps {
            client,
            directory: "/project".into(),
            config: Resolved::new(info, |_| None),
            roots: Some(Roots { paths, storage_channel: CHANNEL.into() }),
            route: Route::Session { id: SessionID("ses_a".into()) },
            continue_: false,
            events: true,
        },
    );
    // Terminal panes get sockets that never answer.
    tui.terminals.set_connector(Arc::new(|_| {
        let (socket, remote) = pty::pair();
        std::mem::forget(remote);
        Ok(socket)
    }));
    let opened: Opened = Arc::default();
    let record = opened.clone();
    tui.client_mcp.set_connector(Arc::new(move |url: url::Url, headers: Vec<(String, String)>| {
        let (socket, remote) = client_mcp::pair();
        record.lock().unwrap().push((url.to_string(), headers, remote));
        Ok(socket)
    }));
    let harness = Harness { app, tui, memory, opened, state, next: std::cell::Cell::new(0), _home: home };
    assert!(harness.wait(|harness| harness.app.text().contains("1 queued")));
    assert!(
        harness.wait(|harness| { !harness.requests("GET", "/api/experimental/session/ses_a/terminal").is_empty() })
    );
    harness
}

impl Harness {
    fn wait(&self, check: impl Fn(&Self) -> bool) -> bool {
        self.app.wait_until(WAIT, || {
            self.app.render();
            check(self)
        })
    }

    fn settle(&self) {
        self.app.wait_until(Duration::from_millis(100), || false);
        self.app.render();
    }

    fn requests(&self, method: &str, path: &str) -> Vec<Logged> {
        self.memory.requests().into_iter().filter(|logged| logged.method == method && logged.path == path).collect()
    }

    fn selection(&self) -> Value {
        let path = self.state.join(CHANNEL).join("tui").join("session-terminal-selection.json");
        std::fs::read_to_string(path).ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or(Value::Null)
    }

    fn experiment(&self, on: bool) {
        opencode_tui::dialogs::settings::update(&self.tui, move |value| {
            opencode_tui::dialogs::settings::set_path(value, &["experimental", "client-mcp"], json!(on));
        });
    }

    /// Sends a request on the newest client MCP socket and waits for its reply.
    fn request(&self, method: &str, params: Value) -> Value {
        let id = self.next.get() + 1;
        self.next.set(id);
        let message = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
        let deliver = self.opened.lock().unwrap().last().unwrap().2.deliver.clone();
        deliver.try_send(Incoming::Text(message.to_string())).unwrap();
        let reply = std::cell::RefCell::new(None);
        self.app.wait_until(WAIT, || {
            let mut opened = self.opened.lock().unwrap();
            let remote = &mut opened.last_mut().unwrap().2;
            while let Ok(text) = remote.sent.try_recv() {
                let value: Value = serde_json::from_str(&text).unwrap();
                if value["id"] == json!(id) {
                    *reply.borrow_mut() = Some(value);
                }
            }
            reply.borrow().is_some()
        });
        reply.into_inner().expect("a reply")
    }

    /// The cell where `label` starts on screen.
    fn at(&self, label: &str) -> Option<(u16, u16)> {
        at(&self.app.text(), label)
    }

    /// The subagent rows on screen, top to bottom.
    fn rows(&self) -> Vec<&'static str> {
        let text = self.app.text();
        let mut rows: Vec<_> = ["Scan", "Lint", "Test"]
            .into_iter()
            .filter_map(|title| at(&text, &format!("Explore: {title} ()")).map(|(_, y)| (y, title)))
            .collect();
        rows.sort();
        rows.into_iter().map(|(_, title)| title).collect()
    }

    /// The subagent rows drawn as the selection, with the focused action background.
    fn focused(&self) -> Vec<&'static str> {
        let focused = self.tui.page().background.action.primary.focused;
        let capture = self.app.render();
        let text = capture.text();
        ["Scan", "Lint", "Test"]
            .into_iter()
            .filter(|title| {
                at(&text, &format!("Explore: {title} ()"))
                    .is_some_and(|(x, y)| capture.cell(u32::from(x), u32::from(y)).unwrap().bg == focused)
            })
            .collect()
    }

    /// One durable event of a subagent, as a running subagent streams them.
    fn emit(&self, kind: &str, session: &str) {
        let seq = self.next.get() + 1;
        self.next.set(seq);
        self.memory.emit(&json!({
            "id": format!("evt_{seq}"), "created": seq, "type": kind,
            "durable": { "aggregateID": session, "seq": seq, "version": 1 },
            "location": { "directory": "/project" }, "data": { "sessionID": session },
        }));
    }

    fn call(&self, tool: &str, arguments: Value, session: Option<&str>) -> Value {
        let mut params = json!({ "name": tool, "arguments": arguments });
        if let Some(session) = session {
            params["_meta"] = json!({ "ai.opencode/sessionID": session });
        }
        self.request("tools/call", params)["result"].clone()
    }
}

fn at(screen: &str, label: &str) -> Option<(u16, u16)> {
    screen.lines().enumerate().find_map(|(y, line)| {
        let byte = line.find(label)?;
        Some((line[..byte].chars().count() as u16, y as u16))
    })
}

fn text(result: &Value) -> (&str, bool) {
    (result["content"][0]["text"].as_str().unwrap_or_default(), result["isError"] == json!(true))
}

#[test]
fn the_client_mcp_experiment_serves_the_terminal_tools() {
    let harness = mount();
    harness.settle();
    assert!(harness.opened.lock().unwrap().is_empty());
    assert!(!harness.tui.client_mcp.connected());

    harness.experiment(true);
    assert!(harness.wait(|harness| !harness.opened.lock().unwrap().is_empty()));
    let (url, headers) = {
        let opened = harness.opened.lock().unwrap();
        (opened[0].0.clone(), opened[0].1.clone())
    };
    assert_eq!(url, "ws://opencode.local/api/experimental/client-mcp?location%5Bdirectory%5D=%2Fproject&name=tui");
    assert!(headers.is_empty());

    let tools = harness.request("tools/list", json!({}))["result"]["tools"].clone();
    let names: Vec<&str> = tools.as_array().unwrap().iter().map(|tool| tool["name"].as_str().unwrap()).collect();
    assert_eq!(names, ["open_terminal", "write_terminal"]);
    assert_eq!(tools[1]["inputSchema"]["required"], json!(["text"]));

    assert_eq!(text(&harness.call("open_terminal", json!({}), None)), ("Unknown session", true));
    assert_eq!(text(&harness.call("open_terminal", json!({}), Some("ses_missing"))), ("Unknown session", true));
    assert_eq!(
        text(&harness.call("open_terminal", json!({}), Some("ses_other"))),
        ("session not open in this TUI", true)
    );
    assert_eq!(
        text(&harness.call("write_terminal", json!({ "text": 1 }), Some("ses_a"))),
        ("text must be a string", true)
    );
    // A subagent's call opens its family's terminal: the newest one, shown without focus.
    assert_eq!(text(&harness.call("open_terminal", json!({}), Some("ses_c"))), ("Opened terminal pty_1", false));
    assert!(harness.wait(|harness| harness.selection()["sessions"]["ses_a"] == "pty_1"));
    assert_eq!(
        text(&harness.call("write_terminal", json!({ "text": "ls\n" }), Some("ses_a"))),
        ("Wrote to terminal pty_1", false)
    );
    assert!(
        harness.requests("POST", "/api/experimental/session/ses_a/terminal").is_empty(),
        "an existing terminal is reused"
    );

    harness.experiment(false);
    assert!(harness.wait(|harness| !harness.tui.client_mcp.connected()));
    let closed = {
        let mut opened = harness.opened.lock().unwrap();
        let remote = &mut opened[0].2;
        harness.app.wait_until(WAIT, || {
            matches!(remote.sent.try_recv(), Err(tokio::sync::mpsc::error::TryRecvError::Disconnected))
        })
    };
    assert!(closed, "turning the experiment off closes the socket");
}

#[test]
fn the_client_mcp_socket_follows_a_restarted_service() {
    let at = |url: &str, password: &str| (url::Url::parse(url).unwrap(), Some(Auth::password(password)));
    let endpoint = Arc::new(Mutex::new(at("http://127.0.0.1:4096/", "old")));
    let harness = mount_with(Some(endpoint.clone()));
    harness.experiment(true);
    assert!(harness.wait(|harness| harness.opened.lock().unwrap().len() == 1));
    // The service restarts on a new port with a new password, and the event stream reconnects to it.
    *endpoint.lock().unwrap() = at("http://127.0.0.1:5000/", "new");
    harness.memory.emit(&json!({ "id": "evt_again", "type": "server.connected", "data": {} }));
    assert!(harness.wait(|harness| harness.opened.lock().unwrap().len() == 2));
    let opened: Vec<_> =
        harness.opened.lock().unwrap().iter().map(|(url, headers, _)| (url.clone(), headers.clone())).collect();
    let socket = |port: u16, password: &str| {
        (
            format!("ws://127.0.0.1:{port}/api/experimental/client-mcp?location%5Bdirectory%5D=%2Fproject&name=tui"),
            vec![("authorization".to_owned(), format!("Basic {}", Auth::password(password).token()))],
        )
    };
    assert_eq!(opened, [socket(4096, "old"), socket(5000, "new")]);
}

#[test]
fn the_subagents_tab_interrupts_a_running_subagent_and_hides_the_queued_dock() {
    let harness = mount();
    harness.tui.keymap.dispatch("session.child.first", None);
    assert!(harness.wait(|harness| harness.app.text().contains("Explore: Scan ()")));
    let text = harness.app.text();
    assert!(text.contains("interrupt ctrl+d"), "{text}");
    assert!(!text.contains("1 queued"), "the dock hides under the composer");
    harness.tui.keymap.dispatch("composer.subagent.interrupt", None);
    assert!(harness.wait(|harness| { !harness.requests("POST", "/api/session/ses_c/interrupt").is_empty() }));
    // Escape closes the composer, and the dock and the prompt come back.
    harness.app.press("escape");
    assert!(harness.wait(|harness| harness.app.text().contains("1 queued")));
    assert!(!harness.app.text().contains("Subagents"));
}

#[test]
fn terminal_select_opens_the_terminal_list_and_enter_shows_the_terminal() {
    let harness = mount();
    harness.tui.keymap.dispatch("terminal.select", None);
    assert!(harness.wait(|harness| harness.app.text().contains("+ New terminal")));
    assert!(harness.app.text().contains("vim"), "the foreground process names the terminal");
    harness.app.press("down");
    harness.app.press("enter");
    assert!(harness.wait(|harness| harness.selection()["sessions"]["ses_a"] == "pty_1"));
    assert!(!harness.app.text().contains("+ New terminal"));
}

#[test]
fn the_shell_output_dialog_shows_the_output_without_escapes() {
    let harness = mount();
    harness.tui.keymap.dispatch("session.child.first", None);
    harness.memory.emit(&json!({
        "id": "evt_shell", "created": 1, "type": "shell.created",
        "location": { "directory": "/project", "project": { "id": "proj_test", "directory": "/project" } },
        "data": { "info": shell() },
    }));
    harness.app.press("right");
    assert!(harness.wait(|harness| harness.app.text().contains("make watch")));
    harness.app.press("enter");
    assert!(harness.wait(|harness| harness.app.text().contains("hello red")));
    let text = harness.app.text();
    assert!(text.contains("Shell output") && text.contains("Running"), "{text}");
    assert!(text.contains("world"));
    assert!(!text.contains("Earlier output omitted"));
    let outputs = harness.requests("GET", "/api/shell/sh_1/output");
    let query = |logged: &Logged, name: &str| logged.query.get(name).and_then(|values| values.first().cloned());
    assert_eq!(query(&outputs[0], "cursor").as_deref(), Some("9007199254740991"));
    assert_eq!(query(&outputs[1], "cursor").as_deref(), Some("0"));
    assert_eq!(query(&outputs[1], "limit").as_deref(), Some("65536"));
    assert_eq!(query(&outputs[1], "location[directory]").as_deref(), Some("/project"));
}

#[test]
fn the_subagent_selection_follows_the_keys_while_subagents_stream_under_a_resting_pointer() {
    let harness = mount_family();
    harness.app.press("down");
    assert!(harness.wait(|harness| harness.rows().len() == 3));
    let rows = harness.rows();
    assert_eq!(harness.focused(), [rows[0]]);
    // The pointer rests on the first row, where the prompt was. Rows redrawn under it must not take the selection.
    let (x, y) = harness.at(&format!("Explore: {} ()", rows[0])).unwrap();
    harness.app.hover(x, y);
    for (key, expected) in [("down", 1), ("down", 2), ("up", 1)] {
        harness.app.press(key);
        for session in ["ses_c", "ses_d", "ses_e", "ses_c"] {
            harness.emit("session.execution.started", session);
            harness.settle();
        }
        harness.settle();
        assert_eq!(harness.rows(), rows, "the order holds");
        assert_eq!(harness.focused(), [rows[expected]], "after {key}");
    }
    // Moving the pointer selects the row under it (`onMouseMove`).
    let (x, y) = harness.at(&format!("Explore: {} ()", rows[2])).unwrap();
    harness.app.hover(x, y);
    assert!(harness.wait(|harness| harness.focused() == [rows[2]]));
}

#[test]
fn a_finished_subagent_leaves_the_selection_on_its_row_index() {
    let harness = mount_family();
    harness.app.press("down");
    assert!(harness.wait(|harness| harness.rows().len() == 3));
    let rows = harness.rows();
    let id = |title: &str| match title {
        "Scan" => "ses_c",
        "Lint" => "ses_d",
        _ => "ses_e",
    };
    harness.app.press("down");
    assert!(harness.wait(|harness| harness.focused() == [rows[1]]));
    // As in TS, the selection is an index: the next subagent moves up into it.
    harness.emit("session.execution.succeeded", id(rows[1]));
    assert!(harness.wait(|harness| harness.rows() == [rows[0], rows[2]]));
    assert_eq!(harness.focused(), [rows[2]]);
    // Past the end of the list, it moves to the last row.
    harness.emit("session.execution.succeeded", id(rows[2]));
    assert!(harness.wait(|harness| harness.rows() == [rows[0]]));
    assert_eq!(harness.focused(), [rows[0]]);
    harness.app.press("up");
    assert!(harness.wait(|harness| !harness.app.text().contains("Subagents")));
}
