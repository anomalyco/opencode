//! The sidebar's limit section (E.14, row F05, `feature-plugins/sidebar/limit.tsx`): what the OpenCode Console
//! workspace's limits leave for the selected model, in the error color when it is out or reached. Hidden when
//! no limit applies to the model.

use std::rc::Rc;

use opencode_plugin::{Definition, Placement, Slotted, slot};
use opencode_store::Changes;
use opentui::keymap::Disposer;
use opentui::prelude::*;

use crate::app::Tui;
use crate::dialogs::usage::{Level, format_dollars, level, model_usage};
use crate::routes::session::sidebar::Section;

pub fn plugin() -> Definition<Tui> {
    Definition::new("opencode.sidebar.limit", |cx| {
        cx.slot(Placement::append(slot::SIDEBAR_CONTENT), |tui, _| {
            let section = Rc::new(Section::new(tui, None, |tui, _| model(tui), view));
            // The limits and the selected model live outside the store: they load or change without a store
            // change, so `tui.local` refreshes the section too.
            let weak = Rc::downgrade(&section);
            let tui_weak = tui.weak();
            let listener = tui.local.subscribe(move || {
                if let (Some(section), Some(tui)) = (weak.upgrade(), tui_weak.upgrade()) {
                    section.sync(&tui, &Changes::everything());
                }
            });
            Box::new(Limit { section, _listener: listener })
        });
    })
}

struct Limit {
    section: Rc<Section<(String, bool)>>,
    _listener: Disposer,
}

impl Slotted<Tui> for Limit {
    fn root(&self) -> View {
        self.section.root()
    }

    // Any store change reads the limits and the selected model again.
    fn sync(&self, tui: &Tui, changes: &Changes) {
        self.section.sync(tui, changes);
    }
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
