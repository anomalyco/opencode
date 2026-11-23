//! Exercise plugin requests, rendered frames, reloads, faults, and backpressure against a real JS host.

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

    /// Waits until `done` holds, turning the UI thread without moving its clock ([`still`]). The wait for anything of the
    /// JS host's or the loader's (a reply, a reload, a drain, a load) takes real time, which no deadline of the host's
    /// (the key hold's 50 ms, a debounce) may see: a row that advanced the clock as it polled raced those deadlines
    /// against the machine's load (compat-harness). A row that wants a deadline to pass advances the clock itself.
    pub fn until(&self, what: &str, done: impl Fn() -> bool) {
        until(&self.harness, what, done);
    }

    /// Waits until the JS host retires no command a component dropped ([`Scripts::retiring`]): such a command lingers
    /// 250 ms on the JS host's own clock (`UNCOMMAND`), then its registrations change once more. A row waited for it
    /// with a sleep (compat-harness).
    pub fn retired(&self) {
        self.until("the JS host retired its dropped commands", || {
            self.settle();
            !self.scripts().retiring()
        });
    }

    /// Waits until plugin `id` is active.
    pub fn active(&self, id: &str) {
        let entries = || {
            let entries =
                self.harness.tui.plugins.entries().into_iter().map(|entry| format!("{} {:?}", entry.id, entry.status));
            entries.collect::<Vec<_>>().join("\n")
        };
        self.until(&format!("{id} is active"), || {
            let failed = matches!(self.status(id), Some(opencode_plugin::Status::Failed(_)));
            assert!(!failed, "{id} failed:\n{}", entries());
            self.status(id) == Some(opencode_plugin::Status::Active)
        });
    }
}

/// Mounts the TUI on Home with the plugin directories `plugins` (names under `EXAMPLES`), their `options`, and the JS
/// host `config`.
pub fn open(plugins: &[(&str, Option<serde_json::Value>)], config: Config, size: (u16, u16)) -> Pipe {
    open_with(plugins, config, size, Vec::new())
}

/// Open the JS plugin fixture with additional linked built-ins.
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
    let external = External { config_dir, cwd: root.path().to_path_buf() };
    external_with(&harness.tui, external, Some(config));
    Pipe { harness, root }
}

fn plugin_files(name: &str, log: &str) -> (opencode_util::temp::TempDir, PathBuf, PathBuf) {
    let root = opencode_util::temp::tempdir().unwrap();
    let plugin = root.path().join("config/plugins").join(name);
    std::fs::create_dir_all(&plugin).unwrap();
    let log = root.path().join(log);
    (root, plugin, log)
}

fn mount_server(root: opencode_util::temp::TempDir, config: Config, server: support::Fake) -> Pipe {
    let harness = support::mount(80, 30, Deps { route: Route::Home, ..support::deps(Arc::new(server)) });
    let external = External { config_dir: root.path().join("config"), cwd: root.path().to_path_buf() };
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

/// [`Pipe::until`] for a harness.
pub fn until(harness: &Harness, what: &str, done: impl Fn() -> bool) {
    harness.wait(what, || {
        still(&harness.app);
        done()
    });
}

/// Drain ready UI work without advancing the test clock.
pub(crate) fn still(app: &TestApp) {
    app.advance(Duration::ZERO);
    if app.needs_frame() {
        app.render();
    }
}

/// Waits until the JS host handled everything sent before, and no tree waits for the host; then three frames. However
/// long the JS host takes, the clock moves only by the frames' turns, never as it waits ([`Pipe::until`]).
pub fn settle(harness: &Harness, scripts: &Scripts) {
    settle_app(&harness.app, &harness.tui, scripts);
}

/// Wait for the JS host and the app to settle during a replay.
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
            still(app);
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

/// Wait for the loader to finish the current directory walk and process its result.
pub fn walked(harness: &Harness, scripts: &Scripts) {
    walked_app(&harness.app, scripts);
}

fn walked_app(app: &TestApp, scripts: &Scripts) {
    let begun = Instant::now();
    while scripts.walking() {
        assert!(begun.elapsed() < Duration::from_secs(20), "a walk of a plugin's tree never ended");
        still(app);
        std::thread::sleep(Duration::from_micros(200));
    }
    for _ in 0..3 {
        turn_app(app);
    }
}

/// Recheck the artifact before recording the decision. Wait for the off-thread hash to finish.
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

/// Run one UI turn and paint if requested. Revisions over the frame budget need another turn.
pub(crate) fn turn(harness: &Harness) {
    turn_app(&harness.app);
}

fn turn_app(app: &TestApp) {
    app.advance(Duration::from_millis(1));
    if app.needs_frame() {
        app.render();
    }
}

/// Cells, new toasts, and plugin status at one checkpoint.
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

/// Run the same checkpoints on the linked and pipe versions. Each run owns its TUI and plugin directory.
fn compare_twin(
    config: Config,
    name: &str,
    plugin: abi::Plugin,
    script: impl Fn(&Harness, &dyn Fn(), &mut dyn FnMut(&'static str)),
) -> Vec<Seen> {
    let id = plugin.id;
    let run = |pipe: Option<Config>| {
        let (h, _root) = match pipe {
            Some(config) => {
                let pipe = open(&[(name, None)], config, (80, 30));
                pipe.active(id);
                (pipe.harness, Some(pipe.root))
            }
            None => {
                let mut deps = Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) };
                deps.builtins.push(abi::Plugin { id, setup: plugin.setup }.into());
                (support::mount(80, 30, deps), None)
            }
        };
        let scripts = h.tui.plugins.scripts.borrow().clone();
        let settle = || match &scripts {
            Some(scripts) => settle(&h, scripts),
            None => (0..3).for_each(|_| h.app.advance(Duration::from_millis(1))),
        };
        let mut seen = Vec::new();
        script(&h, &settle, &mut |name| {
            seen.push((name, observe(&h, id)));
        });
        seen
    };
    let linked = run(None);
    let trace = run(Some(config));
    assert_eq!(trace.len(), linked.len(), "pipe checkpoints");
    for ((name, expected), (step, actual)) in linked.iter().zip(trace) {
        assert_eq!(*name, step);
        assert_eq!(expected.1, actual.1, "pipe at {name}: toasts");
        assert_eq!(expected.2, actual.2, "pipe at {name}: status");
        assert!(
            expected.0 == actual.0,
            "pipe at {name}: cells\nlinked:\n{}\npipe:\n{}",
            screen(&expected.0),
            screen(&actual.0)
        );
    }
    linked.into_iter().map(|(_, seen)| seen).collect()
}

#[test]
fn the_twin_is_equal_linked_and_on_the_pipe() {
    let Some(config) = config() else { return };
    let linked = compare_twin(
        config,
        "twin",
        abi::Plugin { id: twin::ID, setup: twin::setup },
        |harness, settle, checkpoint| {
            let tui = &harness.tui;
            let route = Route::Plugin { id: twin::ID.to_owned(), name: "twin".to_owned() };
            tui.navigate(route.clone());
            settle();
            checkpoint("open");
            for card in ["2", "2", "5"] {
                tui.keymap.dispatch("twin.bump", Some(card));
                settle();
            }
            checkpoint("bumped");
            for card in ["0", "1", "3", "4"] {
                tui.keymap.dispatch("twin.bump", Some(card));
                harness.app.advance(Duration::from_millis(1));
            }
            settle();
            checkpoint("burst");
            tui.theme.borrow_mut().set("tokyonight");
            tui.theme_changed();
            settle();
            checkpoint("theme");
            tui.keymap.dispatch("twin.toast", None);
            settle();
            checkpoint("toast");
            tui.navigate(Route::Home);
            settle();
            tui.navigate(route);
            settle();
            checkpoint("remount");
            tui.keymap.dispatch("twin.throw", None);
            settle();
            checkpoint("failed");
            for _ in 0..5 {
                harness.app.advance(Duration::from_millis(16));
            }
            checkpoint("after");
        },
    );
    assert_ne!(linked[0].0, linked[1].0, "a bump changed nothing on screen");
    let (_, toasts, status) = &linked[6];
    assert_eq!(toasts.len(), 1, "{toasts:?}");
    assert!(status.contains("run-command threw: the twin's command threw"), "{status}");
}

#[test]
fn the_kept_twin_is_equal_linked_and_on_the_pipe() {
    let Some(config) = config() else { return };
    let linked = compare_twin(
        config,
        "kept",
        abi::Plugin { id: kept::ID, setup: kept::setup },
        |harness, settle, checkpoint| {
            let tui = &harness.tui;
            let route = Route::Plugin { id: kept::ID.to_owned(), name: "kept".to_owned() };
            tui.navigate(route.clone());
            settle();
            checkpoint("open");
            tui.keymap.dispatch("kept.bump", None);
            settle();
            checkpoint("bumped");
            tui.keymap.dispatch("kept.same", None);
            settle();
            assert_eq!(opencode_plugin::surface::ledger_of(kept::ID).memo_entries, 1, "the kept root lost its memo");
            tui.keymap.dispatch("kept.hide", None);
            settle();
            checkpoint("hidden");
            tui.theme.borrow_mut().set("tokyonight");
            tui.theme_changed();
            settle();
            checkpoint("theme");
            tui.keymap.dispatch("kept.hide", None);
            settle();
            checkpoint("shown");
            tui.navigate(Route::Home);
            settle();
            tui.navigate(route);
            settle();
            checkpoint("remount");
        },
    );
    let (open, hidden, remount) = (screen(&linked[0].0), screen(&linked[2].0), screen(&linked[5].0));
    assert!(open.contains("kept 0 · begun 1 · ended 0 · message none") && open.contains("extra"), "{open}");
    assert!(remount.contains("kept 1 · begun 2 · ended 1"), "{remount}");
    assert!(!hidden.contains("extra") && hidden.contains("below"), "{hidden}");
}

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
    /// The host's frame number as each note applied, while a row lends the recorder its app ([`FRAMES_OF`]).
    static NOTED_FRAMES: std::cell::RefCell<Vec<u64>> = const { std::cell::RefCell::new(Vec::new()) };
    static FRAMES_OF: std::cell::RefCell<Option<opentui::prelude::App>> = const { std::cell::RefCell::new(None) };
}

fn recorder() -> opencode_plugin::Builtin {
    fn setup(setup: &mut abi::Setup) -> Result<(), String> {
        let command = abi::Command::new("recorder.note").title("note");
        setup.command(command, |_, input| {
            NOTED.with(|noted| noted.borrow_mut().push(input.unwrap_or("").to_owned()));
            if let Some(frame) = FRAMES_OF.with_borrow(|app| app.as_ref().map(opentui::prelude::App::frame_number)) {
                NOTED_FRAMES.with(|frames| frames.borrow_mut().push(frame));
            }
        });
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

#[test]
fn many_effects_of_one_answer_wait_for_the_next_paint() {
    let Some(config) = config() else { return };
    let (pipe, _log) = probe_and_twin(config, true);
    NOTED.with(|noted| noted.borrow_mut().clear());
    NOTED_FRAMES.with(|frames| frames.borrow_mut().clear());
    FRAMES_OF.with_borrow_mut(|app| *app = Some(pipe.harness.app.app().clone()));
    let noted = || NOTED.with(|noted| noted.borrow().len());
    pipe.harness.tui.keymap.dispatch("probe.burst", Some("100"));
    let begun = Instant::now();
    while noted() < 100 * 100 {
        assert!(begun.elapsed() < Duration::from_secs(60), "{} noted, {:?}", noted(), pipe.status(PROBE));
        turn(&pipe.harness);
        std::thread::sleep(Duration::from_micros(200));
    }
    // One budget a painted frame, however many of the JS host's answers drained before its paint (frame-effects).
    let mut frames = std::collections::BTreeMap::<u64, usize>::new();
    NOTED_FRAMES.with(|noted| noted.borrow().iter().for_each(|frame| *frames.entry(*frame).or_default() += 1));
    FRAMES_OF.with_borrow_mut(|app| *app = None);
    let most = frames.values().copied().max().unwrap_or_default();
    assert!(most <= opencode_plugin::FRAME_EFFECTS, "{most} ran in one frame");
    assert_eq!(pipe.status(PROBE), Some(Status::Active));
}

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
    until(&pipe.harness, &format!("{command} ended the JS host"), || {
        whole_or_placeholder(&pipe.harness.app.text());
        pipe.scripts().pid().is_some_and(|now| now != pid) || failed(&pipe, PROBE).is_some()
    });
    assert!(begun.elapsed() < setup, "the end took the setup's limit");
    // The failure's toast stays, and any after it waits, until read, as when the user holds it: the new JS host's start
    // may take longer than a toast shows.
    until(&pipe.harness, "the failure's toast", || {
        let title = pipe.harness.tui.toasts.current().and_then(|toast| toast.title);
        title.is_some_and(|title| title.starts_with("Plugin failed"))
    });
    pipe.harness.tui.toasts.pause();
    pipe.settle();
    let error = failed(&pipe, PROBE).unwrap_or_default();
    assert!(error.contains(cause), "{error}");
    assert!(gone(pid), "the old JS host {pid} is still running");
    assert_eq!(pipe.status(twin::ID), Some(Status::Active));
    assert!(pipe.harness.app.text().contains("twin 0"), "{}", pipe.harness.app.text());
    pipe.harness.tui.keymap.dispatch("twin.bump", Some("1"));
    pipe.settle();
    assert!(pipe.harness.app.text().contains("twin 1"), "{}", pipe.harness.app.text());
    let shown = toasts(&pipe.harness);
    assert_eq!(shown.iter().filter(|toast| toast.contains("Plugin failed")).count(), 1, "{shown:?}");
}

#[test]
fn a_plugin_that_hangs_fails_alone_and_the_js_host_starts_again() {
    let Some(mut config) = config() else { return };
    config.limits.ack = Duration::from_millis(500);
    ends_the_js_host("probe.hang", None, "run-command ended the JS host: the JS host sent nothing for 500 ms", config);
}

#[test]
fn a_plugin_that_exits_fails_alone_and_the_js_host_starts_again() {
    let Some(config) = config() else { return };
    // How the platform's `ExitStatus` reads.
    let exited = if cfg!(windows) { "exit code: 7" } else { "exit status: 7" };
    let cause = format!("run-command ended the JS host: the JS host exited ({exited})");
    ends_the_js_host("probe.exit", None, &cause, config);
}

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
        until(&pipe.harness, "the flood ended the JS host", || failed(&pipe, PROBE).is_some());
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
    until(&pipe.harness, "the raw bytes are logged", || {
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

#[test]
fn a_js_host_over_its_memory_budget_starts_again() {
    let Some(mut config) = config() else { return };
    config.limits.memory = 160 << 20;
    config.limits.poll = Duration::from_millis(50);
    let (pipe, log) = probe_and_twin(config, false);
    let pid = pipe.scripts().pid().unwrap();
    pipe.harness.tui.keymap.dispatch("probe.leak", Some("256"));
    until(&pipe.harness, "the budget ended the JS host", || {
        std::thread::sleep(Duration::from_millis(1));
        pipe.scripts().pid().is_some_and(|now| now != pid)
    });
    pipe.settle();
    assert!(gone(pid));
    assert_eq!(setups(&log), 2, "the probe was set up again");
    assert!(pipe.scripts().resident().unwrap() < 160 << 20);
}

#[test]
fn three_ends_in_a_minute_fail_every_plugin() {
    let Some(config) = config() else { return };
    let (pipe, _log) = probe_and_twin(config, false);
    for end in 0..3 {
        let pid = pipe.scripts().pid().unwrap();
        pipe.scripts().kill();
        until(&pipe.harness, &format!("end {end} was noticed"), || {
            std::thread::sleep(Duration::from_millis(1));
            pipe.scripts().pid() != Some(pid)
        });
        if end < 2 {
            // The next starts as the loader reconciles again, which a settle with no JS host does not wait for
            // (pipe-flakes: under load it had not started, and the next end found none).
            until(&pipe.harness, &format!("a JS host started after end {end}"), || {
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

#[test]
fn a_js_host_that_ends_mid_revision_leaves_the_last_whole_tree() {
    let Some(config) = config() else { return };
    let (pipe, _log) = probe_and_twin(config, false);
    twin_open(&pipe);
    for _ in 0..2 {
        pipe.harness.tui.keymap.dispatch("twin.bump", Some("3"));
        // The handler returned, so the end names nobody; its tree may be on its way.
        until(&pipe.harness, "the bump returned", || pipe.scripts().idle());
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

/// Dropped or reordered messages can end a host and lose in-flight work. Delivered calls and effects must remain unique
/// and ordered.
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
        // A gap ends the host before the next handler starts; a repeated sequence is discarded.
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

#[test]
fn delivery_over_the_pipe() {
    if config().is_none() {
        return;
    }
    model::check(&Delivery { faults: false }, 8, 24);
}

#[test]
fn delivery_over_the_pipe_with_faults() {
    if config().is_none() {
        return;
    }
    model::check(&Delivery { faults: true }, 8, 24);
}

#[test]
fn scroll_verbs_reads_and_events_cross_the_pipe() {
    let Some(config) = config() else { return };
    let (pipe, log) = probe_and_twin(config, false);
    let harness = &pipe.harness;
    harness.tui.navigate(Route::Plugin { id: PROBE.to_owned(), name: "pane".to_owned() });
    pipe.settle();
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
        still(&harness.app);
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
    let external = External { config_dir, cwd: root.path().to_path_buf() };
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

// Project-plugin approval over the pipe.

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
        let external = External { config_dir: root.path().join("config"), cwd: work };
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

/// Expected decision, active build, and setup and cleanup counts.
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
            // Importing a module counts as running it; even module-level side effects require approval.
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
        ("a-save-that-changes-nothing-reloads-nothing", &[Ask::Change(2), Ask::Approve, Ask::Change(2)]),
    ];
    for (name, asks) in rows {
        assert_eq!(PendingModel.run(asks), None, "{name}");
    }
}

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

#[test]
fn the_manager_asks_before_a_project_typescript_plugin_runs() {
    let Some(config) = config() else { return };
    let root = opencode_util::temp::tempdir().unwrap();
    let work = root.path().join("work");
    std::fs::create_dir_all(work.join(".git")).unwrap();
    let dir = work.join(".opencode").join("plugins").join("probe");
    copy(&Path::new(EXAMPLES).join("probe"), &dir);
    let harness = support::mount(100, 40, Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) });
    let external = External { config_dir: root.path().join("config"), cwd: work };
    external_with(&harness.tui, external, Some(config));
    let (app, tui) = (&harness.app, &harness.tui);
    // Wait for off-thread hashing before inspecting the question.
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
    until(&harness, "the plugin was declined", || listed(Status::Declined));
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
    until(&harness, "the approved plugin runs", || {
        tui.plugins.entries().iter().any(|entry| entry.id == PROBE && entry.status == Status::Active)
    });
}

/// Waits, painting frames and sending nothing else to the JS host, until `done` holds. It moves no clock ([`still`]):
/// a key hold's deadline must not see how long the JS host takes.
fn quietly(pipe: &Pipe, what: &str, done: impl Fn() -> bool) {
    let begun = Instant::now();
    while !done() {
        assert!(begun.elapsed() < Duration::from_secs(20), "{what}:\n{}", pipe.harness.app.text());
        still(&pipe.harness.app);
        std::thread::sleep(Duration::from_millis(1));
    }
}

/// The text of the twin's header on screen.
fn header(pipe: &Pipe) -> String {
    pipe.harness.app.text().lines().find(|line| line.starts_with("twin ")).unwrap_or("").trim().to_owned()
}

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
    external_with(&harness.tui, External { config_dir, cwd: root.path().to_path_buf() }, Some(config));
    let pipe = Pipe { harness, root };
    (0..count).for_each(|index| pipe.active(&format!("example.probe{index}")));
    pipe
}

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
    assert!(header(&pipe).starts_with(&format!("twin {} ", 9 + 30 - refused)), "{}", header(&pipe));
    assert_eq!(calls(&log), vec![serde_json::json!({ "hold": 400 }), serde_json::json!({ "hold": 700 })]);
}

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
        still(&pipe.harness.app);
        assert_ne!(header(&pipe), "twin 2 · 80", "a revision for the old width was shown");
        std::thread::sleep(Duration::from_micros(500));
    }
    pipe.settle();
    assert_eq!(header(&pipe), "twin 2 · 70");
    assert!(pipe::crossed().dropped > refused, "no revision was refused: the row did not reach its case");
}

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

const KEYS: &str = "example.keys";

/// The keys example on the JS host, on a session (a panel docks beside one), and the file it logs to.
fn keys(config: Config) -> (Pipe, PathBuf) {
    let root = opencode_util::temp::tempdir().unwrap();
    let config_dir = root.path().join("config");
    copy(&Path::new(EXAMPLES).join("keys"), &config_dir.join("plugins/keys"));
    let server = support::Fake::new(|seen| support::base(seen, support::DIRECTORY));
    let harness = support::mount(120, 30, support::deps(Arc::new(server)));
    external_with(&harness.tui, External { config_dir, cwd: root.path().to_path_buf() }, Some(config));
    let pipe = Pipe { harness, root };
    pipe.active(KEYS);
    let log = pipe.root.path().join("config/plugins/.keys.log.jsonl");
    (pipe, log)
}

/// Read and drain the input probe's event log.
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

#[test]
fn the_setup_context_says_the_client_and_its_theme() {
    let Some(mut config) = config() else { return };
    (config.version, config.channel) = ("9.9.9".to_owned(), "beta".to_owned());
    let pipe = lab(config);
    pipe.harness.tui.keymap.dispatch("lab.context", None);
    assert_eq!(toasted(&pipe, "9.9.9"), "9.9.9 beta dark");
}

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

#[test]
fn a_bad_effect_or_view_fails_its_plugin_alone() {
    for (command, cause, ended) in
        [("lab.bigint", "not JSON", false), ("lab.bigview", "BigInt", false), ("lab.exit", "ended the JS host", true)]
    {
        lab_fails(command, cause, ended);
    }
}

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

#[test]
fn a_save_behind_the_one_that_ended_the_js_host_starts_it_once() {
    let Some(config) = config() else { return };
    let (root, plugin, _log) = plugin_files("saved", "saved");
    let (stalled, gate) = (root.path().join("stalled"), root.path().join("gate"));
    let module = format!(
        r#"import {{ existsSync, writeFileSync }} from "node:fs"
const [STALLED, GATE] = {paths}
export default {{ id: "example.saved", setup(api) {{
  const carrier = api[Symbol.for("opencode.carrier")]
  carrier.command({{ name: "saved.stall", title: "saved.stall" }}, () => setTimeout(() => {{
    writeFileSync(STALLED, "")
    while (!existsSync(GATE)) {{}}
  }}, 0))
}} }}
"#,
        paths = serde_json::json!([stalled, gate]),
    );
    std::fs::write(plugin.join("tui.ts"), module.clone()).unwrap();
    let pipe = mount_server(root, config, support::empty());
    pipe.active("example.saved");
    let (h, scripts) = (&pipe.harness, pipe.scripts());
    let started = pipe::crossed().started;
    h.tui.keymap.dispatch("saved.stall", None);
    until(h, "the JS host stalled", || stalled.exists());
    // Two saves while the JS host reads nothing: each walk answers a new build, so two loads wait, one behind the
    // other. Both would import the same files, whose first line ends the host.
    for build in 0..2 {
        std::fs::write(plugin.join("tui.ts"), format!("process.exit({build})\n{module}")).unwrap();
        let sent = pipe::crossed().sent;
        opencode_tui::plugins::host::reconcile(&h.tui);
        walked(h, &scripts);
        until(h, "the save was sent", || pipe::crossed().sent > sent);
    }
    std::fs::write(&gate, "").unwrap();
    // The load that runs ends the host; the one behind it is not sent to the next, which would do the same again.
    quietly(&pipe, "the save ended the JS host", || failed(&pipe, "example.saved").is_some());
    pipe.settle();
    assert_eq!(
        pipe::crossed().started,
        started + 1,
        "a save behind the one that ended the JS host started the host again"
    );
    assert!(failed(&pipe, "example.saved").unwrap().contains("ended the JS host"));
}

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

#[test]
fn a_plugin_whose_path_holds_url_characters_loads() {
    let Some(config) = config() else { return };
    let pipe = open(&[], config, (80, 30));
    copy(&Path::new(EXAMPLES).join("reloader"), &pipe.root.path().join("config/plugins/re#loader%20"));
    opencode_tui::plugins::host::reconcile(&pipe.harness.tui);
    pipe.active("example.reloader");
}

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
    external_with(&harness.tui, External { config_dir, cwd: root.path().to_path_buf() }, Some(config));
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
    let external = External { config_dir: root.path().join("config"), cwd: root.path().to_path_buf() };
    external_with(&harness.tui, external, Some(config));
    let pipe = Pipe { harness, root };
    pipe.active(twin::ID);
}

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
    // Settle before killing the host so the failure cannot be attributed to a running handler.
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
    let external = External { config_dir: root.path().join("config"), cwd: root.path().to_path_buf() };
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
    let pipe = mount_server(root, config, server);
    pipe.active("example.ending");
    pipe.settle();
    let (h, scripts) = (&pipe.harness, pipe.scripts());
    h.tui.keymap.dispatch("ending.fetch", None);
    until(h, "the server has the request", || asked.load(std::sync::atomic::Ordering::SeqCst));
    h.tui.keymap.dispatch("ending.stall", None);
    until(h, "the JS host stalled", || stalled.exists());
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
    until(h, "the fetch settled", || std::fs::read_to_string(&log).is_ok_and(|text| text.ends_with('\n')));
    open.store(true, std::sync::atomic::Ordering::SeqCst);
    for _ in 0..200 {
        h.app.advance(Duration::from_millis(2));
        std::thread::sleep(Duration::from_millis(1));
    }
    pipe.settle();
    assert_eq!(std::fs::read_to_string(&log).unwrap(), "settled Err\n", "settled once, refused");
}

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
    let external = External { config_dir: root.path().join("config"), cwd: root.path().to_path_buf() };
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
    until(h, "the JS host stalled", || stalled.exists());
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
    until(h, "the read was refused", || pipe::crossed().refused_sends > refused);
    // A failed read holds nothing, as one past the frame: what is left is the neighbour's.
    assert_eq!(limits::held(id).content, null, "the refused read is still charged");
    std::fs::write(&gate, "").unwrap();
    pipe.settle();
    // The queue drained: the read goes again, and holds its room.
    opencode_plugin::Host::storage_changed(&*host);
    pipe.settle();
    assert_eq!(limits::held(id).content, null + bytes as u64, "the refused read was not pushed again");
    opencode_plugin::Host::storage_write(&*host, "plugin.example.quota.b", &value).unwrap();
    opencode_plugin::Host::storage_changed(&*host);
    pipe.settle();
    h.tui.keymap.dispatch("quota.report", None);
    until(h, "the report", || std::fs::read_to_string(&log).is_ok_and(|text| text.ends_with('\n')));
    let report = std::fs::read_to_string(&log).unwrap();
    let (a, b) = report.trim_end().split_once(" | ").unwrap();
    assert_eq!(a, format!("a {} none", value.len()));
    assert!(b.starts_with("b 0 the read is ") && b.ends_with("past what the plugin may hold"), "{b}");
}

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
    let external = External { config_dir: root.path().join("config"), cwd: root.path().to_path_buf() };
    external_with(&harness.tui, external, Some(config));
    harness.app.render();
    assert_eq!(opencode_plugin::loader::approval::hashed(), before, "the UI thread read the plugin's files");
    let pipe = Pipe { harness, root };
    pipe.active("example.heavy");
    let walked = pipe.scripts().hashed();
    assert!(walked > 0 && walked < 64 << 10, "the walk read {walked} bytes");
    assert_eq!(opencode_plugin::loader::approval::hashed(), before, "the UI thread read the plugin's files");
}

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
    let external = External { config_dir: root.path().join("config"), cwd: work };
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

// Preserve file size and timestamps when replacing the contents so metadata alone cannot detect the edit.
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
    let external = External { config_dir: root.path().join("config"), cwd: work };
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
    let listed =
        || pipe.harness.tui.plugins.entries().into_iter().find(|entry| entry.target.as_deref() == Some(&target));
    // The walk that hashes the new build runs off the UI thread and may begin after a settle saw none running
    // (ownership-harness): the row waits for its result, the build asked about.
    pipe.until("the new build is asked about", || listed().is_some_and(|entry| entry.status == Status::Pending));
    pipe.settle();
    let Some((Ok(held), _)) = opencode_tui::plugins::host::held(&pipe.harness.tui, &target) else {
        panic!("the new build is not asked about")
    };
    assert_ne!(held.sha256, artifact.sha256);
    assert_eq!(opencode_plugin::loader::approval::hashed(), before, "the UI thread read the plugin's files");
    assert_eq!(std::fs::read_to_string(&marker).unwrap(), ran, "what changed ran");
}

#[test]
fn a_hostile_project_loads_nothing_into_the_js_host() {
    hostile(|_| config());
}

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
    let external = External { config_dir, cwd: project.clone() };
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

#[test]
fn a_fetch_reply_of_a_mebibyte_arrives_whole() {
    let Some(config) = config() else { return };
    let (root, plugin, log) = plugin_files("large", "fetched");
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
    let pipe = mount_server(root, config, server);
    pipe.active("example.large");
    pipe.harness.tui.keymap.dispatch("large.fetch", None);
    until(&pipe.harness, "the fetch ended", || std::fs::read_to_string(&log).is_ok_and(|text| text.ends_with('\n')));
    assert_eq!(std::fs::read_to_string(&log).unwrap(), format!("{length} {first} {last} true\n"));
    assert_eq!(pipe.status("example.large"), Some(opencode_plugin::Status::Active));
}

#[test]
fn a_repeated_reply_in_parts_leaves_nothing_kept() {
    let Some(config) = config() else { return };
    let (root, plugin, log) = plugin_files("twice", "fetched");
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
    let pipe = mount_server(root, config, server);
    pipe.active("example.twice");
    pipe.harness.tui.keymap.dispatch("twice.fetch", None);
    until(&pipe.harness, "the server has the request", || seen.load(std::sync::atomic::Ordering::SeqCst));
    // The next call the host sends is the reply's.
    pipe.scripts().fault(pipe::Fault::Repeat);
    open.store(true, std::sync::atomic::Ordering::SeqCst);
    until(&pipe.harness, "the fetch ended", || std::fs::read_to_string(&log).is_ok_and(|text| text.ends_with('\n')));
    assert_eq!(std::fs::read_to_string(&log).unwrap(), format!("{} 0\n", 1 << 20));
}

#[test]
fn a_fetch_reply_too_large_for_the_js_host_fails() {
    let Some(config) = config() else { return };
    let (root, plugin, log) = plugin_files("huge", "fetched");
    let module = format!(
        "import {{ appendFileSync }} from \"node:fs\"\nexport default {{ id: \"example.huge\", setup(api) {{\n  const carrier = api[Symbol.for(\"opencode.carrier\")]\n  carrier.command({{ name: \"huge.fetch\", title: \"huge.fetch\" }}, async () => {{\n    const result = await carrier.fetch({{ method: \"GET\", path: \"/api/huge\" }})\n    appendFileSync({log:?}, Object.keys(result ?? {{}}).join(\",\") + \"\\n\")\n  }})\n}} }}\n"
    );
    std::fs::write(plugin.join("tui.ts"), module).unwrap();
    // The payload exceeds the entire overflow, not just one frame.
    let big = "x".repeat(9 << 20);
    let server = support::Fake::new(move |seen| match seen.path.as_str() {
        "/api/huge" => (200, serde_json::json!({ "data": big })),
        "/api/session" => (200, serde_json::json!({ "data": [], "cursor": {} })),
        _ => support::not_found(),
    });
    let pipe = mount_server(root, config, server);
    pipe.active("example.huge");
    pipe.harness.tui.keymap.dispatch("huge.fetch", None);
    until(&pipe.harness, "the fetch ended", || std::fs::read_to_string(&log).is_ok_and(|text| text.ends_with('\n')));
    assert_eq!(std::fs::read_to_string(&log).unwrap(), "Err\n");
}

#[test]
fn a_fetch_across_a_reload_of_the_registrations_settles() {
    let Some(config) = config() else { return };
    let (root, plugin, log) = plugin_files("gated", "fetched");
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
    let pipe = mount_server(root, config, server);
    pipe.active("example.gated");
    let h = &pipe.harness;
    h.tui.keymap.dispatch("gated.fetch", None);
    until(h, "the reload took the late command", || {
        matches!(h.tui.keymap.dispatch("gated.late", None), opentui::keymap::RunResult::Ok)
    });
    open.store(true, std::sync::atomic::Ordering::SeqCst);
    until(h, "the fetch ended", || std::fs::read_to_string(&log).is_ok_and(|text| text.ends_with('\n')));
    assert_eq!(std::fs::read_to_string(&log).unwrap(), "Ok\n");
    assert_eq!(pipe.status("example.gated"), Some(opencode_plugin::Status::Active));
}

#[test]
fn a_fetch_across_a_reload_with_a_changed_view_settles() {
    fetch_across_a_reload_with_a_changed_view(false);
}

#[test]
fn a_fetch_whose_done_comes_after_the_reload_settles() {
    fetch_across_a_reload_with_a_changed_view(true);
}

/// A command that starts a fetch, registers another command and changes its footer, `slow` with a second footer that
/// then draws 30,000 rows, whose view the JS host sends after the first's manifest and before the call's `Done`; the
/// server holds the reply until the reload is on screen.
fn fetch_across_a_reload_with_a_changed_view(slow: bool) {
    let Some(config) = config() else { return };
    let (root, plugin, log) = plugin_files("viewed", "fetched");
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
    let pipe = mount_server(root, config, server);
    pipe.active("example.viewed");
    let h = &pipe.harness;
    h.wait_for("viewed before");
    h.tui.keymap.dispatch("viewed.fetch", None);
    until(h, "the reload took the late command and the view", || {
        matches!(h.tui.keymap.dispatch("viewed.late", None), opentui::keymap::RunResult::Ok)
            && h.app.text().contains("viewed after")
    });
    pipe.settle();
    open.store(true, std::sync::atomic::Ordering::SeqCst);
    until(h, "the fetch ended", || std::fs::read_to_string(&log).is_ok_and(|text| text.ends_with('\n')));
    assert_eq!(std::fs::read_to_string(&log).unwrap(), "Ok 0\n");
}

#[test]
fn a_new_builds_first_command_and_fetch_reach_it() {
    new_build_registers_and_fetches(true, 0, false);
}

#[test]
fn a_new_builds_command_and_fetch_after_its_adoption_reach_it() {
    new_build_registers_and_fetches(false, 0, false);
}

// Vary the order of manifest, adoption, and early messages; the bound is per staged build.
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
    let (root, plugin, log) = plugin_files("build", "built");
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
    let pipe = mount_server(root, config, server);
    pipe.active("example.build");
    let (h, scripts) = (&pipe.harness, pipe.scripts());
    let runs = |name: &str| matches!(h.tui.keymap.dispatch(name, None), opentui::keymap::RunResult::Ok);
    let held = |types: &[&str]| {
        until(h, &format!("{types:?} held"), || {
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
        until(h, "the load described or set up", || {
            scripts.held_types().iter().any(|kind| kind == "described" || kind == "loaded")
        });
        if !scripts.held_types().iter().any(|kind| kind == "loaded") {
            scripts.hold_answers(false);
            scripts.hold_answers(true);
        }
        held(&["loaded", "manifest", "effects"]);
        scripts.hold_answers(false);
    } else {
        until(h, "the new build is registered", || runs("build.two"));
        assert!(runs("build.go"));
    }
    // The setup's write settles once, and so does the fetch: its line is the other one.
    let lines = || std::fs::read_to_string(&log).unwrap_or_default().lines().map(str::to_owned).collect::<Vec<_>>();
    until(h, "the setup's write and the fetch settled", || {
        lines().iter().any(|line| line == "setup settled") && lines().iter().any(|line| line != "setup settled")
    });
    pipe.settle();
    let fetch = || lines().into_iter().filter(|line| line != "setup settled" && line != "late").collect::<Vec<_>>();
    assert_eq!(lines().iter().filter(|line| *line == "setup settled").count(), 1, "{:?}", lines());
    let fetched = || requests.lock().unwrap().iter().filter(|seen| seen.path == "/api/build").count();
    let host = opencode_tui::plugins::host::host(&h.tui);
    let stored = || opencode_plugin::Host::storage_read(&*host, "plugin.example.build.kept");
    if notices + 2 > 256 {
        let case = format!("{notices} notices, manifest first {manifest_first}");
        // Refused at once, while the setup's write may still wait to be refused as the activation ends.
        let fetch = fetch();
        assert!(fetch.len() == 1 && fetch[0].starts_with("Err "), "{case}: {fetch:?}");
        until(h, "the build failed", || {
            matches!(pipe.status("example.build"), Some(opencode_plugin::Status::Failed(_)))
        });
        let Some(opencode_plugin::Status::Failed(error)) = pipe.status("example.build") else { unreachable!() };
        assert!(error.contains("more than 256 messages"), "{case}: {error}");
        assert!(!runs("build.late"), "{case}: the late command of the build that failed is there");
        assert_eq!(fetched(), 0, "{case}: a fetch of the build that failed left");
        assert_eq!(stored(), None, "{case}: the setup's write of the build that failed persisted");
        return;
    }
    assert_eq!(stored().as_deref(), Some(r#"{"build":"two"}"#), "the setup's write of the build");
    assert_eq!(fetch(), ["Ok 0"]);
    until(h, "the late command is registered", || runs("build.late"));
    until(h, "the late command ran", || std::fs::read_to_string(&log).is_ok_and(|text| text.ends_with("late\n")));
    assert_eq!(fetched(), 1, "one request for the one fetch");
    assert_eq!(pipe.status("example.build"), Some(opencode_plugin::Status::Active));
}

#[test]
fn a_fetch_of_an_activation_that_ends_settles_once() {
    let Some(config) = config() else { return };
    let (root, plugin, log) = plugin_files("ending", "ended");
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
    let pipe = mount_server(root, config, server);
    pipe.active("example.ending");
    let h = &pipe.harness;
    h.tui.keymap.dispatch("ending.fetch", None);
    until(h, "the server has the request", || asked.load(std::sync::atomic::Ordering::SeqCst));
    h.tui.plugins.set_active(&opencode_tui::plugins::host::host(&h.tui), "example.ending", false);
    until(h, "the fetch ended", || std::fs::read_to_string(&log).is_ok_and(|text| text.ends_with('\n')));
    open.store(true, std::sync::atomic::Ordering::SeqCst);
    for _ in 0..200 {
        h.app.advance(Duration::from_millis(2));
        std::thread::sleep(Duration::from_millis(1));
    }
    pipe.settle();
    assert_eq!(std::fs::read_to_string(&log).unwrap(), "Err\n", "settled once, refused");
}

#[test]
fn a_snapshot_of_the_running_build_never_reaches_the_new_one() {
    snapshot_across_a_new_build(true);
}

#[test]
fn a_snapshot_after_the_new_builds_adoption_never_reaches_it() {
    snapshot_across_a_new_build(false);
}

/// The first build of a plugin watches the stored `old`; its second build does not, and logs each snapshot it hears.
/// The host changes `old`, `held` while it holds the second build's `Loaded`, else once it registered that build.
fn snapshot_across_a_new_build(held: bool) {
    let Some(config) = config() else { return };
    let (root, plugin, log) = plugin_files("snap", "snapshots");
    let first = "export default { id: \"example.snap\", setup(context) {\n  context.storage.store(\"old\", { initial: { n: 0 } })\n} }\n";
    let second = format!(
        "import {{ appendFileSync }} from \"node:fs\"\nexport default {{ id: \"example.snap\", setup(context) {{\n  const carrier = context[Symbol.for(\"opencode.carrier\")]\n  carrier.listen((key) => {{ if (key === \"storage:old\") appendFileSync({log:?}, \"heard\\n\") }})\n  context.keymap.layer(() => ({{ mode: \"global\", commands: [{{ id: \"snap.read\", run: () => appendFileSync({log:?}, `read ${{carrier.read(\"storage:old\")}}\\n`) }}] }}))\n}} }}\n"
    );
    std::fs::write(plugin.join("tui.ts"), first).unwrap();
    let harness = support::mount(80, 30, Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) });
    let external = External { config_dir: root.path().join("config"), cwd: root.path().to_path_buf() };
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
        until(h, "the load described or set up", || {
            scripts.held_types().iter().any(|kind| kind == "described" || kind == "loaded")
        });
        if !scripts.held_types().iter().any(|kind| kind == "loaded") {
            scripts.hold_answers(false);
            scripts.hold_answers(true);
        }
        until(h, "the new build's Loaded held", || scripts.held_types().iter().any(|kind| kind == "loaded"));
        // The running build is still the host's: its read follows the change.
        change(5);
        scripts.hold_answers(false);
    }
    until(h, "the new build is registered", || runs("snap.read"));
    if !held {
        change(5);
        assert!(runs("snap.read"));
    }
    pipe.settle();
    until(h, "the read was logged", || std::fs::read_to_string(&log).is_ok_and(|text| text.contains("read ")));
    let logged = std::fs::read_to_string(&log).unwrap();
    assert_eq!(logged.lines().last(), Some("read undefined"), "{logged}");
    assert!(!logged.contains("heard"), "{logged}");
}

#[test]
fn a_fetch_the_host_does_not_take_fails_over_the_pipe() {
    let Some(config) = config() else { return };
    let (root, plugin, log) = plugin_files("refused", "fetched");
    // Its call stages 128 effects before the fetch. The host takes a fetch only while the effects that wait leave it
    // room for the call's own: the queue sits exactly at its bound, a fetch alone can find the last place, and the
    // call's margin keeps the answer the same wherever in a frame the queue stands.
    let module = format!(
        "import {{ appendFileSync }} from \"node:fs\"\nexport default {{ id: \"example.refused\", setup(api) {{\n  const carrier = api[Symbol.for(\"opencode.carrier\")]\n  carrier.command({{ name: \"refused.fetch\", title: \"refused.fetch\" }}, async () => {{\n    for (let i = 0; i < 128; i++) api.ui.toast.show({{ message: \"staged\" }})\n    const result = await carrier.fetch({{ method: \"GET\", path: \"/api/session\" }})\n    appendFileSync({log:?}, Object.keys(result ?? {{}}).join(\",\") + \"\\n\")\n  }})\n}} }}\n"
    );
    std::fs::write(plugin.join("tui.ts"), module).unwrap();
    let server = support::Fake::new(|seen| match seen.path.as_str() {
        "/api/session" => (200, serde_json::json!({ "data": [], "cursor": {} })),
        _ => support::not_found(),
    });
    let pipe = mount_server(root, config, server);
    pipe.active("example.refused");
    let h = &pipe.harness;
    opencode_tui::plugins::host::add(&h.tui, abi::Plugin { id: "probe", setup: crate::plugins::chain }.into());
    h.wait_for("chain ready");
    let lines = || std::fs::read_to_string(&log).unwrap_or_default();
    h.tui.keymap.dispatch("chain.fan", None);
    // The fan fills the queue of effects to its bound, where a fetch finds no room: wait for the bound itself, not for
    // a number of frames (a frame runs a budget, and the chain adds a little back as it runs).
    let begun = Instant::now();
    while opencode_plugin::effects_waiting() < opencode_plugin::EFFECTS_BOUND {
        assert!(
            begun.elapsed() < Duration::from_secs(30),
            "{} effects wait, under the queue's bound of {}",
            opencode_plugin::effects_waiting(),
            opencode_plugin::EFFECTS_BOUND
        );
        h.app.render();
    }
    h.tui.keymap.dispatch("refused.fetch", None);
    until(h, "the refused fetch ended", || lines().ends_with('\n'));
    assert_eq!(lines(), "Err\n");
    h.tui.plugins.set_active(&opencode_tui::plugins::host::host(&h.tui), "probe", false);
    // A frame runs its budget of what waits: the drain is so many frames, however long each takes under load
    // (pipe-flakes: 65 frames of the full queue took 5 s alone, past the 30 s of a wait under the lane's load).
    let waiting = opencode_plugin::effects_waiting();
    // Each paint runs nothing past its budget; the rest comes due just after it.
    for _ in 0..waiting.div_ceil(opencode_plugin::FRAME_EFFECTS) {
        h.app.render();
        h.app.advance(Duration::ZERO);
    }
    assert_eq!(opencode_plugin::effects_waiting(), 0, "the queue drained within a frame for each budget of {waiting}");
    h.tui.keymap.dispatch("refused.fetch", None);
    until(h, "the fetch ended", || lines().lines().count() == 2);
    assert_eq!(lines(), "Err\nOk\n");
}

#[test]
fn a_late_reply_does_not_reach_a_mount_opened_again_over_the_pipe() {
    let Some(config) = config() else { return };
    let (root, plugin, log) = plugin_files("owned", "replied");
    let module = format!(
        "import {{ appendFileSync }} from \"node:fs\"\nexport default {{ id: \"example.owned\", setup(api) {{\n  const carrier = api[Symbol.for(\"opencode.carrier\")]\n  carrier.surface(\"owned\", {{ type: \"route\", name: \"owned\" }}, () => ({{ type: \"text\", spans: [{{ text: \"owned route\" }}] }}))\n  const fetch = (name) => async () => {{\n    const result = await carrier.fetch({{ method: \"GET\", path: \"/api/hold\" }}).catch((error) => ({{ [error.name]: error.message }}))\n    appendFileSync({log:?}, name + \" \" + Object.keys(result ?? {{}}).join(\",\") + \" \" + carrier.pendingFetches() + \"\\n\")\n  }}\n  carrier.command({{ name: \"owned.route\", title: \"owned.route\", scope: {{ route: \"owned\" }} }}, fetch(\"route\"))\n  carrier.command({{ name: \"owned.global\", title: \"owned.global\" }}, fetch(\"global\"))\n}} }}\n"
    );
    std::fs::write(plugin.join("tui.ts"), module).unwrap();
    let (fake, gate, served, asked) = crate::plugin_surface::held();
    let harness = support::mount(80, 30, Deps { route: Route::Home, ..support::deps(Arc::new(fake)) });
    let external = External { config_dir: root.path().join("config"), cwd: root.path().to_path_buf() };
    external_with(&harness.tui, external, Some(config));
    let pipe = Pipe { harness, root };
    pipe.active("example.owned");
    let h = &pipe.harness;
    let route = Route::Plugin { id: "example.owned".into(), name: "owned".into() };
    h.tui.navigate(route.clone());
    h.wait_for("owned route");
    h.tui.keymap.dispatch("owned.route", None);
    // The JS host answers the command, and the host sends its fetch, before the route closes.
    until(h, "the route's fetch went out", || asked.load(std::sync::atomic::Ordering::SeqCst) >= 1);
    h.tui.navigate(Route::Home);
    h.app.advance(Duration::from_millis(16));
    h.tui.navigate(route);
    h.wait_for("owned route");
    *gate.0.lock().unwrap() = true;
    gate.1.notify_all();
    let lines = || std::fs::read_to_string(&log).unwrap_or_default();
    h.wait("the route's reply was served", || served.load(std::sync::atomic::Ordering::SeqCst) >= 1);
    until(h, "the route's fetch settled", || lines().ends_with('\n'));
    assert_eq!(lines(), "route AbortError 0\n", "a reply reached a mount opened again, or its fetch did not settle");
    h.tui.keymap.dispatch("owned.global", None);
    until(h, "the global reply arrived", || lines().lines().count() == 2);
    assert_eq!(lines(), "route AbortError 0\nglobal Ok 0\n");
}

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
    let pipe = mount_server(root, config, server);
    pipe.active("example.flooded");
    let (h, scripts) = (&pipe.harness, pipe.scripts());
    // The answer that asks for the fetch waits, so the fetch's own answer goes once the overflow is full.
    scripts.hold_answers(true);
    h.tui.keymap.dispatch("flooded.go", None);
    until(h, "the JS host stalled", || stalled.exists());
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
    until(h, "the fetch settled", || std::fs::read_to_string(&log).is_ok_and(|text| text.ends_with('\n')));
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
    let external = External { config_dir: root.path().join("config"), cwd: root.path().to_path_buf() };
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
    until(h, "the JS host stalled", || stalled.exists());
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
            until(h, "the fetch was sent", || asked.load(std::sync::atomic::Ordering::SeqCst) == 1);
            *server_gate.0.lock().unwrap() = true;
            server_gate.1.notify_all();
            h.wait("the server answered", || served.load(std::sync::atomic::Ordering::SeqCst) == 1);
        }
    }
    for _ in 0..5 {
        h.app.advance(Duration::from_millis(1));
    }
    std::fs::write(&gate, "").unwrap();
    until(h, "the fetch settled", || std::fs::read_to_string(&log).is_ok_and(|text| text.ends_with('\n')));
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

#[test]
fn a_v2_plugin_reads_a_sessions_pending_inbox() {
    let Some(config) = config() else { return };
    let (root, plugin, log) = plugin_files("pending", "pending");
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
    let external = External { config_dir: root.path().join("config"), cwd: root.path().to_path_buf() };
    external_with(&harness.tui, external, Some(config));
    let pipe = Pipe { harness, root };
    pipe.active("example.pending");
    until(&pipe.harness, "the inbox loaded", || pipe.harness.app.text().contains("1 queued"));
    pipe.harness.tui.keymap.dispatch("pending.log", None);
    until(&pipe.harness, "the plugin read its inbox", || {
        std::fs::read_to_string(&log).is_ok_and(|text| text.ends_with('\n'))
    });
    assert_eq!(std::fs::read_to_string(&log).unwrap(), "[\"msg_3\"]\n");
}

#[test]
fn a_tree_past_the_frame_cap_fails_its_plugin_alone() {
    let Some(config) = config() else { return };
    let root = opencode_util::temp::tempdir().unwrap();
    // Nine texts within a node's text bound, past a tree frame's together.
    let big = "{ type: \"box\", children: Array.from({ length: 9 }, () => ({ type: \"text\", spans: [{ text: \"x\".repeat(1e6) }] })) }";
    for (name, view) in [("big", big), ("calm", "{ type: \"text\", spans: [{ text: \"calm route\" }] }")] {
        let dir = root.path().join("config/plugins").join(name);
        std::fs::create_dir_all(&dir).unwrap();
        let module = format!(
            "export default {{ id: \"example.{name}\", setup(api) {{\n  const carrier = api[Symbol.for(\"opencode.carrier\")]\n  carrier.surface(\"{name}\", {{ type: \"route\", name: \"{name}\" }}, () => ({view}))\n}} }}\n"
        );
        std::fs::write(dir.join("tui.ts"), module).unwrap();
    }
    let pipe = mount_server(root, config, support::empty());
    pipe.active("example.big");
    pipe.active("example.calm");
    let pid = pipe.scripts().pid();
    let h = &pipe.harness;
    h.tui.navigate(Route::Plugin { id: "example.big".into(), name: "big".into() });
    pipe.until("the big plugin failed", || failed(&pipe, "example.big").is_some());
    let error = failed(&pipe, "example.big").unwrap();
    assert!(error.starts_with("its tree of 9000"), "{error}");
    assert_eq!(pipe.scripts().pid(), pid, "the JS host started again");
    h.tui.navigate(Route::Plugin { id: "example.calm".into(), name: "calm".into() });
    h.wait_for("calm route");
}
