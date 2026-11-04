//! System dialogs (E.18b): themes, status, pair, highlights, update and the home notice, the plugin manager,
//! and error details.
//!
//! - P-COMP: `parity/component/E.18b-system.tsx` renders the TS dialogs alone; here they open over the whole TUI,
//!   so the comparison covers the dialog panel (the cells with the panel background in the fixture).
//! - `TestApp` and P-REQ: behavior, and the requests each dialog sends to a test transport. Pairing and updating
//!   are only ever proven here: they change real state.

use std::rc::Rc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use bytes::Bytes;
use opencode_api::client::Client;
use opencode_api::transport::{BoxFuture, Request, Response, Transport};
use opencode_local::cli_config::{Info, Resolved, merge};
use opencode_parity::{Fixture, compare, fixtures_dir};
use opencode_tui::dialogs::{settings, status, theme_list};
use opencode_tui::{Deps, Route, Tui};
use opentui::testing::TestApp;
use serde_json::{Value, json};

const DIRECTORY: &str = "/tmp/opencode/app";

type Answer = Box<dyn Fn(&str, &str, &Value) -> Option<(u16, Value)> + Send + Sync>;

/// Answers with `answer` (method, path, body), else an empty session list, else 404; logs every request.
struct Server {
    answer: Answer,
    log: Arc<Mutex<Vec<(String, String, Value)>>>,
}

impl Transport for Server {
    fn send(&self, request: Request) -> BoxFuture<'_, Result<Response, String>> {
        let path = request.url.path().to_owned();
        let full = match request.url.query() {
            Some(query) => format!("{path}?{query}"),
            None => path.clone(),
        };
        let body: Value = request
            .body
            .as_ref()
            .and_then(|body| serde_json::from_slice(body).ok())
            .unwrap_or(Value::Null);
        self.log
            .lock()
            .unwrap()
            .push((request.method.to_owned(), full, body.clone()));
        let (status, body) =
            (self.answer)(request.method, &path, &body).unwrap_or_else(|| match path.as_str() {
                "/api/session" => (200, json!({ "data": [], "cursor": {} })),
                _ => (404, json!({})),
            });
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

/// The harness config of `parity/lib/component.tsx` plus `extra`.
fn info(extra: Value) -> Info {
    merge(&[
        Some(json!({ "theme": { "name": "opencode", "mode": "dark" }, "animations": false })),
        Some(extra),
    ])
}

struct Mounted {
    tui: Rc<Tui>,
    log: Arc<Mutex<Vec<(String, String, Value)>>>,
}

impl Mounted {
    /// The requests whose path starts with `prefix`, as `METHOD path?query`.
    fn requests(&self, prefix: &str) -> Vec<String> {
        self.log
            .lock()
            .unwrap()
            .iter()
            .filter(|(_, path, _)| path.starts_with(prefix))
            .map(|(method, path, _)| format!("{method} {path}"))
            .collect()
    }
}

fn mount_with(app: &TestApp, info: Info, answer: Answer) -> Mounted {
    let log = Arc::new(Mutex::new(Vec::new()));
    let transport = Server {
        answer,
        log: log.clone(),
    };
    let client = Client::with_transport("http://opencode.local", Arc::new(transport)).unwrap();
    let tui = opencode_tui::mount(
        app,
        Deps {
            client,
            directory: DIRECTORY.into(),
            config: Resolved::new(info, |_| None),
            roots: None,
            route: Route::Home,
            continue_: false,
            events: false,
        },
    );
    Mounted { tui, log }
}

fn mount(app: &TestApp, info: Info) -> Rc<Tui> {
    mount_with(app, info, Box::new(|_, _, _| None)).tui
}

fn wait_for(app: &TestApp, text: &str) -> String {
    let found = app.wait_until(Duration::from_secs(5), || app.text().contains(text));
    let screen = app.text();
    assert!(found, "{text:?} never showed:\n{screen}");
    screen
}

/// Compares the dialog panel with the fixture: every cell inside the bounding box of the cells that carry the
/// panel background (the background under the fixture's first `title` letter).
#[track_caller]
fn assert_dialog(app: &TestApp, name: &str, title: &str) {
    // Deferred work (a dialog built again, a read) may still be on its way.
    app.wait_until(Duration::from_secs(2), || {
        dialog_diff(app, name, title).is_ok()
    });
    if let Err(message) = dialog_diff(app, name, title) {
        panic!("{message}");
    }
}

fn dialog_diff(app: &TestApp, name: &str, title: &str) -> Result<(), String> {
    let expected = Fixture::load(fixtures_dir().join(format!("{name}.json"))).unwrap();
    let mut actual = Fixture::from_capture(&app.render());
    let at = (0..expected.height)
        .find_map(|y| {
            let row: String = (0..expected.width)
                .map(|x| expected.cell(x, y).unwrap().symbol.clone())
                .collect();
            row.find(title)
                .map(|x| (row[..x].chars().count() as u32, y))
        })
        .unwrap_or_else(|| panic!("{title:?} is not in {name}"));
    let panel = expected.cell(at.0, at.1).unwrap().bg;
    let inside: Vec<(u32, u32)> = (0..expected.height)
        .flat_map(|y| (0..expected.width).map(move |x| (x, y)))
        .filter(|&(x, y)| expected.cell(x, y).unwrap().bg == panel)
        .collect();
    let (left, right) = (
        inside.iter().map(|p| p.0).min().unwrap(),
        inside.iter().map(|p| p.0).max().unwrap(),
    );
    let (top, bottom) = (
        inside.iter().map(|p| p.1).min().unwrap(),
        inside.iter().map(|p| p.1).max().unwrap(),
    );
    for y in 0..expected.height {
        for x in 0..expected.width {
            if !(left..=right).contains(&x) || !(top..=bottom).contains(&y) {
                *actual.cell_mut(x, y).unwrap() = expected.cell(x, y).unwrap().clone();
            }
        }
    }
    let comparison = compare(&expected, &actual);
    if !comparison.is_equal() {
        let path = std::env::temp_dir()
            .join("opencode-parity")
            .join(format!("{name}.json"));
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, actual.to_json()).unwrap();
    }
    if comparison.is_equal() {
        return Ok(());
    }
    Err(format!(
        "P-COMP {name} (panel {left}..={right} x {top}..={bottom}): {comparison}"
    ))
}

fn theme(tui: &Tui) -> String {
    tui.theme.borrow().selected().to_owned()
}

fn configured_theme(tui: &Tui) -> Option<String> {
    tui.settings.info().theme.and_then(|theme| theme.name)
}

// Themes ------------------------------------------------------------------------------------------------------

#[test]
fn theme_list_matches_typescript_and_previews_in_the_dialog() {
    let app = TestApp::new(80, 30);
    let tui = mount(&app, info(json!({})));
    tui.keymap.dispatch("theme.switch", None);
    wait_for(&app, "Search themes");
    assert_dialog(&app, "E.18b/themes", "Search themes");

    // The move previews `opencode2`; the dialog is drawn again in it.
    app.press("down");
    app.wait_until(Duration::from_secs(5), || theme(&tui) == "opencode2");
    app.render();
    assert_dialog(&app, "E.18b/themes-down", "Search themes");

    // Escape restores the opening theme and writes nothing.
    app.press("escape");
    assert!(!app.text().contains("Search themes"), "{}", app.text());
    assert_eq!(theme(&tui), "opencode");
    assert_eq!(configured_theme(&tui).as_deref(), Some("opencode"));

    // A filter previews its first match; Enter keeps it and writes `theme.name`.
    theme_list::show(&tui, None);
    wait_for(&app, "Search themes");
    app.type_text("tokyo");
    app.wait_until(Duration::from_secs(5), || theme(&tui) == "tokyonight");
    app.render();
    assert_dialog(&app, "E.18b/themes-filter", "tokyo");
    app.press("enter");
    assert!(!app.text().contains("tokyonight"), "{}", app.text());
    assert_eq!(theme(&tui), "tokyonight");
    assert_eq!(configured_theme(&tui).as_deref(), Some("tokyonight"));
}

#[test]
fn clearing_the_filter_previews_the_opening_theme_again() {
    let app = TestApp::new(80, 30);
    let tui = mount(&app, info(json!({})));
    theme_list::show(&tui, None);
    wait_for(&app, "Search themes");
    app.type_text("nord");
    app.wait_until(Duration::from_secs(5), || theme(&tui) == "nord");
    for _ in 0.."nord".len() {
        app.press("backspace");
    }
    app.wait_until(Duration::from_secs(5), || theme(&tui) == "opencode");
    assert_eq!(theme(&tui), "opencode");
    wait_for(&app, "Search themes");
}

#[test]
fn settings_theme_opens_the_list_and_comes_back() {
    let app = TestApp::new(80, 30);
    let tui = mount(&app, info(json!({})));
    settings::show(&tui, Some("theme.name"));
    wait_for(&app, "opencode ↵");
    app.press("enter");
    wait_for(&app, "Search themes");

    // Escape goes back to Settings on Theme, with the opening theme.
    app.press("down");
    app.wait_until(Duration::from_secs(5), || theme(&tui) == "opencode2");
    app.press("escape");
    wait_for(&app, "Search settings");
    assert_eq!(theme(&tui), "opencode");
    wait_for(&app, "opencode ↵");

    // A pick goes back too, and Settings shows the new value.
    app.press("enter");
    wait_for(&app, "Search themes");
    app.press("down");
    app.wait_until(Duration::from_secs(5), || theme(&tui) == "opencode2");
    app.press("enter");
    wait_for(&app, "opencode2 ↵");
    assert_eq!(configured_theme(&tui).as_deref(), Some("opencode2"));
    assert_eq!(theme(&tui), "opencode2");
}

// Status ------------------------------------------------------------------------------------------------------

fn location() -> Value {
    json!({ "directory": DIRECTORY, "project": { "id": "proj_app", "directory": DIRECTORY, "canonical": DIRECTORY } })
}

fn servers() -> Value {
    json!([
        { "name": "linear", "status": { "status": "failed", "error": "MCP error -32000: Connection closed" } },
        { "name": "github", "status": { "status": "connected" } },
        { "name": "sentry", "status": { "status": "needs_auth", "error": "Authentication required" } },
        { "name": "docs", "status": { "status": "disabled" } },
        { "name": "figma", "status": { "status": "pending" } },
    ])
}

fn mcp(list: Value) -> Answer {
    Box::new(move |_, path, _| match path {
        "/api/location" => Some((200, location())),
        "/api/mcp" => Some((200, json!({ "location": location(), "data": list.clone() }))),
        _ => None,
    })
}

#[test]
fn status_matches_typescript() {
    let app = TestApp::new(80, 30);
    let mounted = mount_with(&app, info(json!({})), mcp(servers()));
    mounted.tui.keymap.dispatch("opencode.status", None);
    wait_for(&app, "5 MCP servers");
    assert_dialog(&app, "E.18b/status", "Status");
    assert_eq!(mounted.requests("/api/mcp").len(), 1);

    let app = TestApp::new(80, 30);
    let tui = mount_with(&app, info(json!({})), mcp(json!([]))).tui;
    status::show(&tui);
    wait_for(&app, "No MCP servers");
    assert_dialog(&app, "E.18b/status-empty", "Status");
}
