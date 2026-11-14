//! P6a: the built-ins on contract 2.0 (synthesis 4.14), with the properties of what they use. `work`: a streamed
//! delta and a theme switch build nothing in them. `ledger`: a built-in disabled at run time holds no mount and draws
//! as one disabled from the start. `lifecycle` and `delivery`: a surface hears its mounts begin and end in order, and
//! each view hears what changed since the last. Their frames are E.14's, on both carriers (`app::scenarios`).

use crate::support::{self, DIRECTORY, Fake, Harness};

use std::cell::{Cell, RefCell};
use std::sync::Arc;
use std::time::Duration;

use opencode_api::generated::V2Event;
use opencode_plugin::abi::interact::{Event, Handled};
use opencode_plugin::abi::v2::{Node, Place, Surface};
use opencode_plugin::abi::{self, Changed, Command, Placement, Span};
use opencode_plugin::{reconcile, slot, surface};
use opencode_tui::Deps;
use serde_json::{Value, json};

/// `ses_a` with the sidebar docked, the prompt footer and the getting started card; `plugins` is the config's list.
fn session(plugins: &[&str], extra: Vec<opencode_plugin::Builtin>) -> Harness {
    let config = json!({ "animations": false, "plugins": plugins });
    let mut builtins = support::deps(Arc::new(support::empty())).builtins;
    builtins.extend(extra);
    let deps = Deps {
        config: support::config(support::decode(&config.to_string())),
        builtins,
        ..support::deps(Arc::new(Fake::new(|seen| support::base(seen, DIRECTORY))))
    };
    let harness = support::mount(170, 34, deps);
    // The card shows once the integrations loaded; without the footer that draws it, the location stands in.
    harness.wait_for(match plugins.contains(&"-opencode.sidebar.footer") {
        true => "Fix the parser",
        false => "Getting started",
    });
    settle(&harness);
    harness
}

fn settle(harness: &Harness) {
    for _ in 0..3 {
        harness.app.advance(Duration::from_millis(1));
        harness.app.render();
    }
}

fn event(kind: &str, seq: u64, data: Value) -> V2Event {
    serde_json::from_value(json!({
        "id": format!("evt_{seq}"), "created": 10_000_000 + seq, "type": kind,
        "durable": { "aggregateID": "ses_a", "seq": seq, "version": 1 },
        "data": data,
    }))
    .unwrap()
}

/// Starts a reply in `ses_a` and streams `count` text deltas into it, a frame after each.
fn stream(harness: &Harness, count: u64) {
    let id = "msg_live";
    harness.tui.data.apply(&[event(
        "session.step.started",
        1,
        json!({ "sessionID": "ses_a", "assistantMessageID": id, "agent": "build",
                "model": { "providerID": "p", "id": "m" }, "started": 1 }),
    )]);
    let started = json!({ "sessionID": "ses_a", "assistantMessageID": id, "ordinal": 0 });
    harness.tui.data.apply(&[event("session.text.started", 2, started)]);
    settle(harness);
    let before = reconcile::work();
    for index in 0..count {
        let delta =
            json!({ "sessionID": "ses_a", "assistantMessageID": id, "ordinal": 0, "delta": format!("w{index} ") });
        harness.tui.data.apply(&[event("session.text.delta", 3 + index, delta)]);
        settle(harness);
    }
    let work = reconcile::work().since(before);
    assert_eq!(work, reconcile::Work::default(), "streamed deltas worked in the built-ins");
    assert!(harness.app.text().contains(&format!("w{} ", count - 1)), "{}", harness.app.text());
}

// Expected (`work`, per streamed update): a delta that changes nothing a built-in shows builds, sets, moves and keeps
// nothing in their trees: each view answers a keep of its root, which the host takes with no work. The counters are
// the host's, and only plugin trees count in them.
#[test]
fn a_streamed_delta_does_no_work_in_the_built_ins() {
    stream(&session(&[], Vec::new()), 20);
}

// Expected (`work`, a theme switch): a switch to a theme of another name builds and drops no widget of a built-in: they
// read no palette, so the host restyles their trees in place, and a view that reads the theme's name keeps its tree.
#[test]
fn a_theme_switch_builds_nothing_in_the_built_ins() {
    for route in [opencode_tui::Route::Home, support::session_route("ses_a")] {
        let harness = session(&[], Vec::new());
        harness.tui.navigate(route.clone());
        settle(&harness);
        let before = reconcile::work();
        assert!(harness.tui.theme.borrow_mut().set("tokyonight"));
        harness.tui.theme_changed();
        settle(&harness);
        let work = reconcile::work().since(before);
        assert_eq!((work.created, work.removed), (0, 0), "{route:?}: {work:?}");
    }
}

/// The built-ins with a 2.0 surface on the session route.
const SESSION: [&str; 7] = [
    "opencode.prompt.footer",
    "opencode.btw",
    "opencode.sidebar.context",
    "opencode.sidebar.limit",
    "opencode.sidebar.mcp",
    "opencode.sidebar.todo",
    "opencode.sidebar.footer",
];

// Expected (`ledger`): each built-in disabled while its surfaces show holds no mount after, and the screen equals the
// session opened with that built-in disabled in the config (the twin); enabled again, it holds what it held. On Home,
// the same for the home footer.
#[test]
fn a_disabled_built_in_holds_nothing_and_draws_as_one_never_enabled() {
    let mut cases: Vec<(&str, bool)> = SESSION.iter().map(|id| (*id, false)).collect();
    cases.push(("opencode.home.footer", true));
    for (id, home) in cases {
        let open = |plugins: &[&str]| {
            let harness = session(plugins, Vec::new());
            if home {
                harness.tui.navigate(opencode_tui::Route::Home);
                settle(&harness);
            }
            harness
        };
        let harness = open(&[]);
        let held = surface::ledger_of(id);
        assert!(held.mounts > 0, "{id} holds no mount: {held:?}");
        // As the plugin manager toggles: the route mounts again with the plugins' claims.
        let toggle = |active| {
            let host = opencode_tui::plugins::host::host(&harness.tui);
            assert_eq!(harness.tui.plugins.toggle(&host, id, active), Some(Ok(())), "{id}");
            harness.tui.navigate(harness.tui.route());
            settle(&harness);
        };
        toggle(false);
        // Home's placeholder example is random (P-APP masks it).
        let screen = |harness: &Harness| {
            let text = harness.app.render().text();
            text.lines().filter(|line| !line.contains("Ask anything")).collect::<Vec<_>>().join("\n")
        };
        let shown = screen(&harness);
        let disabled = format!("-{id}");
        let twin = open(&[disabled.as_str()]);
        assert_eq!(shown, screen(&twin), "{id}: the screen differs from the twin's");
        drop(twin);
        assert_eq!(surface::ledger_of(id), surface::Ledger::default(), "{id} holds what it held");
        toggle(true);
        assert_eq!(surface::ledger_of(id).mounts, held.mounts, "{id} enabled again");
    }
}

thread_local! {
    /// What the probe heard and viewed, in order.
    static HEARD: RefCell<Vec<String>> = const { RefCell::new(Vec::new()) };
    /// The probe's view keeps its root unless it hears `all`, as a built-in's does.
    static KEEPING: Cell<bool> = const { Cell::new(false) };
    /// The probe's next view names a keep the host does not hold, which the host refuses.
    static BREAK: Cell<bool> = const { Cell::new(false) };
}

fn heard() -> Vec<String> {
    HEARD.with(|heard| heard.take())
}

/// A slot surface in the prompt's status row that hears its mounts and logs them and each view: the plugin's own log.
fn probe(setup: &mut abi::Setup) -> Result<(), String> {
    setup.storage_key("state");
    setup.command(Command { name: "probe.write".into(), ..Command::default() }, |host, _| {
        host.storage_merge("state", serde_json::Map::from_iter([("n".to_owned(), json!(1))]));
    });
    let surface = Surface::new("probe", Place::Slot(Placement::append(slot::PROMPT_FOOTER_STATUS)), |cx| {
        let shell = cx.input.slot.as_ref().and_then(|slot| slot.prompt).is_some_and(|prompt| prompt.shell);
        let line = format!("view {} shell {shell} {}", cx.mount.generation, said(&cx.input.changed));
        HEARD.with(|heard| heard.borrow_mut().push(line));
        if BREAK.replace(false) {
            return Node::Keep { key: "gone".into() };
        }
        if KEEPING.get() && !cx.input.changed.all {
            return Node::Keep { key: "root".into() };
        }
        Node::text([Span::new("probe")]).with_id("root")
    })
    .mounts()
    .on(|_, event| {
        if let Event::Mount { mounted, slot } = event {
            let shell = slot.as_ref().and_then(|slot| slot.prompt).is_some_and(|prompt| prompt.shell);
            let session = slot.as_ref().and_then(|slot| slot.session_id.clone()).unwrap_or_default();
            HEARD.with(|heard| heard.borrow_mut().push(format!("mount {mounted} {session} shell {shell}")));
        }
        Handled::Pass
    });
    setup.surface(surface);
    Ok(())
}

/// What a view heard changed, in short.
fn said(changed: &Changed) -> String {
    let mut said = Vec::new();
    for (on, name) in [(changed.all, "all"), (changed.local, "local"), (changed.size, "size"), (changed.woken, "woken")]
    {
        if on {
            said.push(name.to_owned());
        }
    }
    said.extend(changed.messages.iter().map(|(session, message)| format!("{session}/{message}")));
    said.join(",")
}

/// The generation in a `view` line.
fn generation(line: &str) -> u64 {
    line.split(' ').nth(1).and_then(|number| number.parse().ok()).unwrap_or_default()
}

// Expected (`lifecycle`): a surface that asks hears each mount begin before its first view, which hears `all`, and end
// after the next mount began (the prompt mounts its footer again as shell mode turns on and off); once its plugin is
// disabled it hears nothing, not even the end of its mount. The reference is the sequence written out; the log is the
// plugin's own.
#[test]
fn a_surface_hears_its_mounts_begin_and_end_in_order() {
    let probe = abi::Plugin { id: "test.probe", setup: probe }.into();
    let harness = session(&[], vec![probe]);
    let first: Vec<String> =
        heard().into_iter().filter(|line| !line.starts_with("view") || line.contains("all")).collect();
    assert_eq!(first.first().map(String::as_str), Some("mount true ses_a shell false"), "{first:?}");
    assert!(first.get(1).is_some_and(|line| line.contains("shell false all")), "{first:?}");
    let opened = generation(&first[1]);
    harness.app.type_text("!");
    harness.wait_for("esc exit shell mode");
    settle(&harness);
    harness.app.press("escape");
    harness.wait_gone("exit shell mode");
    settle(&harness);
    let log: Vec<String> =
        heard().into_iter().filter(|line| !line.starts_with("view") || line.contains("all")).collect();
    let views: Vec<u64> = log.iter().filter(|line| line.starts_with("view")).map(|line| generation(line)).collect();
    assert!(views.len() == 2 && views[0] > opened && views[1] > views[0], "{log:?}");
    let expected = [
        "mount true ses_a shell true".to_owned(),
        format!("view {} shell true all", views[0]),
        "mount false ses_a shell false".to_owned(),
        "mount true ses_a shell false".to_owned(),
        format!("view {} shell false all", views[1]),
        "mount false ses_a shell true".to_owned(),
    ];
    // A first view also hears the change of the host's own state since the mount's last view: `local`.
    let log: Vec<String> = log.into_iter().map(|line| line.replace(",local", "")).collect();
    assert_eq!(log, expected);
    let host = opencode_tui::plugins::host::host(&harness.tui);
    assert_eq!(harness.tui.plugins.toggle(&host, "test.probe", false), Some(Ok(())));
    harness.tui.navigate(harness.tui.route());
    settle(&harness);
    harness.app.type_text("!");
    harness.wait_for("esc exit shell mode");
    settle(&harness);
    assert_eq!(heard(), Vec::<String>::new(), "a disabled plugin heard its mounts");
    assert_eq!(surface::ledger_of("test.probe"), surface::Ledger::default());
}

// Expected (`delivery`): each view hears what changed since the one before, once: a streamed delta names its message;
// the plugin's own command is `woken`, and the storage write it made is `local` in that same view, as its notice, which
// comes later, calls no view once the view ran.
#[test]
fn a_view_hears_what_changed_since_the_last() {
    let probe = abi::Plugin { id: "test.probe", setup: probe }.into();
    let harness = session(&[], vec![probe]);
    heard();
    harness.tui.data.apply(&[event(
        "session.step.started",
        1,
        json!({ "sessionID": "ses_a", "assistantMessageID": "msg_live", "agent": "build",
                "model": { "providerID": "p", "id": "m" }, "started": 1 }),
    )]);
    let started = json!({ "sessionID": "ses_a", "assistantMessageID": "msg_live", "ordinal": 0 });
    harness.tui.data.apply(&[event("session.text.started", 2, started)]);
    settle(&harness);
    heard();
    let delta = json!({ "sessionID": "ses_a", "assistantMessageID": "msg_live", "ordinal": 0, "delta": "x" });
    harness.tui.data.apply(&[event("session.text.delta", 3, delta)]);
    settle(&harness);
    let deltas: Vec<String> = heard().into_iter().filter(|line| line.contains("msg_live")).collect();
    assert_eq!(deltas.len(), 1, "{deltas:?}");
    assert!(deltas[0].ends_with("shell false ses_a/msg_live"), "{deltas:?}");
    harness.tui.keymap.dispatch("probe.write", None);
    settle(&harness);
    let after: Vec<String> = heard();
    assert_eq!(
        after.first().map(|line| line.split(' ').skip(4).collect::<Vec<_>>().join(" ")),
        Some("local,woken".into())
    );
    assert!(after.iter().skip(1).all(|line| !line.contains("local")), "the write was heard twice: {after:?}");
    // A tree the host refuses is asked for again whole, and that view hears `all`: one that keeps its root unless told
    // so builds it, and the plugin stays active.
    KEEPING.set(true);
    BREAK.set(true);
    harness.tui.keymap.dispatch("probe.write", None);
    settle(&harness);
    let retried: Vec<String> = heard();
    assert!(retried.len() >= 2 && retried[1].contains(" all"), "{retried:?}");
    let status = harness.tui.plugins.entries().into_iter().find(|entry| entry.id == "test.probe").unwrap().status;
    assert_eq!(status, opencode_plugin::Status::Active);
    assert!(harness.app.render().text().contains("probe"));
    KEEPING.set(false);
}
