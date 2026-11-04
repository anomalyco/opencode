//! The home route (T.1, to E.1): a minimal home with the root sessions of the directory. E.1 builds
//! the TS home (logo, prompt, footer slot, row T17); the session list dialog is E.11a's.

use std::cell::RefCell;
use std::rc::Rc;

use opencode_api::client::RequestOptions;
use opencode_api::generated::{SessionID, SessionInfo, SessionListInput, SessionListInputOrder};
use opencode_store::Changes;
use opentui::prelude::*;

use super::{Route, RouteView};
use crate::app::Tui;

/// Sessions the home asks for.
const LIMIT: i64 = 50;

pub struct Home {
    root: View,
    list: Select,
    empty: Text,
    ids: Rc<RefCell<Vec<SessionID>>>,
    prompt: crate::prompt::editor::Prompt,
}

impl Home {
    pub fn new(tui: &Tui) -> Self {
        let app = &tui.app;
        let theme = tui.page();
        let title = Text::new(app, "opencode").fg(theme.text.base).bold();
        let hint = Text::new(
            app,
            format!(
                "enter open · {} commands · {} exit",
                tui.keymap
                    .shortcut("command.palette.show")
                    .unwrap_or_default(),
                tui.keymap.shortcut("app.exit").unwrap_or_default(),
            ),
        )
        .fg(theme.text.muted);
        let empty = Text::new(app, "Loading sessions…").fg(theme.text.muted);
        let list = Select::new(app)
            .grow(1.0)
            .basis(Length::Auto)
            .show_description(true)
            .wrap_selection(false)
            .colors(theme.text.base, theme.background.base)
            .focused_colors(theme.text.base, theme.background.base)
            .selected_colors(
                theme.text.formfield.selected,
                theme.background.formfield.selected,
            )
            .description_colors(theme.text.muted, theme.text.formfield.selected);
        let ids: Rc<RefCell<Vec<SessionID>>> = Rc::default();
        {
            let ids = ids.clone();
            let weak = tui.weak();
            list.on_select(move |cx, index, _| {
                let Some(id) = ids.borrow().get(index).cloned() else {
                    return;
                };
                let weak = weak.clone();
                // Navigating replaces this view; do it after the select's handler returns.
                cx.defer(move |_| {
                    if let Some(tui) = weak.upgrade() {
                        tui.navigate(Route::Session { id });
                    }
                });
            });
        }
        // E.2's prompt starts a new session; Tab moves between it and the list.
        let prompt = crate::prompt::editor::mount(tui, None);
        let body = View::new(app)
            .column()
            .grow(1.0)
            .basis(Length::Auto)
            .padding_edge(Edge::Left, 2)
            .padding_edge(Edge::Right, 2)
            .padding_edge(Edge::Top, 1)
            .gap(1)
            .child(&title)
            .child(&empty)
            .child(&list)
            .child(prompt.root())
            .child(&hint);
        let root = View::new(app)
            .column()
            .grow(1.0)
            .basis(Length::Auto)
            .child(&body);
        crate::features::update_notification::mount(tui, &root);
        crate::features::home_forms::mount(tui, &root);
        crate::plugins::home_footer::mount(tui, &root);
        load(tui, &empty, prompt.textarea());
        Self {
            root,
            list,
            empty,
            ids,
            prompt,
        }
    }
}

impl RouteView for Home {
    fn root(&self) -> View {
        self.root.clone()
    }

    fn sync(&self, tui: &Tui, changes: &Changes) {
        self.prompt.sync(tui, changes);
        if !changes.sessions() {
            return;
        }
        let sessions: Vec<(SessionID, SelectOption)> = tui.data.read(|state| {
            state
                .sessions()
                .into_iter()
                .filter(|session| session.parent_id.is_none() && session.time.archived.is_none())
                .take(LIMIT as usize)
                .map(|session| (session.id.clone(), option(session)))
                .collect()
        });
        if sessions.is_empty() {
            return;
        }
        let selected = self.ids.borrow().get(self.list.selected()).cloned();
        let (ids, options): (Vec<_>, Vec<_>) = sessions.into_iter().unzip();
        let index = selected
            .and_then(|selected| ids.iter().position(|id| *id == selected))
            .unwrap_or(0);
        *self.ids.borrow_mut() = ids;
        self.list.options(options).select(index);
        self.empty.visible(false);
    }

    fn focus(&self, _tui: &Tui) {
        self.list.focus();
    }
}

/// Reads the root sessions of the directory into the store; the next sync lists them.
fn load(tui: &Tui, empty: &Text, prompt: &Textarea) {
    let client = tui.data.client().clone();
    let input = SessionListInput {
        limit: Some(LIMIT),
        order: Some(SessionListInputOrder::Desc),
        parent_id: Some(None),
        archived: Some(false),
        directory: Some(tui.directory.clone().into()),
        ..SessionListInput::default()
    };
    let weak = tui.weak();
    let empty = empty.clone();
    let prompt = prompt.clone();
    tui.app.spawn(
        async move {
            client
                .session_list(&input, &RequestOptions::default())
                .await
        },
        move |_, result| {
            let Some(tui) = weak.upgrade() else { return };
            match result {
                Ok(response) if response.data.is_empty() => {
                    empty.set_text("No sessions yet");
                    tui.app.focus(&prompt);
                }
                Ok(response) => {
                    for session in response.data {
                        tui.data.remember(session);
                    }
                }
                Err(error) => {
                    empty.set_text("Could not load sessions");
                    tui.toasts.error(error.to_string());
                }
            }
        },
    );
}

fn option(session: &SessionInfo) -> SelectOption {
    let title = session
        .title
        .clone()
        .filter(|title| !title.is_empty())
        .unwrap_or_else(|| session.id.0.clone());
    SelectOption::new(title, session.id.0.clone())
}
