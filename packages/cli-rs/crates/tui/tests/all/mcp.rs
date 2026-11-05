//! The MCP servers and skills dialogs (E.17b) over a fixture server.
//!
//! The `*_matches_typescript` tests are P-COMP proofs: they serve the responses of
//! `parity/component/E.17b-mcp.tsx`, hide the screen behind the dialog (the TS script renders the
//! dialog alone), send the same keys, and compare the cells with the fixtures it wrote. The other
//! tests run each action and check the requests it sent (P-REQ). No test touches a real service.

use std::rc::Rc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use bytes::Bytes;
use opencode_api::client::Client;
use opencode_api::transport::{BoxFuture, Request, Response, Transport};
use opencode_local::cli_config::{Resolved, decode_text};
use opencode_local::paths::Paths;
use opencode_parity::assert_fixture;
use opencode_store::{Catalog, Location};
use opencode_tui::app::Roots;
use opencode_tui::{Deps, Route, Tui};
use opentui::prelude::*;
use opentui::testing::TestApp;
use serde_json::{Value, json};

const DIRECTORY: &str = "/tmp/opencode/app";
/// The location query every MCP and skill request carries.
const QUERY: &str = "location%5Bdirectory%5D=%2Ftmp%2Fopencode%2Fapp";

/// One request: method, path with query, and JSON body.
type Logged = (String, String, Value);

/// `SERVERS` of `E.17b-mcp.tsx`.
fn servers() -> Value {
    json!([
        { "name": "linear", "status": { "status": "failed", "error": "MCP error -32000: Connection closed" } },
        { "name": "github", "status": { "status": "connected" } },
        { "name": "sentry", "status": { "status": "needs_auth", "error": "Authentication required" } },
        { "name": "docs", "status": { "status": "disabled" } },
        { "name": "figma", "status": { "status": "pending" } },
    ])
}

/// `SKILLS` of `E.17b-mcp.tsx`.
fn skills() -> Value {
    let skill = |id: &str, description: Option<&str>| {
        let mut skill = json!({
            "id": id, "name": id, "path": format!("/tmp/opencode/skills/{id}/SKILL.md"), "content": "",
        });
        if let Some(description) = description {
            skill["description"] = json!(description);
        }
        skill
    };
    json!([
        skill("review", Some("Review a change\n  for defects  and style.")),
        skill("release-notes", Some("Write release notes from the log.")),
        skill("bisect", None),
    ])
}

/// Serves the location, the MCP list and skills, the prompt catalog, and the writes; logs every
/// request.
struct Fixture {
    servers: Arc<Mutex<Value>>,
    /// `None` answers the skill list with a 500.
    skills: Option<Value>,
    log: Arc<Mutex<Vec<Logged>>>,
}

impl Transport for Fixture {
    fn send(&self, request: Request) -> BoxFuture<'_, Result<Response, String>> {
        let path = request.url.path().to_owned();
        let body: Value =
            request.body.as_ref().and_then(|body| serde_json::from_slice(body).ok()).unwrap_or(Value::Null);
        let full = match request.url.query() {
            Some(query) => format!("{path}?{query}"),
            None => path.clone(),
        };
        self.log.lock().unwrap().push((request.method.to_owned(), full, body.clone()));
        let location = json!({ "directory": DIRECTORY });
        let (status, body) = match (request.method, path.as_str()) {
            ("GET", "/api/location") => (
                200,
                json!({ "directory": DIRECTORY, "project": { "id": "proj_app", "directory": DIRECTORY, "canonical": DIRECTORY } }),
            ),
            ("GET", "/api/mcp") => (200, json!({ "location": location, "data": self.servers.lock().unwrap().clone() })),
            ("GET", "/api/skill") => match &self.skills {
                Some(skills) => (200, json!({ "location": location, "data": skills })),
                None => (500, json!({ "message": "skills exploded" })),
            },
            ("GET", "/api/session") => (200, json!({ "data": [], "cursor": {} })),
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
            ("GET", "/api/provider") => (200, json!({ "location": location, "data": [] })),
            ("GET", "/api/config") => (200, json!([])),
            ("GET", "/api/command") => (200, json!({ "location": location, "data": [] })),
            // `docs` fails to connect, so the error toast and the cleared loading state show.
            ("POST", "/api/experimental/mcp/docs/connect") => {
                (400, json!({ "_tag": "BadRequest", "message": "docs is disabled" }))
            }
            ("POST", path) if path.starts_with("/api/experimental/mcp/") => (204, Value::Null),
            ("POST", "/api/session") => (200, json!({ "data": session(body["id"].as_str().unwrap_or("ses_new")) })),
            ("POST", path) if path.ends_with("/prompt") => (
                200,
                json!({ "data": {
                    "id": body["id"], "sessionID": path.split('/').nth(3), "time": { "created": 1 }, "type": "user",
                    "payload": { "text": body["text"] }, "delivery": "steer",
                } }),
            ),
            ("POST", path) if path.ends_with("/model") || path.ends_with("/agent") => (204, Value::Null),
            ("GET", path) if path.ends_with("/message") => (200, json!({ "data": [], "cursor": {} })),
            _ => (404, json!({})),
        };
        let bytes = if status == 204 { Vec::new() } else { serde_json::to_vec(&body).unwrap() };
        Box::pin(async move {
            Ok(Response {
                status,
                headers: vec![("content-type".into(), "application/json".into())],
                body: Box::pin(futures_util::stream::iter([Ok(Bytes::from(bytes))])),
            })
        })
    }
}

fn session(id: &str) -> Value {
    json!({
        "id": id, "title": "New session", "projectID": "proj_app", "cost": 0,
        "tokens": { "input": 0, "output": 0, "reasoning": 0, "cache": { "read": 0, "write": 0 } },
        "time": { "created": 1, "updated": 1 },
        "location": { "directory": DIRECTORY },
    })
}

struct Kit {
    app: TestApp,
    tui: Rc<Tui>,
    servers: Arc<Mutex<Value>>,
    log: Arc<Mutex<Vec<Logged>>>,
    _home: tempfile::TempDir,
}

impl Kit {
    fn new() -> Self {
        Self::with(servers(), Some(skills()))
    }

    fn with(servers: Value, skills: Option<Value>) -> Self {
        let home = tempfile::tempdir().unwrap();
        let root = home.path().to_owned();
        let paths = Paths::from_vars(|name| (name == "HOME").then(|| root.clone().into())).unwrap();
        let log = Arc::new(Mutex::new(Vec::new()));
        let servers = Arc::new(Mutex::new(servers));
        let transport = Fixture { servers: servers.clone(), skills, log: log.clone() };
        let client = Client::with_transport("http://opencode.local", Arc::new(transport)).unwrap();
        let theme =
            opencode_ui::theme::Catalog::default().load("opencode", opencode_ui::theme::ThemeMode::Dark).unwrap().theme;
        // As the TS screen, the app clears with the page background the backdrop blends over.
        let app = TestApp::with_options(
            100,
            30,
            AppOptions {
                theme: opentui::theme::Theme { background: theme.background.base, ..opentui::theme::Theme::default() },
                light_theme: None,
                ..AppOptions::default()
            },
        );
        let info = decode_text(r#"{ "theme": { "name": "opencode", "mode": "dark" } }"#).unwrap();
        let tui = opencode_tui::mount(
            &app,
            Deps {
                client,
                directory: DIRECTORY.into(),
                config: Resolved::new(info, |_| None),
                roots: Some(Roots { paths, storage_channel: "test".into() }),
                route: Route::Home,
                continue_: false,
                events: false,
            },
        );
        let kit = Self { app, tui, servers, log, _home: home };
        // The home prompt's catalog, so slash commands and submit work.
        kit.wait_for("Model M");
        kit
    }

    fn wait_for(&self, text: &str) -> String {
        let found = self.app.wait_until(Duration::from_secs(5), || self.app.text().contains(text));
        let screen = self.app.text();
        assert!(found, "{text:?} never showed:\n{screen}");
        screen
    }

    fn wait_gone(&self, text: &str) {
        let gone = self.app.wait_until(Duration::from_secs(5), || !self.app.text().contains(text));
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

    /// Runs a command as the palette and the slash autocomplete (E.3) do.
    fn run(&self, command: &str) {
        self.tui.keymap.dispatch(command, None);
    }

    fn requests(&self, method: &str, prefix: &str) -> Vec<Logged> {
        self.log.lock().unwrap().iter().filter(|(m, url, _)| m == method && url.starts_with(prefix)).cloned().collect()
    }

    fn wait_requests(&self, method: &str, prefix: &str, count: usize) -> Vec<Logged> {
        let found = self.app.wait_until(Duration::from_secs(5), || self.requests(method, prefix).len() >= count);
        assert!(found, "no {method} {prefix}…: {:?}", self.log.lock().unwrap());
        self.requests(method, prefix)
    }

    /// Mutating requests under `/api/experimental/mcp`, in order.
    fn toggles(&self) -> Vec<String> {
        self.requests("POST", "/api/experimental/mcp/").into_iter().map(|(_, url, _)| url).collect()
    }
}

#[test]
fn mcp_dialog_matches_typescript() {
    let kit = Kit::new();
    // Both commands are in the palette under their slash names.
    for (id, slash, group) in [("mcp.list", "mcps", "Agent"), ("prompt.skills", "skills", "Prompt")] {
        let command = kit
            .tui
            .keymap
            .commands()
            .into_iter()
            .find(|command| command.id == id)
            .unwrap_or_else(|| panic!("{id} is not registered"));
        assert_eq!(command.slash.as_ref().map(|slash| slash.name.as_str()), Some(slash));
        assert_eq!(command.group.as_deref(), Some(group));
    }
    kit.run("mcp.list");
    kit.wait_for("Sign in required");
    kit.only_dialog();
    assert_fixture(&kit.app.render(), "E.17b/mcp");

    for _ in 0..3 {
        kit.app.press("down");
    }
    kit.wait_for("view error");
    assert_fixture(&kit.app.render(), "E.17b/mcp-failed");

    kit.app.press("return");
    kit.wait_for("MCP server: linear");
    assert_fixture(&kit.app.render(), "E.17b/mcp-error");
}

#[test]
fn skills_dialog_matches_typescript() {
    let kit = Kit::new();
    kit.run("prompt.skills");
    kit.wait_for("bisect");
    kit.only_dialog();
    assert_fixture(&kit.app.render(), "E.17b/skills");

    kit.app.type_text("rel");
    kit.wait_gone("bisect");
    assert_fixture(&kit.app.render(), "E.17b/skills-filter");

    let kit = Kit::with(servers(), Some(json!([])));
    kit.run("prompt.skills");
    kit.wait_for("No skills available");
    kit.only_dialog();
    assert_fixture(&kit.app.render(), "E.17b/skills-empty");
}

#[test]
fn mcp_dialog_reads_the_list_once_and_space_toggles_each_server() {
    let mut list = servers();
    list.as_array_mut().unwrap().push(json!({
        "name": "notion", "status": { "status": "needs_auth", "error": "Authentication required" },
        "integrationID": "mcp_notion",
    }));
    let kit = Kit::with(list, Some(skills()));
    kit.run("mcp.list");
    kit.wait_for("Sign in required");
    assert_eq!(kit.requests("GET", "/api/mcp"), [("GET".into(), format!("/api/mcp?{QUERY}"), Value::Null)]);
    // Sorted: docs, figma, github, linear, notion, sentry.
    let space_at = |downs: usize| {
        kit.app.press("home");
        for _ in 0..downs {
            kit.app.press("down");
        }
        kit.app.press("space");
    };

    // github is connected: disconnect. The action title follows the selection.
    space_at(2);
    kit.wait_for("disconnect space");
    kit.wait_requests("POST", "/api/experimental/mcp/", 1);
    // linear failed: retry connects. sentry needs sign-in without an integration: connect.
    space_at(3);
    kit.wait_requests("POST", "/api/experimental/mcp/", 2);
    space_at(5);
    kit.wait_requests("POST", "/api/experimental/mcp/", 3);
    // figma is pending: no request.
    space_at(1);
    // docs is disabled: connect, which fails with a toast and leaves the row as it was.
    space_at(0);
    kit.wait_requests("POST", "/api/experimental/mcp/", 4);
    kit.wait_for("docs is disabled");
    // Only figma, which is pending, still reads "Connecting".
    let settled = kit.app.wait_until(Duration::from_secs(5), || kit.app.text().matches("Connecting …").count() == 1);
    assert!(settled, "{}", kit.app.text());
    assert_eq!(
        kit.toggles(),
        [
            format!("/api/experimental/mcp/github/disconnect?{QUERY}"),
            format!("/api/experimental/mcp/linear/connect?{QUERY}"),
            format!("/api/experimental/mcp/sentry/connect?{QUERY}"),
            format!("/api/experimental/mcp/docs/connect?{QUERY}"),
        ]
    );
    // Every toggle is a bodiless POST that the server answers with 204 (docs: 400).
    assert!(kit.requests("POST", "/api/experimental/mcp/").iter().all(|(_, _, body)| body.is_null()));
    // notion signs in through its integration: the integration dialog opens (E.17a) instead of a toggle. This
    // fixture serves no integrations, so it shows none.
    space_at(4);
    kit.wait_for("No integrations available");
    assert_eq!(kit.toggles().len(), 4);
}

#[test]
fn mcp_dialog_follows_the_store_after_a_status_change() {
    let kit = Kit::new();
    kit.run("mcp.list");
    kit.wait_for("Sign in required");
    // What `mcp.status.changed` does after its settle: invalidate the list and read it again.
    kit.servers.lock().unwrap()[1]["status"] = json!({ "status": "disabled" });
    let location = Location::new(DIRECTORY);
    kit.tui.data.catalog_invalidate(Catalog::McpServer, Some(&location));
    let read = kit.tui.data.catalog_sync(Catalog::McpServer, Some(&location));
    kit.tui.app.runtime().spawn(read);
    kit.wait_gone("Connected ✓");
    let screen = kit.app.text();
    assert_eq!(screen.matches("Disabled ○").count(), 2, "{screen}");
}

#[test]
fn mcp_error_view_goes_back_copies_and_investigates() {
    let kit = Kit::new();
    kit.run("mcp.list");
    kit.wait_for("Sign in required");
    for _ in 0..3 {
        kit.app.press("down");
    }
    kit.app.press("return");
    kit.wait_for("MCP server: linear");
    // Escape goes back to the list, on the failed server.
    kit.app.press("escape");
    kit.wait_for("view error enter");
    assert!(kit.app.text().contains("retry space"));

    kit.app.press("return");
    kit.wait_for("investigate i");
    // `TestApp` has no terminal, so the copy fails with a toast (the live run copies).
    kit.app.press("c");
    kit.wait_for("Failed to copy to clipboard");
    kit.app.press("i");
    kit.wait_for("Investigate why");
    assert!(!kit.tui.dialogs.is_open());
    let text = kit.tui.textarea.borrow().as_ref().unwrap().text();
    for part in [
        "Investigate why this OpenCode component failed in the current project.",
        "MCP server: linear\nStatus: failed\nConfiguration: mcp.servers.linear\nError: MCP error -32000: Connection closed",
        "project and global OpenCode configuration",
    ] {
        assert!(text.contains(part), "{part:?} missing from {text:?}");
    }
    assert!(kit.toggles().is_empty());
}

#[test]
fn picking_a_skill_mentions_it_and_the_prompt_sends_it() {
    let kit = Kit::new();
    kit.run("prompt.skills");
    kit.wait_for("bisect");
    assert_eq!(kit.requests("GET", "/api/skill"), [("GET".into(), format!("/api/skill?{QUERY}"), Value::Null)]);
    kit.app.type_text("rel");
    kit.wait_gone("bisect");
    kit.app.press("return");
    kit.wait_gone("Skills");
    let textarea = kit.tui.textarea.borrow().clone().unwrap();
    assert_eq!(textarea.text(), "@release-notes ");

    // A second pick of the same skill inserts nothing; the list is cached, so it is not read again.
    kit.app.type_text("go");
    kit.slash_dialog_pick("release-notes");
    assert_eq!(textarea.text(), "@release-notes go");
    assert_eq!(kit.requests("GET", "/api/skill").len(), 1);

    kit.app.press("return");
    let prompts = || -> Vec<Value> {
        kit.requests("POST", "/api/session/")
            .into_iter()
            .filter(|(_, url, _)| url.ends_with("/prompt"))
            .map(|(_, _, body)| body)
            .collect()
    };
    let sent = kit.app.wait_until(Duration::from_secs(5), || !prompts().is_empty());
    assert!(sent, "no prompt: {:?}", kit.log.lock().unwrap());
    let prompt = prompts().remove(0);
    assert_eq!(prompt["text"], "@release-notes go");
    assert_eq!(
        prompt["skills"],
        json!([{ "id": "release-notes", "mention": { "start": 0, "end": 14, "text": "@release-notes" } }])
    );
}

#[test]
fn skills_dialog_shows_a_failed_read() {
    let kit = Kit::with(servers(), None);
    kit.run("prompt.skills");
    let screen = kit.wait_for("Could not load skills");
    assert!(screen.contains("Close and reopen Skills to try again."), "{screen}");
    // Locked while failed: typing does not filter.
    assert!(!screen.contains("Search"), "{screen}");
}

impl Kit {
    /// Opens the skills dialog through the palette command and picks `id`.
    fn slash_dialog_pick(&self, id: &str) {
        self.tui.keymap.dispatch("prompt.skills", None);
        self.wait_for("bisect");
        self.app.type_text(id);
        self.app.press("return");
        self.wait_gone("Skills");
    }
}
