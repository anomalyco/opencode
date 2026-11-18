//! Selection and clipboard handling. The focused editor keeps its own selection; Ctrl+C copies or clears a selection
//! before the exit binding runs.

use opencode_local::cli_config::TerminalCopy;

use crate::prelude::*;

/// Install selection handling before the keymap so copying a selection takes priority.
pub fn install(tui: &Rc<Tui>) {
    let weak = tui.weak();
    tui.app.on_key_capture(bind!(weak, |tui, cx, key| handle_key(&tui, cx, key)));
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
    tui.app.on_mouse(bind!(tui, |tui, cx, event| {
        if event.kind != MouseEventKind::Down(MouseButton::Right) || copy_on_select(&tui) {
            return;
        }
        if copy_selection(&tui) {
            cx.prevent_default();
            cx.stop_propagation();
        }
    }));
}

/// Whether releasing a selection copies it: `terminal.copy`, else `"select"` outside Windows.
pub fn copy_on_select(tui: &Tui) -> bool {
    let configured = tui.settings.info().terminal.and_then(|terminal| terminal.copy);
    match configured {
        Some(mode) => mode == TerminalCopy::Select,
        None => !cfg!(windows),
    }
}

/// Copies the mouse selection (`Selection.copy`). The selection stays: clearing it would also reset the
/// double- and triple-click count.
pub fn copy_selection(tui: &Tui) -> bool {
    let Some(text) = tui.app.selected_text() else { return false };
    copy(tui, &crate::prompt::paste::clipboard_text(tui, &text), "Copied to clipboard");
    true
}

pub fn copy(tui: &Tui, text: &str, message: &str) -> bool {
    let written = write(tui, text);
    if written {
        tui.toasts.show(ToastOptions::new(Variant::Info, message));
    }
    written
}

pub fn write(tui: &Tui, text: &str) -> bool {
    let written = put(&tui.app, text);
    if !written {
        tui.toasts.error("Clipboard write failed");
    }
    written
}

pub fn put(app: &App, text: &str) -> bool {
    // OpenTUI rejects NUL before any destination; host clipboard text cannot hold it.
    let text = text.replace('\0', "");
    match crate::features::links::testing::sink() {
        Some(sink) => {
            sink.copied.borrow_mut().push(text);
            true
        }
        None => app.copy_to_clipboard(&text),
    }
}

fn handle_key(tui: &Tui, cx: &mut Cx<'_>, key: &KeyEvent) {
    let Some(text) = tui.app.selected_text() else { return };
    // A keyboard selection in the prompt takes precedence over the mouse selection.
    let editing = tui.textarea.borrow().as_ref().is_some_and(|textarea| {
        tui.app.focused().is_some_and(|widget| widget.id() == textarea.id()) && !textarea.selected_text().is_empty()
    });
    // Shortcuts match Kitty's base-layout key, so a non-Latin layout's C counts too.
    if key.matches("ctrl+c") {
        if copy_on_select(tui) && !editing {
            tui.app.clear_selection();
            return;
        }
        copy(tui, &crate::prompt::paste::clipboard_text(tui, &text), "Copied to clipboard");
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
