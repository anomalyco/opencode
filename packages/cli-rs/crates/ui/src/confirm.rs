//! Confirm dialog (U.3): `packages/tui/src/ui/dialog-confirm.tsx`.

use crate::dialog::{DialogCx, FooterAction, FooterProps, HeaderProps, header, layout};
use crate::keymap::{KeymapLayer, TuiCommand};
use opentui::prelude::*;
use std::rc::Rc;

/// `DialogConfirmProps`.
#[derive(Clone, Default)]
pub struct ConfirmProps {
    pub title: String,
    pub message: String,
    pub on_confirm: Option<Rc<dyn Fn()>>,
    pub on_cancel: Option<Rc<dyn Fn()>>,
    /// Button labels; `confirm` and `cancel` by default.
    pub confirm_label: Option<String>,
    pub cancel_label: Option<String>,
}

/// `DialogConfirm`: Enter confirms and Escape cancels, as the footer's `cancel esc` and `confirm enter` say.
pub fn confirm(cx: &Rc<DialogCx>, props: ConfirmProps) -> View {
    let choose = |confirm: bool| {
        let dialogs = cx.dialogs.clone();
        let run = if confirm {
            props.on_confirm.clone()
        } else {
            props.on_cancel.clone()
        };
        move || {
            if let Some(run) = &run {
                run();
            }
            dialogs.clear();
        }
    };
    let (yes, no) = (choose(true), choose(false));
    cx.layer(KeymapLayer {
        commands: vec![
            TuiCommand::inline("return", move |_, _| yes())
                .title("Confirm")
                .group("Dialog"),
            TuiCommand::inline("escape", move |_, _| no())
                .title("Cancel")
                .group("Dialog"),
        ],
        ..KeymapLayer::default()
    });
    let label = |label: &Option<String>, fallback: &str| {
        label.as_deref().unwrap_or(fallback).to_lowercase()
    };
    layout(
        cx,
        &header(
            cx,
            HeaderProps {
                title: props.title.clone(),
                ..HeaderProps::default()
            },
        ),
        &Text::new(&cx.app, props.message.as_str()).fg(cx.theme.text.muted),
        Some(FooterProps {
            // Footer labels are lowercase.
            primary: vec![
                FooterAction::new(label(&props.cancel_label, "cancel"))
                    .key("esc")
                    .on_trigger(choose(false)),
                FooterAction::new(label(&props.confirm_label, "confirm"))
                    .key("enter")
                    .on_trigger(choose(true)),
            ],
            ..FooterProps::default()
        }),
    )
}

/// `Locale.titlecase`: upper-cases the first letter of each word.
pub fn titlecase(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut word = false;
    for char in text.chars() {
        let is_word = char.is_ascii_alphanumeric() || char == '_';
        out.push(if is_word && !word {
            char.to_ascii_uppercase()
        } else {
            char
        });
        word = is_word;
    }
    out
}
