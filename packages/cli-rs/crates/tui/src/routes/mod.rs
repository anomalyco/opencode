//! Routes (T.1, row T01): `home`, `session`, and `plugin` (`context/route.tsx`).

pub mod home;
pub mod location_missing;
pub mod plugin;
pub mod session;

use opencode_api::generated::SessionID;
use opencode_store::Changes;
use opentui::prelude::View;

use crate::app::Tui;

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
    fn focus(&self, _tui: &Tui) {}
}

pub(crate) fn mount(tui: &Tui, route: &Route) -> Box<dyn RouteView> {
    match route {
        Route::Home => Box::new(home::Home::new(tui)),
        Route::Session { id } => Box::new(session::Session::new(tui, id.clone())),
        Route::Plugin { id, name } => Box::new(plugin::Plugin::new(tui, id, name)),
    }
}
