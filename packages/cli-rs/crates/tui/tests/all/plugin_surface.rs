//! Exercise plugin surface lifecycle and compare visible frames, callback logs, and retained resources across carriers.

use crate::support::model::{self, Failure, Model, Rng};
use crate::support::{self, Harness};

use std::cell::RefCell;
use std::rc::Rc;
use std::sync::Arc;
use std::time::Duration;

use opencode_api::generated::V2Event;
use opencode_plugin::abi::{self, v2};
use opencode_plugin::reconcile;
use opencode_plugin::surface::{self, Ledger};
use opencode_tui::{Deps, Route};
use opentui::widget::Widget;

const ID: &str = "test.board";
const ITEMS: usize = 6;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Call {
    generation: u64,
    full: bool,
    bad: bool,
    built: usize,
}

#[derive(Default)]
struct Board {
    values: Vec<u32>,
    bad: u32,
    calls: Vec<Call>,
    waker: Option<abi::Waker>,
    palette: bool,
    palettes: Vec<String>,
    handles: Vec<Option<v2::ContentRef>>,
}

thread_local! {
    static BOARD: RefCell<Board> = RefCell::new(Board { values: vec![0; ITEMS], ..Board::default() });
}

fn board<T>(f: impl FnOnce(&mut Board) -> T) -> T {
    BOARD.with(|board| f(&mut board.borrow_mut()))
}

fn setup(setup: &mut abi::Setup) -> Result<(), String> {
    board(|board| board.waker = setup.waker());
    setup.command(abi::Command::new("board.bump"), |_, input| {
        let index: usize = input.and_then(|input| input.parse().ok()).unwrap_or(0);
        board(|board| board.values[index % ITEMS] += 1);
    });
    let mut surface = v2::Surface::new("board", v2::Place::Route("board".into()), view);
    if board(|board| board.palette) {
        surface = surface.palette();
    }
    setup.surface(surface);
    Ok(())
}

fn view(cx: &mut v2::View<'_>) -> v2::Node {
    let (values, bad, palette) = board(|board| {
        let bad = board.bad > 0;
        board.bad = board.bad.saturating_sub(1);
        (board.values.clone(), bad, board.palette)
    });
    let mut built = 0;
    let cards: Vec<v2::Node> = values
        .iter()
        .enumerate()
        .map(|(index, value)| {
            cx.memo(format!("card-{index}"), *value, |cx| {
                built += 1;
                let patch = patch(index, *value);
                let handle = cx.content(patch);
                if let Some(old) = board(|board| {
                    board.handles.resize(ITEMS, None);
                    board.handles[index].replace(handle)
                }) {
                    cx.release(old);
                }
                v2::Node::column(vec![
                    v2::Node::text(vec![abi::Span::new(format!("card {index}: {value}"))]).fg("text.muted"),
                    v2::Node::diff(v2::Source::Content(handle)).view(v2::DiffView::Unified),
                ])
            })
        })
        .collect();
    let call = Call { generation: cx.mount.generation, full: cx.input.full, bad, built };
    let shade = palette.then(|| cx.input.palette.get("text.muted")).flatten();
    board(|board| {
        board.calls.push(call);
        if let Some(shade) = shade {
            board.palettes.push(format!("{shade:?}"));
        }
    });
    let mut children = cards;
    if bad {
        children.push(v2::Node::Keep { key: "nothing".into() });
    }
    v2::Node::column(children).with_id("board")
}

fn patch(index: usize, value: u32) -> String {
    format!("@@ -1 +1 @@\n-item {index}\n+item {index} is {value}\n")
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Carrier {
    Linked,
    /// Through the byte shims of the C ABI: JSON both ways, as a loaded library.
    Abi,
}

pub const CARRIERS: [Carrier; 2] = [Carrier::Linked, Carrier::Abi];

pub fn builtin(carrier: Carrier, plugin: abi::Plugin) -> opencode_plugin::Builtin {
    match carrier {
        Carrier::Linked => opencode_plugin::Builtin::Plugin(plugin),
        Carrier::Abi => opencode_plugin::Builtin::Abi(plugin),
    }
}

fn open_tui(carrier: Carrier) -> Harness {
    let deps = Deps {
        route: Route::Home,
        builtins: vec![builtin(carrier, abi::Plugin { id: ID, setup })],
        ..support::deps(Arc::new(support::empty()))
    };
    let harness = support::mount_still(80, 40, deps);
    settle(&harness);
    harness
}

fn settle(harness: &Harness) {
    harness.app.advance(Duration::from_millis(1));
    harness.app.render();
    harness.app.advance(Duration::from_millis(1));
}

fn route() -> Route {
    Route::Plugin { id: ID.to_owned(), name: "board".to_owned() }
}

fn status(harness: &Harness) -> opencode_plugin::Status {
    harness.tui.plugins.entries().into_iter().find(|entry| entry.id == ID).unwrap().status
}

#[derive(Clone, Copy, Debug)]
enum Command {
    Open,
    Home,
    Bump(usize),
    Wake,
    Theme(usize),
    /// The next view returns a tree with a keep the host does not hold.
    Bad,
}

/// The theme's modes a theme change switches between; the theme's name stays, so only its palette changes.
const MODES: [opencode_ui::theme::ThemeMode; 2] =
    [opencode_ui::theme::ThemeMode::Dark, opencode_ui::theme::ThemeMode::Light];

fn apply(harness: &Harness, command: Command) {
    let tui = &harness.tui;
    match command {
        Command::Open => tui.navigate(route()),
        Command::Home => tui.navigate(Route::Home),
        Command::Bump(index) => {
            let _ = tui.keymap.dispatch("board.bump", Some(&index.to_string()));
        }
        Command::Wake => {
            if let Some(waker) = board(|board| board.waker.clone()) {
                waker.wake();
            }
        }
        Command::Theme(index) => {
            tui.theme.borrow_mut().set_mode(Some(MODES[index % MODES.len()]), false);
            tui.theme_changed();
        }
        Command::Bad => board(|board| board.bad = 1),
    }
    settle(harness);
}

struct Surfaces(Carrier);

impl Model for Surfaces {
    type Command = Command;

    fn generate(&self, rng: &mut Rng, steps: usize) -> Vec<Command> {
        (0..steps)
            .map(|_| match rng.below(100) {
                0..20 => Command::Open,
                20..32 => Command::Home,
                32..60 => Command::Bump(rng.below(ITEMS)),
                60..72 => Command::Wake,
                72..84 => Command::Theme(rng.below(2)),
                _ => Command::Bad,
            })
            .collect()
    }

    fn run(&self, commands: &[Command]) -> Option<Failure> {
        board(|board| *board = Board { values: vec![0; ITEMS], ..Board::default() });
        let baseline = surface::ledger_of(ID);
        let harness = open_tui(self.0);
        // The reference: the generation mounted, the highest one seen, and a bad view armed.
        let mut mounted: Option<u64> = None;
        let mut highest = 0;
        for (step, command) in commands.iter().enumerate() {
            let fail = |property, detail: String| Some(Failure { property, site: property, step, detail });
            let seen = board(|board| board.calls.len());
            let work = reconcile::work();
            apply(&harness, *command);
            let calls: Vec<Call> = board(|board| board.calls[seen..].to_vec());
            let on_route = matches!(harness.tui.route(), Route::Plugin { .. });
            match command {
                Command::Open => {
                    // A new mount, unless the route showed already and the TUI mounted it again: a new one either way.
                    let Some(first) = calls.first() else {
                        return fail("lifecycle", "an opened surface got no view".into());
                    };
                    if first.generation <= highest || !first.full || first.built != ITEMS && !first.bad {
                        return fail("lifecycle", format!("a new mount's first view was {first:?} after {highest}"));
                    }
                    // Only a refused first tree merits a second view during mount.
                    if calls.len() != 1 + usize::from(first.bad) {
                        return fail("work", format!("opening a surface ran {} views: {calls:?}", calls.len()));
                    }
                    mounted = Some(first.generation);
                    highest = first.generation;
                }
                Command::Home => mounted = None,
                Command::Theme(_) => {
                    if !calls.is_empty() {
                        return fail("work", format!("a theme change called the view: {calls:?}"));
                    }
                    let done = reconcile::work().since(work);
                    if mounted.is_some() && (done.created > 0 || done.removed > 0 || done.parses > 0) {
                        return fail("work", format!("a theme change rebuilt widgets: {done:?}"));
                    }
                }
                _ => {}
            }
            if !on_route {
                mounted = None;
            }
            // Every call goes to the mounted generation; a refused one is followed at once by a whole tree.
            for (index, call) in calls.iter().enumerate() {
                if Some(call.generation) != mounted {
                    return fail(
                        "lifecycle",
                        format!("a view of generation {} while {mounted:?} shows", call.generation),
                    );
                }
                if call.bad && !calls.get(index + 1).is_some_and(|next| next.full && !next.bad) {
                    return fail("keep-full", format!("a refused tree was not followed by a whole one: {calls:?}"));
                }
            }
            if status(&harness) != opencode_plugin::Status::Active {
                return fail("keep-full", "one refusal failed the plugin".into());
            }
            let ledger = surface::ledger_of(ID);
            let bytes: usize =
                board(|board| board.values.iter().enumerate().map(|(index, value)| patch(index, *value).len()).sum());
            let expected = match mounted {
                Some(_) => Ledger {
                    mounts: baseline.mounts + 1,
                    content: baseline.content + ITEMS as i64,
                    content_bytes: baseline.content_bytes + bytes as i64,
                    memo_entries: baseline.memo_entries + ITEMS as i64,
                },
                None => baseline,
            };
            if ledger != expected {
                return fail("ledger", format!("the host holds {ledger:?}, expected {expected:?}"));
            }
        }
        drop(harness);
        if surface::ledger_of(ID) != baseline {
            return fail_at(commands.len(), "ledger", format!("a closed TUI holds {:?}", surface::ledger_of(ID)));
        }
        None
    }
}

fn fail_at(step: usize, property: &'static str, detail: String) -> Option<Failure> {
    Some(Failure { property, site: property, step, detail })
}

#[test]
fn surface_mounts_hold_their_properties() {
    for carrier in CARRIERS {
        model::check(&Surfaces(carrier), 40, 32);
    }
}

struct Equal;

impl Model for Equal {
    type Command = Command;

    fn generate(&self, rng: &mut Rng, steps: usize) -> Vec<Command> {
        Surfaces(Carrier::Linked).generate(rng, steps)
    }

    fn run(&self, commands: &[Command]) -> Option<Failure> {
        let runs: Vec<Vec<(Vec<opentui::testing::Cell>, Vec<Call>)>> = CARRIERS
            .iter()
            .map(|carrier| {
                board(|board| *board = Board { values: vec![0; ITEMS], ..Board::default() });
                let harness = open_tui(*carrier);
                // Generations are new across the process, so each run numbers its own from 1.
                let mut generations: Vec<u64> = Vec::new();
                commands
                    .iter()
                    .map(|command| {
                        apply(&harness, *command);
                        let mut calls = board(|board| std::mem::take(&mut board.calls));
                        for call in &mut calls {
                            if !generations.contains(&call.generation) {
                                generations.push(call.generation);
                            }
                            call.generation =
                                generations.iter().position(|known| *known == call.generation).unwrap() as u64;
                        }
                        // Home's prompt shows a random placeholder in each TUI; only the route's frame is the plugin's.
                        let on_route = matches!(harness.tui.route(), Route::Plugin { .. });
                        let cells = if on_route { harness.app.render().cells } else { Vec::new() };
                        (cells, calls)
                    })
                    .collect()
            })
            .collect();
        let (linked, library) = (&runs[0], &runs[1]);
        let step = linked.iter().zip(library).position(|(linked, library)| linked != library)?;
        let detail = format!("linked {:?}\nlibrary {:?}", linked[step].1, library[step].1);
        Some(Failure { property: "carrier-equal", site: "carrier-equal", step, detail })
    }
}

#[test]
fn both_carriers_give_equal_frames_and_call_logs() {
    model::check(&Equal, 24, 24);
}

/// The cells of the route after `commands`, with a plugin that reads the palette or not.
fn frame_cells(carrier: Carrier, commands: &[Command], palette: bool) -> Vec<opentui::testing::Cell> {
    board(|board| *board = Board { values: vec![0; ITEMS], palette, ..Board::default() });
    let harness = open_tui(carrier);
    for command in commands {
        apply(&harness, *command);
    }
    harness.app.render().cells
}

/// The frame of the route after `commands`.
fn frame_after(carrier: Carrier, commands: &[Command]) -> String {
    board(|board| *board = Board { values: vec![0; ITEMS], ..Board::default() });
    let harness = open_tui(carrier);
    for command in commands {
        apply(&harness, *command);
    }
    harness.app.render().text()
}

#[test]
fn a_refused_tree_leaves_no_trace() {
    use Command::*;
    for carrier in CARRIERS {
        let with = frame_after(carrier, &[Open, Bump(1), Bad, Bump(2), Wake]);
        let without = frame_after(carrier, &[Open, Bump(1), Bump(2), Wake]);
        assert_eq!(with, without, "{carrier:?}");
        assert_ne!(frame_after(carrier, &[Open, Bump(1), Bump(3), Wake]), without);
        let calls = board(|board| board.calls.clone());
        assert!(calls.iter().all(|call| !call.bad));
    }
}

#[test]
fn a_second_refusal_in_a_row_fails_the_plugin() {
    for carrier in CARRIERS {
        board(|board| *board = Board { values: vec![0; ITEMS], ..Board::default() });
        let harness = open_tui(carrier);
        apply(&harness, Command::Open);
        board(|board| board.bad = 2);
        apply(&harness, Command::Bump(0));
        let failed =
            matches!(status(&harness), opencode_plugin::Status::Failed(ref error) if error.contains("refused twice"));
        assert!(failed, "{carrier:?}");
        let calls = board(|board| board.calls.len());
        apply(&harness, Command::Bump(1));
        apply(&harness, Command::Wake);
        assert_eq!(board(|board| board.calls.len()), calls, "a failed plugin got a view");
        assert_eq!(surface::ledger_of(ID), Ledger::default(), "{carrier:?}");
        assert!(!harness.app.render().text().contains("card 0"), "{carrier:?}");
    }
}

#[test]
fn a_theme_change_calls_only_a_surface_that_reads_the_palette() {
    for (carrier, palette) in CARRIERS.into_iter().flat_map(|carrier| [(carrier, false), (carrier, true)]) {
        let fresh = frame_cells(carrier, &[Command::Theme(1), Command::Open, Command::Bump(2)], palette);
        board(|board| *board = Board { values: vec![0; ITEMS], palette, ..Board::default() });
        let harness = open_tui(carrier);
        apply(&harness, Command::Open);
        // The last tree keeps every card but one.
        apply(&harness, Command::Bump(2));
        let (calls, palettes) = board(|board| (board.calls.len(), board.palettes.len()));
        let before = harness.app.render();
        let work = reconcile::work();
        apply(&harness, Command::Theme(1));
        let done = reconcile::work().since(work);
        let after = board(|board| board.calls.len());
        assert_eq!(after - calls, usize::from(palette), "palette={palette}");
        assert_eq!((done.created, done.removed, done.parses), (0, 0, 0), "{done:?}");
        assert_ne!(harness.app.render(), before);
        assert_eq!(harness.app.render().cells, fresh, "the switched route differs from one opened in the theme");
        if palette {
            let seen = board(|board| board.palettes.clone());
            assert_eq!(seen.len(), palettes + 1);
            assert_ne!(seen[palettes - 1], seen[palettes], "the palette did not change");
        }
    }
}

thread_local! {
    static PART_VIEWS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
    /// `test.parts` keeps its whole page from its second view on, not only the box and the item.
    static PART_ROOT: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
    static PART_KEEPS: std::cell::Cell<bool> = const { std::cell::Cell::new(true) };
}

fn parts(setup: &mut abi::Setup) -> Result<(), String> {
    let part = |part: &str| v2::Node::Markdown {
        id: None,
        source: v2::Source::PartOutput(v2::PartRef { session: "ses_p".into(), part: part.into() }),
    };
    setup.surface(v2::Surface::new("parts", v2::Place::Route("parts".into()), move |cx| {
        let views = PART_VIEWS.get();
        PART_VIEWS.set(views + 1);
        let keeps = views > 0 && !cx.input.full;
        if keeps && PART_ROOT.get() {
            return v2::Node::Keep { key: "page".into() };
        }
        let code = v2::Node::Code {
            id: None,
            content: v2::Source::PartOutput(v2::PartRef { session: "ses_p".into(), part: "call_2".into() }),
            filetype: None,
            numbers: false,
            layout: abi::Layout::default(),
        };
        let (held, item) = match keeps && PART_KEEPS.get() {
            false => (
                v2::Node::column(vec![v2::Node::text(vec![abi::Span::new("kept:")]), part("call_2"), code])
                    .with_id("held"),
                v2::Node::column(vec![part("call_2")]).with_id("item"),
            ),
            true => (v2::Node::Keep { key: "held".into() }, v2::Node::Keep { key: "item".into() }),
        };
        let list = v2::Node::list(vec![v2::ListItem::new(item, 1)])
            .with_id("list")
            .layout(abi::Layout::default().height(abi::Width::Cells(1)));
        v2::Node::column(vec![
            part("call_1"),
            part("call_2"),
            held,
            list,
            part("msg_1"),
            v2::Node::text(vec![abi::Span::new("end")]),
        ])
        .with_id("page")
    }));
    Ok(())
}

fn tool_event(kind: &str, seq: u64, data: serde_json::Value) -> V2Event {
    let event = serde_json::json!({
        "id": format!("evt_{seq}"), "created": 10_000 + seq, "type": kind,
        "durable": { "aggregateID": "ses_p", "seq": seq, "version": 1 },
        "data": data,
    });
    serde_json::from_value(event).unwrap()
}

#[test]
fn a_part_output_shows_the_transcripts_own_text() {
    for (root, carrier) in [(false, Carrier::Linked), (true, Carrier::Linked), (true, Carrier::Abi)] {
        part_output(root, carrier);
    }
}

fn part_output(root: bool, carrier: Carrier) {
    PART_ROOT.set(root);
    let harness = parts_harness(carrier);
    let shown = |harness: &Harness| -> Vec<String> {
        let screen = harness.app.render().text();
        screen.lines().map(str::trim).filter(|line| !line.is_empty()).map(str::to_owned).collect()
    };
    assert_eq!(shown(&harness), ["tool said fn parse", "lib.rs", "kept:", "end"]);
    call_2(&harness, "session.tool.input.started", 1, serde_json::json!({ "name": "read" }));
    call_2(&harness, "session.tool.called", 2, serde_json::json!({ "input": {}, "executed": true }));
    assert_eq!(shown(&harness), ["tool said fn parse", "lib.rs", "kept:", "end"], "a running call shows output");
    call_2(&harness, "session.tool.success", 3, output("REAL_RESULT"));
    harness.wait_for("REAL_RESULT");
    settle(&harness);
    assert_eq!(
        shown(&harness),
        ["tool said fn parse", "lib.rs", "REAL_RESULT", "kept:", "REAL_RESULT", "REAL_RESULT", "REAL_RESULT", "end"],
        "root kept {root}, {carrier:?}"
    );
    assert!(PART_VIEWS.get() >= 2, "the kept box was never kept");
    PART_ROOT.set(false);
}

fn output(text: &str) -> serde_json::Value {
    serde_json::json!({ "content": [{ "type": "text", "text": text }], "executed": true })
}

fn call_2(harness: &Harness, kind: &str, seq: u64, extra: serde_json::Value) {
    let ids = serde_json::json!({ "sessionID": "ses_p", "assistantMessageID": "msg_3", "id": "call_2" });
    harness.tui.data.apply(&[tool_event(kind, seq, support::merge(ids, extra))]);
    settle(harness);
}

fn parts_harness(carrier: Carrier) -> Harness {
    PART_VIEWS.set(0);
    let session = support::merge(support::session("ses_p", "Parts"), serde_json::json!({ "agent": "build" }));
    let messages = serde_json::json!([
        {
            "id": "msg_3", "type": "assistant", "agent": "build",
            "model": { "providerID": "provider", "id": "model" },
            "time": { "created": 5000 },
            "content": [
                {
                    "type": "tool", "id": "call_x", "name": "read", "time": { "created": 5100, "completed": 5200 },
                    "state": {
                        "status": "completed", "input": { "id": "call_2", "text": "WRONG_INPUT" },
                        "content": [{ "type": "text", "text": "x output" }],
                    },
                },
            ],
        },
        {
            "id": "msg_2", "type": "assistant", "agent": "build",
            "model": { "providerID": "provider", "id": "model" },
            "time": { "created": 1500, "completed": 4000 }, "finish": "stop",
            "content": [
                { "type": "text", "id": "t1", "text": "part one says hello" },
                {
                    "type": "tool", "id": "call_1", "name": "read", "time": { "created": 1600, "completed": 1700 },
                    "state": {
                        "status": "completed", "input": {},
                        "content": [
                            { "type": "text", "text": "tool said fn parse" },
                            { "type": "file", "uri": "file:///p/lib.rs", "mime": "text/plain", "name": "lib.rs" },
                        ],
                    },
                },
            ],
        },
        { "id": "msg_1", "type": "user", "text": "Show me", "time": { "created": 1000 } },
    ]);
    let fake = support::Fake::new(move |seen| match seen.path.as_str() {
        "/api/session" => (200, serde_json::json!({ "data": [], "cursor": {} })),
        "/api/session/ses_p" => (200, serde_json::json!({ "data": session })),
        "/api/session/ses_p/message" => (200, serde_json::json!({ "data": messages, "cursor": {} })),
        "/api/session/ses_p/permission" => (200, serde_json::json!({ "data": [] })),
        _ => support::not_found(),
    });
    let deps = Deps {
        route: support::session_route("ses_p"),
        builtins: vec![builtin(carrier, abi::Plugin { id: "test.parts", setup: parts })],
        ..support::deps(Arc::new(fake))
    };
    let harness = support::mount_still(80, 24, deps);
    harness.wait_for("part one says hello");
    harness.tui.navigate(Route::Plugin { id: "test.parts".into(), name: "parts".into() });
    harness.wait_for("tool said fn parse");
    harness
}

#[test]
fn a_kept_output_is_admitted_as_one_written_out() {
    let _limits = opencode_plugin::limits::set(opencode_plugin::limits::Limits {
        text: 64,
        ..opencode_plugin::limits::Limits::default()
    });
    let run = |keeps: bool, root: bool, carrier: Carrier| {
        PART_KEEPS.set(keeps);
        PART_ROOT.set(root);
        let harness = parts_harness(carrier);
        let over = "x".repeat(88);
        let stages = [
            (1, "small output", "small output"),
            (4, &over, "⋯ too large: 88 bytes"),
            (7, "small again", "small again"),
        ];
        let frames: Vec<String> = stages
            .into_iter()
            .map(|(seq, text, shows)| {
                call_2(&harness, "session.tool.input.started", seq, serde_json::json!({ "name": "read" }));
                call_2(&harness, "session.tool.called", seq + 1, serde_json::json!({ "input": {}, "executed": true }));
                call_2(&harness, "session.tool.success", seq + 2, output(text));
                // The nodes it writes out show the output first.
                harness.wait_for(shows);
                settle(&harness);
                harness.app.render().text()
            })
            .collect();
        PART_KEEPS.set(true);
        PART_ROOT.set(false);
        (frames, PART_VIEWS.get())
    };
    for (root, carrier) in [(false, Carrier::Linked), (false, Carrier::Abi), (true, Carrier::Linked)] {
        let (kept, views) = run(true, root, carrier);
        let (written, _) = run(false, false, carrier);
        assert!(views >= 2, "{carrier:?}, root {root}: the kept box was never kept");
        for (stage, (kept, written)) in ["small", "over", "small again"].iter().zip(kept.iter().zip(&written)) {
            assert_eq!(kept, written, "{carrier:?}, root {root}, {stage}: a kept output is not the one written out");
        }
        assert!(written[1].contains("⋯ too large: 88 bytes"), "the output past the limit shows\n{}", written[1]);
    }
}

/// A plugin of ABI 1.x whose route shows one text in the theme's muted color.
fn plain(setup: &mut abi::Setup) -> Result<(), String> {
    setup.route("plain", |_, _| abi::Render::Show(abi::Node::text([abi::Span::new("plain words").fg("text.muted")])));
    Ok(())
}

#[test]
fn a_route_of_abi_1_takes_a_new_theme_in_place() {
    let deps = Deps {
        route: Route::Home,
        builtins: vec![abi::Plugin { id: "test.plain", setup: plain }.into()],
        ..support::deps(Arc::new(support::empty()))
    };
    let harness = support::mount_still(80, 24, deps);
    harness.tui.navigate(Route::Plugin { id: "test.plain".into(), name: "plain".into() });
    let screen = harness.wait_for("plain words");
    let (y, line) = screen.lines().enumerate().find(|(_, line)| line.contains("plain words")).unwrap();
    let x = line.find("plain").unwrap() as u16;
    let widget = harness.app.widget_at(x, y as u16).unwrap().id();
    apply(&harness, Command::Theme(1));
    let theme = harness.tui.page();
    let frame = harness.app.render();
    let cell = &frame.cells[y * frame.width as usize + usize::from(x)];
    assert_eq!(cell.fg, theme.text.muted);
    assert_eq!(frame.cells[0].bg, theme.background.base);
    assert_eq!(harness.app.widget_at(x, y as u16).unwrap().id(), widget, "the text was built again");
}

/// A route of ABI 1.x whose node is `deep` levels of boxes, or a text of infinite width.
fn unbounded(setup: &mut abi::Setup) -> Result<(), String> {
    setup.route("deep", |_, _| {
        let deep =
            (0..300).fold(abi::Node::text([abi::Span::new("bottom")]), |inner, _| abi::Node::column(vec![inner]));
        abi::Render::Show(abi::Node::column(vec![abi::Node::text([abi::Span::new("deep route")]), deep]))
    });
    setup.route("wide", |_, _| {
        let layout = abi::Layout { width: Some(abi::Width::Percent(f32::INFINITY)), ..abi::Layout::default() };
        abi::Render::Show(abi::Node::text([abi::Span::new("wide route")]).layout(layout))
    });
    Ok(())
}

// Expected: a route of ABI 1.x whose node nests 300 levels, or has an infinite width, is not drawn, and the TUI goes
// on; OpenTUI would end it on either.
#[test]
fn a_node_the_layout_cannot_take_does_not_end_the_tui() {
    let deps = Deps {
        route: Route::Home,
        builtins: vec![abi::Plugin { id: "test.unbounded", setup: unbounded }.into()],
        ..support::deps(Arc::new(support::empty()))
    };
    let harness = support::mount_still(80, 24, deps);
    for name in ["deep", "wide"] {
        harness.tui.navigate(Route::Plugin { id: "test.unbounded".into(), name: name.into() });
        settle(&harness);
        let screen = harness.app.render().text();
        assert!(!screen.contains("route"), "{screen}");
    }
    harness.tui.navigate(Route::Home);
    settle(&harness);
    harness.app.render();
}

thread_local! {
    /// The handle the first mount of `test.alias` gave.
    static FIRST: std::cell::Cell<Option<v2::ContentRef>> = const { std::cell::Cell::new(None) };
    static REPLIES: RefCell<Vec<String>> = const { RefCell::new(Vec::new()) };
}

/// A route whose first mount shows content it gave, and whose later mounts give other content and show the first
/// mount's handle.
fn alias(setup: &mut abi::Setup) -> Result<(), String> {
    setup.surface(v2::Surface::new("alias", v2::Place::Route("alias".into()), |cx| {
        let handle = match FIRST.get() {
            None => {
                let first = cx.content("FIRST BYTES");
                FIRST.set(Some(first));
                first
            }
            Some(first) => {
                cx.content("SECOND BYTES");
                first
            }
        };
        v2::Node::Markdown { id: None, source: v2::Source::Content(handle) }
    }));
    Ok(())
}

// Expected (`lifecycle`, mounts): a content handle names what its own mount gave, and nothing in another mount, also
// one of the same surface opened again whose first handle would have the same number: such a tree is refused.
#[test]
fn a_content_handle_names_nothing_in_another_mount() {
    FIRST.set(None);
    let deps = Deps {
        route: Route::Home,
        builtins: vec![abi::Plugin { id: "test.alias", setup: alias }.into()],
        ..support::deps(Arc::new(support::empty()))
    };
    let harness = support::mount_still(80, 24, deps);
    let route = Route::Plugin { id: "test.alias".into(), name: "alias".into() };
    harness.tui.navigate(route.clone());
    harness.wait_for("FIRST BYTES");
    harness.tui.navigate(Route::Home);
    settle(&harness);
    harness.tui.navigate(route);
    settle(&harness);
    let screen = harness.app.render().text();
    assert!(!screen.contains("SECOND BYTES") && !screen.contains("FIRST BYTES"), "{screen}");
}

/// A route with a command of its own and a global one, each of which fetches `/api/hold`; the replies are logged.
fn owned(setup: &mut abi::Setup) -> Result<(), String> {
    let fetch = |host: &dyn abi::Host, _: Option<&str>| {
        let _ = host.try_fetch(abi::Fetch::new("GET", "/api/hold"));
    };
    let command = |name: &str, scope| abi::Command::new(name).scope(scope);
    setup.command(command("owned.route", abi::Scope::Route("owned".into())), fetch);
    setup.command(command("owned.global", abi::Scope::Global), fetch);
    setup.on_reply(|_, _, result| REPLIES.with(|replies| replies.borrow_mut().push(format!("{result:?}"))));
    setup.surface(v2::Surface::new("owned", v2::Place::Route("owned".into()), |_| {
        v2::Node::text(vec![abi::Span::new("owned route")])
    }));
    Ok(())
}

/// Server gate for holding fetches until a test releases them.
pub(crate) type Gate = Arc<(std::sync::Mutex<bool>, std::sync::Condvar)>;

type Count = Arc<std::sync::atomic::AtomicUsize>;

pub(crate) fn held() -> (support::Fake, Gate, Count, Count) {
    let gate: Gate = Arc::default();
    let (served, asked) = (Count::default(), Count::default());
    let fake = {
        let (gate, served, asked) = (gate.clone(), served.clone(), asked.clone());
        support::Fake::new(move |seen| {
            if seen.path != "/api/hold" {
                return support::base(seen, support::DIRECTORY);
            }
            asked.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            let (open, wake) = &*gate;
            let open = wake.wait_timeout_while(open.lock().unwrap(), Duration::from_secs(10), |open| !*open).unwrap();
            drop(open);
            served.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            (200, serde_json::json!({ "held": true }))
        })
    };
    (fake, gate, served, asked)
}

#[test]
fn a_late_reply_does_not_reach_a_mount_opened_again() {
    for loopback in [false, true] {
        late_reply(loopback);
    }
}

fn late_reply(loopback: bool) {
    REPLIES.with(|replies| replies.borrow_mut().clear());
    let (fake, gate, served, _) = held();
    let harness = support::mount_still(80, 24, Deps { route: Route::Home, ..support::deps(Arc::new(fake)) });
    let host = opencode_tui::plugins::host::host(&harness.tui);
    let definition = match loopback {
        true => {
            let entries = abi::export_plugin!(@loopback "test.owned", owned);
            opencode_plugin::loader::native::loopback(&host, entries).unwrap().0
        }
        false => abi::Plugin { id: "test.owned", setup: owned }.into(),
    };
    opencode_tui::plugins::host::add(&harness.tui, definition);
    let route = Route::Plugin { id: "test.owned".into(), name: "owned".into() };
    harness.tui.navigate(route.clone());
    harness.wait_for("owned route");
    let _ = harness.tui.keymap.dispatch("owned.route", None);
    settle(&harness);
    harness.tui.navigate(Route::Home);
    settle(&harness);
    harness.tui.navigate(route);
    harness.wait_for("owned route");
    let release = || {
        *gate.0.lock().unwrap() = true;
        gate.1.notify_all();
    };
    release();
    let arrived = |count| {
        harness.app.wait_until(Duration::from_secs(5), || served.load(std::sync::atomic::Ordering::SeqCst) >= count);
        harness.app.wait_until(Duration::from_millis(300), || false);
    };
    arrived(1);
    assert!(
        REPLIES.with(|replies| replies.borrow().is_empty()),
        "loopback {loopback}: a reply reached a mount opened again"
    );
    let _ = harness.tui.keymap.dispatch("owned.global", None);
    arrived(2);
    assert_eq!(
        REPLIES.with(|replies| replies.borrow().len()),
        1,
        "loopback {loopback}: the plugin's own reply did not arrive"
    );
    harness.tui.plugins.deactivate_all();
}

thread_local! {
    static ROOM: RefCell<Vec<(&'static str, u16, u16)>> = const { RefCell::new(Vec::new()) };
}

fn room(setup: &mut abi::Setup) -> Result<(), String> {
    setup.surface(v2::Surface::new("room", v2::Place::Route("room".into()), |cx| {
        ROOM.with(|room| room.borrow_mut().push(("route", cx.input.width, cx.input.height)));
        let rows = (0..40).map(|row| v2::Node::text(vec![abi::Span::new(format!("row {row}"))])).collect();
        let scroll = v2::Node::scroll(rows).with_id("rows").layout(abi::Layout::default().grow());
        v2::Node::column(vec![v2::Node::text(vec![abi::Span::new("room title")]), scroll])
            .layout(abi::Layout::default().grow())
    }));
    setup.surface(v2::Surface::new("tag", v2::Place::Slot(abi::Placement::append("home.footer.status")), |cx| {
        ROOM.with(|room| room.borrow_mut().push(("slot", cx.input.width, cx.input.height)));
        v2::Node::text(vec![abi::Span::new("room tag")]).layout(abi::Layout::default().grow().min_width(0))
    }));
    Ok(())
}

#[test]
fn a_surface_gets_the_room_it_is_given() {
    ROOM.with(|room| room.borrow_mut().clear());
    let deps = Deps {
        route: Route::Home,
        builtins: vec![abi::Plugin { id: "test.room", setup: room }.into()],
        ..support::deps(Arc::new(support::empty()))
    };
    let harness = support::mount_still(80, 24, deps);
    harness.wait_for("room tag");
    settle(&harness);
    let slot = ROOM.with(|room| room.borrow().iter().rev().find(|(name, ..)| *name == "slot").copied()).unwrap();
    assert!(slot.1 > 0 && slot.1 < 80, "the slot surface was given {slot:?}");
    harness.tui.navigate(Route::Plugin { id: "test.room".into(), name: "room".into() });
    let screen = harness.wait_for("room title");
    // The title takes the page's first row and the scroll every row below it.
    assert!(screen.lines().next().is_some_and(|line| line.trim() == "room title"), "{screen}");
    let rows = screen.lines().filter(|line| line.trim_start().starts_with("row ")).count();
    assert_eq!(rows, 23, "the route's scroll does not fill the page:\n{screen}");
    let first =
        |screen: &str| screen.lines().find(|line| line.trim_start().starts_with("row ")).unwrap().trim().to_owned();
    let top = first(&screen);
    harness.app.scroll(10, 10, true);
    settle(&harness);
    assert_ne!(first(&harness.app.render().text()), top, "the wheel moved nothing");
    harness.app.resize(70, 18);
    settle(&harness);
    harness.app.render();
    settle(&harness);
    let last = ROOM.with(|room| room.borrow().iter().rev().find(|(name, ..)| *name == "route").copied()).unwrap();
    assert!(last.1 == 70 && last.2 > 0 && last.2 <= 18, "after a resize the route's view was given {last:?}");
}

thread_local! {
    static RETRY: std::cell::Cell<(u8, Option<v2::ContentRef>)> = const { std::cell::Cell::new((0, None)) };
}

/// A route that shows a kept body; command `retry.go` arms its next view with mode 1 or 2. Both give content and
/// return a tree the host refuses; the whole tree asked for after that shows the refused view's content (1) or keeps
/// the body the last accepted tree holds (2). Mode 3 memoizes, gives content and panics.
fn retry(setup: &mut abi::Setup) -> Result<(), String> {
    setup.command(abi::Command::new("retry.go"), |_, input| {
        RETRY.set((input.and_then(|input| input.parse().ok()).unwrap_or(0), None));
    });
    setup.surface(v2::Surface::new("retry", v2::Place::Route("retry".into()), |cx| {
        let body = v2::Node::text(vec![abi::Span::new("kept body")]).with_id("body");
        match RETRY.get() {
            (mode @ (1 | 2), None) => {
                RETRY.set((mode, Some(cx.content("REFUSED BYTES"))));
                v2::Node::column(vec![v2::Node::Keep { key: "missing".into() }])
            }
            (1, Some(refused)) => v2::Node::Markdown { id: None, source: v2::Source::Content(refused) },
            (2, Some(_)) => v2::Node::column(vec![v2::Node::Keep { key: "body".into() }]),
            (3, _) => {
                cx.memo("memo", 1, |_| v2::Node::column(Vec::new()));
                cx.content("PANIC BYTES");
                panic!("the view panics");
            }
            _ => v2::Node::column(vec![body]),
        }
    }));
    Ok(())
}

#[test]
fn a_whole_tree_after_a_refusal_takes_nothing_from_before() {
    for mode in [1, 2, 3] {
        RETRY.set((0, None));
        let deps = Deps {
            route: Route::Home,
            builtins: vec![abi::Plugin { id: "test.retry", setup: retry }.into()],
            ..support::deps(Arc::new(support::empty()))
        };
        let harness = support::mount_still(80, 24, deps);
        harness.tui.navigate(Route::Plugin { id: "test.retry".into(), name: "retry".into() });
        harness.wait_for("kept body");
        let _ = harness.tui.keymap.dispatch("retry.go", Some(&mode.to_string()));
        settle(&harness);
        let entry = harness.tui.plugins.entries().into_iter().find(|entry| entry.id == "test.retry").unwrap();
        assert!(
            matches!(&entry.status, opencode_plugin::Status::Failed(error)
                if error.contains(if mode == 3 { "panics" } else { "refused twice" })),
            "mode {mode}: {:?}",
            entry.status
        );
        assert!(!harness.app.render().text().contains("REFUSED BYTES"), "mode {mode}");
        assert_eq!(surface::ledger_of("test.retry"), Ledger::default(), "mode {mode}");
    }
}

thread_local! {
    /// The views of `test.restyle`'s surfaces: the surface and the mount's generation.
    static RESTYLE: RefCell<Vec<(&'static str, u64)>> = const { RefCell::new(Vec::new()) };
    /// The renders of its claim of ABI 1.x.
    static KEPT_RENDERS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
    static PAL_MODES: RefCell<Vec<String>> = const { RefCell::new(Vec::new()) };
}

/// Surfaces in the home footer, the `app` slot, the sidebar and the prompt's footer, each a muted text; one in the
/// footer that reads the palette and changes its click with it, on a raised background; and a claim of ABI 1.x that
/// keeps what it showed.
fn restyling(setup: &mut abi::Setup) -> Result<(), String> {
    let text = |name: &'static str, place: &str| {
        v2::Surface::new(name, v2::Place::Slot(abi::Placement::append(place)), move |cx| {
            RESTYLE.with(|log| log.borrow_mut().push((name, cx.mount.generation)));
            v2::Node::text(vec![abi::Span::new(format!("{name} claim"))]).fg("text.muted")
        })
    };
    setup.surface(text("foot", "home.footer"));
    setup.surface(text("app", "app"));
    setup.surface(text("side", "sidebar.content"));
    setup.surface(text("prompt", "prompt.footer"));
    setup.surface(
        v2::Surface::new("pal", v2::Place::Slot(abi::Placement::append("home.footer")), |cx| {
            RESTYLE.with(|log| log.borrow_mut().push(("pal", cx.mount.generation)));
            let mode = format!("{:?}", cx.input.palette.mode);
            PAL_MODES.with(|modes| modes.borrow_mut().push(mode.clone()));
            v2::Node::row(vec![v2::Node::text(vec![abi::Span::new("pal box")])])
                .bg("background.raised.base")
                .on_click(abi::Click::command("restyle.mode").input(mode))
        })
        .palette(),
    );
    setup.slot(abi::Placement::append("home.footer"), |_, _, _| {
        let renders = KEPT_RENDERS.get();
        KEPT_RENDERS.set(renders + 1);
        match renders {
            0 => abi::Render::Show(abi::Node::text([abi::Span::new("kept claim").fg("text.muted")])),
            _ => abi::Render::Keep,
        }
    });
    Ok(())
}

fn cell_of(harness: &Harness, text: &str) -> opentui::testing::Cell {
    let capture = harness.app.render();
    let (x, y) = harness.find(text);
    capture.cells[usize::from(y) * capture.width as usize + usize::from(x)].clone()
}

#[test]
fn a_theme_change_keeps_every_surface_mounted() {
    let session = support::merge(support::session("ses_t", "Restyle"), serde_json::json!({ "agent": "build" }));
    let fake = move || {
        let session = session.clone();
        support::Fake::new(move |seen| match seen.path.as_str() {
            "/api/session" => (200, serde_json::json!({ "data": [session], "cursor": {} })),
            "/api/session/ses_t" => (200, serde_json::json!({ "data": session })),
            "/api/session/ses_t/message" => (200, serde_json::json!({ "data": [], "cursor": {} })),
            "/api/session/ses_t/permission" => (200, serde_json::json!({ "data": [] })),
            _ => support::base(seen, support::DIRECTORY),
        })
    };
    for route in [Route::Home, support::session_route("ses_t")] {
        RESTYLE.with(|log| log.borrow_mut().clear());
        PAL_MODES.with(|modes| modes.borrow_mut().clear());
        KEPT_RENDERS.set(0);
        let deps = Deps {
            route: route.clone(),
            builtins: vec![abi::Plugin { id: "test.restyle", setup: restyling }.into()],
            ..support::deps(Arc::new(fake()))
        };
        let harness = support::mount_still(160, 40, deps);
        let names: &[&str] = match route {
            Route::Home => &["foot claim", "app claim", "prompt claim", "pal box", "kept claim"],
            _ => &["side claim", "app claim", "prompt claim"],
        };
        harness.wait_for_all(names);
        settle(&harness);
        // The startup's reads land when they do, some not yet sent, and each change batch views every claim: the
        // store's changes wait while the switch runs, so the views and widgets after it are the switch's.
        harness.tui.hold_sync(true);
        let seen = RESTYLE.with(|log| log.borrow().clone());
        let work = reconcile::work();
        assert!(harness.tui.theme.borrow_mut().set_mode(Some(opencode_ui::theme::ThemeMode::Light), false));
        harness.tui.theme_changed();
        settle(&harness);
        let done = reconcile::work().since(work);
        let after = RESTYLE.with(|log| log.borrow()[seen.len()..].to_vec());
        harness.tui.hold_sync(false);
        let palette = seen.iter().rev().find(|(name, _)| *name == "pal").map(|(_, generation)| *generation);
        assert!(
            after.iter().all(|(name, generation)| *name == "pal" && Some(*generation) == palette),
            "{route:?}: views after the switch {after:?}, before {seen:?}"
        );
        assert_eq!((done.created, done.removed), (0, 0), "{route:?}: {done:?}");
        let page = harness.tui.page();
        for name in names.iter().filter(|name| **name != "pal box") {
            assert_eq!(cell_of(&harness, name).fg, page.text.muted, "{route:?}: {name}");
        }
        if route == Route::Home {
            assert_eq!(after.len(), 1, "the palette's surface was not called once");
            let modes = PAL_MODES.with(|modes| modes.borrow().clone());
            assert_eq!(modes.last().map(String::as_str), Some("Light"), "{modes:?}");
            assert_eq!(cell_of(&harness, "pal box").bg, page.background.raised.base);
        }
    }
}

thread_local! {
    /// Views of `test.replacing` left before the next refuses, twice.
    static REPLACING: std::cell::Cell<usize> = const { std::cell::Cell::new(usize::MAX) };
}

/// A surface that replaces the home footer's status row and, once armed, returns trees the host refuses.
fn replacing(setup: &mut abi::Setup) -> Result<(), String> {
    setup.command(abi::Command::new("replacing.break"), |_, _| {
        REPLACING.set(0);
    });
    setup.surface(v2::Surface::new(
        "replace",
        v2::Place::Slot(abi::Placement::new(abi::SlotKind::Replace, "home.footer.status")),
        |_| {
            if REPLACING.get() == 0 {
                return v2::Node::column(vec![v2::Node::Keep { key: "gone".into() }]);
            }
            v2::Node::text(vec![abi::Span::new("replaced version")])
        },
    ));
    Ok(())
}

#[test]
fn a_failed_surface_gives_its_slot_back() {
    REPLACING.set(usize::MAX);
    let deps = Deps {
        route: Route::Home,
        builtins: vec![abi::Plugin { id: "test.replacing", setup: replacing }.into()],
        ..support::deps(Arc::new(support::empty()))
    };
    let harness = support::mount_still(100, 30, deps);
    let replaced = harness.wait_for("replaced version");
    assert!(!replaced.contains("plugin failed"), "{replaced}");
    let _ = harness.tui.keymap.dispatch("replacing.break", None);
    settle(&harness);
    let entry = harness.tui.plugins.entries().into_iter().find(|entry| entry.id == "test.replacing").unwrap();
    assert!(matches!(entry.status, opencode_plugin::Status::Failed(_)), "{:?}", entry.status);
    let screen = harness.app.render().text();
    assert!(!screen.contains("replaced version") && screen.contains("1 plugin failed"), "{screen}");
    assert_eq!(surface::ledger_of("test.replacing"), Ledger::default());
}

#[test]
fn a_theme_of_another_name_calls_the_view_once_and_builds_nothing() {
    for carrier in CARRIERS {
        board(|board| *board = Board { values: vec![0; ITEMS], ..Board::default() });
        let harness = open_tui(carrier);
        apply(&harness, Command::Open);
        let calls = board(|board| board.calls.len());
        let work = reconcile::work();
        assert!(harness.tui.theme.borrow_mut().set("tokyonight"));
        harness.tui.theme_changed();
        settle(&harness);
        let done = reconcile::work().since(work);
        let after = board(|board| board.calls[calls..].to_vec());
        assert_eq!(after.len(), 1, "{after:?}");
        assert!(after[0].built == 0 && !after[0].full, "{after:?}");
        assert_eq!((done.created, done.removed, done.parses), (0, 0, 0), "{done:?}");
    }
}

#[test]
fn a_reload_drops_the_replies_of_the_activation_before() {
    REPLIES.with(|replies| replies.borrow_mut().clear());
    let (fake, gate, served, _) = held();
    let deps = Deps {
        route: Route::Home,
        builtins: vec![abi::Plugin { id: "test.owned", setup: owned }.into()],
        ..support::deps(Arc::new(fake))
    };
    let harness = support::mount_still(80, 24, deps);
    let route = Route::Plugin { id: "test.owned".into(), name: "owned".into() };
    harness.tui.navigate(route.clone());
    harness.wait_for("owned route");
    let _ = harness.tui.keymap.dispatch("owned.route", None);
    let _ = harness.tui.keymap.dispatch("owned.global", None);
    settle(&harness);
    let host: Rc<dyn opencode_plugin::Host> = harness.tui.clone();
    assert!(harness.tui.plugins.set_active(&host, "test.owned", false));
    settle(&harness);
    assert!(harness.tui.plugins.set_active(&host, "test.owned", true));
    settle(&harness);
    harness.tui.navigate(route);
    harness.wait_for("owned route");
    *gate.0.lock().unwrap() = true;
    gate.1.notify_all();
    let arrived = |count| {
        harness.app.wait_until(Duration::from_secs(5), || served.load(std::sync::atomic::Ordering::SeqCst) >= count);
        harness.app.wait_until(Duration::from_millis(300), || false);
    };
    arrived(2);
    assert!(REPLIES.with(|replies| replies.borrow().is_empty()), "a reply reached the activation after a reload");
    let _ = harness.tui.keymap.dispatch("owned.global", None);
    arrived(3);
    assert_eq!(REPLIES.with(|replies| replies.borrow().len()), 1, "the new activation's reply did not arrive");
}

#[test]
fn a_mounts_widgets_are_freed_with_it() {
    for carrier in CARRIERS {
        board(|board| *board = Board { values: vec![0; ITEMS], ..Board::default() });
        let harness = open_tui(carrier);
        let marked = |harness: &Harness| {
            let marker = Rc::new(());
            support::mark_at(&harness.app, "card 0: 0", 4, &marker);
            assert_eq!(Rc::strong_count(&marker), 5);
            marker
        };
        apply(&harness, Command::Open);
        let marker = marked(&harness);
        apply(&harness, Command::Bad);
        apply(&harness, Command::Bump(1));
        assert_eq!(Rc::strong_count(&marker), 5, "a refused tree and its retry freed shown widgets");
        apply(&harness, Command::Open);
        assert_eq!(Rc::strong_count(&marker), 1, "a mount opened again kept the last one's widgets");
        let marker = marked(&harness);
        apply(&harness, Command::Home);
        assert_eq!(Rc::strong_count(&marker), 1, "a closed mount kept its widgets");
        apply(&harness, Command::Open);
        let marker = marked(&harness);
        board(|board| board.bad = 2);
        apply(&harness, Command::Bump(2));
        assert!(matches!(status(&harness), opencode_plugin::Status::Failed(_)));
        assert_eq!(Rc::strong_count(&marker), 1, "a failed plugin's mount kept its widgets");
    }
}

thread_local! {
    /// How many cards `test.cards` shows, and the value of the first.
    static CARDS: std::cell::Cell<(usize, u32)> = const { std::cell::Cell::new((0, 0)) };
}

/// A route of cards, each memoized on its value; a command bumps the first card, another changes nothing.
fn cards(setup: &mut abi::Setup) -> Result<(), String> {
    let command = |name: &str| abi::Command::new(name);
    setup.command(command("cards.bump"), |_, _| CARDS.with(|cards| cards.set((cards.get().0, cards.get().1 + 1))));
    setup.command(command("cards.same"), |_, _| {});
    setup.surface(v2::Surface::new("cards", v2::Place::Route("cards".into()), |cx| {
        let (count, first) = CARDS.with(std::cell::Cell::get);
        let cards = (0..count)
            .map(|index| {
                let value = if index == 0 { first } else { 0 };
                cx.memo(format!("card-{index}"), value, |_| {
                    v2::Node::text(vec![abi::Span::new(format!("card {index} is {value}"))])
                })
            })
            .collect();
        v2::Node::column(cards).with_id("cards")
    }));
    Ok(())
}

/// What crossed the C ABI while `step` ran, on the route of `test.cards` with `count` cards.
fn crossed_by(count: usize, step: impl FnOnce(&Harness)) -> opencode_plugin::loader::native::Crossed {
    CARDS.with(|cards| cards.set((count, 0)));
    let deps = Deps {
        route: Route::Home,
        builtins: vec![builtin(Carrier::Abi, abi::Plugin { id: "test.cards", setup: cards })],
        ..support::deps(Arc::new(support::empty()))
    };
    let harness = support::mount_still(80, 40, deps);
    harness.tui.navigate(Route::Plugin { id: "test.cards".into(), name: "cards".into() });
    settle(&harness);
    let before = opencode_plugin::loader::native::crossed();
    step(&harness);
    settle(&harness);
    opencode_plugin::loader::native::crossed().since(before)
}

#[test]
fn a_revision_crosses_bytes_that_follow_the_change() {
    let run = |count, command: &'static str| {
        crossed_by(count, move |harness| {
            harness.tui.keymap.dispatch(command, None);
        })
    };
    let (small, large) =
        ((run(40, "cards.same"), run(40, "cards.bump")), (run(410, "cards.same"), run(410, "cards.bump")));
    assert_eq!((small.0.calls, small.1.calls), (2, 2), "a command and a view");
    // The requests name two numbers that may have one digit more: the mount's generation, a count across the process,
    // and `next`, which numbers content after the cards' handles.
    assert!(small.1.sent.abs_diff(large.1.sent) <= 2, "the requests grew with the cards: {small:?} {large:?}");
    assert_eq!(small.1.received - small.0.received, large.1.received - large.0.received, "{small:?} {large:?}");
    assert!(small.1.received > small.0.received);
    assert!(small.1.sent < 512, "{small:?}");
    let theme = crossed_by(410, |harness| {
        harness.tui.theme.borrow_mut().set("tokyonight");
        harness.tui.theme_changed();
    });
    assert_eq!(theme.calls, 1, "a theme of another name crossed more than its one view: {theme:?}");
}

thread_local! {
    static HIDE: RefCell<(Option<usize>, Vec<bool>)> = const { RefCell::new((None, Vec::new())) };
}

fn hiding(setup: &mut abi::Setup) -> Result<(), String> {
    let hide = abi::Command::new("hide.toggle");
    setup.command(hide, |_, input| {
        let card = input.and_then(|input| input.parse().ok());
        HIDE.with(|hide| hide.borrow_mut().0 = card);
    });
    setup.surface(v2::Surface::new("hide", v2::Place::Route("hide".into()), |cx| {
        let hidden = HIDE.with(|hide| {
            let mut hide = hide.borrow_mut();
            hide.1.push(cx.input.full);
            hide.0
        });
        let cards = (0..3)
            .filter(|index| Some(*index) != hidden)
            .map(|index| cx.memo(format!("card-{index}"), 0u32, |_| v2::Node::text(vec![abi::Span::new("card")])))
            .collect();
        v2::Node::column(cards).with_id("cards")
    }));
    Ok(())
}

#[test]
fn a_card_left_out_is_built_again_when_it_comes_back() {
    for carrier in CARRIERS {
        HIDE.with(|hide| *hide.borrow_mut() = (None, Vec::new()));
        let deps = Deps {
            route: Route::Home,
            builtins: vec![builtin(carrier, abi::Plugin { id: "test.hide", setup: hiding })],
            ..support::deps(Arc::new(support::empty()))
        };
        let harness = support::mount_still(60, 20, deps);
        harness.tui.navigate(Route::Plugin { id: "test.hide".into(), name: "hide".into() });
        settle(&harness);
        for input in [Some("1"), None, Some("2"), None] {
            harness.tui.keymap.dispatch("hide.toggle", input);
            settle(&harness);
        }
        let fulls = HIDE.with(|hide| hide.borrow().1.clone());
        assert!(fulls.len() >= 5 && fulls[0], "{carrier:?}: {fulls:?}");
        assert!(fulls[1..].iter().all(|full| !full), "{carrier:?}: a whole tree was asked for again: {fulls:?}");
    }
}

thread_local! {
    static DUP: RefCell<(bool, Vec<bool>)> = const { RefCell::new((false, Vec::new())) };
}

fn duplicating(setup: &mut abi::Setup) -> Result<(), String> {
    let arm = abi::Command::new("dup.arm");
    setup.command(arm, |_, _| DUP.with(|dup| dup.borrow_mut().0 = true));
    setup.surface(v2::Surface::new("dup", v2::Place::Route("dup".into()), |cx| {
        let repeat = DUP.with(|dup| {
            let mut dup = dup.borrow_mut();
            dup.1.push(cx.input.full);
            dup.0
        });
        let second = if repeat { "a" } else { "b" };
        v2::Node::column(vec![
            v2::Node::text(vec![abi::Span::new("one")]).with_id("a"),
            v2::Node::text(vec![abi::Span::new("two")]).with_id(second),
        ])
    }));
    Ok(())
}

#[test]
fn a_duplicate_id_fails_the_plugin_without_a_retry() {
    for carrier in CARRIERS {
        DUP.with(|dup| *dup.borrow_mut() = (false, Vec::new()));
        let deps = Deps {
            route: Route::Home,
            builtins: vec![builtin(carrier, abi::Plugin { id: "test.dup", setup: duplicating })],
            ..support::deps(Arc::new(support::empty()))
        };
        let harness = support::mount_still(60, 20, deps);
        harness.tui.navigate(Route::Plugin { id: "test.dup".into(), name: "dup".into() });
        settle(&harness);
        let before = DUP.with(|dup| dup.borrow().1.len());
        harness.tui.keymap.dispatch("dup.arm", None);
        settle(&harness);
        let views = DUP.with(|dup| dup.borrow().1[before..].to_vec());
        assert_eq!(views, [false], "{carrier:?}: a whole tree was asked for after a duplicate id");
        let status = harness.tui.plugins.entries().into_iter().find(|entry| entry.id == "test.dup").unwrap().status;
        let broke = matches!(&status, opencode_plugin::Status::Failed(error) if error.contains("broke the contract"));
        assert!(broke, "{carrier:?}: {status:?}");
    }
}

fn page(setup: &mut abi::Setup) -> Result<(), String> {
    let command = abi::Command::new("page.go").scope(abi::Scope::Route("page".into()));
    setup.command(command, |_, _| {});
    setup.surface(v2::Surface::new("page", v2::Place::Route("page".into()), |_| {
        v2::Node::text(vec![abi::Span::new("a page")])
    }));
    Ok(())
}

#[test]
fn a_route_opens_with_one_view() {
    let from = [
        ("home", Route::Home),
        ("a page without commands", Route::Plugin { id: "test.none".into(), name: "none".into() }),
        ("a route with commands", Route::Plugin { id: "test.page".into(), name: "page".into() }),
    ];
    for carrier in CARRIERS {
        for (name, before) in &from {
            board(|board| *board = Board { values: vec![0; ITEMS], ..Board::default() });
            let deps = Deps {
                route: Route::Home,
                builtins: vec![
                    builtin(carrier, abi::Plugin { id: ID, setup }),
                    builtin(carrier, abi::Plugin { id: "test.page", setup: page }),
                ],
                ..support::deps(Arc::new(support::empty()))
            };
            let harness = support::mount_still(80, 40, deps);
            harness.tui.navigate(before.clone());
            settle(&harness);
            let views = board(|board| board.calls.len());
            harness.tui.navigate(route());
            settle(&harness);
            let calls = board(|board| board.calls[views..].to_vec());
            assert_eq!(calls.len(), 1, "{carrier:?} from {name}: {calls:?}");
            assert!(harness.app.render().text().contains("card 0"), "{carrier:?} from {name}");
        }
    }
}

thread_local! {
    static TALLIED: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

fn tally(setup: &mut abi::Setup) -> Result<(), String> {
    let command = abi::Command::new("tally.bump")
        .title("Bump the tally")
        .keybind("1")
        .palette()
        .scope(abi::Scope::Route("tally".into()));
    setup.command(command, |_, _| TALLIED.set(TALLIED.get() + 1));
    setup.surface(v2::Surface::new("tally", v2::Place::Route("tally".into()), |_| {
        v2::Node::text(vec![abi::Span::new("a tally")])
    }));
    Ok(())
}

#[test]
fn a_routes_commands_are_in_the_palette() {
    for carrier in CARRIERS {
        let deps = Deps {
            route: Route::Home,
            builtins: vec![builtin(carrier, abi::Plugin { id: "test.tally", setup: tally })],
            ..support::deps(Arc::new(support::empty()))
        };
        let harness = support::mount_still(80, 30, deps);
        let palette = |harness: &Harness| {
            harness.tui.keymap.dispatch("command.palette.show", None);
            harness.wait_for("Search commands");
            harness.app.type_text("Bump the tally");
            settle(harness);
            harness.app.render().text()
        };
        let screen = palette(&harness);
        assert!(!screen.contains("Bump the tally\n") && screen.contains("No results"), "{carrier:?}: {screen}");
        harness.app.press("escape");
        settle(&harness);
        harness.tui.navigate(Route::Plugin { id: "test.tally".into(), name: "tally".into() });
        harness.wait_for("a tally");
        TALLIED.set(0);
        harness.app.press("1");
        settle(&harness);
        assert_eq!(TALLIED.get(), 1, "{carrier:?}: its key runs it on the route");
        let screen = palette(&harness);
        assert!(!screen.contains("No results"), "{carrier:?}: {screen}");
        harness.app.press("1");
        settle(&harness);
        assert_eq!(TALLIED.get(), 1, "{carrier:?}: its key ran it under a dialog");
        harness.app.press("backspace");
        settle(&harness);
        harness.app.press("enter");
        settle(&harness);
        assert_eq!(TALLIED.get(), 2, "{carrier:?}: the palette runs it");
        assert!(!harness.tui.dialogs.is_open() && harness.app.render().text().contains("a tally"), "{carrier:?}");
    }
}

/// A route whose command panics.
fn doomed(setup: &mut abi::Setup) -> Result<(), String> {
    let command = abi::Command::new("doomed.panic").scope(abi::Scope::Route("page".into()));
    setup.command(command, |_, _| -> () { panic!("doomed") });
    setup.surface(v2::Surface::new("page", v2::Place::Route("page".into()), |_| {
        v2::Node::text(vec![abi::Span::new("a doomed page")])
    }));
    Ok(())
}

#[test]
fn a_failed_plugins_route_says_it_failed() {
    for carrier in CARRIERS {
        let deps = Deps {
            route: Route::Home,
            builtins: vec![builtin(carrier, abi::Plugin { id: "test.doomed", setup: doomed })],
            ..support::deps(Arc::new(support::empty()))
        };
        let harness = support::mount_still(100, 30, deps);
        harness.tui.navigate(Route::Plugin { id: "test.doomed".into(), name: "page".into() });
        harness.wait_for("a doomed page");
        harness.tui.keymap.dispatch("doomed.panic", None);
        let screen = harness.wait_for("Plugin test.doomed failed. Run /plugins for details.");
        assert!(!screen.contains("Unknown"), "{carrier:?}: {screen}");
        harness.tui.navigate(Route::Plugin { id: "test.none".into(), name: "page".into() });
        harness.wait_for("Unknown plugin route: test.none/page");
    }
}

#[test]
fn leaving_a_surface_unmounts_it_in_the_library() {
    let harness = open_tui(Carrier::Abi);
    harness.tui.navigate(route());
    settle(&harness);
    let before = opencode_plugin::loader::native::crossed();
    harness.tui.navigate(Route::Home);
    settle(&harness);
    assert_eq!(opencode_plugin::loader::native::crossed().since(before).calls, 1);
}

#[test]
fn each_change_of_the_hosts_state_after_a_view_calls_one() {
    for carrier in CARRIERS {
        board(|board| *board = Board { values: vec![0; ITEMS], ..Board::default() });
        let harness = open_tui(carrier);
        harness.tui.navigate(route());
        settle(&harness);
        let views = || board(|board| board.calls.len());
        let before = views();
        opencode_tui::dialogs::settings::update(&harness.tui, |value| {
            opencode_tui::dialogs::settings::set_path(value, &["animations"], serde_json::json!(false));
        });
        settle(&harness);
        assert_eq!(views() - before, 1, "{carrier:?}: a settings write");
        let before = views();
        harness.tui.local.sync(&opencode_store::Changes::everything());
        settle(&harness);
        assert_eq!(views() - before, 1, "{carrier:?}: a local change");
    }
}

thread_local! {
    static NESTED: std::cell::Cell<u32> = const { std::cell::Cell::new(0) };
}

/// A route whose body is a memo holding a memo, under a line a command changes; no other node has an id.
fn nesting(setup: &mut abi::Setup) -> Result<(), String> {
    setup.command(abi::Command::new("nest.bump"), |_, _| NESTED.with(|nested| nested.set(nested.get() + 1)));
    setup.surface(v2::Surface::new("nest", v2::Place::Route("nest".into()), |cx| {
        let head = v2::Node::text(vec![abi::Span::new(format!("bumped {}", NESTED.with(std::cell::Cell::get)))]);
        let body = cx.memo("outer", 1u8, |cx| {
            v2::Node::column(vec![cx.memo("inner", 2u8, |_| v2::Node::text(vec![abi::Span::new("kept")]))])
        });
        v2::Node::column(vec![head, body])
    }));
    Ok(())
}

#[test]
fn a_kept_memo_that_holds_a_memo_keeps_a_library_active() {
    for carrier in CARRIERS {
        NESTED.with(|nested| nested.set(0));
        let deps = Deps {
            route: Route::Home,
            builtins: vec![builtin(carrier, abi::Plugin { id: "test.nest", setup: nesting })],
            ..support::deps(Arc::new(support::empty()))
        };
        let harness = support::mount_still(80, 20, deps);
        harness.tui.navigate(Route::Plugin { id: "test.nest".into(), name: "nest".into() });
        settle(&harness);
        harness.tui.keymap.dispatch("nest.bump", None);
        settle(&harness);
        let screen = harness.app.text();
        assert!(screen.contains("bumped 1") && screen.contains("kept"), "{carrier:?}:\n{screen}");
        assert_eq!(opencode_plugin::surface::ledger_of("test.nest").memo_entries, 2, "{carrier:?}");
    }
}

// A dialog whose body is a surface (contract ergonomics 2.7): the plugin `test.dlg` has a route `pg` with a field
// `outside`, and a dialog surface `ask` with a field `name`, which its command `dlg.open` shows and focuses in one
// call. The surface's handler records each edit of its field and the dialog's close.

thread_local! {
    static DIALOG_SEEN: RefCell<Vec<String>> = const { RefCell::new(Vec::new()) };
}

/// The dialog probe's carriers: linked, the C ABI, and Luau.
#[derive(Clone, Copy, Debug, PartialEq)]
enum DialogCarrier {
    Native(Carrier),
    #[cfg(luau)]
    Luau,
}

fn dialog_carriers() -> Vec<DialogCarrier> {
    vec![
        DialogCarrier::Native(Carrier::Linked),
        DialogCarrier::Native(Carrier::Abi),
        #[cfg(luau)]
        DialogCarrier::Luau,
    ]
}

fn dialog_probe(setup: &mut abi::Setup) -> Result<(), String> {
    setup.command(abi::Command::new("dlg.open"), |host, _| {
        host.dialog(abi::Dialog::Surface(abi::DialogSurface::new("ask").title("Ask")));
        host.focus("name");
    });
    setup.command(abi::Command::new("dlg.outside").scope(abi::Scope::Route("pg".into())), |host, _| {
        host.focus("outside");
    });
    setup.command(abi::Command::new("dlg.blur"), |host, _| host.blur());
    // Route and dialog fields deliberately share an ID to distinguish focus ownership.
    for (name, field) in [("same", "outside"), ("tall", "deep"), ("long", "end")] {
        setup.command(abi::Command::new(format!("dlg.{name}")), move |host, _| {
            host.dialog(abi::Dialog::Surface(abi::DialogSurface::new(name)));
            host.focus(field);
        });
    }
    setup.command(abi::Command::new("dlg.dismissed"), |_, _| {
        DIALOG_SEEN.with_borrow_mut(|seen| seen.push("dismissed".to_owned()));
    });
    let text = |text: &str| v2::Node::text(vec![abi::Span::new(text)]);
    setup.surface(v2::Surface::new("pg", v2::Place::Route("pg".into()), move |_| {
        v2::Node::column(vec![text("dialog page"), v2::Node::input("").with_id("outside")])
    }));
    let record = |_: &dyn abi::Host, event: &abi::interact::Event| {
        let line = match event {
            abi::interact::Event::Change { node, text, .. } if node == "name" => format!("change {text}"),
            abi::interact::Event::Change { node, text, .. } => format!("change {node} {text}"),
            abi::interact::Event::Closed { surface } => format!("closed {surface}"),
            // Register an Escape handler that would consume Escape if installed.
            abi::interact::Event::Key(key) if key.bind.as_deref() == Some("esc") => {
                DIALOG_SEEN.with_borrow_mut(|seen| seen.push("esc".to_owned()));
                return abi::interact::Handled::Consume;
            }
            _ => return abi::interact::Handled::Pass,
        };
        DIALOG_SEEN.with_borrow_mut(|seen| seen.push(line));
        abi::interact::Handled::Pass
    };
    let surface = v2::Surface::new("ask", v2::Place::Dialog("ask".into()), move |_| {
        v2::Node::column(vec![text("dialog body"), v2::Node::input("").with_id("name")])
    })
    .layers(vec![abi::interact::Layer::default().keys(vec![abi::interact::Bind::new("escape", "esc")])])
    .on(record);
    setup.surface(surface);
    setup.surface(
        v2::Surface::new("same", v2::Place::Dialog("same".into()), move |_| {
            v2::Node::column(vec![text("same body"), v2::Node::input("").with_id("outside")])
        })
        .on(record),
    );
    setup.surface(
        v2::Surface::new("tall", v2::Place::Dialog("tall".into()), move |_| {
            let mut rows: Vec<v2::Node> = (0..24).map(|row| text(&format!("line {row}"))).collect();
            rows.push(v2::Node::input("").with_id("deep"));
            let scroll =
                v2::Node::scroll(rows).with_id("sc").layout(abi::Layout::default().height(abi::Width::Cells(3)));
            v2::Node::column(vec![text("tall body"), scroll])
        })
        .on(record),
    );
    setup.surface(
        v2::Surface::new("long", v2::Place::Dialog("long".into()), move |_| {
            let mut rows: Vec<v2::Node> = (0..45).map(|row| text(&format!("row {row}"))).collect();
            rows.push(v2::Node::input("").with_id("end"));
            v2::Node::column(rows)
        })
        .on(record),
    );
    Ok(())
}

/// [`dialog_probe`] in Luau, which records in its storage.
#[cfg(luau)]
const DIALOG_LUAU: &str = r#"local plugin = require("@opencode/plugin")
local function text(text) return { type = "text", spans = { { text = text } } } end
local function record(host, line)
    local seen = host:storageGet("seen") or {}
    table.insert(seen, line)
    host:storageSet("seen", seen)
end
return plugin.define(function(setup)
    setup:storageKey("seen")
    setup:command({ name = "dlg.open" }, function(host)
        host:dialog({ type = "surface", surface = "ask", title = "Ask" })
        host:focus("name")
    end)
    setup:command({ name = "dlg.outside", scope = { route = "pg" } }, function(host) host:focus("outside") end)
    setup:command({ name = "dlg.blur" }, function(host) host:blur() end)
    setup:surface({ name = "pg", place = { type = "route", name = "pg" } }, function()
        return { type = "box", children = { text("dialog page"), { type = "input", id = "outside" } } }
    end)
    setup:surface({ name = "ask", place = { type = "dialog", name = "ask" } }, function()
        return { type = "box", children = { text("dialog body"), { type = "input", id = "name" } } }
    end, function(host, event)
        if event.type == "change" then record(host, "change " .. event.text) end
        if event.type == "closed" then record(host, "closed " .. event.surface) end
        return "pass"
    end)
end)
"#;

/// The TUI on the probe's route, on `carrier`.
fn dialog_open(carrier: DialogCarrier) -> Harness {
    DIALOG_SEEN.with_borrow_mut(Vec::clear);
    let harness =
        support::mount_still(80, 24, Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) });
    let definition = match carrier {
        DialogCarrier::Native(Carrier::Linked) => abi::Plugin { id: "test.dlg", setup: dialog_probe }.into(),
        DialogCarrier::Native(Carrier::Abi) => {
            let entries = abi::export_plugin!(@loopback "test.dlg", dialog_probe);
            let host = opencode_tui::plugins::host::host(&harness.tui);
            opencode_plugin::loader::native::loopback(&host, entries).unwrap().0
        }
        #[cfg(luau)]
        DialogCarrier::Luau => {
            let sources = opencode_plugin::luau::Sources::from_files([
                ("plugin.toml", "id = \"test.dlg\""),
                ("init.luau", DIALOG_LUAU),
            ]);
            opencode_plugin::luau::define(&sources, None).unwrap().0
        }
    };
    opencode_tui::plugins::host::add(&harness.tui, definition);
    harness.tui.navigate(Route::Plugin { id: "test.dlg".into(), name: "pg".into() });
    harness.wait_for("dialog page");
    dialog_turns(&harness);
    harness
}

fn dialog_turns(harness: &Harness) {
    for _ in 0..5 {
        harness.app.advance(Duration::from_millis(1));
        harness.app.render();
    }
}

/// What the probe's handler recorded.
#[cfg_attr(not(luau), allow(unused_variables))]
fn dialog_seen(harness: &Harness, carrier: DialogCarrier) -> Vec<String> {
    match carrier {
        DialogCarrier::Native(_) => DIALOG_SEEN.with_borrow(Vec::clone),
        #[cfg(luau)]
        DialogCarrier::Luau => {
            let stored = opencode_plugin::Host::storage_read(&*harness.tui, "plugin.test.dlg.seen");
            stored.and_then(|json| serde_json::from_str(&json).ok()).unwrap_or_default()
        }
    }
}

/// The node of `surface`'s newest mount that has the focus, and how many mounts it has.
fn dialog_focus(harness: &Harness, surface: &str) -> (Option<String>, usize) {
    let mut mounts = opencode_plugin::behave::mounts(harness.app.app(), "test.dlg", surface);
    let count = mounts.len();
    (mounts.pop().and_then(|mount| mount.focused), count)
}

#[test]
fn a_dialog_surface_takes_the_focus_inside_it_only_and_closes_on_ctrl_c() {
    for carrier in dialog_carriers() {
        let h = dialog_open(carrier);
        _ = h.tui.keymap.dispatch("dlg.open", None);
        h.wait_for("dialog body");
        dialog_turns(&h);
        assert_eq!(dialog_focus(&h, "ask"), (Some("name".to_owned()), 1), "{carrier:?}: the field took no focus");
        h.app.type_text("abc");
        dialog_turns(&h);
        assert_eq!(dialog_seen(&h, carrier).last().map(String::as_str), Some("change abc"), "{carrier:?}");

        _ = h.tui.keymap.dispatch("dlg.outside", None);
        dialog_turns(&h);
        assert_eq!(dialog_focus(&h, "pg").0, None, "{carrier:?}: a field under the dialog took the focus");
        assert_eq!(dialog_focus(&h, "ask").0.as_deref(), Some("name"), "{carrier:?}: the dialog lost its focus");

        h.app.press("ctrl+c");
        dialog_turns(&h);
        assert!(h.app.text().contains("dialog body"), "{carrier:?}: ctrl+c closed a dialog whose field had text");
        assert_eq!(dialog_seen(&h, carrier).last().map(String::as_str), Some("change "), "{carrier:?}");
        h.app.press("ctrl+c");
        dialog_turns(&h);
        assert!(!h.app.text().contains("dialog body"), "{carrier:?}: ctrl+c left the dialog open");
        assert!(h.app.text().contains("dialog page"), "{carrier:?}: ctrl+c closed more than the dialog");
        assert_eq!(dialog_focus(&h, "ask").1, 0, "{carrier:?}: the dialog's mount outlived it");
        assert_eq!(dialog_seen(&h, carrier).last().map(String::as_str), Some("closed ask"), "{carrier:?}");

        _ = h.tui.keymap.dispatch("dlg.open", None);
        h.wait_for("dialog body");
        dialog_turns(&h);
        assert_eq!(dialog_focus(&h, "ask"), (Some("name".to_owned()), 1), "{carrier:?}: reopened, no focus");
        _ = h.tui.keymap.dispatch("dlg.blur", None);
        dialog_turns(&h);
        assert_eq!(dialog_focus(&h, "ask").0, None, "{carrier:?}: the blur kept the field's focus");
        let host = h.tui.dialogs.host().id();
        let focus = h.app.app().focused();
        let in_dialog = std::iter::successors(focus, |widget| widget.parent()).any(|widget| widget.id() == host);
        assert!(in_dialog, "{carrier:?}: the blur moved the focus out of the dialog");
        h.app.press("escape");
        dialog_turns(&h);
        assert!(!h.app.text().contains("dialog body") && h.app.text().contains("dialog page"), "{carrier:?}");
        let closes = dialog_seen(&h, carrier).iter().filter(|line| *line == "closed ask").count();
        assert_eq!(closes, 2, "{carrier:?}: {:?}", dialog_seen(&h, carrier));
    }
}

/// Native carriers used for dialog-surface assertions.
const DIALOG_NATIVE: [DialogCarrier; 2] = [DialogCarrier::Native(Carrier::Linked), DialogCarrier::Native(Carrier::Abi)];

/// The probe's running activation, as the host names it.
fn dialog_generation(h: &Harness) -> u64 {
    (0..100_000).find(|generation| h.tui.plugins.live("test.dlg", *generation)).expect("a running activation")
}

#[test]
fn a_dialog_surface_keeps_its_field_focused_in_a_new_theme() {
    for carrier in DIALOG_NATIVE {
        let h = dialog_open(carrier);
        _ = h.tui.keymap.dispatch("dlg.open", None);
        h.wait_for("dialog body");
        dialog_turns(&h);
        h.tui.theme.borrow_mut().set("tokyonight");
        h.tui.theme_changed();
        dialog_turns(&h);
        assert_eq!(dialog_focus(&h, "ask").0.as_deref(), Some("name"), "{carrier:?}: the theme took the focus");
        h.app.type_text("q");
        dialog_turns(&h);
        assert_eq!(dialog_seen(&h, carrier).last().map(String::as_str), Some("change q"), "{carrier:?}");
    }
}

#[test]
fn escape_closes_a_dialog_surface_whose_bind_would_take_it() {
    for carrier in DIALOG_NATIVE {
        let h = dialog_open(carrier);
        _ = h.tui.keymap.dispatch("dlg.open", None);
        h.wait_for("dialog body");
        dialog_turns(&h);
        h.app.press("escape");
        dialog_turns(&h);
        assert!(!h.app.text().contains("dialog body"), "{carrier:?}: escape left the dialog open");
        assert!(!dialog_seen(&h, carrier).contains(&"esc".to_owned()), "{carrier:?}: the bind took escape");
    }
}

#[test]
fn a_dialog_shown_and_focused_takes_the_focus_from_a_field_with_its_id_under_it() {
    for carrier in DIALOG_NATIVE {
        let h = dialog_open(carrier);
        _ = h.tui.keymap.dispatch("dlg.same", None);
        h.wait_for("same body");
        dialog_turns(&h);
        assert_eq!(dialog_focus(&h, "same").0.as_deref(), Some("outside"), "{carrier:?}: no focus in the dialog");
        h.app.type_text("k");
        dialog_turns(&h);
        assert_eq!(dialog_seen(&h, carrier).last().map(String::as_str), Some("change outside k"), "{carrier:?}");
    }
}

#[test]
fn a_focused_field_of_a_dialog_below_a_scroll_shows() {
    for carrier in DIALOG_NATIVE {
        let h = dialog_open(carrier);
        _ = h.tui.keymap.dispatch("dlg.tall", None);
        h.wait_for("tall body");
        dialog_turns(&h);
        let offset = opencode_plugin::behave::mounts(h.app.app(), "test.dlg", "tall")
            .pop()
            .and_then(|mount| mount.offsets.into_iter().find(|(id, _)| id == "sc"))
            .map(|(_, offset)| offset);
        assert!(offset.is_some_and(|offset| offset > 0), "{carrier:?}: the scroll stayed at {offset:?}");
    }
}

#[test]
fn a_focused_field_of_a_dialog_taller_than_the_screen_shows() {
    for carrier in DIALOG_NATIVE {
        let h = dialog_open(carrier);
        _ = h.tui.keymap.dispatch("dlg.long", None);
        h.wait_for("row 0");
        dialog_turns(&h);
        assert_eq!(dialog_focus(&h, "long").0.as_deref(), Some("end"), "{carrier:?}");
        assert!(h.app.text().contains("row 44"), "{carrier:?}: the field is below the screen:\n{}", h.app.text());
    }
}

/// Shows the probe's dialog `same` as an earlier activation of the plugin did, before a reload, then changes it in
/// place as the running one, with `change`.
fn dialog_changed_in_place(h: &Harness, change: impl FnOnce(abi::Dialog) -> abi::Dialog) -> u64 {
    let generation = dialog_generation(h);
    let shown = || abi::Dialog::Surface(abi::DialogSurface::new("same"));
    opencode_tui::plugins::panel::show(&h.tui, "test.dlg", generation + 1000, shown());
    h.wait_for("same body");
    opencode_tui::plugins::panel::show(&h.tui, "test.dlg", generation, change(shown()));
    dialog_turns(h);
    generation
}

#[test]
fn a_dialog_changed_in_place_by_a_waiting_request_tells_it_closed() {
    for carrier in DIALOG_NATIVE {
        let h = dialog_open(carrier);
        dialog_changed_in_place(&h, |shown| abi::Dialog::Dismissable {
            dialog: Box::new(shown),
            dismissed: abi::Action::Command { name: "dlg.dismissed".into(), input: None },
        });
        h.app.press("escape");
        dialog_turns(&h);
        assert!(!h.app.text().contains("same body"), "{carrier:?}: escape left the dialog open");
        assert!(
            dialog_seen(&h, carrier).contains(&"dismissed".to_owned()),
            "{carrier:?}: {:?}",
            dialog_seen(&h, carrier)
        );
    }
}

#[test]
fn a_dialog_changed_in_place_by_a_later_activation_leaves_no_owner() {
    for carrier in DIALOG_NATIVE {
        let h = dialog_open(carrier);
        let generation = dialog_changed_in_place(&h, |shown| shown);
        h.app.press("escape");
        dialog_turns(&h);
        assert!(!h.app.text().contains("same body"), "{carrier:?}: escape left the dialog open");
        h.tui.dialogs.replace(|cx| opentui::prelude::View::new(&cx.app), None, Default::default());
        let close = abi::Dialog::Close { key: String::new() };
        opencode_tui::plugins::panel::show(&h.tui, "test.dlg", generation, close);
        assert!(h.tui.dialogs.is_open(), "{carrier:?}: the plugin closed the host's dialog");
        h.tui.dialogs.clear();
    }
}

#[cfg(feature = "ts")]
#[test]
fn a_dialog_shown_and_focused_over_the_pipe_takes_the_typing() {
    let Some(config) = crate::plugin_pipe::config() else { return };
    let root = opencode_util::temp::tempdir().unwrap();
    let log = root.path().join("changes");
    let plugin = root.path().join("config").join("plugins").join("dlgraw");
    std::fs::create_dir_all(&plugin).unwrap();
    let script = format!(
        r#"import {{ appendFileSync }} from "node:fs"
export default {{ id: "example.dlgraw", setup(api) {{
  const carrier = api[Symbol.for("opencode.carrier")]
  const field = {{ type: "box", children: [{{ type: "text", spans: [{{ text: "raw body" }}] }}, {{ type: "input", id: "f" }}] }}
  carrier.surface("ask", {{ type: "dialog", name: "ask" }}, () => field, {{
    on: (event) => {{ if (event.type === "change") appendFileSync({log:?}, event.text + "\n") }},
  }})
  carrier.command({{ name: "dlgraw.open", title: "dlgraw.open" }}, () => {{
    carrier.effect({{ type: "dialog", dialog: {{ type: "surface", surface: "ask" }} }})
    carrier.effect({{ type: "focus", node: "f" }})
  }})
}} }}
"#
    );
    std::fs::write(plugin.join("tui.ts"), script).unwrap();
    let harness =
        support::mount_still(80, 24, Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) });
    let external = opencode_tui::plugins::host::External {
        config_dir: root.path().join("config"),
        cwd: root.path().to_path_buf(),
        dev: Vec::new(),
    };
    opencode_tui::plugins::host::external_with(&harness.tui, external, Some(config));
    let pipe = crate::plugin_pipe::Pipe { harness, root: opencode_util::temp::tempdir().unwrap() };
    pipe.active("example.dlgraw");
    pipe.settle();
    pipe.harness.tui.keymap.dispatch("dlgraw.open", None);
    pipe.harness.wait("the dialog shows", || {
        pipe.settle();
        pipe.harness.app.text().contains("raw body")
    });
    pipe.settle();
    pipe.harness.app.type_text("x");
    let changes = || std::fs::read_to_string(&log).unwrap_or_default();
    pipe.harness.app.wait_until(Duration::from_secs(5), || {
        pipe.settle();
        !changes().is_empty()
    });
    assert_eq!(changes().trim(), "x", "the field took no typing");
}
