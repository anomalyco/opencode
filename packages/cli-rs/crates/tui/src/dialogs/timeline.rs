//! Timeline dialog (E.10a, row DLG39): `routes/session/dialog-timeline.tsx`. The session's prompts, newest
//! first; moving jumps the transcript to the prompt, and Enter opens the message actions (E.10b).

use std::rc::Rc;

use chrono::{Local, TimeZone};
use opencode_api::generated::{SessionID, SessionMessageInfo};
use opencode_ui::dialog::{DialogOptions, DialogSize};
use opencode_ui::select::{self, SelectOption, SelectProps};

use crate::app::Tui;

/// Called with a message ID as the selection moves (`onMove`).
pub type OnMove = Rc<dyn Fn(&Tui, String)>;

/// `DialogTimeline`, opened with `dialog.replace`.
pub fn show(tui: &Tui, session: SessionID, on_move: OnMove) {
    let options: Vec<_> = tui
        .data
        .read(|state| prompts(state.messages(&session)))
        .into_iter()
        .rev()
        .map(|(id, title, created)| {
            let weak = tui.weak();
            let session = session.clone();
            let message = id.clone();
            SelectOption::new(title, id)
                .footer(time(created))
                .on_select(move |_| {
                    if let Some(tui) = weak.upgrade() {
                        crate::dialogs::message::show(&tui, session.clone(), message.clone());
                    }
                })
        })
        .collect();
    let weak = tui.weak();
    tui.dialogs.replace(
        move |cx| {
            let mut props = SelectProps::new("Timeline", options);
            props.placeholder = Some("Search timeline".to_owned());
            props.on_move = Some(Rc::new(move |option: &SelectOption<String>| {
                if let Some(tui) = weak.upgrade() {
                    on_move(&tui, option.value.clone());
                }
            }));
            select::select(cx, props).0
        },
        None,
        DialogOptions {
            size: DialogSize::Large,
            ..DialogOptions::default()
        },
    );
}

/// The user messages, oldest first, as `(id, title, created)`; a title is the text on one line.
pub(crate) fn prompts(messages: &[SessionMessageInfo]) -> Vec<(String, String, f64)> {
    messages
        .iter()
        .filter_map(|message| match message {
            SessionMessageInfo::User(user) => Some((
                user.id.0.clone(),
                user.text.replace('\n', " "),
                user.time.created,
            )),
            _ => None,
        })
        .collect()
}

/// `Locale.time`: `toLocaleTimeString(undefined, { timeStyle: "short" })` in en-US. Bun's ICU puts a plain space
/// before AM/PM.
pub(crate) fn time(created: f64) -> String {
    Local
        .timestamp_millis_opt(created as i64)
        .single()
        .map(|date| date.format("%-I:%M %p").to_string())
        .unwrap_or_default()
}
