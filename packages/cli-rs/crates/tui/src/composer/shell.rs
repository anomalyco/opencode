//! The Shell tab (`routes/session/composer/shell-tab.tsx`): the session's running shell commands; Enter opens the
//! shell output dialog and Ctrl+D kills one.

use std::rc::Rc;

use opencode_api::client::RequestOptions;
use opencode_api::generated::{LocationQueryInput, SessionMessageShellStatus, ShellRemoveInput};
use opencode_store::Shell;
use opencode_ui::bind;
use opencode_ui::keymap::TuiCommand;
use opencode_ui::theme::Theme;
use opentui::prelude::Container;

use super::{Inner, Label, RowState, Tab, empty, row, window};
use crate::app::Tui;

#[derive(Default)]
pub(super) struct State {
    entries: Vec<Shell>,
    selected: usize,
    offset: usize,
}

impl State {
    /// The effects that keep the selection in range and scroll it into view, centered, when it leaves the box.
    fn settle(&mut self) {
        if self.selected >= self.entries.len() {
            self.selected = self.entries.len().saturating_sub(1);
        }
        let height = self.entries.len().min(super::ROWS) as isize;
        let y = self.selected as isize - self.offset as isize;
        if y >= height || y < 0 {
            self.offset = super::clamp_offset(self.offset as isize + y - height / 2, self.entries.len());
        }
    }
}

pub(super) fn update(inner: &Rc<Inner>, tui: &Tui) {
    let entries = tui.data.read(|state| {
        state
            .session_shells(&inner.session)
            .into_iter()
            .filter(|shell| shell.info.status == SessionMessageShellStatus::Running)
            .cloned()
            .collect()
    });
    let mut state = inner.shell.borrow_mut();
    state.entries = entries;
    if inner.is_active(Tab::Shell) {
        state.settle();
    }
}

pub(super) fn commands(inner: &Rc<Inner>) -> Vec<TuiCommand> {
    let command = |id: &str, title: &str, run: fn(&Rc<Inner>, &Tui)| {
        TuiCommand::new(
            id,
            bind!(inner, |inner, _, _| {
                let Some(tui) = inner.tui.upgrade() else {
                    return;
                };
                run(&inner, &tui);
            }),
        )
        .title(title)
        .group("Composer")
    };
    vec![
        command("composer.shell.up", "Previous shell", |inner, tui| {
            {
                let mut state = inner.shell.borrow_mut();
                if state.selected == 0 {
                    drop(state);
                    inner.close(tui);
                    return;
                }
                state.selected -= 1;
                state.settle();
            }
            inner.refresh(tui);
        }),
        command("composer.shell.down", "Next shell", |inner, tui| {
            {
                let mut state = inner.shell.borrow_mut();
                if state.entries.is_empty() {
                    return;
                }
                state.selected = (state.selected + 1) % state.entries.len();
                state.settle();
            }
            inner.refresh(tui);
        }),
        command("composer.shell.select", "View shell output", |inner, tui| open(inner, tui)),
        command("composer.shell.kill", "Kill shell command", |inner, tui| {
            let Some(shell) = selected(inner) else { return };
            let client = tui.data.client().clone();
            tui.app.runtime().spawn(async move {
                let input = ShellRemoveInput {
                    id: shell.info.id,
                    location: Some(LocationQueryInput { directory: Some(shell.location.directory) }),
                };
                if let Err(error) = client.shell_remove(&input, &RequestOptions::default()).await {
                    log::warn!("failed to kill the shell command: {error}");
                }
            });
        }),
    ]
}

fn selected(inner: &Inner) -> Option<Shell> {
    let state = inner.shell.borrow();
    state.entries.get(state.selected).cloned()
}

fn open(inner: &Inner, tui: &Tui) {
    if let Some(shell) = selected(inner) {
        crate::dialogs::shell_output::show(tui, shell.info, shell.location);
    }
}

/// The list; returns the footer hints.
pub(super) fn draw(inner: &Rc<Inner>, tui: &Tui, theme: &Theme) -> Vec<(String, String)> {
    let (entries, selected, offset) = {
        let state = inner.shell.borrow();
        (state.entries.clone(), state.selected, state.offset)
    };
    if entries.is_empty() {
        inner.body.add(&empty(tui, theme, " No shell commands".to_owned()));
    }
    for index in window(&entries, offset) {
        let hover = {
            bind!(inner, |inner| {
                let Some(tui) = inner.tui.upgrade() else {
                    return;
                };
                if std::mem::replace(&mut inner.shell.borrow_mut().selected, index) != index {
                    inner.redraw_later(&tui);
                }
            })
        };
        let click = {
            bind!(inner, |inner| {
                let Some(tui) = inner.tui.upgrade() else {
                    return;
                };
                inner.shell.borrow_mut().selected = index;
                tui.app.defer(bind!(inner, |inner, _| {
                    if let Some(tui) = inner.tui.upgrade() {
                        open(&inner, &tui);
                    }
                }));
            })
        };
        let command = entries[index].info.command.split('\n').next().unwrap_or_default();
        inner.body.add(&row(
            tui,
            theme,
            if index == selected { RowState::Focused } else { RowState::Base },
            Label { text: command.to_owned(), status: None, truncate: false },
            hover,
            click,
        ));
    }
    if entries.get(selected).is_none() {
        return Vec::new();
    }
    vec![
        ("output".to_owned(), tui.keymap.shortcut("composer.shell.select").unwrap_or_default()),
        ("kill".to_owned(), tui.keymap.shortcut("composer.shell.kill").unwrap_or_default()),
    ]
}
