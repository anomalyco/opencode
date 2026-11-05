//! System commands and toggles (E.20, rows T16 and T19), `app.tsx:1083-1290`. T.1 registers `app.exit`,
//! `help.show`, `session.new`, and the palette in `app::install_keys`, and calls [`install`] once for the rest.
//!
//! As in TS, only `docs.open`, `app.console`, and `location.reload` show in the palette; the others run from
//! their keybinds (all `none` by default except `terminal.suspend`, Ctrl+Z). The toggles write `cli.json`
//! through the settings writer (E.18a), so every view that reads the live config follows them.
//!
//! `service.restart` is not registered: TS offers it only for a managed service, and restarting stops the
//! shared service, which this client never does (orchestrator O-21).
//!
//! T16: [`mouse_tracking`] picks the startup mouse mode, and `mouse` changes apply while the TUI runs;
//! [`cursor`] is the prompt's cursor shape.

use std::cell::Cell;
use std::rc::Rc;

use opencode_api::client::RequestOptions;
use opencode_local::cli_config::{CursorStyle, DiffWrap, Info, PromptPaste, Resolved};
use opencode_ui::bind;
use opencode_ui::keymap::{Bind, GLOBAL_MODE, KeymapLayer, Slash, TuiCommand};
use opencode_ui::toast::{ToastOptions, Variant};
use opentui::keymap::{Condition, Disposer};
use opentui::native::{Control, MouseTracking};
use serde_json::Value;

use crate::app::Tui;
use crate::dialogs::settings::{set_path, update};

const DOCS: &str = "https://opencode.ai/v2/docs";

/// Registers the commands; the caller keeps the returned layers.
pub fn install(tui: &Rc<Tui>) -> Vec<Disposer> {
    let info = tui.settings.info();
    let command = |id: &str, title: &str, run: fn(&Tui)| {
        TuiCommand::new(id, bind!(tui, |tui, _, _| run(&tui))).bind(Bind::Off).title(title).group("System")
    };
    let commands = vec![
        command("location.reload", "Reload configuration", reload).palette().slash(Slash {
            name: "reload".to_owned(),
            aliases: Vec::new(),
            arguments: false,
        }),
        command("docs.open", "Open docs", |tui| {
            // TS ignores a failure here.
            let _ = crate::features::links::open_url(DOCS);
            tui.dialogs.clear();
        })
        .palette(),
        command("app.debug", "Toggle debug panel", |tui| {
            tui.app.toggle_debug_overlay();
            tui.dialogs.clear();
        }),
        command("app.console", "Toggle console", |tui| {
            tui.app.console().toggle();
            tui.dialogs.clear();
        })
        .palette(),
        command("terminal.suspend", "Suspend terminal", |tui| tui.app.suspend()).enabled(if cfg!(windows) {
            Condition::Never
        } else {
            Condition::Always
        }),
        command("terminal.title.toggle", &toggle_title(title_enabled(&info), "terminal title"), |tui| {
            let next = !title_enabled(&tui.settings.info());
            if !next {
                crate::features::title::clear(tui);
            }
            write(tui, &["terminal", "title"], Value::Bool(next));
        }),
        command("app.toggle.animations", &toggle_title(info.animations.unwrap_or(true), "animations"), |tui| {
            let next = !tui.settings.info().animations.unwrap_or(true);
            write(tui, &["animations"], Value::Bool(next));
        }),
        command("app.toggle.file_context", &toggle_title(file_context(&info), "file context"), |tui| {
            let next = !file_context(&tui.settings.info());
            write(tui, &["prompt", "editor"], Value::Bool(next));
        }),
        command("app.toggle.diffwrap", &toggle_title(diff_wrap(&info), "diff wrapping"), |tui| {
            let next = if diff_wrap(&tui.settings.info()) { "none" } else { "word" };
            write(tui, &["diffs", "wrap"], Value::from(next));
        }),
        command("app.toggle.paste_summary", &toggle_title(paste_summary(&info), "paste summary"), |tui| {
            let next = if paste_summary(&tui.settings.info()) { "full" } else { "compact" };
            write(tui, &["prompt", "paste"], Value::from(next));
        }),
    ];
    let ids: Vec<String> = commands.iter().filter_map(|c| c.id.clone()).collect();
    let layers = [
        KeymapLayer { mode: Some(GLOBAL_MODE.to_owned()), commands, ..KeymapLayer::default() },
        // `appBindingCommands` (`app.tsx:150-186`).
        KeymapLayer { bindings: ids, ..KeymapLayer::default() },
    ];
    install_effects(tui);
    layers
        .into_iter()
        .filter_map(|layer| {
            tui.keymap.layer(layer).inspect_err(|error| log::error!("system commands keymap layer: {error}")).ok()
        })
        .collect()
}

/// The mouse mode the terminal starts in: motion tracking for hover, or none with `mouse: false`
/// (`useMouse: config.mouse`).
pub fn mouse_tracking(config: &Resolved) -> MouseTracking {
    if config.mouse { MouseTracking::Motion } else { MouseTracking::Off }
}

/// The configured cursor (`useCursorStyle`): `cursor.style`, else a block, and `cursor.blinking`, else on.
pub fn cursor(config: &Resolved) -> (opentui::native::CursorStyle, bool) {
    let style = match config.cursor_style {
        CursorStyle::Block => opentui::native::CursorStyle::Block,
        CursorStyle::Underline => opentui::native::CursorStyle::Underline,
        CursorStyle::Line => opentui::native::CursorStyle::Line,
        CursorStyle::Default => opentui::native::CursorStyle::Default,
    };
    (style, config.cursor_blinking)
}

/// What TS effects redo when the config changes: `renderer.useMouse = config.data.mouse`, and the title effect,
/// which sets the route's title again once `terminal.title` is back on.
fn install_effects(tui: &Rc<Tui>) {
    let mouse = Rc::new(Cell::new(tui.config().mouse));
    let title = Rc::new(Cell::new(title_enabled(&tui.config().info)));
    tui.settings.on_change(move |tui| {
        let info = tui.settings.info();
        if !title.replace(title_enabled(&info)) && title.get() {
            crate::features::title::route_changed(tui);
        }
        let next = info.mouse.unwrap_or(true);
        if mouse.replace(next) == next {
            return;
        }
        let mouse = next;
        let tracking = if mouse { MouseTracking::Motion } else { MouseTracking::Off };
        // Before terminal setup (tests) there is no terminal to tell.
        if let Err(error) = tui.app.session().control(Control::Mouse(tracking)) {
            log::debug!("mouse mode not applied: {error}");
        }
    });
}

/// `location.reload`: closes dialogs, then reloads the server configuration with progress toasts.
fn reload(tui: &Tui) {
    tui.dialogs.clear();
    tui.toasts.show(
        ToastOptions::new(Variant::Info, "Reloading configuration…").duration(std::time::Duration::from_secs(30)),
    );
    let client = tui.data.client().clone();
    tui.app.spawn(
        async move { client.location_reload(&RequestOptions::default()).await.map_err(|error| error.to_string()) },
        bind!(tui, |tui, _, result| {
            match result {
                Ok(()) => tui.toasts.show(ToastOptions::new(Variant::Success, "Configuration reloaded")),
                Err(error) => tui.toasts.error(error),
            }
        }),
    );
}

/// One `config.update` of a toggle, then closes dialogs.
fn write(tui: &Tui, path: &'static [&'static str], value: Value) {
    update(tui, move |draft| set_path(draft, path, value));
    tui.dialogs.clear();
}

/// "Disable X" while on, "Enable X" while off. The titles are fixed at startup: TS shows them only in the
/// palette, and these commands are not in it.
fn toggle_title(on: bool, what: &str) -> String {
    format!("{} {what}", if on { "Disable" } else { "Enable" })
}

pub(crate) fn title_enabled(info: &Info) -> bool {
    info.terminal.as_ref().and_then(|terminal| terminal.title).unwrap_or(true)
}

fn file_context(info: &Info) -> bool {
    info.prompt.as_ref().and_then(|prompt| prompt.editor).unwrap_or(true)
}

fn diff_wrap(info: &Info) -> bool {
    info.diffs.as_ref().and_then(|diffs| diffs.wrap).unwrap_or(DiffWrap::Word) == DiffWrap::Word
}

/// `prompt.paste !== "full"`.
fn paste_summary(info: &Info) -> bool {
    info.prompt.as_ref().and_then(|prompt| prompt.paste) != Some(PromptPaste::Full)
}

#[cfg(test)]
mod tests {
    use super::*;
    use opencode_local::cli_config::merge;
    use serde_json::json;

    #[test]
    fn toggle_reads_follow_the_typescript_defaults() {
        let empty = merge(&[None]);
        assert!(title_enabled(&empty) && file_context(&empty));
        assert!(diff_wrap(&empty) && paste_summary(&empty));
        let set = merge(&[Some(json!({
            "terminal": { "title": false },
            "prompt": { "editor": false, "paste": "full" },
            "diffs": { "wrap": "none" },
        }))]);
        assert!(!title_enabled(&set) && !file_context(&set));
        assert!(!diff_wrap(&set) && !paste_summary(&set));
        assert_eq!(toggle_title(true, "animations"), "Disable animations");
        assert_eq!(toggle_title(false, "terminal title"), "Enable terminal title");
    }
}
