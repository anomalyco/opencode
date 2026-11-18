use opencode_plugin::RouteMount;

use super::RouteView;
use crate::prelude::*;

pub struct Plugin {
    root: View,
    content: Option<RouteMount>,
    /// Mount draws the plugin view. Its first sync in the same turn needs no second draw.
    fresh: Cell<bool>,
}

impl Plugin {
    pub fn new(tui: &Tui, id: &str, name: &str) -> Self {
        let content = crate::plugins::host::route(tui, id, name);
        let view = match &content {
            Some(content) => content.root(),
            None => crate::features::route_missing::mount(tui, id, name),
        };
        let root = View::new(&tui.app).column().grow(1.0).basis(Length::Auto).child(&view);
        Self { root, content, fresh: Cell::new(true) }
    }
}

impl RouteView for Plugin {
    fn root(&self) -> View {
        self.root.clone()
    }

    fn sync(&self, tui: &Tui, changes: &Changes) {
        if self.fresh.replace(false) {
            return;
        }
        if let Some(content) = &self.content {
            crate::plugins::host::changed(tui, changes, |changed| content.sync(tui, changed));
        }
    }

    fn restyle(&self, tui: &Tui) -> bool {
        self.content.as_ref().is_some_and(|content| content.restyle(tui))
    }
}
