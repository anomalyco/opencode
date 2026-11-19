//! The public SDK alone: the quick start and a plugin author's fixture under `crates/plugin/examples` build on this
//! crate and pull in no OpenTUI and no crate of the TUI.

use std::path::Path;
use std::process::Command;

/// The quick start and the author's fixture.
const PLUGINS: [&str; 2] = ["hello", "author"];
/// What a plugin on the SDK never depends on.
const INTERNAL: [&str; 4] = ["anomalyco-opentui", "anomalyco-opentui-sys", "opencode-ui", "opencode-tui"];

#[test]
fn plugins_on_the_sdk_pull_in_no_tui() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    let examples = root.join("plugin/examples");
    for fixture in PLUGINS {
        let check = cargo()
            .args(["check", "--quiet", "--locked", "--manifest-path"])
            .arg(examples.join(fixture).join("Cargo.toml"))
            .arg("--target-dir")
            .arg(root.join("../target/sample-plugin"))
            .status()
            .unwrap();
        assert!(check.success(), "{fixture} does not build on the SDK alone");
    }
    for plugin in PLUGINS {
        let output = cargo()
            .args(["tree", "--locked", "--edges", "normal,build", "--prefix", "none", "--format", "{p}"])
            .arg("--manifest-path")
            .arg(examples.join(plugin).join("Cargo.toml"))
            .output()
            .unwrap();
        assert!(output.status.success(), "cargo tree of {plugin}: {}", String::from_utf8_lossy(&output.stderr));
        let tree = String::from_utf8(output.stdout).unwrap();
        let names: Vec<&str> = tree.lines().filter_map(|line| line.split_whitespace().next()).collect();
        assert!(names.contains(&"opencode-plugin-abi"), "{plugin} is not on the SDK:\n{tree}");
        let internal: Vec<&&str> = names.iter().filter(|name| INTERNAL.contains(name)).collect();
        assert!(internal.is_empty(), "{plugin} pulls in {internal:?}");
    }
}

#[test]
fn a_pinned_plugin_builds_through_the_next_sdk() {
    let crate_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    for features in [None, Some("opencode-plugin-abi/next")] {
        let mut check = cargo();
        check.args(["check", "--quiet", "--locked", "--manifest-path"]).arg(crate_dir.join("tests/pinned/Cargo.toml"));
        check.arg("--target-dir").arg(crate_dir.join("../../target/sample-plugin"));
        check.args(features.map(|features| ["--features", features]).into_iter().flatten());
        assert!(check.status().unwrap().success(), "the pinned plugin does not build with {features:?}");
    }
}

#[test]
fn the_readme_quick_start_is_the_hello_example() {
    let crate_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let readme = std::fs::read_to_string(crate_dir.join("README.md")).unwrap();
    let hello = crate_dir.join("../plugin/examples/hello");
    let source = std::fs::read_to_string(hello.join("src/lib.rs")).unwrap();
    assert!(readme.contains(&source), "README.md does not show examples/hello/src/lib.rs as it is");
    // The manifest, but for the comments, the path dependency and `[workspace]`, which keep the example out of the
    // client's workspace.
    let manifest = std::fs::read_to_string(hello.join("Cargo.toml")).unwrap();
    let lines = manifest.lines().filter(|line| {
        !(line.is_empty() || line.starts_with('#') || line.starts_with("opencode-plugin-abi") || *line == "[workspace]")
    });
    for line in lines {
        assert!(readme.contains(line), "README.md does not show the line {line:?} of examples/hello/Cargo.toml");
    }
}

#[test]
fn the_guide_shows_its_examples_as_they_are() {
    let crate_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let guide = std::fs::read_to_string(crate_dir.join("../../docs/plugins.md")).unwrap();
    let examples = crate_dir.join("../plugin/examples");
    for file in ["hello/src/lib.rs", "luau/hello/init.luau", "luau/hello/plugin.toml", "pipe/hello/tui.tsx"] {
        let source = std::fs::read_to_string(examples.join(file)).unwrap();
        assert!(guide.contains(&source), "docs/plugins.md does not show examples/{file} as it is");
    }
    // The first example of the task module's documentation, without the lines rustdoc hides.
    let task = std::fs::read_to_string(crate_dir.join("src/task.rs")).unwrap();
    let example: Vec<&str> = task
        .lines()
        .skip_while(|line| *line != "//! ```")
        .skip(1)
        .take_while(|line| *line != "//! ```")
        .map(|line| line.strip_prefix("//! ").unwrap_or_default())
        .filter(|line| !line.starts_with("# "))
        .collect();
    assert!(example.len() > 10, "the task module's example is gone");
    assert!(guide.contains(&example.join("\n")), "docs/plugins.md does not show the task module's example as it is");
}

fn cargo() -> Command {
    Command::new(std::env::var("CARGO").unwrap_or_else(|_| "cargo".to_owned()))
}
