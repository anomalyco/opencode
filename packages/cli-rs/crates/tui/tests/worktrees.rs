//! Worktrees (E.11b) over a fixture server that records requests: `session.move` in a session and on home,
//! a new worktree staged on home and created by the first submit, and the quick switch slots with their
//! pins. No test touches a real service or repository.

use std::path::Path;
use std::rc::Rc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use bytes::Bytes;
use opencode_api::client::Client;
use opencode_api::generated::{SessionID, V2Event};
use opencode_api::transport::{BoxFuture, Request, Response, Transport};
use opencode_local::cli_config::{Resolved, decode_text};
use opencode_local::paths::Paths;
use opencode_tui::app::Roots;
use opencode_tui::{Deps, Route, Tui};
use opentui::testing::TestApp;
use serde_json::{Value, json};

/// A request: method, path, query, and JSON body.
type Seen = Arc<Mutex<Vec<(String, String, String, Value)>>>;

struct Fixture {
    seen: Seen,
}

impl Transport for Fixture {
    fn send(&self, request: Request) -> BoxFuture<'_, Result<Response, String>> {
        let body: Value = request
            .body
            .as_ref()
            .and_then(|body| serde_json::from_slice(body).ok())
            .unwrap_or(Value::Null);
        let path = request.url.path().to_owned();
        let query = request.url.query().unwrap_or_default().to_owned();
        self.seen.lock().unwrap().push((
            request.method.to_owned(),
            path.clone(),
            query.clone(),
            body.clone(),
        ));
        let location = json!({ "directory": "/project" });
        let (status, body) = match (request.method, path.as_str()) {
            ("GET", "/api/location") => {
                let directory = if query.contains("project-new") {
                    "/project-new"
                } else {
                    "/project"
                };
                (
                    200,
                    json!({ "directory": directory, "project": { "id": "project", "directory": directory, "canonical": "/project" } }),
                )
            }
            ("GET", "/api/worktree") => (
                200,
                json!([{ "directory": "/project" }, { "directory": "/project-spike", "strategy": "git" }]),
            ),
            ("POST", "/api/worktree") => (200, json!({ "directory": "/project-new" })),
            ("GET", "/api/session") => (
                200,
                json!({ "data": [session("ses_a"), session("ses_b")], "cursor": {} }),
            ),
            ("GET", "/api/agent") => (
                200,
                json!({ "location": location, "data": [{
                    "id": "build", "name": "build", "mode": "primary", "hidden": false, "permissions": [],
                    "request": { "settings": {}, "headers": {}, "body": {} },
                }] }),
            ),
            ("GET", "/api/model") => (
                200,
                json!({ "location": location, "data": [{
                    "id": "m", "modelID": "m", "providerID": "p", "name": "Model M",
                    "capabilities": { "tools": true, "input": ["text"], "output": ["text"] },
                    "variants": [], "time": { "released": 0 }, "cost": [], "status": "active",
                    "enabled": true, "limit": { "context": 1000, "output": 100 },
                }] }),
            ),
            ("GET", "/api/provider" | "/api/integration") => {
                (200, json!({ "location": location, "data": [] }))
            }
            ("GET", "/api/config") => (200, json!([])),
            ("POST", "/api/session") => (
                200,
                json!({ "data": session(body["id"].as_str().unwrap_or("ses_new")) }),
            ),
            ("POST", path) if path.ends_with("/prompt") => (
                200,
                json!({ "data": {
                    "id": body["id"], "sessionID": path.split('/').nth(3), "time": { "created": 1 }, "type": "user",
                    "payload": { "text": body["text"] }, "delivery": "steer",
                } }),
            ),
            ("GET", path) if path.starts_with("/api/session/ses_") => {
                let id = path.split('/').nth(3).unwrap_or_default();
                match path.split('/').nth(4) {
                    None => (200, json!({ "data": session(id) })),
                    Some("message") => (200, json!({ "data": [], "cursor": {} })),
                    Some(_) => (200, json!({ "data": [] })),
                }
            }
            ("POST", path)
                if ["/model", "/agent", "/move", "/refresh"]
                    .iter()
                    .any(|end| path.ends_with(end)) =>
            {
                (204, Value::Null)
            }
            _ => (404, json!({})),
        };
        let body = if status == 204 {
            Vec::new()
        } else {
            serde_json::to_vec(&body).unwrap()
        };
        Box::pin(async move {
            Ok(Response {
                status,
                headers: vec![("content-type".into(), "application/json".into())],
                body: Box::pin(futures_util::stream::iter([Ok(Bytes::from(body))])),
            })
        })
    }
}

fn session(id: &str) -> Value {
    json!({
        "id": id, "title": format!("Session {id}"), "projectID": "project", "cost": 0,
        "agent": "build", "model": { "providerID": "p", "id": "m" },
        "tokens": { "input": 0, "output": 0, "reasoning": 0, "cache": { "read": 0, "write": 0 } },
        "time": { "created": 1, "updated": 1 },
        "location": { "directory": "/project" },
    })
}

struct Setup {
    app: TestApp,
    tui: Rc<Tui>,
    seen: Seen,
    home: tempfile::TempDir,
}

impl Setup {
    fn new(route: Route, pinned: &[&str]) -> Self {
        let home = tempfile::tempdir().unwrap();
        let state = home.path().join("state");
        std::fs::create_dir_all(&state).unwrap();
        std::fs::write(
            state.join("session.json"),
            json!({ "pinned": pinned }).to_string(),
        )
        .unwrap();
        let seen = Seen::default();
        let client = Client::with_transport(
            "http://opencode.local",
            Arc::new(Fixture { seen: seen.clone() }),
        )
        .unwrap();
        let app = TestApp::new(100, 30);
        let info = decode_text(r#"{ "tabs": { "mode": "off" }, "animations": false }"#).unwrap();
        let tui = opencode_tui::mount(
            &app,
            Deps {
                client,
                directory: "/project".into(),
                config: Resolved::new(info, |_| None),
                roots: Some(Roots {
                    paths: paths(home.path()),
                    storage_channel: "latest".into(),
                }),
                route,
                continue_: false,
                events: false,
            },
        );
        let setup = Self {
            app,
            tui,
            seen,
            home,
        };
        setup.wait_for("Model M");
        setup
    }

    fn wait_for(&self, text: &str) -> String {
        let found = self
            .app
            .wait_until(Duration::from_secs(5), || self.app.text().contains(text));
        let screen = self.app.text();
        assert!(found, "{text:?} never showed:\n{screen}");
        screen
    }

    /// Requests other than the startup and catalog reads, in order: method, path, query, body.
    fn log(&self) -> Vec<(String, String, String, Value)> {
        self.seen.lock().unwrap().clone()
    }

    fn requests(&self, method: &str, path: &str) -> Vec<(String, Value)> {
        self.log()
            .into_iter()
            .filter(|(m, p, _, _)| m == method && p == path)
            .map(|(_, _, query, body)| (query, body))
            .collect()
    }

    fn wait_request(&self, method: &str, path: &str) -> Vec<(String, Value)> {
        let found = self.app.wait_until(Duration::from_secs(5), || {
            !self.requests(method, path).is_empty()
        });
        assert!(found, "no {method} {path}: {:?}", self.log());
        self.requests(method, path)
    }

    fn wait_session(&self, id: &str) {
        let id = SessionID(id.into());
        let loaded = self.app.wait_until(Duration::from_secs(5), || {
            self.tui.data.read(|state| state.session(&id).is_some())
        });
        assert!(loaded, "{id:?} never loaded: {:?}", self.log());
    }

    /// Opens the dialog and waits until its reads are done: the list is locked while the title shows the
    /// spinner (`⋯` with animations off).
    fn open_worktrees(&self) -> String {
        self.tui.keymap.dispatch("session.move", None);
        let ready = self.app.wait_until(Duration::from_secs(5), || {
            let screen = self.app.text();
            screen.contains("/project-spike") && !screen.contains("Worktrees ⋯")
        });
        assert!(ready, "the worktrees never loaded:\n{}", self.app.text());
        self.app.text()
    }

    fn pins(&self) -> String {
        std::fs::read_to_string(self.home.path().join("state/session.json")).unwrap_or_default()
    }
}

fn paths(home: &Path) -> Paths {
    Paths {
        home: home.to_owned(),
        data: home.join("data"),
        cache: home.join("cache"),
        config: home.join("config"),
        state: home.join("state"),
        tmp: home.join("tmp"),
        bin: home.join("bin"),
        log: home.join("log"),
        repos: home.join("repos"),
    }
}

fn session_route(id: &str) -> Route {
    Route::Session {
        id: SessionID(id.into()),
    }
}

#[test]
fn a_session_moves_to_a_worktree() {
    let setup = Setup::new(session_route("ses_a"), &[]);
    setup.wait_session("ses_a");
    let screen = setup.open_worktrees();
    // A session adds `move`; the session's checkout is current.
    assert!(screen.contains("move ctrl+m"), "{screen}");
    let current = screen.find("Current").unwrap();
    let other = screen.find("Other").unwrap();
    let main = screen
        .find("/project\n")
        .or_else(|| screen.find("/project "))
        .unwrap();
    assert!(current < main && main < other, "{screen}");
    // `worktree.list`, then `worktree.refresh` once.
    setup.wait_request("POST", "/api/worktree/refresh");
    assert_eq!(
        setup.requests("GET", "/api/worktree")[0].0,
        "projectID=project"
    );

    setup.app.press("down");
    setup.app.press("ctrl+m");
    let moved = setup.wait_request("POST", "/api/session/ses_a/move");
    assert_eq!(
        moved,
        vec![(String::new(), json!({ "directory": "/project-spike" }))]
    );
    assert!(!setup.tui.dialogs.is_open());
    assert_eq!(setup.tui.route(), session_route("ses_a"));
}

#[test]
fn picking_a_worktree_goes_home_there() {
    let setup = Setup::new(session_route("ses_a"), &[]);
    setup.wait_session("ses_a");
    setup.open_worktrees();
    setup.app.press("down");
    setup.app.press("return");
    let home = setup
        .app
        .wait_until(Duration::from_secs(5), || setup.tui.route() == Route::Home);
    assert!(home, "{:?}", setup.tui.route());
    // The home prompt works in the picked checkout.
    setup.wait_for("/project-spike");
    assert!(setup.requests("POST", "/api/session/ses_a/move").is_empty());
}

#[test]
fn a_new_worktree_is_staged_on_home_and_created_by_the_first_submit() {
    let setup = Setup::new(Route::Home, &[]);
    let screen = setup.open_worktrees();
    assert!(!screen.contains("move ctrl+m"), "{screen}");
    setup.app.press("ctrl+a");
    setup.wait_for("Name worktree");
    setup.app.type_text("My Spike!");
    setup.app.press("return");
    setup.wait_for("(new worktree)");
    assert!(!setup.tui.dialogs.is_open());
    assert!(setup.requests("POST", "/api/worktree").is_empty());

    setup.app.type_text("hello");
    setup.app.press("return");
    let created = setup.wait_request("POST", "/api/worktree");
    assert_eq!(
        created[0].1,
        json!({ "projectID": "project", "name": "my-spike" })
    );
    let sessions = setup.wait_request("POST", "/api/session");
    assert_eq!(
        sessions[0].1["location"],
        json!({ "directory": "/project-new" })
    );
    let id = sessions[0].1["id"].as_str().unwrap().to_owned();
    let prompts = setup.wait_request("POST", &format!("/api/session/{id}/prompt"));
    assert_eq!(prompts[0].1["text"], "hello");
    // The worktree, then its location, then the session.
    let order: Vec<String> = setup
        .log()
        .into_iter()
        .filter(|(method, path, query, _)| {
            (method == "POST" && (path == "/api/worktree" || path == "/api/session"))
                || (path == "/api/location" && query.contains("project-new"))
        })
        .map(|(method, path, _, _)| format!("{method} {path}"))
        .collect();
    assert_eq!(
        order[..3],
        [
            "POST /api/worktree",
            "GET /api/location",
            "POST /api/session"
        ]
    );
    let opened = setup.app.wait_until(Duration::from_secs(5), || {
        setup.tui.route() == session_route(&id)
    });
    assert!(opened, "{:?}", setup.tui.route());
}

#[test]
fn quick_switch_opens_pinned_sessions_and_deletes_drop_pins() {
    let setup = Setup::new(session_route("ses_a"), &["ses_b", "ses_a"]);
    setup.wait_session("ses_a");
    // The home's list read would load it; this route reads only its own session.
    setup
        .tui
        .data
        .remember(serde_json::from_value(session("ses_b")).unwrap());
    setup.wait_session("ses_b");
    // Slot 1 is the first pin.
    setup.app.press("ctrl+x");
    setup.app.press("1");
    assert_eq!(setup.tui.route(), session_route("ses_b"));
    setup.app.press("ctrl+x");
    setup.app.press("2");
    assert_eq!(setup.tui.route(), session_route("ses_a"));
    // An empty slot does nothing.
    setup.app.press("ctrl+x");
    setup.app.press("3");
    assert_eq!(setup.tui.route(), session_route("ses_a"));

    let deleted: V2Event = serde_json::from_value(json!({
        "id": "evt_1", "created": 1, "type": "session.deleted",
        "durable": { "aggregateID": "ses_b", "seq": 1, "version": 1 },
        "data": { "sessionID": "ses_b" },
    }))
    .unwrap();
    setup.tui.data.apply(&[deleted]);
    let pruned = setup.app.wait_until(Duration::from_secs(5), || {
        setup.pins().contains(r#""ses_a""#) && !setup.pins().contains("ses_b")
    });
    assert!(pruned, "{}", setup.pins());
}
