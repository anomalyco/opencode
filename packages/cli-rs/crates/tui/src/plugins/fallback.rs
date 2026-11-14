//! The host's own `/plugins` while the plugin manager (`opencode.plugins`) has failed (synthesis 3.6, 4.10): the toasts
//! and the home footer still say "Run /plugins", so the host lists the TUI plugins and their errors, read only. Enter
//! on a row with an error shows it; enter on the manager's own row enables it again, which brings the manager back.

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
    let theme = tui.page();
    let options: Vec<SelectOption<String>> = tui
        .plugins
        .entries()
        .into_iter()
        .filter(|entry| entry.source != Source::Builtin || entry.id == super::manager::ID || failed(entry))
        .map(|entry| {
            let mut option = SelectOption::new(entry.id.clone(), entry.id.clone()).footer(footer(&entry));
            option.footer_color = Some(if failed(&entry) { theme.text.feedback.error.base } else { theme.text.muted });
            option
        })
        .collect();
    let weak = tui.weak();
    tui.dialogs.replace(
        move |cx| {
            let mut props = SelectProps::new("Plugins", options.clone());
            props.focus_target = focus.clone();
            props.on_select = Some(Rc::new(bind!(weak, |tui, option: &SelectOption<String>| {
                let id = option.value.clone();
                // The select is still handling the key.
                tui.app.defer(bind!(tui, |tui, _| pick(&tui, &id)));
            })));
            opencode_ui::select::select(cx, props).0
        },
        None,
        DialogOptions::new(DialogSize::Large),
    );
}

/// Enables the manager again, or shows a plugin's error with Back to its row.
fn pick(tui: &Rc<Tui>, id: &str) {
    if id == super::manager::ID {
        tui.dialogs.clear();
        return super::contain::enable(tui, id);
    }
    let Some(entry) = tui.plugins.entries().into_iter().find(|entry| entry.id == id) else { return };
    let (Status::Failed(error) | Status::Skipped(error)) = entry.status.clone() else { return };
    let source = entry.target.clone().unwrap_or_else(|| entry.id.clone());
    let props = error_details::Props {
        title: "TUI plugin error".to_owned(),
        source: Some(source.clone()),
        error,
        context: Some(format!("Plugin: {}\nStatus: failed\nRuntime: tui\nSource: {source}", entry.id)),
        diagnostic_ref: None,
        on_back: Rc::new(bind!(tui, |tui| {
            let id = entry.id.clone();
            tui.app.defer(bind!(tui, |tui, _| show(&tui, Some(id.clone()))));
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
