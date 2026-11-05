//! The transcript (E.6a) over a fixture server: user messages, Markdown text, reasoning, the
//! footer and token usage, windowing with backfill of older pages, and streamed deltas.

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use bytes::Bytes;
use opencode_api::client::Client;
use opencode_api::generated::{SessionID, V2Event};
use opencode_api::transport::{BoxFuture, Request, Response, Transport};
use opencode_local::cli_config::{
    Bounded, Debug, Info, Resolved, Scroll, Session, TurnTokens, Visibility,
};
use opencode_tui::{Deps, Route, Tui};
use opentui::testing::TestApp;
use serde_json::{Value, json};
use tokio::sync::Semaphore;

/// Serves sessions and their messages, newest page first, `limit` at a time, with a cursor that
/// counts the messages older than the page. Older pages wait for a permit of `gate`.
struct Fixture {
    sessions: HashMap<String, Vec<Value>>,
    gate: Arc<Semaphore>,
    older: Arc<AtomicUsize>,
}

impl Transport for Fixture {
    fn send(&self, request: Request) -> BoxFuture<'_, Result<Response, String>> {
        let path = request.url.path().to_owned();
        let query: HashMap<String, String> = request.url.query_pairs().into_owned().collect();
        Box::pin(async move {
            let parts: Vec<&str> = path
                .trim_start_matches("/api/session/")
                .split('/')
                .collect();
            let (status, body) = match (request.method, parts.as_slice()) {
                ("GET", _) if path == "/api/session" => (200, json!({ "data": [], "cursor": {} })),
                ("GET", [id]) if self.sessions.contains_key(*id) => {
                    (200, json!({ "data": session(id) }))
                }
                ("GET", [id, "message"]) if self.sessions.contains_key(*id) => {
                    let messages = &self.sessions[*id];
                    let limit: usize = query
                        .get("limit")
                        .map_or(20, |limit| limit.parse().unwrap());
                    let end = match query.get("cursor") {
                        Some(cursor) => {
                            self.older.fetch_add(1, Ordering::SeqCst);
                            self.gate.acquire().await.unwrap().forget();
                            cursor.parse().unwrap()
                        }
                        None => messages.len(),
                    };
                    let start = end.saturating_sub(limit);
                    let page: Vec<_> = messages[start..end].iter().rev().cloned().collect();
                    let next = (start > 0).then(|| start.to_string());
                    (200, json!({ "data": page, "cursor": { "next": next } }))
                }
                ("GET", [id, "permission"]) if self.sessions.contains_key(*id) => {
                    (200, json!({ "data": [] }))
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

fn session(id: &str) -> Value {
    json!({
        "id": id, "title": "Transcript", "projectID": "project", "cost": 0, "agent": "build",
        "tokens": { "input": 0, "output": 0, "reasoning": 0, "cache": { "read": 0, "write": 0 } },
        "time": { "created": 1, "updated": 1 },
        "location": { "directory": "/project" },
    })
}

fn user(id: &str, created: u64, text: &str) -> Value {
    json!({ "id": id, "type": "user", "text": text, "time": { "created": created } })
}

fn assistant(id: &str, created: u64, content: Value, done: Option<u64>) -> Value {
    let mut message = json!({
        "id": id, "type": "assistant", "agent": "build",
        "model": { "providerID": "provider", "id": "model" },
        "time": { "created": created },
        "content": content,
    });
    if let Some(completed) = done {
        message["time"]["completed"] = json!(completed);
        message["time"]["streamed"] = json!(completed - 1000);
        message["finish"] = json!("stop");
        message["tokens"] = json!({
            "input": 1200, "output": 50, "reasoning": 0, "cache": { "read": 3000, "write": 0 },
        });
    }
    message
}

struct Harness {
    app: TestApp,
    tui: std::rc::Rc<Tui>,
    gate: Arc<Semaphore>,
    older: Arc<AtomicUsize>,
}

fn open(width: u16, height: u16, id: &str, messages: Vec<Value>, info: Info) -> Harness {
    let gate = Arc::new(Semaphore::new(0));
    let older = Arc::new(AtomicUsize::new(0));
    let fixture = Fixture {
        sessions: HashMap::from([(id.to_owned(), messages)]),
        gate: gate.clone(),
        older: older.clone(),
    };
    let client = Client::with_transport("http://opencode.local", Arc::new(fixture)).unwrap();
    let app = TestApp::new(width, height);
    let tui = opencode_tui::mount(
        &app,
        Deps {
            client,
            directory: "/project".into(),
            config: Resolved::new(info, |_| None),
            roots: None,
            route: Route::Session {
                id: SessionID(id.into()),
            },
            continue_: false,
            events: false,
        },
    );
    Harness {
        app,
        tui,
        gate,
        older,
    }
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

    fn apply(&self, event: Value) {
        let event: V2Event = serde_json::from_value(event).unwrap();
        self.tui.data.apply(&[event]);
    }

    /// One wheel step up over the transcript, then the follow-up the transcript schedules.
    fn scroll_up(&self) -> String {
        self.app.scroll(10, 5, false);
        self.app.advance(Duration::from_millis(1));
        self.app.text()
    }
}

fn event(kind: &str, seq: u64, data: Value) -> Value {
    json!({
        "id": format!("evt_{seq}"), "created": 10_000 + seq, "type": kind,
        "durable": { "aggregateID": "ses_s", "seq": seq, "version": 1 },
        "data": data,
    })
}

#[test]
fn user_markdown_reasoning_and_footer_render_as_the_typescript_rows() {
    let messages = vec![
        json!({
            "id": "msg_1", "type": "user", "text": "Why does the parser fail?",
            "time": { "created": 1000 },
            "files": [{ "data": "", "mime": "text/plain", "name": "parser.rs", "source": { "type": "inline" } }],
            "skills": [{ "id": "skl_1", "name": "rust" }],
        }),
        assistant(
            "msg_2",
            1500,
            json!([
                { "type": "reasoning", "text": "**Reading the parser**\n\nThe loop stops early.",
                  "time": { "created": 1500, "completed": 3000 } },
                { "type": "text", "text": "The parser drops the **last** token in `next()`." },
            ]),
            Some(4000),
        ),
    ];
    let info = Info {
        debug: Some(Debug {
            turn_tokens: Some(TurnTokens::Enabled(true)),
            ..Debug::default()
        }),
        ..Info::default()
    };
    let h = open(80, 30, "ses_r", messages, info);
    let screen = h.wait_for("The parser drops");

    // The user message on its raised surface, behind the agent bar, with its chips.
    assert!(screen.contains("┃  Why does the parser fail?"), "{screen}");
    assert!(screen.contains("┃   skill  rust\n"), "{screen}");
    assert!(screen.contains("┃   file  parser.rs\n"), "{screen}");
    // Markdown with its markers concealed, padded 3 from the left.
    assert!(
        screen.contains("     The parser drops the last token in next()."),
        "{screen}"
    );
    // `session.thinking` defaults to hide: one collapsed header with the summary title.
    assert!(
        screen.contains("+ Thought: Reading the parser · 1.5s"),
        "{screen}"
    );
    assert!(!screen.contains("The loop stops early."), "{screen}");
    // The footer: agent, model, the turn's duration since the prompt, and tokens per second
    // over the step's streaming time (50 tokens in 1.5 s).
    assert!(
        screen.contains("Build · provider/model · 3.0s · 33.3 tok/s"),
        "{screen}"
    );
    // `debug.turn_tokens`: the turn's usage summary.
    assert!(
        screen.contains("+ Tokens: 1 step · latest: 1,250 new · 3,000 cached · 4,250 total"),
        "{screen}"
    );
    // Rows keep the TS order.
    let order = [
        "Why does the parser fail?",
        "Thought",
        "The parser drops",
        "Build ·",
        "Tokens",
    ];
    let positions: Vec<_> = order
        .iter()
        .map(|text| screen.find(text).unwrap())
        .collect();
    assert!(positions.is_sorted(), "{screen}");

    // A click opens the reasoning block; the body shows behind its bar.
    let row = screen
        .lines()
        .position(|line| line.contains("+ Thought"))
        .unwrap();
    h.app.click(8, row as u16);
    let expanded = h.wait_for("The loop stops early.");
    // Open, the group header drops the title (`group-view.tsx:186`).
    assert!(expanded.contains("- Thought · 1.5s"), "{expanded}");

    // `session.toggle.thinking` shows every block open.
    let shown = Info {
        session: Some(Session {
            thinking: Some(Visibility::Show),
            ..Session::default()
        }),
        ..Info::default()
    };
    let messages = vec![assistant(
        "msg_2",
        1500,
        json!([{ "type": "reasoning", "text": "Plan the fix.", "time": { "created": 1500, "completed": 3000 } }]),
        Some(4000),
    )];
    let h = open(80, 20, "ses_r", messages, shown);
    let screen = h.wait_for("Plan the fix.");
    assert!(screen.contains("┃ Thought: 1.5s"), "{screen}");
    assert!(screen.contains("┃ Plan the fix."), "{screen}");
}

/// A settings change reaches the rows at once, as TS's reactive config does: thinking opens and the
/// tokens-per-second footer goes, then `session.toggle.thinking` writes the config back.
#[test]
fn config_changes_reach_the_transcript_without_a_restart() {
    let messages = vec![assistant(
        "msg_2",
        1500,
        json!([{ "type": "reasoning", "text": "Plan the fix.", "time": { "created": 1500, "completed": 3000 } }]),
        Some(4000),
    )];
    let h = open(80, 20, "ses_r", messages, Info::default());
    let screen = h.wait_for("+ Thought");
    assert!(!screen.contains("Plan the fix."), "{screen}");
    assert!(screen.contains("tok/s"), "{screen}");
    opencode_tui::dialogs::settings::update(&h.tui, |draft| {
        opencode_tui::dialogs::settings::set_path(draft, &["session", "thinking"], json!("show"));
        opencode_tui::dialogs::settings::set_path(draft, &["session", "tps"], json!(false));
    });
    let screen = h.wait_for("Plan the fix.");
    assert!(!screen.contains("tok/s"), "{screen}");

    h.tui.keymap.dispatch("session.toggle.thinking", None);
    assert!(
        h.app.wait_until(Duration::from_secs(5), || !h
            .app
            .text()
            .contains("Plan the fix.")),
        "{}",
        h.app.text()
    );
    assert_eq!(
        h.tui
            .settings
            .info()
            .session
            .and_then(|session| session.thinking),
        Some(Visibility::Hide)
    );
}

#[test]
fn a_streamed_reply_updates_in_place_and_gains_its_footer() {
    let messages = vec![
        user("msg_1", 1000, "Summarize the plan"),
        assistant(
            "msg_2",
            2000,
            json!([{ "type": "reasoning", "text": "Thinking it over", "time": { "created": 2000 } }]),
            None,
        ),
    ];
    let h = open(80, 20, "ses_s", messages, Info::default());
    let screen = h.wait_for("Thinking");
    // Reasoning that is not done shows the spinner's label.
    assert!(screen.contains("Thinking"), "{screen}");

    // Text streams into a new row, delta by delta.
    h.apply(event(
        "session.text.started",
        1,
        json!({ "sessionID": "ses_s", "assistantMessageID": "msg_2", "ordinal": 0 }),
    ));
    for (seq, delta) in [(2, "The plan has "), (3, "**two** steps.")] {
        h.apply(event(
            "session.text.delta",
            seq,
            json!({ "sessionID": "ses_s", "assistantMessageID": "msg_2", "ordinal": 0, "delta": delta }),
        ));
    }
    let screen = h.wait_for("The plan has two steps.");
    assert!(
        !screen.contains("Build ·"),
        "no footer while streaming:\n{screen}"
    );

    // The step ends: the message completes, the reasoning is done, and the footer shows.
    h.apply(event(
        "session.step.ended",
        4,
        json!({
            "sessionID": "ses_s", "assistantMessageID": "msg_2", "finish": "stop", "cost": 0,
            "tokens": { "input": 10, "output": 20, "reasoning": 0, "cache": { "read": 0, "write": 0 } },
        }),
    ));
    let screen = h.wait_for("Build ·");
    assert!(screen.contains("Build · provider/model · 9.0s"), "{screen}");
    // The group's duration counts finished parts only, so this part adds none.
    assert!(
        screen.lines().any(|line| line.trim() == "+ Thought"),
        "{screen}"
    );
    assert!(screen.contains("The plan has two steps."), "{screen}");
}

/// 50 turns of 6 rows each; the first page (20 messages) is 60 rows, 40 of them mounted.
fn long_session() -> Harness {
    let messages: Vec<Value> = (1..=50)
        .flat_map(|turn| {
            let created = turn * 10_000;
            [
                user(&format!("msg_{turn:03}a"), created, &format!("Question {turn}")),
                assistant(
                    &format!("msg_{turn:03}b"),
                    created + 1000,
                    json!([
                        { "type": "reasoning", "text": format!("Reasoning {turn}"), "time": { "created": created + 1000, "completed": created + 2000 } },
                        { "type": "text", "text": format!("Answer {turn} part 1") },
                        { "type": "text", "text": format!("Answer {turn} part 2") },
                        { "type": "text", "text": format!("Answer {turn} part 3") },
                    ]),
                    Some(created + 3000),
                ),
            ]
        })
        .collect();
    // One row per wheel step, so each step's top line can be followed (TS scrolls 3 by default).
    let info = Info {
        scroll: Some(Scroll {
            speed: Some(Bounded(1.0)),
            ..Scroll::default()
        }),
        ..Info::default()
    };
    open(80, 20, "ses_w", messages, info)
}

/// Scrolls up one wheel step at a time until `turn`'s question shows. Every step keeps the
/// reader's line on screen while older rows mount above it, and each older page shows the
/// history hint until it lands. Returns the last screen.
fn scroll_up_to(h: &Harness, turn: u32) -> String {
    let screen = h.wait_for("Answer 50 part 3");
    assert!(
        !screen.contains("Question 50"),
        "only the tail is on screen:\n{screen}"
    );
    let target = format!("┃  Question {turn}");
    let unique = |screen: &str| {
        screen
            .lines()
            .find(|line| line.contains("Question") || line.contains("Answer"))
            .map(str::trim)
            .map(str::to_owned)
    };
    let hint = "Loading session history…";
    let mut previous = screen;
    let mut history = Vec::new();
    let mut gated = false;
    for _ in 0..3000 {
        let mut screen = h.scroll_up();
        if screen.contains(hint) {
            // The first older page waits at the gate, so the hint shows until it lands.
            if !gated {
                gated = true;
                h.gate.add_permits(100);
            }
            assert!(
                h.app
                    .wait_until(Duration::from_secs(5), || !h.app.text().contains(hint)),
                "the page never landed"
            );
            screen = h.app.text();
        }
        if let Some(line) = unique(&previous) {
            assert!(
                screen.contains(&line),
                "the view jumped: {line:?} left the screen\nbefore:\n{previous}\nafter:\n{screen}"
            );
        }
        if screen != previous {
            history.push(screen.clone());
        }
        previous = screen;
        if previous.lines().any(|line| line.trim() == target) {
            break;
        }
    }
    assert!(
        previous.lines().any(|line| line.trim() == target),
        "{target:?} never showed after {} older reads; the last screens:\n{}",
        h.older.load(Ordering::SeqCst),
        history[history.len().saturating_sub(4)..].join("\n=====\n")
    );
    assert!(gated, "the history hint never showed");
    assert!(!previous.contains(hint), "{previous}");
    previous
}

#[test]
fn the_tail_mounts_first_and_older_pages_load_near_the_top() {
    let h = long_session();
    scroll_up_to(&h, 1);
    // The first page plus four older ones.
    assert_eq!(h.older.load(Ordering::SeqCst), 4);
}

/// The timestamps of a recorded reply ("Debugging concurrent speaker mute issue"): one prompt, then 21 steps
/// (created, streamed, completed) over 24 minutes. The first page of 20 messages starts inside the turn's
/// exploration group, so TS loads the next page (`completeGroupBoundary`) and its footer measures from the
/// prompt, not from the last step.
#[test]
fn the_footer_spans_a_turn_whose_prompt_is_on_an_older_page() {
    const PROMPT: u64 = 1_787_836_326_838;
    const STEPS: [(u64, u64, u64); 21] = [
        (1_787_836_331_139, 1_787_836_333_383, 1_787_836_333_451),
        (1_787_836_335_619, 1_787_836_345_509, 1_787_836_345_807),
        (1_787_836_348_535, 1_787_836_363_359, 1_787_836_363_524),
        (1_787_836_367_308, 1_787_836_377_226, 1_787_836_377_388),
        (1_787_836_380_215, 1_787_836_395_366, 1_787_836_395_545),
        (1_787_836_399_666, 1_787_836_408_893, 1_787_836_439_344),
        (1_787_836_441_786, 1_787_836_449_866, 1_787_836_450_090),
        (1_787_836_452_390, 1_787_836_472_791, 1_787_836_473_342),
        (1_787_836_474_857, 1_787_836_483_625, 1_787_837_656_785),
        (1_787_837_658_445, 1_787_837_665_255, 1_787_837_665_440),
        (1_787_837_669_331, 1_787_837_684_930, 1_787_837_685_134),
        (1_787_837_687_891, 1_787_837_694_511, 1_787_837_694_728),
        (1_787_837_696_321, 1_787_837_701_053, 1_787_837_701_127),
        (1_787_837_703_042, 1_787_837_705_660, 1_787_837_705_686),
        (1_787_837_707_749, 1_787_837_717_980, 1_787_837_718_048),
        (1_787_837_719_638, 1_787_837_725_356, 1_787_837_725_508),
        (1_787_837_729_516, 1_787_837_737_857, 1_787_837_737_942),
        (1_787_837_741_970, 1_787_837_746_446, 1_787_837_747_502),
        (1_787_837_750_419, 1_787_837_757_200, 1_787_837_757_294),
        (1_787_837_760_314, 1_787_837_768_984, 1_787_837_769_046),
        (1_787_837_771_391, 1_787_837_777_069, 1_787_837_777_107),
    ];
    let last = STEPS.len() - 1;
    let messages: Vec<Value> = std::iter::once(user("msg_00", PROMPT, "Why are both speakers muted?"))
        .chain(STEPS.iter().enumerate().map(|(index, (created, streamed, completed))| {
            let content = if index == last {
                json!([{ "type": "text", "text": "Both streams play again." }])
            } else {
                json!([{
                    "type": "tool", "id": format!("call_{index}"), "name": "read",
                    "state": { "status": "completed", "input": { "path": format!("src/{index}.rs") }, "content": [] },
                    "time": { "created": created, "completed": streamed },
                }])
            };
            json!({
                "id": format!("msg_{:02}", index + 1), "type": "assistant", "agent": "build",
                "model": { "providerID": "provider", "id": "model" },
                "time": { "created": created, "streamed": streamed, "completed": completed },
                "finish": if index == last { "stop" } else { "tool-calls" },
                "tokens": { "input": 1200, "output": 50, "reasoning": 0, "cache": { "read": 0, "write": 0 } },
                "content": content,
            })
        }))
        .collect();
    let h = open(100, 30, "ses_t", messages, Info::default());
    h.gate.add_permits(10);
    // 1,450,269 ms from the prompt; the last step alone took 5.7s.
    let screen = h.wait_for("Build · provider/model · 24m 10s");
    assert!(!screen.contains("5.7s"), "{screen}");
    assert_eq!(h.older.load(Ordering::SeqCst), 1);
}

/// The built-in `opencode.latex` plugin (P.2) draws `latex` fences in assistant text as Unicode math.
#[test]
fn mermaid_fences_render_as_diagrams() {
    let text = "The flow:\n\n```mermaid\nflowchart LR\n  A[Idea] --> B[Parse]\n```";
    let messages = vec![
        user("msg_1", 1000, "Draw it"),
        assistant(
            "msg_2",
            1500,
            json!([{ "type": "text", "text": text }]),
            Some(4000),
        ),
    ];
    let h = open(60, 20, "ses_m", messages, Info::default());
    let screen = h.wait_for("│ Idea ├───▶│ Parse │");
    assert!(!screen.contains("flowchart LR"), "{screen}");
}

#[test]
fn latex_fences_render_as_math() {
    let text = "The roots:\n\n```latex\nx = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}\n```";
    let messages = vec![
        user("msg_1", 1000, "Solve it"),
        assistant(
            "msg_2",
            1500,
            json!([{ "type": "text", "text": text }]),
            Some(4000),
        ),
    ];
    let h = open(60, 20, "ses_l", messages, Info::default());
    let screen = h.wait_for("╰╯b² - 4ac");
    assert!(!screen.contains("\\frac"), "{screen}");
    let rule = screen
        .lines()
        .position(|line| line.contains("─────────────"))
        .unwrap();
    assert!(
        screen.lines().nth(rule).unwrap().contains("x ="),
        "{screen}"
    );
}
