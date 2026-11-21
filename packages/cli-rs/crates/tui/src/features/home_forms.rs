//! Show the current location's global form over home. The prompt keeps its place but yields its keys.

use opencode_store::Location;
use opencode_store::forms::GLOBAL;

use crate::prelude::*;
use crate::routes::session::form::{Host, quiet};

pub struct HomeForms {
    host: Host,
    read: RefCell<Option<Location>>,
}

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
    HomeForms { host: Host::new(tui, overlay), read: RefCell::default() }
}

impl HomeForms {
    pub fn restyle(&self) {
        self.host.restyle();
    }

    pub fn active(&self) -> bool {
        self.host.active()
    }

    /// Shows the first global form of the home's location. Returns true when a form closed, so the home gives its
    /// prompt the keys back.
    pub fn sync(&self, tui: &Tui, changes: &Changes) -> bool {
        let location = crate::features::location::home_target(tui);
        // A full sync (a reconnect) reads again: the store invalidated what it read before.
        if self.read.borrow().as_ref() != Some(&location) || changes.all {
            quiet(tui, tui.data.form_sync(GLOBAL, Some(&location)));
            *self.read.borrow_mut() = Some(location.clone());
        }
        let form = tui.data.read(|state| {
            state.forms(GLOBAL, Some(&location)).and_then(|forms| forms.first().map(|form| (*form).clone()))
        });
        let before = self.host.active();
        self.host.show(form.as_ref());
        before && !self.host.active()
    }
}
