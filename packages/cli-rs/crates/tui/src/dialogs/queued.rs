//! Queued prompts dialog (E.10b, row DLG41): `openQueuedPrompts` (`routes/session/index.tsx:788-844`). The
//! session's queued prompts with `1 of n` footers; Enter steers one, `queued_prompt.delete` cancels it, and
//! `queued_prompt.undo` takes it back into the composer. The list follows the inbox while the dialog is open.

use opencode_ui::select::{FooterHint, Group, Select, SelectAction};

use crate::prelude::*;
use crate::routes::session::queued::{self, Action};

/// Opens the dialog for the session view `view`, with `dialog.replace`.
pub(crate) fn show(tui: &Tui, view: &Rc<queued::Inner>) {
    let list = Rc::new(List { tui: tui.weak(), view: Rc::downgrade(view), select: RefCell::default() });
    let options = list.options();
    let this = list.clone();
    tui.dialogs.replace(
        move |cx| {
            let mut props = SelectProps::new("Queued prompts", options.clone());
            props.search_in_title = true;
            props.title_placeholder = Some("Search queued prompts".to_owned());
            props.on_select =
                Some(Rc::new(bind!(this, |list, option: &SelectOption<String>| list.steer(&option.value))));
            let action = |command: &str, title: &str, run: fn(&List, &str)| {
                SelectAction::new(
                    command,
                    title,
                    bind!(this, |list, option: &SelectOption<String>| run(&list, &option.value)),
                )
            };
            props.actions = vec![
                action("queued_prompt.delete", "delete", List::delete),
                action("queued_prompt.undo", "undo", List::undo),
            ];
            props.footer_hints =
                vec![FooterHint { title: "steer".to_owned(), label: "enter".to_owned(), group: Some(Group::Primary) }];
            let (view, handle) = select::select(cx, props);
            *this.select.borrow_mut() = Some(handle);
            // The dialog owns the list; handlers hold weak references.
            let list = this.clone();
            cx.on_close(opentui::keymap::Disposer::new(move || {
                list.select.borrow_mut().take();
            }));
            if let Some(tui) = this.tui.upgrade() {
                cx.on_close(tui.follow(&this, |list, _, changes| list.sync(changes)));
            }
            view
        },
        None,
        DialogOptions::default(),
    );
}

struct List {
    tui: Weak<Tui>,
    view: Weak<queued::Inner>,
    select: RefCell<Option<Select<String>>>,
}

impl List {
    fn options(&self) -> Vec<SelectOption<String>> {
        let (Some(tui), Some(view)) = (self.tui.upgrade(), self.view.upgrade()) else { return Vec::new() };
        let prompts = tui.data.read(|state| queued::prompts(state, &view.session));
        let count = prompts.len();
        prompts
            .into_iter()
            .enumerate()
            .map(|(index, (id, text))| SelectOption::new(text, id).footer(format!("{} of {count}", index + 1)))
            .collect()
    }

    /// Refreshes the options after each store flush that touched the inbox, while the dialog is open.
    fn sync(&self, changes: &Changes) {
        let Some(view) = self.view.upgrade() else { return };
        if changes.pending(&view.session) {
            let select = self.select.borrow().clone();
            if let Some(select) = select {
                select.set_options(self.options());
            }
        }
    }

    /// Enter: steers the prompt and closes the dialog once the server took it.
    fn steer(&self, inbox: &str) {
        let (Some(tui), Some(view)) = (self.tui.upgrade(), self.view.upgrade()) else { return };
        queued::mutate(&tui, &view.session, Action::Steer, inbox, None, |tui, steered| {
            if steered {
                tui.dialogs.clear();
            }
        });
    }

    /// Cancels the prompt; the dialog closes when it was the last one.
    fn delete(&self, inbox: &str) {
        let (Some(tui), Some(view)) = (self.tui.upgrade(), self.view.upgrade()) else { return };
        let last = tui.data.read(|state| queued::prompts(state, &view.session).len() == 1);
        queued::mutate(&tui, &view.session, Action::Cancel, inbox, None, move |tui, cancelled| {
            if cancelled && last {
                tui.dialogs.clear();
            }
        });
    }

    fn undo(&self, inbox: &str) {
        if let (Some(tui), Some(view)) = (self.tui.upgrade(), self.view.upgrade()) {
            view.undo(&tui, inbox);
        }
    }
}
