//! The plugin host (P.1, `docs/P.1.md`): the built-in plugins on the plugin API, the `cli.json` `plugins`
//! entries, and the calls the TUI's slots, plugin routes, and Markdown make.

use std::rc::Rc;

use opencode_plugin::{Definition, Registry, SlotInput, SlotMount, Slotted};
use opencode_store::Changes;
use opencode_ui::dialog::DialogKeymap;
use opencode_ui::markdown::CodeBlockRenderers;
use opencode_ui::theme::Theme;
use opentui::prelude::*;

use crate::app::Tui;

pub type Plugins = Registry<Tui>;

impl opencode_plugin::Host for Tui {
    type Changes = Changes;

    fn app(&self) -> &App {
        &self.app
    }

    fn theme(&self) -> Theme {
        self.page()
    }

    fn keymap(&self) -> &DialogKeymap {
        &self.keymap
    }
}

/// The built-ins in TS order (`plugin/builtins.ts`). The storybook (F14) is excepted (Q17).
pub fn builtins() -> Vec<Definition<Tui>> {
    vec![
        super::home_footer::plugin(),
        super::prompt_footer::plugin(),
        super::btw::plugin(),
        super::sidebar_context::plugin(),
        super::sidebar_limit::plugin(),
        super::sidebar_mcp::plugin(),
        super::sidebar_todo::plugin(),
        super::sidebar_footer::plugin(),
        crate::plugins::notifications::plugin(),
        crate::dialogs::plugins::plugin(),
        super::stats::plugin(),
        opencode_mermaid::plugin(),
        opencode_latex::plugin(),
        super::diffs::viewer::plugin(),
    ]
}

/// The registry of the built-ins and the `plugins` config, not yet active.
pub fn registry(info: &opencode_local::cli_config::Info) -> Plugins {
    let targets = info.plugins.iter().flatten().map(|plugin| match plugin {
        opencode_local::cli_config::Plugin::Name(name) => name.as_str(),
        opencode_local::cli_config::Plugin::Package { package, .. } => package.as_str(),
    });
    Registry::new(builtins(), targets)
}

/// Activates the plugins once the TUI is built, and logs the configured plugins it skipped.
pub fn install(tui: &Rc<Tui>) {
    for target in tui.plugins.skipped() {
        log::warn!("plugin {target} skipped: {}", opencode_plugin::SKIPPED);
    }
    tui.plugins.activate(tui);
}

/// Adds and activates one more plugin, then remounts the route so its claims show.
pub fn add(tui: &Rc<Tui>, plugin: Definition<Tui>) {
    tui.plugins.add(plugin);
    tui.plugins.activate(tui);
    tui.navigate(tui.route());
}

/// Mounts slot `path` with the host's `content` into `parent`. The view that owns the slot syncs the result.
pub fn slot(
    tui: &Tui,
    parent: &View,
    path: &str,
    input: &SlotInput,
    content: impl FnOnce(&View),
) -> SlotMount<Tui> {
    tui.plugins.mount(tui, parent, path, input, content)
}

/// The view of plugin route `id`/`name`, if a plugin registers it.
pub fn route(tui: &Tui, id: &str, name: &str) -> Option<Box<dyn Slotted<Tui>>> {
    tui.plugins.route(tui, id, name)
}

/// The plugins' Markdown code-block renderers in the page theme.
pub fn code_blocks(tui: &Tui) -> CodeBlockRenderers {
    tui.plugins.code_blocks(&tui.page())
}
