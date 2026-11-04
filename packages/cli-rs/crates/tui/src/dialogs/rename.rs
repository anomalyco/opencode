//! Rename dialog (E.10a, row DLG17): `packages/tui/src/component/dialog-session-rename.tsx`. E.11a
//! wrote it for the session list's rename action; E.10a binds `session.rename` to it.

use std::rc::Rc;
use std::time::Duration;

use opencode_api::client::RequestOptions;
use opencode_api::generated::{SessionID, SessionUpdateInput};
use opencode_ui::dialog::DialogOptions;
use opencode_ui::prompt::{PromptProps, prompt};
use opencode_ui::toast::{ToastOptions, Variant};

use crate::app::Tui;

/// `DialogSessionRename.show`: replaces the open dialogs with the rename prompt.
pub fn show(tui: &Tui, session: SessionID, title: Option<String>) {
    let weak = tui.weak();
    let clear = tui.dialogs.clone();
    tui.dialogs.replace(
        move |cx| {
            let (view, _) = prompt(
                cx,
                PromptProps {
                    title: "Rename session".into(),
                    placeholder: Some("Session title".into()),
                    value: title,
                    on_confirm: Some(Rc::new(move |value: &str| {
                        let title = value.trim().to_owned();
                        let Some(tui) = weak.upgrade() else { return };
                        if title.is_empty() {
                            return;
                        }
                        rename(&tui, session.clone(), title);
                    })),
                    on_cancel: Some(Rc::new(move || clear.clear())),
                    ..PromptProps::default()
                },
            );
            view
        },
        None,
        DialogOptions::default(),
    );
}

fn rename(tui: &Tui, session: SessionID, title: String) {
    let client = tui.data.client().clone();
    let input = SessionUpdateInput {
        session_id: session,
        title: Some(title),
        ..SessionUpdateInput::default()
    };
    let weak = tui.weak();
    tui.app.spawn(
        async move { client.session_update(&input, &RequestOptions::default()).await },
        move |_, result| {
            let Some(tui) = weak.upgrade() else { return };
            match result {
                Ok(()) => tui.dialogs.clear(),
                Err(error) => tui.toasts.show(
                    ToastOptions::new(
                        Variant::Error,
                        format!("Failed to rename session: {error}"),
                    )
                    .duration(Duration::from_millis(5000)),
                ),
            }
        },
    );
}
