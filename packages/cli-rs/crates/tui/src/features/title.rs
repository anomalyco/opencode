//! The terminal title (E.1, row T09, `app.tsx:636-662`): "OpenCode" on home and for a session without a
//! real title, "OC | <title>" for a session, and "OC | <name>" for a plugin route. `terminal.title: false`
//! leaves the title alone. Quitting clears it (`util/renderer.ts` `destroyRenderer`).
//!
//! `app::mount` calls [`install`] once, `Tui::navigate` calls [`route_changed`], and `Tui::sync` calls
//! [`sync`] with what changed.

use std::cell::RefCell;

use opencode_api::generated::SessionID;
use opencode_store::Changes;

use crate::app::Tui;
use crate::routes::Route;

#[derive(Default)]
pub struct Title {
    /// The title last sent, so a sync that changes nothing sends nothing.
    sent: RefCell<Option<String>>,
    /// The last session the session route showed, with its title (TS `active`). The deleted toast names it
    /// after the store dropped the session.
    active: RefCell<Option<(SessionID, Option<String>)>>,
}

impl Title {
    fn set(&self, tui: &Tui, title: String) {
        if self.sent.borrow().as_deref() == Some(title.as_str()) {
            return;
        }
        tui.app.set_title(&title);
        *self.sent.borrow_mut() = Some(title);
    }

    /// The title of `id` when it was the last session shown.
    pub fn active(&self, id: &SessionID) -> Option<String> {
        self.active
            .borrow()
            .as_ref()
            .filter(|(active, _)| active == id)
            .and_then(|(_, title)| title.clone())
    }
}

pub fn install(tui: &Tui) {
    route_changed(tui);
}

pub fn route_changed(tui: &Tui) {
    let session = match tui.route() {
        Route::Session { id } => tui
            .data
            .read(|state| state.session(&id).map(|session| session.title.clone()))
            .map(|title| (id, title)),
        _ => None,
    };
    if let Some(session) = &session {
        *tui.title.active.borrow_mut() = Some(session.clone());
    }
    if !enabled(tui) {
        return;
    }
    let title = match tui.route() {
        Route::Home => "OpenCode".to_owned(),
        Route::Session { .. } => {
            session_title(session.as_ref().and_then(|(_, title)| title.as_deref()))
        }
        Route::Plugin { name, .. } => format!("OC | {name}"),
    };
    tui.title.set(tui, title);
}

pub fn sync(tui: &Tui, changes: &Changes) {
    if let Route::Session { id } = tui.route()
        && changes.session(&id)
    {
        route_changed(tui);
    }
}

/// Clears the title before the terminal is released, as `destroyRenderer` does.
pub fn clear(tui: &Tui) {
    if enabled(tui) {
        tui.title.set(tui, String::new());
    }
}

/// `terminal.title` as the last settings write left it, so `terminal.title.toggle` (E.20) takes effect.
fn enabled(tui: &Tui) -> bool {
    crate::features::system_commands::title_enabled(&tui.settings.info())
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

/// `isFallbackTitle`: `New session - <ISO>` or `Child session - <ISO>`.
fn is_fallback(title: &str) -> bool {
    let Some(stamp) = title
        .strip_prefix("New session - ")
        .or_else(|| title.strip_prefix("Child session - "))
    else {
        return false;
    };
    // `\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z`
    let shape = b"dddd-dd-ddTdd:dd:dd.dddZ";
    stamp.len() == shape.len()
        && stamp
            .bytes()
            .zip(shape)
            .all(|(byte, expected)| match expected {
                b'd' => byte.is_ascii_digit(),
                other => byte == *other,
            })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn titles_follow_the_tui() {
        assert_eq!(session_title(None), "OpenCode");
        assert_eq!(
            session_title(Some("New session - 2026-03-01T12:00:00.000Z")),
            "OpenCode"
        );
        assert_eq!(
            session_title(Some("Child session - 2026-03-01T12:00:00.000Z")),
            "OpenCode"
        );
        assert_eq!(
            session_title(Some("New session - yesterday")),
            "OC | New session - yesterday"
        );
        assert_eq!(session_title(Some("Fix the parser")), "OC | Fix the parser");
        let long = "a".repeat(41);
        assert_eq!(
            session_title(Some(&long)),
            format!("OC | {}…", "a".repeat(37))
        );
        assert_eq!(
            session_title(Some(&"a".repeat(40))),
            format!("OC | {}", "a".repeat(40))
        );
    }
}
