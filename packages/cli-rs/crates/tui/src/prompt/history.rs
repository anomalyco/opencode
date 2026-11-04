//! Prompt history (E.2, row P03): `<state>/prompt-history.jsonl`, shared by every prompt of the app
//! (`prompt/history.tsx`), and Up and Down in the prompt (`component/prompt/index.tsx:1022-1096`).
//!
//! F.5's `jsonl::History` owns the format and the cursor. Loading and appending touch the file, so
//! they run on blocking threads; stepping only reads memory and runs on the UI thread.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use opencode_local::jsonl;
use opentui::native::EditorQuery;
use opentui::prelude::*;
use serde_json::Value;

use super::editor::Inner;

/// The app's prompt history. Without a state directory nothing is kept, as nothing is written.
#[derive(Clone, Default)]
pub struct History {
    slot: Arc<Mutex<Option<jsonl::History>>>,
    /// Entries not appended yet, in submit order.
    queue: Arc<Mutex<Vec<Value>>>,
    state: Option<PathBuf>,
}

impl History {
    /// Loads `<state>/prompt-history.jsonl` on a blocking thread; until then the history is empty.
    pub fn load(app: &App, state: Option<PathBuf>) -> Self {
        let history = Self {
            state,
            ..Self::default()
        };
        history.write(app);
        history
    }

    /// `move(direction, input)`.
    pub fn step(&self, direction: i64, input: &str) -> Option<Value> {
        self.slot.lock().ok()?.as_mut()?.step(direction, input)
    }

    /// `append(entry)`, written on a blocking thread.
    pub fn append(&self, app: &App, entry: Value) {
        if self.state.is_none() {
            return;
        }
        if let Ok(mut queue) = self.queue.lock() {
            queue.push(entry);
        }
        self.write(app);
    }

    /// Loads the file if no task has yet, then appends every queued entry. Blocking tasks run in any order,
    /// so each one takes the whole queue while it holds the history: entries land in submit order, and one
    /// submitted before the load finished is not lost.
    fn write(&self, app: &App) {
        let Some(state) = self.state.clone() else {
            return;
        };
        let (slot, queue) = (self.slot.clone(), self.queue.clone());
        app.runtime().spawn_blocking(move || {
            let Ok(mut slot) = slot.lock() else { return };
            let history = slot.get_or_insert_with(|| jsonl::History::load(&state));
            let entries = queue.lock().map(|mut queue| std::mem::take(&mut *queue));
            for entry in entries.unwrap_or_default() {
                history.append(entry);
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
        let last = textarea
            .view()
            .info(false)
            .map_or(0, |info| info.total_virtual_line_count.saturating_sub(1));
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
    scroll
        + view
            .position(EditorQuery::Cursor)
            .map_or(0, |position| position.visual_row)
}
