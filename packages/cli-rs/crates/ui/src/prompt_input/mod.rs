//! Prompt input rules shared by the TUI prompt and mini's footer prompt: text offsets and triggers, pasted
//! attachments, clipboard pastes, and the external editor.

pub mod attach;
pub mod editor;
pub mod parse;
pub mod paste;

use opentui::native::SelectionColors;
use opentui::prelude::*;

/// The cursor offset of byte `index` of the textarea's text: display cells as the buffer counts them (a tab is the
/// buffer's tab width), one per line break. Inside a grapheme rounds down; past the end is the end.
pub fn offset_at(textarea: &Textarea, index: usize) -> u32 {
    textarea.buffer().byte_index_to_cell_offset(index).unwrap_or_default()
}

/// The byte index in the textarea's text at cursor offset `offset`, rounded down to a grapheme start.
pub fn index_at(textarea: &Textarea, offset: u32) -> usize {
    textarea.buffer().cell_offset_to_byte_index(offset).unwrap_or_default()
}

/// The cursor offset where `text` ends, which the textarea shows from offset `start`.
pub fn after(textarea: &Textarea, start: u32, text: &str) -> u32 {
    offset_at(textarea, index_at(textarea, start) + text.len())
}

/// The cursor offset at the end of the textarea's text.
pub fn end(textarea: &Textarea) -> u32 {
    offset_at(textarea, usize::MAX)
}

/// Replaces offsets `start..end` with `text` as one edit through the widget, so marks move.
pub fn replace(textarea: &Textarea, start: u32, end: u32, text: &str) {
    if start < end {
        let _ = textarea.view().select_range(start, end, SelectionColors::default());
        if text.is_empty() {
            textarea.perform(EditorAction::Backspace);
            return;
        }
    }
    if !text.is_empty() {
        textarea.insert(text);
    }
}
