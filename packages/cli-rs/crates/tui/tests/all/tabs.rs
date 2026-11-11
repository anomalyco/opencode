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
