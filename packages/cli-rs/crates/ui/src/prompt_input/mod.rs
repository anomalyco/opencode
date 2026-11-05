//! Prompt input rules shared by the TUI prompt and mini's footer prompt: text offsets and triggers, pasted
//! attachments, clipboard pastes, and the external editor.

pub mod attach;
pub mod editor;
pub mod parse;
pub mod paste;

use opentui::native::SelectionColors;
use opentui::prelude::*;

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
