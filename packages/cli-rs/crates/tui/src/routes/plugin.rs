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
    /// Not synced yet. The TUI syncs a route it has just mounted, in the same turn (`Tui::navigate`); the plugin's
    /// content drew as it mounted, so that first sync brings nothing new (review bigboi-7: a route's first frame ran
    /// two views).
    fresh: Cell<bool>,
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
        Self { root, content, _viewer: viewer, fresh: Cell::new(true) }
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

    /// A plugin's route keeps its widgets and their state, its scroll offsets among them; the diff viewer and the
    /// missing route mount again.
    fn restyle(&self, tui: &Tui) -> bool {
        self.content.as_ref().is_some_and(|content| content.restyle(tui))
    }
}
