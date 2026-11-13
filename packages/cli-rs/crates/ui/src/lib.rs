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
pub mod locale;
pub mod markdown;
pub mod motion;
pub mod open;
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
/// session title with a newline cannot break the escape sequence, and cut to the [`TITLE_BYTES`] OpenTUI takes on a
/// character boundary.
pub fn terminal_title(title: &str) -> String {
    let mut out = terminal_title_uncut(title);
    out.truncate(out.floor_char_boundary(TITLE_BYTES));
    out
}

/// The longest title OpenTUI sends, in UTF-8 bytes: its sequence `ESC ] 0 ; <title> BEL` fits 4096 bytes. A longer
/// one fails the app's terminal session, which ends the TUI (`session.zig` `title_bytes_max`).
pub const TITLE_BYTES: usize = 4096 - "\x1b]0;\x07".len();

fn terminal_title_uncut(title: &str) -> String {
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

/// Untrusted text (model, tool, server or file data) as it may be written to the terminal outside the renderer:
/// escape sequences removed, then every other C0 control except newline and tab, DEL, and C1. Text without them
/// is returned as it is. TS writes such text raw (`parity/deviations/O89-terminal-text.md`).
pub fn terminal_text(text: &str) -> std::borrow::Cow<'_, str> {
    static ANSI: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
        // `ansi-regex` 6.3, as `normalizeText` in the attention feature.
        regex::Regex::new(concat!(
            r"\x1b\][^\x07\x1b\x{9c}]*(?:\x07|\x1b\\|\x{9c})",
            r"|[\x1b\x{9b}][\[\]()#;?]*(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]",
        ))
        .unwrap()
    });
    let control = |char: char| matches!(char, '\u{0}'..='\u{8}' | '\u{b}'..='\u{1f}' | '\u{7f}'..='\u{9f}');
    if !text.contains(control) {
        return text.into();
    }
    ANSI.replace_all(text, "").replace(control, "").into()
}

#[cfg(test)]
mod tests {
    #[test]
    fn terminal_title_collapses_control_runs() {
        assert_eq!(super::terminal_title("OC | a\r\nb\tc\u{85}"), "OC | a b c ");
        assert_eq!(super::terminal_title("plain"), "plain");
    }

    // Expected (reviews bigboi-2, carbon-3): a title is cut to the 4091 bytes OpenTUI takes, on a character boundary,
    // after the controls are replaced.
    #[test]
    fn terminal_title_fits_opentui() {
        use super::{TITLE_BYTES, terminal_title};
        assert_eq!(TITLE_BYTES, 4091);
        let cases = [
            ("a".repeat(4091), "a".repeat(4091)),
            ("a".repeat(5000), "a".repeat(4091)),
            // "é" is two bytes: 2045 of them are 4090 bytes, and the next does not fit.
            ("é".repeat(3000), "é".repeat(2045)),
            (format!("{}\r\n\r\n", "a".repeat(4089)), format!("{} ", "a".repeat(4089))),
        ];
        for (input, want) in cases {
            assert_eq!(terminal_title(&input), want, "{}", input.len());
        }
    }

    #[test]
    fn terminal_text_drops_escape_sequences_and_controls() {
        use super::terminal_text;
        let cases = [
            ("x\x1b]52;c;cHduZWQ=\x07y", "xy"),
            // `ansi-regex` does not match a C1 OSC; its controls go, its text stays.
            ("x\u{9d}52;c;cHduZWQ=\u{9c}y", "x52;c;cHduZWQ=y"),
            ("\x1b[31mred\x1b[0m", "red"),
            ("a\r\nb\tc\x08d\x7fe\u{85}f", "a\nb\tcdef"),
            ("lone \x1b escape", "lone  escape"),
        ];
        for (input, want) in cases {
            assert_eq!(terminal_text(input), want, "{input:?}");
        }
        let plain = "plain text\n\twith ✓ unicode";
        assert!(matches!(terminal_text(plain), std::borrow::Cow::Borrowed(text) if text == plain));
    }
}
