//! The public SDK alone (O-67): the quick start, a plugin author's fixture and the three ports under
//! `crates/plugin/examples` build on this crate and pull in no OpenTUI and no crate of the TUI.

use std::path::Path;
use std::process::Command;

/// The quick start, the author's fixture, then the ports.
const PLUGINS: [&str; 5] = ["hello", "author", "subagents-sidebar", "force-input", "session-usage"];
/// What a plugin on the SDK never depends on.
const INTERNAL: [&str; 4] = ["opentui", "opentui-sys", "opencode-ui", "opencode-tui"];

#[test]
fn plugins_on_the_sdk_pull_in_no_tui() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    let examples = root.join("plugin/examples");
    for fixture in ["hello", "author"] {
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

// Expected (big-boi 14, carbon-4): the pinned author crate, written against the 2.0 SDK, builds as a crate outside the
// workspace on this SDK, and on what a later 2.x adds (the `next` feature: a node kind and an event kind more), so the
// 2.x source promise holds for a plugin with two mounts, a key, a layout, released content, a worker and a wildcard.
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

// Expected (O-125): the 1.x form `export_plugin!(id, setup, requires_minor = N)` keeps building ABI 1.x (the loader's
// `version` tests read its table), and warns in the plugin's own crate, naming the 2.x form. The sample's source is a
// 1.x plugin's, unchanged, whose `fetch` and `foreground` keep their 1.x `RequestId` (O-154): it builds, and the
// warnings name the 2.x `try_fetch` and `try_foreground`.
#[test]
fn the_legacy_requires_minor_form_warns_with_the_2x_form() {
    let crate_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let output = cargo()
        .args(["check", "--locked", "--features", "requires-1-5", "--manifest-path"])
        .arg(crate_dir.join("../plugin/examples/sample/Cargo.toml"))
        .arg("--target-dir")
        .arg(crate_dir.join("../../target/sample-plugin"))
        .output()
        .unwrap();
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(output.status.success(), "{stderr}");
    let warned = stderr.contains("use of deprecated function `opencode_plugin_abi::runtime::legacy::requires_minor`")
        && stderr.contains("`plugin!(id = id, requires_minor = N, setup)`");
    assert!(warned, "no deprecation of the 1.x form:\n{stderr}");
    for (method, instead) in [("fetch", "`try_fetch`"), ("foreground", "`try_foreground`")] {
        let warned = stderr.contains(&format!("use of deprecated method `opencode_plugin_abi::Host::{method}`"))
            && stderr.contains(instead);
        assert!(warned, "the 1.x `{method}` does not build as 1.x's:\n{stderr}");
    }
}

// Expected: the README's quick start shows `examples/hello` as it is, so what an author copies is what the tests build
// and load (`the_quick_start_plugin_loads_from_a_plugins_directory_and_runs` in `opencode-plugin`).
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

fn cargo() -> Command {
    Command::new(std::env::var("CARGO").unwrap_or_else(|_| "cargo".to_owned()))
}
