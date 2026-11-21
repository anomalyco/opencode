use crate::support::{self, Harness, WAIT, deref_harness, user};

use std::collections::HashMap;
use std::rc::Rc;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use opencode_api::generated::V2Event;
use opencode_api::transport::{BoxFuture, Request, Response, Transport};
use opencode_local::cli_config::{Bounded, Debug, Info, Markdown, Scroll, Session, TurnTokens, Verbosity, Visibility};
use opencode_tui::Deps;
use opentui::widget::Widget;
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
            let parts: Vec<&str> = path.trim_start_matches("/api/session/").split('/').collect();
            let (status, body) = match (request.method, parts.as_slice()) {
                ("GET", _) if path == "/api/session" => (200, json!({ "data": [], "cursor": {} })),
                ("GET", [id]) if self.sessions.contains_key(*id) => (200, json!({ "data": session(id) })),
                ("GET", [id, "message"]) if self.sessions.contains_key(*id) => {
                    let messages = &self.sessions[*id];
                    let limit: usize = query.get("limit").map_or(20, |limit| limit.parse().unwrap());
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
                ("GET", [id, "permission"]) if self.sessions.contains_key(*id) => (200, json!({ "data": [] })),
                _ => support::not_found(),
            };
            Ok(support::respond(status, &body))
        })
    }
}

fn session(id: &str) -> Value {
    support::merge(support::session(id, "Transcript"), json!({ "agent": "build" }))
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

struct View {
    harness: Harness,
    gate: Arc<Semaphore>,
    older: Arc<AtomicUsize>,
}

deref_harness!(View);

fn open(width: u16, height: u16, id: &str, messages: Vec<Value>, info: Info) -> View {
    let gate = Arc::new(Semaphore::new(0));
    let older = Arc::new(AtomicUsize::new(0));
    let fixture =
        Fixture { sessions: HashMap::from([(id.to_owned(), messages)]), gate: gate.clone(), older: older.clone() };
    let mut deps =
        Deps { config: support::config(info), route: support::session_route(id), ..support::deps(Arc::new(fixture)) };
    if PLUGGED.with(std::cell::Cell::get) {
        deps.builtins.push(opencode_plugin::abi::Plugin { id: "test.minimap", setup: minimap }.into());
    }
    View { harness: support::mount(width, height, deps), gate, older }
}

impl View {
    fn apply(&self, event: Value) {
        let event: V2Event = serde_json::from_value(event).unwrap();
        self.tui.data.apply(&[event]);
    }

    fn scroll_up(&self) -> String {
        self.app.scroll(10, 5, false);
        self.app.advance(Duration::from_millis(1));
        self.app.text()
    }
}

fn medium() -> Session {
    Session { verbosity: Some(Verbosity::Medium), ..Session::default() }
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
        debug: Some(Debug { turn_tokens: Some(TurnTokens::Enabled(true)), ..Debug::default() }),
        ..Info::default()
    };
    let h = open(80, 30, "ses_r", messages, Info { session: Some(medium()), ..info });
    let screen = h.wait_for("The parser drops");

    assert!(screen.contains("┃  Why does the parser fail?"), "{screen}");
    assert!(screen.contains("┃   skill  rust\n"), "{screen}");
    assert!(screen.contains("┃   file  parser.rs\n"), "{screen}");
    assert!(screen.contains("     The parser drops the last token in next()."), "{screen}");
    assert!(screen.contains("+ Thought: Reading the parser · 1.5s"), "{screen}");
    assert!(!screen.contains("The loop stops early."), "{screen}");
    assert!(screen.contains("Build · provider/model · 3.0s · 33.3 tok/s"), "{screen}");
    assert!(screen.contains("+ Tokens: 1 step · latest: 1,250 new · 3,000 cached · 4,250 total"), "{screen}");
    let order = ["Why does the parser fail?", "Thought", "The parser drops", "Build ·", "Tokens"];
    let positions: Vec<_> = order.iter().map(|text| screen.find(text).unwrap()).collect();
    assert!(positions.is_sorted(), "{screen}");

    let row = screen.lines().position(|line| line.contains("+ Thought")).unwrap();
    h.app.click(8, row as u16);
    let expanded = h.wait_for("The loop stops early.");
    assert!(expanded.contains("- Thought · 1.5s"), "{expanded}");

    let shown = Info { session: Some(Session { thinking: Some(Visibility::Show), ..medium() }), ..Info::default() };
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

#[test]
fn config_changes_reach_the_transcript_without_a_restart() {
    let messages = vec![assistant(
        "msg_2",
        1500,
        json!([{ "type": "reasoning", "text": "Plan the fix.", "time": { "created": 1500, "completed": 3000 } }]),
        Some(4000),
    )];
    let h = open(80, 20, "ses_r", messages, Info { session: Some(medium()), ..Info::default() });
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
    assert!(h.app.wait_until(WAIT, || !h.app.text().contains("Plan the fix.")), "{}", h.app.text());
    assert_eq!(h.tui.settings.info().session.and_then(|session| session.thinking), Some(Visibility::Hide));
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
    let h = open(80, 20, "ses_s", messages, Info { session: Some(medium()), ..Info::default() });
    let screen = h.wait_for("Thinking");
    assert!(screen.contains("Thinking"), "{screen}");

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
    assert!(!screen.contains("Build ·"), "no footer while streaming:\n{screen}");

    // The final text does not extend what streamed, so it replaces it.
    h.apply(event(
        "session.text.ended",
        4,
        json!({ "sessionID": "ses_s", "assistantMessageID": "msg_2", "ordinal": 0, "text": "The plan has three steps." }),
    ));
    let screen = h.wait_for("The plan has three steps.");
    assert!(!screen.contains("two steps"), "{screen}");

    h.apply(event(
        "session.step.ended",
        5,
        json!({
            "sessionID": "ses_s", "assistantMessageID": "msg_2", "finish": "stop", "cost": 0,
            "tokens": { "input": 10, "output": 20, "reasoning": 0, "cache": { "read": 0, "write": 0 } },
        }),
    ));
    let screen = h.wait_for("Build ·");
    assert!(screen.contains("Build · provider/model · 9.0s"), "{screen}");
    // The group's duration counts finished parts only, so this part adds none.
    assert!(screen.lines().any(|line| line.trim() == "+ Thought"), "{screen}");
    assert!(screen.contains("The plan has three steps."), "{screen}");
}

/// 50 turns of 6 rows each; the first page (20 messages) is 60 rows, 40 of them mounted.
fn long_session() -> View {
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
    // Use single-row wheel steps so every viewport movement is observable.
    let info = Info { scroll: Some(Scroll { speed: Some(Bounded(1.0)), ..Scroll::default() }), ..Info::default() };
    open(80, 20, "ses_w", messages, info)
}

thread_local! {
    static SEEN: std::cell::RefCell<Vec<opencode_plugin::abi::v2::TranscriptView>> = const {
        std::cell::RefCell::new(Vec::new())
    };
    static PLUGGED: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
    static MAPPED: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
    static TOLD: std::cell::RefCell<Vec<opencode_plugin::abi::v2::TranscriptView>> = const {
        std::cell::RefCell::new(Vec::new())
    };
}

fn minimap(setup: &mut opencode_plugin::abi::Setup) -> Result<(), String> {
    use opencode_plugin::abi::{Command, v2};
    setup.command(Command::new("mini.read"), |host, _| {
        SEEN.with(|seen| seen.borrow_mut().extend(host.transcript()));
    });
    setup.command(Command::new("mini.top"), |host, _| {
        host.scroll(v2::Target::Transcript, v2::Scroll::Edge { edge: v2::Edge::Top });
    });
    setup.command(Command::new("mini.up"), |host, _| {
        host.scroll(v2::Target::Transcript, v2::Scroll::By { rows: -5 });
    });
    if MAPPED.with(std::cell::Cell::get) {
        let map = v2::Surface::new("map", v2::Place::Slot(opencode_plugin::abi::Placement::append("app")), |_| {
            v2::Node::text(Vec::new())
        });
        setup.surface(map.layout(vec![v2::Notify::Transcript], |geometry| {
            TOLD.with(|told| told.borrow_mut().extend(geometry.transcript.clone()));
            v2::LayoutReply::default()
        }));
    }
    Ok(())
}

fn mapped(mapped: bool) -> View {
    PLUGGED.with(|plugged| plugged.set(true));
    MAPPED.with(|cell| cell.set(mapped));
    TOLD.with(|told| told.borrow_mut().clear());
    let h = long_session();
    h.wait_for("Answer 50 part 3");
    h.app.render();
    h
}

fn mini(h: &View, command: &str) -> String {
    let _ = h.tui.keymap.dispatch(command, None);
    h.app.advance(Duration::from_millis(1));
    h.app.render().text()
}

#[test]
fn a_plugins_move_shows_the_way_back_to_the_latest() {
    let h = mapped(false);
    let screen = mini(&h, "mini.up");
    assert!(screen.contains("Jump to latest"), "{screen}");
}

#[test]
fn a_plugins_jump_to_the_top_backfills_each_time() {
    let h = mapped(false);
    let read = |h: &View| {
        let _ = h.tui.keymap.dispatch("mini.read", None);
        h.app.advance(Duration::from_millis(1));
        let above = SEEN.with(|seen| seen.borrow().last().map(|view| view.above)).expect("the transcript is published");
        (above, h.older.load(Ordering::SeqCst))
    };
    mini(&h, "mini.top");
    let first = read(&h);
    mini(&h, "mini.top");
    let second = read(&h);
    let asked = || h.older.load(Ordering::SeqCst) > first.1;
    assert!(
        second.0 < first.0 || h.app.wait_until(WAIT, asked),
        "the second jump revealed nothing: {first:?}, {second:?}"
    );
}

#[test]
fn a_pointer_over_the_transcript_runs_no_behaviors() {
    let h = mapped(true);
    let before = opencode_plugin::behave::counts();
    for x in 5..15 {
        h.app.hover(x, 5);
    }
    h.app.render();
    assert_eq!(opencode_plugin::behave::counts().since(before).arms, 0);
}

#[test]
fn a_subscriber_hears_a_plugins_move_in_its_frame() {
    let h = mapped(true);
    mini(&h, "mini.up");
    let _ = h.tui.keymap.dispatch("mini.read", None);
    h.app.advance(Duration::from_millis(1));
    let offset = SEEN.with(|seen| seen.borrow().last().map(|view| view.offset));
    let told = TOLD.with(|told| told.borrow().last().map(|view| view.offset));
    assert_eq!(told, offset);
}

#[test]
fn a_plugin_moves_the_transcript_through_its_own_scroll_path() {
    PLUGGED.with(|plugged| plugged.set(true));
    let h = long_session();
    h.wait_for("Answer 50 part 3");
    let read = |h: &View| {
        let _ = h.tui.keymap.dispatch("mini.read", None);
        h.app.advance(Duration::from_millis(1));
        SEEN.with(|seen| seen.borrow().last().cloned()).expect("the transcript is published")
    };
    let before = read(&h);
    assert!(before.offset > 0 && !before.rows.is_empty() && before.above > 0, "{before:?}");
    assert!(before.rows.iter().any(|row| row.kind == "user"), "{before:?}");
    let _ = h.tui.keymap.dispatch("mini.top", None);
    h.app.advance(Duration::from_millis(1));
    h.app.render();
    let after = read(&h);
    assert!(
        after.above < before.above || h.older.load(Ordering::SeqCst) > 0,
        "the jump revealed nothing: {} above before, {} after",
        before.above,
        after.above
    );
}

/// Ten turns whose replies wrap at every width, all on the first page, one row per wheel step.
fn wrapping_session() -> View {
    let filler = "the quick brown fox jumps over the lazy dog ".repeat(5);
    let messages: Vec<Value> = (1..=10)
        .flat_map(|turn| {
            let created = turn * 10_000;
            let text = format!("Paragraph {turn} {filler}");
            [
                user(&format!("msg_{turn:03}a"), created, &format!("Question {turn}")),
                assistant(
                    &format!("msg_{turn:03}b"),
                    created + 1000,
                    json!([{ "type": "text", "text": text }]),
                    Some(created + 3000),
                ),
            ]
        })
        .collect();
    let info = Info { scroll: Some(Scroll { speed: Some(Bounded(1.0)), ..Scroll::default() }), ..Info::default() };
    open(80, 20, "ses_z", messages, info)
}

/// The line under the session's title, which is the transcript's top row.
fn top_line(screen: &str) -> String {
    screen.lines().nth(1).unwrap_or_default().trim().to_owned()
}

/// A resize narrower and wider rewraps every row, above the reader's too, and keeps the row at the top of the view
/// there.
#[test]
fn a_resize_keeps_the_readers_row_at_the_top() {
    let h = wrapping_session();
    h.wait_for("Paragraph 10");
    for _ in 0..30 {
        h.scroll_up();
    }
    // Up to a reply's first line, so the row's top is the view's top.
    for _ in 0..20 {
        if top_line(&h.app.text()).starts_with("Paragraph") {
            break;
        }
        h.scroll_up();
    }
    let top = top_line(&h.app.text());
    assert!(top.starts_with("Paragraph"), "{}", h.app.text());
    let paragraph: String = top.split_whitespace().take(2).collect::<Vec<_>>().join(" ");
    // The resize's own frame and the rebuild's after it.
    for width in [50, 120, 80] {
        h.app.resize(width, 20);
        for frame in [h.app.render().text(), h.app.render().text()] {
            let held = top_line(&frame).starts_with(&format!("{paragraph} "));
            assert!(held, "{width} columns, {paragraph:?} left the top:\n{frame}");
        }
    }
}

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

#[test]
fn the_footer_measures_throughput_from_the_first_token() {
    for (first, second, streamed, rate) in
        [(Some(8_000), Some(25_000), 28_000, "13.0"), (None, Some(25_000), 28_000, "9.3"), (None, None, 30_000, "6.5")]
    {
        let mut step = assistant("msg_2", 6_000, json!([{ "type": "text", "text": "First step" }]), Some(20_000));
        step["finish"] = json!("tool-calls");
        step["time"]["firstToken"] = json!(first);
        step["time"]["streamed"] = json!(10_000);
        step["tokens"]["output"] = json!(20);
        step["tokens"]["reasoning"] = json!(5);
        let mut reply = assistant("msg_3", 24_000, json!([{ "type": "text", "text": "Final answer" }]), Some(31_000));
        reply["time"]["firstToken"] = json!(second);
        reply["time"]["streamed"] = json!(streamed);
        reply["tokens"]["output"] = json!(30);
        reply["tokens"]["reasoning"] = json!(10);
        let messages = vec![user("msg_1", 1_000, "Current input"), step, reply];
        let h = open(80, 20, "ses_f", messages, Info { session: Some(medium()), ..Info::default() });
        let screen = h.wait_for(&format!("{rate} tok/s"));
        assert!(!screen.contains("ttft"), "{screen}");
    }
}

#[test]
fn mermaid_fences_render_as_diagrams() {
    let text = "The flow:\n\n```mermaid\nflowchart LR\n  A[Idea] --> B[Parse]\n```";
    let messages = vec![
        user("msg_1", 1000, "Draw it"),
        assistant("msg_2", 1500, json!([{ "type": "text", "text": text }]), Some(4000)),
    ];
    let h = open(60, 20, "ses_m", messages, Info::default());
    let screen = h.wait_for("│ Idea ├───▶│ Parse │");
    assert!(!screen.contains("flowchart LR"), "{screen}");
}

#[test]
fn a_theme_switch_restyles_the_transcript_in_place() {
    let text = "The fix:\n\n```rust\nfn main() {\n    let x = \"value\"; // note\n}\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```mermaid\nflowchart LR\n  A[Idea] --> B[Parse]\n```\n\nDone.";
    let messages = || {
        vec![
            user("msg_1", 1000, "Fix it"),
            assistant(
                "msg_2",
                1500,
                json!([
                    { "type": "reasoning", "text": "Check the `main` body.\n\n```rust\nlet y = 1;\n```",
                      "time": { "created": 1500, "completed": 3000 } },
                    { "type": "text", "text": text },
                ]),
                Some(4000),
            ),
            user("msg_3", 5000, "And the script?"),
            assistant(
                "msg_4",
                5500,
                json!([{ "type": "text", "text": "```python\ndef run():\n    return 1  # one\n```" }]),
                Some(8000),
            ),
        ]
    };
    let info = |theme: &str| Info {
        session: Some(Session { thinking: Some(Visibility::Show), ..medium() }),
        theme: support::decode(&format!(r#"{{ "theme": {{ "name": "{theme}", "mode": "dark" }} }}"#)).theme,
        ..support::still()
    };
    let h = open(70, 60, "ses_t", messages(), info("opencode"));
    h.wait_for_all(&["return 1", "│ Idea ├───▶│ Parse │", "let y = 1;"]);
    let fence = Rc::new(());
    support::mark_at(&h.app, "fn main()", 1, &fence);
    let script = Rc::new(());
    support::mark_at(&h.app, "def run()", 1, &script);

    assert!(h.tui.theme.borrow_mut().set("tokyonight"));
    h.tui.theme_changed();
    let switched = h.app.render();
    assert_eq!(Rc::strong_count(&fence), 2, "the Rust fence was built again");
    assert_eq!(Rc::strong_count(&script), 2, "the Python fence was built again");

    let fresh = open(70, 60, "ses_t", messages(), info("tokyonight"));
    fresh.wait_for_all(&["return 1", "│ Idea ├───▶│ Parse │", "let y = 1;"]);
    let expected = fresh.app.render();
    let diff = (0..switched.height)
        .flat_map(|y| (0..switched.width).map(move |x| (x, y)))
        .find(|&(x, y)| switched.cell(x, y) != expected.cell(x, y));
    assert_eq!(diff.map(|(x, y)| (x, y, switched.cell(x, y), expected.cell(x, y))), None, "{}", switched.text());
}

#[test]
fn a_theme_switch_builds_no_fence_or_diff_again() {
    let fence = |language: &str, line: &str| format!("```{language}\n{}```\n", format!("{line}\n").repeat(15));
    let reply = |fences: bool| {
        let code = [fence("rust", "let x = parse(\"a\", 1); // b"), fence("python", "total += f(1)  # n")];
        if fences { format!("Reply.\n\n{}\n{}\n{}", code[0], code[1], code[0]) } else { "Reply.".to_owned() }
    };
    let edit = |index: usize| {
        let lines: String =
            (0..15).map(|line| format!("-    let a{line} = {line};\n+    let b{line} = {line};\n")).collect();
        json!([{
            "type": "tool", "id": format!("call_{index}"), "name": "edit", "time": { "created": 1, "completed": 2 },
            "state": {
                "status": "completed", "input": { "path": format!("/project/src/m{index}.rs") },
                "content": [{ "type": "text", "text": "Edited" }],
                "metadata": { "files": [{
                    "file": format!("src/m{index}.rs"), "filePath": format!("/project/src/m{index}.rs"), "type": "update",
                    "patch": format!("--- src/m{index}.rs\n+++ src/m{index}.rs\n@@ -1,16 +1,16 @@\n fn main() {{\n{lines}"),
                    "additions": 15, "deletions": 15,
                }] },
            },
        }])
    };
    let created = |replies: usize, content: &dyn Fn(usize) -> Value| {
        let messages = (0..replies as u64)
            .flat_map(|index| {
                let id = |suffix: &str| format!("msg_{index:03}{suffix}");
                let at = 1000 + index * 10_000;
                [user(&id("a"), at, "Go"), assistant(&id("b"), at + 100, content(index as usize), Some(at + 5000))]
            })
            .collect();
        let h = open(120, 200, "ses_w", messages, support::still());
        h.wait_for("Reply.");
        h.app.render();
        let first = opentui::widget::View::new(&h.app).id();
        assert!(h.tui.theme.borrow_mut().set("tokyonight"));
        h.tui.theme_changed();
        h.app.render();
        opentui::widget::View::new(&h.app).id() - first
    };
    let text = |fences: bool| move |_: usize| json!([{ "type": "text", "text": reply(fences) }]);
    let with_edit = |index: usize| {
        let mut content = edit(index);
        content.as_array_mut().unwrap().insert(0, json!({ "type": "text", "text": "Reply." }));
        content
    };
    let counts = [created(12, &text(false)), created(1, &text(true)), created(12, &text(true))];
    assert_eq!(counts, [counts[0]; 3], "widgets per switch at 0, 3 and 36 fences");
    let counts = [created(1, &with_edit), created(12, &with_edit)];
    assert_eq!(counts, [counts[0]; 2], "widgets per switch at 1 and 12 edit diffs");
}

#[test]
fn a_markdown_mode_change_shows_the_source_in_place() {
    let text = "Some **bold** text.\n\n```rust\nlet x = 1;\n```";
    let messages = || {
        vec![
            user("msg_1", 1000, "Show"),
            assistant("msg_2", 1500, json!([{ "type": "text", "text": text }]), Some(4000)),
        ]
    };
    let h = open(60, 20, "ses_c", messages(), support::still());
    let screen = h.wait_for("let x = 1;");
    assert!(screen.contains("Some bold text."), "{screen}");
    let fence = Rc::new(());
    support::mark_at(&h.app, "let x = 1;", 1, &fence);
    opencode_tui::dialogs::settings::update(&h.tui, |draft| {
        opencode_tui::dialogs::settings::set_path(draft, &["session", "markdown"], json!("source"))
    });
    let switched = h.app.render();
    assert!(switched.text().contains("Some **bold** text."), "{}", switched.text());
    assert_eq!(Rc::strong_count(&fence), 2, "the fence was built again");

    let source =
        Info { session: Some(Session { markdown: Some(Markdown::Source), ..Session::default() }), ..support::still() };
    let fresh = open(60, 20, "ses_c", messages(), source);
    fresh.wait_for("let x = 1;");
    assert_eq!(switched.cells, fresh.app.render().cells, "{}", switched.text());
}

#[test]
fn a_theme_switch_restyles_groups_in_place() {
    let read = |id: &str, path: &str| {
        json!({
            "type": "tool", "id": id, "name": "read", "time": { "created": 1600, "completed": 1700 },
            "state": { "status": "completed", "input": { "path": path }, "content": [{ "type": "text", "text": "x" }] },
        })
    };
    let messages = vec![
        user("msg_1", 1000, "Explore"),
        assistant(
            "msg_2",
            1500,
            json!([
                { "type": "reasoning", "text": "**Reading**\n\nLook at `a`.\n\n```rust\nlet a = 1;\n```",
                  "time": { "created": 1500, "completed": 1600 } },
                read("call_1", "/project/a.rs"),
                read("call_2", "/project/b.rs"),
                { "type": "reasoning", "text": "Then `b`.", "time": { "created": 1700, "completed": 1800 } },
                read("call_3", "/project/c.rs"),
                { "type": "text", "text": "Done." },
            ]),
            Some(4000),
        ),
    ];
    let info = Info {
        debug: Some(Debug { turn_tokens: Some(TurnTokens::Enabled(true)), ..Debug::default() }),
        ..support::still()
    };
    support::assert_restyles_in_place(
        || open(80, 40, "ses_g", messages.clone(), info.clone()),
        |h| {
            let screen = h.wait_for_all(&["Done.", "+ Tokens"]);
            let row = |text: &str| screen.lines().position(|line| line.contains(text)).unwrap() as u16;
            h.app.click(8, row("+ Tokens"));
            // Apart, so no two clicks make a double click.
            let click = |text: &str| {
                h.app.advance(Duration::from_secs(1));
                let screen = h.app.text();
                let row = screen.lines().position(|line| line.contains(text)).unwrap() as u16;
                h.app.click(8, row);
                h.app.advance(Duration::from_millis(1));
            };
            click("2 thoughts, 3 reads");
            click("+ Thought: Reading");
            click("Explored: 2 reads");
        },
        |screen| screen.contains("- Tokens") && screen.contains("let a = 1;") && screen.contains("Read b.rs"),
    );
}

#[test]
fn latex_fences_render_as_math() {
    let text = "The roots:\n\n```latex\nx = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}\n```";
    let messages = vec![
        user("msg_1", 1000, "Solve it"),
        assistant("msg_2", 1500, json!([{ "type": "text", "text": text }]), Some(4000)),
    ];
    let h = open(60, 20, "ses_l", messages, Info::default());
    let screen = h.wait_for("√ b² - 4ac");
    assert!(!screen.contains("\\frac"), "{screen}");
    let rule = screen.lines().position(|line| line.contains("─────────────")).unwrap();
    assert!(screen.lines().nth(rule).unwrap().contains("x ="), "{screen}");
}

/// Simon's table (tex-regression): inline math in table cells draws as math in the assistant's text.
const VARIABLES: &str = "### Variables\n\n| Symbol | Meaning |\n| --- | --- |\n| $S$ | Raw score, from 1 to 10 |\n\
| $T$ | Tokens used |\n| $T_0$ | Baseline token count, such as the median across runs |\n\
| $\\alpha$ | How hard token usage is penalized. 0 means no penalty. 0.2–0.3 is a moderate starting point |\n\
| $S_{\\text{adj}}$ | Adjusted score, kept within 1 to 10 |\n\n$$\nS_{\\text{adj}} = \\frac{T_0}{T}\n$$";

fn math_screen(text: &str, info: Info) -> String {
    let messages = vec![
        user("msg_1", 1000, "Show the math"),
        assistant("msg_2", 1500, json!([{ "type": "text", "text": text }]), Some(4000)),
    ];
    let h = open(100, 40, "ses_l", messages, info);
    h.wait_for("provider/model")
}

#[test]
fn inline_math_draws_in_table_cells() {
    let screen = math_screen(VARIABLES, Info::default());
    for shown in ["│ T₀ ", "│ α ", "│ S_adj ", "│ S ", "Variables"] {
        assert!(screen.contains(shown), "{shown:?}\n{screen}");
    }
    assert!(!screen.contains('$') && !screen.contains("###"), "{screen}");
}

/// Inline math wherever Markdown holds inline text: table cells with text beside the math, headings, list items,
/// emphasis, block quotes, and links next to math. `$$…$$` inside a cell is no display block, so it stays text.
#[test]
fn inline_math_draws_in_every_inline_context() {
    let text = "| Symbol | Meaning |\n| --- | --- |\n| $T_0$ tokens | beside |\n| $$x^2$$ | a cell |\n\
| **$\\alpha$** | [link](https://x.y) $\\beta$ |\n\n## Heading $x^2$\n\n- item $\\gamma$\n- *em $\\delta$*\n\n\
> quote $\\epsilon$\n\n**bold $\\mu$** and [a link](https://x.y) next to $\\nu$.";
    let screen = math_screen(text, Info::default());
    for shown in [
        "│ T₀ tokens ",
        "│ $$x^2$$ ",
        "│ α ",
        "link (https://x.y) β",
        "Heading x²",
        "- item γ",
        "- em δ",
        "│ quote ϵ",
        "bold μ and a link (https://x.y) next to ν.",
    ] {
        assert!(screen.contains(shown), "{shown:?}\n{screen}");
    }
}

/// With `session.markdown` `source`, Markdown shows its markup as typed, inline math too; display math still draws,
/// as fences do. This was the "regression" Simon saw: his config had switched to `source`.
#[test]
fn source_mode_keeps_inline_math_as_typed() {
    let info =
        Info { session: Some(Session { markdown: Some(Markdown::Source), ..Session::default() }), ..Info::default() };
    let screen = math_screen(VARIABLES, info);
    for shown in ["│ $T_0$ ", "│ $\\alpha$ ", "### Variables", "T₀"] {
        assert!(screen.contains(shown), "{shown:?}\n{screen}");
    }
}
