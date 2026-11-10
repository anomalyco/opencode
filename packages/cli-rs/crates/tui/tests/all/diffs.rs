//! The diff viewer's lifetime (`reviews/ms3-ms4.review-carbon.md` carbon-1): a viewer goes with its panel, so its
//! file menu and its last-turn watch end when the panel closes.

use crate::support;

use std::cell::Cell;
use std::rc::Rc;
use std::sync::Arc;
use std::time::Duration;

use opencode_api::generated::SessionID;
use opencode_api::memory::{Memory, Route as MemoryRoute};
use opencode_store::SessionStatus;
use opencode_tui::{Deps, Route};
use opentui::prelude::{MouseButton, MouseEventKind};
use serde_json::{Value, json};

const DIRECTORY: &str = "/project";

fn routes(diff: Value) -> Vec<MemoryRoute> {
    let location =
        json!({ "directory": DIRECTORY, "project": { "id": "proj", "directory": DIRECTORY, "canonical": DIRECTORY } });
    let list = |data: Value| json!({ "location": location, "data": data });
    let session = json!({
        "id": "ses_a", "title": "Review", "projectID": "proj", "cost": 0,
        "tokens": { "input": 0, "output": 0, "reasoning": 0, "cache": { "read": 0, "write": 0 } },
        "time": { "created": 1, "updated": 1 },
        "location": { "directory": DIRECTORY },
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

struct Diffs {
    harness: support::Harness,
    memory: Memory,
    turns: Cell<i64>,
}

support::deref_harness!(Diffs);

fn mount(route: Route) -> Diffs {
    let diff = json!({
        "file": "src/main.rs", "patch": "@@ -1 +1 @@\n-old\n+new\n", "additions": 1, "deletions": 1,
        "status": "modified",
    });
    mount_with(route, diff, 140, 30)
}

fn mount_with(route: Route, diff: Value, width: u16, height: u16) -> Diffs {
    let memory = Memory::new(routes(diff));
    let config = json!({ "animations": false, "session": { "sidebar": "hide" }, "diffs": { "source": "turn" } });
    let deps = Deps {
        config: support::config(support::decode(&config.to_string())),
        route,
        events: true,
        ..support::deps(Arc::new(memory.clone()))
    };
    Diffs { harness: support::mount(width, height, deps), memory, turns: Cell::new(0) }
}

impl Diffs {
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
            let seen = self.app.wait_until(support::WAIT, || self.tui.data.read(|state| state.status(&id)) == status);
            assert!(seen, "{kind} did not set the status");
        }
    }
}

#[test]
fn closing_the_panel_ends_its_file_menu_and_turn_watch() {
    let h = mount(support::session_route("ses_a"));
    h.wait_for("Review");
    h.tui.keymap.dispatch("diff.open", None);
    h.wait_for("src/main.rs");
    // While the panel is open, an ended turn loads the diff again.
    let reads = h.diff_reads();
    h.turn();
    let found = h.app.wait_until(support::WAIT, || h.diff_reads() > reads);
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

// Expected (R2-1): the viewer's file tree and file menu are freed with every widget they showed once the menu closes
// and the route goes.
#[test]
fn the_file_tree_and_menu_are_freed_with_their_view() {
    let h = mount(Route::Home);
    h.wait_for("/project");
    h.tui.keymap.dispatch("diff.open", None);
    h.wait_for("≡ main.rs");
    let marker = Rc::new(());
    assert!(support::mark(&h.app, &h.tui.frame.main(), 0, &marker) > 0);
    h.open_menu();
    // The label, its row, and the overlay.
    support::mark_at(&h.app, "Mark complete", 3, &marker);
    let (x, y) = h.find("Mark complete");
    h.app.hover(x, y);
    h.app.click(x, y);
    h.assert_menu_closed();
    h.wait_for("1/1");
    // A tree row still takes the pointer while it shows.
    let (x, y) = h.find("≡ main.rs");
    h.app.hover(x, y);
    h.app.click(x, y);
    h.tui.navigate(Route::Home);
    h.app.render();
    assert_eq!(Rc::strong_count(&marker), 1);
}

// Expected (carbon-1): a plugin toggled in `/plugins` mounts the session again with its docked panel, which must not
// take the keys from the open manager.
#[test]
fn a_docked_panel_does_not_take_the_plugin_manager_search() {
    let h = mount(support::session_route("ses_a"));
    h.wait_for("Review");
    h.tui.keymap.dispatch("diff.open", None);
    h.wait_for("src/main.rs");
    crate::system::toggle_a_plugin(&h);
    h.wait_for("src/main.rs");
    h.app.type_text("zzqq");
    h.wait_for("No results found");
}

// Expected (r2 review, bigboi-ui-6): TS `diff-viewer.test.tsx` "virtualizes a large added file at %i columns without
// losing its end": the viewer shows the start of a 7,502-line added file, then its end, also after a resize.
#[test]
fn a_large_added_file_shows_its_start_and_end() {
    for width in [80, 160] {
        let patch = large_added_patch();
        let diff =
            json!({ "file": "snapshot.json", "patch": patch, "additions": 7502, "deletions": 0, "status": "added" });
        let h = mount_with(Route::Home, diff, width, 24);
        h.wait_for("/project");
        h.tui.keymap.dispatch("diff.open", None);
        h.wait_for("row-0000");
        h.tui.keymap.dispatch("diff.last", None);
        h.wait_for("row-7499");
        h.tui.keymap.dispatch("diff.first", None);
        h.wait_for("row-0000");
        h.app.resize(if width == 80 { 160 } else { 80 }, 20);
        // The viewer draws again at the new width first (TS awaits a flush).
        h.app.render();
        h.tui.keymap.dispatch("diff.last", None);
        h.wait_for("row-7499");
    }
}

/// The added JSON file of TS `diff-viewer.test.tsx`: 7,502 lines, one of them very long.
fn large_added_patch() -> String {
    let rows = (0..7500).map(|index| {
        let repeat = if index == 777 {
            2000
        } else if index % 7 == 0 {
            24
        } else {
            1
        };
        let comma = if index == 7499 { "" } else { "," };
        format!("+  \"row-{index:04}\": \"{}\"{comma}", "value".repeat(repeat))
    });
    let lines: Vec<String> = std::iter::once("+{".to_owned()).chain(rows).chain(["+}".to_owned()]).collect();
    format!(
        "diff --git a/snapshot.json b/snapshot.json\nnew file mode 100644\n--- /dev/null\n+++ b/snapshot.json\n@@ -0,0 +1,{} @@\n{}",
        lines.len(),
        lines.join("\n")
    )
}
