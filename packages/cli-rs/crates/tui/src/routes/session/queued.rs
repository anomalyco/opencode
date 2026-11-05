//! Queued prompts (E.10b, row V14): the dock above the prompt (`QueuedPromptDock`,
//! `routes/session/index.tsx:2481-2514`), `session.queued_prompts` (`:1409-1415`), and the pending actions the dock,
//! the queued prompts dialog, the pending steer dialog, and an empty submit share (`requestPending`,
//! `mutatePending`, and `undoPending`, `:760-787`).

use std::cell::{Cell, RefCell};
use std::collections::HashSet;
use std::rc::{Rc, Weak};

use opencode_api::client::RequestOptions;
use opencode_api::generated::{
    SessionID, SessionInboxCancelInput, SessionInboxDelivery, SessionInboxInfo, SessionInboxUpdateInput,
    SessionMessageID,
};
use opencode_store::{Changes, State};
use opencode_ui::keymap::{Bind, GLOBAL_MODE, KeymapLayer, TuiCommand};
use opencode_ui::toast::{ToastOptions, Variant};
use opentui::keymap::{Condition, Disposer};
use opentui::prelude::*;

use crate::app::Tui;
use crate::prompt::editor::{Inner as PromptInner, Mode};

/// What a pending action does to an inbox item (`PendingAction`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    Steer,
    Queue,
    Cancel,
}

/// The session's queued prompts in admission order, as `(id, text)` (`queuedPrompts`).
pub fn prompts(state: &State, session: &SessionID) -> Vec<(String, String)> {
    state
        .pending(session)
        .iter()
        .filter_map(|item| match item {
            SessionInboxInfo::User(user) if user.delivery == SessionInboxDelivery::Queue => {
                Some((user.id.0.clone(), user.payload.text.clone()))
            }
            _ => None,
        })
        .collect()
}

/// The delivery of a pending user prompt (`pendingDelivery`).
pub fn delivery(state: &State, session: &SessionID, message: &str) -> Option<SessionInboxDelivery> {
    state.pending(session).iter().find_map(|item| match item {
        SessionInboxInfo::User(user) if user.id.0 == message => Some(user.delivery.clone()),
        _ => None,
    })
}

thread_local! {
    /// Inbox items with an action in flight (`createSingleFlight`); a second action on one of them does nothing.
    static INFLIGHT: RefCell<HashSet<String>> = RefCell::default();
}

/// `mutatePending`: steers, queues, or cancels an inbox item, then calls `done` with whether it worked. A failure
/// shows "Failed to <label> pending prompt". Returns false, without calling `done`, while another action on the
/// item is in flight.
pub fn mutate(
    tui: &Tui,
    session: &SessionID,
    action: Action,
    inbox: &str,
    failure: Option<&'static str>,
    done: impl FnOnce(&Tui, bool) + 'static,
) -> bool {
    if !INFLIGHT.with_borrow_mut(|inflight| inflight.insert(inbox.to_owned())) {
        return false;
    }
    let client = tui.data.client().clone();
    let (session, id) = (session.clone(), SessionMessageID(inbox.to_owned()));
    let weak = tui.weak();
    let key = inbox.to_owned();
    tui.app.spawn(
        async move {
            let options = RequestOptions::default();
            let delivery = match action {
                Action::Steer => SessionInboxDelivery::Steer,
                Action::Queue => SessionInboxDelivery::Queue,
                Action::Cancel => {
                    let input = SessionInboxCancelInput { session_id: session, inbox_id: id };
                    return client.session_inbox_cancel(&input, &options).await;
                }
            };
            let input = SessionInboxUpdateInput { session_id: session, inbox_id: id, delivery };
            client.session_inbox_update(&input, &options).await
        },
        move |_, result| {
            INFLIGHT.with_borrow_mut(|inflight| inflight.remove(&key));
            let Some(tui) = weak.upgrade() else { return };
            if let Err(error) = &result {
                let label = failure.unwrap_or(match action {
                    Action::Steer => "steer",
                    Action::Queue => "queue",
                    Action::Cancel => "delete",
                });
                tui.toasts.show(
                    ToastOptions::new(Variant::Error, error.to_string())
                        .title(format!("Failed to {label} pending prompt")),
                );
            }
            done(&tui, result.is_ok());
        },
    );
    true
}

/// The dock and the `session.queued_prompts` command of one session view. Dropping it removes the command's layers.
pub struct Queued(Rc<Inner>);

pub(crate) struct Inner {
    tui: Weak<Tui>,
    pub(crate) session: SessionID,
    root: View,
    label: Text,
    /// The number of queued prompts the dock shows.
    count: Cell<usize>,
    /// The session's prompt, which the undo appends to and checks for shell mode.
    prompt: Weak<PromptInner>,
    layers: RefCell<Vec<Disposer>>,
}

impl Queued {
    pub fn new(tui: &Tui, session: &SessionID, prompt: Weak<PromptInner>) -> Self {
        let app = &tui.app;
        let theme = tui.page();
        let raised = theme.background.raised.base;
        let label = Text::new(app, "")
            .fg(theme.text.muted)
            .wrap(WrapMode::None)
            .truncate(true)
            .grow(1.0)
            .shrink(1.0)
            .min_width(0);
        let body = View::new(app)
            .row()
            .width(Length::Percent(100.0))
            .padding_edge(Edge::Top, 1)
            .padding_edge(Edge::Bottom, 1)
            .padding_edge(Edge::Left, 2)
            .padding_edge(Edge::Right, 1)
            .bg(raised)
            .child(&label);
        let hovered = theme.decrease(&theme.background.raised.base, 1);
        let target = body.clone();
        let root = View::new(app)
            .column()
            .shrink(0.0)
            .margin_edge(Edge::Bottom, 1)
            .border(BorderStyle::Heavy)
            .border_sides(Sides::LEFT)
            .border_color(theme.border.base)
            .visible(false)
            .child(&body);
        root.on_hover(move |_, hover| {
            target.bg(if hover { hovered } else { raised });
        });
        let inner = Rc::new(Inner {
            tui: tui.weak(),
            session: session.clone(),
            root,
            label,
            count: Cell::new(0),
            prompt,
            layers: RefCell::default(),
        });
        let weak = Rc::downgrade(&inner);
        inner.root.mouse_pointer(MousePointer::POINTER).on_click(move |_, _| {
            if let Some(inner) = weak.upgrade() {
                inner.open();
            }
        });
        inner.register(tui);
        inner.update(tui);
        Self(inner)
    }

    pub fn root(&self) -> &View {
        &self.0.root
    }

    /// Follows the session's inbox. `blocked` is true while a permission or form replaces the prompt, which hides
    /// the dock as well (`disabled()`).
    pub fn sync(&self, tui: &Tui, changes: &Changes, blocked: bool) {
        if changes.pending(&self.0.session) {
            self.0.update(tui);
        }
        self.0.root.visible(self.0.count.get() > 0 && !blocked);
    }
}

impl Drop for Queued {
    fn drop(&mut self) {
        // The command may run while the view drops, so the layers go afterwards.
        let layers = std::mem::take(&mut *self.0.layers.borrow_mut());
        if let Some(tui) = self.0.tui.upgrade() {
            tui.app.defer(move |_| drop(layers));
        }
    }
}

impl Inner {
    fn register(self: &Rc<Self>, tui: &Tui) {
        // The count of the last update: keymap conditions must not lock the store.
        let queued = {
            let weak = Rc::downgrade(self);
            Condition::when(move || weak.upgrade().is_some_and(|inner| inner.count.get() > 0))
        };
        let weak = Rc::downgrade(self);
        let command = TuiCommand::new("session.queued_prompts", move |_, _| {
            if let Some(inner) = weak.upgrade() {
                inner.open();
            }
        })
        .title("View queued prompts")
        .group("Prompt")
        .bind(Bind::Off)
        .palette()
        .enabled(queued);
        for layer in [
            KeymapLayer { mode: Some(GLOBAL_MODE.to_owned()), commands: vec![command], ..KeymapLayer::default() },
            KeymapLayer { bindings: vec!["session.queued_prompts".to_owned()], ..KeymapLayer::default() },
        ] {
            match tui.keymap.layer(layer) {
                Ok(disposer) => self.layers.borrow_mut().push(disposer),
                Err(error) => log::error!("queued prompts keymap layer: {error}"),
            }
        }
    }

    /// `<count> queued · <first prompt on one line>`, or nothing without queued prompts.
    fn update(&self, tui: &Tui) {
        let queued = tui.data.read(|state| prompts(state, &self.session));
        self.count.set(queued.len());
        let Some((_, first)) = queued.first() else {
            self.label.set_text("");
            return;
        };
        let theme = tui.page();
        let first = first.replace('\n', " ");
        let mut spans = vec![Span::styled(format!("{} queued", queued.len()), Style::new().fg(theme.text.base))];
        if !first.is_empty() {
            spans.push(Span::raw(format!(" · {first}")));
        }
        self.label.set_text(spans);
    }

    /// `openQueuedPrompts`.
    fn open(self: &Rc<Self>) {
        if let Some(tui) = self.tui.upgrade() {
            crate::dialogs::queued::show(&tui, self);
        }
    }

    /// `queued_prompt.undo`: takes a queued prompt back into the composer, unless the composer is in shell mode
    /// with text. The cancel goes first, then the text, then the dialog closes and the composer takes focus.
    pub(crate) fn undo(&self, tui: &Tui, inbox: &str) {
        let Some(prompt) = self.prompt.upgrade() else {
            return;
        };
        let Some(text) = tui.data.read(|state| {
            prompts(state, &self.session).into_iter().find_map(|(id, text)| (id == inbox).then_some(text))
        }) else {
            return;
        };
        if prompt.mode.get() == Mode::Shell && !prompt.textarea.text().is_empty() {
            tui.toasts.show(ToastOptions::new(Variant::Error, "Leave shell mode before undoing a queued prompt"));
            return;
        }
        let session = self.session.clone();
        mutate(tui, &self.session, Action::Cancel, inbox, Some("undo"), move |tui, undone| {
            if !undone {
                return;
            }
            super::actions::append_prompt(tui, &session, &text);
            tui.dialogs.clear();
            if tui.route() == (crate::routes::Route::Session { id: session }) {
                tui.app.focus(&prompt.textarea);
            }
        });
    }
}
