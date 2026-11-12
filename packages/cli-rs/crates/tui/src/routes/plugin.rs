//! The plugin route (T.1): a route a plugin registers, the diff viewer's route, or the missing route screen.

use opencode_plugin::RouteMount;

use super::RouteView;
use crate::plugins::diffs::viewer::{self, Viewer};
use crate::prelude::*;

pub struct Plugin {
    root: View,
    content: Option<RouteMount>,
    /// The diff viewer, a host entry, which lives as long as its route.
    _viewer: Option<Rc<Viewer>>,
}

impl Plugin {
    pub fn new(tui: &Tui, id: &str, name: &str) -> Self {
        let shared = (id, name) == (viewer::ID, viewer::ROUTE);
        let viewer =
            shared.then(|| tui.plugins.diffs.borrow().clone()).flatten().map(|shared| viewer::route(tui, &shared));
        let content = viewer.is_none().then(|| crate::plugins::host::route(tui, id, name)).flatten();
        let view = match (&viewer, &content) {
            (Some(viewer), _) => viewer.root(),
            (None, Some(content)) => content.root(),
            (None, None) => crate::features::route_missing::mount(tui, id, name),
        };
        let root = View::new(&tui.app).column().grow(1.0).basis(Length::Auto).child(&view);
        Self { root, content, _viewer: viewer }
    }
}

impl RouteView for Plugin {
    fn root(&self) -> View {
        self.root.clone()
    }

    fn sync(&self, tui: &Tui, changes: &Changes) {
        if let Some(content) = &self.content {
            crate::plugins::host::changed(tui, changes, |changed| content.sync(tui, changed));
        }
    }
}
