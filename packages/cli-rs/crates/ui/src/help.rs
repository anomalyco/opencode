//! Help dialog (U.3): `packages/tui/src/ui/dialog-help.tsx`.

use crate::dialog::{
    DialogCx, DialogOptions, Dialogs, FooterAction, FooterProps, HeaderProps, header, layout,
};
use crate::keymap::{COMMAND_PALETTE_COMMAND, KeymapLayer, TuiCommand};
use opentui::prelude::*;
use std::rc::Rc;

/// `DialogHelp`: names the palette's shortcut; Enter and Escape close it.
pub fn help(cx: &Rc<DialogCx>) -> View {
    let close = |dialogs: &Dialogs| {
        let dialogs = dialogs.clone();
        move || dialogs.clear()
    };
    let (enter, escape) = (close(&cx.dialogs), close(&cx.dialogs));
    cx.layer(KeymapLayer {
        commands: vec![
            TuiCommand::inline("return", move |_, _| enter())
                .title("Close help")
                .group("Dialog"),
            TuiCommand::inline("escape", move |_, _| escape())
                .title("Close help")
                .group("Dialog"),
        ],
        ..KeymapLayer::default()
    });
    // TS interpolates `undefined` when the palette command has no shortcut.
    let shortcut = cx
        .keymap
        .shortcut(COMMAND_PALETTE_COMMAND)
        .unwrap_or_else(|| "undefined".to_owned());
    let message =
        format!("Press {shortcut} to see all available actions and commands in any context.");
    layout(
        cx,
        &header(
            cx,
            HeaderProps {
                title: "Help".to_owned(),
                close_label: Some("esc/enter".to_owned()),
                ..HeaderProps::default()
            },
        ),
        &Text::new(&cx.app, message).fg(cx.theme.text.muted),
        Some(FooterProps {
            primary: vec![
                FooterAction::new("ok")
                    .key("enter")
                    .on_trigger(close(&cx.dialogs)),
            ],
            ..FooterProps::default()
        }),
    )
}

/// Opens the help dialog in place of any open dialog.
pub fn show(dialogs: &Dialogs) {
    dialogs.replace(help, None, DialogOptions::default());
}
