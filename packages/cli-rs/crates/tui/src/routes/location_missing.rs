//! The session location view (E.1, row T18, `routes/session/location-missing.tsx`): when the server reports
//! the open session's directory missing, the prompt gives way to "Session location unavailable" with one
//! action, "Choose directory", which moves the session (`session.move`).
//!
//! TS chooses the directory in `DialogWorkspaces`, which is not ported yet; this view asks for a path in a
//! prompt dialog instead (see the E.1 report). The session route owns one [`LocationMissing`] beside its
//! prompt and hides the prompt while [`LocationMissing::active`].

use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::time::Duration;

use opencode_api::client::RequestOptions;
use opencode_api::generated::{AbsolutePath, SessionID, SessionMoveInput};
use opencode_ui::dialog::DialogOptions;
use opencode_ui::keymap::{KeymapLayer, TuiCommand};
use opencode_ui::prompt::{PromptProps, prompt};
use opencode_ui::toast::{ToastOptions, Variant};
use opentui::keymap::Disposer;
use opentui::prelude::*;

use crate::app::Tui;

pub struct LocationMissing {
    session: SessionID,
    root: View,
    active: Cell<bool>,
    layer: RefCell<Option<Disposer>>,
}

impl LocationMissing {
    pub fn new(tui: &Tui, session: &SessionID) -> Self {
        let root = View::new(&tui.app)
            .column()
            .shrink(0.0)
            .max_height(15)
            .visible(false);
        Self {
            session: session.clone(),
            root,
            active: Cell::new(false),
            layer: RefCell::new(None),
        }
    }

    pub fn root(&self) -> &View {
        &self.root
    }

    pub fn active(&self) -> bool {
        self.active.get()
    }

    /// Shows the view while the location error names the session's directory.
    pub fn sync(&self, tui: &Tui) {
        let directory = tui.data.read(|state| {
            state
                .session(&self.session)
                .map(|session| session.location.directory.0.clone())
        });
        let missing = directory.filter(|directory| {
            crate::features::location::error(tui)
                .is_some_and(|location| location.directory == *directory)
        });
        if missing.is_some() == self.active.get() {
            return;
        }
        self.active.set(missing.is_some());
        self.root.clear();
        self.layer.take();
        let Some(directory) = missing else {
            self.root.visible(false);
            return;
        };
        self.root.add(&view(tui, &self.session, &directory));
        self.root.visible(true);
        let weak = tui.weak();
        let session = self.session.clone();
        let layer = KeymapLayer {
            commands: vec![
                TuiCommand::inline("return", move |_, _| {
                    if let Some(tui) = weak.upgrade() {
                        choose(&tui, session.clone(), directory.clone());
                    }
                })
                .title("Select option")
                .group("Session recovery"),
            ],
            ..KeymapLayer::default()
        };
        match tui.keymap.layer(layer) {
            Ok(disposer) => *self.layer.borrow_mut() = Some(disposer),
            Err(error) => log::error!("location keymap layer: {error}"),
        }
        // The prompt hides; it must not keep the keys.
        tui.app.blur();
    }
}

/// `SessionLocationUnavailable`: `SessionQuestion` with the directory, the explanation, and one action.
fn view(tui: &Tui, session: &SessionID, directory: &str) -> View {
    let app = &tui.app;
    let theme = tui.page();
    let home = std::env::var("HOME").unwrap_or_default();
    let shown = opencode_ui::select::truncate_middle(
        &opencode_ui::path::abbreviate_home(directory, &home),
        72,
    );
    let header = View::new(app)
        .row()
        .gap(1)
        .padding_edge(Edge::Left, 1)
        .shrink(0.0)
        .child(&Text::new(app, "△").fg(theme.text.feedback.warning.base))
        .child(&Text::new(app, "Session location unavailable").fg(theme.text.base));
    let body = View::new(app)
        .column()
        .padding_edge(Edge::Left, 1)
        .gap(1)
        .child(&Text::new(app, shown).fg(theme.text.muted))
        .child(
            &Text::new(app, "Choose another directory to continue this session.")
                .fg(theme.text.base),
        );
    let content = View::new(app)
        .column()
        .gap(1)
        .padding_edge(Edge::Left, 1)
        .padding_edge(Edge::Right, 3)
        .padding_y(1)
        .grow(1.0)
        .basis(Length::Auto)
        .child(&header)
        .child(&body);
    let action = View::new(app)
        .padding_x(1)
        .bg(theme.background.action.primary.focused)
        .child(&Text::new(app, "Choose directory").fg(theme.text.action.primary.focused));
    let actions = View::new(app).row().gap(1).shrink(0.0).child(&action);
    let hints = View::new(app).row().gap(2).shrink(0.0).child(
        &View::new(app)
            .row()
            .gap(1)
            .child(&Text::new(app, "enter").fg(theme.text.base))
            .child(&Text::new(app, "confirm").fg(theme.text.muted)),
    );
    let narrow = app.size().0 < 80;
    let footer = View::new(app)
        .direction(if narrow {
            FlexDirection::Column
        } else {
            FlexDirection::Row
        })
        .shrink(0.0)
        .gap(1)
        .padding_edge(Edge::Top, 1)
        .padding_edge(Edge::Left, 2)
        .padding_edge(Edge::Right, 3)
        .padding_edge(Edge::Bottom, 1)
        .bg(theme.decrease(&theme.background.raised.base, 1))
        .justify(if narrow {
            Justify::Start
        } else {
            Justify::SpaceBetween
        })
        .align_items(if narrow { Align::Start } else { Align::Center })
        .child(&actions)
        .child(&hints);
    let weak = tui.weak();
    let (session, directory) = (session.clone(), directory.to_owned());
    action.on_click(move |_, _| {
        if let Some(tui) = weak.upgrade() {
            choose(&tui, session.clone(), directory.clone());
        }
    });
    View::new(app)
        .column()
        .bg(theme.background.raised.base)
        .border(BorderStyle::Heavy)
        .border_sides(Sides::LEFT)
        .border_color(theme.background.action.primary.focused)
        .child(&content)
        .child(&footer)
}

/// Asks for the new directory, then moves the session there.
fn choose(tui: &Tui, session: SessionID, directory: String) {
    let weak = tui.weak();
    let clear = tui.dialogs.clone();
    tui.dialogs.replace(
        move |cx| {
            let (view, _) = prompt(
                cx,
                PromptProps {
                    title: "Choose directory".into(),
                    placeholder: Some("Absolute path".into()),
                    value: Some(directory.clone()),
                    on_confirm: Some(Rc::new(move |value: &str| {
                        let target = value.trim().to_owned();
                        let Some(tui) = weak.upgrade() else { return };
                        tui.dialogs.clear();
                        if !target.is_empty() {
                            move_session(&tui, session.clone(), target);
                        }
                    })),
                    on_cancel: Some(Rc::new(move || clear.clear())),
                    ..PromptProps::default()
                },
            );
            view
        },
        None,
        DialogOptions::default(),
    );
}

fn move_session(tui: &Tui, session: SessionID, directory: String) {
    let client = tui.data.client().clone();
    let input = SessionMoveInput {
        session_id: session,
        directory: AbsolutePath(directory),
        delivery: None,
    };
    let weak = tui.weak();
    tui.app.spawn(
        async move {
            client
                .session_move(&input, &RequestOptions::default())
                .await
        },
        move |_, result| {
            if let (Err(error), Some(tui)) = (result, weak.upgrade()) {
                tui.toasts.show(
                    ToastOptions::new(Variant::Error, error.to_string())
                        .title("Failed to move session")
                        .duration(Duration::from_millis(5000)),
                );
            }
        },
    );
}
