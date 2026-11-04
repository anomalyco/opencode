//! The missing plugin route screen (E.1, row T26). T.1's stand-in names the route.

use opentui::prelude::*;

use crate::app::Tui;

pub fn mount(tui: &Tui, id: &str, name: &str) -> View {
    let text =
        Text::new(&tui.app, format!("Unknown plugin route: {id}/{name}")).fg(tui.page().text.muted);
    View::new(&tui.app).padding(1).child(&text)
}
