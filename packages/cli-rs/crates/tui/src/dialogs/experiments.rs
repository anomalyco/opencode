//! Experiments dialog (E.18a): `packages/tui/src/component/dialog-experiments.tsx`.
//!
//! The registry, the dialog, the toggle, and its persistence under `cli.json` `experimental.<id>` are permanent
//! infrastructure (`packages/tui/AGENTS.md`): keep them when [`EXPERIMENTS`] is empty.

use opencode_ui::select::select;

use super::settings::{self, set_path};

use crate::prelude::*;

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

/// Flips experiment `id`. All experiments are booleans, so either direction toggles. While `saving` holds, the
/// previous change is still being written and this one is ignored, as in TS.
fn toggle(tui: &Tui, saving: &Rc<Cell<bool>>, id: &'static str) {
    if saving.get() {
        return;
    }
    let next = !tui.settings.experiment(id);
    saving.set(true);
    let saving = saving.clone();
    settings::write(
        tui,
        move |draft| set_path(draft, &["experimental", id], Value::Bool(next)),
        move |_| saving.set(false),
    );
}

/// `DialogExperiments`, in place of any open dialog.
pub fn show(tui: &Tui) {
    let weak = tui.weak();
    // Outside the build: a build in a new theme keeps ignoring changes until the write ends.
    let saving = Rc::new(Cell::new(false));
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
            props.on_select = Some(Rc::new({
                let saving = saving.clone();
                bind!(weak, |tui, option| toggle(&tui, &saving, option.value))
            }));
            if any {
                let bind = |key: &str, title: &str| {
                    let (weak, selected, saving) = (weak.clone(), selected.clone(), saving.clone());
                    TuiCommand::inline(key, move |_, _| {
                        let id = *selected.borrow();
                        if let (Some(tui), Some(id)) = (weak.upgrade(), id) {
                            toggle(&tui, &saving, id);
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
