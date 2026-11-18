//! The sidebar's limit section (E.14, row F05, `feature-plugins/sidebar/limit.tsx`): what the OpenCode Console
//! workspace's limits leave for the selected model, in the error color when it is out or reached. Hidden when
//! no limit applies to the model. It is a plugin of the one API (O-67), on contract 2.0 (P6a).

use opencode_plugin::abi::v2::{Node, Place, Surface};
use opencode_plugin::abi::{self, Placement, Span};
use opencode_plugin::slot;

use super::{hidden, kept};
use crate::dialogs::usage::{Level, format_dollars, level, model_usage};

pub fn plugin() -> abi::Plugin {
    abi::Plugin { id: "opencode.sidebar.limit", setup }
}

const ROOT: &str = "limit";

fn setup(setup: &mut abi::Setup) -> Result<(), String> {
    setup.surface(Surface::new("limit", Place::Slot(Placement::append(slot::SIDEBAR_CONTENT)), |cx| {
        let changed = &cx.input.changed;
        if !(changed.all || changed.local || !changed.sessions.is_empty() || !changed.locations.is_empty()) {
            return kept(ROOT);
        }
        let Some((left, danger)) = model(cx.read) else { return hidden(ROOT) };
        Node::column(vec![
            Node::text([Span::new("Limit").fg("text.base").bold()]),
            Node::text([Span::new(format!("{left} remaining")).fg(if danger {
                "text.feedback.error.base"
            } else {
                "text.muted"
            })]),
        ])
        .with_id(ROOT)
    }));
    Ok(())
}

fn model(read: &dyn abi::Read) -> Option<(String, bool)> {
    let selected = read.model()?;
    let model = read
        .models(None)?
        .into_iter()
        .find(|model| model.provider_id == selected.provider_id && model.id == selected.id)?;
    let info = read.limits()?;
    let provider =
        read.providers().and_then(|providers| providers.into_iter().find(|item| item.id == model.provider_id));
    let usage = model_usage(&info, &model, provider.as_ref())?;
    Some((format_dollars(usage.left), matches!(level(&usage, &model), Level::Out | Level::Reached)))
}
