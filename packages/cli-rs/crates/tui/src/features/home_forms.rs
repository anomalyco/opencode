//! The global form overlay on home (E.9b, row T30; `routes/home.tsx:36-38,109-120`). Global MCP elicitations can
//! arrive without a session route, so home shows the first one of its location over the screen's bottom. The home
//! prompt keeps its place but takes no keys meanwhile.

use std::cell::Cell;

use opencode_store::Changes;
use opencode_store::forms::GLOBAL;
use opentui::prelude::*;

use crate::app::Tui;
use crate::routes::session::form::{Host, quiet};

pub struct HomeForms {
    host: Host,
    read: Cell<bool>,
}

/// Mounts the overlay on `home`; the home calls [`HomeForms::sync`] on each store change.
pub fn mount(tui: &Tui, home: &View) -> HomeForms {
    let overlay = View::new(&tui.app)
        .absolute()
        .position(Edge::Left, 0)
        .position(Edge::Right, 0)
        .position(Edge::Bottom, 1)
        .padding_edge(Edge::Left, 2)
        .padding_edge(Edge::Right, 2)
        .z_index(2000)
        .column()
        .visible(false);
    home.add(&overlay);
    HomeForms { host: Host::new(tui, overlay), read: Cell::new(false) }
}

impl HomeForms {
    /// Whether a form shows; the home prompt is disabled meanwhile.
    pub fn active(&self) -> bool {
        self.host.active()
    }

    /// Shows the first global form of the default location. Returns true when a form closed, so the home gives its
    /// prompt the keys back.
    pub fn sync(&self, tui: &Tui, changes: &Changes) -> bool {
        // A full sync (a reconnect) reads again: the store invalidated what it read before.
        if !self.read.replace(true) || changes.all {
            quiet(tui, tui.data.form_sync(GLOBAL, None));
        }
        let form = tui.data.read(|state| {
            state
                .forms(GLOBAL, Some(state.default_location()))
                .and_then(|forms| forms.first().map(|form| (*form).clone()))
        });
        let before = self.host.active();
        self.host.show(form.as_ref());
        before && !self.host.active()
    }
}
