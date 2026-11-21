use crate::support::{self, Fake, Harness, WAIT, deref_harness, user};

use std::rc::Rc;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::time::Duration;

use opencode_local::cli_config::{Info, Session, Verbosity};
use opencode_tui::{Deps, Route};
use serde_json::{Value, json};

/// Serves the same messages for every session, newest page first, `limit` at a time, with a cursor that
/// counts the messages older than the page; `older` counts the reads of an older page. While `failing` is set, every
/// message read fails.
fn fake(messages: Vec<Value>, older: Arc<AtomicUsize>, failing: Arc<AtomicBool>) -> Fake {
    Fake::new(move |seen| {
        let path = seen.path.as_str();
        let id = path.strip_prefix("/api/session/").and_then(|rest| rest.split('/').next()).unwrap_or_default();
        let session = format!("/api/session/{id}");
        match seen.method.as_str() {
            "GET" if path == "/api/session" => (200, json!({ "data": [], "cursor": {} })),
            "GET" if path == session => (200, json!({ "data": info(id) })),
            "GET" if path == format!("{session}/message") => {
                let limit = seen.param("limit");
                let limit: usize = if limit.is_empty() { 20 } else { limit.parse().unwrap() };
                let cursor = seen.param("cursor");
                if !cursor.is_empty() {
                    older.fetch_add(1, Ordering::SeqCst);
                }
                if failing.load(Ordering::SeqCst) {
                    return (500, json!({ "_tag": "UnknownError", "message": "the read failed", "ref": "err_1" }));
                }
                let end = if cursor.is_empty() { messages.len() } else { cursor.parse().unwrap() };
                let start = end.saturating_sub(limit);
                let page: Vec<_> = messages[start..end].iter().rev().cloned().collect();
                let next = (start > 0).then(|| start.to_string());
                (200, json!({ "data": page, "cursor": { "next": next } }))
            }
            "GET" if path == format!("{session}/permission") => (200, json!({ "data": [] })),
            _ => support::not_found(),
        }
    })
}

fn info(id: &str) -> Value {
    support::merge(support::session(id, "Navigation"), json!({ "agent": "build" }))
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

struct Nav {
    harness: Harness,
    older: Arc<AtomicUsize>,
    failing: Arc<AtomicBool>,
}

deref_harness!(Nav);

fn open(messages: Vec<Value>, info: Info) -> Nav {
    let last = messages.len() / 2;
    let older = Arc::new(AtomicUsize::new(0));
    let failing = Arc::new(AtomicBool::new(false));
    let fake = fake(messages, older.clone(), failing.clone());
    let deps =
        Deps { config: support::config(info), route: support::session_route("ses_n"), ..support::deps(Arc::new(fake)) };
    // Keep a 15-row transcript viewport for the paging assertions.
    let h = Nav { harness: support::mount(80, 25, deps), older, failing };
    h.wait_for(&format!("Answer {last} three."));
    h
}

impl Nav {
    fn press(&self, key: &str) -> String {
        self.app.press(key);
        self.app.advance(Duration::from_millis(1));
        self.idle()
    }

    /// Renders frames until none is pending and no older page is loading: a move near the top runs
    /// two frames later (`after_layout`), and a backfill lands whenever its page arrives.
    fn idle(&self) -> String {
        let idle = self.app.wait_until(WAIT, || {
            self.app.render();
            !self.app.needs_frame() && !self.app.text().contains("Loading session history…")
        });
        let screen = self.app.text();
        assert!(idle, "never idle:\n{screen}");
        screen
    }

    fn dispatch(&self, command: &str) -> String {
        self.tui.keymap.dispatch(command, None);
        self.app.advance(Duration::from_millis(1));
        self.idle()
    }

    fn row(screen: &str, text: &str) -> Option<usize> {
        screen.lines().position(|line| line.contains(text))
    }
}

/// The transcript's first row on screen, under the tab strip.
const TOP: usize = 1;

#[test]
fn first_mounts_the_head_and_newer_rows_mount_on_the_way_down() {
    let scrollbar = Info { session: Some(Session { scrollbar: Some(true), ..Session::default() }), ..Info::default() };
    let h = open(turns(60), scrollbar);
    // `session.first` mounts the oldest 60 rows only (`setVisibleRowsEnd`), so the content is shorter
    // and the scrollbar's thumb longer than with every row mounted.
    h.press("ctrl+g");
    let head = h.wait_for("┃  Question 1\n");
    assert!(head.contains("Jump to latest ↓"), "{head}");
    let thumb = |screen: &str| {
        screen
            .lines()
            .skip(TOP)
            .take(15)
            .map(|line| match line.chars().nth(77) {
                Some('█') => 2,
                Some('▀' | '▄') => 1,
                _ => 0,
            })
            .sum::<usize>()
    };
    let head_thumb = thumb(&head);
    // Paging down mounts the newer rows (`revealNewerRows`) until the newest one shows, then the view
    // follows the bottom again.
    let mut screen = head;
    for _ in 0..400 {
        if screen.contains("Answer 60 three.") && !screen.contains("Jump to latest") {
            break;
        }
        screen = h.press("pagedown");
    }
    assert!(screen.contains("Answer 60 three."), "{screen}");
    assert!(!screen.contains("Jump to latest"), "{screen}");
    h.press("ctrl+g");
    h.wait_for("┃  Question 1\n");
    let screen = settle(&h, h.dispatch("session.message.next"));
    assert!(head_thumb > thumb(&screen), "head thumb {head_thumb}, full thumb {}:\n{screen}", thumb(&screen));
}

#[test]
fn message_navigation_aligns_messages_with_the_top() {
    let mut messages = turns(30);
    messages[3]["content"] = json!([{ "type": "reasoning", "text": "thinking only" }]);
    let h = open(messages, Info::default());
    // A reply's first anchor is its first mounted part, so a closed exploration group does not count
    // (`anchors.messagePositions`). The previous message above the view's top is turn 29's reply,
    // aligned one row above its text.
    let screen = settle(&h, h.dispatch("session.message.previous"));
    assert_eq!(Nav::row(&screen, "Answer 29 one."), Some(TOP + 1), "{screen}");
    assert!(screen.contains("Jump to latest ↓"), "{screen}");

    // The last user message (alt+end) aligns too: the slack below the last rows makes room. Turn 2's reply, reasoning
    // alone, is no stop.
    h.press("end");
    let screen = settle(&h, h.press("alt+end"));
    assert_eq!(Nav::row(&screen, "Question 30"), Some(TOP + 1), "{screen}");

    for _ in 0..80 {
        h.dispatch("session.message.user.previous");
    }
    let screen = h.wait_for("┃  Question 1\n");
    assert_eq!(Nav::row(&screen, "Question 1"), Some(TOP + 1), "{screen}");
    for (direction, text) in
        [("next", "Answer 1 one."), ("next", "Question 2"), ("next", "Question 3"), ("previous", "Question 2")]
    {
        let screen = settle(&h, h.dispatch(&format!("session.message.{direction}")));
        assert_eq!(Nav::row(&screen, text), Some(TOP + 1), "{screen}");
    }
}

#[test]
fn a_failed_transcript_read_toasts_its_message() {
    for command in ["session open", "session.page.up", "session.message.user.previous", "session.first"] {
        let h = open(turns(30), Info::default());
        h.failing.store(true, Ordering::SeqCst);
        if command == "session open" {
            h.tui.navigate(support::session_route("ses_m"));
            h.app.advance(Duration::from_millis(1));
        }
        for _ in 0..400 {
            if command == "session open" || h.older.load(Ordering::SeqCst) > 0 {
                break;
            }
            h.dispatch(command);
        }
        let screen = h.wait_for("the read failed");
        assert!(!screen.contains("UnknownError"), "{command}:\n{screen}");
    }
}

#[test]
fn groups_open_on_click_and_follow_grouping_and_verbosity() {
    let screen = open(turns(3), Info::default()).app.text();
    assert!(screen.contains("+ 2 reads") && !screen.contains("Explored"), "{screen}");

    let medium =
        Info { session: Some(Session { verbosity: Some(Verbosity::Medium), ..Session::default() }), ..Info::default() };
    let h = open(turns(3), medium);
    let screen = h.app.text();
    assert!(screen.contains("→ Explored: 2 reads"), "{screen}");
    let read = "→ Read";
    assert!(!screen.contains(read), "{screen}");

    let (x, _) = position(&screen, "→ Explored: 2 reads");
    let lines: Vec<_> = screen.lines().collect();
    let last = lines.iter().rposition(|line| line.contains("→ Explored")).unwrap();
    h.app.click(x as u16, last as u16);
    let opened = h.wait_for(read);
    let lines: Vec<_> = opened.lines().collect();
    let header = lines.iter().rposition(|line| line.contains("→ Explored")).unwrap();
    assert!(lines[header + 1].contains(read) && lines[header + 2].contains(read), "{opened}");

    let screen = settle(&h, h.dispatch("session.toggle.exploration_grouping"));
    assert!(!screen.contains("Explored") && screen.contains(read), "{screen}");
    let screen = settle(&h, h.dispatch("session.toggle.exploration_grouping"));
    assert!(screen.contains("Explored"), "{screen}");

    let high =
        Info { session: Some(Session { verbosity: Some(Verbosity::High), ..Session::default() }), ..Info::default() };
    let h = open(turns(3), high);
    let screen = h.app.text();
    let lines: Vec<_> = screen.lines().collect();
    let header = lines.iter().rposition(|line| line.contains("→ Explored")).unwrap();
    assert!(lines[header + 1].contains(read), "{screen}");
    let screen = settle(&h, h.dispatch("session.verbosity.cycle"));
    assert!(screen.contains("+ 2 reads"), "{screen}");
    assert!(!screen.contains("Explored"), "{screen}");
}

#[test]
fn the_scrollbar_toggles_and_the_wheel_moves_three_rows() {
    let h = open(turns(30), Info::default());
    let screen = h.app.text();
    let anchor = "Answer 30 one.";
    let at = Nav::row(&screen, anchor).unwrap();
    h.app.scroll(10, 8, false);
    h.app.advance(Duration::from_millis(1));
    let screen = h.app.text();
    assert_eq!(Nav::row(&screen, anchor), Some(at + 3), "{screen}");

    // The bar's thumb in the column before the route's two-cell padding.
    let thumb = |screen: &str| {
        screen.lines().skip(TOP).take(15).filter(|line| line.chars().nth(77).is_some_and(|cell| cell != ' ')).count()
    };
    assert_eq!(thumb(&screen), 0, "{screen}");
    let screen = settle(&h, h.dispatch("session.toggle.scrollbar"));
    assert!(thumb(&screen) > 0, "a bar in the last column:\n{screen}");
}

#[test]
fn navigation_frees_the_view_it_replaces() {
    let h = open(turns(3), Info::default());
    let marker = Rc::new(());
    for route in [Route::Home, support::session_route("ses_n"), support::session_route("ses_n")] {
        assert!(support::mark(&h.app, &h.tui.frame.main(), 0, &marker) > 0);
        h.tui.navigate(route);
        h.idle();
    }
    h.wait_for("Answer 3 three.");
    support::mark(&h.app, &h.tui.frame.main(), 0, &marker);
    let (x, y) = h.find("Question 3");
    h.app.hover(x, y);
    h.app.click(x, y);
    h.wait_for("Message Actions");
    h.app.press("escape");
    h.tui.navigate(Route::Home);
    h.idle();
    assert_eq!(Rc::strong_count(&marker), 1);
}

fn settle(h: &Nav, _: String) -> String {
    for _ in 0..4 {
        h.app.advance(Duration::from_millis(5));
    }
    h.app.text()
}

fn position(screen: &str, text: &str) -> (usize, usize) {
    let y = Nav::row(screen, text).unwrap();
    let line = screen.lines().nth(y).unwrap();
    let x = line[..line.find(text).unwrap()].chars().count();
    (x, y)
}

#[test]
fn home_and_end_navigate_a_subagent_transcript() {
    let messages: Vec<Value> =
        (0..20).map(|index| user(&format!("msg_{index:02}"), index, &format!("Message {index}"))).collect();
    let fake = Fake::new(move |seen| {
        let path = seen.path.as_str();
        match seen.method.as_str() {
            "GET" if path == "/api/session" => (200, json!({ "data": [], "cursor": {} })),
            "GET" if path == "/api/session/ses_sub" => {
                (200, json!({ "data": support::merge(info("ses_sub"), json!({ "parentID": "ses_parent" })) }))
            }
            "GET" if path == "/api/session/ses_sub/message" => {
                (200, json!({ "data": messages.iter().rev().collect::<Vec<_>>(), "cursor": {} }))
            }
            "GET" if path == "/api/session/ses_sub/inbox" => (200, json!({ "data": [] })),
            _ => support::not_found(),
        }
    });
    let deps = Deps {
        config: support::config(Info::default()),
        route: support::session_route("ses_sub"),
        ..support::deps(Arc::new(fake))
    };
    let h = Nav { harness: support::mount(100, 30, deps), older: Arc::default(), failing: Arc::default() };
    let screen = h.wait_for("Message 19");
    assert!(screen.contains("Subagents"), "{screen}");
    assert!(!screen.contains("Message 0\n") && !screen.contains("Message 0 "), "{screen}");
    h.press("home");
    let screen = h.wait_for("Message 0");
    assert!(!screen.contains("Message 19"), "{screen}");
    h.press("end");
    let screen = h.wait_for("Message 19");
    assert!(!screen.lines().any(|line| line.trim_end().ends_with("Message 0")), "{screen}");
}
