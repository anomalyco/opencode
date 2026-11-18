//! Home, session, and plugin route views.

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
    /// Apply the page theme without losing focus, scroll position, or widget state. Return false to request a remount.
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
