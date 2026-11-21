//! Tool transcript rows, states, and click actions.

use crate::support::{self, Fake, Harness, Log, WAIT, deref_harness};

use std::sync::Arc;
use std::time::Duration;

use opencode_api::generated::SessionID;
use opencode_local::cli_config::{Grouping, Info, Session, Verbosity};
use opencode_tui::{Deps, Route};
use opentui::prelude::Color;
use serde_json::{Value, json};

fn fake(messages: Vec<Value>, permissions: Vec<Value>) -> Fake {
    Fake::new(move |seen| match (seen.method.as_str(), seen.path.as_str()) {
        ("GET", "/api/session") => (200, json!({ "data": [], "cursor": {} })),
        ("GET", "/api/session/ses_t") => (200, json!({ "data": session("ses_t", "Tools") })),
        ("GET", "/api/session/ses_child") => (200, json!({ "data": session("ses_child", "Child work") })),
        ("GET", "/api/session/ses_t/message") => {
            (200, json!({ "data": messages.iter().rev().collect::<Vec<_>>(), "cursor": {} }))
        }
        ("GET", "/api/session/ses_child/message") => (200, json!({ "data": [], "cursor": {} })),
        ("GET", "/api/session/ses_t/permission") => (200, json!({ "data": permissions })),
        ("GET", "/api/shell/sh_1/output") => (
            200,
            support::list(
                "/project",
                json!({ "output": "hi from the shell\n", "cursor": 18, "size": 18, "truncated": false }),
            ),
        ),
        _ => support::not_found(),
    })
}

fn session(id: &str, title: &str) -> Value {
    support::merge(support::session(id, title), json!({ "agent": "build" }))
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
    json!({ "type": "tool", "id": id, "name": name, "state": state, "time": { "created": 1500 } })
}

/// A tool call that ran for 1.25s.
fn timed(id: &str, name: &str, state: Value) -> Value {
    support::merge(tool(id, name, state), json!({ "time": { "created": 1500, "ran": 1500, "completed": 2750 } }))
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

struct Tools {
    harness: Harness,
    seen: Log,
}

deref_harness!(Tools);

fn open(width: u16, height: u16, messages: Vec<Value>, permissions: Vec<Value>) -> Tools {
    let fake = fake(messages, permissions);
    let seen = fake.log();
    let info = Info {
        animations: Some(false),
        session: Some(Session {
            grouping: Some(Grouping::None),
            verbosity: Some(Verbosity::Medium),
            ..Session::default()
        }),
        ..Info::default()
    };
    let deps =
        Deps { config: support::config(info), route: support::session_route("ses_t"), ..support::deps(Arc::new(fake)) };
    Tools { harness: support::mount(width, height, deps), seen }
}

impl Tools {
    fn log(&self) -> Vec<String> {
        let seen = self.seen.lock().unwrap();
        seen.iter().map(|seen| format!("{} {}?{}", seen.method, seen.path, seen.query)).collect()
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
    let theme = h.tui.page();

    // Paths show relative to the location, whose read can land after the transcript's. Running: the spinner (still
    // with animations off) and the line; finished: the icon. Still streaming its input: the pending label. A legacy
    // name maps to its view: `bash` is the shell, here before its command arrives.
    h.wait_for_all(&[
        "   ⋯ Read src/a.rs:10-89\n",
        "   → Read src/b.rs\n",
        "      ↳ Loaded AGENTS.md\n",
        "   ⋯ Finding files…\n",
        "   ✱ Glob \"**/*.rs\" in src (3 matches)\n",
        "   ✱ Grep \"TODO\" (1 match)\n",
        "   ← Write new.rs\n",
        "Writing command…",
    ]);
    assert_eq!(h.fg("Read src/b.rs"), theme.text.muted);

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
    let screen = h.wait_for("No such directory");
    assert!(screen.contains("     No such directory\n"), "{screen}");
    // Apart from the first click, so the two are not a double click that selects a word.
    h.app.advance(Duration::from_secs(1));
    h.click("Glob \"*.md\"");
    let gone = h.app.wait_until(WAIT, || !h.app.text().contains("No such directory"));
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
    // Running: the spinner beside the command, with the working directory as a `cd` relative to the location, whose
    // read can land after the transcript's. Finished: the command, then the output's tail under a count of the lines
    // it hides.
    let screen =
        h.wait_for_all(&["$ false", "⋯ cd web && npm test", "$ seq 20", "(13 earlier lines)", "line 20", "$ echo hi"]);
    let theme = h.tui.page();
    assert!(!screen.contains("line 13\n"), "{screen}");
    assert!(!screen.contains("<shell status>"), "{screen}");
    assert_eq!(h.fg("Command failed"), theme.text.feedback.error.base);
    assert_eq!(h.bg("$ seq 20"), theme.background.raised.base);
    let (x, y) = h.find("$ seq 20");
    let capture = h.app.render();
    let rule = capture.cell(u32::from(x) - 3, u32::from(y)).unwrap();
    assert_eq!(rule.symbol, "┃");

    h.click("$ seq 20");
    let screen = h.wait_for("line 1\n");
    assert!(!screen.contains("earlier lines"), "{screen}");

    h.click("$ echo hi");
    h.wait_for("hi from the shell");
    let log = h.log();
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
    // Paths show relative to the location, whose read can land after the transcript's. 96 columns of content: a
    // unified diff.
    let screen = h.wait_for_all(&[
        "# Wrote src/new.rs",
        "  1 fn main() {}",
        "  2 fn other() {}",
        "Error [2:4] expected item",
        "⋯ Preparing edit…",
        "← Edit src/b.rs",
        "← Edit src/a.rs",
        "2 -     old();",
        "2 +     new();",
    ]);
    let (_, removed) = h.find("old();");
    let (_, added) = h.find("new();");
    assert_eq!(added, removed + 1, "{screen}");
}

/// A theme switch restyles every tool row in place: open output and errors stay open, the diff and the written file
/// keep their code, and each cell equals the rows mounted in the new theme.
#[test]
fn a_theme_switch_restyles_the_tool_rows_in_place() {
    let patch = "--- src/a.rs\n+++ src/a.rs\n@@ -1,3 +1,3 @@\n fn main() {\n-    old();\n+    new();\n }\n@@ -9,2 +9,2 @@\n x\n-y\n+z\n";
    let lines: Vec<String> = (1..=20).map(|line| format!("line {line}")).collect();
    let messages = turn(vec![
        tool("call_1", "read", running(json!({ "path": "/project/src/a.rs" }), json!({}))),
        tool(
            "call_2",
            "read",
            completed(json!({ "path": "/project/b.rs" }), "b", json!({ "loaded": ["/project/c.md"] })),
        ),
        tool("call_3", "glob", failed(json!({ "pattern": "*.md" }), "No such directory")),
        tool("call_4", "grep", failed(json!({ "pattern": "secret" }), "The user rejected permission to use this tool")),
        tool("call_5", "shell", running(json!({ "command": "npm test" }), json!({}))),
        tool("call_6", "shell", completed(json!({ "command": "seq 20" }), &lines.join("\n"), json!({}))),
        tool("call_7", "mcp_fetch", completed(json!({ "url": "https://example.com" }), "fetched", json!({}))),
        tool(
            "call_8",
            "write",
            completed(
                json!({ "path": "/project/src/new.rs", "content": "fn main() {\n    let x = \"a\"; // b\n}" }),
                "Wrote",
                json!({ "diagnostics": { "/project/src/new.rs": [
                    { "severity": 1, "message": "expected item", "range": { "start": { "line": 1, "character": 3 } } },
                ] } }),
            ),
        ),
        tool(
            "call_9",
            "edit",
            completed(
                json!({ "path": "/project/src/a.rs" }),
                "Edited",
                json!({ "files": [{
                    "file": "src/a.rs", "filePath": "/project/src/a.rs", "type": "update",
                    "patch": patch, "additions": 2, "deletions": 2,
                }] }),
            ),
        ),
    ]);
    support::assert_restyles_in_place(
        || open(100, 100, messages.clone(), Vec::new()),
        |h| {
            h.wait_for_all(&["Glob \"*.md\"", "$ seq 20", "mcp_fetch", "Error [2:4] expected item", "+     new();"]);
            h.click("Glob \"*.md\"");
            h.click("$ seq 20");
            h.app.advance(Duration::from_secs(1));
            h.click("mcp_fetch");
        },
        |screen| {
            ["No such directory", "line 1\n", "url: https://example.com", "Loaded c.md"]
                .iter()
                .all(|text| screen.contains(text))
        },
    );
}

#[test]
fn the_edit_diff_splits_in_a_session_pane_above_120_columns() {
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
    assert_ne!(added, removed, "{screen}");
    opencode_tui::dialogs::settings::update(&h.tui, |draft| {
        opencode_tui::dialogs::settings::set_path(draft, &["session", "sidebar"], json!("hide"))
    });
    let split = h.app.wait_until(WAIT, || {
        h.app.render();
        h.find("old();").1 == h.find("new();").1
    });
    assert!(split, "{}", h.app.text());
}

/// A write or edit block keeps no copy of its file or patch: the store holds the text, and OpenTUI's views their own.
/// The Rust heap this thread keeps after a mount grows with the text by the copies; the fixed cost cancels out
/// between two sizes. The store's copy is decoded on the runtime's threads and does not count.
#[test]
fn write_and_edit_blocks_keep_no_second_copy_of_the_text() {
    // Rust heap this thread keeps after mounting a completed call whose text has `size` bytes and ends in `end`.
    let kept = |name: &str, size: usize| {
        let mut text: String =
            (0..size / 32).map(|line| format!("let value_{line:05} = compute({line:05});\n")).collect();
        text.push_str("end");
        let (input, metadata) = match name {
            "write" => (json!({ "path": "/project/w.rs", "content": text }), json!({})),
            _ => (
                json!({ "path": "/project/e.rs" }),
                json!({ "files": [{
                    "file": "e.rs", "filePath": "/project/e.rs", "type": "update",
                    "patch": format!("--- e.rs\n+++ e.rs\n@@ -1 +1,{} @@\n-x\n+{}\n", size / 32 + 1, text.replace('\n', "\n+")),
                    "additions": size / 32 + 1, "deletions": 1,
                }] }),
            ),
        };
        let messages = turn(vec![tool("call_1", name, completed(input, "Done", metadata))]);
        let measure = support::heap::measure();
        let h = open(100, 40, messages, Vec::new());
        h.wait_for("end\n");
        measure.kept()
    };
    for (name, bound) in [("write", 1.6), ("edit", 10.1)] {
        // The first mount on a thread also fills caches that live for the process.
        kept(name, 4096);
        let (small, large) = (kept(name, 4096), kept(name, 69_632));
        let copies = (large - small) as f64 / 65_536.0;
        assert!(copies < bound, "{name} keeps {copies:.2} copies of its text, at most {bound}");
    }
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
fn a_theme_switch_restyles_the_permission_prompt_in_place() {
    let patch = "--- src/a.rs\n+++ src/a.rs\n@@ -1,3 +1,3 @@\n fn main() {\n-    old();\n+    new();\n }\n";
    let metadata = json!({ "files": [{
        "file": "src/a.rs", "filePath": "/project/src/a.rs", "type": "update", "patch": patch,
        "additions": 1, "deletions": 1,
    }] });
    let messages = turn(vec![tool("call_1", "edit", running(json!({ "path": "/project/src/a.rs" }), metadata))]);
    let request = json!({
        "id": "per_1", "sessionID": "ses_t", "action": "edit", "resources": ["/project/src/a.rs"], "save": ["*"],
        "source": { "type": "tool", "messageID": "msg_2", "id": "call_1" },
    });
    support::assert_restyles_in_place(
        || open(100, 40, messages.clone(), vec![request.clone()]),
        |h| {
            h.wait_for_all(&["Permission required", "+     new();"]);
            h.app.press("right");
        },
        |screen| screen.contains("This will always allow"),
    );
}

#[test]
fn a_shell_moved_to_the_background_draws_only_its_command() {
    let output = "Command moved to the background (shell ID: sh_1).\nPID: 4321\nOutput is streaming to: /shell-output\n\nThe command did not finish within its timeout of 120 seconds and was moved to the background. Do not start another copy while it is running.";
    let messages = turn(vec![tool(
        "call_1",
        "shell",
        completed(
            json!({ "command": "npm run build" }),
            output,
            json!({ "status": "running", "shellID": "sh_1", "pid": 4321, "truncated": false }),
        ),
    )]);
    let h = open(100, 30, messages, Vec::new());
    let screen = h.wait_for("$ npm run build");
    assert!(!screen.contains("moved to the background"), "{screen}");
    assert!(!screen.contains("PID"), "{screen}");
}

#[test]
fn a_running_shell_the_store_lists_reads_its_output_every_second() {
    let messages =
        turn(vec![tool("call_1", "shell", running(json!({ "command": "npm run dev" }), json!({ "shellID": "sh_1" })))]);
    let h = open(100, 30, messages, Vec::new());
    h.wait_for("npm run dev");
    let reads = || h.log().iter().filter(|line| line.contains("/api/shell/sh_1/output")).count();
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
    let polled = h.app.wait_until(WAIT, || reads() > first);
    assert!(polled, "no second read");

    // Once the shell exits, one last read drains it and the polling stops.
    let running = reads();
    h.tui.data.apply(&[event("shell.exited", json!({ "id": "sh_1", "exit": 0, "status": "completed" }))]);
    h.app.advance(Duration::from_millis(10));
    h.wait("the last read", || reads() > running);
    let stopped = reads();
    h.app.advance(Duration::from_secs(3));
    h.app.wait_until(Duration::from_millis(300), || false);
    assert_eq!(reads(), stopped);
    assert!(h.app.text().contains("hi from the shell"));
}

#[test]
fn todo_count_and_failure_use_their_own_rows() {
    let messages = turn(vec![
        timed("c1", "question", running(json!({ "questions": [{"question":"A?"},{"question":"B?"}] }), json!({}))),
        timed("c2", "todowrite", failed(json!({}), "bad todos")),
    ]);
    let h = open(100, 40, messages, Vec::new());
    h.wait_for_all(&["Asked 2 questions", "Todo update failed"]);
    assert_eq!(h.fg("Todo update failed"), h.tui.page().text.feedback.error.base);
}

/// A theme switch restyles these rows in place too: an open nested call stays open, the patch keeps its diff, and
/// each cell equals the rows mounted in the new theme.
#[test]
fn a_theme_switch_restyles_these_rows_in_place() {
    let patch = "Index: a.rs\n===\n--- a.rs\n+++ a.rs\n@@ -1 +1 @@\n-old\n+new\n";
    let calls = json!([
        { "tool": "read", "status": "completed", "input": { "path": "src/a.rs" } },
        { "tool": "grep", "status": "error", "input": { "pattern": "TODO" } },
    ]);
    let messages = turn(vec![
        timed("c1", "webfetch", completed(json!({ "url": "https://opencode.ai/docs" }), "# Docs", json!({}))),
        timed("c2", "websearch", completed(json!({ "query": "rust tui" }), "results", json!({ "provider": "exa" }))),
        timed("c3", "skill", completed(json!({ "id": "x" }), "loaded", json!({ "name": "writing-doc" }))),
        timed(
            "c4",
            "todowrite",
            completed(
                json!({ "todos": [
                    { "content": "Prove them", "status": "in_progress" },
                    { "content": "Drop legacy", "status": "cancelled" },
                ] }),
                "",
                json!({}),
            ),
        ),
        timed(
            "c5",
            "question",
            completed(json!({ "questions": [{ "question": "Ship it?" }] }), "", json!({ "answers": [["Yes"]] })),
        ),
        timed(
            "c6",
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
        timed("c7", "apply_patch", failed(json!({ "patchText": "*** Update File: a.rs" }), "context mismatch")),
        timed(
            "c8",
            "execute",
            completed(
                json!({ "code": "throw 1" }),
                "Error: boom",
                json!({ "toolCalls": calls, "files": [
                    { "file": "b.rs", "status": "modified", "patch": patch, "additions": 1, "deletions": 1 },
                    { "file": "c.rs", "status": "modified", "additions": 4, "deletions": 2 },
                ] }),
            ),
        ),
        timed(
            "c9",
            "task",
            completed(json!({ "description": "Check the docs", "agent": "general" }), "done", json!({})),
        ),
    ]);
    support::assert_restyles_in_place(
        || open(100, 80, messages.clone(), Vec::new()),
        |h| {
            h.wait_for_all(&["read [path=src/a.rs]", "-3 lines", "# Patch failed", "Check the docs"]);
            h.click("read [path=src/a.rs]");
        },
        |screen| screen.contains("path: src/a.rs") && screen.contains("Skill \"writing-doc\""),
    );
}

#[test]
fn a_subagent_row_opens_its_child_session() {
    let messages = turn(vec![
        timed(
            "c1",
            "task",
            running(
                json!({ "description": "Survey the views", "subagent_type": "explore", "model": "provider/model#high" }),
                json!({ "sessionID": "ses_child" }),
            ),
        ),
        timed(
            "c2",
            "task",
            completed(
                json!({ "description": "Check the docs", "agent": "general" }),
                "done",
                json!({ "sessionID": "ses_child", "status": "running" }),
            ),
        ),
        timed("c3", "task", completed(json!({ "description": "Resume", "sessionID": "ses_child" }), "done", json!({}))),
    ]);
    let h = open(100, 30, messages, Vec::new());
    let screen = h.wait_for_all(&[
        "   ⋯ Explore Subagent — Survey the views · provider/model (high)\n",
        "   ✓ General Subagent — Check the docs\n",
        "   ↳ Continue subagent — Resume\n",
    ]);
    assert!(!screen.contains("Background"), "{screen}");

    h.click("Check the docs");
    let found = h.app.wait_until(WAIT, || h.tui.route() == Route::Session { id: SessionID("ses_child".into()) });
    assert!(found, "still on {:?}", h.tui.route());
    h.wait_for("Child work");
    let read = h
        .app
        .wait_until(WAIT, || support::lines(&h.seen).iter().any(|line| line == "GET /api/session/ses_child/message"));
    assert!(read, "{:?}", support::lines(&h.seen));
}

#[test]
fn a_subagent_row_follows_its_child_status() {
    let messages = turn(vec![timed(
        "c1",
        "task",
        completed(
            json!({ "description": "Check the docs", "agent": "general" }),
            "done",
            json!({ "sessionID": "ses_child", "status": "running" }),
        ),
    )]);
    let h = open(100, 30, messages, Vec::new());
    h.wait_for("   ✓ General Subagent — Check the docs\n");
    let child = support::merge(session("ses_child", "Child work"), json!({ "parentID": "ses_t" }));
    h.tui.data.remember(serde_json::from_value(child).unwrap());
    let child = SessionID("ses_child".into());
    h.tui.data.set_status(&child, opencode_store::SessionStatus::Running);
    h.wait_for("   ⋯ General Subagent — Check the docs\n");
    h.tui.data.set_status(&child, opencode_store::SessionStatus::Idle);
    h.wait_for("   ✓ General Subagent — Check the docs\n");
}

#[test]
fn execute_lists_its_calls_and_opens_the_dialog() {
    let calls = json!([
        { "tool": "read", "status": "completed", "input": { "path": "src/a.rs" } },
        { "tool": "grep", "status": "error", "input": { "pattern": "TODO" } },
        { "tool": "glob", "status": "running" },
    ]);
    let messages = turn(vec![
        timed("c1", "execute", running(json!({ "code": "await read()" }), json!({ "toolCalls": calls }))),
        timed(
            "c2",
            "execute",
            completed(
                json!({ "code": "const a = 1\nreturn a" }),
                "{\"a\":1}\n\nLogs:\nhello",
                json!({ "toolCalls": [] }),
            ),
        ),
        timed(
            "c3",
            "execute",
            completed(json!({ "code": "throw 1" }), "Error: boom\n  at main", json!({ "error": true })),
        ),
    ]);
    let h = open(120, 40, messages, Vec::new());
    h.wait_for_all(&[
        "   ⋯ execute\n",
        "   › read [path=src/a.rs]\n",
        "   ✗ grep [pattern=TODO]\n",
        "   › glob\n",
        "   ✓ execute\n",
        "   ✗ execute\n",
        "\n     ↳ Error: boom\n",
        "\n         at main\n",
    ]);
    let theme = h.tui.page();
    assert_eq!(h.fg("✗ execute"), theme.text.feedback.error.base);

    h.click("read [path=src/a.rs]");
    h.wait_for("path: src/a.rs");

    let (x, y) = h.find("✓ execute");
    h.app.click(x + 2, y);
    h.app.advance(Duration::from_millis(1));
    let screen = h.wait_for("Completed · 1.3s");
    for text in [
        "Code",
        "1 const a = 1",
        "2 return a",
        "Output",
        "1 {",
        "2   \"a\": 1",
        "3 }",
        "Logs:",
        "copy code",
        "copy output",
    ] {
        assert!(screen.contains(text), "{text:?} missing:\n{screen}");
    }
}

/// A script's changes show below its execute block, one block per change in order, while it runs too; a change without
/// its diff shows its counts, or only its path (`PatchedFiles`, script-changes.test.ts).
#[test]
fn execute_shows_the_files_its_script_changed_below_it() {
    let patch = "--- src/a.rs\n+++ src/a.rs\n@@ -1 +1 @@\n-old();\n+new();\n";
    let first = json!({ "file": "src/a.rs", "status": "modified", "additions": 1, "deletions": 1, "patch": patch });
    let calls = json!([{ "tool": "edit", "status": "completed", "input": { "path": "src/a.rs" } }]);
    let messages = turn(vec![timed(
        "c1",
        "execute",
        running(json!({ "code": "await edit()" }), json!({ "toolCalls": calls, "files": [first] })),
    )]);
    let h = open(100, 60, messages, Vec::new());
    h.wait_for_all(&[
        "   ⋯ execute\n     › edit [path=src/a.rs]\n\n  ┃\n  ┃  ← Patched src/a.rs\n",
        "1 - old();",
        "1 + new();",
    ]);

    let files = json!([
        first,
        { "file": "src/a.rs", "status": "modified", "additions": 2, "deletions": 0 },
        { "file": "copy.txt", "status": "added" },
        { "file": "gone.bin", "status": "deleted", "deletions": 40 },
        { "file": "big.txt", "status": "modified", "additions": 5, "deletions": 1 },
        { "file": "", "status": "added" },
        { "file": "moved.ts", "status": "renamed" },
        "junk",
    ]);
    let ids = json!({ "sessionID": "ses_t", "assistantMessageID": "msg_2", "id": "c1" });
    let progress = support::merge(ids, json!({ "metadata": { "toolCalls": calls, "files": files } }));
    h.tui.data.apply(&[support::event("ses_t", "session.tool.progress", 1, progress)]);
    let screen = h.wait_for_all(&["+2 lines", "# Created copy.txt", "# Deleted gone.bin", "-40 lines", "+5 -1 lines"]);
    let lines: Vec<&str> = screen.lines().collect();
    let row = |text: &str| lines.iter().position(|line| line.contains(text)).unwrap();
    assert!(row("+2 lines") < row("copy.txt") && row("copy.txt") < row("gone.bin") && row("gone.bin") < row("big.txt"));
    // A change without counts shows only its path, so the next block's top padding follows.
    assert!(lines[row("copy.txt") + 1].trim_start_matches(['┃', ' ']).is_empty(), "{screen}");
    assert!(lines[row("copy.txt") + 2].trim().is_empty(), "{screen}");
    // A change without a file or with another status is no change.
    assert!(!screen.contains("moved.ts") && lines.iter().filter(|line| line.contains("# Created")).count() == 1);
    let theme = h.tui.page();
    assert_eq!(h.fg("+2 lines"), theme.diff.text.added);
    assert_eq!(h.fg("-40 lines"), theme.diff.text.removed);
    // The space between the counts and the unit have no color of their own: OpenTUI's default, white.
    let (x, y) = h.find("+5 -1 lines");
    assert_eq!(h.app.render().cell(u32::from(x) + 2, u32::from(y)).unwrap().fg, Color::rgb(255, 255, 255));
}

/// A patch's deleted file shows its counts, nothing for none; an update without hunks shows its counts.
#[test]
fn a_patch_without_a_diff_shows_its_counts_like_a_script() {
    let messages = turn(vec![timed(
        "c1",
        "apply_patch",
        completed(
            json!({ "patchText": "*** Begin Patch" }),
            "",
            json!({ "files": [
                { "file": "gone.rs", "type": "delete", "patch": "", "additions": 0, "deletions": 1 },
                { "file": "empty.rs", "type": "delete", "patch": "", "additions": 0, "deletions": 0 },
                { "file": "mode.sh", "type": "update", "patch": "", "additions": 0, "deletions": 0 },
                { "file": "bin.dat", "type": "update", "patch": "Binary files differ", "additions": 3, "deletions": 0 },
            ] }),
        ),
    )]);
    let h = open(100, 60, messages, Vec::new());
    let screen =
        h.wait_for_all(&["# Deleted gone.rs", "-1 line\n", "# Deleted empty.rs", "← Patched mode.sh", "+3 lines"]);
    assert!(!screen.contains("-0 lines"), "{screen}");
}

/// The dialog's scroll box is as tall as the code and output wrapped by character: the last row shows unscrolled.
#[test]
fn the_execute_dialog_fits_wrapped_code() {
    let code = format!("const long = \"{}\"", "x".repeat(300));
    let output = "{\"a\":1}\n\nLogs:\nthe last log line";
    let messages =
        turn(vec![timed("c1", "execute", completed(json!({ "code": code }), output, json!({ "toolCalls": [] })))]);
    let h = open(120, 40, messages, Vec::new());
    // The transcript reads its messages on the app's runtime: the first frame can show the header alone.
    h.wait_for("✓ execute");
    let (x, y) = h.find("✓ execute");
    h.app.click(x + 2, y);
    h.app.advance(Duration::from_millis(1));
    h.wait_for_all(&["Completed", "the last log line"]);
}
