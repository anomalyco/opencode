//! Text selection and copy (E.20, rows T13 and CB01): `util/selection.ts`, `app.tsx:586-611`, and the clipboard
//! write of `clipboard.ts:53-61`.
//!
//! - With `terminal.copy: "select"` (the default outside Windows), releasing a drag copies the selected text.
//! - With `"manual"`, a right click copies it, and Ctrl+C copies it instead of exiting.
//! - Ctrl+C under copy-on-select, Escape, and any other key clear the selection; Ctrl+C and Escape go on to the
//!   keymap only when there was nothing to copy or clear. A key aimed at the focused prompt keeps the prompt's
//!   own selection, as TS keeps an editor's.
//!
//! [`copy`] is the one clipboard write of the TUI: it drops NUL, then writes OSC 52 and the host clipboard
//! (`App::copy_to_clipboard`, G.4), and toasts.

use std::rc::Rc;

use opencode_local::cli_config::TerminalCopy;
use opencode_ui::toast::{ToastOptions, Variant};
use opentui::prelude::*;

use crate::app::Tui;

/// Registers the selection keys, the release copy, and the right-click copy. `app::install_keys` calls it before
/// the keymap's key handler, as TS intercepts selection keys at priority 101 (`app.tsx:589-596`).
pub fn install(tui: &Rc<Tui>) {
    let weak = tui.weak();
    tui.app.on_key_capture(move |cx, key| {
        if let Some(tui) = weak.upgrade() {
            handle_key(&tui, cx, key);
        }
    });
    let weak = tui.weak();
    tui.app.on_selection(move |cx, text| {
        // The library would copy without the toast or the NUL rule.
        cx.prevent_default();
        let Some(tui) = weak.upgrade() else { return };
        if copy_on_select(&tui) {
            let text = crate::prompt::paste::clipboard_text(&tui, text);
            copy(&tui, &text, "Copied to clipboard");
        }
    });
    let weak = tui.weak();
    tui.app.on_mouse(move |cx, event| {
        let Some(tui) = weak.upgrade() else { return };
        if event.kind != MouseEventKind::Down(MouseButton::Right) || copy_on_select(&tui) {
            return;
        }
        if copy_selection(&tui) {
            cx.prevent_default();
            cx.stop_propagation();
        }
    });
}

/// Whether releasing a selection copies it: `terminal.copy`, else `"select"` outside Windows.
pub fn copy_on_select(tui: &Tui) -> bool {
    let configured = tui
        .settings
        .info()
        .terminal
        .and_then(|terminal| terminal.copy);
    match configured {
        Some(mode) => mode == TerminalCopy::Select,
        None => !cfg!(windows),
    }
}

/// Copies the mouse selection (`Selection.copy`). The selection stays: clearing it would also reset the
/// double- and triple-click count.
pub fn copy_selection(tui: &Tui) -> bool {
    let Some(text) = tui.app.selected_text() else {
        return false;
    };
    copy(
        tui,
        &crate::prompt::paste::clipboard_text(tui, &text),
        "Copied to clipboard",
    );
    true
}

/// [`write`], then shows `message` when it worked.
pub fn copy(tui: &Tui, text: &str, message: &str) -> bool {
    let written = write(tui, text);
    if written {
        tui.toasts.show(ToastOptions::new(Variant::Info, message));
    }
    written
}

/// `clipboard.write`: writes `text` to every clipboard destination, or shows an error toast when none took it.
/// Returns whether one did.
pub fn write(tui: &Tui, text: &str) -> bool {
    // OpenTUI rejects NUL before any destination; host clipboard text cannot hold it.
    let text = text.replace('\0', "");
    let written = match crate::features::links::testing::sink() {
        Some(sink) => {
            sink.copied.borrow_mut().push(text.clone());
            true
        }
        None => tui.app.copy_to_clipboard(&text),
    };
    if !written {
        tui.toasts.error("Clipboard write failed");
    }
    written
}

/// `Selection.handleSelectionKey`.
fn handle_key(tui: &Tui, cx: &mut Cx<'_>, key: &KeyEvent) {
    let Some(text) = tui.app.selected_text() else {
        return;
    };
    // TS checks that the focused editor is part of the mouse selection; a keyboard selection in the prompt
    // ends the mouse selection here, so the prompt's own selection is the one that counts.
    let editing = tui.textarea.borrow().as_ref().is_some_and(|textarea| {
        tui.app
            .focused()
            .is_some_and(|widget| widget.id() == textarea.id())
            && !textarea.selected_text().is_empty()
    });
    // Shortcuts match Kitty's base-layout key, so a non-Latin layout's C counts too.
    if key.matches("ctrl+c") {
        if copy_on_select(tui) && !editing {
            tui.app.clear_selection();
            return;
        }
        copy(
            tui,
            &crate::prompt::paste::clipboard_text(tui, &text),
            "Copied to clipboard",
        );
        cx.prevent_default();
        cx.stop_propagation();
        return;
    }
    if key.matches("escape") {
        tui.app.clear_selection();
        cx.prevent_default();
        cx.stop_propagation();
        return;
    }
    if !editing {
        tui.app.clear_selection();
    }
}
