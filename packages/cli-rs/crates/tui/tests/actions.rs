//! The session actions (E.10a) over a fixture server that logs every request: rename, timeline, fork, compact,
//! undo, redo, the copies, export, the parent session, and the revert commit before a prompt. Writes answer 204
//! where the server does. The dialogs' cells are compared with the TypeScript ones in
//! `parity/component/E.10a-actions.tsx` (`dialogs_match_typescript`).

use std::rc::Rc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use bytes::Bytes;
use opencode_api::client::Client;
use opencode_api::generated::{SessionID, SessionMessageInfo};
use opencode_api::transport::{BoxFuture, Request, Response, Transport};
use opencode_local::cli_config::{Info, Resolved};
use opencode_parity::assert_fixture;
use opencode_tui::{Deps, Route, Tui};
use opentui::prelude::*;
use opentui::testing::TestApp;
use serde_json::{Value, json};

/// A request the fixture saw: method, path with query, and JSON body.
type Seen = Arc<Mutex<Vec<(String, String, Value)>>>;

const LOCATION: &str = "/project";

/// One session `ses_a` with its messages and inbox, the location catalog, and every write the actions send.
struct Fixture {
    session: Value,
    messages: Vec<Value>,
    inbox: Vec<Value>,
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
        let full = match request.url.query() {
            Some(query) => format!("{path}?{query}"),
            None => path.clone(),
        };
        self.seen
            .lock()
            .unwrap()
            .push((request.method.to_owned(), full, body.clone()));
        let location = json!({ "directory": LOCATION });
        let id = self.session["id"].as_str().unwrap().to_owned();
        let base = format!("/api/session/{id}");
        let (status, body) = match (request.method, path.as_str()) {
            ("GET", "/api/session") => (200, json!({ "data": [], "cursor": {} })),
            ("GET", p) if p == base => (200, json!({ "data": self.session })),
            ("GET", p) if p == format!("{base}/message") => {
                let page: Vec<_> = self.messages.iter().rev().cloned().collect();
                (200, json!({ "data": page, "cursor": {} }))
            }
            ("GET", p) if p == format!("{base}/inbox") => (200, json!({ "data": self.inbox })),
            ("GET", p) if p.ends_with("/permission") => (200, json!({ "data": [] })),
            ("GET", p) if p.starts_with("/api/session/ses_") => {
                let other = p.trim_start_matches("/api/session/");
                match other.split_once('/') {
                    Some((_, "message")) => (200, json!({ "data": [], "cursor": {} })),
                    Some(_) => (200, json!({ "data": [] })),
                    None => (200, json!({ "data": session(other, json!({})) })),
                }
            }
            ("GET", p) if p == format!("/api/experimental/session/{id}/export") => (
                200,
                json!({ "data": { "info": self.session, "messages": self.messages } }),
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
            ("GET", "/api/provider" | "/api/command") => {
                (200, json!({ "location": location, "data": [] }))
            }
            ("PATCH", p) if p == base => (204, Value::Null),
            ("POST", p) if p == format!("{base}/fork") => (
                200,
                json!({ "data": session("ses_fork", json!({ "title": "Forked" })) }),
            ),
            ("POST", p) if p == format!("{base}/compact") => (
                200,
                json!({ "data": {
                    "id": body["id"], "sessionID": id, "time": { "created": 1 }, "type": "compaction",
                    "delivery": "steer", "payload": {},
                } }),
            ),
            ("POST", p) if p == format!("{base}/interrupt") => {
                (200, json!({ "interrupted": true }))
            }
            ("POST", p) if p == format!("/api/experimental/session/{id}/wait") => {
                (204, Value::Null)
            }
            ("POST", p) if p == format!("{base}/revert/stage") => {
                (200, json!({ "data": { "messageID": body["messageID"] } }))
            }
            ("DELETE", p) if p == format!("{base}/revert") => (204, Value::Null),
            ("POST", p) if p == format!("{base}/revert/commit") => (204, Value::Null),
            ("DELETE", p) if p.starts_with(&format!("{base}/inbox/")) => (204, Value::Null),
            ("POST", p) if p == format!("{base}/prompt") => (
                200,
                json!({ "data": {
                    "id": body["id"], "sessionID": id, "time": { "created": 1 }, "type": "user",
                    "payload": { "text": body["text"] }, "delivery": "steer",
                } }),
            ),
            ("POST", p) if p.ends_with("/model") || p.ends_with("/agent") => (204, Value::Null),
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

fn session(id: &str, extra: Value) -> Value {
    let mut session = json!({
        "id": id, "title": "Fix the parser", "projectID": "project", "cost": 0, "agent": "build",
        "model": { "providerID": "p", "id": "m" },
        "tokens": { "input": 0, "output": 0, "reasoning": 0, "cache": { "read": 0, "write": 0 } },
        "time": { "created": 1_772_539_200_000_u64, "updated": 1_772_542_800_000_u64 },
        "location": { "directory": LOCATION },
    });
    for (key, value) in extra.as_object().unwrap() {
        session[key] = value.clone();
    }
    session
}

fn user(id: &str, created: u64, text: &str) -> Value {
    json!({ "id": id, "type": "user", "text": text, "time": { "created": created } })
}

fn assistant(id: &str, created: u64, content: Value) -> Value {
    json!({
        "id": id, "type": "assistant", "agent": "build",
        "model": { "providerID": "p", "id": "m" },
        "time": { "created": created, "completed": created + 1000 }, "finish": "stop",
        "content": content,
    })
}

/// Two turns: a question with a reply (reasoning, text, and a tool call), then a question with a text reply.
fn turns() -> Vec<Value> {
    vec![
        user("msg_01", 1_772_539_200_000, "Read the parser"),
        assistant(
            "msg_02",
            1_772_539_201_000,
            json!([
                { "type": "reasoning", "id": "r1", "text": "Look at the file first." },
                { "type": "text", "id": "t1", "text": "I read it." },
                {
                    "type": "tool", "id": "call_1", "name": "read",
                    "time": { "created": 1_772_539_201_500_u64, "completed": 1_772_539_201_600_u64 },
                    "state": {
                        "status": "completed", "input": { "filePath": "src/parser.rs" },
                        "content": [{ "type": "text", "text": "fn parse() {}" }],
                    },
                },
            ]),
        ),
        user("msg_03", 1_772_539_260_000, "Fix the bug\nin parse"),
        assistant(
            "msg_04",
            1_772_539_261_000,
            json!([{ "type": "text", "id": "t2", "text": "Fixed it." }]),
        ),
    ]
}

struct Kit {
    app: TestApp,
    tui: Rc<Tui>,
    seen: Seen,
}

impl Kit {
    fn new(session: Value, messages: Vec<Value>, inbox: Vec<Value>) -> Self {
        Self::sized(100, 30, session, messages, inbox)
    }

    fn sized(
        width: u16,
        height: u16,
        session: Value,
        messages: Vec<Value>,
        inbox: Vec<Value>,
    ) -> Self {
        for message in &messages {
            if let Err(error) = serde_json::from_value::<SessionMessageInfo>(message.clone()) {
                panic!("{message} does not decode: {error}");
            }
        }
        let seen = Seen::default();
        let id = SessionID(session["id"].as_str().unwrap().to_owned());
        let fixture = Fixture {
            session,
            messages,
            inbox,
            seen: seen.clone(),
        };
        let client = Client::with_transport("http://opencode.local", Arc::new(fixture)).unwrap();
        let app = TestApp::new(width, height);
        let tui = opencode_tui::mount(
            &app,
            Deps {
                client,
                directory: LOCATION.into(),
                config: Resolved::new(
                    Info {
                        animations: Some(false),
                        ..Info::default()
                    },
                    |_| None,
                ),
                roots: None,
                route: Route::Session { id },
                continue_: false,
                events: false,
            },
        );
        Self { app, tui, seen }
    }

    fn wait_for(&self, text: &str) -> String {
        let found = self
            .app
            .wait_until(Duration::from_secs(5), || self.app.text().contains(text));
        let screen = self.app.text();
        assert!(
            found,
            "{text:?} never showed:\n{screen}\nrequests: {:?}",
            self.seen.lock().unwrap()
        );
        screen
    }

    /// The transcript and the prompt's catalog are in.
    fn ready(&self) {
        self.wait_for("Fixed it.");
        self.wait_for("Model M");
    }

    fn leader(&self, key: &str) {
        self.app.press("ctrl+x");
        self.app.press(key);
    }

    /// Mutating requests, in order, as `METHOD path body`.
    fn writes(&self) -> Vec<String> {
        self.seen
            .lock()
            .unwrap()
            .iter()
            .filter(|(method, _, _)| method != "GET")
            .map(|(method, path, body)| format!("{method} {path} {body}"))
            .collect()
    }

    fn wait_writes(&self, count: usize) -> Vec<String> {
        let found = self
            .app
            .wait_until(Duration::from_secs(5), || self.writes().len() >= count);
        assert!(
            found,
            "expected {count} writes: {:?}\n{}",
            self.writes(),
            self.app.text()
        );
        self.writes()
    }

    fn reads(&self, path: &str) -> usize {
        self.seen
            .lock()
            .unwrap()
            .iter()
            .filter(|(method, seen, _)| method == "GET" && seen == path)
            .count()
    }

    fn clear(&self) {
        self.seen.lock().unwrap().clear();
    }

    fn prompt_text(&self) -> String {
        self.tui
            .textarea
            .borrow()
            .as_ref()
            .map(|textarea| textarea.text())
            .unwrap_or_default()
    }

    fn only_dialog(&self) {
        let host = self.tui.dialogs.host().id();
        for child in self.app.root().children() {
            if child.id() != host {
                child.visible(false);
            }
        }
    }
}

#[test]
fn rename_opens_the_dialog_by_key_and_renames_or_generates_by_slash() {
    let kit = Kit::new(session("ses_a", json!({})), turns(), vec![]);
    kit.ready();
    kit.app.press("ctrl+r");
    kit.wait_for("Rename session");
    assert!(
        kit.app.text().contains("Fix the parser"),
        "{}",
        kit.app.text()
    );
    kit.app.press("escape");
    assert!(!kit.tui.dialogs.is_open());

    kit.app.type_text("/rename Ship docs");
    kit.app.press("return");
    assert_eq!(
        kit.wait_writes(1),
        [r#"PATCH /api/session/ses_a {"title":"Ship docs"}"#]
    );

    // A bare `/rename` asks for a generated title, then reads the session back.
    kit.clear();
    kit.app.type_text("/rename");
    kit.app.press("return");
    assert_eq!(
        kit.wait_writes(1),
        [r#"PATCH /api/session/ses_a {"title":""}"#]
    );
    assert!(
        kit.app
            .wait_until(Duration::from_secs(5), || kit.reads("/api/session/ses_a")
                == 1),
        "{:?}",
        kit.seen.lock().unwrap()
    );
}

#[test]
fn timeline_lists_prompts_newest_first_and_moving_jumps_the_transcript() {
    // Long replies, so a jump scrolls.
    let long = |id: &str, created: u64| {
        let text: Vec<String> = (1..=30)
            .map(|line| format!("Line {line} of {id}."))
            .collect();
        assistant(
            id,
            created,
            json!([{ "type": "text", "id": id, "text": text.join("\n\n") }]),
        )
    };
    let messages = vec![
        user("msg_01", 1_772_539_200_000, "First question"),
        long("msg_02", 1_772_539_201_000),
        user("msg_03", 1_772_539_260_000, "Second question"),
        long("msg_04", 1_772_539_261_000),
    ];
    let kit = Kit::new(session("ses_a", json!({})), messages, vec![]);
    kit.wait_for("Line 30 of msg_04.");
    kit.leader("g");
    let screen = kit.wait_for("Timeline");
    let (second, first) = (
        screen.find("Second question").unwrap(),
        screen.find("First question").unwrap(),
    );
    assert!(second < first, "{screen}");

    kit.app.press("down");
    kit.app.press("escape");
    let found = kit.app.wait_until(Duration::from_secs(5), || {
        // Below the header: the bar row above the prompt, then the prompt.
        kit.app
            .text()
            .lines()
            .nth(4)
            .is_some_and(|line| line.contains("First question"))
    });
    assert!(found, "{}", kit.app.text());
    assert!(kit.writes().is_empty(), "{:?}", kit.writes());
}

#[test]
fn fork_forks_the_whole_session_or_before_a_prompt_and_opens_it() {
    let kit = Kit::new(session("ses_a", json!({})), turns(), vec![]);
    kit.ready();
    kit.tui.keymap.dispatch("session.fork", None);
    let screen = kit.wait_for("Fork session");
    let order = ["Full session", "Fix the bug in parse", "Read the parser"];
    let positions: Vec<_> = order
        .iter()
        .map(|text| screen.find(text).unwrap())
        .collect();
    assert!(positions.is_sorted(), "{screen}");
    kit.app.press("return");
    assert_eq!(kit.wait_writes(1), ["POST /api/session/ses_a/fork {}"]);
    kit.wait_for("Forked session");
    assert_eq!(
        kit.tui.route(),
        Route::Session {
            id: SessionID("ses_fork".into())
        }
    );

    let kit = Kit::new(session("ses_a", json!({})), turns(), vec![]);
    kit.ready();
    kit.tui.keymap.dispatch("session.fork", None);
    kit.wait_for("Full session");
    kit.app.press("down");
    kit.app.press("return");
    assert_eq!(
        kit.wait_writes(1),
        [r#"POST /api/session/ses_a/fork {"before":"msg_03"}"#]
    );
    kit.wait_for("Forked session");
    // The fork's composer holds the prompt it was forked before.
    let found = kit.app.wait_until(Duration::from_secs(5), || {
        kit.prompt_text() == "Fix the bug\nin parse"
    });
    assert!(found, "{:?}\n{}", kit.prompt_text(), kit.app.text());
}

#[test]
fn compact_commits_the_model_then_admits_one_compaction() {
    let kit = Kit::new(session("ses_a", json!({})), turns(), vec![]);
    kit.ready();
    kit.leader("c");
    let found = kit.app.wait_until(Duration::from_secs(5), || {
        kit.writes().iter().any(|write| write.contains("/compact"))
    });
    let writes = kit.writes();
    assert!(found, "{writes:?}");
    let compact = writes
        .iter()
        .position(|write| write.contains("/compact"))
        .unwrap();
    assert!(
        writes[compact].starts_with("POST /api/session/ses_a/compact {\"id\":\"msg_"),
        "{writes:?}"
    );
    // The only other write is the model the prompt shows, committed first.
    assert!(
        writes[..compact].iter().all(|write| write
            == r#"POST /api/session/ses_a/model {"model":{"id":"m","providerID":"p"}}"#),
        "{writes:?}"
    );
    assert_eq!(writes.len(), compact + 1, "{writes:?}");
}

#[test]
fn undo_reverts_to_the_last_prompt_and_puts_it_back_in_the_prompt() {
    let kit = Kit::new(session("ses_a", json!({})), turns(), vec![]);
    kit.ready();
    kit.leader("u");
    assert_eq!(
        kit.wait_writes(3),
        [
            "POST /api/session/ses_a/interrupt null",
            "POST /api/experimental/session/ses_a/wait null",
            r#"POST /api/session/ses_a/revert/stage {"messageID":"msg_03"}"#,
        ]
    );
    let found = kit.app.wait_until(Duration::from_secs(5), || {
        kit.prompt_text() == "Fix the bug\nin parse"
    });
    assert!(found, "{:?}", kit.prompt_text());

    // Nothing before the staged revert: nothing to undo, and no request.
    let kit = Kit::new(
        session("ses_a", json!({ "revert": { "messageID": "msg_01" } })),
        turns(),
        vec![],
    );
    kit.wait_for("Model M");
    kit.clear();
    kit.leader("u");
    kit.wait_for("Nothing to undo");
    assert!(kit.writes().is_empty(), "{:?}", kit.writes());
}

#[test]
fn undo_cancels_a_prompt_still_in_the_inbox() {
    let inbox = vec![json!({
        "id": "msg_05", "sessionID": "ses_a", "time": { "created": 1_772_539_300_000_u64 }, "type": "user",
        "payload": { "text": "Queued question" }, "delivery": "queue",
    })];
    let kit = Kit::new(session("ses_a", json!({})), turns(), inbox);
    kit.ready();
    kit.wait_for("Queued question");
    kit.app.type_text("draft");
    kit.leader("u");
    assert_eq!(
        kit.wait_writes(1),
        ["DELETE /api/session/ses_a/inbox/msg_05 null"]
    );
    let found = kit.app.wait_until(Duration::from_secs(5), || {
        kit.prompt_text() == "draft\n\nQueued question"
    });
    assert!(found, "{:?}", kit.prompt_text());
}

#[test]
fn redo_clears_a_staged_revert_and_is_off_without_one() {
    let kit = Kit::new(session("ses_a", json!({})), turns(), vec![]);
    kit.ready();
    kit.leader("r");
    kit.app.advance(Duration::from_millis(50));
    assert!(kit.writes().is_empty(), "{:?}", kit.writes());

    let kit = Kit::new(
        session("ses_a", json!({ "revert": { "messageID": "msg_03" } })),
        turns(),
        vec![],
    );
    kit.wait_for("1 message reverted");
    kit.wait_for("ctrl+x r or /redo to restore");
    kit.leader("r");
    assert_eq!(
        kit.wait_writes(1),
        ["DELETE /api/session/ses_a/revert null"]
    );
}

#[test]
fn a_prompt_commits_a_staged_revert_before_it_is_sent() {
    let kit = Kit::new(
        session("ses_a", json!({ "revert": { "messageID": "msg_03" } })),
        turns(),
        vec![],
    );
    kit.wait_for("1 message reverted");
    kit.wait_for("Model M");
    kit.app.type_text("Try again");
    kit.app.press("return");
    let found = kit.app.wait_until(Duration::from_secs(5), || {
        kit.writes().iter().any(|write| write.contains("/prompt"))
    });
    let writes = kit.writes();
    assert!(found, "{writes:?}");
    let commit = writes
        .iter()
        .position(|write| write == "POST /api/session/ses_a/revert/commit null")
        .unwrap_or_else(|| panic!("no commit: {writes:?}"));
    let prompt = writes
        .iter()
        .position(|write| write.contains("/prompt"))
        .unwrap();
    assert!(commit < prompt, "{writes:?}");
}

#[test]
fn copies_and_the_parent_report_their_outcome() {
    // Without a terminal, every copy fails, as TS reports a rejected clipboard write.
    let kit = Kit::new(
        session("ses_a", json!({ "parentID": "ses_p" })),
        turns(),
        vec![],
    );
    kit.ready();
    kit.leader("y");
    kit.wait_for("Failed to copy to clipboard");
    kit.tui.keymap.dispatch("session.copy.id", None);
    kit.wait_for("Failed to copy session ID");
    kit.tui.keymap.dispatch("session.copy", None);
    kit.wait_for("Failed to copy session transcript");
    assert_eq!(kit.reads("/api/experimental/session/ses_a/export"), 1);
    assert!(kit.writes().is_empty(), "{:?}", kit.writes());
    kit.tui.keymap.dispatch("session.parent", None);
    assert_eq!(
        kit.tui.route(),
        Route::Session {
            id: SessionID("ses_p".into())
        }
    );

    let kit = Kit::new(
        session("ses_a", json!({})),
        vec![user("msg_01", 1_772_539_200_000, "Hello")],
        vec![],
    );
    kit.wait_for("Hello");
    kit.leader("y");
    kit.wait_for("No assistant messages found");
}

/// The export written to the temporary directory for `session`, removed once read.
fn take_export(extension: &str, session: &str) -> Option<String> {
    let entries = std::fs::read_dir(std::env::temp_dir()).ok()?;
    entries.flatten().find_map(|entry| {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !(name.starts_with("session-") && name.ends_with(extension)) {
            return None;
        }
        let content = std::fs::read_to_string(entry.path()).ok()?;
        content.contains(session).then(|| {
            std::fs::remove_file(entry.path()).ok();
            content
        })
    })
}

#[test]
fn export_saves_markdown_or_sanitized_json_and_shows_the_path() {
    let kit = Kit::new(session("ses_export_md", json!({})), turns(), vec![]);
    kit.wait_for("Fixed it.");
    kit.leader("x");
    kit.wait_for("Export session");
    // Markdown, JSON, thinking, tools, Copy, Export.
    for _ in 0..5 {
        kit.app.press("tab");
    }
    kit.app.press("return");
    kit.wait_for("Session exported");
    assert_eq!(
        kit.reads("/api/experimental/session/ses_export_md/export"),
        1
    );
    let markdown = take_export(".md", "ses_export_md").expect("the Markdown export");
    let created = markdown.lines().nth(3).unwrap().to_owned();
    assert!(created.starts_with("**Created:** 3/3/2026, "), "{markdown}");
    let expected = [
        "# Fix the parser",
        "",
        "**Session ID:** ses_export_md",
        &created,
        &markdown.lines().nth(4).unwrap().to_owned(),
        "",
        "---",
        "",
        "## User",
        "",
        "Read the parser",
        "",
        "---",
        "",
        "## Assistant",
        "",
        "_Thinking:_",
        "",
        "Look at the file first.",
        "",
        "I read it.",
        "",
        "**Tool: read**",
        "",
        "**Input:**",
        "```json",
        "{",
        "  \"filePath\": \"src/parser.rs\"",
        "}",
        "```",
        "",
        "fn parse() {}",
        "",
        "---",
        "",
        "## User",
        "",
        "Fix the bug",
        "in parse",
        "",
        "---",
        "",
        "## Assistant",
        "",
        "Fixed it.",
        "",
    ]
    .join("\n");
    assert_eq!(markdown, expected);
    kit.app.press("return");
    assert!(!kit.tui.dialogs.is_open());

    let kit = Kit::new(session("ses_export_js", json!({})), turns(), vec![]);
    kit.wait_for("Fixed it.");
    kit.leader("x");
    kit.wait_for("Export session");
    // JSON, then Sanitize, then Export.
    kit.app.press("tab");
    kit.app.press("return");
    kit.wait_for("Sanitize sensitive data");
    kit.app.press("tab");
    kit.app.press("return");
    kit.wait_for("[x] Sanitize");
    kit.app.press("tab");
    kit.app.press("tab");
    kit.app.press("return");
    kit.wait_for("Session exported");
    assert_eq!(
        kit.reads("/api/experimental/session/ses_export_js/export?sanitize=true"),
        1
    );
    let text = take_export(".json", "ses_export_js").expect("the JSON export");
    assert!(text.ends_with("}\n"), "{text}");
    let value: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(value["info"]["id"], "ses_export_js");
    assert_eq!(value["messages"].as_array().unwrap().len(), 4);
    // Pretty-printed with two spaces and the server's key order.
    assert!(
        text.starts_with("{\n  \"info\": {\n    \"id\": \"ses_export_js\",\n"),
        "{text}"
    );
}

#[test]
fn dialogs_match_typescript() {
    // The TS fixtures render in UTC; the Rust footers use local time, so shift the prompts by the local offset.
    let offset = {
        use chrono::{Local, Offset, TimeZone};
        Local
            .timestamp_millis_opt(1_772_539_200_000)
            .unwrap()
            .offset()
            .fix()
            .local_minus_utc() as i64
            * 1000
    };
    let shifted: Vec<Value> = turns()
        .into_iter()
        .map(|mut message| {
            let created = message["time"]["created"].as_i64().unwrap();
            message["time"]["created"] = json!(created - offset);
            message
        })
        .collect();
    let open = |route: &str| {
        let kit = Kit::sized(
            100,
            30,
            session("ses_a", json!({})),
            shifted.clone(),
            vec![],
        );
        kit.ready();
        kit.tui.keymap.dispatch(route, None);
        kit
    };

    let kit = open("session.timeline");
    kit.wait_for("Timeline");
    kit.only_dialog();
    assert_fixture(&kit.app.render(), "E.10a/timeline");

    let kit = open("session.fork");
    kit.wait_for("Full session");
    kit.only_dialog();
    assert_fixture(&kit.app.render(), "E.10a/fork");

    let kit = open("session.rename");
    kit.wait_for("Rename session");
    kit.only_dialog();
    assert_fixture(&kit.app.render(), "E.10a/rename");

    let kit = open("session.export");
    kit.wait_for("Export session");
    kit.only_dialog();
    assert_fixture(&kit.app.render(), "E.10a/export");
    kit.app.press("tab");
    kit.app.press("return");
    kit.wait_for("Sanitize");
    assert_fixture(&kit.app.render(), "E.10a/export-json");
}
