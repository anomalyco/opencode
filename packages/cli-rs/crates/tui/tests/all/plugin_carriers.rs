//! Drive one plugin linked, through the ABI shims, and as a loaded library. Compare cells, events, and request effects.

#[path = "../../../plugin/examples/board/src/board.rs"]
mod board;

use crate::plugin_surface::{CARRIERS, Carrier, builtin};
use crate::support::{self, Harness};

use std::cell::Cell;
use std::path::Path;
use std::process::Command;
use std::rc::Rc;
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
    open_on(run, 80, Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) })
}

fn open_on(run: Run, width: u16, mut deps: Deps) -> Board {
    let plugin = abi::Plugin { id: ID, setup: board::setup };
    if let Run::In(carrier) = run {
        deps.builtins.push(builtin(carrier, plugin));
    }
    let harness = support::mount(width, 30, deps);
    let still = std::time::Instant::now();
    harness.tui.plugins.monitor().set_clock(move || still);
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
        // A panel or an overlay draws first at its first layout.
        harness.app.render();
    }
    crate::plugin_mail::drain(harness);
}

/// Cells, newly shown toasts, and plugin status at a checkpoint.
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
    tui.navigate(Route::Home);
    settle(&board.harness);
    app.type_text("/inspect");
    settle(&board.harness);
    app.press("return");
    settle(&board.harness);
    let screen = app.render().text();
    assert!(screen.contains("Name the board") && screen.contains("/tmp/board"), "{run:?}: no prompt:\n{screen}");
    app.type_text("s");
    app.press("return");
    settle(&board.harness);
    tui.navigate(route.clone());
    settle(&board.harness);
    let screen = app.render().text();
    // `max_width` wraps the row at 30 cells: its first 30 and the next line make the whole text, wherever the locale's
    // and the offset's lengths put the break (a toast may cover the rest of either row).
    let lines: Vec<&str> = screen.lines().collect();
    let wrapped = lines.windows(2).any(|pair| {
        let first: String = pair[0].chars().take(30).collect();
        let Some((rest, _)) = pair[1].split_once("graphemes") else { return false };
        let text = format!("{} {rest}graphemes", first.trim_end());
        text.starts_with("locale ") && text.contains(", offset ") && text.ends_with(" s, 8 cells, 5 graphemes")
    });
    assert!(wrapped, "{run:?}: no facts:\n{screen}");
    seen.push(("facts", observe(&board.harness)));
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
        app.render();
        tui.plugins
            .entries()
            .iter()
            .any(|entry| entry.id == ID && matches!(entry.status, opencode_plugin::Status::Failed(_)))
    });
    seen.push(("thread panic", observe(&board.harness)));
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
    let (_, (_, toasts, _)) = linked.iter().find(|(name, _)| *name == "facts").unwrap();
    assert!(toasts.iter().any(|toast| toast.contains("named boards")), "the prompt's value was not edited: {toasts:?}");
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

#[test]
fn a_commands_state_change_tells_the_keymaps_listeners() {
    let board = open(Run::In(Carrier::Linked));
    let tui = &board.harness.tui;
    let heard = Rc::new(Cell::new(0));
    let counted = heard.clone();
    let _listening = tui.keymap.keymap().on_state(move || counted.set(counted.get() + 1));
    for gate in ["on", "off"] {
        let before = heard.get();
        tui.keymap.dispatch("board.gate", Some(gate));
        settle(&board.harness);
        assert!(heard.get() > before, "the keymap's listeners did not hear `board.hotkey` turned {gate}");
    }
}

#[test]
fn a_command_is_disabled_and_declines_alike_on_every_carrier() {
    let script = |run: Run| {
        let board = open(run);
        let (app, tui) = (&board.harness.app, &board.harness.tui);
        let dispatch = |name: &str, input: Option<&str>| {
            tui.keymap.dispatch(name, input);
            settle(&board.harness);
        };
        let listed = || tui.keymap.commands().iter().any(|command| command.id == "board.hotkey");
        let mut seen = Vec::new();
        for (step, gate) in [("disabled", None), ("enabled", Some("on")), ("passing", None), ("off", Some("off"))] {
            match (step, gate) {
                ("passing", _) => dispatch("board.passing", None),
                (_, Some(gate)) => dispatch("board.gate", Some(gate)),
                _ => {}
            }
            let shown = listed();
            app.press("ctrl+p");
            settle(&board.harness);
            let toasts: Vec<String> = std::iter::from_fn(|| {
                let toast = tui.toasts.current()?;
                tui.toasts.dismiss();
                Some(toast.message)
            })
            .collect();
            seen.push((step, shown, tui.dialogs.is_open(), toasts));
            if tui.dialogs.is_open() {
                app.press("escape");
                settle(&board.harness);
            }
        }
        seen
    };
    let linked = script(Run::In(Carrier::Linked));
    let hotkey = |text: &str| vec![text.to_owned()];
    assert_eq!(
        linked,
        [
            ("disabled", false, true, Vec::new()),
            ("enabled", true, false, hotkey("hotkey")),
            ("passing", true, true, hotkey("hotkey passed")),
            ("off", false, true, Vec::new()),
        ]
    );
    for run in [Run::In(CARRIERS[1]), Run::Library] {
        assert_eq!(script(run), linked, "{run:?}");
    }
}

#[test]
fn a_listener_takes_its_key_alike_on_every_carrier() {
    let script = |run: Run| {
        let board = open(run);
        let (app, tui) = (&board.harness.app, &board.harness.tui);
        let mut seen = Vec::new();
        for (step, arm) in [("passing", "off"), ("taking", "on"), ("passing again", "off")] {
            tui.keymap.dispatch("board.listen", Some(arm));
            settle(&board.harness);
            app.press("ctrl+p");
            settle(&board.harness);
            let toasts: Vec<String> = std::iter::from_fn(|| {
                let toast = tui.toasts.current()?;
                tui.toasts.dismiss();
                Some(toast.message)
            })
            .collect();
            seen.push((step, tui.dialogs.is_open(), toasts));
            if tui.dialogs.is_open() {
                app.press("escape");
                settle(&board.harness);
            }
        }
        seen
    };
    let linked = script(Run::In(Carrier::Linked));
    assert_eq!(
        linked,
        [
            ("passing", true, Vec::new()),
            ("taking", false, vec!["listener took ctrl+p".to_owned()]),
            ("passing again", true, Vec::new()),
        ]
    );
    for run in [Run::In(CARRIERS[1]), Run::Library] {
        assert_eq!(script(run), linked, "{run:?}");
    }
}

#[test]
fn a_selects_actions_are_alike_on_every_carrier() {
    let script = |run: Run| {
        let board = open(run);
        let (app, tui) = (&board.harness.app, &board.harness.tui);
        tui.keymap.dispatch("board.choose", None);
        settle(&board.harness);
        let mut seen = Vec::new();
        for key in ["down", "ctrl+o", "ctrl+a"] {
            app.press(key);
            seen.push((key, tui.dialogs.is_open(), observe(&board.harness), app.text()));
        }
        seen
    };
    let linked = script(Run::In(Carrier::Linked));
    let screen = &linked[0].3;
    assert!(screen.contains("Open") && screen.contains("ctrl+o") && screen.contains("Close"), "{screen}");
    let toasts: Vec<_> = linked.iter().map(|(key, open, (_, toasts, _), _)| (*key, *open, toasts.clone())).collect();
    let toast = |text: &str| vec![format!("Info None chose {text}")];
    assert_eq!(toasts, [("down", true, Vec::new()), ("ctrl+o", true, toast("1")), ("ctrl+a", true, toast("none"))]);
    for run in [Run::In(CARRIERS[1]), Run::Library] {
        for ((key, _, linked, _), (_, _, seen, _)) in linked.iter().zip(script(run)) {
            assert_eq!((&linked.1, &linked.2), (&seen.1, &seen.2), "{run:?} after {key}: toasts and status");
            assert!(linked.0 == seen.0, "{run:?} after {key}: the frames differ");
        }
    }
}

#[test]
fn a_bottom_border_title_is_alike_on_every_carrier() {
    let script = |run: Run| {
        let board = open(run);
        let tui = &board.harness.tui;
        tui.navigate(Route::Plugin { id: ID.to_owned(), name: "board".to_owned() });
        tui.keymap.dispatch("board.titled", None);
        settle(&board.harness);
        (observe(&board.harness), board.harness.app.text())
    };
    let (linked, screen) = script(Run::In(Carrier::Linked));
    let top = screen.lines().position(|line| line.contains("┌─top─")).expect(&screen);
    let bottom = screen.lines().nth(top + 2).unwrap_or_default();
    assert!(bottom.trim_end().ends_with("bottom─┘"), "{screen}");
    for run in [Run::In(CARRIERS[1]), Run::Library] {
        let (seen, _) = script(run);
        assert!(linked == seen, "{run:?}: the frames, toasts or status differ");
    }
}

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

#[test]
fn a_task_awaits_a_confirm_then_a_fetch_on_every_carrier() {
    let run = |run: Run| {
        let board = open(run);
        let (app, tui) = (&board.harness.app, &board.harness.tui);
        tui.navigate(Route::Plugin { id: ID.to_owned(), name: "board".to_owned() });
        settle(&board.harness);
        let mut seen = Vec::new();
        tui.keymap.dispatch("board.ask", None);
        settle(&board.harness);
        seen.push(("asking", app.render().text(), observe(&board.harness)));
        app.press("return");
        board.harness.wait("the fetch's reply", || {
            app.advance(Duration::from_millis(1));
            tui.toasts.current().is_some()
        });
        seen.push(("counted", app.render().text(), observe(&board.harness)));
        tui.keymap.dispatch("board.ask", None);
        settle(&board.harness);
        app.press("escape");
        settle(&board.harness);
        seen.push(("declined", app.render().text(), observe(&board.harness)));
        seen
    };
    let linked = run(Run::In(Carrier::Linked));
    let at = |name: &str| linked.iter().find(|seen| seen.0 == name).unwrap();
    assert!(at("asking").1.contains("Count the sessions?"), "the confirm did not open: {}", at("asking").1);
    assert!(at("asking").2.1.is_empty(), "{:?}", at("asking").2.1);
    assert_eq!(at("counted").2.1, ["Info None asked Some(true), counted Ok(0)"]);
    assert!(at("counted").1.contains("card 5: 2"), "the answers bumped no card: {}", at("counted").1);
    assert!(!at("counted").1.contains("Count the sessions?"), "the confirm stayed open");
    assert_eq!(at("declined").2.1, ["Info None asked Some(false)"]);
    for other in [Run::In(CARRIERS[1]), Run::Library] {
        for ((name, _, linked), (_, text, seen)) in linked.iter().zip(run(other)) {
            assert_eq!((&linked.1, &linked.2), (&seen.1, &seen.2), "{other:?} at {name}: toasts and status");
            assert!(linked.0 == seen.0, "{other:?} at {name}: the frames differ:\n{text}");
        }
    }
}

#[test]
fn a_tasks_dialog_the_host_refuses_answers_it_with_none_on_every_carrier() {
    let run = |run: Run| {
        let board = open(run);
        let (app, tui) = (&board.harness.app, &board.harness.tui);
        let options =
            opencode_ui::dialog::DialogOptions::new(opencode_ui::dialog::DialogSize::Medium).key("host.plugins");
        tui.dialogs.replace(|cx| opentui::prelude::View::new(&cx.app), None, options);
        tui.keymap.dispatch("board.ask", None);
        board.harness.wait("the refused confirm's answer", || {
            app.advance(Duration::from_millis(1));
            tui.toasts.current().is_some()
        });
        assert_eq!(tui.dialogs.key().as_deref(), Some("host.plugins"), "{run:?}: the host's list was replaced");
        observe(&board.harness).1
    };
    for carrier in [Run::In(Carrier::Linked), Run::In(CARRIERS[1]), Run::Library] {
        assert_eq!(run(carrier), ["Info None asked None"], "{carrier:?}");
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

#[test]
fn input_is_equal_on_every_carrier() {
    let run = |run: Run| {
        let board = open(run);
        let (app, tui) = (&board.harness.app, &board.harness.tui);
        tui.navigate(Route::Plugin { id: ID.to_owned(), name: "board".to_owned() });
        settle(&board.harness);
        let mut seen = Vec::new();
        for key in ["j", "alt+h", "m", "j", "m", "j", "p"] {
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

#[test]
fn panels_overlays_and_reads_are_equal_on_every_carrier() {
    let run = |run: Run| {
        let session = support::Fake::new(|seen| support::base(seen, support::DIRECTORY));
        let board = open_on(run, 120, support::deps(Arc::new(session)));
        let (app, tui) = (&board.harness.app, &board.harness.tui);
        // Wait for the host's catalog first so its redraw is not attributed to plugin work.
        board.harness.wait_for("Model M");
        settle(&board.harness);
        let mut seen = Vec::new();
        let step = |name: &'static str, seen: &mut Vec<_>| {
            settle(&board.harness);
            seen.push((name, app.render().text(), observe(&board.harness)));
        };
        tui.keymap.dispatch("board.notes", None);
        step("open", &mut seen);
        for key in ["f", "w", "r"] {
            app.press(key);
        }
        step("focus", &mut seen);
        app.press("k");
        app.press("w");
        step("hold", &mut seen);
        app.press("v");
        step("menu", &mut seen);
        app.press("x");
        step("shut", &mut seen);
        app.press("v");
        settle(&board.harness);
        app.press("escape");
        step("escape", &mut seen);
        // A key after the blur is the composer's.
        app.press("b");
        app.press("w");
        step("blur", &mut seen);
        let (x, y) = support::at(&app.render().text(), "say").expect("the input shows");
        app.click(x + 1, y);
        // Keys no layer of the board binds: a layer whose scope holds takes its key before the field.
        app.type_text("yo");
        app.press("enter");
        step("say", &mut seen);
        app.press("b");
        settle(&board.harness);
        tui.keymap.dispatch("board.say", None);
        settle(&board.harness);
        app.type_text("ya");
        app.press("enter");
        step("field", &mut seen);
        tui.keymap.dispatch("board.unnotes", None);
        step("close", &mut seen);
        tui.keymap.dispatch("board.pick", None);
        settle(&board.harness);
        app.type_text("3");
        step("search", &mut seen);
        seen
    };
    let linked = run(Run::In(Carrier::Linked));
    let at = |name: &str| &linked.iter().find(|seen| seen.0 == name).unwrap().1;
    let heard = |name: &str| at(name).lines().find_map(|line| Some(line.split_once("heard")?.1.trim().to_owned()));
    assert!(at("open").contains("notes focused=true"), "the panel did not open with the focus: {}", at("open"));
    assert_eq!(heard("hold").as_deref(), Some("where:pad rect:60x1 hold where:pad"), "focus, reads, a hold");
    assert!(at("menu").contains("MENU here"), "the overlay did not open: {}", at("menu"));
    assert!(!at("shut").contains("MENU here"), "the overlay's key did not close it");
    assert!(
        heard("escape").is_some_and(|heard| heard.ends_with("hold where:pad closed:menu")),
        "{:?}",
        heard("escape")
    );
    assert!(!at("escape").contains("MENU here"));
    assert!(at("hold").contains("notes focused=true at pad"), "the view did not read its focus: {}", at("hold"));
    assert_eq!(heard("blur"), heard("escape"), "blur kept the focus: {}", at("blur"));
    assert!(at("blur").contains("notes focused=false at"), "the panel did not hear it lost the focus: {}", at("blur"));
    assert!(at("say").contains("said c:y c:yo s:yo"), "the input's events: {}", at("say"));
    assert!(at("field").contains("notes focused=true at say"), "the field did not take the focus: {}", at("field"));
    assert!(at("field").contains("c:yoy c:yoya s:yoya"), "the focused field's events: {}", at("field"));
    assert!(!at("close").contains("notes focused"), "the panel did not close");
    let search = at("search");
    assert!(search.contains("card 3") && !search.contains("card 4"), "the search did not list the rows: {search}");
    for other in [Run::In(CARRIERS[1]), Run::Library] {
        for ((name, _, linked), (_, text, seen)) in linked.iter().zip(run(other)) {
            assert_eq!((&linked.1, &linked.2), (&seen.1, &seen.2), "{other:?} at {name}: toasts and status");
            if linked.0 != seen.0 {
                let at = linked.0.iter().zip(&seen.0).position(|(a, b)| a != b);
                panic!("{other:?} at {name}: the frames differ, first at cell {at:?} of 120 a row:\n{text}");
            }
        }
    }
}

#[test]
fn a_dialog_surface_is_equal_on_every_carrier() {
    let run = |run: Run| {
        let board = open(run);
        let (app, tui) = (&board.harness.app, &board.harness.tui);
        let mut seen = Vec::new();
        let step = |name: &'static str, seen: &mut Vec<_>| {
            settle(&board.harness);
            seen.push((name, app.render().text(), observe(&board.harness)));
        };
        // Over the board's route: the home screen's composer draws its placeholder at random.
        tui.navigate(Route::Plugin { id: ID.to_owned(), name: "board".to_owned() });
        settle(&board.harness);
        tui.keymap.dispatch("board.dialog", None);
        step("open", &mut seen);
        app.type_text("hi");
        step("typed", &mut seen);
        app.press("ctrl+l");
        settle(&board.harness);
        app.press("down");
        app.press("down");
        step("scrolled", &mut seen);
        app.press("escape");
        step("closed", &mut seen);
        tui.keymap.dispatch("board.dialog", None);
        settle(&board.harness);
        app.type_text("yo");
        app.press("ctrl+c");
        step("cleared", &mut seen);
        app.press("ctrl+c");
        step("gone", &mut seen);
        seen
    };
    let linked = run(Run::In(Carrier::Linked));
    let at = |name: &str| &linked.iter().find(|seen| seen.0 == name).unwrap().1;
    assert!(at("open").contains("Ask the board") && at("open").contains("at answer"), "{}", at("open"));
    assert!(at("typed").contains("answered a:h a:hi at answer"), "{}", at("typed"));
    assert!(at("scrolled").contains("a:hi at lines") && !at("scrolled").contains("line 0 "), "{}", at("scrolled"));
    let toasts = |name: &str| linked.iter().find(|seen| seen.0 == name).unwrap().2.1.clone();
    assert!(!at("closed").contains("Ask the board"), "{}", at("closed"));
    assert!(toasts("closed").iter().any(|toast| toast.contains("ask closed")), "{:?}", toasts("closed"));
    assert!(
        at("cleared").contains("a:yo a: at answer") && at("cleared").contains("Ask the board"),
        "{}",
        at("cleared")
    );
    assert!(!at("gone").contains("Ask the board"), "{}", at("gone"));
    assert!(toasts("gone").iter().any(|toast| toast.contains("ask closed")), "{:?}", toasts("gone"));
    for other in [Run::In(CARRIERS[1]), Run::Library] {
        for ((name, _, linked), (_, text, seen)) in linked.iter().zip(run(other)) {
            assert_eq!((&linked.1, &linked.2), (&seen.1, &seen.2), "{other:?} at {name}: toasts and status");
            if linked.0 != seen.0 {
                let at = linked.0.iter().zip(&seen.0).position(|(a, b)| a != b);
                panic!("{other:?} at {name}: the frames differ, first at cell {at:?} of 80 a row:\n{text}");
            }
        }
    }
}

fn claimed(run: Run) -> Vec<(&'static str, Seen)> {
    let session = support::merge(support::session("ses_c", "Claims"), serde_json::json!({ "agent": "build" }));
    let messages = serde_json::json!([
        {
            "id": "msg_2", "type": "assistant", "agent": "build", "model": { "providerID": "provider", "id": "model" },
            "time": { "created": 1500 }, "content": [],
        },
        { "id": "msg_1", "type": "user", "text": "Stream it", "time": { "created": 1000 } },
    ]);
    let fake = support::Fake::new(move |seen| match seen.path.as_str() {
        "/api/session" => (200, serde_json::json!({ "data": [], "cursor": {} })),
        "/api/session/ses_c" => (200, serde_json::json!({ "data": session })),
        "/api/session/ses_c/message" => (200, serde_json::json!({ "data": messages, "cursor": {} })),
        "/api/session/ses_c/permission" | "/api/session/ses_c/inbox" => (200, serde_json::json!({ "data": [] })),
        _ => support::not_found(),
    });
    let session = opencode_local::cli_config::Session {
        grouping: Some(opencode_local::cli_config::Grouping::None),
        verbosity: Some(opencode_local::cli_config::Verbosity::Medium),
        ..Default::default()
    };
    let info =
        opencode_local::cli_config::Info { animations: Some(false), session: Some(session), ..Default::default() };
    let deps =
        Deps { config: support::config(info), route: support::session_route("ses_c"), ..support::deps(Arc::new(fake)) };
    let board = open_on(run, 80, deps);
    let (harness, tui) = (&board.harness, &board.harness.tui);
    harness.wait_for("Stream it");
    let seq = std::cell::Cell::new(0);
    let emit = |kind: &str, data: serde_json::Value| {
        seq.set(seq.get() + 1);
        let ids = serde_json::json!({ "sessionID": "ses_c", "assistantMessageID": "msg_2" });
        let event = serde_json::json!({
            "id": format!("evt_{}", seq.get()), "created": 10_000 + seq.get(), "type": kind,
            "durable": { "aggregateID": "ses_c", "seq": seq.get(), "version": 1 }, "data": support::merge(ids, data),
        });
        tui.data.apply(&[serde_json::from_value(event).unwrap()]);
        harness.wait("the views took the event", || tui.synced());
        settle(harness);
        harness.app.render();
    };
    let observe = || {
        let (cells, toasts, status) = observe(harness);
        let rect = tui.textarea.borrow().as_ref().map(opentui::prelude::Widget::rect);
        let width = usize::from(harness.app.app().size().0);
        let composer = |index: usize| {
            let (x, y) = ((index % width) as f64, (index / width) as f64);
            rect.is_some_and(|r| {
                x >= r.screen_x
                    && x < r.screen_x + f64::from(r.width)
                    && y >= r.screen_y
                    && y < r.screen_y + f64::from(r.height)
            })
        };
        let cells =
            cells.into_iter().enumerate().filter(|(index, _)| !composer(*index)).map(|(_, cell)| cell).collect();
        // What the claimed parts hold, a library's memo tables as it counts them included, beside the plugin's status.
        let held = opencode_plugin::claim::ledger();
        (cells, toasts, format!("{status} claims {:?}", (held.mounts, held.content, held.memo_entries)))
    };
    let mut seen = Vec::new();
    emit("session.tool.input.started", serde_json::json!({ "id": "call_1", "name": "board" }));
    emit("session.tool.input.delta", serde_json::json!({ "id": "call_1", "delta": "{\"q\": 1" }));
    seen.push(("streaming", observe()));
    emit("session.tool.called", serde_json::json!({ "id": "call_1", "input": { "q": 1 }, "executed": true }));
    seen.push(("running", observe()));
    let content = serde_json::json!([{ "type": "text", "text": "the board's call is done" }]);
    emit("session.tool.success", serde_json::json!({ "id": "call_1", "content": content, "executed": true }));
    seen.push(("completed", observe()));
    let screen = harness.app.text();
    assert!(
        screen.contains("board call_1 Completed") && screen.contains("the board's call is done"),
        "{run:?}:\n{screen}"
    );
    emit("session.tool.input.started", serde_json::json!({ "id": "call_2", "name": "board" }));
    let error = serde_json::json!({ "type": "unknown", "message": "boom" });
    emit("session.tool.failed", serde_json::json!({ "id": "call_2", "error": error, "executed": false }));
    seen.push(("declined", observe()));
    emit("session.text.started", serde_json::json!({ "ordinal": 0 }));
    for chunk in ["Before.\n\n", "```board\n", "alpha\n", "beta\n", "```\n"] {
        emit("session.text.delta", serde_json::json!({ "ordinal": 0, "delta": chunk }));
    }
    seen.push(("fence", observe()));
    let screen = harness.app.text();
    assert!(screen.contains("fence board") && !screen.contains("board call_2 Error"), "{run:?}:\n{screen}");
    // The card holds the host's code view of the fence, which followed it as it streamed (`fence-node`).
    assert!(screen.contains("alpha") && screen.contains("beta"), "{run:?}:\n{screen}");
    tui.theme.borrow_mut().set("tokyonight");
    tui.theme_changed();
    settle(harness);
    seen.push(("theme", observe()));
    seen
}

#[test]
fn a_claimed_part_is_equal_on_every_carrier() {
    let linked = claimed(Run::In(Carrier::Linked));
    assert!(linked.windows(2).all(|pair| pair[0].1.0 != pair[1].1.0), "a checkpoint saw what the one before did");
    // Each claimed part holds its card's one memo value until its mount ends: the finished call, the fence, and the
    // declined call, whose library keeps its table too.
    let (_, (_, _, status)) = linked.last().unwrap();
    assert!(status.ends_with(", 3)"), "{status}");
    for run in [Run::In(CARRIERS[1]), Run::Library] {
        let other = claimed(run);
        for ((name, linked), (_, other)) in linked.iter().zip(&other) {
            assert_eq!((&linked.1, &linked.2), (&other.1, &other.2), "{run:?} at {name}: toasts and status");
            if linked.0 != other.0 {
                let at = linked.0.iter().zip(&other.0).position(|(a, b)| a != b);
                panic!("{run:?} at {name}: the frames differ, first at cell {at:?}");
            }
        }
    }
}
