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
    mount_on(route, diff, width, height, false)
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
    let files: Vec<Value> = (0..count).map(|index| hunk_file(index, lines)).collect();
    let h = mount_with(Route::Home, Value::Array(files), width, height);
    h.wait_for("/project");
    h.tui.keymap.dispatch("diff.open", None);
    h.wait_for("≡ f0000.rs");
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
    let h = route(4, 4, 120, 30);
    h.keys(&["]", "m"]);
    assert_eq!(h.reviewed(), ["f0001.rs"]);
}

// Expected (`the_current_file_is_the_last_card_at_the_top`, now `top_anchor` with an inset of 1, and
// `card_tops_skip_the_gap_of_later_cards`, now `To` on the card past its gap): `n` puts the second card's heading on
// the pane's first row, not its gap; a row down clears the selection, and `m` marks the card at the top.
#[test]
fn the_current_file_is_the_card_at_the_top() {
    let h = route(4, 12, 120, 30);
    h.keys(&["n"]);
    let row = h.top_card_row();
    assert!(row.contains("src/f0001.rs") && !row.contains('▄'), "{row:?}\n{}", h.app.text());
    h.keys(&["j", "m"]);
    assert_eq!(h.reviewed(), ["f0001.rs"]);
}

// Expected (4.9 "`]`, `]`, `[` near the bottom", `jumps_continue_from_the_selected_hunk_until_the_view_moves`): at the
// end the scroll cannot move, and a step goes on from the hunk it last landed on: `]` `]` `[` lands where one `]` did,
// and `]` `]` on another file.
#[test]
fn hunk_steps_near_the_bottom_go_on_from_the_last() {
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
}

// Expected (4.9 "mark a file above the viewport reviewed, then wheel across it"): marking the first file from its tree
// row's menu, while the third is at the top, keeps the third where it is (`Keep`); the wheel then shows the first as its
// reviewed heading.
#[test]
fn a_file_marked_above_the_view_keeps_the_reading_position() {
    let h = route(5, 12, 120, 30);
    h.keys(&["n", "n"]);
    let before = h.top_card_row();
    assert!(before.contains("src/f0002.rs"), "{before:?}");
    let (x, y) = h.find("≡ f0000.rs");
    h.app.mouse(MouseEventKind::Down(MouseButton::Right), x, y);
    h.wait_for("Mark complete");
    h.keys(&["return"]);
    assert_eq!(h.reviewed(), ["f0000.rs"]);
    assert_eq!(h.top_card_row(), before, "the reading position moved");
    for _ in 0..40 {
        h.app.scroll(80, 10, false);
    }
    let screen = h.settle();
    let heading = screen.lines().find(|line| line.contains("src/f0000.rs")).unwrap_or_default();
    assert!(heading.contains('✓') && !screen.contains("old 0"), "{screen}");
}

// Expected (4.9 "410 files and more"): the route opens on the first card at 410 and 1,000 files, goes to the last, and
// counts a mark of all of them.
#[test]
fn many_files_open_and_reach_the_last() {
    for count in [410, 1000] {
        let h = route(count, 4, 120, 30);
        let last = format!("src/f{:04}.rs", count - 1);
        h.keys(&["shift+g"]);
        h.wait_for(&last);
        h.keys(&["m"]);
        h.wait_for(&format!("1/{count}"));
    }
}

// Expected (4.9 "a width change that crosses the split threshold during a jump"): a step and a resize from a split
// view to a unified one in one frame land where the step lands at the narrower width.
#[test]
fn a_jump_across_the_split_threshold_lands_as_at_the_new_width() {
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
}

// Expected (4.9 "a menu on right button down"): the press opens the menu; the release does not close it.
#[test]
fn the_file_menu_opens_on_the_right_button_down() {
    let h = route(2, 4, 120, 30);
    let (x, y) = h.find("≡ f0001.rs");
    h.app.mouse(MouseEventKind::Down(MouseButton::Right), x, y);
    h.wait_for("Mark complete");
    h.app.mouse(MouseEventKind::Up(MouseButton::Right), x, y);
    assert!(h.settle().contains("Mark complete"));
}

// Expected (4.9 "open from Home and go back"): the route remembers where `/diff` came from and `q` goes back there.
#[test]
fn the_route_opens_from_home_and_goes_back() {
    let h = route(1, 4, 120, 30);
    assert_eq!(h.tui.route(), Route::Plugin { id: "opencode.diffs".into(), name: "diff".into() });
    h.keys(&["q"]);
    h.wait("the route did not go back home", || h.tui.route() == Route::Home);
}

// Expected (4.9 "dock and focus"): the docked panel takes the keys while it has the focus; with the focus on the
// composer the same key types, the footer dims, and a press on the panel gives it back.
#[test]
fn the_docked_panel_takes_the_keys_only_with_the_focus() {
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
}

// Expected (deviation F15-diff-viewer-ctrl-c): the reserved chord is the host's in the viewer, so it exits the app as
// `app.exit` does on home; escape closes the viewer.
#[test]
fn ctrl_c_in_the_viewer_is_the_hosts() {
    let h = route(1, 4, 120, 30);
    h.keys(&["escape"]);
    h.wait("escape did not close the viewer", || h.tui.route() == Route::Home);
    h.tui.keymap.dispatch("diff.open", None);
    h.wait_for("≡ f0000.rs");
    assert!(!h.app.app().is_quitting());
    h.keys(&["ctrl+c"]);
    assert!(h.app.app().is_quitting(), "ctrl+c did not exit:\n{}", h.app.text());
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

// Expected (P6c, a select's `query`): the base picker asks the server for the branches of what is typed, once it stayed
// 150 ms, and shows its empty text when none match.
#[test]
fn the_base_picker_searches_the_server_as_the_user_types() {
    let files: Vec<Value> = (0..2).map(|index| hunk_file(index, 4)).collect();
    let memory = Memory::new(
        routes(Value::Array(files))
            .into_iter()
            .chain([MemoryRoute::json("GET", "/api/vcs/branch", 200, &json!({ "location": { "directory": DIRECTORY }, "data": [] }))])
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
    h.wait_for("No branches found");
    let searched = |search: &str| {
        h.memory.requests().iter().any(|logged| {
            logged.path == "/api/vcs/branch" && logged.query.get("search").is_some_and(|values| values == &[search])
        })
    };
    h.app.type_text("rel");
    h.settle();
    assert!(!searched("rel"), "the search did not wait");
    h.app.advance(Duration::from_millis(200));
    h.wait("the picker did not search the server", || searched("rel"));
    h.wait_for("No branches found");
}
