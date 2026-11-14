//! Tabs and panes (E.12) through the whole TUI, with real roots in a temp dir:
//!
//! - P-FILE: `tabs.json` and `layout.json` as the TS storage and tab model read and write them
//!   (`parity/oracle/E.12-tabs.ts`), under the same lock;
//! - `session.deleted` of the open tab, `/clear`, and a plugin panel with its resize handle.
//!
//! The cell-level proofs are the P-APP scenarios `E.12/tab-strip` and `E.12/rail-resize`.

use crate::support::{self, Harness, WAIT, deref_harness};

use std::path::{Path, PathBuf};
use std::process::Command;
use std::rc::Rc;
use std::sync::Arc;

use opencode_api::generated::SessionID;
use opencode_api::memory::{Memory, Route as MemoryRoute};
use opencode_tui::panel::{Presentation, Target};
use opencode_tui::{Deps, Route, Tui};
use opentui::prelude::*;
use serde_json::{Value, json};

const CHANNEL: &str = "test";

struct Tabs {
    harness: Harness,
    memory: Memory,
    state: PathBuf,
    _home: opencode_util::temp::TempDir,
}

deref_harness!(Tabs);

fn routes() -> Vec<MemoryRoute> {
    let mut routes: Vec<MemoryRoute> = [("ses_a", "Fix the parser"), ("ses_b", "Write the docs")]
        .iter()
        .flat_map(|(id, title)| support::session_routes(&support::test_session(id, title)))
        .collect();
    routes.push(MemoryRoute::json("GET", "/api/session", 200, &json!({ "data": [], "cursor": {} })));
    routes.push(MemoryRoute::json("GET", "/api/config", 200, &json!([])));
    routes
}

fn mount(width: u16, config: Value) -> Tabs {
    let home = opencode_util::temp::tempdir().unwrap();
    let paths = support::home_paths(home.path());
    std::fs::create_dir_all(&paths.state).unwrap();
    let state = paths.state.clone();
    let memory = Memory::new(routes());
    let deps = Deps {
        config: support::config(support::decode(&config.to_string())),
        roots: support::roots(paths, CHANNEL),
        events: true,
        ..support::deps(Arc::new(memory.clone()))
    };
    let harness = Tabs { harness: support::mount(width, 30, deps), memory, state, _home: home };
    harness.wait_for("Fix the parser");
    harness
}

impl Tabs {
    fn open(&self, id: &str) {
        self.tui.navigate(support::session_route(id));
        let opened = self.app.wait_until(WAIT, || self.ids().iter().any(|tab| tab == id));
        assert!(opened, "no {id} tab: {:?}", self.ids());
    }

    /// Waits until the tabs are `ids` and the route is the session `route`, or home.
    fn wait_tabs(&self, ids: &[&str], route: Option<&str>) {
        let route = route.map_or(Route::Home, support::session_route);
        let found = self.app.wait_until(WAIT, || self.ids() == ids && self.tui.route() == route);
        assert!(found, "tabs {:?}, route {:?}", self.ids(), self.tui.route());
    }

    fn file(&self, key: &str) -> Value {
        let path = self.state.join(CHANNEL).join("tui").join(format!("{key}.json"));
        std::fs::read_to_string(path).ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or(Value::Null)
    }

    /// Waits until `key`'s file satisfies `check`.
    fn wait_file(&self, key: &str, check: impl Fn(&Value) -> bool) -> Value {
        let found = self.app.wait_until(WAIT, || check(&self.file(key)));
        let value = self.file(key);
        assert!(found, "{key}.json: {value}");
        value
    }

    fn ids(&self) -> Vec<String> {
        self.tui.tabs.tabs(&self.tui).into_iter().map(|tab| tab.session_id).collect()
    }
}

/// The stored tabs once both sessions are open and their titles have loaded.
fn both_tabs() -> Value {
    json!([{ "sessionID": "ses_a", "title": "Fix the parser" }, { "sessionID": "ses_b", "title": "Write the docs" }])
}

fn cwd() -> String {
    std::env::current_dir().unwrap().to_string_lossy().into_owned()
}

#[test]
fn tabs_open_close_and_persist_in_the_cwd_scope() {
    let h = mount(100, json!({ "animations": false }));
    h.open("ses_b");
    let screen = h.wait_for("Write the docs");
    assert!(screen.lines().next().unwrap().contains("Fix the parser"), "{screen}");
    let file = h.wait_file("tabs", |file| file["cwd"][cwd()]["tabs"] == both_tabs());
    assert_eq!(file["cwd"][cwd()]["unread"], json!({}));

    // `<leader>w` closes the open tab and goes back to the previous one; `ctrl+shift+t` reopens it.
    h.app.press("ctrl+x");
    h.app.press("w");
    h.wait_tabs(&["ses_a"], Some("ses_a"));
    h.app.press("ctrl+shift+t");
    h.wait_tabs(&["ses_a", "ses_b"], Some("ses_b"));
}

#[test]
fn deleting_the_open_tab_selects_another_without_a_toast() {
    let h = mount(100, json!({ "animations": false }));
    h.open("ses_b");
    h.wait_for("Write the docs");
    h.memory.emit(&json!({
        "id": "evt_1", "created": 3, "type": "session.deleted",
        "durable": { "aggregateID": "ses_b", "seq": 1, "version": 1 },
        "location": { "directory": "/project" },
        "data": { "sessionID": "ses_b" },
    }));
    let moved = h.app.wait_until(WAIT, || h.tui.route() == support::session_route("ses_a"));
    assert!(moved, "{:?}", h.tui.route());
    assert_eq!(h.ids(), ["ses_a"]);
    assert!(!h.app.text().contains("was deleted"), "{}", h.app.text());
}

#[test]
fn clear_closes_the_tab_and_goes_home() {
    let h = mount(100, json!({ "animations": false }));
    h.open("ses_b");
    h.wait_for("Write the docs");
    h.tui.keymap.dispatch("session.clear", None);
    h.wait_tabs(&["ses_a"], None);
    // Home shows the strip with the new-session tab.
    let screen = h.wait_for("New session");
    assert!(screen.lines().next().unwrap().contains("Fix the parser"), "{screen}");
}

// `createSessionRetention` (`packages/client/src/solid/retention.ts`, limit 3 in `session-tabs.tsx:140-146`): of the
// sessions viewed and left, only the last three keep their transcripts.
#[test]
fn only_the_last_three_viewed_sessions_keep_their_transcripts() {
    let ids: Vec<String> = (1..=6).map(|n| format!("ses_{n}")).collect();
    let mut routes = vec![
        MemoryRoute::json("GET", "/api/session", 200, &json!({ "data": [], "cursor": {} })),
        MemoryRoute::json("GET", "/api/config", 200, &json!([])),
    ];
    for id in &ids {
        let path = format!("/api/session/{id}");
        let message = json!({ "id": format!("msg_{id}"), "type": "user", "text": format!("Hello from {id}"), "time": { "created": 1 } });
        routes.push(MemoryRoute::json("GET", &path, 200, &json!({ "data": support::test_session(id, id) })));
        routes.push(MemoryRoute::json(
            "GET",
            &format!("{path}/message"),
            200,
            &json!({ "data": [message], "cursor": {} }),
        ));
        for list in ["inbox", "permission", "form"] {
            routes.push(MemoryRoute::json("GET", &format!("{path}/{list}"), 200, &json!({ "data": [] })));
        }
    }
    let deps = Deps {
        config: support::config(support::decode(r#"{ "animations": false, "tabs": { "mode": "off" } }"#)),
        ..support::deps(Arc::new(Memory::new(routes)))
    };
    let h = support::mount(100, 30, deps);
    for id in &ids {
        h.tui.navigate(support::session_route(id));
        h.wait_for(&format!("Hello from {id}"));
    }
    h.tui.navigate(Route::Home);
    let loaded = |id: &String| h.tui.data.read(|state| !state.messages(&SessionID(id.clone())).is_empty());
    let kept = h.app.wait_until(WAIT, || ids.iter().filter(|id| loaded(id)).count() == 3);
    let held: Vec<_> = ids.iter().filter(|id| loaded(id)).collect();
    assert!(kept, "{held:?}");
    assert_eq!(held, ids[3..].iter().collect::<Vec<_>>());
}

// The prefetch effect (`session-tabs.tsx:285-325`): a persisted background tab reads its permissions after a delay,
// so its tab shows that it waits on the user.
#[test]
fn a_background_tab_reads_its_pending_permission() {
    let home = opencode_util::temp::tempdir().unwrap();
    let paths = support::home_paths(home.path());
    let storage = paths.state.join(CHANNEL).join("tui");
    std::fs::create_dir_all(&storage).unwrap();
    let mut tabs = json!({ "cwd": {} });
    tabs["cwd"][cwd()] = json!({ "tabs": [{ "sessionID": "ses_a" }, { "sessionID": "ses_b" }] });
    std::fs::write(storage.join("tabs.json"), tabs.to_string()).unwrap();
    let mut routes = routes();
    let request = json!({ "id": "per_1", "sessionID": "ses_b", "action": "read", "resources": ["notes.md"] });
    routes.insert(0, MemoryRoute::json("GET", "/api/session/ses_b/permission", 200, &json!({ "data": [request] })));
    let deps = Deps {
        config: support::config(support::decode(r#"{ "animations": false }"#)),
        roots: support::roots(paths, CHANNEL),
        route: support::session_route("ses_a"),
        events: true,
        ..support::deps(Arc::new(Memory::new(routes)))
    };
    let h = support::mount(100, 30, deps);
    h.wait_for("Fix the parser");
    let waiting = h.app.wait_until(WAIT, || {
        h.app.advance(std::time::Duration::from_millis(100));
        h.tui.tabs.status(&h.tui, "ses_b").attention.is_some()
    });
    assert!(waiting, "{}", h.app.text());
}

// Another client holding `tabs.json`'s lock delays the writes, not the UI thread that queues them
// (`context/storage.tsx` returns a pending promise).
#[test]
fn a_held_tabs_lock_does_not_block_the_ui() {
    let h = mount(100, json!({ "animations": false }));
    h.wait_file("tabs", |file| !file.is_null());
    let file = h.state.join(CHANNEL).join("tui").join("tabs.json");
    let locks = h.state.join(CHANNEL).join("locks");
    let lock = opencode_local::lock::acquire(&locks, &file.to_string_lossy(), &Default::default()).unwrap();
    let releaser = std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(2));
        lock.release().unwrap();
    });
    let started = std::time::Instant::now();
    h.tui.navigate(support::session_route("ses_b"));
    // The first write now waits on the lock; give it time to start.
    std::thread::sleep(std::time::Duration::from_millis(200));
    opencode_tui::tabs::reorder(&h.tui, "ses_b", 0);
    let elapsed = started.elapsed();
    assert!(elapsed < std::time::Duration::from_secs(1), "the UI waited {elapsed:?} for the lock");
    releaser.join().unwrap();
    // Both writes land, in order, once the lock is free.
    h.wait_file("tabs", |file| {
        let tabs = file["cwd"][cwd()]["tabs"].as_array().cloned().unwrap_or_default();
        tabs.iter().map(|tab| tab["sessionID"].clone()).collect::<Vec<_>>() == [json!("ses_b"), json!("ses_a")]
    });
}

// Another client writing `tabs.json` while this one's writes wait on its lock: the reload replays them over the
// file, so the tab and its normalized title stay, and land in the file once the lock is free.
#[test]
fn a_reload_keeps_the_writes_held_behind_the_lock() {
    let h = mount(120, json!({ "animations": false, "tabs": { "layout": "vertical" } }));
    h.wait_file("tabs", |file| !file.is_null());
    let storage = h.state.join(CHANNEL).join("tui");
    let file = storage.join("tabs.json");
    let locks = h.state.join(CHANNEL).join("locks");
    let lock = opencode_local::lock::acquire(&locks, &file.to_string_lossy(), &Default::default()).unwrap();
    let title = |id: &str| {
        let tabs = h.tui.tabs.tabs(&h.tui);
        tabs.into_iter().find(|tab| tab.session_id == id).and_then(|tab| tab.title)
    };
    h.tui.navigate(support::session_route("ses_b"));
    let titled = h.app.wait_until(WAIT, || title("ses_b").as_deref() == Some("Write the docs"));
    assert!(titled, "{:?}", h.tui.tabs.tabs(&h.tui));

    // The other client, holding the lock, writes its tabs and then the layout; the rail shows the reload.
    let mut other = json!({ "cwd": {} });
    other["cwd"][cwd()] = json!({ "tabs": [{ "sessionID": "ses_a", "title": "Fix the parser" }] });
    std::fs::write(&file, other.to_string()).unwrap();
    std::fs::write(storage.join("layout.json"), json!({ "verticalTabsWidth": 50 }).to_string()).unwrap();
    let reloaded = h.app.wait_until(WAIT, || h.tui.frame.rail_width(&h.tui) == 50);
    assert!(reloaded, "rail {}", h.tui.frame.rail_width(&h.tui));
    assert_eq!(title("ses_b").as_deref(), Some("Write the docs"), "{:?}", h.tui.tabs.tabs(&h.tui));

    lock.release().unwrap();
    h.wait_file("tabs", |file| file["cwd"][cwd()]["tabs"] == both_tabs());
}

// A burst that overflows the store's signal channel while the UI is busy skips the `session.deleted` in it; the
// skip resyncs as a reconnect does, and the store saw the deletion, so the tab still closes.
#[test]
fn a_deletion_lost_in_a_signal_overflow_still_closes_its_tab() {
    let h = mount(100, json!({ "animations": false }));
    h.open("ses_b");
    h.tui.navigate(support::session_route("ses_a"));
    h.wait_for("Write the docs");
    let _listening = opencode_tui::features::events::subscribe(&h.tui, ["filesystem.changed"], |_, _| {});
    let deleted = json!({
        "id": "evt_deleted", "created": 3, "type": "session.deleted",
        "durable": { "aggregateID": "ses_b", "seq": 1, "version": 1 },
        "location": { "directory": "/project" },
        "data": { "sessionID": "ses_b" },
    });
    let burst = (0..2048).map(|id| {
        json!({
            "id": format!("evt_fs_{id}"), "created": 4, "type": "filesystem.changed",
            "location": { "directory": "/project" }, "data": { "file": format!("src/{id}.rs"), "event": "change" },
        })
    });
    let events: Vec<_> =
        std::iter::once(deleted).chain(burst).map(|event| serde_json::from_value(event).unwrap()).collect();
    // The UI thread is busy: nothing drains its queue until it is full.
    let proxy = h.app.proxy();
    while proxy.post(|_| {}) != Err(opentui::app::ProxyError::Full) {}
    h.tui.data.apply(&events);
    h.wait_tabs(&["ses_a"], Some("ses_a"));
}

// `TabPulse` unmounts with its tab: closing a busy tab leaves no pulse that keeps the frame ticking.
#[test]
fn a_closed_busy_tab_stops_the_pulse_ticks() {
    let h = mount(100, json!({}));
    h.open("ses_b");
    h.wait_for("Write the docs");
    let event = json!({
        "id": "evt_1", "created": 10_000, "type": "session.execution.started",
        "durable": { "aggregateID": "ses_a", "seq": 1, "version": 1 },
        "data": { "sessionID": "ses_a" },
    });
    h.tui.data.apply(&[serde_json::from_value(event).unwrap()]);
    h.app.render();
    h.app.advance(std::time::Duration::from_millis(200));
    assert!(h.app.needs_frame(), "a busy tab pulses");
    opencode_tui::tabs::close(&h.tui, Some("ses_a"));
    h.wait_tabs(&["ses_b"], Some("ses_b"));
    // Late responses may still draw; a pulse left behind draws every tick, forever.
    let still = h.app.wait_until(WAIT, || {
        h.app.render();
        h.app.advance(std::time::Duration::from_millis(200));
        !h.app.needs_frame()
    });
    assert!(still, "a closed tab still ticks");
}

// A busy tab in the background animates with nothing else going on, and stops once it is idle. The strip and the
// full rail pulse at 20 fps. The compact rail has no pulse: its spinner paints each step of TS's 80 ms interval,
// 12.5 frames a second. Without a frame source of its own it stalled until input came (the user saw it step 2-3
// times a second). A rail that hides while its tab works (the terminal narrows to the strip) leaves nothing ticking.
#[test]
fn a_busy_tab_paints_on_its_own_and_stops_when_idle() {
    let execution = |kind: &str, seq: u64| {
        let event = json!({
            "id": format!("evt_{seq}"), "created": 10_000 + seq, "type": format!("session.execution.{kind}"),
            "durable": { "aggregateID": "ses_a", "seq": seq, "version": 1 },
            "data": { "sessionID": "ses_a" },
        });
        serde_json::from_value(event).unwrap()
    };
    let vertical = json!({ "tabs": { "layout": "vertical" } });
    for (name, config, compact, busy) in [
        ("strip", json!({ "tabs": { "layout": "horizontal" } }), false, 160),
        ("rail", vertical.clone(), false, 160),
        ("compact rail", vertical, true, 100),
        // A still glyph or a number needs no frames.
        ("compact rail, no animations", json!({ "animations": false, "tabs": { "layout": "vertical" } }), true, 0),
        ("compact rail, numbers", json!({ "tabs": { "layout": "vertical", "indicators": "numbers" } }), true, 0),
    ] {
        let h = mount(120, config);
        h.open("ses_b");
        h.wait_for("Write the docs");
        if compact {
            h.app.drag((41, 10), (5, 10));
            assert!(h.app.wait_until(WAIT, || h.tui.frame.rail_width(&h.tui) == 6), "{name}");
        }
        // The first pass takes the startup's one-off timers. Idle, a retry of a read the fixture leaves unanswered
        // may still paint once.
        frames(&h);
        assert!(frames(&h).len() <= 1, "{name}: idle");
        // Off the spinner's steps, which count from the tabs' epoch.
        h.app.advance(std::time::Duration::from_millis(30));
        h.tui.data.apply(&[execution("started", 1)]);
        if compact && busy > 0 {
            // The change lands before the spinner first paints, so only that paint can ask for the next step.
            assert!(h.app.wait_until(WAIT, || h.tui.tabs.status(&h.tui, "ses_a").busy), "{name}: not busy");
            h.app.wait_until(std::time::Duration::from_millis(300), || false);
            let text = h.app.render().text();
            assert!(text.contains(|glyph| ('⠁'..='⣿').contains(&glyph)), "{name}: no spinner\n{text}");
            h.app.advance(std::time::Duration::from_millis(80));
            assert!(h.app.needs_frame(), "{name}: no step after 80 ms");
        }
        let busy_frames = frames(&h);
        assert!((busy..=busy + 2).contains(&busy_frames.len()), "{name}: busy, {} frames", busy_frames.len());
        if compact {
            assert!(busy_frames.iter().all(|at| at % 80 == 0), "{name}: off the spinner's steps, {busy_frames:?}");
        }
        h.app.resize(60, 30);
        h.tui.data.apply(&[execution("succeeded", 2)]);
        frames(&h);
        assert!(frames(&h).len() <= 1, "{name}: idle again");
    }
}

/// The frames painted over 8 s without input, one each time the app asks for one, as `App::event_loop` does, in
/// milliseconds since the tabs' epoch. The requests in flight land first: their replies are output, not idle.
fn frames(h: &Tabs) -> Vec<u128> {
    h.app.wait_until(std::time::Duration::from_millis(300), || {
        h.app.render();
        false
    });
    (0..8000)
        .filter_map(|_| {
            h.app.advance(std::time::Duration::from_millis(1));
            h.app.needs_frame().then(|| {
                h.app.render();
                h.tui.app.now().duration_since(h.tui.tabs.epoch()).as_millis()
            })
        })
        .collect()
}

#[test]
fn a_split_panel_shows_beside_the_session_and_resizes() {
    let h = mount(140, json!({ "animations": false, "session": { "sidebar": "hide" } }));
    h.tui.panels.register(
        "test",
        "diff",
        Rc::new(|tui: &Tui, root: &View, input: &opencode_tui::panel::Input<'_>| {
            root.add(&Text::new(&tui.app, format!("panel for {}", input.target.session)));
            Box::new(()) as Box<dyn std::any::Any>
        }),
    );
    let target = Target { plugin: "test".into(), name: "diff".into(), session: "ses_a".into() };
    h.tui.panels.open(&h.tui, target, Presentation::Panel);
    let screen = h.wait_for("panel for ses_a");
    // The default width is half the panel width (140), so the panel starts at column 70.
    let row = screen.lines().find(|line| line.contains("panel for")).unwrap();
    assert_eq!(row.chars().position(|c| c == 'p'), Some(70), "{screen}");

    // Drag the handle (on the boundary's right cell, column 69) to column 89: the panel is 50 wide.
    h.app.hover(69, 10);
    h.app.drag((69, 10), (89, 10));
    let column = || {
        h.app.text().lines().find(|line| line.contains("panel for")).and_then(|row| row.chars().position(|c| c == 'p'))
    };
    assert!(h.app.wait_until(WAIT, || column() == Some(90)), "{}", h.app.text());
    h.wait_file("layout", |layout| layout["paneWidth"] == 50);

    // Leaving the panel's session closes it.
    h.open("ses_b");
    assert!(h.app.wait_until(WAIT, || h.tui.panels.current().is_none()));
}

// P-FILE: the TS client reads what Rust wrote and Rust reads what TS wrote, under the same lock.

#[test]
fn tabs_and_layout_are_shared_with_the_typescript_client() {
    let Some(script) = oracle() else { return };
    let h = mount(120, json!({ "animations": false, "tabs": { "layout": "vertical" } }));
    h.open("ses_b");
    // The second tab's title lands with its session read.
    h.wait_file("tabs", |file| file["cwd"][cwd()]["tabs"] == both_tabs());
    // The rail's handle sits on column 41; a drag to 30 stores 31.
    h.app.drag((41, 10), (30, 10));
    h.wait_file("layout", |layout| layout["verticalTabsWidth"] == 31);

    let state = h.state.to_string_lossy().into_owned();
    let read = run(&script, &["load", &state, CHANNEL]);
    assert_eq!(read["tabs"]["cwd"][cwd()]["tabs"], both_tabs());
    assert_eq!(read["layout"]["verticalTabsWidth"], 31);

    // TS moves a tab and widens the rail; the running Rust TUI's storage watch picks both up.
    run(&script, &["move", &state, CHANNEL, &cwd(), "ses_b", "0"]);
    run(&script, &["width", &state, CHANNEL, "50"]);
    let reloaded = h.app.wait_until(WAIT, || h.ids() == ["ses_b", "ses_a"] && h.tui.frame.rail_width(&h.tui) == 50);
    assert!(reloaded, "tabs {:?}, rail {}", h.ids(), h.tui.frame.rail_width(&h.tui));
}

// The TypeScript side of P-FILE, when bun and the workspace's node_modules are there.
fn oracle() -> Option<PathBuf> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let script = root.join("parity/oracle/E.12-tabs.ts");
    let present = root.join("../../node_modules").is_dir() && Command::new("bun").arg("--version").output().is_ok();
    if !present {
        assert!(
            std::env::var_os("OPENCODE_RS_REQUIRE_TS").is_none(),
            "OPENCODE_RS_REQUIRE_TS is set, but skipped: needs bun and the workspace node_modules"
        );
        eprintln!("skipped: needs bun and the workspace node_modules");
        return None;
    }
    Some(script)
}

fn run(script: &Path, args: &[&str]) -> Value {
    // `parity/bunfig.toml` preloads Solid's JSX, which the TS storage module needs.
    let output = Command::new("bun")
        .current_dir(script.parent().unwrap().parent().unwrap())
        .arg(script)
        .args(args)
        .env("BUN_RUNTIME_TRANSPILER_CACHE_PATH", std::env::temp_dir().join("opencode-rs-e12-bun-cache"))
        .output()
        .unwrap();
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    serde_json::from_str(String::from_utf8(output.stdout).unwrap().lines().last().unwrap()).unwrap()
}
