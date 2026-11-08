//! Keeps `deps-allow.txt` equal to the third-party crates the workspace builds for `TARGET` (O-58), in three sections:
//! what `opencode-cli` ships with; `[tests]`, what the rest of the workspace adds with default features (tests,
//! examples, and members `opencode-cli` does not ship); and `[optional]`, what non-default features add. A crate that
//! is in an earlier section with other marks (another version with a build script, say) is listed again.
//!
//! Every crate is third-party except the workspace members and OpenTUI's packages, whatever its source: a vendored
//! crate by `path` is listed like any other.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::process::Command;

use serde_json::Value;

const TARGET: &str = "x86_64-unknown-linux-gnu";
const ROOT: &str = "opencode-cli";
const SECTIONS: [&str; 2] = ["[tests]", "[optional]"];

/// OpenTUI's packages, first-party when they come from where the workspace takes OpenTUI.
const OPENTUI: [&str; 2] = ["opentui", "opentui-sys"];
/// `None`: the opentui-rust checkout the workspace's `opentui` path dependency is in. When the client pins OpenTUI by
/// git `rev` (O-63), this becomes `Some("git+https://github.com/anomalyco/opentui")`.
const OPENTUI_GIT: Option<&str> = None;

type Graph = BTreeMap<String, BTreeSet<&'static str>>;

#[test]
fn allow_list_matches_the_graph() {
    let workspace = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let manifest = workspace.join("Cargo.toml");
    // Features do not change a package's targets or declared dependencies, so one all-features metadata serves the
    // three graphs.
    let metadata: Value = serde_json::from_str(&cargo(
        &manifest,
        &["metadata", "--format-version", "1", "--filter-platform", TARGET, "--all-features"],
    ))
    .expect("cargo metadata prints JSON");
    let graph = |selection: &[&str]| graph(&manifest, &metadata, selection);
    let shipped = graph(&["-p", ROOT, "-e", "normal,build"]);
    let workspace_graph = graph(&["--workspace", "-e", "normal,build,dev"]);
    let all = graph(&["--workspace", "-e", "normal,build,dev", "--all-features"]);

    let text = std::fs::read_to_string(workspace.join("deps-allow.txt")).expect("deps-allow.txt is readable");
    let (shipped_text, rest) = text.split_once(&format!("\n{}\n", SECTIONS[0])).expect("deps-allow.txt has [tests]");
    let (tests_text, optional_text) =
        rest.split_once(&format!("\n{}\n", SECTIONS[1])).expect("deps-allow.txt has [optional] after [tests]");

    let differences = [
        differences(&format!("the shipped graph of {ROOT}"), &shipped, &parse(shipped_text)),
        differences(
            &format!("the rest of the workspace, the {} section", SECTIONS[0]),
            &beyond(&workspace_graph, &shipped),
            &parse(tests_text),
        ),
        differences(
            &format!("non-default features, the {} section", SECTIONS[1]),
            &beyond(&all, &workspace_graph),
            &parse(optional_text),
        ),
    ];
    assert!(
        differences.iter().all(Option::is_none),
        "deps-allow.txt does not match the dependency graph for {TARGET}.\n{}\n\
         \nA new third-party crate, build script, proc macro or source, in any section, needs an orchestrator \
         decision (O-58, an O- entry in decisions.md) before its line goes into deps-allow.txt; otherwise remove the \
         dependency. For a crate that left the graph, delete its line.",
        differences.into_iter().flatten().collect::<Vec<_>>().join("\n"),
    );
}

/// The crates of `graph` that `base` lacks or lists with other marks.
fn beyond(graph: &Graph, base: &Graph) -> Graph {
    graph.iter().filter(|(name, marks)| base.get(*name) != Some(marks)).map(|(n, m)| (n.clone(), m.clone())).collect()
}

fn differences(what: &str, graph: &Graph, listed: &BTreeMap<String, BTreeSet<&str>>) -> Option<String> {
    let added = graph.iter().filter(|(name, marks)| listed.get(*name) != Some(marks)).map(line).collect::<Vec<_>>();
    let removed = listed.iter().filter(|(name, marks)| graph.get(*name) != Some(marks)).map(line).collect::<Vec<_>>();
    (!added.is_empty() || !removed.is_empty()).then(|| {
        format!(
            "\nFor {what}:\nIn the graph, not in the file (a new crate, build script, proc macro or source):\n{}\n\
             In the file, not in the graph (removed or changed):\n{}",
            bullets(&added),
            bullets(&removed),
        )
    })
}

/// Third-party crates reachable over the edges `selection` names, with their marks. `cargo tree` gives the crates
/// with the features that selection resolves (`cargo metadata` unifies features over the whole workspace,
/// dev-dependencies included, and so lists more for `ROOT`); `metadata` gives each crate's source, targets and
/// declared dependencies.
fn graph(manifest: &Path, metadata: &Value, selection: &[&str]) -> Graph {
    let tree = cargo(
        manifest,
        &["tree", "--target", TARGET, "--prefix", "none", "--format", "{p}"]
            .iter()
            .chain(selection)
            .copied()
            .collect::<Vec<_>>(),
    );
    let crates = tree
        .lines()
        .filter_map(|line| {
            let mut words = line.split_whitespace();
            Some((words.next()?, words.next()?.strip_prefix('v')?))
        })
        .collect::<BTreeSet<_>>();
    let members = metadata["workspace_members"].as_array().unwrap();
    let opentui = opentui_source(metadata);

    let mut graph = Graph::new();
    // `cargo tree` names a crate by name and version only; a second source of the same version (a vendored copy)
    // counts both, so neither hides the other.
    for package in metadata["packages"].as_array().unwrap().iter().filter(|p| {
        crates.contains(&(p["name"].as_str().unwrap(), p["version"].as_str().unwrap()))
            && !members.contains(&p["id"])
            && !(OPENTUI.contains(&p["name"].as_str().unwrap()) && p["id"].as_str().unwrap().starts_with(&opentui))
    }) {
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
        match package["source"].as_str() {
            None => marks.insert("path"),
            Some(source) if source.starts_with("git+") => marks.insert("git"),
            Some("registry+https://github.com/rust-lang/crates.io-index" | "sparse+https://index.crates.io/") => false,
            Some(_) => marks.insert("registry"),
        };
    }
    graph
}

/// The package ID prefix of OpenTUI's packages: the git repository, or the root of the checkout the workspace's
/// `opentui` path dependency is in (its `crates/opentui`, two levels down).
fn opentui_source(metadata: &Value) -> String {
    if let Some(url) = OPENTUI_GIT {
        return format!("{url}?");
    }
    let path = metadata["packages"]
        .as_array()
        .unwrap()
        .iter()
        .flat_map(|p| p["dependencies"].as_array().unwrap())
        .find_map(|dep| (dep["name"] == "opentui").then(|| dep["path"].as_str()).flatten())
        .expect("a workspace member takes opentui by path");
    let root = Path::new(path).parent().and_then(Path::parent).expect("opentui is at <checkout>/crates/opentui");
    format!("path+file://{}/", root.display())
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
