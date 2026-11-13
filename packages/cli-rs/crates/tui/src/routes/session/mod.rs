//! The session route (T.1): the regions later steps fill (`routes/session/index.tsx`).
//!
//! ```text
//! transcript    messages::list (E.6a), sticky to the bottom; a running reply shows its own progress there
//! queued        queued::Queued (E.10b), the queued prompts dock; it hides while the composer shows
//! composer top  the `session.composer.top` plugin slot (P.1)
//! composer      composer::Composer (E.13b); while it shows, it replaces everything below it
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

use opencode_api::generated::SessionMessageAssistantContentItem;
use opencode_store::Task;
use std::collections::BTreeSet;

use super::RouteView;

use crate::prelude::*;

pub struct Session {
    id: SessionID,
    transcript: messages::list::Transcript,
    scroll: scroll::Controls,
    _actions: actions::Actions,
    /// Built again around the transcript on a theme switch; `None` only while that runs.
    parts: RefCell<Option<Parts>>,
}

/// What a theme switch builds again: everything but the transcript, its scrolling, and the session's commands.
struct Parts {
    frame: crate::frame::SessionFrame,
    sidebar: sidebar::Sidebar,
    queued: queued::Queued,
    /// The `session.composer.top` slot's plugin claims (P.1).
    slot: opencode_plugin::SlotMount,
    composer: crate::composer::Composer,
    permission: permission::Permission,
    form: form::SessionForms,
    location: crate::routes::location_missing::LocationMissing,
    prompt: crate::prompt::editor::Prompt,
}

impl Session {
    pub fn new(tui: &Tui, id: SessionID) -> Self {
        let transcript = messages::list::Transcript::new(tui);
        let scroll = scroll::Controls::new(tui, &transcript);
        let actions = actions::Actions::new(tui, &id, &scroll);
        let parts = Parts::new(tui, &id, &transcript, &scroll);
        let synced = (tui.data.session_sync(&id, true), tui.data.message_sync(&id));
        missing(tui, &id, synced.0.clone());
        load(tui, synced.1.clone());
        prewarm(tui, &id, synced.1.clone());
        // `restoreScrollPosition` waits for the first sync (`synced`, `rowsSynced`).
        tui.app.spawn(
            async move { futures_util::future::join(synced.0, synced.1).await },
            bind!(scroll.0, |inner, _, (session, messages)| {
                let (Ok(()), Ok(())) = (session, messages) else { return };
                if let Some(tui) = inner.tui.upgrade() {
                    scroll::Controls(inner).restore(&tui);
                }
            }),
        );
        Self { id, transcript, scroll, _actions: actions, parts: RefCell::new(Some(parts)) }
    }

    fn parts(&self) -> std::cell::Ref<'_, Parts> {
        std::cell::Ref::map(self.parts.borrow(), |parts| parts.as_ref().expect("the session view's parts"))
    }
}

impl Parts {
    fn new(tui: &Tui, id: &SessionID, transcript: &messages::list::Transcript, scroll: &scroll::Controls) -> Self {
        let app = &tui.app;
        let permission = permission::Permission::new(tui, id);
        let form = form::SessionForms::new(tui, id);
        let location = crate::routes::location_missing::LocationMissing::new(tui, id);
        let prompt = crate::prompt::editor::mount(tui, Some(id));
        scroll.follow_submits(&prompt);
        let queued = queued::Queued::new(tui, id, prompt.weak());
        // `<Switch>`: the permission, the form, the missing location, or the prompt.
        let rest = View::new(app)
            .column()
            .shrink(0.0)
            .child(permission.root())
            .child(form.root())
            .child(location.root())
            .child(prompt.root());
        let composer = crate::composer::Composer::new(tui, id, {
            let (rest, textarea) = (rest.clone(), prompt.textarea().clone());
            let prompt_root = prompt.root().clone();
            Rc::new(move |tui: &Tui, open: bool| {
                rest.visible(!open);
                if open {
                    if tui.app.focused().is_some_and(|widget| widget.id() == textarea.id()) {
                        tui.app.blur();
                    }
                } else if prompt_root.is_visible() {
                    if tui.dialogs.is_open() {
                        tui.dialogs.refocus(&textarea);
                    } else {
                        tui.app.focus(&textarea);
                    }
                }
            })
        });
        // `<Slot path="session.composer.top">` between the dock and the composer (`routes/session/index.tsx:1597`).
        let composer_top = View::new(app).column().shrink(0.0);
        let slot = crate::plugins::host::slot(
            tui,
            &composer_top,
            opencode_plugin::slot::SESSION_COMPOSER_TOP,
            &opencode_plugin::slot::SlotInput { session_id: Some(id.0.clone()), ..Default::default() },
            |_| {},
        );
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
            .child(queued.root())
            .child(&composer_top)
            .child(composer.root())
            .child(&rest);
        let frame = crate::frame::SessionFrame::new(tui, id, &column);
        let sidebar = sidebar::mount(tui, &frame.root(), id);
        Self { frame, sidebar, queued, slot, composer, permission, form, location, prompt }
    }
}

impl RouteView for Session {
    fn root(&self) -> View {
        self.parts().frame.root()
    }

    /// The transcript and its scrolling restyle in place, so the rows, their code, the scroll position and the
    /// selection stay. The rest takes its colors when it is built, so it builds again around them, as a remount does.
    fn restyle(&self, tui: &Tui) -> bool {
        self.transcript.restyle(tui);
        self.scroll.restyle(tui);
        // The old parts go first: the new prompt takes the draft the old one saves.
        self.transcript.root().detach();
        drop(self.parts.borrow_mut().take());
        let parts = Parts::new(tui, &self.id, &self.transcript, &self.scroll);
        *self.parts.borrow_mut() = Some(parts);
        true
    }

    fn sync(&self, tui: &Tui, changes: &Changes) {
        let parts = self.parts();
        let Parts { frame, sidebar, queued, slot, composer, permission, form, location, prompt } = &*parts;
        // A full sync (a reconnect) reads again what the store invalidated, as TS does when the connection
        // turns connected (`routes/session/index.tsx:339-347`, `routes/session/rows.ts:123-129`): events
        // lost with the old stream would otherwise stay missing. Reads still valid return at once.
        if changes.all {
            form::quiet(tui, tui.data.session_sync(&self.id, true));
            form::quiet(tui, tui.data.message_sync(&self.id));
            form::quiet(tui, tui.data.pending_sync(&self.id));
        }
        if changes.session(&self.id) {
            crate::features::location::session(tui, &self.id);
        }
        self.transcript.sync(tui, &self.id, changes);
        let prompting = permission.active() || form.active() || location.active();
        permission.sync(tui, changes);
        form.sync(tui, changes, permission.active());
        location.sync(tui);
        composer.sync(tui, form.active(), !frame.session_active());
        let blocked = permission.active() || form.active() || composer.open();
        queued.sync(tui, changes, blocked);
        crate::plugins::host::changed(tui, changes, |changed| slot.sync(tui, changed));
        if (permission.active() || form.active() || location.active()) != prompting {
            prompt.root().visible(prompting);
            // An open dialog keeps the keys; the prompt takes them when it closes.
            if prompting && tui.dialogs.is_open() {
                tui.dialogs.refocus(prompt.textarea());
            } else if prompting && !composer.open() {
                prompt.focus(tui);
            }
        }
        prompt.sync(tui, changes);
        sidebar.sync(tui, changes);
    }

    fn focus_target(&self) -> Option<AnyWidget> {
        let parts = self.parts();
        if parts.form.active() {
            return parts.form.editor().map(|textarea| textarea.as_any());
        }
        (!parts.permission.active() && !parts.location.active() && !parts.composer.open())
            .then(|| parts.prompt.textarea().as_any())
    }
}

/// Awaits a store read; a failure shows as an error toast.
pub(super) fn load(tui: &Tui, task: Task<()>) {
    tui.request(task, |_, ()| {});
}

/// Once the page lands, compiles the grammars its code fences name on workers while the UI builds the rows, so the
/// first frame waits for less of each compile. It reads the store off the UI thread.
fn prewarm(tui: &Tui, id: &SessionID, task: Task<()>) {
    let (data, id) = (tui.data.clone(), id.clone());
    tui.app.runtime().spawn(async move {
        if task.await.is_err() {
            return;
        }
        let languages: BTreeSet<String> = data.read(|state| {
            let texts = state.messages(&id).iter().flat_map(|message| match message {
                SessionMessageInfo::Assistant(assistant) => assistant.content.as_slice(),
                _ => &[],
            });
            texts
                .filter_map(|content| match content {
                    SessionMessageAssistantContentItem::Text(text) => Some(text.text.as_str()),
                    SessionMessageAssistantContentItem::Reasoning(reasoning) => Some(reasoning.text.as_str()),
                    _ => None,
                })
                .flat_map(opencode_ui::grammars::fence_languages)
                .map(str::to_owned)
                .collect()
        });
        opencode_ui::grammars::prewarm(languages.iter().map(String::as_str));
    });
}

/// Awaits the session's read (`routes/session/index.tsx:340-370`). A failure shows as an error toast; a session the
/// server does not have closes its tab, or goes home with tabs off, while it is still open. A transport error keeps
/// it: TS reads only while connected.
fn missing(tui: &Tui, id: &SessionID, task: Task<()>) {
    let id = id.clone();
    tui.app.spawn(
        task,
        opencode_ui::bind!(tui, |tui, _, result| {
            let message = match result {
                Err(error) => {
                    tui.toasts.error(error.to_string());
                    if matches!(*error, opencode_api::error::Error::Transport(_)) {
                        return;
                    }
                    None
                }
                Ok(()) if tui.data.read(|state| state.session(&id).is_none()) => {
                    Some(format!("Session not found: {}", id.0))
                }
                Ok(()) => return,
            };
            if tui.route() != (crate::routes::Route::Session { id: id.clone() }) {
                return;
            }
            if let Some(message) = message {
                tui.toasts.error(message);
            }
            if crate::tabs::Tabs::enabled(&tui) {
                crate::tabs::close(&tui, Some(&id.0));
            } else {
                tui.navigate(crate::routes::Route::Home);
            }
        }),
    );
}
