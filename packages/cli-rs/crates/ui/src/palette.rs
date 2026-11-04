//! Command palette (U.3): `packages/tui/src/component/command-palette.tsx`.
//!
//! The palette lists every reachable palette command from [`DialogKeymap::commands`] with its shortcuts. Without a
//! filter, suggested commands come first again under `Suggested`; with one, the list is flat and the settings rows
//! join it. Choosing a command closes the palette and dispatches it.

use crate::dialog::{DialogCx, DialogKeymap, DialogOptions, Dialogs};
use crate::keymap::COMMAND_PALETTE_COMMAND;
use crate::select::{SelectOption, SelectProps, select};
use opentui::prelude::*;
use std::rc::Rc;

/// The palette's rows for the commands `keymap` can reach now.
pub fn command_options(keymap: &Rc<DialogKeymap>) -> Vec<(SelectOption<String>, bool)> {
    keymap
        .commands()
        .into_iter()
        .filter(|command| command.palette && command.id != COMMAND_PALETTE_COMMAND)
        .map(|command| {
            let footer = keymap.shortcut_all(&command.id);
            let search_text = [Some(command.id.clone()), command.description.clone()]
                .into_iter()
                .flatten()
                .filter(|part| !part.is_empty())
                .collect::<Vec<_>>()
                .join(" ");
            let search_footer = [command.group.clone(), footer.clone()]
                .into_iter()
                .flatten()
                .filter(|part| !part.is_empty())
                .collect::<Vec<_>>()
                .join(" · ");
            let id = command.id.clone();
            let run_keymap = Rc::downgrade(keymap);
            let mut option = SelectOption::new(
                command.title.clone().unwrap_or_else(|| command.id.clone()),
                command.id.clone(),
            )
            .search_text(search_text)
            .on_select(move |dialogs: &Dialogs| {
                dialogs.clear();
                if let Some(keymap) = run_keymap.upgrade() {
                    keymap.dispatch(&id, None);
                }
            });
            option.description = command.description.clone();
            option.category = command.group.clone();
            option.footer = footer;
            option.search_footer = Some(search_footer);
            (option, command.suggested)
        })
        .collect()
}

/// `CommandPaletteDialog`. `settings` are the settings rows (TS `settingOptions` of `dialog-config.tsx`), shown
/// only while filtering.
pub fn palette(cx: &Rc<DialogCx>, settings: Vec<SelectOption<String>>) -> View {
    let commands = command_options(&cx.keymap);
    let options = Rc::new(move |filter: &str| {
        if !filter.is_empty() {
            return commands
                .iter()
                .map(|(option, _)| option.clone())
                .chain(settings.iter().cloned())
                .collect();
        }
        let suggested = commands
            .iter()
            .filter(|(_, suggested)| *suggested)
            .map(|(option, _)| {
                let mut option = option.clone();
                option.value = format!("suggested:{}", option.value);
                option.category = Some("Suggested".to_owned());
                option
            });
        suggested
            .chain(commands.iter().map(|(option, _)| option.clone()))
            .collect()
    });
    let mut props = SelectProps::dynamic("Commands", options);
    props.search_in_title = true;
    props.title_placeholder = Some("Search commands".into());
    props.flat = true;
    props.filter_threshold = 0.7;
    select(cx, props).0
}

/// Opens the palette in place of any open dialog.
pub fn show(dialogs: &Dialogs, settings: Vec<SelectOption<String>>) {
    dialogs.replace(|cx| palette(cx, settings), None, DialogOptions::default());
}
