//! The form prompt (E.9b) over a fixture server: a pending form shows above the session prompt or over home, and
//! each answer sends one request (P-REQ: method, path, body, and the directory header of a global form). The
//! server answers 204, as it does, and lists no forms once one settled. The flows follow
//! `packages/tui/test/cli/tui/form.test.tsx`.
//!
//! P-COMP: `parity/component/E.9b-form.tsx` renders the TS prompt alone at 96x30, one fixture per field kind and
//! the review; here the prompt sits in the session route of a 100x30 app, two columns in. The comparison covers
//! the prompt's rows (those with its left border).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use bytes::Bytes;
use opencode_api::client::Client;
use opencode_api::generated::{FormField, FormValue, SessionID};
use opencode_api::transport::{BoxFuture, Request, Response, Transport};
use opencode_local::cli_config::{Info, Resolved};
use opencode_parity::{Fixture as Cells, compare, fixtures_dir};
use opencode_tui::routes::session::form::{
    display_value, initial_values, selected_row, set_multiselect_custom, set_url_opener, toggle_multiselect, validate,
    visible_fields,
};
use opencode_tui::{Deps, Route, Tui};
use opentui::testing::TestApp;
use serde_json::{Value, json};

/// A mutating request as the server saw it.
#[derive(Debug, PartialEq)]
struct Sent {
    method: &'static str,
    path: String,
    body: Value,
    directory: Option<String>,
}

/// Serves one session with `forms`, `global` forms at `/project`, and records every POST and DELETE.
#[derive(Default)]
struct Fixture {
    forms: Vec<Value>,
    global: Vec<Value>,
    settled: AtomicBool,
    sent: Mutex<Vec<Sent>>,
}

impl Transport for Fixture {
    fn send(&self, request: Request) -> BoxFuture<'_, Result<Response, String>> {
        let path = request.url.path().to_owned();
        let settled = self.settled.load(Ordering::SeqCst);
        let list = |forms: &Vec<Value>| if settled { Vec::new() } else { forms.clone() };
        let (status, body) = match (request.method, path.as_str()) {
            ("GET", "/api/session/ses_root") => (200, json!({ "data": session() })),
            ("GET", "/api/session") => (200, json!({ "data": [], "cursor": {} })),
            ("GET", "/api/session/ses_root/message") => (200, json!({ "data": [], "cursor": {} })),
            ("GET", "/api/session/ses_root/permission") => (200, json!({ "data": [] })),
            ("GET", "/api/session/ses_root/form") => (200, json!({ "data": list(&self.forms) })),
            ("GET", "/api/form") => {
                (200, json!({ "location": { "directory": "/project" }, "data": list(&self.global) }))
            }
            // The goal footer's RPC read (E.14); no goal is set.
            ("POST", path) if path.starts_with("/api/rpc/") => (200, json!({ "output": null })),
            ("POST" | "DELETE", _) => {
                let body = request.body.as_deref().map_or(Value::Null, |body| serde_json::from_slice(body).unwrap());
                let directory = request
                    .headers
                    .iter()
                    .find(|(name, _)| name == "x-opencode-directory")
                    .map(|(_, value)| value.clone());
                self.sent.lock().unwrap().push(Sent { method: request.method, path, body, directory });
                self.settled.store(true, Ordering::SeqCst);
                (204, Value::Null)
            }
            _ => (404, json!({})),
        };
        let body = if status == 204 { Vec::new() } else { serde_json::to_vec(&body).unwrap() };
        Box::pin(async move {
            Ok(Response {
                status,
                headers: vec![("content-type".into(), "application/json".into())],
                body: Box::pin(futures_util::stream::iter([Ok(Bytes::from(body))])),
            })
        })
    }
}

fn session() -> Value {
    json!({
        "id": "ses_root", "title": "Fix the parser", "projectID": "project", "cost": 0,
        "tokens": { "input": 0, "output": 0, "reasoning": 0, "cache": { "read": 0, "write": 0 } },
        "time": { "created": 1, "updated": 1 },
        "location": { "directory": "/project" },
    })
}

fn form(session: &str, id: &str, title: &str, fields: Value) -> Value {
    json!({ "id": id, "sessionID": session, "title": title, "fields": fields })
}

struct Harness {
    app: TestApp,
    _tui: std::rc::Rc<Tui>,
    fixture: Arc<Fixture>,
}

fn mount(fixture: Fixture, route: Route) -> Harness {
    let fixture = Arc::new(fixture);
    let client = Client::with_transport("http://opencode.local", fixture.clone()).unwrap();
    let app = TestApp::new(100, 30);
    let tui = opencode_tui::mount(
        &app,
        Deps {
            client,
            directory: "/project".into(),
            config: Resolved::new(Info::default(), |_| None),
            roots: None,
            route,
            continue_: false,
            events: false,
        },
    );
    Harness { app, _tui: tui, fixture }
}

fn session_form(fields: Value) -> Harness {
    mount(
        Fixture { forms: vec![form("ses_root", "frm_1", "Deploy settings", fields)], ..Fixture::default() },
        Route::Session { id: SessionID("ses_root".into()) },
    )
}

impl Harness {
    #[track_caller]
    fn wait_for(&self, text: &str) -> String {
        let found = self.app.wait_until(Duration::from_secs(5), || self.app.text().contains(text));
        let screen = self.app.text();
        assert!(found, "{text:?} never showed:\n{screen}\n{:?}", self.fixture.sent.lock().unwrap());
        screen
    }

    #[track_caller]
    fn wait_gone(&self, text: &str) {
        let gone = self.app.wait_until(Duration::from_secs(5), || !self.app.text().contains(text));
        assert!(gone, "{text:?} stayed:\n{}", self.app.text());
    }

    /// Waits for the requests and returns them.
    fn sent(&self, count: usize) -> Vec<Sent> {
        let arrived = self.app.wait_until(Duration::from_secs(5), || self.fixture.sent.lock().unwrap().len() >= count);
        let sent = std::mem::take(&mut *self.fixture.sent.lock().unwrap());
        assert!(arrived, "expected {count} requests, got {sent:?}");
        sent
    }

    fn nothing_sent(&self) {
        assert_eq!(*self.fixture.sent.lock().unwrap(), []);
    }
}

fn reply(session: &str, form: &str, answer: Value) -> Sent {
    Sent {
        method: "POST",
        path: format!("/api/session/{session}/form/{form}/reply"),
        body: json!({ "answer": answer }),
        directory: None,
    }
}

/// The prompt's bottom edge: it shows while no form does.
const PROMPT: &str = "╹▀";

#[test]
fn a_single_choice_submits_on_enter_and_the_prompt_returns() {
    let harness = session_form(json!([{
        "key": "target", "type": "string", "title": "Target",
        "options": [{ "value": "staging", "label": "Staging" }, { "value": "production", "label": "Production", "description": "Live traffic" }],
    }]));
    let screen = harness.wait_for("Deploy settings");
    for text in ["1. Staging", "2. Production", "Live traffic", "↑↓ select", "enter submit", "esc dismiss"] {
        assert!(screen.contains(text), "{text:?}:\n{screen}");
    }
    assert!(!screen.contains("⇆ tab"), "a single choice has no tabs:\n{screen}");
    assert!(!screen.contains(PROMPT), "the prompt hides:\n{screen}");

    harness.app.press("down");
    harness.app.press("enter");
    assert_eq!(harness.sent(1), [reply("ses_root", "frm_1", json!({ "target": "production" }))]);
    harness.wait_for(PROMPT);
    harness.wait_gone("Deploy settings");
}

#[test]
fn escape_cancels_the_form() {
    let harness = session_form(json!([{ "key": "ok", "type": "boolean", "title": "Continue?" }]));
    let screen = harness.wait_for("Deploy settings");
    assert!(screen.contains("1. Yes") && screen.contains("2. No"), "{screen}");
    harness.app.press("escape");
    assert_eq!(
        harness.sent(1),
        [Sent {
            method: "DELETE",
            path: "/api/session/ses_root/form/frm_1".into(),
            body: Value::Null,
            directory: None,
        }]
    );
    harness.wait_for(PROMPT);
}

#[test]
fn every_field_kind_fills_in_and_submits_from_the_review() {
    let harness = session_form(json!([
        { "key": "name", "type": "string", "required": true },
        { "key": "count", "type": "integer", "minimum": 1, "maximum": 5 },
        { "key": "agree", "type": "boolean" },
        { "key": "targets", "type": "multiselect", "custom": true,
          "options": [{ "value": "a", "label": "A" }, { "value": "b", "label": "B" }] },
        { "key": "reason", "type": "string", "when": [{ "key": "agree", "op": "eq", "value": false }] },
    ]));
    let screen = harness.wait_for("name  count  agree  targets  Submit");
    assert!(screen.contains("Type your answer"), "{screen}");
    assert!(!screen.contains("reason"), "hidden until agree is no:\n{screen}");

    // Text: typed, then committed by Tab.
    harness.app.type_text("Ada");
    harness.wait_for("Ada");
    harness.app.press("tab");
    // Integer: the range is the placeholder, and a value out of range stays with an error.
    harness.wait_for("1-5");
    harness.app.type_text("9");
    harness.app.press("tab");
    harness.wait_for("Must be at most 5");
    harness.app.press("backspace");
    harness.app.type_text("3");
    harness.app.press("tab");
    // Boolean: Enter picks Yes and moves on.
    harness.wait_for("1. Yes");
    harness.app.press("enter");
    // Multiselect: Space toggles; typing on the custom row opens its editor; Enter commits it.
    harness.wait_for("3. [ ] Type your own answer");
    harness.app.press("space");
    harness.wait_for("1. [✓] A");
    harness.app.press("down");
    harness.app.press("down");
    harness.wait_for("enter edit");
    harness.app.type_text("zed");
    harness.wait_for("[✓] zed");
    harness.app.press("enter");
    harness.wait_for("enter toggle");
    harness.nothing_sent();

    harness.app.press("right");
    let screen = harness.wait_for("enter submit");
    for text in ["name: Ada", "count: 3", "agree: Yes", "targets: A, zed"] {
        assert!(screen.contains(text), "{text:?}:\n{screen}");
    }
    harness.app.press("enter");
    assert_eq!(
        harness.sent(1),
        [reply("ses_root", "frm_1", json!({ "name": "Ada", "count": 3, "agree": true, "targets": ["a", "zed"] }))]
    );
}

#[test]
fn a_required_answer_blocks_submitting() {
    let harness = session_form(json!([
        { "key": "targets", "type": "multiselect", "required": true, "minItems": 1,
          "options": [{ "value": "staging", "label": "Staging" }] },
        { "key": "priority", "type": "multiselect", "options": [{ "value": "now", "label": "Now" }] },
    ]));
    harness.wait_for("[ ] Staging");
    harness.app.press("right");
    harness.app.press("right");
    let screen = harness.wait_for("enter submit");
    assert!(screen.contains("targets: Answer required"), "{screen}");
    harness.app.press("enter");
    harness.wait_for("Answer required");
    harness.nothing_sent();
}

#[test]
fn an_external_field_needs_acknowledgement() {
    // Tests must not open a browser.
    set_url_opener(|_| true);
    let harness = session_form(json!([{
        "key": "authorization", "type": "external",
        "url": "https://example.com/authorize", "title": "Authorize access",
    }]));
    let screen = harness.wait_for("https://example.com/authorize");
    assert!(screen.contains("enter open link") && screen.contains("c copy"), "{screen}");
    harness.app.press("right");
    harness.wait_for("(acknowledgement required)");
    harness.app.press("enter");
    harness.wait_for("External action must be acknowledged: Authorize access");
    harness.nothing_sent();

    harness.app.press("left");
    harness.wait_for("enter open link");
    harness.app.press("enter");
    harness.wait_for("press enter to confirm");
    harness.wait_for("enter I finished");
    harness.app.press("enter");
    let screen = harness.wait_for("enter submit");
    assert!(screen.contains("Authorize access: Acknowledged"), "{screen}");
    harness.nothing_sent();
    harness.app.press("enter");
    assert_eq!(harness.sent(1), [reply("ses_root", "frm_1", json!({ "authorization": true }))]);
}

#[test]
fn ctrl_c_clears_a_text_answer_before_cancelling() {
    let harness = session_form(json!([{ "key": "notes", "type": "string" }]));
    harness.wait_for("Type your answer");
    harness.app.type_text("draft answer");
    harness.wait_for("draft answer");
    harness.app.press("ctrl+c");
    harness.wait_gone("draft answer");
    harness.nothing_sent();
    harness.app.press("ctrl+c");
    assert_eq!(harness.sent(1)[0].method, "DELETE");
}

#[test]
fn a_global_form_shows_over_home_and_replies_with_its_directory() {
    let harness = mount(
        Fixture {
            global: vec![form(
                "global",
                "frm_g",
                "MCP server needs a token",
                json!([{ "key": "token", "type": "string", "title": "Token" }]),
            )],
            ..Fixture::default()
        },
        Route::Home,
    );
    harness.wait_for("MCP server needs a token");
    // The home prompt is disabled: typing fills the form.
    harness.app.type_text("abc");
    harness.wait_for("abc");
    harness.app.press("enter");
    let screen = harness.wait_for("enter submit");
    assert!(screen.contains("Token: abc"), "{screen}");
    harness.app.press("enter");
    assert_eq!(
        harness.sent(1),
        [Sent { directory: Some("%2Fproject".into()), ..reply("global", "frm_g", json!({ "token": "abc" })) }]
    );
    harness.wait_gone("MCP server needs a token");
}

fn fields(value: Value) -> Vec<FormField> {
    serde_json::from_value(value).unwrap()
}

#[test]
fn the_helpers_follow_util_form() {
    let text = |value: &str| Some(FormValue::String(value.to_owned()));
    let string = |extra: Value| {
        let mut field = json!({ "key": "k", "type": "string" });
        field.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
        fields(json!([field])).remove(0)
    };
    let cases = [
        (string(json!({ "required": true })), None, Some("Answer required")),
        (string(json!({ "required": true })), text(""), Some("Answer required")),
        (string(json!({ "minLength": 3 })), text("ab"), Some("Must be at least 3 characters")),
        (string(json!({ "maxLength": 2 })), text("abc"), Some("Must be at most 2 characters")),
        (string(json!({ "pattern": "^a+$" })), text("ab"), Some("Must match pattern: ^a+$")),
        (string(json!({ "pattern": "(" })), text("ab"), Some("Invalid pattern: (")),
        (string(json!({ "format": "email" })), text("a@b"), Some("Expected an email address")),
        (string(json!({ "format": "email" })), text("a@b.dev"), None),
        (string(json!({ "format": "uri" })), text("not a url"), Some("Expected a URL")),
        (string(json!({ "format": "date" })), text("2026-02-30"), Some("Expected a date (YYYY-MM-DD)")),
        (string(json!({ "format": "date" })), text("2026-02-28"), None),
        (string(json!({ "format": "date-time" })), text("2026-02-28T10:00:00Z"), None),
        (string(json!({ "options": [{ "value": "a", "label": "A" }] })), text("b"), Some("Select an available option")),
        (string(json!({ "options": [{ "value": "a", "label": "A" }], "custom": true })), text("b"), None),
        (
            fields(json!([{ "key": "n", "type": "integer", "minimum": 2 }])).remove(0),
            Some(FormValue::Number(1.5)),
            Some("Expected an integer"),
        ),
        (
            fields(json!([{ "key": "n", "type": "number", "minimum": 2 }])).remove(0),
            Some(FormValue::Number(1.5)),
            Some("Must be at least 2"),
        ),
        (
            fields(json!([{ "key": "m", "type": "multiselect", "required": true, "options": [] }])).remove(0),
            Some(FormValue::Array(Vec::new())),
            Some("Select at least one option"),
        ),
        (
            fields(json!([{ "key": "m", "type": "multiselect", "maxItems": 1, "options": [] }])).remove(0),
            Some(FormValue::Array(vec!["a".into(), "b".into()])),
            Some("Select at most 1"),
        ),
        (
            fields(json!([{ "key": "m", "type": "multiselect", "options": [{ "value": "a", "label": "A" }] }]))
                .remove(0),
            Some(FormValue::Array(vec!["z".into()])),
            Some("Select only available options"),
        ),
    ];
    for (field, value, want) in cases {
        assert_eq!(validate(&field, value.as_ref()).as_deref(), want, "{field:?} {value:?}");
    }

    let multi = fields(json!([{ "key": "m", "type": "multiselect",
        "options": [{ "value": "a", "label": "Alpha" }], "default": ["a", "own"] }]))
    .remove(0);
    assert_eq!(display_value(&multi, Some(&FormValue::Array(vec!["a".into(), "own".into()])), "(none)"), "Alpha, own");
    assert_eq!(display_value(&multi, Some(&FormValue::Array(Vec::new())), "(none)"), "(none)");
    assert_eq!(toggle_multiselect(Some(&FormValue::Array(vec!["a".into()])), "a"), Vec::<String>::new());
    assert_eq!(
        set_multiselect_custom(Some(&FormValue::Array(vec!["a".into(), "old".into()])), Some("old"), "new"),
        ["a", "new"]
    );

    let custom = fields(json!([{ "key": "t", "type": "string", "custom": true, "default": "mine",
        "options": [{ "value": "a", "label": "A" }] }]));
    let (answers, typed) = initial_values(&custom);
    assert_eq!(answers.get("t"), Some(&FormValue::String("mine".into())));
    assert_eq!(typed.get("t").map(String::as_str), Some("mine"));
    assert_eq!(selected_row(custom.first(), answers.get("t")), 1, "the custom row");

    let conditional = fields(json!([
        { "key": "kind", "type": "string", "options": [{ "value": "x", "label": "X" }] },
        { "key": "detail", "type": "string", "when": [{ "key": "kind", "op": "eq", "value": "x" }] },
        { "key": "other", "type": "string", "when": [{ "key": "kind", "op": "neq", "value": "x" }] },
        { "key": "link", "type": "external", "url": "https://x.dev" },
    ]));
    let keys = |answers: &indexmap::IndexMap<String, FormValue>| {
        visible_fields(&conditional, answers)
            .iter()
            .map(|field| opencode_tui::routes::session::form::key(field).to_owned())
            .collect::<Vec<_>>()
    };
    assert_eq!(keys(&indexmap::IndexMap::new()), ["kind", "link"]);
    let answered = indexmap::IndexMap::from([("kind".to_owned(), FormValue::String("x".into()))]);
    assert_eq!(keys(&answered), ["kind", "detail", "link"]);
}

/// The fixture's form: the fields, with the message the TS script sets.
fn parity_form(fields: Value) -> Harness {
    let mut form = form("ses_root", "frm_1", "Deploy settings", fields);
    form["metadata"] = json!({ "message": "Pick how to deploy." });
    mount(Fixture { forms: vec![form], ..Fixture::default() }, Route::Session { id: SessionID("ses_root".into()) })
}

/// The rows of `cells` whose cell at `x` is the prompt's border, cut to `width` columns from `x`.
fn panel(cells: &Cells, x: u32, width: u32) -> Cells {
    let rows: Vec<u32> =
        (0..cells.height).filter(|&y| cells.cell(x, y).is_some_and(|cell| cell.symbol == "┃")).collect();
    Cells {
        width,
        height: rows.len() as u32,
        cells: rows
            .iter()
            .flat_map(|&y| (x..x + width).map(move |column| (column, y)))
            .map(|(column, y)| cells.cell(column, y).unwrap().clone())
            .collect(),
    }
}

#[track_caller]
fn assert_panel(harness: &Harness, name: &str) {
    let expected = Cells::load(fixtures_dir().join(format!("{name}.json"))).unwrap();
    let expected = panel(&expected, 0, expected.width);
    let actual = panel(&Cells::from_capture(&harness.app.render()), 2, expected.width);
    let comparison = compare(&expected, &actual);
    if !comparison.is_equal() {
        let path = std::env::temp_dir().join("opencode-parity").join(format!("{name}.json"));
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, actual.to_json()).unwrap();
    }
    assert!(
        expected.height == actual.height && comparison.is_equal(),
        "P-COMP {name}: {} rows, Rust {}: {comparison}\n{}",
        expected.height,
        actual.height,
        harness.app.text()
    );
}

fn kinds() -> Value {
    json!([
        { "key": "name", "type": "string", "title": "Name", "required": true },
        { "key": "count", "type": "integer", "title": "Replicas", "minimum": 1, "maximum": 5 },
        { "key": "agree", "type": "boolean", "title": "Confirm", "description": "Restart the service?" },
        { "key": "targets", "type": "multiselect", "title": "Targets", "custom": true, "default": ["a"],
          "options": [{ "value": "a", "label": "Alpha" }, { "value": "b", "label": "Beta", "description": "The second region" }] },
    ])
}

#[test]
fn a_choice_matches_typescript() {
    let harness = parity_form(json!([{
        "key": "target", "type": "string", "custom": true,
        "options": [{ "value": "staging", "label": "Staging" }, { "value": "production", "label": "Production", "description": "Live traffic" }],
    }]));
    harness.wait_for("Type your own answer");
    harness.app.press("down");
    assert_panel(&harness, "E.9b/choice");
}

#[test]
fn each_field_kind_and_the_review_match_typescript() {
    for (tabs, name, ready) in [
        (None, "E.9b/text", "Type your answer"),
        (Some(1), "E.9b/integer", "1-5"),
        (Some(2), "E.9b/boolean", "Restart the service?"),
        (Some(3), "E.9b/multiselect", "Type your own answer"),
        (Some(4), "E.9b/review", "enter submit"),
    ] {
        let harness = parity_form(kinds());
        harness.wait_for("Type your answer");
        if let Some(tabs) = tabs {
            harness.app.type_text("Ada");
            harness.wait_for("Ada");
            for _ in 0..tabs {
                harness.app.press("tab");
            }
        }
        harness.wait_for(ready);
        assert_panel(&harness, name);
    }
}

#[test]
fn an_external_field_and_the_progress_line_match_typescript() {
    let harness = parity_form(json!([{
        "key": "authorization", "type": "external", "url": "https://example.com/authorize",
        "title": "Authorize access", "description": "Sign in to continue.",
    }]));
    harness.wait_for("Sign in to continue.");
    assert_panel(&harness, "E.9b/external");

    let fields: Vec<Value> = ["first", "second", "third", "fourth"]
        .iter()
        .map(|key| json!({ "key": key, "type": "string", "title": format!("The {key} question that is long") }))
        .collect();
    let harness = parity_form(Value::Array(fields));
    harness.wait_for("completed");
    assert_panel(&harness, "E.9b/progress");
}
