//! Console copy (E.20, row T28): Ctrl+Y in the console overlay copies the selected text with the "Copied to
//! clipboard" toast and clears the selection (`app.tsx:261-263,601-611`). TS binds the key in the console's own
//! options; here it is a key handler that acts only while the console is visible.

use std::rc::Rc;

use opencode_ui::bind;

use crate::app::Tui;

/// Registers the Ctrl+Y handler. `app::install_keys` calls it before the selection keys, which would clear the
/// selection first.
pub fn install(tui: &Rc<Tui>) {
    tui.app.on_key_capture(bind!(tui, |tui, cx, key| {
        if !key.matches("ctrl+y") || !tui.app.console().is_visible() {
            return;
        }
        let Some(text) = tui.app.selected_text() else {
            return;
        };
        crate::features::selection::copy(&tui, &text, "Copied to clipboard");
        tui.app.clear_selection();
        cx.prevent_default();
        cx.stop_propagation();
    }));
}
