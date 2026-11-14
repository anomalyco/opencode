//! The V2 compatibility layer (P8): today's `{ id, setup }` TUI plugins, with JSX over OpenTUI's intrinsics, on the JS
//! host. The probe is `crates/plugin/examples/pipe/v2probe/tui.tsx`, written against `@opencode/plugin/tui` as an npm
//! plugin is; the three published packages are compared with their native ports in `ports.rs`, and with TS cell for cell
//! in P-APP (`parity/scenarios/P.8`); `ports::measure_the_three_npm_plugins` measures them. Every row skips without
//! Bun, unless `OPENCODE_RS_REQUIRE_TS=1`.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use opencode_plugin::Status;
use opencode_plugin::loader::approval::Decision;
use opencode_plugin::pipe::{Config, Fault};
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
    drawn(&pipe);
    (pipe, log)
}

/// Waits until the probe's claims that read the host drew. A first render that read what the host has not pushed
/// waits for it without the JS host saying so to a ping (its mount is neither dirty nor in flight), so they may draw
/// after a settle.
fn drawn(pipe: &Pipe) {
    pipe.harness.wait("the probe's claims drew", || {
        pipe.harness.app.advance(Duration::from_millis(1));
        line(pipe, "v2probe commands").is_some() && line(pipe, "v2probe route").is_some()
    });
    pipe.settle();
}

/// A call log of this test's own, empty.
fn log_file() -> PathBuf {
    let log =
        std::env::temp_dir().join(format!("v2probe-{}-{:?}.log", std::process::id(), std::thread::current().id()));
    let _ = std::fs::remove_file(&log);
    log
}

/// What the probe logged, in order, without its setups.
fn calls(log: &Path) -> Vec<Value> {
    let text = std::fs::read_to_string(log).unwrap_or_default();
    text.lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .filter(|call: &Value| call.get("setup").is_none())
        .collect()
}

/// [`calls`] once there are `count`: a plugin's code after an answer it awaited runs some promise turns after the call
/// that answered it, which a settle's ping may pass.
fn logged(pipe: &Pipe, log: &Path, count: usize) -> Vec<Value> {
    pipe.harness.wait(&format!("{count} calls logged"), || {
        pipe.harness.app.advance(Duration::from_millis(1));
        calls(log).len() >= count
    });
    calls(log)
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

/// The probe's list in its home footer claim: `v2probe <count>: <items>|`.
fn footer(pipe: &Pipe) -> String {
    let text = pipe.harness.app.text();
    let listed =
        |line: &&str| line.strip_prefix("v2probe ").is_some_and(|rest| rest.starts_with(|c: char| c.is_ascii_digit()));
    text.lines().map(str::trim).find(listed).unwrap_or_default().to_owned()
}

/// The first line of the screen that starts with `prefix`, trimmed.
fn line(pipe: &Pipe, prefix: &str) -> Option<String> {
    pipe.harness.app.text().lines().map(str::trim).find(|line| line.starts_with(prefix)).map(str::to_owned)
}

// Expected (`delivery` for the V2 layer): commands a V2 plugin registers with `keymap.layer` reach its handlers once each
// and in order, through the pipe's fault operators too (a drop or a swap ends the JS host, which a restart follows),
// and its JSX shows what they did once the JS host settled.
#[test]
fn a_v2_plugins_commands_arrive_once_each_in_order() {
    let Some(config) = config() else { return };
    let (pipe, log) = probe(config);
    assert_eq!(footer(&pipe), "v2probe 0: |");
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
    assert!(shown.starts_with("v2probe ") && shown.ends_with("33|"), "{shown}");
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
    // The toasts each use shows: the host shows one at a time.
    let shown: Vec<Vec<String>> = (0..2)
        .map(|_| {
            pipe.harness.tui.keymap.dispatch("v2probe.unmapped", None);
            pipe.settle();
            toasts(&pipe)
        })
        .collect();
    let warning = "Plugin: example.v2probe: markdown.registerCodeBlockRenderer is not supported by opencode-native yet";
    assert_eq!(shown, [vec![warning.to_owned()], vec![]]);
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
    assert_eq!(logged(&pipe, &log, 1), [json!({ "picked": { "n": 2 } })]);
}

// Expected (the audit's most used dialogs): `confirm`, `prompt` and `alert` show the host's dialogs, and each promise
// answers what the user did there.
#[test]
fn confirm_prompt_and_alert_answer_their_promises() {
    let Some(config) = config() else { return };
    let (pipe, log) = probe(config);
    let app = &pipe.harness.app;
    // Each next dialog opens in the plugin's code after the answer it awaited, some promise turns after the answer.
    let shows = |text: &str| {
        pipe.harness.wait(text, || {
            app.advance(Duration::from_millis(1));
            app.text().contains(text)
        })
    };
    pipe.harness.tui.keymap.dispatch("v2probe.ask", None);
    shows("Go on?");
    app.press("return");
    shows("Name it");
    app.type_text("abc");
    app.press("return");
    shows("It told.");
    app.press("return");
    pipe.settle();
    let expected = [json!({ "confirmed": true }), json!({ "prompted": "abc" }), json!({ "alerted": true })];
    assert_eq!(logged(&pipe, &log, expected.len()), expected);
}

// Expected (the audit's most used layout): a plugin's route draws its bordered, titled box with its padding, the data
// its navigation gave, and a scroll the wheel moves.
#[test]
fn a_route_draws_a_bordered_box_and_a_scroll_with_its_data() {
    let Some(config) = config() else { return };
    let (pipe, _log) = probe(config);
    pipe.harness.tui.keymap.dispatch("v2probe.page", None);
    pipe.settle();
    // The page registers a command as it renders: the reload that makes remounts it once the command's 250 ms passed.
    std::thread::sleep(Duration::from_millis(400));
    pipe.settle();
    assert_eq!(pipe.status(PROBE), Some(Status::Active));
    let screen = pipe.harness.app.text();
    assert_eq!(pipe.harness.tui.route(), Route::Plugin { id: PROBE.to_owned(), name: "page".to_owned() });
    assert!(screen.contains("╭─Page") && screen.contains("data n=3"), "{screen}");
    assert!(screen.contains("line 4") && !screen.contains("line 9"), "{screen}");
    let (x, y) = pipe.harness.find("line 2");
    for _ in 0..5 {
        pipe.harness.app.scroll(x, y, true);
    }
    pipe.settle();
    let screen = pipe.harness.app.text();
    assert!(screen.contains("line 9") && !screen.contains("line 0"), "{screen}");
}

// Expected (OpenTUI's reconciler as TS runs it): a node with `visible={false}` draws nothing; a span takes its `style`
// and `href` alone, so its `fg` prop leaves it in the text's color; a claim of a path the host does not publish goes to
// its nearest published ancestor, appended, so a `replace` there replaces nothing; a read an installed package's JSX makes once, as it mounts, shows the
// host's value, which came after that render; and text outside a `<text>` crashes the render as OpenTUI's does.
#[test]
fn a_render_draws_by_the_reconcilers_rules() {
    let Some(config) = config() else { return };
    let (pipe, _log) = probe(config);
    let screen = pipe.harness.app.text();
    assert!(!screen.contains("hidden text"), "{screen}");
    assert_eq!(line(&pipe, "v2probe degraded").as_deref(), Some("v2probe degraded claim"), "{screen}");
    // The degraded `replace` replaced nothing: the footer's own version is still there.
    assert!(screen.lines().any(|line| line.trim() == "local"), "{screen}");
    assert_eq!(line(&pipe, "v2probe commands").as_deref(), Some("v2probe commands true"), "{screen}");
    let (x, y) = pipe.harness.find("0: |");
    let cell = pipe.harness.app.render().cell(u32::from(x + 3), u32::from(y)).unwrap().fg;
    assert_eq!(cell, pipe.harness.tui.page().text.muted, "a span took its fg prop");
    toasts(&pipe);
    pipe.harness.tui.keymap.dispatch("v2probe.bare", None);
    pipe.settle();
    let shown = toasts(&pipe);
    let crash = "Plugin: example.v2probe crashed in slot home.footer: Orphan text error: \"bare words\"";
    assert!(shown.len() == 1 && shown[0].starts_with(crash), "{shown:?}");
    assert_eq!(pipe.status(PROBE), Some(Status::Active));
}

// Expected: a theme change restyles a node colored from the context's theme without the plugin's render running again
// (its colors carry their token), and the theme the plugin reads after it is the new one.
#[test]
fn a_theme_change_restyles_the_render_and_reaches_the_theme() {
    let Some(config) = config() else { return };
    let (pipe, _log) = probe(config);
    let tui = &pipe.harness.tui;
    let fg = || {
        let (x, y) = pipe.harness.find("v2probe 0");
        pipe.harness.app.render().cell(u32::from(x), u32::from(y)).unwrap().fg
    };
    assert_eq!(fg(), tui.page().text.muted);
    let before = tui.page().text.muted;
    tui.theme.borrow_mut().set("tokyonight");
    tui.theme_changed();
    pipe.settle();
    let muted = tui.page().text.muted;
    assert_ne!(muted, before, "the theme did not change the color");
    assert_eq!(fg(), muted);
    toasts(&pipe);
    tui.keymap.dispatch("v2probe.color", None);
    pipe.settle();
    assert_eq!(toasts(&pipe), [format!("#{:02x}{:02x}{:02x}", muted.r, muted.g, muted.b)]);
}

// Expected: a dialog another one replaces answers nothing (`undefined`), as TS's does; the second answers its pick.
#[test]
fn a_replaced_dialog_answers_nothing() {
    let Some(config) = config() else { return };
    let (pipe, log) = probe(config);
    for _ in 0..2 {
        pipe.harness.tui.keymap.dispatch("v2probe.pick", None);
        pipe.settle();
    }
    pipe.harness.app.press("return");
    pipe.settle();
    assert_eq!(logged(&pipe, &log, 2), [json!({ "picked": null }), json!({ "picked": { "n": 1 } })]);
}

// Expected (`ui.dialog.show`, the audit's most common gap): the plugin's own JSX shows in the host's panel dialog and
// follows its signals, a click in it runs its handler, and escape closes it and calls `onClose`, as `dialog.clear()`
// does.
#[test]
fn a_dialog_of_its_own_shows_its_jsx_and_closes() {
    let Some(config) = config() else { return };
    let (pipe, log) = probe(config);
    let tui = &pipe.harness.tui;
    tui.keymap.dispatch("v2probe.show", None);
    pipe.settle();
    let screen = pipe.harness.app.text();
    assert!(screen.contains("Own dialog") && screen.contains("shown 0"), "{screen}");
    let (x, y) = pipe.harness.find("bump it");
    pipe.harness.app.click(x, y);
    // The layer sends the changed dialog in a microtask after the click's handler.
    pipe.harness.wait("the dialog follows its signal", || {
        pipe.harness.app.advance(Duration::from_millis(1));
        pipe.harness.app.text().contains("shown 1")
    });
    pipe.harness.app.press("escape");
    pipe.settle();
    assert!(!pipe.harness.app.text().contains("Own dialog"), "{}", pipe.harness.app.text());
    assert_eq!(logged(&pipe, &log, 1), [json!({ "closed": true })]);
    tui.keymap.dispatch("v2probe.show", None);
    pipe.settle();
    tui.keymap.dispatch("v2probe.unshow", None);
    pipe.settle();
    assert!(!pipe.harness.app.text().contains("Own dialog"), "{}", pipe.harness.app.text());
    assert_eq!(logged(&pipe, &log, 2), [json!({ "closed": true }), json!({ "closed": true })]);
}

// Expected: a command a component registers (the page's, after setup) runs while the component is mounted, though
// registering it reloaded the plugin's registrations, and goes once the component left; the reload settles (nothing
// more crosses while the page stays), and the reads the plugin watched before it follow navigation after it.
#[test]
fn a_components_command_lives_with_its_mount_across_a_reload() {
    let Some(config) = config() else { return };
    let (pipe, log) = probe(config);
    let tui = &pipe.harness.tui;
    assert_eq!(line(&pipe, "v2probe route").as_deref(), Some("v2probe route home"));
    tui.keymap.dispatch("v2probe.page", None);
    pipe.settle();
    // The reload the page's command made, and the remount after it, settle within the 250 ms a command lingers.
    std::thread::sleep(Duration::from_millis(400));
    pipe.settle();
    let quiet = opencode_plugin::pipe::crossed();
    std::thread::sleep(Duration::from_millis(400));
    for _ in 0..5 {
        pipe.harness.app.advance(Duration::from_millis(16));
    }
    let after = opencode_plugin::pipe::crossed();
    assert_eq!((after.received, after.trees), (quiet.received, quiet.trees), "the reload did not settle");
    assert!(matches!(tui.keymap.dispatch("v2probe.onpage", None), opentui::keymap::RunResult::Ok));
    pipe.settle();
    assert_eq!(calls(&log), [json!({ "onpage": true })]);
    tui.keymap.dispatch("v2probe.home", None);
    pipe.settle();
    assert_eq!(line(&pipe, "v2probe route").as_deref(), Some("v2probe route home"));
    tui.keymap.dispatch("v2probe.page", None);
    pipe.settle();
    let screen = pipe.harness.app.text();
    assert!(screen.contains("v2probe route plugin"), "the route read did not follow after the reload:\n{screen}");
    tui.keymap.dispatch("v2probe.home", None);
    pipe.settle();
    // The command outlives its mount by 250 ms of the JS host's time.
    std::thread::sleep(Duration::from_millis(400));
    pipe.settle();
    assert!(!matches!(tui.keymap.dispatch("v2probe.onpage", None), opentui::keymap::RunResult::Ok), "it stayed");
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
    drawn(&pipe);
    assert_eq!(footer(&pipe), "v2probe 0: |");
}
