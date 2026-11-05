//! Focus rules (E.19a, rows N01 and N04, `attention.ts:22,78-102`): the terminal's focus as its focus reports
//! last said, and whether a notification or sound asked for `always`, `focused`, or `blurred` goes out.
//!
//! The focus is unknown until the first report, so a `focused` or `blurred` request waits on a terminal that
//! reports focus. `app::mount` calls [`install`] once.

use opencode_ui::bind;

use crate::app::Tui;

/// The terminal focus (`FocusState`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Focus {
    #[default]
    Unknown,
    Focused,
    Blurred,
}

/// When a notification or sound may go out (`AttentionWhen`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum When {
    Always,
    Focused,
    Blurred,
}

/// Why a request sent nothing (`AttentionNotifySkipReason`).
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

/// Follows the terminal's focus reports.
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
