//! Routes (T.1, row T01): `home`, `session`, and `plugin` (`context/route.tsx`).

pub mod home;
pub mod location_missing;
pub mod plugin;
pub mod session;

use opentui::prelude::{AnyWidget, View};

use crate::prelude::*;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Route {
    Home,
    Session { id: SessionID },
    Plugin { id: String, name: String },
}

/// A mounted route. `sync` updates the widgets `changes` names; it gets everything once after mounting.
pub trait RouteView {
    fn root(&self) -> View;
    fn sync(&self, tui: &Tui, changes: &Changes);
    /// The widget that takes the keys once nothing covers the view: on mount, or when a dialog over it closes.
    fn focus_target(&self) -> Option<AnyWidget> {
        None
    }
    /// Takes the page theme after a theme switch in place, as TS's views follow their theme: every widget keeps its
    /// state, the focus and the scroll positions. Returns false, by default, when the view must mount again instead.
    fn restyle(&self, _tui: &Tui) -> bool {
        false
    }
}

pub(crate) fn mount(tui: &Tui, route: &Route) -> Box<dyn RouteView> {
    match route {
        Route::Home => Box::new(home::Home::new(tui)),
        Route::Session { id } => Box::new(session::Session::new(tui, id.clone())),
        Route::Plugin { id, name } => Box::new(plugin::Plugin::new(tui, id, name)),
    }
}
