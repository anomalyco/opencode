//! The guide shows the SDK's examples as they are.

use std::path::Path;

#[test]
fn the_guide_shows_its_examples_as_they_are() {
    let crate_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let guide = std::fs::read_to_string(crate_dir.join("../../docs/plugins.md")).unwrap();
    let examples = crate_dir.join("../plugin/examples");
    for file in ["luau/hello/init.luau", "luau/hello/plugin.toml", "pipe/hello/tui.tsx"] {
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
