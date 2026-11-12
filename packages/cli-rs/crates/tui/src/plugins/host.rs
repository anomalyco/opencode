//! The plugin host (P.1, `docs/P.1.md`): the built-in plugins on the plugin API, the `cli.json` `plugins`
//! entries, external plugins with hot reload (P.4, `docs/P.4.md`), and the calls the TUI's slots, plugin
//! routes, and Markdown make.

use std::cell::OnceCell;
use std::ops::Deref;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use opencode_api::generated::{
    IntegrationInfo, LocationQueryInput, McpServer, ModelInfo, ModelRef, PluginInfo, PluginListInput, PluginSource,
    PluginState, ProviderID, ProviderInfo, UsageLimitsInfo, V2Event, VcsInfo,
};
use opencode_local::cli_config::AttentionSoundName;
use opencode_local::serial::Serial;
use opencode_local::storage::Storage;
use opencode_plugin::abi;
use opencode_plugin::loader::native::Native;
use opencode_plugin::loader::{Configured, Loader};
use opencode_plugin::node::{abi_mode, assign, refill, theme_color};
use opencode_plugin::{Builtin, Definition, Host, Registry, RouteMount, SlotInput, SlotMount, Status};
use opencode_store::State;
use opencode_store::location::{Catalog, Location, LocationData};
use opencode_ui::dialog::DialogKeymap;
use opencode_ui::markdown::CodeBlockRenderers;

use crate::features::attention::focus::When;
use crate::features::attention::notify::{self, Request, Sound};
use crate::prelude::*;

/// The plugin registry, and what its host entries ([`Builtin::Host`]) reach the TUI through once `Rc<Tui>` exists.
pub struct Plugins {
    registry: Registry,
    tui: Rc<OnceCell<Weak<Tui>>>,
    /// The diff viewer's state while it is active, which its route shows.
    pub(crate) diffs: RefCell<Option<Rc<super::diffs::viewer::Shared>>>,
}

impl Deref for Plugins {
    type Target = Registry;

    fn deref(&self) -> &Registry {
        &self.registry
    }
}

impl Host for Tui {
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
        if let Some(json) = self.reads.stored.borrow().get(key) {
            return json.clone();
        }
        let json = self.storage().and_then(|storage| load(&storage, key));
        self.reads.stored.borrow_mut().insert(key.to_owned(), json.clone());
        json
    }

    fn storage_write(&self, key: &str, json: &str) -> Result<(), String> {
        let value: serde_json::Value = serde_json::from_str(json).map_err(|error| error.to_string())?;
        // The frozen 1.3 SDK stores arrays too (`typeof value === "object"`).
        if !(value.is_object() || value.is_array()) {
            return Err("a stored value is an object or an array".to_owned());
        }
        store(self, key, value.clone(), move |stored| *stored = value);
        Ok(())
    }

    fn storage_merge(&self, key: &str, fields: serde_json::Map<String, serde_json::Value>) -> Result<(), String> {
        let shown = match self.storage_read(key).and_then(|json| serde_json::from_str(&json).ok()) {
            Some(serde_json::Value::Object(object)) => object.into_iter().chain(fields.clone()).collect(),
            _ => fields.clone(),
        };
        store(self, key, serde_json::Value::Object(shown), move |stored| match stored.as_object_mut() {
            Some(object) => object.extend(fields),
            None => *stored = serde_json::Value::Object(fields),
        });
        Ok(())
    }

    fn storage_changed(&self) {
        self.reads.changed(self);
    }

    fn toast(&self, toast: &abi::Toast) {
        let variant = match toast.variant {
            abi::Variant::Info => Variant::Info,
            abi::Variant::Success => Variant::Success,
            abi::Variant::Warning => Variant::Warning,
            abi::Variant::Error => Variant::Error,
        };
        let mut options = ToastOptions::new(variant, toast.message.clone());
        options.title = toast.title.clone();
        // A toast about a session offers to open it, unless the session's family is on screen.
        let Some(session) = toast.session.as_ref().map(|id| SessionID(id.clone())) else {
            return self.toasts.show(options);
        };
        let here = match self.route() {
            Route::Session { id: open } => self.data.read(|state| state.root(&open) == state.root(&session)),
            _ => false,
        };
        if !here {
            if options.title.is_none() {
                options.title = self.data.read(|state| state.session(&session).and_then(|info| info.title.clone()));
            }
            let route = Route::Session { id: session };
            options = options.action("Open", bind!(self, |tui| tui.navigate(route.clone())));
        }
        self.toasts.show(options);
    }

    fn failed(&self, id: &str) {
        failed_toast(self, format!("Plugin failed: {id}"), String::new());
        // The home footer counts the failed plugins.
        self.reads.changed(self);
    }

    fn attention(&self, attention: &abi::Attention) {
        let when = |when| match when {
            abi::When::Always => When::Always,
            abi::When::Focused => When::Focused,
            abi::When::Blurred => When::Blurred,
        };
        let sound = attention.sound.as_ref().map(|sound| Sound {
            name: match sound.name {
                abi::SoundName::Default => AttentionSoundName::Default,
                abi::SoundName::Question => AttentionSoundName::Question,
                abi::SoundName::Permission => AttentionSoundName::Permission,
                abi::SoundName::Error => AttentionSoundName::Error,
                abi::SoundName::Done => AttentionSoundName::Done,
                abi::SoundName::SubagentDone => AttentionSoundName::SubagentDone,
            },
            when: when(sound.when),
            volume: sound.volume,
        });
        let request = Request {
            title: attention.title.clone(),
            message: attention.message.clone(),
            notification: attention.notify.map(when),
            sound,
        };
        notify::notify(self, &request);
    }

    fn on_event(&self, types: &[String], run: Rc<dyn Fn(&V2Event)>) -> Option<Disposer> {
        Some(crate::features::events::subscribe(self, types.iter().cloned(), move |_, event| run(event)))
    }

    fn slot(&self, parent: &View, path: &str, input: &SlotInput) -> Option<SlotMount> {
        Some(self.plugins.mount(self, parent, path, input, |_| {}))
    }

    fn open_route(&self, id: &str, name: &str) {
        self.dialogs.clear();
        self.navigate(Route::Plugin { id: id.to_owned(), name: name.to_owned() });
    }

    fn remount(&self) {
        self.navigate(self.route());
        crate::dialogs::plugins::refresh(self);
    }

    fn dispatch(&self, name: &str, input: Option<&str>) {
        self.keymap.dispatch(name, input);
    }

    fn navigate(&self, _: &str, route: &abi::Route) {
        let route = match route {
            abi::Route::Home => Route::Home,
            abi::Route::Session { id } => Route::Session { id: SessionID(id.clone()) },
            abi::Route::Plugin { id, name } => {
                self.dialogs.clear();
                Route::Plugin { id: id.clone(), name: name.clone() }
            }
        };
        self.navigate(route);
    }

    fn fetch(&self, fetch: abi::Fetch, reply: Box<dyn FnOnce(Result<Value, String>)>) {
        // The client of the moment, on the transport that follows a restarted service.
        let client = self.data.client().clone();
        let call = super::fetch::call_of(fetch);
        self.app
            .spawn(async move { client.reply(call?).await.map_err(|error| error.tui_message()) }, move |_, result| {
                reply(result)
            });
    }

    fn dialog(&self, id: &str, dialog: abi::Dialog) {
        super::panel::show(self, id, dialog);
    }

    fn dialog_open(&self, id: &str, key: &str) -> bool {
        super::panel::open(self, id, key)
    }

    fn copy(&self, text: &str) -> bool {
        let copied = crate::features::selection::put(&self.app, text);
        if !copied {
            self.toasts.error("Failed to copy to clipboard");
        }
        copied
    }

    fn markdown(&self, text: &str) -> AnyWidget {
        markdown(self).set_markdown(text).as_any()
    }

    fn read(&self, f: &mut dyn FnMut(&dyn abi::Read)) {
        f(&Reader { tui: self, theme: OnceCell::new() });
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

/// Calls `sync` with what change batch `changes` changed for the plugins' claims and routes, or with `None` when it
/// changed nothing.
pub fn changed(tui: &Tui, changes: &Changes, sync: impl FnOnce(Option<&abi::Changed>)) {
    if changes.is_empty() {
        return sync(None);
    }
    // Refilled with each change batch, so a batch like the one before costs no allocation.
    let mut changed = tui.reads.batch.take();
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
    sync(Some(&changed));
    tui.reads.batch.replace(changed);
}

/// Shows `shown` under storage key `key` at once, and queues `change` of the latest stored value under the storage
/// lock after every write made before it. The plugin queues [`opencode_plugin::Host::storage_changed`] after it.
fn store(tui: &Tui, key: &str, shown: Value, change: impl FnOnce(&mut Value) + Send + 'static) {
    tui.reads.stored.borrow_mut().insert(key.to_owned(), Some(shown.to_string()));
    if let Some(storage) = tui.storage() {
        let pending = tui.reads.pending.clone();
        pending.fetch_add(1, Ordering::SeqCst);
        let key = key.to_owned();
        tui.reads.writer.get_or_init(|| Serial::new("plugin-storage")).run(move || {
            if let Err(error) = storage.update(&key, &serde_json::json!({}), change) {
                log::error!("Failed to store {key}: {error}");
            }
            pending.fetch_sub(1, Ordering::SeqCst);
        });
    }
}

/// Waits until every plugin storage write queued so far is on disk.
pub fn flush_storage(tui: &Tui) {
    if let Some(writer) = tui.reads.writer.get() {
        writer.flush();
    }
}

fn load(storage: &Storage, key: &str) -> Option<String> {
    storage.load(key, &Value::Null).ok().filter(|value| !value.is_null()).map(|value| value.to_string())
}

/// Reads the plugins' stored keys again after the storage directory changed, so another client's writes show. While a
/// write of this TUI is queued the keys stay; its own change of the directory reads them again after it.
pub fn reload_storage(tui: &Tui) {
    let Some(storage) = tui.storage().filter(|_| tui.reads.pending.load(Ordering::SeqCst) == 0) else { return };
    let mut changed = false;
    for (key, json) in tui.reads.stored.borrow_mut().iter_mut() {
        let fresh = load(&storage, key);
        changed |= *json != fresh;
        *json = fresh;
    }
    if changed {
        tui.reads.changed(tui);
    }
}

/// TS's error toast for a failed plugin, which offers to open the plugin manager.
fn failed_toast(tui: &Tui, title: String, names: String) {
    let mut options = ToastOptions::new(Variant::Error, format!("{names}Run /plugins to view details."));
    options.title = Some(title);
    let options = options.action(
        "Open plugins",
        bind!(tui, |tui| {
            tui.keymap.dispatch("plugins.list", None);
        }),
    );
    tui.toasts.show(options);
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
    /// The one worker that writes the plugins' storage, so writes land in the order they were made.
    writer: OnceCell<Serial>,
    /// The writes queued and not yet on disk.
    pending: Arc<AtomicUsize>,
    /// The mounted claims' pushes, which a storage write calls with `local` from the effect queue.
    watchers: RefCell<Vec<Weak<Push>>>,
    telling: Cell<bool>,
    /// The server plugins of the default location (TS `plugins.server()`), and that location.
    server: RefCell<(Option<Location>, Vec<PluginInfo>)>,
    /// What the last change batch changed, for the plugins.
    batch: RefCell<abi::Changed>,
    /// The plugin panel on screen.
    pub(super) panel: RefCell<Option<super::panel::Live>>,
}

impl Reads {
    /// Tells the mounted claims that the storage changed. The plugins queue it after a write, so it is in order with
    /// their other effects; it tells at the end of the queue, once for every write queued before then.
    fn changed(&self, tui: &Tui) {
        if self.telling.replace(true) {
            return;
        }
        tui.app.defer(bind!(tui, |tui, _| {
            tui.reads.telling.set(false);
            let pushes: Vec<_> = tui.reads.watchers.borrow().iter().filter_map(Weak::upgrade).collect();
            let local = abi::Changed { local: true, ..abi::Changed::default() };
            pushes.iter().for_each(|push| push(&local));
        }));
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
        tui.app.defer(bind!(tui, |tui, _| {
            let needs = std::mem::take(&mut *tui.reads.needs.borrow_mut());
            for (catalog, location) in needs {
                drop(tui.data.catalog_sync(catalog, Some(&location)));
            }
        }));
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
        abi_mode(self.tui.theme.borrow().mode())
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
            shells: state.session_shells(id).len(),
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
        self.catalog(None, Catalog::Provider, |data| data.provider.clone())
    }

    fn info(&self) -> abi::Info {
        let location = self.location(None);
        let failed =
            self.tui.plugins.entries().iter().filter(|entry| matches!(entry.status, Status::Failed(_))).count();
        abi::Info {
            version: self.tui.startup.args.version.clone(),
            size: self.tui.app.size(),
            location: abi::LocationRef { directory: location.directory, workspace: location.workspace_id },
            failed_plugins: failed + server_failed(&self.tui.reads.server.borrow().1),
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

    fn route(&self) -> abi::Route {
        match self.tui.route() {
            Route::Home => abi::Route::Home,
            Route::Session { id } => abi::Route::Session { id: id.0 },
            Route::Plugin { id, name } => abi::Route::Plugin { id, name },
        }
    }

    fn interactive(&self) -> bool {
        crate::frame::session_interactive(self.tui)
    }

    fn shortcut(&self, name: &str) -> Option<String> {
        self.tui.keymap.shortcut(name)
    }
}

fn status(status: opencode_store::SessionStatus) -> abi::SessionStatus {
    match status {
        opencode_store::SessionStatus::Idle => abi::SessionStatus::Idle,
        opencode_store::SessionStatus::Running => abi::SessionStatus::Running,
    }
}

/// The built-ins in TS order (`plugin/builtins.ts`), with the ones from other crates ([`crate::Deps::builtins`],
/// Mermaid and LaTeX) in their TS place after `stats`. The storybook (F14) is excepted (Q17). The plugin manager and
/// the diff viewer are host entries, which reach the TUI through `tui` once it exists.
fn builtins(tui: &Rc<OnceCell<Weak<Tui>>>, external: Vec<Builtin>) -> Vec<Builtin> {
    let mut builtins = vec![
        super::home_footer::plugin().into(),
        super::prompt_footer::plugin().into(),
        super::btw::plugin().into(),
        super::sidebar_context::plugin().into(),
        super::sidebar_limit::plugin().into(),
        super::sidebar_mcp::plugin().into(),
        super::sidebar_todo::plugin().into(),
        super::sidebar_footer::plugin().into(),
        crate::plugins::notifications::plugin().into(),
        hosted(tui, crate::dialogs::plugins::ID, crate::dialogs::plugins::activate),
        super::stats::plugin().into(),
    ];
    builtins.extend(external);
    builtins.push(hosted(tui, super::diffs::viewer::ID, super::diffs::viewer::activate));
    builtins
}

/// A part of the TUI that the plugin manager lists and toggles like a plugin, which is not plugin API: `activate` runs
/// on activation once the TUI exists, and the disposer it returns runs on deactivation.
fn hosted(tui: &Rc<OnceCell<Weak<Tui>>>, id: &'static str, activate: fn(&Rc<Tui>) -> Disposer) -> Builtin {
    let active: Rc<RefCell<Option<Disposer>>> = Rc::default();
    let (tui, disposer) = (tui.clone(), active.clone());
    Builtin::Host {
        id,
        activate: Rc::new(move || {
            if let Some(tui) = tui.get().and_then(Weak::upgrade) {
                *disposer.borrow_mut() = Some(activate(&tui));
            }
        }),
        dispose: Rc::new(move || drop(active.take())),
    }
}

/// The registry of the built-ins and the `plugins` config, not yet active.
pub fn registry(info: &opencode_local::cli_config::Info, external: Vec<Builtin>) -> Plugins {
    let targets = info.plugins.iter().flatten().map(target);
    let tui = Rc::default();
    Plugins { registry: Registry::new(builtins(&tui, external), targets), tui, diffs: RefCell::default() }
}

/// A `plugins` entry's target.
fn target(plugin: &opencode_local::cli_config::Plugin) -> &str {
    match plugin {
        opencode_local::cli_config::Plugin::Name(name) => name,
        opencode_local::cli_config::Plugin::Package { package, .. } => package,
    }
}

/// The TUI as the plugin registry takes it.
pub fn host(tui: &Rc<Tui>) -> Rc<dyn Host> {
    tui.clone()
}

/// Activates the plugins once the TUI is built.
pub fn install(tui: &Rc<Tui>) {
    let _ = tui.plugins.tui.set(tui.weak());
    tui.plugins.activate(&host(tui));
    crate::features::events::subscribe(tui, ["plugin.updated", "server.connected"], |tui, event| {
        if matches!(event, V2Event::PluginUpdated(_) | V2Event::ServerConnected(_)) {
            sync_server_plugins(tui);
        }
    })
    .forget();
    sync_server_plugins(tui);
}

/// Reads the server plugins again once the default location changed.
pub fn sync(tui: &Tui) {
    let default = tui.data.read(|state| state.default_location().clone());
    if tui.reads.server.borrow().0.as_ref() != Some(&default) {
        sync_server_plugins(tui);
    }
}

/// `syncServerPlugins`: reads the server plugins of the default location, and shows the plugins that newly failed in
/// one error toast.
fn sync_server_plugins(tui: &Tui) {
    let location = tui.data.read(|state| state.default_location().clone());
    let input = PluginListInput { location: Some(LocationQueryInput { directory: Some(location.directory.clone()) }) };
    tui.reads.server.borrow_mut().0 = Some(location);
    let client = tui.data.client().clone();
    tui.app.spawn(
        async move { client.plugin_list(&input).await },
        bind!(tui, |tui, _, result| {
            let Ok(output) = result else { return };
            let before = std::mem::replace(&mut tui.reads.server.borrow_mut().1, output.data.clone());
            let failed: Vec<String> = output
                .data
                .iter()
                .filter(|plugin| matches!(plugin.state, PluginState::Failed(_)))
                .filter(|plugin| {
                    !before
                        .iter()
                        .any(|previous| server_name(previous) == server_name(plugin) && previous.state == plugin.state)
                })
                .map(server_name)
                .collect();
            if server_failed(&before) != server_failed(&output.data) {
                tui.reads.changed(&tui);
            }
            match failed.as_slice() {
                [] => {}
                [name] => failed_toast(&tui, format!("Plugin failed: {name}"), String::new()),
                names => {
                    failed_toast(&tui, format!("{} plugins failed", names.len()), format!("{}\n", names.join(", ")))
                }
            }
        }),
    );
}

fn server_failed(plugins: &[PluginInfo]) -> usize {
    plugins.iter().filter(|plugin| matches!(plugin.state, PluginState::Failed(_))).count()
}

/// `serverPluginName`.
fn server_name(plugin: &PluginInfo) -> String {
    if let Some(id) = &plugin.id {
        return id.0.clone();
    }
    match &plugin.source {
        PluginSource::Package(package) => package.target.clone(),
        PluginSource::Local(local) => local.path.clone(),
        PluginSource::Builtin(source) => source.r#type.clone(),
        PluginSource::Sdk(source) => source.r#type.clone(),
        PluginSource::Unknown(value) => value.get("type").and_then(Value::as_str).unwrap_or_default().to_owned(),
    }
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
    let entries = configured(tui, tui.plugins.skipped());
    let loader = Rc::new(Loader::new(Rc::new(Native), external.config_dir, external.cwd, entries));
    loader.reconcile(&host(tui), &tui.plugins);
    let watches: Rc<RefCell<Vec<Watched>>> = Rc::default();
    watch(tui, &loader, &watches);
    tui.app.on_message({
        let (loader, watches) = (loader.clone(), watches.clone());
        bind!(tui, |tui, _, _: &PluginsChanged| {
            loader.reconcile(&host(&tui), &tui.plugins);
            watch(&tui, &loader, &watches);
        })
    });
    // TS reconciles again when `config.data.plugins` changes: new entries, options and directives apply.
    let plugins = RefCell::new(tui.config().info.plugins.clone());
    tui.settings.on_change(bind!(tui, |tui, _| {
        let current = tui.config().info.plugins.clone();
        if *plugins.borrow() == current {
            return;
        }
        let host = host(&tui);
        let targets = tui.plugins.set_targets(&host, current.iter().flatten().map(target));
        plugins.replace(current);
        loader.set_configured(configured(&tui, targets));
        loader.reconcile(&host, &tui.plugins);
        watch(&tui, &loader, &watches);
    }));
}

/// The entries that name no plugin, with their `options` as JSON text.
fn configured(tui: &Tui, targets: Vec<String>) -> Vec<Configured> {
    let options = |target: &str| {
        tui.config().info.plugins.iter().flatten().find_map(|plugin| match plugin {
            opencode_local::cli_config::Plugin::Package { package, options: Some(options) } if package == target => {
                Some(serde_json::Value::Object(options.clone()).to_string())
            }
            _ => None,
        })
    };
    targets.into_iter().map(|target| Configured { options: options(&target), target }).collect()
}

/// A watched directory, the identity of the directory it watches, and the watch.
type Watched<W = opencode_local::watch::Watch> = (PathBuf, Option<u64>, W);

/// Watches the loader's directories: keeps the watches that still see them, and replaces one whose directory
/// went away or was made again, which the old watch no longer sees.
fn watch(tui: &Tui, loader: &Loader, watches: &RefCell<Vec<Watched>>) {
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

#[cfg(windows)]
fn identity(dir: &std::path::Path) -> Option<u64> {
    opencode_util::win::file_index(dir).ok()
}

/// Adds and activates one more plugin, then remounts the route so its claims show.
pub fn add(tui: &Rc<Tui>, plugin: Definition) {
    tui.plugins.add(plugin);
    tui.plugins.activate(&host(tui));
    tui.navigate(tui.route());
}

/// Mounts slot `path` with the host's `content` into `parent`. The view that owns the slot syncs the result.
pub fn slot(tui: &Tui, parent: &View, path: &str, input: &SlotInput, content: impl FnOnce(&View)) -> SlotMount {
    tui.plugins.mount(tui, parent, path, input, content)
}

/// The view of plugin route `id`/`name`, if a plugin registers it.
pub fn route(tui: &Tui, id: &str, name: &str) -> Option<RouteMount> {
    tui.plugins.route(tui, id, name)
}

/// The plugins' Markdown code-block renderers in the page theme.
pub fn code_blocks(tui: &Tui) -> CodeBlockRenderers {
    tui.plugins.code_blocks(&tui.page())
}

/// An empty [`abi::Node::Markdown`] widget: Markdown in the page theme with the plugins' fences, markers hidden unless
/// `session.markdown` is `source`.
pub fn markdown(tui: &Tui) -> opentui::widget::Markdown {
    let page = tui.page();
    let conceal = tui.config().info.session.as_ref().and_then(|session| session.markdown)
        != Some(opencode_local::cli_config::Markdown::Source);
    let syntax = opencode_ui::code::syntax_theme(&page);
    opencode_ui::markdown::view(&tui.app, &page, &syntax, &code_blocks(tui), conceal, false)
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
