//! The V2 compatibility layer (P8): today's `{ id, setup }` TUI plugins, with JSX over OpenTUI's intrinsics, on the JS
//! host. The probe is `crates/plugin/examples/pipe/v2probe/tui.tsx`, written against `@opencode/plugin/tui` as an npm
//! plugin is; the three published packages are compared with their native ports in `ports.rs`, and with TS cell for cell
//! in P-APP (`parity/scenarios/P.8`). Every row skips without Bun, unless `OPENCODE_RS_REQUIRE_TS=1`.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use opencode_plugin::Status;
use opencode_plugin::loader::approval::Decision;
use opencode_plugin::pipe::{self, Config, Fault};
use opencode_tui::plugins::host::{External, external_with};
use opencode_tui::{Deps, Route};
use serde_json::{Value, json};

use crate::plugin_pipe::{Pipe, config, copy, open};
use crate::support;

const EXAMPLES: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../plugin/examples/pipe");
const PROBE: &str = "example.v2probe";

/// The probe, with its call log, on Home and settled.
fn probe(config: Config) -> (Pipe, PathBuf) {
    let log = log_file();
    let options = json!({ "log": log.to_string_lossy() });
    let pipe = open(&[("v2probe", Some(options))], config, (80, 30));
    pipe.active(PROBE);
    pipe.settle();
    (pipe, log)
}

/// A call log of this test's own, empty.
fn log_file() -> PathBuf {
    let log = std::env::temp_dir().join(format!("v2probe-{}-{:?}.log", std::process::id(), std::thread::current().id()));
    let _ = std::fs::remove_file(&log);
    log
}

/// What the probe logged, in order, without its setups.
fn calls(log: &Path) -> Vec<Value> {
    let text = std::fs::read_to_string(log).unwrap_or_default();
    text.lines().map(|line| serde_json::from_str(line).unwrap()).filter(|call: &Value| call.get("setup").is_none()).collect()
}

/// The toasts shown since the last call, oldest first, as `title: message`.
fn toasts(pipe: &Pipe) -> Vec<String> {
    let mut shown = Vec::new();
    while let Some(toast) = pipe.harness.tui.toasts.current() {
        shown.push(format!("{}{}", toast.title.map(|title| format!("{title}: ")).unwrap_or_default(), toast.message));
        pipe.harness.tui.toasts.dismiss();
    }
    shown
}

fn footer(pipe: &Pipe) -> String {
    let text = pipe.harness.app.text();
    text.lines().map(str::trim).find(|line| line.starts_with("v2probe ")).unwrap_or_default().to_owned()
}

// Expected (`delivery` for the V2 layer): commands a V2 plugin registers with `keymap.layer` reach its handlers once each
// and in order, through the pipe's fault operators too (a drop or a swap ends the JS host, which a restart follows),
// and its JSX shows what they did once the JS host settled.
#[test]
fn a_v2_plugins_commands_arrive_once_each_in_order() {
    let Some(config) = config() else { return };
    let (pipe, log) = probe(config);
    assert_eq!(footer(&pipe), "v2probe 0:");
    let mut sent = Vec::new();
    for (round, fault) in [None, Some(Fault::Repeat), Some(Fault::Drop), Some(Fault::Swap)].into_iter().enumerate() {
        if let Some(fault) = fault {
            pipe.scripts().fault(fault);
        }
        for index in 0..4 {
            let input = format!("{round}{index}");
            pipe.harness.tui.keymap.dispatch("v2probe.add", Some(&input));
            sent.push(json!({ "add": input }));
        }
        pipe.settle();
    }
    assert_eq!(calls(&log), sent);
    // The last item shows; a restart resets the plugin's state, as it resets any plugin's on the JS host.
    let shown = footer(&pipe);
    assert!(shown.starts_with("v2probe ") && shown.ends_with("33"), "{shown}");
    assert_eq!(pipe.status(PROBE), Some(Status::Active));
}

// Expected (containment, as TS's plugin boundary): a render that throws shows nothing from then on and says so once, in
// the words TS uses; the plugin stays active and its commands run.
#[test]
fn a_v2_render_that_throws_is_reported_as_ts_reports_it() {
    let Some(config) = config() else { return };
    let (pipe, log) = probe(config);
    toasts(&pipe);
    pipe.harness.tui.keymap.dispatch("v2probe.throw", None);
    pipe.settle();
    assert_eq!(toasts(&pipe), ["Plugin: example.v2probe crashed in slot home.footer: boom"]);
    assert_eq!(footer(&pipe), "");
    assert_eq!(pipe.status(PROBE), Some(Status::Active));
    pipe.harness.tui.keymap.dispatch("v2probe.add", Some("after"));
    pipe.settle();
    assert_eq!(calls(&log), [json!({ "add": "after" })]);
    assert!(toasts(&pipe).is_empty(), "the crash was reported again");
}

// Expected: an intrinsic the contract has no node for (`<select>`) throws as it is created, which the boundary reports
// as any crash in a render: the plugin learns it as an exception, the user as TS's crash toast.
#[test]
fn an_intrinsic_without_a_node_is_reported_as_a_crash() {
    let Some(config) = config() else { return };
    let (pipe, _log) = probe(config);
    toasts(&pipe);
    pipe.harness.tui.keymap.dispatch("v2probe.select", None);
    pipe.settle();
    assert_eq!(
        toasts(&pipe),
        ["Plugin: example.v2probe crashed in slot home.footer: <select> is not supported by opencode-native's JS host"]
    );
    assert_eq!(pipe.status(PROBE), Some(Status::Active));
}

// Expected: what the layer does not map warns once a plugin and feature, and does nothing; an API that answers whether
// it did answers false, as TS's `ui.panel.open` does outside a session.
#[test]
fn what_does_not_map_warns_once_and_answers_false() {
    let Some(config) = config() else { return };
    let (pipe, log) = probe(config);
    toasts(&pipe);
    for _ in 0..2 {
        pipe.harness.tui.keymap.dispatch("v2probe.unmapped", None);
        pipe.settle();
    }
    assert_eq!(toasts(&pipe), ["Plugin: example.v2probe: ui.dialog.show is not supported by opencode-native yet"]);
    assert_eq!(calls(&log), [json!({ "panel": false }), json!({ "panel": false })]);
    assert_eq!(pipe.status(PROBE), Some(Status::Active));
}

// Expected: `ui.dialog.select` shows the host's select, and its promise answers the value of the row picked, whatever
// value it was.
#[test]
fn a_select_answers_the_value_picked() {
    let Some(config) = config() else { return };
    let (pipe, log) = probe(config);
    pipe.harness.tui.keymap.dispatch("v2probe.pick", None);
    pipe.settle();
    let screen = pipe.harness.app.text();
    assert!(screen.contains("Pick one") && screen.contains("Second"), "{screen}");
    pipe.harness.app.press("down");
    pipe.harness.app.press("return");
    pipe.settle();
    assert_eq!(calls(&log), [json!({ "picked": { "n": 2 } })]);
}

// Expected (containment): a render that spins ends the JS host by the progress rule; the plugin fails, named, and the
// JS host starts again for the others.
#[test]
fn a_v2_render_that_spins_fails_its_plugin_alone() {
    let Some(mut config) = config() else { return };
    config.limits.ack = Duration::from_millis(500);
    let (pipe, _log) = probe(config);
    let pid = pipe.scripts().pid().unwrap();
    pipe.harness.tui.keymap.dispatch("v2probe.loop", None);
    pipe.harness.wait("the spin ended the JS host", || {
        pipe.harness.app.advance(Duration::from_millis(1));
        matches!(pipe.status(PROBE), Some(Status::Failed(_)))
    });
    let Some(Status::Failed(error)) = pipe.status(PROBE) else { unreachable!() };
    assert!(error.contains("ended the JS host"), "{error}");
    assert_ne!(pipe.scripts().pid(), Some(pid));
}

// Expected (containment): a plugin that floods the host with toasts from a timer fails, though no call of it ran, and
// alone.
#[test]
fn a_v2_plugin_that_floods_fails_alone() {
    let Some(config) = config() else { return };
    let log = log_file();
    let options = json!({ "log": log.to_string_lossy() });
    let pipe = open(&[("v2probe", Some(options)), ("twin", None)], config, (80, 30));
    pipe.active(PROBE);
    pipe.active("example.twin");
    pipe.harness.tui.keymap.dispatch("v2probe.flood", None);
    pipe.settle();
    // The UI thread takes nothing while the flood comes.
    std::thread::sleep(Duration::from_millis(1500));
    pipe.harness.wait("the flood ended the JS host", || {
        pipe.harness.app.advance(Duration::from_millis(1));
        matches!(pipe.status(PROBE), Some(Status::Failed(_)))
    });
    pipe.settle();
    let Some(Status::Failed(error)) = pipe.status(PROBE) else { unreachable!() };
    assert!(error.contains("flooded the host with effects"), "{error}");
    assert_eq!(pipe.status("example.twin"), Some(Status::Active));
}

// Expected (O-146): a project's V2 plugin waits for approval: none of its module runs before (its import writes a
// line), and once approved it loads, sets up and draws.
#[test]
fn a_project_v2_plugin_waits_for_approval() {
    let Some(config) = config() else { return };
    let root = opencode_util::temp::tempdir().unwrap();
    let work = root.path().join("work");
    std::fs::create_dir_all(work.join(".git")).unwrap();
    let dir = work.join(".opencode/plugins/v2probe");
    copy(&Path::new(EXAMPLES).join("v2probe"), &dir);
    let marker = dir.parent().unwrap().join(".v2probe.log.jsonl");
    let harness = support::mount(80, 30, Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) });
    let external = External { config_dir: root.path().join("config"), cwd: work, dev: Vec::new() };
    external_with(&harness.tui, external, Some(config));
    let pipe = Pipe { harness, root };
    pipe.settle();
    let target = dir.to_string_lossy().into_owned();
    assert_eq!(footer(&pipe), "", "it drew before approval");
    assert!(!marker.exists(), "the module ran before approval");
    let tui = &pipe.harness.tui;
    let Some((Ok(artifact), _)) = opencode_tui::plugins::host::held(tui, &target) else { panic!("nothing is held") };
    assert!(artifact.script, "{artifact:?}");
    opencode_tui::plugins::host::decide(tui, &target, &artifact, Decision::Approved).unwrap();
    pipe.active(PROBE);
    pipe.settle();
    assert!(marker.exists(), "the approved module did not run");
    assert_eq!(footer(&pipe), "v2probe 0:");
}

/// The JS host's resident set and the carrier's own time on the UI thread, for the report (P8's measure): three
/// published packages loaded unmodified, each drawing, over a fake server. Not a gate; run with `--ignored`.
#[test]
#[ignore]
fn measure_the_three_npm_plugins() {
    let Some(config) = config() else { return };
    let root = opencode_util::temp::tempdir().unwrap();
    let plugins = root.path().join("config/plugins");
    for name in ["opencode-subagents-sidebar", "@mynameistito/opencode-force-input", "opencode-session-usage"] {
        crate::ports::unpack(name, &plugins.join(name.replace('/', "__")));
    }
    let _ = pipe::crossed();
    let deps = Deps { route: support::session_route("ses_p"), ..support::deps(Arc::new(support::empty())) };
    let harness = support::mount(160, 40, deps);
    let external = External { config_dir: root.path().join("config"), cwd: root.path().to_path_buf(), dev: Vec::new() };
    external_with(&harness.tui, external, Some(config));
    let pipe = Pipe { harness, root };
    for id in ["subagents-sidebar", "mynameistito.opencode-force-input", "opencode.sidebar.limit"] {
        pipe.active(id);
    }
    pipe.settle();
    let resident = pipe.scripts().resident().unwrap_or_default();
    let before = pipe::crossed();
    let frames = 200;
    let begun = std::time::Instant::now();
    for _ in 0..frames {
        pipe.harness.app.advance(Duration::from_millis(16));
    }
    let wall = begun.elapsed();
    let after = pipe::crossed();
    eprintln!(
        "three npm plugins: JS host resident {} KiB; {frames} idle frames: carrier time {:?} ({:?} a frame), wall {:?}",
        resident >> 10,
        after.host - before.host,
        (after.host - before.host) / frames,
        wall / frames,
    );
}
