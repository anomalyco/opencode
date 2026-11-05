//! Pending steer dialog (E.10b, row DLG40): a click on a user message still waiting to steer
//! (`routes/session/index.tsx:2398-2414`). "Move to queue" queues it and "Delete" cancels it; the dialog closes once
//! the server took the change.

use std::rc::Rc;

use opencode_api::generated::SessionID;
use opencode_ui::bind;
use opencode_ui::dialog::DialogOptions;
use opencode_ui::select::{self, SelectOption, SelectProps};

use crate::app::Tui;
use crate::routes::session::queued::{self, Action};

pub fn show(tui: &Tui, session: SessionID, message: String) {
    let options = vec![SelectOption::new("Move to queue", Action::Queue), SelectOption::new("Delete", Action::Cancel)];
    let weak = tui.weak();
    tui.dialogs.replace(
        move |cx| {
            let mut props = SelectProps::new("Pending steer", options.clone());
            // `renderFilter={!newDesigns()}`.
            props.render_filter = false;
            let (weak, session, message) = (weak.clone(), session.clone(), message.clone());
            props.on_select = Some(Rc::new(bind!(weak, |tui, option: &SelectOption<Action>| {
                queued::mutate(&tui, &session, option.value, &message, None, |tui, done| {
                    if done {
                        tui.dialogs.clear();
                    }
                });
            })));
            select::select(cx, props).0
        },
        None,
        DialogOptions::default(),
    );
}
