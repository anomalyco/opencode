//! The diff viewer's lifetime (`reviews/ms3-ms4.review-carbon.md` carbon-1): a viewer goes with its panel, so its
//! file menu and its last-turn watch end when the panel closes.

use std::cell::Cell;
use std::sync::Arc;
use std::time::Duration;

use opencode_api::client::Client;
use opencode_api::generated::SessionID;
use opencode_api::memory::{Memory, Route as MemoryRoute};
use opencode_local::cli_config::{self, Resolved};
use opencode_store::SessionStatus;
use opencode_tui::{Deps, Route, Tui};
use opentui::prelude::{MouseButton, MouseEventKind};
use opentui::testing::TestApp;
use serde_json::{Value, json};

const DIRECTORY: &str = "/project";

fn routes() -> Vec<MemoryRoute> {
    let location =
        json!({ "directory": DIRECTORY, "project": { "id": "proj", "directory": DIRECTORY, "canonical": DIRECTORY } });
    let list = |data: Value| json!({ "location": location, "data": data });
    let session = json!({
        "id": "ses_a", "title": "Review", "projectID": "proj", "cost": 0,
        "tokens": { "input": 0, "output": 0, "reasoning": 0, "cache": { "read": 0, "write": 0 } },
        "time": { "created": 1, "updated": 1 },
        "location": { "directory": DIRECTORY },
    });
    let diff = json!({
        "file": "src/main.rs", "patch": "@@ -1 +1 @@\n-old\n+new\n", "additions": 1, "deletions": 1,
        "status": "modified",
    });
    vec![
        MemoryRoute::json("GET", "/api/location", 200, &location),
        MemoryRoute::json("GET", "/api/agent", 200, &list(json!([]))),
        MemoryRoute::json("GET", "/api/model", 200, &list(json!([]))),
        MemoryRoute::json("GET", "/api/session/ses_a", 200, &json!({ "data": session })),
        MemoryRoute::json("GET", "/api/session", 200, &json!({ "data": [], "cursor": {} })),
        MemoryRoute::json("GET", "/api/session/ses_a/diff", 200, &json!({ "data": [diff] })),
        MemoryRoute::json("GET", "/api/vcs/base", 200, &list(Value::Null)),
        MemoryRoute::json("GET", "/api/vcs/diff", 200, &list(json!([diff]))),
        MemoryRoute::json("GET", "/api/session/:id/message", 200, &json!({ "data": [], "cursor": {} })),
        MemoryRoute::json("GET", "/api/session/:id/inbox", 200, &json!({ "data": [] })),
        MemoryRoute::json("GET", "/api/session/:id/permission", 200, &json!({ "data": [] })),
    ]
}

struct Harness {
    app: TestApp,
    tui: std::rc::Rc<Tui>,
    memory: Memory,
    turns: Cell<i64>,
}

fn mount(route: Route) -> Harness {
    let memory = Memory::new(routes());
    let client = Client::with_transport("http://opencode.local", Arc::new(memory.clone())).unwrap();
    let app = TestApp::new(140, 30);
    let config = json!({ "animations": false, "session": { "sidebar": "hide" }, "diffs": { "source": "turn" } });
    let info = cli_config::decode_text(&config.to_string()).unwrap();
    let tui = opencode_tui::mount(
        &app,
        Deps {
            client,
            directory: DIRECTORY.into(),
            config: Resolved::new(info, |_| None),
            roots: None,
            route,
            continue_: false,
            events: true,
        },
    );
    Harness { app, tui, memory, turns: Cell::new(0) }
}

impl Harness {
    fn wait_for(&self, what: &str) -> String {
        let found = self.app.wait_until(Duration::from_secs(5), || self.app.text().contains(what));
        let screen = self.app.text();
        assert!(found, "{what} never showed:\n{screen}");
        screen
    }

    /// Right-clicks the file's header, and waits for its menu.
    fn open_menu(&self) {
        let screen = self.wait_for("src/main.rs");
        let (y, line) = screen.lines().enumerate().find(|(_, line)| line.contains("src/main.rs")).unwrap();
        let x = line[..line.find("src/main.rs").unwrap()].chars().count() as u16;
        self.app.mouse(MouseEventKind::Down(MouseButton::Right), x, y as u16);
        self.wait_for("Mark complete");
        assert_eq!(self.tui.keymap.mode(), "menu");
    }

    /// The menu is gone, with its mode.
    fn assert_menu_closed(&self) {
        self.app.advance(Duration::from_millis(1));
        let screen = self.app.text();
        assert!(!screen.contains("Mark complete"), "the menu stayed:\n{screen}");
        assert_ne!(self.tui.keymap.mode(), "menu", "the menu kept its mode");
    }

    fn diff_reads(&self) -> usize {
        self.memory
            .requests()
            .iter()
            .filter(|logged| logged.method == "GET" && logged.path == "/api/session/ses_a/diff")
            .count()
    }

    /// A turn of `ses_a` starts and ends.
    fn turn(&self) {
        for (kind, status) in [
            ("session.execution.started", SessionStatus::Running),
            ("session.execution.succeeded", SessionStatus::Idle),
        ] {
            let turn = self.turns.get() + 1;
            self.turns.set(turn);
            self.memory.emit(&json!({
                "id": format!("evt_{turn}"), "created": turn, "type": kind,
                "durable": { "aggregateID": "ses_a", "seq": turn, "version": 1 },
                "data": { "sessionID": "ses_a" },
            }));
            let id = SessionID("ses_a".into());
            let seen =
                self.app.wait_until(Duration::from_secs(5), || self.tui.data.read(|state| state.status(&id)) == status);
            assert!(seen, "{kind} did not set the status");
        }
    }
}

#[test]
fn closing_the_panel_ends_its_file_menu_and_turn_watch() {
    let h = mount(Route::Session { id: SessionID("ses_a".into()) });
    h.wait_for("Review");
    h.tui.keymap.dispatch("diff.open", None);
    h.wait_for("src/main.rs");
    // While the panel is open, an ended turn loads the diff again.
    let reads = h.diff_reads();
    h.turn();
    let found = h.app.wait_until(Duration::from_secs(5), || h.diff_reads() > reads);
    assert!(found, "an ended turn did not load the diff again");
    h.open_menu();
    h.tui.panels.close(&h.tui);
    h.assert_menu_closed();

    let reads = h.diff_reads();
    h.turn();
    h.app.advance(Duration::from_millis(200));
    assert_eq!(h.diff_reads(), reads, "the closed viewer loaded the turn again");
}

#[test]
fn leaving_the_route_ends_its_file_menu() {
    let h = mount(Route::Home);
    h.wait_for("/project");
    h.tui.keymap.dispatch("diff.open", None);
    h.open_menu();
    h.tui.navigate(Route::Home);
    h.assert_menu_closed();
}
