//! Regressions for the `carbon` review of MS1 (`reviews/ms1.review-carbon.md`): session views that leave their
//! keys behind (carbon-2), keymap conditions that lock the store (carbon-5), and permission reads and focus
//! after a reconnect or under a dialog (carbon-6).

use std::sync::{Arc, Mutex};
use std::time::Duration;

use bytes::Bytes;
use opencode_api::client::Client;
use opencode_api::generated::SessionID;
use opencode_api::memory::{Memory, Route as MemoryRoute};
use opencode_api::transport::{BoxFuture, Request, Response, Transport};
use opencode_local::cli_config::{Info, Resolved};
use opencode_tui::{Args, Deps, Route, Tui};
use opentui::testing::TestApp;
use opentui::widget::Widget;
use serde_json::{Value, json};

const DIRECTORY: &str = "/project";
const GONE: &str = "/gone";

/// The memory server, with `ses_a`'s pending permissions changeable while it runs.
struct Server {
    memory: Memory,
    permissions: Mutex<Vec<Value>>,
}

impl Transport for Server {
    fn send(&self, request: Request) -> BoxFuture<'_, Result<Response, String>> {
        if request.method != "GET" || request.url.path() != "/api/session/ses_a/permission" {
            return self.memory.send(request);
        }
        let body = json!({ "data": *self.permissions.lock().unwrap() });
        Box::pin(async move {
            Ok(Response {
                status: 200,
                headers: vec![("content-type".into(), "application/json".into())],
                body: Box::pin(futures_util::stream::iter([Ok(Bytes::from(serde_json::to_vec(&body).unwrap()))])),
            })
        })
    }
}

fn routes() -> Vec<MemoryRoute> {
    let location =
        json!({ "directory": DIRECTORY, "project": { "id": "proj", "directory": DIRECTORY, "canonical": DIRECTORY } });
    let list = |data: Value| json!({ "location": location, "data": data });
    let agent = json!({
        "id": "build", "name": "build", "mode": "primary", "hidden": false, "permissions": [],
        "request": { "settings": {}, "headers": {}, "body": {} },
    });
    let model = json!({
        "id": "model", "modelID": "model", "providerID": "demo", "name": "Demo Model",
        "capabilities": { "tools": true, "input": ["text"], "output": ["text"] },
        "variants": [], "time": { "released": 0 }, "cost": [], "status": "active",
        "enabled": true, "limit": { "context": 1000, "output": 100 },
    });
    let missing = json!({ "_tag": "LocationNotFoundError", "message": "Location not found" });
    vec![
        MemoryRoute::json("GET", "/api/location", 404, &missing)
            .with_query([("location[directory]".to_owned(), vec![GONE.to_owned()])].into()),
        MemoryRoute::json("GET", "/api/location", 200, &location),
        MemoryRoute::json("GET", "/api/agent", 200, &list(json!([agent]))),
        MemoryRoute::json("GET", "/api/model", 200, &list(json!([model]))),
        MemoryRoute::json("POST", "/api/session", 200, &json!({ "data": session("ses_new", DIRECTORY) })),
        MemoryRoute::json("GET", "/api/session/ses_new", 200, &json!({ "data": session("ses_new", DIRECTORY) })),
        MemoryRoute::json("GET", "/api/session/ses_a", 200, &json!({ "data": session("ses_a", DIRECTORY) })),
        MemoryRoute::json("GET", "/api/session/ses_gone", 200, &json!({ "data": session("ses_gone", GONE) })),
        MemoryRoute::json("GET", "/api/session", 200, &json!({ "data": [], "cursor": {} })),
        MemoryRoute::json("GET", "/api/session/:id/message", 200, &json!({ "data": [], "cursor": {} })),
        MemoryRoute::json("GET", "/api/session/:id/inbox", 200, &json!({ "data": [] })),
        MemoryRoute::json("GET", "/api/session/:id/permission", 200, &json!({ "data": [] })),
    ]
}

fn session(id: &str, directory: &str) -> Value {
    json!({
        "id": id, "title": "Review", "projectID": "proj", "cost": 0,
        "tokens": { "input": 0, "output": 0, "reasoning": 0, "cache": { "read": 0, "write": 0 } },
        "time": { "created": 1, "updated": 1 },
        "location": { "directory": directory },
    })
}

fn permission() -> Value {
    json!({ "id": "per_1", "sessionID": "ses_a", "action": "shell", "resources": ["ls -la"], "save": [] })
}

struct Harness {
    app: TestApp,
    tui: std::rc::Rc<Tui>,
    server: Arc<Server>,
}

fn mount(route: Route) -> Harness {
    let server = Arc::new(Server { memory: Memory::new(routes()), permissions: Mutex::default() });
    let client = Client::with_transport("http://opencode.local", server.clone()).unwrap();
    let app = TestApp::new(100, 30);
    let tui = opencode_tui::mount_with(
        &app,
        Deps {
            client,
            directory: DIRECTORY.into(),
            config: Resolved::new(Info::default(), |_| None),
            roots: None,
            route,
            continue_: false,
            events: true,
        },
        Args::default(),
    );
    Harness { app, tui, server }
}

impl Harness {
    fn wait_for(&self, what: &str, check: impl Fn(&str) -> bool) -> String {
        let found = self.app.wait_until(Duration::from_secs(5), || check(&self.app.text()));
        let screen = self.app.text();
        let gets: Vec<_> = self
            .server
            .memory
            .requests()
            .iter()
            .map(|logged| format!("{} {} {:?}", logged.method, logged.path, logged.query))
            .collect();
        assert!(found, "{what} never happened:\n{screen}\n{gets:#?}");
        screen
    }

    fn writes(&self) -> Vec<String> {
        self.server
            .memory
            .requests()
            .iter()
            .filter(|logged| logged.method != "GET")
            .map(|logged| format!("{} {}", logged.method, logged.path))
            .collect()
    }

    fn commands(&self) -> Vec<String> {
        self.tui.keymap.commands().into_iter().map(|command| command.id).collect()
    }

    fn prompt_focused(&self) -> bool {
        let textarea = self.tui.textarea.borrow().clone();
        let focused = self.tui.app.focused().map(|widget| widget.id());
        textarea.is_some_and(|textarea| Some(textarea.id()) == focused)
    }
}

#[test]
fn leaving_a_missing_location_session_gives_enter_back_to_the_prompt() {
    let h = mount(Route::Session { id: SessionID("ses_gone".into()) });
    h.wait_for("the location view", |screen| screen.contains("Session location unavailable"));
    h.tui.navigate(Route::Home);
    h.app.advance(Duration::from_millis(1));
    let commands = h.commands();
    for leaked in ["session.toggle.thinking", "session.verbosity.cycle", "session.first"] {
        assert!(!commands.contains(&leaked.to_owned()), "{leaked} outlived its session");
    }
    h.app.type_text("hello");
    h.app.press("return");
    h.app.advance(Duration::from_millis(1));
    assert!(!h.app.text().contains("Choose directory"), "enter opened the location dialog:\n{}", h.app.text());
    let sent = h.app.wait_until(Duration::from_secs(5), || h.writes().contains(&"POST /api/session".to_owned()));
    assert!(sent, "the home prompt did not submit: {:?}", h.writes());
}

#[test]
fn keymap_queries_do_not_lock_the_store() {
    let h = mount(Route::Session { id: SessionID("ses_a".into()) });
    h.wait_for("the session", |screen| screen.contains("Review"));
    // `session.list`'s `suggested` and the prompt's `running` conditions run inside `commands`.
    let commands = h.tui.data.read(|_| h.commands());
    assert!(commands.contains(&"session.list".to_owned()));
}

#[test]
fn a_reconnect_reads_permissions_again() {
    let h = mount(Route::Session { id: SessionID("ses_a".into()) });
    h.wait_for("the session", |screen| screen.contains("Review"));
    h.app.advance(Duration::from_millis(50));
    // Asked while the stream was down: only the read after the reconnect can see it.
    h.server.permissions.lock().unwrap().push(permission());
    h.server.memory.emit(&json!({ "id": "evt_again", "type": "server.connected", "data": {} }));
    h.wait_for("the permission prompt", |screen| screen.contains("Permission required"));
}

#[test]
fn a_resolved_permission_leaves_an_open_dialog_focused() {
    let h = mount(Route::Session { id: SessionID("ses_a".into()) });
    h.wait_for("the session", |screen| screen.contains("Review"));
    h.server.memory.emit(&json!({
        "id": "evt_asked", "created": 1, "type": "permission.asked", "data": permission(),
    }));
    h.wait_for("the permission prompt", |screen| screen.contains("Permission required"));
    h.tui.keymap.dispatch("help.show", None);
    h.app.advance(Duration::from_millis(1));
    assert!(h.tui.dialogs.is_open());
    h.server.memory.emit(&json!({
        "id": "evt_replied", "created": 2, "type": "permission.replied",
        "data": { "sessionID": "ses_a", "requestID": "per_1", "reply": "once" },
    }));
    h.wait_for("the permission to close", |screen| !screen.contains("Permission required"));
    assert!(!h.prompt_focused(), "the prompt took the dialog's focus");
    h.tui.dialogs.clear();
    h.app.advance(Duration::from_millis(1));
    assert!(h.prompt_focused(), "the prompt did not take the keys back");
}
