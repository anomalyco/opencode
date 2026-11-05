//! Shell mode (E.2, row P07): `!` at the start of the prompt enters it; Escape, Ctrl+C on an empty
//! prompt, and Backspace at the start leave it (`component/prompt/index.tsx:964-1020`). Submitting
//! in shell mode runs the text with `session.shell` (`submit.rs`).

use std::rc::Rc;

use opencode_ui::bind;
use opencode_ui::dialog::FocusId;
use opencode_ui::keymap::{KeymapLayer, TuiCommand};
use opentui::keymap::Condition;

use super::editor::{Inner, Mode};

/// The shell-mode layers, each targeting the prompt's textarea.
pub fn layers(inner: &Rc<Inner>, target: FocusId) -> Vec<KeymapLayer<FocusId>> {
    let when = |check: fn(&Inner) -> bool| {
        let weak = Rc::downgrade(inner);
        Condition::when(move || weak.upgrade().is_some_and(|prompt| check(&prompt)))
    };
    let set = |mode: Mode| {
        bind!(inner, |prompt, _: Option<&str>, _: Option<&opentui::prelude::KeyEvent>| prompt.set_mode(mode))
    };
    let inline = |key: &str, title: &str, mode: Mode| TuiCommand::inline(key, set(mode)).title(title).group("Prompt");
    vec![
        KeymapLayer {
            target: Some(target),
            enabled: when(|prompt| prompt.mode.get() == Mode::Normal && prompt.textarea.cursor_offset() == 0),
            commands: vec![inline("!", "Shell mode", Mode::Shell)],
            ..KeymapLayer::default()
        },
        KeymapLayer {
            priority: 1,
            target: Some(target),
            enabled: when(|prompt| prompt.mode.get() == Mode::Shell),
            commands: vec![
                inline("escape", "Exit shell mode", Mode::Normal),
                inline("ctrl+c", "Exit shell mode", Mode::Normal)
                    .enabled(when(|prompt| prompt.textarea.text().is_empty())),
            ],
            ..KeymapLayer::default()
        },
        KeymapLayer {
            target: Some(target),
            enabled: when(|prompt| prompt.mode.get() == Mode::Shell && prompt.textarea.cursor_offset() == 0),
            commands: vec![inline("backspace", "Exit shell mode", Mode::Normal)],
            ..KeymapLayer::default()
        },
    ]
}
