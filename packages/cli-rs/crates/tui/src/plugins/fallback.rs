//! The host's own `/plugins` while the plugin manager (`opencode.plugins`) has failed (synthesis 3.6, 4.10): the toasts
//! and the home footer still say "Run /plugins", so the host lists the TUI plugins and their errors, read only. Enter
//! on a row with an error shows it; the user's enter or click on the manager's own row enables it again, which brings
//! the manager back. Rows name registry entries by key, so a held build of the manager's ID is not the manager.

use opencode_plugin::{Entry, Source, Status};

use crate::dialogs::error_details;
use crate::prelude::*;

/// `plugins.list` in the global layer until the disposer is dropped.
pub fn activate(tui: &Rc<Tui>) -> Disposer {
    let layer = KeymapLayer::global(vec![
        TuiCommand::new("plugins.list", bind!(tui, |tui, _, _| show(&tui, None)))
            .bind(Bind::Default)
            .title("Plugins")
            .group("System")
            .palette()
            .slash("plugins"),
    ]);
    tui.keymap.layer(layer).unwrap_or_else(|error| {
        log::error!("the host's plugin list: {error}");
        Disposer::noop()
    })
}

/// The list, in place of any open dialog, on the row of plugin `focus` if given.
fn show(tui: &Rc<Tui>, focus: Option<String>) {
    let entries: Vec<Entry> = tui
        .plugins
        .entries()
        .into_iter()
        .filter(|entry| entry.source != Source::Builtin || entry.id == super::manager::ID || failed(entry))
        .collect();
    let weak = tui.weak();
    tui.dialogs.replace(
        move |cx| {
            // In the dialog's theme, built again with it.
            let theme = cx.theme.page();
            let options: Vec<SelectOption<String>> = entries
                .iter()
                .map(|entry| {
                    let mut option = SelectOption::new(entry.id.clone(), entry.key.clone()).footer(footer(entry));
                    option.footer_color = Some(match entry.status {
                        Status::Failed(_) => theme.text.feedback.error.base,
                        Status::Pending => theme.text.feedback.warning.base,
                        _ => theme.text.muted,
                    });
                    option
                })
                .collect();
            let mut props = SelectProps::new("Plugins", options);
            props.focus_target = focus.clone();
            let handle: Rc<RefCell<Option<opencode_ui::select::Select<String>>>> = Rc::default();
            let picked = Rc::downgrade(&handle);
            // Any row's error on its own key, the manager's too, whose enter starts it again (review carbon-3).
            let errors: Vec<String> =
                entries.iter().filter(|entry| error(entry).is_some()).map(|e| e.key.clone()).collect();
            let shown = weak.clone();
            let mut view_error = opencode_ui::select::SelectAction::new(
                "dialog.plugins.error",
                "view error",
                bind!(shown, |tui, option: &SelectOption<String>| {
                    let key = option.value.clone();
                    tui.app.defer(bind!(tui, |tui, _| details(&tui, &key)));
                }),
            );
            view_error.hidden_when = Some(Rc::new(move |option: Option<&SelectOption<String>>| {
                option.is_none_or(|o| !errors.contains(&o.value))
            }));
            props.actions = vec![view_error];
            props.on_select = Some(Rc::new(bind!(weak, |tui, option: &SelectOption<String>| {
                // A key or a click, not a run of the submit by name, as a plugin's `dispatch` runs it (review bigboi-1).
                let by_input = picked
                    .upgrade()
                    .is_some_and(|handle| handle.borrow().as_ref().is_some_and(|handle| handle.by_input()));
                let key = option.value.clone();
                // The select is still handling the key.
                tui.app.defer(bind!(tui, |tui, _| pick(&tui, &key, by_input)));
            })));
            let (view, select) = opencode_ui::select::select(cx, props);
            handle.replace(Some(select));
            // Kept while the list is open; its close lets the select go.
            cx.on_close(opentui::keymap::Disposer::new(move || drop(handle.take())));
            view
        },
        None,
        DialogOptions::new(DialogSize::Large),
    );
}

/// Enables the manager again, on the user's input and while it still has failed and this list stands in for it; or
/// shows the error of the entry `key` names, with Back to its row.
fn pick(tui: &Rc<Tui>, key: &str, by_input: bool) {
    let Some(entry) = tui.plugins.entries().into_iter().find(|entry| entry.key == key) else { return };
    if entry.key == opencode_plugin::Entry::plugin_key(super::manager::ID) {
        if by_input && failed(&entry) && super::host::fallback_shown(tui) {
            tui.dialogs.clear();
            super::contain::enable(tui, key);
        }
        return;
    }
    details(tui, key);
}

/// The error of the entry `key` names, with Back to its row.
fn details(tui: &Rc<Tui>, key: &str) {
    let Some(entry) = tui.plugins.entries().into_iter().find(|entry| entry.key == key) else { return };
    let Some(error) = error(&entry) else { return };
    let source = entry.target.clone().unwrap_or_else(|| entry.id.clone());
    let props = error_details::Props {
        title: "TUI plugin error".to_owned(),
        source: Some(source.clone()),
        error,
        context: Some(format!("Plugin: {}\nStatus: failed\nRuntime: tui\nSource: {source}", entry.id)),
        diagnostic_ref: None,
        on_back: Rc::new(bind!(tui, |tui| {
            let key = entry.key.clone();
            tui.app.defer(bind!(tui, |tui, _| show(&tui, Some(key.clone()))));
        })),
    };
    tui.dialogs.replace(
        bind!(tui, |tui, cx| error_details::view(&tui, cx, props.clone()), else View::new(&cx.app)),
        None,
        DialogOptions::new(DialogSize::Large),
    );
}

fn failed(entry: &Entry) -> bool {
    matches!(entry.status, Status::Failed(_))
}

fn error(entry: &Entry) -> Option<String> {
    match &entry.status {
        Status::Failed(error) | Status::Skipped(error) => Some(error.clone()),
        _ => None,
    }
}

fn footer(entry: &Entry) -> String {
    let status = match &entry.status {
        Status::Active => "active",
        Status::Inactive => "inactive",
        Status::Skipped(_) => "skipped",
        Status::Failed(_) => "failed",
        Status::Pending => "pending",
        Status::Declined => "declined",
    };
    match entry.id == super::manager::ID {
        true => format!("{status}, enter enables it again"),
        false => status.to_owned(),
    }
}
