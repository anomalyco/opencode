//! Confirm dialog (U.3): `packages/tui/src/ui/dialog-confirm.tsx`.

use crate::dialog::{DIALOG_INSET, DialogButton, DialogButtons, DialogCx, HeaderProps, header, layout_view};
use crate::keymap::{KeymapLayer, TuiCommand};
use crate::tool_info::titlecase;
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
    /// Escape closes the dialog without the cancel button's action, as the header and the backdrop do, when the cancel
    /// button records an answer of its own.
    pub dismiss: bool,
    /// The cancel button is active at first, when confirming does what cannot be taken back.
    pub cancel_first: bool,
}

/// `DialogConfirm`: `Cancel` and `Confirm` buttons, `Confirm` active unless `cancel_first`. The arrows and Tab move
/// between them, Enter runs the active one, and Escape cancels, or with `dismiss` only closes.
pub fn confirm(cx: &Rc<DialogCx>, props: ConfirmProps) -> View {
    let choose = |confirm: bool| -> Rc<dyn Fn()> {
        let dialogs = cx.dialogs.clone();
        let run = if confirm { props.on_confirm.clone() } else { props.on_cancel.clone() };
        Rc::new(move || {
            if let Some(run) = &run {
                run();
            }
            dialogs.clear();
        })
    };
    let label = |label: &Option<String>, fallback: &str| titlecase(label.as_deref().unwrap_or(fallback));
    let buttons = DialogButtons::new(
        cx,
        vec![
            DialogButton { label: label(&props.cancel_label, "cancel"), run: choose(false) },
            DialogButton { label: label(&props.confirm_label, "confirm"), run: choose(true) },
        ],
        if props.cancel_first { 0 } else { 1 },
    );
    let command = |key: &str, title: &str, run: Box<dyn Fn(&DialogButtons)>| {
        let buttons = buttons.clone();
        TuiCommand::inline(key, move |_, _| run(&buttons)).title(title).group("Dialog")
    };
    let no = match props.dismiss {
        true => {
            let dialogs = cx.dialogs.clone();
            Rc::new(move || dialogs.clear()) as Rc<dyn Fn()>
        }
        false => choose(false),
    };
    cx.layer(KeymapLayer::new(vec![
        command("return", "Confirm dialog selection", Box::new(|buttons| buttons.run())),
        command("left", "Previous dialog option", Box::new(|buttons| buttons.step(-1))),
        command("right", "Next dialog option", Box::new(|buttons| buttons.step(1))),
        command("tab", "Next dialog option", Box::new(|buttons| buttons.step(1))),
        command("shift+tab", "Previous dialog option", Box::new(|buttons| buttons.step(-1))),
        TuiCommand::inline("escape", move |_, _| no()).title("Cancel").group("Dialog"),
    ]));
    layout_view(
        cx,
        &header(cx, HeaderProps::new(props.title.clone())),
        &Text::new(&cx.app, props.message.as_str()).fg(cx.theme.text.muted),
        Some(&buttons.view),
        DIALOG_INSET,
        1,
    )
}
