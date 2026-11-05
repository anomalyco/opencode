//! Skills dialog (E.17b, row DLG19): `packages/tui/src/component/dialog-skill.tsx`.
//!
//! "Skills": the location's skills, read once if the store has none, with the description after
//! the padded name. Choosing one hands its ID to the caller and closes the dialog; the prompt
//! inserts an `@skill` mention as a prompt part (`prompt::autocomplete::parts::insert_skill`).

use std::cell::Cell;
use std::rc::Rc;

use opencode_api::generated::{SkillID, SkillInfo};
use opencode_store::{Catalog, Location};
use opencode_ui::dialog::{DIALOG_LIST_INSET, DialogOptions, DialogSize};
use opencode_ui::select::{self, SelectOption, SelectProps};
use opentui::prelude::*;

use crate::app::Tui;

/// What choosing a skill does.
pub type OnSelect = Rc<dyn Fn(&Tui, &SkillID)>;

/// Opens the dialog for `location` (the default one for `None`).
pub fn show(tui: &Tui, location: Option<Location>, on_select: OnSelect) {
    let location = location.unwrap_or_else(|| tui.data.read(|state| state.default_location().clone()));
    let cached = tui.data.read(|state| state.location(Some(&location)).and_then(|data| data.skill.clone()));
    if let Some(skills) = cached {
        open(tui, Load::Loaded(skills), on_select);
        return;
    }
    let open_now = open(tui, Load::Loading, on_select.clone());
    let weak = tui.weak();
    let read = location.clone();
    tui.app.spawn(tui.data.catalog_sync(Catalog::Skill, Some(&location)), move |_, result| {
        let Some(tui) = weak.upgrade() else { return };
        // Closed meanwhile: reopening it would surprise.
        if !open_now.get() {
            return;
        }
        let load = match result {
            Ok(()) => Load::Loaded(
                tui.data
                    .read(|state| state.location(Some(&read)).and_then(|data| data.skill.clone()).unwrap_or_default()),
            ),
            Err(error) => Load::Failed(error.to_string()),
        };
        open(&tui, load, on_select);
    });
}

enum Load {
    Loading,
    Loaded(Vec<SkillInfo>),
    Failed(String),
}

/// Shows the dialog in `load`'s state. The returned flag clears when this dialog closes.
fn open(tui: &Tui, load: Load, on_select: OnSelect) -> Rc<Cell<bool>> {
    let alive = Rc::new(Cell::new(true));
    let flag = alive.clone();
    let weak = tui.weak();
    tui.dialogs.replace(
        move |cx| {
            let loaded = matches!(load, Load::Loaded(_));
            let options = match &load {
                Load::Loaded(skills) => options(skills),
                _ => Vec::new(),
            };
            let mut props = SelectProps::new("Skills", options);
            props.render_filter = loaded;
            props.locked = !loaded;
            props.on_select = Some(Rc::new(move |option: &SelectOption<SkillID>| {
                let Some(tui) = weak.upgrade() else { return };
                let (id, on_select, weak) = (option.value.clone(), on_select.clone(), tui.weak());
                tui.app.defer(move |_| {
                    let Some(tui) = weak.upgrade() else { return };
                    on_select(&tui, &id);
                    tui.dialogs.clear();
                });
            }));
            let (app, theme) = (cx.app.clone(), cx.theme.clone());
            let inset = |children: Vec<AnyWidget>| {
                let view = View::new(&app).padding_x(DIALOG_LIST_INSET);
                for child in children {
                    view.add(&child);
                }
                view.as_any()
            };
            let empty = match &load {
                Load::Failed(error) => inset(vec![
                    Text::new(&app, "Could not load skills").fg(theme.text.feedback.error.base).bold().as_any(),
                    Text::new(&app, error.clone()).fg(theme.text.muted).as_any(),
                    Text::new(&app, "Close and reopen Skills to try again.").fg(theme.text.muted).as_any(),
                ]),
                Load::Loading => inset(vec![Text::new(&app, "Loading skills…").fg(theme.text.muted).as_any()]),
                Load::Loaded(_) => inset(vec![Text::new(&app, "No skills available").fg(theme.text.muted).as_any()]),
            };
            props.empty_view = Some(Rc::new(move || empty.clone()));
            let no_match = inset(vec![Text::new(&app, "No skills found").fg(theme.text.muted).as_any()]);
            props.no_match_view = Some(Rc::new(move || no_match.clone()));
            let (view, _) = select::select(cx, props);
            cx.on_close(opentui::keymap::Disposer::new(move || flag.set(false)));
            view
        },
        None,
        DialogOptions { size: DialogSize::Large, key: None },
    );
    alive
}

/// The rows: names padded to the longest, descriptions on one line.
fn options(skills: &[SkillInfo]) -> Vec<SelectOption<SkillID>> {
    // `padEnd` counts UTF-16 units; skill names are ASCII identifiers.
    let width = skills.iter().map(|skill| skill.name.0.chars().count()).max().unwrap_or(0);
    skills
        .iter()
        .map(|skill| {
            let mut option = SelectOption::new(format!("{:<width$}", skill.name.0), skill.id.clone());
            option.description = skill
                .description
                .as_deref()
                .map(|text| text.split_whitespace().collect::<Vec<_>>().join(" "))
                .filter(|text| !text.is_empty());
            option
        })
        .collect()
}
