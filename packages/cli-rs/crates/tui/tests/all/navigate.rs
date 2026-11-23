use crate::support::{self, Fake, Harness, WAIT, deref_harness, user};

use std::rc::Rc;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::time::Duration;

use opencode_local::cli_config::{Grouping, Info, Session, Verbosity};
use opencode_tui::{Deps, Route};
use opentui::widget::Widget;
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
    let last = format!("Answer {} three.", messages.len() / 2);
    open_until(messages, info, &last, 25)
}

/// [`open`], `height` rows tall, waiting for `shown` instead of the last answer.
fn open_until(messages: Vec<Value>, info: Info, shown: &str, height: u16) -> Nav {
    let older = Arc::new(AtomicUsize::new(0));
    let failing = Arc::new(AtomicBool::new(false));
    let fake = fake(messages, older.clone(), failing.clone());
    let deps =
        Deps { config: support::config(info), route: support::session_route("ses_n"), ..support::deps(Arc::new(fake)) };
    // 25 rows keep a 15-row transcript viewport for the paging assertions.
    let h = Nav { harness: support::mount(80, height, deps), older, failing };
    h.wait_for(shown);
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

    /// A user message lands, as events.
    fn deliver(&self, seq: u64, text: &str) {
        let ids = json!({ "sessionID": "ses_n", "inboxID": format!("msg_new{seq}") });
        let item = json!({ "item": { "type": "user", "delivery": "steer", "payload": { "text": text } } });
        self.tui.data.apply(vec![
            support::event("ses_n", "session.inbox.enqueued", seq, support::merge(ids.clone(), item)),
            support::event("ses_n", "session.inbox.delivered", seq + 1, ids),
        ]);
    }

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
    let at = Nav::row(&start, anchor).unwrap();
    assert!(!start.contains("Jump to latest"), "{start}");

    let screen = h.press("ctrl+alt+y");
    assert_eq!(Nav::row(&screen, anchor), Some(at + 1), "{screen}");
    assert!(screen.contains("Jump to latest ↓"), "{screen}");
    let screen = h.press("ctrl+alt+e");
    assert_eq!(Nav::row(&screen, anchor), Some(at), "{screen}");

    let before = h.app.text();
    let half = h.press("ctrl+alt+u");
    let moved = shift(&before, &half).unwrap();
    let page = h.press("pageup");
    assert!((3..=5).contains(&moved), "half page moved {moved}:\n{half}");
    assert_eq!(shift(&half, &page), Some(moved * 2), "{half}\n=====\n{page}");
    let back = h.press("ctrl+alt+d");
    assert_eq!(shift(&page, &back), Some(-moved), "{back}");
    for _ in 0..3 {
        h.press("pagedown");
    }
    let bottom = h.app.text();
    assert_eq!(Nav::row(&bottom, anchor), Some(at), "{bottom}");
    assert!(!bottom.contains("Jump to latest"), "{bottom}");
}

#[test]
fn page_up_backfills_then_last_returns_to_the_tail() {
    let h = open(turns(30), Info::default());
    let mut screen = h.app.text();
    for _ in 0..400 {
        if screen.contains("┃  Question 1\n") {
            break;
        }
        let previous = screen;
        screen = h.press("pageup");
        let first = previous.lines().skip(TOP).find(|line| line.contains("Question") || line.contains("Answer"));
        if let Some(line) = first {
            assert!(screen.contains(line), "{line:?} left:\n{previous}\n=====\n{screen}");
        }
    }
    assert!(screen.contains("┃  Question 1\n"), "{screen}");
    assert!(h.older.load(Ordering::SeqCst) >= 2);
    assert!(screen.contains("Jump to latest ↓"), "{screen}");

    // `session.last` (end): back at the newest rows, following the bottom.
    let screen = h.press("end");
    let screen = if screen.contains("Answer 30 three.") { screen } else { h.wait_for("Answer 30 three.") };
    assert!(!screen.contains("Jump to latest"), "{screen}");
    assert!(!screen.contains("Question 1\n"), "{screen}");
}

#[test]
fn first_loads_the_history_and_jump_to_latest_returns() {
    let h = open(turns(30), Info::default());
    // `session.first` (ctrl+g) loads every older page at once and shows the first message on top.
    h.press("ctrl+g");
    let screen = h.wait_for("┃  Question 1\n");
    assert_eq!(h.older.load(Ordering::SeqCst), 1, "one request for every page");
    assert_eq!(Nav::row(&screen, "Question 1"), Some(TOP + 2), "{screen}");
    assert!(screen.contains("Jump to latest ↓"), "{screen}");

    // A click on "Jump to latest" is `session.last`.
    let (x, y) = position(&screen, "Jump to latest");
    h.app.click(x as u16 + 2, y as u16);
    h.app.advance(Duration::from_millis(1));
    let screen = h.wait_for("Answer 30 three.");
    assert!(!screen.contains("Jump to latest"), "{screen}");
}

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
    // Message navigation finds its target among the mounted rows, so it mounts no others (a deviation:
    // `ensureAllRows` mounted every row first).
    let screen = settle(&h, h.dispatch("session.message.next"));
    assert_eq!(thumb(&screen), head_thumb, "{screen}");
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
    // A new message keeps the view the jump holds.
    h.deliver(1, "Question 31");
    let screen = settle(&h, h.idle());
    assert_eq!(Nav::row(&screen, "Answer 29 one."), Some(TOP + 1), "{screen}");
    // Then the question before it, its box on the top row.
    let screen = settle(&h, h.dispatch("session.message.previous"));
    assert_eq!(Nav::row(&screen, "Question 29"), Some(TOP + 1), "{screen}");
    // Next steps from the last jump, whatever the view shows.
    let screen = settle(&h, h.dispatch("session.message.next"));
    assert_eq!(Nav::row(&screen, "Answer 29 one."), Some(TOP + 1), "{screen}");
    // User-only skips the replies.
    let screen = settle(&h, h.dispatch("session.message.user.next"));
    assert_eq!(Nav::row(&screen, "Question 30"), Some(TOP + 1), "{screen}");
    let screen = settle(&h, h.dispatch("session.message.user.previous"));
    assert_eq!(Nav::row(&screen, "Question 29"), Some(TOP + 1), "{screen}");

    // The last user message (alt+end) aligns too: the slack below the last rows makes room.
    h.press("end");
    let screen = settle(&h, h.press("alt+end"));
    assert_eq!(Nav::row(&screen, "Question 31"), Some(TOP + 1), "{screen}");
    // A resize ends the jump and drops its slack, so the view is at the bottom again.
    h.app.resize(100, 25);
    let screen = settle(&h, h.idle());
    assert!(!screen.contains("Jump to latest"), "{screen}");

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

    // In rows shorter than the view, a jump lands at the top too.
    let h = open(turns(1), Info::default());
    settle(&h, h.dispatch("session.message.next"));
    let screen = settle(&h, h.dispatch("session.message.next"));
    assert_eq!(Nav::row(&screen, "Answer 1 one."), Some(TOP + 1), "{screen}");
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
fn a_tab_reopens_where_the_reader_left_it() {
    let h = open(turns(30), Info::default());
    let transcript = |screen: &str| -> Vec<String> { screen.lines().skip(TOP).take(17).map(str::to_owned).collect() };
    let switch = |id: &str| {
        h.tui.navigate(support::session_route(id));
        h.app.advance(Duration::from_millis(1));
    };
    for _ in 0..3 {
        h.press("pageup");
    }
    let screen = h.idle();
    let left = transcript(&screen);
    assert!(left.iter().any(|line| line.contains("Jump to latest ↓")), "{screen}");

    switch("ses_m");
    let other = h.app.wait_until(WAIT, || {
        let screen = h.app.text();
        screen.contains("Answer 30 three.") && !screen.contains("Jump to latest")
    });
    assert!(other, "{}", h.app.text());
    switch("ses_n");
    let restored = h.app.wait_until(WAIT, || transcript(&h.app.text()) == left);
    assert!(restored, "{left:#?}\n=====\n{:#?}", transcript(&h.app.text()));

    h.press("end");
    let bottom = transcript(&h.wait_for("Answer 30 three."));
    switch("ses_m");
    h.wait_for("Answer 30 three.");
    switch("ses_n");
    let found = h.app.wait_until(WAIT, || transcript(&h.app.text()) == bottom);
    assert!(found, "{bottom:#?}\n=====\n{}", h.app.text());

    h.press("ctrl+g");
    h.wait_for("┃  Question 1\n");
    let first = transcript(&h.idle());
    switch("ses_m");
    h.wait_for("Answer 30 three.");
    switch("ses_n");
    let found = h.app.wait_until(WAIT, || transcript(&h.app.text()) == first);
    assert!(found, "{first:#?}\n=====\n{}", h.app.text());
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

// ─── The window ─────────────────────────────────────────────────────────────
// A session long enough that paging through it mounts rows ahead of the view and drops them on the far side.

const LONG: u64 = 120;

/// A page is half the 15-row view: 7 or 8 rows, as the halves add up. Anything else is a jump.
fn paged(before: &str, after: &str) -> bool {
    shift(before, after).is_some_and(|moved| (7..=8).contains(&moved.abs()))
}

/// The height of the mounted rows: the transcript's scroll content, the tallest widget over its first line.
fn mounted(h: &Nav) -> f32 {
    std::iter::successors(h.app.app().widget_at(4, TOP as u16 + 1), |widget| widget.parent())
        .map(|widget| widget.rect().height)
        .fold(0.0, f32::max)
}

/// The question whose box is on the transcript's first row.
fn top_question(screen: &str) -> Option<u64> {
    screen.lines().nth(TOP + 1)?.trim_end().rsplit_once("Question ")?.1.parse().ok()
}

/// Presses `key` until the screen stops changing, and returns the last screen.
fn page_to_end(h: &Nav, key: &str) -> String {
    let mut screen = h.idle();
    for _ in 0..2000 {
        let next = h.press(key);
        if next == screen {
            return screen;
        }
        screen = next;
    }
    panic!("{key} never reached an end:\n{screen}")
}

#[test]
fn paging_away_and_back_returns_to_the_same_rows() {
    let h = open(turns(LONG), Info::default());
    for (start, away, back) in [("end", "pageup", "pagedown"), ("ctrl+g", "pagedown", "pageup")] {
        h.press(start);
        h.wait_for(if start == "end" { "Answer 120 three." } else { "┃  Question 1\n" });
        let from = h.idle();
        for pages in [1, 9, 40, 130] {
            for _ in 0..pages {
                h.press(away);
            }
            for _ in 0..pages {
                h.press(back);
            }
            let screen = h.idle();
            assert_eq!(screen, from, "{pages} × {away}, then {back}:\n{from}\n=====\n{screen}");
        }
    }
}

#[test]
fn paging_end_to_end_moves_a_page_at_a_time_over_a_bounded_window() {
    let h = open(turns(LONG), Info::default());
    h.press("ctrl+g");
    h.wait_for("┃  Question 1\n");
    let (mut widest, mut travelled) = (0.0_f32, 0);
    for (key, edge) in [("pagedown", "Answer 120 three."), ("pageup", "┃  Question 1\n")] {
        let mut before = h.idle();
        let mut jumps = Vec::new();
        for step in 0.. {
            assert!(step < 2000, "{key} never reached an end");
            let after = h.press(key);
            widest = widest.max(mounted(&h));
            if after == before {
                break;
            }
            if !paged(&before, &after) {
                jumps.push(format!("{before}\n=====\n{after}"));
            }
            travelled += 1;
            before = after;
        }
        assert!(before.contains(edge), "{key} stopped short:\n{before}");
        // The last move stops at the edge, so it may be shorter.
        assert!(jumps.len() <= 1, "{key} jumped {} times; the first:\n{}", jumps.len(), jumps[0]);
    }
    // Both ways cover the transcript twice, at 7.5 rows a page.
    let height = travelled as f32 * 7.5 / 2.0;
    assert!(widest < height / 2.0, "{widest} rows mounted at once, of about {height}");
}

#[test]
fn a_streaming_reply_keeps_the_readers_rows_and_is_followed_at_the_bottom() {
    let mut messages = turns(LONG);
    messages.push(user("msg_livea", 9_000_000, "Question live"));
    messages.push(json!({
        "id": "msg_liveb", "type": "assistant", "agent": "build",
        "model": { "providerID": "provider", "id": "model" },
        "time": { "created": 9_001_000 }, "content": [],
    }));
    let h = open_until(messages, Info::default(), "Question live", 25);
    let seq = std::cell::Cell::new(0);
    let stream = |kind: &str, data: Value| {
        seq.set(seq.get() + 1);
        let ids = json!({ "sessionID": "ses_n", "assistantMessageID": "msg_liveb", "ordinal": 0 });
        h.tui.data.apply(vec![support::event("ses_n", kind, seq.get(), support::merge(ids, data))]);
    };
    let line = |n: usize| stream("session.text.delta", json!({ "delta": format!("Streamed line {n}.\n\n") }));
    stream("session.text.started", json!({}));
    for n in 1..=5 {
        line(n);
        let screen = h.wait_for(&format!("Streamed line {n}."));
        assert!(!screen.contains("Jump to latest"), "{screen}");
    }
    // Away from the bottom, far enough that rows drop below the view, what streams moves nothing on screen.
    let mut before = h.idle();
    for n in 6..90 {
        let after = h.press("pageup");
        assert!(paged(&before, &after), "{before}\n=====\n{after}");
        line(n);
        let screen = h.idle();
        assert_eq!(screen, after, "line {n} moved the reader:\n{after}\n=====\n{screen}");
        before = after;
    }
    h.press("end");
    h.wait_for("Streamed line 89.");
    line(90);
    let screen = h.wait_for("Streamed line 90.");
    assert!(!screen.contains("Jump to latest"), "{screen}");
}

#[test]
fn jumps_land_on_their_target_wherever_the_window_is() {
    let h = open(turns(LONG), Info::default());
    // From the head, the last user message (a jump by ID) aligns with the top.
    h.press("ctrl+g");
    h.wait_for("┃  Question 1\n");
    let screen = settle(&h, h.press("alt+end"));
    assert_eq!(top_question(&screen), Some(LONG), "{screen}");
    // From the tail, Home shows the head again.
    h.press("end");
    h.wait_for("Answer 120 three.");
    h.press("ctrl+g");
    let screen = h.wait_for("┃  Question 1\n");
    assert_eq!(Nav::row(&screen, "Question 1"), Some(TOP + 2), "{screen}");
    // Far below the head, stepping by user message lands each question on top in turn, back to the first.
    for _ in 0..150 {
        h.press("pagedown");
    }
    let screen = settle(&h, h.dispatch("session.message.user.previous"));
    let mut question = top_question(&screen).unwrap_or_else(|| panic!("no question on top:\n{screen}"));
    assert!(question > 60, "{screen}");
    while question > 1 {
        let screen = settle(&h, h.dispatch("session.message.user.previous"));
        question -= 1;
        assert_eq!(top_question(&screen), Some(question), "{screen}");
    }
    for question in 2..=12 {
        let screen = settle(&h, h.dispatch("session.message.user.next"));
        assert_eq!(top_question(&screen), Some(question), "{screen}");
    }
}

#[test]
fn what_the_reader_opened_is_open_when_its_rows_come_back() {
    let mut messages = turns(LONG);
    let output: Vec<String> = (1..=20).map(|line| format!("line {line}")).collect();
    messages[1]["content"] = json!([
        {
            "type": "tool", "id": "call_missing", "name": "read",
            "state": { "status": "error", "input": { "path": "src/c.rs" }, "error": { "type": "unknown", "message": "No such file" } },
            "time": { "created": 1, "completed": 2 },
        },
        { "type": "reasoning", "text": "Weighing the parser.\n\nIt stops early.", "time": { "created": 1, "completed": 2 } },
        {
            "type": "tool", "id": "call_shell", "name": "shell",
            "state": { "status": "completed", "input": { "command": "seq 20" }, "content": [{ "type": "text", "text": output.join("\n") }] },
            "time": { "created": 1, "completed": 2 },
        },
        read("call_1a", "src/a.rs"),
        { "type": "text", "text": "Answer 1 one.\n\nAnswer 1 two.\n\nAnswer 1 three." },
    ]);
    // Groups keep their state in the session's settings; ungrouped, each row keeps its own.
    let session = Session { grouping: Some(Grouping::None), verbosity: Some(Verbosity::Medium), ..Session::default() };
    let ungrouped = Info { session: Some(session), ..Info::default() };
    let h = open_until(messages, ungrouped, "Answer 120 three.", 60);
    h.press("ctrl+g");
    let closed = h.wait_for("┃  Question 1\n");
    for (shown, opened) in [("src/c.rs", "No such file"), ("Thought", "It stops early."), ("$ seq 20", "line 1\n")] {
        h.idle();
        let (x, y) = h.find(shown);
        h.app.click(x + 1, y);
        h.wait_for(opened);
    }
    let open = h.idle();
    assert_ne!(open, closed);
    page_to_end(&h, "pagedown");
    let screen = page_to_end(&h, "pageup");
    assert_eq!(screen, open, "{open}\n=====\n{screen}");
}

#[test]
fn a_selection_keeps_its_rows_while_the_wheel_moves_away_and_back() {
    let h = open(turns(LONG), Info::default());
    h.press("ctrl+g");
    let screen = h.wait_for("┃  Question 1\n");
    let (x, from) = position(&screen, "Answer 1 one.");
    let (_, to) = position(&screen, "Answer 1 three.");
    h.app.drag((x as u16, from as u16), (x as u16 + 15, to as u16));
    let selected = h.app.app().selected_text();
    assert!(selected.as_deref().is_some_and(|text| text.contains("Answer 1 two.")), "{selected:?}");
    for down in [true, false] {
        for _ in 0..200 {
            h.app.scroll(10, 8, down);
            h.app.advance(Duration::from_millis(1));
            h.idle();
        }
        assert_eq!(h.app.app().selected_text(), selected, "after the wheel went {}", if down { "down" } else { "up" });
    }
    // Below the toast that copying on select raises.
    let rows = |screen: &str| screen.lines().skip(TOP + 3).map(str::to_owned).collect::<Vec<_>>();
    assert_eq!(rows(&h.idle()), rows(&screen));
}

/// `count` turns whose replies run `tools` rows each, longer than a chunk of the window, ungrouped.
fn long_turns(count: u64, tools: u64) -> Vec<Value> {
    (1..=count)
        .flat_map(|turn| {
            let created = turn * 10_000;
            let mut content: Vec<Value> = (0..tools)
                .map(|tool| {
                    json!({
                        "type": "tool", "id": format!("call_{turn}_{tool}"), "name": "lookup",
                        "state": { "status": "completed", "input": { "key": format!("k{turn}.{tool}") }, "content": [] },
                        "time": { "created": 1, "completed": 2 },
                    })
                })
                .collect();
            content.push(json!({ "type": "text", "text": format!("Answer {turn} one.\n\nAnswer {turn} two.\n\nAnswer {turn} three.") }));
            [
                user(&format!("msg_{turn:03}a"), created, &format!("Question {turn}")),
                assistant(&format!("msg_{turn:03}b"), created + 1000, Value::Array(content)),
            ]
        })
        .collect()
}

fn ungrouped() -> Info {
    let session = Session { grouping: Some(Grouping::None), verbosity: Some(Verbosity::Medium), ..Session::default() };
    Info { session: Some(session), ..Info::default() }
}

/// The screen without the "Jump to latest" hint, which shows once the view leaves the bottom.
fn unhinted(screen: &str) -> String {
    let lines = screen.lines().map(|line| line.replace("Jump to latest ↓", "").trim_end().to_owned());
    lines.collect::<Vec<_>>().join("\n")
}

/// Review repro (mem-scroll): stepping back by user message over replies longer than a chunk takes more than one
/// `extend`. The first one's drop below runs in the same frame as the second one's mount above, whose pin reads the
/// content height from before the drop, so for a frame or two the view shows rows that are neither where the reader
/// was nor the target. Property: from any start, each `user.previous` lands on the question before the last, and every
/// frame on the way shows the start or the target.
#[test]
fn review_user_previous_over_long_turns_holds_the_view_until_it_lands() {
    let mut failures = Vec::new();
    for pages in [0, 6, 12, 20] {
        let h = open_until(long_turns(8, 90), ungrouped(), "Answer 8 three.", 25);
        for _ in 0..pages {
            h.press("pageup");
        }
        let mut landed = Vec::new();
        for _ in 0..12 {
            let before = unhinted(&h.idle());
            h.tui.keymap.dispatch("session.message.user.previous", None);
            let mut frames = Vec::new();
            for _ in 0..40 {
                h.app.advance(Duration::from_millis(1));
                h.app.render();
                frames.push(unhinted(&h.app.text()));
            }
            let screen = unhinted(&h.idle());
            let question = top_question(&screen);
            landed.push(question);
            if let Some(stray) = frames.iter().find(|frame| **frame != before && **frame != screen) {
                failures.push(format!(
                    "{pages} pages up, user.previous to {question:?}: a frame on the way:\n{before}\n=====\n{stray}\n=====\n{screen}"
                ));
            }
            if question == Some(1) {
                break;
            }
        }
        let first = landed.first().copied().flatten().unwrap_or(0);
        let expected: Vec<Option<u64>> = (1..=first).rev().map(Some).collect();
        if landed != expected {
            failures.push(format!("{pages} pages up: user.previous landed on {landed:?}"));
        }
    }
    let heads: Vec<&str> = failures.iter().map(|failure| failure.lines().next().unwrap_or_default()).collect();
    assert!(failures.is_empty(), "{} failures:\n{}\n\nthe first:\n{}", failures.len(), heads.join("\n"), failures[0]);
}

/// Review check (mem-scroll): the wheel drops rows too (`on_mouse` → `reveal_*` → `grow`), and the only wheel test
/// holds a selection, which keeps every row. Property: without a selection, every wheel step moves the content by the
/// same distance end to end, both ways, and the way back ends on the screen it started from.
#[test]
fn review_the_wheel_moves_evenly_while_rows_drop() {
    let h = open(turns(LONG), Info::default());
    h.press("ctrl+g");
    let from = h.wait_for("┃  Question 1\n");
    let mut failures = Vec::new();
    let mut steps = 0;
    for down in [true, false] {
        let mut before = h.idle();
        for step in 0.. {
            assert!(step < 3000, "the wheel never reached an end");
            h.app.scroll(10, 8, down);
            h.app.advance(Duration::from_millis(1));
            let after = h.idle();
            if after == before {
                break;
            }
            if down {
                steps += 1;
            }
            let moved = shift(&before, &after);
            if moved.is_none_or(|moved| moved.abs() != 3) {
                let direction = if down { "down" } else { "up" };
                // The last step at each edge may be shorter; anything else is a jump.
                let edge = moved.is_some_and(|moved| moved.abs() < 3);
                failures.push((edge, format!("step {step} {direction}: moved {moved:?}\n{before}\n=====\n{after}")));
            }
            before = after;
        }
    }
    assert!(steps > 300, "{steps} wheel steps to the bottom");
    let jumps: Vec<&str> = failures.iter().filter(|(edge, _)| !edge).map(|(_, text)| text.as_str()).collect();
    assert!(
        jumps.is_empty() && failures.len() <= 2,
        "{} jumps of {} uneven steps; the first:\n{}",
        jumps.len(),
        failures.len(),
        jumps.first().copied().unwrap_or_else(|| failures[0].1.as_str())
    );
    assert_eq!(h.idle(), from);
}

/// A key that drops rows, and a resize before the frame that lays it out: the resize pins the reader's row from rects
/// the key's move and drop have not moved yet. A resize then moves the view by more than the page (as it does without
/// a drop), but never past the rows it showed: each step still overlaps the one before, and paging back returns to
/// the head. A drop the view missed would jump by its whole height. The height alternates, so no row rewraps.
#[test]
fn a_resize_in_the_frame_of_a_key_never_skips_rows() {
    let h = open(turns(LONG), Info::default());
    h.press("ctrl+g");
    let head = h.wait_for("┃  Question 1\n");
    let mut before = h.idle();
    let mut jumps = Vec::new();
    for step in 0..150 {
        h.app.press("pagedown");
        h.app.resize(80, if step % 2 == 0 { 26 } else { 25 });
        h.app.advance(Duration::from_millis(1));
        let after = h.idle();
        if shift(&before, &after).is_none_or(|moved| !(-15..0).contains(&moved)) {
            jumps.push(format!("step {step}:\n{before}\n=====\n{after}"));
        }
        before = after;
    }
    assert!(jumps.is_empty(), "{} jumps; the first:\n{}", jumps.len(), jumps[0]);
    assert!(top_question(&before).is_some_and(|question| question > 60), "{before}");
    let screen = page_to_end(&h, "pageup");
    assert_eq!(screen, head);
}

#[test]
fn freed_rows_go_back_to_the_system_once_the_reader_stops() {
    let runs = opencode_tui::features::release::runs;
    let h = open(turns(LONG), Info::default());
    h.press("ctrl+g");
    h.wait_for("┃  Question 1\n");
    let start = runs();
    page_to_end(&h, "pagedown");
    assert_eq!(runs(), start, "a release while the rows drop");
    h.app.advance(Duration::from_secs(2));
    assert_eq!(runs(), start + 1, "no release once the drops stopped");
    page_to_end(&h, "pageup");
    h.app.advance(Duration::from_secs(2));
    assert_eq!(runs(), start + 1, "a second release within 30 s of the first");
    h.app.advance(Duration::from_secs(30));
    assert_eq!(runs(), start + 2, "no release 30 s after the first");
}
