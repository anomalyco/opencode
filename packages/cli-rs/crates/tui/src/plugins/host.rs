//! The plugin host (P.1, `docs/P.1.md`): the built-in plugins on the plugin API, the `cli.json` `plugins`
//! entries, external plugins with hot reload (P.4, `docs/P.4.md`), and the calls the TUI's slots, plugin
//! routes, and Markdown make.

use std::cell::RefCell;
use std::path::PathBuf;
use std::rc::Rc;
use std::time::Duration;

use opencode_plugin::loader::native::Native;
use opencode_plugin::loader::{Backend, Configured, Loader};
use opencode_plugin::{Definition, Registry, SlotInput, SlotMount, Slotted, Toast};
use opencode_store::Changes;
use opencode_ui::dialog::DialogKeymap;
use opencode_ui::markdown::CodeBlockRenderers;
use opencode_ui::theme::Theme;
use opencode_ui::toast::{ToastOptions, Variant};
use opentui::prelude::*;

use crate::app::Tui;
use crate::routes::Route;

pub type Plugins = Registry<Tui>;

impl opencode_plugin::Host for Tui {
    type Changes = Changes;

    fn app(&self) -> &App {
        &self.app
    }

    fn theme(&self) -> Theme {
        self.page()
    }

    fn theme_mode(&self) -> opentui::theme::ThemeMode {
        self.theme.borrow().mode()
    }

    fn keymap(&self) -> &DialogKeymap {
        &self.keymap
    }

    fn storage_read(&self, key: &str) -> Option<String> {
        let value = self.storage()?.load(key, &serde_json::Value::Null).ok()?;
        (!value.is_null()).then(|| value.to_string())
    }

    fn storage_write(&self, key: &str, json: &str) -> Result<(), String> {
        let storage = self.storage().ok_or("this TUI has no storage")?;
        let value: serde_json::Value = serde_json::from_str(json).map_err(|error| error.to_string())?;
        storage
            .update(key, &serde_json::json!({}), |stored| *stored = value)
            .map(|_| ())
            .map_err(|error| error.to_string())
    }

    fn toast(&self, variant: Toast, title: Option<&str>, message: &str) {
        let variant = match variant {
            Toast::Info => Variant::Info,
            Toast::Success => Variant::Success,
            Toast::Warning => Variant::Warning,
            Toast::Error => Variant::Error,
        };
        let mut options = ToastOptions::new(variant, message);
        if let Some(title) = title {
            options = options.title(title);
        }
        self.toasts.show(options);
    }

    fn open_route(&self, id: &str, name: &str) {
        self.dialogs.clear();
        self.navigate(Route::Plugin { id: id.to_owned(), name: name.to_owned() });
    }

    fn remount(&self) {
        self.navigate(self.route());
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

/// What [`external`] needs: the global config directory and the working directory.
pub struct External {
    pub config_dir: PathBuf,
    pub cwd: PathBuf,
}

/// Posted when a watched plugin directory changed.
struct PluginsChanged;

/// Loads the external native plugins (P.4): the discovered `plugins` directories and the `cli.json` entries that name no
/// built-in. Each change in a watched directory reconciles them again (hot reload), debounced by 100 ms as in TS.
pub fn external(tui: &Rc<Tui>, external: External) {
    let options = |target: &str| {
        tui.config().info.plugins.iter().flatten().find_map(|plugin| match plugin {
            opencode_local::cli_config::Plugin::Package { package, options: Some(options) } if package == target => {
                Some(serde_json::Value::Object(options.clone()).to_string())
            }
            _ => None,
        })
    };
    let configured =
        tui.plugins.skipped().into_iter().map(|target| Configured { options: options(&target), target }).collect();
    let loader =
        Rc::new(Loader::new(Rc::new(Native) as Rc<dyn Backend<Tui>>, external.config_dir, external.cwd, configured));
    loader.reconcile(tui, &tui.plugins);
    let watches: Rc<RefCell<Vec<(PathBuf, opencode_local::watch::Watch)>>> = Rc::default();
    watch(tui, &loader, &watches);
    let weak = tui.weak();
    tui.app.on_message(move |_, _: &PluginsChanged| {
        let Some(tui) = weak.upgrade() else { return };
        loader.reconcile(&tui, &tui.plugins);
        watch(&tui, &loader, &watches);
    });
}

/// Watches the loader's directories that are not watched yet. A watch that stops seeing its directory costs a
/// handle until the TUI exits, as in TS.
fn watch(tui: &Tui, loader: &Loader<Tui>, watches: &RefCell<Vec<(PathBuf, opencode_local::watch::Watch)>>) {
    for dir in loader.watch_dirs() {
        if watches.borrow().iter().any(|(known, _)| *known == dir) {
            continue;
        }
        let proxy = tui.app.proxy();
        let watch = opencode_local::watch::watch(
            &dir,
            |_| true,
            Duration::from_millis(100),
            move || {
                let _ = proxy.send(PluginsChanged);
            },
        );
        if let Some(watch) = watch {
            watches.borrow_mut().push((dir, watch));
        }
    }
}

/// Adds and activates one more plugin, then remounts the route so its claims show.
pub fn add(tui: &Rc<Tui>, plugin: Definition<Tui>) {
    tui.plugins.add(plugin);
    tui.plugins.activate(tui);
    tui.navigate(tui.route());
}

/// Mounts slot `path` with the host's `content` into `parent`. The view that owns the slot syncs the result.
pub fn slot(tui: &Tui, parent: &View, path: &str, input: &SlotInput, content: impl FnOnce(&View)) -> SlotMount<Tui> {
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
