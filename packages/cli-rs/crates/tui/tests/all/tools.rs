//! Tool rows (E.7a) over a fixture server: the inline tools (read, glob, grep, write before it
//! lands, the generic tool), the block tools (shell, write, edit), each running and finished, the
//! error and denied states, clicks that expand, and the warning color of a call that waits on a
//! permission request.

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

/// Serves one session, its messages, its permission requests, and shell output; logs every request.
struct Fixture {
    messages: Vec<Value>,
    permissions: Vec<Value>,
    log: Mutex<Vec<String>>,
}

impl Transport for Fixture {
    fn send(&self, request: Request) -> BoxFuture<'_, Result<Response, String>> {
        let path = request.url.path().to_owned();
        let query = request.url.query().unwrap_or_default().to_owned();
        self.log.lock().unwrap().push(format!("{} {path}?{query}", request.method));
        Box::pin(async move {
            let (status, body) = match (request.method, path.as_str()) {
                ("GET", "/api/session") => (200, json!({ "data": [], "cursor": {} })),
                ("GET", "/api/session/ses_t") => (200, json!({ "data": session() })),
                ("GET", "/api/session/ses_t/message") => {
                    (200, json!({ "data": self.messages.iter().rev().collect::<Vec<_>>(), "cursor": {} }))
                }
                ("GET", "/api/session/ses_t/permission") => (200, json!({ "data": self.permissions })),
                ("GET", "/api/shell/sh_1/output") => (
                    200,
                    json!({
                        "location": { "directory": "/project" },
                        "data": { "output": "hi from the shell\n", "cursor": 18, "size": 18, "truncated": false },
                    }),
                ),
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

fn session() -> Value {
    json!({
        "id": "ses_t", "title": "Tools", "projectID": "project", "cost": 0, "agent": "build",
        "tokens": { "input": 0, "output": 0, "reasoning": 0, "cache": { "read": 0, "write": 0 } },
        "time": { "created": 1, "updated": 1 },
        "location": { "directory": "/project" },
    })
}

/// A user prompt, then one assistant step that calls `tools`.
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
    json!({ "type": "tool", "id": id, "name": name, "state": state, "time": { "created": 1500 } })
}

fn streaming(input: &str) -> Value {
    json!({ "status": "streaming", "input": input })
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

fn open(width: u16, height: u16, messages: Vec<Value>, permissions: Vec<Value>) -> Harness {
    let fixture = Arc::new(Fixture { messages, permissions, log: Mutex::default() });
    let client = Client::with_transport("http://opencode.local", fixture.clone()).unwrap();
    let app = TestApp::new(width, height);
    // Each call in its own row: grouping is E.8's.
    let info = Info {
        animations: Some(false),
        session: Some(Session { grouping: Some(Grouping::None), ..Session::default() }),
        ..Info::default()
    };
    let tui = opencode_tui::mount(
        &app,
        Deps {
            client,
            directory: "/project".into(),
            config: Resolved::new(info, |_| None),
            roots: None,
            route: Route::Session { id: SessionID("ses_t".into()) },
            continue_: false,
            events: false,
        },
    );
    Harness { app, tui, fixture }
}

impl Harness {
    fn wait_for(&self, text: &str) -> String {
        let found = self.app.wait_until(Duration::from_secs(5), || self.app.text().contains(text));
        let screen = self.app.text();
        let log = self.fixture.log.lock().unwrap().clone();
        assert!(found, "{text:?} never showed:\n{screen}\nrequests: {log:#?}");
        screen
    }

    /// The column and row where `text` starts.
    fn find(&self, text: &str) -> (u16, u16) {
        let screen = self.app.text();
        screen
            .lines()
            .enumerate()
            .find_map(|(row, line)| line.find(text).map(|byte| (line[..byte].chars().count() as u16, row as u16)))
            .unwrap_or_else(|| panic!("{text:?} is not on screen:\n{screen}"))
    }

    fn fg(&self, text: &str) -> Color {
        let (x, y) = self.find(text);
        let capture = self.app.render();
        capture.cell(u32::from(x), u32::from(y)).unwrap().fg
    }

    fn bg(&self, text: &str) -> Color {
        let (x, y) = self.find(text);
        let capture = self.app.render();
        capture.cell(u32::from(x), u32::from(y)).unwrap().bg
    }

    fn click(&self, text: &str) {
        let (x, y) = self.find(text);
        self.app.click(x, y);
        self.app.advance(Duration::from_millis(1));
    }
}

#[test]
fn inline_tools_show_pending_running_and_finished_lines() {
    let messages = turn(vec![
        tool("call_1", "read", running(json!({ "path": "/project/src/a.rs", "offset": 10, "limit": 80 }), json!({}))),
        tool(
            "call_2",
            "read",
            completed(json!({ "path": "/project/src/b.rs" }), "fn b() {}", json!({ "loaded": ["/project/AGENTS.md"] })),
        ),
        tool("call_3", "glob", streaming("{\"pat")),
        tool(
            "call_4",
            "glob",
            completed(json!({ "pattern": "**/*.rs", "path": "/project/src" }), "a.rs", json!({ "count": 3 })),
        ),
        tool("call_5", "grep", completed(json!({ "pattern": "TODO" }), "a.rs:1", json!({ "matches": 1 }))),
        tool("call_6", "grep", failed(json!({ "pattern": "secret" }), "The user rejected permission to use this tool")),
        tool("call_7", "write", running(json!({ "path": "/project/new.rs" }), json!({}))),
        tool("call_8", "bash", streaming("")),
    ]);
    let h = open(100, 40, messages, Vec::new());
    let screen = h.wait_for("Grep \"TODO\"");
    let theme = h.tui.page();

    // Running: the spinner (still with animations off) and the line; finished: the icon.
    assert!(screen.contains("   ⋯ Read src/a.rs:10-89\n"), "{screen}");
    assert!(screen.contains("   → Read src/b.rs\n"), "{screen}");
    assert!(screen.contains("      ↳ Loaded AGENTS.md\n"), "{screen}");
    // Still streaming its input: the pending label.
    assert!(screen.contains("   ⋯ Finding files…\n"), "{screen}");
    assert!(screen.contains("   ✱ Glob \"**/*.rs\" in src (3 matches)\n"), "{screen}");
    assert!(screen.contains("   ✱ Grep \"TODO\" (1 match)\n"), "{screen}");
    assert!(screen.contains("   ← Write new.rs\n"), "{screen}");
    // A legacy name maps to its view: `bash` is the shell, here before its command arrives.
    assert!(screen.contains("Writing command…"), "{screen}");
    assert_eq!(h.fg("Read src/b.rs"), theme.text.muted);

    // A denied call is struck through in the muted color, not shown as an error.
    let (x, y) = h.find("Grep \"secret\"");
    let capture = h.app.render();
    let cell = capture.cell(u32::from(x), u32::from(y)).unwrap();
    assert_eq!(cell.fg, theme.text.muted);
    assert!(cell.attributes.contains(opentui::prelude::Attributes::STRIKETHROUGH), "{:?}", cell.attributes);
}

#[test]
fn a_failed_call_shows_its_error_on_click() {
    let messages = turn(vec![tool(
        "call_1",
        "glob",
        failed(json!({ "pattern": "*.md" }), "\u{1b}[31mNo such directory\u{1b}[0m"),
    )]);
    let h = open(100, 30, messages, Vec::new());
    h.wait_for("Glob \"*.md\"");
    let theme = h.tui.page();
    assert_eq!(h.fg("Glob \"*.md\""), theme.text.feedback.error.base);
    assert!(!h.app.text().contains("No such directory"));
    h.click("Glob \"*.md\"");
    // The ANSI codes are stripped; the error sits under the text, past the icon.
    let screen = h.wait_for("No such directory");
    assert!(screen.contains("     No such directory\n"), "{screen}");
    // Apart from the first click, so the two are not a double click that selects a word.
    h.app.advance(Duration::from_secs(1));
    h.click("Glob \"*.md\"");
    let gone = h.app.wait_until(Duration::from_secs(2), || !h.app.text().contains("No such directory"));
    assert!(gone, "{}", h.app.text());
}

#[test]
fn shell_blocks_collapse_their_output_and_read_a_named_shell_on_click() {
    let lines: Vec<String> = (1..=20).map(|line| format!("line {line}")).collect();
    let messages = turn(vec![
        tool("call_1", "shell", running(json!({ "command": "npm test", "workdir": "/project/web" }), json!({}))),
        tool("call_2", "shell", completed(json!({ "command": "seq 20" }), &lines.join("\n"), json!({}))),
        tool(
            "call_3",
            "shell",
            completed(json!({ "command": "echo hi" }), "hi\n\n<shell status>", json!({ "shellID": "sh_1", "exit": 0 })),
        ),
        tool("call_4", "shell", failed(json!({ "command": "false" }), "Command failed")),
    ]);
    let h = open(100, 60, messages, Vec::new());
    let screen = h.wait_for("$ false");
    let theme = h.tui.page();

    // Running: the spinner beside the command, with the working directory as a `cd`.
    assert!(screen.contains("⋯ cd web && npm test"), "{screen}");
    // Finished: the command, then the output's tail under a count of the lines it hides.
    assert!(screen.contains("$ seq 20"), "{screen}");
    assert!(screen.contains("(13 earlier lines)"), "{screen}");
    assert!(!screen.contains("line 13\n"), "{screen}");
    assert!(screen.contains("line 20"), "{screen}");
    // A named shell's output is read from the server, not taken from the tool's content.
    assert!(screen.contains("$ echo hi"), "{screen}");
    assert!(!screen.contains("<shell status>"), "{screen}");
    // The error under the command, in the error color.
    assert_eq!(h.fg("Command failed"), theme.text.feedback.error.base);
    // Blocks sit on the raised background behind a rule in the page color.
    assert_eq!(h.bg("$ seq 20"), theme.background.raised.base);
    let (x, y) = h.find("$ seq 20");
    let capture = h.app.render();
    let rule = capture.cell(u32::from(x) - 3, u32::from(y)).unwrap();
    assert_eq!(rule.symbol, "┃");

    // A click expands the output.
    h.click("$ seq 20");
    let screen = h.wait_for("line 1\n");
    assert!(!screen.contains("earlier lines"), "{screen}");

    // A click on the named shell reads its output from the start.
    h.click("$ echo hi");
    h.wait_for("hi from the shell");
    let log = h.fixture.log.lock().unwrap().clone();
    let reads: Vec<_> = log.iter().filter(|line| line.contains("/api/shell/")).collect();
    assert_eq!(
        reads,
        ["GET /api/shell/sh_1/output?location%5Bdirectory%5D=%2Fproject&cursor=0&limit=1048576"],
        "{log:?}"
    );
}

#[test]
fn write_and_edit_blocks_show_the_file_and_the_diff() {
    let patch = "Index: src/a.rs\n===\n--- src/a.rs\n+++ src/a.rs\n@@ -1,3 +1,3 @@\n fn main() {\n-    old();\n+    new();\n }\n";
    let messages = turn(vec![
        tool(
            "call_1",
            "write",
            completed(
                json!({ "path": "/project/src/new.rs", "content": "fn main() {}\nfn other() {}" }),
                "Wrote",
                json!({ "diagnostics": { "/project/src/new.rs": [
                    { "severity": 1, "message": "expected item", "range": { "start": { "line": 1, "character": 3 } } },
                ] } }),
            ),
        ),
        tool("call_2", "edit", streaming("{\"pa")),
        tool("call_3", "edit", running(json!({ "path": "/project/src/b.rs" }), json!({}))),
        tool(
            "call_4",
            "edit",
            completed(
                json!({ "path": "/project/src/a.rs" }),
                "Edited",
                json!({ "files": [{
                    "file": "src/a.rs", "filePath": "/project/src/a.rs", "type": "update",
                    "patch": patch, "additions": 1, "deletions": 1,
                }] }),
            ),
        ),
    ]);
    let h = open(100, 60, messages, Vec::new());
    let screen = h.wait_for("new();");

    assert!(screen.contains("# Wrote src/new.rs"), "{screen}");
    assert!(screen.contains("  1 fn main() {}"), "{screen}");
    assert!(screen.contains("  2 fn other() {}"), "{screen}");
    assert!(screen.contains("Error [2:4] expected item"), "{screen}");
    assert!(screen.contains("⋯ Preparing edit…"), "{screen}");
    assert!(screen.contains("← Edit src/b.rs"), "{screen}");
    assert!(screen.contains("← Edit src/a.rs"), "{screen}");
    // 96 columns of content: a unified diff, the removed line above the added one.
    let (_, removed) = h.find("old();");
    let (_, added) = h.find("new();");
    assert_eq!(added, removed + 1, "{screen}");
    assert!(screen.contains("2 -     old();"), "{screen}");
    assert!(screen.contains("2 +     new();"), "{screen}");
}

#[test]
fn the_edit_diff_splits_above_120_columns() {
    let patch = "--- src/a.rs\n+++ src/a.rs\n@@ -1,3 +1,3 @@\n fn main() {\n-    old();\n+    new();\n }\n";
    let messages = turn(vec![tool(
        "call_1",
        "edit",
        completed(
            json!({ "path": "/project/src/a.rs" }),
            "Edited",
            json!({ "files": [{
                "relativePath": "src/a.rs", "status": "modified", "patch": patch,
                "additions": 1, "deletions": 1,
            }] }),
        ),
    )]);
    let h = open(140, 30, messages, Vec::new());
    let screen = h.wait_for("new();");
    let (_, removed) = h.find("old();");
    let (_, added) = h.find("new();");
    assert_eq!(added, removed, "{screen}");
}

#[test]
fn the_generic_tool_lists_its_inputs_and_output_on_click() {
    let input = json!({ "url": "https://example.com", "depth": 2, "options": { "deep": true } });
    let messages = turn(vec![
        tool("call_1", "mcp_fetch", completed(input.clone(), "\u{1b}[1mfetched\u{1b}[0m 3 pages", json!({}))),
        tool("call_2", "mcp_scan", running(json!({ "target": "a b" }), json!({}))),
        tool("call_3", "mcp_drop", failed(json!({}), "Tool not found")),
    ]);
    let h = open(100, 40, messages, Vec::new());
    let screen = h.wait_for("mcp_fetch");
    let theme = h.tui.page();
    assert!(screen.contains("   ✓ mcp_fetch [url=https://example.com, depth=2]\n"), "{screen}");
    assert!(screen.contains("   ⋯ mcp_scan [target=a b]\n"), "{screen}");
    assert!(screen.contains("   ✗ mcp_drop\n"), "{screen}");
    assert_eq!(h.fg("mcp_drop"), theme.text.feedback.error.base);

    // Hovering a clickable line brightens it.
    let (x, y) = h.find("mcp_fetch");
    h.app.hover(x, y);
    h.app.advance(Duration::from_millis(1));
    assert_eq!(h.fg("mcp_fetch"), theme.text.base);

    h.click("mcp_fetch");
    let screen = h.wait_for("output: fetched 3 pages");
    assert!(screen.contains("     url: https://example.com\n"), "{screen}");
    assert!(screen.contains("     depth: 2\n"), "{screen}");
    assert!(screen.contains("     options: {\n"), "{screen}");
    assert!(screen.contains("\"deep\": true"), "{screen}");
}

#[test]
fn a_call_waiting_on_permission_takes_the_warning_color() {
    let messages = turn(vec![
        tool("call_1", "grep", running(json!({ "pattern": "TODO" }), json!({}))),
        tool("call_2", "shell", running(json!({ "command": "rm -rf build" }), json!({}))),
    ]);
    let request = |id: &str, call: &str, action: &str| {
        json!({
            "id": id, "sessionID": "ses_t", "action": action, "resources": ["*"],
            "source": { "type": "tool", "messageID": "msg_2", "id": call },
        })
    };
    let h = open(100, 40, messages, vec![request("per_1", "call_2", "shell")]);
    h.wait_for("Permission required");
    let theme = h.tui.page();
    let screen = h.wait_for("Grep \"TODO\"");
    // Only the first request's call is waiting.
    assert_eq!(h.fg("rm -rf build"), theme.text.feedback.warning.base, "{screen}");
    assert_eq!(h.fg("Grep \"TODO\""), theme.text.muted);
}

#[test]
fn a_running_shell_the_store_lists_reads_its_output_every_second() {
    let messages =
        turn(vec![tool("call_1", "shell", running(json!({ "command": "npm run dev" }), json!({ "shellID": "sh_1" })))]);
    let h = open(100, 30, messages, Vec::new());
    h.wait_for("npm run dev");
    let reads = || h.fixture.log.lock().unwrap().iter().filter(|line| line.contains("/api/shell/sh_1/output")).count();
    // Not listed yet: nothing to read.
    h.app.advance(Duration::from_secs(2));
    assert_eq!(reads(), 0);

    let event = |kind: &str, data: Value| {
        let event = json!({
            "id": format!("evt_{kind}"), "created": 1, "type": kind,
            "location": { "directory": "/project" }, "data": data,
        });
        serde_json::from_value::<opencode_api::generated::V2Event>(event).unwrap()
    };
    h.tui.data.apply(&[event(
        "shell.created",
        json!({ "info": {
            "id": "sh_1", "status": "running", "command": "npm run dev", "cwd": "/project",
            "shell": "/bin/sh", "file": "/shell-output", "metadata": {}, "time": { "started": 1 },
        } }),
    )]);
    h.wait_for("hi from the shell");
    let first = reads();
    assert!(first >= 1);
    h.app.advance(Duration::from_millis(1100));
    let polled = h.app.wait_until(Duration::from_secs(2), || reads() > first);
    assert!(polled, "no second read");

    // Once the shell exits, one last read drains it and the polling stops.
    h.tui.data.apply(&[event("shell.exited", json!({ "id": "sh_1", "exit": 0, "status": "completed" }))]);
    h.app.advance(Duration::from_millis(10));
    h.app.wait_until(Duration::from_millis(300), || false);
    let stopped = reads();
    h.app.advance(Duration::from_secs(3));
    h.app.wait_until(Duration::from_millis(300), || false);
    assert_eq!(reads(), stopped);
    assert!(h.app.text().contains("hi from the shell"));
}
