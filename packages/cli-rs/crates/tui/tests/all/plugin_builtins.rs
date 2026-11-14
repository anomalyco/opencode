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
// the host's, and only plugin trees count in them. A tree built again equal to the last is no work to the host, so on
// the C ABI carrier each view also crosses no more than a keep (review carbon-7): one call a surface, a few dozen bytes
// back, where a section built again sends its whole tree.
#[test]
fn a_streamed_delta_does_no_work_in_the_built_ins() {
    stream(&session(&[], Vec::new()), 20);
    let crossed = stream_crossed(&history(0, true), 20);
    assert_eq!(crossed.calls, 20 * SESSION.len() as u64, "{crossed:?}");
    assert!(crossed.received <= crossed.calls * KEEP_BYTES, "{crossed:?}");
}

/// The most a view's reply that keeps its root crosses the C ABI, in bytes.
const KEEP_BYTES: u64 = 96;

/// `ses_a` with `turns` question and answer pairs before, each answer with its tokens, on the C ABI carrier when `abi`.
fn history(turns: u64, abi: bool) -> Harness {
    let messages: Vec<Value> = (1..=turns)
        .rev()
        .flat_map(|turn| {
            let created = turn * 10_000;
            [
                json!({
                    "id": format!("msg_{turn:04}b"), "type": "assistant", "agent": "build",
                    "model": { "providerID": "p", "id": "m" },
                    "time": { "created": created + 1000, "completed": created + 2000 }, "finish": "stop",
                    "tokens": { "input": 100, "output": 10, "reasoning": 0, "cache": { "read": 0, "write": 0 } },
                    "content": [{ "type": "text", "text": format!("Answer {turn} one.\n\nAnswer {turn} two.") }],
                }),
                json!({ "id": format!("msg_{turn:04}a"), "type": "user", "text": format!("Question {turn}"),
                        "time": { "created": created } }),
            ]
        })
        .collect();
    let fake = Fake::new(move |seen| match (seen.method.as_str(), seen.path.as_str()) {
        ("GET", "/api/session/ses_a/message") => (200, json!({ "data": messages, "cursor": {} })),
        _ => support::base(seen, DIRECTORY),
    });
    let deps = Deps {
        config: support::config(support::decode(r#"{ "animations": false }"#)),
        abi_builtins: abi,
        ..support::deps(Arc::new(fake))
    };
    let harness = support::mount(170, 34, deps);
    harness.wait_for("Getting started");
    if turns > 0 {
        harness.wait_for(&format!("Answer {turns} two."));
    }
    settle(&harness);
    harness
}

// Expected (`work`, per streamed update, on the C ABI carrier): a delta costs the built-ins the same calls and bytes
// across the carrier with no history as with 200 turns before it. A view reads the message that changed, not the
// session (P6a review, big-boi high 2). The counters are the loader's.
#[test]
fn a_streamed_delta_crosses_the_same_bytes_at_any_history() {
    let per_delta = |turns| {
        let harness = history(turns, true);
        stream_crossed(&harness, 20)
    };
    let (none, long) = (per_delta(0), per_delta(200));
    assert_eq!(none.calls, long.calls, "{none:?} {long:?}");
    // The requests name mount generations and request ids, process-wide counters whose digits grow with whatever ran
    // before (other tests in parallel): a tenth is slack for those. A read of the session at 200 turns copies all 400
    // messages on every delta, many times what a delta crosses.
    let bound = |bytes: u64| bytes + bytes / 10;
    assert!(long.sent <= bound(none.sent) && long.received <= bound(none.received), "{none:?} {long:?}");
}

/// What crossed the C ABI while `count` deltas streamed into a reply of `ses_a`.
fn stream_crossed(harness: &Harness, count: u64) -> opencode_plugin::loader::native::Crossed {
    let id = "msg_live";
    let started = json!({ "sessionID": "ses_a", "assistantMessageID": id, "agent": "build",
                          "model": { "providerID": "p", "id": "m" }, "started": 1 });
    harness.tui.data.apply(&[event("session.step.started", 1, started)]);
    let text = json!({ "sessionID": "ses_a", "assistantMessageID": id, "ordinal": 0 });
    harness.tui.data.apply(&[event("session.text.started", 2, text)]);
    settle(harness);
    let (before, work) = (opencode_plugin::loader::native::crossed(), reconcile::work());
    for index in 0..count {
        let delta =
            json!({ "sessionID": "ses_a", "assistantMessageID": id, "ordinal": 0, "delta": format!("w{index} ") });
        harness.tui.data.apply(&[event("session.text.delta", 3 + index, delta)]);
        settle(harness);
    }
    assert!(harness.app.text().contains(&format!("w{} ", count - 1)), "{}", harness.app.text());
    assert_eq!(reconcile::work().since(work), reconcile::Work::default(), "streamed deltas worked in the built-ins");
    opencode_plugin::loader::native::crossed().since(before)
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

/// This year's stats, as E.14/stats serves them.
fn stats() -> Value {
    let day = 86_400_000_i64;
    let from = 1_767_268_800_000_i64;
    json!({ "data": {
        "range": { "from": from, "to": from + 27 * day }, "sessions": 42, "subagents": 3, "prompts": 120, "steps": 300,
        "tokens": { "input": 1_000_000, "output": 200_000, "reasoning": 34_000, "cache": { "read": 0, "write": 0 } },
        "cost": 12.5, "tools": { "mode": "none" }, "activeDays": 9, "streak": 4,
        "activity": [
            { "date": "2026-01-02", "steps": 3 }, { "date": "2026-01-05", "steps": 12 },
            { "date": "2026-01-12", "steps": 30 }, { "date": "2026-01-20", "steps": 1 },
        ],
        "models": [],
    } })
}

/// The `/stats` route at `height` rows, its stats served.
fn stats_route(height: u16) -> Harness {
    let fake = Fake::new(|seen| match seen.path.as_str() {
        "/api/experimental/session/stats" => (200, stats()),
        _ => support::base(seen, DIRECTORY),
    });
    let deps = Deps {
        config: support::config(support::decode(r#"{ "animations": false }"#)),
        route: opencode_tui::Route::Home,
        ..support::deps(Arc::new(fake))
    };
    let harness = support::mount(100, height, deps);
    harness.tui.navigate(opencode_tui::Route::Plugin { id: "opencode.stats".into(), name: "stats".into() });
    harness.wait_for("TOKENS");
    harness
}

// Expected (a theme switch on `/stats`): the poster's calendar and logo compute their colors from the theme, so a
// switch draws every cell as the poster opened in the new theme, compact and tall with its logo (P6a review, big-boi
// medium 3).
#[test]
fn the_stats_poster_takes_a_new_theme() {
    for height in [30, 44] {
        support::assert_restyles_in_place(|| Box::new(stats_route(height)), |_| {}, |screen| screen.contains("TOKENS"));
    }
}

// Expected (`settled-first`, a resize of `/stats`): the first frame at the new height is the poster opened at it,
// compact or tall, centered in the new room, both ways across the compact threshold (review carbon-1: the view saw the
// last frame's height, so the page centered in rows the terminal no longer has).
#[test]
fn a_resized_stats_page_draws_its_first_frame_at_the_new_size() {
    let harness = stats_route(44);
    for height in [24, 44] {
        harness.app.resize(100, height);
        let first = harness.app.render();
        let fresh = stats_route(height);
        settle(&fresh);
        assert_eq!(first, fresh.app.render(), "{height} rows:\n{}", first.text());
    }
}

// Expected: the poster's big number and calendar are glyphs, not text: a drag over them selects nothing, as TS's
// `selectable={false}` (review carbon-7, `unselectable`).
#[test]
fn the_stats_poster_selects_no_glyphs() {
    use opentui::input::{MouseButton, MouseEventKind};
    let harness = stats_route(44);
    let screen = harness.app.render().text();
    let (x, y) = support::at(&screen, "██").expect("the big number");
    harness.app.mouse(MouseEventKind::Down(MouseButton::Left), x, y);
    harness.app.mouse(MouseEventKind::Drag(MouseButton::Left), x + 6, y + 2);
    harness.app.mouse(MouseEventKind::Up(MouseButton::Left), x + 6, y + 2);
    settle(&harness);
    assert_eq!(harness.app.app().selected_text(), None);
}

// Expected (`lifecycle`, `/stats`): the stats asked for as the route opened, answered after it closed, reach nothing:
// Home shows, and the route holds no mount; opened again, it asks again and shows the new answer.
#[test]
fn a_stats_reply_after_the_route_closed_reaches_nothing() {
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    static OPEN: AtomicBool = AtomicBool::new(false);
    static ASKED: AtomicUsize = AtomicUsize::new(0);
    OPEN.store(false, Ordering::SeqCst);
    ASKED.store(0, Ordering::SeqCst);
    let fake = Fake::new(|seen| match seen.path.as_str() {
        "/api/experimental/session/stats" => {
            ASKED.fetch_add(1, Ordering::SeqCst);
            let start = std::time::Instant::now();
            while !OPEN.load(Ordering::SeqCst) && start.elapsed() < Duration::from_secs(10) {
                std::thread::sleep(Duration::from_millis(5));
            }
            (200, stats())
        }
        _ => support::base(seen, DIRECTORY),
    });
    let deps = Deps {
        config: support::config(support::decode(r#"{ "animations": false }"#)),
        route: opencode_tui::Route::Home,
        ..support::deps(Arc::new(fake))
    };
    let harness = support::mount(100, 30, deps);
    harness.wait_for("Ask anything");
    let route = opencode_tui::Route::Plugin { id: "opencode.stats".into(), name: "stats".into() };
    harness.tui.navigate(route.clone());
    harness.wait_for("Gathering your stats");
    harness.wait("the stats to be asked for", || ASKED.load(Ordering::SeqCst) == 1);
    harness.app.press("escape");
    harness.wait_gone("Gathering your stats");
    OPEN.store(true, Ordering::SeqCst);
    for _ in 0..20 {
        harness.app.advance(Duration::from_millis(5));
    }
    let screen = harness.app.render().text();
    assert!(screen.contains("Ask anything") && !screen.contains("TOKENS"), "{screen}");
    assert_eq!(surface::ledger_of("opencode.stats"), surface::Ledger::default());
    harness.tui.navigate(route);
    harness.wait_for("TOKENS");
    assert_eq!(ASKED.load(Ordering::SeqCst), 2);
}

// Expected (review carbon-7): the built-ins that follow the terminal's size hear a resize: the getting started card
// goes below 22 rows and comes back above, and the prompt footer's shell hint shortens below 44 columns and grows back.
#[test]
fn the_built_ins_follow_a_resize() {
    let harness = session(&[], Vec::new());
    for (height, card) in [(21, false), (34, true)] {
        harness.app.resize(170, height);
        settle(&harness);
        assert_eq!(harness.app.render().text().contains("Getting started"), card, "{height} rows");
    }
    harness.app.type_text("!");
    harness.wait_for("esc exit shell mode");
    for (width, long) in [(40, false), (170, true)] {
        harness.app.resize(width, 34);
        settle(&harness);
        let screen = harness.app.render().text();
        assert_eq!(screen.contains("exit shell mode"), long, "{width} columns:\n{screen}");
        assert!(screen.contains("shell"), "{width} columns:\n{screen}");
    }
}

// Expected: a `todowrite` call that completes in the reply that streams, a message changed in place, shows its list in
// the sidebar's todo section (P6a review: the section reads a changed message alone, and the session only for one that
// holds such a call).
#[test]
fn a_todo_list_written_in_a_streaming_reply_shows_in_the_sidebar() {
    let harness = session(&[], Vec::new());
    let started = json!({ "sessionID": "ses_a", "assistantMessageID": "msg_live", "agent": "build",
                          "model": { "providerID": "p", "id": "m" }, "started": 1 });
    harness.tui.data.apply(&[event("session.step.started", 1, started)]);
    settle(&harness);
    let ids = json!({ "sessionID": "ses_a", "assistantMessageID": "msg_live", "id": "call_t" });
    let with = |extra: Value| support::merge(ids.clone(), extra);
    let todos = json!({ "todos": [{ "content": "Write the parser", "status": "in_progress" }] });
    harness.tui.data.apply(&[event("session.tool.input.started", 2, with(json!({ "name": "todowrite" })))]);
    harness.tui.data.apply(&[event("session.tool.called", 3, with(json!({ "input": todos, "executed": true })))]);
    let output = json!({ "content": [{ "type": "text", "text": "ok" }], "executed": true });
    harness.tui.data.apply(&[event("session.tool.success", 4, with(output))]);
    let sidebar =
        || harness.app.text().lines().any(|line| line.chars().skip(120).collect::<String>().contains("Write"));
    harness.wait("the list in the sidebar", sidebar);
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
    let mut cases: Vec<(&str, Option<opencode_tui::Route>)> = SESSION.iter().map(|id| (*id, None)).collect();
    cases.push(("opencode.home.footer", Some(opencode_tui::Route::Home)));
    let stats = opencode_tui::Route::Plugin { id: "opencode.stats".into(), name: "stats".into() };
    cases.push(("opencode.stats", Some(stats)));
    for (id, route) in cases {
        let open = |plugins: &[&str]| {
            let harness = session(plugins, Vec::new());
            if let Some(route) = &route {
                harness.tui.navigate(route.clone());
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

// Expected (`ledger`, its own rows): the ledger keeps a row for a plugin only while it holds something, so mounting
// and closing surfaces of ever new plugin IDs leaves as many rows as before (P6a review, big-boi low).
#[test]
fn the_ledger_keeps_no_row_for_a_plugin_that_holds_nothing() {
    let before = surface::ledger_rows();
    for index in 0..6 {
        let id: &'static str = Box::leak(format!("test.churn.{index}").into_boxed_str());
        let harness = session(&[], vec![abi::Plugin { id, setup: probe }.into()]);
        assert_eq!(surface::ledger_of(id).mounts, 1, "{id}");
        drop(harness);
        heard();
    }
    assert_eq!(surface::ledger_rows(), before);
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
    .on(|host, event| {
        if let Event::Mount { mount, mounted, slot } = event {
            let prompt = slot.as_ref().and_then(|slot| slot.prompt);
            let (shell, details) = (prompt.is_some_and(|prompt| prompt.shell), prompt.is_some_and(|p| p.show_details));
            let session = slot.as_ref().and_then(|slot| slot.session_id.clone()).unwrap_or_default();
            let line = format!("mount {mounted} {} {session} shell {shell} details {details}", mount.generation);
            HEARD.with(|heard| heard.borrow_mut().push(line));
            // What the plugin starts as a mount ends is the plugin's: its reply comes after the mount went.
            if !mounted {
                let fetch = abi::Fetch { method: "GET".into(), path: "/api/probe".into(), ..abi::Fetch::default() };
                host.fetch(fetch);
            }
        }
        Handled::Pass
    });
    setup.surface(surface);
    setup.on_reply(|_, _, _| HEARD.with(|heard| heard.borrow_mut().push("reply".to_owned())));
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

/// The generation in a `view` line, the second word.
fn generation(line: &str) -> u64 {
    line.split(' ').nth(1).and_then(|number| number.parse().ok()).unwrap_or_default()
}

/// The lines of the log that are mount notices and each mount's first view, without replies. The first view hears
/// `all` and no `local`: everything is new to it (review carbon-6). The host may send a batch of `all` again as it
/// starts or mounts a route, which the next change of its own state may be in.
fn mounts_and_first_views() -> Vec<String> {
    let mut viewed = std::collections::HashSet::new();
    heard()
        .into_iter()
        .filter(|line| {
            line != "reply" && (!line.starts_with("view") || line.contains("all") && viewed.insert(generation(line)))
        })
        .collect()
}

// Expected (`lifecycle`): a surface that asks hears each mount begin before its first view, which hears `all`, and end
// after the next mount began (the prompt mounts its footer again as shell mode turns on and off, and with equal input
// as the route mounts again); each notice names its mount, so the end names the mount that went, not the new one. What
// the plugin starts as a mount ends answers after it. Once its plugin is disabled it hears nothing, not even the end of
// its mount. On both carriers; the reference is the sequence written out, the log the plugin's own.
#[test]
fn a_surface_hears_its_mounts_begin_and_end_in_order() {
    for abi in [false, true] {
        mounts_in_order(abi);
    }
}

fn mounts_in_order(abi: bool) {
    let plugin = abi::Plugin { id: "test.probe", setup: probe };
    let builtin = if abi { opencode_plugin::Builtin::Abi(plugin) } else { opencode_plugin::Builtin::Plugin(plugin) };
    let harness = session(&[], vec![builtin]);
    let first = mounts_and_first_views();
    let opened = first.first().map(|line| line.split(' ').nth(2).unwrap().parse::<u64>().unwrap()).unwrap();
    assert_eq!(
        first,
        [format!("mount true {opened} ses_a shell false details true"), format!("view {opened} shell false all")]
    );
    harness.app.type_text("!");
    harness.wait_for("esc exit shell mode");
    settle(&harness);
    harness.app.press("escape");
    harness.wait_gone("exit shell mode");
    settle(&harness);
    // The reads started as the two mounts ended are the plugin's: both answer, after their mounts went.
    harness
        .wait("the replies", || HEARD.with(|heard| heard.borrow().iter().filter(|line| *line == "reply").count()) == 2);
    let log = mounts_and_first_views();
    let views: Vec<u64> = log.iter().filter(|line| line.starts_with("view")).map(|line| generation(line)).collect();
    assert!(views.len() == 2 && views[0] > opened && views[1] > views[0], "abi {abi}: {log:?}");
    let expected = [
        format!("mount true {} ses_a shell true details true", views[0]),
        format!("view {} shell true all", views[0]),
        format!("mount false {opened} ses_a shell false details true"),
        format!("mount true {} ses_a shell false details true", views[1]),
        format!("view {} shell false all", views[1]),
        format!("mount false {} ses_a shell true details true", views[0]),
    ];
    assert_eq!(log, expected, "abi {abi}");
    // The route mounts again: a mount of equal input, which only the notice's mount tells from the one it replaces.
    harness.tui.navigate(harness.tui.route());
    settle(&harness);
    harness.wait("the reply", || HEARD.with(|heard| heard.borrow().iter().any(|line| line == "reply")));
    let log = mounts_and_first_views();
    let again = log.iter().find(|line| line.starts_with("view")).map(|line| generation(line)).unwrap_or_default();
    assert!(again > views[1], "abi {abi}: {log:?}");
    let mut sorted = log.clone();
    sorted.sort();
    let mut expected = [
        format!("mount false {} ses_a shell false details true", views[1]),
        format!("mount true {again} ses_a shell false details true"),
        format!("view {again} shell false all"),
    ];
    expected.sort();
    assert_eq!(sorted, expected, "abi {abi}");
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

// Expected (review carbon-6): a change of the host's own state is `local` to the next view of each surface once,
// however many surfaces watch it: a delta after it is heard as the delta alone, by each of two plugins' surfaces.
#[test]
fn a_change_of_the_hosts_state_is_local_once() {
    let probes = ["test.probe.a", "test.probe.b"].map(|id| abi::Plugin { id, setup: probe }.into()).into();
    let harness = session(&[], probes);
    let started = json!({ "sessionID": "ses_a", "assistantMessageID": "msg_live", "agent": "build",
                          "model": { "providerID": "p", "id": "m" }, "started": 1 });
    harness.tui.data.apply(&[event("session.step.started", 1, started)]);
    let text = json!({ "sessionID": "ses_a", "assistantMessageID": "msg_live", "ordinal": 0 });
    harness.tui.data.apply(&[event("session.text.started", 2, text)]);
    settle(&harness);
    heard();
    harness.tui.local.set_variant(Some("high"));
    settle(&harness);
    let changed = heard();
    assert!(changed.len() >= 2 && changed.iter().all(|line| line.ends_with(" local")), "{changed:?}");
    let delta = json!({ "sessionID": "ses_a", "assistantMessageID": "msg_live", "ordinal": 0, "delta": "x" });
    harness.tui.data.apply(&[event("session.text.delta", 3, delta)]);
    settle(&harness);
    let deltas = heard();
    assert!(deltas.len() == 2 && deltas.iter().all(|line| line.ends_with("shell false ses_a/msg_live")), "{deltas:?}");
}

thread_local! {
    /// The keeper's cards, each the value of its memo.
    static CARDS: RefCell<Vec<u32>> = RefCell::new(vec![1, 2, 3]);
    /// The cards its views built.
    static BUILT: Cell<usize> = const { Cell::new(0) };
    /// Its root is a hidden box.
    static HIDE: Cell<bool> = const { Cell::new(false) };
    /// Its next view gives content and keeps its root; later views show that content.
    static GIVE: Cell<bool> = const { Cell::new(false) };
    static GIVEN: Cell<Option<abi::v2::ContentRef>> = const { Cell::new(None) };
    /// The slot's width and height and the surface's, as each view was told them.
    static SIZES: RefCell<Vec<[u16; 4]>> = const { RefCell::new(Vec::new()) };
}

/// A slot surface in the prompt's status row that reads the palette and keeps its root unless it is new or its command
/// woke it, also when told `all` (as one whose memo of its whole input hit). Its cards are memos.
fn keeper(setup: &mut abi::Setup) -> Result<(), String> {
    setup.command(Command { name: "keeper.wake".into(), ..Command::default() }, |_, _| {});
    let surface = Surface::new("keeper", Place::Slot(Placement::append(slot::PROMPT_FOOTER_STATUS)), |cx| {
        if let Some(slot) = &cx.input.slot {
            SIZES.with(|sizes| sizes.borrow_mut().push([slot.width, slot.height, cx.input.width, cx.input.height]));
        }
        if GIVE.replace(false) {
            GIVEN.set(Some(cx.content("GIVEN BYTES")));
            return Node::Keep { key: "keeper".into() };
        }
        if !cx.input.full && !cx.input.changed.woken {
            return Node::Keep { key: "keeper".into() };
        }
        let cards = CARDS.with(|cards| cards.borrow().clone());
        let mut children: Vec<Node> = cards
            .into_iter()
            .enumerate()
            .map(|(index, value)| {
                cx.memo(format!("card{index}"), value, |_| {
                    BUILT.set(BUILT.get() + 1);
                    Node::text([Span::new(format!("K{index}={value}"))]).fg("text.muted")
                })
            })
            .collect();
        if let Some(handle) = GIVEN.get() {
            children.push(Node::Markdown { id: None, source: abi::v2::Source::Content(handle) });
        }
        Node::row(children).gap(1).with_id("keeper").visible(!HIDE.get())
    })
    .palette();
    setup.surface(surface);
    Ok(())
}

fn carried(plugin: abi::Plugin, abi: bool) -> opencode_plugin::Builtin {
    match abi {
        true => opencode_plugin::Builtin::Abi(plugin),
        false => opencode_plugin::Builtin::Plugin(plugin),
    }
}

/// `ses_a` with the keeper, on the C ABI carrier when `abi`.
fn keeper_session(abi: bool) -> Harness {
    CARDS.with(|cards| *cards.borrow_mut() = vec![1, 2, 3]);
    GIVEN.set(None);
    let harness = session(&[], vec![carried(abi::Plugin { id: "test.keeper", setup: keeper }, abi)]);
    if !HIDE.get() {
        harness.wait_for("K2=3");
    }
    harness
}

// Expected (review carbon-2): a view that keeps its root without running its memos keeps their values, also after a
// theme switch it answered so: a delta it keeps the root for leaves the table whole and costs no work, and the next
// view that runs the memos builds only the card that changed. Content a view gives as it keeps its root is held, and a
// later tree shows it. Each view of the slot is told the slot's size, which is the surface's. On both carriers.
#[test]
fn a_kept_root_keeps_what_the_mount_holds() {
    for abi in [false, true] {
        let harness = keeper_session(abi);
        assert_eq!(surface::ledger_of("test.keeper").memo_entries, 3, "abi {abi}");
        assert!(harness.tui.theme.borrow_mut().set("tokyonight"));
        harness.tui.theme_changed();
        settle(&harness);
        stream(&harness, 2);
        assert_eq!(surface::ledger_of("test.keeper").memo_entries, 3, "abi {abi}");
        BUILT.set(0);
        CARDS.with(|cards| cards.borrow_mut()[1] = 5);
        harness.tui.keymap.dispatch("keeper.wake", None);
        harness.wait_for("K1=5");
        assert_eq!(BUILT.get(), 1, "abi {abi}");
        GIVE.set(true);
        harness.tui.keymap.dispatch("keeper.wake", None);
        settle(&harness);
        harness.tui.keymap.dispatch("keeper.wake", None);
        harness.wait_for("GIVEN BYTES");
        let sizes = SIZES.with(|sizes| sizes.take());
        assert!(sizes.iter().all(|[w, h, width, height]| (w, h) == (width, height) && *w > 0), "abi {abi}: {sizes:?}");
    }
}

// Expected (review carbon-2, carbon-5): a view that reads the palette and answers a theme switch with a keep of its
// root is painted in the new theme, its root shown or hidden as a fresh mount's. On both carriers.
#[test]
fn a_kept_root_takes_a_new_theme() {
    for (abi, hide) in [(false, false), (true, false), (false, true)] {
        HIDE.set(hide);
        let ready = move |screen: &str| screen.contains("K2=3") != hide && screen.contains("Getting started");
        support::assert_restyles_in_place(|| Box::new(keeper_session(abi)), |_| {}, ready);
    }
    HIDE.set(false);
}

thread_local! {
    /// The views of the mounter's route.
    static VIEWS: Cell<usize> = const { Cell::new(0) };
}

/// A route that hears its mounts begin, and opens an overlay of the plugin as one does.
fn mounter(setup: &mut abi::Setup) -> Result<(), String> {
    let page = Surface::new("mounter", Place::Route("mounter".into()), |_| {
        VIEWS.set(VIEWS.get() + 1);
        Node::text([Span::new("MOUNTER")]).with_id("page")
    })
    .mounts()
    .on(|host, event| {
        if let Event::Mount { mounted: true, .. } = event {
            let anchor = abi::interact::Anchor::Point { x: 2, y: 2 };
            host.overlay(abi::interact::Overlay { surface: "pop".into(), anchor, width: 10, height: 2 });
        }
        Handled::Pass
    });
    setup.surface(page);
    setup.surface(Surface::new("pop", Place::Overlay("pop".into()), |_| Node::text([Span::new("POPPED")])));
    Ok(())
}

// Expected (review carbon-3): what a plugin opens as it hears a mount begin is the plugin's, and ends with it: the
// overlay closes as the plugin is disabled, which leaves the overlay layer and the plugin's ledger as before. The
// route's first view runs once: the wake the notice's handler gives before it calls none. On both carriers.
#[test]
fn what_a_mount_notice_opens_ends_with_the_plugin() {
    for abi in [false, true] {
        let harness = session(&[], vec![carried(abi::Plugin { id: "test.mounter", setup: mounter }, abi)]);
        let overlays = opencode_plugin::interact::ledger(&*harness.tui).overlays;
        VIEWS.set(0);
        harness.tui.navigate(opencode_tui::Route::Plugin { id: "test.mounter".into(), name: "mounter".into() });
        harness.wait_for("POPPED");
        settle(&harness);
        assert_eq!(VIEWS.get(), 1, "abi {abi}");
        let host = opencode_tui::plugins::host::host(&harness.tui);
        assert_eq!(harness.tui.plugins.toggle(&host, "test.mounter", false), Some(Ok(())));
        harness.tui.navigate(support::session_route("ses_a"));
        settle(&harness);
        assert!(!harness.app.render().text().contains("POPPED"), "abi {abi}");
        assert_eq!(opencode_plugin::interact::ledger(&*harness.tui).overlays, overlays, "abi {abi}");
        assert_eq!(surface::ledger_of("test.mounter"), surface::Ledger::default(), "abi {abi}");
    }
}
