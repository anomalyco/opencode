//! Prompt history (E.2, row P03): `<state>/prompt-history.jsonl`, shared by every prompt of the app
//! (`prompt/history.tsx`), and Up and Down in the prompt (`component/prompt/index.tsx:1022-1096`).
//!
//! F.5's `jsonl::History` owns the format and the cursor in memory; stepping and appending run on the
//! UI thread. The file, which the TS TUI shares, is touched on one worker thread in order: the load
//! first, then each new entry under the file's lock (`jsonl::save_history`).

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use opencode_local::jsonl;
use opencode_local::serial::Serial;
use opentui::native::EditorQuery;
use opentui::prelude::*;
use serde_json::Value;

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
        let Some(state) = state else {
            return Self::default();
        };
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

    /// `move(direction, input)`.
    pub fn step(&self, direction: i64, input: &str) -> Option<Value> {
        self.memory.lock().ok()?.history.step(direction, input)
    }

    /// `append(entry)`: in memory at once, and written after the load and every earlier entry.
    pub fn append(&self, _app: &App, entry: Value) {
        let Ok(mut memory) = self.memory.lock() else {
            return;
        };
        let added = memory.history.append(entry.clone());
        if let Some(early) = memory.early.as_mut().filter(|_| added) {
            early.push(entry.clone());
        }
        drop(memory);
        let Some((state, writer)) = self.file.clone().filter(|_| added) else {
            return;
        };
        writer.run(move || {
            if let Err(error) = jsonl::save_history(&state, &entry) {
                log::warn!("prompt-history.jsonl: {error}");
            }
        });
    }
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
    let Some(item) = history.step(-1, &textarea.text()) else {
        return false;
    };
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
    let Some(item) = history.step(1, &textarea.text()) else {
        return false;
    };
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
