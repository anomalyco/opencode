//! UI kit on opentui: themes, keymap, dialogs, and content widgets.

pub mod activity_calendar;
pub mod alert;
pub mod bind;
pub mod code;
pub mod confirm;
pub mod dialog;
pub mod diff;
pub mod form;
pub mod fuzzy;
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

/// A terminal title with each run of C0 and C1 control characters replaced by one space (`setTerminalTitle`), so a
/// session title with a newline cannot break the escape sequence.
pub fn terminal_title(title: &str) -> String {
    let mut out = String::with_capacity(title.len());
    let mut control = false;
    for char in title.chars() {
        let is_control = matches!(char, '\u{0}'..='\u{1f}' | '\u{7f}'..='\u{9f}');
        if is_control && !control {
            out.push(' ');
        }
        if !is_control {
            out.push(char);
        }
        control = is_control;
    }
    out
}

#[cfg(test)]
mod tests {
    #[test]
    fn terminal_title_collapses_control_runs() {
        assert_eq!(super::terminal_title("OC | a\r\nb\tc\u{85}"), "OC | a b c ");
        assert_eq!(super::terminal_title("plain"), "plain");
    }
}
