//! The plugin route (T.1): a route a plugin registers, or the missing route screen.

use opencode_store::Changes;
use opentui::prelude::*;

use super::RouteView;
use crate::app::Tui;

pub struct Plugin {
    root: View,
}

impl Plugin {
    pub fn new(tui: &Tui, id: &str, name: &str) -> Self {
        let content = crate::plugins::host::route(tui, id, name)
            .unwrap_or_else(|| crate::features::route_missing::mount(tui, id, name));
        let root = View::new(&tui.app)
            .column()
            .grow(1.0)
            .basis(Length::Auto)
            .child(&content);
        Self { root }
    }
}

impl RouteView for Plugin {
    fn root(&self) -> View {
        self.root.clone()
    }

    fn sync(&self, _tui: &Tui, _changes: &Changes) {}
}
