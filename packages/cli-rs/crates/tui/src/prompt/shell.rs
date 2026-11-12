//! Shell mode (E.2, row P07): `!` at the start of the prompt enters it; Escape, Ctrl+C on an empty
//! prompt, and Backspace at the start leave it (`component/prompt/index.tsx:964-1020`). Submitting
//! in shell mode runs the text with `session.shell` (`submit.rs`).

use opencode_ui::dialog::FocusId;

use super::editor::{Inner, Mode};

use crate::prelude::*;

/// The shell-mode layers, each targeting the prompt's textarea.
pub fn layers(inner: &Rc<Inner>, target: FocusId) -> Vec<KeymapLayer<FocusId>> {
    let when = |check: fn(&Inner) -> bool| Condition::when(bind!(inner, |prompt| check(&prompt)));
    let set = |mode: Mode| {
        bind!(inner, |prompt, _: Option<&str>, _: Option<&opentui::prelude::KeyEvent>| {
            if mode == Mode::Shell {
                prompt.placeholder.set(rand::random::<u32>() as usize);
            }
            prompt.set_mode(mode)
        })
    };
    let inline = |key: &str, title: &str, mode: Mode| TuiCommand::inline(key, set(mode)).title(title).group("Prompt");
    vec![
        KeymapLayer::new(vec![inline("!", "Shell mode", Mode::Shell)])
            .enabled(when(|prompt| prompt.mode.get() == Mode::Normal && prompt.textarea.cursor_offset() == 0))
            .target(target),
        KeymapLayer::new(vec![
            inline("escape", "Exit shell mode", Mode::Normal),
            inline("ctrl+c", "Exit shell mode", Mode::Normal).enabled(when(|prompt| prompt.textarea.text().is_empty())),
        ])
        .enabled(when(|prompt| prompt.mode.get() == Mode::Shell))
        .target(target)
        .priority(1),
        KeymapLayer::new(vec![inline("backspace", "Exit shell mode", Mode::Normal)])
            .enabled(when(|prompt| prompt.mode.get() == Mode::Shell && prompt.textarea.cursor_offset() == 0))
            .target(target),
    ]
}
