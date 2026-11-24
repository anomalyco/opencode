//! Select the current model's speed (`DialogSpeed`).

use opencode_ui::locale::titlecase;

use crate::local::{Local, Speed};
use crate::prelude::*;

const STANDARD: &str = "standard";

pub fn show(local: &Rc<Local>) {
    local.dialogs.replace(
        bind!(local, |local, cx| {
            // Slowest to fastest, with the model's standard speed between the slower and the faster ones.
            let speeds = local.speeds();
            let option = |speed: &Speed| {
                let mut option = SelectOption::new(titlecase(&speed.id), speed.id.clone());
                option.footer = speed.price.map(|price| format!("{}× price", (price * 100.0).round() / 100.0));
                option
            };
            let options = speeds
                .iter()
                .filter(|speed| !speed.faster)
                .map(option)
                .chain([SelectOption::new("Standard", STANDARD.to_owned())])
                .chain(speeds.iter().filter(|speed| speed.faster).map(option))
                .collect();
            let mut props = SelectProps::new("Select speed", options);
            props.render_filter = false;
            props.flat = true;
            props.current = Some(local.speed().unwrap_or_else(|| STANDARD.to_owned()));
            props.on_select = Some(Rc::new(bind!(local, |local, option: &SelectOption<String>| {
                local.dialogs.clear();
                local.set_speed((option.value != STANDARD).then_some(option.value.as_str()));
            })));
            select::select(cx, props).0
        }, else View::new(&cx.app)),
        None,
        DialogOptions::default(),
    );
}
