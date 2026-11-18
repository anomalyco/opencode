//! With tabs off, the leader and a digit open pinned root sessions in pin order.

use crate::dialogs::session_list::pins;
use crate::features::events::Handled;
use crate::prelude::*;

pub fn install(tui: &Rc<Tui>) {
    let weak = tui.weak();
    let enabled = || Condition::when(bind!(weak, |tui| !tui.config().tabs.enabled));
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
    let Some(target) = pins::slots(tui).into_iter().nth(slot - 1) else { return };
    if tui.route() == (Route::Session { id: target.clone() }) {
        return;
    }
    tui.navigate(Route::Session { id: target });
}

pub(crate) fn event(tui: &Tui, event: &Handled) {
    if let Handled::SessionDeleted(event) = event {
        // The file loses the pin even when only another client had it.
        pins::prune(tui, &event.data.session_id);
    }
}
