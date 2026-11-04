//! Queued prompts dialog (E.10b, row DLG41): `openQueuedPrompts` (`routes/session/index.tsx:788-844`). The
//! session's queued prompts with `1 of n` footers; Enter steers one, `queued_prompt.delete` cancels it, and
//! `queued_prompt.undo` takes it back into the composer. The list follows the inbox while the dialog is open.

use std::cell::{Cell, RefCell};
use std::rc::{Rc, Weak};

use opencode_ui::dialog::DialogOptions;
use opencode_ui::select::{
    self, FooterHint, Group, Select, SelectAction, SelectOption, SelectProps,
};

use crate::app::Tui;
use crate::routes::session::queued::{self, Action};

/// Opens the dialog for the session view `view`, with `dialog.replace`.
pub(crate) fn show(tui: &Tui, view: &Rc<queued::Inner>) {
    let list = Rc::new(List {
        tui: tui.weak(),
        view: Rc::downgrade(view),
        select: RefCell::default(),
        seen: Cell::new(tui.data.revision()),
    });
    let options = list.options();
    let this = list.clone();
    tui.dialogs.replace(
        move |cx| {
            let mut props = SelectProps::new("Queued prompts", options.clone());
            props.search_in_title = true;
            props.title_placeholder = Some("Search queued prompts".to_owned());
            let weak = Rc::downgrade(&this);
            props.on_select = Some(Rc::new(move |option: &SelectOption<String>| {
                if let Some(list) = weak.upgrade() {
                    list.steer(&option.value);
                }
            }));
            let action = |command: &str, title: &str, run: fn(&List, &str)| {
                let weak = Rc::downgrade(&this);
                SelectAction::new(command, title, move |option: &SelectOption<String>| {
                    if let Some(list) = weak.upgrade() {
                        run(&list, &option.value);
                    }
                })
            };
            props.actions = vec![
                action("queued_prompt.delete", "delete", List::delete),
                action("queued_prompt.undo", "undo", List::undo),
            ];
            props.footer_hints = vec![FooterHint {
                title: "steer".to_owned(),
                label: "enter".to_owned(),
                group: Some(Group::Primary),
            }];
            let (view, handle) = select::select(cx, props);
            *this.select.borrow_mut() = Some(handle);
            // The dialog owns the list; handlers hold weak references.
            let list = this.clone();
            cx.on_close(opentui::keymap::Disposer::new(move || {
                list.select.borrow_mut().take();
            }));
            view
        },
        None,
        DialogOptions::default(),
    );
    list.watch(tui.data.subscribe());
}

struct List {
    tui: Weak<Tui>,
    view: Weak<queued::Inner>,
    select: RefCell<Option<Select<String>>>,
    /// The store revision the list last saw.
    seen: Cell<u64>,
}

impl List {
    fn options(&self) -> Vec<SelectOption<String>> {
        let (Some(tui), Some(view)) = (self.tui.upgrade(), self.view.upgrade()) else {
            return Vec::new();
        };
        let prompts = tui.data.read(|state| queued::prompts(state, &view.session));
        let count = prompts.len();
        prompts
            .into_iter()
            .enumerate()
            .map(|(index, (id, text))| {
                SelectOption::new(text, id).footer(format!("{} of {count}", index + 1))
            })
            .collect()
    }

    /// Refreshes the options after each store flush that touched the inbox, while the dialog is open.
    fn watch(self: &Rc<Self>, mut revisions: tokio::sync::watch::Receiver<u64>) {
        let Some(tui) = self.tui.upgrade() else {
            return;
        };
        let weak = Rc::downgrade(self);
        tui.app.spawn(
            async move { revisions.changed().await.is_ok().then_some(revisions) },
            move |_, revisions| {
                let (Some(list), Some(revisions)) = (weak.upgrade(), revisions) else {
                    return;
                };
                let (Some(tui), Some(view)) = (list.tui.upgrade(), list.view.upgrade()) else {
                    return;
                };
                let (revision, changes) = tui.data.changes_since(list.seen.get());
                list.seen.set(revision);
                if changes.pending(&view.session) {
                    let select = list.select.borrow().clone();
                    if let Some(select) = select {
                        select.set_options(list.options());
                    }
                }
                list.watch(revisions);
            },
        );
    }

    /// Enter: steers the prompt and closes the dialog once the server took it.
    fn steer(&self, inbox: &str) {
        let (Some(tui), Some(view)) = (self.tui.upgrade(), self.view.upgrade()) else {
            return;
        };
        queued::mutate(
            &tui,
            &view.session,
            Action::Steer,
            inbox,
            None,
            |tui, steered| {
                if steered {
                    tui.dialogs.clear();
                }
            },
        );
    }

    /// Cancels the prompt; the dialog closes when it was the last one.
    fn delete(&self, inbox: &str) {
        let (Some(tui), Some(view)) = (self.tui.upgrade(), self.view.upgrade()) else {
            return;
        };
        let last = tui
            .data
            .read(|state| queued::prompts(state, &view.session).len() == 1);
        queued::mutate(
            &tui,
            &view.session,
            Action::Cancel,
            inbox,
            None,
            move |tui, cancelled| {
                if cancelled && last {
                    tui.dialogs.clear();
                }
            },
        );
    }

    fn undo(&self, inbox: &str) {
        if let (Some(tui), Some(view)) = (self.tui.upgrade(), self.view.upgrade()) {
            view.undo(&tui, inbox);
        }
    }
}
