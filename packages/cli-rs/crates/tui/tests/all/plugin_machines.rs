//! Drive the plugin lifecycle, manager, and viewer against the shared state-machine fixture. Compare each observed
//! state with the recorded expectation.

use crate::support::{self, Harness};

#[cfg(luau)]
use std::cell::Cell;
use std::collections::BTreeSet;
#[cfg(luau)]
use std::path::{Path, PathBuf};
#[cfg(luau)]
use std::rc::Rc;
use std::sync::Arc;
use std::time::Duration;

use opencode_api::memory::{Memory, Route as MemoryRoute};
#[cfg(luau)]
use opencode_plugin::Status;
#[cfg(luau)]
use opencode_plugin::loader::{Configured, Loader};
#[cfg(luau)]
use opencode_tui::plugins::host::host;
use opencode_tui::{Deps, Route};
use serde_json::{Value, json};

const MACHINES: &str = include_str!("../../../../parity/machines/plugins.json");

/// The life plugin of the shared fixture, `parity/plugins/life` (its Luau side), copied into the config's `plugins`
/// directory, or with `project` into the project's, where it waits for approval; with `failing`,
/// its setup fails as it first loads, and so does the distractor's beside it (`parity/plugins/other`), each named in
/// `cli.json` with the option `fail`, as TS's reader names them.
#[cfg(luau)]
struct Life {
    harness: Harness,
    loader: Rc<Loader>,
    /// The plugin's `init.luau`, which a reload rewrites with the next build.
    init: PathBuf,
    target: String,
    builds: Cell<u8>,
    _root: opencode_util::temp::TempDir,
}

#[cfg(luau)]
impl Life {
    fn open(project: bool, failing: bool) -> Self {
        let harness = support::mount(80, 24, Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) });
        let root = opencode_util::temp::tempdir().unwrap();
        // The project root, so the loader looks for plugins in this directory and none above it.
        std::fs::create_dir(root.path().join(".git")).unwrap();
        let config = root.path().join("config");
        let plugins = if project { root.path().join(".opencode/plugins") } else { config.join("plugins") };
        let copy = |name: &str| {
            let dir = plugins.join(format!("parity.{name}"));
            std::fs::create_dir_all(&dir).unwrap();
            let twin = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../parity/plugins").join(name);
            for file in ["plugin.toml", "init.luau"] {
                std::fs::copy(twin.join(file), dir.join(file)).unwrap();
            }
            dir
        };
        let dir = copy("life");
        let configured = match failing {
            true => [dir.clone(), copy("other")]
                .iter()
                .map(|dir| Configured {
                    target: dir.to_string_lossy().into_owned(),
                    options: Some(r#"{"fail":true}"#.to_owned()),
                })
                .collect(),
            false => Vec::new(),
        };
        let loader = Rc::new(Loader::new(config, root.path().to_path_buf(), configured).with_luau(|| {}));
        harness.tui.plugins.set_loader(loader.clone());
        let target = dir.to_string_lossy().into_owned();
        let life = Self { harness, loader, init: dir.join("init.luau"), target, builds: Cell::new(1), _root: root };
        life.reconcile();
        life.settle();
        life
    }

    /// Reconciles until a reconcile after a finished walk changes nothing and leaves no compiled build waiting, as the
    /// host does on each walk's wake. A Luau plugin's files are walked, staged and compiled on threads of their own.
    fn reconcile(&self) {
        let tui = &self.harness.tui;
        for round in 0..400 {
            let changed = self.loader.reconcile(&host(tui), &tui.plugins);
            while self.loader.luau_walking() {
                std::thread::sleep(Duration::from_millis(1));
            }
            if round > 0 && !changed && !self.loader.luau_ready() {
                return;
            }
        }
        panic!("the loader never settled");
    }

    fn settle(&self) {
        let (app, tui) = (&self.harness.app, &self.harness.tui);
        app.advance(Duration::from_millis(1));
        while tui.toasts.current().is_some() {
            tui.toasts.dismiss();
        }
        app.advance(Duration::from_millis(1));
    }

    /// The plugin's status in the manager's list.
    fn status(&self) -> Option<Status> {
        let entries = self.harness.tui.plugins.entries();
        entries.into_iter().find(|entry| entry.target.as_deref() == Some(&*self.target)).map(|entry| entry.status)
    }

    fn act(&self, action: &str) {
        match action {
            "toggle" => {
                self.manager();
                self.harness.app.press("enter");
                self.settle();
                self.harness.app.press("escape");
            }
            "flip" | "throw" | "stall" | "arm" | "dialog" | "confirm" | "alert" => {
                self.palette(&format!("Life {action}"), true);
            }
            // The plugin manager's question: Enter on the row asks, Decline is active at first, and the list comes
            // back once it is answered. The answer is checked against the files off the UI thread, then the approved
            // files are staged and compiled.
            "approve" | "decline" => {
                self.manager();
                self.harness.app.press("enter");
                self.settle();
                if action == "approve" {
                    self.harness.app.press("right");
                }
                self.harness.app.press("enter");
                // The answer is applied when an approval stops holding the build back, or a decline lists the row;
                // the approved files are staged and compiled after that, which `reconcile` waits for.
                let answered = self.harness.app.wait_until(support::WAIT, || match action {
                    "approve" => self.loader.held(&self.target).is_none(),
                    _ => self.status() != Some(Status::Pending),
                });
                assert!(answered, "the answer to the question was not recorded");
                self.reconcile();
                self.settle();
                self.harness.app.press("escape");
            }
            "escape" | "enter" => self.harness.app.press(action),
            // The leader starts a key sequence, which the line shows while it is pending.
            "leader" => self.harness.app.press("ctrl+x"),
            "reload" => {
                self.builds.set(self.builds.get() + 1);
                let source = std::fs::read_to_string(&self.init).unwrap();
                let next = source.replacen(
                    &format!("local BUILD = {}", self.builds.get() - 1),
                    &format!("local BUILD = {}", self.builds.get()),
                    1,
                );
                std::fs::write(&self.init, next).unwrap();
                self.reconcile();
            }
            _ => panic!("unknown action {action}"),
        }
        self.settle();
    }

    fn palette(&self, title: &str, run: bool) -> bool {
        let app = &self.harness.app;
        app.press("ctrl+p");
        self.settle();
        app.type_text(title);
        self.settle();
        // The filter shows the title too, so a listed command shows it twice.
        let listed = app.text().matches(title).count() >= 2;
        app.press(if listed && run { "enter" } else { "escape" });
        self.settle();
        listed
    }

    fn manager(&self) {
        self.harness.tui.keymap.dispatch("plugins.list", None);
        self.settle();
        self.harness.app.type_text("life");
        self.settle();
    }

    /// `line/palette/row/dialog`, as `parity/machines/plugins.json` writes them. While its dialog shows, the palette
    /// and the manager would replace it, so the first three are not read; while a key sequence is pending, a key would
    /// continue it, so the line is read with its keys alone.
    fn observe(&self) -> String {
        let screen = self.harness.app.text();
        let dialogs = [("Life prompt", "prompt"), ("Life asks", "confirm"), ("Life says", "alert")];
        if let Some((_, dialog)) = dialogs.into_iter().find(|(title, _)| screen.contains(title)) {
            return format!("?/?/?/{dialog}");
        }
        let line = ["A", "B"].into_iter().find(|side| screen.contains(&format!("life plugin: {side}"))).unwrap_or("-");
        let keys = screen
            .lines()
            .filter(|row| row.contains("life plugin: "))
            .find_map(|row| row.split(" keys ").nth(1))
            .and_then(|keys| keys.split_whitespace().next());
        if let Some(keys) = keys {
            return format!("{line}+{keys}/?/?/-");
        }
        let palette = if self.palette("Life flip", false) { "yes" } else { "no" };
        self.manager();
        let screen = self.harness.app.text();
        self.harness.app.press("escape");
        self.settle();
        let row = screen.lines().find(|line| line.contains("parity.life") && !line.contains("Plugin failed"));
        let row = match row {
            Some(row) if row.contains("failed") => "failed",
            Some(row) if row.contains("pending") => "pending",
            Some(row) if row.contains("declined") => "declined",
            Some(row) if row.contains("inactive") => "off",
            Some(_) => "on",
            None => "none",
        };
        format!("{line}/{palette}/{row}/-")
    }

    fn act_manager(&self, action: &str) {
        match action {
            "open" => {
                self.harness.app.type_text("/plugins");
                self.settle();
                self.harness.app.press("enter");
            }
            "escape" => self.harness.app.press("escape"),
            "internal" => self.harness.app.press("ctrl+a"),
            "toggle" => self.harness.app.press("enter"),
            _ => panic!("unknown action {action}"),
        }
        self.settle();
    }

    fn act_views(&self, action: &str) {
        match action {
            "open" => {
                self.harness.app.type_text("/plugins");
                self.settle();
                self.harness.app.press("enter");
            }
            "filter" => self.harness.app.type_text("parity.other"),
            "down" => self.harness.app.press("down"),
            "details" => {
                let key = if self.harness.app.text().contains("view error space") { "space" } else { "enter" };
                self.harness.app.press(key);
            }
            "escape" => self.harness.app.press("escape"),
            _ => panic!("unknown action {action}"),
        }
        self.settle();
    }

    fn observe_views(&self) -> String {
        let screen = self.harness.app.text();
        let lines: Vec<&str> = screen.lines().collect();
        if screen.contains("TUI plugin error") {
            let title = lines.iter().position(|line| line.contains("TUI plugin error"));
            let source = title.and_then(|row| lines.get(row + 1)).copied().unwrap_or_default();
            let plugin = source.split("parity.").nth(1);
            let plugin = plugin.and_then(|rest| rest.split(|c: char| !c.is_alphanumeric()).next()).unwrap_or("?");
            let cause = match (screen.contains("life setup"), screen.contains("other setup")) {
                (true, false) => "life",
                (false, true) => "other",
                _ => "?",
            };
            return format!("error/{plugin}/{cause}");
        }
        if !screen.contains("show internal") && !screen.contains("hide internal") {
            return "-/?/?".to_owned();
        }
        let title = lines.iter().position(|line| line.contains("Plugins") && line.contains("esc"));
        let query = title.and_then(|row| lines.get(row + 2)).map_or("?", |line| line.trim());
        let query = if query == "Search" { "-" } else { query };
        let rows: Vec<String> = lines
            .iter()
            .filter(|line| line.contains("parity.") && line.contains("local"))
            .map(|line| {
                let name = line.split("parity.").nth(1).and_then(|rest| rest.split_whitespace().next()).unwrap_or("?");
                let status = if line.contains("failed") {
                    "failed"
                } else if line.contains("inactive") {
                    "off"
                } else {
                    "on"
                };
                format!("{name}:{status}")
            })
            .collect();
        format!("list/{query}/{}", rows.join("+"))
    }

    fn observe_manager(&self) -> String {
        let screen = self.harness.app.text();
        let internal = ["show", "hide"].into_iter().find(|word| screen.contains(&format!("{word} internal")));
        let Some(internal) = internal else {
            let life = if screen.contains("life plugin:") { "on" } else { "off" };
            return format!("-/?/{life}");
        };
        if internal == "hide" {
            return "list/hide/?".to_owned();
        }
        let row = screen.lines().find(|line| line.contains("parity.life") && !line.contains("Plugin failed"));
        let life = match row {
            Some(row) if row.contains("inactive") => "off",
            Some(_) => "on",
            None => "none",
        };
        format!("list/{internal}/{life}")
    }
}

struct Viewer {
    harness: Harness,
}

impl Viewer {
    fn open() -> Self {
        let location = json!({ "directory": "/project", "project": { "id": "proj", "directory": "/project" } });
        let list = |data: Value| json!({ "location": location, "data": data });
        let file = |name: &str| {
            json!({ "file": format!("{name}.ts"), "patch": format!("@@ -1 +1 @@\n-old {name}\n+new {name}\n"),
                "additions": 1, "deletions": 1, "status": "modified" })
        };
        let memory = Memory::new(vec![
            MemoryRoute::json("GET", "/api/location", 200, &location),
            MemoryRoute::json("GET", "/api/agent", 200, &list(json!([]))),
            MemoryRoute::json("GET", "/api/model", 200, &list(json!([]))),
            MemoryRoute::json("GET", "/api/session", 200, &json!({ "data": [], "cursor": {} })),
            MemoryRoute::json("GET", "/api/vcs/diff", 200, &list(json!([file("a"), file("b")]))),
        ]);
        let config = json!({ "animations": false, "diffs": { "source": "working" } });
        let deps = Deps {
            config: support::config(support::decode(&config.to_string())),
            route: Route::Home,
            ..support::deps(Arc::new(memory))
        };
        let viewer = Self { harness: support::mount(120, 30, deps) };
        viewer.settle();
        viewer
    }

    fn settle(&self) {
        let app = &self.harness.app;
        app.advance(Duration::from_millis(1));
        for _ in 0..20 {
            app.render();
            if !app.needs_frame() {
                break;
            }
        }
    }

    fn act(&self, action: &str) {
        let app = &self.harness.app;
        match action {
            "open" => {
                app.type_text("/diff");
                self.settle();
                app.press("enter");
                assert!(app.wait_until(support::WAIT, || app.text().contains("≡ a.ts")), "{}", app.text());
            }
            "close" => app.press("q"),
            "review" => app.press("m"),
            "single" => app.press("s"),
            _ => panic!("unknown action {action}"),
        }
        self.settle();
    }

    /// `screen/reviewed/shown`, as `parity/machines/plugins.json` writes them for the viewer machine: the tree is the
    /// screen's first 30 columns, the cards the rest.
    fn observe(&self) -> String {
        let screen = self.harness.app.text();
        let (mut reviewed, mut shown) = (String::new(), String::new());
        for line in screen.lines() {
            let tree: String = line.chars().take(30).collect();
            let pane: String = line.chars().skip(30).collect();
            for name in ["a", "b"] {
                if tree.contains(&format!("≡ {name}.ts")) && tree.trim_end().ends_with('✓') {
                    reviewed.push_str(name);
                }
                if pane.contains(&format!("{name}.ts")) {
                    shown.push_str(name);
                }
            }
        }
        if !screen.contains("≡ a.ts") {
            return "-/?/?".to_owned();
        }
        let reviewed = if reviewed.is_empty() { "-" } else { &reviewed };
        format!("diff/{reviewed}/{shown}")
    }
}

fn replay_viewer(machine: &Value, path: &[&str], known: &mut ExpectedFailures) -> Option<String> {
    let viewer = Viewer::open();
    let mut state = machine["initial"].as_str().unwrap();
    for (index, action) in ["mount"].into_iter().chain(path.iter().copied()).enumerate() {
        let edge = machine["states"][state][1][action].as_str();
        let next = if index == 0 { state } else { edge.unwrap_or(state) };
        if index > 0 {
            let unspecified =
                machine["unspecified"][state].as_array().is_some_and(|actions| actions.contains(&action.into()));
            match edge {
                Some(_) => viewer.act(action),
                None => assert!(unspecified, "the viewer machine names no outcome of {action} in {state}"),
            }
        }
        let (actual, expected) = (viewer.observe(), machine["states"][next][0].as_str().unwrap());
        if actual != expected {
            if known.has(&format!("{state} {action} {actual}")) {
                return None;
            }
            return Some(format!("{state} + {action}: expected {expected:?}, got {actual:?}"));
        }
        state = next;
    }
    None
}

struct ExpectedFailures {
    known: BTreeSet<String>,
    seen: BTreeSet<String>,
}

impl ExpectedFailures {
    fn new(rows: &[&Value]) -> Self {
        let known = rows
            .iter()
            .flat_map(|rows| rows.as_array().unwrap())
            .filter(|row| row[0] == "rust")
            .map(|row| {
                let file = row[1].as_str().unwrap();
                let deviation =
                    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("../../parity/deviations/{file}.md"));
                assert!(
                    file.starts_with("finding:") || deviation.is_file(),
                    "xfail row names no deviation file: {file}"
                );
                row[2].as_str().unwrap().to_owned()
            })
            .collect();
        Self { known, seen: BTreeSet::new() }
    }

    fn has(&mut self, key: &str) -> bool {
        let known = self.known.contains(key);
        if known {
            self.seen.insert(key.to_owned());
        }
        known
    }

    fn check(&self) {
        let unseen: Vec<_> = self.known.difference(&self.seen).collect();
        assert!(unseen.is_empty(), "expected failure disappeared: {unseen:?}");
    }
}

fn traces<'a>(corpus: &Value, machine: &'a Value, walks: bool) -> Vec<Vec<&'a str>> {
    fn visit<'a>(machine: &'a Value, state: &str, path: &mut Vec<&'a str>, depth: usize, out: &mut Vec<Vec<&'a str>>) {
        let edges = machine["states"][state][1].as_object().unwrap();
        if path.len() == depth || edges.is_empty() {
            out.push(path.clone());
            return;
        }
        for (action, next) in edges {
            path.push(action);
            visit(machine, next.as_str().unwrap(), path, depth, out);
            path.pop();
        }
    }
    let mut out = Vec::new();
    let initial = machine["initial"].as_str().unwrap();
    if !walks {
        visit(machine, initial, &mut Vec::new(), corpus["depth"].as_u64().unwrap() as usize, &mut out);
        return out;
    }
    for seed in 0..corpus["seeds"].as_u64().unwrap() as u32 {
        let (mut state, mut n, mut path) = (initial, seed, Vec::new());
        for _ in 0..corpus["steps"].as_u64().unwrap() {
            let edges = machine["states"][state][1].as_object().unwrap();
            n = n.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            let mut keys: Vec<_> = edges.keys().collect();
            keys.sort_unstable();
            let action = keys[(n >> 16) as usize % keys.len()].as_str();
            path.push(action);
            state = edges[action].as_str().unwrap();
        }
        out.push(path);
    }
    out
}

/// Replays `path` on a fresh TUI. An action a state has no edge for does nothing; the manager machine names an
/// outcome for each, and its reader sends every action but those it lists as unspecified. The first difference that
/// is not a known row, or `None`; a known row ends the path, unless the machine says this client follows it on
/// (`continue`). The plugin life's machines run the Luau twin of the TS plugin, which only a build with the `luau`
/// feature loads.
fn replay(machine: &Value, path: &[&str], known: &mut ExpectedFailures) -> Option<String> {
    if machine == &CORPUS["machines"]["viewer"] {
        return replay_viewer(machine, path, known);
    }
    #[cfg(luau)]
    return replay_life(machine, path, known);
    #[cfg(not(luau))]
    unreachable!("the plugin life runs a Luau plugin, which a build without the luau feature does not load")
}

/// [`replay`] of the machines that run the plugin life.
#[cfg(luau)]
fn replay_life(machine: &Value, path: &[&str], known: &mut ExpectedFailures) -> Option<String> {
    let views = machine == &CORPUS["machines"]["views"];
    let life = Life::open(machine == &CORPUS["machines"]["project"], views);
    let manager = machine == &CORPUS["machines"]["manager"] || views;
    let follows = machine["continue"] == true;
    let mut state = machine["initial"].as_str().unwrap();
    for (index, action) in ["mount"].into_iter().chain(path.iter().copied()).enumerate() {
        let edge = machine["states"][state][1][action].as_str();
        let next = match index {
            0 => state,
            _ => edge.unwrap_or(state),
        };
        let unspecified =
            machine["unspecified"][state].as_array().is_some_and(|actions| actions.contains(&action.into()));
        match (index, manager) {
            (0, _) => {}
            (_, true) if edge.is_some() && views => life.act_views(action),
            (_, true) if edge.is_some() => life.act_manager(action),
            (_, true) => assert!(unspecified, "the manager machine names no outcome of {action} in {state}"),
            (_, false) => life.act(action),
        }
        let actual = match (views, manager) {
            (true, _) => life.observe_views(),
            (_, true) => life.observe_manager(),
            _ => life.observe(),
        };
        let expected = machine["states"][next][0].as_str().unwrap();
        if actual != expected {
            if known.has(&format!("{state} {action} {actual}")) {
                if !follows {
                    return None;
                }
                state = next;
                continue;
            }
            return Some(format!("{state} + {action}: expected {expected:?}, got {actual:?}"));
        }
        state = next;
    }
    None
}

/// Removes chunks, largest first, while the same failure remains.
fn shrink<T: Clone>(mut path: Vec<T>, mut fails: impl FnMut(&[T]) -> bool) -> Vec<T> {
    for size in (1..=path.len()).rev() {
        for start in (0..=path.len().saturating_sub(size)).rev() {
            if start + size > path.len() {
                continue;
            }
            let mut candidate = path.clone();
            candidate.drain(start..start + size);
            if fails(&candidate) {
                path = candidate;
            }
        }
    }
    path
}

/// Two normal cycles, each with one action dropped, repeated, or swapped with the next.
fn faulted<'a>(cycles: &[Vec<&'a str>]) -> BTreeSet<Vec<&'a str>> {
    let mut out = BTreeSet::new();
    for a in cycles {
        for b in cycles {
            let normal: Vec<&str> = a.iter().chain(b).copied().collect();
            for i in 0..normal.len() {
                let mut dropped = normal.clone();
                dropped.remove(i);
                let mut repeated = normal.clone();
                repeated.insert(i, normal[i]);
                out.extend([dropped, repeated]);
                if i + 1 < normal.len() {
                    let mut swapped = normal.clone();
                    swapped.swap(i, i + 1);
                    out.insert(swapped);
                }
            }
        }
    }
    out
}

/// Replays `paths` of the machine `name`, and panics with the shrunk path of the first difference that is not a known
/// row of `rows`. Returns the known rows it met.
fn check(name: &str, paths: impl IntoIterator<Item = Vec<&'static str>>, rows: &[&Value]) -> ExpectedFailures {
    let machine = &CORPUS["machines"][name];
    let mut known = ExpectedFailures::new(rows);
    for path in paths {
        let Some(failure) = replay(machine, &path, &mut known) else { continue };
        let path = shrink(path, |candidate| {
            replay(machine, candidate, &mut ExpectedFailures::new(rows)).as_ref() == Some(&failure)
        });
        panic!("{name} {path:?}: {failure}");
    }
    known
}

static CORPUS: std::sync::LazyLock<Value> = std::sync::LazyLock::new(|| serde_json::from_str(MACHINES).unwrap());

fn cycles(name: &str) -> Vec<Vec<&'static str>> {
    CORPUS["faults"][name]["cycles"]
        .as_array()
        .unwrap()
        .iter()
        .map(|cycle| cycle.as_str().unwrap().split(' ').collect())
        .collect()
}

#[test]
#[cfg(luau)]
fn the_plugin_life_follows_the_shared_fixture() {
    let life = &CORPUS["machines"]["life"];
    check("life", traces(&CORPUS, life, false), &[&life["xfail"]]).check();
}

#[test]
#[cfg(luau)]
fn the_plugin_life_follows_the_shared_fixture_on_walks() {
    let life = &CORPUS["machines"]["life"];
    check("life", traces(&CORPUS, life, true), &[&life["xfail"]]);
}

#[test]
#[cfg(luau)]
fn a_project_plugin_follows_the_shared_fixture() {
    let project = &CORPUS["machines"]["project"];
    check("project", traces(&CORPUS, project, false), &[&project["xfail"]]).check();
}

#[test]
#[cfg(luau)]
fn the_plugin_life_recovers_from_a_dropped_repeated_or_swapped_action() {
    check(
        "life",
        faulted(&cycles("life")),
        &[&CORPUS["machines"]["life"]["xfail"], &CORPUS["faults"]["life"]["xfail"]],
    );
}

#[test]
#[cfg(luau)]
fn the_plugin_manager_keys_follow_the_shared_fixture() {
    let manager = &CORPUS["machines"]["manager"];
    check("manager", traces(&CORPUS, manager, false), &[&manager["xfail"]]).check();
}

#[test]
#[cfg(luau)]
fn the_plugin_manager_keys_follow_the_shared_fixture_on_walks_and_faults() {
    let manager = &CORPUS["machines"]["manager"];
    check("manager", traces(&CORPUS, manager, true), &[&manager["xfail"]]);
    check("manager", faulted(&cycles("manager")), &[&manager["xfail"], &CORPUS["faults"]["manager"]["xfail"]]);
}

#[test]
#[cfg(luau)]
fn the_plugin_manager_views_follow_the_shared_fixture() {
    let views = &CORPUS["machines"]["views"];
    check("views", traces(&CORPUS, views, false), &[&views["xfail"]]).check();
}

#[test]
#[cfg(luau)]
fn the_plugin_manager_views_follow_the_shared_fixture_on_walks_and_faults() {
    let views = &CORPUS["machines"]["views"];
    check("views", traces(&CORPUS, views, true), &[&views["xfail"]]);
    check("views", faulted(&cycles("views")), &[&views["xfail"], &CORPUS["faults"]["views"]["xfail"]]);
}

#[test]
fn the_diff_viewer_follows_the_shared_fixture() {
    let viewer = &CORPUS["machines"]["viewer"];
    check("viewer", traces(&CORPUS, viewer, false), &[&viewer["xfail"]]).check();
}

#[test]
fn the_diff_viewer_follows_the_shared_fixture_on_walks_and_faults() {
    let viewer = &CORPUS["machines"]["viewer"];
    check("viewer", traces(&CORPUS, viewer, true), &[&viewer["xfail"]]);
    check("viewer", faulted(&cycles("viewer")), &[&viewer["xfail"], &CORPUS["faults"]["viewer"]["xfail"]]);
}
