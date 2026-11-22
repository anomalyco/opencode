//! Move a pending steer back into the queue or delete it.

use crate::prelude::*;
use crate::routes::session::queued::{self, Action};

pub fn show(tui: &Tui, session: SessionID, message: String) {
    let options = vec![SelectOption::new("Move to queue", Action::Queue), SelectOption::new("Delete", Action::Cancel)];
    let weak = tui.weak();
    tui.dialogs.replace(
        move |cx| {
            let mut props = SelectProps::new("Pending steer", options.clone());
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
