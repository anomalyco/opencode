//! The diff viewer's lifetime (`reviews/ms3-ms4.review-carbon.md` carbon-1): a viewer goes with its panel, so its
//! file menu and its last-turn watch end when the panel closes.

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

/// Serves `diff`, one file or a list of them.
fn mount_with(route: Route, diff: Value, width: u16, height: u16) -> Diffs {
    mount_on(route, diff, width, height, ABI.with(Cell::get))
}

thread_local! {
    /// The carrier [`mount_with`] mounts the built-ins on, which [`on_both`] sets.
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

/// [`mount_with`] over one file, with `config` merged over the rows' own.
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
    let memory = Memory::new(routes(diff));
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

    /// The menu is gone, with what it held.
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

    /// A turn of `session` starts and ends within one turn of the UI: the store applies both before the UI hears of
    /// the first, as on a loaded machine (`steps/flakes-8.md`).
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

// Expected (carbon-dialogs-5): the file tree follows the selected file down and its `help` footer opens the help.
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
    // Each step rebuilt the tree; it kept the offset it scrolled to.
    assert!(!h.app.text().contains("≡ file_00.rs"), "{}", h.app.text());

    let (x, y) = h.find(" help");
    h.app.click(x + 1, y);
    h.wait("the help did not open", || h.tui.dialogs.is_open());
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

// Expected (P6c): the viewer is the same plugin on both carriers: its panel opens with its cards and fails on neither.
// More cards than the tree's other keyed nodes: a library's memo table of the cards is checked against a tree whose
// list items count.
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

// The scenarios of synthesis 4.9 by name, and the hunk rules the host's verbs and reads now hold (P6c). Each opens the
// full-screen route from Home, with the file tree beside the cards, over files of one modified hunk each.

/// A modified file of one hunk: `lines` lines, the third changed.
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

/// The route over `count` files of `lines` lines, at `width` by `height`, open and drawn.
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

    /// Presses each key, then lets the viewer draw.
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

// Expected (`jumps_start_below_the_sticky_header`, now `Step`'s inset): from the top, the first card's hunk sits under
// its sticky header, so `]` lands on the second file's, which `m` then marks.
#[test]
fn a_hunk_step_starts_below_the_sticky_header() {
    on_both(|| {
        let h = route(4, 4, 120, 30);
        h.keys(&["]", "m"]);
        assert_eq!(h.reviewed(), ["f0001.rs"]);
    });
}

// Expected (`the_current_file_is_the_last_card_at_the_top`, now `top_anchor` with an inset of 1, and
// `card_tops_skip_the_gap_of_later_cards`, now `To` on the card past its gap): `n` puts the second card's heading on
// the pane's first row, not its gap; a row down clears the selection, and `m` marks the card at the top.
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

// Expected (4.9 "`]`, `]`, `[` near the bottom", `jumps_continue_from_the_selected_hunk_until_the_view_moves`): at the
// end the scroll cannot move, and a step goes on from the hunk it last landed on: `]` `]` `[` lands where one `]` did,
// and `]` `]` on another file.
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

// Expected (4.9 "mark a file above the viewport reviewed, then wheel across it"): marking the first file from its tree
// row's menu, while the third is at the top, keeps the third where it is (`Keep`); the wheel then shows the first as its
// reviewed heading.
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

// Expected (4.9 "410 files and more"): the route opens on the first card at 410 and 1,000 files, goes to the last, and
// counts a mark of all of them.
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

// Expected (4.9 "a width change that crosses the split threshold during a jump"): a step and a resize from a split
// view to a unified one in one frame land where the step lands at the narrower width.
#[test]
fn a_jump_across_the_split_threshold_lands_as_at_the_new_width() {
    on_both(|| {
        // Settled frames: the first frame after a resize still shows the view of the old size, laid out at the new one,
        // since a surface hears its size from the layout of that frame (steps/plugins-p6c.md, big-boi's review).
        let jumped = |resize: bool| {
            let h = route(4, 30, if resize { 140 } else { 120 }, 30);
            h.app.press("]");
            if resize {
                h.app.resize(120, 30);
            }
            h.settle()
        };
        let narrow = jumped(false);
        assert!(narrow.contains("+new 1") || narrow.contains("+ new 1"), "{narrow}");
        assert_eq!(jumped(true), narrow);
    });
}

// Expected (4.9 "a menu on right button down"): the press opens the menu; the release does not close it.
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

// Expected (4.9 "open from Home and go back"): the route remembers where `/diff` came from and `q` goes back there.
#[test]
fn the_route_opens_from_home_and_goes_back() {
    on_both(|| {
        let h = route(1, 4, 120, 30);
        assert_eq!(h.tui.route(), Route::Plugin { id: "opencode.diffs".into(), name: "diff".into() });
        h.keys(&["q"]);
        h.wait("the route did not go back home", || h.tui.route() == Route::Home);
    });
}

// Expected (4.9 "dock and focus"): the docked panel takes the keys while it has the focus; with the focus on the
// composer the same key types, the footer dims, and a press on the panel gives it back.
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

// Expected (TS binds `app.exit` to close the viewer, one level; carbon's review of P6c, 2): the reserved chord, which no
// plugin sees, closes the viewer's surface that has the input and no more: an open file menu alone, then the route,
// back to the route it came from; a focused docked panel, keeping the composer's draft. With `app.exit` rebound it
// does the same, so the route traps nobody. On home with an empty prompt it is `app.exit`'s. On both carriers.
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

/// The viewer's settings as the TUI config holds them now.
fn diffs_setting(h: &Diffs) -> serde_json::Value {
    h.tui.settings.info().to_value()["diffs"].clone()
}

// Expected (P6c, `Read::setting` and `Host::set_setting`): `v` saves the view the viewer shows, and a plugin's write of a
// value its setting does not take, or of a name the host does not name, saves nothing.
#[test]
fn a_setting_saves_only_what_it_takes() {
    let h = route(2, 4, 140, 30);
    h.keys(&["v"]);
    h.wait("the view was not saved", || diffs_setting(&h)["view"] == "unified");
    let setup = |setup: &mut opencode_plugin::abi::Setup| {
        let command = opencode_plugin::abi::Command { name: "probe.set".into(), ..Default::default() };
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

// Expected (P6c, `PanelInput::forced`): `f` in a panel the room forces full screen changes nothing and saves nothing; with
// room it goes full screen and saves it.
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

/// The route over two files with the base picker open, whose server lists `branches` for any search.
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
    /// Whether the base picker asked the server for the branches of `search`.
    fn searched(&self, search: &str) -> bool {
        self.memory.requests().iter().any(|logged| {
            logged.path == "/api/vcs/branch" && logged.query.get("search").is_some_and(|values| values == &[search])
        })
    }
}

// Expected (P6c, a select's `query`): the base picker asks the server for the branches of what is typed, once it stayed
// 150 ms, and shows its empty text when none match.
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

// Expected (P6c, a select's `query`): the picker shows the branches the server found for what is typed, though their
// names do not hold it; the host does not filter them again.
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

// Expected (P6c's gate, the wheel step): a wheel step that ends no selection keeps the viewer's tree whole, as today's
// viewer draws no more than the scroll; one that ends a selection builds it again, and the tree's row loses its mark.
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

// Expected (`onSwitchSource`): the source picked in the viewer is the next viewer's, though the config names another.
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

// Expected (`fileMenu` on new files): files loaded again close the file menu that was open.
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

// Expected: the tree scrolls to its selected row only as far as it must, so a row already in view moves nothing.
#[test]
fn the_tree_scrolls_only_as_far_as_its_selection() {
    let h = route(40, 4, 120, 30);
    h.keys(&["n", "n", "n"]);
    let tree: String = h.settle().lines().map(|line| line.chars().take(30).collect::<String>() + "\n").collect();
    assert!(tree.contains("f0000.rs") && tree.contains("f0003.rs"), "{tree}");
}

// Expected (TS `wrapMode="char"`): a patch line wider than the pane wraps by cell, inside its words.
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

// Expected (TS `panel.focused`): the docked panel's footer dims as the focus leaves the panel, and lights again as it
// comes back.
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

// Expected (TS's turn watch, `steps/flakes-8.md`): a turn that starts and ends before the UI hears of its start still
// loads the last turn's diff again, on both carriers; another session's turn loads nothing.
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

// Expected (big-boi's review of P6c): a mark at 1,000 files keeps the other cards on both carriers, and over the C ABI
// the host counts what the view's keeps hold in one pass of the ids, not one a keep.
#[test]
fn a_mark_at_1000_files_costs_one_pass_on_both_carriers() {
    for abi in [false, true] {
        let h = route_on(1000, 4, 200, 58, abi);
        let (work, crossed) = (reconcile::work(), opencode_plugin::loader::native::crossed());
        h.keys(&["m"]);
        assert!(h.settle().contains("1/1000"), "{}", h.app.text());
        let (work, crossed) =
            (reconcile::work().since(work), opencode_plugin::loader::native::crossed().since(crossed));
        // The 999 other cards and the tree's rows but the two whose marks changed.
        assert!(work.kept >= 999 + 998, "the mark kept {} subtrees (C ABI: {abi})", work.kept);
        if abi {
            // An id's walk up is a few steps; a scan of the ids a keep was 20 million.
            assert!(work.held <= 25 * 1000, "the keeps visited {} ids", work.held);
            // A keep a card and a keep a row cross, not the cards or the rows: 97 KB, where 766 KB crossed with the
            // rows built each view.
            assert!(crossed.received <= 150 * 1000, "{} bytes crossed", crossed.received);
        }
    }
}

// Expected (big-boi's review of P6c; TS returns when split is not available): the view toggle where split has no
// room changes nothing, so it costs no view, on both carriers.
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

// Expected (big-boi's review of P6c): a wheel step keeps the viewer whole and its cards' memo with it, so a mark after
// it keeps the other 99 cards, on both carriers.
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

// Expected (big-boi's review of P6c; TS names files by index): a `#` in a file name is part of it. `m` on the card at the
// top, the file menu of its heading and a hunk step each name `src/f#1.rs`, not `src/f`, on both carriers.
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

// Expected (big-boi's review of P6c; TS shows the error on the image's `onError`): bytes whose header names a size but
// that the host cannot decode show "Could not decode image", with no size and nothing to click, on both carriers.
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

// Expected (deviation F16, big-boi's review of P6c): the viewer's image preview is the plugin's dialog, so it closes as
// the plugin is turned off; a host dialog that replaced it stays. On both carriers.
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

// Expected (`toggleDirectory`): a click on a folder's row closes it, its files leave the tree, and a second click opens
// it again, on both carriers.
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

// Expected (carbon's review of P6c, 1; TS focuses the panel as its file menu opens): with the composer focused, a right
// press on a card's heading in the docked panel opens the file menu with the input, so return marks the file and
// escape closes only the menu; the panel then has the input, its footer lit, and a click on the session gives the
// composer the input back. On both carriers.
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

// Expected (decision 2; carbon's review of P6c, 4): a remount of the viewer's route (a plugin toggled in `/plugins`,
// a theme change) keeps the viewer: its marks, and the route `q` goes back to, here stats. On both carriers.
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

// Expected (TS's close clears the viewer's dialogs; carbon's review of P6c, 4): the source and base dialogs end with
// the viewer, so none is left on screen once its route goes, on both carriers.
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

// Expected (carbon's review of P6c, 4): a plugin's image preview takes only images the host decodes, as an image node
// would, and has the key `images`, which `Dialog::Close` closes.
#[test]
fn a_plugin_image_preview_is_bounded_and_keyed() {
    let h = route(1, 4, 120, 30);
    let setup = |setup: &mut opencode_plugin::abi::Setup| {
        let command = |name: &str| opencode_plugin::abi::Command { name: name.into(), ..Default::default() };
        let images = |data: String| {
            abi_dialog_images(opencode_plugin::abi::Images {
                images: vec![opencode_plugin::abi::Image { data, name: None }],
                index: 0,
            })
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
    /// What the keymap probe's layer heard.
    static HEARD: std::cell::RefCell<Vec<String>> = const { std::cell::RefCell::new(Vec::new()) };
}

// Expected (the contract's `Bind::command`; carbon's review of P6c, 5): a bind of a name the user set to "none" takes
// no key, not even its own fallback; a bind may not take the plugin manager's command, so `/plugins` still opens; and
// a bind with no key and no name is left out, not its whole layer.
#[test]
fn a_plugins_binds_take_what_they_may() {
    use opencode_plugin::abi::interact::{Bind, Handled, Layer, LayerScope};
    let h = mount_config(Route::Home, json!({ "keybinds": { "diff.next_hunk": "none" } }));
    h.wait_for("/project");
    let setup = |setup: &mut opencode_plugin::abi::Setup| {
        let keys = vec![
            Bind { key: "f8".into(), ..Bind::command("diff.next_hunk", "none") },
            Bind::command("plugins.list", "steal"),
            Bind::new("", "empty"),
            Bind::new("f9", "kept"),
        ];
        setup.layer(Layer { scope: LayerScope::Global, priority: 10, keys, ..Layer::default() }, |_, event| {
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
    /// Which of its two forms the dialog probe shows.
    static SECOND: Cell<bool> = const { Cell::new(false) };
}

// Expected (carbon's review of P6c, 5): a keyed select shown again shows its new empty text and note, which it had none
// of; a panel shown again shows its new close label.
#[test]
fn a_select_and_a_panel_shown_again_show_their_new_fields() {
    use opencode_plugin::abi::{Action, Dialog, Panel, PanelSize, Select, SelectOption, Span};
    let h = route(1, 4, 120, 30);
    let setup = |setup: &mut opencode_plugin::abi::Setup| {
        let command = |name: &str| opencode_plugin::abi::Command { name: name.into(), ..Default::default() };
        setup.command(command("probe.select"), |host, _| {
            let second = SECOND.with(Cell::get);
            let options = if second { Vec::new() } else { vec![SelectOption::new("row one", "one")] };
            let action = Action::Command { name: "probe.select".into(), input: None };
            host.dialog(Dialog::Select(Select {
                key: Some("pick".into()),
                empty: second.then(|| Span::new("Nothing here")),
                note: second.then(|| Span::new("A note under")),
                ..Select::new("Pick", options, action)
            }));
        });
        setup.command(command("probe.panel"), |host, _| {
            let second = SECOND.with(Cell::get);
            host.dialog(Dialog::Panel(Panel {
                key: "info".into(),
                size: PanelSize::Medium,
                title: vec![Span::new("Info")],
                subtitle: None,
                body: opencode_plugin::abi::Node::text([Span::new("body")]),
                actions: Vec::new(),
                binds: Vec::new(),
                bleed: false,
                centered: false,
                bare: false,
                close: Some(if second { "shut B" } else { "shut A" }.into()),
                height: None,
            }));
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

// Expected (TS reloads Last turn as the session goes idle; carbon's review of P6c, 6 and CM1): a failed or a user's
// interrupted turn loads the diff again; one interrupted by the server's shutdown, which a restart recovers, does not;
// a turn whose end the connection may have lost loads it again on the reconnect, or once the UI caught up with
// signals it skipped. On both carriers.
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

// Expected (TS's `reportedBases()`; carbon's review of P6c, 6): opened in Uncommitted, the base picker marks the base
// the server reports once it arrives, though it opened before, on both carriers.
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
        // The source list opens on Uncommitted, the one above Base.
        h.keys(&["down", "return"]);
        h.wait_for("Base branch");
        h.wait_for("dev");
        let marked = |h: &Diffs| h.app.text().lines().any(|line| line.contains("▪") && line.contains("main"));
        h.wait("the reported base is not marked", || marked(&h));
    });
}

/// The route over files of `lines` lines each, at `width` by `height`, open and drawn.
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
    /// Opens the file menu of `file`'s tree row and runs its one action.
    fn menu_on_row(&self, file: &str) {
        let (x, y) = self.find(&format!("≡ {file}"));
        self.app.mouse(MouseEventKind::Down(MouseButton::Right), x, y);
        self.wait_for("Mark ");
        self.keys(&["return"]);
    }
}

// Expected (`toggleFileReviewed` keeps the reading position; carbon's REPRO_9 against decision 14): with the selected
// card mid-screen below another, a file above it that opens again (marked incomplete) keeps the selected card in
// view, on both carriers.
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

// Expected (carbon's CM2): content of an earlier load is released, so what the viewer holds in the host stays flat over
// reloads of the same files, on both carriers.
#[test]
fn reloads_release_the_content_of_the_load_before() {
    on_both(|| {
        let h = mount(support::session_route("ses_a"));
        h.wait_for("Review");
        h.tui.keymap.dispatch("diff.open", None);
        h.wait_for("src/main.rs");
        let held = || opencode_plugin::surface::ledger_of("opencode.diffs").content_bytes;
        h.turn();
        h.settle();
        let first = held();
        for _ in 0..3 {
            h.turn();
            h.settle();
        }
        assert_eq!(held(), first, "the content of earlier loads stayed");
    });
}

// Expected (carbon's CM3, CM5, CM7, CM8): the compact footer's close leaves a narrow route; the view toggle where split
// has no room saves nothing; the header's `?` opens the help with the tree hidden; a right press on the file menu's
// row closes the menu.
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

// Expected (carbon's CM4): picking the base the viewer shows again loads nothing, and a base picked in Uncommitted,
// which shows no base, loads nothing either, on both carriers.
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

// Expected (carbon's CM6): a patch too long to show whole (3,100 lines, in chunks) laid out compact after a resize from
// the full layout shows as one opened compact, its gutter's padding with it.
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
