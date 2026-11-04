//! Agent dialog (E.16): `component/dialog-agent.tsx`, "Select agent".

use std::rc::Rc;

use opencode_ui::dialog::DialogOptions;
use opencode_ui::select::{self, SelectOption, SelectProps};
use opentui::prelude::*;

use crate::dialogs::model::Local;

pub fn show(local: &Rc<Local>) {
    let weak = Rc::downgrade(local);
    local.dialogs.replace(
        move |cx| {
            let Some(local) = weak.upgrade() else {
                return View::new(&cx.app);
            };
            let options = local
                .agents()
                .into_iter()
                .map(|agent| {
                    let option = SelectOption::new(agent.id.0.clone(), agent.id.0);
                    match agent.description {
                        Some(description) => option.description(description),
                        None => option,
                    }
                })
                .collect();
            let mut props = SelectProps::new("Select agent", options);
            props.placeholder = cx.new_designs.then(|| "Search agents".to_owned());
            props.current = local.agent().map(|agent| agent.id.0);
            let weak = Rc::downgrade(&local);
            props.on_select = Some(Rc::new(move |option: &SelectOption<String>| {
                let Some(local) = weak.upgrade() else { return };
                local.set_agent(&option.value);
                local.dialogs.clear();
            }));
            select::select(cx, props).0
        },
        None,
        DialogOptions::default(),
    );
}
