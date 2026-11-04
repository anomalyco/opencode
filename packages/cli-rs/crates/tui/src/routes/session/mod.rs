//! The session route (T.1): the regions later steps fill (`routes/session/index.tsx`).
//!
//! ```text
//! header        title
//! transcript    messages::list (E.6a), sticky to the bottom
//! working       the spinner while the session runs
//! permission    permission::Permission (E.9a); the prompt hides while it shows
//! form          form::SessionForms (E.9b); after a permission request, and it hides the prompt too
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
    _scroll: scroll::Controls,
    working: Spinner,
    permission: permission::Permission,
    form: form::SessionForms,
    location: crate::routes::location_missing::LocationMissing,
    prompt: crate::prompt::editor::Prompt,
}

impl Session {
    pub fn new(tui: &Tui, id: SessionID) -> Self {
        let app = &tui.app;
        let theme = tui.page();
        let header = Text::new(app, "").fg(theme.text.base).bold().truncate(true);
        let transcript = messages::list::Transcript::new(tui);
        let scroll = scroll::Controls::new(tui, &transcript);
        let working = Spinner::new(app)
            .color(theme.text.muted)
            .label("Thinking")
            .animations(opencode_ui::motion::enabled(tui.config.info.animations))
            .visible(false);
        let permission = permission::Permission::new(tui, &id);
        let form = form::SessionForms::new(tui, &id);
        let location = crate::routes::location_missing::LocationMissing::new(tui, &id);
        let prompt = crate::prompt::editor::mount(tui, Some(&id));
        let column = View::new(app)
            .column()
            .grow(1.0)
            .basis(Length::Auto)
            .min_width(0)
            .padding_edge(Edge::Left, 2)
            .padding_edge(Edge::Right, 2)
            .padding_edge(Edge::Top, 1)
            // `paddingBottom={1}` (`routes/session/index.tsx:1518`); T.1's status row used to fill it.
            .padding_edge(Edge::Bottom, 1)
            .gap(1)
            .child(&header)
            .child(transcript.root())
            .child(&working)
            .child(permission.root())
            .child(form.root())
            .child(location.root())
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
            _scroll: scroll,
            working,
            permission,
            form,
            location,
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
            crate::features::location::session(tui, &self.id);
        }
        if changes.status(&self.id) {
            let running = tui.data.read(|state| state.status(&self.id)) == SessionStatus::Running;
            self.working.visible(running);
        }
        self.transcript.sync(tui, &self.id, changes);
        let prompting = self.permission.active() || self.form.active() || self.location.active();
        self.permission.sync(tui, changes);
        self.form.sync(tui, changes, self.permission.active());
        self.location.sync(tui);
        if (self.permission.active() || self.form.active() || self.location.active()) != prompting {
            self.prompt.root().visible(prompting);
            if prompting {
                self.prompt.focus(tui);
            }
        }
        self.prompt.sync(tui, changes);
    }

    fn focus(&self, tui: &Tui) {
        if !self.permission.active() && !self.form.active() && !self.location.active() {
            self.prompt.focus(tui);
        }
    }
}

/// Awaits a store read; a failure shows as an error toast.
pub(super) fn load(tui: &Tui, task: Task<()>) {
    let weak = tui.weak();
    tui.app.spawn(task, move |_, result| {
        if let (Err(error), Some(tui)) = (result, weak.upgrade()) {
            tui.toasts.error(error.to_string());
        }
    });
}
