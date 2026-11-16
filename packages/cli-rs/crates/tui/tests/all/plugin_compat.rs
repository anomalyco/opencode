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
    // The last item shows; a restart resets the plugin's state, as it resets any plugin's on the JS host. The restarted
    // footer's first render waits for its reads, which a settle does not (`drawn`).
    pipe.harness.wait("the restarted footer drew", || {
        pipe.harness.app.advance(Duration::from_millis(1));
        footer(&pipe).ends_with("33|")
    });
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
// and `href` alone, so its `fg` prop leaves it in the text's color; a `replace` of a path the host does not publish shows
// nowhere, as TS's never degrades; a read an installed package's JSX makes once, as it mounts, shows the host's value,
// which came after that render; and text outside a `<text>` crashes the render as OpenTUI's does.
#[test]
fn a_render_draws_by_the_reconcilers_rules() {
    let Some(config) = config() else { return };
    let (pipe, _log) = probe(config);
    let screen = pipe.harness.app.text();
    assert!(!screen.contains("hidden text"), "{screen}");
    // A `replace` of a path the host does not publish never degrades (TS `structure.ts`, carbon-4): it shows nowhere,
    // and the footer's own version is still there.
    assert_eq!(line(&pipe, "v2probe missing"), None, "{screen}");
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
    // A command of the base mode runs nothing while the dialog has the keyboard (bigboi P8-4).
    tui.keymap.dispatch("v2probe.base", None);
    pipe.settle();
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
    tui.keymap.dispatch("v2probe.base", None);
    assert_eq!(logged(&pipe, &log, 2), [json!({ "closed": true }), json!({ "base": true })]);
    tui.keymap.dispatch("v2probe.show", None);
    pipe.settle();
    tui.keymap.dispatch("v2probe.unshow", None);
    pipe.settle();
    assert!(!pipe.harness.app.text().contains("Own dialog"), "{}", pipe.harness.app.text());
    assert_eq!(logged(&pipe, &log, 3), [json!({ "closed": true }), json!({ "base": true }), json!({ "closed": true })]);
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
    // Right after the page left, its command runs nothing (bigboi P8-4), though the host lists it 250 ms longer.
    tui.keymap.dispatch("v2probe.onpage", None);
    pipe.settle();
    assert_eq!(calls(&log), [json!({ "onpage": true })], "the page's command ran after the page left");
    std::thread::sleep(Duration::from_millis(400));
    pipe.settle();
    assert!(!matches!(tui.keymap.dispatch("v2probe.onpage", None), opentui::keymap::RunResult::Ok), "it stayed");
}

// Expected (carbon-5): a handler of an activation a reload ended that rejects late fails nothing: the reloaded plugin
// stays active.
#[test]
fn a_late_rejection_of_a_reloaded_plugin_fails_nothing() {
    let Some(config) = config() else { return };
    let (pipe, _log) = probe(config);
    let tui = &pipe.harness.tui;
    tui.keymap.dispatch("v2probe.reject", None);
    pipe.settle();
    let file = pipe.root.path().join("config/plugins/v2probe/tui.tsx");
    let source = std::fs::read_to_string(&file).unwrap();
    std::fs::write(&file, format!("{source}\n// reloaded\n")).unwrap();
    opencode_tui::plugins::host::reconcile(tui);
    pipe.settle();
    std::thread::sleep(Duration::from_millis(600));
    pipe.settle();
    assert_eq!(pipe.status(PROBE), Some(Status::Active));
}

// Expected (carbon-2): a store a plugin makes after its setup takes its first write, which the host stores, rather than
// refusing it as a key the plugin's manifest does not list yet.
#[test]
fn a_store_made_after_setup_takes_its_first_write() {
    let Some(config) = config() else { return };
    let (pipe, log) = probe(config);
    pipe.harness.tui.keymap.dispatch("v2probe.late", None);
    assert_eq!(logged(&pipe, &log, 1), [json!({ "stored": true })]);
    let host = opencode_tui::plugins::host::host(&pipe.harness.tui);
    let stored = opencode_plugin::Host::storage_read(&*host, "plugin.example.v2probe.late");
    assert_eq!(stored.and_then(|text| serde_json::from_str::<Value>(&text).ok()), Some(json!({ "count": 42 })));
}

// Expected (carbon-2): two reloads of a plugin's registrations that both come before the host took the first leave the
// plugin working: the commands of both run.
#[test]
fn two_quick_reloads_leave_the_plugin_working() {
    let Some(config) = config() else { return };
    let (pipe, log) = probe(config);
    let tui = &pipe.harness.tui;
    tui.keymap.dispatch("v2probe.twice", None);
    // Both reloads wait for the UI thread, which takes them in one go.
    std::thread::sleep(Duration::from_millis(300));
    pipe.settle();
    for name in ["v2probe.first", "v2probe.second"] {
        tui.keymap.dispatch(name, None);
        pipe.settle();
    }
    assert_eq!(logged(&pipe, &log, 2), [json!({ "ran": "v2probe.first" }), json!({ "ran": "v2probe.second" })]);
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
    let (pipe, dir, marker) = project(&[], config);
    assert_eq!(footer(&pipe), "", "it drew before approval");
    assert!(!marker.exists(), "the module ran before approval");
    approve(&pipe, &dir);
    pipe.active(PROBE);
    pipe.settle();
    assert!(marker.exists(), "the approved module did not run");
    drawn(&pipe);
    assert_eq!(footer(&pipe), "v2probe 0: |");
}

// Expected (bigboi P8-1): what runs is what was approved. A save between the approval and the JS host's import (here
// while the JS host is busy with another plugin's command) runs neither the saved module nor its setup: the approved
// files run, and the saved ones wait for a decision of their own. The approval stages the approved copy off the UI
// thread and only then sends its load (js-followups), so the save waits for that load: one that came before it would
// change the files before they were copied, and the approved build would never load (the saved one is held instead).
// Without this wait the race lost 7 of 40 runs under load with jsnpm-3 and 6 of 40 without it.
#[test]
fn a_save_after_approval_runs_nothing_unapproved() {
    let Some(config) = config() else { return };
    let (pipe, dir, marker) = project(&["probe"], config);
    pipe.active("example.probe");
    let tui = &pipe.harness.tui;
    tui.keymap.dispatch("probe.hold", Some("1500"));
    approve(&pipe, &dir);
    let target = dir.to_string_lossy().into_owned();
    // Turns of the UI only, not the JS host's settle: the host is in the hold, which the save is to come before. On a
    // machine slow enough for the hold to end first, the approved module may have run already.
    pipe.harness.wait("the approved copy's load is sent", || {
        crate::plugin_pipe::turn(&pipe.harness);
        pipe.scripts().loading(&target) || marker.exists()
    });
    let file = dir.join("tui.tsx");
    let source = std::fs::read_to_string(&file).unwrap();
    std::fs::write(&file, source.replace("const MODULE = true", "const MODULE = \"saved\"")).unwrap();
    pipe.settle();
    opencode_tui::plugins::host::reconcile(tui);
    pipe.settle();
    let ran = std::fs::read_to_string(&marker).unwrap_or_default();
    let ran: Vec<&str> = ran.lines().collect();
    assert!(!ran.iter().any(|line| line.contains("saved")), "an unapproved module ran: {ran:?}");
    assert_eq!(ran, [r#"{"module":true}"#], "the approved module did not run once");
    assert_eq!(listed(&pipe, &dir, PROBE), Some(Status::Pending));
}

// Expected (bigboi P8-1, js-followups): a save after the approval but before the approved files are copied, which
// happens off the UI thread, runs nothing: the copy is refused as the files changed since they were approved, the
// approved module never runs, and the saved build waits for a decision of its own; approved, it runs. This is the race
// `a_save_after_approval_runs_nothing_unapproved` lost under load before it waited for the load, made certain by
// holding the copy until the save is made.
#[test]
fn a_save_before_the_approved_copy_runs_nothing() {
    let Some(config) = config() else { return };
    let (pipe, dir, marker) = project(&[], config);
    let tui = &pipe.harness.tui;
    let target = dir.to_string_lossy().into_owned();
    let Some((Ok(shown), _)) = opencode_tui::plugins::host::held(tui, &target) else { panic!("nothing is held") };
    pipe.scripts().pause_stages(true);
    assert_eq!(crate::plugin_pipe::decide(&pipe.harness, &target, &shown, Decision::Approved), Ok(true));
    let file = dir.join("tui.tsx");
    let source = std::fs::read_to_string(&file).unwrap();
    std::fs::write(&file, source.replace("const MODULE = true", "const MODULE = \"saved\"")).unwrap();
    pipe.scripts().pause_stages(false);
    pipe.harness.wait("the saved build is held", || {
        pipe.settle();
        matches!(opencode_tui::plugins::host::held(tui, &target), Some((Ok(held), _)) if held.sha256 != shown.sha256)
    });
    assert_eq!(std::fs::read_to_string(&marker).unwrap_or_default(), "", "a module ran before its approval");
    assert_eq!(listed(&pipe, &dir, PROBE), Some(Status::Pending));
    approve(&pipe, &dir);
    pipe.active(PROBE);
    let ran = std::fs::read_to_string(&marker).unwrap();
    assert_eq!(ran.lines().collect::<Vec<_>>(), [r#"{"module":"saved"}"#]);
}

/// The status of the project plugin `dir`: listed by its directory until it loads, then by `id`.
fn listed(pipe: &Pipe, dir: &Path, id: &str) -> Option<Status> {
    let target = dir.to_string_lossy();
    let entries = pipe.harness.tui.plugins.entries().into_iter();
    entries.filter(|entry| entry.id == target || entry.id == id).map(|entry| entry.status).next()
}

// Expected (bigboi P8-1): a project plugin's approved files import only from among themselves, the layer's modules and
// the runtime's: a module outside them is refused before it runs, and the plugin fails, saying why.
#[test]
fn a_project_plugin_imports_nothing_outside_its_approved_files() {
    let Some(config) = config() else { return };
    let root = opencode_util::temp::tempdir().unwrap();
    let work = root.path().join("work");
    let dir = work.join(".opencode").join("plugins").join("reach");
    std::fs::create_dir_all(work.join(".git")).unwrap();
    std::fs::create_dir_all(&dir).unwrap();
    let marker = root.path().join("outside.ran");
    let shared = format!("require(\"node:fs\").writeFileSync({:?}, \"ran\")\nexport const note = 1\n", marker);
    let outside = work.join(".opencode/shared.ts");
    std::fs::write(&outside, shared).unwrap();
    // By its absolute path, which resolves wherever the importing file is.
    let module = format!(
        "import {{ note }} from {outside:?}\nexport default {{ id: \"example.reach\", setup() {{ void note }} }}\n"
    );
    std::fs::write(dir.join("tui.ts"), module).unwrap();
    let harness = support::mount(80, 30, Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) });
    let external = External { config_dir: root.path().join("config"), cwd: work, dev: Vec::new() };
    external_with(&harness.tui, external, Some(config));
    let pipe = Pipe { harness, root };
    pipe.settle();
    approve(&pipe, &dir);
    pipe.settle();
    assert!(!marker.exists(), "a module outside the approved files ran");
    let status = listed(&pipe, &dir, "example.reach");
    let refused =
        matches!(&status, Some(Status::Failed(error)) if error.contains("outside the plugin's approved files"));
    assert!(refused, "{status:?}");
}

// Expected (carbon jsnpm-3): an approved project plugin's `package.json` `name` cannot lead its TUI module out of the
// approved files: a name that climbs out of its staged copy with `../`, or an absolute one, names a module the user
// never approved, which runs nowhere, and the plugin fails saying why; a direct relative import out of it is still
// refused.
#[cfg(unix)]
#[test]
fn a_project_plugins_package_name_cannot_lead_out_of_its_approved_files() {
    let Some(config) = config() else { return };
    let root = opencode_util::temp::tempdir().unwrap();
    let work = root.path().join("work");
    std::fs::create_dir_all(work.join(".git")).unwrap();
    let unapproved = work.join("unapproved");
    std::fs::create_dir_all(&unapproved).unwrap();
    let marker = root.path().join("unapproved.ran");
    let module = format!(
        "require(\"node:fs\").appendFileSync({marker:?}, \"ran\\n\")\nexport default {{ id: \"example.out\", setup() {{}} }}\n"
    );
    std::fs::write(unapproved.join("tui.ts"), &module).unwrap();
    std::fs::write(unapproved.join("helper.ts"), "export const helper = 1\n").unwrap();
    // Up to `/` from wherever the copy is staged, then down to the unapproved directory.
    let climb = format!("{}{}", "../".repeat(40), unapproved.to_string_lossy().trim_start_matches('/'));
    let plugins = work.join(".opencode").join("plugins");
    let named = |name: &str, folder: &str| {
        let dir = plugins.join(folder);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("package.json"), serde_json::json!({ "name": name, "exports": {} }).to_string())
            .unwrap();
        dir
    };
    let climbing = named(&climb, "climb");
    let absolute = named(&unapproved.to_string_lossy(), "absolute");
    let relative = plugins.join("relative");
    std::fs::create_dir_all(&relative).unwrap();
    let import = format!("import {{ helper }} from {:?}\n", format!("{climb}/helper.ts"));
    std::fs::write(
        relative.join("tui.ts"),
        format!("{import}export default {{ id: \"example.relative\", setup() {{ void helper }} }}\n"),
    )
    .unwrap();
    let harness = support::mount(80, 30, Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) });
    let external = External { config_dir: root.path().join("config"), cwd: work, dev: Vec::new() };
    external_with(&harness.tui, external, Some(config));
    let pipe = Pipe { harness, root };
    pipe.settle();
    for dir in [&climbing, &absolute, &relative] {
        approve(&pipe, dir);
    }
    pipe.settle();
    for (dir, why) in [
        (&climbing, "outside the plugin's approved files"),
        (&absolute, "outside the plugin's approved files"),
        (&relative, "outside the plugin's approved files"),
    ] {
        pipe.harness.wait("the plugin failed", || {
            pipe.settle();
            matches!(listed(&pipe, dir, ""), Some(Status::Failed(_)))
        });
        let status = listed(&pipe, dir, "");
        assert!(matches!(&status, Some(Status::Failed(error)) if error.contains(why)), "{dir:?}: {status:?}");
    }
    assert!(!marker.exists(), "a module outside the approved files ran");
}

// Expected (carbon jsnpm-3): a global plugin, which is not confined, also loads only a TUI module among its own files: a
// `package.json` `name` that leads elsewhere fails the plugin, and the module it names runs nowhere.
#[cfg(unix)]
#[test]
fn a_global_plugins_package_name_cannot_lead_out_of_its_directory() {
    let Some(config) = config() else { return };
    let root = opencode_util::temp::tempdir().unwrap();
    let elsewhere = root.path().join("elsewhere");
    std::fs::create_dir_all(&elsewhere).unwrap();
    let marker = root.path().join("elsewhere.ran");
    let module = format!(
        "require(\"node:fs\").appendFileSync({marker:?}, \"ran\\n\")\nexport default {{ id: \"example.away\", setup() {{}} }}\n"
    );
    std::fs::write(elsewhere.join("tui.ts"), module).unwrap();
    let dir = root.path().join("config").join("plugins").join("away");
    std::fs::create_dir_all(&dir).unwrap();
    let name = format!("{}{}", "../".repeat(40), elsewhere.to_string_lossy().trim_start_matches('/'));
    std::fs::write(dir.join("package.json"), serde_json::json!({ "name": name, "exports": {} }).to_string()).unwrap();
    let harness = support::mount(80, 30, Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) });
    let work = root.path().join("work");
    std::fs::create_dir_all(&work).unwrap();
    let external = External { config_dir: root.path().join("config"), cwd: work, dev: Vec::new() };
    external_with(&harness.tui, external, Some(config));
    let pipe = Pipe { harness, root };
    pipe.harness.wait("the plugin failed", || {
        pipe.settle();
        matches!(listed(&pipe, &dir, ""), Some(Status::Failed(_)))
    });
    let status = listed(&pipe, &dir, "");
    let refused = matches!(&status, Some(Status::Failed(error)) if error.contains("outside the plugin's directory"));
    assert!(refused, "{status:?}");
    assert!(!marker.exists(), "a module outside the plugin's directory ran");
}

// Expected (FT-3): a project plugin's approved files import one another by relative paths, from its root and from a
// directory below it, as TS loads them.
#[test]
fn a_project_plugin_imports_its_own_files_by_relative_paths() {
    let Some(config) = config() else { return };
    let root = opencode_util::temp::tempdir().unwrap();
    let work = root.path().join("work");
    let dir = work.join(".opencode").join("plugins").join("near");
    std::fs::create_dir_all(work.join(".git")).unwrap();
    std::fs::create_dir_all(dir.join("dist/lib")).unwrap();
    std::fs::write(
        dir.join("package.json"),
        r#"{ "name": "near", "type": "module", "exports": { "./tui": "./dist/tui.js" } }"#,
    )
    .unwrap();
    let marker = root.path().join("near.ran");
    let module = format!(
        "import {{ note }} from \"./lib/view.js\"\nexport default {{ id: \"example.near\", setup() {{ require(\"node:fs\").writeFileSync({marker:?}, note) }} }}\n"
    );
    std::fs::write(dir.join("dist/tui.js"), module).unwrap();
    std::fs::write(dir.join("dist/lib/view.js"), "import { part } from \"../part.js\"\nexport const note = part\n")
        .unwrap();
    std::fs::write(dir.join("dist/part.js"), "export const part = \"near\"\n").unwrap();
    let harness = support::mount(80, 30, Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) });
    let external = External { config_dir: root.path().join("config"), cwd: work, dev: Vec::new() };
    external_with(&harness.tui, external, Some(config));
    let pipe = Pipe { harness, root };
    pipe.settle();
    approve(&pipe, &dir);
    pipe.active("example.near");
    assert_eq!(std::fs::read_to_string(&marker).ok().as_deref(), Some("near"));
}

// Expected (bigboi P8-1, FT-2): what runs is what was approved, also when a dependency's file changes after the
// approval without changing what the walk off the UI thread stamps (its size and time kept): a new JS host sets the
// plugin up again from the approved copy, and the changed file runs nowhere.
#[test]
fn a_dependency_changed_after_approval_runs_nothing_unapproved() {
    let Some(config) = config() else { return };
    let root = opencode_util::temp::tempdir().unwrap();
    let work = root.path().join("work");
    let dir = work.join(".opencode").join("plugins").join("deps");
    std::fs::create_dir_all(work.join(".git")).unwrap();
    std::fs::create_dir_all(dir.join("node_modules/dep")).unwrap();
    std::fs::write(dir.join("node_modules/dep/package.json"), r#"{ "name": "dep", "main": "index.js" }"#).unwrap();
    let dep = dir.join("node_modules/dep/index.js");
    std::fs::write(&dep, "export const made = \"approved\"\n").unwrap();
    let marker = root.path().join("deps.ran");
    let module = format!(
        "import {{ made }} from \"dep\"\nexport default {{ id: \"example.deps\", setup() {{ require(\"node:fs\").appendFileSync({marker:?}, made + \"\\n\") }} }}\n"
    );
    std::fs::write(dir.join("tui.ts"), module).unwrap();
    let harness = support::mount(80, 30, Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) });
    let external = External { config_dir: root.path().join("config"), cwd: work, dev: Vec::new() };
    external_with(&harness.tui, external, Some(config));
    let pipe = Pipe { harness, root };
    pipe.settle();
    approve(&pipe, &dir);
    pipe.active("example.deps");
    // Past the time a recent change makes the stamp racy, which would hash the tree again and hold the plugin back.
    std::thread::sleep(Duration::from_millis(2100));
    let modified = std::fs::metadata(&dep).unwrap().modified().unwrap();
    std::fs::write(&dep, "export const made = \"replaced\"\n").unwrap();
    std::fs::File::options().write(true).open(&dep).unwrap().set_modified(modified).unwrap();
    opencode_tui::plugins::host::reconcile(&pipe.harness.tui);
    pipe.settle();
    pipe.scripts().kill();
    pipe.harness.wait("the plugin was set up again", || {
        pipe.harness.app.advance(Duration::from_millis(1));
        std::fs::read_to_string(&marker).unwrap_or_default().lines().count() == 2
    });
    assert_eq!(std::fs::read_to_string(&marker).unwrap(), "approved\napproved\n");
}

// Expected (FT-5): a plugin that imports OpenTUI's renderable classes and enums by name links and sets up, as in TS,
// where Bun failed its module for a name the layer did not export; a class it extends constructs.
#[test]
fn a_plugin_importing_opentuis_classes_links_and_sets_up() {
    let Some(config) = config() else { return };
    let root = opencode_util::temp::tempdir().unwrap();
    let dir = root.path().join("config/plugins/linked");
    std::fs::create_dir_all(&dir).unwrap();
    let marker = root.path().join("linked.ran");
    let module = format!(
        "import {{ BoxRenderable, CliRenderEvents, SyntaxStyle, StyledText, TextRenderable }} from \"@opentui/core\"\n\
         import {{ RendererContext, createDynamic }} from \"@opentui/solid\"\n\
         class Fence extends BoxRenderable {{}}\n\
         const style = SyntaxStyle.fromStyles({{}})\n\
         export default {{ id: \"example.linked\", setup() {{\n\
         new Fence({{}}, {{}}).add(new TextRenderable({{}}, {{}}))\n\
         void [style, StyledText, RendererContext, createDynamic]\n\
         require(\"node:fs\").writeFileSync({marker:?}, CliRenderEvents.RESIZE)\n\
         }} }}\n"
    );
    std::fs::write(dir.join("tui.ts"), module).unwrap();
    let harness = support::mount(80, 30, Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) });
    let external = External { config_dir: root.path().join("config"), cwd: root.path().to_path_buf(), dev: Vec::new() };
    external_with(&harness.tui, external, Some(config));
    let pipe = Pipe { harness, root };
    pipe.active("example.linked");
    assert_eq!(std::fs::read_to_string(&marker).ok().as_deref(), Some("resize"));
}

// Expected (FT-9): a plugin that makes a store for each of 80 keys in its setup, as opencode-tokscope does for its
// history shards, loads and stays active, and each store holds and follows what the host stored for it, as in TS: no
// key or read bound is hit, and with the UI thread busy as the setup runs, its messages stay under the pipe's 256.
#[test]
fn a_plugin_with_eighty_stores_reads_each() {
    let Some(config) = config() else { return };
    let root = opencode_util::temp::tempdir().unwrap();
    let dir = root.path().join("config/plugins/shards");
    std::fs::create_dir_all(&dir).unwrap();
    let marker = root.path().join("shards.sum");
    let module = format!(
        "export default {{ id: \"example.shards\", setup(context) {{\n\
         const stores = Array.from({{ length: 80 }}, (_, index) => context.storage.store(`shard${{index}}`, {{ initial: {{ n: 0 }} }})[0])\n\
         context.keymap.layer(() => ({{ mode: \"global\", commands: [{{ id: \"shards.sum\", title: \"Sum\", run() {{\n\
         require(\"node:fs\").writeFileSync({marker:?}, String(stores.reduce((sum, store) => sum + store.n, 0)))\n\
         }} }}] }}))\n\
         }} }}\n"
    );
    std::fs::write(dir.join("tui.ts"), module).unwrap();
    let harness = support::mount(80, 30, Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) });
    let host = opencode_tui::plugins::host::host(&harness.tui);
    for index in 0..80 {
        opencode_plugin::Host::storage_write(&*host, &format!("plugin.example.shards.shard{index}"), r#"{"n":1}"#)
            .unwrap();
    }
    let external = External { config_dir: root.path().join("config"), cwd: root.path().to_path_buf(), dev: Vec::new() };
    let (received, sent) = (opencode_plugin::pipe::crossed().received, opencode_plugin::pipe::crossed().sent);
    external_with(&harness.tui, external, Some(config));
    let pipe = Pipe { harness, root };
    // The UI thread takes nothing while the setup runs, as when it is busy at startup: once the hello, the load and
    // the setup went, what the setup sends waits for it.
    pipe.harness.wait("the setup went to the JS host", || {
        pipe.harness.app.advance(Duration::from_millis(1));
        opencode_plugin::pipe::crossed().sent - sent >= 3
    });
    std::thread::sleep(Duration::from_millis(1500));
    pipe.active("example.shards");
    pipe.settle();
    // A store's read let go and watched again at each snapshot sent 13,000 messages; each store's are a few.
    let sent = opencode_plugin::pipe::crossed().received - received;
    assert!(sent < 1000, "the setup sent {sent} messages");
    pipe.harness.tui.keymap.dispatch("shards.sum", None);
    pipe.settle();
    assert_eq!(pipe.status("example.shards"), Some(Status::Active));
    assert_eq!(std::fs::read_to_string(&marker).ok().as_deref(), Some("80"));
    // The host's values change, as another client's writes change them: every store follows, as none was let go.
    for index in 0..80 {
        opencode_plugin::Host::storage_write(&*host, &format!("plugin.example.shards.shard{index}"), r#"{"n":2}"#)
            .unwrap();
    }
    opencode_plugin::Host::storage_changed(&*host);
    pipe.settle();
    pipe.harness.tui.keymap.dispatch("shards.sum", None);
    pipe.settle();
    assert_eq!(std::fs::read_to_string(&marker).ok().as_deref(), Some("160"));
}

/// A project with the V2 probe as its plugin, unapproved, whose module writes to the file returned last; the pipe's
/// example plugins `globals` are the user's.
fn project(globals: &[&str], config: Config) -> (Pipe, PathBuf, PathBuf) {
    let root = opencode_util::temp::tempdir().unwrap();
    let work = root.path().join("work");
    std::fs::create_dir_all(work.join(".git")).unwrap();
    let dir = work.join(".opencode").join("plugins").join("v2probe");
    copy(&Path::new(EXAMPLES).join("v2probe"), &dir);
    let marker = root.path().join("module.jsonl");
    std::fs::write(dir.join("marker.txt"), marker.to_string_lossy().as_bytes()).unwrap();
    let config_dir = root.path().join("config");
    for name in globals {
        copy(&Path::new(EXAMPLES).join(name), &config_dir.join("plugins").join(name));
    }
    let harness = support::mount(80, 30, Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) });
    let external = External { config_dir, cwd: work, dev: Vec::new() };
    external_with(&harness.tui, external, Some(config));
    let pipe = Pipe { harness, root };
    pipe.settle();
    (pipe, dir, marker)
}

/// Approves the project plugin `dir` as it is held.
fn approve(pipe: &Pipe, dir: &Path) {
    let tui = &pipe.harness.tui;
    let target = dir.to_string_lossy().into_owned();
    let Some((Ok(artifact), _)) = opencode_tui::plugins::host::held(tui, &target) else { panic!("nothing is held") };
    assert!(artifact.script, "{artifact:?}");
    assert_eq!(crate::plugin_pipe::decide(&pipe.harness, &target, &artifact, Decision::Approved), Ok(true));
}
