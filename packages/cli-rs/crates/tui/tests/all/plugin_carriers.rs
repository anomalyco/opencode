//! `carrier-equal` (P4, synthesis 4.14) with a real library: one plugin source, `crates/plugin/examples/board`, runs
//! linked (its `board.rs` is this module's `board`), through the C ABI's byte shims in this process, and as the
//! `cdylib` that crate builds, with its own std and allocator, loaded from a `plugins` directory. At every checkpoint
//! the three give equal frames (cells with their styles), and the same toasts and plugin status. The board's header
//! is its own call log: views run, cards built, messages arrived.
//!
//! The script covers a mount, revisions with memoized cards, a theme change, an effect, a thread that floods the
//! mailbox past its bound, a remount, and a panic on the plugin's own thread, which is reported once.

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
    let root = matches!(run, Run::Library).then(|| {
        let root = opencode_util::temp::tempdir().unwrap();
        let config = root.path().join("config");
        let dir = config.join("plugins").join("board");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(entry_file()), library()).unwrap();
        external(&harness.tui, External { config_dir: config, cwd: root.path().to_path_buf() });
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
    seen.push(("open", observe(&board.harness)));
    dispatch("board.bump", Some("2"));
    dispatch("board.bump", Some("2"));
    dispatch("board.bump", Some("5"));
    seen.push(("bumped", observe(&board.harness)));
    tui.theme.borrow_mut().set("tokyonight");
    tui.theme_changed();
    settle(&board.harness);
    seen.push(("theme", observe(&board.harness)));
    dispatch("board.toast", None);
    seen.push(("toast", observe(&board.harness)));
    // More than the mailbox holds: the thread waits on `Full`, and every message arrives.
    dispatch("board.flood", Some("1000"));
    board.harness.wait("the flood arrived", || {
        app.advance(Duration::from_millis(1));
        app.text().contains("messages 1000")
    });
    let stats = opencode_plugin::mailbox::stats(ID).unwrap();
    assert!(stats.high <= abi::BOUND, "{run:?}: the mailbox held {} entries", stats.high);
    seen.push(("flood", observe(&board.harness)));
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
