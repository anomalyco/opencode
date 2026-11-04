//! The session route (T.1): the regions later steps fill (`routes/session/index.tsx`).
//!
//! ```text
//! header        title
//! transcript    messages::list (E.6a), sticky to the bottom
//! working       the spinner while the session runs
//! permission    permission::sync (E.9a)
//! prompt        prompt::editor::mount (E.2)
//! ```
//! The sidebar (E.14) mounts beside the column.

pub mod actions;
pub mod form;
pub mod grouping;
pub mod messages;
pub mod navigation;
pub mod permission;
pub mod queued;
pub mod scroll;
pub mod sidebar;
pub mod tools;

use opencode_api::generated::SessionID;
use opencode_store::{Changes, SessionStatus, Task};
use opencode_ui::motion::Spinner;
use opentui::prelude::*;

use super::RouteView;
use crate::app::Tui;

pub struct Session {
    id: SessionID,
    root: View,
    header: Text,
    transcript: messages::list::Transcript,
    working: Spinner,
    permission: View,
    prompt: crate::prompt::editor::Prompt,
}

impl Session {
    pub fn new(tui: &Tui, id: SessionID) -> Self {
        let app = &tui.app;
        let theme = tui.page();
        let header = Text::new(app, "").fg(theme.text.base).bold().truncate(true);
        let transcript = messages::list::Transcript::new(tui);
        let working = Spinner::new(app)
            .color(theme.text.muted)
            .label("Thinking")
            .animations(opencode_ui::motion::enabled(tui.config.info.animations))
            .visible(false);
        let permission = View::new(app).column().shrink(0.0);
        let prompt = crate::prompt::editor::mount(tui, &id);
        let column = View::new(app)
            .column()
            .grow(1.0)
            .basis(Length::Auto)
            .min_width(0)
            .padding_edge(Edge::Left, 2)
            .padding_edge(Edge::Right, 2)
            .padding_edge(Edge::Top, 1)
            .gap(1)
            .child(&header)
            .child(transcript.root())
            .child(&working)
            .child(&permission)
            .child(prompt.root());
        let root = View::new(app)
            .row()
            .grow(1.0)
            .basis(Length::Auto)
            .child(&column);
        sidebar::mount(tui, &root, &id);
        load(tui, tui.data.session_sync(&id, false));
        load(tui, tui.data.message_sync(&id));
        Self {
            id,
            root,
            header,
            transcript,
            working,
            permission,
            prompt,
        }
    }
}

impl RouteView for Session {
    fn root(&self) -> View {
        self.root.clone()
    }

    fn sync(&self, tui: &Tui, changes: &Changes) {
        if changes.session(&self.id) {
            let title = tui.data.read(|state| {
                state
                    .session(&self.id)
                    .and_then(|session| session.title.clone())
            });
            self.header.set_text(title.unwrap_or_default());
        }
        if changes.status(&self.id) {
            let running = tui.data.read(|state| state.status(&self.id)) == SessionStatus::Running;
            self.working.visible(running);
        }
        self.transcript.sync(tui, &self.id, changes);
        permission::sync(tui, &self.permission, &self.id, changes);
        self.prompt.sync(tui, changes);
    }

    fn focus(&self, tui: &Tui) {
        self.prompt.focus(tui);
    }
}

/// Awaits a store read; a failure shows as an error toast.
fn load(tui: &Tui, task: Task<()>) {
    let weak = tui.weak();
    tui.app.spawn(task, move |_, result| {
        if let (Err(error), Some(tui)) = (result, weak.upgrade()) {
            tui.toasts.error(error.to_string());
        }
    });
}
