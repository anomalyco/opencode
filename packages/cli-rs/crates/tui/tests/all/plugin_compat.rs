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
use opentui::input::{MouseButton, MouseEventKind};
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

// Expected (`docs/plugins.md`, "Writing a plugin"): the guide's TypeScript example, `examples/pipe/hello`, runs on the
// JS host as its Rust and Luau twins run on their carriers: its line closes the home footer, its command toasts, and a
// click on the line runs the command.
#[test]
fn the_guides_typescript_hello_runs_on_the_js_host() {
    let Some(config) = config() else { return };
    let pipe = open(&[("hello", None)], config, (80, 30));
    pipe.active("example.ts-hello");
    let (app, tui) = (&pipe.harness.app, &pipe.harness.tui);
    pipe.harness.wait("its line closes the home footer", || {
        app.advance(Duration::from_millis(1));
        app.text().lines().any(|line| line.trim_end().ends_with("hello"))
    });
    pipe.settle();
    let toasted = |what: &str| {
        pipe.harness.wait(what, || {
            app.advance(Duration::from_millis(1));
            tui.toasts.current().is_some()
        });
        assert_eq!(toasts(&pipe), ["Hello from a plugin"]);
    };
    tui.keymap.dispatch("hello.greet", None);
    toasted("the command toasts");
    let (x, y) = pipe.harness.find("hello");
    app.click(x, y);
    toasted("a click on the line runs the command");
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
    // The swap ends the JS host, and its round runs again on the next, which a settle while none runs does not wait for
    // (pipe-flakes: under load the last round was not logged yet).
    assert_eq!(logged(&pipe, &log, sent.len()), sent);
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

// Expected: an intrinsic the contract has no node for (`<tab_select>`) throws as it is created, which the boundary reports
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
        [
            "Plugin: example.v2probe crashed in slot home.footer: <tab_select> is not supported by opencode-native's JS host"
        ]
    );
    assert_eq!(pipe.status(PROBE), Some(Status::Active));
}

// Expected: what the layer does not map warns once a plugin and feature in the client's log, shows no toast over the
// plugin's surface, and does nothing; an API that answers whether it did answers false, as TS's `ui.panel.open` does
// outside a session. A warning toast covered `P.8/file-browser`'s route until it timed out, so whether the checkpoint
// saw it depended on the machine's speed.
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

// Expected (contract 2.x, step B, `focus-input` on the pipe): a field a handler shows with `focused` takes the focus
// once the revision that shows it is adopted, though the focus came first, with the handler's effects: what the user
// types then is the field's. The revision is held until the focus has come (`Tamper::Hold`), as a slow frame holds it.
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
    pipe.harness.wait("the call answered", || {
        app.advance(Duration::from_millis(1));
        pipe.scripts().idle()
    });
    // Its revision may come after the answer: a replay before it delivers nothing, and the revision is then held for
    // good (pipe-flakes).
    pipe.harness.wait("the revision is held", || {
        app.advance(Duration::from_millis(1));
        pipe.scripts().kept()
    });
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

// Expected (contract 2.x, step B, the ownership rule of 2.8; big-boi's G2 contrast): a batch the JS host sends as a
// mount's applies to that mount or nowhere. The route opens, closes and opens again, a new mount with the same fields
// `guard` and `same`; with `guard` focused, a focus of `same` that names the closed mount moves nothing, where the same
// focus naming no mount (the activation's) or the new mount focuses `same`.
#[test]
fn a_batch_of_a_closed_mount_moves_nothing_where_the_activations_would() {
    let Some(config) = config() else { return };
    let pipe = raw(config, "closed", CLOSED);
    let (app, tui) = (&pipe.harness.app, &pipe.harness.tui);
    let mounts = || opencode_plugin::behave::mounts(app.app(), "example.closed", "pf");
    let route = Route::Plugin { id: "example.closed".into(), name: "pf".into() };
    for _ in 0..2 {
        tui.navigate(route.clone());
        pipe.harness.wait("the route shows", || {
            app.advance(Duration::from_millis(1));
            app.text().contains("closed page") && mounts().len() == 1
        });
        pipe.settle();
        tui.navigate(Route::Home);
        pipe.harness.wait("the route closes", || {
            app.advance(Duration::from_millis(1));
            mounts().is_empty()
        });
    }
    tui.navigate(route);
    pipe.harness.wait("the route shows again", || {
        app.advance(Duration::from_millis(1));
        mounts().len() == 1
    });
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

/// The TUI with the raw carrier plugin `example.<name>` of `source`, active.
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

// Expected (carbon c2b-1): a call's effects apply in its order, a field's focus that names a mount among them. A
// command that closes the plugin's alert and then focuses a field of its route focuses the field, where the focus came
// first, sent on its own, and the open alert refused it.
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

// Expected (carbon c2b-1): a call that throws asks for nothing, also what it asked for as a mount's: a command that
// opens the command palette as its route's and then throws fails the plugin, and the palette stays closed. What the JS
// host sends is handed over one message at a time, the host running between: an effect sent ahead of the call's throw
// would apply before the throw failed the plugin.
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
        app.advance(Duration::from_millis(1));
        app.render();
        matches!(pipe.status("example.ordered"), Some(Status::Failed(_)))
    });
    pipe.scripts().hold_answers(false);
    pipe.settle();
    assert!(!tui.dialogs.is_open(), "the thrown call's dispatch ran:\n{}", app.text());
}

// Expected (carbon c2b-2): a field's focus that waits for the view showing it is dropped once the user takes the focus
// back meanwhile: the reserved chord, though the composer had the focus already, or a click into another field. The
// home footer's slot shows its field `sp` and focuses it in one call, and the revision that shows it is held until
// then; the composer, or the field clicked, keeps the focus once it comes.
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
        pipe.harness.wait("the call answered", || {
            app.advance(Duration::from_millis(1));
            pipe.scripts().idle()
        });
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

// Expected (cf-3): a reload of the registrations that ends the home footer slot's mount and begins it again gives the
// focus back to the field the plugin focused only if the field still held it as the mount ended, as TS's renderable
// keeps or lost it. With the composer focused by the user meanwhile, the composer keeps it.
#[test]
fn a_reload_gives_the_focus_back_only_to_a_field_that_held_it() {
    let Some(config) = config() else { return };
    let pipe = raw(config, "refocus", REFOCUS);
    let (app, tui) = (&pipe.harness.app, &pipe.harness.tui);
    let focused = || {
        opencode_plugin::behave::mounts(app.app(), "example.refocus", "slot#0").pop().and_then(|mount| mount.focused)
    };
    let reload = || {
        tui.keymap.dispatch("rf.reload", None);
        pipe.settle();
        std::thread::sleep(Duration::from_millis(100));
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

/// The probe of the refocus row, on the TS API: a slot of the home footer with the field `search`; `rf.focus` focuses
/// it, and `rf.reload` registers another layer, which reloads the plugin's registrations.
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

// Expected (contract 2.x, step B, the ownership rule of 2.8): a field's focus is its mount's, and applies to it or
// nowhere: one the JS host sent while the mount was open, which the host takes only after the mount closed, moves
// nothing; the composer the user went back to keeps the focus and what they type.
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

// Expected (contract 2.x, addition 4, on the pipe): a select and then an alert, each sized and centered by `dialog.set`
// right after, as opencode-session-time's `/time`, show extra large and centered.
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

// Expected (the audit's most used layout): a plugin's route draws its bordered, titled box with its padding, the data
// its navigation gave, and a scroll the wheel moves.
#[test]
fn a_route_draws_a_bordered_box_and_a_scroll_with_its_data() {
    let Some(config) = config() else { return };
    let (pipe, _log) = probe(config);
    pipe.harness.tui.keymap.dispatch("v2probe.page", None);
    pipe.settle();
    // The page registers a command as it renders, which settles once the command's 250 ms passed.
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

// Expected: a command a component registers (the page's, after setup) runs while the component is mounted, and goes
// once the component left; the change settles (nothing more crosses while the page stays), and the reads the plugin
// watched before it follow navigation after it.
#[test]
fn a_components_command_lives_with_its_mount_across_a_reload() {
    let Some(config) = config() else { return };
    let (pipe, log) = probe(config);
    let tui = &pipe.harness.tui;
    assert_eq!(line(&pipe, "v2probe route").as_deref(), Some("v2probe route home"));
    tui.keymap.dispatch("v2probe.page", None);
    pipe.settle();
    // The change the page's command made settles within the 250 ms a command lingers.
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

// Expected (CT-1): a page whose layer's commands have no `id`, as tokscope's, draws and settles: its commands change in
// place, once. They named them anew each mount, and each reload mounted the page again, about 1,000 times a second.
#[test]
fn a_page_whose_commands_have_no_id_draws_and_settles() {
    let Some(config) = config() else { return };
    let (pipe, log) = probe(config);
    let tui = &pipe.harness.tui;
    tui.keymap.dispatch("v2probe.inline", None);
    pipe.settle();
    std::thread::sleep(Duration::from_millis(400));
    pipe.settle();
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

// Expected (CT-21): a page that names its layer's command anew each time it mounts, as opencode-navigator does, draws
// and settles: its command changes in place, which mounts nothing again. Each reload mounted it again, and it failed at
// the 64-changes bound.
#[test]
fn a_page_that_names_its_commands_anew_each_mount_settles() {
    let Some(config) = config() else { return };
    let (pipe, _log) = probe(config);
    pipe.harness.tui.keymap.dispatch("v2probe.churn", None);
    pipe.settle();
    std::thread::sleep(Duration::from_millis(400));
    pipe.settle();
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

// Expected (CT-1, containment): a plugin whose registrations change without end (its page registers a new command every
// 20 ms) fails, named, rather than reload without end; the client goes on.
#[test]
fn a_plugin_whose_registrations_never_settle_fails() {
    let Some(config) = config() else { return };
    let (pipe, _log) = probe(config);
    pipe.harness.tui.keymap.dispatch("v2probe.restless", None);
    pipe.harness.wait("the churn failed the plugin", || {
        pipe.harness.app.advance(Duration::from_millis(1));
        matches!(pipe.status(PROBE), Some(Status::Failed(_)))
    });
    let Some(Status::Failed(error)) = pipe.status(PROBE) else { unreachable!() };
    assert!(error.contains("changed its registrations more than 64 times"), "{error}");
}

// Expected (ports_trio's session-manager search lost a letter): a change of a plugin's commands alone, here the layer of
// a component the first letter typed mounts, replaces their keys in place, as TS's keymap follows a layer: the plugin's
// route keeps its mount, so its field keeps the focus and every key typed into it. Each change reloaded the plugin and
// mounted the route again, whose new field took the focus a round trip later; the keys between went nowhere.
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
    pipe.settle();
    // Past the 250 ms a command the plugin dropped lingers.
    std::thread::sleep(Duration::from_millis(400));
    pipe.settle();
    assert!(app.text().contains("query notes."), "{}", app.text());
    assert_eq!(focused(), field, "the field was built again");
    assert!(matches!(tui.keymap.dispatch("v2probe.clear", None), opentui::keymap::RunResult::Ok));
    pipe.harness.wait_for("not searching");
    assert_eq!(pipe.status(PROBE), Some(Status::Active));
}

// Expected (CT-29): a session panel whose render registers a key layer, as opencode-self-improvement's /memory panel
// does, stays open: the command it registers changes in place. A reload closed it, so `/memory` showed nothing.
#[test]
fn a_session_panel_stays_open_across_a_reload() {
    let Some(config) = config() else { return };
    let log = log_file();
    let options = json!({ "log": log.to_string_lossy() });
    let server = Arc::new(support::Fake::new(|seen| support::base(seen, support::DIRECTORY)));
    let pipe = crate::plugin_pipe::open_on(&[("v2probe", Some(options))], config, (120, 30), Vec::new(), server);
    pipe.active(PROBE);
    pipe.harness.tui.navigate(Route::Session { id: opencode_api::generated::SessionID("ses_a".into()) });
    pipe.harness.wait("the session shows", || {
        pipe.harness.app.advance(Duration::from_millis(1));
        matches!(pipe.harness.tui.route(), Route::Session { .. })
    });
    pipe.settle();
    pipe.harness.tui.keymap.dispatch("v2probe.panel", None);
    assert_eq!(logged(&pipe, &log, 1), [json!({ "opened": true })]);
    pipe.settle();
    std::thread::sleep(Duration::from_millis(400));
    pipe.settle();
    let shows = || pipe.harness.app.text().contains("probe panel probe.panel");
    pipe.harness.wait("the panel shows", || {
        pipe.harness.app.advance(Duration::from_millis(1));
        shows()
    });
    assert!(pipe.harness.tui.panels.current().is_some(), "the panel closed");
    assert_eq!(pipe.status(PROBE), Some(Status::Active));
}

// Expected (O-170): a plugin that imports the `effect` package fails to load alone, naming the package, and the client
// goes on: the JS host serves what the TUI plugin API defines, not libraries a plugin expects the host to happen to
// have. The row held the opposite when the host served effect (CT-13).
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

// Expected (contract 2.x, addition 1, R3): a page that sizes its box from its own width, a cell wider each time, is
// held after 8 frames in a row of rect pushes with no other cause: its `onSizeChange` runs a bounded number of times,
// and the plugin stays active. A page that settles after one change ends at that width and hears no more.
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

// Expected (the key hold's bound): a printable key a JS command binds globally, whose handler stalls the JS host for
// 1.5 s. The keys after it wait no longer than the hold's limit (50 ms): then the bound key goes on as declined, first,
// and the keys typed after it, in order. While the JS host is still stalled, the next bound key goes on at once, and its
// command runs late. The late answers put nothing back, and once the JS host answered, a bound key holds again.
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

// Measures how long a key a JS command binds and declines takes to reach the composer: the whole hold, a round trip to
// the real JS host and the key routed on. Real time only, as the manual clock stands still, so the hold's limit never
// cuts it short. `KEY_HOLD_PRESSES` sets the count (300).
#[test]
#[ignore = "a measurement: run with --ignored --nocapture"]
fn measure_the_key_hold() {
    let Some(config) = config() else { return };
    let (pipe, _log) = probe(config);
    let harness = &pipe.harness;
    let presses: usize = std::env::var("KEY_HOLD_PRESSES").ok().and_then(|count| count.parse().ok()).unwrap_or(300);
    let mut took = Vec::with_capacity(presses);
    for press in 0..presses {
        let before = harness.text().len();
        let begun = std::time::Instant::now();
        harness.app.type_text("%");
        assert!(harness.app.wait_until(Duration::from_secs(5), || harness.text().len() > before), "press {press} held");
        took.push(begun.elapsed());
    }
    took.sort();
    let at = |share: f64| took[((took.len() - 1) as f64 * share) as usize];
    println!(
        "key hold over {presses} presses: median {:?}, p95 {:?}, p99 {:?}, worst {:?}",
        at(0.5),
        at(0.95),
        at(0.99),
        took[took.len() - 1]
    );
}

// Expected (contract ergonomics 2.5; CT-8, the key hold): a key whose JS command is disabled is bound by nothing on the
// host, so it reaches the composer in the frame it is typed, with no round trip to the JS host held for it. Enabled,
// the command takes it; disabled again, the key goes on at once. Neither change reloads the plugin: its activation
// stays the one it was.
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

// Expected (carbon ce-5): a JS host that started again sets the plugin up afresh, and its commands take the states that
// setup gives them: `^`'s command, enabled before, is disabled again, so the palette lists it nowhere, where the host
// kept it enabled because the restarted setup's manifest was the first one's.
#[test]
fn a_restarted_js_hosts_commands_take_its_setups_states() {
    let Some(config) = config() else { return };
    let (pipe, _log) = probe(config);
    let (harness, tui) = (&pipe.harness, &pipe.harness.tui);
    let reachable = || tui.keymap.commands().iter().any(|command| command.id == "v2probe.caret");
    tui.keymap.dispatch("v2probe.caretOn", Some("on"));
    pipe.settle();
    assert!(reachable(), "the enabled command is not reachable");
    let pid = pipe.scripts().pid();
    // The swapped call ends the JS host as the next one comes.
    pipe.scripts().fault(Fault::Swap);
    tui.keymap.dispatch("v2probe.add", Some("x"));
    tui.keymap.dispatch("v2probe.add", Some("y"));
    harness.wait("the JS host started again", || {
        harness.app.advance(Duration::from_millis(1));
        pipe.scripts().pid().is_some_and(|now| Some(now) != pid)
    });
    pipe.settle();
    assert_eq!(pipe.status(PROBE), Some(Status::Active));
    assert!(!reachable(), "the restarted plugin's disabled command is reachable");
}

// Expected (carbon ce-5): a command enabled after a reload of the plugin's registrations was sent, but before the host
// took it, is enabled on the guest that takes the plugin over. Everything the JS host sends is handed over at once, so
// the `set-enabled` comes to the guest that handed over, and `^` is taken.
#[test]
fn a_state_set_as_the_registrations_reload_goes_to_the_new_guest() {
    let Some(config) = config() else { return };
    let (pipe, log) = probe(config);
    let (harness, tui) = (&pipe.harness, &pipe.harness.tui);
    pipe.scripts().hold_answers(true);
    tui.keymap.dispatch("v2probe.lateCaret", None);
    harness.wait("the reload and the state came", || {
        harness.app.advance(Duration::from_millis(1));
        let types = pipe.scripts().held_types();
        types
            .iter()
            .position(|kind| kind == "manifest")
            .is_some_and(|at| types[at..].iter().any(|kind| kind == "effects"))
    });
    pipe.scripts().hold_answers(false);
    pipe.settle();
    harness.app.type_text("^");
    pipe.settle();
    assert_eq!((harness.text(), calls(&log)), (String::new(), vec![json!({ "caret": true })]));
}

// Expected (contract gaps 2): a JS plugin's key listener takes its key with `preventDefault`. Not taken, `ctrl+p` goes
// on to the host's palette once the JS host answered; taken, no palette opens. The listener hears it once each time.
#[test]
fn a_js_listener_takes_its_key_with_prevent_default() {
    let Some(config) = config() else { return };
    let (pipe, log) = probe(config);
    let (harness, tui) = (&pipe.harness, &pipe.harness.tui);
    let mut seen = Vec::new();
    for step in ["pass", "take"] {
        tui.keymap.dispatch("v2probe.listen", Some(step));
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
    /// What the native listeners of [`hearing`] heard, `above:<key>` and `below:<key>`.
    static HEARD: std::cell::RefCell<Vec<String>> = const { std::cell::RefCell::new(Vec::new()) };
}

/// A linked plugin with two global listeners of every key, one above the JS host's listeners and one below, which
/// hear and pass each key.
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

// Expected (cg2-5): a key a JS listener takes and lets go is heard once by every native listener, above it and below
// it: the key it puts back resumes below the listeners that heard it.
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
    pipe.harness.tui.keymap.dispatch("v2probe.listen", Some("pass"));
    pipe.settle();
    HEARD.with(|heard| heard.borrow_mut().clear());
    pipe.harness.app.press("ctrl+o");
    pipe.settle();
    let heard = HEARD.with(|heard| std::mem::take(&mut *heard.borrow_mut()));
    assert_eq!(heard, ["above:ctrl+o", "below:ctrl+o"]);
}

// Expected (cg2-1): what the user types into the composer never waits for a JS listener of every key, even one that
// can take keys: with every answer of the JS host held back, the letters show at once; a key it may take still waits.
#[test]
fn composer_typing_never_waits_for_a_js_key_listener() {
    let Some(config) = config() else { return };
    let (pipe, _log) = probe(config);
    let (harness, tui) = (&pipe.harness, &pipe.harness.tui);
    // The first run registers the listener, which reloads the plugin's registrations once.
    for step in ["pass", "take"] {
        tui.keymap.dispatch("v2probe.listen", Some(step));
        pipe.settle();
    }
    pipe.scripts().hold_answers(true);
    harness.app.type_text("ab");
    assert_eq!(harness.text(), "ab", "the typing waited for the JS host");
    harness.app.press("ctrl+p");
    assert!(!tui.dialogs.is_open(), "the key the listener may take did not wait for it");
    pipe.scripts().hold_answers(false);
    pipe.settle();
    assert!(!tui.dialogs.is_open(), "the listener did not take its key");
}

// Expected (ce-4): a JS palette command whose key declines is still listed as the palette that key opens shows.
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

// Expected (the key hold's bound): a JS host that ends while it holds keys releases them at once, the bound key first
// as declined, even under a hold limit far longer than the test; its command is not sent again.
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
    harness.wait("the ended JS host released the keys", || {
        harness.app.advance(Duration::from_millis(1));
        harness.text() == "%ab"
    });
    // The plugin whose command ended it fails, blamed, as any such does.
    harness.wait("the end was noticed", || {
        harness.app.advance(Duration::from_millis(1));
        pipe.scripts().pid() != pid && matches!(pipe.status(PROBE), Some(Status::Failed(_)))
    });
    pipe.settle();
    assert_eq!(harness.text(), "%ab");
    assert!(!calls(&log).iter().any(|call| call.get("percent").is_some()), "{:?}", calls(&log));
}

// Expected (big-boi's catalog recheck): an activation a reload handed the JS host's activation to owns the dialogs of the
// one before it (FT-4); a plugin disabled and enabled again runs a fresh setup, whose activation owns its own dialogs
// alone, not those of the activations before it. It took on the reload's chain, and claimed them.
#[test]
fn a_fresh_activation_owns_only_its_own_dialogs() {
    let Some(config) = config() else { return };
    let (pipe, _log) = probe(config);
    let tui = &pipe.harness.tui;
    let owned = || (1..512).filter(|generation| tui.plugins.owns(PROBE, *generation)).collect::<Vec<u64>>();
    let live = || (1..512).find(|generation| tui.plugins.live(PROBE, *generation));
    // A store made after setup declares its key, a registration: a reload, which hands the activation on. A command
    // alone (the page's layer) changes in place.
    tui.keymap.dispatch("v2probe.late", None);
    pipe.settle();
    std::thread::sleep(Duration::from_millis(400));
    pipe.settle();
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

/// The status of the project plugin `dir`: its entry by its directory until it loads (named by its package, if it has
/// one, CT-6), then by `id`.
fn listed(pipe: &Pipe, dir: &Path, id: &str) -> Option<Status> {
    let target = dir.to_string_lossy();
    let entries = pipe.harness.tui.plugins.entries().into_iter();
    let unloaded = |entry: &opencode_plugin::Entry| entry.key == format!("target:{target}");
    entries.filter(|entry| entry.id == target || unloaded(entry) || entry.id == id).map(|entry| entry.status).next()
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

// Expected (CT-3, CT-4): a server plugin's TUI part as delayed-message's is written loads and calls its server's RPC,
// as in TS: it imports Solid and OpenTUI's JSX runtime by OpenTUI's runtime registry names, the encoded and the plain
// spelling, defines its RPC with `@opencode/plugin/rpc`, and `client.rpc` calls `/api/rpc/<id>/<method>`. It failed
// with "Cannot find package 'opentui:runtime-module:solid-js'", and `client.rpc` was not a function.
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
    pipe.harness.wait("the RPC answered", || {
        pipe.harness.app.advance(Duration::from_millis(1));
        std::fs::read_to_string(&log).is_ok_and(|text| text.ends_with('\n'))
    });
    assert_eq!(std::fs::read_to_string(&log).unwrap(), "{\"said\":\"hi\"}\n");
    let called = requests.lock().unwrap().iter().find(|seen| seen.path == "/api/rpc/echo/say").cloned().unwrap();
    assert_eq!((called.method.as_str(), called.body), ("POST", json!({ "input": { "text": "hi" } })));
    pipe.harness.wait_for("rpc hi");
}

// Expected (CT-6): a local TypeScript plugin that fails to load is listed by its package's name, as a skipped one is
// (FT-15), not by its directory's path.
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
    pipe.harness.wait("the load failed", || {
        pipe.harness.app.advance(Duration::from_millis(1));
        entry().is_some_and(|entry| matches!(entry.status, Status::Failed(_)))
    });
    let entry = entry().unwrap();
    assert_eq!(entry.id, "opencode-broken-thing", "{entry:?}");
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

/// A registry that answers nothing and counts the connections made to it: Bun pointed at it shows whether it asked
/// npm for anything (js-no-install).
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

    /// `config` with Bun pointed at this registry.
    fn point(&self, config: Config) -> Config {
        let env = ["BUN_CONFIG_REGISTRY", "NPM_CONFIG_REGISTRY", "npm_config_registry"]
            .map(|name| (name.to_owned(), self.url.clone()))
            .to_vec();
        Config { env, ..config }
    }
}

/// A global plugin with no `node_modules` whose module imports a package nobody installed, loaded on a JS host that
/// runs as `config` says, with Bun pointed at a registry that counts what it is asked; its status, the toast told, and
/// how often the registry was asked.
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

/// What [`missing_package`] must find: the plugin failed, saying which package is missing and that nothing is
/// installed, the user was told, and no registry was asked.
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

// Expected (js-no-install, Simon's rule: npm plugins load, nothing is installed): a plugin whose directory has no
// `node_modules` and that imports a package nobody installed fails to load, saying which package and that
// opencode-native installs nothing; the startup's failure toast and `/plugins` show it, and Bun asks no registry for
// it, which it did with its auto-install on.
#[test]
fn a_plugin_importing_a_package_nobody_installed_fails_and_nothing_is_fetched() {
    let Some(config) = config() else { return };
    assert_installs_nothing(missing_package(config));
}

// Expected (js-no-install): the same on the JS host the bundled opencode binary gives, run as the Bun it embeds
// (`BUN_BE_BUN=1`), which parses Bun's flags and bunfig itself: `Config::find`'s bundled path, with no `bun` on the
// path.
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
