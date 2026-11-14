//! `carrier-equal` (P4, synthesis 4.14) with a real library: one plugin source, `crates/plugin/examples/board`, runs
//! linked (its `board.rs` is this module's `board`), through the C ABI's byte shims in this process, and as the
//! `cdylib` that crate builds, with its own std and allocator, loaded from a `plugins` directory. At every checkpoint
//! the three give equal frames (cells with their styles), and the same toasts and plugin status. The board's header
//! is its own call log: views run, cards built, messages arrived.
//!
//! The script covers a mount, revisions with memoized cards and the meter canvas they draw again, an animation of the
//! meter, whose time crosses with each frame, a theme change, an effect, bursts of messages from the plugin's thread, a
//! remount, and a panic on the plugin's own thread, which is reported once. The script is the same
//! input on every carrier: each burst is all in the mailbox before the UI thread runs again, so the drains, and the
//! views they cause, do not depend on how the threads are scheduled (review bigboi-6: comparing a flood that raced
//! the UI failed in 12 of 24 runs). A flood that waits on `Full` races by design; its own test compares only what does
//! not depend on the schedule.

#[path = "../../../plugin/examples/board/src/board.rs"]
mod board;

use crate::plugin_surface::{CARRIERS, Carrier, builtin};
use crate::support::{self, Harness};

use std::path::Path;
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use opencode_plugin::abi;
use opencode_plugin::loader::entry_file;
use opencode_tui::plugins::host::{External, external};
use opencode_tui::{Deps, Route};

const ID: &str = "example.board";

/// The board built as a `cdylib`, once per test run.
pub fn library() -> Vec<u8> {
    static BUILT: Mutex<Option<Vec<u8>>> = Mutex::new(None);
    let mut built = BUILT.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(library) = &*built {
        return library.clone();
    }
    let crate_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../plugin/examples/board");
    let target = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/board-plugin");
    let status = Command::new(std::env::var("CARGO").unwrap_or_else(|_| "cargo".to_owned()))
        .args(["build", "--quiet", "--manifest-path"])
        .arg(crate_dir.join("Cargo.toml"))
        .arg("--target-dir")
        .arg(&target)
        .status()
        .unwrap();
    assert!(status.success(), "the board plugin did not build");
    let name = format!("{}opencode_board{}", std::env::consts::DLL_PREFIX, std::env::consts::DLL_SUFFIX);
    let library = std::fs::read(target.join("debug").join(name)).unwrap();
    *built = Some(library.clone());
    library
}

/// A carrier of this test: one of the in-process ones, or the real library.
#[derive(Clone, Copy, Debug)]
enum Run {
    In(Carrier),
    Library,
}

struct Board {
    harness: Harness,
    _root: Option<opencode_util::temp::TempDir>,
}

fn open(run: Run) -> Board {
    let plugin = abi::Plugin { id: ID, setup: board::setup };
    let mut deps = Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) };
    if let Run::In(carrier) = run {
        deps.builtins.push(builtin(carrier, plugin));
    }
    let harness = support::mount(80, 30, deps);
    // The meter animates only while the client's animations run.
    opencode_ui::motion::set_running(&harness.app, true);
    let root = matches!(run, Run::Library).then(|| {
        let root = opencode_util::temp::tempdir().unwrap();
        let config = root.path().join("config");
        let dir = config.join("plugins").join("board");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(entry_file()), library()).unwrap();
        external(&harness.tui, External { config_dir: config, cwd: root.path().to_path_buf(), dev: Vec::new() });
        root
    });
    settle(&harness);
    Board { harness, _root: root }
}

fn settle(harness: &Harness) {
    for _ in 0..3 {
        harness.app.advance(Duration::from_millis(1));
    }
}

/// What a checkpoint compares: the frame's cells, the toasts shown since the last one, and the plugin's status.
type Seen = (Vec<opentui::testing::Cell>, Vec<String>, String);

fn observe(harness: &Harness) -> Seen {
    let tui = &harness.tui;
    let mut toasts = Vec::new();
    while let Some(toast) = tui.toasts.current() {
        toasts.push(format!("{:?} {:?} {}", toast.variant, toast.title, toast.message));
        tui.toasts.dismiss();
    }
    settle(harness);
    let status = tui.plugins.entries().into_iter().find(|entry| entry.id == ID).map(|entry| entry.status);
    (harness.app.render().cells, toasts, format!("{status:?}"))
}

/// Runs the script on `run`, and returns what each checkpoint saw.
fn script(run: Run) -> Vec<(&'static str, Seen)> {
    let board = open(run);
    let (app, tui) = (&board.harness.app, &board.harness.tui);
    let route = Route::Plugin { id: ID.to_owned(), name: "board".to_owned() };
    let dispatch = |name: &str, input: Option<&str>| {
        tui.keymap.dispatch(name, input);
        settle(&board.harness);
    };
    let mut seen = Vec::new();
    tui.navigate(route.clone());
    settle(&board.harness);
    // The cards' scroll takes the page below the header: a growing scroll in a route has rows (P1's full-page route).
    let screen = board.harness.app.render().text();
    let cards = screen.lines().filter(|line| line.trim_start().starts_with("card ")).count();
    assert!(cards >= 3, "{run:?}: the cards' scroll shows {cards} cards");
    assert!(screen.contains("40x2 First 0 ms"), "{run:?}: the meter did not draw:\n{screen}");
    seen.push(("open", observe(&board.harness)));
    dispatch("board.bump", Some("2"));
    dispatch("board.bump", Some("2"));
    dispatch("board.bump", Some("5"));
    seen.push(("bumped", observe(&board.harness)));
    dispatch("board.animate", None);
    for _ in 0..4 {
        app.advance(Duration::from_millis(16));
        app.render();
    }
    seen.push(("animated", observe(&board.harness)));
    dispatch("board.animate", None);
    tui.theme.borrow_mut().set("tokyonight");
    tui.theme_changed();
    settle(&board.harness);
    seen.push(("theme", observe(&board.harness)));
    dispatch("board.toast", None);
    seen.push(("toast", observe(&board.harness)));
    // Three bursts, each all in the mailbox before the UI thread runs: one drain, one view each.
    for burst in 1..=3 {
        tui.keymap.dispatch("board.burst", Some("200"));
        let queued = || opencode_plugin::mailbox::stats(ID).is_some_and(|stats| stats.waiting == 200);
        let begun = std::time::Instant::now();
        while !queued() {
            assert!(begun.elapsed() < Duration::from_secs(10), "{run:?}: burst {burst} never queued");
            std::thread::yield_now();
        }
        settle(&board.harness);
    }
    seen.push(("bursts", observe(&board.harness)));
    tui.navigate(Route::Home);
    settle(&board.harness);
    tui.navigate(route);
    settle(&board.harness);
    seen.push(("remount", observe(&board.harness)));
    dispatch("board.thread-panic", None);
    board.harness.wait("the thread's panic failed the plugin", || {
        app.advance(Duration::from_millis(1));
        tui.plugins
            .entries()
            .iter()
            .any(|entry| entry.id == ID && matches!(entry.status, opencode_plugin::Status::Failed(_)))
    });
    seen.push(("thread panic", observe(&board.harness)));
    // Later frames report nothing more.
    for _ in 0..5 {
        app.advance(Duration::from_millis(16));
    }
    seen.push(("after", observe(&board.harness)));
    seen
}

/// The board's cards on screen after a flood of `count`, with what is left of the frame dropped: the header counts views
/// and builds, which follow when the UI thread drained.
fn flood(run: Run, count: usize) -> (Vec<String>, usize) {
    let board = open(run);
    let (app, tui) = (&board.harness.app, &board.harness.tui);
    tui.navigate(Route::Plugin { id: ID.to_owned(), name: "board".to_owned() });
    settle(&board.harness);
    tui.keymap.dispatch("board.flood", Some(&count.to_string()));
    board.harness.wait("the flood arrived", || {
        app.advance(Duration::from_millis(1));
        app.text().contains(&format!("messages {count}"))
    });
    let cards = app.text().lines().filter(|line| line.contains("card ")).map(|line| line.trim().to_owned()).collect();
    (cards, opencode_plugin::mailbox::stats(ID).unwrap().high)
}

// Expected (`backlog` on every carrier): a flood of four times the bound, whose thread waits on `Full`, delivers every
// message, leaves the same cards on every carrier, and never holds more than the bound, however the UI drains it.
#[test]
fn a_flood_ends_the_same_on_every_carrier() {
    let (linked, high) = flood(Run::In(Carrier::Linked), 4 * abi::BOUND);
    assert!(high <= abi::BOUND, "the mailbox held {high}");
    assert!(linked.iter().any(|line| line == &format!("card 0: {}", 4 * abi::BOUND / board::CARDS + 1)), "{linked:?}");
    for run in [Run::In(CARRIERS[1]), Run::Library] {
        let (cards, high) = flood(run, 4 * abi::BOUND);
        assert!(high <= abi::BOUND, "{run:?}: the mailbox held {high}");
        assert_eq!(cards, linked, "{run:?}");
    }
}

// Expected (`carrier-equal`, and a thread's panic in `reported-once`): the board gives the same frames, toasts and
// status linked, through the byte shims, and as a real library; the flood never holds more than the bound; the
// thread's panic fails the plugin with one toast, and later frames add none.
#[test]
fn one_source_is_equal_on_every_carrier() {
    let linked = script(Run::In(Carrier::Linked));
    // The guard: the checkpoints see different frames, so equal runs are not equal by being empty.
    assert_ne!(linked[0].1.0, linked[1].1.0, "a bump changed nothing on screen");
    let (_, (_, toasts, status)) = linked.iter().find(|(name, _)| *name == "thread panic").unwrap();
    assert_eq!(toasts.len(), 1, "{toasts:?}");
    assert!(toasts[0].contains("Plugin failed: example.board"), "{toasts:?}");
    assert!(status.contains("thread boom panicked: the board's thread panicked"), "{status}");
    let (_, (_, after, _)) = linked.last().unwrap();
    assert!(after.is_empty(), "a failure was reported again: {after:?}");
    let (_, (_, toasts, _)) = linked.iter().find(|(name, _)| *name == "toast").unwrap();
    assert_eq!(toasts.len(), 1, "{toasts:?}");
    for run in [Run::In(CARRIERS[1]), Run::Library] {
        let other = script(run);
        for ((name, linked), (_, other)) in linked.iter().zip(&other) {
            assert_eq!(linked.1, other.1, "{run:?} at {name}: toasts");
            assert_eq!(linked.2, other.2, "{run:?} at {name}: status");
            if linked.0 != other.0 {
                panic!("{run:?} at {name}: the frames differ");
            }
        }
    }
}

// Expected (`carrier-equal` for a contained panic, P4c): a panic in a command of the board's route is caught where it
// happens and fails the plugin once, naming the call, with the same frames, toasts and status linked, through the
// byte shims, and as a real library; later frames add nothing.
#[test]
fn a_contained_panic_is_equal_on_every_carrier() {
    let run = |run: Run| {
        let board = open(run);
        let tui = &board.harness.tui;
        tui.navigate(Route::Plugin { id: ID.to_owned(), name: "board".to_owned() });
        settle(&board.harness);
        let open = observe(&board.harness);
        tui.keymap.dispatch("board.panic", None);
        settle(&board.harness);
        let failed = observe(&board.harness);
        for _ in 0..5 {
            board.harness.app.advance(Duration::from_millis(16));
        }
        [open, failed, observe(&board.harness)]
    };
    let linked = run(Run::In(Carrier::Linked));
    let (_, toasts, status) = &linked[1];
    assert_eq!(toasts.len(), 1, "{toasts:?}");
    assert!(status.contains("run-command panicked: the board's command panicked"), "{status}");
    assert!(linked[2].1.is_empty(), "a failure was reported again: {:?}", linked[2].1);
    assert_ne!(linked[0].0, linked[1].0, "the failed route still shows");
    for other in [Run::In(CARRIERS[1]), Run::Library] {
        for (at, (linked, seen)) in linked.iter().zip(run(other)).enumerate() {
            assert_eq!((&linked.1, &linked.2), (&seen.1, &seen.2), "{other:?} at {at}: toasts and status");
            assert!(linked.0 == seen.0, "{other:?} at {at}: the frames differ");
        }
    }
}

// Expected (`carrier-equal` for a canvas's draw, and a panicking draw contained, P4c): the meter draws at its size,
// again for a version, and once a frame while it animates, with the animation's time; a draw that panics is caught
// where it happens and fails the plugin once, naming the draw, with the same frames, toasts and status linked, through
// the byte shims, and as a real library; later frames add nothing.
#[test]
fn a_panicking_draw_is_contained_on_every_carrier() {
    let run = |run: Run| {
        let board = open(run);
        let tui = &board.harness.tui;
        let work = opencode_plugin::canvas::work();
        tui.navigate(Route::Plugin { id: ID.to_owned(), name: "board".to_owned() });
        settle(&board.harness);
        let open = observe(&board.harness);
        tui.keymap.dispatch("board.draw-panic", None);
        settle(&board.harness);
        // The draw runs as the meter paints; the failure it caused shows from the frame after.
        board.harness.app.render();
        settle(&board.harness);
        let failed = observe(&board.harness);
        for _ in 0..5 {
            board.harness.app.advance(Duration::from_millis(16));
        }
        let done = opencode_plugin::canvas::work().since(work);
        ([open, failed, observe(&board.harness)], (done.draws, done.lists))
    };
    let (linked, work) = run(Run::In(Carrier::Linked));
    // The first draw, and the one that panicked, which ran.
    assert_eq!(work, (2, 1), "draws and lists");
    let (_, toasts, status) = &linked[1];
    assert_eq!(toasts.len(), 1, "{toasts:?}");
    assert!(status.contains("draw panicked: the board's draw panicked"), "{status}");
    assert!(linked[2].1.is_empty(), "a failure was reported again: {:?}", linked[2].1);
    assert_ne!(linked[0].0, linked[1].0, "the failed route still shows");
    for other in [Run::In(CARRIERS[1]), Run::Library] {
        let (seen, counted) = run(other);
        assert_eq!(counted, work, "{other:?}: draws and lists");
        for (at, (linked, seen)) in linked.iter().zip(seen).enumerate() {
            assert_eq!((&linked.1, &linked.2), (&seen.1, &seen.2), "{other:?} at {at}: toasts and status");
            assert!(linked.0 == seen.0, "{other:?} at {at}: the frames differ");
        }
    }
}

/// The board's `files` route on `run`: a windowed list whose estimates are not its files' heights, through a `To`, hunk
/// steps, a `Nearest`, the wheel and a resize. Each checkpoint's frame shows the offset, the header `layout` painted
/// from the top file, where the last step landed, and how many `layout` calls ran.
fn files(run: Run) -> Vec<(&'static str, Seen)> {
    let board = open(run);
    let (app, tui) = (&board.harness.app, &board.harness.tui);
    let dispatch = |name: &str, input: Option<&str>| {
        tui.keymap.dispatch(name, input);
        settle(&board.harness);
    };
    tui.navigate(Route::Plugin { id: ID.to_owned(), name: "files".to_owned() });
    settle(&board.harness);
    let mut seen = vec![("open", observe(&board.harness))];
    dispatch("files.to", Some("40"));
    seen.push(("to", observe(&board.harness)));
    for _ in 0..3 {
        dispatch("files.step", Some("1"));
    }
    seen.push(("steps", observe(&board.harness)));
    dispatch("files.step", Some("-2"));
    seen.push(("back", observe(&board.harness)));
    // The reads show in the next view, which the `Nearest` causes.
    dispatch("files.read", None);
    dispatch("files.near", Some("12"));
    seen.push(("near", observe(&board.harness)));
    for _ in 0..4 {
        app.scroll(10, 10, true);
    }
    settle(&board.harness);
    seen.push(("wheel", observe(&board.harness)));
    app.resize(60, 24);
    settle(&board.harness);
    seen.push(("resize", observe(&board.harness)));
    seen
}

// Expected (`carrier-equal` for P3, synthesis 4.14): the same source's windowed list gives the same frames linked,
// through the byte shims, and as a real library: a `To` lands its file at the top, steps land on hunks of files that
// had no widgets and report where, the reads see the steps' last file at the top, `Nearest` and the wheel move the
// list, and `layout`, told the header's width, paints the header from the top file in the frame of each.
#[test]
fn a_windowed_list_is_equal_on_every_carrier() {
    let linked = files(Run::In(Carrier::Linked));
    let text = |cells: &[opentui::testing::Cell]| cells.iter().map(|cell| cell.symbol.as_str()).collect::<String>();
    let to = text(&linked[1].1.0);
    assert!(to.contains("file 40") && !to.contains("file 39 "), "the `To` did not bring file 40 to the top");
    assert!(text(&linked[2].1.0).contains("landed d4"), "the steps reported no landing");
    assert!(!text(&linked[2].1.0).contains("told -"), "`layout` was told no width");
    assert_ne!(linked[0].1.0, linked[1].1.0, "the `To` changed nothing on screen");
    let near = text(&linked[4].1.0);
    assert!(near.contains(" of 60 top f41"), "the reads read nothing: {near}");
    for run in [Run::In(CARRIERS[1]), Run::Library] {
        for ((name, linked), (_, other)) in linked.iter().zip(&files(run)) {
            assert_eq!((&linked.1, &linked.2), (&other.1, &other.2), "{run:?} at {name}: toasts and status");
            if linked.0 != other.0 {
                panic!("{run:?} at {name}: the frames differ:\n{}\n{}", text(&linked.0), text(&other.0));
            }
        }
    }
}

// Expected (`carrier-equal` for input, P2): the route's handler takes a key, passes one on to the plugin's own global
// layer, sets a mode whose layer takes the same key for another card and reads it back, and ends it; then a handler's
// panic fails the plugin once, naming the call. The frames, toasts and status are the same linked, through the byte
// shims, and as a real library.
#[test]
fn input_is_equal_on_every_carrier() {
    let run = |run: Run| {
        let board = open(run);
        let (app, tui) = (&board.harness.app, &board.harness.tui);
        tui.navigate(Route::Plugin { id: ID.to_owned(), name: "board".to_owned() });
        settle(&board.harness);
        let mut seen = Vec::new();
        for key in ["j", "h", "m", "j", "m", "j", "p"] {
            app.press(key);
            settle(&board.harness);
            let keys =
                app.text().lines().find_map(|line| line.split_once(" keys ").map(|(_, keys)| keys.trim().to_owned()));
            seen.push((key, keys, observe(&board.harness)));
        }
        seen
    };
    let linked = run(Run::In(Carrier::Linked));
    assert_eq!(
        linked[5].1.as_deref(),
        Some("bump help global move shift@move done@move bump"),
        "a key, a pass and a mode"
    );
    let (_, _, (_, toasts, status)) = linked.last().unwrap();
    assert_eq!(toasts.len(), 1, "{toasts:?}");
    assert!(status.contains("handle panicked: the board's handler panicked"), "{status}");
    for other in [Run::In(CARRIERS[1]), Run::Library] {
        for ((key, _, linked), (_, _, seen)) in linked.iter().zip(run(other)) {
            assert_eq!((&linked.1, &linked.2), (&seen.1, &seen.2), "{other:?} after {key}: toasts and status");
            assert!(linked.0 == seen.0, "{other:?} after {key}: the frames differ");
        }
    }
}
