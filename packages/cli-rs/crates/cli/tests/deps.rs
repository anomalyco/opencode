//! Keeps `deps-allow.txt` equal to the third-party crates `opencode-cli` ships with, and its `[tests]` section equal
//! to those only the rest of the workspace uses: tests, examples, and members `opencode-cli` does not ship (O-58).

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::Path;
use std::process::Command;

use serde_json::Value;

const TARGET: &str = "x86_64-unknown-linux-gnu";
const ROOT: &str = "opencode-cli";
const TESTS: &str = "[tests]";

#[test]
fn allow_list_matches_the_graph() {
    let workspace = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let shipped = graph(&workspace, &["-p", ROOT, "-e", "normal,build"]);
    let mut tests = graph(&workspace, &["--workspace", "-e", "normal,build,dev"]);
    tests.retain(|name, _| !shipped.contains_key(name));
    let text = std::fs::read_to_string(workspace.join("deps-allow.txt")).expect("deps-allow.txt is readable");
    let (shipped_text, tests_text) = text.split_once(&format!("\n{TESTS}\n")).expect("deps-allow.txt has [tests]");

    let differences = [
        differences(&format!("the shipped graph of {ROOT}"), &shipped, &parse(shipped_text)),
        differences(&format!("the rest of the workspace, the {TESTS} section"), &tests, &parse(tests_text)),
    ];
    assert!(
        differences.iter().all(Option::is_none),
        "deps-allow.txt does not match the dependency graph for {TARGET}.\n{}\n\
         \nA new third-party crate, build script or proc macro, in either section, needs an orchestrator decision \
         (O-58, an O- entry in decisions.md) before its line goes into deps-allow.txt; otherwise remove the dependency. \
         For a crate that left the graph, delete its line.",
        differences.into_iter().flatten().collect::<Vec<_>>().join("\n"),
    );
}

fn differences(
    what: &str,
    graph: &BTreeMap<String, BTreeSet<&str>>,
    listed: &BTreeMap<String, BTreeSet<&str>>,
) -> Option<String> {
    let added = graph.iter().filter(|(name, marks)| listed.get(*name) != Some(marks)).map(line).collect::<Vec<_>>();
    let removed = listed.iter().filter(|(name, marks)| graph.get(*name) != Some(marks)).map(line).collect::<Vec<_>>();
    (!added.is_empty() || !removed.is_empty()).then(|| {
        format!(
            "\nFor {what}:\nIn the graph, not in the file (a new crate, build script or proc macro):\n{}\n\
             In the file, not in the graph (removed or changed):\n{}",
            bullets(&added),
            bullets(&removed),
        )
    })
}

/// Third-party crates reachable over the edges `selection` names, with their marks. `cargo tree` gives the crates
/// with the features that selection resolves (`cargo metadata` unifies features over the whole workspace,
/// dev-dependencies included, and so lists more for `ROOT`); `cargo metadata` gives each crate's targets and declared
/// dependencies.
fn graph(workspace: &Path, selection: &[&str]) -> BTreeMap<String, BTreeSet<&'static str>> {
    let manifest = workspace.join("Cargo.toml");
    let tree = cargo(
        &manifest,
        &["tree", "--target", TARGET, "--prefix", "none", "--format", "{p}"]
            .iter()
            .chain(selection)
            .copied()
            .collect::<Vec<_>>(),
    );
    let metadata: Value =
        serde_json::from_str(&cargo(&manifest, &["metadata", "--format-version", "1", "--filter-platform", TARGET]))
            .expect("cargo metadata prints JSON");
    let packages = metadata["packages"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| ((p["name"].as_str().unwrap(), p["version"].as_str().unwrap()), p))
        .collect::<HashMap<_, _>>();

    let crates = tree
        .lines()
        .filter_map(|line| {
            let mut words = line.split_whitespace();
            Some((words.next()?, words.next()?.strip_prefix('v')?))
        })
        .collect::<BTreeSet<_>>();
    let mut graph = BTreeMap::<String, BTreeSet<&'static str>>::new();
    for package in crates.iter().map(|key| packages[key]).filter(|p| !p["source"].is_null()) {
        let kinds = package["targets"]
            .as_array()
            .unwrap()
            .iter()
            .flat_map(|t| t["kind"].as_array().unwrap())
            .collect::<Vec<_>>();
        let cc =
            package["dependencies"].as_array().unwrap().iter().any(|dep| dep["name"] == "cc" && dep["kind"] == "build");
        let marks = graph.entry(package["name"].as_str().unwrap().to_owned()).or_default();
        if kinds.iter().any(|kind| *kind == "custom-build") {
            marks.insert("build");
        }
        if kinds.iter().any(|kind| *kind == "proc-macro") {
            marks.insert("proc-macro");
        }
        if cc {
            marks.insert("cc");
        }
    }
    graph
}

/// Runs cargo offline against the lock file. Inside `cargo test` this takes no lock the test run holds.
fn cargo(manifest: &Path, args: &[&str]) -> String {
    let output = Command::new(std::env::var_os("CARGO").unwrap_or_else(|| "cargo".into()))
        .args(args)
        .args(["--locked", "--offline", "--manifest-path"])
        .arg(manifest)
        .output()
        .expect("cargo runs");
    assert!(output.status.success(), "cargo {} failed:\n{}", args[0], String::from_utf8_lossy(&output.stderr));
    String::from_utf8(output.stdout).expect("cargo prints UTF-8")
}

fn parse(text: &str) -> BTreeMap<String, BTreeSet<&str>> {
    text.lines()
        .map(|line| line.split('#').next().unwrap().trim())
        .filter(|line| !line.is_empty())
        .map(|line| {
            let mut words = line.split_whitespace();
            (words.next().unwrap().to_owned(), words.collect())
        })
        .collect()
}

fn line((name, marks): (&String, &BTreeSet<&str>)) -> String {
    std::iter::once(name.as_str()).chain(marks.iter().copied()).collect::<Vec<_>>().join(" ")
}

fn bullets(lines: &[String]) -> String {
    if lines.is_empty() {
        return "  (none)".to_owned();
    }
    lines.iter().map(|line| format!("  {line}")).collect::<Vec<_>>().join("\n")
}
