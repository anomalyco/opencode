//! Tool rows (E.7b) over a fixture server: webfetch, websearch, subagent, execute, patch, todowrite,
//! question, and skill, each running and finished; a subagent click opens the child session, and an
//! execute click opens its dialog.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use bytes::Bytes;
use opencode_api::client::Client;
use opencode_api::generated::SessionID;
use opencode_api::transport::{BoxFuture, Request, Response, Transport};
use opencode_local::cli_config::{Grouping, Info, Resolved, Session};
use opencode_tui::{Deps, Route, Tui};
use opentui::prelude::Color;
use opentui::testing::TestApp;
use serde_json::{Value, json};

/// Serves the session, an empty child session, and their messages; logs every request.
struct Fixture {
    messages: Vec<Value>,
    log: Mutex<Vec<String>>,
}

impl Transport for Fixture {
    fn send(&self, request: Request) -> BoxFuture<'_, Result<Response, String>> {
        let path = request.url.path().to_owned();
        self.log
            .lock()
            .unwrap()
            .push(format!("{} {path}", request.method));
        Box::pin(async move {
            let (status, body) = match (request.method, path.as_str()) {
                ("GET", "/api/session") => (200, json!({ "data": [], "cursor": {} })),
                ("GET", "/api/session/ses_t") => {
                    (200, json!({ "data": session("ses_t", "Tools") }))
                }
                ("GET", "/api/session/ses_child") => {
                    (200, json!({ "data": session("ses_child", "Child work") }))
                }
                ("GET", "/api/session/ses_t/message") => (
                    200,
                    json!({ "data": self.messages.iter().rev().collect::<Vec<_>>(), "cursor": {} }),
                ),
                ("GET", "/api/session/ses_child/message") => {
                    (200, json!({ "data": [], "cursor": {} }))
                }
                _ => (404, json!({})),
            };
            let body = serde_json::to_vec(&body).unwrap();
            Ok(Response {
                status,
                headers: vec![("content-type".into(), "application/json".into())],
                body: Box::pin(futures_util::stream::iter([Ok(Bytes::from(body))])),
            })
        })
    }
}

fn session(id: &str, title: &str) -> Value {
    json!({
        "id": id, "title": title, "projectID": "project", "cost": 0, "agent": "build",
        "tokens": { "input": 0, "output": 0, "reasoning": 0, "cache": { "read": 0, "write": 0 } },
        "time": { "created": 1, "updated": 1 },
        "location": { "directory": "/project" },
    })
}

fn turn(tools: Vec<Value>) -> Vec<Value> {
    vec![
        json!({ "id": "msg_1", "type": "user", "text": "Run the tools", "time": { "created": 1000 } }),
        json!({
            "id": "msg_2", "type": "assistant", "agent": "build",
            "model": { "providerID": "provider", "id": "model" },
            "time": { "created": 1500 }, "finish": "tool-calls",
            "content": tools,
        }),
    ]
}

fn tool(id: &str, name: &str, state: Value) -> Value {
    json!({
        "type": "tool", "id": id, "name": name, "state": state,
        "time": { "created": 1500, "ran": 1500, "completed": 2750 },
    })
}

fn running(input: Value, metadata: Value) -> Value {
    json!({ "status": "running", "input": input, "metadata": metadata })
}

fn completed(input: Value, output: &str, metadata: Value) -> Value {
    json!({
        "status": "completed", "input": input, "metadata": metadata,
        "content": [{ "type": "text", "text": output }],
    })
}

fn failed(input: Value, message: &str) -> Value {
    json!({ "status": "error", "input": input, "error": { "type": "unknown", "message": message } })
}

struct Harness {
    app: TestApp,
    tui: std::rc::Rc<Tui>,
    fixture: Arc<Fixture>,
}

fn open(width: u16, height: u16, messages: Vec<Value>) -> Harness {
    let fixture = Arc::new(Fixture {
        messages,
        log: Mutex::default(),
    });
    let client = Client::with_transport("http://opencode.local", fixture.clone()).unwrap();
    let app = TestApp::new(width, height);
    let info = Info {
        animations: Some(false),
        session: Some(Session {
            grouping: Some(Grouping::None),
            ..Session::default()
        }),
        ..Info::default()
    };
    let tui = opencode_tui::mount(
        &app,
        Deps {
            client,
            directory: "/project".into(),
            config: Resolved::new(info, |_| None),
            roots: None,
            route: Route::Session {
                id: SessionID("ses_t".into()),
            },
            continue_: false,
            events: false,
        },
    );
    Harness { app, tui, fixture }
}

impl Harness {
    fn wait_for(&self, text: &str) -> String {
        let found = self
            .app
            .wait_until(Duration::from_secs(5), || self.app.text().contains(text));
        let screen = self.app.text();
        let log = self.fixture.log.lock().unwrap().clone();
        assert!(
            found,
            "{text:?} never showed:\n{screen}\nrequests: {log:#?}"
        );
        screen
    }

    fn find(&self, text: &str) -> (u16, u16) {
        let screen = self.app.text();
        screen
            .lines()
            .enumerate()
            .find_map(|(row, line)| {
                line.find(text)
                    .map(|byte| (line[..byte].chars().count() as u16, row as u16))
            })
            .unwrap_or_else(|| panic!("{text:?} is not on screen:\n{screen}"))
    }

    fn fg(&self, text: &str) -> Color {
        let (x, y) = self.find(text);
        self.app
            .render()
            .cell(u32::from(x), u32::from(y))
            .unwrap()
            .fg
    }

    fn click(&self, text: &str) {
        let (x, y) = self.find(text);
        self.app.click(x, y);
        self.app.advance(Duration::from_millis(1));
    }
}

#[test]
fn inline_tools_show_running_and_finished_lines() {
    let messages = turn(vec![
        tool(
            "c1",
            "webfetch",
            running(json!({ "url": "https://example.com" }), json!({})),
        ),
        tool(
            "c2",
            "webfetch",
            completed(
                json!({ "url": "https://opencode.ai/docs" }),
                "# Docs",
                json!({}),
            ),
        ),
        tool("c3", "websearch", running(json!({}), json!({}))),
        tool(
            "c4",
            "websearch",
            completed(
                json!({ "query": "rust tui" }),
                "results",
                json!({ "provider": "exa" }),
            ),
        ),
        tool("c5", "skill", running(json!({}), json!({}))),
        tool(
            "c6",
            "skill",
            completed(
                json!({ "id": "x" }),
                "loaded",
                json!({ "name": "writing-doc" }),
            ),
        ),
        tool(
            "c7",
            "question",
            running(
                json!({ "questions": [{ "question": "A?" }, { "question": "B?" }] }),
                json!({}),
            ),
        ),
        tool(
            "c8",
            "todowrite",
            running(json!({ "todos": [] }), json!({})),
        ),
        tool(
            "c9",
            "todowrite",
            completed(json!({ "todos": [] }), "", json!({})),
        ),
        tool("c10", "todowrite", failed(json!({}), "bad todos")),
    ]);
    let h = open(100, 40, messages);
    let screen = h.wait_for("Todo update failed");
    for line in [
        "   % WebFetch https://example.com\n",
        "   % WebFetch https://opencode.ai/docs\n",
        "   ⋯ Searching web…\n",
        "   ◈ Web Search via Exa \"rust tui\"\n",
        "   ⋯ Loading skill…\n",
        "   → Skill \"writing-doc\"\n",
        "   → Asked 2 questions\n",
        "   ⋯ Updating todos…\n",
        "   ⚙ Cleared todos\n",
        "   ⚙ Todo update failed\n",
    ] {
        assert!(screen.contains(line), "{line:?} missing:\n{screen}");
    }
    let theme = h.tui.page();
    assert_eq!(h.fg("Todo update failed"), theme.text.feedback.error.base);
}

#[test]
fn blocks_list_todos_answers_and_patched_files() {
    let patch = "Index: a.rs\n===\n--- a.rs\n+++ a.rs\n@@ -1 +1 @@\n-old\n+new\n";
    let messages = turn(vec![
        tool(
            "c1",
            "todowrite",
            completed(
                json!({ "todos": [
                    { "content": "Write the views", "status": "completed" },
                    { "content": "Prove them", "status": "in_progress" },
                    { "content": "Drop legacy", "status": "cancelled" },
                    { "content": "Report", "status": "pending" },
                ] }),
                "",
                json!({}),
            ),
        ),
        tool(
            "c2",
            "question",
            completed(
                json!({ "questions": [{ "question": "Which design?" }, { "question": "Ship it?" }] }),
                "",
                json!({ "answers": [["New", "Both"], []] }),
            ),
        ),
        tool(
            "c3",
            "apply_patch",
            completed(
                json!({ "patchText": "*** Begin Patch" }),
                "",
                json!({ "files": [
                    { "file": "a.rs", "type": "update", "patch": patch, "additions": 1, "deletions": 1 },
                    { "file": "gone.rs", "type": "delete", "patch": "", "additions": 0, "deletions": 3 },
                ] }),
            ),
        ),
        tool(
            "c4",
            "apply_patch",
            running(
                json!({ "patchText": "*** Begin Patch\n*** Add File: src/new.rs\n+x" }),
                json!({}),
            ),
        ),
        tool(
            "c5",
            "apply_patch",
            failed(
                json!({ "patchText": "*** Update File: a.rs\n*** Update File: b.rs" }),
                "context mismatch",
            ),
        ),
    ]);
    let h = open(100, 60, messages);
    let screen = h.wait_for("Patch failed");
    for text in [
        "# Todos",
        "[✓] Write the views",
        "[•] Prove them",
        "[-] Drop legacy",
        "[ ] Report",
        "# Questions",
        "Which design?",
        "New, Both",
        "(no answer)",
        "← Patched a.rs",
        "# Deleted gone.rs",
        "-3 lines",
        "⋯ Patching src/new.rs",
        "# Patch failed",
        "context mismatch",
    ] {
        assert!(screen.contains(text), "{text:?} missing:\n{screen}");
    }
    let theme = h.tui.page();
    assert_eq!(h.fg("Prove them"), theme.text.feedback.warning.base);
    assert_eq!(h.fg("Drop legacy"), theme.text.faint);
    assert_eq!(h.fg("# Patch failed"), theme.text.feedback.error.base);
    assert_eq!(h.fg("context mismatch"), theme.text.muted);
    assert_eq!(h.fg("-3 lines"), theme.diff.text.removed);
}

#[test]
fn a_subagent_row_opens_its_child_session() {
    let messages = turn(vec![
        tool(
            "c1",
            "task",
            running(
                json!({ "description": "Survey the views", "subagent_type": "explore", "model": "provider/model#high" }),
                json!({ "sessionID": "ses_child" }),
            ),
        ),
        tool(
            "c2",
            "task",
            completed(
                json!({ "description": "Check the docs", "agent": "general" }),
                "done",
                json!({ "sessionID": "ses_child", "status": "running" }),
            ),
        ),
        tool(
            "c3",
            "task",
            completed(
                json!({ "description": "Resume", "sessionID": "ses_child" }),
                "done",
                json!({}),
            ),
        ),
    ]);
    let h = open(100, 30, messages);
    let screen = h.wait_for("Resume");
    for line in [
        "   ⋯ Explore Subagent — Survey the views · provider/model (high)\n",
        "   ✓ General Subagent — Check the docs  Background\n",
        "   ↳ Continue subagent — Resume\n",
    ] {
        assert!(screen.contains(line), "{line:?} missing:\n{screen}");
    }
    let theme = h.tui.page();
    assert_eq!(h.fg("Background"), theme.text.muted);

    h.click("Check the docs");
    let found = h.app.wait_until(Duration::from_secs(5), || {
        h.tui.route()
            == Route::Session {
                id: SessionID("ses_child".into()),
            }
    });
    assert!(found, "still on {:?}", h.tui.route());
    h.wait_for("Child work");
    assert!(
        h.fixture
            .log
            .lock()
            .unwrap()
            .iter()
            .any(|line| line == "GET /api/session/ses_child/message"),
    );
}

#[test]
fn execute_lists_its_calls_and_opens_the_dialog() {
    let calls = json!([
        { "tool": "read", "status": "completed", "input": { "path": "src/a.rs" } },
        { "tool": "grep", "status": "error", "input": { "pattern": "TODO" } },
        { "tool": "glob", "status": "running" },
    ]);
    let messages = turn(vec![
        tool(
            "c1",
            "execute",
            running(
                json!({ "code": "await read()" }),
                json!({ "toolCalls": calls }),
            ),
        ),
        tool(
            "c2",
            "execute",
            completed(
                json!({ "code": "const a = 1\nreturn a" }),
                "{\"a\":1}\n\nLogs:\nhello",
                json!({ "toolCalls": [] }),
            ),
        ),
        tool(
            "c3",
            "execute",
            completed(
                json!({ "code": "throw 1" }),
                "Error: boom\n  at main",
                json!({ "error": true }),
            ),
        ),
    ]);
    let h = open(120, 40, messages);
    let screen = h.wait_for("Error: boom");
    for line in [
        "   ⋯ execute\n",
        "   › read [path=src/a.rs]\n",
        "   ✗ grep [pattern=TODO]\n",
        "   › glob\n",
        "   ✓ execute\n",
        "   ✗ execute\n",
        "\n     ↳ Error: boom\n",
        "\n         at main\n",
    ] {
        assert!(screen.contains(line), "{line:?} missing:\n{screen}");
    }
    let theme = h.tui.page();
    assert_eq!(h.fg("✗ execute"), theme.text.feedback.error.base);

    // A nested call expands its inputs.
    h.click("read [path=src/a.rs]");
    h.wait_for("path: src/a.rs");

    // The finished call opens the dialog with its code and output.
    let (x, y) = h.find("✓ execute");
    h.app.click(x + 2, y);
    h.app.advance(Duration::from_millis(1));
    let screen = h.wait_for("Completed · 1.3s");
    for text in [
        "Code",
        "1 const a = 1",
        "2 return a",
        "Output",
        "{\"a\":1}",
        "Logs:",
        "copy code",
        "copy output",
    ] {
        assert!(screen.contains(text), "{text:?} missing:\n{screen}");
    }
}
