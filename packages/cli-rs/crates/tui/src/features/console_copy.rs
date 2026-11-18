//! Ctrl+Y copies the console selection while the overlay is visible.

use crate::prelude::*;

/// Registers the Ctrl+Y handler. `app::install_keys` calls it before the selection keys, which would clear the
/// selection first.
pub fn install(tui: &Rc<Tui>) {
    tui.app.on_key_capture(bind!(tui, |tui, cx, key| {
        if !key.matches("ctrl+y") || !tui.app.console().is_visible() {
            return;
        }
        let Some(text) = tui.app.selected_text() else { return };
        crate::features::selection::copy(&tui, &text, "Copied to clipboard");
        tui.app.clear_selection();
        cx.prevent_default();
        cx.stop_propagation();
    }));
}
