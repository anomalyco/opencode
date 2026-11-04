//! The plugin host (P.1): built-in plugins on the plugin API, by `SlotMap` path. T.1 asks it for
//! plugin routes.

use opentui::prelude::View;

use crate::app::Tui;

/// The view of plugin route `id`/`name`, if a plugin registers it.
pub fn route(_tui: &Tui, _id: &str, _name: &str) -> Option<View> {
    None
}
