//! Agent dialog (E.16): `component/dialog-agent.tsx`, "Select agent".

use std::rc::Rc;

use opencode_ui::bind;
use opencode_ui::dialog::DialogOptions;
use opencode_ui::select::{self, SelectOption, SelectProps};
use opentui::prelude::*;

use crate::local::Local;

pub fn show(local: &Rc<Local>) {
    local.dialogs.replace(
        bind!(local, |local, cx| {
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
            props.search_in_title = true;
            props.title_placeholder = Some("Search agents".to_owned());
            props.current = local.agent().map(|agent| agent.id.0);
            props.on_select = Some(Rc::new(bind!(local, |local, option: &SelectOption<String>| {
                local.set_agent(&option.value);
                local.dialogs.clear();
            })));
            select::select(cx, props).0
        }, else View::new(&cx.app)),
        None,
        DialogOptions::default(),
    );
}
