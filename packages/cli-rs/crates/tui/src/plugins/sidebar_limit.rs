//! The sidebar's limit section (E.14, row F05, `feature-plugins/sidebar/limit.tsx`): what the OpenCode Console
//! workspace's limits leave for the selected model, in the error color when it is out or reached. Hidden when
//! no limit applies to the model.

use opencode_plugin::{Definition, Placement, slot};
use opentui::prelude::*;

use crate::app::Tui;
use crate::dialogs::usage::{Level, format_dollars, level, model_usage};
use crate::routes::session::sidebar::Section;

pub fn plugin() -> Definition<Tui> {
    Definition::new("opencode.sidebar.limit", |cx| {
        // The limits and the selected model live outside the store, so any change reads them again.
        cx.slot(Placement::append(slot::SIDEBAR_CONTENT), |tui, _| {
            Box::new(Section::new(tui, None, |tui, _| model(tui), view))
        });
    })
}

/// What remains, and whether it is out or reached.
fn model(tui: &Tui) -> Option<(String, bool)> {
    let local = &tui.local;
    let model = local.model_info(&local.current()?)?;
    let info = local.usage()??;
    let provider = local.provider(&model.provider_id.0);
    let usage = model_usage(&info, &model, provider.as_ref())?;
    Some((format_dollars(usage.left), matches!(level(&usage, &model), Level::Out | Level::Reached)))
}

fn view(tui: &Tui, (left, danger): &(String, bool)) -> View {
    let theme = tui.page();
    let app = &tui.app;
    View::new(app).child(&Text::new(app, "Limit").fg(theme.text.base).bold()).child(
        &Text::new(app, format!("{left} remaining")).fg(if *danger {
            theme.text.feedback.error.base
        } else {
            theme.text.muted
        }),
    )
}
