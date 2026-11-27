//! Sidebar warning for the selected model's remaining workspace allowance.

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
    let models = read.models(None)?;
    let model = models.iter().find(|model| model.provider_id == selected.provider_id && model.id == selected.id)?;
    let info = read.limits()?;
    let providers = read.providers(None);
    let provider =
        providers.as_deref().and_then(|providers| providers.iter().find(|item| item.id == model.provider_id));
    let usage = model_usage(&info, model, provider)?;
    Some((format_dollars(usage.left), matches!(level(&usage, model), Level::Out | Level::Reached)))
}
