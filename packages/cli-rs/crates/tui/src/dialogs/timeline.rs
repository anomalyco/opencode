//! Browse prompts newest first and jump to the highlighted message.

use opencode_util::time::Zone;

use crate::prelude::*;

pub type OnMove = Rc<dyn Fn(&Tui, String)>;

pub fn show(tui: &Tui, session: SessionID, on_move: OnMove) {
    let options: Vec<_> = tui
        .data
        .read(|state| prompts(state.messages(&session)))
        .into_iter()
        .rev()
        .map(|(id, title, created)| {
            let session = session.clone();
            let message = id.clone();
            SelectOption::new(title, id)
                .footer(time(created))
                .on_select(bind!(tui, |tui, _| crate::dialogs::message::show(&tui, session.clone(), message.clone())))
        })
        .collect();
    let weak = tui.weak();
    tui.dialogs.replace(
        move |cx| {
            let mut props = SelectProps::new("Timeline", options.clone());
            let on_move = on_move.clone();

            props.search_in_title = true;
            props.title_placeholder = Some("Search timeline".to_owned());
            props.on_move =
                Some(Rc::new(bind!(weak, |tui, option: &SelectOption<String>| on_move(&tui, option.value.clone()))));
            select::select(cx, props).0
        },
        None,
        DialogOptions::new(DialogSize::Large),
    );
}

/// The user messages, oldest first, as `(id, title, created)`; a title is the text on one line.
pub(crate) fn prompts(messages: &[SessionMessageInfo]) -> Vec<(String, String, f64)> {
    messages
        .iter()
        .filter_map(|message| match message {
            SessionMessageInfo::User(user) => {
                Some((user.id.0.clone(), user.text.replace('\n', " "), user.time.created))
            }
            _ => None,
        })
        .collect()
}

/// `Locale.time`: `toLocaleTimeString(undefined, { timeStyle: "short" })` in en-US. Bun's ICU puts a plain space
/// before AM/PM.
pub(crate) fn time(created: f64) -> String {
    Zone::Local.at(created as i64).map(|date| date.short_time()).unwrap_or_default()
}
