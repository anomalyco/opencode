//! Run V2 JSX plugins on the real JS host. Drive input and inspect both plugin callbacks and the TUI they produce.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use opencode_plugin::Status;
use opencode_plugin::loader::approval::Decision;
use opencode_plugin::pipe::{Config, Fault};
use opencode_tui::plugins::host::{External, external_with};
use opencode_tui::{Deps, Route};
use opentui::input::{MouseButton, MouseEventKind};
use serde_json::{Value, json};

use crate::plugin_pipe::{Pipe, config, copy, open};
use crate::support;

const EXAMPLES: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../plugin/examples/pipe");
const PROBE: &str = "example.v2probe";

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
    pipe.until("the probe's claims drew", || {
        line(pipe, "v2probe commands").is_some() && line(pipe, "v2probe route").is_some()
    });
    pipe.settle();
}

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
    pipe.until(&format!("{count} calls logged"), || calls(log).len() >= count);
    calls(log)
}

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
    let listed =
        |line: &&str| line.strip_prefix("v2probe ").is_some_and(|rest| rest.starts_with(|c: char| c.is_ascii_digit()));
    text.lines().map(str::trim).find(listed).unwrap_or_default().to_owned()
}

/// The first line of the screen that starts with `prefix`, trimmed.
fn line(pipe: &Pipe, prefix: &str) -> Option<String> {
    pipe.harness.app.text().lines().map(str::trim).find(|line| line.starts_with(prefix)).map(str::to_owned)
}

#[test]
fn the_guides_typescript_hello_runs_on_the_js_host() {
    let Some(config) = config() else { return };
    let pipe = open(&[("hello", None)], config, (80, 30));
    pipe.active("example.ts-hello");
    let (app, tui) = (&pipe.harness.app, &pipe.harness.tui);
    pipe.until("its line closes the home footer", || app.text().lines().any(|line| line.trim_end().ends_with("hello")));
    pipe.settle();
    let toasted = |what: &str| {
        pipe.until(what, || tui.toasts.current().is_some());
        assert_eq!(toasts(&pipe), ["Hello from a plugin"]);
    };
    tui.keymap.dispatch("hello.greet", None);
    toasted("the command toasts");
    let (x, y) = pipe.harness.find("hello");
    app.click(x, y);
    toasted("a click on the line runs the command");
}

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
    // Wait for the restarted host before checking the next round; settling with no host returns immediately.
    assert_eq!(logged(&pipe, &log, sent.len()), sent);
    // The last item shows; a restart resets the plugin's state, as it resets any plugin's on the JS host. The restarted
    // footer's first render waits for its reads, which a settle does not (`drawn`).
    pipe.until("the restarted footer drew", || footer(&pipe).ends_with("33|"));
    let shown = footer(&pipe);
    assert!(shown.starts_with("v2probe ") && shown.ends_with("33|"), "{shown}");
    assert_eq!(pipe.status(PROBE), Some(Status::Active));
}

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

#[test]
fn an_intrinsic_without_a_node_is_reported_as_a_crash() {
    let Some(config) = config() else { return };
    let (pipe, _log) = probe(config);
    toasts(&pipe);
    pipe.harness.tui.keymap.dispatch("v2probe.select", None);
    pipe.settle();
    assert_eq!(
        toasts(&pipe),
        [
            "Plugin: example.v2probe crashed in slot home.footer: <tab_select> is not supported by opencode-native's JS host"
        ]
    );
    assert_eq!(pipe.status(PROBE), Some(Status::Active));
}

#[test]
fn what_does_not_map_warns_once_and_answers_false() {
    let Some(config) = config() else { return };
    let (pipe, log) = probe(config);
    toasts(&pipe);
    let shown: Vec<Vec<String>> = (0..2)
        .map(|_| {
            pipe.harness.tui.keymap.dispatch("v2probe.unmapped", None);
            pipe.settle();
            toasts(&pipe)
        })
        .collect();
    assert_eq!(shown, [Vec::<String>::new(), vec![]]);
    assert_eq!(calls(&log), [json!({ "panel": false }), json!({ "panel": false })]);
    assert_eq!(pipe.status(PROBE), Some(Status::Active));
}

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

#[test]
fn confirm_prompt_and_alert_answer_their_promises() {
    let Some(config) = config() else { return };
    let (pipe, log) = probe(config);
    let app = &pipe.harness.app;
    // Each next dialog opens in the plugin's code after the answer it awaited, some promise turns after the answer.
    let shows = |text: &str| pipe.until(text, || app.text().contains(text));
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

#[test]
fn a_field_shown_and_focused_in_one_handler_takes_the_focus_once_shown() {
    let Some(config) = config() else { return };
    let (pipe, log) = probe(config);
    let (app, tui) = (&pipe.harness.app, &pipe.harness.tui);
    tui.keymap.dispatch("v2probe.findpage", None);
    pipe.harness.wait_for("no field");
    pipe.settle();
    pipe.scripts().tamper(opencode_plugin::pipe::Tamper::Hold);
    tui.keymap.dispatch("v2probe.find", None);
    // The call answered, with its focus; a settle would wait for the held revision.
    pipe.until("the call answered", || pipe.scripts().idle());
    // Its revision may come after the answer: a replay before it delivers nothing, and the revision is then held for
    // good (pipe-flakes).
    pipe.until("the revision is held", || pipe.scripts().kept());
    for _ in 0..20 {
        app.advance(Duration::from_millis(1));
        app.render();
    }
    assert!(app.text().contains("no field"), "the revision was not held:\n{}", app.text());
    pipe.scripts().replay();
    pipe.settle();
    assert!(!app.text().contains("no field"), "the held revision did not show:\n{}", app.text());
    app.type_text("ab");
    pipe.settle();
    assert_eq!(logged(&pipe, &log, 2), [json!({ "found": "a" }), json!({ "found": "ab" })]);
}

#[test]
fn a_batch_of_a_closed_mount_moves_nothing_where_the_activations_would() {
    let Some(config) = config() else { return };
    let pipe = raw(config, "closed", CLOSED);
    let (app, tui) = (&pipe.harness.app, &pipe.harness.tui);
    let mounts = || opencode_plugin::behave::mounts(app.app(), "example.closed", "pf");
    let route = Route::Plugin { id: "example.closed".into(), name: "pf".into() };
    for _ in 0..2 {
        tui.navigate(route.clone());
        pipe.until("the route shows", || app.text().contains("closed page") && mounts().len() == 1);
        pipe.settle();
        tui.navigate(Route::Home);
        pipe.until("the route closes", || mounts().is_empty());
    }
    tui.navigate(route);
    pipe.until("the route shows again", || mounts().len() == 1);
    pipe.settle();
    let focus = |command: &str| {
        tui.keymap.dispatch("pf.guard", None);
        pipe.settle();
        tui.keymap.dispatch(command, None);
        pipe.settle();
        mounts().pop().and_then(|mount| mount.focused)
    };
    assert_eq!(focus("pf.old").as_deref(), Some("guard"), "the closed mount's focus moved the new mount's");
    assert_eq!(focus("pf.untagged").as_deref(), Some("same"), "the activation's focus did not apply");
    assert_eq!(focus("pf.new").as_deref(), Some("same"), "the new mount's own focus did not apply");
}

#[test]
fn a_slot_claim_that_draws_nothing_moves_no_row_while_it_loads() {
    let Some(config) = config() else { return };
    let footer = |screen: &str| screen.lines().position(|line| line.contains("ctrl+p commands"));
    for route in [Route::Home, support::session_route("ses_a")] {
        let root = opencode_util::temp::tempdir().unwrap();
        let plugin = root.path().join("config/plugins/keys");
        std::fs::create_dir_all(&plugin).unwrap();
        std::fs::write(plugin.join("tui.ts"), KEYS).unwrap();
        let server = support::Fake::new(|seen| support::base(seen, support::DIRECTORY));
        let deps = Deps { route: route.clone(), ..support::deps(Arc::new(server)) };
        let harness = support::mount(80, 24, deps);
        let settled = footer(&harness.wait_for("ctrl+p commands"));
        let external =
            External { config_dir: root.path().join("config"), cwd: root.path().to_path_buf(), dev: Vec::new() };
        external_with(&harness.tui, external, Some(config.clone()));
        let pipe = Pipe { harness, root };
        let (app, tui) = (&pipe.harness.app, &pipe.harness.tui);
        pipe.active("example.keys");
        let frames = std::cell::RefCell::new(Vec::new());
        let registered = || tui.keymap.commands().iter().any(|command| command.id == "keys.toggle");
        pipe.harness.wait("the claim drew", || {
            app.advance(Duration::from_millis(1));
            frames.borrow_mut().push(app.text());
            registered() && pipe.scripts().idle()
        });
        pipe.settle();
        frames.borrow_mut().push(app.text());
        for frame in frames.borrow().iter() {
            assert_eq!(footer(frame), settled, "{route:?}: a frame moved the prompt's footer:\n{frame}");
            assert!(!frame.lines().any(|line| line.trim() == "…"), "{route:?}: a placeholder row showed:\n{frame}");
        }
    }
}

/// The probe of the open-jump row: an `app` slot claim that draws nothing and adds the command `keys.toggle`.
const KEYS: &str = r#"export default { id: "example.keys", setup(api) {
  api.ui.slot({ append: "app", render: () => {
    api.keymap.layer(() => ({ commands: [{ id: "keys.toggle", title: "Toggle keys", run() {} }] }))
    return null
  } })
} }
"#;

fn raw(config: Config, name: &str, source: &str) -> Pipe {
    let root = opencode_util::temp::tempdir().unwrap();
    let plugin = root.path().join("config").join("plugins").join(name);
    std::fs::create_dir_all(&plugin).unwrap();
    std::fs::write(plugin.join("tui.ts"), source).unwrap();
    let harness = support::mount(80, 24, Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) });
    let external = External { config_dir: root.path().join("config"), cwd: root.path().to_path_buf(), dev: Vec::new() };
    external_with(&harness.tui, external, Some(config));
    let pipe = Pipe { harness, root };
    pipe.active(&format!("example.{name}"));
    pipe
}

#[test]
fn a_calls_effects_keep_their_order() {
    let Some(config) = config() else { return };
    let pipe = raw(config, "ordered", ORDERED);
    let (app, tui) = (&pipe.harness.app, &pipe.harness.tui);
    tui.navigate(Route::Plugin { id: "example.ordered".into(), name: "pf".into() });
    pipe.harness.wait_for("ordered page");
    pipe.settle();
    tui.keymap.dispatch("pf.ask", None);
    pipe.harness.wait_for("Told");
    tui.keymap.dispatch("pf.close", None);
    pipe.settle();
    let focused =
        opencode_plugin::behave::mounts(app.app(), "example.ordered", "pf").pop().and_then(|mount| mount.focused);
    assert_eq!((tui.dialogs.is_open(), focused.as_deref()), (false, Some("same")), "{}", app.text());
}

#[test]
fn a_thrown_calls_mount_effects_go_with_it() {
    let Some(config) = config() else { return };
    let pipe = raw(config, "ordered", ORDERED);
    let (app, tui) = (&pipe.harness.app, &pipe.harness.tui);
    tui.navigate(Route::Plugin { id: "example.ordered".into(), name: "pf".into() });
    pipe.harness.wait_for("ordered page");
    pipe.settle();
    pipe.scripts().hold_answers(true);
    tui.keymap.dispatch("pf.throw", None);
    pipe.harness.wait("the throw failed the plugin", || {
        pipe.scripts().release_one();
        crate::plugin_pipe::still(app);
        app.render();
        matches!(pipe.status("example.ordered"), Some(Status::Failed(_)))
    });
    pipe.scripts().hold_answers(false);
    pipe.settle();
    assert!(!tui.dialogs.is_open(), "the thrown call's dispatch ran:\n{}", app.text());
}

#[test]
fn a_pending_focus_goes_when_the_user_takes_the_focus_back() {
    let Some(config) = config() else { return };
    let pipe = raw(config, "pending", PENDING);
    let (app, tui) = (&pipe.harness.app, &pipe.harness.tui);
    let focused =
        || opencode_plugin::behave::mounts(app.app(), "example.pending", "sp").pop().and_then(|mount| mount.focused);
    pipe.harness.wait_for("other field");
    pipe.settle();
    for (moved, by) in [("the reserved chord", "ctrl+c"), ("a click into another field", "click")] {
        tui.keymap.dispatch("sp.hide", None);
        opencode_plugin::Host::focus_composer(&**tui);
        pipe.settle();
        pipe.scripts().tamper(opencode_plugin::pipe::Tamper::Hold);
        tui.keymap.dispatch("sp.show", None);
        pipe.until("the call answered", || pipe.scripts().idle());
        assert!(!app.text().contains("sp field"), "{moved}: the revision was not held:\n{}", app.text());
        match by {
            "ctrl+c" => app.press("ctrl+c"),
            _ => {
                let (x, y) =
                    app.text().lines().enumerate().find_map(|(y, line)| Some((line.find("other field")?, y))).unwrap();
                app.mouse(MouseEventKind::Down(MouseButton::Left), x as u16, y as u16);
                app.mouse(MouseEventKind::Up(MouseButton::Left), x as u16, y as u16);
            }
        }
        app.render();
        let before = focused();
        pipe.scripts().replay();
        pipe.settle();
        assert!(app.text().contains("sp field"), "{moved}: the held revision did not show:\n{}", app.text());
        assert_eq!(focused(), before, "{moved}: the pending focus took the focus back");
        assert_ne!(focused().as_deref(), Some("sp"), "{moved}");
    }
}

#[test]
fn a_reload_gives_the_focus_back_only_to_a_field_that_held_it() {
    let Some(config) = config() else { return };
    let pipe = raw(config, "refocus", REFOCUS);
    let (app, tui) = (&pipe.harness.app, &pipe.harness.tui);
    let focused = || {
        opencode_plugin::behave::mounts(app.app(), "example.refocus", "slot#0").pop().and_then(|mount| mount.focused)
    };
    // Each run adds a layer of a command `rf.more-<n>`: the registrations change, and the run is taken once the keymap
    // lists the new command.
    let more = || tui.keymap.commands().iter().filter(|command| command.id.starts_with("rf.more-")).count();
    let reload = || {
        let before = more();
        tui.keymap.dispatch("rf.reload", None);
        pipe.until("the registrations changed", || more() > before);
        pipe.settle();
    };
    pipe.harness.wait_for("refocus slot");
    pipe.settle();
    tui.keymap.dispatch("rf.focus", None);
    pipe.settle();
    assert!(focused().is_some(), "the field took no focus");
    reload();
    assert!(focused().is_some(), "the reload took the focus from the field that held it");
    opencode_plugin::Host::focus_composer(&**tui);
    app.render();
    assert_eq!(focused(), None, "the composer took no focus");
    reload();
    assert_eq!(focused(), None, "the reload took the focus back from the composer");
}

const REFOCUS: &str = r#"import { createElement, insert, insertNode, setProp } from "@opentui/solid"
let field
let layers = 0
export default { id: "example.refocus", setup(api) {
  api.ui.slot({ append: "home.footer", render: () => {
    const box = createElement("box")
    const text = createElement("text")
    insert(text, "refocus slot")
    insertNode(box, text)
    field = createElement("input")
    setProp(field, "id", "search")
    insertNode(box, field)
    return box
  } })
  api.keymap.layer(() => ({ commands: [
    { id: "rf.focus", run: () => field.focus() },
    { id: "rf.reload", run: () => void api.keymap.layer(() => ({ commands: [{ id: `rf.more-${++layers}`, run() {} }] })) },
  ] }))
} }
"#;

/// The raw probe of the pending-focus row: a slot of the home footer with the field `other`, and `sp`, which `sp.show`
/// shows and focuses in one call and `sp.hide` hides.
const PENDING: &str = r#"export default { id: "example.pending", setup(api) {
  const carrier = api[Symbol.for("opencode.carrier")]
  const mounts = []
  let shown = false
  const view = () => ({ type: "box", children: [
    { type: "input", id: "other", placeholder: "other field" },
    ...(shown ? [{ type: "text", spans: [{ text: "sp shown" }] }, { type: "input", id: "sp", placeholder: "sp field" }] : []),
  ] })
  carrier.surface("sp", { type: "slot", kind: "append", path: "home.footer" }, view, {
    mounts: true,
    on: (event) => {
      if (event.type === "mount" && event.mounted) mounts.push(event.mount)
    },
  })
  carrier.command({ name: "sp.show", title: "sp.show" }, () => {
    shown = true
    carrier.effect({ type: "focus", node: "sp" }, mounts.at(-1))
  })
  carrier.command({ name: "sp.hide", title: "sp.hide" }, () => {
    shown = false
  })
} }
"#;

/// The raw probe of the order row: a route `pf` with the field `same`; `pf.ask` shows an alert, `pf.close` closes the
/// plugin's dialog and then focuses `same` as the route's, and `pf.throw` opens the command palette as the route's and
/// throws.
const ORDERED: &str = r#"export default { id: "example.ordered", setup(api) {
  const carrier = api[Symbol.for("opencode.carrier")]
  const mounts = []
  const page = { type: "box", children: [{ type: "text", spans: [{ text: "ordered page" }] }, { type: "input", id: "same" }] }
  carrier.surface("pf", { type: "route", name: "pf" }, () => page, {
    mounts: true,
    on: (event) => {
      if (event.type === "mount" && event.mounted) mounts.push(event.mount)
    },
  })
  carrier.command({ name: "pf.ask", title: "pf.ask" }, () => {
    carrier.effect({ type: "dialog", dialog: { type: "alert", title: "Told", message: "It says." } })
  })
  carrier.command({ name: "pf.close", title: "pf.close" }, () => {
    carrier.effect({ type: "dialog", dialog: { type: "close", key: "" } })
    carrier.effect({ type: "focus", node: "same" }, mounts.at(-1))
  })
  carrier.command({ name: "pf.throw", title: "pf.throw" }, () => {
    carrier.effect({ type: "dispatch", name: "command.palette.show" }, mounts.at(-1))
    throw new Error("thrown")
  })
} }
"#;

/// The raw probe of the closed-mount row: a route `pf` with the fields `guard` and `same`, which records each mount it
/// begins; `pf.guard` focuses `guard` as the newest mount's, and `pf.old`, `pf.untagged` and `pf.new` focus `same` as
/// the first mount's, the activation's and the newest mount's.
const CLOSED: &str = r#"export default { id: "example.closed", setup(api) {
  const carrier = api[Symbol.for("opencode.carrier")]
  const mounts = []
  const page = { type: "box", children: [
    { type: "text", spans: [{ text: "closed page" }] },
    { type: "input", id: "guard" },
    { type: "input", id: "same" },
  ] }
  carrier.surface("pf", { type: "route", name: "pf" }, () => page, {
    mounts: true,
    on: (event) => {
      if (event.type === "mount" && event.mounted) mounts.push(event.mount)
    },
  })
  const focus = (node, mount) => carrier.effect({ type: "focus", node }, mount)
  carrier.command({ name: "pf.guard", title: "pf.guard" }, () => focus("guard", mounts.at(-1)))
  carrier.command({ name: "pf.old", title: "pf.old" }, () => focus("same", mounts[0]))
  carrier.command({ name: "pf.untagged", title: "pf.untagged" }, () => focus("same"))
  carrier.command({ name: "pf.new", title: "pf.new" }, () => focus("same", mounts.at(-1)))
} }
"#;

#[test]
fn a_fields_focus_after_its_mount_closed_moves_nothing() {
    let Some(config) = config() else { return };
    let (pipe, log) = probe(config);
    let (app, tui) = (&pipe.harness.app, &pipe.harness.tui);
    tui.keymap.dispatch("v2probe.findpage", None);
    pipe.harness.wait_for("no field");
    pipe.settle();
    // What the JS host answers waits: the call, its field's focus and the revision that shows the field.
    pipe.scripts().hold_answers(true);
    tui.keymap.dispatch("v2probe.find", None);
    app.wait_until(Duration::from_millis(500), || {
        app.advance(Duration::from_millis(1));
        false
    });
    tui.navigate(Route::Home);
    for _ in 0..5 {
        app.advance(Duration::from_millis(1));
        app.render();
    }
    pipe.scripts().hold_answers(false);
    pipe.settle();
    assert!(opencode_plugin::Host::composer_focused(&**tui), "the closed mount's focus moved it:\n{}", app.text());
    app.type_text("ab");
    pipe.settle();
    let typed = tui.textarea.borrow().as_ref().map(|area| area.text()).unwrap_or_default();
    assert_eq!(typed, "ab");
    assert_eq!(calls(&log), Vec::<Value>::new());
}

#[test]
fn a_dialog_set_right_after_sizes_and_centers_the_dialog() {
    let Some(config) = config() else { return };
    let (pipe, log) = probe(config);
    let (app, tui) = (&pipe.harness.app, &pipe.harness.tui);
    let presented = || (tui.dialogs.size(), tui.dialogs.centered());
    let xlarge = (opencode_ui::dialog::DialogSize::XLarge, true);
    tui.keymap.dispatch("v2probe.centered", None);
    pipe.harness.wait_for("Turn 1");
    assert_eq!(presented(), xlarge);
    app.press("return");
    pipe.harness.wait_for("It took long.");
    assert_eq!(presented(), xlarge);
    assert_eq!(logged(&pipe, &log, 1), [json!({ "turn": 1 })]);
}

#[test]
fn a_route_draws_a_bordered_box_and_a_scroll_with_its_data() {
    let Some(config) = config() else { return };
    let (pipe, _log) = probe(config);
    pipe.harness.tui.keymap.dispatch("v2probe.page", None);
    // A route's first view waits for the page it replaces to go, and so comes after a settle: wait for the page.
    pipe.until("the page drew", || {
        let screen = pipe.harness.app.text();
        screen.contains("╭─Page") && screen.contains("data n=3")
    });
    // The page registers a command as it renders, which settles once the command it replaced retired.
    pipe.retired();
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

#[test]
fn a_render_draws_by_the_reconcilers_rules() {
    let Some(config) = config() else { return };
    let (pipe, _log) = probe(config);
    let screen = pipe.harness.app.text();
    assert!(!screen.contains("hidden text"), "{screen}");
    // Replacing an unpublished slot must not fall back to another slot.
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

#[test]
fn a_dialog_of_its_own_shows_its_jsx_and_closes() {
    let Some(config) = config() else { return };
    let (pipe, log) = probe(config);
    let tui = &pipe.harness.tui;
    tui.keymap.dispatch("v2probe.show", None);
    pipe.settle();
    let screen = pipe.harness.app.text();
    assert!(screen.contains("Own dialog") && screen.contains("shown 0"), "{screen}");
    tui.keymap.dispatch("v2probe.base", None);
    pipe.settle();
    let (x, y) = pipe.harness.find("bump it");
    pipe.harness.app.click(x, y);
    // The layer sends the changed dialog in a microtask after the click's handler.
    pipe.until("the dialog follows its signal", || pipe.harness.app.text().contains("shown 1"));
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

#[test]
fn a_components_command_lives_with_its_mount_across_a_reload() {
    let Some(config) = config() else { return };
    let (pipe, log) = probe(config);
    let tui = &pipe.harness.tui;
    assert_eq!(line(&pipe, "v2probe route").as_deref(), Some("v2probe route home"));
    tui.keymap.dispatch("v2probe.page", None);
    // The change the page's command made settles once the command it replaced retired.
    pipe.retired();
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
    // Registration cleanup can lag route exit; a lingering command must already be inert.
    tui.keymap.dispatch("v2probe.onpage", None);
    pipe.settle();
    assert_eq!(calls(&log), [json!({ "onpage": true })], "the page's command ran after the page left");
    pipe.retired();
    assert!(!matches!(tui.keymap.dispatch("v2probe.onpage", None), opentui::keymap::RunResult::Ok), "it stayed");
}

#[test]
fn a_page_whose_commands_have_no_id_draws_and_settles() {
    let Some(config) = config() else { return };
    let (pipe, log) = probe(config);
    let tui = &pipe.harness.tui;
    tui.keymap.dispatch("v2probe.inline", None);
    pipe.retired();
    let quiet = opencode_plugin::pipe::crossed();
    std::thread::sleep(Duration::from_millis(400));
    for _ in 0..5 {
        pipe.harness.app.advance(Duration::from_millis(16));
    }
    let after = opencode_plugin::pipe::crossed();
    assert_eq!((after.received, after.trees), (quiet.received, quiet.trees), "the page did not settle");
    assert_eq!(pipe.status(PROBE), Some(Status::Active));
    assert!(pipe.harness.app.text().contains("inline page"), "{}", pipe.harness.app.text());
    pipe.harness.app.press("j");
    assert_eq!(logged(&pipe, &log, 1), [json!({ "inline": "j" })]);
}

#[test]
fn a_page_that_names_its_commands_anew_each_mount_settles() {
    let Some(config) = config() else { return };
    let (pipe, _log) = probe(config);
    pipe.harness.tui.keymap.dispatch("v2probe.churn", None);
    pipe.retired();
    let quiet = opencode_plugin::pipe::crossed();
    std::thread::sleep(Duration::from_millis(400));
    for _ in 0..5 {
        pipe.harness.app.advance(Duration::from_millis(16));
    }
    let after = opencode_plugin::pipe::crossed();
    assert_eq!((after.received, after.trees), (quiet.received, quiet.trees), "the page did not settle");
    assert_eq!(pipe.status(PROBE), Some(Status::Active));
    assert!(pipe.harness.app.text().contains("churn page"), "{}", pipe.harness.app.text());
}

#[test]
fn a_plugin_whose_registrations_never_settle_fails() {
    let Some(config) = config() else { return };
    let (pipe, _log) = probe(config);
    pipe.harness.tui.keymap.dispatch("v2probe.restless", None);
    pipe.until("the churn failed the plugin", || matches!(pipe.status(PROBE), Some(Status::Failed(_))));
    let Some(Status::Failed(error)) = pipe.status(PROBE) else { unreachable!() };
    assert!(error.contains("changed its registrations more than 64 times"), "{error}");
}

#[test]
fn a_change_of_commands_alone_keeps_the_route_and_its_field() {
    let Some(config) = config() else { return };
    let (pipe, _log) = probe(config);
    let (app, tui) = (&pipe.harness.app, &pipe.harness.tui);
    tui.keymap.dispatch("v2probe.searchpage", None);
    pipe.harness.wait_for("not searching");
    pipe.settle();
    tui.keymap.dispatch("v2probe.search", None);
    pipe.harness.wait_gone("not searching");
    pipe.settle();
    let focused = || app.app().focused().map(|widget| opentui::widget::Widget::id(&widget));
    let field = focused();
    assert!(field.is_some(), "the field has no focus:\n{}", app.text());
    // The first key mounts the matches and their command: the keys after it go on while the change crosses.
    app.type_text("notes");
    // Once the command the plugin dropped retired.
    pipe.retired();
    assert!(app.text().contains("query notes."), "{}", app.text());
    assert_eq!(focused(), field, "the field was built again");
    assert!(matches!(tui.keymap.dispatch("v2probe.clear", None), opentui::keymap::RunResult::Ok));
    pipe.harness.wait_for("not searching");
    assert_eq!(pipe.status(PROBE), Some(Status::Active));
}

#[test]
fn a_session_panel_stays_open_across_a_reload() {
    let Some(config) = config() else { return };
    let log = log_file();
    let options = json!({ "log": log.to_string_lossy() });
    let server = Arc::new(support::Fake::new(|seen| support::base(seen, support::DIRECTORY)));
    let pipe = crate::plugin_pipe::open_on(&[("v2probe", Some(options))], config, (120, 30), Vec::new(), server);
    pipe.active(PROBE);
    pipe.harness.tui.navigate(Route::Session { id: opencode_api::generated::SessionID("ses_a".into()) });
    pipe.until("the session shows", || matches!(pipe.harness.tui.route(), Route::Session { .. }));
    pipe.settle();
    pipe.harness.tui.keymap.dispatch("v2probe.panel", None);
    assert_eq!(logged(&pipe, &log, 1), [json!({ "opened": true })]);
    pipe.retired();
    let shows = || pipe.harness.app.text().contains("probe panel probe.panel");
    pipe.until("the panel shows", shows);
    assert!(pipe.harness.tui.panels.current().is_some(), "the panel closed");
    assert_eq!(pipe.status(PROBE), Some(Status::Active));
}

#[test]
fn a_session_panel_toggles_focuses_and_closes_itself() {
    let Some(config) = config() else { return };
    let log = log_file();
    let options = json!({ "log": log.to_string_lossy() });
    let server = Arc::new(support::Fake::new(|seen| support::base(seen, support::DIRECTORY)));
    let pipe = crate::plugin_pipe::open_on(&[("v2probe", Some(options))], config, (120, 30), Vec::new(), server);
    pipe.active(PROBE);
    pipe.harness.tui.navigate(Route::Session { id: opencode_api::generated::SessionID("ses_a".into()) });
    pipe.until("the session shows", || matches!(pipe.harness.tui.route(), Route::Session { .. }));
    pipe.settle();
    pipe.harness.tui.keymap.dispatch("v2probe.panel", None);
    assert_eq!(logged(&pipe, &log, 1), [json!({ "opened": true })]);
    pipe.until("the panel shows", || pipe.harness.app.text().contains("probe panel probe.panel"));
    pipe.settle();
    let run = |command: &str| {
        pipe.harness.tui.keymap.dispatch(command, None);
        pipe.settle();
    };
    let presentation = || pipe.harness.tui.panels.presentation();
    run("v2probe.panel-full");
    assert_eq!(presentation(), opencode_tui::panel::Presentation::Fullscreen);
    run("v2probe.panel-full");
    assert_eq!(presentation(), opencode_tui::panel::Presentation::Panel);
    run("pane.focus.left");
    run("v2probe.panel-focus");
    pipe.harness.app.type_text("zq");
    pipe.settle();
    let typed = pipe.harness.app.text().lines().find_map(|line| line.find("zq").map(|at| line[..at].chars().count()));
    assert!(typed.is_some_and(|column| column >= 60), "zq at {typed:?}:\n{}", pipe.harness.app.text());
    run("v2probe.panel-close");
    assert!(pipe.harness.tui.panels.current().is_none(), "the panel is open");
    assert_eq!(pipe.status(PROBE), Some(Status::Active));
}

#[test]
fn a_plugin_that_imports_effect_fails_to_load_naming_it() {
    let Some(config) = config() else { return };
    let log = log_file();
    let pipe = open(&[("effectprobe", Some(json!({ "log": log.to_string_lossy() })))], config, (80, 30));
    let dir = pipe.root.path().join("config").join("plugins").join("effectprobe");
    pipe.harness.wait("the plugin failed", || {
        pipe.settle();
        matches!(listed(&pipe, &dir, "example.effectprobe"), Some(Status::Failed(_)))
    });
    let Some(Status::Failed(error)) = listed(&pipe, &dir, "example.effectprobe") else { unreachable!() };
    assert!(error.contains("'effect'") && error.contains("not installed"), "{error}");
    let failed =
        pipe.harness.tui.plugins.entries().into_iter().filter(|entry| matches!(entry.status, Status::Failed(_)));
    assert_eq!(failed.count(), 1, "another plugin failed");
    assert!(calls(&log).is_empty(), "the plugin ran");
    assert!(!pipe.harness.app.text().is_empty(), "the client stopped drawing");
}

#[test]
fn a_layout_that_follows_its_own_size_is_held() {
    let Some(config) = config() else { return };
    let (pipe, log) = probe(config);
    let sizes = |name: &str| calls(&log).iter().filter(|call| call.get(name).is_some()).count();
    let frames = || {
        for _ in 0..40 {
            pipe.harness.app.advance(Duration::from_millis(16));
            pipe.settle();
        }
    };
    let last = |name: &str| calls(&log).iter().rev().find_map(|call| call.get(name).and_then(Value::as_u64));
    pipe.harness.tui.keymap.dispatch("v2probe.settle", None);
    frames();
    let settled = sizes("settle");
    assert_eq!(last("settle"), Some(11), "{:?}", calls(&log));
    frames();
    assert_eq!(sizes("settle"), settled, "the settled page heard a size again");
    pipe.harness.tui.keymap.dispatch("v2probe.grow", None);
    frames();
    let grown = sizes("grow");
    assert!((2..=12).contains(&grown), "the page grew {grown} times");
    frames();
    assert_eq!(sizes("grow"), grown, "the held page grew again with no other cause");
    assert_eq!(pipe.status(PROBE), Some(Status::Active));
}

#[test]
fn a_stalled_js_host_holds_keys_no_longer_than_the_limit() {
    let Some(config) = config() else { return };
    let (pipe, log) = probe(config);
    let harness = &pipe.harness;
    harness.tui.keymap.dispatch("v2probe.arm", Some("stall"));
    pipe.settle();
    harness.app.type_text("%ab");
    assert_eq!(harness.text(), "", "the keys after the bound key wait for its command");
    harness.app.advance(Duration::from_millis(49));
    assert_eq!(harness.text(), "");
    harness.app.advance(Duration::from_millis(2));
    assert_eq!(harness.text(), "%ab", "at the limit the bound key goes on, then the keys after it");
    harness.app.type_text("%c");
    harness.app.advance(Duration::from_millis(1));
    assert_eq!(harness.text(), "%ab%c", "a stalled JS host holds no key");
    assert_eq!(logged(&pipe, &log, 2), [json!({ "percent": "stall" }), json!({ "percent": "pass" })]);
    pipe.settle();
    assert_eq!(harness.text(), "%ab%c", "a late answer put its key back");
    // Typed before the UI takes anything else, so the command's answer cannot have arrived between the keys.
    for key in ['%', 'x'] {
        let event =
            opentui::prelude::KeyEvent::new(opentui::prelude::KeyCode::Char(key), opentui::prelude::Modifiers::NONE);
        harness.app.app().dispatch(opentui::prelude::Event::Key(event));
    }
    assert_eq!(harness.text(), "%ab%c", "the JS host answered: a bound key holds again");
    assert_eq!(logged(&pipe, &log, 3).len(), 3);
    pipe.settle();
    assert_eq!(harness.text(), "%ab%c%x");
}

#[test]
fn a_disabled_commands_key_is_not_held() {
    let Some(config) = config() else { return };
    let (pipe, log) = probe(config);
    let (harness, tui) = (&pipe.harness, &pipe.harness.tui);
    let live = || (1..512).find(|generation| tui.plugins.live(PROBE, *generation));
    let before = live();
    harness.app.type_text("^");
    assert_eq!(harness.text(), "^", "the disabled command's key was held");
    tui.keymap.dispatch("v2probe.caretOn", Some("on"));
    pipe.settle();
    harness.app.type_text("^a");
    pipe.settle();
    assert_eq!(harness.text(), "^a", "the enabled command did not take its key");
    tui.keymap.dispatch("v2probe.caretOn", Some("off"));
    pipe.settle();
    harness.app.type_text("^");
    assert_eq!(harness.text(), "^a^", "the key of the command disabled again was held");
    assert_eq!(calls(&log), [json!({ "caret": true })]);
    assert_eq!(live(), before, "a change of the command's state reloaded the plugin");
}

#[test]
fn a_restarted_js_hosts_commands_take_its_setups_states() {
    let Some(config) = config() else { return };
    let (pipe, _log) = probe(config);
    let tui = &pipe.harness.tui;
    let reachable = || tui.keymap.commands().iter().any(|command| command.id == "v2probe.caret");
    tui.keymap.dispatch("v2probe.caretOn", Some("on"));
    pipe.settle();
    assert!(reachable(), "the enabled command is not reachable");
    let pid = pipe.scripts().pid();
    pipe.scripts().fault(Fault::Swap);
    tui.keymap.dispatch("v2probe.add", Some("x"));
    tui.keymap.dispatch("v2probe.add", Some("y"));
    pipe.until("the JS host started again", || pipe.scripts().pid().is_some_and(|now| Some(now) != pid));
    pipe.settle();
    assert_eq!(pipe.status(PROBE), Some(Status::Active));
    assert!(!reachable(), "the restarted plugin's disabled command is reachable");
}

/// The probe's live activation, by its generation.
fn generation(pipe: &Pipe) -> Option<u64> {
    (1..512).find(|generation| pipe.harness.tui.plugins.live(PROBE, *generation))
}

/// Waits until the host took a reload of the probe's registrations past activation `before`. The reload is the host's
/// own work after the JS host answered (the loader reconciles), so a settle that saw the JS host idle may come first.
fn reloaded(pipe: &Pipe, before: Option<u64>) {
    pipe.until("the probe's registrations reloaded", || generation(pipe).is_some_and(|now| Some(now) != before));
    pipe.settle();
}

#[test]
fn a_state_set_as_the_registrations_reload_goes_to_the_new_guest() {
    let Some(config) = config() else { return };
    let (pipe, log) = probe(config);
    let (harness, tui) = (&pipe.harness, &pipe.harness.tui);
    let before = generation(&pipe);
    pipe.scripts().hold_answers(true);
    tui.keymap.dispatch("v2probe.lateCaret", None);
    pipe.until("the reload and the state came", || {
        let types = pipe.scripts().held_types();
        types
            .iter()
            .position(|kind| kind == "manifest")
            .is_some_and(|at| types[at..].iter().any(|kind| kind == "effects"))
    });
    pipe.scripts().hold_answers(false);
    // Typed before the host took the reload, `^` would meet the guest that handed over (compat-flakes).
    reloaded(&pipe, before);
    harness.app.type_text("^");
    pipe.settle();
    assert_eq!((harness.text(), calls(&log)), (String::new(), vec![json!({ "caret": true })]));
}

#[test]
fn a_js_listener_takes_its_key_with_prevent_default() {
    let Some(config) = config() else { return };
    let (pipe, log) = probe(config);
    let (harness, tui) = (&pipe.harness, &pipe.harness.tui);
    let mut seen = Vec::new();
    for step in ["pass", "take"] {
        // The first run registers the listener's layer: a reload, which the key must come after (compat-flakes).
        let before = generation(&pipe);
        tui.keymap.dispatch("v2probe.listen", Some(step));
        if step == "pass" {
            reloaded(&pipe, before);
        }
        pipe.settle();
        harness.app.press("ctrl+p");
        pipe.settle();
        seen.push((step, tui.dialogs.is_open()));
        if tui.dialogs.is_open() {
            harness.app.press("escape");
            pipe.settle();
        }
    }
    assert_eq!(seen, [("pass", true), ("take", false)]);
    assert_eq!(calls(&log), [json!({ "listened": false }), json!({ "listened": true })]);
}

thread_local! {
    static HEARD: std::cell::RefCell<Vec<String>> = const { std::cell::RefCell::new(Vec::new()) };
}

fn hearing(setup: &mut opencode_plugin::abi::Setup) -> Result<(), String> {
    use opencode_plugin::abi::interact::{Event, Handled, Layer, LayerScope};
    for (priority, name) in [(10, "above"), (-10, "below")] {
        let layer = Layer::default().scope(LayerScope::Global).any().priority(priority);
        setup.layer(layer, move |_, event| {
            if let Event::Key(key) = event {
                HEARD.with(|heard| heard.borrow_mut().push(format!("{name}:{}", key.key)));
            }
            Handled::Pass
        });
    }
    Ok(())
}

#[test]
fn a_key_a_js_listener_lets_go_is_heard_once_by_each_native_listener() {
    let Some(config) = config() else { return };
    let log = log_file();
    let options = json!({ "log": log.to_string_lossy() });
    let plugin = opencode_plugin::abi::Plugin { id: "example.hearing", setup: hearing };
    let builtin = crate::plugin_surface::builtin(crate::plugin_surface::Carrier::Linked, plugin);
    let pipe = crate::plugin_pipe::open_with(&[("v2probe", Some(options))], config, (80, 30), vec![builtin]);
    pipe.active(PROBE);
    pipe.settle();
    let before = generation(&pipe);
    pipe.harness.tui.keymap.dispatch("v2probe.listen", Some("pass"));
    reloaded(&pipe, before);
    HEARD.with(|heard| heard.borrow_mut().clear());
    pipe.harness.app.press("ctrl+o");
    pipe.settle();
    let heard = HEARD.with(|heard| std::mem::take(&mut *heard.borrow_mut()));
    assert_eq!(heard, ["above:ctrl+o", "below:ctrl+o"]);
}

#[test]
fn composer_typing_never_waits_for_a_js_key_listener() {
    let Some(config) = config() else { return };
    let (pipe, _log) = probe(config);
    let (harness, tui) = (&pipe.harness, &pipe.harness.tui);
    // The first run registers the listener's layer, which reloads the plugin's registrations once: until the host took
    // that reload, the layer holds nothing, and holding the JS host's answers would hold the reload back too
    // (compat-flakes).
    let before = generation(&pipe);
    tui.keymap.dispatch("v2probe.listen", Some("take"));
    reloaded(&pipe, before);
    pipe.scripts().hold_answers(true);
    harness.app.type_text("ab");
    assert_eq!(harness.text(), "ab", "the typing waited for the JS host");
    harness.app.press("ctrl+p");
    assert!(!tui.dialogs.is_open(), "the key the listener may take did not wait for it");
    pipe.scripts().hold_answers(false);
    pipe.settle();
    assert!(!tui.dialogs.is_open(), "the listener did not take its key");
}

#[test]
fn a_declining_palette_command_stays_in_the_palette_its_key_opens() {
    let Some(config) = config() else { return };
    let (pipe, _log) = probe(config);
    let harness = &pipe.harness;
    harness.app.press("ctrl+p");
    pipe.settle();
    assert!(harness.tui.dialogs.is_open(), "the declined key did not open the palette");
    harness.app.type_text("Probe hot");
    pipe.settle();
    assert!(harness.app.text().contains("Probe hotkey"), "{}", harness.app.text());
}

#[test]
fn a_js_host_that_ends_while_keys_are_held_releases_them() {
    let Some(mut config) = config() else { return };
    config.hold = Duration::from_secs(60);
    let (pipe, log) = probe(config);
    let harness = &pipe.harness;
    let pid = pipe.scripts().pid();
    harness.tui.keymap.dispatch("v2probe.arm", Some("exit"));
    pipe.settle();
    harness.app.type_text("%ab");
    assert_eq!(harness.text(), "", "the keys after the bound key wait for its command");
    pipe.until("the ended JS host released the keys", || harness.text() == "%ab");
    pipe.until("the end was noticed", || {
        pipe.scripts().pid() != pid && matches!(pipe.status(PROBE), Some(Status::Failed(_)))
    });
    pipe.settle();
    assert_eq!(harness.text(), "%ab");
    assert!(!calls(&log).iter().any(|call| call.get("percent").is_some()), "{:?}", calls(&log));
}

#[test]
fn a_fresh_activation_owns_only_its_own_dialogs() {
    let Some(config) = config() else { return };
    let (pipe, _log) = probe(config);
    let tui = &pipe.harness.tui;
    let owned = || (1..512).filter(|generation| tui.plugins.owns(PROBE, *generation)).collect::<Vec<u64>>();
    let live = || (1..512).find(|generation| tui.plugins.live(PROBE, *generation));
    // A store made after setup declares its key, a registration: a reload, which hands the activation on. A command
    // alone (the page's layer) changes in place.
    let before = generation(&pipe);
    tui.keymap.dispatch("v2probe.late", None);
    reloaded(&pipe, before);
    let chain = owned();
    assert!(chain.len() >= 2, "the reload handed nothing on: {chain:?}");
    let host = opencode_tui::plugins::host::host(tui);
    tui.plugins.set_active(&host, PROBE, false);
    pipe.settle();
    tui.plugins.set_active(&host, PROBE, true);
    pipe.active(PROBE);
    pipe.settle();
    // The fresh setup's own registrations may reload it again: its own chain, which starts after the old one.
    let fresh = live().expect("the enabled plugin has an activation");
    let now = owned();
    assert!(now.contains(&fresh), "{fresh} not in {now:?}");
    assert!(now.iter().all(|generation| !chain.contains(generation)), "the fresh activation owns {now:?} of {chain:?}");
}

#[test]
fn a_late_rejection_of_a_reloaded_plugin_fails_nothing() {
    let Some(config) = config() else { return };
    let (pipe, _log) = probe(config);
    let tui = &pipe.harness.tui;
    tui.keymap.dispatch("v2probe.reject", None);
    pipe.settle();
    let file = pipe.root.path().join("config/plugins/v2probe/tui.tsx");
    let source = std::fs::read_to_string(&file).unwrap();
    let before = generation(&pipe);
    std::fs::write(&file, format!("{source}\n// reloaded\n")).unwrap();
    opencode_tui::plugins::host::reconcile(tui);
    // The new build loads and takes over; the old activation's late rejection comes as it ends.
    reloaded(&pipe, before);
    assert_eq!(pipe.status(PROBE), Some(Status::Active));
}

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

#[test]
fn two_quick_reloads_leave_the_plugin_working() {
    let Some(config) = config() else { return };
    let (pipe, log) = probe(config);
    let tui = &pipe.harness.tui;
    tui.keymap.dispatch("v2probe.twice", None);
    // Both reloads wait for the UI thread, which takes them in one go; then both commands are the keymap's.
    let registered = |name: &str| tui.keymap.commands().iter().any(|command| command.id == name);
    pipe.until("both reloads were taken", || registered("v2probe.first") && registered("v2probe.second"));
    pipe.settle();
    for name in ["v2probe.first", "v2probe.second"] {
        tui.keymap.dispatch(name, None);
        pipe.settle();
    }
    assert_eq!(logged(&pipe, &log, 2), [json!({ "ran": "v2probe.first" }), json!({ "ran": "v2probe.second" })]);
}

#[test]
fn a_v2_render_that_spins_fails_its_plugin_alone() {
    let Some(mut config) = config() else { return };
    config.limits.ack = Duration::from_millis(500);
    let (pipe, _log) = probe(config);
    let pid = pipe.scripts().pid().unwrap();
    pipe.harness.tui.keymap.dispatch("v2probe.loop", None);
    pipe.until("the spin ended the JS host", || matches!(pipe.status(PROBE), Some(Status::Failed(_))));
    let Some(Status::Failed(error)) = pipe.status(PROBE) else { unreachable!() };
    assert!(error.contains("ended the JS host"), "{error}");
    assert_ne!(pipe.scripts().pid(), Some(pid));
}

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
    pipe.until("the flood ended the JS host", || matches!(pipe.status(PROBE), Some(Status::Failed(_))));
    pipe.settle();
    let Some(Status::Failed(error)) = pipe.status(PROBE) else { unreachable!() };
    assert!(error.contains("flooded the host with effects"), "{error}");
    assert_eq!(pipe.status("example.twin"), Some(Status::Active));
}

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

// Edit the source while the JS host is busy to exercise the interval between approval and import.
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

// Hold the staged copy to exercise an edit between approval and copying.
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

/// Look up the project plugin by directory until its package ID is known.
fn listed(pipe: &Pipe, dir: &Path, id: &str) -> Option<Status> {
    let target = dir.to_string_lossy();
    let entries = pipe.harness.tui.plugins.entries().into_iter();
    let unloaded = |entry: &opencode_plugin::Entry| entry.key == format!("target:{target}");
    entries.filter(|entry| entry.id == target || unloaded(entry) || entry.id == id).map(|entry| entry.status).next()
}

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
    pipe.until("the plugin was set up again", || {
        std::fs::read_to_string(&marker).unwrap_or_default().lines().count() == 2
    });
    assert_eq!(std::fs::read_to_string(&marker).unwrap(), "approved\napproved\n");
}

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

#[test]
fn a_plugin_imports_runtime_modules_and_calls_its_own_rpc() {
    let Some(config) = config() else { return };
    let root = opencode_util::temp::tempdir().unwrap();
    let dir = root.path().join("config/plugins/rpc");
    std::fs::create_dir_all(&dir).unwrap();
    let log = root.path().join("rpc.log");
    let module = format!(
        "import {{ createSignal }} from \"opentui:runtime-module:solid-js\"\n\
         import {{ jsx }} from \"opentui:runtime-module:%40opentui%2Fsolid%2Fjsx-runtime\"\n\
         import {{ Rpc }} from \"opentui:runtime-module:@opencode/plugin/rpc\"\n\
         import {{ Plugin }} from \"@opencode/plugin/tui\"\n\
         import {{ appendFileSync }} from \"node:fs\"\n\
         const Echo = Rpc.define({{ id: \"echo\", methods: {{ say: {{ input: {{}}, output: {{}} }} }}, events: {{}} }})\n\
         export default Plugin.define({{ id: \"example.rpc\", setup(context) {{\n\
         const [said, setSaid] = createSignal(\"\")\n\
         const echo = context.client.rpc(Echo)\n\
         context.keymap.layer(() => ({{ mode: \"global\", commands: [{{ id: \"rpc.say\", run: async () => {{\n\
           const output = await echo.say({{ text: \"hi\" }})\n\
           setSaid(output.said)\n\
           appendFileSync({log:?}, JSON.stringify(output) + \"\\n\")\n\
         }} }}] }}))\n\
         context.ui.slot({{ append: \"home.footer\", render: () => jsx(\"text\", {{ get children() {{ return `rpc ${{said()}}` }} }}) }})\n\
         }} }})\n"
    );
    std::fs::write(dir.join("tui.ts"), module).unwrap();
    let server = support::Fake::new(|seen| match seen.path.as_str() {
        "/api/rpc/echo/say" => (200, json!({ "output": { "said": seen.body["input"]["text"] } })),
        "/api/session" => (200, json!({ "data": [], "cursor": {} })),
        _ => support::not_found(),
    });
    let requests = server.log();
    let harness = support::mount(80, 30, Deps { route: Route::Home, ..support::deps(Arc::new(server)) });
    let external = External { config_dir: root.path().join("config"), cwd: root.path().to_path_buf(), dev: Vec::new() };
    external_with(&harness.tui, external, Some(config));
    let pipe = Pipe { harness, root };
    pipe.active("example.rpc");
    pipe.harness.tui.keymap.dispatch("rpc.say", None);
    pipe.until("the RPC answered", || std::fs::read_to_string(&log).is_ok_and(|text| text.ends_with('\n')));
    assert_eq!(std::fs::read_to_string(&log).unwrap(), "{\"said\":\"hi\"}\n");
    let called = requests.lock().unwrap().iter().find(|seen| seen.path == "/api/rpc/echo/say").cloned().unwrap();
    assert_eq!((called.method.as_str(), called.body), ("POST", json!({ "input": { "text": "hi" } })));
    pipe.harness.wait_for("rpc hi");
}

#[test]
fn a_local_plugin_that_fails_is_listed_by_its_package() {
    let Some(config) = config() else { return };
    let root = opencode_util::temp::tempdir().unwrap();
    let dir = root.path().join("config/plugins/broken");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("package.json"), r#"{ "name": "opencode-broken-thing" }"#).unwrap();
    std::fs::write(dir.join("tui.ts"), "throw new Error(\"boom\")\n").unwrap();
    let harness = support::mount(80, 30, Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) });
    let external = External { config_dir: root.path().join("config"), cwd: root.path().to_path_buf(), dev: Vec::new() };
    external_with(&harness.tui, external, Some(config));
    let pipe = Pipe { harness, root };
    let entry = || {
        let entries = pipe.harness.tui.plugins.entries();
        entries.into_iter().find(|entry| entry.target.as_deref().is_some_and(|target| target.ends_with("broken")))
    };
    pipe.until("the load failed", || entry().is_some_and(|entry| matches!(entry.status, Status::Failed(_))));
    let entry = entry().unwrap();
    assert_eq!(entry.id, "opencode-broken-thing", "{entry:?}");
}

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
    pipe.until("the setup went to the JS host", || opencode_plugin::pipe::crossed().sent - sent >= 3);
    std::thread::sleep(Duration::from_millis(1500));
    pipe.active("example.shards");
    pipe.settle();
    let sent = opencode_plugin::pipe::crossed().received - received;
    assert!(sent < 1000, "the setup sent {sent} messages");
    pipe.harness.tui.keymap.dispatch("shards.sum", None);
    pipe.settle();
    assert_eq!(pipe.status("example.shards"), Some(Status::Active));
    assert_eq!(std::fs::read_to_string(&marker).ok().as_deref(), Some("80"));
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

#[test]
fn a_plugin_past_the_stored_values_bound_goes_on_and_follows_a_large_value() {
    let Some(config) = config() else { return };
    let root = opencode_util::temp::tempdir().unwrap();
    let dir = root.path().join("config/plugins/big");
    std::fs::create_dir_all(&dir).unwrap();
    let marker = root.path().join("big.count");
    let module = format!(
        "const prices = (from, count) => Object.fromEntries(Array.from({{ length: count }}, (_, index) =>\n\
         [`provider/model-${{from + index}}`, {{ input: index, output: index * 2, note: \"x\".repeat(80) }}]))\n\
         export default {{ id: \"example.big\", setup(context) {{\n\
         const [store, update] = context.storage.store(\"prices\", {{ initial: {{ entries: {{}} }} }})\n\
         const write = (text) => require(\"node:fs\").writeFileSync({marker:?}, text)\n\
         const count = () => write(String(Object.keys(store.entries).length))\n\
         const save = (size) => update((draft) => {{ draft.entries = prices(0, size) }}).then(count, (error) => write(`refused ${{error.message}}`))\n\
         context.keymap.layer(() => ({{ mode: \"global\", commands: [\n\
         {{ id: \"big.small\", title: \"Small\", run: () => save(5) }},\n\
         {{ id: \"big.save\", title: \"Save\", run: () => save(10000) }},\n\
         {{ id: \"big.count\", title: \"Count\", run: count }},\n\
         ] }}))\n\
         }} }}\n"
    );
    std::fs::write(dir.join("tui.ts"), module).unwrap();
    let harness = support::mount(80, 30, Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) });
    let host = opencode_tui::plugins::host::host(&harness.tui);
    let external = External { config_dir: root.path().join("config"), cwd: root.path().to_path_buf(), dev: Vec::new() };
    external_with(&harness.tui, external, Some(config));
    let pipe = Pipe { harness, root };
    pipe.active("example.big");
    pipe.settle();
    let marked = |what: &str, done: &dyn Fn(&str) -> bool| {
        pipe.until(what, || std::fs::read_to_string(&marker).is_ok_and(|text| done(&text)))
    };
    pipe.harness.tui.keymap.dispatch("big.small", None);
    marked("the small value was stored", &|text| text == "5");
    pipe.harness.tui.keymap.dispatch("big.save", None);
    marked("the large value was refused", &|text| text.starts_with("refused"));
    let key = "plugin.example.big.prices";
    opencode_tui::plugins::host::flush_storage(&pipe.harness.tui);
    let stored = opencode_plugin::Host::storage_read(&*host, key).unwrap_or_default();
    let entries = |json: &str| {
        serde_json::from_str::<Value>(json).ok().map(|value| value["entries"].as_object().map_or(0, |map| map.len()))
    };
    assert_eq!(entries(&stored), Some(5), "the host keeps {} bytes", stored.len());
    pipe.harness.tui.keymap.dispatch("big.count", None);
    marked("the store shows what is stored", &|text| text == "5");
    assert_eq!(pipe.status("example.big"), Some(Status::Active));
    let others: serde_json::Map<String, Value> = (0..12_000)
        .map(|index| (format!("other/model-{index}"), serde_json::json!({ "input": index, "note": "y".repeat(80) })))
        .collect();
    let theirs = serde_json::json!({ "entries": others }).to_string();
    opencode_plugin::Host::storage_write(&*host, key, &theirs).unwrap();
    opencode_plugin::Host::storage_changed(&*host);
    pipe.settle();
    pipe.harness.tui.keymap.dispatch("big.count", None);
    marked("the store follows the other client's value", &|text| text == "12000");
    assert_eq!(pipe.status("example.big"), Some(Status::Active));
}

#[test]
fn a_store_update_of_a_value_answered_past_a_frame_keeps_it() {
    let Some(config) = config() else { return };
    let root = opencode_util::temp::tempdir().unwrap();
    let dir = root.path().join("config/plugins/notes");
    std::fs::create_dir_all(&dir).unwrap();
    let (marker, part) = (root.path().join("notes.lengths"), root.path().join("notes.lengths.part"));
    let module = format!(
        "export default {{ id: \"example.notes\", setup(context) {{\n\
         const [store, update] = context.storage.store(\"notes\", {{ initial: {{ items: [] }} }})\n\
         const fs = require(\"node:fs\")\n\
         const write = (text) => {{ fs.writeFileSync({part:?}, text); fs.renameSync({part:?}, {marker:?}) }}\n\
         context.keymap.layer(() => ({{ mode: \"global\", commands: [{{ id: \"notes.append\", title: \"Append\", run: () =>\n\
         update((draft) => {{ draft.items.push(\"tail\") }}).then(() => write(JSON.stringify(store.items.map((item) => item.length))),\n\
         (error) => write(`refused ${{error.message}}`)) }}] }}))\n\
         }} }}\n"
    );
    std::fs::write(dir.join("tui.ts"), module).unwrap();
    let harness = support::mount(80, 30, Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) });
    let host = opencode_tui::plugins::host::host(&harness.tui);
    let key = "plugin.example.notes.notes";
    let quotes = serde_json::json!({ "items": ["\"".repeat(110_000)] }).to_string();
    assert!(quotes.len() < opencode_plugin::storage::VALUE_BYTES);
    opencode_plugin::Host::storage_write(&*host, key, &quotes).unwrap();
    let external = External { config_dir: root.path().join("config"), cwd: root.path().to_path_buf(), dev: Vec::new() };
    external_with(&harness.tui, external, Some(config));
    let pipe = Pipe { harness, root };
    pipe.active("example.notes");
    pipe.settle();
    pipe.harness.tui.keymap.dispatch("notes.append", None);
    // The plugin writes the marker whole, then renames it into place: it shows only with its text (compat-harness).
    pipe.until("the update ended", || marker.exists());
    assert_eq!(std::fs::read_to_string(&marker).unwrap(), "[110000,4]");
    opencode_tui::plugins::host::flush_storage(&pipe.harness.tui);
    let stored: Value = serde_json::from_str(&opencode_plugin::Host::storage_read(&*host, key).unwrap()).unwrap();
    let lengths: Vec<usize> =
        stored["items"].as_array().unwrap().iter().map(|item| item.as_str().unwrap().len()).collect();
    assert_eq!(lengths, [110_000, 4]);
}

/// Unapproved project fixture with a marker written at module evaluation.
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

fn approve(pipe: &Pipe, dir: &Path) {
    let tui = &pipe.harness.tui;
    let target = dir.to_string_lossy().into_owned();
    let Some((Ok(artifact), _)) = opencode_tui::plugins::host::held(tui, &target) else { panic!("nothing is held") };
    assert!(artifact.script, "{artifact:?}");
    assert_eq!(crate::plugin_pipe::decide(&pipe.harness, &target, &artifact, Decision::Approved), Ok(true));
}

struct Registry {
    url: String,
    asked: Arc<std::sync::atomic::AtomicUsize>,
}

impl Registry {
    fn start() -> Self {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/", listener.local_addr().unwrap());
        let asked = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let counted = asked.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                counted.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                drop(stream);
            }
        });
        Self { url, asked }
    }

    fn asked(&self) -> usize {
        self.asked.load(std::sync::atomic::Ordering::SeqCst)
    }

    fn point(&self, config: Config) -> Config {
        let env = ["BUN_CONFIG_REGISTRY", "NPM_CONFIG_REGISTRY", "npm_config_registry"]
            .map(|name| (name.to_owned(), self.url.clone()))
            .to_vec();
        Config { env, ..config }
    }
}

fn missing_package(config: Config) -> (Option<Status>, Option<String>, usize) {
    let registry = Registry::start();
    let root = opencode_util::temp::tempdir().unwrap();
    let dir = root.path().join("config").join("plugins").join("needs");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("tui.ts"),
        "import isNumber from \"is-number-js-no-install-probe\"\nexport default { id: \"example.needs\", setup() { void isNumber } }\n",
    )
    .unwrap();
    let harness = support::mount(100, 30, Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) });
    let work = root.path().join("work");
    std::fs::create_dir_all(&work).unwrap();
    let external = External { config_dir: root.path().join("config"), cwd: work, dev: Vec::new() };
    external_with(&harness.tui, external, Some(registry.point(config)));
    let pipe = Pipe { harness, root };
    pipe.harness.wait("the plugin failed", || {
        pipe.settle();
        matches!(listed(&pipe, &dir, "example.needs"), Some(Status::Failed(_)))
    });
    let toast = pipe.harness.tui.toasts.current().and_then(|toast| toast.title);
    (listed(&pipe, &dir, "example.needs"), toast, registry.asked())
}

/// A failed import must identify the absent package without installing it.
fn assert_installs_nothing((status, toast, asked): (Option<Status>, Option<String>, usize)) {
    let Some(Status::Failed(error)) = &status else { panic!("{status:?}") };
    assert!(
        error.contains("'is-number-js-no-install-probe'")
            && error.contains("not installed")
            && error.contains("opencode-native installs nothing"),
        "{error}"
    );
    assert!(toast.as_deref().is_some_and(|title| title.starts_with("Plugin failed")), "{toast:?}");
    assert_eq!(asked, 0, "Bun asked a registry for the missing package");
}

#[test]
fn a_plugin_importing_a_package_nobody_installed_fails_and_nothing_is_fetched() {
    let Some(config) = config() else { return };
    assert_installs_nothing(missing_package(config));
}

#[test]
fn the_bundled_opencode_as_bun_installs_nothing_either() {
    if config().is_none() {
        return;
    }
    let Some(opencode) = opencode_plugin::pipe::find("opencode") else {
        assert!(std::env::var_os("OPENCODE_RS_REQUIRE_TS").is_none(), "OPENCODE_RS_REQUIRE_TS is set: needs opencode");
        return;
    };
    let home = std::env::var_os("HOME");
    let var = |name: &str| match name {
        "HOME" => home.clone(),
        _ => None,
    };
    let work = opencode_util::temp::tempdir().unwrap();
    let Some(found) =
        Config::find(var, work.path().to_path_buf(), &opencode_plugin::pipe::Server::Remote, Some(opencode.clone()))
    else {
        panic!("{} does not run as Bun", opencode.display())
    };
    assert!(found.opencode, "{found:?}");
    let mut config = config().unwrap();
    config.bun = found.bun;
    config.opencode = true;
    config.bun_version = found.bun_version;
    assert_installs_nothing(missing_package(config));
}

#[test]
fn a_dialog_field_keeps_its_draft_across_a_reload() {
    let Some(config) = config() else { return };
    let (pipe, log) = probe(config);
    let drafts = || calls(&log).into_iter().filter_map(|call| call.get("draft").cloned()).collect::<Vec<_>>();
    pipe.harness.tui.keymap.dispatch("v2probe.draft", None);
    pipe.harness.wait("the field has the focus", || {
        pipe.settle();
        opencode_plugin::behave::mounts(pipe.harness.app.app(), PROBE, "compat.dialog")
            .pop()
            .is_some_and(|mount| mount.focused.as_deref() == Some("draft"))
    });
    pipe.harness.app.type_text("abcd");
    pipe.harness.wait("the field heard abcd", || {
        pipe.settle();
        drafts().last() == Some(&json!("abcd"))
    });
    pipe.harness.app.press("left");
    pipe.harness.app.press("left");
    pipe.harness.tui.keymap.dispatch("v2probe.relayer", None);
    pipe.settle();
    std::thread::sleep(Duration::from_millis(400));
    pipe.harness.wait("the field has the focus again", || {
        pipe.settle();
        opencode_plugin::behave::mounts(pipe.harness.app.app(), PROBE, "compat.dialog")
            .pop()
            .is_some_and(|mount| mount.focused.as_deref() == Some("draft"))
    });
    pipe.harness.app.type_text("X");
    pipe.harness.wait("the field heard the key", || {
        pipe.settle();
        drafts().len() > 4
    });
    assert_eq!(drafts().last(), Some(&json!("abXcd")), "{:?}", drafts());
}

#[test]
fn keys_typed_as_a_dialog_opens_go_to_its_field() {
    let Some(config) = config() else { return };
    let (pipe, log) = probe(config);
    let ahead = || calls(&log).into_iter().filter_map(|call| call.get("ahead").cloned()).collect::<Vec<_>>();
    pipe.harness.app.press("f2");
    pipe.harness.app.type_text("ab");
    pipe.harness.app.wait_until(Duration::from_secs(5), || {
        pipe.settle();
        ahead().last() == Some(&json!("ab"))
    });
    assert_eq!(ahead().last(), Some(&json!("ab")), "{:?}", ahead());
    pipe.harness.tui.dialogs.clear();
    pipe.settle();
    let screen = pipe.harness.app.text();
    let composed = screen.lines().any(|line| line.trim_start_matches([' ', '┃']).starts_with("ab"));
    assert!(!composed, "the keys reached the composer:\n{screen}");
    // A dialog with nothing to focus lets the keys go on as its first view shows, not after the wait's deadline (each
    // turn of a settle is a millisecond of the app's clock).
    pipe.harness.app.press("f3");
    pipe.harness.app.type_text("x");
    pipe.settle();
    let screen = pipe.harness.app.text();
    assert!(screen.contains("Plain dialog"), "{screen}");
    assert!(!pipe.scripts().holds_input(), "the keys wait for a dialog with nothing to focus");
}
