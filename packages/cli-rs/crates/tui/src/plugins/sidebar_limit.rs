//! The sidebar's limit section (E.14, row F05, `feature-plugins/sidebar/limit.tsx`): what the OpenCode Console
//! workspace's limits leave for the selected model, in the error color when it is out or reached. Hidden when
//! no limit applies to the model. It is a plugin of the one API (O-67).

use opencode_plugin::abi::{self, Node, Placement, Render, Span};
use opencode_plugin::slot;

use crate::dialogs::usage::{Level, format_dollars, level, model_usage};

pub fn plugin() -> abi::Plugin {
    abi::Plugin { id: "opencode.sidebar.limit", setup }
}

fn setup(setup: &mut abi::Setup) -> Result<(), String> {
    setup.slot(Placement::append(slot::SIDEBAR_CONTENT), |read, _, changed| {
        // The limits and the selected model live in the host's own state (`local`); the selection also follows the
        // sessions, and the models and providers their location.
        if !(changed.all || changed.local || !changed.sessions.is_empty() || !changed.locations.is_empty()) {
            return Render::Keep;
        }
        model(read).map_or(Render::Hide, |(left, danger)| {
            Render::Show(Node::column(vec![
                Node::text([Span::new("Limit").fg("text.base").bold()]),
                Node::text([Span::new(format!("{left} remaining")).fg(if danger {
                    "text.feedback.error.base"
                } else {
                    "text.muted"
                })]),
            ]))
        })
    });
    Ok(())
}

/// What remains, and whether it is out or reached.
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
