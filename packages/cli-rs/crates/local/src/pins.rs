//! Pinned sessions in `<state>/session.json`, shared with the TypeScript TUI (`context/local.tsx:508-603`).
//!
//! TypeScript reads the file once and writes its whole list with `writeJsonAtomic`. Here every change
//! runs under the `Flock` lock in `<state>/locks` with the file path as the key, reads the file again,
//! and applies only its own pin or unpin, so pins another client wrote since survive. Other fields of
//! the file survive too.

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::{Map, Value};

use crate::lock;
use crate::storage::write_json_atomic;

pub fn file(state: &Path) -> PathBuf {
    state.join("session.json")
}

/// The pinned session IDs, oldest pin first; none when the file is missing or broken.
pub fn load(state: &Path) -> Vec<String> {
    pinned(&read(&file(state)))
}

/// Adds `id` at the end, or with `pinned: false` removes it, and returns the list written.
pub fn set(state: &Path, id: &str, pinned: bool) -> Result<Vec<String>, lock::Error> {
    let file = file(state);
    lock::with_lock(
        &state.join("locks"),
        &file.to_string_lossy(),
        &lock::Options::default(),
        || {
            let mut document = read(&file);
            let mut list = self::pinned(&document);
            let present = list.iter().any(|pin| pin == id);
            if present == pinned {
                return Ok(list);
            }
            if pinned {
                list.push(id.to_owned());
            } else {
                list.retain(|pin| pin != id);
            }
            document.insert(
                "pinned".into(),
                Value::Array(list.iter().cloned().map(Value::String).collect()),
            );
            write_json_atomic(&file, &Value::Object(document))?;
            Ok(list)
        },
    )?
    .map_err(lock::Error::Io)
}

fn read(file: &Path) -> Map<String, Value> {
    fs::read_to_string(file)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .and_then(|value| match value {
            Value::Object(map) => Some(map),
            _ => None,
        })
        .unwrap_or_default()
}

fn pinned(document: &Map<String, Value>) -> Vec<String> {
    document
        .get("pinned")
        .and_then(Value::as_array)
        .map(|pinned| {
            pinned
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn changes_keep_pins_and_fields_written_since() {
        let state = tempfile::tempdir().unwrap();
        assert_eq!(set(state.path(), "a", true).unwrap(), ["a"]);
        // Another client pins `b` and adds a field after this one read the file.
        fs::write(file(state.path()), r#"{"pinned":["a","b"],"other":1}"#).unwrap();
        assert_eq!(set(state.path(), "c", true).unwrap(), ["a", "b", "c"]);
        assert_eq!(set(state.path(), "a", false).unwrap(), ["b", "c"]);
        assert_eq!(set(state.path(), "a", false).unwrap(), ["b", "c"]);
        assert_eq!(
            fs::read_to_string(file(state.path())).unwrap(),
            r#"{"pinned":["b","c"],"other":1}"#
        );
        assert_eq!(load(state.path()), ["b", "c"]);
        let leftovers: Vec<_> = fs::read_dir(state.path())
            .unwrap()
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty());
    }

    #[test]
    fn concurrent_changes_lose_nothing() {
        let state = tempfile::tempdir().unwrap();
        let threads: Vec<_> = (0..4)
            .map(|n| {
                let state = state.path().to_owned();
                std::thread::spawn(move || {
                    for i in 0..5 {
                        set(&state, &format!("{n}-{i}"), true).unwrap();
                    }
                })
            })
            .collect();
        for thread in threads {
            thread.join().unwrap();
        }
        assert_eq!(load(state.path()).len(), 20);
    }
}
