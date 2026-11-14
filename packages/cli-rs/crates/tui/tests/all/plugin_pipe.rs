//! The pipe carrier (P7, synthesis 3.7, 4.3, 4.14): TypeScript plugins on the JS host, a real Bun process. The plugins
//! are `crates/plugin/examples/pipe`: `twin/tui.ts`, whose linked twin is `twin.rs`, and `probe/tui.ts`, which writes
//! its own call log. Every row skips without Bun, unless `OPENCODE_RS_REQUIRE_TS=1`.
//!
//! A frame of the pipe is compared once the JS host has settled: everything sent was handled, and no tree waits for
//! the host ([`settle`]). Before that, a surface shows what the second tier allows: its last whole revision or a
//! placeholder.

#[path = "../../../plugin/examples/pipe/twin.rs"]
mod twin;

use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::Arc;
use std::time::{Duration, Instant};

use opencode_plugin::abi;
use opencode_plugin::pipe::{self, Config, Scripts};
use opencode_tui::plugins::host::{External, external_with};
use opencode_tui::{Deps, Route};

use crate::plugin_surface::{Carrier, builtin};
use crate::support::{self, Harness};

const EXAMPLES: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../plugin/examples/pipe");

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
    let root = opencode_util::temp::tempdir().unwrap();
    let config_dir = root.path().join("config");
    let mut entries = Vec::new();
    for (name, options) in plugins {
        let dir = config_dir.join("plugins").join(name);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::copy(Path::new(EXAMPLES).join(name).join("tui.ts"), dir.join("tui.ts")).unwrap();
        if let Some(options) = options {
            entries.push(serde_json::json!({ "package": dir.to_string_lossy(), "options": options }));
        }
    }
    let mut deps = Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) };
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

/// The JS host as the tests run it: Bun, and the default limits but a longer acknowledgement, so a machine under load
/// does not end it as hung; the hang rows set their own.
pub fn config() -> Option<Config> {
    let mut config = Config::new(bun()?);
    config.limits.ack = Duration::from_secs(10);
    Some(config)
}

/// Waits until the JS host handled everything sent before, and no tree waits for the host; then three frames.
pub fn settle(harness: &Harness, scripts: &Scripts) {
    let begun = Instant::now();
    loop {
        // What the UI sends in its next frames (a route's first view is deferred) goes before the ping.
        for _ in 0..3 {
            harness.app.advance(Duration::from_millis(1));
        }
        let seq = scripts.ping();
        let mut pong = None;
        while pong.is_none() {
            if begun.elapsed() > Duration::from_secs(20) {
                let entries =
                    harness.tui.plugins.entries().into_iter().map(|entry| format!("{} {:?}", entry.id, entry.status));
                panic!(
                    "the JS host never settled:\n{}\n{}",
                    entries.collect::<Vec<_>>().join("\n"),
                    harness.app.text()
                );
            }
            harness.app.advance(Duration::from_millis(1));
            pong = scripts.ponged(seq);
            if pong.is_none() {
                std::thread::sleep(Duration::from_micros(200));
            }
        }
        for _ in 0..3 {
            harness.app.advance(Duration::from_millis(1));
        }
        if pong == Some(false) && scripts.idle() {
            return;
        }
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

/// The twin's script, linked (`None`) or on the pipe: what each checkpoint saw.
fn twin_script(pipe: Option<Config>) -> Vec<(&'static str, Seen)> {
    let (harness, _root) = match pipe {
        Some(config) => {
            let pipe = open(&[("twin", None)], config, (80, 30));
            pipe.active(twin::ID);
            (pipe.harness, Some(pipe.root))
        }
        None => {
            let mut deps = Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) };
            deps.builtins.push(builtin(Carrier::Linked, abi::Plugin { id: twin::ID, setup: twin::setup }));
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
    let linked = twin_script(None);
    // The guard: the checkpoints see different frames, so equal runs are not equal by being empty.
    assert_ne!(linked[0].1.0, linked[1].1.0, "a bump changed nothing on screen");
    let (_, (_, toasts, status)) = linked.iter().find(|(name, _)| *name == "failed").unwrap();
    assert_eq!(toasts.len(), 1, "{toasts:?}");
    assert!(status.contains("run-command threw: the twin's command threw"), "{status}");
    let piped = twin_script(Some(config));
    for ((name, linked), (_, piped)) in linked.iter().zip(&piped) {
        assert_eq!(linked.1, piped.1, "at {name}: toasts");
        assert_eq!(linked.2, piped.2, "at {name}: status");
        if linked.0 != piped.0 {
            panic!("at {name}: the frames differ\nlinked:\n{}\npipe:\n{}", screen(&linked.0), screen(&piped.0));
        }
    }
}

// Containment, hold, placeholders and delivery over the pipe (P7).

use opencode_plugin::Status;
use opencode_plugin::pipe::Fault;

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
        let command = abi::Command { name: "recorder.note".into(), title: "note".into(), ..abi::Command::default() };
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
    let (pipe, _log) = probe_and_twin(config, false);
    let pid = pipe.scripts().pid().unwrap();
    twin_open(&pipe);
    toasts(&pipe.harness);
    pipe.harness.tui.keymap.dispatch(command, input);
    pipe.harness.wait(&format!("{command} ended the JS host"), || {
        pipe.harness.app.advance(Duration::from_millis(1));
        whole_or_placeholder(&pipe.harness.app.text());
        pipe.scripts().pid().is_some_and(|now| now != pid) || failed(&pipe, PROBE).is_some()
    });
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
    ends_the_js_host("probe.hang", None, "run-command ended the JS host: the JS host did not acknowledge", config);
}

// Expected (containment, a plugin that exits): the JS host's end is noticed; the plugin whose handler ran fails, named
// with the exit, and the rest is as for a hang.
#[test]
fn a_plugin_that_exits_fails_alone_and_the_js_host_starts_again() {
    let Some(config) = config() else { return };
    ends_the_js_host("probe.exit", None, "run-command ended the JS host: the JS host exited (exit status: 7)", config);
}

// Expected (containment, a plugin that floods): effects sent outside any call past the host's bound of unread messages
// end the JS host, and the plugin whose effects filled it fails, though no call of it ran.
#[test]
fn a_plugin_that_floods_fails_alone_and_the_js_host_starts_again() {
    let Some(config) = config() else { return };
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
    assert!(error.contains("flooded the host with effects"), "{error}");
    assert!(gone(pid));
    assert_eq!(pipe.status(twin::ID), Some(Status::Active));
}

// Expected (review F4): a plugin's prints go to the JS host's standard error and break nothing; raw bytes written past
// them to standard output break the protocol, which ends the JS host: the plugin whose handler wrote them fails, and the
// other is set up again on a new one.
#[test]
fn standard_output_is_the_protocols_alone() {
    let Some(config) = config() else { return };
    let (pipe, log) = probe_and_twin(config, false);
    let pid = pipe.scripts().pid().unwrap();
    pipe.harness.tui.keymap.dispatch("probe.print", None);
    pipe.settle();
    assert_eq!(calls(&log), vec![serde_json::json!({ "printed": true })]);
    assert_eq!(pipe.scripts().pid(), Some(pid), "a print ended the JS host");
    pipe.harness.tui.keymap.dispatch("probe.raw", None);
    pipe.harness.wait("the raw bytes ended the JS host", || {
        pipe.harness.app.advance(Duration::from_millis(1));
        pipe.scripts().pid().is_some_and(|now| now != pid)
    });
    pipe.settle();
    assert!(gone(pid));
    let error = failed(&pipe, PROBE).unwrap_or_default();
    assert!(error.contains("run-command ended the JS host: the JS host broke the protocol"), "{error}");
    assert_eq!(pipe.status(twin::ID), Some(Status::Active));
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
    harness.app.type_text("ab");
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
    // Away and back: the home footer mounts again, under the same key.
    harness.tui.navigate(Route::Plugin { id: twin::ID.to_owned(), name: "twin".to_owned() });
    pipe.settle();
    harness.tui.navigate(Route::Home);
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
        if faults == 0 {
            if seen != expected {
                return fail("log", format!("expected {expected:?}\nseen {seen:?}"));
            }
            if noted != steps {
                return fail("effects", format!("expected {steps:?}\nnoted {noted:?}"));
            }
            return None;
        }
        // Each seen once, in the order of the input.
        let mut rest = expected.iter();
        if let Some(entry) = seen.iter().find(|entry| !rest.any(|expected| expected == *entry)) {
            return fail("subsequence", format!("{entry} out of order or twice\nexpected {expected:?}\nseen {seen:?}"));
        }
        let mut rest = steps.iter();
        if let Some(note) = noted.iter().find(|note| !rest.any(|step| step == *note)) {
            return fail("effects-order", format!("{note} out of order or twice\nexpected {steps:?}\nnoted {noted:?}"));
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
// its bytes are a fraction of the whole tree's; one that changes nothing crosses no tree; a theme change crosses
// nothing to the plugin.
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
    // The settle's own ping and pong cross; nothing else does.
    assert_eq!((themed.sent - quiet.sent, themed.trees - quiet.trees), (1, 0), "a theme change crossed to the plugin");
}
