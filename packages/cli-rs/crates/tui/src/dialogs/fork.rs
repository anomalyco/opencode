//! Fork dialog (E.10a, row DLG37): `routes/session/dialog-fork.tsx`. "Full session", then the session's prompts,
//! newest first. A pick forks the session before that prompt (`POST /api/session/:id/fork`), opens the fork, and
//! puts the prompt back in its composer.

use opencode_api::generated::{SessionForkInput, SessionID, SessionMessageID, SessionMessageInfo};
use opencode_ui::bind;
use opencode_ui::dialog::{DIALOG_LIST_INSET, DialogOptions, DialogSize, HeaderProps, header, layout_with};
use opencode_ui::motion::Spinner;
use opencode_ui::select::{self, SelectOption, SelectProps};
use opencode_ui::toast::{ToastOptions, Variant};
use std::rc::Rc;
use std::time::Duration;

use crate::app::Tui;
use crate::dialogs::timeline::{prompts, time};
use crate::prompt::draft::Draft;
use crate::routes::Route;

/// Called with the highlighted prompt's ID, or `None` for "Full session" (`onMove`).
pub type OnMove = Rc<dyn Fn(&Tui, Option<String>)>;

/// `DialogFork`. With `message`, it forks before that prompt at once, as the message actions do.
pub fn show(tui: &Tui, session: SessionID, message: Option<String>, on_move: OnMove) {
    if let Some(message) = message {
        fork(tui, session, Some(message));
        return;
    }
    let pick = |message: Option<String>| {
        let session = session.clone();
        bind!(tui, |tui, _: &opencode_ui::dialog::Dialogs| fork(&tui, session.clone(), message.clone()))
    };
    let options: Vec<_> = std::iter::once(SelectOption::new("Full session", None).on_select(pick(None)))
        .chain(tui.data.read(|state| prompts(state.messages(&session))).into_iter().rev().map(
            |(id, title, created)| {
                SelectOption::new(title, Some(id.clone())).footer(time(created)).on_select(pick(Some(id)))
            },
        ))
        .collect();
    let weak = tui.weak();
    tui.dialogs.replace(
        move |cx| {
            let mut props = SelectProps::new("Fork session", options.clone());
            let weak = weak.clone();
            let on_move = on_move.clone();

            // TS passes no `current`, and `undefined === undefined` marks "Full session" with `●`.
            props.current = Some(None);
            props.on_move = Some(Rc::new(bind!(weak, |tui, option: &SelectOption<Option<String>>| on_move(
                &tui,
                option.value.clone()
            ))));
            select::select(cx, props).0
        },
        None,
        large(),
    );
}

/// `fork`: shows "Forking session…", forks, then opens the fork with the prompt it was forked before.
fn fork(tui: &Tui, session: SessionID, message: Option<String>) {
    pending(tui);
    let prompt = message.as_deref().and_then(|message| {
        tui.data.read(|state| match state.message(&session, message) {
            Some(SessionMessageInfo::User(user)) => Some(crate::routes::session::actions::projected(
                &user.text,
                user.files.as_deref(),
                user.agents.as_deref(),
                user.skills.as_deref(),
            )),
            _ => None,
        })
    });
    let client = tui.data.client().clone();
    let input = SessionForkInput { session_id: session, before: message.map(SessionMessageID) };
    tui.app.spawn(
        async move { client.session_fork(&input).await },
        bind!(tui, |tui, _, result| {
            tui.dialogs.clear();
            let info = match result {
                Ok(info) => info,
                Err(error) => {
                    tui.toasts.show(
                        ToastOptions::new(Variant::Error, error.to_string()).duration(Duration::from_millis(5000)),
                    );
                    return;
                }
            };
            if let Some(prompt) = prompt {
                tui.prompt.drafts.save(Some(&info.id), Draft { prompt, cursor: u32::MAX });
            }
            // The fork opens with its directory and title known, as `startup` opens a session it read.
            let id = info.id.clone();
            tui.data.remember(info);
            tui.navigate(Route::Session { id });
            tui.toasts
                .show(ToastOptions::new(Variant::Success, "Forked session").duration(Duration::from_millis(4000)));
        }),
    );
}

/// The pending view: the header and a spinner, at the list inset.
fn pending(tui: &Tui) {
    tui.dialogs.replace(
        move |cx| {
            let spinner = Spinner::new(&cx.app).color(cx.theme.text.muted).label("Forking session…");
            layout_with(cx, &header(cx, HeaderProps::new("Fork session")), &spinner, None, DIALOG_LIST_INSET, 1)
        },
        None,
        large(),
    );
}

fn large() -> DialogOptions {
    DialogOptions::new(DialogSize::Large)
}
