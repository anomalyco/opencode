//! Per-channel TUI storage. Reread values under the file lock before atomic replacement so unrelated fields survive.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use opencode_util::busy;
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
    #[error("A stored value of {0} bytes is past {1}")]
    TooLarge(usize, usize),
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
        Ok(Self { directory, locks: root.join("locks"), lock: lock::Options::default() })
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
    pub fn update(&self, key: &str, initial: &Value, change: impl FnOnce(&mut Value)) -> Result<Value, Error> {
        self.update_within(key, initial, usize::MAX, change)
    }

    /// [`Storage::update`] of a value that may be `bytes` long at most as it is written: the bound is checked on the
    /// value the change makes of what the file holds under the lock, so writers that each fit it alone cannot make a
    /// value past it together. Past it nothing is written.
    pub fn update_within(
        &self,
        key: &str,
        initial: &Value,
        bytes: usize,
        change: impl FnOnce(&mut Value),
    ) -> Result<Value, Error> {
        let file = self.file(key)?;
        lock::with_lock(&self.locks, &file.to_string_lossy(), &self.lock, || {
            let mut draft = read(&file).unwrap_or_else(|| initial.clone());
            change(&mut draft);
            if !is_object(&draft) {
                return Err(Error::NotObject);
            }
            let text = jsonc::stringify(&draft);
            if text.len() > bytes {
                return Err(Error::TooLarge(text.len(), bytes));
            }
            write_text_atomic(&file, &text)?;
            Ok(draft)
        })?
    }

    /// Removes `key` under the lock, so it reads as never stored.
    pub fn remove(&self, key: &str) -> Result<(), Error> {
        let file = self.file(key)?;
        lock::with_lock(&self.locks, &file.to_string_lossy(), &self.lock, || match fs::remove_file(&file) {
            Err(error) if error.kind() != io::ErrorKind::NotFound => Err(Error::Io(error)),
            _ => Ok(()),
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
    if valid { Ok(value) } else { Err(Error::Segment(value.to_string())) }
}

/// `writeJsonAtomic`: compact `JSON.stringify` to `<file>.<pid>.<uuid>.tmp`, then a rename, tried again while Windows
/// reports the file busy (another TUI reloading it). The temporary file is removed when either step fails.
pub fn write_json_atomic(file: &Path, value: &Value) -> io::Result<()> {
    write_text_atomic(file, &jsonc::stringify(value))
}

/// [`write_json_atomic`] for any text.
pub fn write_text_atomic(file: &Path, text: &str) -> io::Result<()> {
    if let Some(dir) = file.parent() {
        fs::create_dir_all(dir)?;
    }
    let temp = PathBuf::from(format!("{}.{}.{}.tmp", file.display(), std::process::id(), crate::id::v4()));
    fs::write(&temp, text).and_then(|()| busy::rename(&temp, file)).inspect_err(|_| {
        let _ = fs::remove_file(&temp);
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn load_update_and_reject_bad_keys() {
        let state = opencode_util::temp::tempdir().unwrap();
        let storage = Storage::new(state.path(), "dev").unwrap();
        let initial = json!({"open": true});
        assert_eq!(storage.load("view", &initial).unwrap(), initial);
        let file = storage.file("view").unwrap();
        assert_eq!(file, state.path().join("dev/tui/view.json"));
        fs::write(&file, "{\"open\":false,\"other\":1}").unwrap();
        let next = storage.update("view", &initial, |value| value["open"] = json!(true)).unwrap();
        assert_eq!(next, json!({"open": true, "other": 1}));
        assert_eq!(fs::read_to_string(&file).unwrap(), "{\"open\":true,\"other\":1}");
        fs::write(&file, "5").unwrap();
        assert_eq!(storage.load("view", &initial).unwrap(), initial);
        assert!(matches!(storage.file("../x"), Err(Error::Segment(_))));
        assert!(matches!(storage.file(".x"), Err(Error::Segment(_))));
        assert!(storage.file("plugin.sidebar.view").is_ok());
        assert!(matches!(storage.update("view", &initial, |value| *value = json!(1)), Err(Error::NotObject)));
    }

    // Two TUIs share a storage key: every update is read and written under the lock, so none is lost, and none meets
    // a release that is deleting another writer's lock directory.
    #[test]
    fn concurrent_updates_keep_every_change() {
        let state = opencode_util::temp::tempdir().unwrap();
        let storage = Storage::new(state.path(), "dev").unwrap();
        let threads: Vec<_> = (0..4)
            .map(|_| {
                let storage = storage.clone();
                std::thread::spawn(move || {
                    for _ in 0..10 {
                        storage
                            .update("count", &json!({ "count": 0 }), |value| {
                                value["count"] = json!(value["count"].as_u64().unwrap_or_default() + 1);
                            })
                            .unwrap();
                    }
                })
            })
            .collect();
        for thread in threads {
            thread.join().unwrap();
        }
        assert_eq!(storage.load("count", &json!({})).unwrap(), json!({ "count": 40 }));
    }

    // One TUI replaces a key while others reload it (#64875). A reader holds the file open as it reads, on Windows
    // without delete sharing as Bun does, so a rename onto it answers "Access is denied" until the reader closes it and
    // the write tries again. Every write lands, every read sees a whole value no older than the one before, and no
    // temporary file stays behind.
    #[test]
    fn writers_replace_a_key_other_tuis_are_reading() {
        use std::io::Read;
        use std::sync::Arc;
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::time::Duration;

        let state = opencode_util::temp::tempdir().unwrap();
        let storage = Storage::new(state.path(), "dev").unwrap();
        storage.update("count", &json!({ "count": 0 }), |_| ()).unwrap();
        let file = storage.file("count").unwrap();
        let done = Arc::new(AtomicBool::new(false));
        let readers: Vec<_> = (0..2)
            .map(|_| {
                let (file, done) = (file.clone(), done.clone());
                std::thread::spawn(move || {
                    let (mut reads, mut last) = (0, 0);
                    while !done.load(Ordering::SeqCst) {
                        let mut options = fs::OpenOptions::new();
                        options.read(true);
                        // FILE_SHARE_READ | FILE_SHARE_WRITE: no FILE_SHARE_DELETE, so a rename onto it is refused.
                        #[cfg(windows)]
                        std::os::windows::fs::OpenOptionsExt::share_mode(&mut options, 0x1 | 0x2);
                        let mut handle = match options.open(&file) {
                            Err(error) if busy::busy(&error) => continue,
                            handle => handle.unwrap(),
                        };
                        let mut text = String::new();
                        handle.read_to_string(&mut text).unwrap();
                        std::thread::sleep(Duration::from_millis(1));
                        drop(handle);
                        let count = serde_json::from_str::<Value>(&text).unwrap()["count"].as_u64().unwrap();
                        assert!(count >= last, "read {count} after {last}");
                        (reads, last) = (reads + 1, count);
                        std::thread::sleep(Duration::from_millis(3));
                    }
                    reads
                })
            })
            .collect();
        let writers: Vec<_> = (0..2)
            .map(|_| {
                let storage = storage.clone();
                std::thread::spawn(move || {
                    for _ in 0..25 {
                        storage
                            .update("count", &json!({}), |value| {
                                value["count"] = json!(value["count"].as_u64().unwrap() + 1);
                            })
                            .unwrap();
                    }
                })
            })
            .collect();
        for writer in writers {
            writer.join().unwrap();
        }
        done.store(true, Ordering::SeqCst);
        for reader in readers {
            assert!(reader.join().unwrap() > 0);
        }
        assert_eq!(storage.load("count", &json!({})).unwrap(), json!({ "count": 50 }));
        let left: Vec<_> = fs::read_dir(storage.directory()).unwrap().map(|entry| entry.unwrap().file_name()).collect();
        assert_eq!(left, ["count.json"]);
    }

    // Expected (re-review final pass, the storage bound): a bounded update is measured on what the change makes of the
    // file's value under the lock: a change that fits alone is refused when the file grew meanwhile, and nothing is
    // written; one within the bound is written as `update` writes it.
    #[test]
    fn a_bounded_update_measures_the_locked_value() {
        let state = opencode_util::temp::tempdir().unwrap();
        let storage = Storage::new(state.path(), "dev").unwrap();
        let add = |name: &str| {
            let name = name.to_owned();
            move |value: &mut Value| value[name] = json!("x".repeat(60))
        };
        let first = storage.update_within("k", &json!({}), 100, add("a")).unwrap();
        assert_eq!(fs::read_to_string(storage.file("k").unwrap()).unwrap(), jsonc::stringify(&first));
        let refused = storage.update_within("k", &json!({}), 100, add("b"));
        assert!(matches!(refused, Err(Error::TooLarge(len, 100)) if len > 100), "{refused:?}");
        assert_eq!(storage.load("k", &json!({})).unwrap(), first, "a refused update wrote");
    }
}
