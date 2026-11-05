//! Quick switch (E.11b, row W03; `app.tsx:841-848,1323-1327`, `context/local.tsx:549-601`): with tabs off,
//! `<leader>1` to `<leader>9` open the pinned root sessions in pin order. Pins are toggled in the session
//! list (`session.pin.toggle`, `dialogs::session_list::pins`); a deleted session loses its pin.

use std::rc::Rc;

use opencode_api::generated::V2Event;
use opencode_ui::bind;
use opencode_ui::keymap::{Bind, KeymapLayer, TuiCommand};
use opentui::keymap::Condition;

use crate::app::Tui;
use crate::dialogs::session_list::pins;
use crate::routes::Route;

pub fn install(tui: &Rc<Tui>) {
    let weak = tui.weak();
    let enabled = {
        let weak = weak.clone();
        move || {
            let weak = weak.clone();
            Condition::when(move || weak.upgrade().is_some_and(|tui| !tui.config().tabs.enabled))
        }
    };
    let commands: Vec<TuiCommand> = (1..=9)
        .map(|slot| {
            TuiCommand::new(format!("session.quick_switch.{slot}"), bind!(weak, |tui, _, _| quick_switch(&tui, slot)))
                .bind(Bind::Off)
                .title(format!("Switch to session in quick slot {slot}"))
                .group("Session")
                .enabled(enabled())
        })
        .collect();
    let names: Vec<String> = commands.iter().filter_map(|command| command.id.clone()).collect();
    tui.keymap.install(
        "quick switch",
        [
            KeymapLayer::global(commands),
            // `pinnedSessionBindingCommands`, bound only while tabs are off.
            KeymapLayer::global(Vec::new()).enabled(enabled()).bindings(names),
        ],
    );
}

/// `quickSwitch`: opens the session in `slot` (1-based), unless it is open already.
pub fn quick_switch(tui: &Tui, slot: usize) {
    let Some(target) = pins::slots(tui).into_iter().nth(slot - 1) else {
        return;
    };
    if tui.route() == (Route::Session { id: target.clone() }) {
        return;
    }
    tui.navigate(Route::Session { id: target });
}

/// `session.deleted` prunes the session's pin (`prune`).
pub(crate) fn event(tui: &Tui, event: &V2Event) {
    if let V2Event::SessionDeleted(event) = event {
        // The file loses the pin even when only another client had it.
        pins::prune(tui, &event.data.session_id);
    }
}
