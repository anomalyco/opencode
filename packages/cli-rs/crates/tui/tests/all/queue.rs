//! Queued prompts and pending prompt actions (E.10b) over a fixture server that logs every request: the dock, the
//! queued prompts dialog (steer, delete, undo), the pending steer dialog, and the message actions dialog. Writes
//! answer 204 where the server does; `fail` answers the inbox writes with a 409.

use std::rc::Rc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use bytes::Bytes;
use opencode_api::client::Client;
use opencode_api::generated::SessionID;
use opencode_api::transport::{BoxFuture, Request, Response, Transport};
use opencode_local::cli_config::{Info, Resolved};
use opencode_tui::{Deps, Route, Tui};
use opentui::testing::TestApp;
use serde_json::{Value, json};

use crate::support::WAIT;

type Seen = Arc<Mutex<Vec<(String, String, Value)>>>;

const LOCATION: &str = "/project";

struct Fixture {
    messages: Vec<Value>,
    inbox: Vec<Value>,
    fail: bool,
    seen: Seen,
}

impl Transport for Fixture {
    fn send(&self, request: Request) -> BoxFuture<'_, Result<Response, String>> {
        let body: Value =
            request.body.as_ref().and_then(|body| serde_json::from_slice(body).ok()).unwrap_or(Value::Null);
        let path = request.url.path().to_owned();
        self.seen.lock().unwrap().push((request.method.to_owned(), path.clone(), body.clone()));
        let location = json!({ "directory": LOCATION });
        let base = "/api/session/ses_a";
        let inbox = path.starts_with(&format!("{base}/inbox/"));
        let (status, body) = match (request.method, path.as_str()) {
            ("GET", "/api/session") => (200, json!({ "data": [], "cursor": {} })),
            ("GET", p) if p == base => (200, json!({ "data": session("ses_a") })),
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
                    None => (200, json!({ "data": session(other) })),
                }
            }
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
            ("GET", "/api/provider" | "/api/command") => (200, json!({ "location": location, "data": [] })),
            ("PATCH" | "DELETE", _) if inbox && self.fail => {
                (409, json!({ "_tag": "SessionInboxConflict", "message": "already delivered" }))
            }
            ("PATCH" | "DELETE", _) if inbox => (204, Value::Null),
            ("POST", p) if p == format!("{base}/revert/stage") => {
                (200, json!({ "data": { "messageID": body["messageID"] } }))
            }
            ("POST", p) if p == format!("{base}/fork") => (200, json!({ "data": session("ses_fork") })),
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

fn session(id: &str) -> Value {
    json!({
        "id": id, "title": "Fix the parser", "projectID": "project", "cost": 0, "agent": "build",
        "model": { "providerID": "p", "id": "m" },
        "tokens": { "input": 0, "output": 0, "reasoning": 0, "cache": { "read": 0, "write": 0 } },
        "time": { "created": 1_772_539_200_000_u64, "updated": 1_772_542_800_000_u64 },
        "location": { "directory": LOCATION },
    })
}

fn user(id: &str, created: u64, text: &str) -> Value {
    json!({ "id": id, "type": "user", "text": text, "time": { "created": created } })
}

fn turns() -> Vec<Value> {
    vec![
        user("msg_01", 1_772_539_200_000, "Read the parser"),
        json!({
            "id": "msg_02", "type": "assistant", "agent": "build", "model": { "providerID": "p", "id": "m" },
            "time": { "created": 1_772_539_201_000_u64, "completed": 1_772_539_202_000_u64 }, "finish": "stop",
            "content": [{ "type": "text", "id": "t1", "text": "Fixed it." }],
        }),
    ]
}

fn pending(id: &str, text: &str, delivery: &str) -> Value {
    json!({
        "id": id, "sessionID": "ses_a", "time": { "created": 1_772_539_300_000_u64 }, "type": "user",
        "payload": { "text": text }, "delivery": delivery,
    })
}

fn queued() -> Vec<Value> {
    vec![pending("msg_05", "First queued\nquestion", "queue"), pending("msg_06", "Second queued", "queue")]
}

struct Kit {
    app: TestApp,
    tui: Rc<Tui>,
    seen: Seen,
}

impl Kit {
    fn new(inbox: Vec<Value>) -> Self {
        Self::with(inbox, false)
    }

    fn with(inbox: Vec<Value>, fail: bool) -> Self {
        let seen = Seen::default();
        let fixture = Fixture { messages: turns(), inbox, fail, seen: seen.clone() };
        let client = Client::with_transport("http://opencode.local", Arc::new(fixture)).unwrap();
        let app = TestApp::new(100, 30);
        let tui = opencode_tui::mount(
            &app,
            Deps {
                client,
                directory: LOCATION.into(),
                config: Resolved::new(Info { animations: Some(false), ..Info::default() }, |_| None),
                roots: None,
                route: Route::Session { id: SessionID("ses_a".into()) },
                continue_: false,
                events: false,
            },
        );
        let kit = Self { app, tui, seen };
        kit.wait_for("Fixed it.");
        kit.wait_for("Model M");
        kit
    }

    fn wait_for(&self, text: &str) -> String {
        let found = self.app.wait_until(WAIT, || self.app.text().contains(text));
        let screen = self.app.text();
        assert!(found, "{text:?} never showed:\n{screen}");
        screen
    }

    fn wait_gone(&self, text: &str) {
        let gone = self.app.wait_until(WAIT, || !self.app.text().contains(text));
        assert!(gone, "{text:?} stayed:\n{}", self.app.text());
    }

    /// A single click where `text` starts: the clock moves past the double-click window first, which would
    /// select a word. Hit testing uses the last frame, so the click waits for a frame that nothing changed
    /// after (a late response can rebuild the widget under `text`).
    fn click(&self, text: &str) {
        self.app.advance(Duration::from_secs(1));
        let mut at = None;
        let settled = self.app.wait_until(WAIT, || {
            at = self.app.text().lines().enumerate().find_map(|(y, line)| {
                let x = line.find(text)?;
                Some((line[..x].chars().count() as u16, y as u16))
            });
            self.app.advance(Duration::ZERO);
            at.is_some() && !self.app.needs_frame()
        });
        let (x, y) = at.unwrap_or_else(|| panic!("{text:?} never showed:\n{}", self.app.text()));
        assert!(settled, "the screen never settled:\n{}", self.app.text());
        self.app.click(x, y);
    }

    fn writes(&self) -> Vec<String> {
        self.seen
            .lock()
            .unwrap()
            .iter()
            // The goal footer's RPC `get` is a read, as P-REQ counts it.
            .filter(|(method, path, _)| method != "GET" && !(path.starts_with("/api/rpc/") && path.ends_with("/get")))
            .map(|(method, path, body)| format!("{method} {path} {body}"))
            .collect()
    }

    fn wait_writes(&self, count: usize) -> Vec<String> {
        let found = self.app.wait_until(WAIT, || self.writes().len() >= count);
        assert!(found, "expected {count} writes: {:?}", self.writes());
        self.app.advance(Duration::from_millis(20));
        self.writes()
    }

    fn prompt_text(&self) -> String {
        self.tui.textarea.borrow().as_ref().map(|textarea| textarea.text()).unwrap_or_default()
    }
}

#[test]
fn the_dock_shows_the_queue_and_the_transcript_hides_it() {
    let kit = Kit::new(queued());
    let screen = kit.wait_for("2 queued · First queued question");
    assert!(!screen.contains("Second queued"), "{screen}");
    // The dock sits above the prompt, and nothing else shows the queued prompts.
    let dock = screen.lines().position(|line| line.contains("2 queued")).unwrap();
    let prompt = screen.lines().position(|line| line.contains("╹▀")).unwrap();
    assert!(dock < prompt, "{screen}");
    assert_eq!(screen.matches("First queued").count(), 1, "{screen}");

    let kit = Kit::new(vec![]);
    let screen = kit.app.text();
    assert!(!screen.contains("queued"), "{screen}");
    kit.app.press("ctrl+x");
    kit.app.press("q");
    kit.app.advance(Duration::from_millis(20));
    assert!(!kit.app.text().contains("Search queued prompts"), "{}", kit.app.text());
}

#[test]
fn the_queued_dialog_lists_prompts_and_enter_steers_one() {
    let kit = Kit::new(queued());
    kit.app.press("ctrl+x");
    kit.app.press("q");
    let screen = kit.wait_for("Search queued prompts");
    assert!(screen.contains("1 of 2"), "{screen}");
    assert!(screen.contains("steer enter"), "{screen}");
    assert!(screen.contains("delete ctrl+d"), "{screen}");
    assert!(screen.contains("undo ctrl+u"), "{screen}");
    // The first prompt takes two rows of the two-row list, so the move scrolls the second into view.
    kit.app.press("down");
    kit.wait_for("2 of 2");
    kit.app.press("enter");
    assert_eq!(kit.wait_writes(1), [r#"PATCH /api/session/ses_a/inbox/msg_06 {"delivery":"steer"}"#]);
    kit.wait_gone("Search queued prompts");
}

#[test]
fn a_click_on_the_dock_opens_the_dialog_and_delete_closes_after_the_last() {
    let kit = Kit::new(queued());
    kit.click("2 queued");
    kit.wait_for("Search queued prompts");
    kit.app.press("ctrl+d");
    assert_eq!(kit.wait_writes(1), ["DELETE /api/session/ses_a/inbox/msg_05 null"]);
    // Not the last prompt: the dialog stays.
    assert!(kit.app.text().contains("Search queued prompts"), "{}", kit.app.text());

    let kit = Kit::new(vec![pending("msg_05", "Only one", "queue")]);
    kit.click("1 queued");
    kit.wait_for("Search queued prompts");
    kit.app.press("ctrl+d");
    kit.wait_writes(1);
    kit.wait_gone("Search queued prompts");
}

#[test]
fn undo_takes_a_queued_prompt_back_into_the_composer() {
    let kit = Kit::new(queued());
    kit.app.type_text("draft");
    kit.app.press("ctrl+x");
    kit.app.press("q");
    kit.wait_for("Search queued prompts");
    kit.app.press("ctrl+u");
    assert_eq!(kit.wait_writes(1), ["DELETE /api/session/ses_a/inbox/msg_05 null"]);
    kit.wait_gone("Search queued prompts");
    assert_eq!(kit.prompt_text(), "draft\n\nFirst queued\nquestion");
}

#[test]
fn undo_waits_for_shell_mode_to_end() {
    let kit = Kit::new(queued());
    kit.app.type_text("!ls");
    kit.app.press("ctrl+x");
    kit.app.press("q");
    kit.wait_for("Search queued prompts");
    kit.app.press("ctrl+u");
    kit.wait_for("Leave shell mode before undoing a queued prompt");
    assert!(kit.writes().is_empty(), "{:?}", kit.writes());
}

#[test]
fn a_failed_steer_keeps_the_dialog_and_toasts() {
    let kit = Kit::with(queued(), true);
    kit.app.press("ctrl+x");
    kit.app.press("q");
    kit.wait_for("Search queued prompts");
    kit.app.press("enter");
    kit.wait_for("Failed to steer pending prompt");
    assert!(kit.app.text().contains("Search queued prompts"), "{}", kit.app.text());
}

#[test]
fn a_pending_steer_moves_to_the_queue_or_is_deleted() {
    let kit = Kit::new(vec![pending("msg_05", "Steer this", "steer")]);
    // A steer still in the inbox shows in the transcript, and the dock stays hidden.
    let screen = kit.wait_for("Steer this");
    assert!(!screen.contains("queued"), "{screen}");
    kit.click("Steer this");
    let screen = kit.wait_for("Pending steer");
    assert!(screen.contains("Move to queue"), "{screen}");
    assert!(screen.contains("Delete"), "{screen}");
    kit.app.press("enter");
    assert_eq!(kit.wait_writes(1), [r#"PATCH /api/session/ses_a/inbox/msg_05 {"delivery":"queue"}"#]);
    kit.wait_gone("Pending steer");

    let kit = Kit::new(vec![pending("msg_05", "Steer this", "steer")]);
    kit.click("Steer this");
    kit.wait_for("Pending steer");
    kit.app.press("down");
    kit.app.press("enter");
    assert_eq!(kit.wait_writes(1), ["DELETE /api/session/ses_a/inbox/msg_05 null"]);
}

#[test]
fn message_actions_revert_and_fork() {
    let kit = Kit::new(vec![]);
    kit.click("Read the parser");
    let screen = kit.wait_for("Message Actions");
    for option in ["Jump to", "Revert", "Copy", "Fork"] {
        assert!(screen.contains(option), "{option}: {screen}");
    }
    // Jump to closes it.
    kit.app.press("enter");
    kit.wait_gone("Message Actions");
    assert!(kit.writes().is_empty(), "{:?}", kit.writes());

    kit.click("Read the parser");
    kit.wait_for("Message Actions");
    kit.app.press("down");
    kit.app.press("enter");
    assert_eq!(kit.wait_writes(1), [r#"POST /api/session/ses_a/revert/stage {"messageID":"msg_01"}"#]);
    let found = kit.app.wait_until(WAIT, || kit.prompt_text() == "Read the parser");
    assert!(found, "{:?}", kit.prompt_text());

    let kit = Kit::new(vec![]);
    kit.click("Read the parser");
    kit.wait_for("Message Actions");
    for _ in 0..3 {
        kit.app.press("down");
    }
    kit.app.press("enter");
    assert_eq!(kit.wait_writes(1), [r#"POST /api/session/ses_a/fork {"before":"msg_01"}"#]);
    kit.wait_for("Forked session");
}

#[test]
fn the_timeline_opens_the_message_actions() {
    let kit = Kit::new(vec![]);
    kit.app.press("ctrl+x");
    kit.app.press("g");
    kit.wait_for("Search timeline");
    kit.app.press("enter");
    kit.wait_for("Message Actions");
}
