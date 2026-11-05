//! Alert dialog (U.3): `packages/tui/src/ui/dialog-alert.tsx`.

use crate::dialog::{DialogCx, DialogOptions, Dialogs, FooterAction, FooterProps, HeaderProps, header, layout};
use crate::keymap::{KeymapLayer, TuiCommand};
use opentui::prelude::*;
use std::rc::Rc;

/// `DialogAlertProps`.
#[derive(Clone, Default)]
pub struct AlertProps {
    pub title: String,
    pub message: String,
    pub on_confirm: Option<Rc<dyn Fn()>>,
}

/// `DialogAlert`: a title, a muted message, and `ok` on Enter.
pub fn alert(cx: &Rc<DialogCx>, props: AlertProps) -> View {
    let confirm: Rc<dyn Fn()> = {
        let dialogs = cx.dialogs.clone();
        let on_confirm = props.on_confirm.clone();
        Rc::new(move || {
            if let Some(on_confirm) = &on_confirm {
                on_confirm();
            }
            dialogs.clear();
        })
    };
    let run = confirm.clone();
    cx.layer(KeymapLayer::new(vec![
        TuiCommand::inline("return", move |_, _| run()).title("Confirm alert").group("Dialog"),
    ]));
    let run = confirm.clone();
    layout(
        cx,
        &header(cx, HeaderProps::new(props.title)),
        &Text::new(&cx.app, props.message).fg(cx.theme.text.muted),
        Some(FooterProps {
            primary: vec![FooterAction::new("ok").key("enter").on_trigger(move || run())],
            ..FooterProps::default()
        }),
    )
}

/// Opens an alert in place of any open dialog.
pub fn show(dialogs: &Dialogs, props: AlertProps) {
    dialogs.replace(|cx| alert(cx, props), None, DialogOptions::default());
}
