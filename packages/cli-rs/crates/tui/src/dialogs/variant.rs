//! Variant dialog (E.16): `component/dialog-variant.tsx`, "Select variant".

use std::rc::Rc;

use opencode_ui::bind;
use opencode_ui::dialog::DialogOptions;
use opencode_ui::select::{self, SelectOption, SelectProps};
use opentui::prelude::*;

use crate::local::Local;

pub fn show(local: &Rc<Local>) {
    local.dialogs.replace(
        bind!(local, |local, cx| {
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
            props.render_filter = false;
            props.flat = true;
            props.current = Some(local.variant().unwrap_or_else(|| "default".to_owned()));
            props.on_select = Some(Rc::new(bind!(local, |local, option: &SelectOption<String>| {
                local.dialogs.clear();
                local.set_variant((option.value != "default").then_some(option.value.as_str()));
            })));
            select::select(cx, props).0
        }, else View::new(&cx.app)),
        None,
        DialogOptions::default(),
    );
}
