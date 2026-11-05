//! "Connect an integration" (E.17a) over a fixture server.
//!
//! `integrations_match_typescript` is the P-COMP proof: it serves the responses of
//! `parity/component/E.17a-integrations.tsx`, hides the screen behind the dialog (the TS script renders the
//! dialog alone), sends the same keys, and compares the cells with the fixtures it wrote. The other tests run
//! each flow and check the requests it sent (P-REQ). No test touches a real service or opens a browser: the
//! URL opener is a sink.

use std::cell::RefCell;
use std::rc::Rc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use bytes::Bytes;
use opencode_api::client::Client;
use opencode_api::generated::IntegrationID;
use opencode_api::transport::{BoxFuture, Request, Response, Transport};
use opencode_local::cli_config::{Resolved, decode_text};
use opencode_local::paths::Paths;
use opencode_parity::assert_fixture;
use opencode_tui::app::Roots;
use opencode_tui::{Deps, Route, Tui};
use opentui::prelude::*;
use opentui::testing::TestApp;
use serde_json::{Value, json};

use crate::support::wait::WAIT;

const DIRECTORY: &str = "/tmp/opencode/app";
/// The location query every integration request carries.
const QUERY: &str = "location%5Bdirectory%5D=%2Ftmp%2Fopencode%2Fapp";

/// One request: method, path with query, and JSON body.
type Logged = (String, String, Value);

fn credential(id: &str, label: &str, status: Option<Value>) -> Value {
    let mut value = json!({ "type": "credential", "id": id, "label": label, "method": "key" });
    if let Some(status) = status {
        value["status"] = status;
    }
    value
}

/// `INTEGRATIONS` of `E.17a-integrations.tsx`.
fn integrations() -> Value {
    json!([
        {
            "id": "opencode", "name": "OpenCode Console",
            "methods": [{ "type": "oauth", "id": "device", "label": "Sign in with OpenCode" }],
            "connections": [credential("cred_work", "work", None), credential("cred_home", "home", None)],
        },
        {
            "id": "openai", "name": "OpenAI",
            "methods": [
                { "type": "key", "label": "API key" },
                { "type": "oauth", "id": "browser", "label": "ChatGPT Plus/Pro" },
            ],
            "connections": [],
        },
        {
            "id": "anthropic", "name": "Anthropic",
            "methods": [{ "type": "key" }],
            "connections": [credential("cred_ant", "personal", Some(json!({ "status": "expired", "message": "Expired" })))],
        },
        {
            "id": "github-copilot", "name": "GitHub Copilot",
            "methods": [{
                "type": "oauth", "id": "device", "label": "Sign in with GitHub",
                "form": [{
                    "key": "deployment", "type": "string", "title": "Deployment", "required": true,
                    "options": [
                        { "value": "github.com", "label": "GitHub.com", "description": "Public" },
                        { "value": "enterprise", "label": "GitHub Enterprise" },
                    ],
                }],
            }],
            "connections": [],
        },
        {
            "id": "acme", "name": "Acme",
            "methods": [{ "type": "key" }, { "type": "env", "names": ["ACME_KEY"] }],
            "connections": [{ "type": "env", "name": "ACME_KEY" }],
        },
        { "id": "zed", "name": "Zed", "methods": [{ "type": "env", "names": ["ZED_KEY"] }], "connections": [] },
        {
            "id": "mcp_notion", "name": "Notion", "metadata": { "source": "mcp" },
            "methods": [{ "type": "oauth", "id": "mcp", "label": "Sign in" }],
            "connections": [],
        },
    ])
}

/// `ATTEMPT` of `E.17a-integrations.tsx`.
fn attempt() -> Value {
    json!({
        "attemptID": "att_1", "url": "https://github.com/login/device", "instructions": "Enter code ABCD-1234",
        "mode": "auto", "time": { "created": 1, "expires": 2 },
    })
}

/// Serves the integrations, the catalog, and every write; logs every request.
struct Fixture {
    integrations: Arc<Mutex<Value>>,
    /// What OAuth and command status polls answer.
    status: Arc<Mutex<Value>>,
    /// The OAuth attempt's mode.
    mode: &'static str,
    log: Arc<Mutex<Vec<Logged>>>,
}

impl Transport for Fixture {
    fn send(&self, request: Request) -> BoxFuture<'_, Result<Response, String>> {
        let path = request.url.path().to_owned();
        let body: Value = request
            .body
            .as_ref()
            .and_then(|body| serde_json::from_slice(body).ok())
            .unwrap_or(Value::Null);
        let full = match request.url.query() {
            Some(query) => format!("{path}?{query}"),
            None => path.clone(),
        };
        self.log
            .lock()
            .unwrap()
            .push((request.method.to_owned(), full, body.clone()));
        let location = json!({ "directory": DIRECTORY });
        let (status, body) = match (request.method, path.as_str()) {
            ("GET", "/api/location") => (
                200,
                json!({ "directory": DIRECTORY, "project": { "id": "proj_app", "directory": DIRECTORY, "canonical": DIRECTORY } }),
            ),
            ("GET", "/api/integration") => (
                200,
                json!({ "location": location, "data": self.integrations.lock().unwrap().clone() }),
            ),
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
                    "id": "m", "modelID": "m", "providerID": "openai", "name": "Model M",
                    "capabilities": { "tools": true, "input": ["text"], "output": ["text"] },
                    "variants": [], "time": { "released": 0 }, "cost": [], "status": "active",
                    "enabled": true, "limit": { "context": 1000, "output": 100 },
                }] }),
            ),
            ("GET", "/api/provider") => (
                200,
                json!({ "location": location, "data": [{
                    "id": "openai", "integrationID": "openai", "name": "OpenAI", "activation": "auto", "package": "openai",
                }] }),
            ),
            ("GET", "/api/config") => (200, json!([])),
            ("GET", "/api/command") => (200, json!({ "location": location, "data": [] })),
            ("GET", "/api/mcp") => (200, json!({ "location": location, "data": [] })),
            // A wrong key is rejected with the server's message.
            ("POST", "/api/integration/anthropic/connect/key") => (
                400,
                json!({ "_tag": "BadRequest", "message": "Invalid API key" }),
            ),
            ("POST", path) if path.ends_with("/connect/oauth") => {
                let mut attempt = attempt();
                attempt["mode"] = json!(self.mode);
                (200, json!({ "location": location, "data": attempt }))
            }
            ("POST", path) if path.ends_with("/connect/command") => (
                200,
                json!({ "location": location, "data": { "attemptID": "att_cmd", "time": { "created": 1, "expires": 2 } } }),
            ),
            ("GET", path) if path.contains("/connect/") => (
                200,
                json!({ "location": location, "data": self.status.lock().unwrap().clone() }),
            ),
            ("POST" | "PATCH" | "DELETE", _) => (204, Value::Null),
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

fn pending() -> Value {
    json!({ "status": "pending", "time": { "created": 1, "expires": 2 } })
}

struct Kit {
    app: TestApp,
    tui: Rc<Tui>,
    status: Arc<Mutex<Value>>,
    log: Arc<Mutex<Vec<Logged>>>,
    opened: Rc<RefCell<Vec<String>>>,
    _home: tempfile::TempDir,
}

impl Kit {
    fn new() -> Self {
        Self::with(integrations(), "auto")
    }

    fn with(integrations: Value, mode: &'static str) -> Self {
        let home = tempfile::tempdir().unwrap();
        let root = home.path().to_owned();
        let paths = Paths::from_vars(|name| (name == "HOME").then(|| root.clone().into())).unwrap();
        let log = Arc::new(Mutex::new(Vec::new()));
        let status = Arc::new(Mutex::new(pending()));
        let transport = Fixture {
            integrations: Arc::new(Mutex::new(integrations)),
            status: status.clone(),
            mode,
            log: log.clone(),
        };
        let client = Client::with_transport("http://opencode.local", Arc::new(transport)).unwrap();
        let theme = opencode_ui::theme::Catalog::default()
            .load("opencode", opencode_ui::theme::ThemeMode::Dark)
            .unwrap()
            .theme;
        // As the TS screen, the app clears with the page background the backdrop blends over.
        let app = TestApp::with_options(
            100,
            40,
            AppOptions {
                theme: opentui::theme::Theme {
                    background: theme.background.base,
                    ..opentui::theme::Theme::default()
                },
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
                roots: Some(Roots {
                    paths,
                    storage_channel: "test".into(),
                }),
                route: Route::Home,
                continue_: false,
                events: false,
            },
        );
        // Never a browser: record what would open.
        let opened = Rc::new(RefCell::new(Vec::new()));
        {
            let opened = opened.clone();
            *tui.local.open_url.borrow_mut() = Rc::new(move |url: &str| {
                opened.borrow_mut().push(url.to_owned());
                Ok(())
            });
        }
        let kit = Self {
            app,
            tui,
            status,
            log,
            opened,
            _home: home,
        };
        kit.wait_for("Model M");
        // The integrations are read at startup, so the dialog opens on the list.
        let read = kit
            .app
            .wait_until(WAIT, || kit.tui.local.integrations().is_some());
        assert!(read, "the integrations were never read");
        kit
    }

    fn wait_for(&self, text: &str) -> String {
        let found = self.app.wait_until(WAIT, || self.app.text().contains(text));
        let screen = self.app.text();
        assert!(found, "{text:?} never showed:\n{screen}");
        screen
    }

    fn only_dialog(&self) {
        let host = self.tui.dialogs.host().id();
        for child in self.app.root().children() {
            if child.id() != host {
                child.visible(false);
            }
        }
    }

    fn connect(&self) {
        self.tui.keymap.dispatch("provider.connect", None);
        self.wait_for("Connect an integration");
    }

    /// Waits for `condition`, moving the manual clock past each 500 ms poll.
    fn poll_until(&self, condition: impl Fn() -> bool) -> bool {
        for _ in 0..20 {
            if self.app.wait_until(Duration::from_millis(100), &condition) {
                return true;
            }
            self.app.advance(Duration::from_millis(500));
        }
        false
    }

    fn down(&self, count: usize) {
        for _ in 0..count {
            self.app.press("down");
        }
    }

    /// Mutating requests, in order, with their bodies.
    fn writes(&self) -> Vec<Logged> {
        self.log
            .lock()
            .unwrap()
            .iter()
            .filter(|(method, _, _)| method != "GET")
            .cloned()
            .collect()
    }

    fn wait_writes(&self, count: usize) -> Vec<Logged> {
        let found = self.app.wait_until(WAIT, || self.writes().len() >= count);
        assert!(found, "fewer than {count} writes: {:?}", self.writes());
        self.writes()
    }

    fn reads(&self, prefix: &str) -> usize {
        self.log
            .lock()
            .unwrap()
            .iter()
            .filter(|(method, url, _)| method == "GET" && url.starts_with(prefix))
            .count()
    }
}

fn write(method: &str, path: &str, body: Value) -> Logged {
    (method.into(), path.into(), body)
}

#[test]
fn integrations_match_typescript() {
    let kit = Kit::new();
    let command = kit
        .tui
        .keymap
        .commands()
        .into_iter()
        .find(|command| command.id == "provider.connect")
        .expect("provider.connect is not registered");
    assert_eq!(
        command.slash.as_ref().map(|slash| slash.name.as_str()),
        Some("connect")
    );
    assert_eq!(command.group.as_deref(), Some("Integration"));

    kit.connect();
    kit.wait_for("Acme");
    kit.only_dialog();
    assert_fixture(&kit.app.render(), "E.17a/list");
    kit.app.press("up");
    kit.app.wait_until(Duration::from_millis(200), || false);
    assert_fixture(&kit.app.render(), "E.17a/list-end");

    let open = |keys: &[&str], text: &str, fixture: &str| {
        let kit = Kit::new();
        kit.connect();
        for key in keys {
            kit.app.press(key);
        }
        kit.wait_for(text);
        kit.only_dialog();
        assert_fixture(&kit.app.render(), fixture);
    };
    open(&["return"], "Connected accounts", "E.17a/accounts");
    open(&["down", "return"], "Connect OpenAI", "E.17a/methods");
    open(&["down", "return", "down", "return"], "submit", "E.17a/key");
    open(&["down", "down", "return"], "Deployment", "E.17a/form");
    open(
        &["down", "down", "return", "return"],
        "Waiting for authorization",
        "E.17a/oauth",
    );
}

#[test]
fn an_api_key_connects_and_opens_the_provider_models() {
    let kit = Kit::new();
    kit.connect();
    kit.down(1);
    kit.app.press("return");
    kit.wait_for("Connect OpenAI");
    kit.down(1);
    kit.app.press("return");
    kit.wait_for("submit");
    // An empty key sends nothing.
    kit.app.press("return");
    kit.app.type_text("sk-test");
    // Counted before the submit: the catalog read after it can land during the key press.
    let integration_reads = kit.reads("/api/integration");
    kit.app.press("return");
    assert_eq!(
        kit.wait_writes(1),
        [write(
            "POST",
            &format!("/api/integration/openai/connect/key?{QUERY}"),
            json!({ "key": "sk-test" })
        )]
    );
    kit.wait_for("Connected OpenAI");
    // The catalog is read again, then the model dialog of the connected provider opens. The home footer
    // already shows "Model M", so wait for the dialog's search.
    kit.wait_for("Search models");
    kit.wait_for("Model M");
    assert!(kit.reads("/api/integration") > integration_reads);
    assert!(kit.tui.dialogs.is_open());
}

#[test]
fn a_rejected_key_shows_the_error_and_stays() {
    let kit = Kit::new();
    kit.connect();
    kit.down(3);
    kit.app.press("return");
    // Anthropic's account needs sign-in; picking it asks for a key again.
    kit.wait_for("Connected accounts");
    kit.down(1);
    kit.app.press("return");
    kit.wait_for("Connect Anthropic");
    kit.app.type_text("bad");
    kit.app.press("return");
    kit.wait_for("Invalid API key");
    assert!(kit.tui.dialogs.is_open());
    assert_eq!(
        kit.writes(),
        [write(
            "POST",
            &format!("/api/integration/anthropic/connect/key?{QUERY}"),
            json!({ "key": "bad" })
        )]
    );
}

#[test]
fn oauth_sends_the_form_answer_opens_the_sink_and_completes() {
    let kit = Kit::new();
    kit.connect();
    kit.down(2);
    kit.app.press("return");
    kit.wait_for("Deployment");
    kit.app.press("return");
    kit.wait_for("Waiting for authorization");
    assert_eq!(
        kit.writes(),
        [write(
            "POST",
            &format!("/api/integration/github-copilot/connect/oauth?{QUERY}"),
            json!({ "methodID": "device", "answer": { "deployment": "github.com" } })
        )]
    );
    kit.app.press("return");
    assert_eq!(*kit.opened.borrow(), ["https://github.com/login/device"]);
    // `TestApp` has no terminal, so the copy fails with a toast (the live run copies).
    kit.app.press("c");
    kit.wait_for("Failed to copy to clipboard");
    // The status is polled until the browser finishes.
    let polls = || kit.reads("/api/integration/github-copilot/connect/oauth/att_1");
    let polled = kit.poll_until(|| polls() >= 2);
    assert!(polled, "polled {} times", polls());
    *kit.status.lock().unwrap() =
        json!({ "status": "complete", "time": { "created": 1, "expires": 2 } });
    assert!(kit.poll_until(|| kit.app.text().contains("Connected GitHub Copilot")));
    // A finished attempt is not cancelled.
    assert_eq!(kit.writes().len(), 1);
}

#[test]
fn closing_a_pending_oauth_cancels_it() {
    let kit = Kit::new();
    kit.connect();
    kit.down(2);
    kit.app.press("return");
    kit.wait_for("Deployment");
    kit.app.press("return");
    kit.wait_for("Waiting for authorization");
    kit.app.press("escape");
    let writes = kit.wait_writes(2);
    assert_eq!(
        writes[1],
        write(
            "DELETE",
            &format!("/api/integration/github-copilot/connect/oauth/att_1?{QUERY}"),
            Value::Null
        )
    );
    assert!(!kit.tui.dialogs.is_open());
    // Escape on the form's first field cancels the connect without a request.
    kit.connect();
    kit.down(2);
    kit.app.press("return");
    kit.wait_for("Deployment");
    kit.app.press("escape");
    assert!(!kit.tui.dialogs.is_open());
    assert_eq!(kit.writes().len(), 2);
}

#[test]
fn a_pasted_code_completes_the_oauth() {
    let kit = Kit::with(integrations(), "code");
    kit.connect();
    kit.down(1);
    kit.app.press("return");
    kit.wait_for("Connect OpenAI");
    kit.app.press("return");
    kit.wait_for("Authorization code");
    kit.app.type_text("abc123");
    kit.app.press("return");
    kit.wait_for("Connected OpenAI");
    assert_eq!(
        kit.writes(),
        [
            write(
                "POST",
                &format!("/api/integration/openai/connect/oauth?{QUERY}"),
                json!({ "methodID": "browser" })
            ),
            write(
                "POST",
                &format!("/api/integration/openai/connect/oauth/att_1/complete?{QUERY}"),
                json!({ "code": "abc123" })
            ),
        ]
    );
}

#[test]
fn accounts_activate_rename_and_remove() {
    let kit = Kit::new();
    kit.connect();
    kit.app.press("return");
    kit.wait_for("Connected accounts");
    // Accounts are sorted by label: home, work. "work" is active (first in the connections).
    kit.down(1);
    kit.wait_for("rename");
    kit.app.press("return");
    kit.wait_writes(1);
    // Rename home.
    kit.app.press("ctrl+r");
    kit.wait_for("Rename account");
    for _ in 0..4 {
        kit.app.press("backspace");
    }
    kit.app.type_text("laptop");
    kit.app.press("return");
    kit.wait_writes(2);
    kit.wait_for("Connected accounts");
    // Remove: the first press asks to confirm, the second removes.
    kit.down(1);
    kit.app.press("ctrl+d");
    kit.wait_for("Press ctrl+d again to confirm");
    assert_eq!(kit.writes().len(), 2);
    kit.app.press("ctrl+d");
    let writes = kit.wait_writes(3);
    assert_eq!(
        writes,
        [
            write("POST", "/api/credential/cred_home/activate", Value::Null),
            write(
                "PATCH",
                "/api/credential/cred_home",
                json!({ "label": "laptop" })
            ),
            write("DELETE", "/api/credential/cred_home", Value::Null),
        ]
    );
}

#[test]
fn removing_the_last_account_disconnects() {
    let mut list = integrations();
    list[0]["connections"] = json!([credential("cred_work", "work", None)]);
    let kit = Kit::with(list, "auto");
    kit.connect();
    kit.app.press("return");
    kit.wait_for("Connected accounts");
    kit.down(1);
    kit.app.press("ctrl+d");
    kit.app.press("ctrl+d");
    kit.wait_for("Disconnected OpenCode Console");
    assert!(!kit.tui.dialogs.is_open());
    assert_eq!(
        kit.writes(),
        [write("DELETE", "/api/credential/cred_work", Value::Null)]
    );
}

#[test]
fn an_mcp_sign_in_goes_straight_to_its_method() {
    let kit = Kit::new();
    opencode_tui::dialogs::integration::show_auto_connect(
        &kit.tui,
        &IntegrationID("mcp_notion".into()),
    );
    kit.wait_for("Waiting for authorization");
    assert_eq!(
        kit.writes(),
        [write(
            "POST",
            &format!("/api/integration/mcp_notion/connect/oauth?{QUERY}"),
            json!({ "methodID": "mcp" })
        )]
    );
    // MCP integrations stay out of the connect list.
    kit.app.press("escape");
    kit.connect();
    assert!(!kit.app.text().contains("Notion"));
}

#[test]
fn a_command_connect_shows_its_output_and_completes() {
    let mut list = integrations();
    list.as_array_mut().unwrap().push(json!({
        "id": "mcp_cli", "name": "CLI tool", "metadata": { "source": "mcp" },
        "methods": [{ "type": "command", "id": "login", "label": "Log in with the CLI", "command": ["cli", "login"] }],
        "connections": [],
    }));
    let kit = Kit::with(list, "auto");
    *kit.status.lock().unwrap() = json!({
        "status": "pending", "message": "Visit example.test and enter 1234\n",
        "time": { "created": 1, "expires": 2 },
    });
    opencode_tui::dialogs::integration::show_auto_connect(
        &kit.tui,
        &IntegrationID("mcp_cli".into()),
    );
    kit.wait_for("Visit example.test and enter 1234");
    kit.wait_for("Waiting for command to finish");
    *kit.status.lock().unwrap() = json!({
        "status": "failed", "message": "Login refused", "time": { "created": 1, "expires": 2 },
    });
    assert!(kit.poll_until(|| kit.app.text().contains("Login refused")));
    assert!(!kit.tui.dialogs.is_open());
    assert_eq!(
        kit.writes(),
        [write(
            "POST",
            &format!("/api/integration/mcp_cli/connect/command?{QUERY}"),
            json!({ "methodID": "login" })
        )]
    );
}

#[test]
fn form_steps_open_a_link_take_an_own_answer_and_a_multiselect() {
    let mut list = integrations();
    list.as_array_mut().unwrap().push(json!({
        "id": "mcp_aws", "name": "AWS", "metadata": { "source": "mcp" },
        "methods": [{
            "type": "external", "id": "profile", "label": "AWS profile",
            "form": [
                { "key": "login", "type": "external", "url": "https://aws.example/login", "title": "Sign in to AWS" },
                {
                    "key": "profile", "type": "string", "title": "Profile", "required": true, "custom": true,
                    "options": [{ "value": "default", "label": "default" }],
                },
                {
                    "key": "regions", "type": "multiselect", "title": "Regions", "required": true,
                    "options": [{ "value": "us", "label": "US" }, { "value": "eu", "label": "EU" }],
                },
                // Hidden: its default is sent without a question.
                { "key": "source", "type": "string", "hidden": true, "default": "tui" },
                // Shown only for another profile.
                {
                    "key": "role", "type": "string", "title": "Role",
                    "when": [{ "key": "profile", "op": "eq", "value": "default" }],
                },
            ],
        }],
        "connections": [],
    }));
    let kit = Kit::with(list, "auto");
    opencode_tui::dialogs::integration::show_auto_connect(
        &kit.tui,
        &IntegrationID("mcp_aws".into()),
    );
    // "I finished" stays hidden until the link was opened.
    kit.wait_for("Open link");
    assert!(!kit.app.text().contains("I finished"));
    kit.app.press("return");
    kit.wait_for("Open link again");
    assert_eq!(*kit.opened.borrow(), ["https://aws.example/login"]);
    kit.down(1);
    kit.app.press("return");
    // The own answer: row 2, typed, submitted with Enter. The list is as tall as its rows without their gaps
    // (`count` in TS), so row 2 scrolls into view when selected.
    kit.wait_for("1. default");
    kit.down(1);
    kit.wait_for("2. Type your own answer");
    kit.app.press("return");
    kit.app.type_text("dev");
    kit.app.press("return");
    // The multiselect offers "Continue" once one region is checked.
    kit.wait_for("[ ] US");
    assert!(!kit.app.text().contains("Continue"));
    kit.app.press("return");
    kit.wait_for("[x] US");
    kit.down(2);
    kit.app.press("return");
    kit.wait_for("Connected AWS");
    assert_eq!(
        kit.writes(),
        [write(
            "POST",
            &format!("/api/integration/mcp_aws/connect/external?{QUERY}"),
            json!({
                "methodID": "profile",
                "answer": { "login": true, "profile": "dev", "regions": ["us"], "source": "tui" },
            })
        )]
    );
}
