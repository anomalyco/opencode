//! The transcript's other rows (E.6b) over a fixture server: compactions (running, done, failed,
//! queued), shell, skill, notice and switch messages, errors and retries, the revert banner, the
//! background hint, images, and the free-limit stop that offers OpenCode Go.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use bytes::Bytes;
use opencode_api::client::Client;
use opencode_api::generated::{SessionID, SessionMessageInfo, V2Event};
use opencode_api::transport::{BoxFuture, Request, Response, Transport};
use opencode_local::cli_config::{Info, Resolved, Session};
use opencode_tui::{Deps, Route, Tui};
use opentui::testing::TestApp;
use serde_json::{Value, json};

const ID: &str = "ses_m";

/// Serves one session, its messages, its pending inbox items, and the revert clear.
struct Fixture {
    session: Value,
    messages: Vec<Value>,
    inbox: Vec<Value>,
    log: Arc<Mutex<Vec<String>>>,
}

impl Transport for Fixture {
    fn send(&self, request: Request) -> BoxFuture<'_, Result<Response, String>> {
        let path = request.url.path().to_owned();
        Box::pin(async move {
            self.log.lock().unwrap().push(format!("{} {path}", request.method));
            let session = format!("/api/session/{ID}");
            let (status, body) = match (request.method, path.as_str()) {
                ("GET", "/api/session") => (200, json!({ "data": [], "cursor": {} })),
                ("GET", p) if p == session => (200, json!({ "data": self.session })),
                ("GET", p) if p == format!("{session}/message") => {
                    let page: Vec<_> = self.messages.iter().rev().cloned().collect();
                    (200, json!({ "data": page, "cursor": {} }))
                }
                ("GET", p) if p == format!("{session}/inbox") => (200, json!({ "data": self.inbox })),
                ("GET", p) if p == format!("{session}/permission") => (200, json!({ "data": [] })),
                ("DELETE", p) if p == format!("{session}/revert") => (204, Value::Null),
                _ => (404, json!({})),
            };
            let body = if status == 204 { Vec::new() } else { serde_json::to_vec(&body).unwrap() };
            Ok(Response {
                status,
                headers: vec![("content-type".into(), "application/json".into())],
                body: Box::pin(futures_util::stream::iter([Ok(Bytes::from(body))])),
            })
        })
    }
}

fn session(extra: Value) -> Value {
    let mut session = json!({
        "id": ID, "title": "Messages", "projectID": "project", "cost": 0, "agent": "build",
        "tokens": { "input": 0, "output": 0, "reasoning": 0, "cache": { "read": 0, "write": 0 } },
        "time": { "created": 1, "updated": 1 },
        "location": { "directory": "/project" },
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
        "model": { "providerID": "provider", "id": "model" },
        "time": { "created": created }, "content": content,
    })
}

struct Harness {
    app: TestApp,
    tui: std::rc::Rc<Tui>,
    log: Arc<Mutex<Vec<String>>>,
}

fn open(height: u16, session: Value, messages: Vec<Value>, inbox: Vec<Value>, info: Info) -> Harness {
    // A message that does not decode would drop its whole page.
    for message in &messages {
        if let Err(error) = serde_json::from_value::<SessionMessageInfo>(message.clone()) {
            panic!("{message} does not decode: {error}");
        }
    }
    let log = Arc::new(Mutex::new(Vec::new()));
    let fixture = Fixture { session, messages, inbox, log: log.clone() };
    let client = Client::with_transport("http://opencode.local", Arc::new(fixture)).unwrap();
    let app = TestApp::new(80, height);
    let info = Info { animations: Some(false), ..info };
    let tui = opencode_tui::mount(
        &app,
        Deps {
            client,
            directory: "/project".into(),
            config: Resolved::new(info, |_| None),
            roots: None,
            route: Route::Session { id: SessionID(ID.into()) },
            continue_: false,
            events: false,
        },
    );
    Harness { app, tui, log }
}

impl Harness {
    fn wait_for(&self, text: &str) -> String {
        let found = self.app.wait_until(Duration::from_secs(5), || self.app.text().contains(text));
        let screen = self.app.text();
        assert!(found, "{text:?} never showed:\n{screen}\nrequests: {:?}", self.log.lock().unwrap());
        screen
    }

    fn apply(&self, kind: &str, seq: u64, data: Value) {
        let event: V2Event = serde_json::from_value(json!({
            "id": format!("evt_{seq}"), "created": 10_000 + seq, "type": kind,
            "durable": { "aggregateID": ID, "seq": seq, "version": 1 },
            "data": data,
        }))
        .unwrap();
        self.tui.data.apply(&[event]);
    }

    fn row(&self, text: &str) -> u16 {
        self.app
            .text()
            .lines()
            .position(|line| line.contains(text))
            .unwrap_or_else(|| panic!("{text:?} is not on screen")) as u16
    }
}

fn in_order(screen: &str, texts: &[&str]) {
    let positions: Vec<_> =
        texts.iter().map(|text| screen.find(text).unwrap_or_else(|| panic!("{text:?} missing:\n{screen}"))).collect();
    assert!(positions.is_sorted(), "{texts:?} out of order:\n{screen}");
}

#[test]
fn compactions_show_their_status_summary_and_queue() {
    let messages = vec![
        user("msg_1", 1000, "First question"),
        json!({
            "id": "msg_2", "type": "compaction", "status": "completed", "reason": "manual",
            "summary": "The user asked about **parsing**.", "time": { "created": 2000 },
            "tokens": { "input": 1200, "output": 300, "reasoning": 0, "cache": { "read": 50, "write": 0 } },
        }),
        json!({
            "id": "msg_3", "type": "compaction", "status": "running", "reason": "auto",
            "summary": "", "time": { "created": 2500 },
        }),
        user("msg_4", 3000, "Second question"),
        json!({
            "id": "msg_5", "type": "compaction", "status": "failed", "reason": "manual",
            "error": { "type": "provider", "message": "context too large" }, "time": { "created": 4000 },
        }),
        json!({
            "id": "msg_6", "type": "compaction", "status": "failed", "reason": "manual",
            "error": { "type": "aborted", "message": "aborted" }, "time": { "created": 5000 },
        }),
    ];
    let inbox = vec![json!({
        "id": "msg_9", "type": "compaction", "sessionID": ID, "time": { "created": 6000 },
        "payload": {}, "delivery": "queue",
    })];
    let h = open(40, session(json!({})), messages, inbox, Info::default());
    let screen = h.wait_for("Compaction queued");
    // A rule on each side of the status; the summary as Markdown under it.
    assert!(screen.contains("─ Compaction · 1.3K in · 300 out ─"), "{screen}");
    assert!(screen.contains("   The user asked about parsing."), "{screen}");
    assert!(screen.contains("─ ✗ Compaction ─"), "{screen}");
    assert!(screen.contains("   context too large"), "{screen}");
    assert!(screen.contains("─ Compaction · cancelled ─"), "{screen}");
    // With animations off a running compaction's spinner is `⋯`.
    assert!(screen.contains("─ ⋯ Compaction ─"), "{screen}");
    assert!(screen.contains("─ ◇ Compaction queued ─"), "{screen}");
    // The running compaction waits for the turn, after the rest; the queued one comes last.
    in_order(&screen, &["1.3K in", "Second question", "✗ Compaction", "cancelled", "⋯ Compaction", "◇"]);
    assert!(h.log.lock().unwrap().contains(&format!("GET /api/session/{ID}/inbox")));
}

#[test]
fn shell_skill_notice_and_switch_messages_render_as_one_line_each() {
    let output: Vec<String> = (1..=15).map(|line| format!("out {line}")).collect();
    let messages = vec![
        json!({
            "id": "msg_1", "type": "shell", "shellID": "shl_1", "command": "seq 15",
            "status": "exited", "exit": 0, "time": { "created": 1000, "completed": 1100 },
            "output": { "output": output.join("\n"), "cursor": 0, "size": 0, "truncated": false },
        }),
        json!({
            "id": "msg_2", "type": "shell", "shellID": "shl_2", "command": "false",
            "status": "exited", "exit": 1, "time": { "created": 1200, "completed": 1300 },
            "output": { "output": "", "cursor": 0, "size": 0, "truncated": false },
        }),
        json!({ "id": "msg_3", "type": "skill", "skill": "skl_1", "name": "rust", "text": "", "time": { "created": 1400 } }),
        json!({ "id": "msg_4", "type": "agent-switched", "agent": "plan", "previous": "build", "time": { "created": 1500 } }),
        json!({ "id": "msg_5", "type": "model-switched", "model": { "providerID": "openai", "id": "gpt-5" }, "time": { "created": 1600 } }),
        json!({ "id": "msg_6", "type": "location-switched", "location": { "directory": "/elsewhere" }, "time": { "created": 1700 } }),
        json!({ "id": "msg_7", "type": "system", "text": "", "time": { "created": 1800 } }),
        json!({
            "id": "msg_8", "type": "synthetic", "text": "", "time": { "created": 1900 },
            "description": "Review   the\ndiff",
            "metadata": { "source": "subagent", "state": "completed", "agent": "explore", "childID": "ses_child" },
        }),
    ];
    let h = open(50, session(json!({})), messages, Vec::new(), Info::default());
    let screen = h.wait_for("Explore finished");
    // The shell's output collapses to its tail; a nonzero exit is the block's error.
    assert!(screen.contains("┃  $ seq 15"), "{screen}");
    assert!(screen.contains("┃  (8 earlier lines)"), "{screen}");
    assert!(screen.contains("┃  out 15"), "{screen}");
    assert!(!screen.contains("out 8\n"), "{screen}");
    assert!(screen.contains("┃  Command exited with code 1"), "{screen}");
    assert!(screen.contains("   → Skill rust"), "{screen}");
    assert!(screen.contains("   Switched agent from Build to Plan"), "{screen}");
    assert!(screen.contains("   Switched model to openai/gpt-5"), "{screen}");
    assert!(screen.contains("   ↳ Moved to /elsewhere"), "{screen}");
    assert!(screen.contains("   ◈ Instructions updated"), "{screen}");
    assert!(screen.contains("   ↳ Explore finished · Review   the"), "{screen}");

    // A click opens the whole output.
    h.app.click(10, h.row("$ seq 15"));
    let open = h.wait_for("out 1\n");
    assert!(open.contains("out 6"), "{open}");
    assert!(!open.contains("earlier lines"), "{open}");

    // A click on a subagent's completion opens its session.
    h.app.click(8, h.row("Explore finished"));
    assert!(h.app.wait_until(Duration::from_secs(5), || matches!(
        h.tui.route(),
        Route::Session { id } if id.0 == "ses_child"
    )));
}

#[test]
fn errors_notices_and_retries_follow_the_footer_rules() {
    let failed = |id: &str, created: u64, error: Value| {
        let mut message = assistant(id, created, json!([]));
        message["error"] = error;
        message["time"]["completed"] = json!(created + 100);
        message
    };
    let mut retrying = assistant("msg_6", 6000, json!([]));
    retrying["retry"] = json!({
        "attempt": 2, "at": 1000,
        "error": { "type": "provider", "message": "overloaded" },
    });
    let messages = vec![
        user("msg_1", 1000, "Go"),
        failed("msg_2", 2000, json!({ "type": "provider", "message": "bad request" })),
        json!({
            "id": "msg_3", "type": "idle", "outcome": "failed", "time": { "created": 2500 },
            "error": { "type": "execution", "message": "the runner crashed" },
        }),
        failed("msg_4", 3000, json!({ "type": "provider.free-limit", "message": "free limit" })),
        failed("msg_5", 4000, json!({ "type": "provider.budget-limit", "message": "budget" })),
        retrying,
    ];
    let h = open(50, session(json!({})), messages, Vec::new(), Info::default());
    let screen = h.wait_for("Retry due");
    assert!(screen.contains("   Error: bad request"), "{screen}");
    assert!(screen.contains("   Error: the runner crashed"), "{screen}");
    assert!(screen.contains("   You've used today's free messages."), "{screen}");
    assert!(screen.contains("   Upgrade to OpenCode Go → /connect · Switch model → /models"), "{screen}");
    // A usage limit is a bordered notice with the model-list key.
    assert!(screen.contains("  ┃ Usage limit reached"), "{screen}");
    assert!(screen.contains("  ┃ Paid models are paused. Switch to a free model with"), "{screen}");
    assert!(screen.contains("   ⚠ Retry due · attempt 2 · overloaded"), "{screen}");
    in_order(&screen, &["bad request", "runner crashed", "free messages", "Usage limit", "Retry due"]);
}

#[test]
fn the_revert_banner_counts_reverted_prompts_and_a_click_clears_it() {
    let messages = vec![
        user("msg_1", 1000, "Keep this"),
        user("msg_2", 2000, "Undo this"),
        assistant("msg_3", 3000, json!([{ "type": "text", "text": "Edited the file" }])),
        user("msg_4", 4000, "And this"),
    ];
    let revert = json!({ "revert": {
        "messageID": "msg_2",
        "files": [
            { "file": "src/parser.rs", "patch": "", "additions": 4, "deletions": 2, "status": "modified" },
            { "file": "src/new.rs", "patch": "", "additions": 10, "deletions": 0, "status": "added" },
        ],
    }});
    let h = open(30, session(revert), messages, Vec::new(), Info::default());
    let screen = h.wait_for("messages reverted");
    assert!(screen.contains("┃  2 messages reverted"), "{screen}");
    assert!(screen.contains("┃  M src/parser.rs +4 -2"), "{screen}");
    assert!(screen.contains("┃  A src/new.rs +10"), "{screen}");
    assert!(screen.contains("or /redo to restore"), "{screen}");
    // Messages from the boundary on are hidden.
    assert!(screen.contains("Keep this"), "{screen}");
    assert!(!screen.contains("Undo this"), "{screen}");

    h.app.click(10, h.row("messages reverted"));
    assert!(h.app.wait_until(Duration::from_secs(5), || {
        h.log.lock().unwrap().contains(&format!("DELETE /api/session/{ID}/revert"))
    }));
}

#[test]
fn a_long_running_shell_call_shows_the_background_hint() {
    let messages = vec![
        user("msg_1", 1000, "Build it"),
        assistant(
            "msg_2",
            2000,
            json!([{
                "type": "tool", "id": "call_1", "name": "bash",
                "state": { "status": "running", "input": { "command": "make" }, "metadata": {} },
                "time": { "created": 2000, "ran": 2000 },
            }]),
        ),
    ];
    let h = open(20, session(json!({})), messages, Vec::new(), Info::default());
    let screen = h.wait_for("to move running work to the background");
    assert!(screen.contains("   Press ctrl+b to move running work to the background"), "{screen}");
    // The call finishes: the hint goes.
    h.apply(
        "session.tool.success",
        1,
        json!({
            "sessionID": ID, "assistantMessageID": "msg_2", "id": "call_1",
            "executed": true, "content": [{ "type": "text", "text": "done" }],
        }),
    );
    assert!(h.app.wait_until(Duration::from_secs(5), || { !h.app.text().contains("background") }));
}

#[test]
fn image_previews_show_three_and_count_the_rest() {
    // A 1x1 PNG.
    let png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";
    let image = |name: &str, data: &str| json!({ "data": data, "mime": "image/png", "name": name, "source": { "type": "inline" } });
    let mut message = user("msg_1", 1000, "Look at these");
    message["files"] =
        json!([image("a.png", png), image("b.png", "bm90IGFuIGltYWdl"), image("c.png", png), image("d.png", png),]);
    let on = Info { session: Some(Session { image_preview: Some(true), ..Session::default() }), ..Info::default() };
    let h = open(24, session(json!({})), vec![message.clone()], Vec::new(), on);
    let screen = h.wait_for("+1 more");
    // An image that does not decode says so.
    assert!(screen.contains("No preview"), "{screen}");
    in_order(&screen, &["No preview", "+1 more", "Look at these"]);

    // Off by default: only the chips.
    let h = open(24, session(json!({})), vec![message], Vec::new(), Info::default());
    let screen = h.wait_for("Look at these");
    assert!(!screen.contains("more"), "{screen}");
    assert!(screen.contains("file  a.png"), "{screen}");
}

#[test]
fn a_live_free_limit_stop_restores_the_prompt_and_offers_go() {
    let messages = vec![user("msg_1", 1000, "Write the tests"), assistant("msg_2", 2000, json!([]))];
    let h = open(30, session(json!({})), messages, Vec::new(), Info::default());
    h.wait_for("Write the tests");
    h.apply(
        "session.step.failed",
        1,
        json!({
            "sessionID": ID, "assistantMessageID": "msg_2",
            "error": { "type": "provider.free-limit", "message": "free limit", "retryAfterMs": 3_600_000 },
        }),
    );
    let screen = h.wait_for("Free limit reached");
    assert!(screen.contains("You've used today's free messages."), "{screen}");
    let prompt = h.tui.textarea.borrow().clone().expect("the prompt is focused");
    assert_eq!(prompt.text(), "Write the tests");
}
