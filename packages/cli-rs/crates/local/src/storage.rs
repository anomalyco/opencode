//! TUI storage shared with the TypeScript TUI (F.5, row L05).
//!
//! Ports `createStorage` from `packages/tui/src/context/storage.tsx`. Key `k` lives in
//! `<state>/<channel>/tui/<k>.json`; updates run under the `Flock` lock in `<state>/<channel>/locks`
//! with the file path as the key, read the file again, and write it atomically. Values are
//! `serde_json::Value`, so fields the other client wrote survive a write.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::jsonc;
use crate::lock;
use crate::watch::{self, Watch};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Invalid storage segment: {0}")]
    Segment(String),
    #[error("Storage values must be objects")]
    NotObject,
    #[error(transparent)]
    Lock(#[from] lock::Error),
    #[error(transparent)]
    Io(#[from] io::Error),
}

/// The storage of one storage channel (`channels.storage`).
#[derive(Clone, Debug)]
pub struct Storage {
    directory: PathBuf,
    locks: PathBuf,
    lock: lock::Options,
}

impl Storage {
    /// Opens `<state>/<channel>/tui`, creating it as TypeScript does.
    pub fn new(state: &Path, channel: &str) -> Result<Self, Error> {
        let root = state.join(segment(channel)?);
        let directory = root.join("tui");
        fs::create_dir_all(&directory)?;
        Ok(Self {
            directory,
            locks: root.join("locks"),
            lock: lock::Options::default(),
        })
    }

    pub fn directory(&self) -> &Path {
        &self.directory
    }

    pub fn file(&self, key: &str) -> Result<PathBuf, Error> {
        Ok(self.directory.join(format!("{}.json", segment(key)?)))
    }

    /// The stored value of `key`, or `initial` when the file is missing, broken, or not an object.
    pub fn load(&self, key: &str, initial: &Value) -> Result<Value, Error> {
        let file = self.file(key)?;
        Ok(read(&file).unwrap_or_else(|| initial.clone()))
    }

    /// Changes `key` under the lock and returns the value written.
    pub fn update(
        &self,
        key: &str,
        initial: &Value,
        change: impl FnOnce(&mut Value),
    ) -> Result<Value, Error> {
        let file = self.file(key)?;
        lock::with_lock(&self.locks, &file.to_string_lossy(), &self.lock, || {
            let mut draft = read(&file).unwrap_or_else(|| initial.clone());
            change(&mut draft);
            if !is_object(&draft) {
                return Err(Error::NotObject);
            }
            write_json_atomic(&file, &draft)?;
            Ok(draft)
        })?
    }

    /// Calls `on_change` after the storage directory changes, debounced by 50 ms; callers reload the
    /// keys they hold.
    pub fn watch(&self, on_change: impl FnMut() + Send + 'static) -> Option<Watch> {
        watch::watch(&self.directory, |_| true, watch::DEBOUNCE, on_change)
    }
}

fn read(file: &Path) -> Option<Value> {
    let value: Value = serde_json::from_str(&fs::read_to_string(file).ok()?).ok()?;
    is_object(&value).then_some(value)
}

// `typeof value === "object" && value !== null`: arrays count.
fn is_object(value: &Value) -> bool {
    value.is_object() || value.is_array()
}

fn segment(value: &str) -> Result<&str, Error> {
    let mut chars = value.chars();
    let valid = chars.next().is_some_and(|c| c.is_ascii_alphanumeric())
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
    if valid {
        Ok(value)
    } else {
        Err(Error::Segment(value.to_string()))
    }
}

/// `writeJsonAtomic`: compact `JSON.stringify` to `<file>.<pid>.<uuid>.tmp`, then a rename. The
/// temporary file is removed when either step fails.
pub fn write_json_atomic(file: &Path, value: &Value) -> io::Result<()> {
    write_text_atomic(file, &jsonc::stringify(value), || true).map(|_| ())
}

/// Writes `text` to `<file>.<pid>.<uuid>.tmp` and renames it over `file` when `ready()` still holds
/// once the temporary file is written. Returns whether it renamed; the temporary file never
/// outlives the call.
pub fn write_text_atomic(
    file: &Path,
    text: &str,
    ready: impl FnOnce() -> bool,
) -> io::Result<bool> {
    if let Some(dir) = file.parent() {
        fs::create_dir_all(dir)?;
    }
    let temp = PathBuf::from(format!(
        "{}.{}.{}.tmp",
        file.display(),
        std::process::id(),
        uuid::Uuid::new_v4()
    ));
    let result = fs::write(&temp, text).and_then(|()| {
        if !ready() {
            return Ok(false);
        }
        fs::rename(&temp, file).map(|()| true)
    });
    if !matches!(result, Ok(true)) {
        let _ = fs::remove_file(&temp);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn load_update_and_reject_bad_keys() {
        let state = tempfile::tempdir().unwrap();
        let storage = Storage::new(state.path(), "dev").unwrap();
        let initial = json!({"open": true});
        assert_eq!(storage.load("view", &initial).unwrap(), initial);
        let file = storage.file("view").unwrap();
        assert_eq!(file, state.path().join("dev/tui/view.json"));
        fs::write(&file, "{\"open\":false,\"other\":1}").unwrap();
        let next = storage
            .update("view", &initial, |value| value["open"] = json!(true))
            .unwrap();
        assert_eq!(next, json!({"open": true, "other": 1}));
        assert_eq!(
            fs::read_to_string(&file).unwrap(),
            "{\"open\":true,\"other\":1}"
        );
        fs::write(&file, "5").unwrap();
        assert_eq!(storage.load("view", &initial).unwrap(), initial);
        assert!(matches!(storage.file("../x"), Err(Error::Segment(_))));
        assert!(matches!(storage.file(".x"), Err(Error::Segment(_))));
        assert!(storage.file("plugin.sidebar.view").is_ok());
        assert!(matches!(
            storage.update("view", &initial, |value| *value = json!(1)),
            Err(Error::NotObject)
        ));
    }
}
