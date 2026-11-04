//! The session route (T.1): the regions later steps fill (`routes/session/index.tsx`).
//!
//! ```text
//! transcript    messages::list (E.6a), sticky to the bottom; a running reply shows its own progress there
//! permission    permission::Permission (E.9a); the prompt hides while it shows
//! form          form::SessionForms (E.9b); after a permission request, and it hides the prompt too
//! prompt        prompt::editor::mount (E.2)
//! ```
//! The column is the session pane of `frame::SessionFrame` (E.12); TS has no session header, the title shows
//! in the tab strip. The sidebar (E.14) mounts beside the column.

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
use opencode_store::{Changes, Task};
use opentui::prelude::*;

use super::RouteView;
use crate::app::Tui;

pub struct Session {
    id: SessionID,
    frame: crate::frame::SessionFrame,
    transcript: messages::list::Transcript,
    _scroll: scroll::Controls,
    _actions: actions::Actions,
    permission: permission::Permission,
    form: form::SessionForms,
    location: crate::routes::location_missing::LocationMissing,
    prompt: crate::prompt::editor::Prompt,
}

impl Session {
    pub fn new(tui: &Tui, id: SessionID) -> Self {
        let app = &tui.app;
        let transcript = messages::list::Transcript::new(tui);
        let scroll = scroll::Controls::new(tui, &transcript);
        let actions = actions::Actions::new(tui, &id, &scroll);
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
            // `paddingBottom={1}` (`routes/session/index.tsx:1518`); T.1's status row used to fill it.
            .padding_edge(Edge::Bottom, 1)
            .child(transcript.root())
            .child(permission.root())
            .child(form.root())
            .child(location.root())
            .child(prompt.root());
        let frame = crate::frame::SessionFrame::new(tui, &id, &column);
        sidebar::mount(tui, &frame.root(), &id);
        load(tui, tui.data.session_sync(&id, false));
        load(tui, tui.data.message_sync(&id));
        Self {
            id,
            frame,
            transcript,
            _scroll: scroll,
            _actions: actions,
            permission,
            form,
            location,
            prompt,
        }
    }
}

impl RouteView for Session {
    fn root(&self) -> View {
        self.frame.root()
    }

    fn sync(&self, tui: &Tui, changes: &Changes) {
        if changes.session(&self.id) {
            crate::features::location::session(tui, &self.id);
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
