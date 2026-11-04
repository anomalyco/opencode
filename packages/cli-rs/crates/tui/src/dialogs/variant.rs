//! Variant dialog (E.16): `component/dialog-variant.tsx`, "Select variant".

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
            let options = std::iter::once(SelectOption::new("Default", "default".to_owned()))
                .chain(
                    local
                        .variants()
                        .into_iter()
                        .filter(|variant| variant != "default")
                        .map(|variant| SelectOption::new(variant.clone(), variant)),
                )
                .collect();
            let mut props = SelectProps::new("Select variant", options);
            props.render_filter = !cx.new_designs;
            props.flat = true;
            props.current = Some(local.variant().unwrap_or_else(|| "default".to_owned()));
            let weak = Rc::downgrade(&local);
            props.on_select = Some(Rc::new(move |option: &SelectOption<String>| {
                let Some(local) = weak.upgrade() else { return };
                local.dialogs.clear();
                local.set_variant((option.value != "default").then_some(option.value.as_str()));
            }));
            select::select(cx, props).0
        },
        None,
        DialogOptions::default(),
    );
}
