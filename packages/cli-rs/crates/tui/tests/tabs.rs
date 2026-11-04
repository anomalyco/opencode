//! Tabs and panes (E.12) through the whole TUI, with real roots in a temp dir:
//!
//! - P-FILE: `tabs.json` and `layout.json` as the TS storage and tab model read and write them
//!   (`parity/oracle/E.12-tabs.ts`), under the same lock;
//! - `session.deleted` of the open tab, `/clear`, and a plugin panel with its resize handle.
//!
//! The cell-level proofs are the P-APP scenarios `E.12/tab-strip` and `E.12/rail-resize`.

#[path = "support/wait.rs"]
mod wait;

use std::path::{Path, PathBuf};
use std::process::Command;
use std::rc::Rc;
use std::sync::Arc;

use opencode_api::client::Client;
use opencode_api::memory::{Memory, Route as MemoryRoute};
use opencode_local::cli_config::{self, Resolved};
use opencode_local::paths::Paths;
use opencode_tui::app::Roots;
use opencode_tui::panel::{Presentation, Target};
use opencode_tui::{Deps, Route, Tui};
use opentui::prelude::*;
use opentui::testing::TestApp;
use serde_json::{Value, json};
use wait::WAIT;

const CHANNEL: &str = "test";

struct Harness {
    app: TestApp,
    tui: Rc<Tui>,
    memory: Memory,
    state: PathBuf,
    _home: tempfile::TempDir,
}

fn session(id: &str, title: &str) -> Value {
    json!({
        "id": id, "title": title, "projectID": "proj_test", "cost": 0,
        "tokens": { "input": 0, "output": 0, "reasoning": 0, "cache": { "read": 0, "write": 0 } },
        "time": { "created": 1, "updated": 1 },
        "location": { "directory": "/project" },
    })
}

fn routes() -> Vec<MemoryRoute> {
    let mut routes = Vec::new();
    for (id, title) in [("ses_a", "Fix the parser"), ("ses_b", "Write the docs")] {
        routes.push(MemoryRoute::json(
            "GET",
            &format!("/api/session/{id}"),
            200,
            &json!({ "data": session(id, title) }),
        ));
        routes.push(MemoryRoute::json(
            "GET",
            &format!("/api/session/{id}/message"),
            200,
            &json!({ "data": [], "cursor": {} }),
        ));
        for list in ["inbox", "permission", "form"] {
            routes.push(MemoryRoute::json(
                "GET",
                &format!("/api/session/{id}/{list}"),
                200,
                &json!({ "data": [] }),
            ));
        }
    }
    routes.push(MemoryRoute::json(
        "GET",
        "/api/session",
        200,
        &json!({ "data": [], "cursor": {} }),
    ));
    routes.push(MemoryRoute::json("GET", "/api/config", 200, &json!([])));
    routes
}

fn mount(width: u16, config: Value) -> Harness {
    let home = tempfile::tempdir().unwrap();
    let root = home.path().to_owned();
    let paths =
        Paths::from_vars(|name| (name == "HOME").then(|| root.clone().into_os_string())).unwrap();
    std::fs::create_dir_all(&paths.state).unwrap();
    let state = paths.state.clone();
    let memory = Memory::new(routes());
    let client = Client::with_transport("http://opencode.local", Arc::new(memory.clone())).unwrap();
    let app = TestApp::new(width, 30);
    let info = cli_config::decode_text(&config.to_string()).unwrap();
    let tui = opencode_tui::mount(
        &app,
        Deps {
            client,
            directory: "/project".into(),
            config: Resolved::new(info, |_| None),
            roots: Some(Roots {
                paths,
                storage_channel: CHANNEL.into(),
            }),
            route: Route::Session {
                id: opencode_api::generated::SessionID("ses_a".into()),
            },
            continue_: false,
            events: true,
        },
    );
    let harness = Harness {
        app,
        tui,
        memory,
        state,
        _home: home,
    };
    harness.wait_for("Fix the parser");
    harness
}

impl Harness {
    fn wait_for(&self, text: &str) -> String {
        let found = self.app.wait_until(WAIT, || self.app.text().contains(text));
        let screen = self.app.text();
        assert!(found, "{text:?} never showed:\n{screen}");
        screen
    }

    fn open(&self, id: &str) {
        self.tui.navigate(Route::Session {
            id: opencode_api::generated::SessionID(id.into()),
        });
        let opened = self
            .app
            .wait_until(WAIT, || self.ids().iter().any(|tab| tab == id));
        assert!(opened, "no {id} tab: {:?}", self.ids());
    }

    /// Waits until the tabs are `ids` and the route is the session `route`, or home.
    fn wait_tabs(&self, ids: &[&str], route: Option<&str>) {
        let route = route.map_or(Route::Home, |id| Route::Session {
            id: opencode_api::generated::SessionID(id.into()),
        });
        let found = self
            .app
            .wait_until(WAIT, || self.ids() == ids && self.tui.route() == route);
        assert!(found, "tabs {:?}, route {:?}", self.ids(), self.tui.route());
    }

    fn file(&self, key: &str) -> Value {
        let path = self
            .state
            .join(CHANNEL)
            .join("tui")
            .join(format!("{key}.json"));
        std::fs::read_to_string(path)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or(Value::Null)
    }

    /// Waits until `key`'s file satisfies `check`.
    fn wait_file(&self, key: &str, check: impl Fn(&Value) -> bool) -> Value {
        let found = self.app.wait_until(WAIT, || check(&self.file(key)));
        let value = self.file(key);
        assert!(found, "{key}.json: {value}");
        value
    }

    fn ids(&self) -> Vec<String> {
        self.tui
            .tabs
            .tabs(&self.tui)
            .into_iter()
            .map(|tab| tab.session_id)
            .collect()
    }
}

/// The stored tabs once both sessions are open and their titles have loaded.
fn both_tabs() -> Value {
    json!([{ "sessionID": "ses_a", "title": "Fix the parser" }, { "sessionID": "ses_b", "title": "Write the docs" }])
}

fn cwd() -> String {
    std::env::current_dir()
        .unwrap()
        .to_string_lossy()
        .into_owned()
}

#[test]
fn tabs_open_close_and_persist_in_the_cwd_scope() {
    let h = mount(100, json!({ "animations": false }));
    h.open("ses_b");
    let screen = h.wait_for("Write the docs");
    assert!(
        screen.lines().next().unwrap().contains("Fix the parser"),
        "{screen}"
    );
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
    let moved = h.app.wait_until(WAIT, || {
        h.tui.route()
            == Route::Session {
                id: opencode_api::generated::SessionID("ses_a".into()),
            }
    });
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
    assert!(
        screen.lines().next().unwrap().contains("Fix the parser"),
        "{screen}"
    );
}

#[test]
fn a_split_panel_shows_beside_the_session_and_resizes() {
    let h = mount(
        140,
        json!({ "animations": false, "session": { "sidebar": "hide" } }),
    );
    h.tui.panels.register(
        "test",
        "diff",
        Rc::new(
            |tui: &Tui, root: &View, input: &opencode_tui::panel::Input<'_>| {
                root.add(&Text::new(
                    &tui.app,
                    format!("panel for {}", input.target.session),
                ));
            },
        ),
    );
    let target = Target {
        plugin: "test".into(),
        name: "diff".into(),
        session: "ses_a".into(),
    };
    h.tui.panels.open(&h.tui, target, Presentation::Panel);
    let screen = h.wait_for("panel for ses_a");
    // The default width is half the panel width (140), so the panel starts at column 70.
    let row = screen
        .lines()
        .find(|line| line.contains("panel for"))
        .unwrap();
    assert_eq!(row.chars().position(|c| c == 'p'), Some(70), "{screen}");

    // Drag the handle (on the boundary's right cell, column 69) to column 89: the panel is 50 wide.
    h.app.drag((69, 10), (89, 10));
    let column = || {
        h.app
            .text()
            .lines()
            .find(|line| line.contains("panel for"))
            .and_then(|row| row.chars().position(|c| c == 'p'))
    };
    assert!(
        h.app.wait_until(WAIT, || column() == Some(90)),
        "{}",
        h.app.text()
    );
    h.wait_file("layout", |layout| layout["paneWidth"] == 50);

    // Leaving the panel's session closes it.
    h.open("ses_b");
    assert!(h.app.wait_until(WAIT, || h.tui.panels.current().is_none()));
}

// P-FILE: the TS client reads what Rust wrote and Rust reads what TS wrote, under the same lock.

#[test]
fn tabs_and_layout_are_shared_with_the_typescript_client() {
    let Some(script) = oracle() else { return };
    let h = mount(
        120,
        json!({ "animations": false, "tabs": { "layout": "vertical" } }),
    );
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
    let reloaded = h.app.wait_until(WAIT, || {
        h.ids() == ["ses_b", "ses_a"] && h.tui.frame.rail_width(&h.tui) == 50
    });
    assert!(
        reloaded,
        "tabs {:?}, rail {}",
        h.ids(),
        h.tui.frame.rail_width(&h.tui)
    );
}

// The TypeScript side of P-FILE, when bun and the workspace's node_modules are there.
fn oracle() -> Option<PathBuf> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let script = root.join("parity/oracle/E.12-tabs.ts");
    let present = root.join("../../node_modules").is_dir()
        && Command::new("bun").arg("--version").output().is_ok();
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
        .env(
            "BUN_RUNTIME_TRANSPILER_CACHE_PATH",
            std::env::temp_dir().join("opencode-rs-e12-bun-cache"),
        )
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_str(
        String::from_utf8(output.stdout)
            .unwrap()
            .lines()
            .last()
            .unwrap(),
    )
    .unwrap()
}
