//! Working directory dialog (E.20, row DLG42): `ui/working-directory-actions.tsx`. Clicking the prompt footer's
//! location opens "Working directory" with "Copy path", "Open folder", and "Workspaces".

use std::rc::Rc;

use opencode_ui::dialog::DialogOptions;
use opencode_ui::select::{self, SelectOption, SelectProps};
use opencode_ui::toast::{ToastOptions, Variant};
use opentui::prelude::*;

use crate::app::Tui;

/// `openMenu`: does nothing while text is selected, so finishing a drag over the location does not open it.
pub fn show(tui: &Tui, directory: &str) {
    if tui.app.selected_text().is_some() {
        return;
    }
    let weak = tui.weak();
    let directory = directory.to_owned();
    tui.dialogs.replace(
        move |cx| {
            let Some(tui) = weak.upgrade() else {
                return View::new(&cx.app);
            };
            let mut props = SelectProps::new("Working directory", options(&tui, &directory));
            props.render_filter = false;
            select::select(cx, props).0
        },
        None,
        DialogOptions::default(),
    );
}

fn options(tui: &Rc<Tui>, directory: &str) -> Vec<SelectOption<String>> {
    let action = |run: fn(&Tui, &str)| {
        let (weak, directory) = (tui.weak(), directory.to_owned());
        move |_: &opencode_ui::dialog::Dialogs| {
            if let Some(tui) = weak.upgrade() {
                run(&tui, &directory);
            }
        }
    };
    vec![
        SelectOption::new("Copy path", "location.copy".to_owned())
            .description(directory)
            .on_select(action(|tui, directory| {
                // TS closes the dialog only once the write succeeded.
                if crate::features::selection::write(tui, directory) {
                    tui.dialogs.clear();
                    tui.toasts
                        .show(ToastOptions::new(Variant::Info, "Path copied to clipboard"));
                }
            })),
        SelectOption::new("Open folder", "location.open".to_owned())
            .description("in system file manager")
            .on_select(action(|tui, directory| {
                tui.dialogs.clear();
                if let Err(error) = crate::features::links::open_path(directory) {
                    tui.toasts.error(error);
                }
            })),
        // The prompt always passes `onMove`: its `session.move` command (E.11b).
        SelectOption::new("Workspaces", "session.move".to_owned())
            .description("to another working directory")
            .on_select(action(|tui, _| {
                tui.keymap.dispatch("session.move", None);
            })),
    ]
}
