//! The pipe carrier (P7, synthesis 3.7, 4.3, 4.14): TypeScript plugins on the JS host, a real Bun process. The plugins
//! are `crates/plugin/examples/pipe`: `twin/tui.ts` and `kept/tui.ts` (P6a), whose linked twins are `twin.rs` and
//! `kept.rs`, and `probe/tui.ts`, which writes its own call log. Every row skips without Bun, unless `OPENCODE_RS_REQUIRE_TS=1`.
//!
//! A frame of the pipe is compared once the JS host has settled: everything sent was handled, and no tree waits for
//! the host ([`settle`]). Before that, a surface shows what the second tier allows: its last whole revision or a
//! placeholder.

#[path = "../../../plugin/examples/pipe/kept.rs"]
mod kept;
#[path = "../../../plugin/examples/pipe/twin.rs"]
mod twin;

use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::Arc;
use std::time::{Duration, Instant};

use opencode_plugin::abi;
use opencode_plugin::pipe::{self, Config, Scripts};
use opencode_tui::plugins::host::{External, external_with};
use opencode_tui::{Deps, Route, Tui};
use opentui::testing::TestApp;

use crate::plugin_surface::{Carrier, builtin};
use crate::support::{self, Harness};

pub(crate) const EXAMPLES: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../plugin/examples/pipe");

/// Bun, or `None` to skip.
pub fn bun() -> Option<PathBuf> {
    let found = std::env::var_os("OPENCODE_BUN").map(PathBuf::from).or_else(|| pipe::find("bun"));
    if found.is_none() && std::env::var("OPENCODE_RS_REQUIRE_TS").as_deref() == Ok("1") {
        panic!("bun is required (OPENCODE_RS_REQUIRE_TS=1) and was not found");
    }
    found
}

pub struct Pipe {
    pub harness: Harness,
    pub root: opencode_util::temp::TempDir,
}

impl Pipe {
    pub fn scripts(&self) -> Rc<Scripts> {
        self.harness.tui.plugins.scripts.borrow().clone().expect("the JS host runs")
    }

    /// Waits until the JS host handled everything sent so far and no tree waits for the host, then lets the UI draw.
    pub fn settle(&self) {
        settle(&self.harness, &self.scripts());
    }

    pub fn status(&self, id: &str) -> Option<opencode_plugin::Status> {
        self.harness.tui.plugins.entries().into_iter().find(|entry| entry.id == id).map(|entry| entry.status)
    }

    /// Waits until plugin `id` is active.
    pub fn active(&self, id: &str) {
        let entries = || {
            let entries =
                self.harness.tui.plugins.entries().into_iter().map(|entry| format!("{} {:?}", entry.id, entry.status));
            entries.collect::<Vec<_>>().join("\n")
        };
        self.harness.wait(&format!("{id} is active"), || {
            let failed = matches!(self.status(id), Some(opencode_plugin::Status::Failed(_)));
            assert!(!failed, "{id} failed:\n{}", entries());
            self.harness.app.advance(Duration::from_millis(1));
            self.status(id) == Some(opencode_plugin::Status::Active)
        });
    }
}

/// Mounts the TUI on Home with the plugin directories `plugins` (names under `EXAMPLES`), their `options`, and the JS
/// host `config`.
pub fn open(plugins: &[(&str, Option<serde_json::Value>)], config: Config, size: (u16, u16)) -> Pipe {
    open_with(plugins, config, size, Vec::new())
}

/// [`open`] with built-ins beside the TypeScript plugins.
pub fn open_with(
    plugins: &[(&str, Option<serde_json::Value>)],
    config: Config,
    size: (u16, u16),
    builtins: Vec<opencode_plugin::Builtin>,
) -> Pipe {
    open_on(plugins, config, size, builtins, Arc::new(support::empty()))
}

/// [`open_with`] on `server`, such as one that has a session to show.
pub fn open_on(
    plugins: &[(&str, Option<serde_json::Value>)],
    config: Config,
    size: (u16, u16),
    builtins: Vec<opencode_plugin::Builtin>,
    server: Arc<dyn opencode_api::transport::Transport>,
) -> Pipe {
    let root = opencode_util::temp::tempdir().unwrap();
    let config_dir = root.path().join("config");
    let mut entries = Vec::new();
    for (name, options) in plugins {
        let dir = config_dir.join("plugins").join(name);
        copy(&Path::new(EXAMPLES).join(name), &dir);
        if let Some(options) = options {
            entries.push(serde_json::json!({ "package": dir.to_string_lossy(), "options": options }));
        }
    }
    let mut deps = Deps { route: Route::Home, ..support::deps(server) };
    deps.builtins.extend(builtins);
    if !entries.is_empty() {
        let info = support::decode(&serde_json::json!({ "plugins": entries }).to_string());
        deps.config = support::config(info);
    }
    let harness = support::mount(size.0, size.1, deps);
    let external = External { config_dir, cwd: root.path().to_path_buf(), dev: Vec::new() };
    external_with(&harness.tui, external, Some(config));
    Pipe { harness, root }
}

/// Copies the plugin directory `from` to `to`, its hidden files left out.
pub fn copy(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for entry in std::fs::read_dir(from).unwrap().flatten() {
        if entry.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        let target = to.join(entry.file_name());
        match entry.file_type().unwrap().is_dir() {
            true => copy(&entry.path(), &target),
            false => drop(std::fs::copy(entry.path(), target).unwrap()),
        }
    }
}

/// The JS host as the tests run it: Bun, and the default limits but a longer acknowledgement, so a machine under load
/// does not end it as hung; the hang rows set their own.
pub fn config() -> Option<Config> {
    let mut config = Config::new(bun()?);
    config.limits.ack = Duration::from_secs(10);
    Some(config)
}

/// Waits until the JS host handled everything sent before, and no tree waits for the host; then three frames.
pub fn settle(harness: &Harness, scripts: &Scripts) {
    settle_app(&harness.app, &harness.tui, scripts);
}

/// [`settle`] for an app and its TUI outside a [`Harness`] (the P-APP replay).
pub(crate) fn settle_app(app: &TestApp, tui: &Tui, scripts: &Scripts) {
    let begun = Instant::now();
    walked_app(app, scripts);
    // A ping would start a JS host that nothing asked for.
    if scripts.pid().is_none() {
        for _ in 0..3 {
            turn_app(app);
        }
        if scripts.pid().is_none() {
            return;
        }
    }
    let unsettled = || {
        if begun.elapsed() > Duration::from_secs(20) {
            let entries = tui.plugins.entries().into_iter().map(|entry| format!("{} {:?}", entry.id, entry.status));
            panic!("the JS host never settled:\n{}\n{}", entries.collect::<Vec<_>>().join("\n"), app.text());
        }
    };
    loop {
        unsettled();
        // What the UI sends in its next frames (a route's first view is deferred) goes before the ping.
        for _ in 0..3 {
            turn_app(app);
        }
        let seq = scripts.ping();
        let mut pong = None;
        // A full overflow refuses the ping, and nothing answers it: the next round pings again (pipe-flakes: a settle
        // as the JS host began to read a full overflow waited for good).
        while pong.is_none() && scripts.pinging(seq) {
            unsettled();
            turn_app(app);
            pong = scripts.ponged(seq);
            if pong.is_none() {
                std::thread::sleep(Duration::from_micros(200));
            }
        }
        for _ in 0..3 {
            turn_app(app);
        }
        if pong == Some(false) && scripts.idle() {
            return;
        }
    }
}

/// Waits until no walk of a plugin's tree runs (FT-2), and the loader took the last: then a few turns.
pub fn walked(harness: &Harness, scripts: &Scripts) {
    walked_app(&harness.app, scripts);
}

fn walked_app(app: &TestApp, scripts: &Scripts) {
    let begun = Instant::now();
    while scripts.walking() {
        assert!(begun.elapsed() < Duration::from_secs(20), "a walk of a plugin's tree never ended");
        turn_app(app);
        std::thread::sleep(Duration::from_micros(200));
    }
    for _ in 0..3 {
        turn_app(app);
    }
}

/// The user's `decision` on `artifact`, the build of `target` held back, as the manager's question gives it: what was
/// recorded once the tree was hashed again, off the UI thread (FT-2).
pub fn decide(
    harness: &Harness,
    target: &str,
    artifact: &opencode_plugin::loader::approval::Artifact,
    decision: opencode_plugin::loader::approval::Decision,
) -> Result<bool, String> {
    let recorded = Rc::new(std::cell::RefCell::new(None));
    let answer = recorded.clone();
    opencode_tui::plugins::host::decide(&harness.tui, target, artifact, decision, move |_, recorded| {
        answer.replace(Some(recorded));
    });
    harness.wait("the decision was recorded", || {
        turn(harness);
        recorded.borrow().is_some()
    });
    recorded.take().unwrap()
}

/// One turn of the UI thread, and its frame when it wants one, as the run loop paints: a revision past a frame's rows
/// waits for the next paint (Pl).
pub(crate) fn turn(harness: &Harness) {
    turn_app(&harness.app);
}

fn turn_app(app: &TestApp) {
    app.advance(Duration::from_millis(1));
    if app.needs_frame() {
        app.render();
    }
}

/// What a checkpoint compares: the frame's cells, the toasts shown since the last one, and the plugin's status.
type Seen = (Vec<opentui::testing::Cell>, Vec<String>, String);

fn observe(harness: &Harness, id: &str) -> Seen {
    let tui = &harness.tui;
    let mut toasts = Vec::new();
    while let Some(toast) = tui.toasts.current() {
        toasts.push(format!("{:?} {:?} {}", toast.variant, toast.title, toast.message));
        tui.toasts.dismiss();
    }
    for _ in 0..3 {
        harness.app.advance(Duration::from_millis(1));
    }
    let status = tui.plugins.entries().into_iter().find(|entry| entry.id == id).map(|entry| entry.status);
    // An unwinding failure is a panic in process and a throw on the JS host: the carrier's word for it.
    let status = format!("{status:?}").replace(" panicked: ", " threw: ");
    (harness.app.render().cells, toasts, status)
}

/// The text of `cells` at 80 columns, for a failure's report.
fn screen(cells: &[opentui::testing::Cell]) -> String {
    cells.chunks(80).map(|row| row.iter().map(|cell| cell.symbol.as_str()).collect::<String>() + "\n").collect()
}

/// The twin's script, in process on `carrier` or on the pipe: what each checkpoint saw.
fn twin_script(pipe: Option<Config>, carrier: Carrier) -> Vec<(&'static str, Seen)> {
    let (harness, _root) = match pipe {
        Some(config) => {
            let pipe = open(&[("twin", None)], config, (80, 30));
            pipe.active(twin::ID);
            (pipe.harness, Some(pipe.root))
        }
        None => {
            let mut deps = Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) };
            deps.builtins.push(builtin(carrier, abi::Plugin { id: twin::ID, setup: twin::setup }));
            (support::mount(80, 30, deps), None)
        }
    };
    let scripts = harness.tui.plugins.scripts.borrow().clone();
    let settle = || match &scripts {
        Some(scripts) => settle(&harness, scripts),
        None => {
            for _ in 0..3 {
                harness.app.advance(Duration::from_millis(1));
            }
        }
    };
    let tui = &harness.tui;
    let route = Route::Plugin { id: twin::ID.to_owned(), name: "twin".to_owned() };
    let mut seen = Vec::new();
    tui.navigate(route.clone());
    settle();
    seen.push(("open", observe(&harness, twin::ID)));
    for card in ["2", "2", "5"] {
        tui.keymap.dispatch("twin.bump", Some(card));
        settle();
    }
    seen.push(("bumped", observe(&harness, twin::ID)));
    // A burst: the JS host views after each, and sends the next tree once the last was adopted.
    for card in ["0", "1", "3", "4"] {
        tui.keymap.dispatch("twin.bump", Some(card));
        harness.app.advance(Duration::from_millis(1));
    }
    settle();
    seen.push(("burst", observe(&harness, twin::ID)));
    tui.theme.borrow_mut().set("tokyonight");
    tui.theme_changed();
    settle();
    seen.push(("theme", observe(&harness, twin::ID)));
    tui.keymap.dispatch("twin.toast", None);
    settle();
    seen.push(("toast", observe(&harness, twin::ID)));
    tui.navigate(Route::Home);
    settle();
    tui.navigate(route);
    settle();
    seen.push(("remount", observe(&harness, twin::ID)));
    tui.keymap.dispatch("twin.throw", None);
    settle();
    seen.push(("failed", observe(&harness, twin::ID)));
    for _ in 0..5 {
        harness.app.advance(Duration::from_millis(16));
    }
    seen.push(("after", observe(&harness, twin::ID)));
    seen
}

// Expected (`carrier-equal` for the pipe, P7): one plugin, written twice (Rust linked, TypeScript on the JS host), gives
// equal frames, toasts and status at every checkpoint once the JS host settled: a mount, revisions with memoized cards
// and content by handle, a theme change, an effect, a remount, and a command that unwinds, which fails the plugin once
// with no effect.
#[test]
fn the_twin_is_equal_linked_and_on_the_pipe() {
    let Some(config) = config() else { return };
    let linked = twin_script(None, Carrier::Linked);
    // The guard: the checkpoints see different frames, so equal runs are not equal by being empty.
    assert_ne!(linked[0].1.0, linked[1].1.0, "a bump changed nothing on screen");
    let (_, (_, toasts, status)) = linked.iter().find(|(name, _)| *name == "failed").unwrap();
    assert_eq!(toasts.len(), 1, "{toasts:?}");
    assert!(status.contains("run-command threw: the twin's command threw"), "{status}");
    // The pipe, and the C ABI's byte shims as the third carrier (review bigboi, gate note).
    for (carrier, other) in
        [("pipe", twin_script(Some(config), Carrier::Linked)), ("abi", twin_script(None, Carrier::Abi))]
    {
        for ((name, linked), (_, piped)) in linked.iter().zip(&other) {
            assert_eq!(linked.1, piped.1, "{carrier} at {name}: toasts");
            assert_eq!(linked.2, piped.2, "{carrier} at {name}: status");
            if linked.0 != piped.0 {
                panic!(
                    "{carrier} at {name}: the frames differ\nlinked:\n{}\n{carrier}:\n{}",
                    screen(&linked.0),
                    screen(&piped.0)
                );
            }
        }
    }
}

/// The script of the twin of the built-ins' contract (P6a), in process on `carrier` or on the pipe: what each
/// checkpoint saw.
fn kept_script(pipe: Option<Config>, carrier: Carrier) -> Vec<(&'static str, Seen)> {
    let (harness, _root) = match pipe {
        Some(config) => {
            let pipe = open(&[("kept", None)], config, (80, 30));
            pipe.active(kept::ID);
            (pipe.harness, Some(pipe.root))
        }
        None => {
            let mut deps = Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) };
            deps.builtins.push(builtin(carrier, abi::Plugin { id: kept::ID, setup: kept::setup }));
            (support::mount(80, 30, deps), None)
        }
    };
    let scripts = harness.tui.plugins.scripts.borrow().clone();
    let settle = || match &scripts {
        Some(scripts) => settle(&harness, scripts),
        None => {
            for _ in 0..3 {
                harness.app.advance(Duration::from_millis(1));
            }
        }
    };
    let tui = &harness.tui;
    let route = Route::Plugin { id: kept::ID.to_owned(), name: "kept".to_owned() };
    let mut seen = Vec::new();
    tui.navigate(route.clone());
    settle();
    seen.push(("open", observe(&harness, kept::ID)));
    tui.keymap.dispatch("kept.bump", None);
    settle();
    seen.push(("bumped", observe(&harness, kept::ID)));
    // A view that keeps the root keeps the memo values under it, in whichever table holds them (review carbon-2).
    tui.keymap.dispatch("kept.same", None);
    settle();
    assert_eq!(
        opencode_plugin::surface::ledger_of(kept::ID).memo_entries,
        1,
        "{carrier:?}, pipe {}",
        scripts.is_some()
    );
    tui.keymap.dispatch("kept.hide", None);
    settle();
    seen.push(("hidden", observe(&harness, kept::ID)));
    tui.theme.borrow_mut().set("tokyonight");
    tui.theme_changed();
    settle();
    seen.push(("theme", observe(&harness, kept::ID)));
    tui.keymap.dispatch("kept.hide", None);
    settle();
    seen.push(("shown", observe(&harness, kept::ID)));
    tui.navigate(Route::Home);
    settle();
    tui.navigate(route);
    settle();
    seen.push(("remount", observe(&harness, kept::ID)));
    seen
}

// Expected (`carrier-equal` of P6a on the pipe): one plugin of the built-ins' contract, written twice (Rust linked,
// TypeScript on the JS host), gives equal frames and status at every checkpoint, also on the C ABI: mount notices heard
// begin and end (the route's line counts them), a box hidden and shown again in place, a read of one message, and views
// that keep their root while what they show is the same.
#[test]
fn the_kept_twin_is_equal_linked_and_on_the_pipe() {
    let Some(config) = config() else { return };
    let linked = kept_script(None, Carrier::Linked);
    let text = |seen: &Seen| screen(&seen.0);
    let (open, remount) = (text(&linked[0].1), text(&linked[5].1));
    assert!(open.contains("kept 0 · begun 1 · ended 0 · message none") && open.contains("extra"), "{open}");
    assert!(remount.contains("kept 1 · begun 2 · ended 1"), "{remount}");
    assert!(!text(&linked[2].1).contains("extra") && text(&linked[2].1).contains("below"), "{}", text(&linked[2].1));
    for (carrier, other) in
        [("pipe", kept_script(Some(config), Carrier::Linked)), ("abi", kept_script(None, Carrier::Abi))]
    {
        for ((name, linked), (_, piped)) in linked.iter().zip(&other) {
            assert_eq!(linked.2, piped.2, "{carrier} at {name}: status");
            if linked.0 != piped.0 {
                panic!(
                    "{carrier} at {name}: the frames differ\nlinked:\n{}\n{carrier}:\n{}",
                    screen(&linked.0),
                    screen(&piped.0)
                );
            }
        }
    }
}

// Containment, hold, placeholders and delivery over the pipe (P7).

use opencode_plugin::Status;
use opencode_plugin::pipe::Fault;
use opentui::input::{Event, KeyCode, KeyEvent, Modifiers, MouseButton, MouseEventKind};

use crate::support::model::{self, Failure, Model, Rng};

const PROBE: &str = "example.probe";

/// The probe's own call log, with the setups and cleanups left out.
fn calls(log: &Path) -> Vec<serde_json::Value> {
    let text = std::fs::read_to_string(log).unwrap_or_default();
    text.lines()
        .map(|line| serde_json::from_str::<serde_json::Value>(line).unwrap())
        .filter(|entry| entry.get("setup").is_none() && entry.get("cleanup").is_none())
        .collect()
}

/// How many setups the probe's log holds.
fn setups(log: &Path) -> usize {
    std::fs::read_to_string(log).unwrap_or_default().lines().filter(|line| line.contains("\"setup\"")).count()
}

/// The probe and the twin on one JS host, the probe logging to the file returned, with `config`.
fn probe_and_twin(config: Config, record: bool) -> (Pipe, PathBuf) {
    let log = std::env::temp_dir().join(format!("probe-{}-{:?}.log", std::process::id(), std::thread::current().id()));
    let _ = std::fs::remove_file(&log);
    let options = serde_json::json!({ "log": log.to_string_lossy(), "record": record });
    let builtins = if record { vec![recorder()] } else { Vec::new() };
    let pipe = open_with(&[("probe", Some(options)), ("twin", None)], config, (80, 30), builtins);
    pipe.active(PROBE);
    pipe.active(twin::ID);
    (pipe, log)
}

thread_local! {
    /// What the probe's effects asked the test's recorder to note, in the order they applied.
    static NOTED: std::cell::RefCell<Vec<String>> = const { std::cell::RefCell::new(Vec::new()) };
}

fn recorder() -> opencode_plugin::Builtin {
    fn setup(setup: &mut abi::Setup) -> Result<(), String> {
        let command = abi::Command::new("recorder.note").title("note");
        setup.command(command, |_, input| NOTED.with(|noted| noted.borrow_mut().push(input.unwrap_or("").to_owned())));
        Ok(())
    }
    opencode_plugin::Builtin::Plugin(abi::Plugin { id: "test.recorder", setup })
}

fn failed(pipe: &Pipe, id: &str) -> Option<String> {
    match pipe.status(id) {
        Some(Status::Failed(error)) => Some(error),
        _ => None,
    }
}

/// Toasts shown since the last call, oldest first: only the newest of a burst shows, the way the TUI's stack works.
fn toasts(harness: &Harness) -> Vec<String> {
    let mut shown = Vec::new();
    while let Some(toast) = harness.tui.toasts.current() {
        shown.push(format!("{}{}", toast.title.map(|title| format!("{title}: ")).unwrap_or_default(), toast.message));
        harness.tui.toasts.dismiss();
    }
    shown
}

/// The twin's route, bumped once, settled.
fn twin_open(pipe: &Pipe) {
    let tui = &pipe.harness.tui;
    tui.navigate(Route::Plugin { id: twin::ID.to_owned(), name: "twin".to_owned() });
    pipe.settle();
    tui.keymap.dispatch("twin.bump", Some("1"));
    pipe.settle();
    assert!(pipe.harness.app.text().contains("twin 1"), "{}", pipe.harness.app.text());
}

/// Checks that a frame of the twin's route shows a whole board, or the placeholder of a new mount: never part of one.
fn whole_or_placeholder(text: &str) {
    if text.starts_with('…') {
        return;
    }
    let cards = (0..twin::CARDS).filter(|card| text.contains(&format!("card {card}: "))).count();
    assert!(text.contains("twin ") && cards == twin::CARDS, "a frame without a whole board:\n{text}");
}

/// Whether process `pid` is gone, after up to two seconds.
fn gone(pid: u32) -> bool {
    let begun = Instant::now();
    while begun.elapsed() < Duration::from_secs(2) {
        if !Path::new(&format!("/proc/{pid}")).exists() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    !cfg!(target_os = "linux")
}

// Expected (review carbon new-1): on the pipe carrier too each effect of an answer is an entry of its own: of 100
// answers of 100 dispatches each, a turn of the run loop, with its one paint, runs at most two frames' bounds (the rest
// of one frame and the next), and the rest in later turns; the plugin stays active.
#[test]
fn many_effects_of_one_answer_wait_for_the_next_paint() {
    let Some(config) = config() else { return };
    let (pipe, _log) = probe_and_twin(config, true);
    NOTED.with(|noted| noted.borrow_mut().clear());
    let noted = || NOTED.with(|noted| noted.borrow().len());
    pipe.harness.tui.keymap.dispatch("probe.burst", Some("100"));
    let (begun, mut most) = (Instant::now(), 0);
    while noted() < 100 * 100 {
        assert!(begun.elapsed() < Duration::from_secs(60), "{} noted, {:?}", noted(), pipe.status(PROBE));
        let before = noted();
        turn(&pipe.harness);
        most = most.max(noted() - before);
        std::thread::sleep(Duration::from_micros(200));
    }
    assert!(most <= 2048, "{most} ran in one turn");
    assert_eq!(pipe.status(PROBE), Some(Status::Active));
}

// Expected (containment, a plugin that throws; `no-effects` and `reported-once` over the pipe): a handler that throws
// fails its plugin alone, once, with none of what it asked for before the throw; the other plugin on the same JS host
// goes on, and the JS host was not started again.
#[test]
fn a_plugin_that_throws_fails_alone_with_no_effects() {
    let Some(config) = config() else { return };
    let (pipe, _log) = probe_and_twin(config, false);
    let pid = pipe.scripts().pid();
    twin_open(&pipe);
    toasts(&pipe.harness);
    pipe.harness.tui.keymap.dispatch("probe.throw", None);
    pipe.settle();
    let shown = toasts(&pipe.harness);
    assert_eq!(shown.len(), 1, "{shown:?}");
    assert!(shown[0].starts_with("Plugin failed: example.probe"), "{shown:?}");
    assert!(failed(&pipe, PROBE).is_some_and(|error| error.contains("run-command threw: the probe threw")));
    // The error shows the message; the log has the stack, down to the plugin's line (dx-fresh).
    let stderr = pipe.scripts().stderr();
    assert!(
        stderr.iter().any(|line| line.trim_start().starts_with("at ") && line.contains("probe/tui.ts:")),
        "{stderr:?}"
    );
    pipe.harness.tui.keymap.dispatch("twin.bump", Some("1"));
    pipe.settle();
    assert!(pipe.harness.app.text().contains("twin 2"), "{}", pipe.harness.app.text());
    assert_eq!(pipe.scripts().pid(), pid, "the JS host started again");
    assert_eq!(pipe.status(twin::ID), Some(Status::Active));
    for _ in 0..5 {
        pipe.harness.app.advance(Duration::from_millis(16));
    }
    assert!(toasts(&pipe.harness).is_empty(), "a failure was reported again");
}

/// Kills, by a command of the probe, the JS host; then checks that the probe alone failed with `cause`, that the old
/// process is gone, and that the twin, set up again on a new JS host, shows its last whole tree until its new one comes.
fn ends_the_js_host(command: &str, input: Option<&str>, cause: &str, config: Config) {
    let setup = config.limits.setup;
    let (pipe, _log) = probe_and_twin(config, false);
    let pid = pipe.scripts().pid().unwrap();
    twin_open(&pipe);
    toasts(&pipe.harness);
    let begun = Instant::now();
    pipe.harness.tui.keymap.dispatch(command, input);
    pipe.harness.wait(&format!("{command} ended the JS host"), || {
        pipe.harness.app.advance(Duration::from_millis(1));
        whole_or_placeholder(&pipe.harness.app.text());
        pipe.scripts().pid().is_some_and(|now| now != pid) || failed(&pipe, PROBE).is_some()
    });
    // Judged by the handler's limit: nothing the setups answered is still owed (a load answered with its ID was).
    assert!(begun.elapsed() < setup, "the end took the setup's limit");
    // The failure's toast stays, and any after it waits, until read, as when the user holds it: the new JS host's start
    // may take longer than a toast shows.
    pipe.harness.wait("the failure's toast", || {
        pipe.harness.app.advance(Duration::from_millis(1));
        let title = pipe.harness.tui.toasts.current().and_then(|toast| toast.title);
        title.is_some_and(|title| title.starts_with("Plugin failed"))
    });
    pipe.harness.tui.toasts.pause();
    pipe.settle();
    let error = failed(&pipe, PROBE).unwrap_or_default();
    assert!(error.contains(cause), "{error}");
    assert!(gone(pid), "the old JS host {pid} is still running");
    assert_eq!(pipe.status(twin::ID), Some(Status::Active));
    // The twin was set up again: its state is new, and it answers.
    assert!(pipe.harness.app.text().contains("twin 0"), "{}", pipe.harness.app.text());
    pipe.harness.tui.keymap.dispatch("twin.bump", Some("1"));
    pipe.settle();
    assert!(pipe.harness.app.text().contains("twin 1"), "{}", pipe.harness.app.text());
    let shown = toasts(&pipe.harness);
    assert_eq!(shown.iter().filter(|toast| toast.contains("Plugin failed")).count(), 1, "{shown:?}");
}

// Expected (containment, a plugin that hangs): the event the JS host does not acknowledge within the limit ends it;
// the plugin whose handler ran fails, named with its call, and the old process is gone; the other plugin is set up
// again on a new JS host, its surface showing its last whole tree meanwhile.
#[test]
fn a_plugin_that_hangs_fails_alone_and_the_js_host_starts_again() {
    let Some(mut config) = config() else { return };
    config.limits.ack = Duration::from_millis(500);
    ends_the_js_host("probe.hang", None, "run-command ended the JS host: the JS host sent nothing for 500 ms", config);
}

// Expected (containment, a plugin that exits): the JS host's end is noticed; the plugin whose handler ran fails, named
// with the exit, and the rest is as for a hang.
#[test]
fn a_plugin_that_exits_fails_alone_and_the_js_host_starts_again() {
    let Some(config) = config() else { return };
    // How the platform's `ExitStatus` reads.
    let exited = if cfg!(windows) { "exit code: 7" } else { "exit status: 7" };
    let cause = format!("run-command ended the JS host: the JS host exited ({exited})");
    ends_the_js_host("probe.exit", None, &cause, config);
}

// Expected (containment, a plugin that floods): effects sent outside any call past the host's bound of unread messages
// end the JS host, and the plugin whose effects filled it fails, though no call of it ran. The other plugin is set up
// again on a new JS host, which serves it: it answers. Also when the host's queue is smaller than its hello, which a new
// JS host takes first whatever the bound (pipe-restart: such a hello was lost, and the JS host that replaced the
// flooded one exited at once, "the stream skipped from 0 to N", as did each after it).
#[test]
fn a_plugin_that_floods_fails_alone_and_the_js_host_starts_again() {
    for queued in [None, Some(1 << 10)] {
        let Some(mut config) = config() else { return };
        if let Some(queued) = queued {
            config.limits.queued = queued;
        }
        let (pipe, _log) = probe_and_twin(config, false);
        let pid = pipe.scripts().pid().unwrap();
        twin_open(&pipe);
        pipe.harness.tui.keymap.dispatch("probe.flood", Some("5000"));
        pipe.settle();
        // The UI thread takes nothing while the flood comes.
        std::thread::sleep(Duration::from_millis(1500));
        pipe.harness.wait("the flood ended the JS host", || {
            pipe.harness.app.advance(Duration::from_millis(1));
            failed(&pipe, PROBE).is_some()
        });
        pipe.settle();
        let error = failed(&pipe, PROBE).unwrap();
        assert!(error.contains("flooded the host with effects"), "queued {queued:?}: {error}");
        assert!(gone(pid));
        pipe.harness.tui.keymap.dispatch("twin.bump", Some("1"));
        pipe.settle();
        let screen = pipe.harness.app.text();
        assert!(
            screen.contains("twin 1"),
            "queued {queued:?}: the twin does not answer: {:?}\n{screen}",
            pipe.status(twin::ID)
        );
        assert_eq!(pipe.status(twin::ID), Some(Status::Active), "queued {queued:?}");
    }
}

// Expected (review F4, js-stdio): a plugin's prints go to the JS host's standard error and break nothing, and so do the
// raw bytes it writes to the descriptor of standard output itself, as oc-bg-color-sync writes an OSC sequence: the
// protocol runs on standard input, so the JS host and every plugin keep running and answer, and the bytes are logged by
// the plugin whose handler wrote them, escaped. TS sends them to the terminal (deviation F16).
#[test]
fn a_raw_write_to_standard_output_is_logged_and_breaks_nothing() {
    let Some(config) = config() else { return };
    let (pipe, log) = probe_and_twin(config, false);
    let pid = pipe.scripts().pid().unwrap();
    pipe.harness.tui.keymap.dispatch("probe.print", None);
    pipe.settle();
    assert_eq!(calls(&log), vec![serde_json::json!({ "printed": true })]);
    assert_eq!(pipe.scripts().pid(), Some(pid), "a print ended the JS host");
    for _ in 0..3 {
        pipe.harness.tui.keymap.dispatch("probe.raw", None);
        pipe.settle();
    }
    assert_eq!(calls(&log).iter().filter(|call| **call == serde_json::json!({ "raw": true })).count(), 3);
    pipe.harness.wait("the raw bytes are logged", || {
        pipe.harness.app.advance(Duration::from_millis(1));
        pipe.scripts().stray().iter().filter(|record| record.contains("not a frame")).count() == 3
    });
    let stray = pipe.scripts().stray();
    let record = stray.iter().find(|record| record.contains("not a frame")).unwrap();
    assert!(record.starts_with(&format!("plugin {PROBE} wrote 30 bytes")), "{stray:?}");
    assert!(record.contains(r"\u{1b}]11;rgb:10/20/30\u{7}not a frame\n"), "{record}");
    assert_eq!(pipe.scripts().pid(), Some(pid), "a raw write ended the JS host");
    assert_eq!(pipe.status(PROBE), Some(Status::Active));
    twin_open(&pipe);
    assert_eq!(pipe.status(twin::ID), Some(Status::Active));
    assert_eq!(pipe.scripts().pid(), Some(pid));
}

// Expected (the JS host's memory budget): a JS host over its budget is ended and started again with its plugins.
#[test]
fn a_js_host_over_its_memory_budget_starts_again() {
    let Some(mut config) = config() else { return };
    config.limits.memory = 160 << 20;
    config.limits.poll = Duration::from_millis(50);
    let (pipe, log) = probe_and_twin(config, false);
    let pid = pipe.scripts().pid().unwrap();
    pipe.harness.tui.keymap.dispatch("probe.leak", Some("256"));
    pipe.harness.wait("the budget ended the JS host", || {
        pipe.harness.app.advance(Duration::from_millis(1));
        std::thread::sleep(Duration::from_millis(1));
        pipe.scripts().pid().is_some_and(|now| now != pid)
    });
    pipe.settle();
    assert!(gone(pid));
    assert_eq!(setups(&log), 2, "the probe was set up again");
    assert!(pipe.scripts().resident().unwrap() < 160 << 20);
}

// Expected (the restart rule): a JS host that ends three times in a minute is not started again, and every plugin on it
// fails, once each.
#[test]
fn three_ends_in_a_minute_fail_every_plugin() {
    let Some(config) = config() else { return };
    let (pipe, _log) = probe_and_twin(config, false);
    for end in 0..3 {
        let pid = pipe.scripts().pid().unwrap();
        pipe.scripts().kill();
        pipe.harness.wait(&format!("end {end} was noticed"), || {
            pipe.harness.app.advance(Duration::from_millis(1));
            std::thread::sleep(Duration::from_millis(1));
            pipe.scripts().pid() != Some(pid)
        });
        if end < 2 {
            // The next starts as the loader reconciles again, which a settle with no JS host does not wait for
            // (pipe-flakes: under load it had not started, and the next end found none).
            pipe.harness.wait(&format!("a JS host started after end {end}"), || {
                pipe.harness.app.advance(Duration::from_millis(1));
                std::thread::sleep(Duration::from_millis(1));
                pipe.scripts().pid().is_some()
            });
            pipe.settle();
        }
    }
    for _ in 0..5 {
        pipe.harness.app.advance(Duration::from_millis(16));
    }
    assert!(failed(&pipe, PROBE).is_some_and(|error| error.contains("ended 3 times")), "{:?}", pipe.status(PROBE));
    assert!(failed(&pipe, twin::ID).is_some_and(|error| error.contains("ended 3 times")));
    assert_eq!(pipe.scripts().pid(), None);
}

// Expected (no orphans): the JS host ends with the TUI that started it, and its process is reaped.
#[test]
fn the_js_host_ends_with_the_tui() {
    let Some(config) = config() else { return };
    let (pipe, _log) = probe_and_twin(config, false);
    let pid = pipe.scripts().pid().unwrap();
    drop(pipe);
    assert!(gone(pid), "the JS host {pid} outlived the TUI");
}

// Expected (`hold`, 3.7, review F3): the keys typed after a holding command wait until its handler returned, then reach
// the composer in order; past the limit of 50 ms they go on without it.
#[test]
fn a_holding_command_holds_the_keys_after_it() {
    let Some(config) = config() else { return };
    let (pipe, log) = probe_and_twin(config, false);
    let harness = &pipe.harness;
    harness.tui.keymap.dispatch("probe.hold", Some("5"));
    // Typed before the UI takes anything else: the handler's answer cannot have arrived, however soon the JS host gave it.
    for key in ['a', 'b'] {
        harness.app.app().dispatch(Event::Key(KeyEvent::new(KeyCode::Char(key), Modifiers::NONE)));
    }
    assert_eq!(harness.text(), "", "a held key reached the composer before the command returned");
    pipe.settle();
    assert_eq!(harness.text(), "ab");
    assert_eq!(calls(&log), vec![serde_json::json!({ "hold": 5 })]);
    // A handler that takes longer than the limit: the keys go on at 50 ms, before it returns.
    harness.tui.keymap.dispatch("probe.hold", Some("1500"));
    harness.app.type_text("c");
    harness.app.advance(Duration::from_millis(49));
    assert_eq!(harness.text(), "ab");
    harness.app.advance(Duration::from_millis(2));
    assert_eq!(harness.text(), "abc");
    assert_eq!(calls(&log).len(), 1, "the handler returned before the limit");
    pipe.settle();
    assert_eq!(calls(&log).len(), 2);
}

/// The row the composer's placeholder shows on.
fn prompt_row(harness: &Harness) -> Option<usize> {
    harness.app.text().lines().position(|line| line.contains("Ask anything"))
}

// Expected (rows moved above the viewport: 0, review F1): once the first tree of a claim has arrived, no frame moves the
// rows around it: a later revision of the same size, and a new mount of the same key, whose placeholder keeps the room
// its last tree took until its own tree comes.
#[test]
fn rows_do_not_move_once_the_first_tree_arrived() {
    let Some(config) = config() else { return };
    let (pipe, _log) = probe_and_twin(config, false);
    let harness = &pipe.harness;
    pipe.settle();
    assert!(harness.app.text().contains("probe line 2"), "{}", harness.app.text());
    let row = prompt_row(harness).unwrap();
    let watch = |what: &str| {
        for _ in 0..40 {
            harness.app.advance(Duration::from_millis(1));
            harness.app.render();
            assert_eq!(prompt_row(harness), Some(row), "{what} moved the rows:\n{}", harness.app.text());
            std::thread::sleep(Duration::from_micros(500));
        }
    };
    harness.tui.keymap.dispatch("probe.rows", Some("3"));
    watch("a revision of the same size");
    pipe.settle();
    // Away and back: the home footer mounts again, under the same key, while the JS host is busy, so its placeholder
    // shows for a while.
    harness.tui.navigate(Route::Plugin { id: twin::ID.to_owned(), name: "twin".to_owned() });
    pipe.settle();
    harness.tui.keymap.dispatch("probe.hold", Some("400"));
    harness.app.advance(Duration::from_millis(60));
    harness.tui.navigate(Route::Home);
    harness.app.advance(Duration::from_millis(1));
    assert!(!harness.app.text().contains("probe line"), "the guard: no placeholder showed\n{}", harness.app.text());
    watch("a new mount");
    pipe.settle();
    assert_eq!(prompt_row(harness), Some(row));
    assert!(harness.app.text().contains("probe line 2"), "{}", harness.app.text());
}

// Expected (a JS host that ends in the middle of a revision): every frame shows the last whole revision or the next,
// never part of one.
#[test]
fn a_js_host_that_ends_mid_revision_leaves_the_last_whole_tree() {
    let Some(config) = config() else { return };
    let (pipe, _log) = probe_and_twin(config, false);
    twin_open(&pipe);
    for _ in 0..2 {
        pipe.harness.tui.keymap.dispatch("twin.bump", Some("3"));
        // The handler returned, so the end names nobody; its tree may be on its way.
        pipe.harness.wait("the bump returned", || {
            pipe.harness.app.advance(Duration::from_millis(1));
            pipe.scripts().idle()
        });
        pipe.scripts().kill();
        for _ in 0..40 {
            pipe.harness.app.advance(Duration::from_millis(1));
            whole_or_placeholder(&pipe.harness.app.text());
            std::thread::sleep(Duration::from_micros(500));
        }
        pipe.settle();
        assert_eq!(pipe.status(twin::ID), Some(Status::Active));
        whole_or_placeholder(&pipe.harness.app.text());
    }
}

/// One step of the delivery model.
#[derive(Clone, Debug)]
enum Act {
    /// The probe's step `n`: logged by the probe, then an effect that the recorder notes.
    Step,
    /// A holding command, of `ms` in its handler.
    Hold(u32),
    /// Frames, with the JS host not waited for.
    Frames(u8),
    Settle,
    /// A fault for the next handler's message.
    Fault(Fault),
}

/// `delivery` over the pipe, in its weaker form (3.7): the probe's own log holds each event once, in the order of the
/// input; the effects apply in that order too. With a fault on the pipe, what the JS host received before it ended, and
/// after it started again, is still once and in order; what was in flight when it ended is lost.
struct Delivery {
    faults: bool,
}

impl Model for Delivery {
    type Command = Act;

    fn generate(&self, rng: &mut Rng, steps: usize) -> Vec<Act> {
        (0..steps)
            .map(|_| match rng.below(20) {
                0..=9 => Act::Step,
                10 | 11 => Act::Hold(*rng.pick(&[0, 2])),
                12..=15 => Act::Frames(1 + rng.below(3) as u8),
                16..=18 => Act::Settle,
                _ if self.faults => Act::Fault(*rng.pick(&[Fault::Drop, Fault::Repeat, Fault::Swap])),
                _ => Act::Settle,
            })
            .collect()
    }

    fn run(&self, acts: &[Act]) -> Option<Failure> {
        let mut config = config()?;
        config.ends = usize::MAX;
        NOTED.with(|noted| noted.borrow_mut().clear());
        let (pipe, log) = probe_and_twin(config, true);
        let harness = &pipe.harness;
        let mut expected = Vec::new();
        let mut steps = Vec::new();
        let mut faults = 0;
        for act in acts {
            match act {
                Act::Step => {
                    let step = expected.len();
                    harness.tui.keymap.dispatch("probe.step", Some(&step.to_string()));
                    expected.push(serde_json::json!({ "step": step }));
                    steps.push(step.to_string());
                }
                Act::Hold(ms) => {
                    harness.tui.keymap.dispatch("probe.hold", Some(&ms.to_string()));
                    expected.push(serde_json::json!({ "hold": ms }));
                }
                Act::Frames(count) => {
                    for _ in 0..*count {
                        harness.app.advance(Duration::from_millis(1));
                    }
                }
                Act::Settle => pipe.settle(),
                Act::Fault(fault) => {
                    pipe.scripts().fault(*fault);
                    faults += usize::from(*fault != Fault::Repeat);
                }
            }
        }
        pipe.settle();
        let seen = calls(&log);
        let noted = NOTED.with(|noted| noted.borrow().clone());
        let fail = |site, detail: String| Some(Failure { property: "delivery", site, step: acts.len(), detail });
        if faults == 0 && acts.iter().all(|act| !matches!(act, Act::Fault(_))) {
            if seen != expected {
                return fail("log", format!("expected {expected:?}\nseen {seen:?}"));
            }
            if noted != steps {
                return fail("effects", format!("expected {steps:?}\nnoted {noted:?}"));
            }
            return None;
        }
        // A drop or a swap ends the JS host before it starts the message after the gap, and a repeat is dropped: no
        // handler was running, so every call it did not start is sent again to the next one. The logs are exact
        // (review bigboi-2: an oracle of subsequences passed with every call after a restart discarded).
        let _ = faults;
        if seen != expected {
            return fail("log-after-faults", format!("expected {expected:?}\nseen {seen:?}"));
        }
        if noted != steps {
            return fail("effects-after-faults", format!("expected {steps:?}\nnoted {noted:?}"));
        }
        None
    }

    fn simplify(&self, act: &Act) -> Vec<Act> {
        match act {
            Act::Hold(_) | Act::Frames(_) | Act::Fault(_) => vec![Act::Step],
            Act::Step | Act::Settle => Vec::new(),
        }
    }
}

// Expected (`delivery` over the pipe): with no fault, the probe's log is the input's events, once each and in order,
// and their effects applied in that order, whatever the frames between them.
#[test]
fn delivery_over_the_pipe() {
    if config().is_none() {
        return;
    }
    model::check(&Delivery { faults: false }, 8, 24);
}

// Expected (`delivery`'s weaker form under the pipe's fault operators: drop, repeat, swap one message): nothing is seen
// twice or out of order; a repeat changes nothing; a drop or a swap ends the JS host, and delivery goes on after it.
#[test]
fn delivery_over_the_pipe_with_faults() {
    if config().is_none() {
        return;
    }
    model::check(&Delivery { faults: true }, 8, 24);
}

// Expected (P3's requests over the pipe): a scroll verb a handler asks for moves the mount's scroll; the scroll's state,
// a read the plugin watches, reaches it before its next call; the user's wheel is a scroll event, which is a call.
#[test]
fn scroll_verbs_reads_and_events_cross_the_pipe() {
    let Some(config) = config() else { return };
    let (pipe, log) = probe_and_twin(config, false);
    let harness = &pipe.harness;
    harness.tui.navigate(Route::Plugin { id: PROBE.to_owned(), name: "pane".to_owned() });
    pipe.settle();
    // No call ran since the scroll was laid out: the plugin has not been told of it.
    assert!(harness.app.text().contains("offset -"), "{}", harness.app.text());
    harness.tui.keymap.dispatch("probe.bottom", None);
    pipe.settle();
    assert!(harness.app.text().contains("item 59"), "the verb did not move the scroll:\n{}", harness.app.text());
    // The state is pushed before the next call, which views again.
    harness.tui.keymap.dispatch("probe.step", Some("0"));
    pipe.settle();
    let text = harness.app.text();
    let offset: i32 =
        text.lines().find_map(|line| line.trim().strip_prefix("offset ")).unwrap().trim().parse().unwrap();
    assert!(offset > 0, "{text}");
    // The wheel moves the scroll as the frame is drawn, which tells the surface.
    harness.app.scroll(10, 10, false);
    harness.app.render();
    pipe.settle();
    assert!(calls(&log).contains(&serde_json::json!({ "scrolled": "user-scroll" })), "{:?}", calls(&log));
    let text = harness.app.text();
    let after: i32 = text.lines().find_map(|line| line.trim().strip_prefix("offset ")).unwrap().trim().parse().unwrap();
    assert!(after < offset, "the wheel's offset did not reach the plugin:\n{text}");
}

// Expected (`work` in bytes over the pipe): a revision that changes one card crosses that card and keeps the others, so
// its bytes are a fraction of the whole tree's; one that changes nothing crosses no tree; a theme change crosses the
// theme alone, which the V2 context's `theme` reads (P8), and no tree: the twin's nodes name tokens.
#[test]
fn a_revision_crosses_bytes_that_follow_the_change() {
    let Some(config) = config() else { return };
    let pipe = open(&[("twin", None)], config, (80, 30));
    pipe.active(twin::ID);
    let tui = &pipe.harness.tui;
    let before = pipe::crossed();
    tui.navigate(Route::Plugin { id: twin::ID.to_owned(), name: "twin".to_owned() });
    pipe.settle();
    let opened = pipe::crossed();
    let whole = opened.tree_bytes - before.tree_bytes;
    assert_eq!(opened.trees - before.trees, 1, "one tree opens the route");
    tui.keymap.dispatch("twin.bump", Some("1"));
    pipe.settle();
    let bumped = pipe::crossed();
    let one = bumped.tree_bytes - opened.tree_bytes;
    assert_eq!(bumped.trees - opened.trees, 1);
    assert!(one * 2 < whole, "a one-card revision crossed {one} bytes of a {whole}-byte tree");
    // The next view keeps the card the bump built, as memo does on every carrier; the one after crosses nothing.
    tui.keymap.dispatch("twin.toast", None);
    pipe.settle();
    let kept = pipe::crossed();
    assert_eq!(kept.trees - bumped.trees, 1);
    tui.keymap.dispatch("twin.toast", None);
    pipe.settle();
    assert_eq!(pipe::crossed().trees, kept.trees, "a call that changed nothing crossed a tree");
    let quiet = pipe::crossed();
    tui.theme.borrow_mut().set("tokyonight");
    tui.theme_changed();
    pipe.settle();
    let themed = pipe::crossed();
    // The settle's own ping and pong cross, and the theme; nothing else does.
    assert_eq!((themed.sent - quiet.sent, themed.trees - quiet.trees), (2, 0), "a theme change crossed a tree");
}

/// The twin alone on the JS host, its route open and settled.
fn twin_alone(config: Config) -> Pipe {
    let pipe = open(&[("twin", None)], config, (80, 30));
    pipe.active(twin::ID);
    pipe.harness.tui.navigate(Route::Plugin { id: twin::ID.to_owned(), name: "twin".to_owned() });
    pipe.settle();
    pipe
}

// Expected (the pipe's fault operator "repeat one message", from the JS host): a revision delivered again once a newer
// one was adopted builds on what the host no longer shows; it is dropped, and the newer one stays on screen.
#[test]
fn a_stale_revision_is_dropped() {
    let Some(config) = config() else { return };
    let pipe = twin_alone(config);
    let tui = &pipe.harness.tui;
    pipe.scripts().tamper(pipe::Tamper::Keep);
    tui.keymap.dispatch("twin.bump", Some("1"));
    pipe.settle();
    tui.keymap.dispatch("twin.bump", Some("1"));
    pipe.settle();
    assert!(pipe.harness.app.text().contains("twin 2"));
    let dropped = pipe::crossed().dropped;
    pipe.scripts().replay();
    pipe.settle();
    assert!(pipe.harness.app.text().contains("twin 2"), "{}", pipe.harness.app.text());
    assert_eq!(pipe::crossed().dropped, dropped + 1);
    assert_eq!(pipe.status(twin::ID), Some(Status::Active));
}

// Expected (`keep-full` over the pipe): a revision the host refuses for a keep it does not hold changes nothing; the
// host says so, the JS host sends a whole tree, which is adopted, and the plugin stays active and goes on.
#[test]
fn a_refused_revision_is_mended_by_a_whole_one() {
    let Some(config) = config() else { return };
    let pipe = twin_alone(config);
    let tui = &pipe.harness.tui;
    let refused = pipe::crossed().refused;
    pipe.scripts().tamper(pipe::Tamper::UnknownKeep);
    tui.keymap.dispatch("twin.bump", Some("1"));
    pipe.settle();
    assert_eq!(pipe::crossed().refused, refused + 1);
    assert!(pipe.harness.app.text().contains("twin 1"), "{}", pipe.harness.app.text());
    tui.keymap.dispatch("twin.bump", Some("2"));
    pipe.settle();
    assert!(pipe.harness.app.text().contains("card 2: 1"), "{}", pipe.harness.app.text());
    assert_eq!(pipe.status(twin::ID), Some(Status::Active));
}

// Expected (`reload-fresh` over the pipe): a changed module loads again on the JS host; the running build stays active
// and on screen until the new one answered, which then replaces it as a fresh load would: its mount shows the
// placeholder until its first tree.
#[test]
fn a_changed_module_reloads_and_the_running_one_stays_meanwhile() {
    let Some(config) = config() else { return };
    let (pipe, _log) = probe_and_twin(config, false);
    let harness = &pipe.harness;
    twin_open(&pipe);
    // The JS host is busy, so the new build's setup waits.
    harness.tui.keymap.dispatch("probe.hold", Some("600"));
    let file = pipe.root.path().join("config/plugins/twin/tui.ts");
    let source = std::fs::read_to_string(&file).unwrap();
    // The new build's setup leaves a mark before it answers.
    let mark = pipe.root.path().join("set-up");
    let source = source.replace("`twin ${total}", "`twin* ${total}").replace(
        "setup(api: any) {",
        &format!("setup(api: any) {{\n    require(\"node:fs\").writeFileSync({:?}, \"\")", mark.to_string_lossy()),
    );
    std::fs::write(&file, source).unwrap();
    let begun = Instant::now();
    let mut reloaded = false;
    while begun.elapsed() < Duration::from_secs(10) && !reloaded {
        harness.app.advance(Duration::from_millis(1));
        std::thread::sleep(Duration::from_millis(2));
        assert_eq!(pipe.status(twin::ID), Some(Status::Active), "the running build left while the new one loaded");
        let text = harness.app.text();
        reloaded = text.contains("twin* 0");
        assert!(reloaded || text.contains("twin 1") || mark.exists(), "before the new build was set up: {text}");
    }
    assert!(reloaded, "the changed module did not load: {}", harness.app.text());
    pipe.settle();
    harness.tui.keymap.dispatch("twin.bump", Some("2"));
    pipe.settle();
    assert!(harness.app.text().contains("card 2: 1"), "{}", harness.app.text());
}

// Expected (review F4, standard streams as the protocol): what a plugin prints, through every console method and
// `process.stdout` (a string, a buffer with its callback, an encoding), and what its own module and a dependency from
// `node_modules` print as they load and when called, goes to the JS host's standard error and breaks nothing: the JS
// host never ends, every plugin stays active and answers, and a write's callback runs.
#[test]
fn prints_of_a_plugin_and_its_dependencies_never_reach_the_protocol() {
    let Some(config) = config() else { return };
    let root = opencode_util::temp::tempdir().unwrap();
    let config_dir = root.path().join("config");
    let printer = config_dir.join("plugins/printer");
    copy(&Path::new(EXAMPLES).join("printer"), &printer);
    let chatty = printer.join("node_modules/chatty");
    std::fs::create_dir_all(&chatty).unwrap();
    std::fs::write(chatty.join("package.json"), r#"{ "name": "chatty", "main": "index.js" }"#).unwrap();
    std::fs::write(
        chatty.join("index.js"),
        "console.log('chatty loads'); process.stdout.write('chatty writes as it loads\\n');\n\
         module.exports = (when) => { console.info('chatty in ' + when); process.stdout.write(Buffer.from('chatty ' + when + '\\n')); };\n",
    )
    .unwrap();
    copy(&Path::new(EXAMPLES).join("twin"), &config_dir.join("plugins/twin"));
    let harness = support::mount(80, 30, Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) });
    let external = External { config_dir, cwd: root.path().to_path_buf(), dev: Vec::new() };
    external_with(&harness.tui, external, Some(config));
    let pipe = Pipe { harness, root };
    pipe.active("example.printer");
    pipe.active(twin::ID);
    let pid = pipe.scripts().pid();
    pipe.settle();
    assert!(pipe.harness.app.text().contains("the printer is here"), "{}", pipe.harness.app.text());
    // A tree of the start may be dropped, for a mount that ended or an input replaced as the screen laid out.
    let dropped = pipe::crossed().dropped;
    for _ in 0..3 {
        pipe.harness.tui.keymap.dispatch("printer.print", None);
        pipe.settle();
    }
    assert_eq!(pipe::crossed().dropped, dropped, "a print dropped a tree");
    let log = std::fs::read_to_string(printer.with_file_name(".printer.log.jsonl")).unwrap();
    assert_eq!(log.lines().filter(|line| line.contains("printed")).count(), 3, "{log}");
    assert_eq!(log.lines().filter(|line| line.contains("written")).count(), 3, "a write's callback never ran: {log}");
    twin_open(&pipe);
    assert_eq!(pipe.scripts().pid(), pid, "a print ended the JS host");
    assert_eq!(pipe.status("example.printer"), Some(Status::Active));
}

// The approval of a project's TypeScript plugin (O-125 (1), Pa's rules), over the pipe.

/// A client in project `work` whose `.opencode/plugins/probe` is the probe at build `build`, with the JS host.
struct Project {
    pipe: Pipe,
    dir: PathBuf,
}

impl Project {
    fn open(config: Config) -> Self {
        let root = opencode_util::temp::tempdir().unwrap();
        let work = root.path().join("work");
        std::fs::create_dir_all(work.join(".git")).unwrap();
        let dir = work.join(".opencode").join("plugins").join("probe");
        copy(&Path::new(EXAMPLES).join("probe"), &dir);
        // It runs from a copy of its files: it logs beside this directory all the same.
        std::fs::write(dir.join("log.txt"), dir.with_file_name(".probe.log.jsonl").to_string_lossy().as_bytes())
            .unwrap();
        // Build 0 is the module with its build line, as each build is.
        let source = std::fs::read_to_string(dir.join("tui.ts")).unwrap();
        std::fs::write(dir.join("tui.ts"), format!("{source}\n// build 0\n")).unwrap();
        let harness = support::mount(80, 30, Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) });
        let external = External { config_dir: root.path().join("config"), cwd: work, dev: Vec::new() };
        external_with(&harness.tui, external, Some(config));
        let project = Self { pipe: Pipe { harness, root }, dir };
        project.settle();
        project
    }

    fn target(&self) -> String {
        self.dir.to_string_lossy().into_owned()
    }

    fn settle(&self) {
        self.pipe.settle();
        while self.pipe.harness.tui.toasts.current().is_some() {
            self.pipe.harness.tui.toasts.dismiss();
        }
        self.pipe.settle();
    }

    /// The user answers about the build held back, as the manager's question does.
    fn answer(&self, decision: opencode_plugin::loader::approval::Decision) -> bool {
        let tui = &self.pipe.harness.tui;
        let Some((Ok(artifact), _)) = opencode_tui::plugins::host::held(tui, &self.target()) else { return false };
        assert!(artifact.script, "{artifact:?}");
        let recorded = decide(&self.pipe.harness, &self.target(), &artifact, decision).unwrap();
        self.settle();
        recorded
    }

    /// A new build of the probe: another line in its module.
    fn change(&self, build: u8) {
        let file = self.dir.join("tui.ts");
        let source = std::fs::read_to_string(&file).unwrap();
        let source = source.split("\n// build").next().unwrap().to_owned();
        std::fs::write(&file, format!("{source}\n// build {build}\n")).unwrap();
        opencode_tui::plugins::host::reconcile(&self.pipe.harness.tui);
        self.settle();
    }

    fn listed(&self) -> Option<Status> {
        let target = self.target();
        let entries = self.pipe.harness.tui.plugins.entries();
        entries.into_iter().find(|entry| entry.target.as_deref() == Some(&target)).map(|entry| entry.status)
    }

    /// The setups and cleanups the probe logged itself, and the times its module's own code ran.
    fn log(&self) -> (usize, usize, usize) {
        let text = std::fs::read_to_string(self.dir.with_file_name(".probe.log.jsonl")).unwrap_or_default();
        (text.matches("\"setup\"").count(), text.matches("\"cleanup\"").count(), text.matches("\"module\"").count())
    }
}

/// A screen with the composer's placeholder, which the client picks at random, left out.
fn masked(screen: &str) -> String {
    screen.lines().map(|line| line.split("Ask anything").next().unwrap_or("")).collect::<Vec<_>>().join("\n")
}

/// One step of the approval model on the pipe.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Ask {
    Approve,
    Decline,
    /// A new build, 1 to 3.
    Change(u8),
    /// The probe's command, as the keymap runs it.
    Run,
    Frame,
}

/// Pa's machine on the pipe: the build in the directory, the last decision with the build it named, and how often the
/// probe was started and stopped.
#[derive(Clone, Copy, Debug, Default)]
struct Asked {
    build: u8,
    decision: Option<(u8, opencode_plugin::loader::approval::Decision)>,
    setups: usize,
    cleanups: usize,
}

impl Asked {
    fn approved(&self) -> bool {
        self.decision == Some((self.build, opencode_plugin::loader::approval::Decision::Approved))
    }

    fn listed(&self) -> Status {
        match self.decision {
            _ if self.approved() => Status::Active,
            Some((build, opencode_plugin::loader::approval::Decision::Declined)) if build == self.build => {
                Status::Declined
            }
            _ => Status::Pending,
        }
    }

    fn step(&mut self, ask: Ask) {
        use opencode_plugin::loader::approval::Decision;
        let running = self.approved();
        match ask {
            // An answer names the build held back, which is the one in the directory.
            Ask::Approve if !running => self.decision = Some((self.build, Decision::Approved)),
            Ask::Decline if !running => self.decision = Some((self.build, Decision::Declined)),
            Ask::Change(build) => self.build = build,
            _ => {}
        }
        match (running, self.approved()) {
            (false, true) => self.setups += 1,
            (true, false) => self.cleanups += 1,
            _ => {}
        }
    }
}

/// `pending` over the pipe: while the probe is not approved, nothing of it ran, the JS host did not start for it, no
/// registry holds its ID, its command is not reachable, and the frame equals a client that never had it.
struct PendingModel;

impl Model for PendingModel {
    type Command = Ask;

    fn generate(&self, rng: &mut Rng, steps: usize) -> Vec<Ask> {
        (0..steps)
            .map(|_| match rng.below(10) {
                0 | 1 => Ask::Approve,
                2 => Ask::Decline,
                3..=5 => Ask::Change(1 + rng.below(3) as u8),
                6 | 7 => Ask::Run,
                _ => Ask::Frame,
            })
            .collect()
    }

    fn run(&self, asks: &[Ask]) -> Option<Failure> {
        use opencode_plugin::loader::approval::Decision;
        let config = config()?;
        let project = Project::open(config.clone());
        let twin = support::mount(80, 30, Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) });
        let mut asked = Asked { build: 0, ..Asked::default() };
        let mut started = false;
        for (step, ask) in [None].into_iter().chain(asks.iter().copied().map(Some)).enumerate() {
            let mut ran = false;
            if let Some(ask) = ask {
                asked.step(ask);
                match ask {
                    Ask::Approve => drop(project.answer(Decision::Approved)),
                    Ask::Decline => drop(project.answer(Decision::Declined)),
                    Ask::Change(build) => project.change(build),
                    Ask::Run => {
                        ran = matches!(
                            project.pipe.harness.tui.keymap.dispatch("probe.step", Some("0")),
                            opentui::keymap::RunResult::Ok
                        );
                        project.settle();
                    }
                    Ask::Frame => project.pipe.harness.app.advance(Duration::from_millis(16)),
                }
                twin.app.advance(Duration::from_millis(16));
            }
            started |= asked.approved();
            let fail = |site, detail: String| Some(Failure { property: "pending", site, step, detail });
            if project.listed() != Some(asked.listed()) {
                return fail(
                    "listed",
                    format!("listed {:?}, expected {:?} ({asked:?})", project.listed(), asked.listed()),
                );
            }
            // Each setup imports the module afresh, and nothing of it runs before (review bigboi-1).
            if project.log() != (asked.setups, asked.cleanups, asked.setups) {
                return fail("log", format!("the probe logged {:?}, expected {asked:?}", project.log()));
            }
            if asked.approved() {
                continue;
            }
            if ran {
                return fail("reachable", "the probe's command ran while it is not approved".to_owned());
            }
            if project.pipe.harness.tui.plugins.entries().iter().any(|entry| entry.id == PROBE) {
                return fail("registry", "the registry holds the probe".to_owned());
            }
            if !started && project.pipe.scripts().pid().is_some() {
                return fail("js-host", "the JS host started for a plugin that never was approved".to_owned());
            }
            let (seen, alone) = (masked(&project.pipe.harness.app.text()), masked(&twin.app.text()));
            if seen != alone {
                return fail("twin", format!("{seen}\nthe twin:\n{alone}"));
            }
        }
        None
    }

    fn simplify(&self, ask: &Ask) -> Vec<Ask> {
        match ask {
            Ask::Change(build) if *build != 1 => vec![Ask::Change(1)],
            Ask::Decline => vec![Ask::Approve],
            _ => Vec::new(),
        }
    }
}

// Expected (Pa's `pending` on the pipe, O-125 (1)): a project's TypeScript plugin waits for approval as a native one
// does. Pending or declined it equals no plugin: nothing of it ran, the JS host did not start for it, nothing is
// registered or reachable, and the frame is a client's without it; approved, it runs at once; a new build of it is
// pending again, which stops the running one (its cleanup runs).
#[test]
fn a_project_typescript_plugin_waits_for_approval() {
    if config().is_none() {
        return;
    }
    model::check(&PendingModel, 6, 16);
}

// The fixed rows of that machine: the guard that its oracles can fail is the approval itself, which runs the probe.
#[test]
fn the_fixed_typescript_approval_rows_pass() {
    if config().is_none() {
        return;
    }
    let rows: &[(&str, &[Ask])] = &[
        ("an-approval-runs-it", &[Ask::Approve, Ask::Run]),
        ("a-new-build-is-pending-again", &[Ask::Approve, Ask::Change(2), Ask::Run]),
        ("a-decline-names-its-build", &[Ask::Decline, Ask::Change(2), Ask::Change(0), Ask::Run]),
        ("an-approval-of-an-older-build-holds", &[Ask::Approve, Ask::Change(2), Ask::Change(0), Ask::Run]),
        // Seed 1: a save that changes nothing loads nothing again, as TS compares a module's content.
        ("a-save-that-changes-nothing-reloads-nothing", &[Ask::Change(2), Ask::Approve, Ask::Change(2)]),
    ];
    for (name, asks) in rows {
        assert_eq!(PendingModel.run(asks), None, "{name}");
    }
}

// Expected (review jsnpm-5): of two answers given on one build before its hash ended, the later one is recorded and the
// earlier one is dropped silently, however their hashes end. Approve then Decline ends declined, with nothing of it
// run; Approve twice approves once and says nothing about a changed build.
#[test]
fn a_later_answer_supersedes_one_still_hashed() {
    use opencode_plugin::loader::approval::Decision;
    let Some(config) = config() else { return };
    for (answers, listed, setups) in [
        ([Decision::Approved, Decision::Declined], Status::Declined, 0),
        ([Decision::Approved, Decision::Approved], Status::Active, 1),
    ] {
        let project = Project::open(config.clone());
        let tui = &project.pipe.harness.tui;
        let Some((Ok(artifact), _)) = opencode_tui::plugins::host::held(tui, &project.target()) else {
            panic!("nothing is held")
        };
        let told = Rc::new(std::cell::RefCell::new(Vec::new()));
        for decision in answers {
            let told = told.clone();
            opencode_tui::plugins::host::decide(tui, &project.target(), &artifact, decision, move |_, recorded| {
                told.borrow_mut().push((decision, recorded));
            });
        }
        project.pipe.harness.wait("the later answer was recorded", || {
            turn(&project.pipe.harness);
            !told.borrow().is_empty()
        });
        project.settle();
        assert_eq!(*told.borrow(), [(answers[1], Ok(true))], "{answers:?}");
        assert_eq!(project.listed(), Some(listed), "{answers:?}");
        assert_eq!(project.log().0, setups, "{answers:?}");
    }
}

// Expected (the manager's question for a TypeScript plugin, 3.9): the toast and the question name TypeScript code and
// the JS host, the directory and the hash of its files, with Decline active; Enter declines, and approving runs it.
#[test]
fn the_manager_asks_before_a_project_typescript_plugin_runs() {
    let Some(config) = config() else { return };
    let root = opencode_util::temp::tempdir().unwrap();
    let work = root.path().join("work");
    std::fs::create_dir_all(work.join(".git")).unwrap();
    let dir = work.join(".opencode").join("plugins").join("probe");
    copy(&Path::new(EXAMPLES).join("probe"), &dir);
    let harness = support::mount(100, 40, Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) });
    let external = External { config_dir: root.path().join("config"), cwd: work, dev: Vec::new() };
    external_with(&harness.tui, external, Some(config));
    let (app, tui) = (&harness.app, &harness.tui);
    // Its files are hashed off the UI thread (FT-2): the question comes once they are.
    walked(&harness, &tui.plugins.scripts.borrow().clone().unwrap());
    let toast = tui.toasts.current().unwrap();
    assert_eq!(toast.title.as_deref(), Some(&*format!("Plugin needs approval: {}", dir.display())));
    assert!(toast.message.contains("TypeScript code in opencode's JS host"), "{}", toast.message);
    tui.toasts.dismiss();
    tui.keymap.dispatch("plugins.list", None);
    app.advance(Duration::from_millis(16));
    app.type_text("probe");
    app.advance(Duration::from_millis(16));
    app.press("enter");
    app.advance(Duration::from_millis(16));
    let screen = app.text();
    assert!(screen.contains("Run project plugin?"), "{screen}");
    assert!(screen.contains("run TypeScript code in") && screen.contains("Module directory"), "{screen}");
    assert!(screen.contains("SHA-256 of its files"), "{screen}");
    // Decline is active: Enter declines.
    app.press("enter");
    app.advance(Duration::from_millis(16));
    let listed = |status: Status| {
        tui.plugins
            .entries()
            .iter()
            .any(|entry| entry.target.as_deref() == Some(&*dir.to_string_lossy()) && entry.status == status)
    };
    // The decision is recorded off the UI thread, as the walk is.
    harness.wait("the plugin was declined", || {
        app.advance(Duration::from_millis(1));
        listed(Status::Declined)
    });
    assert!(
        tui.plugins.scripts.borrow().as_ref().unwrap().pid().is_none(),
        "the JS host started for a declined plugin"
    );
    // Approving it later runs it.
    app.press("escape");
    app.advance(Duration::from_millis(16));
    tui.keymap.dispatch("plugins.list", None);
    app.advance(Duration::from_millis(16));
    app.type_text("probe");
    app.advance(Duration::from_millis(16));
    app.press("enter");
    app.advance(Duration::from_millis(16));
    app.press("right");
    app.press("enter");
    harness.wait("the approved plugin runs", || {
        app.advance(Duration::from_millis(1));
        tui.plugins.entries().iter().any(|entry| entry.id == PROBE && entry.status == Status::Active)
    });
}

// Review bigboi: rows that fail without each fix.

/// Waits, advancing frames and sending nothing else to the JS host, until `done` holds.
fn quietly(pipe: &Pipe, what: &str, done: impl Fn() -> bool) {
    let begun = Instant::now();
    while !done() {
        assert!(begun.elapsed() < Duration::from_secs(20), "{what}:\n{}", pipe.harness.app.text());
        pipe.harness.app.advance(Duration::from_millis(1));
        std::thread::sleep(Duration::from_millis(1));
    }
}

/// The text of the twin's header on screen.
fn header(pipe: &Pipe) -> String {
    pipe.harness.app.text().lines().find(|line| line.starts_with("twin ")).unwrap_or("").trim().to_owned()
}

// Expected (bigboi-2, bigboi-3, a cut of the JS host): the handler it was running when it ended fails its plugin and is
// not run again; the calls it received and never started are sent again, in order, after the surviving plugin's setup,
// and so is input routed while it is set up again: each runs exactly once. The survivor's JS state is new (setup
// again), so its board counts only those.
#[test]
fn a_cut_runs_what_never_started_once_and_what_ran_never_again() {
    let Some(config) = config() else { return };
    let (pipe, log) = probe_and_twin(config, false);
    twin_open(&pipe);
    let tui = &pipe.harness.tui;
    let pid = pipe.scripts().pid().unwrap();
    tui.keymap.dispatch("probe.hold", Some("800"));
    for _ in 0..3 {
        tui.keymap.dispatch("twin.bump", Some("2"));
    }
    // The hold runs; the bumps wait behind it.
    std::thread::sleep(Duration::from_millis(300));
    pipe.scripts().kill();
    quietly(&pipe, "the cut was noticed", || pipe.scripts().pid().is_some_and(|now| now != pid));
    // Input while the survivor is set up again goes behind its setup, to the new activation: not lost, not run twice.
    tui.keymap.dispatch("twin.bump", Some("2"));
    pipe.settle();
    let error = failed(&pipe, PROBE).unwrap_or_default();
    assert!(error.contains("run-command ended the JS host"), "{error}");
    assert!(calls(&log).is_empty(), "the cut handler ran again: {:?}", calls(&log));
    assert_eq!(pipe.status(twin::ID), Some(Status::Active));
    assert!(header(&pipe).starts_with("twin 4 "), "{}", pipe.harness.app.text());
    assert!(pipe.harness.app.text().contains("card 2: 4"), "{}", pipe.harness.app.text());
}

/// `count` copies of the probe, as `example.probe<n>` with commands `probe<n>.…`, on one JS host with `config`.
fn probes(count: usize, config: Config) -> Pipe {
    let root = opencode_util::temp::tempdir().unwrap();
    let config_dir = root.path().join("config");
    let source = std::fs::read_to_string(Path::new(EXAMPLES).join("probe/tui.ts")).unwrap();
    for index in 0..count {
        let dir = config_dir.join(format!("plugins/probe{index}"));
        std::fs::create_dir_all(&dir).unwrap();
        let source = source
            .replace("\"example.probe\"", &format!("\"example.probe{index}\""))
            .replace("name: \"probe.", &format!("name: \"probe{index}."));
        std::fs::write(dir.join("tui.ts"), source).unwrap();
    }
    let harness = support::mount(80, 30, Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) });
    external_with(&harness.tui, External { config_dir, cwd: root.path().to_path_buf(), dev: Vec::new() }, Some(config));
    let pipe = Pipe { harness, root };
    (0..count).for_each(|index| pipe.active(&format!("example.probe{index}")));
    pipe
}

// Expected (bigboi-3, the production limit of 1 s): five handlers of 270 ms each, sent in one burst, wait in the JS
// host's queue for over a second; a queue that moves is not a hang, so the JS host stays and every plugin stays active.
#[test]
fn a_queue_that_moves_is_not_a_hang() {
    let Some(bun) = bun() else { return };
    let config = Config::new(bun);
    assert_eq!(config.limits.ack, Duration::from_secs(1));
    let pipe = probes(5, config);
    pipe.settle();
    let (pid, started) = (pipe.scripts().pid(), pipe::crossed().started);
    for index in 0..5 {
        pipe.harness.tui.keymap.dispatch(&format!("probe{index}.hold"), Some("270"));
    }
    quietly(&pipe, "the burst was answered", || pipe.scripts().idle());
    assert_eq!((pipe.scripts().pid(), pipe::crossed().started), (pid, started), "the JS host was ended");
    for index in 0..5 {
        assert_eq!(pipe.status(&format!("example.probe{index}")), Some(Status::Active));
    }
}

// Expected (FT-1, the production limit of 1 s): twelve plugins each send a tree while the UI thread is busy for longer
// than the limit; the trees past the bound the host keeps unread hold the JS host's answers back unread too, which is
// the host's time, not the JS host's: it is not ended, and every plugin stays active and draws.
#[test]
fn twelve_plugins_behind_a_busy_ui_thread_are_not_a_hang() {
    let Some(bun) = bun() else { return };
    let config = Config::new(bun);
    assert_eq!((config.limits.ack, config.limits.trees), (Duration::from_secs(1), 8));
    let pipe = probes(12, config);
    pipe.settle();
    let (pid, started) = (pipe.scripts().pid(), pipe::crossed().started);
    for index in 0..12 {
        pipe.harness.tui.keymap.dispatch(&format!("probe{index}.rows"), Some("2"));
    }
    std::thread::sleep(Duration::from_millis(1500));
    pipe.settle();
    assert_eq!((pipe.scripts().pid(), pipe::crossed().started), (pid, started), "the JS host was ended");
    for index in 0..12 {
        assert_eq!(pipe.status(&format!("example.probe{index}")), Some(Status::Active));
    }
    let lines = pipe.harness.app.text().matches("probe line 1").count();
    assert!(lines >= 1, "{}", pipe.harness.app.text());
}

// Expected (bigboi-3): a handler's answer comes once the views it made due were sent, so a view that never returns
// after its command did is a handler that never answered: the JS host is ended at the limit with nothing else sent
// (no ping), and that plugin fails.
#[test]
fn a_view_that_never_returns_after_its_command_ends_the_js_host() {
    let Some(mut config) = config() else { return };
    config.limits.ack = Duration::from_millis(500);
    let (pipe, _log) = probe_and_twin(config, false);
    pipe.settle();
    pipe.harness.tui.keymap.dispatch("probe.stuck", None);
    quietly(&pipe, "the stuck view failed the probe", || failed(&pipe, PROBE).is_some());
    let error = failed(&pipe, PROBE).unwrap();
    assert!(error.contains("run-command ended the JS host: the JS host sent nothing for 500 ms"), "{error}");
    pipe.settle();
    assert_eq!(pipe.status(twin::ID), Some(Status::Active));
}

// Expected (bigboi-4): a full queue is back-pressure, not a fault. A message larger than the whole queue is refused and
// ends nothing; a busy JS host whose queue fills is not ended: what does not fit waits in the host's overflow and goes,
// in order, once it reads; past the overflow's bound a message is refused, counted, and nothing ends. A restart's own
// sends can therefore never end the JS host again (they did, three times, before).
#[test]
fn a_full_queue_is_back_pressure_and_ends_nothing() {
    let Some(mut config) = config() else { return };
    config.limits.queued = 64 << 10;
    config.limits.inbox = 256 << 10;
    let (pipe, log) = probe_and_twin(config, false);
    twin_open(&pipe);
    let tui = &pipe.harness.tui;
    let (pid, started) = (pipe.scripts().pid(), pipe::crossed().started);
    let large = "x".repeat(2 << 20);
    for _ in 0..3 {
        tui.keymap.dispatch("probe.step", Some(&large));
    }
    pipe.settle();
    assert!(calls(&log).is_empty(), "{:?}", calls(&log));
    // Busy, it reads nothing for a while: eight bumps fill its queue and the pipe, and wait in the overflow; none is
    // refused.
    let refused = pipe::crossed().refused_sends;
    tui.keymap.dispatch("probe.hold", Some("400"));
    let middle = "y".repeat(20 << 10);
    for _ in 0..8 {
        tui.keymap.dispatch("twin.bump", Some(&middle));
    }
    pipe.settle();
    assert_eq!(pipe::crossed().refused_sends, refused, "a burst within the overflow was refused");
    assert!(header(&pipe).starts_with("twin 9 "), "{}", header(&pipe));
    // Then more than the overflow holds: the rest is refused.
    let refused = pipe::crossed().refused_sends;
    tui.keymap.dispatch("probe.hold", Some("700"));
    for _ in 0..30 {
        tui.keymap.dispatch("twin.bump", Some(&middle));
    }
    pipe.settle();
    let refused = pipe::crossed().refused_sends - refused;
    assert!(refused > 0 && refused < 30, "{refused} bumps refused: the row did not reach the bound");
    assert_eq!((pipe.scripts().pid(), pipe::crossed().started), (pid, started), "a full queue ended the JS host");
    assert_eq!(pipe.status(PROBE), Some(Status::Active));
    assert_eq!(pipe.status(twin::ID), Some(Status::Active));
    // Every bump that was not refused ran, once, in order.
    assert!(header(&pipe).starts_with(&format!("twin {} ", 9 + 30 - refused)), "{}", header(&pipe));
    assert_eq!(calls(&log), vec![serde_json::json!({ "hold": 400 }), serde_json::json!({ "hold": 700 })]);
}

// Expected (bigboi-5): the keys a holding command held reach the composer after the effects of its answer: here the
// composer set to `set:`, then `ab`.
#[test]
fn held_keys_come_after_the_holding_commands_effects() {
    let Some(config) = config() else { return };
    let (pipe, _log) = probe_and_twin(config, false);
    pipe.settle();
    pipe.harness.tui.keymap.dispatch("probe.holdset", None);
    pipe.harness.app.type_text("ab");
    pipe.settle();
    assert_eq!(pipe.harness.text(), "set:ab");
}

// Expected (bigboi-6): a reload imports the plugin's modules afresh (an edit of a helper alone runs); a replacement whose
// setup throws leaves the running one answering; and a command sent while a candidate's setup runs is answered by the
// activation the host routed it to, the running one.
#[test]
fn a_reload_is_fresh_and_a_candidate_never_answers_for_the_running_one() {
    let Some(config) = config() else { return };
    let pipe = open(&[("reloader", None)], config, (80, 30));
    pipe.active("example.reloader");
    let dir = pipe.root.path().join("config/plugins/reloader");
    let say = || {
        toasts(&pipe.harness);
        pipe.harness.tui.keymap.dispatch("reloader.say", None);
        pipe.settle();
        toasts(&pipe.harness)
    };
    let reload = || {
        opencode_tui::plugins::host::reconcile(&pipe.harness.tui);
        pipe.settle();
    };
    assert_eq!(say(), vec!["v1".to_owned()]);
    std::fs::write(dir.join("label.ts"), "export function label() {\n  return \"v2\"\n}\n").unwrap();
    reload();
    assert_eq!(say(), vec!["v2".to_owned()], "an edit of the helper alone did not run");
    let source = std::fs::read_to_string(dir.join("tui.ts")).unwrap();
    std::fs::write(
        dir.join("tui.ts"),
        source.replace("setup(api: any) {", "setup(api: any) {\n    throw new Error(\"no\")"),
    )
    .unwrap();
    reload();
    assert_eq!(say(), vec!["v2".to_owned()], "a failed replacement took the running one down");
    let slow = source.replace(
        "setup(api: any) {",
        "async setup(api: any) {\n    await new Promise((done) => setTimeout(done, 400))",
    );
    std::fs::write(dir.join("label.ts"), "export function label() {\n  return \"v3\"\n}\n").unwrap();
    std::fs::write(dir.join("tui.ts"), slow).unwrap();
    opencode_tui::plugins::host::reconcile(&pipe.harness.tui);
    pipe.harness.tui.keymap.dispatch("reloader.say", None);
    quietly(&pipe, "the command was answered", || pipe.harness.tui.toasts.current().is_some());
    assert_eq!(toasts(&pipe.harness), vec!["v2".to_owned()], "the candidate answered for the running activation");
    pipe.settle();
    assert_eq!(say(), vec!["v3".to_owned()]);
}

// Expected (bigboi-7, the layout epoch): a revision the JS host built for an input the host has replaced (here, a width
// before a resize) is refused, never shown; the one for the current input follows.
#[test]
fn a_revision_for_a_replaced_size_is_never_shown() {
    let Some(config) = config() else { return };
    let (pipe, _log) = probe_and_twin(config, false);
    twin_open(&pipe);
    assert_eq!(header(&pipe), "twin 1 · 80");
    let refused = pipe::crossed().dropped;
    // The bump's view runs before the JS host reads the new size.
    pipe.harness.tui.keymap.dispatch("probe.hold", Some("400"));
    pipe.harness.tui.keymap.dispatch("twin.bump", Some("0"));
    pipe.harness.app.resize(70, 30);
    let begun = Instant::now();
    while begun.elapsed() < Duration::from_secs(10) && header(&pipe) != "twin 2 · 70" {
        pipe.harness.app.advance(Duration::from_millis(1));
        assert_ne!(header(&pipe), "twin 2 · 80", "a revision for the old width was shown");
        std::thread::sleep(Duration::from_micros(500));
    }
    pipe.settle();
    assert_eq!(header(&pipe), "twin 2 · 70");
    assert!(pipe::crossed().dropped > refused, "no revision was refused: the row did not reach its case");
}

// Expected (bigboi-8): the host keeps only what waits for an answer; mounts, inputs and unmounts, acknowledged, leave
// nothing behind however long the session churns.
#[test]
fn what_is_only_acknowledged_leaves_nothing_behind() {
    let Some(config) = config() else { return };
    let (pipe, _log) = probe_and_twin(config, false);
    let tui = &pipe.harness.tui;
    for round in 0..20 {
        tui.navigate(Route::Plugin { id: twin::ID.to_owned(), name: "twin".to_owned() });
        pipe.harness.app.resize(if round % 2 == 0 { 70 } else { 80 }, 30);
        pipe.settle();
        tui.navigate(Route::Home);
        pipe.settle();
    }
    assert_eq!(pipe.scripts().waiting(), 0);
}

// P2's input over the pipe.

const KEYS: &str = "example.keys";

/// The keys example on the JS host, on a session (a panel docks beside one), and the file it logs to.
fn keys(config: Config) -> (Pipe, PathBuf) {
    let root = opencode_util::temp::tempdir().unwrap();
    let config_dir = root.path().join("config");
    copy(&Path::new(EXAMPLES).join("keys"), &config_dir.join("plugins/keys"));
    let server = support::Fake::new(|seen| support::base(seen, support::DIRECTORY));
    let harness = support::mount(120, 30, support::deps(Arc::new(server)));
    external_with(&harness.tui, External { config_dir, cwd: root.path().to_path_buf(), dev: Vec::new() }, Some(config));
    let pipe = Pipe { harness, root };
    pipe.active(KEYS);
    let log = pipe.root.path().join("config/plugins/.keys.log.jsonl");
    (pipe, log)
}

/// What the keys example's handlers got since the last call, one `owner: what` line each.
fn heard(log: &Path) -> Vec<String> {
    let text = std::fs::read_to_string(log).unwrap_or_default();
    let _ = std::fs::remove_file(log);
    let entries = text.lines().map(serde_json::from_str::<serde_json::Map<String, serde_json::Value>>);
    entries.flat_map(Result::unwrap).map(|(owner, what)| format!("{owner}: {}", what.as_str().unwrap_or(""))).collect()
}

/// Dispatches `keys` as one polled batch, then waits for the JS host's answers without moving the clock, so no hold
/// times out on a busy machine, and settles.
fn burst(pipe: &Pipe, keys: &[(char, Modifiers)]) {
    for (key, modifiers) in keys {
        pipe.harness.app.app().dispatch(Event::Key(KeyEvent::new(KeyCode::Char(*key), *modifiers)));
    }
    let begun = Instant::now();
    while !pipe.scripts().idle() {
        assert!(begun.elapsed() < Duration::from_secs(20), "the JS host never answered");
        pipe.harness.app.advance(Duration::ZERO);
        std::thread::sleep(Duration::from_micros(200));
    }
    pipe.settle();
}

/// Waits until the screen shows `text`: a surface that mounts asks for its first tree in a later frame.
fn shows(pipe: &Pipe, text: &str) {
    quietly(pipe, &format!("the screen shows {text:?}"), || pipe.harness.app.text().contains(text));
}

fn plain(text: &str) -> Vec<(char, Modifiers)> {
    text.chars().map(|key| (key, Modifiers::NONE)).collect()
}

// Expected (P2 on the pipe, review F3): a key's answer comes a round trip late, so a key that changes how the next
// ones route holds them until its answer applied. `x` sets the composer before the `ab` typed with it; `ctrl+n` enters
// the mode `normal` before `d` and `w` of the same batch, which its layer takes, and `i` leaves it before `cd`: no key is
// lost or misrouted. A listener of every key in the base mode hears each key outside the mode, and passes it on.
#[test]
fn a_modal_composer_on_the_pipe_loses_no_key_at_a_mode_switch() {
    let Some(config) = config() else { return };
    let (pipe, log) = keys(config);
    burst(&pipe, &plain("xab"));
    assert_eq!(pipe.harness.text(), "X:ab");
    assert_eq!(heard(&log), ["any: any x", "setup: hold", "any: any a", "any: any b"]);
    let mut batch = vec![('n', Modifiers::CTRL)];
    batch.extend(plain("dwicd"));
    burst(&pipe, &batch);
    assert_eq!(pipe.harness.text(), "X:abcd");
    assert_eq!(
        heard(&log),
        ["any: any ctrl+n", "setup: normal", "normal: d", "normal: w", "normal: insert", "any: any c", "any: any d"]
    );
}

// Expected (P2 on the pipe): a panel opens, takes the focus and the keys of its layer; a focus effect moves the focus to
// its node, which the read it watches shows; a press on its pointer node is consumed and captures the release; its
// handler's overlay opens over it, with the opener's mount, which hears it closed; closing the panel leaves nothing of
// its input behind.
#[test]
fn a_panel_and_its_overlay_take_keys_and_focus_over_the_pipe() {
    let Some(config) = config() else { return };
    let (pipe, log) = keys(config);
    let tui = &pipe.harness.tui;
    let before = opencode_plugin::interact::ledger(&**tui);
    tui.keymap.dispatch("keys.panel", None);
    pipe.settle();
    shows(&pipe, "SIDE mode=- node=-");
    burst(&pipe, &plain("k"));
    tui.keymap.dispatch("keys.focus", None);
    pipe.settle();
    shows(&pipe, "SIDE mode=- node=a");
    // A press on its node is consumed (no click of the host's runs), and the release reaches the node it captured.
    // One cell in: the panel's first column is its splitter's.
    let (x, y) = support::at(&pipe.harness.app.text(), "node a").map(|(x, y)| (x + 1, y)).unwrap();
    pipe.harness.app.mouse(MouseEventKind::Down(MouseButton::Left), x, y);
    pipe.settle();
    assert!(opencode_plugin::interact::ledger(&**tui).capture, "a consumed press captured nothing");
    pipe.harness.app.mouse(MouseEventKind::Up(MouseButton::Left), x, y);
    pipe.settle();
    burst(&pipe, &plain("o"));
    shows(&pipe, "MENU one");
    burst(&pipe, &plain("m"));
    pipe.harness.app.press("escape");
    pipe.settle();
    assert!(!pipe.harness.app.text().contains("MENU one"), "{}", pipe.harness.app.text());
    let heard = heard(&log).into_iter().filter(|line| !line.starts_with("any: ")).collect::<Vec<_>>();
    assert_eq!(heard, ["side: k", "side: pointer down", "side: pointer up", "side: open", "menu: m", "side: closed"]);
    tui.keymap.dispatch("keys.close", None);
    pipe.settle();
    assert!(!pipe.harness.app.text().contains("SIDE"), "{}", pipe.harness.app.text());
    assert_eq!(opencode_plugin::interact::ledger(&**tui), before);
}

// Expected (P2 on the pipe, synthesis 3.8): a JS host that ends takes the modes its plugins set with it: their JS state
// is gone. The plugin is set up again, its layers stay, and the keys route as if no mode were set.
#[test]
fn a_mode_ends_with_the_js_host_that_set_it() {
    let Some(config) = config() else { return };
    let (pipe, log) = keys(config);
    let base = opencode_plugin::interact::ledger(&*pipe.harness.tui);
    burst(&pipe, &[('n', Modifiers::CTRL)]);
    assert_eq!(opencode_plugin::interact::ledger(&*pipe.harness.tui).modes, base.modes + 1);
    let pid = pipe.scripts().pid().unwrap();
    pipe.scripts().kill();
    quietly(&pipe, "the end was noticed", || pipe.scripts().pid().is_some_and(|now| now != pid));
    pipe.settle();
    assert_eq!(pipe.status(KEYS), Some(Status::Active));
    assert_eq!(opencode_plugin::interact::ledger(&*pipe.harness.tui), base);
    heard(&log);
    burst(&pipe, &plain("dx"));
    assert_eq!(pipe.harness.text(), "X:");
    assert_eq!(heard(&log), ["any: any d", "any: any x", "setup: hold"]);
}

// Review carbon: rows that fail without each fix.

const LAB: &str = "example.lab";

/// The lab and the twin on one JS host, on Home, where the lab's slot shows.
fn lab(config: Config) -> Pipe {
    let pipe = open(&[("lab", None), ("twin", None)], config, (100, 30));
    pipe.active(LAB);
    pipe.active(twin::ID);
    shows(&pipe, "lab c=0");
    pipe
}

/// Whether the keymap has command `id`.
fn registered(pipe: &Pipe, id: &str) -> bool {
    pipe.harness.tui.keymap.commands().iter().any(|command| command.id == id)
}

/// Waits for a toast that starts with `start`, and returns it.
fn toasted(pipe: &Pipe, start: &str) -> String {
    let current =
        || pipe.harness.tui.toasts.current().map(|toast| toast.message).filter(|message| message.starts_with(start));
    quietly(pipe, &format!("a toast {start:?}"), || current().is_some());
    current().unwrap()
}

// Expected (carbon-8): the setup context says the client's version and channel, and the theme's mode.
#[test]
fn the_setup_context_says_the_client_and_its_theme() {
    let Some(mut config) = config() else { return };
    (config.version, config.channel) = ("9.9.9".to_owned(), "beta".to_owned());
    let pipe = lab(config);
    pipe.harness.tui.keymap.dispatch("lab.context", None);
    assert_eq!(toasted(&pipe, "9.9.9"), "9.9.9 beta dark");
}

// Expected (carbon-8, carbon-9 CM5, CM6): a stored key the manifest declares is written, answered and watched; once
// unwatched, a change of it is not pushed.
#[test]
fn a_stored_value_is_answered_watched_and_unwatched() {
    let Some(config) = config() else { return };
    let pipe = lab(config);
    let tui = &pipe.harness.tui;
    tui.keymap.dispatch("lab.store", Some("x"));
    let stored = toasted(&pipe, "stored");
    assert!(stored.contains(r#"\"text\":\"x\""#), "{stored}");
    shows(&pipe, r#"note={"text":"x"}"#);
    tui.keymap.dispatch("lab.unwatch", None);
    pipe.settle();
    toasts(&pipe.harness);
    tui.keymap.dispatch("lab.store", Some("y"));
    assert!(toasted(&pipe, "stored").contains(r#"\"text\":\"y\""#));
    shows(&pipe, "note=null");
    pipe.settle();
    toasts(&pipe.harness);
    assert!(!pipe.harness.app.text().contains(r#"\"y\""#), "{}", pipe.harness.app.text());
}

// Expected (carbon-8, FT-9): a plugin watches at most 128 reads, its note and 127 of the 140 others; the rest are not
// answered.
#[test]
fn a_plugin_watches_at_most_128_reads() {
    let Some(config) = config() else { return };
    let pipe = lab(config);
    pipe.harness.tui.keymap.dispatch("lab.watches", None);
    assert_eq!(toasted(&pipe, "watches"), "watches 127");
}

/// Runs `command` of the lab, which ends it, and checks it alone failed with `cause` and whether the JS host `ended`.
fn lab_fails(command: &str, cause: &str, ended: bool) {
    let Some(config) = config() else { return };
    let pipe = lab(config);
    let tui = &pipe.harness.tui;
    let (pid, started) = (pipe.scripts().pid(), pipe::crossed().started);
    tui.keymap.dispatch(command, None);
    // Queued behind it: never started when it ended the JS host, or ran before its view did.
    tui.keymap.dispatch("twin.bump", Some("1"));
    tui.keymap.dispatch("twin.bump", Some("1"));
    quietly(&pipe, "the lab failed", || failed(&pipe, LAB).is_some());
    pipe.settle();
    let error = failed(&pipe, LAB).unwrap();
    assert!(error.contains(cause), "{error}");
    assert_eq!(pipe::crossed().started - started, u64::from(ended), "{error}");
    assert_eq!(pipe.scripts().pid() == pid, !ended);
    assert_eq!(pipe.status(twin::ID), Some(Status::Active));
    // The twin answers: its state is its own, or new after an end.
    tui.navigate(Route::Plugin { id: twin::ID.to_owned(), name: "twin".to_owned() });
    pipe.settle();
    let total = |pipe: &Pipe| header(pipe).split(' ').nth(1).and_then(|total| total.parse::<u32>().ok()).unwrap();
    let before = total(&pipe);
    assert!(ended || before == 2, "{}", pipe.harness.app.text());
    tui.keymap.dispatch("twin.bump", Some("1"));
    pipe.settle();
    assert_eq!(total(&pipe), before + 1);
}

// Expected (carbon-5): an effect that is not JSON fails its plugin alone; the JS host stays.
#[test]
fn an_effect_that_is_not_json_fails_its_plugin_alone() {
    lab_fails("lab.bigint", "not JSON", false);
}

// Expected (carbon-5): a view that is not JSON fails its plugin alone; the JS host stays.
#[test]
fn a_view_that_is_not_json_fails_its_plugin_alone() {
    lab_fails("lab.bigview", "BigInt", false);
}

// Expected (carbon-3): a view that ends the JS host fails its own plugin, not one whose call waited behind it.
#[test]
fn a_view_that_ends_the_js_host_fails_its_plugin_alone() {
    lab_fails("lab.exit", "ended the JS host", true);
}

// Expected (carbon-7): a memo within a kept memo stays known: the inner subtree is not built again, though its outer one
// was kept, then built again. Counted from once the slot's size is settled: a first tree that went out before the slot
// was laid out is refused, and the next is built whole (review bigboi-7).
#[test]
fn a_memo_within_a_kept_memo_stays_known() {
    let Some(config) = config() else { return };
    let pipe = lab(config);
    let tui = &pipe.harness.tui;
    pipe.settle();
    tui.keymap.dispatch("lab.inner", None);
    let built = toasted(&pipe, "inner");
    tui.toasts.dismiss();
    tui.keymap.dispatch("lab.c", None);
    shows(&pipe, "lab c=1");
    tui.keymap.dispatch("lab.a", None);
    shows(&pipe, "lab a=1");
    tui.keymap.dispatch("lab.inner", None);
    assert_eq!(toasted(&pipe, "inner"), built);
}

// Expected (carbon-7, carbon-9 CM2): content a view releases goes, and so does what a JS host that ended gave: the host
// holds the content of the trees it shows, however many views and restarts.
#[test]
fn released_content_and_a_restarted_hosts_content_go() {
    let Some(mut config) = config() else { return };
    config.ends = 10;
    let pipe = lab(config);
    let tui = &pipe.harness.tui;
    let held = opencode_plugin::surface::ledger().content;
    for round in 1..=4 {
        tui.keymap.dispatch("lab.c", None);
        shows(&pipe, &format!("lab c={round}"));
    }
    assert_eq!(opencode_plugin::surface::ledger().content, held, "a released handle was kept");
    for _ in 0..2 {
        let pid = pipe.scripts().pid().unwrap();
        pipe.scripts().kill();
        quietly(&pipe, "the end was noticed", || pipe.scripts().pid().is_some_and(|now| now != pid));
        shows(&pipe, "lab c=0");
        pipe.settle();
    }
    assert_eq!(opencode_plugin::surface::ledger().content, held, "an ended JS host's content was kept");
}

// Expected (carbon-7): a slot that shows no rows takes the height it was laid out at when it mounts again: the prompt
// does not move while its first tree is on its way. (At this tip a slot's root lays out one row at least, so the
// screen's stand-in size, which carbon saw recorded, never reaches a mount that showed a tree.)
#[test]
fn a_slot_of_no_rows_reserves_none_again() {
    let Some(config) = config() else { return };
    let pipe = lab(config);
    let tui = &pipe.harness.tui;
    tui.keymap.dispatch("lab.zero", None);
    quietly(&pipe, "the slot went", || !pipe.harness.app.text().contains("lab c="));
    pipe.settle();
    let at = |pipe: &Pipe| support::at(&pipe.harness.app.text(), "Ask anything");
    let before = at(&pipe);
    tui.navigate(Route::Plugin { id: twin::ID.to_owned(), name: "twin".to_owned() });
    pipe.settle();
    tui.navigate(Route::Home);
    pipe.harness.app.render();
    assert_eq!(at(&pipe), before, "the placeholder reserved rows:\n{}", pipe.harness.app.text());
}

// Expected (carbon-3): a new version whose import ends the JS host fails its plugin once: the running version is not
// set up again from the files that ended it, so the JS host starts once more, and the others stay.
#[test]
fn a_new_version_that_ends_the_js_host_starts_it_once() {
    let Some(config) = config() else { return };
    let pipe = open(&[("reloader", None), ("twin", None)], config, (80, 30));
    pipe.active("example.reloader");
    pipe.active(twin::ID);
    let started = pipe::crossed().started;
    let file = pipe.root.path().join("config/plugins/reloader/tui.ts");
    let source = std::fs::read_to_string(&file).unwrap();
    std::fs::write(&file, format!("process.exit(7)\n{source}")).unwrap();
    opencode_tui::plugins::host::reconcile(&pipe.harness.tui);
    quietly(&pipe, "the reloader failed", || failed(&pipe, "example.reloader").is_some());
    pipe.settle();
    assert_eq!(pipe::crossed().started, started + 1);
    assert!(failed(&pipe, "example.reloader").unwrap().contains("ended the JS host"));
    assert_eq!(pipe.status(twin::ID), Some(Status::Active));
}

// Expected (carbon-2): a plugin directory that moves frees its ID on the JS host: the plugin loads from the new one.
#[test]
fn a_moved_plugin_loads_from_its_new_directory() {
    let Some(config) = config() else { return };
    let pipe = open(&[("reloader", None)], config, (80, 30));
    pipe.active("example.reloader");
    let plugins = pipe.root.path().join("config/plugins");
    std::fs::rename(plugins.join("reloader"), plugins.join("moved")).unwrap();
    opencode_tui::plugins::host::reconcile(&pipe.harness.tui);
    pipe.settle();
    pipe.active("example.reloader");
    toasts(&pipe.harness);
    pipe.harness.tui.keymap.dispatch("reloader.say", None);
    assert_eq!(toasted(&pipe, "v"), "v1");
}

// Expected (carbon-2): a plugin directory whose path holds `#` and `%` loads: the JS host imports it by URL.
#[test]
fn a_plugin_whose_path_holds_url_characters_loads() {
    let Some(config) = config() else { return };
    let pipe = open(&[], config, (80, 30));
    copy(&Path::new(EXAMPLES).join("reloader"), &pipe.root.path().join("config/plugins/re#loader%20"));
    opencode_tui::plugins::host::reconcile(&pipe.harness.tui);
    pipe.active("example.reloader");
}

// Expected (carbon-2): a plugin set up again on a new JS host that registers other commands is loaded again with them,
// and the new activation answers: the old one's end does not deactivate it.
#[test]
fn a_setup_again_that_registers_others_keeps_the_new_activation() {
    let Some(config) = config() else { return };
    let file = std::env::temp_dir().join(format!("dyn-{}-{:?}", std::process::id(), std::thread::current().id()));
    std::fs::write(&file, "1").unwrap();
    let pipe = open(&[("dyn", Some(serde_json::json!({ "file": file.to_string_lossy() })))], config, (80, 30));
    pipe.active("example.dyn");
    std::fs::write(&file, "2").unwrap();
    let pid = pipe.scripts().pid().unwrap();
    pipe.scripts().kill();
    quietly(&pipe, "the end was noticed", || pipe.scripts().pid().is_some_and(|now| now != pid));
    quietly(&pipe, "dyn.c2 was registered", || registered(&pipe, "dyn.c2"));
    pipe.settle();
    toasts(&pipe.harness);
    pipe.harness.tui.keymap.dispatch("dyn.c2", None);
    assert_eq!(toasted(&pipe, "dyn"), "dyn.c2");
    let _ = std::fs::remove_file(&file);
}

// Expected (carbon-8): a plugin a directive disables is described and not set up: none of its setup runs until it is
// enabled, and then it answers.
#[test]
fn a_disabled_plugin_is_not_set_up_until_enabled() {
    let Some(config) = config() else { return };
    let log =
        std::env::temp_dir().join(format!("disabled-{}-{:?}.log", std::process::id(), std::thread::current().id()));
    let _ = std::fs::remove_file(&log);
    let root = opencode_util::temp::tempdir().unwrap();
    let config_dir = root.path().join("config");
    let dir = config_dir.join("plugins").join("probe");
    copy(&Path::new(EXAMPLES).join("probe"), &dir);
    let entries = serde_json::json!({ "plugins": [
        { "package": dir.to_string_lossy(), "options": { "log": log.to_string_lossy() } },
        "-example.probe",
    ] });
    let deps = Deps {
        route: Route::Home,
        config: support::config(support::decode(&entries.to_string())),
        ..support::deps(Arc::new(support::empty()))
    };
    let harness = support::mount(80, 30, deps);
    external_with(&harness.tui, External { config_dir, cwd: root.path().to_path_buf(), dev: Vec::new() }, Some(config));
    let pipe = Pipe { harness, root };
    quietly(&pipe, "the probe is listed", || pipe.status(PROBE).is_some());
    pipe.settle();
    assert_eq!(pipe.status(PROBE), Some(Status::Inactive));
    assert_eq!(setups(&log), 0, "a disabled plugin's setup ran");
    let host = opencode_tui::plugins::host::host(&pipe.harness.tui);
    assert!(pipe.harness.tui.plugins.set_active(&host, PROBE, true));
    pipe.active(PROBE);
    quietly(&pipe, "probe.step was registered", || registered(&pipe, "probe.step"));
    pipe.settle();
    assert_eq!(setups(&log), 1);
    pipe.harness.tui.keymap.dispatch("probe.step", Some("1"));
    assert_eq!(toasted(&pipe, "step"), "step 1");
    let _ = std::fs::remove_file(&log);
}

// Expected (carbon-1): safe mode holds a TypeScript plugin as it holds a library: nothing of it runs, and no JS host
// starts for it.
#[test]
fn safe_mode_holds_a_typescript_plugin() {
    let Some(config) = config() else { return };
    let log = std::env::temp_dir().join(format!("safe-{}-{:?}.log", std::process::id(), std::thread::current().id()));
    let _ = std::fs::remove_file(&log);
    let root = opencode_util::temp::tempdir().unwrap();
    let config_dir = root.path().join("config");
    let dir = config_dir.join("plugins").join("probe");
    copy(&Path::new(EXAMPLES).join("probe"), &dir);
    let entries = serde_json::json!({ "plugins": [{ "package": dir.to_string_lossy(), "options": { "log": log.to_string_lossy() } }] });
    let deps = Deps {
        route: Route::Home,
        config: support::config(support::decode(&entries.to_string())),
        ..support::deps(Arc::new(support::empty()))
    };
    let harness = support::mount(80, 30, deps);
    harness.tui.plugins.set_safe();
    external_with(&harness.tui, External { config_dir, cwd: root.path().to_path_buf(), dev: Vec::new() }, Some(config));
    let pipe = Pipe { harness, root };
    for _ in 0..50 {
        pipe.harness.app.advance(Duration::from_millis(1));
        std::thread::sleep(Duration::from_millis(2));
    }
    assert_eq!(pipe.scripts().pid(), None, "a JS host started in safe mode");
    assert_eq!(setups(&log), 0);
    assert_ne!(pipe.status(PROBE), Some(Status::Active));
}

// Expected (carbon-4, synthesis 3.8): the reserved chord is never held: during a command's hold it reaches the host at
// once (here it clears the prompt), and the keys the hold kept are dropped.
#[test]
fn the_reserved_chord_goes_through_a_hold() {
    let Some(config) = config() else { return };
    let (pipe, _log) = probe_and_twin(config, false);
    pipe.settle();
    pipe.harness.app.type_text("xy");
    pipe.settle();
    pipe.harness.tui.keymap.dispatch("probe.hold", Some("300"));
    pipe.harness.app.type_text("ab");
    pipe.harness.app.app().dispatch(Event::Key(KeyEvent::new(KeyCode::Char('c'), Modifiers::CTRL)));
    assert_eq!(pipe.harness.text(), "", "the reserved chord was held");
    pipe.settle();
    pipe.harness.app.type_text("z");
    pipe.settle();
    assert_eq!(pipe.harness.text(), "z", "what the hold kept came after the chord");
}

// Expected (carbon-6): the JS host exits once the client that started it is gone, though its input stays open: here
// its parent, a shell, exits at once and something else holds its input.
#[cfg(target_os = "linux")]
#[test]
fn the_js_host_exits_when_its_client_is_gone() {
    let Some(bun) = bun() else { return };
    let host = Path::new(env!("CARGO_MANIFEST_DIR")).join("../plugin/src/pipe/host.ts");
    // The shell lives until the JS host started as its child, then exits.
    let script = format!(
        "sleep 12 </dev/null 2>/dev/null | {} {} >/dev/null 2>&1 & echo $!; sleep 1",
        bun.display(),
        host.display()
    );
    let output =
        std::process::Command::new("sh").arg("-c").arg(script).stderr(std::process::Stdio::null()).output().unwrap();
    let pid: u32 = String::from_utf8_lossy(&output.stdout).trim().parse().unwrap();
    let begun = Instant::now();
    let alive = || {
        let state = std::fs::read_to_string(format!("/proc/{pid}/stat")).unwrap_or_default();
        !state.is_empty() && !state.contains(") Z ")
    };
    while alive() && begun.elapsed() < Duration::from_secs(10) {
        std::thread::sleep(Duration::from_millis(20));
    }
    assert!(!alive(), "the JS host {pid} outlived its client");
}

// Expected (carbon-9, CM9): a plugin directory without a TUI module is listed as skipped, and nothing of it runs; its
// reason says so, with what the resolution said (win11-runs D2).
#[test]
fn a_directory_without_a_tui_module_is_skipped() {
    let Some(config) = config() else { return };
    let pipe = open(&[("twin", None)], config, (80, 30));
    pipe.active(twin::ID);
    let dir = pipe.root.path().join("config").join("plugins").join("server-only");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("server.ts"), "export default {}\n").unwrap();
    opencode_tui::plugins::host::reconcile(&pipe.harness.tui);
    let target = dir.to_string_lossy().into_owned();
    let skipped = || {
        // Skipped for good, not while it starts.
        let entries = pipe.harness.tui.plugins.entries();
        entries.into_iter().any(|entry| {
            entry.target.as_deref() == Some(target.as_str())
                && matches!(&entry.status, Status::Skipped(reason)
                    if reason.starts_with(&format!("{}: ", opencode_plugin::NO_TUI_MODULE))
                        && reason.contains("tui"))
        })
    };
    quietly(&pipe, "the directory was skipped", skipped);
}

// Expected (win11-runs D2): a plugin directory the config names by its verbatim spelling (`\\?\C:\…`) loads as the same
// directory spelled plainly does, though Bun resolves nothing under a verbatim directory.
#[cfg(windows)]
#[test]
fn a_directory_named_by_its_verbatim_path_loads() {
    let Some(config) = config() else { return };
    let root = opencode_util::temp::tempdir().unwrap();
    let dir = root.path().canonicalize().unwrap().join("elsewhere").join("twin");
    copy(&Path::new(EXAMPLES).join("twin"), &dir);
    let verbatim = dir.to_string_lossy().into_owned();
    assert!(verbatim.starts_with(r"\\?\"), "{verbatim}");
    let mut deps = Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) };
    let info = serde_json::json!({ "plugins": [{ "package": verbatim, "options": {} }] });
    deps.config = support::config(support::decode(&info.to_string()));
    let harness = support::mount(80, 30, deps);
    let external = External { config_dir: root.path().join("config"), cwd: root.path().to_path_buf(), dev: Vec::new() };
    external_with(&harness.tui, external, Some(config));
    let pipe = Pipe { harness, root };
    pipe.active(twin::ID);
}

// Expected (carbon-8): a watch a handler made is gone with the JS host that ended: the setup again makes its own, and the
// host pushes nothing for the old one, though its read changed.
#[test]
fn a_handlers_watch_ends_with_its_js_host() {
    let Some(mut config) = config() else { return };
    config.ends = 10;
    let pipe = lab(config);
    let tui = &pipe.harness.tui;
    tui.keymap.dispatch("lab.late", None);
    pipe.settle();
    tui.keymap.dispatch("lab.lateread", None);
    assert_eq!(toasted(&pipe, "late"), "late true");
    toasts(&pipe.harness);
    // The JS host ran all it was sent: the kill ends no plugin's code, which would fail that plugin.
    pipe.settle();
    let pid = pipe.scripts().pid().unwrap();
    pipe.scripts().kill();
    quietly(&pipe, "the end was noticed", || pipe.scripts().pid().is_some_and(|now| now != pid));
    pipe.settle();
    // The read it watched changes.
    pipe.harness.app.resize(90, 30);
    pipe.settle();
    tui.keymap.dispatch("lab.lateread", None);
    assert_eq!(toasted(&pipe, "late"), "late false");
}

// Expected (carbon-8): a call that asks for more effects than the host runs at once fails its plugin, with none of them.
#[test]
fn a_call_over_the_effect_bound_fails_its_plugin() {
    let Some(config) = config() else { return };
    let pipe = lab(config);
    pipe.harness.tui.keymap.dispatch("lab.effects", Some("300"));
    quietly(&pipe, "the lab failed", || failed(&pipe, LAB).is_some());
    assert!(failed(&pipe, LAB).unwrap().contains("300 effects"));
    assert_eq!(pipe.status(twin::ID), Some(Status::Active));
}

/// Not a row: the client the next row kills outright. Its JS host runs the spawner, whose command spins; it prints the
/// JS host's process ID and waits to be killed.
#[test]
fn a_client_whose_plugin_spawns() {
    let Some(pids) = std::env::var_os("PIPE_SPAWN_CLIENT") else { return };
    let Some(config) = config() else { return };
    let options = serde_json::json!({ "pids": pids.to_string_lossy() });
    let pipe = open(&[("spawner", Some(options))], config, (80, 30));
    pipe.active("example.spawner");
    pipe.settle();
    pipe.harness.tui.keymap.dispatch("spawner.spin", None);
    for _ in 0..50 {
        pipe.harness.app.advance(Duration::from_millis(1));
        std::thread::sleep(Duration::from_millis(2));
    }
    println!("\nhost {} .", pipe.scripts().pid().unwrap());
    std::thread::sleep(Duration::from_secs(30));
}

// Expected (no orphans): a client killed outright, with no destructor and no reaper, while its JS host spins in a
// plugin's command, leaves nothing that plugin started: neither its child nor one in a session of its own whose parent
// exited, nor the JS host. Linux only; macOS and Windows do not run it.
#[cfg(target_os = "linux")]
#[test]
fn a_client_killed_outright_leaves_nothing_its_plugins_started() {
    use std::io::BufRead;
    if bun().is_none() {
        return;
    }
    let pids = std::env::temp_dir().join(format!("spawned-{}-{:?}", std::process::id(), std::thread::current().id()));
    let _ = std::fs::remove_file(&pids);
    let mut client = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "plugin_pipe::a_client_whose_plugin_spawns", "--nocapture", "--test-threads=1"])
        .env("PIPE_SPAWN_CLIENT", &pids)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .unwrap();
    let mut lines = std::io::BufReader::new(client.stdout.take().unwrap()).lines();
    let host: u32 = lines.find_map(|line| line.ok()?.rsplit_once("host ")?.1.split(' ').next()?.parse().ok()).unwrap();
    let started: Vec<u32> =
        std::fs::read_to_string(&pids).unwrap().split_whitespace().map(|pid| pid.parse().unwrap()).collect();
    let alive = |pid: &u32| {
        let state = std::fs::read_to_string(format!("/proc/{pid}/stat")).unwrap_or_default();
        !state.is_empty() && !state.contains(") Z ")
    };
    let all: Vec<u32> = started.iter().copied().chain([host]).collect();
    assert_eq!(all.len(), 3);
    assert!(all.iter().all(alive), "{all:?} were not all running");
    // SIGKILL on Unix.
    client.kill().unwrap();
    client.wait().unwrap();
    let begun = Instant::now();
    while all.iter().any(alive) && begun.elapsed() < Duration::from_secs(5) {
        std::thread::sleep(Duration::from_millis(20));
    }
    let left: Vec<&u32> = all.iter().filter(|pid| alive(pid)).collect();
    // Nothing must outlive the row either way.
    for pid in &left {
        let _ = std::process::Command::new("kill").args(["-9", &pid.to_string()]).status();
    }
    let _ = std::fs::remove_file(&pids);
    assert!(left.is_empty(), "{left:?} outlived the client (JS host {host})");
}

// Expected (review: bound each read): a watched read more than the JS host takes now (here a stored value the host
// wrote, past an overflow of 256 KiB) is not pushed: the plugin reads nothing, can ask why, and goes on; a small read
// after it is pushed again.
#[test]
fn a_read_over_its_bound_fails_alone() {
    let Some(mut config) = config() else { return };
    config.limits.inbox = 256 << 10;
    let pipe = lab(config);
    let tui = &pipe.harness.tui;
    // Written by the host: the plugin's own write of it would be over the stored value's bound.
    let host = opencode_tui::plugins::host::host(tui);
    let big = serde_json::json!({ "text": "x".repeat(300 << 10) }).to_string();
    opencode_plugin::Host::storage_write(&*host, "plugin.example.lab.note", &big).unwrap();
    opencode_plugin::Host::storage_changed(&*host);
    pipe.settle();
    shows(&pipe, "note=null");
    tui.keymap.dispatch("lab.readerror", None);
    assert!(toasted(&pipe, "read error").contains("more than the JS host takes"), "{:?}", toasts(&pipe.harness));
    toasts(&pipe.harness);
    assert_eq!(pipe.status(LAB), Some(Status::Active));
    tui.keymap.dispatch("lab.store", Some("y"));
    shows(&pipe, r#"note={"text":"y"}"#);
    tui.keymap.dispatch("lab.readerror", None);
    assert_eq!(toasted(&pipe, "read error"), "read error none");
}

// Expected (CT-36): a watched read whose snapshot is past a frame's cap comes in parts: the plugin reads the value, with
// no error. Before, it failed (bigboi's pipe sign-off made it a failed read rather than the value before).
#[test]
fn a_read_past_the_frame_comes_in_parts() {
    let Some(config) = config() else { return };
    let pipe = lab(config);
    let tui = &pipe.harness.tui;
    tui.keymap.dispatch("lab.store", Some("previous"));
    shows(&pipe, r#"note={"text":"previous"}"#);
    let host = opencode_tui::plugins::host::host(tui);
    let near = serde_json::json!({ "text": "x".repeat(300 << 10) }).to_string();
    opencode_plugin::Host::storage_write(&*host, "plugin.example.lab.note", &near).unwrap();
    opencode_plugin::Host::storage_changed(&*host);
    pipe.settle();
    tui.keymap.dispatch("lab.notelength", None);
    assert_eq!(toasted(&pipe, "note length"), format!("note length {}", near.len()));
    tui.keymap.dispatch("lab.readerror", None);
    assert_eq!(toasted(&pipe, "read error"), "read error none");
    assert_eq!(pipe.status(LAB), Some(Status::Active));
}

// Expected (big-boi's `cg4-7`): a read the plugin watches and at once lets go reads as nothing once its snapshot came:
// the snapshot, here of 300 KiB in parts, was on its way, and it set the value again, uncharged, after the unwatch.
#[test]
fn a_snapshot_after_its_unwatch_sets_nothing() {
    let Some(config) = config() else { return };
    let root = opencode_util::temp::tempdir().unwrap();
    let log = root.path().join("report");
    let plugin = root.path().join("config").join("plugins").join("late");
    std::fs::create_dir_all(&plugin).unwrap();
    let module = format!(
        r#"import {{ writeFileSync }} from "node:fs"
export default {{ id: "example.late", setup(api) {{
  const carrier = api[Symbol.for("opencode.carrier")]
  const command = (name, run) => carrier.command({{ name, title: name }}, run)
  carrier.storage(["a"])
  command("late.go", () => {{
    carrier.watch("a", {{ type: "storage-get", key: "a" }})
    carrier.unwatch("a")
  }})
  command("late.report", () => writeFileSync({log}, String(carrier.read("a") === undefined)))
}} }}
"#,
        log = serde_json::json!(log),
    );
    std::fs::write(plugin.join("tui.ts"), module).unwrap();
    let harness = support::mount(80, 30, Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) });
    let host = opencode_tui::plugins::host::host(&harness.tui);
    let value = serde_json::json!({ "t": "x".repeat(300 << 10) }).to_string();
    opencode_plugin::Host::storage_write(&*host, "plugin.example.late.a", &value).unwrap();
    let external = External { config_dir: root.path().join("config"), cwd: root.path().to_path_buf(), dev: Vec::new() };
    external_with(&harness.tui, external, Some(config));
    let pipe = Pipe { harness, root };
    pipe.active("example.late");
    pipe.settle();
    pipe.harness.tui.keymap.dispatch("late.go", None);
    pipe.settle();
    pipe.harness.tui.keymap.dispatch("late.report", None);
    pipe.settle();
    assert_eq!(std::fs::read_to_string(&log).unwrap(), "true", "the late snapshot set the read");
}

// Expected (big-boi's `cg4-2`): a stored value's snapshot carries its JSON, not its text quoted again: a value of 200
// KiB of backslashes goes in about that many bytes, where quoting its text again doubled them, and a value of the
// stored bound could pass what the JS host takes.
#[test]
fn a_stored_values_snapshot_is_not_escaped_twice() {
    let Some(config) = config() else { return };
    let pipe = lab(config);
    let host = opencode_tui::plugins::host::host(&pipe.harness.tui);
    let slashes = serde_json::json!({ "text": "\\".repeat(100 << 10) }).to_string();
    assert!(slashes.len() > 200 << 10);
    let before = opencode_plugin::pipe::crossed().sent_bytes;
    opencode_plugin::Host::storage_write(&*host, "plugin.example.lab.note", &slashes).unwrap();
    opencode_plugin::Host::storage_changed(&*host);
    pipe.settle();
    let sent = opencode_plugin::pipe::crossed().sent_bytes - before;
    pipe.harness.tui.keymap.dispatch("lab.notelength", None);
    assert_eq!(toasted(&pipe, "note length"), format!("note length {}", slashes.len()));
    assert!(sent < (slashes.len() as u64) * 5 / 4, "{sent} bytes sent for a value of {}", slashes.len());
}

// Expected (big-boi's catalog review, last): a plugin disabled while the JS host reads nothing and the overflow is full
// still has its activation deactivated once the JS host reads again, so a fetch the host took settles once, refused, and
// the reply that comes after reaches nothing. The full overflow refused the deactivation, and the fetch waited for good.
#[test]
fn a_deactivation_past_a_full_overflow_settles_what_it_awaits() {
    let Some(mut config) = config() else { return };
    (config.limits.queued, config.limits.inbox, config.limits.ordered) = (40 << 10, 64 << 10, 1 << 16);
    let root = opencode_util::temp::tempdir().unwrap();
    let (log, stalled, gate) = (root.path().join("settled"), root.path().join("stalled"), root.path().join("gate"));
    let plugin = root.path().join("config").join("plugins").join("ending");
    std::fs::create_dir_all(&plugin).unwrap();
    let module = format!(
        r#"import {{ appendFileSync, existsSync, writeFileSync }} from "node:fs"
const [LOG, STALLED, GATE] = {paths}
export default {{ id: "example.ending", setup(api) {{
  const carrier = api[Symbol.for("opencode.carrier")]
  const command = (name, run) => carrier.command({{ name, title: name }}, run)
  command("ending.fetch", () => {{
    carrier.fetch({{ method: "GET", path: "/api/held" }}).then((result) => appendFileSync(LOG, "settled " + Object.keys(result ?? {{}}).join(",") + "\n"))
  }})
  // The JS host reads nothing until the gate opens.
  command("ending.stall", () => setTimeout(() => {{
    writeFileSync(STALLED, "")
    while (!existsSync(GATE)) {{}}
  }}, 0))
  command("ending.noop", () => {{}})
}} }}
"#,
        paths = serde_json::json!([log, stalled, gate]),
    );
    std::fs::write(plugin.join("tui.ts"), module).unwrap();
    let open = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let asked = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let (server_gate, seen) = (open.clone(), asked.clone());
    let server = support::Fake::new(move |request| match request.path.as_str() {
        "/api/held" => {
            seen.store(true, std::sync::atomic::Ordering::SeqCst);
            let begun = Instant::now();
            while !server_gate.load(std::sync::atomic::Ordering::SeqCst) && begun.elapsed() < Duration::from_secs(20) {
                std::thread::sleep(Duration::from_millis(2));
            }
            (200, serde_json::json!({ "held": true }))
        }
        "/api/session" => (200, serde_json::json!({ "data": [], "cursor": {} })),
        _ => support::not_found(),
    });
    let harness = support::mount(80, 30, Deps { route: Route::Home, ..support::deps(Arc::new(server)) });
    let external = External { config_dir: root.path().join("config"), cwd: root.path().to_path_buf(), dev: Vec::new() };
    external_with(&harness.tui, external, Some(config));
    let pipe = Pipe { harness, root };
    pipe.active("example.ending");
    pipe.settle();
    let (h, scripts) = (&pipe.harness, pipe.scripts());
    h.tui.keymap.dispatch("ending.fetch", None);
    h.wait("the server has the request", || {
        h.app.advance(Duration::from_millis(1));
        asked.load(std::sync::atomic::Ordering::SeqCst)
    });
    h.tui.keymap.dispatch("ending.stall", None);
    h.wait("the JS host stalled", || {
        h.app.advance(Duration::from_millis(1));
        stalled.exists()
    });
    // A backlog until the overflow refuses what comes: it is full.
    let refused = pipe::crossed().refused_sends;
    for _ in 0..10_000 {
        if pipe::crossed().refused_sends > refused {
            break;
        }
        h.tui.keymap.dispatch("ending.noop", Some(&"x".repeat(2 << 10)));
    }
    assert!(pipe::crossed().refused_sends > refused, "the overflow never filled");
    // To its last bytes, with pings smaller than a deactivation.
    let refused = pipe::crossed().refused_sends;
    for _ in 0..10_000 {
        if pipe::crossed().refused_sends > refused {
            break;
        }
        scripts.ping();
    }
    assert!(pipe::crossed().refused_sends > refused, "a ping still had room");
    h.tui.plugins.set_active(&opencode_tui::plugins::host::host(&h.tui), "example.ending", false);
    for _ in 0..20 {
        h.app.advance(Duration::from_millis(1));
    }
    std::fs::write(&gate, "").unwrap();
    pipe.settle();
    assert_eq!(scripts.overflow_bytes(), 0, "the overflow drained");
    h.wait("the fetch settled", || {
        h.app.advance(Duration::from_millis(1));
        std::fs::read_to_string(&log).is_ok_and(|text| text.ends_with('\n'))
    });
    open.store(true, std::sync::atomic::Ordering::SeqCst);
    for _ in 0..200 {
        h.app.advance(Duration::from_millis(2));
        std::thread::sleep(Duration::from_millis(1));
    }
    pipe.settle();
    assert_eq!(std::fs::read_to_string(&log).unwrap(), "settled Err\n", "settled once, refused");
}

// Expected (bigboi's pipe sign-off, recheck): a watched read whose snapshot fits a frame but not what is left of the
// overflow goes as a failed read, and charges the plugin's content nothing as it is refused. Once the queue drained it
// is pushed again, though it did not change (big-boi's `cg4-8`: it stayed failed), and holds the room, so a
// neighbouring read that needs it fails on the content bound.
#[test]
fn a_read_the_overflow_refuses_holds_no_content() {
    use opencode_plugin::limits::{self, Limits};
    let Some(mut config) = config() else { return };
    // A frame takes the read; the overflow takes the backlog and not the read beside it.
    (config.limits.queued, config.limits.inbox, config.limits.ordered) = (40 << 10, 64 << 10, 1 << 16);
    let root = opencode_util::temp::tempdir().unwrap();
    let (log, stalled, gate) = (root.path().join("report"), root.path().join("stalled"), root.path().join("gate"));
    let plugin = root.path().join("config").join("plugins").join("quota");
    std::fs::create_dir_all(&plugin).unwrap();
    let module = format!(
        r#"import {{ appendFileSync, existsSync, writeFileSync }} from "node:fs"
const [LOG, STALLED, GATE] = {paths}
export default {{ id: "example.quota", setup(api) {{
  const carrier = api[Symbol.for("opencode.carrier")]
  const command = (name, run) => carrier.command({{ name, title: name }}, run)
  carrier.storage(["a", "b"])
  carrier.watch("a", {{ type: "storage-get", key: "a" }})
  carrier.watch("b", {{ type: "storage-get", key: "b" }})
  // The JS host reads nothing until the gate opens.
  command("quota.stall", () => setTimeout(() => {{
    writeFileSync(STALLED, "")
    while (!existsSync(GATE)) {{}}
  }}, 0))
  command("quota.noop", () => {{}})
  const read = (key) => key + " " + (carrier.read(key) == null ? 0 : JSON.stringify(carrier.read(key)).length) + " " + (carrier.readError(key) ?? "none")
  command("quota.report", () => appendFileSync(LOG, read("a") + " | " + read("b") + "\n"))
}} }}
"#,
        paths = serde_json::json!([log, stalled, gate]),
    );
    std::fs::write(plugin.join("tui.ts"), module).unwrap();
    let harness = support::mount(80, 30, Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) });
    let external = External { config_dir: root.path().join("config"), cwd: root.path().to_path_buf(), dev: Vec::new() };
    external_with(&harness.tui, external, Some(config));
    let pipe = Pipe { harness, root };
    pipe.active("example.quota");
    pipe.settle();
    let (h, scripts, id) = (&pipe.harness, pipe.scripts(), "example.quota");
    // Its content is its two reads, each nothing yet.
    let null = "null".len() as u64;
    let before = limits::held(id).content;
    assert_eq!(before, 2 * null);
    // Room for one read of 32,779 bytes beside what it holds, not two. Its snapshot carries the stored JSON as it is.
    let _limits = limits::set(Limits { plugin_content: before + (40 << 10), ..limits::get() });
    let value = serde_json::json!({ "t": "x".repeat(32_779 - 8) }).to_string();
    let bytes = value.len();
    assert_eq!(bytes, 32_779);
    h.tui.keymap.dispatch("quota.stall", None);
    h.wait("the JS host stalled", || {
        h.app.advance(Duration::from_millis(1));
        stalled.exists()
    });
    // A backlog that leaves the overflow less room than the read.
    for _ in 0..10_000 {
        if scripts.overflow_bytes() > (64 << 10) - bytes / 2 {
            break;
        }
        h.tui.keymap.dispatch("quota.noop", Some(&"x".repeat(2 << 10)));
    }
    assert!(scripts.overflow_bytes() > (64 << 10) - bytes / 2, "no backlog");
    let refused = pipe::crossed().refused_sends;
    let host = opencode_tui::plugins::host::host(&h.tui);
    opencode_plugin::Host::storage_write(&*host, "plugin.example.quota.a", &value).unwrap();
    opencode_plugin::Host::storage_changed(&*host);
    h.wait("the read was refused", || {
        h.app.advance(Duration::from_millis(1));
        pipe::crossed().refused_sends > refused
    });
    // A failed read holds nothing, as one past the frame: what is left is the neighbour's.
    assert_eq!(limits::held(id).content, null, "the refused read is still charged");
    std::fs::write(&gate, "").unwrap();
    pipe.settle();
    // The queue drained: the read goes again, and holds its room.
    opencode_plugin::Host::storage_changed(&*host);
    pipe.settle();
    assert_eq!(limits::held(id).content, null + bytes as u64, "the refused read was not pushed again");
    // The neighbour needs the room the read holds now.
    opencode_plugin::Host::storage_write(&*host, "plugin.example.quota.b", &value).unwrap();
    opencode_plugin::Host::storage_changed(&*host);
    pipe.settle();
    h.tui.keymap.dispatch("quota.report", None);
    h.wait("the report", || {
        h.app.advance(Duration::from_millis(1));
        std::fs::read_to_string(&log).is_ok_and(|text| text.ends_with('\n'))
    });
    let report = std::fs::read_to_string(&log).unwrap();
    let (a, b) = report.trim_end().split_once(" | ").unwrap();
    assert_eq!(a, format!("a {} none", value.len()));
    assert!(b.starts_with("b 0 the read is ") && b.ends_with("past what the plugin may hold"), "{b}");
}

// Expected (bigboi's pipe sign-off): a load the JS host's queue refuses (here its options are past the frame's cap)
// fails with why, as nothing else answers it; its neighbour on the same JS host is active, and once the JS host
// answered a ping, nothing waits.
#[test]
fn a_load_past_the_frame_fails_and_its_neighbour_runs() {
    let Some(config) = config() else { return };
    let options = serde_json::json!({ "pad": "x".repeat(300 << 10) });
    let pipe = open(&[("lab", None), ("twin", Some(options))], config, (100, 30));
    pipe.active(LAB);
    pipe.settle();
    // It never imported: the loader names it by its directory.
    let twin = pipe.root.path().join("config").join("plugins").join("twin");
    let status = pipe.status(&twin.to_string_lossy());
    let failed = matches!(&status, Some(Status::Failed(error)) if error.contains("no room for a load"));
    assert!(failed, "{status:?}");
    assert_eq!(pipe.status(LAB), Some(Status::Active));
    assert_eq!(pipe.scripts().waiting(), 0);
}

// Expected (no orphans): a TUI that ends as usual leaves nothing a plugin started either, also a process outside the JS
// host's group, which the host's kill of the group misses: the JS host ends it as its input ends.
#[cfg(target_os = "linux")]
#[test]
fn the_tui_ending_leaves_nothing_its_plugins_started() {
    let Some(config) = config() else { return };
    let pids = std::env::temp_dir().join(format!("ended-{}-{:?}", std::process::id(), std::thread::current().id()));
    let _ = std::fs::remove_file(&pids);
    let pipe = open(&[("spawner", Some(serde_json::json!({ "pids": pids.to_string_lossy() })))], config, (80, 30));
    pipe.active("example.spawner");
    pipe.settle();
    let started: Vec<u32> =
        std::fs::read_to_string(&pids).unwrap().split_whitespace().map(|pid| pid.parse().unwrap()).collect();
    let all: Vec<u32> = started.iter().copied().chain(pipe.scripts().pid()).collect();
    assert_eq!(all.len(), 3);
    drop(pipe);
    let left: Vec<u32> = all.into_iter().filter(|pid| !gone(*pid)).collect();
    for pid in &left {
        let _ = std::process::Command::new("kill").args(["-9", &pid.to_string()]).status();
    }
    let _ = std::fs::remove_file(&pids);
    assert!(left.is_empty(), "{left:?} outlived the TUI");
}

// Expected (Pl on the pipe): a JS plugin's trees, content and watched reads are charged like the others'. The lab's
// slot holds its nodes and its content, and a read it watches is charged while it watches it; with no room left in its
// content share, a watched read that grows is not pushed (the plugin reads nothing and can ask why) and goes on; an
// unwatch gives the read's bytes back; with no share at all its diff's new content shows the placeholder; disabled, it
// holds nothing.
#[test]
fn a_js_plugins_trees_content_and_reads_are_held_to_the_limits() {
    use opencode_plugin::limits::{self, Limits};
    let Some(config) = config() else { return };
    let pipe = lab(config);
    let held = limits::held(LAB);
    assert!(held.nodes > 0 && held.content > 0, "the lab holds {held:?}");
    // A read it watches is charged while it is watched.
    pipe.harness.tui.keymap.dispatch("lab.store", Some(&"z".repeat(2000)));
    pipe.settle();
    shows(&pipe, "zzzz");
    let grown = limits::held(LAB).content;
    assert!(grown >= held.content + 2000, "the read is not charged: {} then {grown}", held.content);
    let held = limits::held(LAB);
    let share = |content: u64| limits::set(Limits { plugin_content: content, ..Limits::default() });
    {
        let _limits = share(held.content);
        pipe.harness.tui.keymap.dispatch("lab.store", Some(&"y".repeat(2500)));
        pipe.settle();
        shows(&pipe, "note=null");
        pipe.harness.tui.keymap.dispatch("lab.readerror", None);
        let error = toasted(&pipe, "read error");
        assert!(error.contains("past what the plugin may hold"), "{error}");
        assert_eq!(pipe.status(LAB), Some(Status::Active));
    }
    // Watched again at 2,000 bytes, then not: its unwatch gives the read's bytes back.
    pipe.harness.tui.keymap.dispatch("lab.store", Some(&"z".repeat(2000)));
    pipe.settle();
    shows(&pipe, "zzzz");
    let grown = limits::held(LAB).content;
    pipe.harness.tui.keymap.dispatch("lab.unwatch", None);
    pipe.settle();
    assert!(limits::held(LAB).content + 2000 <= grown, "the read is charged after its unwatch");
    let _limits = share(0);
    pipe.harness.tui.keymap.dispatch("lab.c", None);
    pipe.settle();
    shows(&pipe, "⋯ its content is past what the plugin may hold");
    // Disabled, it holds nothing: its mounts' content and its reads.
    pipe.harness.tui.plugins.toggle(&opencode_tui::plugins::host::host(&pipe.harness.tui), LAB, false);
    pipe.settle();
    assert_eq!(limits::held(LAB), limits::Held::default(), "held once disabled");
}

// Expected (Pl on the pipe): a JS plugin that fails gives back what it held, the reads it watched among it.
#[test]
fn a_failed_js_plugin_holds_nothing() {
    use opencode_plugin::limits;
    let Some(config) = config() else { return };
    let pipe = lab(config);
    pipe.harness.tui.keymap.dispatch("lab.store", Some(&"z".repeat(2000)));
    pipe.settle();
    shows(&pipe, "zzzz");
    pipe.harness.tui.keymap.dispatch("lab.bigint", None);
    quietly(&pipe, "the lab failed", || failed(&pipe, LAB).is_some());
    pipe.settle();
    assert_eq!(limits::held(LAB), limits::Held::default(), "held once failed");
}

// Expected (bigboi P8-9, FT-2): a plugin directory is read to hash it off the UI thread, and not again for each
// reconcile the JS host's answers start: once no file changed lately, reconciles that change no file read none.
#[test]
fn the_js_hosts_answers_hash_no_plugin_again() {
    let Some(config) = config() else { return };
    let names = ["probe", "twin", "lab", "v2probe"];
    let before = opencode_plugin::loader::approval::hashed();
    let pipe = open(&names.map(|name| (name, None)), config, (80, 30));
    for id in ["example.probe", "example.twin", "example.lab", "example.v2probe"] {
        pipe.active(id);
    }
    pipe.settle();
    // A file changed within the last 2 s is read again at each walk, as its next change may keep its size and time.
    std::thread::sleep(Duration::from_millis(2100));
    opencode_tui::plugins::host::reconcile(&pipe.harness.tui);
    pipe.settle();
    let walked = pipe.scripts().hashed();
    assert!(walked > 0, "no walk read the plugins");
    for _ in 0..5 {
        opencode_tui::plugins::host::reconcile(&pipe.harness.tui);
        pipe.settle();
    }
    assert_eq!(pipe.scripts().hashed(), walked, "a reconcile that changed nothing hashed");
    assert_eq!(opencode_plugin::loader::approval::hashed(), before, "the UI thread hashed a plugin's files");
}

// Expected (FT-2): the UI thread reads none of a TypeScript plugin's files as the client starts, so its first frame
// does not wait on them, however many its dependencies hold; the walk off the UI thread reads the plugin's own files
// and each dependency's `package.json`, not the dependencies' files (2,000 of 8 KiB here); and the plugin loads.
#[test]
fn the_first_frame_does_not_wait_on_a_plugins_files() {
    let Some(config) = config() else { return };
    let root = opencode_util::temp::tempdir().unwrap();
    let dir = root.path().join("config/plugins/heavy");
    let lib = dir.join("node_modules/dep/lib");
    std::fs::create_dir_all(&lib).unwrap();
    std::fs::write(dir.join("node_modules/dep/package.json"), r#"{ "name": "dep", "version": "1.0.0" }"#).unwrap();
    let chunk = vec![b'x'; 8 << 10];
    for index in 0..2000 {
        std::fs::write(lib.join(format!("{index}.js")), &chunk).unwrap();
    }
    std::fs::write(dir.join("tui.ts"), "export default { id: \"example.heavy\", setup() {} }\n").unwrap();
    let before = opencode_plugin::loader::approval::hashed();
    let harness = support::mount(80, 30, Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) });
    let external = External { config_dir: root.path().join("config"), cwd: root.path().to_path_buf(), dev: Vec::new() };
    external_with(&harness.tui, external, Some(config));
    harness.app.render();
    assert_eq!(opencode_plugin::loader::approval::hashed(), before, "the UI thread read the plugin's files");
    let pipe = Pipe { harness, root };
    pipe.active("example.heavy");
    let walked = pipe.scripts().hashed();
    assert!(walked > 0 && walked < 64 << 10, "the walk read {walked} bytes");
    assert_eq!(opencode_plugin::loader::approval::hashed(), before, "the UI thread read the plugin's files");
}

// Expected (FT-2, js-followups): the user's Approve on a project's TypeScript plugin with 16 MB of dependencies returns
// before its tree is hashed again, and the UI thread reads none of its files for it: the answer is recorded once the
// hash off the UI thread ends, as the build shown, and the plugin then loads.
#[test]
fn an_approval_does_not_wait_on_a_plugins_files() {
    let Some(config) = config() else { return };
    let root = opencode_util::temp::tempdir().unwrap();
    let work = root.path().join("work");
    std::fs::create_dir_all(work.join(".git")).unwrap();
    let dir = work.join(".opencode").join("plugins").join("heavy");
    let lib = dir.join("node_modules/dep/lib");
    std::fs::create_dir_all(&lib).unwrap();
    std::fs::write(dir.join("node_modules/dep/package.json"), r#"{ "name": "dep", "version": "1.0.0" }"#).unwrap();
    let chunk = vec![b'x'; 8 << 10];
    for index in 0..2000 {
        std::fs::write(lib.join(format!("{index}.js")), &chunk).unwrap();
    }
    std::fs::write(dir.join("tui.ts"), "export default { id: \"example.heavy\", setup() {} }\n").unwrap();
    let harness = support::mount(80, 30, Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) });
    let external = External { config_dir: root.path().join("config"), cwd: work, dev: Vec::new() };
    external_with(&harness.tui, external, Some(config));
    let pipe = Pipe { harness, root };
    walked(&pipe.harness, &pipe.scripts());
    let target = dir.to_string_lossy().into_owned();
    let Some((Ok(artifact), _)) = opencode_tui::plugins::host::held(&pipe.harness.tui, &target) else {
        panic!("nothing is held")
    };
    let before = opencode_plugin::loader::approval::hashed();
    let recorded = Rc::new(std::cell::RefCell::new(None));
    let answer = recorded.clone();
    let decision = opencode_plugin::loader::approval::Decision::Approved;
    opencode_tui::plugins::host::decide(&pipe.harness.tui, &target, &artifact, decision, move |_, recorded| {
        answer.replace(Some(recorded));
    });
    assert!(recorded.borrow().is_none(), "the approval waited on the plugin's tree");
    pipe.harness.wait("the decision was recorded", || {
        turn(&pipe.harness);
        recorded.borrow().is_some()
    });
    assert_eq!(recorded.take(), Some(Ok(true)));
    pipe.active("example.heavy");
    assert_eq!(opencode_plugin::loader::approval::hashed(), before, "the UI thread read the plugin's files");
}

// Expected (FT-2, js-followups): a project plugin's file rewritten after its approval with its size and time kept, so
// the walk's stamp cannot tell, fails the stage of the approved copy; the plugin is held back, its tree is hashed again
// off the UI thread, and the new build is asked about. Nothing of it runs, and the UI thread reads none of its files.
#[test]
fn a_stage_that_finds_other_bytes_hashes_off_the_ui_thread() {
    let Some(config) = config() else { return };
    let root = opencode_util::temp::tempdir().unwrap();
    let work = root.path().join("work");
    std::fs::create_dir_all(work.join(".git")).unwrap();
    let dir = work.join(".opencode").join("plugins").join("staged");
    std::fs::create_dir_all(&dir).unwrap();
    let (marker, data) = (root.path().join("staged.ran"), dir.join("data.js"));
    std::fs::write(&data, "export const made = \"approved\"\n").unwrap();
    let module = format!(
        "import {{ made }} from \"./data.js\"\nexport default {{ id: \"example.staged\", setup() {{ require(\"node:fs\").appendFileSync({marker:?}, made + \" \" + import.meta.dir + \"\\n\") }} }}\n"
    );
    std::fs::write(dir.join("tui.ts"), module).unwrap();
    let harness = support::mount(80, 30, Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) });
    let external = External { config_dir: root.path().join("config"), cwd: work, dev: Vec::new() };
    external_with(&harness.tui, external, Some(config));
    let pipe = Pipe { harness, root };
    pipe.settle();
    let target = dir.to_string_lossy().into_owned();
    let Some((Ok(artifact), _)) = opencode_tui::plugins::host::held(&pipe.harness.tui, &target) else {
        panic!("nothing is held")
    };
    let approved = opencode_plugin::loader::approval::Decision::Approved;
    assert_eq!(decide(&pipe.harness, &target, &artifact, approved), Ok(true));
    pipe.active("example.staged");
    let ran = std::fs::read_to_string(&marker).unwrap();
    let staged = PathBuf::from(ran.trim().strip_prefix("approved ").unwrap());
    // Past the time a recent change makes the stamp racy; the approved copy goes, so the next load stages it again.
    std::thread::sleep(Duration::from_millis(2100));
    let modified = std::fs::metadata(&data).unwrap().modified().unwrap();
    std::fs::write(&data, "export const made = \"replaced\"\n").unwrap();
    std::fs::File::options().write(true).open(&data).unwrap().set_modified(modified).unwrap();
    std::fs::remove_dir_all(&staged).unwrap();
    let before = opencode_plugin::loader::approval::hashed();
    opencode_tui::plugins::host::reconcile(&pipe.harness.tui);
    pipe.settle();
    let listed =
        || pipe.harness.tui.plugins.entries().into_iter().find(|entry| entry.target.as_deref() == Some(&target));
    assert_eq!(listed().map(|entry| entry.status), Some(Status::Pending));
    let Some((Ok(held), _)) = opencode_tui::plugins::host::held(&pipe.harness.tui, &target) else {
        panic!("the new build is not asked about")
    };
    assert_ne!(held.sha256, artifact.sha256);
    assert_eq!(opencode_plugin::loader::approval::hashed(), before, "the UI thread read the plugin's files");
    assert_eq!(std::fs::read_to_string(&marker).unwrap(), ran, "what changed ran");
}

// Expected (carbon-1, the flag on): a project the client works in loads nothing into the JS host as it starts for the
// user's own plugin: not its `bunfig.toml` (a `preload`), not its `.env`, not the `bun` of a relative `PATH` entry.
// Bun starts in a directory of the JS host's own, and the project's directory reaches plugins as data.
#[test]
fn a_hostile_project_loads_nothing_into_the_js_host() {
    hostile(|_| config());
}

// Expected (js-host-runtime): the same holds on the opencode binary run as the Bun it embeds (`BUN_BE_BUN=1`), found as
// the client finds a local server's binary it cannot tell from the process: the first `opencode` on the path that
// answers as Bun, never the project's own behind a relative entry. Its Bun version is reported, and new enough.
#[test]
fn a_hostile_project_loads_nothing_into_the_js_host_on_opencodes_bun() {
    hostile(|project| {
        let path = std::env::var_os("PATH").unwrap_or_default();
        let path = std::env::join_paths(
            [PathBuf::from("bin"), PathBuf::new()].into_iter().chain(std::env::split_paths(&path)),
        )
        .unwrap();
        let var = |name: &str| match name {
            "OPENCODE_PLUGIN_JS" => Some("1".into()),
            "OPENCODE_BUN" => None,
            "PATH" => Some(path.clone()),
            _ => std::env::var_os(name),
        };
        let found =
            Config::from_vars(var, project.to_path_buf(), &pipe::Server::Local(None)).filter(|found| found.opencode);
        let Some(mut found) = found else {
            assert_ne!(std::env::var("OPENCODE_RS_REQUIRE_TS").as_deref(), Ok("1"), "no opencode binary runs as Bun");
            return None;
        };
        let version = found.bun_version.clone().expect("opencode's Bun says its version");
        eprintln!("the JS host runs on {} (opencode's Bun {version})", found.bun.display());
        let numbers: Vec<u64> =
            version.split(['-', '+']).next().unwrap().split('.').map(|n| n.parse().unwrap()).collect();
        assert!((numbers[0], numbers[1], numbers[2]) >= pipe::OLDEST_BUN, "{version}");
        found.limits.ack = Duration::from_secs(10);
        Some(found)
    });
}

/// Opens a project that tries to load code into the JS host, on the JS host `runtime` makes for it.
fn hostile(runtime: impl FnOnce(&Path) -> Option<Config>) {
    let root = opencode_util::temp::tempdir().unwrap();
    let (project, ran) = (root.path().join("work"), root.path().join("ran"));
    std::fs::create_dir_all(project.join("bin")).unwrap();
    let write = |name: &str, text: String| std::fs::write(project.join(name), text).unwrap();
    write("bunfig.toml", "preload = [\"./pwn.ts\"]\n".to_owned());
    write("pwn.ts", format!("require(\"node:fs\").appendFileSync({:?}, \"preload\\n\")\n", ran));
    write(".env", "PWN_FROM_ENV=1\n".to_owned());
    for name in ["bun", "opencode"] {
        write(&format!("bin/{name}"), format!("#!/bin/sh\necho {name} >> {ran:?}\necho 1.4.4\n"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(project.join("bin").join(name), std::fs::Permissions::from_mode(0o755)).unwrap();
        }
    }
    write("package.json", "{ \"name\": \"hostile\", \"type\": \"commonjs\" }\n".to_owned());
    let Some(mut config) = runtime(&project) else { return };
    let log = root.path().join("seen.jsonl");
    let config_dir = root.path().join("config");
    let plugin = config_dir.join("plugins/seen");
    std::fs::create_dir_all(&plugin).unwrap();
    let seen = format!(
        "import {{ appendFileSync }} from \"node:fs\"\nexport default {{ id: \"example.seen\", setup() {{ appendFileSync({log:?}, JSON.stringify({{ env: process.env.PWN_FROM_ENV ?? null, cwd: process.cwd(), directory: process.env.OPENCODE_DIRECTORY }}) + \"\\n\") }} }}\n"
    );
    std::fs::write(plugin.join("tui.ts"), seen).unwrap();
    config.directory = project.clone();
    let harness = support::mount(80, 30, Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) });
    let external = External { config_dir, cwd: project.clone(), dev: Vec::new() };
    external_with(&harness.tui, external, Some(config));
    let pipe = Pipe { harness, root };
    pipe.active("example.seen");
    pipe.settle();
    assert!(!ran.exists(), "the project's code ran: {}", std::fs::read_to_string(&ran).unwrap_or_default());
    let seen: serde_json::Value =
        serde_json::from_str(std::fs::read_to_string(&log).unwrap().lines().last().unwrap()).unwrap();
    assert_eq!(seen["env"], serde_json::Value::Null, "the project's .env reached the JS host");
    assert_ne!(Path::new(seen["cwd"].as_str().unwrap()), project.as_path(), "Bun started in the project");
    assert_eq!(Path::new(seen["directory"].as_str().unwrap()), project.as_path());
    // The project's `bin/bun` behind a relative or empty `PATH` entry is never the Bun found, also when the project is
    // the home directory, which the check against a project's own files leaves out.
    let path = std::env::join_paths([Path::new("bin"), Path::new("")]).unwrap();
    assert_eq!(opencode_plugin::pipe::find_in("bun", &path, &project, Some(&project)), None);
}

// Expected (CT-5): a fetch whose reply is 1 MiB, four times a frame, gets it whole, as TS does: it goes in parts that
// the JS host joins. It failed past 256 KiB (snippets' `/api/skill`, 450 KB, failed its setup).
#[test]
fn a_fetch_reply_of_a_mebibyte_arrives_whole() {
    let Some(config) = config() else { return };
    let root = opencode_util::temp::tempdir().unwrap();
    let log = root.path().join("fetched");
    let plugin = root.path().join("config/plugins/large");
    std::fs::create_dir_all(&plugin).unwrap();
    let module = format!(
        "import {{ appendFileSync }} from \"node:fs\"\nexport default {{ id: \"example.large\", setup(api) {{\n  const carrier = api[Symbol.for(\"opencode.carrier\")]\n  carrier.command({{ name: \"large.fetch\", title: \"large.fetch\" }}, async () => {{\n    const result = await carrier.fetch({{ method: \"GET\", path: \"/api/large\" }})\n    const data = result?.Ok?.data ?? \"\"\n    appendFileSync({log:?}, `${{data.length}} ${{data.slice(0, 3)}} ${{data.slice(-3)}} ${{result?.Ok?.after}}\\n`)\n  }})\n}} }}\n"
    );
    std::fs::write(plugin.join("tui.ts"), module).unwrap();
    // Not one byte repeated: a part out of place or lost would show. Quotes and a multibyte character cross JSON's
    // escapes and a part's boundary.
    let data: String = (0..(1usize << 20) / 8).map(|index| format!("{:07}{}", index, ['"', 'é'][index % 2])).collect();
    let length = data.chars().count();
    let (first, last) = (data[..3].to_owned(), data.chars().rev().take(3).collect::<Vec<_>>());
    let last: String = last.into_iter().rev().collect();
    let server = support::Fake::new(move |seen| match seen.path.as_str() {
        "/api/large" => (200, serde_json::json!({ "data": data, "after": true })),
        "/api/session" => (200, serde_json::json!({ "data": [], "cursor": {} })),
        _ => support::not_found(),
    });
    let harness = support::mount(80, 30, Deps { route: Route::Home, ..support::deps(Arc::new(server)) });
    let external = External { config_dir: root.path().join("config"), cwd: root.path().to_path_buf(), dev: Vec::new() };
    external_with(&harness.tui, external, Some(config));
    let pipe = Pipe { harness, root };
    pipe.active("example.large");
    pipe.harness.tui.keymap.dispatch("large.fetch", None);
    pipe.harness.wait("the fetch ended", || {
        pipe.harness.app.advance(Duration::from_millis(1));
        std::fs::read_to_string(&log).is_ok_and(|text| text.ends_with('\n'))
    });
    assert_eq!(std::fs::read_to_string(&log).unwrap(), format!("{length} {first} {last} true\n"));
    assert_eq!(pipe.status("example.large"), Some(opencode_plugin::Status::Active));
}

// Expected (big-boi's catalog review, CT-5): the JS host keeps a reply's parts only while a fetch waits for them: a
// reply in parts that the repeat fault sends twice settles once, and the second set's parts, which no call takes, are
// not kept. They stayed for good.
#[test]
fn a_repeated_reply_in_parts_leaves_nothing_kept() {
    let Some(config) = config() else { return };
    let root = opencode_util::temp::tempdir().unwrap();
    let log = root.path().join("fetched");
    let plugin = root.path().join("config/plugins/twice");
    std::fs::create_dir_all(&plugin).unwrap();
    let module = format!(
        "import {{ appendFileSync }} from \"node:fs\"\nexport default {{ id: \"example.twice\", setup(api) {{\n  const carrier = api[Symbol.for(\"opencode.carrier\")]\n  carrier.command({{ name: \"twice.fetch\", title: \"twice.fetch\" }}, async () => {{\n    const result = await carrier.fetch({{ method: \"GET\", path: \"/api/large\" }})\n    await new Promise((resolve) => setTimeout(resolve, 300))\n    appendFileSync({log:?}, `${{result?.Ok?.data?.length}} ${{carrier.pendingFetches()}}\\n`)\n  }})\n}} }}\n"
    );
    std::fs::write(plugin.join("tui.ts"), module).unwrap();
    let open = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let (gate, seen) = (open.clone(), Arc::new(std::sync::atomic::AtomicBool::new(false)));
    let asked = seen.clone();
    let server = support::Fake::new(move |request| match request.path.as_str() {
        "/api/large" => {
            asked.store(true, std::sync::atomic::Ordering::SeqCst);
            let begun = Instant::now();
            while !gate.load(std::sync::atomic::Ordering::SeqCst) && begun.elapsed() < Duration::from_secs(20) {
                std::thread::sleep(Duration::from_millis(2));
            }
            (200, serde_json::json!({ "data": "x".repeat(1 << 20) }))
        }
        "/api/session" => (200, serde_json::json!({ "data": [], "cursor": {} })),
        _ => support::not_found(),
    });
    let harness = support::mount(80, 30, Deps { route: Route::Home, ..support::deps(Arc::new(server)) });
    let external = External { config_dir: root.path().join("config"), cwd: root.path().to_path_buf(), dev: Vec::new() };
    external_with(&harness.tui, external, Some(config));
    let pipe = Pipe { harness, root };
    pipe.active("example.twice");
    pipe.harness.tui.keymap.dispatch("twice.fetch", None);
    pipe.harness.wait("the server has the request", || {
        pipe.harness.app.advance(Duration::from_millis(1));
        seen.load(std::sync::atomic::Ordering::SeqCst)
    });
    // The next call the host sends is the reply's.
    pipe.scripts().fault(pipe::Fault::Repeat);
    open.store(true, std::sync::atomic::Ordering::SeqCst);
    pipe.harness.wait("the fetch ended", || {
        pipe.harness.app.advance(Duration::from_millis(1));
        std::fs::read_to_string(&log).is_ok_and(|text| text.ends_with('\n'))
    });
    assert_eq!(std::fs::read_to_string(&log).unwrap(), format!("{} 0\n", 1 << 20));
}

// Expected (carbon-5): a fetch whose reply is more than the JS host takes ends with an error, where the plugin's await
// never ended.
#[test]
fn a_fetch_reply_too_large_for_the_js_host_fails() {
    let Some(config) = config() else { return };
    let root = opencode_util::temp::tempdir().unwrap();
    let log = root.path().join("fetched");
    let plugin = root.path().join("config/plugins/huge");
    std::fs::create_dir_all(&plugin).unwrap();
    let module = format!(
        "import {{ appendFileSync }} from \"node:fs\"\nexport default {{ id: \"example.huge\", setup(api) {{\n  const carrier = api[Symbol.for(\"opencode.carrier\")]\n  carrier.command({{ name: \"huge.fetch\", title: \"huge.fetch\" }}, async () => {{\n    const result = await carrier.fetch({{ method: \"GET\", path: \"/api/huge\" }})\n    appendFileSync({log:?}, Object.keys(result ?? {{}}).join(\",\") + \"\\n\")\n  }})\n}} }}\n"
    );
    std::fs::write(plugin.join("tui.ts"), module).unwrap();
    // Past the 8 MiB the overflow holds: one within it goes in parts (CT-5).
    let big = "x".repeat(9 << 20);
    let server = support::Fake::new(move |seen| match seen.path.as_str() {
        "/api/huge" => (200, serde_json::json!({ "data": big })),
        "/api/session" => (200, serde_json::json!({ "data": [], "cursor": {} })),
        _ => support::not_found(),
    });
    let harness = support::mount(80, 30, Deps { route: Route::Home, ..support::deps(Arc::new(server)) });
    let external = External { config_dir: root.path().join("config"), cwd: root.path().to_path_buf(), dev: Vec::new() };
    external_with(&harness.tui, external, Some(config));
    let pipe = Pipe { harness, root };
    pipe.active("example.huge");
    pipe.harness.tui.keymap.dispatch("huge.fetch", None);
    pipe.harness.wait("the fetch ended", || {
        pipe.harness.app.advance(Duration::from_millis(1));
        std::fs::read_to_string(&log).is_ok_and(|text| text.ends_with('\n'))
    });
    assert_eq!(std::fs::read_to_string(&log).unwrap(), "Err\n");
}

// Expected (CT-1): a fetch whose reply comes after the plugin's registrations changed, which reloads it, settles: the
// reply reaches the activation that took the JS host's over. It was lost with the one that asked, and the plugin's
// await never ended (tokscope's history pass, started in setup, once its page's first mount reloaded it).
#[test]
fn a_fetch_across_a_reload_of_the_registrations_settles() {
    let Some(config) = config() else { return };
    let root = opencode_util::temp::tempdir().unwrap();
    let log = root.path().join("fetched");
    let plugin = root.path().join("config/plugins/gated");
    std::fs::create_dir_all(&plugin).unwrap();
    let module = format!(
        "import {{ appendFileSync }} from \"node:fs\"\nexport default {{ id: \"example.gated\", setup(api) {{\n  const carrier = api[Symbol.for(\"opencode.carrier\")]\n  carrier.command({{ name: \"gated.fetch\", title: \"gated.fetch\" }}, async () => {{\n    const pending = carrier.fetch({{ method: \"GET\", path: \"/api/gated\" }})\n    carrier.command({{ name: \"gated.late\", title: \"gated.late\" }}, () => {{}})\n    const result = await pending\n    appendFileSync({log:?}, Object.keys(result ?? {{}}).join(\",\") + \"\\n\")\n  }})\n}} }}\n"
    );
    std::fs::write(plugin.join("tui.ts"), module).unwrap();
    let open = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let gate = open.clone();
    let server = support::Fake::new(move |seen| match seen.path.as_str() {
        "/api/gated" => {
            let begun = Instant::now();
            while !gate.load(std::sync::atomic::Ordering::SeqCst) && begun.elapsed() < Duration::from_secs(20) {
                std::thread::sleep(Duration::from_millis(2));
            }
            (200, serde_json::json!({ "gated": true }))
        }
        "/api/session" => (200, serde_json::json!({ "data": [], "cursor": {} })),
        _ => support::not_found(),
    });
    let harness = support::mount(80, 30, Deps { route: Route::Home, ..support::deps(Arc::new(server)) });
    let external = External { config_dir: root.path().join("config"), cwd: root.path().to_path_buf(), dev: Vec::new() };
    external_with(&harness.tui, external, Some(config));
    let pipe = Pipe { harness, root };
    pipe.active("example.gated");
    let h = &pipe.harness;
    h.tui.keymap.dispatch("gated.fetch", None);
    h.wait("the reload took the late command", || {
        h.app.advance(Duration::from_millis(1));
        matches!(h.tui.keymap.dispatch("gated.late", None), opentui::keymap::RunResult::Ok)
    });
    open.store(true, std::sync::atomic::Ordering::SeqCst);
    h.wait("the fetch ended", || {
        h.app.advance(Duration::from_millis(1));
        std::fs::read_to_string(&log).is_ok_and(|text| text.ends_with('\n'))
    });
    assert_eq!(std::fs::read_to_string(&log).unwrap(), "Ok\n");
    assert_eq!(pipe.status("example.gated"), Some(opencode_plugin::Status::Active));
}

// Expected (big-boi's catalog review, CT-1): the same across a reload whose call also changed a mounted view. The view
// sends the reload's manifest before the call's `Done`, so the handover came before the call's effects made the reply's
// way back: the fetch the host took was answered once and the plugin still waited for it. Every fetch the host took
// settles once, here with its reply.
#[test]
fn a_fetch_across_a_reload_with_a_changed_view_settles() {
    fetch_across_a_reload_with_a_changed_view(false);
}

// Expected (big-boi's catalog review, CT-1): the same when a second view of the call is slow, so the host has taken the
// reload and replaced the guest before the call's `Done` comes: the guest that runs the JS host's activation now applies
// the call's effects, where they went with the replaced guest and the fetch never left.
#[test]
fn a_fetch_whose_done_comes_after_the_reload_settles() {
    fetch_across_a_reload_with_a_changed_view(true);
}

/// A command that starts a fetch, registers another command and changes its footer, `slow` with a second footer that
/// then draws 30,000 rows, whose view the JS host sends after the first's manifest and before the call's `Done`; the
/// server holds the reply until the reload is on screen.
fn fetch_across_a_reload_with_a_changed_view(slow: bool) {
    let Some(config) = config() else { return };
    let root = opencode_util::temp::tempdir().unwrap();
    let log = root.path().join("fetched");
    let plugin = root.path().join("config/plugins/viewed");
    std::fs::create_dir_all(&plugin).unwrap();
    let module = format!(
        "import {{ Plugin }} from \"@opencode/plugin/tui\"\n\
         import {{ createSignal }} from \"solid-js\"\n\
         import {{ jsx }} from \"@opentui/solid/jsx-runtime\"\n\
         import {{ appendFileSync }} from \"node:fs\"\n\
         export default Plugin.define({{ id: \"example.viewed\", setup(context) {{\n\
         const carrier = context[Symbol.for(\"opencode.carrier\")]\n\
         const [text, setText] = createSignal(\"before\")\n\
         context.ui.slot({{ append: \"home.footer\", render: () => jsx(\"text\", {{ get children() {{ return `viewed ${{text()}}` }} }}) }})\n\
         if ({slow}) context.ui.slot({{ append: \"home.footer\", render: () => jsx(\"box\", {{ get children() {{\n\
           if (text() !== \"after\" || globalThis.slowed) return jsx(\"text\", {{ children: \"slow\" }})\n\
           globalThis.slowed = true\n\
           return Array.from({{ length: 30000 }}, (_, index) => jsx(\"text\", {{ children: `row ${{index}}` }})) }} }}) }})\n\
         context.keymap.layer(() => ({{ mode: \"global\", commands: [{{ id: \"viewed.fetch\", run: async () => {{\n\
           const pending = carrier.fetch({{ method: \"GET\", path: \"/api/gated\" }})\n\
           context.keymap.layer(() => ({{ mode: \"global\", commands: [{{ id: \"viewed.late\", run() {{}} }}] }}))\n\
           setText(\"after\")\n\
           const result = await pending\n\
           appendFileSync({log:?}, Object.keys(result ?? {{}}).join(\",\") + \" \" + carrier.pendingFetches() + \"\\n\")\n\
         }} }}] }}))\n\
         }} }})\n"
    );
    std::fs::write(plugin.join("tui.ts"), module).unwrap();
    let open = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let gate = open.clone();
    let server = support::Fake::new(move |seen| match seen.path.as_str() {
        "/api/gated" => {
            let begun = Instant::now();
            while !gate.load(std::sync::atomic::Ordering::SeqCst) && begun.elapsed() < Duration::from_secs(20) {
                std::thread::sleep(Duration::from_millis(2));
            }
            (200, serde_json::json!({ "gated": true }))
        }
        "/api/session" => (200, serde_json::json!({ "data": [], "cursor": {} })),
        _ => support::not_found(),
    });
    let harness = support::mount(80, 30, Deps { route: Route::Home, ..support::deps(Arc::new(server)) });
    let external = External { config_dir: root.path().join("config"), cwd: root.path().to_path_buf(), dev: Vec::new() };
    external_with(&harness.tui, external, Some(config));
    let pipe = Pipe { harness, root };
    pipe.active("example.viewed");
    let h = &pipe.harness;
    h.wait_for("viewed before");
    h.tui.keymap.dispatch("viewed.fetch", None);
    h.wait("the reload took the late command and the view", || {
        h.app.advance(Duration::from_millis(1));
        matches!(h.tui.keymap.dispatch("viewed.late", None), opentui::keymap::RunResult::Ok)
            && h.app.text().contains("viewed after")
    });
    pipe.settle();
    open.store(true, std::sync::atomic::Ordering::SeqCst);
    h.wait("the fetch ended", || {
        h.app.advance(Duration::from_millis(1));
        std::fs::read_to_string(&log).is_ok_and(|text| text.ends_with('\n'))
    });
    assert_eq!(std::fs::read_to_string(&log).unwrap(), "Ok 0\n");
}

// Expected (big-boi's catalog recheck): a new build that, right after its setup, registers a command and starts a fetch,
// all of which the host reads before it registers the build: the command exists and the fetch settles once, with its
// reply. They went to the build it replaces, as they named only the plugin: the command was refused as that build's,
// and the fetch took its relay, whose reply reached nobody.
#[test]
fn a_new_builds_first_command_and_fetch_reach_it() {
    new_build_registers_and_fetches(true, 0, false);
}

// Expected (big-boi's catalog recheck, the control): the same once the host registered the new build.
#[test]
fn a_new_builds_command_and_fetch_after_its_adoption_reach_it() {
    new_build_registers_and_fetches(false, 0, false);
}

// Expected (big-boi's catalog review, 2), his four arrival orders before the host registers a new build, which keeps
// 256 messages of it: when all fit (254 notices, the fetch, the manifest) the fetch settles with its reply and the late
// command runs; when one does not, whichever it is (the manifest after 255 notices and the fetch; the fetch after 256
// or 300 notices; the fetch after the manifest and 255 notices), the build fails as a whole, saying why, before anything
// it sent is applied: its fetch settles once, refused, without reaching the server, and its late command is not there.
// With the manifest spilled the fetch waited for good; with the fetch spilled after the manifest the build stayed active.
#[test]
fn a_new_build_past_the_early_bound_fails_whatever_spills() {
    new_build_registers_and_fetches(true, 254, false);
    new_build_registers_and_fetches(true, 255, false);
    new_build_registers_and_fetches(true, 256, false);
    new_build_registers_and_fetches(true, 300, false);
    new_build_registers_and_fetches(true, 255, true);
}

/// A plugin's second build sends `notices` unwatch notices, then registers a command and fetches (`manifest_first`:
/// registers the command first, then the notices and the fetch), `early` right after its setup, its `Loaded`, manifest
/// and effects held until all came, so the host reads them before its deferred registration; else from a command once
/// the host registered it.
fn new_build_registers_and_fetches(early: bool, notices: usize, manifest_first: bool) {
    let Some(config) = config() else { return };
    let root = opencode_util::temp::tempdir().unwrap();
    let log = root.path().join("built");
    let plugin = root.path().join("config/plugins/build");
    std::fs::create_dir_all(&plugin).unwrap();
    let module = |build: &str| {
        format!(
            "import {{ appendFileSync }} from \"node:fs\"\nexport default {{ id: \"example.build\", setup(api) {{\n  const carrier = api[Symbol.for(\"opencode.carrier\")]\n  carrier.command({{ name: \"build.{build}\", title: \"build.{build}\" }}, () => {{}})\n  if ({build:?} === \"one\") return\n  carrier.storage([\"kept\"])\n  void carrier.effect({{ type: \"storage-set\", key: \"kept\", value: JSON.stringify({{ build: \"two\" }}) }}).then(() => appendFileSync({log:?}, \"setup settled\\n\"))\n  const notices = () => {{ for (let index = 0; index < {notices}; index++) carrier.unwatch(`notice${{index}}`) }}\n  const command = () => carrier.command({{ name: \"build.late\", title: \"build.late\" }}, () => appendFileSync({log:?}, \"late\\n\"))\n  const fetched = () => carrier.fetch({{ method: \"GET\", path: \"/api/build\" }}).then((result) => appendFileSync({log:?}, Object.keys(result ?? {{}}).join(\",\") + \" \" + carrier.pendingFetches() + \"\\n\"))\n  const late = () => {{\n    if ({manifest_first}) {{ command(); setTimeout(() => {{ notices(); fetched() }}, 20); return }}\n    notices(); command(); fetched()\n  }}\n  if ({early}) setTimeout(late, 0)\n  else carrier.command({{ name: \"build.go\", title: \"build.go\" }}, late)\n}} }}\n"
        )
    };
    std::fs::write(plugin.join("tui.ts"), module("one")).unwrap();
    let server = support::Fake::new(|seen| match seen.path.as_str() {
        "/api/build" => (200, serde_json::json!({ "built": true })),
        "/api/session" => (200, serde_json::json!({ "data": [], "cursor": {} })),
        _ => support::not_found(),
    });
    let requests = server.log();
    let harness = support::mount(80, 30, Deps { route: Route::Home, ..support::deps(Arc::new(server)) });
    let external = External { config_dir: root.path().join("config"), cwd: root.path().to_path_buf(), dev: Vec::new() };
    external_with(&harness.tui, external, Some(config));
    let pipe = Pipe { harness, root };
    pipe.active("example.build");
    let (h, scripts) = (&pipe.harness, pipe.scripts());
    let runs = |name: &str| matches!(h.tui.keymap.dispatch(name, None), opentui::keymap::RunResult::Ok);
    let held = |types: &[&str]| {
        h.wait(&format!("{types:?} held"), || {
            h.app.advance(Duration::from_millis(1));
            let held = scripts.held_types();
            types.iter().all(|kind| held.iter().any(|known| known == kind))
        })
    };
    if early {
        scripts.hold_answers(true);
    }
    std::fs::write(plugin.join("tui.ts"), module("two")).unwrap();
    opencode_tui::plugins::host::reconcile(&h.tui);
    if early {
        // The loader sets the build up once it read what the load described: that goes on, what follows is held.
        h.wait("the load described or set up", || {
            h.app.advance(Duration::from_millis(1));
            scripts.held_types().iter().any(|kind| kind == "described" || kind == "loaded")
        });
        if !scripts.held_types().iter().any(|kind| kind == "loaded") {
            scripts.hold_answers(false);
            scripts.hold_answers(true);
        }
        held(&["loaded", "manifest", "effects"]);
        scripts.hold_answers(false);
    } else {
        h.wait("the new build is registered", || {
            h.app.advance(Duration::from_millis(1));
            runs("build.two")
        });
        assert!(runs("build.go"));
    }
    // The setup's write settles once, and so does the fetch: its line is the other one.
    let lines = || std::fs::read_to_string(&log).unwrap_or_default().lines().map(str::to_owned).collect::<Vec<_>>();
    h.wait("the setup's write and the fetch settled", || {
        h.app.advance(Duration::from_millis(1));
        lines().iter().any(|line| line == "setup settled") && lines().iter().any(|line| line != "setup settled")
    });
    pipe.settle();
    let fetch = || lines().into_iter().filter(|line| line != "setup settled" && line != "late").collect::<Vec<_>>();
    assert_eq!(lines().iter().filter(|line| *line == "setup settled").count(), 1, "{:?}", lines());
    let fetched = || requests.lock().unwrap().iter().filter(|seen| seen.path == "/api/build").count();
    let host = opencode_tui::plugins::host::host(&h.tui);
    let stored = || opencode_plugin::Host::storage_read(&*host, "plugin.example.build.kept");
    if notices + 2 > 256 {
        // Its batch was answered as refused, nothing of it reached the server, and the build failed as a whole.
        let case = format!("{notices} notices, manifest first {manifest_first}");
        // Refused at once, while the setup's write may still wait to be refused as the activation ends.
        let fetch = fetch();
        assert!(fetch.len() == 1 && fetch[0].starts_with("Err "), "{case}: {fetch:?}");
        h.wait("the build failed", || {
            h.app.advance(Duration::from_millis(1));
            matches!(pipe.status("example.build"), Some(opencode_plugin::Status::Failed(_)))
        });
        let Some(opencode_plugin::Status::Failed(error)) = pipe.status("example.build") else { unreachable!() };
        assert!(error.contains("more than 256 messages"), "{case}: {error}");
        assert!(!runs("build.late"), "{case}: the late command of the build that failed is there");
        assert_eq!(fetched(), 0, "{case}: a fetch of the build that failed left");
        // Nor did the storage write its setup asked for in its load persist (big-boi's catalog review).
        assert_eq!(stored(), None, "{case}: the setup's write of the build that failed persisted");
        return;
    }
    assert_eq!(stored().as_deref(), Some(r#"{"build":"two"}"#), "the setup's write of the build");
    assert_eq!(fetch(), ["Ok 0"]);
    h.wait("the late command is registered", || {
        h.app.advance(Duration::from_millis(1));
        runs("build.late")
    });
    h.wait("the late command ran", || {
        h.app.advance(Duration::from_millis(1));
        std::fs::read_to_string(&log).is_ok_and(|text| text.ends_with("late\n"))
    });
    assert_eq!(fetched(), 1, "one request for the one fetch");
    assert_eq!(pipe.status("example.build"), Some(opencode_plugin::Status::Active));
}

// Expected (big-boi's catalog review, 2): a fetch the host took settles once, refused, when its plugin's activation ends
// before the reply: disabled while the server holds it, the plugin's await ends, and the reply that comes after reaches
// nothing. The JS host dropped the activation with the fetch still waiting.
#[test]
fn a_fetch_of_an_activation_that_ends_settles_once() {
    let Some(config) = config() else { return };
    let root = opencode_util::temp::tempdir().unwrap();
    let log = root.path().join("ended");
    let plugin = root.path().join("config/plugins/ending");
    std::fs::create_dir_all(&plugin).unwrap();
    let module = format!(
        "import {{ appendFileSync }} from \"node:fs\"\nexport default {{ id: \"example.ending\", setup(api) {{\n  const carrier = api[Symbol.for(\"opencode.carrier\")]\n  carrier.command({{ name: \"ending.fetch\", title: \"ending.fetch\" }}, async () => {{\n    const result = await carrier.fetch({{ method: \"GET\", path: \"/api/held\" }})\n    appendFileSync({log:?}, Object.keys(result ?? {{}}).join(\",\") + \"\\n\")\n  }})\n}} }}\n"
    );
    std::fs::write(plugin.join("tui.ts"), module).unwrap();
    let open = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let asked = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let (gate, seen) = (open.clone(), asked.clone());
    let server = support::Fake::new(move |request| match request.path.as_str() {
        "/api/held" => {
            seen.store(true, std::sync::atomic::Ordering::SeqCst);
            let begun = Instant::now();
            while !gate.load(std::sync::atomic::Ordering::SeqCst) && begun.elapsed() < Duration::from_secs(20) {
                std::thread::sleep(Duration::from_millis(2));
            }
            (200, serde_json::json!({ "held": true }))
        }
        "/api/session" => (200, serde_json::json!({ "data": [], "cursor": {} })),
        _ => support::not_found(),
    });
    let harness = support::mount(80, 30, Deps { route: Route::Home, ..support::deps(Arc::new(server)) });
    let external = External { config_dir: root.path().join("config"), cwd: root.path().to_path_buf(), dev: Vec::new() };
    external_with(&harness.tui, external, Some(config));
    let pipe = Pipe { harness, root };
    pipe.active("example.ending");
    let h = &pipe.harness;
    h.tui.keymap.dispatch("ending.fetch", None);
    h.wait("the server has the request", || {
        h.app.advance(Duration::from_millis(1));
        asked.load(std::sync::atomic::Ordering::SeqCst)
    });
    h.tui.plugins.set_active(&opencode_tui::plugins::host::host(&h.tui), "example.ending", false);
    h.wait("the fetch ended", || {
        h.app.advance(Duration::from_millis(1));
        std::fs::read_to_string(&log).is_ok_and(|text| text.ends_with('\n'))
    });
    open.store(true, std::sync::atomic::Ordering::SeqCst);
    for _ in 0..200 {
        h.app.advance(Duration::from_millis(2));
        std::thread::sleep(Duration::from_millis(1));
    }
    pipe.settle();
    assert_eq!(std::fs::read_to_string(&log).unwrap(), "Err\n", "settled once, refused");
}

// Expected (big-boi's catalog review, final): a snapshot of a read only the running build watches reaches that build
// alone, also while the host has not registered the new build yet, which the JS host knows by the plugin's ID already:
// the new build hears nothing of it and reads nothing of it, as when the value changes after its adoption. It reached
// the new build, whose listener heard it and which read the value.
#[test]
fn a_snapshot_of_the_running_build_never_reaches_the_new_one() {
    snapshot_across_a_new_build(true);
}

// Expected (big-boi's catalog review, final, the control): the same when the value changes after the new build's
// adoption.
#[test]
fn a_snapshot_after_the_new_builds_adoption_never_reaches_it() {
    snapshot_across_a_new_build(false);
}

/// The first build of a plugin watches the stored `old`; its second build does not, and logs each snapshot it hears.
/// The host changes `old`, `held` while it holds the second build's `Loaded`, else once it registered that build.
fn snapshot_across_a_new_build(held: bool) {
    let Some(config) = config() else { return };
    let root = opencode_util::temp::tempdir().unwrap();
    let log = root.path().join("snapshots");
    let plugin = root.path().join("config/plugins/snap");
    std::fs::create_dir_all(&plugin).unwrap();
    let first = "export default { id: \"example.snap\", setup(context) {\n  context.storage.store(\"old\", { initial: { n: 0 } })\n} }\n";
    let second = format!(
        "import {{ appendFileSync }} from \"node:fs\"\nexport default {{ id: \"example.snap\", setup(context) {{\n  const carrier = context[Symbol.for(\"opencode.carrier\")]\n  carrier.listen((key) => {{ if (key === \"storage:old\") appendFileSync({log:?}, \"heard\\n\") }})\n  context.keymap.layer(() => ({{ mode: \"global\", commands: [{{ id: \"snap.read\", run: () => appendFileSync({log:?}, `read ${{carrier.read(\"storage:old\")}}\\n`) }}] }}))\n}} }}\n"
    );
    std::fs::write(plugin.join("tui.ts"), first).unwrap();
    let harness = support::mount(80, 30, Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) });
    let external = External { config_dir: root.path().join("config"), cwd: root.path().to_path_buf(), dev: Vec::new() };
    external_with(&harness.tui, external, Some(config));
    let pipe = Pipe { harness, root };
    pipe.active("example.snap");
    pipe.settle();
    let (h, scripts) = (&pipe.harness, pipe.scripts());
    let host = opencode_tui::plugins::host::host(&h.tui);
    let change = |n: u32| {
        opencode_plugin::Host::storage_write(&*host, "plugin.example.snap.old", &format!("{{\"n\":{n}}}")).unwrap();
        opencode_plugin::Host::storage_changed(&*host);
        for _ in 0..100 {
            h.app.advance(Duration::from_millis(2));
            std::thread::sleep(Duration::from_millis(2));
        }
    };
    let runs = |name: &str| matches!(h.tui.keymap.dispatch(name, None), opentui::keymap::RunResult::Ok);
    if held {
        scripts.hold_answers(true);
    }
    std::fs::write(plugin.join("tui.ts"), second).unwrap();
    opencode_tui::plugins::host::reconcile(&h.tui);
    if held {
        h.wait("the load described or set up", || {
            h.app.advance(Duration::from_millis(1));
            scripts.held_types().iter().any(|kind| kind == "described" || kind == "loaded")
        });
        if !scripts.held_types().iter().any(|kind| kind == "loaded") {
            scripts.hold_answers(false);
            scripts.hold_answers(true);
        }
        h.wait("the new build's Loaded held", || {
            h.app.advance(Duration::from_millis(1));
            scripts.held_types().iter().any(|kind| kind == "loaded")
        });
        // The running build is still the host's: its read follows the change.
        change(5);
        scripts.hold_answers(false);
    }
    h.wait("the new build is registered", || {
        h.app.advance(Duration::from_millis(1));
        runs("snap.read")
    });
    if !held {
        change(5);
        assert!(runs("snap.read"));
    }
    pipe.settle();
    h.wait("the read was logged", || {
        h.app.advance(Duration::from_millis(1));
        std::fs::read_to_string(&log).is_ok_and(|text| text.contains("read "))
    });
    let logged = std::fs::read_to_string(&log).unwrap();
    assert_eq!(logged.lines().last(), Some("read undefined"), "{logged}");
    assert!(!logged.contains("heard"), "{logged}");
}

// Expected (bigboi's final pass): a TypeScript plugin's fetch that the host does not take, while another plugin's
// fan-out fills the queue of effects, ends with an error, where its await never ended; once the queue drains, a fetch
// gets its reply.
#[test]
fn a_fetch_the_host_does_not_take_fails_over_the_pipe() {
    let Some(config) = config() else { return };
    let root = opencode_util::temp::tempdir().unwrap();
    let log = root.path().join("fetched");
    let plugin = root.path().join("config/plugins/refused");
    std::fs::create_dir_all(&plugin).unwrap();
    let module = format!(
        "import {{ appendFileSync }} from \"node:fs\"\nexport default {{ id: \"example.refused\", setup(api) {{\n  const carrier = api[Symbol.for(\"opencode.carrier\")]\n  carrier.command({{ name: \"refused.fetch\", title: \"refused.fetch\" }}, async () => {{\n    const result = await carrier.fetch({{ method: \"GET\", path: \"/api/session\" }})\n    appendFileSync({log:?}, Object.keys(result ?? {{}}).join(\",\") + \"\\n\")\n  }})\n}} }}\n"
    );
    std::fs::write(plugin.join("tui.ts"), module).unwrap();
    let server = support::Fake::new(|seen| match seen.path.as_str() {
        "/api/session" => (200, serde_json::json!({ "data": [], "cursor": {} })),
        _ => support::not_found(),
    });
    let harness = support::mount(80, 30, Deps { route: Route::Home, ..support::deps(Arc::new(server)) });
    let external = External { config_dir: root.path().join("config"), cwd: root.path().to_path_buf(), dev: Vec::new() };
    external_with(&harness.tui, external, Some(config));
    let pipe = Pipe { harness, root };
    pipe.active("example.refused");
    let h = &pipe.harness;
    opencode_tui::plugins::host::add(&h.tui, abi::Plugin { id: "probe", setup: crate::plugins::chain }.into());
    h.wait_for("chain ready");
    let lines = || std::fs::read_to_string(&log).unwrap_or_default();
    h.tui.keymap.dispatch("chain.fan", None);
    for _ in 0..80 {
        h.app.render();
    }
    h.tui.keymap.dispatch("refused.fetch", None);
    h.wait("the refused fetch ended", || {
        h.app.advance(Duration::from_millis(1));
        lines().ends_with('\n')
    });
    assert_eq!(lines(), "Err\n");
    h.tui.plugins.set_active(&opencode_tui::plugins::host::host(&h.tui), "probe", false);
    // A frame runs its budget of what waits: the drain is so many frames, however long each takes under load
    // (pipe-flakes: 65 frames of the full queue took 5 s alone, past the 30 s of a wait under the lane's load).
    let waiting = opencode_plugin::effects_waiting();
    for _ in 0..waiting.div_ceil(opencode_plugin::FRAME_EFFECTS) {
        h.app.render();
    }
    assert_eq!(opencode_plugin::effects_waiting(), 0, "the queue drained within a frame for each budget of {waiting}");
    h.tui.keymap.dispatch("refused.fetch", None);
    h.wait("the fetch ended", || {
        h.app.advance(Duration::from_millis(1));
        lines().lines().count() == 2
    });
    assert_eq!(lines(), "Err\nOk\n");
}

// Expected (bigboi's last pass): over the pipe as on the native carriers, what a route's command asked for ends with
// its mount: a reply that arrives after the route closed and opened again reaches the plugin no more. Its fetch
// rejects with an `AbortError`, and nothing is left pending. What a global command asked for is the activation's, and
// arrives.
#[test]
fn a_late_reply_does_not_reach_a_mount_opened_again_over_the_pipe() {
    let Some(config) = config() else { return };
    let root = opencode_util::temp::tempdir().unwrap();
    let log = root.path().join("replied");
    let plugin = root.path().join("config/plugins/owned");
    std::fs::create_dir_all(&plugin).unwrap();
    let module = format!(
        "import {{ appendFileSync }} from \"node:fs\"\nexport default {{ id: \"example.owned\", setup(api) {{\n  const carrier = api[Symbol.for(\"opencode.carrier\")]\n  carrier.surface(\"owned\", {{ type: \"route\", name: \"owned\" }}, () => ({{ type: \"text\", spans: [{{ text: \"owned route\" }}] }}))\n  const fetch = (name) => async () => {{\n    const result = await carrier.fetch({{ method: \"GET\", path: \"/api/hold\" }}).catch((error) => ({{ [error.name]: error.message }}))\n    appendFileSync({log:?}, name + \" \" + Object.keys(result ?? {{}}).join(\",\") + \" \" + carrier.pendingFetches() + \"\\n\")\n  }}\n  carrier.command({{ name: \"owned.route\", title: \"owned.route\", scope: {{ route: \"owned\" }} }}, fetch(\"route\"))\n  carrier.command({{ name: \"owned.global\", title: \"owned.global\" }}, fetch(\"global\"))\n}} }}\n"
    );
    std::fs::write(plugin.join("tui.ts"), module).unwrap();
    let (fake, gate, served, asked) = crate::plugin_surface::held();
    let harness = support::mount(80, 30, Deps { route: Route::Home, ..support::deps(Arc::new(fake)) });
    let external = External { config_dir: root.path().join("config"), cwd: root.path().to_path_buf(), dev: Vec::new() };
    external_with(&harness.tui, external, Some(config));
    let pipe = Pipe { harness, root };
    pipe.active("example.owned");
    let h = &pipe.harness;
    let route = Route::Plugin { id: "example.owned".into(), name: "owned".into() };
    h.tui.navigate(route.clone());
    h.wait_for("owned route");
    h.tui.keymap.dispatch("owned.route", None);
    // The JS host answers the command, and the host sends its fetch, before the route closes.
    h.wait("the route's fetch went out", || {
        h.app.advance(Duration::from_millis(1));
        asked.load(std::sync::atomic::Ordering::SeqCst) >= 1
    });
    h.tui.navigate(Route::Home);
    h.app.advance(Duration::from_millis(16));
    h.tui.navigate(route);
    h.wait_for("owned route");
    *gate.0.lock().unwrap() = true;
    gate.1.notify_all();
    let lines = || std::fs::read_to_string(&log).unwrap_or_default();
    h.wait("the route's reply was served", || served.load(std::sync::atomic::Ordering::SeqCst) >= 1);
    h.wait("the route's fetch settled", || {
        h.app.advance(Duration::from_millis(1));
        lines().ends_with('\n')
    });
    assert_eq!(lines(), "route AbortError 0\n", "a reply reached a mount opened again, or its fetch did not settle");
    h.tui.keymap.dispatch("owned.global", None);
    h.wait("the global reply arrived", || {
        h.app.advance(Duration::from_millis(1));
        lines().lines().count() == 2
    });
    assert_eq!(lines(), "route AbortError 0\nglobal Ok 0\n");
}

// Expected (bigboi's ownership pass): a fetch the host accepts while the JS host reads nothing, whose answer finds the
// overflow full, settles once the JS host reads again, and leaves nothing waiting in either of its maps: the answer that
// carries its ID waits in the overflow's reserve, where it was dropped and the fetch never settled.
#[test]
fn a_fetch_answered_past_a_full_overflow_settles() {
    let Some(mut config) = config() else { return };
    // What the JS host answers as it reads again is no flood here: the row is about what the host sends it.
    (config.limits.queued, config.limits.inbox, config.limits.ordered) = (1 << 10, 256 << 10, 1 << 16);
    let root = opencode_util::temp::tempdir().unwrap();
    let (log, stalled, gate) = (root.path().join("settled"), root.path().join("stalled"), root.path().join("gate"));
    let plugin = root.path().join("config").join("plugins").join("flooded");
    std::fs::create_dir_all(&plugin).unwrap();
    let module = format!(
        r#"import {{ appendFileSync, existsSync, writeFileSync }} from "node:fs"
const [LOG, STALLED, GATE] = {paths}
const settled = (how) => appendFileSync(LOG, "settled " + how + " " + carrier.pendingFetches() + "\n")
let carrier
export default {{ id: "example.flooded", setup(api) {{
  carrier = api[Symbol.for("opencode.carrier")]
  carrier.command({{ name: "flooded.go", title: "flooded.go" }}, () => {{
    carrier.fetch({{ method: "GET", path: "/api/session" }}).then(
      (result) => settled(Object.keys(result ?? {{}}).join(",")),
      (error) => settled(error.name),
    )
    // Reads of the same call make its answer larger than the room an overflow that refused one call has left.
    for (let read = 0; read < 50; read++) carrier.effect({{ type: "interactive" }})
    // Once it answered, the JS host reads nothing until the gate opens.
    setTimeout(() => {{
      writeFileSync(STALLED, "")
      while (!existsSync(GATE)) {{}}
    }}, 0)
  }})
  carrier.command({{ name: "flooded.noop", title: "flooded.noop" }}, () => {{}})
}} }}
"#,
        paths = serde_json::json!([log, stalled, gate]),
    );
    std::fs::write(plugin.join("tui.ts"), module).unwrap();
    let server = support::Fake::new(|seen| match seen.path.as_str() {
        "/api/session" => (200, serde_json::json!({ "data": [], "cursor": {} })),
        _ => support::not_found(),
    });
    let harness = support::mount(80, 30, Deps { route: Route::Home, ..support::deps(Arc::new(server)) });
    let external = External { config_dir: root.path().join("config"), cwd: root.path().to_path_buf(), dev: Vec::new() };
    external_with(&harness.tui, external, Some(config));
    let pipe = Pipe { harness, root };
    pipe.active("example.flooded");
    let (h, scripts) = (&pipe.harness, pipe.scripts());
    // The answer that asks for the fetch waits, so the fetch's own answer goes once the overflow is full.
    scripts.hold_answers(true);
    h.tui.keymap.dispatch("flooded.go", None);
    h.wait("the JS host stalled", || {
        h.app.advance(Duration::from_millis(1));
        stalled.exists()
    });
    // Calls fill what the JS host's input takes and the overflow, each size until one is refused, then a smaller one:
    // few enough that their answers are no flood, and the overflow keeps less room than the fetch's answer takes.
    for size in [200 << 10, 30 << 10, 4 << 10, 512, 0] {
        let (input, refused) = ("x".repeat(size), pipe::crossed().refused_sends);
        for _ in 0..1_000 {
            if pipe::crossed().refused_sends > refused {
                break;
            }
            h.tui.keymap.dispatch("flooded.noop", Some(input.as_str()).filter(|input| !input.is_empty()));
        }
        assert!(pipe::crossed().refused_sends > refused, "the overflow never filled");
    }
    scripts.hold_answers(false);
    std::fs::write(&gate, "").unwrap();
    h.wait("the fetch settled", || {
        h.app.advance(Duration::from_millis(1));
        std::fs::read_to_string(&log).is_ok_and(|text| text.ends_with('\n'))
    });
    assert_eq!(std::fs::read_to_string(&log).unwrap(), "settled Ok 0\n");
}

/// What queues behind a fetch's reduced admission answer, in [`a_fetch_settles_once_whatever_queues_behind_its_answer`].
#[derive(Clone, Copy, Debug, PartialEq)]
enum Behind {
    /// Its mount closed: the fetch is cancelled.
    Cancelled,
    /// The server answered: its reply.
    Reply,
}

// Expected (bigboi's pipe pass): a fetch's admission answer too large for the JS host's queue goes reduced in its place,
// so what queues behind it reaches the JS host after it: its cancellation rejects the fetch with an `AbortError`, and its
// reply resolves it, once, and nothing stays pending in either of the JS host's maps. Before, the reduced answer went
// to the tail, behind them: the JS host found no fetch for them, and the fetch the late answer made waited forever.
#[test]
fn a_fetch_settles_once_whatever_queues_behind_its_answer() {
    for behind in [Behind::Cancelled, Behind::Reply] {
        queued_behind(behind);
    }
}

fn queued_behind(behind: Behind) {
    let Some(mut config) = config() else { return };
    // A queue smaller than the fetch's admission answer, which its reads make about 30 KiB; room for the backlog.
    (config.limits.queued, config.limits.inbox) = (4 << 10, 1 << 20);
    let root = opencode_util::temp::tempdir().unwrap();
    let (log, stalled, gate) = (root.path().join("settled"), root.path().join("stalled"), root.path().join("gate"));
    let plugin = root.path().join("config").join("plugins").join("queued");
    std::fs::create_dir_all(&plugin).unwrap();
    let module = format!(
        r#"import {{ appendFileSync, existsSync, writeFileSync }} from "node:fs"
const [LOG, STALLED, GATE] = {paths}
let carrier
const settled = (how) => appendFileSync(LOG, "settled " + how + " " + carrier.pendingFetches() + "\n")
// A fetch, with reads that make its answer large; then the JS host reads nothing until the gate opens.
const go = () => {{
  carrier.fetch({{ method: "GET", path: "/api/hold" }}).then(
    (result) => settled(Object.keys(result ?? {{}}).join(",")),
    (error) => settled(error.name),
  )
  for (let read = 0; read < 8; read++) carrier.effect({{ type: "keymap-commands" }})
  setTimeout(() => {{
    writeFileSync(STALLED, "")
    while (!existsSync(GATE)) {{}}
  }}, 0)
}}
export default {{ id: "example.queued", setup(api) {{
  carrier = api[Symbol.for("opencode.carrier")]
  carrier.surface("queued", {{ type: "route", name: "queued" }}, () => ({{ type: "text", spans: [{{ text: "queued route" }}] }}))
  carrier.command({{ name: "queued.route", title: "queued.route", scope: {{ route: "queued" }} }}, go)
  carrier.command({{ name: "queued.global", title: "queued.global" }}, go)
  carrier.command({{ name: "queued.noop", title: "queued.noop" }}, () => {{}})
}} }}
"#,
        paths = serde_json::json!([log, stalled, gate]),
    );
    std::fs::write(plugin.join("tui.ts"), module).unwrap();
    let (fake, server_gate, served, asked) = crate::plugin_surface::held();
    let harness = support::mount(80, 30, Deps { route: Route::Home, ..support::deps(Arc::new(fake)) });
    let external = External { config_dir: root.path().join("config"), cwd: root.path().to_path_buf(), dev: Vec::new() };
    external_with(&harness.tui, external, Some(config));
    let pipe = Pipe { harness, root };
    pipe.active("example.queued");
    let (h, scripts) = (&pipe.harness, pipe.scripts());
    let route = Route::Plugin { id: "example.queued".into(), name: "queued".into() };
    // The fetch is its route mount's when it is to be cancelled, the activation's when its reply is to come.
    if behind == Behind::Cancelled {
        h.tui.navigate(route);
        h.wait_for("queued route");
    }
    // The call's answer waits until a backlog fills the overflow, behind which its effects then go.
    scripts.hold_answers(true);
    let command = if behind == Behind::Cancelled { "queued.route" } else { "queued.global" };
    h.tui.keymap.dispatch(command, None);
    h.wait("the JS host stalled", || {
        h.app.advance(Duration::from_millis(1));
        stalled.exists()
    });
    for _ in 0..10_000 {
        if scripts.overflow_bytes() > 0 {
            break;
        }
        h.tui.keymap.dispatch("queued.noop", Some(&"x".repeat(2 << 10)));
    }
    assert!(scripts.overflow_bytes() > 0, "{behind:?}: no backlog");
    scripts.hold_answers(false);
    h.app.advance(Duration::from_millis(1));
    // Behind the fetch's answer: its cancellation, or its reply.
    match behind {
        Behind::Cancelled => h.tui.navigate(Route::Home),
        Behind::Reply => {
            h.wait("the fetch was sent", || {
                h.app.advance(Duration::from_millis(1));
                asked.load(std::sync::atomic::Ordering::SeqCst) == 1
            });
            *server_gate.0.lock().unwrap() = true;
            server_gate.1.notify_all();
            h.wait("the server answered", || served.load(std::sync::atomic::Ordering::SeqCst) == 1);
        }
    }
    for _ in 0..5 {
        h.app.advance(Duration::from_millis(1));
    }
    std::fs::write(&gate, "").unwrap();
    h.wait("the fetch settled", || {
        h.app.advance(Duration::from_millis(1));
        std::fs::read_to_string(&log).is_ok_and(|text| text.ends_with('\n'))
    });
    // Once, and nothing pending: a second settling or a late one would show here.
    h.app.wait_until(Duration::from_millis(300), || {
        h.app.advance(Duration::from_millis(1));
        false
    });
    let expected = match behind {
        Behind::Cancelled => "settled AbortError 0\n",
        Behind::Reply => "settled Ok 0\n",
    };
    assert_eq!(std::fs::read_to_string(&log).unwrap(), expected, "{behind:?}");
}

// Expected (bigboi P8-6): `data.session.pending` lists the session's inbox items the server has not delivered, as the
// host holds them, where it listed none.
#[test]
fn a_v2_plugin_reads_a_sessions_pending_inbox() {
    let Some(config) = config() else { return };
    let root = opencode_util::temp::tempdir().unwrap();
    let log = root.path().join("pending");
    let plugin = root.path().join("config/plugins/pending");
    std::fs::create_dir_all(&plugin).unwrap();
    let module = format!(
        "import {{ appendFileSync }} from \"node:fs\"\nexport default {{ id: \"example.pending\", setup(api) {{\n  api.keymap.layer(() => ({{ mode: \"global\", commands: [{{ id: \"pending.log\", run: async () => {{\n    await api.data.session.pending.sync(\"ses_q\")\n    appendFileSync({log:?}, JSON.stringify(api.data.session.pending.list(\"ses_q\").map((item) => item.id)) + \"\\n\")\n  }} }}] }}))\n}} }}\n"
    );
    std::fs::write(plugin.join("tui.ts"), module).unwrap();
    let queued = serde_json::json!({
        "id": "msg_3", "sessionID": "ses_q", "type": "user", "time": { "created": 3000 }, "delivery": "queue",
        "payload": { "text": "queued" },
    });
    let server = support::Fake::new(move |seen| match seen.path.as_str() {
        "/api/session" => (200, serde_json::json!({ "data": [support::session("ses_q", "Q")], "cursor": {} })),
        "/api/session/ses_q" => (200, serde_json::json!({ "data": support::session("ses_q", "Q") })),
        "/api/session/ses_q/message" => (200, serde_json::json!({ "data": [], "cursor": {} })),
        "/api/session/ses_q/inbox" => (200, serde_json::json!({ "data": [queued.clone()] })),
        _ => support::not_found(),
    });
    let deps = Deps { route: support::session_route("ses_q"), ..support::deps(Arc::new(server)) };
    let harness = support::mount(100, 30, deps);
    let external = External { config_dir: root.path().join("config"), cwd: root.path().to_path_buf(), dev: Vec::new() };
    external_with(&harness.tui, external, Some(config));
    let pipe = Pipe { harness, root };
    pipe.active("example.pending");
    pipe.harness.wait("the inbox loaded", || {
        pipe.harness.app.advance(Duration::from_millis(1));
        pipe.harness.app.text().contains("1 queued")
    });
    pipe.harness.tui.keymap.dispatch("pending.log", None);
    pipe.harness.wait("the plugin read its inbox", || {
        pipe.harness.app.advance(Duration::from_millis(1));
        std::fs::read_to_string(&log).is_ok_and(|text| text.ends_with('\n'))
    });
    assert_eq!(std::fs::read_to_string(&log).unwrap(), "[\"msg_3\"]\n");
}
