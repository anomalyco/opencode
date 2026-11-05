//! Message actions dialog (E.10b, row DLG38): `routes/session/dialog-message.tsx`. A click on a user message, or
//! Enter in the timeline (E.10a), opens it: jump to the message, revert to it, copy its text, or fork before it.

use std::rc::Rc;
use std::time::Duration;

use opencode_api::client::RequestOptions;
use opencode_api::generated::{
    SessionID, SessionMessageAssistantContentItem, SessionMessageID, SessionMessageInfo, SessionRevertStageInput,
};
use opencode_ui::dialog::{DialogOptions, Dialogs};
use opencode_ui::select::{self, SelectOption, SelectProps};
use opencode_ui::toast::{ToastOptions, Variant};

use crate::app::Tui;

/// `DialogMessage` for one message of `session`, with `dialog.replace`.
pub fn show(tui: &Tui, session: SessionID, message: String) {
    let action = |run: fn(&Tui, &Dialogs, &SessionID, &str)| {
        let (weak, session, message) = (tui.weak(), session.clone(), message.clone());
        move |dialogs: &Dialogs| {
            if let Some(tui) = weak.upgrade() {
                run(&tui, dialogs, &session, &message);
            }
        }
    };
    let options = vec![
        SelectOption::new("Jump to", "message.jump")
            .description("view message in session")
            .on_select(|dialogs| dialogs.clear()),
        SelectOption::new("Revert", "session.revert")
            .description("undo messages and file changes")
            .on_select(action(revert)),
        SelectOption::new("Copy", "message.copy").description("message text to clipboard").on_select(action(copy)),
        SelectOption::new("Fork", "session.fork").description("create a new session").on_select(action(fork)),
    ];
    tui.dialogs.replace(
        move |cx| {
            let mut props = SelectProps::new("Message Actions", options.clone());
            // `renderFilter={!newDesigns()}`.
            props.render_filter = false;
            select::select(cx, props).0
        },
        None,
        DialogOptions::default(),
    );
}

/// Stages a revert to the message; once it is staged, a user message's text goes back into the composer. The
/// dialog closes at once.
fn revert(tui: &Tui, dialogs: &Dialogs, session: &SessionID, message: &str) {
    let restored = tui.data.read(|state| match state.message(session, message) {
        Some(SessionMessageInfo::User(user)) => Some(user.text.clone()),
        _ => None,
    });
    let client = tui.data.client().clone();
    let input = SessionRevertStageInput {
        session_id: session.clone(),
        message_id: SessionMessageID(message.to_owned()),
        files: None,
    };
    let (weak, session) = (tui.weak(), session.clone());
    tui.app.spawn(
        async move { client.session_revert_stage(&input, &RequestOptions::default()).await },
        move |_, result| {
            let Some(tui) = weak.upgrade() else { return };
            match (result, restored) {
                (Ok(_), Some(text)) => crate::routes::session::actions::append_prompt(&tui, &session, &text),
                (Ok(_), None) => {}
                (Err(error), _) => tui
                    .toasts
                    .show(ToastOptions::new(Variant::Error, error.to_string()).duration(Duration::from_millis(5000))),
            }
        },
    );
    dialogs.clear();
}

/// Copies a user message's text, a reply's text parts, or another message's `text`; it closes once copied.
fn copy(tui: &Tui, dialogs: &Dialogs, session: &SessionID, message: &str) {
    let Some(text) = tui.data.read(|state| state.message(session, message).map(text)) else {
        return;
    };
    if tui.app.copy_to_clipboard(&text) {
        dialogs.clear();
        return;
    }
    tui.toasts.error("Failed to copy to clipboard");
}

/// Forks before a user message at once (`DialogFork` with a `messageID`); other messages do nothing.
fn fork(tui: &Tui, _: &Dialogs, session: &SessionID, message: &str) {
    let user = tui.data.read(|state| matches!(state.message(session, message), Some(SessionMessageInfo::User(_))));
    if user {
        crate::dialogs::fork::show(tui, session.clone(), Some(message.to_owned()), Rc::new(|_, _| {}));
    }
}

fn text(message: &SessionMessageInfo) -> String {
    match message {
        SessionMessageInfo::User(user) => user.text.clone(),
        SessionMessageInfo::Assistant(assistant) => assistant
            .content
            .iter()
            .filter_map(|content| match content {
                SessionMessageAssistantContentItem::Text(text) => Some(text.text.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("\n"),
        // `"text" in value ? value.text : ""`.
        SessionMessageInfo::Synthetic(message) => message.text.clone(),
        SessionMessageInfo::System(message) => message.text.clone(),
        SessionMessageInfo::Skill(message) => message.text.clone(),
        SessionMessageInfo::Unknown(value) => {
            value.get("text").and_then(serde_json::Value::as_str).unwrap_or_default().to_owned()
        }
        _ => String::new(),
    }
}
