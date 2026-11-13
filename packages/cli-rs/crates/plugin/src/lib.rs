//! The plugin host (P.1, P.4, O-67): the TUI's side of the one plugin API, `opencode-plugin-abi`. Built-ins and
//! external plugins reach the TUI only through that API, in process or over the C ABI. [`Registry`] starts them,
//! resolves their slot claims and mounts them; [`loader`] finds and loads external plugins; [`node`] turns what a
//! plugin draws into widgets. The TUI implements [`Host`] once, and that is the only code here that sees it.

mod activation;
pub mod loader;
pub mod node;
mod route;
pub mod slot;

use std::any::Any;
use std::cell::{Cell, RefCell};
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::rc::{Rc, Weak};
use std::sync::Arc;

use activation::{Activation, Drawn};
pub use opencode_plugin_abi as abi;
use opencode_ui::dialog::DialogKeymap;
use opencode_ui::keymap::{Bind, KeymapLayer, Slash, TuiCommand};
use opencode_ui::markdown::CodeBlockRenderers;
use opencode_ui::theme::Theme;
use opentui::keymap::Disposer;
use opentui::prelude::*;
use opentui::widget::CodeBlock;

pub use slot::{Kind, Placement, SlotInput};

/// What the plugins' reads and effects reach in the host: the TUI implements it, and the adapters of both paths call
/// it. It is not plugin API.
pub trait Host: 'static {
    fn app(&self) -> &App;
    /// The page theme.
    fn theme(&self) -> Theme;
    /// Whether the page theme resolved dark or light (TS `api.themeMode`). By default, from the page background's
    /// luminance.
    fn theme_mode(&self) -> ThemeMode {
        let color = self.theme().background.base;
        let luminance = 0.2126 * f64::from(color.r) + 0.7152 * f64::from(color.g) + 0.0722 * f64::from(color.b);
        if luminance > 127.5 { ThemeMode::Light } else { ThemeMode::Dark }
    }
    /// The keymap plugin layers register on.
    fn keymap(&self) -> &DialogKeymap;

    /// The JSON text of storage key `key` (already `plugin.<id>.<key>`), if stored.
    fn storage_read(&self, _key: &str) -> Option<String> {
        None
    }
    /// Stores JSON text (an object or an array) under storage key `key`. [`Host::storage_read`] shows it at once; a
    /// host that writes it to disk does that after the current plugin callback. The plugin queues
    /// [`Host::storage_changed`] after it.
    fn storage_write(&self, _key: &str, _json: &str) -> Result<(), String> {
        Err("no storage".to_owned())
    }
    /// Puts back what storage key `key` held before a plugin call that panicked wrote it: `json`, or nothing. By
    /// default it writes `json` back and cannot remove a key.
    fn storage_restore(&self, key: &str, json: Option<&str>) {
        if let Some(json) = json {
            let _ = self.storage_write(key, json);
        }
    }
    /// Tells the mounted claims that the plugins' storage changed ([`abi::Changed::local`]). Called from the effect
    /// queue, in order with the plugin's other effects.
    fn storage_changed(&self) {}
    /// Sets `fields` in the object stored under storage key `key` and keeps its other fields; a host with storage
    /// sets them in the latest stored object under the storage lock.
    fn storage_merge(&self, key: &str, fields: serde_json::Map<String, serde_json::Value>) -> Result<(), String> {
        let mut object = match self.storage_read(key).and_then(|json| serde_json::from_str(&json).ok()) {
            Some(serde_json::Value::Object(object)) => object,
            _ => serde_json::Map::new(),
        };
        object.extend(fields);
        self.storage_write(key, &serde_json::Value::Object(object).to_string())
    }
    /// Shows `toast`; with a session, it offers to open the session unless the session's family is on screen.
    fn toast(&self, _toast: &abi::Toast) {}
    /// Says that plugin `id` failed: an external plugin did not load or set up (`id` is its target when no build of it
    /// described an ID), or a plugin panicked while it ran, after its claims drew empty. Called outside every plugin
    /// callback.
    fn failed(&self, id: &str) {
        self.toast(
            &abi::Toast::new(abi::Variant::Error, "Run /plugins to view details.")
                .title(format!("Plugin failed: {id}")),
        );
    }
    /// Ends what the host shows for an activation of plugin `id` that ended (it was disabled, replaced, unloaded, or
    /// failed): the dialog it opened, if that activation is no longer [`Registry::live`], so nothing of an old build can
    /// run (4.14). Called outside every plugin callback.
    fn revoked(&self, _id: &str) {}
    /// Asks for the user's attention. Called outside every plugin callback.
    fn attention(&self, _attention: &abi::Attention) {}
    /// Calls `run` with each server event, after the host has applied it, until the disposer is dropped. `run` gets at
    /// least the events whose type is in `types`, and may get others.
    fn on_event(&self, _types: &[String], _run: Rc<dyn Fn(&abi::types::V2Event)>) -> Option<Disposer> {
        None
    }
    /// Mounts slot `path` with `input` into `parent`, for a claim's [`abi::Node::Slot`].
    fn slot(&self, _parent: &View, _path: &str, _input: &SlotInput) -> Option<SlotMount> {
        None
    }
    /// Opens the route plugin `id` registered as `name`.
    fn open_route(&self, _id: &str, _name: &str) {}
    /// Mounts the current route again, so changed slot claims and code-block renderers show.
    fn remount(&self) {}
    /// Runs the registered command `name` with `input` (a plugin's [`abi::Host::dispatch`], a click's
    /// [`abi::Action::Command`]). Called outside every plugin callback.
    fn dispatch(&self, _name: &str, _input: Option<&str>) {}
    /// Shows `route` for plugin `id` ([`abi::Host::navigate`]). Called outside every plugin callback.
    fn navigate(&self, _id: &str, _route: &abi::Route) {}
    /// Sends `fetch` with the host's own client and current transport, and calls `reply` on the UI thread with the
    /// JSON body or the error. Called outside every plugin callback.
    fn fetch(&self, _fetch: abi::Fetch, reply: Box<dyn FnOnce(Result<serde_json::Value, String>)>) {
        reply(Err("this host has no server".to_owned()));
    }
    /// Shows `dialog` of activation `generation` of plugin `id` ([`abi::Host::dialog`]). The dialog belongs to that
    /// activation: a host shows it only while [`Registry::live`] says so, runs its action only then, and ends it in
    /// [`Host::revoked`]. Called outside every plugin callback.
    fn dialog(&self, _id: &str, _generation: u64, _dialog: abi::Dialog) {}
    /// Whether plugin `id`'s panel `key` is open ([`abi::Read::dialog_open`]).
    fn dialog_open(&self, _id: &str, _key: &str) -> bool {
        false
    }
    /// Copies `text` to the clipboard, and returns whether it did; a host tells the user when it did not. Called
    /// outside every plugin callback.
    fn copy(&self, text: &str) -> bool {
        self.app().copy_to_clipboard(text)
    }
    /// The widget of an [`abi::Node::Markdown`]. By default, Markdown in the page theme without plugin fences.
    fn markdown(&self, text: &str) -> AnyWidget {
        let theme = self.theme();
        let syntax = opencode_ui::code::syntax_theme(&theme);
        let renderers = CodeBlockRenderers::default();
        let markdown = opencode_ui::markdown::view(self.app(), &theme, &syntax, &renderers, true, false);
        markdown.set_markdown(text);
        markdown.as_any()
    }

    // What the renders of the one API (O-67) read, on both paths.

    /// Calls `f` with what renders read. A read only records a load it needs; the host starts the load once the
    /// plugin callback around the read has returned. By default the theme only.
    fn read(&self, f: &mut dyn FnMut(&dyn abi::Read)) {
        let theme = self.theme();
        f(&node::Reader::new(&theme, self.theme_mode()));
    }
    /// Calls `push` with what changes outside change batches, the host's own state (`local`) and the terminal size
    /// (`size`), until the disposer is dropped.
    fn watch(&self, _push: Rc<dyn Fn(&abi::Changed)>) -> Option<Disposer> {
        None
    }
}

/// A mounted slot claim or plugin route: its root view, and a sync with each change batch. A plain [`View`] never
/// changes.
pub(crate) trait Claimed {
    fn root(&self) -> View;
    fn sync(&self, _host: &dyn Host, _changed: &abi::Changed) {}
}

impl Claimed for View {
    fn root(&self) -> View {
        self.clone()
    }
}

type ClaimRender = Rc<dyn Fn(&dyn Host, &SlotInput) -> Box<dyn Claimed>>;
type Claim = Box<dyn Claimed>;
type RouteRender = Rc<dyn Fn(&dyn Host) -> Box<dyn Claimed>>;
type SetupFn = Rc<dyn Fn(&mut Setup<'_>) -> Result<(), String>>;
/// The current failure of an external plugin, if any.
pub type ErrorFn = Rc<dyn Fn() -> Option<String>>;
/// Renders a fenced code block in the theme, or returns `None` to keep the default code view.
type CodeBlockRender = Rc<dyn Fn(&CodeBlock<'_>, &Theme) -> Option<AnyWidget>>;

/// A built-in, in the order the registry activates it.
pub enum Builtin {
    /// A plugin of the one API, run in process.
    Plugin(abi::Plugin),
    /// A part of the host that the plugin manager lists and toggles like a plugin. It is not plugin API: `activate`
    /// and `dispose` reach the host on their own.
    Host { id: &'static str, activate: Rc<dyn Fn()>, dispose: Rc<dyn Fn()> },
}

impl From<abi::Plugin> for Builtin {
    fn from(plugin: abi::Plugin) -> Self {
        Builtin::Plugin(plugin)
    }
}

/// A plugin as the registry runs it: an ID and the setup that registers everything it contributes. Setup runs on each
/// activation; deactivation undoes every registration.
#[derive(Clone)]
pub struct Definition {
    pub id: String,
    setup: SetupFn,
    /// The `plugins` target or discovered path of an external plugin.
    target: Option<String>,
    /// The failure of a plugin of the one API while it is active: a call that panicked.
    error: Option<ErrorFn>,
}

impl Definition {
    pub(crate) fn new(id: impl Into<String>, setup: impl Fn(&mut Setup<'_>) + 'static) -> Self {
        Self::fallible(id, move |registering| {
            setup(registering);
            Ok(())
        })
    }

    /// A definition whose setup may fail: then what it registered is disposed, and the plugin is not active.
    pub(crate) fn fallible(
        id: impl Into<String>,
        setup: impl Fn(&mut Setup<'_>) -> Result<(), String> + 'static,
    ) -> Self {
        Self { id: id.into(), setup: Rc::new(setup), target: None, error: None }
    }

    /// Marks an external plugin loaded from `target`; `error` reports its failure while it is active.
    pub(crate) fn external(mut self, target: impl Into<String>, error: ErrorFn) -> Self {
        self.target = Some(target.into());
        self.error = Some(error);
        self
    }

    /// The target of an external plugin.
    fn target(&self) -> Option<&str> {
        self.target.as_deref()
    }

    /// Why the active plugin failed, if it did.
    fn failure(&self) -> Option<String> {
        self.error.as_ref().and_then(|error| error())
    }
}

impl From<Builtin> for Definition {
    fn from(builtin: Builtin) -> Self {
        match builtin {
            Builtin::Plugin(plugin) => in_process(plugin),
            Builtin::Host { id, activate, dispose } => Definition::new(id, move |setup: &mut Setup<'_>| {
                activate();
                let dispose = dispose.clone();
                setup.on_dispose(move || dispose());
            }),
        }
    }
}

impl From<abi::Plugin> for Definition {
    fn from(plugin: abi::Plugin) -> Self {
        in_process(plugin)
    }
}

/// A plugin of the one API, run in process: its closures get Rust values, with no JSON step.
fn in_process(plugin: abi::Plugin) -> Definition {
    // The failure of the running activation: a call that panicked.
    let failure: Rc<RefCell<Option<String>>> = Rc::default();
    let error: ErrorFn = {
        let failure = failure.clone();
        Rc::new(move || failure.borrow().clone())
    };
    let mut definition = Definition::fallible(plugin.id, move |setup: &mut Setup<'_>| {
        *failure.borrow_mut() = None;
        let failed = failure.clone();
        setup.failure(Rc::new(move || failed.borrow().clone()));
        let proxy = setup.host().app().proxy();
        let activation = Activation::new(setup.host(), Arc::new(activation::Wake::new(Some(proxy))));
        let scope = Rc::new(Scope {
            host: Rc::downgrade(setup.host()),
            id: setup.id().to_owned(),
            generation: setup.generation(),
            keys: RefCell::default(),
            activation: activation.clone(),
            replies: RefCell::default(),
            failure: failure.clone(),
            call: RefCell::default(),
            layer: RefCell::default(),
        });
        let mut api = abi::Registered::new(setup.id(), None);
        api.set_waker(activation.waker());
        // Setup reaches the host as a command does: its effects wait on the one queue. A setup that panics runs its
        // dispose callbacks within the same call, as the C ABI's `create` does, so nothing either asked for happens.
        let set_up = scope.attempt(&**setup.host(), |host| {
            match catch_unwind(AssertUnwindSafe(|| (plugin.setup)(&mut api.setup_with(host)))) {
                Ok(set_up) => set_up,
                Err(panic) => {
                    api.dispose(Some(host));
                    std::panic::resume_unwind(panic)
                }
            }
        });
        let set_up = match set_up {
            Some(Ok(set_up)) => set_up,
            Some(Err(panic)) => Err(format!("setup panicked: {panic}")),
            None => Err("the host is gone".to_owned()),
        };
        if let Err(error) = set_up {
            scope.dispose(&mut api);
            return Err(error);
        }
        let manifest = api.manifest();
        if manifest.routes.len() != manifest.render_routes.len() || !manifest.slots.iter().all(|claim| claim.render) {
            log::error!("plugin {}: 1.3 routes and slot claims do not run in process", setup.id());
        }
        *scope.replies.borrow_mut() = api.replies().to_vec();
        if !api.wakes().is_empty() {
            let (wakes, scope) = (api.wakes().to_vec(), scope.clone());
            activation.on_wake(Rc::new(move || scope.run("on-wake", |host| wakes.iter().for_each(|run| run(host)))));
        }
        // A fence key that goes reaches the plugin's handlers once the event that freed its block is done.
        let gone = (!api.fence_gone().is_empty()).then(|| {
            let (runs, scope) = (api.fence_gone().to_vec(), scope.clone());
            Rc::new(move |key| {
                let (runs, scope) = (runs.clone(), scope.clone());
                defer(&scope.host.clone(), move |host| {
                    if !scope.activation.disposed() {
                        scope.call("fence-gone", host, |_| runs.iter().for_each(|run| run(key)));
                    }
                });
            }) as node::Gone
        });
        for (language, render) in api.fences() {
            let (render, scope, fences) = (render.clone(), scope.clone(), node::Fences::new(gone.clone()));
            let render: CodeBlockRender = Rc::new(move |block, theme| {
                let host = scope.host.upgrade()?;
                fences.render(block, theme, |fence| {
                    scope.call("render-fence", &*host, |read| render(read, &fence)).unwrap_or(abi::Fenced::Code)
                })
            });
            setup.registration.code_blocks.push((language.clone(), render));
        }
        for (index, claim, render) in api.renders() {
            let (render, scope) = (render.clone(), scope.clone());
            let mounts: Vec<abi::MountFn> =
                api.mounts().iter().filter(|(claim, _)| *claim == index).map(|(_, run)| run.clone()).collect();
            let mount = (!mounts.is_empty()).then(|| {
                let scope = scope.clone();
                Rc::new(move |_: &dyn Host, input: &abi::SlotInput, mounted: bool| {
                    scope.mounted("on-mount", |host| mounts.iter().for_each(|run| run(host, input, mounted)));
                }) as node::MountFn
            });
            let render: node::SlotRender = Rc::new(move |host: &dyn Host, input, changed| {
                scope.call("render-slot", host, |read| render(read, input, changed)).unwrap_or(abi::Render::Hide)
            });
            setup.claim(slot::placement(claim), render, mount, &activation);
        }
        for (types, run) in api.events() {
            let (kinds, run, scope) = (types.to_vec(), run.clone(), scope.clone());
            let subscription = setup.host().on_event(
                types,
                Rc::new(move |event| {
                    if kinds.iter().any(|kind| kind == event.tag()) {
                        scope.run("on-event", |host| run(host, event));
                    }
                }),
            );
            setup.registration.disposers.extend(subscription);
        }
        let commands: Vec<(abi::Scope, TuiCommand)> = api
            .commands()
            .map(|(command, run)| {
                let (run, scope) = (run.clone(), scope.clone());
                (
                    command.scope.clone(),
                    tui_command(command, move |input| scope.run("run-command", |host| run(host, input))),
                )
            })
            .collect();
        let (global, scoped) = route::split(commands);
        if !global.is_empty() {
            // Kept apart from the registration, so a panic can remove it.
            match setup.host().keymap().layer(KeymapLayer::global(global)) {
                Ok(disposer) => *scope.layer.borrow_mut() = Some(disposer),
                Err(error) => log::error!("plugin {} keymap layer: {error}", setup.id()),
            }
        }
        for (name, render) in api.routes() {
            let mounts: Vec<abi::RouteMountFn> =
                api.route_mounts().iter().filter(|(route, _)| route == name).map(|(_, run)| run.clone()).collect();
            let mount = (!mounts.is_empty()).then(|| {
                let scope = scope.clone();
                Rc::new(move |_: &dyn Host, _: &abi::SlotInput, mounted: bool| {
                    scope.mounted("on-route-mount", |host| mounts.iter().for_each(|run| run(host, mounted)));
                }) as node::MountFn
            });
            let (render, scope) = (render.clone(), scope.clone());
            let render: node::SlotRender = Rc::new(move |host: &dyn Host, _, changed| {
                scope.call("render-route", host, |read| render(read, changed)).unwrap_or(abi::Render::Hide)
            });
            setup.view_route(name, render, route::commands(&scoped, name), mount, &activation);
        }
        // Disposal removes the plugin's commands, runs its dispose callbacks, then drops its replies and wakes.
        setup.on_dispose(move || scope.dispose(&mut api));
        Ok(())
    });
    definition.error = Some(error);
    definition
}

/// The keymap command of a plugin's `command`, which calls `run` with its input.
pub(crate) fn tui_command(command: &abi::Command, run: impl Fn(Option<&str>) + 'static) -> TuiCommand {
    let mut entry = TuiCommand::new(command.name.clone(), move |input, _| run(input))
        .bind(command.keybind.clone().map_or(Bind::Default, Bind::Key));
    // The keymap refuses an empty title, which a hidden command may have.
    if !command.title.trim().is_empty() {
        entry = entry.title(command.title.clone());
    }
    if command.palette {
        entry = entry.palette();
    }
    if let Some(group) = &command.group {
        entry = entry.group(group.clone());
    }
    if let Some(description) = &command.description {
        entry = entry.description(description.clone());
    }
    if let Some(slash) = &command.slash {
        entry = entry.slash(Slash { name: slash.clone(), aliases: Vec::new(), arguments: command.arguments });
    }
    entry
}

/// What an in-process plugin's reads and effects are scoped to: its host, its ID and declared storage keys, its
/// activation, and the call that runs.
struct Scope {
    host: Weak<dyn Host>,
    id: String,
    /// The activation ([`Registry::live`]), which owns the dialogs it asks for.
    generation: u64,
    keys: RefCell<Vec<String>>,
    activation: Rc<Activation>,
    replies: RefCell<Vec<abi::ReplyFn>>,
    failure: Rc<RefCell<Option<String>>>,
    /// What the running call asked for, while one runs.
    call: RefCell<Option<Call>>,
    /// The commands' keymap layer, until deactivation or a panic removes it.
    layer: RefCell<Option<Disposer>>,
}

/// What one call of an in-process plugin asked for: the effects that wait for it to return, and the storage it wrote.
#[derive(Default)]
struct Call {
    effects: Vec<Effect>,
    undo: Undo,
}

type Effect = Box<dyn FnOnce(&dyn Host)>;

impl Scope {
    /// The host's storage key of `key`, when the plugin declared it.
    fn stored(&self, key: &str) -> Option<String> {
        if self.keys.borrow().iter().any(|known| known == key) {
            return Some(format!("plugin.{}.{key}", self.id));
        }
        log::warn!("plugin {}: storage key {key} was not declared", self.id);
        None
    }

    /// Calls `f` as one call of the plugin, `export`, unless it failed: a panic fails it.
    fn call<R>(self: &Rc<Self>, export: &str, host: &dyn Host, f: impl FnOnce(&Scoped<'_>) -> R) -> Option<R> {
        if self.failure.borrow().is_some() {
            return None;
        }
        match self.attempt(host, f)? {
            Ok(value) => Some(value),
            Err(panic) => {
                let (layer, error) = (self.layer.borrow_mut().take(), format!("{export} panicked: {panic}"));
                fail(&self.host, &self.id, &self.failure, layer, &self.activation, error);
                None
            }
        }
    }

    /// Calls `f` with the host as the plugin reads and calls it. What it asks for waits on the effect queue until it
    /// returns; when it panics, that is dropped, the storage it wrote is put back, and the panic's message returned.
    /// `None` when the host never read.
    fn attempt<R>(self: &Rc<Self>, host: &dyn Host, f: impl FnOnce(&Scoped<'_>) -> R) -> Option<Result<R, String>> {
        let outer = self.call.replace(Some(Call::default()));
        let (mut f, mut out) = (Some(f), None);
        host.read(&mut |read| {
            if let Some(f) = f.take() {
                out = Some(catch_unwind(AssertUnwindSafe(|| f(&Scoped { read, host, scope: self }))));
            }
        });
        let call = std::mem::replace(&mut *self.call.borrow_mut(), outer).unwrap_or_default();
        let out = out.map(|out| out.map_err(|panic| abi::panic_message(&*panic)));
        match (&out, &mut *self.call.borrow_mut()) {
            (Some(Err(_)), _) => call.undo.restore(host),
            // A call within a call is part of it.
            (_, Some(outer)) => {
                outer.effects.extend(call.effects);
                outer.undo.0.extend(call.undo.0);
            }
            (_, None) => call.effects.into_iter().for_each(|effect| defer(&self.host, effect)),
        }
        out
    }

    /// Runs a handler of the plugin with the host, then invalidates its claims, whose state it may have changed.
    fn run(self: &Rc<Self>, export: &str, handler: impl FnOnce(&Scoped<'_>)) {
        let Some(host) = self.host.upgrade() else { return };
        if self.call(export, &*host, handler).is_some() {
            self.activation.invalidate();
        }
    }

    /// Runs a mount handler: a claim or route may mount and unmount after its plugin was disposed, which hears of it
    /// no more.
    fn mounted(self: &Rc<Self>, export: &str, handler: impl FnOnce(&Scoped<'_>)) {
        if !self.activation.disposed() {
            self.run(export, handler);
        }
    }

    /// Disposes the plugin's registrations `api` with the host, or without it once it is gone, then the activation, so
    /// no reply or wake reaches the plugin after. A plugin that failed is called no more, so its dispose callbacks do
    /// not run (4.14; TS runs no plugin code after a failed setup either).
    fn dispose(self: &Rc<Self>, api: &mut abi::Registered) {
        if let Some(layer) = self.layer.take() {
            layer.dispose();
        }
        if self.failure.borrow().is_some() {
            api.abandon();
            self.activation.dispose();
            return;
        }
        let host = self.host.upgrade();
        if host.and_then(|host| self.attempt(&*host, |host| api.dispose(Some(host)))).is_none() {
            api.dispose(None);
        }
        self.activation.dispose();
    }
}

/// The host as an in-process plugin reads and calls it: the host's reads, its storage, and its effects, which wait
/// for the callback to return.
struct Scoped<'a> {
    read: &'a dyn abi::Read,
    host: &'a dyn Host,
    scope: &'a Rc<Scope>,
}

impl abi::Read for Scoped<'_> {
    fn theme_mode(&self) -> abi::ThemeMode {
        self.read.theme_mode()
    }

    fn color(&self, token: &str) -> Option<abi::Rgba> {
        self.read.color(token)
    }

    fn session(&self, id: &str) -> Option<abi::Session> {
        self.read.session(id)
    }

    fn family(&self, id: &str) -> abi::Family {
        self.read.family(id)
    }

    fn messages(&self, id: &str, visit: &mut dyn FnMut(&[abi::types::SessionMessageInfo])) {
        self.read.messages(id, visit)
    }

    fn models(&self, location: Option<&abi::LocationRef>) -> Option<Vec<abi::types::ModelInfo>> {
        self.read.models(location)
    }

    fn model(&self) -> Option<abi::types::ModelRef> {
        self.read.model()
    }

    fn limits(&self) -> Option<abi::types::UsageLimitsInfo> {
        self.read.limits()
    }

    fn providers(&self) -> Option<Vec<abi::types::ProviderInfo>> {
        self.read.providers()
    }

    fn storage_get(&self, key: &str) -> Option<serde_json::Value> {
        let json = self.host.storage_read(&self.scope.stored(key)?)?;
        serde_json::from_str(&json).ok()
    }

    fn info(&self) -> abi::Info {
        self.read.info()
    }

    fn mcp_servers(&self, location: Option<&abi::LocationRef>) -> Option<Vec<abi::types::McpServer>> {
        self.read.mcp_servers(location)
    }

    fn integrations(&self, location: Option<&abi::LocationRef>) -> Option<Vec<abi::types::IntegrationInfo>> {
        self.read.integrations(location)
    }

    fn vcs(&self, location: Option<&abi::LocationRef>) -> Option<abi::types::VcsInfo> {
        self.read.vcs(location)
    }

    fn route(&self) -> abi::Route {
        self.read.route()
    }

    fn interactive(&self) -> bool {
        self.read.interactive()
    }

    fn shortcut(&self, name: &str) -> Option<String> {
        self.read.shortcut(name)
    }

    fn dialog_open(&self, key: &str) -> bool {
        self.host.dialog_open(&self.scope.id, key)
    }
}

impl abi::Host for Scoped<'_> {
    fn storage_set(&self, key: &str, value: serde_json::Value) {
        let Some(stored) = self.scope.stored(key) else { return };
        self.written(&stored);
        // The host shows it to reads at once; the claims hear of it in queue order.
        match self.host.storage_write(&stored, &value.to_string()) {
            Ok(()) => self.defer(|host| host.storage_changed()),
            Err(error) => log::warn!("storage {stored}: {error}"),
        }
    }

    fn storage_merge(&self, key: &str, fields: serde_json::Map<String, serde_json::Value>) {
        let Some(stored) = self.scope.stored(key) else { return };
        self.written(&stored);
        match self.host.storage_merge(&stored, fields) {
            Ok(()) => self.defer(|host| host.storage_changed()),
            Err(error) => log::warn!("storage {stored}: {error}"),
        }
    }

    fn dispatch(&self, name: &str, input: Option<&str>) {
        let (name, input) = (name.to_owned(), input.map(str::to_owned));
        self.defer(move |host| host.dispatch(&name, input.as_deref()));
    }

    fn toast(&self, toast: abi::Toast) {
        self.defer(move |host| host.toast(&toast));
    }

    fn attention(&self, attention: abi::Attention) {
        self.defer(move |host| host.attention(&attention));
    }

    fn open_route(&self, name: &str) {
        let (id, name) = (self.scope.id.clone(), name.to_owned());
        self.defer(move |host| host.open_route(&id, &name));
    }

    fn navigate(&self, route: abi::Route) {
        let id = self.scope.id.clone();
        self.defer(move |host| host.navigate(&id, &route));
    }

    fn fetch(&self, fetch: abi::Fetch) -> abi::RequestId {
        let id = next_request();
        let scope = Rc::downgrade(self.scope);
        self.defer(move |host| {
            if scope.upgrade().is_none_or(|scope| scope.activation.disposed()) {
                return;
            }
            host.fetch(
                fetch,
                Box::new(move |result| {
                    let Some(host) = scope.upgrade().map(|scope| scope.host.clone()) else { return };
                    // The reply runs on the effect queue, in order with the effects queued before it.
                    defer(&host, move |_| {
                        let Some(scope) = scope.upgrade().filter(|scope| !scope.activation.disposed()) else { return };
                        let replies = scope.replies.borrow().clone();
                        scope.run("on-reply", |host| replies.iter().for_each(|run| run(host, id, result.clone())));
                    });
                }),
            );
        });
        id
    }

    fn dialog(&self, dialog: abi::Dialog) {
        let (id, generation) = (self.scope.id.clone(), self.scope.generation);
        self.defer(move |host| host.dialog(&id, generation, dialog));
    }

    fn copy(&self, text: &str, then: Option<abi::Action>) {
        let text = text.to_owned();
        self.defer(move |host| copy(host, &text, then));
    }

    fn declare_storage_key(&self, key: &str) {
        let mut keys = self.scope.keys.borrow_mut();
        if !keys.iter().any(|known| known == key) {
            keys.push(key.to_owned());
        }
    }
}

/// Copies `text`, then runs `then` once it is copied.
pub(crate) fn copy(host: &dyn Host, text: &str, then: Option<abi::Action>) {
    if let (true, Some(abi::Action::Command { name, input })) = (host.copy(text), then) {
        host.dispatch(&name, input.as_deref());
    }
}

/// A fresh [`abi::RequestId`], unique in the process.
pub(crate) fn next_request() -> abi::RequestId {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    abi::RequestId(NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed))
}

impl Scoped<'_> {
    /// Holds `effect` until the call returns.
    fn defer(&self, effect: impl FnOnce(&dyn Host) + 'static) {
        match &mut *self.scope.call.borrow_mut() {
            Some(call) => call.effects.push(Box::new(effect)),
            None => defer(&self.scope.host, effect),
        }
    }

    /// Records what storage key `stored` holds before the call writes it.
    fn written(&self, stored: &str) {
        if let Some(call) = &mut *self.scope.call.borrow_mut() {
            call.undo.record(self.host, stored);
        }
    }
}

/// The storage writes of one plugin call, each with what its key held before, which a call that panics puts back.
#[derive(Default)]
pub(crate) struct Undo(Vec<(String, Option<String>)>);

impl Undo {
    /// Records `key`'s value before a write.
    pub(crate) fn record(&mut self, host: &dyn Host, key: &str) {
        self.0.push((key.to_owned(), host.storage_read(key)));
    }

    /// Puts back the last write first, so each key ends with what it held before the first.
    pub(crate) fn restore(self, host: &dyn Host) {
        self.0.into_iter().rev().for_each(|(key, json)| host.storage_restore(&key, json.as_deref()));
    }
}

/// Fails plugin `id` with `error` after a call of it panicked: it is not called again, its commands leave the keymap
/// once the key that may have run the call is handled, the host says so, and its claims draw empty.
pub(crate) fn fail(
    host: &Weak<dyn Host>,
    id: &str,
    failure: &RefCell<Option<String>>,
    layer: Option<Disposer>,
    activation: &Rc<Activation>,
    error: String,
) {
    log::error!("plugin {id} failed: {error}");
    *failure.borrow_mut() = Some(error);
    let id = id.to_owned();
    defer(host, move |host| {
        if let Some(layer) = layer {
            layer.dispose();
        }
        host.revoked(&id);
        host.failed(&id);
        // The fences it drew fall back to the code view, as the ones it draws from now on do.
        host.remount();
    });
    activation.invalidate();
}

/// Queues `effect` on the host's one effect queue, which both paths share: it runs in order with every other plugin
/// effect, once the outermost plugin callback has returned and every UI and store borrow has ended.
pub(crate) fn defer(host: &Weak<dyn Host>, effect: impl FnOnce(&dyn Host) + 'static) {
    let Some(strong) = host.upgrade() else { return };
    let host = host.clone();
    strong.app().defer(move |_| {
        if let Some(host) = host.upgrade() {
            effect(&*host);
        }
    });
}

/// What a plugin registers while it is active: the host's side of a setup, on either path.
pub(crate) struct Setup<'a> {
    host: &'a Rc<dyn Host>,
    id: &'a str,
    registration: Registration,
}

impl Setup<'_> {
    /// The host; closures keep a [`std::rc::Weak`] of it.
    pub(crate) fn host(&self) -> &Rc<dyn Host> {
        self.host
    }

    pub(crate) fn id(&self) -> &str {
        self.id
    }

    /// The activation this setup makes, unique in the registry: what it asks the host for belongs to it
    /// ([`Registry::live`]).
    pub(crate) fn generation(&self) -> u64 {
        self.registration.generation
    }

    /// Tells the registry how to learn that a call of this activation panicked: then it contributes nothing more.
    pub(crate) fn failure(&mut self, failure: ErrorFn) {
        self.registration.failure = Some(failure);
    }

    /// Claims a place in the slot tree (TS `ui.slot`).
    pub(crate) fn slot(
        &mut self,
        placement: Placement,
        render: impl Fn(&dyn Host, &SlotInput) -> Box<dyn Claimed> + 'static,
    ) {
        self.registration.claims.push((placement, Rc::new(render)));
    }

    /// Claims a place in the slot tree with a render of the one API, on either path; `activation` renders its mounts
    /// again, and `mount` hears of each mount and unmount.
    pub(crate) fn claim(
        &mut self,
        placement: Placement,
        render: node::SlotRender,
        mount: Option<node::MountFn>,
        activation: &Rc<Activation>,
    ) {
        let owner = Rc::downgrade(self.host);
        let path = placement.target.clone();
        let activation = activation.clone();
        self.slot(placement, move |host, input| {
            let mount = node::Mount::new(host, owner.clone(), &path, input, render.clone(), mount.clone());
            activation.track(Rc::downgrade(&mount) as Weak<dyn Drawn>);
            Box::new(mount)
        });
    }

    /// Registers route `name` of the one API, on either path: `render` draws in [`route::View`], and `commands` run
    /// while it shows.
    pub(crate) fn view_route(
        &mut self,
        name: &str,
        render: node::SlotRender,
        commands: Vec<TuiCommand>,
        mount: Option<node::MountFn>,
        activation: &Rc<Activation>,
    ) {
        let (owner, activation) = (Rc::downgrade(self.host), activation.clone());
        self.route(name, move |host| {
            let view = route::View::new(host, owner.clone(), render.clone(), commands.clone(), mount.clone());
            activation.track(Rc::downgrade(&view.mount) as Weak<dyn Drawn>);
            Box::new(view)
        });
    }

    /// Registers the route `Route::Plugin { id, name }` shows (TS `ui.router.register`).
    pub(crate) fn route(&mut self, name: impl Into<String>, render: impl Fn(&dyn Host) -> Box<dyn Claimed> + 'static) {
        self.registration.routes.push((name.into(), Rc::new(render)));
    }

    /// Renders Markdown fences of `language` (TS `markdown.registerCodeBlockRenderer`).
    pub(crate) fn code_block(
        &mut self,
        language: impl Into<String>,
        render: impl Fn(&CodeBlock<'_>, &Theme) -> Option<AnyWidget> + 'static,
    ) {
        self.registration.code_blocks.push((language.into(), Rc::new(render)));
    }

    /// Registers a keymap layer: commands, their palette and slash entries, and keybinds (TS `keymap.layer`).
    #[cfg(test)]
    pub(crate) fn layer(&mut self, layer: KeymapLayer<opencode_ui::dialog::FocusId>) {
        match self.host.keymap().layer(layer) {
            Ok(disposer) => self.registration.disposers.push(disposer),
            Err(error) => log::error!("plugin {} keymap layer: {error}", self.id),
        }
    }

    /// Runs `cleanup` when the plugin deactivates (the cleanup TS `setup` returns).
    pub(crate) fn on_dispose(&mut self, cleanup: impl FnOnce() + 'static) {
        self.registration.cleanups.push(Box::new(cleanup));
    }
}

#[derive(Default)]
struct Registration {
    /// The activation, unique in the registry.
    generation: u64,
    /// A call of the activation that panicked, if one did.
    failure: Option<ErrorFn>,
    claims: Vec<(Placement, ClaimRender)>,
    routes: Vec<(String, RouteRender)>,
    code_blocks: Vec<(String, CodeBlockRender)>,
    disposers: Vec<Disposer>,
    cleanups: Vec<Box<dyn FnOnce()>>,
}

impl Registration {
    /// Whether a call of this activation panicked: it contributes nothing, and is called no more (4.14).
    fn panicked(&self) -> bool {
        self.failure.as_ref().is_some_and(|failure| failure().is_some())
    }

    fn dispose(self) {
        self.disposers.into_iter().rev().for_each(Disposer::dispose);
        self.cleanups.into_iter().rev().for_each(|cleanup| cleanup());
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Source {
    Builtin,
    /// Added by the host after the built-ins, such as a test plugin.
    Added,
    /// A `plugins` entry of `cli.json`, or a directory found in a `plugins` directory, that is not loaded.
    Configured,
    /// Loaded from a native build (P.4).
    External,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Status {
    Active,
    Inactive,
    /// Configured but not loaded, with the reason.
    Skipped(String),
    /// An external plugin that failed to load or crashed, with the error.
    Failed(String),
}

/// One plugin as the plugin manager lists it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Entry {
    /// The plugin ID, or the configured target of a skipped entry.
    pub id: String,
    /// Where an external or skipped plugin comes from: its `plugins` target or path.
    pub target: Option<String>,
    pub source: Source,
    pub status: Status,
    /// Whether the plugin has an activation, failed or not (TS `registered().active`): the plugin manager offers
    /// to disable it.
    pub active: bool,
}

/// Why a configured TypeScript TUI plugin is listed but not loaded (deviation of F16 until P.4).
pub const SKIPPED: &str = "TypeScript TUI plugins do not run in opencode-native yet";

struct Plugin {
    definition: Definition,
    source: Source,
    enabled: bool,
    /// The activation order and registrations while active.
    active: Option<(u64, Registration)>,
    /// The built-in an external plugin of its ID replaced in place (TS `desired.set(id, ...)`), whether it was
    /// enabled, and its failure; it comes back when the external plugin is unloaded.
    shadowed: Option<(Definition, bool, Option<String>)>,
    /// The activation order it keeps once it was active, so its claims, or those of a replacement of a built-in, take
    /// the same place again.
    place: Option<u64>,
    /// Why it is not active although it was started: its setup failed, or its build did not load.
    failed: Option<String>,
}

impl Plugin {
    fn new(definition: Definition, source: Source, enabled: bool) -> Self {
        Self { definition, source, enabled, active: None, shadowed: None, place: None, failed: None }
    }

    /// Whether it is active and no call of the activation panicked. One that panicked stays active, so it is listed
    /// failed and its instance is kept, but it contributes nothing and a reload or an enable starts it again.
    fn running(&self) -> bool {
        self.active.as_ref().is_some_and(|(_, registration)| !registration.panicked())
    }
}

/// A setup that failed in [`Registry::load`].
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SetupFailed {
    pub error: String,
    /// It would have replaced an active plugin, which keeps running; else the plugin is listed as failed and is not
    /// active.
    pub kept: bool,
}

/// The host's plugins in enable order, and the configured entries it did not load.
pub struct Registry {
    plugins: RefCell<Vec<Plugin>>,
    /// Targets that are not loaded, with their status ([`Status::Skipped`] or [`Status::Failed`]).
    unloaded: RefCell<Vec<(String, Status)>>,
    /// The `plugins` targets, in order, which also enable and disable external plugins as they load.
    directives: RefCell<Vec<String>>,
    activations: Cell<u64>,
    /// The last activation's generation ([`Registry::live`]).
    generations: Cell<u64>,
    /// The slot paths mounted now, which claims resolve against.
    live: Rc<slot::Live>,
}

impl Registry {
    /// The built-ins, enabled unless a `cli.json` `plugins` entry disables them (`plugin/context.tsx:313-330`).
    /// Every entry that names no built-in is a TypeScript plugin; it is listed as skipped.
    pub fn new<'a>(builtins: Vec<Builtin>, targets: impl IntoIterator<Item = &'a str>) -> Self {
        Self::define(builtins.into_iter().map(Definition::from).collect(), targets)
    }

    /// [`Registry::new`] with built-ins as the registry runs them.
    pub(crate) fn define<'a>(builtins: Vec<Definition>, targets: impl IntoIterator<Item = &'a str>) -> Self {
        let mut plugins: Vec<Plugin> =
            builtins.into_iter().map(|definition| Plugin::new(definition, Source::Builtin, true)).collect();
        let directives: Vec<String> = targets.into_iter().map(str::to_owned).collect();
        for target in directives.iter().map(String::as_str) {
            if let Some(selector) = target.strip_prefix('-') {
                plugins
                    .iter_mut()
                    .filter(|plugin| matches(selector, &plugin.definition.id))
                    .for_each(|plugin| plugin.enabled = false);
                continue;
            }
            plugins
                .iter_mut()
                .filter(|plugin| matches(target, &plugin.definition.id))
                .for_each(|plugin| plugin.enabled = true);
        }
        let skipped =
            unnamed(&plugins, &directives).into_iter().map(|target| (target, Status::Skipped(SKIPPED.to_owned())));
        Self {
            plugins: RefCell::new(plugins),
            unloaded: RefCell::new(skipped.collect()),
            directives: RefCell::new(directives),
            activations: Cell::new(0),
            generations: Cell::new(0),
            live: Rc::default(),
        }
    }

    /// Applies the `plugins` entries of a changed `cli.json`, as TS reconciles on `config.data.plugins`: the
    /// directives enable and disable the plugins again, over the plugin manager's toggles as in TS. Returns the
    /// entries that name no plugin, for the loader; a new one is listed as skipped until the loader takes it.
    pub fn set_targets<'a>(&self, host: &Rc<dyn Host>, targets: impl IntoIterator<Item = &'a str>) -> Vec<String> {
        *self.directives.borrow_mut() = targets.into_iter().map(str::to_owned).collect();
        let configured = unnamed(&self.plugins.borrow(), &self.directives.borrow());
        for target in &configured {
            let listed = self.unloaded.borrow().iter().any(|(known, _)| known == target);
            if !listed && !self.loaded(target) {
                self.set_unloaded(target, Some(Status::Skipped(SKIPPED.to_owned())));
            }
        }
        let toggles: Vec<(String, bool)> = self
            .plugins
            .borrow()
            .iter()
            .filter(|plugin| plugin.source != Source::Added)
            .filter_map(|plugin| {
                let id = &plugin.definition.id;
                let enabled = self.enabled(plugin.definition.target().unwrap_or_default(), id);
                (plugin.enabled != enabled).then(|| (id.clone(), enabled))
            })
            .collect();
        if !toggles.is_empty() {
            for (id, enabled) in toggles {
                self.set_active(host, &id, enabled);
            }
            host.remount();
        }
        configured
    }

    /// Adds an enabled plugin after the others; [`Registry::activate`] starts it.
    pub fn add(&self, definition: impl Into<Definition>) {
        let definition = definition.into();
        self.plugins.borrow_mut().push(Plugin::new(definition, Source::Added, true));
    }

    /// The entries that were skipped.
    pub fn skipped(&self) -> Vec<String> {
        self.unloaded
            .borrow()
            .iter()
            .filter(|(_, status)| matches!(status, Status::Skipped(_)))
            .map(|(target, _)| target.clone())
            .collect()
    }

    /// Lists `target` as not loaded with `status`, or clears it with `None`.
    pub fn set_unloaded(&self, target: &str, status: Option<Status>) {
        let mut unloaded = self.unloaded.borrow_mut();
        let index = unloaded.iter().position(|(known, _)| known == target);
        match (index, status) {
            (Some(index), Some(status)) => unloaded[index].1 = status,
            (None, Some(status)) => unloaded.push((target.to_owned(), status)),
            (Some(index), None) => {
                unloaded.remove(index);
            }
            (None, None) => {}
        }
    }

    /// Adds external plugin `definition`, or replaces the one loaded from the same target, and activates it
    /// unless a `plugins` entry or the plugin manager disabled it. A replacement keeps its place, so slot
    /// order holds across a reload. A replacement of a running plugin starts before the running one stops: when its
    /// setup fails, it is disposed and the running one keeps running (TS `context.tsx`); one that panicked is replaced
    /// as an inactive one is, since nothing of it runs to keep; for an active built-in of its ID
    /// the target is listed as failed. Any other setup that fails leaves the plugin listed as failed and not active.
    pub fn load(&self, host: &Rc<dyn Host>, definition: Definition) -> Option<SetupFailed> {
        let target = definition.target()?.to_owned();
        self.set_unloaded(&target, None);
        // A `plugins` entry that names the plugin enables it; it is not a plugin of its own.
        self.unloaded
            .borrow_mut()
            .retain(|(known, status)| !(matches!(status, Status::Skipped(_)) && matches(known, &definition.id)));
        if let Some(Some(place)) = self.with_target(&target, |plugin| plugin.running().then_some(plugin.place)) {
            let (order, registration) = match self.setup(host, &definition, place) {
                Ok(active) => active,
                Err(error) => return Some(SetupFailed { error, kept: true }),
            };
            let previous = self.with_target(&target, |plugin| {
                plugin.definition = definition;
                plugin.active.replace((order, registration))
            });
            if let Some(Some((_, registration))) = previous {
                registration.dispose();
            }
            return None;
        }
        // Like TS (`context.tsx` restores the fallback), the replacement of an active built-in sets up before the
        // built-in stops, and a setup that fails leaves the built-in running.
        let builtin = self.with_target(&target, |_| ()).is_none().then(|| {
            let plugins = self.plugins.borrow();
            plugins
                .iter()
                .find(|plugin| plugin.source == Source::Builtin && plugin.definition.id == definition.id)
                .and_then(|builtin| builtin.active.as_ref().map(|(order, _)| *order))
        });
        let started = match builtin.flatten() {
            Some(order) if self.enabled(&target, &definition.id) => match self.setup(host, &definition, Some(order)) {
                Ok(started) => Some(started),
                Err(error) => {
                    let kept = format!("{error} (previous version still active)");
                    self.set_unloaded(&target, Some(Status::Failed(kept)));
                    return Some(SetupFailed { error, kept: false });
                }
            },
            _ => None,
        };
        let previous = {
            let mut plugins = self.plugins.borrow_mut();
            match plugins.iter_mut().find(|plugin| plugin.definition.target() == Some(target.as_str())) {
                Some(plugin) => {
                    (plugin.definition, plugin.failed) = (definition, None);
                    Some(plugin.active.take())
                }
                None => {
                    let enabled = self.enabled(&target, &definition.id);
                    // Like TS, an external plugin with a built-in's ID replaces it, in its place.
                    match plugins
                        .iter_mut()
                        .find(|plugin| plugin.source == Source::Builtin && plugin.definition.id == definition.id)
                    {
                        Some(builtin) => {
                            builtin.place = builtin.active.as_ref().map(|(order, _)| *order).or(builtin.place);
                            let original = std::mem::replace(&mut builtin.definition, definition);
                            builtin.shadowed = Some((original, builtin.enabled, builtin.failed.take()));
                            (builtin.source, builtin.enabled) = (Source::External, enabled);
                            Some(match started {
                                Some(started) => builtin.active.replace(started),
                                None => builtin.active.take(),
                            })
                        }
                        None => {
                            plugins.push(Plugin::new(definition, Source::External, enabled));
                            None
                        }
                    }
                }
            }
        };
        if let Some((_, registration)) = previous.flatten() {
            registration.dispose();
        }
        let started = self.with_target(&target, |plugin| plugin.enabled.then(|| plugin.definition.id.clone()));
        let error = self.start(host, &started.flatten()?)?;
        Some(SetupFailed { error, kept: false })
    }

    /// Whether plugin `id` from `target` is enabled: like TS, the directives after the plugin's own entry (all of
    /// them, for a built-in or a discovered plugin) decide.
    fn enabled(&self, target: &str, id: &str) -> bool {
        let directives = self.directives.borrow();
        let after = directives.iter().position(|directive| *directive == target).map_or(0, |index| index + 1);
        directives[after..].iter().fold(true, |enabled, directive| match directive.strip_prefix('-') {
            Some(selector) if matches(selector, id) => false,
            None if matches(directive, id) => true,
            _ => enabled,
        })
    }

    /// Records that the build of `target` did not load, and returns whether an active plugin of it keeps running. An
    /// inactive one, or one that panicked, is listed as failed with `error`, and enabling it fails the same rather
    /// than start the build it had; without a plugin, the target is listed as failed.
    pub fn failed_load(&self, target: &str, error: &str) -> bool {
        // Whether it keeps running, and the registration of a plugin that panicked, which goes.
        let outcome = self.with_target(target, |plugin| {
            if plugin.running() {
                return (true, None);
            }
            let broken = error.to_owned();
            plugin.failed = Some(broken.clone());
            plugin.definition.setup = Rc::new(move |_| Err(broken.clone()));
            (false, plugin.active.take())
        });
        let Some((kept, dead)) = outcome else {
            self.set_unloaded(target, Some(Status::Failed(error.to_owned())));
            return false;
        };
        if let Some((_, registration)) = dead {
            registration.dispose();
        }
        kept
    }

    /// Deactivates every active plugin, the last activated first, while the host is still alive: the host exits (TS
    /// `context.tsx` dispose).
    pub fn deactivate_all(&self) {
        let mut active: Vec<(u64, Registration)> =
            self.plugins.borrow_mut().iter_mut().filter_map(|plugin| plugin.active.take()).collect();
        active.sort_by_key(|(order, _)| std::cmp::Reverse(*order));
        active.into_iter().for_each(|(_, registration)| registration.dispose());
    }

    /// Whether a plugin was loaded from `target`.
    pub fn loaded(&self, target: &str) -> bool {
        self.with_target(target, |_| ()).is_some()
    }

    /// Whether `target` is a selector of a plugin, rather than a plugin to load.
    pub fn selects(&self, target: &str) -> bool {
        self.plugins.borrow().iter().any(|plugin| matches(target, &plugin.definition.id))
    }

    /// Whether a plugin other than the one loaded from `target` has ID `id`. A built-in's ID is free: the plugin
    /// replaces the built-in.
    pub fn id_taken(&self, id: &str, target: &str) -> bool {
        self.plugins.borrow().iter().any(|plugin| {
            plugin.definition.id == id && plugin.definition.target() != Some(target) && plugin.source != Source::Builtin
        })
    }

    /// Deactivates and removes the external plugin loaded from `target`; the built-in it replaced comes back in its
    /// place.
    pub fn unload(&self, host: &Rc<dyn Host>, target: &str) {
        let (removed, restored) = {
            let mut plugins = self.plugins.borrow_mut();
            let Some(index) = plugins.iter().position(|plugin| plugin.definition.target() == Some(target)) else {
                return;
            };
            match plugins[index].shadowed.take() {
                Some((definition, enabled, failed)) => {
                    let plugin = &mut plugins[index];
                    (plugin.definition, plugin.source, plugin.enabled) = (definition, Source::Builtin, enabled);
                    plugin.failed = failed;
                    (plugin.active.take(), enabled.then(|| plugin.definition.id.clone()))
                }
                None => (plugins.remove(index).active, None),
            }
        };
        if let Some((_, registration)) = removed {
            registration.dispose();
        }
        if let Some(id) = restored {
            self.start(host, &id);
        }
    }

    /// Activates every enabled plugin that is not active, in enable order.
    pub fn activate(&self, host: &Rc<dyn Host>) {
        let ids: Vec<String> = self
            .plugins
            .borrow()
            .iter()
            .filter(|plugin| plugin.enabled && plugin.active.is_none())
            .map(|plugin| plugin.definition.id.clone())
            .collect();
        for id in ids {
            self.start(host, &id);
        }
    }

    /// Activates or deactivates plugin `id` as a `cli.json` directive does; returns whether it exists. A setup that
    /// fails lists the plugin failed and says so, as a load does (TS reconciles).
    pub fn set_active(&self, host: &Rc<dyn Host>, id: &str, active: bool) -> bool {
        let Some(error) = self.switch(host, id, active) else { return false };
        if error.is_some() {
            host.failed(id);
        }
        true
    }

    /// The plugin manager's toggle of plugin `id` (TS `plugins.tsx`), `None` when it does not exist. A setup that fails
    /// as it enables the plugin returns its error for the manager to show, and leaves the plugin as it was: enabled or
    /// not, and listed as the last load left it, so a later reload of a disabled plugin starts nothing.
    pub fn toggle(&self, host: &Rc<dyn Host>, id: &str, active: bool) -> Option<Result<(), String>> {
        let before = self.with_plugin(id, |plugin| (plugin.enabled, plugin.failed.clone()))?;
        let error = self.switch(host, id, active)?;
        Some(match error {
            None => Ok(()),
            Some(error) => {
                self.with_plugin(id, |plugin| (plugin.enabled, plugin.failed) = before);
                Err(error)
            }
        })
    }

    /// Activates or deactivates plugin `id`: `None` when it does not exist, else the error of a setup that failed.
    fn switch(&self, host: &Rc<dyn Host>, id: &str, active: bool) -> Option<Option<String>> {
        self.with_plugin(id, |_| ())?;
        if !active {
            let registration = self.with_plugin(id, |plugin| {
                plugin.enabled = false;
                plugin.active.take()
            });
            if let Some((_, registration)) = registration.flatten() {
                registration.dispose();
            }
            return Some(None);
        }
        // Enabling a failed plugin restarts it with a fresh setup.
        let failed = self.with_plugin(id, |plugin| {
            plugin.enabled = true;
            (!plugin.running()).then(|| plugin.active.take()).flatten()
        });
        if let Some((_, registration)) = failed.flatten() {
            registration.dispose();
        }
        Some(self.start(host, id))
    }

    /// Every plugin and skipped entry, for the plugin manager.
    pub fn entries(&self) -> Vec<Entry> {
        let plugins = self.plugins.borrow();
        let active = plugins.iter().map(|plugin| Entry {
            id: plugin.definition.id.clone(),
            target: plugin.definition.target().map(str::to_owned),
            source: plugin.source,
            status: match &plugin.active {
                Some(_) => plugin.definition.failure().map_or(Status::Active, Status::Failed),
                None => plugin.failed.clone().map_or(Status::Inactive, Status::Failed),
            },
            active: plugin.active.is_some(),
        });
        let unloaded = self.unloaded.borrow();
        let unloaded = unloaded.iter().map(|(target, status)| Entry {
            id: target.clone(),
            target: Some(target.clone()),
            source: Source::Configured,
            status: status.clone(),
            active: false,
        });
        active.chain(unloaded).collect()
    }

    /// Mounts slot `path` into `parent`: the claims before it, prepended to it, `content` (the host's own,
    /// unless a claim replaces it), the claims appended to it, and after it. TS's `<Slot>` is a fragment, so
    /// every part goes straight into `parent`. Claims resolve against the slots mounted now: a claim on a slot inside
    /// this one that is not mounted is appended here until that slot mounts, and moves as soon as it does.
    pub fn mount(
        &self,
        host: &dyn Host,
        parent: &View,
        path: &str,
        input: &SlotInput,
        content: impl FnOnce(&View),
    ) -> SlotMount {
        let mounted = self.live.mount(path);
        // The claims that degraded onto an ancestor while this slot was missing leave it before they show here.
        settle(host, &self.live);
        let mut slot = SlotMount { claims: Vec::new(), mounted: Some(mounted), nested: None };
        let snapshot = Rc::new(self.claims());
        let (claims, renders) = &*snapshot;
        let placed = resolve(&self.live, claims).placed.remove(path).unwrap_or_default();
        let mut render = |indices: &[usize]| {
            for &index in indices {
                let claim = renders[index](host, input);
                parent.add(&claim.root());
                slot.claims.push(claim);
            }
        };
        render(&placed.before);
        if let Some(index) = placed.replace {
            render(&[index]);
            render(&placed.after);
            return slot;
        }
        render(&placed.prepend);
        content(parent);
        // The claims appended here change only when a claim targets a slot inside this one.
        if !claims.iter().any(|claim| claim.kind != Kind::Replace && slot::contains(path, &claim.target)) {
            render(&placed.append);
            render(&placed.after);
            return slot;
        }
        let marker = View::new(host.app()).visible(false);
        parent.add(&marker);
        let after = placed.after.clone();
        let nested = Rc::new(Nested {
            parent: parent.clone(),
            marker,
            path: path.to_owned(),
            live: self.live.clone(),
            input: input.clone(),
            claims: snapshot.clone(),
            appended: RefCell::default(),
            seen: Cell::new(0),
            busy: Cell::new(false),
        });
        self.live.follow(Rc::downgrade(&nested) as Weak<dyn Any>);
        settle(host, &self.live);
        render(&after);
        slot.nested = Some(nested);
        slot
    }

    /// Whether activation `generation` of plugin `id` is the one that runs, and has not failed: what it asked the host
    /// for may show and act. An activation that ended, a candidate that was not adopted, and one that panicked are not
    /// live.
    pub fn live(&self, id: &str, generation: u64) -> bool {
        self.with_plugin(id, |plugin| {
            plugin
                .active
                .as_ref()
                .is_some_and(|(_, registration)| registration.generation == generation && !registration.panicked())
        })
        .unwrap_or(false)
    }

    /// The route plugin `id` registers as `name`, rendered.
    pub fn route(&self, host: &dyn Host, id: &str, name: &str) -> Option<RouteMount> {
        let render = self.with_plugin(id, |plugin| {
            let (_, registration) = plugin.active.as_ref().filter(|_| plugin.running())?;
            registration.routes.iter().find(|(route, _)| route == name).map(|(_, render)| render.clone())
        })??;
        Some(RouteMount(render(host)))
    }

    /// The code-block renderers of the active plugins, drawing in the theme `theme` returns when they render, so a
    /// Markdown restyled for a new theme draws its fences in it. At one language the plugin last in activation order
    /// wins; a plugin keeps its place.
    pub fn code_blocks(&self, theme: Rc<dyn Fn() -> Theme>) -> CodeBlockRenderers {
        let mut renderers = CodeBlockRenderers::default();
        for (language, render) in self.by_activation(|registration| &registration.code_blocks) {
            let theme = theme.clone();
            renderers.register(language, Rc::new(move |block| render(block, &theme())));
        }
        renderers
    }

    /// Runs `setup` for plugin `id` unless it is active; returns why it failed.
    fn start(&self, host: &Rc<dyn Host>, id: &str) -> Option<String> {
        let Some(Some(definition)) =
            self.with_plugin(id, |plugin| plugin.active.is_none().then(|| plugin.definition.clone()))
        else {
            return None;
        };
        let place = self.with_plugin(id, |plugin| plugin.place).flatten();
        let started = self.setup(host, &definition, place);
        let error = started.as_ref().err().cloned();
        if let Some(error) = &error {
            log::error!("plugin {id} failed: {error}");
        }
        self.with_plugin(id, move |plugin| match started {
            // The plugin keeps this place among the claims when it is enabled again or rebuilt.
            Ok(active) => (plugin.place, plugin.active, plugin.failed) = (Some(active.0), Some(active), None),
            Err(error) => plugin.failed = Some(error),
        });
        error
    }

    /// Runs the setup of `definition` and numbers the activation, unless it keeps the order `place`. Setup runs without
    /// the registry borrowed, so it may read the registry through the host. A setup that fails leaves nothing
    /// registered.
    fn setup(
        &self,
        host: &Rc<dyn Host>,
        definition: &Definition,
        place: Option<u64>,
    ) -> Result<(u64, Registration), String> {
        let generation = self.generations.get() + 1;
        self.generations.set(generation);
        let registration = Registration { generation, ..Registration::default() };
        let mut setup = Setup { host, id: &definition.id, registration };
        if let Err(error) = (definition.setup)(&mut setup) {
            setup.registration.dispose();
            return Err(error);
        }
        // However the activation ends, what the host shows for it goes; it is not live by then. A candidate that failed
        // was never live, so what it asked for never showed.
        let (owner, id) = (Rc::downgrade(host), definition.id.clone());
        setup.on_dispose(move || {
            if let Some(host) = owner.upgrade() {
                host.revoked(&id);
            }
        });
        let order = place.unwrap_or_else(|| {
            let order = self.activations.get();
            self.activations.set(order + 1);
            order
        });
        Ok((order, setup.registration))
    }

    fn with_target<T>(&self, target: &str, f: impl FnOnce(&mut Plugin) -> T) -> Option<T> {
        let mut plugins = self.plugins.borrow_mut();
        plugins.iter_mut().find(|plugin| plugin.definition.target() == Some(target)).map(f)
    }

    fn with_plugin<T>(&self, id: &str, f: impl FnOnce(&mut Plugin) -> T) -> Option<T> {
        let mut plugins = self.plugins.borrow_mut();
        plugins.iter_mut().find(|plugin| plugin.definition.id == id).map(f)
    }

    /// Every active claim in activation order, and its renders.
    fn claims(&self) -> (Vec<Placement>, Vec<ClaimRender>) {
        self.by_activation(|registration| &registration.claims).into_iter().unzip()
    }

    /// The `part` of every active registration in activation order, cloned so no borrow outlives the call.
    fn by_activation<T: Clone>(&self, part: impl Fn(&Registration) -> &Vec<T>) -> Vec<T> {
        let plugins = self.plugins.borrow();
        // A plugin that panicked contributes nothing (4.14): its claims give their slots back.
        let mut active: Vec<_> =
            plugins.iter().filter(|plugin| plugin.running()).filter_map(|plugin| plugin.active.as_ref()).collect();
        active.sort_by_key(|(order, _)| *order);
        active.into_iter().flat_map(|(_, registration)| part(registration).clone()).collect()
    }
}

/// A mounted plugin route. The route that shows it syncs it with each change batch.
pub struct RouteMount(Box<dyn Claimed>);

impl RouteMount {
    pub fn root(&self) -> View {
        self.0.root()
    }

    /// Draws what `changed` changed; `None` when a change batch changed nothing.
    pub fn sync(&self, host: &dyn Host, changed: Option<&abi::Changed>) {
        if let Some(changed) = changed {
            self.0.sync(host, changed);
        }
    }
}

/// A mounted slot's claims. The owner of the slot syncs it with each change batch.
#[derive(Default)]
pub struct SlotMount {
    claims: Vec<Box<dyn Claimed>>,
    mounted: Option<slot::Mounted>,
    /// The claims appended to a slot that others may degrade onto, kept in step with the mounted slots.
    nested: Option<Rc<Nested>>,
}

impl SlotMount {
    /// Draws what `changed` changed, `None` when a change batch changed nothing, and settles the claims that moved.
    pub fn sync(&self, host: &dyn Host, changed: Option<&abi::Changed>) {
        if let Some(changed) = changed {
            self.claims.iter().for_each(|claim| claim.sync(host, changed));
            if let Some(nested) = &self.nested {
                let busy = nested.busy.replace(true);
                nested.appended.borrow().iter().for_each(|(_, claim)| claim.sync(host, changed));
                nested.busy.set(busy);
            }
        }
        if let Some(live) = self.live() {
            settle(host, live);
        }
    }

    /// The mounted slots this one counts in, if it is mounted.
    pub(crate) fn live(&self) -> Option<&Rc<slot::Live>> {
        self.mounted.as_ref().map(slot::Mounted::live)
    }

    pub fn is_empty(&self) -> bool {
        self.claims.is_empty() && self.nested.as_ref().is_none_or(|nested| nested.appended.borrow().is_empty())
    }
}

/// The claims appended to a mounted slot, in claim order after a hidden marker that follows its content. A claim on a
/// slot inside it shows here while that slot is not mounted (TS `survivingAncestor`).
struct Nested {
    parent: View,
    marker: View,
    path: String,
    live: Rc<slot::Live>,
    input: SlotInput,
    /// The claims and their renders as of the mount, which a change of plugins mounts again.
    claims: Rc<(Vec<Placement>, Vec<ClaimRender>)>,
    /// The mounted ones, by claim index.
    appended: RefCell<Vec<(usize, Claim)>>,
    /// The [`slot::Live::version`] the appended claims follow.
    seen: Cell<u64>,
    /// A refresh or a sync of the appended claims runs; it settles them once it is done.
    busy: Cell<bool>,
}

impl Nested {
    /// Mounts the claims appended here that are not, and drops the ones that are no longer, one at a time in claim
    /// order: a claim that mounts a slot inside this one takes the claims on that slot along before they show here.
    fn refresh(&self, host: &dyn Host) {
        if self.busy.get() || self.seen.get() == self.live.version() {
            return;
        }
        self.busy.set(true);
        // Each pass mounts one claim at most; the bound only guards against claims that keep mounting and dropping
        // each other's slots.
        for _ in 0..=self.claims.0.len() {
            let version = self.live.version();
            let wanted = resolve(&self.live, &self.claims.0).placed.remove(&self.path).unwrap_or_default().append;
            let dropped: Vec<_> =
                self.appended.borrow_mut().extract_if(.., |(index, _)| !wanted.contains(index)).collect();
            dropped.iter().for_each(|(_, claim)| claim.root().detach());
            // A dropped claim may take slots along.
            drop(dropped);
            if self.live.version() != version {
                continue;
            }
            let appended = self.appended.borrow();
            let Some(&index) = wanted.iter().find(|index| !appended.iter().any(|(known, _)| known == *index)) else {
                self.seen.set(version);
                break;
            };
            let at = appended.partition_point(|(known, _)| *known < index);
            drop(appended);
            let claim = self.claims.1[index](host, &self.input);
            let marker = self.parent.children().iter().position(|child| child.is(&self.marker)).unwrap_or(0);
            self.parent.insert(marker + 1 + at, &claim.root());
            self.appended.borrow_mut().insert(at, (index, claim));
        }
        self.busy.set(false);
    }
}

/// Moves the claims that degrade onto a mounted slot as the slots mounted now say, until they agree. A slot that
/// mounts or goes calls it, as does a claim that drew again and so may have mounted or dropped the slots it nests.
pub(crate) fn settle(host: &dyn Host, live: &slot::Live) {
    for _ in 0..=slot::PATHS.len() {
        let version = live.version();
        for follower in live.followers() {
            if let Ok(nested) = follower.downcast::<Nested>() {
                nested.refresh(host);
            }
        }
        if live.version() == version {
            return;
        }
    }
}

/// Resolves `claims` against the slots mounted now.
fn resolve(live: &slot::Live, claims: &[Placement]) -> slot::Resolution {
    let paths = live.paths();
    let paths: Vec<&str> = paths.iter().map(String::as_str).collect();
    slot::resolve(&paths, claims)
}

/// The `plugins` targets that name no plugin, in order: TypeScript plugins, or native builds for the loader.
fn unnamed(plugins: &[Plugin], directives: &[String]) -> Vec<String> {
    let mut unnamed: Vec<String> = Vec::new();
    for target in directives.iter().filter(|target| !target.starts_with('-')) {
        let named = plugins.iter().any(|plugin| matches(target, &plugin.definition.id));
        if named || target == "*" || target.ends_with(".*") || target.starts_with("opencode.") {
            continue;
        }
        if !unnamed.contains(target) {
            unnamed.push(target.clone());
        }
    }
    unnamed
}

/// Whether a `plugins` selector names plugin `id`: itself, `*`, or a `prefix.*` it starts with.
pub fn matches(selector: &str, id: &str) -> bool {
    selector == "*"
        || selector == id
        || selector.strip_suffix('*').is_some_and(|prefix| prefix.ends_with('.') && id.starts_with(prefix))
}

#[cfg(test)]
mod tests;
