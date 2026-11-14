//! Prompt history (E.2, row P03): `<state>/prompt-history.jsonl`, shared by every prompt of the app
//! (`prompt/history.tsx`), and Up and Down in the prompt (`component/prompt/index.tsx:1022-1096`).
//!
//! F.5's `jsonl::History` owns the format and the entries in memory; each prompt keeps its own [`Cursor`]
//! (`usePromptHistory`). Stepping and appending run on the UI thread. The file, which the TS TUI shares, is touched on one worker thread in order: the load
//! first, then each new entry under the file's lock (`jsonl::save_history`).

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use opencode_local::jsonl::{self, empty_prompt};
use opencode_local::serial::Serial;
use opentui::native::EditorQuery;
use opentui::prelude::*;
use serde_json::Value;
use std::cell::{Cell, RefCell};

use super::editor::Inner;

/// The app's prompt history. Without a state directory it lives in memory only.
#[derive(Clone, Default)]
pub struct History {
    memory: Arc<Mutex<Memory>>,
    file: Option<(PathBuf, Serial)>,
}

#[derive(Default)]
struct Memory {
    history: jsonl::History,
    /// Entries appended before the file was read, `None` once it is; they go after its entries.
    early: Option<Vec<Value>>,
}

impl History {
    /// Loads `<state>/prompt-history.jsonl` on the worker; until then the history holds what was
    /// appended meanwhile.
    pub fn load(_app: &App, state: Option<PathBuf>) -> Self {
        let Some(state) = state else { return Self::default() };
        let memory = Arc::new(Mutex::new(Memory { early: Some(Vec::new()), ..Memory::default() }));
        let writer = Serial::new("prompt-history.jsonl");
        let slot = memory.clone();
        let file = state.clone();
        writer.run(move || {
            let mut history = jsonl::History::load(&file);
            let Ok(mut memory) = slot.lock() else { return };
            for entry in memory.early.take().unwrap_or_default() {
                history.append(entry);
            }
            memory.history = history;
        });
        Self { memory, file: Some((state, writer)) }
    }

    /// `move(direction, input)` from `cursor`; `current` is the prompt being edited, kept as the draft when the
    /// cursor leaves it.
    pub fn step(&self, cursor: &Cursor, direction: i64, input: &str, current: impl FnOnce() -> Value) -> Option<Value> {
        let memory = self.memory.lock().ok()?;
        cursor.step(memory.history.entries(), direction, input, current)
    }

    /// `append(entry)`: in memory at once, and written after the load and every earlier entry.
    pub fn append(&self, _app: &App, entry: Value) {
        let Ok(mut memory) = self.memory.lock() else { return };
        let added = memory.history.append(entry.clone());
        if let Some(early) = memory.early.as_mut().filter(|_| added) {
            early.push(entry.clone());
        }
        drop(memory);
        let Some((state, writer)) = self.file.clone().filter(|_| added) else { return };
        writer.run(move || {
            if let Err(error) = jsonl::save_history(&state, &entry) {
                log::warn!("prompt-history.jsonl: {error}");
            }
        });
    }
}

/// One prompt's place in the history, and the draft it left there (`usePromptHistory`).
#[derive(Default)]
pub struct Cursor {
    index: Cell<i64>,
    draft: RefCell<Option<Value>>,
}

impl Cursor {
    /// Back at the live prompt, with no draft kept (`reset`).
    pub fn reset(&self) {
        self.index.set(0);
        self.draft.take();
    }

    /// The entry to show, the draft when back past the newest entry, or `None` when the cursor does not move.
    fn step(&self, entries: &[Value], direction: i64, input: &str, current: impl FnOnce() -> Value) -> Option<Value> {
        let index = self.index.get();
        let next = index + direction;
        if next < -(entries.len() as i64) || next > 0 {
            return None;
        }
        // An edited entry stays put.
        if index < 0 && !input.is_empty() && at(entries, index).and_then(|entry| entry["text"].as_str()) != Some(input)
        {
            return None;
        }
        if index == 0 {
            let mut draft = current();
            draft["text"] = Value::String(input.to_owned());
            *self.draft.borrow_mut() = Some(draft);
        }
        self.index.set(next);
        if next == 0 {
            return self.draft.take();
        }
        let mut prompt = empty_prompt();
        if let (Some(prompt), Some(Value::Object(entry))) = (prompt.as_object_mut(), at(entries, next)) {
            prompt.extend(entry.clone());
        }
        Some(prompt)
    }
}

/// `entries.at(index)` for a negative `index`.
fn at(entries: &[Value], index: i64) -> Option<&Value> {
    entries.get(entries.len().checked_sub(index.unsigned_abs() as usize)?)
}

/// `prompt.history.previous`: moves up a line, then to the start, then to the previous entry.
pub fn previous(prompt: &Inner, history: &History) -> bool {
    let textarea = &prompt.textarea;
    if textarea.cursor_offset() != 0 {
        if visual_row(textarea) == 0 {
            textarea.set_cursor_offset(0);
            return true;
        }
        textarea.perform(EditorAction::MoveUp);
        return true;
    }
    let Some(item) = history.step(&prompt.history, -1, &textarea.text(), || prompt.snapshot()) else { return false };
    prompt.restore(item);
    textarea.set_cursor_offset(0);
    true
}

/// `prompt.history.next`: moves down a line, then to the end, then to the next entry.
pub fn next(prompt: &Inner, history: &History) -> bool {
    let textarea = &prompt.textarea;
    let end = prompt.text_end();
    if textarea.cursor_offset() != end {
        let last = textarea.view().info(false).map_or(0, |info| info.total_virtual_line_count.saturating_sub(1));
        if visual_row(textarea) == last {
            textarea.set_cursor_offset(end);
            return true;
        }
        textarea.perform(EditorAction::MoveDown);
        return true;
    }
    let Some(item) = history.step(&prompt.history, 1, &textarea.text(), || prompt.snapshot()) else { return false };
    prompt.restore(item);
    textarea.set_cursor_offset(prompt.text_end());
    true
}

/// The cursor's wrapped line in the whole text (`scrollY + visualCursor.visualRow`).
fn visual_row(textarea: &Textarea) -> u32 {
    let view = textarea.view();
    let scroll = view.viewport().map_or(0, |viewport| viewport.y);
    scroll + view.position(EditorQuery::Cursor).map_or(0, |position| position.visual_row)
}
