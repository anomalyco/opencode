//! Exercise the diff viewer's lifecycle and controls over real input and recorded server responses.

use crate::support;

use std::cell::Cell;
use std::rc::Rc;
use std::sync::Arc;
use std::time::Duration;

use opencode_api::generated::SessionID;
use opencode_api::memory::{Memory, Route as MemoryRoute};
use opencode_plugin::reconcile;
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
    let diff = if diff.is_array() { diff } else { json!([diff]) };
    vec![
        MemoryRoute::json("GET", "/api/location", 200, &location),
        MemoryRoute::json("GET", "/api/agent", 200, &list(json!([]))),
        MemoryRoute::json("GET", "/api/model", 200, &list(json!([]))),
        MemoryRoute::json("GET", "/api/session/ses_a", 200, &json!({ "data": session })),
        MemoryRoute::json("GET", "/api/session", 200, &json!({ "data": [], "cursor": {} })),
        MemoryRoute::json("GET", "/api/session/ses_a/diff", 200, &json!({ "data": diff })),
        MemoryRoute::json("GET", "/api/vcs/base", 200, &list(Value::Null)),
        MemoryRoute::json("GET", "/api/vcs/diff", 200, &list(diff)),
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
    mount_on(route, diff, width, height, ABI.with(Cell::get))
}

thread_local! {
    static ABI: Cell<bool> = const { Cell::new(false) };
}

/// Runs `row` with the built-ins linked, then on the C ABI's byte shims: 4.9's scenarios on both carriers.
fn on_both(row: impl Fn()) {
    for abi in [false, true] {
        eprintln!("the {} carrier", if abi { "C ABI" } else { "linked" });
        ABI.with(|cell| cell.set(abi));
        row();
    }
    ABI.with(|cell| cell.set(false));
}

fn mount_config(route: Route, config: Value) -> Diffs {
    let memory = Memory::new(routes(json!([hunk_file(0, 4)])));
    let mut merged = json!({ "animations": false, "session": { "sidebar": "hide" }, "diffs": { "source": "turn" } });
    merged.as_object_mut().unwrap().extend(config.as_object().unwrap().clone());
    let deps = Deps {
        config: support::config(support::decode(&merged.to_string())),
        route,
        events: true,
        abi_builtins: ABI.with(Cell::get),
        ..support::deps(Arc::new(memory.clone()))
    };
    let harness = support::mount(120, 30, deps);
    let now = std::time::Instant::now();
    harness.tui.plugins.monitor().set_clock(move || now);
    Diffs { harness, memory, turns: Cell::new(0) }
}

/// [`mount_with`], with the built-ins on the C ABI's byte shims when `abi`.
fn mount_on(route: Route, diff: Value, width: u16, height: u16, abi: bool) -> Diffs {
    mount_routes(route, routes(diff), width, height, abi)
}

/// The session diff's route, which a row may hold.
const SESSION_DIFF: &str = "/api/session/ses_a/diff";

fn mount_routes(route: Route, routes: Vec<MemoryRoute>, width: u16, height: u16, abi: bool) -> Diffs {
    let memory = Memory::new(routes);
    let config = json!({ "animations": false, "session": { "sidebar": "hide" }, "diffs": { "source": "turn" } });
    let deps = Deps {
        config: support::config(support::decode(&config.to_string())),
        route,
        events: true,
        abi_builtins: abi,
        ..support::deps(Arc::new(memory.clone()))
    };
    let harness = support::mount(width, height, deps);
    // The budget's verdicts are not what these rows check, and a debug build of the C ABI's view at 1,000 files runs
    // past it: a call here takes no time, as in `plugin_model`.
    let now = std::time::Instant::now();
    harness.tui.plugins.monitor().set_clock(move || now);
    Diffs { harness, memory, turns: Cell::new(0) }
}

impl Diffs {
    /// Right-clicks the file's header, and waits for its menu.
    fn open_menu(&self) {
        let screen = self.wait_for("src/main.rs");
        let (y, line) = screen.lines().enumerate().find(|(_, line)| line.contains("src/main.rs")).unwrap();
        let x = line[..line.find("src/main.rs").unwrap()].chars().count() as u16;
        self.app.mouse(MouseEventKind::Down(MouseButton::Right), x, y as u16);
        self.wait_for("Mark complete");
        // The menu is the plugin's overlay, which holds the focus: the viewer's keys wait.
        assert_ne!(opencode_plugin::interact::ledger(&*opencode_tui::plugins::host::host(&self.tui)).overlays, 0);
    }

    fn assert_menu_closed(&self) {
        self.app.advance(Duration::from_millis(1));
        let screen = self.app.text();
        assert!(!screen.contains("Mark complete"), "the menu stayed:\n{screen}");
        assert_eq!(opencode_plugin::interact::ledger(&*opencode_tui::plugins::host::host(&self.tui)).overlays, 0);
    }

    fn diff_reads(&self) -> usize {
        self.memory
            .requests()
            .iter()
            .filter(|logged| logged.method == "GET" && logged.path == "/api/session/ses_a/diff")
            .count()
    }

    /// Deliver start and end in the same UI turn so both events arrive before the next sync.
    fn short_turn(&self, session: &str) {
        for (kind, status) in [
            ("session.execution.started", SessionStatus::Running),
            ("session.execution.succeeded", SessionStatus::Idle),
        ] {
            let turn = self.turns.get() + 1;
            self.turns.set(turn);
            self.memory.emit(&json!({
                "id": format!("evt_{turn}"), "created": turn, "type": kind,
                "durable": { "aggregateID": session, "seq": turn, "version": 1 },
                "data": { "sessionID": session },
            }));
            let id = SessionID(session.into());
            let started = std::time::Instant::now();
            while self.tui.data.read(|state| state.status(&id)) != status {
                assert!(started.elapsed() < support::WAIT, "{kind} did not set the status");
                std::thread::sleep(Duration::from_millis(1));
            }
        }
    }

    /// Wait for the requested diff to become visible; observing a request alone does not guarantee the reply has
    /// rendered.
    fn reloaded(&self, before: usize) {
        let held = || opencode_plugin::surface::ledger_of("opencode.diffs").content_bytes;
        let landed = self
            .app
            .wait_until(support::WAIT, || self.diff_reads() > before && self.memory.in_flight() == 0 && held() > 0);
        assert!(landed, "the reload did not land: {} reads, {} in flight", self.diff_reads(), self.memory.in_flight());
        self.settle();
    }

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
    on_both(|| {
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
    });
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

#[test]
fn the_file_tree_and_menu_are_freed_with_their_view() {
    let h = mount(Route::Home);
    h.wait_for("/project");
    h.tui.keymap.dispatch("diff.open", None);
    h.wait_for("≡ main.rs");
    let marker = Rc::new(());
    assert!(support::mark(&h.app, &h.tui.frame.main(), 0, &marker) > 0);
    h.open_menu();
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

#[test]
fn the_file_tree_follows_the_selection_and_its_help_opens() {
    let files: Vec<Value> = (0..35)
        .map(|index| {
            json!({
                "file": format!("src/file_{index:02}.rs"), "patch": "@@ -1 +1 @@\n-old\n+new\n",
                "additions": 1, "deletions": 1, "status": "modified",
            })
        })
        .collect();
    let h = mount_with(Route::Home, Value::Array(files), 120, 20);
    h.wait_for("/project");
    h.tui.keymap.dispatch("diff.open", None);
    h.wait_for("≡ file_00.rs");
    for _ in 0..25 {
        h.dispatch("diff.next_file");
    }
    h.wait_for("≡ file_25.rs");
    assert!(!h.app.text().contains("≡ file_00.rs"), "{}", h.app.text());

    let (x, y) = h.find(" help");
    h.app.click(x + 1, y);
    h.wait("the help did not open", || h.tui.dialogs.is_open());
}

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
        // Render at the new width before checking the layout.
        h.app.render();
        h.tui.keymap.dispatch("diff.last", None);
        h.wait_for("row-7499");
    }
}

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

#[test]
fn the_viewer_runs_on_both_carriers() {
    let file = |path: &str, patch: &str, status: &str| json!({ "file": path, "patch": patch, "additions": 1, "deletions": 1, "status": status });
    let diff = json!([
        file("README.md", "@@ -1 +1 @@\n-old\n+new\n", "modified"),
        file("docs/old.md", "@@ -1,2 +0,0 @@\n-Old notes\n-more\n", "deleted"),
        file("src/main.rs", "@@ -1 +1 @@\n-old\n+new\n", "modified"),
        file("src/lib.rs", "@@ -1 +1 @@\n-old\n+new\n", "modified"),
        file("src/util.rs", "@@ -1 +1 @@\n-old\n+new\n", "modified"),
    ]);
    for abi in [false, true] {
        let h = mount_on(support::session_route("ses_a"), diff.clone(), 140, 30, abi);
        h.wait_for("Review");
        h.tui.keymap.dispatch("diff.open", None);
        let found = h.app.wait_until(support::WAIT, || h.app.text().contains("README.md"));
        let failed: Vec<_> = h.tui.plugins.entries().into_iter().filter(|entry| entry.id == "opencode.diffs").collect();
        assert!(found, "abi {abi}: {failed:?}\n{}", h.app.text());
    }
}

fn hunk_file(index: usize, lines: usize) -> Value {
    let body: String = (0..lines)
        .map(|line| match line {
            2 => format!("-old {index}\n+new {index}\n"),
            _ => format!(" line {line} of {index}\n"),
        })
        .collect();
    json!({
        "file": format!("src/f{index:04}.rs"), "patch": format!("@@ -1,{lines} +1,{lines} @@\n{body}"),
        "additions": 1, "deletions": 1, "status": "modified",
    })
}

fn route(count: usize, lines: usize, width: u16, height: u16) -> Diffs {
    route_on(count, lines, width, height, false)
}

/// [`route`], with the built-ins on the C ABI's byte shims when `abi`.
fn route_on(count: usize, lines: usize, width: u16, height: u16, abi: bool) -> Diffs {
    let files: Vec<Value> = (0..count).map(|index| hunk_file(index, lines)).collect();
    let h = mount_on(Route::Home, Value::Array(files), width, height, abi);
    h.wait_for("/project");
    h.tui.keymap.dispatch("diff.open", None);
    h.wait_for("f0000.rs");
    h.settle();
    h
}

impl Diffs {
    /// Draws until the app wants no more frames.
    fn settle(&self) -> String {
        for _ in 0..20 {
            self.app.render();
            if !self.app.needs_frame() {
                break;
            }
        }
        self.app.text()
    }

    fn keys(&self, keys: &[&str]) -> String {
        for key in keys {
            self.app.press(key);
        }
        self.settle()
    }

    /// The files whose tree rows say they are reviewed: the tree is the screen's first `TREE` columns.
    fn reviewed(&self) -> Vec<String> {
        self.settle()
            .lines()
            .filter_map(|line| {
                let row: String = line.chars().take(TREE).collect();
                let at = row.find("≡ f")?;
                let name = row[at + "≡ ".len()..].split_whitespace().next()?.to_owned();
                row.trim_end().ends_with('✓').then_some(name)
            })
            .collect()
    }

    /// The first row of the cards, under the fixed edge, right of the tree.
    fn top_card_row(&self) -> String {
        let screen = self.settle();
        screen.lines().nth(1).map(|row| row.chars().skip(TREE).collect()).unwrap_or_default()
    }
}

/// The tree's width at 120 columns.
const TREE: usize = 30;

#[test]
fn a_hunk_step_starts_below_the_sticky_header() {
    on_both(|| {
        let h = route(4, 4, 120, 30);
        h.keys(&["]", "m"]);
        assert_eq!(h.reviewed(), ["f0001.rs"]);
    });
}

#[test]
fn the_current_file_is_the_card_at_the_top() {
    on_both(|| {
        let h = route(4, 12, 120, 30);
        h.keys(&["n"]);
        let row = h.top_card_row();
        assert!(row.contains("src/f0001.rs") && !row.contains('▄'), "{row:?}\n{}", h.app.text());
        h.keys(&["j", "m"]);
        assert_eq!(h.reviewed(), ["f0001.rs"]);
    });
}

#[test]
fn hunk_steps_near_the_bottom_go_on_from_the_last() {
    on_both(|| {
        let marked = |keys: &[&str]| {
            let h = route(6, 4, 120, 20);
            h.keys(&["shift+g"]);
            h.keys(keys);
            h.keys(&["m"]);
            h.reviewed()
        };
        let once = marked(&["]"]);
        assert_eq!(once.len(), 1, "{once:?}");
        assert_eq!(marked(&["]", "]", "["]), once);
        let twice = marked(&["]", "]"]);
        assert_eq!(twice.len(), 1, "{twice:?}");
        assert_ne!(twice, once, "the second step at the end did not move on");
    });
}

#[test]
fn a_file_marked_above_the_view_keeps_the_reading_position() {
    on_both(|| {
        let h = route(5, 12, 120, 30);
        h.keys(&["n", "n"]);
        let before = h.top_card_row();
        assert!(before.contains("src/f0002.rs"), "{before:?}");
        let (x, y) = h.find("≡ f0000.rs");
        h.app.mouse(MouseEventKind::Down(MouseButton::Right), x, y);
        h.wait_for("Mark complete");
        // The first frame the mark presents already holds the reading position, not only the settled one.
        h.app.press("return");
        let first = h.app.render().text();
        let first: String = first.lines().nth(1).map(|row| row.chars().skip(TREE).collect()).unwrap_or_default();
        assert_eq!(first, before, "the first frame moved the reading position");
        assert_eq!(h.reviewed(), ["f0000.rs"]);
        assert_eq!(h.top_card_row(), before, "the reading position moved");
        for _ in 0..40 {
            h.app.scroll(80, 10, false);
        }
        let screen = h.settle();
        let heading = screen.lines().find(|line| line.contains("src/f0000.rs")).unwrap_or_default();
        assert!(heading.contains('✓') && !screen.contains("old 0"), "{screen}");
    });
}

#[test]
fn many_files_open_and_reach_the_last() {
    on_both(|| {
        for count in [410, 1000] {
            let h = route(count, 4, 120, 30);
            let last = format!("src/f{:04}.rs", count - 1);
            h.keys(&["shift+g"]);
            h.wait_for(&last);
            h.keys(&["m"]);
            h.wait_for(&format!("1/{count}"));
        }
    });
}

#[test]
fn a_jump_across_the_split_threshold_lands_as_at_the_new_width() {
    on_both(|| {
        let jumped = |resize: bool| {
            let h = route(4, 30, if resize { 140 } else { 120 }, 30);
            h.app.press("]");
            if resize {
                h.app.resize(120, 30);
            }
            let first = h.app.render().text();
            let settled = h.settle();
            assert_eq!(first, settled, "the first frame was not the settled one");
            settled
        };
        let narrow = jumped(false);
        assert!(narrow.contains("+new 1") || narrow.contains("+ new 1"), "{narrow}");
        assert_eq!(jumped(true), narrow);
    });
}

#[test]
fn a_resize_shows_the_new_size_in_its_first_frame() {
    on_both(|| {
        for (width, height, resized) in [(140, 30, 120), (48, 28, 24)] {
            let h = route(1000, 30, width, height);
            h.app.scroll(width - 4, 10, true);
            h.settle();
            h.app.press("]");
            h.settle();
            let before = h.app.text();
            h.app.resize(resized, height);
            let first = h.app.render().text();
            assert_ne!(first, before, "{width} to {resized}: the resize showed nothing new");
            assert_eq!(first, h.settle(), "{width} to {resized}: the first frame was not the settled one");
        }
    });
}

#[test]
fn a_rebuild_at_1000_files_builds_what_it_changes() {
    on_both(|| {
        let rebuilds = |count: usize| {
            let h = route(count, 4, 200, 40);
            let step = |run: &dyn Fn()| {
                h.settle();
                let before = reconcile::work();
                run();
                h.settle();
                let done = reconcile::work().since(before);
                (done.touched(), done.items)
            };
            let theme = || {
                assert!(h.tui.theme.borrow_mut().set("tokyonight"));
                h.tui.theme_changed();
            };
            [step(&|| h.app.press("m")), step(&|| h.app.press("v")), step(&|| h.app.resize(140, 40)), step(&theme)]
        };
        let (small, large) = (rebuilds(410), rebuilds(1000));
        let touched = |steps: &[(u64, u64); 4]| steps.map(|(touched, _)| touched);
        assert_eq!(touched(&large), touched(&small), "widgets touched at 1,000 files and 410: {large:?} {small:?}");
        assert_eq!(large.map(|(_, items)| items), [2, 1000, 0, 1001], "{large:?}");
        assert_eq!(small.map(|(_, items)| items), [2, 410, 0, 411], "{small:?}");
    });
}

// Expected (viewer-frames): a card's heading, kept through a resize that cuts its path the same, shows the path as cut
// for the new width once it cuts it otherwise: as a viewer opened at that width does, on both carriers.
#[test]
fn a_resize_cuts_a_long_heading_for_the_new_width() {
    on_both(|| {
        let long = "src/a/rather/long/directory/that/the/heading/cuts/at/narrow/widths/f0000.rs";
        let file = json!({ "file": long, "patch": "@@ -1,2 +1,2 @@\n line\n-old\n+new\n", "additions": 1,
            "deletions": 1, "status": "modified" });
        let heading = |h: &Diffs| {
            let screen = h.settle();
            screen.lines().find(|line| line.contains("f0000.rs") && line.contains("+1")).unwrap_or_default().to_owned()
        };
        let opened = |width: u16| {
            let h = mount_with(Route::Home, json!([file.clone()]), width, 30);
            h.wait_for("/project");
            h.tui.keymap.dispatch("diff.open", None);
            h.wait_for("f0000.rs");
            h
        };
        let h = opened(160);
        let wide = heading(&h);
        h.app.resize(100, 30);
        let resized = heading(&h);
        assert_ne!(resized, wide, "the heading was not cut again");
        assert_eq!(resized, heading(&opened(100)));
    });
}

#[test]
fn the_file_menu_opens_on_the_right_button_down() {
    on_both(|| {
        let h = route(2, 4, 120, 30);
        let (x, y) = h.find("≡ f0001.rs");
        h.app.mouse(MouseEventKind::Down(MouseButton::Right), x, y);
        h.wait_for("Mark complete");
        h.app.mouse(MouseEventKind::Up(MouseButton::Right), x, y);
        assert!(h.settle().contains("Mark complete"));
    });
}

#[test]
fn the_route_opens_from_home_and_goes_back() {
    on_both(|| {
        let h = route(1, 4, 120, 30);
        assert_eq!(h.tui.route(), Route::Plugin { id: "opencode.diffs".into(), name: "diff".into() });
        h.keys(&["q"]);
        h.wait("the route did not go back home", || h.tui.route() == Route::Home);
    });
}

#[test]
fn the_docked_panel_takes_the_keys_only_with_the_focus() {
    on_both(|| {
        let h = mount(support::session_route("ses_a"));
        h.wait_for("Review");
        h.tui.keymap.dispatch("diff.open", None);
        h.wait_for("src/main.rs");
        h.keys(&["m"]);
        h.wait_for("1/1");
        h.dispatch("pane.focus.left");
        h.keys(&["m"]);
        assert_eq!(h.text(), "m", "the composer did not take the key");
        assert!(h.settle().contains("1/1"), "the panel took the key");
        let (x, y) = h.find("src/main.rs");
        h.app.click(x, y);
        h.keys(&["m"]);
        h.wait_for("0/1");
    });
}

#[test]
fn ctrl_c_closes_one_level_of_the_viewer() {
    let stats = Route::Plugin { id: "opencode.stats".into(), name: "stats".into() };
    let diff = Route::Plugin { id: "opencode.diffs".into(), name: "diff".into() };
    for rebound in [false, true] {
        on_both(|| {
            let h = match rebound {
                false => mount_with(Route::Home, json!([hunk_file(0, 4)]), 120, 30),
                true => mount_config(Route::Home, json!({ "keybinds": { "app.exit": "ctrl+q" } })),
            };
            h.wait_for("/project");
            h.tui.navigate(stats.clone());
            h.wait("stats did not show", || h.tui.route() == stats);
            h.tui.keymap.dispatch("diff.open", None);
            h.wait_for("≡ f0000.rs");
            let (x, y) = h.find("src/f0000.rs");
            h.app.mouse(MouseEventKind::Down(MouseButton::Right), x, y);
            h.wait_for("Mark complete");
            h.keys(&["ctrl+c"]);
            h.assert_menu_closed();
            assert_eq!(h.tui.route(), diff, "the chord closed more than the menu");
            h.keys(&["ctrl+c"]);
            h.wait("ctrl+c did not go back to stats", || h.tui.route() == stats);
            h.keys(&["ctrl+c"]);
            h.wait("ctrl+c did not go home", || h.tui.route() == Route::Home);
            assert!(!h.app.app().is_quitting());
            if !rebound {
                h.keys(&["ctrl+c"]);
                assert!(h.app.app().is_quitting(), "ctrl+c on home is app.exit's");
            }
        });
    }
    on_both(|| {
        let h = mount(support::session_route("ses_a"));
        h.wait_for("Review");
        h.dispatch("pane.focus.left");
        h.app.type_text("draft");
        h.tui.keymap.dispatch("diff.open", None);
        h.wait_for("focus prompt");
        h.keys(&["ctrl+c"]);
        h.wait("ctrl+c did not close the panel", || h.tui.panels.current().is_none());
        assert!(!h.app.app().is_quitting());
        assert_eq!(h.text(), "draft", "the chord lost the composer's draft");
    });
}

fn diffs_setting(h: &Diffs) -> serde_json::Value {
    h.tui.settings.info().to_value()["diffs"].clone()
}

#[test]
fn a_setting_saves_only_what_it_takes() {
    let h = route(2, 4, 140, 30);
    h.keys(&["v"]);
    h.wait("the view was not saved", || diffs_setting(&h)["view"] == "unified");
    let setup = |setup: &mut opencode_plugin::abi::Setup| {
        let command = opencode_plugin::abi::Command::new("probe.set");
        setup.command(command, |host, _| {
            host.set_setting("diffs.view", json!("sideways"));
            host.set_setting("diffs.tree", json!("yes"));
            host.set_setting("theme.name", json!("light"));
        });
        Ok(())
    };
    opencode_tui::plugins::host::add(&h.tui, opencode_plugin::abi::Plugin { id: "probe", setup }.into());
    h.dispatch("probe.set");
    h.settle();
    assert_eq!(diffs_setting(&h)["view"], "unified");
    assert!(diffs_setting(&h)["tree"].is_null(), "{}", diffs_setting(&h));
    assert_ne!(h.tui.settings.info().to_value()["theme"]["name"], "light");
}

#[test]
fn full_screen_is_saved_only_when_the_panel_toggles() {
    for (width, saved) in [(100, serde_json::Value::Null), (140, json!(true))] {
        let h = mount_with(support::session_route("ses_a"), json!([hunk_file(0, 4)]), width, 30);
        h.wait_for("Review");
        h.tui.keymap.dispatch("diff.open", None);
        h.wait_for("src/f0000.rs");
        h.keys(&["f"]);
        h.app.advance(Duration::from_millis(50));
        assert_eq!(diffs_setting(&h)["fullscreen"], saved, "at {width}");
    }
}

fn base_picker(branches: Value) -> Diffs {
    let files: Vec<Value> = (0..2).map(|index| hunk_file(index, 4)).collect();
    let list = json!({ "location": { "directory": DIRECTORY }, "data": branches });
    let memory = Memory::new(
        routes(Value::Array(files))
            .into_iter()
            .chain([MemoryRoute::json("GET", "/api/vcs/branch", 200, &list)])
            .collect(),
    );
    let config = json!({ "animations": false, "diffs": { "source": "branch" } });
    let deps = Deps {
        config: support::config(support::decode(&config.to_string())),
        route: Route::Home,
        events: true,
        ..support::deps(Arc::new(memory.clone()))
    };
    let h = Diffs { harness: support::mount(120, 30, deps), memory, turns: Cell::new(0) };
    h.wait_for("/project");
    h.tui.keymap.dispatch("diff.open", None);
    h.wait_for("≡ f0000.rs");
    h.keys(&["d"]);
    h.wait_for("Diff source");
    h.keys(&["down", "down", "down", "return"]);
    h
}

impl Diffs {
    fn searched(&self, search: &str) -> bool {
        self.memory.requests().iter().any(|logged| {
            logged.path == "/api/vcs/branch" && logged.query.get("search").is_some_and(|values| values == &[search])
        })
    }
}

#[test]
fn the_base_picker_searches_the_server_as_the_user_types() {
    let h = base_picker(json!([]));
    h.wait_for("No branches found");
    h.app.type_text("rel");
    h.settle();
    assert!(!h.searched("rel"), "the search did not wait");
    h.app.advance(Duration::from_millis(200));
    h.wait("the picker did not search the server", || h.searched("rel"));
    h.wait_for("No branches found");
}

#[test]
fn the_base_picker_shows_what_the_server_found() {
    let h = base_picker(json!(["refs/heads/trunk-x"]));
    h.wait_for("trunk-x");
    h.app.type_text("zz");
    h.app.advance(Duration::from_millis(200));
    h.wait("the picker did not search the server", || h.searched("zz"));
    h.app.advance(Duration::from_millis(50));
    assert!(h.settle().contains("trunk-x"), "{}", h.app.text());
}

#[test]
fn a_wheel_step_builds_the_tree_only_when_it_ends_a_selection() {
    let h = route(40, 4, 120, 30);
    let wheel = |down: bool| {
        let before = reconcile::work();
        h.app.scroll(80, 10, down);
        h.settle();
        reconcile::work().since(before)
    };
    let work = wheel(true);
    assert_eq!(work, reconcile::Work::default());
    h.keys(&["n"]);
    let work = wheel(false);
    assert!(work.kept > 1 && work.touched() > 0, "{work:?}");
}

#[test]
fn the_picked_source_outlives_the_viewer() {
    let h = route(2, 4, 120, 30);
    assert!(h.settle().contains("All"));
    h.keys(&["d"]);
    h.wait_for("Diff source");
    h.keys(&["down", "down", "return"]);
    h.wait_for("Uncommitted");
    h.keys(&["q"]);
    h.wait("q did not close the viewer", || h.tui.route() == Route::Home);
    h.tui.keymap.dispatch("diff.open", None);
    h.wait_for("≡ f0000.rs");
    assert!(h.settle().contains("Uncommitted"), "{}", h.app.text());
}

#[test]
fn new_files_close_the_file_menu() {
    let h = mount(support::session_route("ses_a"));
    h.wait_for("Review");
    h.tui.keymap.dispatch("diff.open", None);
    h.wait_for("src/main.rs");
    h.open_menu();
    let reads = h.diff_reads();
    h.turn();
    h.wait("an ended turn did not load the diff again", || h.diff_reads() > reads);
    h.assert_menu_closed();
}

#[test]
fn the_tree_scrolls_only_as_far_as_its_selection() {
    let h = route(40, 4, 120, 30);
    h.keys(&["n", "n", "n"]);
    let tree: String = h.settle().lines().map(|line| line.chars().take(30).collect::<String>() + "\n").collect();
    assert!(tree.contains("f0000.rs") && tree.contains("f0003.rs"), "{tree}");
}

#[test]
fn a_patch_line_wraps_inside_its_words() {
    let line = "abcdefghij ".repeat(12);
    let file = json!({
        "file": "src/long.rs", "patch": format!("@@ -1 +1 @@\n-old\n+{line}\n"),
        "additions": 1, "deletions": 1, "status": "modified",
    });
    let h = mount_with(Route::Home, json!([file]), 120, 30);
    h.wait_for("/project");
    h.tui.keymap.dispatch("diff.open", None);
    h.wait_for("≡ long.rs");
    let screen = h.settle();
    let words: Vec<&str> = screen
        .split_whitespace()
        .filter(|word| word.len() > 1 && word.chars().all(|char| ('a'..='j').contains(&char)))
        .collect();
    assert!(words.len() > 12 && words.iter().any(|word| *word != "abcdefghij"), "{screen}");
}

#[test]
fn the_docked_footer_follows_the_panels_focus() {
    let h = mount(support::session_route("ses_a"));
    h.wait_for("Review");
    h.tui.keymap.dispatch("diff.open", None);
    h.wait_for("focus prompt");
    let footer = |h: &Diffs| {
        h.settle();
        let (x, y) = h.find("focus prompt");
        let capture = h.app.render();
        let cell = capture.cell(u32::from(x), u32::from(y)).unwrap();
        (cell.fg, cell.attributes)
    };
    let focused = footer(&h);
    h.dispatch("pane.focus.left");
    let left = footer(&h);
    assert_ne!(left, focused, "the footer did not dim");
    let (x, y) = h.find("src/main.rs");
    h.app.click(x, y);
    assert_eq!(footer(&h), focused, "the footer did not light again");
}

#[test]
fn a_turn_too_short_to_see_running_loads_the_diff_again() {
    for abi in [false, true] {
        let diff = json!({
            "file": "src/main.rs", "patch": "@@ -1 +1 @@\n-old\n+new\n", "additions": 1, "deletions": 1,
            "status": "modified",
        });
        let h = mount_on(support::session_route("ses_a"), diff, 140, 30, abi);
        h.wait_for("Review");
        h.tui.keymap.dispatch("diff.open", None);
        h.wait_for("src/main.rs");
        let reads = h.diff_reads();
        h.short_turn("ses_b");
        h.settle();
        h.app.advance(Duration::from_millis(50));
        assert_eq!(h.diff_reads(), reads, "another session's turn loaded the diff (C ABI: {abi})");
        h.short_turn("ses_a");
        let loaded = h.app.wait_until(support::WAIT, || h.diff_reads() > reads);
        assert!(loaded, "a short turn did not load the diff again (C ABI: {abi})");
    }
}

#[test]
fn a_mark_at_1000_files_costs_one_pass_on_both_carriers() {
    for abi in [false, true] {
        let h = route_on(1000, 4, 200, 58, abi);
        let (work, crossed) = (reconcile::work(), opencode_plugin::loader::native::crossed());
        h.keys(&["m"]);
        assert!(h.settle().contains("1/1000"), "{}", h.app.text());
        let (work, crossed) =
            (reconcile::work().since(work), opencode_plugin::loader::native::crossed().since(crossed));
        assert!(work.kept >= 999 + 998, "the mark kept {} subtrees (C ABI: {abi})", work.kept);
        if abi {
            assert!(work.held <= 25 * 1000, "the keeps visited {} ids", work.held);
            assert!(crossed.received <= 150 * 1000, "{} bytes crossed", crossed.received);
        }
    }
}

#[test]
fn the_view_toggle_without_room_for_split_costs_no_view() {
    for abi in [false, true] {
        let h = route_on(40, 4, 48, 28, abi);
        let (work, crossed) = (reconcile::work(), opencode_plugin::loader::native::crossed());
        h.keys(&["v"]);
        // The view keeps its root, which holds every id, so the host counts nothing to check it.
        assert_eq!(reconcile::work().since(work), reconcile::Work::default(), "C ABI: {abi}");
        let crossed = opencode_plugin::loader::native::crossed().since(crossed);
        assert!(crossed.received < 1000, "{} bytes crossed", crossed.received);
    }
}

#[test]
fn a_mark_after_a_wheel_step_keeps_the_other_cards() {
    for abi in [false, true] {
        let h = route_on(100, 4, 120, 30, abi);
        let entries = || opencode_plugin::surface::ledger_of("opencode.diffs").memo_entries;
        let before = entries();
        h.app.scroll(80, 10, true);
        h.settle();
        assert_eq!(entries(), before, "the wheel step dropped the memo (C ABI: {abi})");
        let work = reconcile::work();
        h.keys(&["m"]);
        assert!(h.settle().contains("1/100"), "{}", h.app.text());
        let kept = reconcile::work().since(work).kept;
        assert!(kept >= 99 + 98, "the mark kept {kept} subtrees (C ABI: {abi})");
    }
}

#[test]
fn a_hash_in_a_file_name_is_part_of_it() {
    let file = |name: &str, lines: usize| {
        let body: String = (0..lines).map(|line| format!(" line {line}\n")).collect();
        json!({
            "file": name, "patch": format!("@@ -1,{} +1,{} @@\n-old\n+new\n{body}", lines + 1, lines + 1),
            "additions": 1, "deletions": 1, "status": "modified",
        })
    };
    let open = |abi: bool| {
        let h = mount_on(Route::Home, json!([file("src/f", 1), file("src/f#1.rs", 40)]), 120, 30, abi);
        h.wait_for("/project");
        h.tui.keymap.dispatch("diff.open", None);
        h.wait_for("≡ f#1.rs");
        h
    };
    for abi in [false, true] {
        let h = open(abi);
        h.keys(&["end", "m"]);
        assert_eq!(h.reviewed(), ["f#1.rs"], "m on the card at the top (C ABI: {abi})");

        let h = open(abi);
        let (x, y) = h.find("src/f#1.rs");
        h.app.mouse(MouseEventKind::Down(MouseButton::Right), x, y);
        h.wait_for("Mark complete");
        h.keys(&["return"]);
        assert_eq!(h.reviewed(), ["f#1.rs"], "the heading's file menu (C ABI: {abi})");

        let h = open(abi);
        h.keys(&["]", "]", "m"]);
        assert_eq!(h.reviewed(), ["f#1.rs"], "a hunk step's file (C ABI: {abi})");
    }
}

/// The route over one image, `assets/logo.png`, whose working-tree bytes are `bytes`.
fn image_route(bytes: Vec<u8>, abi: bool) -> Diffs {
    let file = json!({ "file": "assets/logo.png", "patch": "", "additions": 0, "deletions": 0, "status": "added" });
    let memory = Memory::new(
        routes(file)
            .into_iter()
            .chain([MemoryRoute::body("GET", "/api/fs/read/assets/logo.png", 200, Some("image/png"), bytes)])
            .collect(),
    );
    let config = json!({ "animations": false, "diffs": { "source": "working" } });
    let deps = Deps {
        config: support::config(support::decode(&config.to_string())),
        route: Route::Home,
        events: true,
        abi_builtins: abi,
        ..support::deps(Arc::new(memory.clone()))
    };
    let h = Diffs { harness: support::mount(100, 30, deps), memory, turns: Cell::new(0) };
    h.wait_for("/project");
    h.tui.keymap.dispatch("diff.open", None);
    h.wait_for("Working tree preview");
    h
}

#[test]
fn an_image_the_host_cannot_decode_says_so() {
    let mut header = b"\x89PNG\r\n\x1a\n\0\0\0\x0dIHDR".to_vec();
    header.extend(3u32.to_be_bytes().into_iter().chain(4u32.to_be_bytes()));
    for abi in [false, true] {
        let h = image_route(header.clone(), abi);
        h.wait_for("Could not decode image");
        let screen = h.settle();
        assert!(!screen.contains("Click to enlarge") && !screen.contains("3 x 4"), "C ABI {abi}:\n{screen}");
    }
}

#[test]
fn the_image_preview_ends_with_the_viewer() {
    let png = opencode_plugin::abi::base64::decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAECAIAAAA8r+mnAAAAFUlEQVR42mO4Y2MDRzZRd+CIgXoSAKBcLGFZ7ECVAAAAAElFTkSuQmCC",
    )
    .unwrap();
    let preview = Some("opencode.diffs/images".to_owned());
    for abi in [false, true] {
        for replaced in [false, true] {
            let h = image_route(png.clone(), abi);
            // The image is read after the route draws: "Loading image…" until it comes.
            h.wait_for("Click to enlarge");
            let (x, y) = h.find("Click to enlarge");
            h.app.click(x, y);
            h.wait("the preview did not open", || h.tui.dialogs.key() == preview);
            if replaced {
                h.dispatch("help.show");
                h.wait("help did not replace the preview", || h.tui.dialogs.key() != preview);
            }
            let open = h.tui.dialogs.key();
            let host = opencode_tui::plugins::host::host(&h.tui);
            assert!(h.tui.plugins.set_active(&host, "opencode.diffs", false));
            h.settle();
            assert_eq!(h.tui.dialogs.is_open(), replaced, "C ABI: {abi}");
            assert_eq!(h.tui.dialogs.key(), if replaced { open } else { None }, "C ABI: {abi}");
        }
    }
}

#[test]
fn a_folder_closes_and_opens_on_a_click() {
    on_both(|| {
        let h = route(2, 4, 120, 30);
        let (x, y) = h.find("▾ src");
        h.app.click(x, y);
        h.wait("the folder did not close", || h.app.text().contains("▸ src"));
        assert!(!h.settle().contains("≡ f0000.rs"), "{}", h.app.text());
        h.app.click(x, y);
        h.wait_for("≡ f0000.rs");
    });
}

#[test]
fn the_docked_file_menu_takes_the_input() {
    on_both(|| {
        let h = mount(support::session_route("ses_a"));
        h.wait_for("Review");
        h.tui.keymap.dispatch("diff.open", None);
        h.wait_for("focus prompt");
        let footer = |h: &Diffs| {
            h.settle();
            let (x, y) = h.find("focus prompt");
            let capture = h.app.render();
            let cell = capture.cell(u32::from(x), u32::from(y)).unwrap();
            (cell.fg, cell.attributes)
        };
        let lit = footer(&h);
        h.dispatch("pane.focus.left");
        h.open_menu();
        h.keys(&["return"]);
        h.wait_for("1/1");
        h.assert_menu_closed();
        assert_eq!(footer(&h), lit, "the panel does not have the input");
        let (x, y) = h.find("src/main.rs");
        h.app.mouse(MouseEventKind::Down(MouseButton::Right), x, y);
        h.wait_for("Mark incomplete");
        h.keys(&["escape"]);
        h.assert_menu_closed();
        assert!(h.tui.panels.current().is_some(), "escape closed the panel, not the menu");
        h.app.click(4, 6);
        h.keys(&["x"]);
        assert_eq!(h.text(), "x", "the click on the session did not give the composer the input");
    });
}

#[test]
fn a_remount_keeps_the_viewer_and_its_way_back() {
    let stats = Route::Plugin { id: "opencode.stats".into(), name: "stats".into() };
    on_both(|| {
        let h = mount_with(Route::Home, json!([hunk_file(0, 4)]), 120, 30);
        h.wait_for("/project");
        h.tui.navigate(stats.clone());
        h.wait("stats did not show", || h.tui.route() == stats);
        h.tui.keymap.dispatch("diff.open", None);
        h.wait_for("≡ f0000.rs");
        h.keys(&["m"]);
        h.wait_for("1/1");
        opencode_plugin::Host::remount(&*h.tui);
        h.wait_for("≡ f0000.rs");
        assert!(h.settle().contains("1/1"), "the remount lost the mark:\n{}", h.app.text());
        h.keys(&["q"]);
        h.wait("q did not go back to stats", || h.tui.route() == stats);
    });
}

#[test]
fn the_viewers_dialogs_end_with_it() {
    on_both(|| {
        for base in [false, true] {
            let h = route(2, 4, 120, 30);
            h.keys(&["d"]);
            h.wait_for("Diff source");
            if base {
                h.keys(&["down", "down", "down", "return"]);
                h.wait_for("Base branch");
            }
            h.tui.navigate(Route::Home);
            h.settle();
            assert!(!h.tui.dialogs.is_open(), "a dialog outlived the viewer (base: {base}):\n{}", h.app.text());
        }
    });
}

#[test]
fn a_plugin_image_preview_is_bounded_and_keyed() {
    let h = route(1, 4, 120, 30);
    let setup = |setup: &mut opencode_plugin::abi::Setup| {
        let command = |name: &str| opencode_plugin::abi::Command::new(name);
        let images = |data: String| {
            abi_dialog_images(opencode_plugin::abi::Images::new(vec![opencode_plugin::abi::Image::new(data)]))
        };
        setup.command(command("probe.huge"), move |host, _| {
            let mut huge = b"\x89PNG\r\n\x1a\n\0\0\0\x0dIHDR".to_vec();
            huge.extend(5000u32.to_be_bytes().into_iter().chain(5000u32.to_be_bytes()));
            host.dialog(images(opencode_plugin::abi::base64::encode(&huge)))
        });
        setup.command(command("probe.png"), move |host, _| {
            let png = "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAECAIAAAA8r+mnAAAAFUlEQVR42mO4Y2MDRzZRd+CIgXoSAKBcLGFZ7ECVAAAAAElFTkSuQmCC";
            host.dialog(images(png.to_owned()))
        });
        setup.command(command("probe.close"), |host, _| {
            host.dialog(opencode_plugin::abi::Dialog::Close { key: "images".into() })
        });
        Ok(())
    };
    opencode_tui::plugins::host::add(&h.tui, opencode_plugin::abi::Plugin { id: "probe", setup }.into());
    h.dispatch("probe.huge");
    h.settle();
    assert!(!h.tui.dialogs.is_open(), "an image past the host's bounds opened a preview");
    h.dispatch("probe.png");
    h.wait("the preview did not open", || h.tui.dialogs.key() == Some("probe/images".to_owned()));
    h.dispatch("probe.close");
    h.wait("Dialog::Close did not close the preview", || !h.tui.dialogs.is_open());
}

fn abi_dialog_images(images: opencode_plugin::abi::Images) -> opencode_plugin::abi::Dialog {
    opencode_plugin::abi::Dialog::Images(images)
}

thread_local! {
    static HEARD: std::cell::RefCell<Vec<String>> = const { std::cell::RefCell::new(Vec::new()) };
}

#[test]
fn a_plugins_binds_take_what_they_may() {
    use opencode_plugin::abi::interact::{Bind, Handled, Layer, LayerScope};
    let h = mount_config(Route::Home, json!({ "keybinds": { "diff.next_hunk": "none" } }));
    h.wait_for("/project");
    let setup = |setup: &mut opencode_plugin::abi::Setup| {
        let keys = vec![
            Bind::command("diff.next_hunk", "none").key("f8"),
            Bind::command("plugins.list", "steal"),
            Bind::new("", "empty"),
            Bind::new("f9", "kept"),
        ];
        setup.layer(Layer::default().scope(LayerScope::Global).priority(10).keys(keys), |_, event| {
            if let opencode_plugin::abi::interact::Event::Key(key) = event {
                HEARD.with(|heard| heard.borrow_mut().push(key.bind.clone().unwrap_or_default()));
            }
            Handled::Consume
        });
        Ok(())
    };
    opencode_tui::plugins::host::add(&h.tui, opencode_plugin::abi::Plugin { id: "probe", setup }.into());
    h.settle();
    h.keys(&["f8", "f9"]);
    h.tui.keymap.dispatch("plugins.list", None);
    h.wait("/plugins did not open", || h.tui.dialogs.is_open());
    assert_eq!(HEARD.with(|heard| heard.borrow().clone()), ["kept"]);
}

thread_local! {
    static SECOND: Cell<bool> = const { Cell::new(false) };
    static NOTED: Cell<bool> = const { Cell::new(false) };
}

#[test]
fn a_select_and_a_panel_shown_again_show_their_new_fields() {
    use opencode_plugin::abi::{Action, Dialog, Panel, PanelSize, Select, SelectOption, Span};
    let h = route(1, 4, 120, 30);
    let setup = |setup: &mut opencode_plugin::abi::Setup| {
        let command = |name: &str| opencode_plugin::abi::Command::new(name);
        setup.command(command("probe.select"), |host, _| {
            let second = SECOND.with(Cell::get);
            let options = if second { Vec::new() } else { vec![SelectOption::new("row one", "one")] };
            let action = Action::command("probe.select");
            host.dialog(Dialog::Select(
                Select::new("Pick", options, action)
                    .key("pick")
                    .maybe(second.then(|| Span::new("Nothing here")), Select::empty)
                    .maybe(NOTED.with(Cell::get).then(|| Span::new("A note under")), Select::note),
            ));
        });
        setup.command(command("probe.panel"), |host, _| {
            let second = SECOND.with(Cell::get);
            host.dialog(Dialog::Panel(
                Panel::new("info", vec![Span::new("Info")], opencode_plugin::abi::Node::text([Span::new("body")]))
                    .size(PanelSize::Medium)
                    .close(if second { "shut B" } else { "shut A" }),
            ));
        });
        Ok(())
    };
    opencode_tui::plugins::host::add(&h.tui, opencode_plugin::abi::Plugin { id: "probe", setup }.into());
    SECOND.with(|second| second.set(false));
    h.dispatch("probe.select");
    h.wait_for("row one");
    SECOND.with(|second| second.set(true));
    h.dispatch("probe.select");
    h.wait_for("Nothing here");
    NOTED.with(|noted| noted.set(true));
    h.dispatch("probe.select");
    h.wait_for("A note under");
    h.keys(&["escape"]);
    SECOND.with(|second| second.set(false));
    h.dispatch("probe.panel");
    h.wait_for("shut A");
    SECOND.with(|second| second.set(true));
    h.dispatch("probe.panel");
    h.wait_for("shut B");
}

impl Diffs {
    /// Emits `kind` of `ses_a`, with `extra` in its data, and waits for the store to hear it.
    fn turn_event(&self, kind: &str, extra: Value) {
        let turn = self.turns.get() + 1;
        self.turns.set(turn);
        let mut data = json!({ "sessionID": "ses_a" });
        data.as_object_mut().unwrap().extend(extra.as_object().cloned().unwrap_or_default());
        self.memory.emit(&json!({
            "id": format!("evt_{turn}"), "created": turn, "type": kind,
            "durable": { "aggregateID": "ses_a", "seq": turn, "version": 1 }, "data": data,
        }));
        self.settle();
        self.app.advance(Duration::from_millis(20));
        self.settle();
    }
}

#[test]
fn every_end_of_a_turn_loads_last_turn_again_and_a_shutdown_does_not() {
    on_both(|| {
        let h = mount(support::session_route("ses_a"));
        h.wait_for("Review");
        h.tui.keymap.dispatch("diff.open", None);
        h.wait_for("src/main.rs");
        let reloads = |h: &Diffs, events: &[(&str, Value)]| {
            let reads = h.diff_reads();
            for (kind, extra) in events {
                h.turn_event(kind, extra.clone());
            }
            h.app.wait_until(Duration::from_millis(500), || h.diff_reads() > reads)
        };
        let started = ("session.execution.started", json!({}));
        let failed = ("session.execution.failed", json!({ "error": { "type": "unknown", "message": "no" } }));
        let interrupted = |reason: &str| ("session.execution.interrupted", json!({ "reason": reason }));
        assert!(reloads(&h, &[started.clone(), failed]), "a failed turn did not load again");
        assert!(reloads(&h, &[started.clone(), interrupted("user")]), "an interrupted turn did not load again");
        assert!(!reloads(&h, &[started.clone(), interrupted("shutdown")]), "a shutdown loaded again");
        assert!(reloads(&h, &[("server.connected", json!({}))]), "a reconnect did not load the turn it lost");
        assert!(!reloads(&h, &[("server.connected", json!({}))]), "a reconnect loaded with no turn running");
        // Posted to the UI as the pump posts signals, so the start is heard before the skip.
        let started: opencode_api::generated::V2Event = serde_json::from_value(json!({
            "id": "evt_lagged", "created": 99, "type": "session.execution.started",
            "durable": { "aggregateID": "ses_a", "seq": 99, "version": 1 }, "data": { "sessionID": "ses_a" },
        }))
        .unwrap();
        opencode_tui::features::events::testing::signal(&h.tui, started);
        let reads = h.diff_reads();
        opencode_tui::features::events::testing::lagged(&h.tui);
        h.wait("skipped signals did not load the turn again", || h.diff_reads() > reads);
    });
}

#[test]
fn the_base_picker_marks_the_base_reported_after_it_opened() {
    on_both(|| {
        let location = json!({ "directory": DIRECTORY });
        let base =
            json!({ "location": location, "data": { "name": "main", "ref": "refs/heads/main", "source": "default" } });
        let branches = json!({ "location": location, "data": ["dev", "main"] });
        let memory = Memory::new(
            [
                MemoryRoute::json("GET", "/api/vcs/base", 200, &base),
                MemoryRoute::json("GET", "/api/vcs/branch", 200, &branches),
            ]
            .into_iter()
            .chain(routes(json!([hunk_file(0, 4)])))
            .collect(),
        );
        let config = json!({ "animations": false, "diffs": { "source": "working" } });
        let deps = Deps {
            config: support::config(support::decode(&config.to_string())),
            route: Route::Home,
            events: true,
            abi_builtins: ABI.with(Cell::get),
            ..support::deps(Arc::new(memory.clone()))
        };
        let h = Diffs { harness: support::mount(120, 30, deps), memory, turns: Cell::new(0) };
        h.wait_for("/project");
        h.tui.keymap.dispatch("diff.open", None);
        h.wait_for("≡ f0000.rs");
        h.keys(&["d"]);
        h.wait_for("Diff source");
        h.keys(&["down", "return"]);
        h.wait_for("Base branch");
        h.wait_for("dev");
        let marked = |h: &Diffs| h.app.text().lines().any(|line| line.contains("▪") && line.contains("main"));
        h.wait("the reported base is not marked", || marked(&h));
    });
}

fn route_of(lines: &[usize], width: u16, height: u16) -> Diffs {
    let files: Vec<Value> = lines.iter().enumerate().map(|(index, lines)| hunk_file(index, *lines)).collect();
    let h = mount_with(Route::Home, Value::Array(files), width, height);
    h.wait_for("/project");
    h.tui.keymap.dispatch("diff.open", None);
    h.wait_for("f0000.rs");
    h.settle();
    h
}

impl Diffs {
    fn menu_on_row(&self, file: &str) {
        let (x, y) = self.find(&format!("≡ {file}"));
        self.app.mouse(MouseEventKind::Down(MouseButton::Right), x, y);
        self.wait_for("Mark ");
        self.keys(&["return"]);
    }
}

#[test]
fn a_file_above_that_opens_again_keeps_the_selected_card_in_view() {
    on_both(|| {
        let h = route_of(&[28, 8, 22, 8, 4], 120, 30);
        h.menu_on_row("f0002.rs");
        h.keys(&["n", "n", "n"]);
        assert!(h.settle().contains("src/f0003.rs"), "{}", h.app.text());
        h.menu_on_row("f0002.rs");
        let screen = h.settle();
        assert!(
            screen.lines().any(|line| line.chars().skip(TREE).collect::<String>().contains("src/f0003.rs")),
            "{screen}"
        );
    });
}

#[test]
fn reloads_release_the_content_of_the_load_before() {
    on_both(|| {
        let h = mount(support::session_route("ses_a"));
        h.wait_for("Review");
        h.tui.keymap.dispatch("diff.open", None);
        h.wait_for("src/main.rs");
        let held = || opencode_plugin::surface::ledger_of("opencode.diffs").content_bytes;
        let reads = h.diff_reads();
        h.turn();
        h.reloaded(reads);
        let first = held();
        for _ in 0..3 {
            let reads = h.diff_reads();
            h.turn();
            h.reloaded(reads);
        }
        assert_eq!(held(), first, "the content of earlier loads stayed");
    });
}

#[test]
fn a_reload_holds_no_content_until_its_reply_lands() {
    on_both(|| {
        let diff = json!({
            "file": "src/main.rs", "patch": "@@ -1 +1 @@\n-old\n+new\n", "additions": 1, "deletions": 1,
            "status": "modified",
        });
        let routes = routes(diff)
            .into_iter()
            .map(|route| if route.path == SESSION_DIFF { route.held() } else { route })
            .collect();
        let h = mount_routes(support::session_route("ses_a"), routes, 140, 30, ABI.with(Cell::get));
        h.memory.release(SESSION_DIFF);
        h.wait_for("Review");
        h.tui.keymap.dispatch("diff.open", None);
        h.wait_for("src/main.rs");
        let held = || opencode_plugin::surface::ledger_of("opencode.diffs").content_bytes;
        h.reloaded(0);
        let first = held();
        assert!(first > 0, "the first load holds no content");
        h.memory.hold(SESSION_DIFF);
        let reads = h.diff_reads();
        h.turn();
        let asked = h.app.wait_until(support::WAIT, || h.diff_reads() > reads);
        assert!(asked, "the ended turn did not load the diff again");
        h.settle();
        assert_eq!(held(), 0, "the viewer held content while its reload waited");
        h.memory.release(SESSION_DIFF);
        h.reloaded(reads);
        assert_eq!(held(), first, "the reload did not give back what the first load held");
    });
}

#[test]
fn the_viewers_small_controls_do_what_they_say() {
    on_both(|| {
        let h = route(2, 4, 48, 28);
        h.keys(&["v"]);
        assert!(diffs_setting(&h)["view"].is_null(), "the toggle without room saved {}", diffs_setting(&h));
        let (x, y) = h.find("close");
        h.app.click(x, y);
        h.wait("the footer's close did not leave", || h.tui.route() == Route::Home);

        let h = route(2, 4, 140, 30);
        h.keys(&["b"]);
        h.wait("the tree did not hide", || !h.app.text().contains("≡ f0000.rs"));
        let screen = h.settle();
        let (y, line) = screen.lines().enumerate().find(|(_, line)| line.trim_end().ends_with('?')).unwrap();
        h.app.click(line.trim_end().chars().count() as u16 - 1, y as u16);
        h.wait("the header's ? did not open the help", || h.tui.dialogs.is_open());
        h.keys(&["escape"]);

        let h = route(2, 4, 120, 30);
        let (x, y) = h.find("≡ f0000.rs");
        h.app.mouse(MouseEventKind::Down(MouseButton::Right), x, y);
        h.wait_for("Mark complete");
        let (x, y) = h.find("Mark complete");
        h.app.mouse(MouseEventKind::Down(MouseButton::Right), x, y);
        h.assert_menu_closed();
        assert!(h.reviewed().is_empty(), "the right press on the menu ran it");
    });
}

#[test]
fn a_base_pick_that_changes_nothing_loads_nothing() {
    on_both(|| {
        for working in [false, true] {
            let h = base_picker(json!(["main", "dev"]));
            if working {
                h.keys(&["escape"]);
                h.keys(&["d"]);
                h.wait_for("Diff source");
                h.keys(&["down", "down", "return"]);
                h.wait_for("Uncommitted");
                h.keys(&["d"]);
                h.wait_for("Diff source");
                h.keys(&["down", "return"]);
            }
            h.wait_for("main");
            let reads = || h.memory.requests().iter().filter(|logged| logged.path == "/api/vcs/diff").count();
            if !working {
                h.keys(&["return"]);
                h.settle();
                h.keys(&["d"]);
                h.wait_for("Diff source");
                h.keys(&["down", "down", "down", "return"]);
                h.wait_for("main");
            }
            let before = reads();
            h.keys(&["return"]);
            h.settle();
            h.app.advance(Duration::from_millis(50));
            assert_eq!(reads(), before, "the pick loaded again (Uncommitted: {working})");
        }
    });
}

#[test]
fn a_chunked_patch_takes_the_padding_of_the_layout() {
    let opened = |resize: bool| {
        let h = route_of(&[3100], if resize { 140 } else { 80 }, 30);
        if resize {
            h.app.resize(80, 30);
        }
        h.settle()
    };
    assert_eq!(opened(true), opened(false));
}
