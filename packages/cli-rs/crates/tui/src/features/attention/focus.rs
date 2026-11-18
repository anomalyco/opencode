//! Terminal focus is unknown until the first report. Focus-dependent notifications and sounds wait for it.

use crate::prelude::*;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Focus {
    #[default]
    Unknown,
    Focused,
    Blurred,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum When {
    Always,
    Focused,
    Blurred,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Skip {
    AttentionDisabled,
    RendererDestroyed,
    EmptyMessage,
    FocusUnknown,
    Focused,
    Blurred,
}

/// `focusSkip`: why `when` holds back a request under `focus`, if it does.
pub fn skip(when: When, focus: Focus) -> Option<Skip> {
    match (when, focus) {
        (When::Always, _) => None,
        (_, Focus::Unknown) => Some(Skip::FocusUnknown),
        (When::Blurred, Focus::Focused) => Some(Skip::Focused),
        (When::Focused, Focus::Blurred) => Some(Skip::Blurred),
        _ => None,
    }
}

pub fn install(tui: &Tui) {
    tui.app.on_terminal_focus(bind!(tui, |tui, _, focused| tui.attention.focus.set(if focused {
        Focus::Focused
    } else {
        Focus::Blurred
    })));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requests_wait_on_the_focus_they_ask_for() {
        let table = [
            (When::Always, Focus::Unknown, None),
            (When::Always, Focus::Focused, None),
            (When::Always, Focus::Blurred, None),
            (When::Blurred, Focus::Unknown, Some(Skip::FocusUnknown)),
            (When::Blurred, Focus::Focused, Some(Skip::Focused)),
            (When::Blurred, Focus::Blurred, None),
            (When::Focused, Focus::Unknown, Some(Skip::FocusUnknown)),
            (When::Focused, Focus::Focused, None),
            (When::Focused, Focus::Blurred, Some(Skip::Blurred)),
        ];
        for (when, focus, expected) in table {
            assert_eq!(skip(when, focus), expected, "{when:?} under {focus:?}");
        }
    }
}
