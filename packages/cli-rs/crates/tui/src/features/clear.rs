//! `session.clear` (`/clear`, row T25, `app.tsx:802-827`): closes the session's tab and goes home in the
//! new-session location, keeping the agent and model the session had. `session.new` (`app.tsx:775-800`) is the same
//! without closing the tab.

use std::rc::Rc;

use opencode_local::cli_config::NewLocation;
use opencode_store::Location;
use opencode_ui::bind;
use opencode_ui::keymap::{Bind, GLOBAL_MODE, KeymapLayer, Slash, TuiCommand};

use crate::app::Tui;
use crate::routes::Route;
use opentui::keymap::Disposer;

pub fn install(tui: &Rc<Tui>) {
    let command = TuiCommand::new("session.clear", bind!(tui, |tui, _, _| clear(&tui, true)))
        .bind(Bind::Off)
        .title("Clear session")
        .group("Session")
        .palette()
        .slash(Slash { name: "clear".to_owned(), aliases: Vec::new(), arguments: false });
    let layer = KeymapLayer { mode: Some(GLOBAL_MODE.to_owned()), commands: vec![command], ..KeymapLayer::default() };
    // The layer lives as long as the keymap, which the TUI owns.
    if let Err(error) = tui.keymap.layer(layer).map(Disposer::forget) {
        log::error!("clear keymap layer: {error}");
    }
}

/// `session.clear`, or `session.new` when `close_tab` is false.
pub fn clear(tui: &Tui, close_tab: bool) {
    let model = tui.local.current();
    let agent = tui.local.agent();
    let location = new_location(tui);
    if close_tab {
        crate::tabs::close(tui, None);
    }
    crate::features::location::navigate_home(tui, Some(location));
    if let Some(agent) = agent {
        tui.local.set_agent(&agent.id.0);
    }
    if let Some(model) = model {
        tui.local.set(&model, false);
    }
    tui.dialogs.clear();
}

/// Goes home in the new-session location (the tab strip's `add`).
pub fn navigate_new(tui: &Tui) {
    let location = new_location(tui);
    crate::features::location::navigate_home(tui, Some(location));
}

/// `newSessionLocation`: the open session's location with `session.new_location: inherit`, unless the server
/// reported it missing; else the launch directory.
fn new_location(tui: &Tui) -> Location {
    let launch = Location::new(tui.data.read(|state| state.default_location().directory.clone()));
    let current = match tui.route() {
        Route::Session { id } => tui
            .data
            .read(|state| state.session(&id).map(|session| Location::from(&session.location)))
            .or_else(|| crate::features::location::current(tui)),
        _ => None,
    };
    let unavailable = crate::features::location::error(tui);
    match current {
        Some(current)
            if tui.config().new_location == NewLocation::Inherit && Some(&current) != unavailable.as_ref() =>
        {
            current
        }
        _ => launch,
    }
}
