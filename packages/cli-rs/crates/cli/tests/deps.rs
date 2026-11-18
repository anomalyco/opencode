//! Checks the target-specific dependency allowlist for binaries, tests and build tools, and the layers of the
//! workspace's own crates.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::process::Command;

use serde_json::Value;

const TARGET: &str = "x86_64-unknown-linux-gnu";
const ROOT: &str = "opencode-cli";
const SECTIONS: [&str; 2] = ["[tests]", "[optional]"];

/// OpenTUI's packages, first-party when they come from where the workspace takes OpenTUI.
const OPENTUI: [&str; 2] = ["opentui", "opentui-sys"];

type Graph = BTreeMap<String, BTreeSet<&'static str>>;

#[test]
fn allow_list_matches_the_graph() {
    let workspace = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let manifest = workspace.join("Cargo.toml");
    // Another host has not downloaded the crates only `TARGET` builds (`errno`, say), whose manifests the graph
    // reads: fetch them, online. Linux has them from its own build. `cargo metadata` also wants crates reached by a
    // host edge and then a `TARGET` edge (`notify`, then its Linux `inotify`), which `cargo fetch --target TARGET`
    // skips, so fetch every platform's.
    if !cfg!(target_os = "linux") {
        let status = Command::new(std::env::var_os("CARGO").unwrap_or_else(|| "cargo".into()))
            .args(["fetch", "--locked", "--manifest-path"])
            .arg(&manifest)
            .status()
            .expect("cargo runs");
        assert!(status.success(), "cargo fetch failed");
    }
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

/// The workspace's crates in layers, lowest first, each as (name without `opencode-`, the workspace crates it takes as
/// normal or build dependencies, the ones it takes only as dev-dependencies). A normal or build dependency is on a
/// lower layer, so the shipped graph has no cycle and an edit never rebuilds a crate beside or below it. The table is
/// the graph: a new crate or a new or removed edge changes it here, deliberately.
const LAYERS: [&[Crate]; 6] = [
    &[("api-types", &[], &[]), ("parity", &[], &[]), ("util", &[], &[])],
    &[
        ("api", &["api-types", "util"], &[]),
        ("drive", &["api-types", "util"], &[]),
        ("local", &["api-types", "util"], &[]),
        ("plugin-abi", &["api-types"], &[]),
    ],
    &[
        // Their tests draw through the plugin host above them: an upward dev edge, which ships nothing.
        ("latex", &["plugin-abi"], &["parity", "plugin", "ui"]),
        ("mermaid", &["plugin-abi"], &["parity", "plugin", "ui"]),
        ("service", &["api", "local", "util"], &[]),
        ("ui", &["api-types", "util"], &["parity"]),
    ],
    &[
        ("plugin", &["api-types", "plugin-abi", "ui", "util"], &["latex", "mermaid"]),
        ("store", &["api", "util"], &["local", "service"]),
    ],
    &[
        ("acp", &["api", "service", "util"], &[]),
        ("mini", &["api", "local", "store", "ui", "util"], &[]),
        (
            "tui",
            &["api", "drive", "local", "plugin", "store", "ui", "util"],
            &["latex", "mermaid", "parity", "plugin-abi"],
        ),
    ],
    &[(
        "cli",
        &["acp", "api", "latex", "local", "mermaid", "mini", "plugin", "service", "store", "tui", "ui", "util"],
        &[],
    )],
];

type Crate = (&'static str, &'static [&'static str], &'static [&'static str]);

#[test]
fn workspace_crates_depend_only_downward() {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../Cargo.toml");
    let metadata: Value = serde_json::from_str(&cargo(&manifest, &["metadata", "--format-version", "1", "--no-deps"]))
        .expect("cargo metadata prints JSON");
    let short = |name: &str| name.strip_prefix("opencode-").unwrap_or(name).to_owned();
    let members = metadata["packages"].as_array().unwrap();
    let names = members.iter().map(|p| short(p["name"].as_str().unwrap())).collect::<BTreeSet<_>>();
    let graph = members
        .iter()
        .map(|package| {
            let deps = |dev: bool| {
                package["dependencies"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .filter(|dep| (dep["kind"] == "dev") == dev)
                    .map(|dep| short(dep["name"].as_str().unwrap()))
                    .filter(|name| names.contains(name))
                    .collect::<BTreeSet<_>>()
            };
            let normal = deps(false);
            let dev = deps(true).difference(&normal).cloned().collect::<BTreeSet<_>>();
            (short(package["name"].as_str().unwrap()), (normal, dev))
        })
        .collect::<BTreeMap<_, _>>();
    let layer = LAYERS
        .iter()
        .enumerate()
        .flat_map(|(at, crates)| crates.iter().map(move |(name, _, _)| (name.to_string(), at)))
        .collect::<BTreeMap<_, _>>();

    let mut problems = Vec::new();
    if layer.len() != LAYERS.iter().map(|crates| crates.len()).sum::<usize>() {
        problems.push("  LAYERS lists a crate twice".to_owned());
    }
    for (at, crates) in LAYERS.iter().enumerate() {
        for (name, normal, dev) in crates.iter() {
            let up = normal.iter().filter(|dep| layer.get(**dep).is_none_or(|l| *l >= at)).collect::<Vec<_>>();
            if !up.is_empty() {
                problems.push(format!("  {name} (layer {at}) takes {up:?}, which are not on a lower layer"));
            }
            let Some((real_normal, real_dev)) = graph.get(*name) else {
                problems.push(format!("  {name} is in LAYERS but not in the workspace"));
                continue;
            };
            let listed = |deps: &[&str]| deps.iter().map(|dep| dep.to_string()).collect::<BTreeSet<_>>();
            for (kind, real, listed) in [("", real_normal, listed(normal)), ("dev-", real_dev, listed(dev))] {
                let added = real.difference(&listed).collect::<Vec<_>>();
                let removed = listed.difference(real).collect::<Vec<_>>();
                if !added.is_empty() {
                    problems.push(format!("  {name} has the {kind}dependencies {added:?}, which LAYERS does not list"));
                }
                if !removed.is_empty() {
                    problems
                        .push(format!("  {name} no longer has the {kind}dependencies {removed:?} that LAYERS lists"));
                }
            }
        }
    }
    for name in graph.keys().filter(|name| !layer.contains_key(*name)) {
        problems.push(format!("  {name} is a workspace crate without a layer"));
    }
    assert!(
        problems.is_empty(),
        "the workspace's crate graph does not match LAYERS in crates/cli/tests/deps.rs:\n{}\n\nA normal or build \
         dependency goes to a lower layer. Before adding an edge or moving a crate to another layer, check that the \
         crate below really needs nothing above it; for a removed edge, delete it from LAYERS.",
        problems.join("\n"),
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

/// The package ID prefix of OpenTUI's packages, from the workspace's `opentui` dependency: its git source and `rev`,
/// or, for a path, the directory above its `crates/opentui` (an OpenTUI worktree's `packages/rust`).
fn opentui_source(metadata: &Value) -> String {
    let dep = metadata["packages"]
        .as_array()
        .unwrap()
        .iter()
        .flat_map(|p| p["dependencies"].as_array().unwrap())
        .find(|dep| dep["name"] == "opentui")
        .expect("a workspace member takes opentui");
    if let Some(source) = dep["source"].as_str() {
        return format!("{source}#");
    }
    let path = dep["path"].as_str().expect("opentui comes from git or a path");
    let root = Path::new(path).parent().and_then(Path::parent).expect("opentui is at <root>/crates/opentui");
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
