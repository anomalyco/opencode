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
use opentui::widget::Widget;

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
    Some(Failure { property, site: property, step, detail })
}

// Expected: a surface's mounts get views only while they show, each with a generation of its own whose first view
// builds whole; a refused tree is asked again whole at once and leaves the plugin active; a theme change calls no
// view and rebuilds nothing; and what a mount held goes with it.
#[test]
fn surface_mounts_hold_their_properties() {
    model::check(&Surfaces, 40, 32);
}

/// The cells of the route after `commands`, with a plugin that reads the palette or not.
fn frame_cells(commands: &[Command], palette: bool) -> Vec<opentui::testing::Cell> {
    board(|board| *board = Board { values: vec![0; ITEMS], palette, ..Board::default() });
    let harness = open_tui();
    for command in commands {
        apply(&harness, *command);
    }
    harness.app.render().cells
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
// widgets take the theme in place, kept cards included; one that reads the palette gets one view, with the new
// palette. Either way the route draws as one opened in the new theme.
#[test]
fn a_theme_change_calls_only_a_surface_that_reads_the_palette() {
    for palette in [false, true] {
        let fresh = frame_cells(&[Command::Theme(1), Command::Open, Command::Bump(2)], palette);
        board(|board| *board = Board { values: vec![0; ITEMS], palette, ..Board::default() });
        let harness = open_tui();
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

/// A plugin of ABI 1.x whose route shows one text in the theme's muted color.
fn plain(setup: &mut abi::Setup) -> Result<(), String> {
    setup.route("plain", |_, _| abi::Render::Show(abi::Node::text([abi::Span::new("plain words").fg("text.muted")])));
    Ok(())
}

// Expected: a theme switch on a plugin's route of ABI 1.x paints the route in the new theme in place: its text in the
// new muted color and its page in the new background, with the same widgets.
#[test]
fn a_route_of_abi_1_takes_a_new_theme_in_place() {
    let deps = Deps {
        route: Route::Home,
        builtins: vec![abi::Plugin { id: "test.plain", setup: plain }.into()],
        ..support::deps(Arc::new(support::empty()))
    };
    let harness = support::mount(80, 24, deps);
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
    let harness = support::mount(80, 24, deps);
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
    /// The replies `test.owned` got.
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
    let harness = support::mount(80, 24, deps);
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
        host.fetch(abi::Fetch { method: "GET".into(), path: "/api/hold".into(), query: Vec::new(), body: None });
    };
    let command = |name: &str, scope| abi::Command { name: name.into(), scope, ..abi::Command::default() };
    setup.command(command("owned.route", abi::Scope::Route("owned".into())), fetch);
    setup.command(command("owned.global", abi::Scope::Global), fetch);
    setup.on_reply(|_, _, result| REPLIES.with(|replies| replies.borrow_mut().push(format!("{result:?}"))));
    setup.surface(v2::Surface::new("owned", v2::Place::Route("owned".into()), |_| {
        v2::Node::text(vec![abi::Span::new("owned route")])
    }));
    Ok(())
}

// Expected (`lifecycle`, mounts): what a mount's own command asked for ends with that mount: a reply that arrives
// after the route closed and opened again under the same key reaches the plugin no more. What the plugin's global
// command asked for is the plugin's, and arrives.
#[test]
fn a_late_reply_does_not_reach_a_mount_opened_again() {
    use std::sync::{Condvar, Mutex};
    REPLIES.with(|replies| replies.borrow_mut().clear());
    let gate = Arc::new((Mutex::new(false), Condvar::new()));
    let served = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let fake = {
        let (gate, served) = (gate.clone(), served.clone());
        support::Fake::new(move |seen| {
            if seen.path != "/api/hold" {
                return support::base(seen, support::DIRECTORY);
            }
            let (open, wake) = &*gate;
            let open = wake.wait_timeout_while(open.lock().unwrap(), Duration::from_secs(10), |open| !*open).unwrap();
            drop(open);
            served.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            (200, serde_json::json!({ "held": true }))
        })
    };
    let deps = Deps {
        route: Route::Home,
        builtins: vec![abi::Plugin { id: "test.owned", setup: owned }.into()],
        ..support::deps(Arc::new(fake))
    };
    let harness = support::mount(80, 24, deps);
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
    assert!(REPLIES.with(|replies| replies.borrow().is_empty()), "a reply reached a mount opened again");
    let _ = harness.tui.keymap.dispatch("owned.global", None);
    arrived(2);
    assert_eq!(REPLIES.with(|replies| replies.borrow().len()), 1, "the plugin's own reply did not arrive");
}

thread_local! {
    /// The sizes the views of `test.room` were given, by surface.
    static ROOM: RefCell<Vec<(&'static str, u16, u16)>> = const { RefCell::new(Vec::new()) };
}

/// A route of a title over a growing scroll of 40 rows, and a claim in the footer's status row that grows; both log
/// their input size.
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
        v2::Node::text(vec![abi::Span::new("room tag")]).layout(abi::Layout::default().grow().min_width_zero())
    }));
    Ok(())
}

// Expected: a 2.0 route has the whole page: its growing scroll shows rows and the wheel moves them, and after a resize
// its view gets the new size. A slot surface's view gets the room its slot gives it, not the terminal's.
#[test]
fn a_surface_gets_the_room_it_is_given() {
    ROOM.with(|room| room.borrow_mut().clear());
    let deps = Deps {
        route: Route::Home,
        builtins: vec![abi::Plugin { id: "test.room", setup: room }.into()],
        ..support::deps(Arc::new(support::empty()))
    };
    let harness = support::mount(80, 24, deps);
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
