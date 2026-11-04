//! Scrolling, message navigation, the scrollbar, and groups (E.8) over a long fixture session.

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use bytes::Bytes;
use opencode_api::client::Client;
use opencode_api::generated::SessionID;
use opencode_api::transport::{BoxFuture, Request, Response, Transport};
use opencode_local::cli_config::{Info, Resolved, Session, Verbosity};
use opencode_tui::{Deps, Route, Tui};
use opentui::testing::TestApp;
use serde_json::{Value, json};

/// Serves one session's messages, newest page first, `limit` at a time, with a cursor that counts the
/// messages older than the page.
struct Fixture {
    id: String,
    messages: Vec<Value>,
    older: Arc<AtomicUsize>,
}

impl Transport for Fixture {
    fn send(&self, request: Request) -> BoxFuture<'_, Result<Response, String>> {
        let path = request.url.path().to_owned();
        let query: HashMap<String, String> = request.url.query_pairs().into_owned().collect();
        Box::pin(async move {
            let session = format!("/api/session/{}", self.id);
            let (status, body) = match request.method {
                "GET" if path == "/api/session" => (200, json!({ "data": [], "cursor": {} })),
                "GET" if path == session => (200, json!({ "data": info(&self.id) })),
                "GET" if path == format!("{session}/message") => {
                    let limit: usize = query
                        .get("limit")
                        .map_or(20, |limit| limit.parse().unwrap());
                    let end = match query.get("cursor") {
                        Some(cursor) => {
                            self.older.fetch_add(1, Ordering::SeqCst);
                            cursor.parse().unwrap()
                        }
                        None => self.messages.len(),
                    };
                    let start = end.saturating_sub(limit);
                    let page: Vec<_> = self.messages[start..end].iter().rev().cloned().collect();
                    let next = (start > 0).then(|| start.to_string());
                    (200, json!({ "data": page, "cursor": { "next": next } }))
                }
                "GET" if path == format!("{session}/permission") => (200, json!({ "data": [] })),
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

fn info(id: &str) -> Value {
    json!({
        "id": id, "title": "Navigation", "projectID": "project", "cost": 0, "agent": "build",
        "tokens": { "input": 0, "output": 0, "reasoning": 0, "cache": { "read": 0, "write": 0 } },
        "time": { "created": 1, "updated": 1 },
        "location": { "directory": "/project" },
    })
}

fn user(id: &str, created: u64, text: &str) -> Value {
    json!({ "id": id, "type": "user", "text": text, "time": { "created": created } })
}

fn assistant(id: &str, created: u64, content: Value) -> Value {
    json!({
        "id": id, "type": "assistant", "agent": "build",
        "model": { "providerID": "provider", "id": "model" },
        "time": { "created": created, "completed": created + 1000 },
        "finish": "stop",
        "content": content,
    })
}

fn read(id: &str, path: &str) -> Value {
    json!({
        "type": "tool", "id": id, "name": "read",
        "state": { "status": "completed", "input": { "path": path }, "content": [] },
        "time": { "created": 1, "completed": 2 },
    })
}

/// 30 turns: a question, then two reads and a three-paragraph answer.
fn turns(count: u64) -> Vec<Value> {
    (1..=count)
        .flat_map(|turn| {
            let created = turn * 10_000;
            [
                user(&format!("msg_{turn:03}a"), created, &format!("Question {turn}")),
                assistant(
                    &format!("msg_{turn:03}b"),
                    created + 1000,
                    json!([
                        read(&format!("call_{turn}a"), "src/a.rs"),
                        read(&format!("call_{turn}b"), "src/b.rs"),
                        { "type": "text", "text": format!("Answer {turn} one.\n\nAnswer {turn} two.\n\nAnswer {turn} three.") },
                    ]),
                ),
            ]
        })
        .collect()
}

struct Harness {
    app: TestApp,
    tui: std::rc::Rc<Tui>,
    older: Arc<AtomicUsize>,
}

fn open(messages: Vec<Value>, info: Info) -> Harness {
    let last = messages.len() / 2;
    let older = Arc::new(AtomicUsize::new(0));
    let fixture = Fixture {
        id: "ses_n".into(),
        messages,
        older: older.clone(),
    };
    let client = Client::with_transport("http://opencode.local", Arc::new(fixture)).unwrap();
    // The transcript keeps the 15-row view these cases were written for (E.12 took the session header and
    // the column gaps out, so it grew by five rows at 80x30).
    let app = TestApp::new(80, 25);
    let tui = opencode_tui::mount(
        &app,
        Deps {
            client,
            directory: "/project".into(),
            config: Resolved::new(info, |_| None),
            roots: None,
            route: Route::Session {
                id: SessionID("ses_n".into()),
            },
            continue_: false,
            events: false,
        },
    );
    let h = Harness { app, tui, older };
    h.wait_for(&format!("Answer {last} three."));
    h
}

impl Harness {
    fn wait_for(&self, text: &str) -> String {
        let found = self
            .app
            .wait_until(Duration::from_secs(5), || self.app.text().contains(text));
        let screen = self.app.text();
        assert!(found, "{text:?} never showed:\n{screen}");
        screen
    }

    fn press(&self, key: &str) -> String {
        self.app.press(key);
        self.app.advance(Duration::from_millis(1));
        self.app.text()
    }

    fn dispatch(&self, command: &str) -> String {
        self.tui.keymap.dispatch(command, None);
        self.app.advance(Duration::from_millis(1));
        self.app.text()
    }

    /// The row a line shows on, if it does.
    fn row(screen: &str, text: &str) -> Option<usize> {
        screen.lines().position(|line| line.contains(text))
    }
}

/// The transcript's first row on screen, under the tab strip.
const TOP: usize = 1;

/// How far the content moved down between two screens, by the first answer or question line of
/// `before` that `after` still shows.
fn shift(before: &str, after: &str) -> Option<isize> {
    let before: Vec<_> = before.lines().collect();
    let after: Vec<_> = after.lines().collect();
    before.iter().enumerate().skip(TOP).find_map(|(row, line)| {
        if !(line.contains("Answer") || line.contains("Question")) {
            return None;
        }
        let to = after.iter().position(|other| other == line)?;
        Some(to as isize - row as isize)
    })
}

#[test]
fn line_half_page_and_page_scroll_by_their_distances() {
    let h = open(turns(30), Info::default());
    let start = h.app.text();
    let anchor = "Answer 30 one.";
    let at = Harness::row(&start, anchor).unwrap();
    assert!(!start.contains("Jump to latest"), "{start}");

    // `session.line.up` (ctrl+alt+y) moves the content down one row.
    let screen = h.press("ctrl+alt+y");
    assert_eq!(Harness::row(&screen, anchor), Some(at + 1), "{screen}");
    assert!(screen.contains("Jump to latest ↓"), "{screen}");
    let screen = h.press("ctrl+alt+e");
    assert_eq!(Harness::row(&screen, anchor), Some(at), "{screen}");

    // Half a page is a quarter of the view, a page half of it (`index.tsx:933-968`); the view is 15
    // rows tall at 80x30 with the prompt below it.
    let before = h.app.text();
    let half = h.press("ctrl+alt+u");
    let moved = shift(&before, &half).unwrap();
    let page = h.press("pageup");
    assert!((3..=5).contains(&moved), "half page moved {moved}:\n{half}");
    assert_eq!(
        shift(&half, &page),
        Some(moved * 2),
        "{half}\n=====\n{page}"
    );
    let back = h.press("ctrl+alt+d");
    assert_eq!(shift(&page, &back), Some(-moved), "{back}");
    for _ in 0..3 {
        h.press("pagedown");
    }
    let bottom = h.app.text();
    assert_eq!(Harness::row(&bottom, anchor), Some(at), "{bottom}");
    assert!(!bottom.contains("Jump to latest"), "{bottom}");
}

#[test]
fn page_up_backfills_then_last_returns_to_the_tail() {
    let h = open(turns(30), Info::default());
    // Paging up all the way mounts older rows and pages, and every page keeps its line.
    let mut screen = h.app.text();
    for _ in 0..400 {
        if screen.contains("┃  Question 1\n") {
            break;
        }
        let previous = screen;
        screen = h.press("pageup");
        if screen.contains("Loading session history…") {
            assert!(h.app.wait_until(Duration::from_secs(5), || {
                !h.app.text().contains("Loading session history…")
            }));
            screen = h.app.text();
        }
        let first = previous
            .lines()
            .skip(TOP)
            .find(|line| line.contains("Question") || line.contains("Answer"));
        if let Some(line) = first {
            assert!(
                screen.contains(line),
                "{line:?} left:\n{previous}\n=====\n{screen}"
            );
        }
    }
    assert!(screen.contains("┃  Question 1\n"), "{screen}");
    assert!(h.older.load(Ordering::SeqCst) >= 2);
    assert!(screen.contains("Jump to latest ↓"), "{screen}");

    // `session.last` (end): back at the newest rows, following the bottom.
    let screen = h.press("end");
    let screen = if screen.contains("Answer 30 three.") {
        screen
    } else {
        h.wait_for("Answer 30 three.")
    };
    assert!(!screen.contains("Jump to latest"), "{screen}");
    assert!(!screen.contains("Question 1\n"), "{screen}");
}

#[test]
fn first_loads_the_history_and_jump_to_latest_returns() {
    let h = open(turns(30), Info::default());
    // `session.first` (ctrl+g) loads every older page at once and shows the first message on top.
    h.press("ctrl+g");
    let screen = h.wait_for("┃  Question 1\n");
    assert_eq!(
        h.older.load(Ordering::SeqCst),
        1,
        "one request for every page"
    );
    assert_eq!(
        Harness::row(&screen, "Question 1"),
        Some(TOP + 2),
        "{screen}"
    );
    assert!(screen.contains("Jump to latest ↓"), "{screen}");

    // A click on "Jump to latest" is `session.last`.
    let (x, y) = position(&screen, "Jump to latest");
    h.app.click(x as u16 + 2, y as u16);
    h.app.advance(Duration::from_millis(1));
    let screen = h.wait_for("Answer 30 three.");
    assert!(!screen.contains("Jump to latest"), "{screen}");
}

#[test]
fn message_navigation_aligns_messages_with_the_top() {
    let h = open(turns(30), Info::default());
    // A reply's first anchor is its first mounted part, so a closed exploration group does not count
    // (`anchors.messagePositions`). The previous message above the view's top is turn 29's reply,
    // aligned one row above its text.
    let screen = settle(&h, h.dispatch("session.message.previous"));
    assert_eq!(
        Harness::row(&screen, "Answer 29 one."),
        Some(TOP + 1),
        "{screen}"
    );
    assert!(screen.contains("Jump to latest ↓"), "{screen}");
    // Then the question before it, its box on the top row.
    let screen = settle(&h, h.dispatch("session.message.previous"));
    assert_eq!(
        Harness::row(&screen, "Question 29"),
        Some(TOP + 1),
        "{screen}"
    );
    // Next steps from the last jump, whatever the view shows.
    let screen = settle(&h, h.dispatch("session.message.next"));
    assert_eq!(
        Harness::row(&screen, "Answer 29 one."),
        Some(TOP + 1),
        "{screen}"
    );
    // User-only skips the replies.
    let screen = settle(&h, h.dispatch("session.message.user.next"));
    assert_eq!(
        Harness::row(&screen, "Question 30"),
        Some(TOP + 1),
        "{screen}"
    );
    let screen = settle(&h, h.dispatch("session.message.user.previous"));
    assert_eq!(
        Harness::row(&screen, "Question 29"),
        Some(TOP + 1),
        "{screen}"
    );

    // The last user message (alt+end) aligns too: the slack below the last rows makes room.
    h.press("end");
    let screen = settle(&h, h.press("alt+end"));
    assert_eq!(
        Harness::row(&screen, "Question 30"),
        Some(TOP + 1),
        "{screen}"
    );

    // Walking back past the loaded history loads older pages.
    for _ in 0..80 {
        h.dispatch("session.message.user.previous");
        h.app.wait_until(Duration::from_millis(50), || false);
    }
    let screen = h.wait_for("┃  Question 1\n");
    assert_eq!(
        Harness::row(&screen, "Question 1"),
        Some(TOP + 1),
        "{screen}"
    );
}

#[test]
fn groups_open_on_click_and_follow_grouping_and_verbosity() {
    let h = open(turns(3), Info::default());
    let screen = h.app.text();
    assert!(screen.contains("→ Explored: 2 reads"), "{screen}");
    // E.7a's read row.
    let read = "→ Read";
    assert!(!screen.contains(read), "{screen}");

    // A click opens the group; the reads show below its header.
    let (x, _) = position(&screen, "→ Explored: 2 reads");
    let lines: Vec<_> = screen.lines().collect();
    let last = lines
        .iter()
        .rposition(|line| line.contains("→ Explored"))
        .unwrap();
    h.app.click(x as u16, last as u16);
    let opened = h.wait_for(read);
    let lines: Vec<_> = opened.lines().collect();
    let header = lines
        .iter()
        .rposition(|line| line.contains("→ Explored"))
        .unwrap();
    // The calls stack under the header with no blank line (`Children` in `tool` mode).
    assert!(
        lines[header + 1].contains(read) && lines[header + 2].contains(read),
        "{opened}"
    );

    // Grouping off shows every call, and back on folds them again.
    let screen = settle(&h, h.dispatch("session.toggle.exploration_grouping"));
    assert!(
        !screen.contains("Explored") && screen.contains(read),
        "{screen}"
    );
    let screen = settle(&h, h.dispatch("session.toggle.exploration_grouping"));
    assert!(screen.contains("Explored"), "{screen}");

    // High opens every exploration group the reader did not close.
    let high = Info {
        session: Some(Session {
            verbosity: Some(Verbosity::High),
            ..Session::default()
        }),
        ..Info::default()
    };
    let h = open(turns(3), high);
    let screen = h.app.text();
    let lines: Vec<_> = screen.lines().collect();
    let header = lines
        .iter()
        .rposition(|line| line.contains("→ Explored"))
        .unwrap();
    assert!(lines[header + 1].contains(read), "{screen}");
    // The cycle goes on to Low, which folds a turn's calls into one activity summary.
    let screen = settle(&h, h.dispatch("session.verbosity.cycle"));
    assert!(screen.contains("+ 2 reads"), "{screen}");
    assert!(!screen.contains("Explored"), "{screen}");
}

#[test]
fn the_scrollbar_toggles_and_the_wheel_moves_three_rows() {
    let h = open(turns(30), Info::default());
    let screen = h.app.text();
    let anchor = "Answer 30 one.";
    let at = Harness::row(&screen, anchor).unwrap();
    h.app.scroll(10, 8, false);
    h.app.advance(Duration::from_millis(1));
    let screen = h.app.text();
    assert_eq!(Harness::row(&screen, anchor), Some(at + 3), "{screen}");

    // The bar's thumb in the column before the route's two-cell padding.
    let thumb = |screen: &str| {
        screen
            .lines()
            .skip(TOP)
            .take(15)
            .filter(|line| line.chars().nth(77).is_some_and(|cell| cell != ' '))
            .count()
    };
    assert_eq!(thumb(&screen), 0, "{screen}");
    let screen = settle(&h, h.dispatch("session.toggle.scrollbar"));
    assert!(thumb(&screen) > 0, "a bar in the last column:\n{screen}");
}

/// Lets frames and follow-up timers run, then reads the screen.
fn settle(h: &Harness, _: String) -> String {
    for _ in 0..4 {
        h.app.advance(Duration::from_millis(5));
    }
    h.app.text()
}

fn position(screen: &str, text: &str) -> (usize, usize) {
    let y = Harness::row(screen, text).unwrap();
    let line = screen.lines().nth(y).unwrap();
    let x = line[..line.find(text).unwrap()].chars().count();
    (x, y)
}
