//! The public SDK alone (O-67): a plugin author's fixture and the three ports under `crates/plugin/examples` build on
//! this crate and pull in no OpenTUI and no crate of the TUI.

use std::path::Path;
use std::process::Command;

/// The author's fixture, then the ports.
const PLUGINS: [&str; 4] = ["author", "subagents-sidebar", "force-input", "session-usage"];
/// What a plugin on the SDK never depends on.
const INTERNAL: [&str; 4] = ["opentui", "opentui-sys", "opencode-ui", "opencode-tui"];

#[test]
fn plugins_on_the_sdk_pull_in_no_tui() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    let examples = root.join("plugin/examples");
    let check = cargo()
        .args(["check", "--quiet", "--locked", "--manifest-path"])
        .arg(examples.join("author/Cargo.toml"))
        .arg("--target-dir")
        .arg(root.join("../target/sample-plugin"))
        .status()
        .unwrap();
    assert!(check.success(), "the author's fixture does not build on the SDK alone");
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

fn cargo() -> Command {
    Command::new(std::env::var("CARGO").unwrap_or_else(|_| "cargo".to_owned()))
}
