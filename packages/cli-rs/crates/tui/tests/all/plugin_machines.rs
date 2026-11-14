//! The shared fixture of the plugin work (O-124, phase Pt), Rust reader: `parity/machines/plugins.json` holds the
//! life of a plugin as the user sees it, as states with an expected observation and named actions. The TS reader is
//! `parity/machines/plugins.test.tsx`. This drives the real TUI through every legal path to the file's depth and its
//! seeded walks, each on a fresh mount, observing after every action, in OpenTUI's shape
//! (`packages/rust/crates/opentui/tests/interaction_machines.rs`). Then it drops, repeats or swaps one action inside
//! two normal cycles; an action a state has no edge for does nothing. A known difference is an exact row of the
//! file's `xfail`, and a row that stops failing fails the test.

use crate::support::{self, Harness};

use std::cell::Cell;
use std::collections::BTreeSet;
use std::rc::Rc;
use std::sync::Arc;
use std::time::Duration;

use opencode_plugin::abi;
use opencode_plugin::loader::native::loopback_described;
use opencode_plugin::loader::{Backend, Loader, entry_file};
use opencode_plugin::{Definition, ErrorFn, Host};
use opencode_tui::plugins::host::host;
use opencode_tui::{Deps, Route};
use serde_json::Value;

const MACHINES: &str = include_str!("../../../../parity/machines/plugins.json");

thread_local! {
    /// Life arm: the next setup fails. It outlives an activation, as the TS plugin's module state does.
    static ARMED: Cell<bool> = const { Cell::new(false) };
}

/// The Rust twin of `parity/plugins/life/tui.tsx`.
fn life(setup: &mut abi::Setup) -> Result<(), String> {
    if ARMED.replace(false) {
        return Err("life setup armed to throw".to_owned());
    }
    let side = Rc::new(Cell::new('A'));
    let command = |name: &str, title: &str| abi::Command {
        name: name.to_owned(),
        title: title.to_owned(),
        palette: true,
        ..abi::Command::default()
    };
    let flip = |side: &Cell<char>| side.set(if side.get() == 'A' { 'B' } else { 'A' });
    let flipped = side.clone();
    setup.command(command("life.flip", "Life flip"), move |_, _| flip(&flipped));
    setup.command(command("life.throw", "Life throw"), |_, _| panic!("life command throws"));
    setup.command(command("life.arm", "Life arm"), |_, _| ARMED.set(true));
    setup.command(command("life.dialog", "Life dialog"), |host, _| {
        // TS's prompt has no action; this one names a command nobody registers.
        let action = abi::Action::Command { name: "life.prompted".to_owned(), input: None };
        host.dialog(abi::Dialog::Prompt { title: "Life prompt".to_owned(), placeholder: None, action });
    });
    // TS's confirm and alert resolve a promise that flips the line; here they name a command that does. A build that
    // replaced this one registers the same names, so an answer that reached it would flip its line.
    let answer = |name: &str| abi::Action::Command { name: name.to_owned(), input: None };
    setup.command(command("life.confirm", "Life confirm"), move |host, _| {
        host.dialog(abi::Dialog::Confirm(abi::Confirm {
            title: "Life asks".to_owned(),
            message: "Flip the line?".to_owned(),
            label: abi::ConfirmLabel::default(),
            action: answer("life.answered"),
        }));
    });
    setup.command(command("life.alert", "Life alert"), move |host, _| {
        host.dialog(abi::Dialog::Alert(abi::Alert {
            title: "Life says".to_owned(),
            message: "The line flips as this closes.".to_owned(),
            action: Some(answer("life.closed")),
        }));
    });
    let hidden = |name: &str| abi::Command { name: name.to_owned(), ..abi::Command::default() };
    let answered = side.clone();
    setup.command(hidden("life.answered"), move |_, input| {
        if input == Some("true") {
            flip(&answered);
        }
    });
    let closed = side.clone();
    setup.command(hidden("life.closed"), move |_, _| flip(&closed));
    setup.slot(abi::Placement::append("home.footer"), move |read, _, _| {
        // The pending key sequence (1.6), after the line while one is pending.
        let pending: Vec<String> = read.keymap_pending().into_iter().map(|part| part.key).collect();
        let keys = if pending.is_empty() { String::new() } else { format!(" keys {}", pending.join(" ")) };
        abi::Render::Show(abi::Node::text([abi::Span::new(format!("life plugin: {}{keys}", side.get()))]))
    });
    Ok(())
}

/// The twin's builds, through the C ABI's byte shims: every build is `life`, and a new file is a reload.
struct Builds;

impl Backend for Builds {
    fn load(&self, host: &Rc<dyn Host>, _: &[u8], _: Option<&str>) -> Result<(Definition, ErrorFn), String> {
        loopback_described(host, abi::export_plugin!(@loopback_described "parity.life", life))
    }
}

/// The TUI on home with the life plugin in its plugins directory, as the user drives it.
struct Life {
    harness: Harness,
    loader: Loader,
    build: std::path::PathBuf,
    builds: Cell<u8>,
    _root: opencode_util::temp::TempDir,
}

impl Life {
    fn open() -> Self {
        ARMED.set(false);
        let harness = support::mount(80, 24, Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) });
        let root = opencode_util::temp::tempdir().unwrap();
        // The project root, so the loader looks for plugins in this directory and none above it.
        std::fs::create_dir(root.path().join(".git")).unwrap();
        let config = root.path().join("config");
        // The manager labels an external plugin by its directory, so the reader finds its row as in TS.
        let dir = config.join("plugins").join("parity.life");
        std::fs::create_dir_all(&dir).unwrap();
        let build = dir.join(entry_file());
        std::fs::write(&build, [1]).unwrap();
        let loader = Loader::new(Rc::new(Builds), config, root.path().to_path_buf(), Vec::new());
        loader.reconcile(&host(&harness.tui), &harness.tui.plugins);
        let life = Self { harness, loader, build, builds: Cell::new(1), _root: root };
        life.settle();
        life
    }

    fn settle(&self) {
        let (app, tui) = (&self.harness.app, &self.harness.tui);
        app.advance(Duration::from_millis(1));
        while tui.toasts.current().is_some() {
            tui.toasts.dismiss();
        }
        app.advance(Duration::from_millis(1));
    }

    fn act(&self, action: &str) {
        match action {
            "toggle" => {
                self.manager();
                self.harness.app.press("enter");
                self.settle();
                self.harness.app.press("escape");
            }
            "flip" | "throw" | "arm" | "dialog" | "confirm" | "alert" => {
                self.palette(&format!("Life {action}"), true);
            }
            "escape" | "enter" => self.harness.app.press(action),
            // The leader starts a key sequence, which the line shows while it is pending.
            "leader" => self.harness.app.press("ctrl+x"),
            "reload" => {
                self.builds.set(self.builds.get() + 1);
                std::fs::write(&self.build, [self.builds.get()]).unwrap();
                let tui = &self.harness.tui;
                self.loader.reconcile(&host(tui), &tui.plugins);
            }
            _ => panic!("unknown action {action}"),
        }
        self.settle();
    }

    /// Searches the palette for `title`, runs it if `run` asks and it is listed, and returns whether it is.
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

    /// Opens the plugin manager filtered to the life plugin.
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
            Some(row) if row.contains("inactive") => "off",
            Some(_) => "on",
            None => "none",
        };
        format!("{line}/{palette}/{row}/-")
    }
}

/// The known differences of this client: `state action observation`.
struct ExpectedFailures {
    known: BTreeSet<String>,
    seen: BTreeSet<String>,
}

impl ExpectedFailures {
    /// This client's rows of each of `rows`.
    fn new(rows: &[&Value]) -> Self {
        let known = rows
            .iter()
            .flat_map(|rows| rows.as_array().unwrap())
            .filter(|row| row[0] == "rust")
            .map(|row| {
                // A deviation file, or an open finding of `steps/plugins-pt.md`.
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

/// Every path from the initial state to `depth` (`walks` false), or the seeded walks, as OpenTUI's reader makes them.
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

/// Replays `path` on a fresh TUI. An action a state has no edge for does nothing. The first difference that is not
/// a known row, or `None`; a known row ends the path.
fn replay(machine: &Value, path: &[&str], known: &mut ExpectedFailures) -> Option<String> {
    let life = Life::open();
    let mut state = machine["initial"].as_str().unwrap();
    for (index, action) in ["mount"].into_iter().chain(path.iter().copied()).enumerate() {
        let next = match index {
            0 => state,
            _ => machine["states"][state][1][action].as_str().unwrap_or(state),
        };
        if index > 0 {
            life.act(action);
        }
        let (expected, actual) = (machine["states"][next][0].as_str().unwrap(), life.observe());
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

/// Replays `paths` of the life machine, and panics with the shrunk path of the first difference that is not a known
/// row of `rows`. Returns the known rows it met.
fn check(paths: impl IntoIterator<Item = Vec<&'static str>>, rows: &[&Value]) -> ExpectedFailures {
    let machine = &CORPUS["machines"]["life"];
    let mut known = ExpectedFailures::new(rows);
    for path in paths {
        let Some(failure) = replay(machine, &path, &mut known) else { continue };
        let path = shrink(path, |candidate| {
            replay(machine, candidate, &mut ExpectedFailures::new(rows)).as_ref() == Some(&failure)
        });
        panic!("life {path:?}: {failure}");
    }
    known
}

static CORPUS: std::sync::LazyLock<Value> = std::sync::LazyLock::new(|| serde_json::from_str(MACHINES).unwrap());

// Expected (4.14, the shared fixture): after every legal path to depth 4 the life plugin shows what the file says,
// and the known rows are exactly the differences.
#[test]
fn the_plugin_life_follows_the_shared_fixture() {
    let life = &CORPUS["machines"]["life"];
    check(traces(&CORPUS, life, false), &[&life["xfail"]]).check();
}

// Expected: the same along the file's seeded walks.
#[test]
fn the_plugin_life_follows_the_shared_fixture_on_walks() {
    let life = &CORPUS["machines"]["life"];
    check(traces(&CORPUS, life, true), &[&life["xfail"]]);
}

// Expected: the same after one action of two normal cycles is dropped, repeated or swapped. An action a state has no
// edge for does nothing. The known rows are the machine's and the fault trials' own.
#[test]
fn the_plugin_life_recovers_from_a_dropped_repeated_or_swapped_action() {
    let cycles: Vec<Vec<&str>> = CORPUS["faults"]["life"]["cycles"]
        .as_array()
        .unwrap()
        .iter()
        .map(|cycle| cycle.as_str().unwrap().split(' ').collect())
        .collect();
    check(faulted(&cycles), &[&CORPUS["machines"]["life"]["xfail"], &CORPUS["faults"]["life"]["xfail"]]);
}
