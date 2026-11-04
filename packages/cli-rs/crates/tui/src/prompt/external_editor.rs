//! External editor (E.5, row P09): `prompt.editor` (`<leader>e`, `/editor`) opens the prompt in `$VISUAL` or
//! `$EDITOR` and reads it back (`openEditor` in `editor.ts`, `prompt.editor` in `component/prompt/index.tsx`).
//!
//! The prompt goes to a temporary `.md` file. The terminal is released to the editor while it runs and taken
//! back when it exits; the UI waits meanwhile, as TS's suspended renderer does. Mentions that survive the edit
//! keep their parts, moved to where their text now is.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::rc::Rc;

use opencode_ui::toast::{ToastOptions, Variant};
use serde_json::{Value, json};

use super::autocomplete::parse::measure;
use super::editor::Inner;
use crate::app::Tui;

/// `prompt.editor`.
pub fn open(tui: &Tui, prompt: &Rc<Inner>) {
    tui.dialogs.clear();
    let Some(command) = ["VISUAL", "EDITOR"]
        .iter()
        .find_map(|name| std::env::var(name).ok().filter(|value| !value.is_empty()))
    else {
        failed(tui, "Set $VISUAL or $EDITOR to open an external editor");
        return;
    };
    // The editor gets the pasted text, not the `[Pasted ~N lines]` labels (`expandPromptInputPastedText`).
    let snapshot = super::paste::expand_prompt(&prompt.snapshot());
    let cwd = working_directory(tui, prompt);
    let weak = Rc::downgrade(prompt);
    tui.app.release_terminal(move |_| {
        let result = edit(
            &command,
            snapshot["text"].as_str().unwrap_or_default(),
            &cwd,
        );
        let Some(prompt) = weak.upgrade() else { return };
        let Some(tui) = prompt.tui.upgrade() else {
            return;
        };
        match result {
            Err(message) => failed(&tui, &message),
            Ok(None) => {}
            Ok(Some(content)) => {
                let text = normalize(&content);
                let mut next = realign(&text, &snapshot);
                next["pasted"] = json!([]);
                next["mode"] = Value::String(prompt.mode.get().as_str().to_owned());
                prompt.restore(next);
                prompt.textarea.set_cursor_offset(measure(&text));
            }
        }
        tui.app.request_redraw();
    });
}

fn failed(tui: &Tui, message: &str) {
    tui.toasts
        .show(ToastOptions::new(Variant::Error, message.to_owned()).title("Failed to open editor"));
}

/// The project's directory unless it is `/`, else the location's, else the TUI's.
fn working_directory(tui: &Tui, prompt: &Inner) -> PathBuf {
    let location = prompt.location(tui);
    let project = tui.data.read(|state| {
        state
            .location(Some(&location))
            .or_else(|| state.location(None))
            .and_then(|data| data.info.as_ref())
            .map(|info| info.project.directory.0.clone())
    });
    let directory = project
        .filter(|directory| directory != "/")
        .unwrap_or(location.directory);
    PathBuf::from(if directory.is_empty() {
        tui.directory.clone()
    } else {
        directory
    })
}

/// Writes `text` to a temporary file, runs the editor on it, and reads it back: `None` when it came back empty.
fn edit(command: &str, text: &str, cwd: &Path) -> Result<Option<String>, String> {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis());
    let file = std::env::temp_dir().join(format!("{stamp}.md"));
    std::fs::write(&file, text).map_err(|error| error.to_string())?;
    let result = run(command, &file, cwd);
    let _ = std::fs::remove_file(&file);
    result
}

fn run(command: &str, file: &Path, cwd: &Path) -> Result<Option<String>, String> {
    // `editor.split(" ")`: arguments are separated by single spaces, without quoting.
    let mut parts = command.split(' ');
    let program = parts.next().unwrap_or_default();
    let mut child = Command::new(program);
    child.args(parts).arg(file);
    if cwd.is_dir() {
        child.current_dir(cwd);
    }
    let status = child.status().map_err(|error| error.to_string())?;
    if !status.success() {
        return Err(format!("Editor exited with {}", exit_reason(&status)));
    }
    let content = std::fs::read_to_string(file).map_err(|error| error.to_string())?;
    Ok((!content.is_empty()).then_some(content))
}

fn exit_reason(status: &std::process::ExitStatus) -> String {
    #[cfg(unix)]
    if let Some(signal) = std::os::unix::process::ExitStatusExt::signal(status) {
        let name = match signal {
            1 => "SIGHUP".to_owned(),
            2 => "SIGINT".to_owned(),
            3 => "SIGQUIT".to_owned(),
            6 => "SIGABRT".to_owned(),
            9 => "SIGKILL".to_owned(),
            15 => "SIGTERM".to_owned(),
            other => other.to_string(),
        };
        return format!("signal {name}");
    }
    format!(
        "code {}",
        status
            .code()
            .map_or_else(|| "null".to_owned(), |code| code.to_string())
    )
}

/// Drops the trailing line break that editors add to a one-line text (`normalizePromptContent`).
pub fn normalize(content: &str) -> String {
    for ending in ["\r\n", "\n"] {
        if let Some(body) = content.strip_suffix(ending) {
            return if body.contains(['\n', '\r']) {
                content.to_owned()
            } else {
                body.to_owned()
            };
        }
    }
    content.to_owned()
}

/// A mention's range: offsets as the cursor counts them, and its text.
#[derive(Clone, Debug, PartialEq)]
struct Mention {
    start: u32,
    end: u32,
    text: String,
}

/// An occurrence of a mention's text: its byte range in the content and its cursor offset.
#[derive(Clone, Copy, Debug)]
struct Candidate {
    start: usize,
    end: usize,
    offset: u32,
}

/// The `PromptInfo` for `content`: each mention with text moves to an occurrence of that text, the one
/// nearest its old offset, and a part whose text is gone is dropped (`realignPromptInputMentions`).
pub fn realign(content: &str, prompt: &Value) -> Value {
    const KEYS: [&str; 3] = ["files", "agents", "skills"];
    let lists: Vec<Option<&Vec<Value>>> = KEYS
        .iter()
        .map(|key| prompt.get(*key).and_then(Value::as_array))
        .collect();
    let parts: Vec<&Value> = lists
        .iter()
        .flatten()
        .flat_map(|list| list.iter())
        .collect();
    let mentions: Vec<Option<Mention>> = parts.iter().map(|part| mention(part)).collect();
    let aligned = realign_mentions(content, &mentions);

    let mut next = json!({ "text": content });
    let mut index = 0;
    for (key, list) in KEYS.iter().zip(lists) {
        let Some(list) = list else { continue };
        let kept: Vec<Value> = list
            .iter()
            .filter_map(|part| {
                let at = index;
                index += 1;
                if mention(part).is_none() {
                    return Some(part.clone());
                }
                let mention = aligned[at].as_ref()?;
                let mut part = part.clone();
                part["mention"] =
                    json!({ "text": mention.text, "start": mention.start, "end": mention.end });
                Some(part)
            })
            .collect();
        next[*key] = Value::Array(kept);
    }
    next
}

/// A part's mention with text.
fn mention(part: &Value) -> Option<Mention> {
    let mention = part.get("mention")?;
    let text = mention
        .get("text")?
        .as_str()
        .filter(|text| !text.is_empty())?;
    let offset = |key: &str| mention.get(key).and_then(Value::as_f64).unwrap_or_default() as u32;
    Some(Mention {
        start: offset("start"),
        end: offset("end"),
        text: text.to_owned(),
    })
}

/// `realignPromptMentions`: longer texts claim their occurrences first, so a short mention never takes part of a
/// longer one.
fn realign_mentions(content: &str, mentions: &[Option<Mention>]) -> Vec<Option<Mention>> {
    let mut aligned = vec![None; mentions.len()];
    let mut groups: Vec<(String, Vec<(usize, &Mention)>)> = Vec::new();
    for (index, mention) in mentions.iter().enumerate() {
        let Some(mention) = mention else { continue };
        match groups.iter_mut().find(|(text, _)| *text == mention.text) {
            Some((_, items)) => items.push((index, mention)),
            None => groups.push((mention.text.clone(), vec![(index, mention)])),
        }
    }
    groups.sort_by(|(left, _), (right, _)| right.len().cmp(&left.len()).then(left.cmp(right)));
    let mut protected: Vec<Candidate> = Vec::new();
    for (text, items) in groups {
        let candidates = occurrences(content, &text);
        let available: Vec<Candidate> = candidates
            .iter()
            .copied()
            .filter(|candidate| !protected.iter().any(|range| overlaps(candidate, range)))
            .collect();
        for (index, candidate) in assign(items, &available) {
            aligned[index] = Some(Mention {
                start: candidate.offset,
                end: candidate.offset + measure(&text),
                text: text.clone(),
            });
        }
        protected.extend(candidates);
    }
    aligned
}

fn occurrences(content: &str, text: &str) -> Vec<Candidate> {
    let mut found = Vec::new();
    let mut from = 0;
    while let Some(at) = content[from..].find(text) {
        let start = from + at;
        found.push(Candidate {
            start,
            end: start + text.len(),
            offset: measure(&content[..start]),
        });
        from = start + text.len();
    }
    found
}

fn overlaps(left: &Candidate, right: &Candidate) -> bool {
    left.start < right.end && left.end > right.start
}

/// Pairs mentions with occurrences in order: the most pairs, then the least total distance from the old offsets
/// (`assignMentions`).
fn assign(mut items: Vec<(usize, &Mention)>, candidates: &[Candidate]) -> Vec<(usize, Candidate)> {
    items.sort_by(|left, right| left.1.start.cmp(&right.1.start).then(left.0.cmp(&right.0)));
    let mut memo = HashMap::new();
    solve(&items, candidates, 0, 0, &mut memo).2
}

type Solution = (usize, u64, Vec<(usize, Candidate)>);

fn solve(
    items: &[(usize, &Mention)],
    candidates: &[Candidate],
    item: usize,
    candidate: usize,
    memo: &mut HashMap<(usize, usize), Solution>,
) -> Solution {
    if item >= items.len() || candidate >= candidates.len() {
        return (0, 0, Vec::new());
    }
    if let Some(cached) = memo.get(&(item, candidate)) {
        return cached.clone();
    }
    let tail = solve(items, candidates, item + 1, candidate + 1, memo);
    let (index, current) = items[item];
    let range = candidates[candidate];
    let mut pairs = vec![(index, range)];
    pairs.extend(tail.2);
    let matched = (
        tail.0 + 1,
        tail.1 + u64::from(range.offset.abs_diff(current.start)),
        pairs,
    );
    let options = [
        solve(items, candidates, item + 1, candidate, memo),
        solve(items, candidates, item, candidate + 1, memo),
    ];
    let best = options.into_iter().fold(matched, |best, next| {
        let better = if next.0 != best.0 {
            next.0 > best.0
        } else {
            next.1 < best.1
        };
        if better { next } else { best }
    });
    memo.insert((item, candidate), best.clone());
    best
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_drops_the_break_after_one_line() {
        assert_eq!(normalize("hello\n"), "hello");
        assert_eq!(normalize("hello\r\n"), "hello");
        assert_eq!(normalize("a\nb\n"), "a\nb\n");
        assert_eq!(normalize("a\r\nb\r\n"), "a\r\nb\r\n");
        assert_eq!(normalize("plain"), "plain");
    }

    #[test]
    fn mentions_follow_their_text_and_vanish_with_it() {
        let prompt = json!({
            "text": "fix @a.ts and @general",
            "files": [
                { "uri": "file:///w/a.ts", "name": "a.ts", "mention": { "start": 4, "end": 9, "text": "@a.ts" } },
                { "uri": "file:///w/b.ts", "name": "b.ts" },
            ],
            "agents": [{ "name": "general", "mention": { "start": 14, "end": 22, "text": "@general" } }],
            "pasted": [],
        });
        let next = realign("日本 @general then @a.ts", &prompt);
        assert_eq!(next["text"], "日本 @general then @a.ts");
        assert_eq!(
            next["files"][0]["mention"],
            json!({ "text": "@a.ts", "start": 19, "end": 24 })
        );
        assert_eq!(
            next["files"][1],
            json!({ "uri": "file:///w/b.ts", "name": "b.ts" })
        );
        assert_eq!(
            next["agents"][0]["mention"],
            json!({ "text": "@general", "start": 5, "end": 13 })
        );
        assert!(next.get("skills").is_none());

        let gone = realign("nothing left", &prompt);
        assert_eq!(
            gone["files"],
            json!([{ "uri": "file:///w/b.ts", "name": "b.ts" }])
        );
        assert_eq!(gone["agents"], json!([]));
    }

    #[test]
    fn repeated_mentions_take_the_nearest_occurrences_and_longer_texts_go_first() {
        let part = |start: u32, text: &str| json!({ "uri": "file:///x", "name": "x", "mention": { "start": start, "end": start + measure(text), "text": text } });
        let prompt = json!({ "files": [part(0, "@x"), part(20, "@x"), part(30, "@x.ts")] });
        // Three "@x" candidates, one inside "@x.ts", which the longer mention protects.
        let next = realign("@x @x.ts                @x", &prompt);
        let starts: Vec<u64> = next["files"]
            .as_array()
            .unwrap()
            .iter()
            .map(|file| file["mention"]["start"].as_u64().unwrap())
            .collect();
        assert_eq!(starts, [0, 24, 3]);
    }
}
