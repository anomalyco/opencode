//! JSONL files in the state directory (F.5, row L06): `prompt-history.jsonl`, `prompt-stash.jsonl`, and
//! `frecency.jsonl`.
//!
//! Ports the three TypeScript providers (`packages/tui/src/prompt/{history,stash,frecency}.tsx`): their
//! parse and limit rules, the rewrite on load that heals a broken file, appends, and the full rewrites
//! after a trim. Write failures are ignored, as in TypeScript. Prompt entries stay
//! `serde_json::Value`, so fields this client does not know survive.

use std::fs;
use std::io::{self, Write};
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use indexmap::IndexMap;
use serde_json::{Map, Value, json};

use crate::jsonc;

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

fn write_text(file: &Path, text: &str) {
    let _ = file
        .parent()
        .map_or(Ok(()), fs::create_dir_all)
        .and_then(|()| fs::write(file, text));
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

/// `usePromptHistory`: the prompt history and its cursor.
#[derive(Debug)]
pub struct History {
    file: PathBuf,
    entries: Vec<Value>,
    index: i64,
}

impl History {
    /// Loads `<state>/prompt-history.jsonl` and rewrites its valid, retained entries.
    pub fn load(state: &Path) -> Self {
        let file = state.join("prompt-history.jsonl");
        let entries = parse_history(&fs::read_to_string(&file).unwrap_or_default());
        if !entries.is_empty() {
            write_text(&file, &body(entries.iter()));
        }
        Self {
            file,
            entries,
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

    /// `append(item)`: skips a repeat of the last entry, trims to the limit, and resets the cursor.
    pub fn append(&mut self, entry: Value) {
        self.index = 0;
        if self
            .entries
            .last()
            .is_some_and(|previous| jsonc::stringify(previous) == jsonc::stringify(&entry))
        {
            return;
        }
        let line = jsonc::stringify(&entry) + "\n";
        self.entries.push(entry);
        if self.entries.len() > MAX_HISTORY_ENTRIES {
            self.entries = last(std::mem::take(&mut self.entries), MAX_HISTORY_ENTRIES);
            write_text(&self.file, &body(self.entries.iter()));
            return;
        }
        append_text(&self.file, &line);
    }
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
        history.append(prompt("b"));
        history.append(prompt("b"));
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
        assert_eq!(fs::read_to_string(&file).unwrap().lines().count(), 50);
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
