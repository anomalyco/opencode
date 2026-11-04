//! The session list and open dialogs (E.11a) over a fixture server.
//!
//! The `*_matches_typescript` tests are P-COMP proofs: they serve the responses of
//! `parity/component/E.11a-sessions.tsx`, hide the screen behind the dialog (the TS script renders
//! the dialog alone), send the same keys, and compare the cells with the fixtures it wrote. The
//! other tests run each action and check the requests it sent (P-REQ). No test touches a real
//! service.

use std::rc::Rc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use bytes::Bytes;
use chrono::TimeZone;
use opencode_api::client::Client;
use opencode_api::generated::SessionID;
use opencode_api::transport::{BoxFuture, Request, Response, Transport};
use opencode_local::cli_config::{Resolved, decode_text};
use opencode_local::paths::Paths;
use opencode_parity::assert_fixture;
use opencode_tui::app::Roots;
use opencode_tui::{Deps, Route, Tui};
use opentui::prelude::*;
use opentui::testing::TestApp;
use serde_json::{Value, json};

const DIRECTORY: &str = "/tmp/opencode/app";

#[derive(Clone, Copy, PartialEq)]
enum Mode {
    /// The session list's sessions, at fixed dates (they show as date headings).
    List,
    /// The open dialog's sessions, relative to now (they show as `5m`, `3h`, …).
    Open,
}

/// One request: method, path with query, and JSON body.
type Logged = (String, String, Option<Value>);

/// Serves the responses of `E.11a-sessions.tsx` and logs every request.
struct Fixture {
    mode: Mode,
    now: f64,
    log: Arc<Mutex<Vec<Logged>>>,
    /// Status of `DELETE /api/session/:id`.
    delete_status: u16,
}

impl Transport for Fixture {
    fn send(&self, request: Request) -> BoxFuture<'_, Result<Response, String>> {
        let path = request.url.path().to_owned();
        let query: Vec<(String, String)> = request.url.query_pairs().into_owned().collect();
        let param = |name: &str| {
            query
                .iter()
                .find(|(key, _)| key == name)
                .map(|(_, value)| value.clone())
        };
        let body = request
            .body
            .as_ref()
            .and_then(|body| serde_json::from_slice(body).ok());
        let full = match request.url.query() {
            Some(query) => format!("{path}?{query}"),
            None => path.clone(),
        };
        self.log
            .lock()
            .unwrap()
            .push((request.method.to_owned(), full, body));
        let (status, body) = match (request.method, path.as_str()) {
            ("GET", "/api/location") => (
                200,
                json!({ "directory": DIRECTORY, "project": { "id": "proj_app", "directory": DIRECTORY, "canonical": DIRECTORY } }),
            ),
            ("GET", "/api/project") => (200, projects()),
            ("GET", "/api/worktree") => {
                (200, json!([{ "directory": "/tmp/opencode/app-feature" }]))
            }
            ("POST", "/api/worktree") => (200, json!({ "directory": "/tmp/opencode/app-new" })),
            ("POST", "/api/worktree/refresh") => (204, Value::Null),
            ("GET", "/api/session") => {
                let all = param("project").is_none() && param("directory").is_none();
                let (base, extra) = match self.mode {
                    Mode::List => (scoped(), other()),
                    Mode::Open => (recent(self.now), recent_other(self.now)),
                };
                let mut sessions = base;
                if all {
                    sessions.push(extra);
                }
                sessions.sort_by(|a, b| {
                    b["time"]["updated"]
                        .as_f64()
                        .unwrap()
                        .total_cmp(&a["time"]["updated"].as_f64().unwrap())
                });
                if let Some(search) = param("search") {
                    sessions.retain(|session| {
                        session["title"]
                            .as_str()
                            .is_some_and(|title| title.to_lowercase().contains(&search))
                    });
                }
                (200, json!({ "data": sessions, "cursor": {} }))
            }
            ("DELETE", _) if path.starts_with("/api/session/") => (
                self.delete_status,
                json!({ "_tag": "NotFound", "message": "gone" }),
            ),
            ("PATCH", _) if path.starts_with("/api/session/") => (204, Value::Null),
            ("GET", _) if path.starts_with("/api/session/") && path.ends_with("/message") => {
                (200, json!({ "data": [], "cursor": {} }))
            }
            ("GET", _) if path.starts_with("/api/session/") => {
                let id = path.trim_start_matches("/api/session/");
                match scoped().into_iter().find(|session| session["id"] == id) {
                    Some(session) => (200, json!({ "data": session })),
                    None => (404, json!({})),
                }
            }
            _ => (404, json!({})),
        };
        let bytes = if status == 204 {
            Vec::new()
        } else {
            serde_json::to_vec(&body).unwrap()
        };
        Box::pin(async move {
            Ok(Response {
                status,
                headers: vec![("content-type".into(), "application/json".into())],
                body: Box::pin(futures_util::stream::iter([Ok(Bytes::from(bytes))])),
            })
        })
    }
}

fn noon(day: u32) -> f64 {
    chrono::Utc
        .with_ymd_and_hms(2026, 3, day, 12, 0, 0)
        .unwrap()
        .timestamp_millis() as f64
}

fn session(id: &str, title: Option<&str>, updated: f64, extra: Value) -> Value {
    let mut session = json!({
        "id": id, "projectID": "proj_app", "cost": 0,
        "tokens": { "input": 0, "output": 0, "reasoning": 0, "cache": { "read": 0, "write": 0 } },
        "time": { "created": updated, "updated": updated },
        "location": { "directory": DIRECTORY },
    });
    if let Some(title) = title {
        session["title"] = json!(title);
    }
    for (key, value) in extra.as_object().unwrap() {
        session[key] = value.clone();
    }
    session
}

fn scoped() -> Vec<Value> {
    vec![
        session(
            "ses_b",
            Some("Write docs"),
            noon(3) - 3_600_000.0,
            json!({}),
        ),
        session("ses_a", Some("Fix the parser"), noon(3), json!({})),
        session(
            "ses_c",
            None,
            noon(1),
            json!({ "location": { "directory": "/tmp/opencode/app-feature" } }),
        ),
    ]
}

fn other() -> Value {
    session(
        "ses_d",
        Some("Other project"),
        noon(2),
        json!({ "projectID": "proj_other", "location": { "directory": "/tmp/other" } }),
    )
}

fn recent(now: f64) -> Vec<Value> {
    vec![
        session(
            "ses_r1",
            Some("Review the plan"),
            now - 5.0 * 60_000.0,
            json!({}),
        ),
        session(
            "ses_r2",
            Some("Fix the parser"),
            now - 3.0 * 3_600_000.0,
            json!({}),
        ),
        session(
            "ses_r3",
            Some("Explore the worktree"),
            now - 2.0 * 86_400_000.0,
            json!({ "location": { "directory": "/tmp/opencode/app-feature" } }),
        ),
    ]
}

fn recent_other(now: f64) -> Value {
    session(
        "ses_r4",
        Some("Other project"),
        now - 40.0 * 86_400_000.0,
        json!({ "projectID": "proj_other", "location": { "directory": "/tmp/other" } }),
    )
}

fn projects() -> Value {
    json!([
        { "id": "proj_app", "canonical": DIRECTORY, "name": "App", "vcs": "git",
          "time": { "created": 1, "updated": 2, "active": 3 }, "sandboxes": [] },
        { "id": "proj_other", "canonical": "/tmp/other",
          "time": { "created": 1, "updated": 2, "active": 2 }, "sandboxes": [] },
    ])
}

struct Kit {
    app: TestApp,
    tui: Rc<Tui>,
    log: Arc<Mutex<Vec<Logged>>>,
    state: std::path::PathBuf,
    _home: tempfile::TempDir,
}

impl Kit {
    fn new(mode: Mode) -> Self {
        Self::with(mode, 200)
    }

    fn with(mode: Mode, delete_status: u16) -> Self {
        let home = tempfile::tempdir().unwrap();
        let root = home.path().to_owned();
        let paths = Paths::from_vars(|name| (name == "HOME").then(|| root.clone().into())).unwrap();
        std::fs::create_dir_all(&paths.state).unwrap();
        std::fs::write(paths.state.join("session.json"), r#"{"pinned":["ses_b"]}"#).unwrap();
        let state = paths.state.clone();
        let log = Arc::new(Mutex::new(Vec::new()));
        let transport = Fixture {
            mode,
            now: opencode_tui::dialogs::session_list::now_ms(),
            log: log.clone(),
            delete_status,
        };
        let client = Client::with_transport("http://opencode.local", Arc::new(transport)).unwrap();
        let theme = opencode_ui::theme::Catalog::default()
            .load("opencode", opencode_ui::theme::ThemeMode::Dark)
            .unwrap()
            .theme;
        // As the TS screen, the app clears with the page background the backdrop blends over.
        let app = TestApp::with_options(
            100,
            34,
            AppOptions {
                theme: opentui::theme::Theme {
                    background: theme.background.base,
                    ..opentui::theme::Theme::default()
                },
                light_theme: None,
                ..AppOptions::default()
            },
        );
        let info = decode_text(
            r#"{ "tabs": { "mode": "off" }, "theme": { "name": "opencode", "mode": "dark" } }"#,
        )
        .unwrap();
        let tui = opencode_tui::mount(
            &app,
            Deps {
                client,
                directory: DIRECTORY.into(),
                config: Resolved::new(info, |_| None),
                roots: Some(Roots {
                    paths,
                    storage_channel: "test".into(),
                }),
                route: Route::Home,
                continue_: false,
                events: false,
            },
        );
        let kit = Self {
            app,
            tui,
            log,
            state,
            _home: home,
        };
        // The scoped sessions go into the store, as the TS script remembers them. The read names the
        // `directory`, so `dialog_reads` leaves it out.
        let ids: Vec<&str> = match mode {
            Mode::List => vec!["ses_a", "ses_b", "ses_c"],
            Mode::Open => vec!["ses_r1", "ses_r2", "ses_r3"],
        };
        let tui = kit.tui.clone();
        let client = tui.data.client().clone();
        let remember = tui.weak();
        tui.app.spawn(
            async move {
                client
                    .session_list(
                        &opencode_api::generated::SessionListInput {
                            limit: Some(50),
                            parent_id: Some(None),
                            directory: Some(DIRECTORY.to_owned().into()),
                            ..Default::default()
                        },
                        &opencode_api::client::RequestOptions::default(),
                    )
                    .await
            },
            move |_, result| {
                let tui = remember.upgrade().unwrap();
                for session in result.unwrap().data {
                    tui.data.remember(session);
                }
            },
        );
        assert!(
            kit.app.wait_until(Duration::from_secs(5), || {
                tui.data.read(|state| {
                    ids.iter()
                        .all(|id| state.session(&SessionID((*id).into())).is_some())
                })
            }),
            "the home never loaded the sessions:\n{}",
            kit.app.text()
        );
        kit
    }

    fn wait_for(&self, text: &str) -> String {
        let found = self
            .app
            .wait_until(Duration::from_secs(5), || self.app.text().contains(text));
        let screen = self.app.text();
        assert!(found, "{text:?} never showed:\n{screen}");
        screen
    }

    fn wait_gone(&self, text: &str) {
        let gone = self
            .app
            .wait_until(Duration::from_secs(5), || !self.app.text().contains(text));
        assert!(gone, "{text:?} stayed:\n{}", self.app.text());
    }

    /// Hides everything but the dialog host, as the TS script renders the dialog alone.
    fn only_dialog(&self) {
        let host = self.tui.dialogs.host().id();
        for child in self.app.root().children() {
            if child.id() != host {
                child.visible(false);
            }
        }
    }

    fn requests(&self) -> Vec<Logged> {
        self.log.lock().unwrap().clone()
    }

    /// The dialog's reads, in order: location, projects, and sessions. The home's own list read
    /// (by `directory`; a theme change that alters the colors remounts the home, which reads again) and the
    /// prompt's catalog reads after connect are left out; TS does not order those against the
    /// dialog.
    fn dialog_reads(&self) -> Vec<String> {
        self.requests()
            .into_iter()
            .filter(|(method, url, _)| {
                method == "GET"
                    && ["/api/location?", "/api/project", "/api/session?"]
                        .iter()
                        .any(|path| url.starts_with(path))
                    && !url.contains("&directory=")
            })
            .map(|(_, url, _)| url)
            .collect()
    }

    fn clear_log(&self) {
        self.log.lock().unwrap().clear();
    }

    /// Mutating requests, in order.
    fn mutations(&self) -> Vec<Logged> {
        self.requests()
            .into_iter()
            .filter(|(method, _, _)| method != "GET")
            .collect()
    }

    fn open_list(&self) -> String {
        self.app.press("ctrl+x");
        self.app.press("l");
        assert!(self.tui.dialogs.is_open(), "{}", self.app.text());
        self.wait_for("Fix the parser")
    }

    fn pins(&self) -> Value {
        let file = self.state.join("session.json");
        let read = || {
            std::fs::read_to_string(&file)
                .ok()
                .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        };
        read().unwrap()
    }
}

#[test]
fn session_list_matches_typescript() {
    let kit = Kit::new(Mode::List);
    kit.open_list();
    kit.wait_gone("Loading");
    kit.only_dialog();
    assert_fixture(&kit.app.render(), "E.11a/sessions");

    kit.app.press("ctrl+d");
    kit.wait_for("again to confirm");
    assert_fixture(&kit.app.render(), "E.11a/sessions-delete");
}

#[test]
fn session_list_scope_and_search_match_typescript() {
    let kit = Kit::new(Mode::List);
    kit.open_list();
    kit.wait_gone("Loading");
    kit.app.press("ctrl+a");
    kit.wait_for("Other project");
    kit.only_dialog();
    assert_fixture(&kit.app.render(), "E.11a/sessions-all");

    let kit = Kit::new(Mode::List);
    kit.open_list();
    kit.wait_gone("Loading");
    kit.app.type_text("docs");
    kit.app.advance(Duration::from_millis(200));
    kit.wait_gone("Tue Mar 03 2026");
    kit.only_dialog();
    assert_fixture(&kit.app.render(), "E.11a/sessions-search");
}

#[test]
fn open_dialog_matches_typescript() {
    let kit = Kit::new(Mode::Open);
    kit.app.press("ctrl+o");
    kit.wait_for("Other project");
    kit.wait_gone("Refreshing");
    kit.only_dialog();
    assert_fixture(&kit.app.render(), "E.11a/open");

    for _ in 0..4 {
        kit.app.press("down");
    }
    kit.app.press("right");
    kit.wait_for("app-feature    ");
    assert_fixture(&kit.app.render(), "E.11a/open-worktrees");
}

#[test]
fn session_list_reads_the_scoped_list_then_all_projects_and_saves_the_scope() {
    let kit = Kit::new(Mode::List);
    kit.clear_log();
    kit.open_list();
    kit.wait_gone("Loading");
    assert_eq!(
        kit.dialog_reads(),
        [
            "/api/location?location%5Bdirectory%5D=%2Ftmp%2Fopencode%2Fapp",
            "/api/project",
            "/api/session?limit=50&order=desc&parentID=null&archived=false&project=proj_app&subpath=",
        ],
    );

    kit.clear_log();
    kit.app.press("ctrl+a");
    kit.wait_for("Other project");
    assert_eq!(
        kit.dialog_reads(),
        ["/api/session?limit=50&order=desc&parentID=null&archived=false"]
    );
    let file = kit.tui.storage().unwrap().file("session-list").unwrap();
    assert!(kit.app.wait_until(Duration::from_secs(5), || {
        std::fs::read_to_string(&file)
            .ok()
            .and_then(|text| serde_json::from_str::<Value>(&text).ok())
            .is_some_and(|value| value == json!({ "allProjects": true }))
    }));

    // The search reads once, after the debounce.
    kit.clear_log();
    kit.app.type_text("docs");
    assert!(kit.dialog_reads().is_empty(), "{:?}", kit.requests());
    kit.app.advance(Duration::from_millis(200));
    // The dialog's date heading goes; the home behind keeps its own rows.
    kit.wait_gone("Tue Mar 03 2026");
    assert_eq!(
        kit.dialog_reads(),
        ["/api/session?limit=50&order=desc&search=docs&parentID=null&archived=false"]
    );
}

#[test]
fn delete_needs_a_second_press_and_removes_the_row() {
    let kit = Kit::new(Mode::List);
    kit.open_list();
    kit.wait_gone("Loading");
    kit.clear_log();
    kit.app.press("ctrl+d");
    kit.wait_for("Press ctrl+d again to confirm");
    assert!(kit.mutations().is_empty(), "one press only marks the row");

    // Moving clears the mark.
    kit.app.press("down");
    kit.wait_gone("again to confirm");
    kit.app.press("up");
    kit.app.press("ctrl+d");
    kit.wait_for("again to confirm");
    kit.app.press("ctrl+d");
    kit.wait_gone("again to confirm");
    assert_eq!(
        kit.mutations(),
        [("DELETE".to_owned(), "/api/session/ses_b".to_owned(), None)]
    );
    assert!(kit.tui.dialogs.is_open());
}

#[test]
fn a_failed_delete_shows_a_toast_and_keeps_the_row() {
    let kit = Kit::with(Mode::List, 404);
    kit.open_list();
    kit.wait_gone("Loading");
    kit.app.press("ctrl+d");
    kit.app.press("ctrl+d");
    kit.wait_for("Failed to delete session");
    let screen = kit.wait_for("Write docs");
    assert!(!screen.contains("again to confirm"), "{screen}");
}

#[test]
fn pin_toggles_session_json() {
    let kit = Kit::new(Mode::List);
    kit.open_list();
    kit.wait_for("Pinned");
    // ses_b is pinned; unpin it.
    kit.app.press("ctrl+f");
    kit.wait_gone("Pinned");
    assert!(
        kit.app.wait_until(Duration::from_secs(5), || {
            kit.pins() == json!({ "pinned": [] })
        }),
        "{}\n{}",
        kit.pins(),
        kit.app.text()
    );
    // Pin the first row again (ses_a is newest).
    kit.app.press("ctrl+f");
    kit.wait_for("Pinned");
    assert!(kit.app.wait_until(Duration::from_secs(5), || {
        kit.pins() == json!({ "pinned": ["ses_a"] })
    }));
    assert!(kit.mutations().is_empty(), "pins are local");
}

#[test]
fn rename_opens_the_prompt_and_patches_the_title() {
    let kit = Kit::new(Mode::List);
    kit.open_list();
    kit.wait_gone("Loading");
    kit.clear_log();
    kit.app.press("ctrl+r");
    kit.wait_for("Rename session");
    for _ in 0.."Write docs".len() {
        kit.app.press("backspace");
    }
    kit.app.type_text("Ship docs");
    kit.app.press("enter");
    assert!(
        kit.app
            .wait_until(Duration::from_secs(5), || !kit.tui.dialogs.is_open()),
        "{}",
        kit.app.text()
    );
    assert_eq!(
        kit.mutations(),
        [(
            "PATCH".to_owned(),
            "/api/session/ses_b".to_owned(),
            Some(json!({ "title": "Ship docs" }))
        )]
    );
}

#[test]
fn enter_opens_the_selected_session() {
    let kit = Kit::new(Mode::List);
    kit.open_list();
    kit.wait_gone("Loading");
    kit.app.press("down");
    kit.app.press("enter");
    assert!(kit.app.wait_until(Duration::from_secs(5), || {
        kit.tui.route()
            == Route::Session {
                id: SessionID("ses_a".into()),
            }
    }));
    assert!(!kit.tui.dialogs.is_open());
}

#[test]
fn open_dialog_reads_worktrees_and_creates_one() {
    let kit = Kit::new(Mode::Open);
    kit.app.press("ctrl+o");
    kit.wait_for("Other project");
    kit.wait_gone("Refreshing");
    // A second ctrl+o leaves the open dialog alone.
    kit.app.press("ctrl+o");
    kit.wait_for("Other project");

    kit.clear_log();
    for _ in 0..4 {
        kit.app.press("down");
    }
    kit.app.press("right");
    kit.wait_for("App / Worktrees");
    kit.wait_for("app-feature    ");
    // Only the worktree requests: the prompt's catalog reads after connect are not ordered against them.
    let requests: Vec<(String, String)> = kit
        .requests()
        .into_iter()
        .filter(|(_, url, _)| url.starts_with("/api/worktree"))
        .map(|(method, url, _)| (method, url))
        .collect();
    assert_eq!(
        requests,
        [
            (
                "GET".to_owned(),
                "/api/worktree?projectID=proj_app".to_owned()
            ),
            ("POST".to_owned(), "/api/worktree/refresh".to_owned()),
        ]
    );

    // Left returns to the projects with the project still selected.
    kit.app.press("left");
    kit.wait_for("Projects");
    kit.app.press("right");
    kit.wait_for("App / Worktrees");
    // The worktree refresh runs once per project.
    kit.clear_log();
    kit.app.press("ctrl+n");
    kit.wait_for("Leave blank for a random name.");
    kit.app.type_text("spike");
    kit.app.press("enter");
    assert!(
        kit.app
            .wait_until(Duration::from_secs(5), || !kit.tui.dialogs.is_open()),
        "{}",
        kit.app.text()
    );
    assert_eq!(
        kit.mutations(),
        [(
            "POST".to_owned(),
            "/api/worktree".to_owned(),
            Some(json!({ "projectID": "proj_app", "name": "spike" }))
        )]
    );
    assert_eq!(kit.tui.route(), Route::Home);
}

#[test]
fn open_dialog_opens_a_session() {
    let kit = Kit::new(Mode::Open);
    kit.app.press("ctrl+o");
    kit.wait_for("Other project");
    kit.app.press("down");
    kit.app.press("enter");
    assert!(kit.app.wait_until(Duration::from_secs(5), || {
        kit.tui.route()
            == Route::Session {
                id: SessionID("ses_r2".into()),
            }
    }));
}
