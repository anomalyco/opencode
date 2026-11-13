//! Mounts of contract 2.0 surfaces (P1, synthesis 4.2 and 4.14): `lifecycle` and `ledger` for mounts, `no-effects`
//! for a refused tree, `keep-full` for a second refusal, and `work` for a theme change, on a linked test plugin in
//! the real TUI.
//!
//! The plugin `test.board` shows a route of cards, one a value, each memoized on its value with its body a `Diff`
//! by content handle. Its view writes its own call log: the mount's generation, whether the host asked for a whole
//! tree, and whether it returned a bad one. The reference is the model's own: which generation is mounted, and what a
//! refusal does.

use crate::support::model::{self, Failure, Model, Rng};
use crate::support::{self, Harness};

use std::cell::RefCell;
use std::sync::Arc;
use std::time::Duration;

use opencode_plugin::abi::{self, v2};
use opencode_plugin::reconcile;
use opencode_plugin::surface::{self, Ledger};
use opencode_tui::{Deps, Route};

const ID: &str = "test.board";
const ITEMS: usize = 6;

/// One view call, as the plugin saw it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Call {
    generation: u64,
    full: bool,
    bad: bool,
    /// Cards it built rather than kept.
    built: usize,
}

#[derive(Default)]
struct Board {
    values: Vec<u32>,
    /// Views left that return a tree the host refuses.
    bad: u32,
    calls: Vec<Call>,
    waker: Option<abi::Waker>,
    /// The surface reads the palette.
    palette: bool,
    palettes: Vec<String>,
}

thread_local! {
    static BOARD: RefCell<Board> = RefCell::new(Board { values: vec![0; ITEMS], ..Board::default() });
}

fn board<T>(f: impl FnOnce(&mut Board) -> T) -> T {
    BOARD.with(|board| f(&mut board.borrow_mut()))
}

fn setup(setup: &mut abi::Setup) -> Result<(), String> {
    board(|board| board.waker = setup.waker());
    setup.command(abi::Command { name: "board.bump".into(), ..abi::Command::default() }, |_, input| {
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
                let patch = format!("@@ -1 +1 @@\n-item {index}\n+item {index} is {value}\n");
                v2::Node::column(vec![
                    v2::Node::text(vec![abi::Span::new(format!("card {index}: {value}"))]).fg("text.muted"),
                    v2::Node::Diff {
                        id: None,
                        content: v2::Source::Content(cx.content(patch)),
                        view: v2::DiffView::Unified,
                        filetype: None,
                    },
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

fn open_tui() -> Harness {
    let deps = Deps {
        route: Route::Home,
        builtins: vec![abi::Plugin { id: ID, setup }.into()],
        ..support::deps(Arc::new(support::empty()))
    };
    let harness = support::mount(80, 40, deps);
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
    /// The plugin's waker, as from its own thread.
    Wake,
    Theme(usize),
    /// The next view returns a tree with a keep the host does not hold.
    Bad,
}

const THEMES: [&str; 2] = ["opencode", "tokyonight"];

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
            tui.theme.borrow_mut().set(THEMES[index % THEMES.len()]);
            tui.theme_changed();
        }
        Command::Bad => board(|board| board.bad = 1),
    }
    settle(harness);
}

struct Surfaces;

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
        let baseline = surface::ledger();
        let harness = open_tui();
        // The reference: the generation mounted, the highest one seen, and a bad view armed.
        let mut mounted: Option<u64> = None;
        let mut highest = 0;
        for (step, command) in commands.iter().enumerate() {
            let fail = |property, detail: String| Some(Failure { property, step, detail });
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
                    mounted = Some(first.generation);
                    highest = first.generation;
                }
                Command::Home => mounted = None,
                Command::Theme(_) => {
                    if !calls.is_empty() {
                        return fail("work", format!("a theme change called the view: {calls:?}"));
                    }
                    // On home the footer mounts its slot again, the claims of 1.x with it: that is the footer's.
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
            // The ledger, read from the host's counts: a mount holds its memo table and one content handle a card.
            // Counted from this run's start: the counts are the thread's, and a run before may have failed.
            let ledger = surface::ledger();
            let expected = match mounted {
                Some(_) => Ledger {
                    mounts: baseline.mounts + 1,
                    content: baseline.content + ITEMS as i64,
                    memo_entries: baseline.memo_entries + ITEMS as i64,
                    ..ledger
                },
                None => baseline,
            };
            if ledger != expected {
                return fail("ledger", format!("the host holds {ledger:?}, expected {expected:?}"));
            }
        }
        drop(harness);
        if surface::ledger() != baseline {
            return fail_at(commands.len(), "ledger", format!("a closed TUI holds {:?}", surface::ledger()));
        }
        None
    }
}

fn fail_at(step: usize, property: &'static str, detail: String) -> Option<Failure> {
    Some(Failure { property, step, detail })
}

// Expected: a surface's mounts get views only while they show, each with a generation of its own whose first view
// builds whole; a refused tree is asked again whole at once and leaves the plugin active; a theme change calls no
// view and rebuilds nothing; and what a mount held goes with it.
#[test]
fn surface_mounts_hold_their_properties() {
    model::check(&Surfaces, 40, 32);
}

/// The frame of the route after `commands`.
fn frame_after(commands: &[Command]) -> String {
    board(|board| *board = Board { values: vec![0; ITEMS], ..Board::default() });
    let harness = open_tui();
    for command in commands {
        apply(&harness, *command);
    }
    harness.app.render().text()
}

// Expected (`no-effects`, a refused tree): a view whose tree is refused leaves nothing: the route draws as in a run
// where that view never returned it, and the content it gave the host is gone. The guard: the same run with a value
// changed differs.
#[test]
fn a_refused_tree_leaves_no_trace() {
    use Command::*;
    let with = frame_after(&[Open, Bump(1), Bad, Bump(2), Wake]);
    let without = frame_after(&[Open, Bump(1), Bump(2), Wake]);
    assert_eq!(with, without);
    assert_ne!(frame_after(&[Open, Bump(1), Bump(3), Wake]), without);
    let calls = board(|board| board.calls.clone());
    assert!(calls.iter().all(|call| !call.bad));
}

// Expected (`keep-full`): a second refused tree in a row fails the plugin: one report, no view after, and its mount
// holds no content.
#[test]
fn a_second_refusal_in_a_row_fails_the_plugin() {
    board(|board| *board = Board { values: vec![0; ITEMS], ..Board::default() });
    let harness = open_tui();
    apply(&harness, Command::Open);
    board(|board| board.bad = 2);
    apply(&harness, Command::Bump(0));
    assert!(matches!(status(&harness), opencode_plugin::Status::Failed(ref error) if error.contains("refused twice")));
    let calls = board(|board| board.calls.len());
    apply(&harness, Command::Bump(1));
    apply(&harness, Command::Wake);
    assert_eq!(board(|board| board.calls.len()), calls, "a failed plugin got a view");
    assert_eq!(surface::ledger().content, 0);
}

// Expected (`work`, a theme change): a surface that names its colors by token gets no call on a theme switch and its
// widgets take the theme in place; one that reads the palette gets one view, with the new palette.
#[test]
fn a_theme_change_calls_only_a_surface_that_reads_the_palette() {
    for palette in [false, true] {
        board(|board| *board = Board { values: vec![0; ITEMS], palette, ..Board::default() });
        let harness = open_tui();
        apply(&harness, Command::Open);
        let (calls, palettes) = board(|board| (board.calls.len(), board.palettes.len()));
        let before = harness.app.render();
        let work = reconcile::work();
        apply(&harness, Command::Theme(1));
        let done = reconcile::work().since(work);
        let after = board(|board| board.calls.len());
        assert_eq!(after - calls, usize::from(palette), "palette={palette}");
        assert_eq!((done.created, done.removed, done.parses), (0, 0, 0), "{done:?}");
        assert_ne!(harness.app.render(), before);
        if palette {
            let seen = board(|board| board.palettes.clone());
            assert_eq!(seen.len(), palettes + 1);
            assert_ne!(seen[palettes - 1], seen[palettes], "the palette did not change");
        }
    }
}

/// A plugin whose route shows a tool call's output of `ses_p` by reference, and a call the transcript lacks.
fn parts(setup: &mut abi::Setup) -> Result<(), String> {
    let part = |part: &str| v2::Node::Markdown {
        id: None,
        source: v2::Source::PartOutput(v2::PartRef { session: "ses_p".into(), part: part.into() }),
    };
    setup.surface(v2::Surface::new("parts", v2::Place::Route("parts".into()), move |_| {
        v2::Node::column(vec![part("call_1"), part("call_9"), v2::Node::text(vec![abi::Span::new("end")])])
    }));
    Ok(())
}

// Expected: a tool call's output named by reference shows the transcript's own text, which never crosses to the
// plugin; a call the transcript does not have shows nothing.
#[test]
fn a_part_output_shows_the_transcripts_own_text() {
    let session = support::merge(support::session("ses_p", "Parts"), serde_json::json!({ "agent": "build" }));
    let messages = serde_json::json!([
        {
            "id": "msg_2", "type": "assistant", "agent": "build",
            "model": { "providerID": "provider", "id": "model" },
            "time": { "created": 1500, "completed": 4000 }, "finish": "stop",
            "content": [
                { "type": "text", "id": "t1", "text": "part one says hello" },
                {
                    "type": "tool", "id": "call_1", "name": "read", "time": { "created": 1600, "completed": 1700 },
                    "state": { "status": "completed", "input": {}, "content": [{ "type": "text", "text": "tool said fn parse" }] },
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
        builtins: vec![abi::Plugin { id: "test.parts", setup: parts }.into()],
        ..support::deps(Arc::new(fake))
    };
    let harness = support::mount(80, 24, deps);
    harness.wait_for("part one says hello");
    harness.tui.navigate(Route::Plugin { id: "test.parts".into(), name: "parts".into() });
    let screen = harness.wait_for("tool said fn parse");
    let lines: Vec<&str> = screen.lines().map(str::trim).filter(|line| !line.is_empty()).collect();
    assert_eq!(lines, ["tool said fn parse", "end"], "{screen}");
}
