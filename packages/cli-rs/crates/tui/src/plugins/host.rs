//! The plugin host (P.1, `docs/P.1.md`): the built-in plugins on the plugin API, the `cli.json` `plugins`
//! entries, external plugins with hot reload (P.4, `docs/P.4.md`), and the calls the TUI's slots, plugin
//! routes, and Markdown make.

use std::cell::{Cell, OnceCell, RefCell};
use std::collections::HashMap;
use std::path::PathBuf;
use std::rc::{Rc, Weak};
use std::time::Duration;

use opencode_api::generated::{
    IntegrationInfo, McpServer, ModelInfo, ModelRef, ProviderID, ProviderInfo, SessionID, SessionMessageInfo,
    UsageLimitsInfo, VcsInfo,
};
use opencode_plugin::abi;
use opencode_plugin::loader::native::Native;
use opencode_plugin::loader::{Backend, Configured, Loader};
use opencode_plugin::node::{assign, refill, theme_color};
use opencode_plugin::{Definition, Registry, SlotInput, SlotMount, Slotted, Toast};
use opencode_store::location::{Catalog, Location, LocationData};
use opencode_store::{Changes, State};
use opencode_ui::bind;
use opencode_ui::dialog::DialogKeymap;
use opencode_ui::markdown::CodeBlockRenderers;
use opencode_ui::theme::Theme;
use opencode_ui::toast::{ToastOptions, Variant};
use opentui::keymap::Disposer;
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

    fn unchanged(changes: &Changes) -> bool {
        changes.is_empty()
    }

    fn storage_read(&self, key: &str) -> Option<String> {
        if let Some(json) = self.reads.stored.borrow().get(key) {
            return json.clone();
        }
        let value = self.storage().and_then(|storage| storage.load(key, &serde_json::Value::Null).ok());
        let json = value.filter(|value| !value.is_null()).map(|value| value.to_string());
        self.reads.stored.borrow_mut().insert(key.to_owned(), json.clone());
        json
    }

    fn storage_write(&self, key: &str, json: &str) -> Result<(), String> {
        let value: serde_json::Value = serde_json::from_str(json).map_err(|error| error.to_string())?;
        if !value.is_object() {
            return Err("a stored value is an object".to_owned());
        }
        self.reads.stored.borrow_mut().insert(key.to_owned(), Some(json.to_owned()));
        if let Some(storage) = self.storage() {
            let key = key.to_owned();
            self.app.runtime().spawn_blocking(move || {
                if let Err(error) = storage.update(&key, &serde_json::json!({}), |stored| *stored = value) {
                    log::error!("Failed to store {key}: {error}");
                }
            });
        }
        self.reads.changed(self);
        Ok(())
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

    fn dispatch(&self, name: &str, input: Option<&str>) {
        self.keymap.dispatch(name, input);
    }

    fn read(&self, f: &mut dyn FnMut(&dyn abi::Read)) {
        f(&Reader { tui: self, theme: OnceCell::new() });
    }

    fn changed(changes: &Changes, changed: &mut abi::Changed) {
        changed.all = changes.all;
        // A selection is part of the session's info to a plugin.
        let sessions = changes.session.iter().chain(&changes.status).chain(changes.selected.keys());
        refill(&mut changed.sessions, sessions, |into, id| assign(into, &id.0));
        refill(&mut changed.lists, &changes.messages, |into, id| assign(into, &id.0));
        let messages = changes.message.iter().flat_map(|(session, ids)| ids.iter().map(move |id| (session, id)));
        refill(&mut changed.messages, messages, |(into_session, into_id), (session, id)| {
            assign(into_session, &session.0);
            assign(into_id, &id.0);
        });
        refill(&mut changed.locations, &changes.locations, |into, location| {
            assign(&mut into.directory, &location.directory);
            match &location.workspace_id {
                Some(workspace) => assign(into.workspace.get_or_insert_default(), workspace),
                None => into.workspace = None,
            }
        });
        (changed.local, changed.size, changed.woken) = (false, false, false);
    }

    fn watch(&self, push: Rc<dyn Fn(&abi::Changed)>) -> Option<Disposer> {
        let local = abi::Changed { local: true, ..abi::Changed::default() };
        let listener = {
            let (push, local) = (push.clone(), local.clone());
            self.local.subscribe(move || push(&local))
        };
        let settings = {
            let push = push.clone();
            self.settings.subscribe(move |_| push(&local))
        };
        let resize = {
            let push = push.clone();
            self.app.on_resize(move |_, _, _| push(&abi::Changed { size: true, ..abi::Changed::default() }))
        };
        let mut watchers = self.reads.watchers.borrow_mut();
        watchers.retain(|watcher| watcher.strong_count() > 0);
        watchers.push(Rc::downgrade(&push));
        let app = self.app.clone();
        Some(Disposer::new(move || {
            listener.dispose();
            settings.dispose();
            app.remove_handler(resize);
            drop(push);
        }))
    }
}

/// What a mounted claim's [`opencode_plugin::Host::watch`] calls.
type Push = dyn Fn(&abi::Changed);

/// The catalog loads plugin reads asked for, which start once the current event is handled, a session ID buffer, so a
/// read by ID allocates nothing, and the plugins' storage.
#[derive(Default)]
pub struct Reads {
    needs: RefCell<Vec<(Catalog, Location)>>,
    key: Cell<SessionID>,
    /// The JSON text of each storage key read or written, so a write shows at once and storage works without disk.
    stored: RefCell<HashMap<String, Option<String>>>,
    /// The mounted claims' pushes, which a storage write calls with `local` once the current event is handled.
    watchers: RefCell<Vec<Weak<Push>>>,
    telling: Cell<bool>,
}

impl Reads {
    /// Tells the mounted claims that the storage changed, outside every plugin callback; writes in one event tell once.
    fn changed(&self, tui: &Tui) {
        if self.telling.replace(true) {
            return;
        }
        let weak = tui.weak();
        tui.app.defer(move |_| {
            let Some(tui) = weak.upgrade() else { return };
            tui.reads.telling.set(false);
            let pushes: Vec<_> = tui.reads.watchers.borrow().iter().filter_map(Weak::upgrade).collect();
            let local = abi::Changed { local: true, ..abi::Changed::default() };
            pushes.iter().for_each(|push| push(&local));
        });
    }

    fn need(&self, tui: &Tui, catalog: Catalog, location: Location) {
        let mut needs = self.needs.borrow_mut();
        if needs.iter().any(|(known, at)| *known == catalog && *at == location) {
            return;
        }
        needs.push((catalog, location));
        if needs.len() > 1 {
            return;
        }
        // Outside every plugin callback and store read: a load writes to the store.
        let weak = tui.weak();
        tui.app.defer(move |_| {
            let Some(tui) = weak.upgrade() else { return };
            let needs = std::mem::take(&mut *tui.reads.needs.borrow_mut());
            for (catalog, location) in needs {
                drop(tui.data.catalog_sync(catalog, Some(&location)));
            }
        });
    }
}

/// The TUI as the one API's renders read it (O-67). Every read is pure; a catalog that is not loaded asks
/// [`Reads::need`] for the load.
struct Reader<'a> {
    tui: &'a Tui,
    theme: OnceCell<Theme>,
}

impl Reader<'_> {
    /// Runs `f` on the store and session `id`.
    fn session<R>(&self, id: &str, f: impl FnOnce(&State, &SessionID) -> R) -> R {
        let mut key = self.tui.reads.key.take();
        assign(&mut key.0, id);
        let result = self.tui.data.read(|state| f(state, &key));
        self.tui.reads.key.set(key);
        result
    }

    /// `catalog` of `location` through `get`; a catalog that is not loaded asks for the load.
    fn catalog<T>(
        &self,
        location: Option<&abi::LocationRef>,
        catalog: Catalog,
        get: impl FnOnce(&LocationData) -> Option<T>,
    ) -> Option<T> {
        let location = self.location(location);
        let value = self.tui.data.read(|state| state.location(Some(&location)).and_then(get));
        if value.is_none() {
            self.tui.reads.need(self.tui, catalog, location);
        }
        value
    }

    /// `location`, or where the TUI works.
    fn location(&self, location: Option<&abi::LocationRef>) -> Location {
        match location {
            Some(location) => {
                Location { directory: location.directory.clone(), workspace_id: location.workspace.clone() }
            }
            None => self.tui.local.catalog_location(),
        }
    }
}

impl abi::Read for Reader<'_> {
    fn theme_mode(&self) -> abi::ThemeMode {
        match self.tui.theme.borrow().mode() {
            ThemeMode::Light => abi::ThemeMode::Light,
            _ => abi::ThemeMode::Dark,
        }
    }

    fn color(&self, token: &str) -> Option<abi::Rgba> {
        theme_color(self.theme.get_or_init(|| self.tui.page()), token)
    }

    fn session(&self, id: &str) -> Option<abi::Session> {
        self.session(id, |state, id| {
            let info = state.session(id)?.clone();
            Some(abi::Session { info, status: status(state.status(id)) })
        })
    }

    fn family(&self, id: &str) -> abi::Family {
        self.session(id, |state, id| abi::Family {
            members: state
                .family(id)
                .iter()
                .filter_map(|member| state.session(member))
                .map(|info| abi::Member {
                    id: info.id.0.clone(),
                    parent: info.parent_id.as_ref().map(|parent| parent.0.clone()),
                    status: status(state.status(&info.id)),
                    updated: info.time.updated,
                })
                .collect(),
            cost: state.cost(id),
        })
    }

    fn messages(&self, id: &str, visit: &mut dyn FnMut(&[SessionMessageInfo])) {
        // The store's reads nest, so `visit` may read again.
        self.session(id, |state, id| visit(state.messages(id)));
    }

    fn models(&self, location: Option<&abi::LocationRef>) -> Option<Vec<ModelInfo>> {
        self.catalog(location, Catalog::Model, |data| data.model.clone())
    }

    fn model(&self) -> Option<ModelRef> {
        let selection = self.tui.local.selection()?;
        Some(ModelRef {
            id: selection.model.model_id,
            provider_id: ProviderID(selection.model.provider_id),
            variant: selection.variant,
        })
    }

    fn limits(&self) -> Option<UsageLimitsInfo> {
        self.tui.local.usage().flatten()
    }

    fn providers(&self) -> Option<Vec<ProviderInfo>> {
        let location = self.location(None);
        self.tui.data.read(|state| state.location(Some(&location)).and_then(|data| data.provider.clone()))
    }

    fn info(&self) -> abi::Info {
        let location = self.location(None);
        abi::Info {
            version: self.tui.startup.args.version.clone(),
            size: self.tui.app.size(),
            location: abi::LocationRef { directory: location.directory, workspace: location.workspace_id },
        }
    }

    fn mcp_servers(&self, location: Option<&abi::LocationRef>) -> Option<Vec<McpServer>> {
        self.catalog(location, Catalog::McpServer, |data| data.mcp_server.clone())
    }

    fn integrations(&self, location: Option<&abi::LocationRef>) -> Option<Vec<IntegrationInfo>> {
        self.catalog(location, Catalog::Integration, |data| data.integration.clone())
    }

    fn vcs(&self, location: Option<&abi::LocationRef>) -> Option<VcsInfo> {
        self.catalog(location, Catalog::Vcs, |data| data.vcs.clone())
    }
}

fn status(status: opencode_store::SessionStatus) -> abi::SessionStatus {
    match status {
        opencode_store::SessionStatus::Idle => abi::SessionStatus::Idle,
        opencode_store::SessionStatus::Running => abi::SessionStatus::Running,
    }
}

/// The built-ins in TS order (`plugin/builtins.ts`), with the ones from other crates ([`crate::Deps::builtins`],
/// Mermaid and LaTeX) in their TS place after `stats`. The storybook (F14) is excepted (Q17).
pub fn builtins(external: Vec<Definition<Tui>>) -> Vec<Definition<Tui>> {
    let mut builtins = vec![
        super::home_footer::plugin(),
        super::prompt_footer::plugin(),
        super::btw::plugin(),
        super::sidebar_context::plugin().into(),
        super::sidebar_limit::plugin().into(),
        super::sidebar_mcp::plugin().into(),
        super::sidebar_todo::plugin().into(),
        super::sidebar_footer::plugin().into(),
        crate::plugins::notifications::plugin(),
        crate::dialogs::plugins::plugin(),
        super::stats::plugin(),
    ];
    builtins.extend(external);
    builtins.push(super::diffs::viewer::plugin());
    builtins
}

/// The registry of the built-ins and the `plugins` config, not yet active.
pub fn registry(info: &opencode_local::cli_config::Info, external: Vec<Definition<Tui>>) -> Plugins {
    let targets = info.plugins.iter().flatten().map(|plugin| match plugin {
        opencode_local::cli_config::Plugin::Name(name) => name.as_str(),
        opencode_local::cli_config::Plugin::Package { package, .. } => package.as_str(),
    });
    Registry::new(builtins(external), targets)
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
    let watches: Rc<RefCell<Vec<Watched>>> = Rc::default();
    watch(tui, &loader, &watches);
    tui.app.on_message(bind!(tui, |tui, _, _: &PluginsChanged| {
        loader.reconcile(&tui, &tui.plugins);
        watch(&tui, &loader, &watches);
    }));
}

/// A watched directory, the identity of the directory it watches, and the watch.
type Watched<W = opencode_local::watch::Watch> = (PathBuf, Option<u64>, W);

/// Watches the loader's directories: keeps the watches that still see them, and replaces one whose directory
/// went away or was made again, which the old watch no longer sees.
fn watch(tui: &Tui, loader: &Loader<Tui>, watches: &RefCell<Vec<Watched>>) {
    let fresh = unwatched(&mut watches.borrow_mut(), loader.watch_dirs());
    for (dir, id) in fresh {
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
            watches.borrow_mut().push((dir, id, watch));
        }
    }
}

/// Drops the watches of directories that are no longer in `dirs` or are not the directory they watched, and
/// returns the directories to watch, with their identity.
fn unwatched<W>(watches: &mut Vec<Watched<W>>, dirs: Vec<PathBuf>) -> Vec<(PathBuf, Option<u64>)> {
    let dirs: Vec<(PathBuf, Option<u64>)> = dirs
        .into_iter()
        .map(|dir| {
            let id = identity(&dir);
            (dir, id)
        })
        .collect();
    watches.retain(|(known, id, _)| dirs.iter().any(|(dir, current)| dir == known && current == id));
    dirs.into_iter().filter(|(dir, _)| !watches.iter().any(|(known, _, _)| known == dir)).collect()
}

/// What tells a directory from one made again at its path.
#[cfg(unix)]
fn identity(dir: &std::path::Path) -> Option<u64> {
    use std::os::unix::fs::MetadataExt;
    std::fs::metadata(dir).ok().map(|metadata| metadata.ino())
}

#[cfg(not(unix))]
fn identity(dir: &std::path::Path) -> Option<u64> {
    let created = std::fs::metadata(dir).ok()?.created().ok()?;
    created.duration_since(std::time::UNIX_EPOCH).ok().map(|since| since.as_nanos() as u64)
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

#[cfg(test)]
mod tests {
    use super::*;

    // Expected: a watched directory that is removed and made again gets a fresh watch, and a directory that left
    // the list loses its watch.
    #[test]
    fn a_directory_made_again_is_watched_again() {
        let root = opencode_util::temp::tempdir().unwrap();
        let (a, b) = (root.path().join("a"), root.path().join("b"));
        std::fs::create_dir(&a).unwrap();
        std::fs::create_dir(&b).unwrap();
        let mut watches: Vec<Watched<()>> = Vec::new();
        let fresh = unwatched(&mut watches, vec![a.clone(), b.clone()]);
        watches.extend(fresh.into_iter().map(|(dir, id)| (dir, id, ())));
        assert!(unwatched(&mut watches, vec![a.clone(), b.clone()]).is_empty());
        // Keep the old directory alive under another name, so the new one cannot reuse its inode.
        std::fs::rename(&a, root.path().join("old")).unwrap();
        std::fs::create_dir(&a).unwrap();
        let fresh = unwatched(&mut watches, vec![a.clone()]);
        assert_eq!(fresh.iter().map(|(dir, _)| dir).collect::<Vec<_>>(), [&a]);
        assert!(watches.is_empty());
    }
}
