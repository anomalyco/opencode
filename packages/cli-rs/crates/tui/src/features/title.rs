//! Terminal titles for home and session routes.

use crate::prelude::*;

#[derive(Default)]
pub struct Title {
    /// The title last sent, so a sync that changes nothing sends nothing.
    sent: RefCell<Option<String>>,
    /// Cache the last viewed session title for the deletion toast, which follows removal from the store.
    active: RefCell<Option<(SessionID, Option<String>)>>,
}

impl Title {
    fn set(&self, tui: &Tui, title: String) {
        let title = opencode_ui::terminal_title(&title);
        if self.sent.borrow().as_deref() == Some(title.as_str()) {
            return;
        }
        tui.app.set_title(&title);
        *self.sent.borrow_mut() = Some(title);
    }

    /// Return the title if `id` matches the last session shown.
    pub fn active(&self, id: &SessionID) -> Option<String> {
        self.active.borrow().as_ref().filter(|(active, _)| active == id).and_then(|(_, title)| title.clone())
    }
}

pub fn install(tui: &Tui) {
    route_changed(tui);
}

pub fn route_changed(tui: &Tui) {
    let session = match &*tui.route() {
        Route::Session { id } => tui
            .data
            .read(|state| state.session(&id).map(|session| session.title.clone()))
            .map(|title| (id.clone(), title)),
        _ => None,
    };
    if let Some(session) = &session {
        *tui.title.active.borrow_mut() = Some(session.clone());
    }
    if !enabled(tui) {
        return;
    }
    let title = match &*tui.route() {
        Route::Home => "OpenCode".to_owned(),
        Route::Session { .. } => session_title(session.as_ref().and_then(|(_, title)| title.as_deref())),
        Route::Plugin { name, .. } => format!("OC | {name}"),
    };
    tui.title.set(tui, title);
}

pub fn sync(tui: &Tui, changes: &Changes) {
    if let Route::Session { id } = &*tui.route()
        && changes.has(id, Touched::INFO)
    {
        route_changed(tui);
    }
}

/// Sends the last title again once the terminal is back from another program: suspending it cleared the title, and
/// the program may have set its own.
pub fn resumed(tui: &Tui) {
    if let Some(title) = tui.title.sent.take() {
        tui.title.set(tui, title);
    }
}

/// A plugin's title (`renderer.setTerminalTitle`), also with `terminal.title: false`. It shows until the TUI sets
/// its own with its next change.
pub fn set_by_plugin(tui: &Tui, title: &str) {
    tui.title.set(tui, title.to_owned());
}

/// Clears the title before the terminal is released, as `destroyRenderer` does whatever `terminal.title` says: the
/// TUI's own, a plugin's, or the one the terminal had.
pub fn clear(tui: &Tui) {
    tui.title.set(tui, String::new());
}

/// Read the latest `terminal.title` setting.
fn enabled(tui: &Tui) -> bool {
    crate::features::system_commands::title_enabled(&tui.config().info)
}

/// "OpenCode" without a title or with a fallback title; otherwise "OC | " and the title cut to 40 characters.
fn session_title(title: Option<&str>) -> String {
    match title {
        None => "OpenCode".to_owned(),
        Some(title) if is_fallback(title) => "OpenCode".to_owned(),
        Some(title) if title.chars().count() > 40 => {
            format!("OC | {}…", title.chars().take(37).collect::<String>())
        }
        Some(title) => format!("OC | {title}"),
    }
}

pub(crate) fn is_fallback(title: &str) -> bool {
    let Some(stamp) = title.strip_prefix("New session - ").or_else(|| title.strip_prefix("Child session - ")) else {
        return false;
    };
    let shape = b"dddd-dd-ddTdd:dd:dd.dddZ";
    stamp.len() == shape.len()
        && stamp.bytes().zip(shape).all(|(byte, expected)| match expected {
            b'd' => byte.is_ascii_digit(),
            other => byte == *other,
        })
}
