//! Drive the plugin lifecycle, manager, and viewer against the shared state-machine fixture. Compare each observed
//! state with the recorded expectation.

use crate::support::{self, Harness};

use std::cell::Cell;
use std::collections::BTreeSet;
use std::sync::Arc;
use std::time::Duration;

use opencode_api::memory::{Memory, Route as MemoryRoute};
use opencode_tui::{Deps, Route};
use serde_json::{Value, json};

const MACHINES: &str = include_str!("../../../../parity/machines/plugins.json");

thread_local! {
    static ARMED: Cell<bool> = const { Cell::new(false) };
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
/// (`continue`). The plugin life's machines run an external plugin, which only a build with the `native` feature loads.
fn replay(machine: &Value, path: &[&str], known: &mut ExpectedFailures) -> Option<String> {
    if machine == &CORPUS["machines"]["viewer"] {
        return replay_viewer(machine, path, known);
    }
    unreachable!("the plugin life runs an external plugin, which a build without the native feature does not load")
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
