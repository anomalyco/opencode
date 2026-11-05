//! The Terminals tab (`routes/session/composer/terminals-tab.tsx`): the session's terminals and "+ New terminal";
//! Enter shows the selected one in the right pane, or creates one. `terminal.select` opens the composer here.

use std::rc::Rc;

use opencode_api::generated::{PersistentPtyInfo, SessionID};
use opencode_ui::keymap::TuiCommand;
use opencode_ui::theme::Theme;
use opentui::prelude::Container;

use super::{Inner, Label, RowState, Tab, row};
use crate::app::Tui;

#[derive(Default)]
pub(super) struct State {
    entries: Vec<PersistentPtyInfo>,
    /// The terminal shown in the right pane (`visibleTerminalID`).
    visible: Option<String>,
    /// An index into the entries and the "+ New terminal" row after them.
    selected: Option<usize>,
    /// What the selection effect last saw: whether the tab showed, the terminals, and the shown one.
    seen: Option<(Vec<String>, Option<String>)>,
}

pub(super) fn update(inner: &Rc<Inner>, tui: &Tui) {
    let session = &inner.session.0;
    let entries = tui.terminals.list(session);
    let visible = crate::frame::terminal_shown(tui).then(|| tui.terminals.selected(session)).flatten();
    let mut state = inner.terminals.borrow_mut();
    state.entries = entries;
    state.visible = visible;
    if !inner.is_active(Tab::Terminals) {
        state.seen = None;
        return;
    }
    // The effect selects the shown terminal when the tab shows and whenever the list or the shown one changes.
    let seen = (state.entries.iter().map(|terminal| terminal.id.0.clone()).collect(), state.visible.clone());
    if state.seen.as_ref() != Some(&seen) {
        state.selected = state.entries.iter().position(|terminal| Some(&terminal.id.0) == state.visible.as_ref());
        state.seen = Some(seen);
    }
}

pub(super) fn commands(inner: &Rc<Inner>) -> Vec<TuiCommand> {
    let command = |id: &str, title: &str, run: fn(&Rc<Inner>, &Tui)| {
        let weak = Rc::downgrade(inner);
        TuiCommand::new(id, move |_, _| {
            let Some(inner) = weak.upgrade() else { return };
            let Some(tui) = inner.tui.upgrade() else {
                return;
            };
            run(&inner, &tui);
        })
        .title(title)
        .group("Composer")
    };
    vec![
        command("composer.terminal.up", "Previous terminal", |inner, tui| {
            {
                let mut state = inner.terminals.borrow_mut();
                let len = state.entries.len();
                state.selected = Some((state.selected.unwrap_or(0) + len) % (len + 1));
            }
            inner.refresh(tui);
        }),
        command("composer.terminal.down", "Next terminal", |inner, tui| {
            {
                let mut state = inner.terminals.borrow_mut();
                let len = state.entries.len();
                state.selected = Some(state.selected.map_or(0, |index| index + 1) % (len + 1));
            }
            inner.refresh(tui);
        }),
        command("composer.terminal.select", "Select terminal", select),
    ]
}

/// Closes the composer, then shows the selected terminal or creates one.
fn select(inner: &Rc<Inner>, tui: &Tui) {
    let terminal = {
        let state = inner.terminals.borrow();
        let Some(index) = state.selected else { return };
        state.entries.get(index).map(|terminal| terminal.id.0.clone())
    };
    let session: SessionID = inner.session.clone();
    inner.close(tui);
    match terminal {
        Some(id) => crate::terminal::select(tui, &session.0, Some(&id), true),
        None => crate::terminal::create(tui, &session, true, |_, _| {}),
    }
}

/// The list. The tab has no footer hints.
pub(super) fn draw(inner: &Rc<Inner>, tui: &Tui, theme: &Theme) -> Vec<(String, String)> {
    let (entries, visible, selected) = {
        let state = inner.terminals.borrow();
        (state.entries.clone(), state.visible.clone(), state.selected)
    };
    // The list does not scroll with the selection; it shows the first five rows.
    let rows = entries.len() + 1;
    for index in 0..rows.min(super::ROWS) {
        let terminal = entries.get(index);
        let current = terminal.is_some_and(|terminal| Some(&terminal.id.0) == visible.as_ref());
        let state = if Some(index) == selected {
            RowState::Focused
        } else if current {
            RowState::Selected
        } else {
            RowState::Base
        };
        let label = match terminal {
            Some(terminal) => terminal.foreground_process.clone().unwrap_or_else(|| terminal.title.clone()),
            None => "+ New terminal".to_owned(),
        };
        let hover = {
            let weak = Rc::downgrade(inner);
            move || {
                let Some(inner) = weak.upgrade() else { return };
                let Some(tui) = inner.tui.upgrade() else {
                    return;
                };
                if inner.terminals.borrow_mut().selected.replace(index) != Some(index) {
                    inner.redraw_later(&tui);
                }
            }
        };
        let click = {
            let weak = Rc::downgrade(inner);
            move || {
                let Some(inner) = weak.upgrade() else { return };
                let Some(tui) = inner.tui.upgrade() else {
                    return;
                };
                inner.terminals.borrow_mut().selected = Some(index);
                let weak = Rc::downgrade(&inner);
                tui.app.defer(move |_| {
                    let Some(inner) = weak.upgrade() else { return };
                    if let Some(tui) = inner.tui.upgrade() {
                        select(&inner, &tui);
                    }
                });
            }
        };
        inner.body.add(&row(tui, theme, state, Label { text: label, status: None, truncate: true }, hover, click));
    }
    Vec::new()
}
