//! Event names that client code matches as raw strings, outside the typed [`V2Event`]: ACP's translation, the
//! TUI's event table and plugins, mini, and the example plugins. If the protocol renames an event, such code still
//! compiles and its handler goes quiet. This test reads those sources and requires every name it finds in an
//! event position (a match arm, a comparison, or an `on_event` list) to be a member of the generated union.

use std::path::{Path, PathBuf};

use opencode_api_types::types::V2Event;

const SOURCES: &[&str] =
    &["acp/src", "mini/src", "tui/src/features/events.rs", "tui/src/plugins", "plugin/examples", "plugin-abi/src"];

/// Dotted names in the same positions that are session error types (`error.type`), not events. TS keeps them as
/// plain strings too, so there is no generated list to check them against.
const ERROR_TYPES: &[&str] =
    &["compaction.interrupted", "provider.auth", "provider.content-filter", "provider.free-limit", "provider.go-limit"];

#[test]
fn every_raw_event_name_is_in_the_generated_union() {
    let crates = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    let mut names: Vec<(String, String)> = SOURCES
        .iter()
        .flat_map(|source| rust_files(&crates.join(source)))
        .flat_map(|file| {
            let text = std::fs::read_to_string(&file).unwrap();
            // Tests may send names that do not exist on purpose; only shipped code counts.
            let shipped = text.split("#[cfg(test)]").next().unwrap_or_default().to_owned();
            let at = file.strip_prefix(&crates).unwrap().display().to_string();
            event_names(&shipped).into_iter().map(move |name| (at.clone(), name))
        })
        .collect();
    names.sort();
    names.dedup();
    assert!(names.len() > 30, "the scan found only {} names: {names:?}", names.len());
    let unknown: Vec<_> =
        names.iter().filter(|(_, name)| !known(name) && !ERROR_TYPES.contains(&name.as_str())).collect();
    assert!(unknown.is_empty(), "event names outside the generated union: {unknown:?}");
}

/// Whether `name` decodes to a member of the union: an unknown type decodes to `Unknown`, a known one with no
/// payload fails or decodes to its variant.
fn known(name: &str) -> bool {
    !matches!(serde_json::from_value(serde_json::json!({ "type": name })), Ok(V2Event::Unknown(_)))
}

fn rust_files(path: &Path) -> Vec<PathBuf> {
    if path.is_file() {
        return vec![path.to_path_buf()];
    }
    let mut entries: Vec<_> = std::fs::read_dir(path).unwrap().map(|entry| entry.unwrap().path()).collect();
    entries.sort();
    entries
        .into_iter()
        .filter(|path| !path.ends_with("tests") && !path.ends_with("tests.rs") && !path.ends_with("target"))
        .flat_map(|path| if path.is_dir() { rust_files(&path) } else { vec![path] })
        .filter(|path| path.extension().is_some_and(|extension| extension == "rs"))
        .collect()
}

/// The dotted string literals in an event position: before `=>` or `|`, after `|`, `==` or `!=`, or anywhere on a
/// line that calls `on_event`.
fn event_names(text: &str) -> Vec<String> {
    text.lines()
        .flat_map(|line| {
            let parts: Vec<&str> = line.split('"').collect();
            let on_event = line.contains("on_event(");
            (1..parts.len().saturating_sub(1))
                .step_by(2)
                .filter(|&index| {
                    let before = parts[index - 1].trim_end();
                    let after = parts[index + 1].trim_start();
                    on_event
                        || after.starts_with("=>")
                        || after.starts_with('|')
                        || before.ends_with('|')
                        || before.ends_with("==")
                        || before.ends_with("!=")
                })
                .map(|index| parts[index])
                .filter(|name| is_event_name(name))
                .map(str::to_owned)
                .collect::<Vec<_>>()
        })
        .collect()
}

fn is_event_name(text: &str) -> bool {
    let mut segments = text.split('.');
    let shaped =
        |segment: &str| !segment.is_empty() && segment.chars().all(|c| c.is_ascii_lowercase() || c == '-' || c == '_');
    segments.clone().count() >= 2 && segments.all(shaped)
}
