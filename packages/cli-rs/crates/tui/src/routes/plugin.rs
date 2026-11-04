//! The plugin route (T.1): a route a plugin registers, or the missing route screen.

use opencode_store::Changes;
use opentui::prelude::*;

use super::RouteView;
use crate::app::Tui;

pub struct Plugin {
    root: View,
    content: Option<Box<dyn opencode_plugin::Slotted<Tui>>>,
}

impl Plugin {
    pub fn new(tui: &Tui, id: &str, name: &str) -> Self {
        let content = crate::plugins::host::route(tui, id, name);
        let view = content
            .as_ref()
            .map(|content| content.root())
            .unwrap_or_else(|| crate::features::route_missing::mount(tui, id, name));
        let root = View::new(&tui.app)
            .column()
            .grow(1.0)
            .basis(Length::Auto)
            .child(&view);
        Self { root, content }
    }
}

impl RouteView for Plugin {
    fn root(&self) -> View {
        self.root.clone()
    }

    fn sync(&self, tui: &Tui, changes: &Changes) {
        if let Some(content) = &self.content {
            content.sync(tui, changes);
        }
    }
}
