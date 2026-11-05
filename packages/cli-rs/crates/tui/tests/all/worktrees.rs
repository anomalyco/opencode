//! Worktrees (E.11b) over a fixture server that records requests: `session.move` in a session and on home,
//! a new worktree staged on home and created by the first submit, and the quick switch slots with their
//! pins. No test touches a real service or repository.

use crate::support::{self, DIRECTORY, Fake, Harness, Log, WAIT, deref_harness};

use std::sync::Arc;

use opencode_api::generated::{SessionID, V2Event};
use opencode_tui::{Deps, Route};
use serde_json::{Value, json};

fn fake() -> Fake {
    Fake::new(|seen| {
        let path = seen.path.as_str();
        match (seen.method.as_str(), path) {
            ("GET", "/api/location") => {
                let directory = if seen.query.contains("project-new") { "/project-new" } else { "/project" };
                (
                    200,
                    json!({ "directory": directory, "project": { "id": "project", "directory": directory, "canonical": "/project" } }),
                )
            }
            ("GET", "/api/worktree") => {
                (200, json!([{ "directory": "/project" }, { "directory": "/project-spike", "strategy": "git" }]))
            }
            ("POST", "/api/worktree") => (200, json!({ "directory": "/project-new" })),
            ("GET", "/api/session") => (200, json!({ "data": [session("ses_a"), session("ses_b")], "cursor": {} })),
            ("POST", "/api/session") => {
                (200, json!({ "data": session(seen.body["id"].as_str().unwrap_or("ses_new")) }))
            }
            ("GET", _) if path.starts_with("/api/session/ses_") => {
                let id = path.split('/').nth(3).unwrap_or_default();
                match path.split('/').nth(4) {
                    None => (200, json!({ "data": session(id) })),
                    Some("message") => (200, json!({ "data": [], "cursor": {} })),
                    Some(_) => (200, json!({ "data": [] })),
                }
            }
            ("POST", _) if path.ends_with("/move") || path.ends_with("/refresh") => (204, Value::Null),
            _ => support::base(seen, DIRECTORY),
        }
    })
}

fn session(id: &str) -> Value {
    support::merge(support::catalog_session(), json!({ "id": id, "title": format!("Session {id}") }))
}

struct Setup {
    harness: Harness,
    seen: Log,
    home: tempfile::TempDir,
}

deref_harness!(Setup);

impl Setup {
    fn new(route: Route, pinned: &[&str]) -> Self {
        let home = tempfile::tempdir().unwrap();
        let state = home.path().join("state");
        std::fs::create_dir_all(&state).unwrap();
        std::fs::write(state.join("session.json"), json!({ "pinned": pinned }).to_string()).unwrap();
        let fake = fake();
        let seen = fake.log();
        let deps = Deps {
            config: support::config(support::decode(r#"{ "tabs": { "mode": "off" }, "animations": false }"#)),
            roots: support::roots(support::paths(home.path()), "latest"),
            route,
            ..support::deps(Arc::new(fake))
        };
        let setup = Self { harness: support::mount(100, 30, deps), seen, home };
        setup.wait_for("Model M");
        setup
    }

    /// Requests other than the startup and catalog reads, in order: method, path, query, body.
    fn log(&self) -> Vec<(String, String, String, Value)> {
        let seen = self.seen.lock().unwrap();
        seen.iter()
            .map(|seen| (seen.method.clone(), seen.path.clone(), seen.query.clone(), seen.body.clone()))
            .collect()
    }

    fn requests(&self, method: &str, path: &str) -> Vec<(String, Value)> {
        self.log()
            .into_iter()
            .filter(|(m, p, _, _)| m == method && p == path)
            .map(|(_, _, query, body)| (query, body))
            .collect()
    }

    fn wait_request(&self, method: &str, path: &str) -> Vec<(String, Value)> {
        let found = self.app.wait_until(WAIT, || !self.requests(method, path).is_empty());
        assert!(found, "no {method} {path}: {:?}", self.log());
        self.requests(method, path)
    }

    fn wait_session(&self, id: &str) {
        let id = SessionID(id.into());
        let loaded = self.app.wait_until(WAIT, || self.tui.data.read(|state| state.session(&id).is_some()));
        assert!(loaded, "{id:?} never loaded: {:?}", self.log());
    }

    /// Opens the dialog and waits until its reads are done: the list is locked while the title shows the
    /// spinner (`⋯` with animations off).
    fn open_worktrees(&self) -> String {
        self.tui.keymap.dispatch("session.move", None);
        let ready = self.app.wait_until(WAIT, || {
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

#[test]
fn a_session_moves_to_a_worktree() {
    let setup = Setup::new(support::session_route("ses_a"), &[]);
    setup.wait_session("ses_a");
    let screen = setup.open_worktrees();
    // A session adds `move`; the session's checkout is current.
    assert!(screen.contains("move ctrl+m"), "{screen}");
    let current = screen.find("Current").unwrap();
    let other = screen.find("Other").unwrap();
    let main = screen.find("/project\n").or_else(|| screen.find("/project ")).unwrap();
    assert!(current < main && main < other, "{screen}");
    // `worktree.list`, then `worktree.refresh` once.
    setup.wait_request("POST", "/api/worktree/refresh");
    assert_eq!(setup.requests("GET", "/api/worktree")[0].0, "projectID=project");

    setup.app.press("down");
    setup.app.press("ctrl+m");
    let moved = setup.wait_request("POST", "/api/session/ses_a/move");
    assert_eq!(moved, vec![(String::new(), json!({ "directory": "/project-spike" }))]);
    assert!(!setup.tui.dialogs.is_open());
    assert_eq!(setup.tui.route(), support::session_route("ses_a"));
}

#[test]
fn picking_a_worktree_goes_home_there() {
    let setup = Setup::new(support::session_route("ses_a"), &[]);
    setup.wait_session("ses_a");
    setup.open_worktrees();
    setup.app.press("down");
    setup.app.press("return");
    let home = setup.app.wait_until(WAIT, || setup.tui.route() == Route::Home);
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
    assert_eq!(created[0].1, json!({ "projectID": "project", "name": "my-spike" }));
    let sessions = setup.wait_request("POST", "/api/session");
    assert_eq!(sessions[0].1["location"], json!({ "directory": "/project-new" }));
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
    assert_eq!(order[..3], ["POST /api/worktree", "GET /api/location", "POST /api/session"]);
    let opened = setup.app.wait_until(WAIT, || setup.tui.route() == support::session_route(&id));
    assert!(opened, "{:?}", setup.tui.route());
}

#[test]
fn quick_switch_opens_pinned_sessions_and_deletes_drop_pins() {
    let setup = Setup::new(support::session_route("ses_a"), &["ses_b", "ses_a"]);
    setup.wait_session("ses_a");
    // The home's list read would load it; this route reads only its own session.
    setup.tui.data.remember(serde_json::from_value(session("ses_b")).unwrap());
    setup.wait_session("ses_b");
    // Slot 1 is the first pin.
    setup.app.press("ctrl+x");
    setup.app.press("1");
    assert_eq!(setup.tui.route(), support::session_route("ses_b"));
    setup.app.press("ctrl+x");
    setup.app.press("2");
    assert_eq!(setup.tui.route(), support::session_route("ses_a"));
    // An empty slot does nothing.
    setup.app.press("ctrl+x");
    setup.app.press("3");
    assert_eq!(setup.tui.route(), support::session_route("ses_a"));

    let deleted: V2Event = serde_json::from_value(json!({
        "id": "evt_1", "created": 1, "type": "session.deleted",
        "durable": { "aggregateID": "ses_b", "seq": 1, "version": 1 },
        "data": { "sessionID": "ses_b" },
    }))
    .unwrap();
    setup.tui.data.apply(&[deleted]);
    let pruned = setup.app.wait_until(WAIT, || setup.pins().contains(r#""ses_a""#) && !setup.pins().contains("ses_b"));
    assert!(pruned, "{}", setup.pins());
}
