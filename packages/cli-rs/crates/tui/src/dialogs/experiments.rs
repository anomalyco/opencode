//! Experiments dialog (E.18a): `packages/tui/src/component/dialog-experiments.tsx`.
//!
//! The registry, the dialog, the toggle, and its persistence under `cli.json` `experimental.<id>` are permanent
//! infrastructure (`packages/tui/AGENTS.md`): keep them when [`EXPERIMENTS`] is empty.

use std::cell::RefCell;
use std::rc::Rc;

use opencode_ui::bind;
use opencode_ui::dialog::DialogOptions;
use opencode_ui::keymap::TuiCommand;
use opencode_ui::select::{SelectOption, SelectProps, select};
use serde_json::Value;

use super::settings::{self, set_path};
use crate::app::Tui;

pub struct Experiment {
    pub id: &'static str,
    pub title: &'static str,
    pub description: &'static str,
}

/// In-flight features anyone can opt into. Each entry is temporary: an experiment either graduates (delete the
/// entry, make the behavior unconditional) or dies (delete the entry and the branch it gated). `new-designs`
/// graduated here: the Rust client draws only the new designs, though the TypeScript TUI still lists it.
pub const EXPERIMENTS: &[Experiment] = &[Experiment {
    id: "client-mcp",
    title: "TUI tools",
    description: "Let the agent open terminals in this TUI (requires server support)",
}];

fn options(tui: &Tui) -> Vec<SelectOption<&'static str>> {
    EXPERIMENTS
        .iter()
        .map(|experiment| {
            let on = tui.settings.experiment(experiment.id);
            SelectOption::new(experiment.title, experiment.id).search_text(experiment.description).footer(if on {
                "on"
            } else {
                "off"
            })
        })
        .collect()
}

/// Flips experiment `id`. All experiments are booleans, so either direction toggles.
pub fn toggle(tui: &Tui, id: &'static str) {
    let next = !tui.settings.experiment(id);
    settings::update(tui, move |draft| set_path(draft, &["experimental", id], Value::Bool(next)));
}

/// `DialogExperiments`, in place of any open dialog.
pub fn show(tui: &Tui) {
    let weak = tui.weak();
    tui.dialogs.replace(
        bind!(weak, |tui, cx| {
            let any = !EXPERIMENTS.is_empty();
            let selected = Rc::new(RefCell::new(EXPERIMENTS.first().map(|e| e.id)));
            let mut props = SelectProps::new("Experiments", options(&tui));
            props.render_filter = any;
            props.on_move = Some(Rc::new({
                let selected = selected.clone();
                move |option| *selected.borrow_mut() = Some(option.value)
            }));
            props.on_select = Some(Rc::new(bind!(weak, |tui, option| toggle(&tui, option.value))));
            if any {
                let bind = |key: &str, title: &str| {
                    let (weak, selected) = (weak.clone(), selected.clone());
                    TuiCommand::inline(key, move |_, _| {
                        let id = *selected.borrow();
                        if let (Some(tui), Some(id)) = (weak.upgrade(), id) {
                            toggle(&tui, id);
                        }
                    })
                    .title(title)
                    .group("Experiments")
                };
                props.bindings = vec![bind("left", "Previous value"), bind("right", "Next value")];
            }
            let (view, handle) = select(cx, props);
            settings::refresh_on_change(&tui, Rc::downgrade(cx), move |tui| handle.set_options(options(tui)));
            view
        }, else opentui::prelude::View::new(&cx.app)),
        None,
        DialogOptions::default(),
    );
}
