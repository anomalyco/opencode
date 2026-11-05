//! Regressions for the `carbon` review of MS3 and MS4 (`reviews/ms3-ms4.review-carbon.md`), over the in-memory
//! transport with its request log (P-REQ): `session.new` and `tui.prompt.append` (carbon-5), OpenCode Console usage
//! limits that load, refresh, show in the prompt, and warn by themselves (carbon-6), `--agent` and `--model`, and
//! groups that stay open across a remount of the session view (V15).

use std::rc::Rc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use bytes::Bytes;
use opencode_api::client::Client;
use opencode_api::generated::SessionID;
use opencode_api::memory::{Memory, Route as MemoryRoute};
use opencode_api::transport::{BoxFuture, Request, Response, Transport};
use opencode_local::cli_config::{self, Resolved};
use opencode_local::model_pref::Model;
use opencode_tui::{Args, Deps, Route, Tui};
use opentui::testing::TestApp;
use serde_json::{Value, json};

const DIRECTORY: &str = "/project";
const WORKTREE: &str = "/project/wt";
const LIMITS: &str = "/api/experimental/usage/limits";

/// The memory server, with the usage limits changeable while it runs.
struct Server {
    memory: Memory,
    limits: Mutex<Value>,
}

impl Transport for Server {
    fn send(&self, request: Request) -> BoxFuture<'_, Result<Response, String>> {
        if request.url.path() != LIMITS {
            return self.memory.send(request);
        }
        // Logged with the rest, so the P-REQ checks see it.
        drop(self.memory.send(request));
        let body = json!({ "location": location(), "data": *self.limits.lock().unwrap() });
        Box::pin(async move {
            Ok(Response {
                status: 200,
                headers: vec![("content-type".into(), "application/json".into())],
                body: Box::pin(futures_util::stream::iter([Ok(Bytes::from(serde_json::to_vec(&body).unwrap()))])),
            })
        })
    }
}

fn location() -> Value {
    location_at(DIRECTORY)
}

fn location_at(directory: &str) -> Value {
    json!({ "directory": directory, "project": { "id": "proj", "directory": DIRECTORY } })
}

fn limits(spent: f64) -> Value {
    json!({
        "workspace": { "id": "wrk_1", "name": "Acme", "usageURL": "https://opencode.ai/console/wrk_1/usage" },
        "budgets": [{
            "id": "big", "limit": 10, "spent": 0, "scope": "each", "per": "model", "coverage": "models",
            "models": [{ "providerID": "opencode", "modelID": "big", "name": "Big Pickle", "spent": spent }],
            "vendors": [], "picked": false, "shared": false, "resetsAt": 1894708800000_i64,
        }],
    })
}

fn model(provider: &str, id: &str, name: &str, input: f64) -> Value {
    json!({
        "id": id, "modelID": id, "providerID": provider, "name": name, "status": "active", "enabled": true,
        "capabilities": { "tools": true, "input": ["text"], "output": ["text"] },
        "cost": [{ "input": input, "output": input * 3.0, "cache": { "read": 0, "write": 0 } }],
        "limit": { "context": 200000, "output": 32000 }, "time": { "released": 0 }, "variants": [],
    })
}

fn agent(id: &str, model: Option<Value>) -> Value {
    json!({
        "id": id, "name": id, "mode": "primary", "hidden": false, "permissions": [], "model": model,
        "request": { "settings": {}, "headers": {}, "body": {} },
    })
}

fn session(id: &str, directory: &str, title: &str, agent: Option<&str>) -> Value {
    json!({
        "id": id, "title": title, "projectID": "proj", "cost": 0, "agent": agent,
        "tokens": { "input": 0, "output": 0, "reasoning": 0, "cache": { "read": 0, "write": 0 } },
        "time": { "created": 1, "updated": 1 },
        "location": { "directory": directory },
    })
}

/// An answer that groups its two reads under "Explored".
fn grouped() -> Value {
    let read = |id: &str, path: &str| {
        json!({
            "type": "tool", "id": id, "name": "read",
            "state": { "status": "completed", "input": { "filePath": path }, "content": [] },
            "time": { "created": 1100, "completed": 1200 },
        })
    };
    json!([
        {
            "id": "msg_2", "type": "assistant", "agent": "build", "model": { "providerID": "demo", "id": "other" },
            "content": [read("call_a", "src/a.rs"), read("call_b", "src/b.rs"), { "type": "text", "text": "All read." }],
            "finish": "stop", "time": { "created": 1000, "completed": 3000 },
        },
        { "id": "msg_1", "type": "user", "text": "Read both", "time": { "created": 1 } },
    ])
}

fn routes() -> Vec<MemoryRoute> {
    // The worktree's catalogs answer for the worktree, so the store files them there.
    let mut routes: Vec<MemoryRoute> = [(DIRECTORY, None), (WORKTREE, Some(WORKTREE))]
        .into_iter()
        .rev()
        .flat_map(|(directory, query)| catalogs(directory, query))
        .collect();
    routes.extend(sessions());
    routes
}

fn catalogs(directory: &str, query: Option<&str>) -> Vec<MemoryRoute> {
    let list = |data: Value| json!({ "location": location_at(directory), "data": data });
    let models = json!([model("opencode", "big", "Big Pickle", 10.0), model("demo", "other", "Other Model", 1.0)]);
    let providers = json!([
        { "id": "opencode", "name": "OpenCode", "integrationID": "opencode", "activation": "auto", "package": "@ai-sdk/test" },
        { "id": "demo", "name": "Demo", "activation": "auto", "package": "@ai-sdk/test" },
    ]);
    let agents = json!([agent("build", Some(json!({ "providerID": "opencode", "id": "big" }))), agent("plan", None)]);
    let routes = [
        MemoryRoute::json("GET", "/api/location", 200, &location_at(directory)),
        MemoryRoute::json("GET", "/api/agent", 200, &list(agents)),
        MemoryRoute::json("GET", "/api/model", 200, &list(models)),
        MemoryRoute::json("GET", "/api/provider", 200, &list(providers)),
        MemoryRoute::json("GET", "/api/integration", 200, &list(json!([]))),
    ];
    let Some(query) = query else {
        return routes.into();
    };
    routes
        .into_iter()
        .map(|route| route.with_query([("location[directory]".to_owned(), vec![query.to_owned()])].into()))
        .collect()
}

fn sessions() -> Vec<MemoryRoute> {
    let mut routes = vec![
        MemoryRoute::json("GET", "/api/config", 200, &json!([])),
        MemoryRoute::json("GET", "/api/session", 200, &json!({ "data": [], "cursor": {} })),
        MemoryRoute::json("GET", "/api/session/ses_g/message", 200, &json!({ "data": grouped(), "cursor": {} })),
        MemoryRoute::json("GET", "/api/session/:id/message", 200, &json!({ "data": [], "cursor": {} })),
    ];
    for (id, directory, title, agent) in [
        ("ses_a", DIRECTORY, "Fix the parser", None),
        ("ses_b", DIRECTORY, "Write the docs", Some("build")),
        ("ses_g", DIRECTORY, "Grouped reads", None),
        ("ses_wt", WORKTREE, "Worktree work", None),
    ] {
        routes.push(MemoryRoute::json(
            "GET",
            &format!("/api/session/{id}"),
            200,
            &json!({ "data": session(id, directory, title, agent) }),
        ));
    }
    for list in ["inbox", "permission", "form"] {
        routes.push(MemoryRoute::json("GET", &format!("/api/session/:id/{list}"), 200, &json!({ "data": [] })));
    }
    routes
}

struct Harness {
    app: TestApp,
    tui: Rc<Tui>,
    server: Arc<Server>,
}

fn mount(route: Route, args: Args, config: Value) -> Harness {
    let server = Arc::new(Server { memory: Memory::new(routes()), limits: Mutex::new(limits(5.0)) });
    let client = Client::with_transport("http://opencode.local", server.clone()).unwrap();
    let app = TestApp::new(100, 30);
    let info = cli_config::decode_text(&config.to_string()).unwrap();
    let tui = opencode_tui::mount_with(
        &app,
        Deps {
            client,
            directory: DIRECTORY.into(),
            config: Resolved::new(info, |_| None),
            roots: None,
            route,
            continue_: false,
            events: true,
        },
        args,
    );
    let h = Harness { app, tui, server };
    let local = h.tui.local.clone();
    h.wait("the catalog", || local.catalog_ready() && !local.agents().is_empty());
    h
}

fn animations_off() -> Value {
    json!({ "animations": false })
}

fn session_route(id: &str) -> Route {
    Route::Session { id: SessionID(id.into()) }
}

impl Harness {
    fn wait(&self, what: &str, check: impl Fn() -> bool) {
        let found = self.app.wait_until(Duration::from_secs(5), || {
            self.app.render();
            check()
        });
        assert!(found, "{what} never happened:\n{}\n{:#?}", self.app.text(), self.log());
    }

    fn wait_for(&self, text: &str) {
        self.wait(text, || self.app.text().contains(text));
    }

    fn settle(&self) {
        self.app.wait_until(Duration::from_millis(150), || false);
        self.app.render();
    }

    fn log(&self) -> Vec<String> {
        self.server.memory.requests().iter().map(|logged| format!("{} {}", logged.method, logged.path)).collect()
    }

    fn count(&self, method: &str, path: &str) -> usize {
        self.server.memory.requests().iter().filter(|logged| logged.method == method && logged.path == path).count()
    }

    /// Mutating requests: everything but reads and the goal plugin's read RPC.
    fn writes(&self) -> Vec<String> {
        self.log()
            .into_iter()
            .filter(|line| !line.starts_with("GET ") && !line.ends_with("/opencode.goal/get"))
            .collect()
    }

    fn agent(&self) -> Option<String> {
        self.tui.local.agent().map(|agent| agent.id.0)
    }

    fn prompt_text(&self) -> String {
        self.tui.textarea.borrow().as_ref().map(|textarea| textarea.text()).unwrap_or_default()
    }

    fn row(&self, text: &str) -> (u16, u16) {
        let screen = self.app.text();
        screen
            .lines()
            .enumerate()
            .find_map(|(y, line)| {
                let x = line.find(text)?;
                Some((line[..x].chars().count() as u16, y as u16))
            })
            .unwrap_or_else(|| panic!("no {text:?} on screen:\n{screen}"))
    }
}

#[test]
fn session_new_keeps_the_location_agent_and_model_and_closes_dialogs() {
    let h = mount(
        session_route("ses_wt"),
        Args::default(),
        json!({ "animations": false, "session": { "new_location": "inherit" } }),
    );
    h.wait_for("Worktree work");
    h.tui.local.set_agent("plan");
    h.tui.local.set(&Model::new("demo", "other"), false);
    assert_eq!(h.tui.local.current(), Some(Model::new("demo", "other")));
    h.tui.keymap.dispatch("help.show", None);
    h.wait("the help dialog", || h.tui.dialogs.is_open());

    h.tui.keymap.dispatch("session.new", None);
    h.wait("home", || h.tui.route() == Route::Home);
    assert!(!h.tui.dialogs.is_open(), "the dialog stayed open");
    assert_eq!(
        opencode_tui::features::location::current(&h.tui).map(|location| location.directory),
        Some(WORKTREE.to_owned()),
        "`inherit` keeps the session's location"
    );
    assert_eq!(h.agent().as_deref(), Some("plan"));
    assert_eq!(h.tui.local.current(), Some(Model::new("demo", "other")));
    assert_eq!(h.writes(), Vec::<String>::new());
}

#[test]
fn tui_prompt_append_appends_to_the_prompt_of_the_current_location() {
    let h = mount(Route::Home, Args::default(), animations_off());
    h.wait("the prompt", || h.tui.textarea.borrow().is_some());
    h.app.type_text("hello ");
    let append = |id: &str, directory: &str, text: &str| {
        json!({
            "id": id, "created": 1, "type": "tui.prompt.append",
            "location": { "directory": directory }, "data": { "text": text },
        })
    };
    h.server.memory.emit(&append("evt_elsewhere", "/elsewhere", "nope "));
    h.server.memory.emit(&append("evt_here", DIRECTORY, "world"));
    h.wait("the append", || h.prompt_text() == "hello world");
    // The cursor moved to the end.
    h.app.type_text("!");
    h.wait("typing after it", || h.prompt_text() == "hello world!");
}

#[test]
fn console_limits_load_show_in_the_prompt_reload_after_a_turn_and_warn_once() {
    let h = mount(session_route("ses_a"), Args::default(), animations_off());
    h.wait_for("Fix the parser");
    // Big Pickle is served by OpenCode Console, so its limits load without opening `/models` or `/usage`.
    h.wait("the limits", || h.count("GET", LIMITS) == 1);
    h.wait_for("$5 left");
    h.wait_for("Running low on Big Pickle");

    *h.server.limits.lock().unwrap() = limits(10.0);
    let succeeded = |id: &str, session: &str| {
        json!({
            "id": id, "created": 2, "type": "session.execution.succeeded",
            "durable": { "aggregateID": session, "seq": 1, "version": 1 },
            "location": { "directory": DIRECTORY }, "data": { "sessionID": session },
        })
    };
    // Another session's turn does not reload them.
    h.server.memory.emit(&succeeded("evt_other", "ses_other"));
    h.settle();
    assert_eq!(h.count("GET", LIMITS), 1);
    h.server.memory.emit(&succeeded("evt_done", "ses_a"));
    h.wait("the reload", || h.count("GET", LIMITS) == 2);
    h.wait_for("Limit reached");
    h.wait_for("Big Pickle limit reached");
    assert_eq!(h.writes(), Vec::<String>::new());
}

#[test]
fn startup_agent_and_model_reach_the_selection() {
    let h = mount(
        Route::Home,
        Args { agent: Some("plan".into()), model: Some("demo/other".into()), ..Args::default() },
        animations_off(),
    );
    h.wait("the startup choice", || {
        h.agent().as_deref() == Some("plan") && h.tui.local.current() == Some(Model::new("demo", "other"))
    });
    assert_eq!(h.tui.local.recent(), [Model::new("demo", "other")]);
    // `--agent` shows over a session's own agent until the user picks one there (`local.tsx:90-96`).
    h.tui.navigate(session_route("ses_b"));
    h.wait_for("Write the docs");
    assert_eq!(h.agent().as_deref(), Some("plan"));
    assert_eq!(h.writes(), Vec::<String>::new());
}

#[test]
fn an_opened_group_stays_open_when_the_session_shows_again() {
    let h = mount(session_route("ses_g"), Args::default(), animations_off());
    h.wait_for("Explored");
    // A closed group shows its header only.
    assert!(!h.app.text().contains("Reading file"), "{}", h.app.text());
    let (x, y) = h.row("Explored");
    h.app.click(x + 2, y);
    h.wait_for("Reading file");

    h.tui.navigate(Route::Home);
    h.wait("home", || !h.app.text().contains("Explored"));
    h.tui.navigate(session_route("ses_g"));
    h.wait_for("Explored");
    h.wait_for("Reading file");
}
