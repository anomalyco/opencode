//! UI kit on opentui: themes, keymap, dialogs, and content widgets.

pub mod activity_calendar;
pub mod alert;
pub mod code;
pub mod confirm;
pub mod dialog;
pub mod diff;
pub mod form;
pub mod grammars;
pub mod help;
pub mod keymap;
pub mod markdown;
pub mod motion;
pub mod palette;
pub mod path;
pub mod permission;
pub mod prompt;
pub mod prompt_input;
pub mod qr;
pub mod select;
pub mod theme;
pub mod toast;
pub mod tool_info;

use opentui::prelude::MousePointer;

/// The mouse pointer over an element: the hand when a click on it acts, else the default. TS sets no pointer shape;
/// the hand is a deliberate deviation (`parity/deviations/W01-hand-pointer.md`).
pub fn click_pointer(clickable: bool) -> MousePointer {
    if clickable { MousePointer::POINTER } else { MousePointer::DEFAULT }
}
