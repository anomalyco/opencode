//! JSONL files in the state directory (F.5, row L06): `prompt-history.jsonl`, `prompt-stash.jsonl`, and
//! `frecency.jsonl`.
//!
//! Ports the three TypeScript providers (`packages/tui/src/prompt/{history,stash,frecency}.tsx`): their
//! parse and limit rules, the rewrite on load that heals a broken file, appends, and the full rewrites
//! after a trim. Full rewrites are atomic. The history, which both TUIs append to, is written under its
//! lock from what the file holds, and only its load rewrites it. Write failures are ignored, as in TypeScript. Prompt
//! entries stay `serde_json::Value`, so fields this client does not know survive.

use std::fs;
use std::io::{self, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use indexmap::IndexMap;
use serde_json::{Map, Value, json};

use crate::jsonc;
use crate::lock;
use crate::storage::write_text_atomic;

pub const MAX_HISTORY_ENTRIES: usize = 50;
pub const MAX_STASH_ENTRIES: usize = 50;
pub const MAX_FRECENCY_ENTRIES: usize = 1000;

/// `Date.now()`.
pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as i64)
}

/// `emptyPrompt()`.
pub fn empty_prompt() -> Value {
    json!({"text": "", "files": [], "agents": [], "skills": [], "pasted": []})
}

/// `parsePromptInfo`: an object with a string `text` and an array `pasted`.
pub fn is_prompt(value: &Value) -> bool {
    value.get("text").is_some_and(Value::is_string)
        && value.get("pasted").is_some_and(Value::is_array)
}

fn lines(text: &str) -> impl Iterator<Item = Value> + '_ {
    text.split('\n')
        .filter(|line| !line.is_empty())
        .filter_map(|line| serde_json::from_str(line).ok())
}

fn last<T>(mut items: Vec<T>, limit: usize) -> Vec<T> {
    let excess = items.len().saturating_sub(limit);
    items.drain(..excess);
    items
}

fn body<'a>(entries: impl Iterator<Item = &'a Value>) -> String {
    entries
        .map(|entry| jsonc::stringify(entry) + "\n")
        .collect()
}

// A full rewrite, atomic so a concurrent reader never sees a partial file.
fn write_text(file: &Path, text: &str) {
    let _ = write_text_atomic(file, text);
}

fn append_text(file: &Path, text: &str) {
    let append = || -> io::Result<()> {
        if let Some(dir) = file.parent() {
            fs::create_dir_all(dir)?;
        }
        fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(file)?
            .write_all(text.as_bytes())
    };
    let _ = append();
}

/// `parsePromptHistory`.
pub fn parse_history(text: &str) -> Vec<Value> {
    last(lines(text).filter(is_prompt).collect(), MAX_HISTORY_ENTRIES)
}

/// `usePromptHistory`: the prompt history and its cursor, in memory. [`save_history`] writes an
/// entry to the file.
#[derive(Debug, Default)]
pub struct History {
    entries: Vec<Value>,
    index: i64,
}

impl History {
    /// Loads `<state>/prompt-history.jsonl` and, under the lock, rewrites it with its valid, retained
    /// entries when that changes it.
    pub fn load(state: &Path) -> Self {
        let file = history_file(state);
        let healed = with_lock(state, &file, || {
            rewrite(&file, |text| {
                let entries = parse_history(text);
                let healed = body(entries.iter());
                (!entries.is_empty() && healed != text).then_some(healed)
            })
        });
        if let Err(error) = healed {
            log::warn!("prompt-history.jsonl: {error}");
        }
        Self {
            entries: parse_history(&fs::read_to_string(&file).unwrap_or_default()),
            index: 0,
        }
    }

    pub fn entries(&self) -> &[Value] {
        &self.entries
    }

    /// `move(direction, input)`: the entry to show, the empty prompt when back at the end, or `None`
    /// when the cursor does not move.
    pub fn step(&mut self, direction: i64, input: &str) -> Option<Value> {
        let current = at(&self.entries, self.index)?;
        if current.get("text").and_then(Value::as_str) != Some(input) && !input.is_empty() {
            return None;
        }
        let next = self.index + direction;
        if next.unsigned_abs() as usize > self.entries.len() || next > 0 {
            return None;
        }
        self.index = next;
        if next == 0 {
            return Some(empty_prompt());
        }
        at(&self.entries, next).cloned()
    }

    /// `append(item)` in memory: skips a repeat of the last entry, trims to the limit, and resets the
    /// cursor. Returns whether the entry is new, so the caller saves it.
    pub fn append(&mut self, entry: Value) -> bool {
        self.index = 0;
        if self
            .entries
            .last()
            .is_some_and(|previous| jsonc::stringify(previous) == jsonc::stringify(&entry))
        {
            return false;
        }
        self.entries.push(entry);
        self.entries = last(std::mem::take(&mut self.entries), MAX_HISTORY_ENTRIES);
        true
    }
}

/// `append(item)`'s write, under the `Flock` lock in `<state>/locks`: skips a repeat of the file's last
/// entry, else appends the line. It never rewrites the file, because the TypeScript TUI appends without
/// the lock and a rename can drop a line it is writing; [`History::load`] trims the file instead.
pub fn save_history(state: &Path, entry: &Value) -> Result<(), lock::Error> {
    let file = history_file(state);
    let line = jsonc::stringify(entry);
    with_lock(state, &file, || {
        let text = fs::read_to_string(&file).unwrap_or_default();
        let repeat = lines(&text)
            .filter(is_prompt)
            .last()
            .is_some_and(|previous| jsonc::stringify(&previous) == line);
        if !repeat {
            append_text(&file, &(line.clone() + "\n"));
        }
        Ok(())
    })
}

fn history_file(state: &Path) -> PathBuf {
    state.join("prompt-history.jsonl")
}

fn with_lock(
    state: &Path,
    file: &Path,
    f: impl FnOnce() -> io::Result<()>,
) -> Result<(), lock::Error> {
    lock::with_lock(
        &state.join("locks"),
        &file.to_string_lossy(),
        &lock::Options::default(),
        f,
    )?
    .map_err(lock::Error::Io)
}

// Rewrites `file` atomically with `change(text)` when that gives a new text. A client that appends
// without the lock (the TypeScript TUI) may write to the file the rename replaces; the old file stays
// open, so the lines it gained are carried over to the end of the new one.
fn rewrite(file: &Path, change: impl FnOnce(&str) -> Option<String>) -> io::Result<()> {
    let mut old = match fs::File::open(file) {
        Ok(old) => Some(old),
        Err(error) if error.kind() == io::ErrorKind::NotFound => None,
        Err(error) => return Err(error),
    };
    let mut bytes = Vec::new();
    if let Some(old) = old.as_mut() {
        old.read_to_end(&mut bytes)?;
    }
    let Some(next) = change(&String::from_utf8_lossy(&bytes)) else {
        return Ok(());
    };
    write_text_atomic(file, &next)?;
    let mut late = Vec::new();
    if let Some(old) = old.as_mut() {
        old.read_to_end(&mut late)?;
    }
    if !late.is_empty() {
        append_text(file, &String::from_utf8_lossy(&late));
    }
    Ok(())
}

// `Array.prototype.at`.
fn at(items: &[Value], index: i64) -> Option<&Value> {
    let index = if index < 0 {
        items.len().checked_sub(index.unsigned_abs() as usize)?
    } else {
        index as usize
    };
    items.get(index)
}

/// `parsePromptStash`: entries rebuilt as `{prompt, timestamp}`.
pub fn parse_stash(text: &str) -> Vec<Value> {
    let entries = lines(text)
        .filter_map(|entry| {
            let prompt = entry.get("prompt").filter(|p| is_prompt(p))?;
            let timestamp = entry.get("timestamp").filter(|t| t.is_number())?;
            Some(json!({"prompt": prompt, "timestamp": timestamp}))
        })
        .collect();
    last(entries, MAX_STASH_ENTRIES)
}

/// `usePromptStash`.
#[derive(Debug)]
pub struct Stash {
    file: PathBuf,
    entries: Vec<Value>,
}

impl Stash {
    /// Loads `<state>/prompt-stash.jsonl` and rewrites its valid, retained entries.
    pub fn load(state: &Path) -> Self {
        let file = state.join("prompt-stash.jsonl");
        let entries = parse_stash(&fs::read_to_string(&file).unwrap_or_default());
        if !entries.is_empty() {
            write_text(&file, &body(entries.iter()));
        }
        Self { file, entries }
    }

    pub fn list(&self) -> &[Value] {
        &self.entries
    }

    /// `push({prompt})` with the time `now` in milliseconds.
    pub fn push(&mut self, prompt: Value, now: i64) {
        let entry = json!({"prompt": prompt, "timestamp": now});
        let line = jsonc::stringify(&entry) + "\n";
        self.entries.push(entry);
        if self.entries.len() > MAX_STASH_ENTRIES {
            self.entries = last(std::mem::take(&mut self.entries), MAX_STASH_ENTRIES);
            self.rewrite();
            return;
        }
        append_text(&self.file, &line);
    }

    pub fn pop(&mut self) -> Option<Value> {
        let entry = self.entries.pop()?;
        self.rewrite();
        Some(entry)
    }

    pub fn remove(&mut self, index: usize) {
        if index >= self.entries.len() {
            return;
        }
        self.entries.remove(index);
        self.rewrite();
    }

    fn rewrite(&self) {
        write_text(&self.file, &body(self.entries.iter()));
    }
}

/// One `frecency.jsonl` entry.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Visit {
    pub frequency: f64,
    pub last_open: f64,
}

/// `parseFrecency`: the latest line per path, newest first, at most 1000. Lines are kept as written.
pub fn parse_frecency(text: &str) -> Vec<Value> {
    let mut latest: IndexMap<String, Value> = IndexMap::new();
    for entry in lines(text) {
        if let Some(path) = entry.get("path").and_then(Value::as_str) {
            latest.insert(path.to_string(), entry);
        }
    }
    let mut entries: Vec<Value> = latest.into_values().collect();
    entries.sort_by(|a, b| last_open(b).total_cmp(&last_open(a)));
    entries.truncate(MAX_FRECENCY_ENTRIES);
    entries
}

fn last_open(entry: &Value) -> f64 {
    entry
        .get("lastOpen")
        .and_then(Value::as_f64)
        .unwrap_or(f64::NAN)
}

/// `useFrecency`: how often and how recently files were opened, by absolute path.
#[derive(Debug)]
pub struct Frecency {
    file: PathBuf,
    cwd: PathBuf,
    data: IndexMap<String, Visit>,
}

impl Frecency {
    /// Loads `<state>/frecency.jsonl` and rewrites it with one line per path.
    pub fn load(state: &Path, cwd: &Path) -> Self {
        let file = state.join("frecency.jsonl");
        let entries = parse_frecency(&fs::read_to_string(&file).unwrap_or_default());
        if !entries.is_empty() {
            write_text(&file, &body(entries.iter()));
        }
        let data = entries
            .iter()
            .filter_map(|entry| {
                let visit = Visit {
                    frequency: entry.get("frequency")?.as_f64()?,
                    last_open: entry.get("lastOpen")?.as_f64()?,
                };
                Some((entry.get("path")?.as_str()?.to_string(), visit))
            })
            .collect();
        Self {
            file,
            cwd: cwd.to_path_buf(),
            data,
        }
    }

    pub fn data(&self) -> &IndexMap<String, Visit> {
        &self.data
    }

    /// `getFrecency(path)` at the time `now`.
    pub fn score(&self, path: &str, now: i64) -> f64 {
        self.data
            .get(&resolve(&self.cwd, path))
            .map_or(0.0, |visit| {
                visit.frequency / (1.0 + (now as f64 - visit.last_open) / 86_400_000.0)
            })
    }

    /// `updateFrecency(path)` at the time `now`.
    pub fn update(&mut self, path: &str, now: i64) {
        let path = resolve(&self.cwd, path);
        let visit = Visit {
            frequency: self.data.get(&path).map_or(0.0, |v| v.frequency) + 1.0,
            last_open: now as f64,
        };
        append_text(&self.file, &(line(&path, &visit) + "\n"));
        self.data.insert(path, visit);
        if self.data.len() <= MAX_FRECENCY_ENTRIES {
            return;
        }
        self.data
            .sort_by(|_, a, _, b| b.last_open.total_cmp(&a.last_open));
        self.data.truncate(MAX_FRECENCY_ENTRIES);
        let text: String = self
            .data
            .iter()
            .map(|(path, visit)| line(path, visit) + "\n")
            .collect();
        write_text(&self.file, &text);
    }
}

fn line(path: &str, visit: &Visit) -> String {
    let mut map = Map::new();
    map.insert("path".into(), Value::String(path.into()));
    map.insert("frequency".into(), jsonc::number(visit.frequency));
    map.insert("lastOpen".into(), jsonc::number(visit.last_open));
    jsonc::stringify(&Value::Object(map))
}

// `path.resolve(cwd, path)`: absolute and lexically normalized.
fn resolve(cwd: &Path, path: &str) -> String {
    let mut out = PathBuf::new();
    for component in cwd.join(path).components() {
        match component {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other),
        }
    }
    let text = out.to_string_lossy().into_owned();
    if text.is_empty() { "/".into() } else { text }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn prompt(text: &str) -> Value {
        json!({"text": text, "pasted": [], "extra": 1})
    }

    #[test]
    fn history_heals_appends_and_moves() {
        let state = tempfile::tempdir().unwrap();
        let file = state.path().join("prompt-history.jsonl");
        fs::write(
            &file,
            "{\"text\":\"a\",\"pasted\":[]}\nbroken\n{\"text\":1}\n",
        )
        .unwrap();
        let mut history = History::load(state.path());
        assert_eq!(
            fs::read_to_string(&file).unwrap(),
            "{\"text\":\"a\",\"pasted\":[]}\n"
        );
        assert!(history.append(prompt("b")));
        assert!(!history.append(prompt("b")));
        assert_eq!(history.entries().len(), 2);
        assert_eq!(history.step(-1, ""), Some(prompt("b")));
        assert_eq!(
            history.step(-1, "b"),
            Some(json!({"text": "a", "pasted": []}))
        );
        assert_eq!(history.step(-1, "a"), None);
        assert_eq!(history.step(1, "x"), None);
        assert_eq!(history.step(1, "a"), Some(prompt("b")));
        assert_eq!(history.step(1, "b"), Some(empty_prompt()));
        for index in 0..60 {
            history.append(prompt(&index.to_string()));
        }
        assert_eq!(history.entries().len(), MAX_HISTORY_ENTRIES);
    }

    #[test]
    fn saves_keep_lines_another_client_appended() {
        let state = tempfile::tempdir().unwrap();
        let file = state.path().join("prompt-history.jsonl");
        save_history(state.path(), &prompt("a")).unwrap();
        save_history(state.path(), &prompt("a")).unwrap();
        // The TypeScript TUI appends without the lock.
        append_text(&file, "{\"text\":\"ts\",\"pasted\":[]}\n");
        for index in 0..49 {
            save_history(state.path(), &prompt(&index.to_string())).unwrap();
        }
        let text = fs::read_to_string(&file).unwrap();
        assert_eq!(text.lines().count(), 51, "saves only append");
        // The load trims to the newest 50, and keeps the line TypeScript appended.
        let history = History::load(state.path());
        let text = fs::read_to_string(&file).unwrap();
        assert_eq!(text.lines().count(), MAX_HISTORY_ENTRIES);
        assert_eq!(history.entries()[0]["text"], "ts");
        assert_eq!(history.entries()[49]["text"], "48");
        // A load that changes nothing does not rewrite the file.
        let before = fs::metadata(&file).unwrap().modified().unwrap();
        History::load(state.path());
        assert_eq!(fs::metadata(&file).unwrap().modified().unwrap(), before);
    }

    #[test]
    fn stash_pushes_pops_and_removes() {
        let state = tempfile::tempdir().unwrap();
        let mut stash = Stash::load(state.path());
        stash.push(prompt("a"), 1);
        stash.push(prompt("b"), 2);
        let file = state.path().join("prompt-stash.jsonl");
        assert_eq!(
            fs::read_to_string(&file).unwrap(),
            "{\"prompt\":{\"text\":\"a\",\"pasted\":[],\"extra\":1},\"timestamp\":1}\n{\"prompt\":{\"text\":\"b\",\"pasted\":[],\"extra\":1},\"timestamp\":2}\n"
        );
        assert_eq!(stash.pop().unwrap()["timestamp"], 2);
        stash.remove(0);
        assert_eq!(fs::read_to_string(&file).unwrap(), "");
    }

    #[test]
    fn frecency_keeps_the_latest_line_per_path() {
        let state = tempfile::tempdir().unwrap();
        let file = state.path().join("frecency.jsonl");
        fs::write(
            &file,
            "{\"path\":\"/a\",\"frequency\":1,\"lastOpen\":10}\n{\"path\":\"/b\",\"frequency\":1,\"lastOpen\":20}\n{\"path\":\"/a\",\"frequency\":2,\"lastOpen\":30}\n",
        )
        .unwrap();
        let mut frecency = Frecency::load(state.path(), Path::new("/w"));
        assert_eq!(
            fs::read_to_string(&file).unwrap(),
            "{\"path\":\"/a\",\"frequency\":2,\"lastOpen\":30}\n{\"path\":\"/b\",\"frequency\":1,\"lastOpen\":20}\n"
        );
        frecency.update("../a", 86_400_030);
        assert_eq!(frecency.score("/a", 86_400_030), 3.0);
        assert_eq!(frecency.score("/w/../a", 172_800_030), 1.5);
        assert!(
            fs::read_to_string(&file)
                .unwrap()
                .ends_with("{\"path\":\"/a\",\"frequency\":3,\"lastOpen\":86400030}\n")
        );
    }
}
