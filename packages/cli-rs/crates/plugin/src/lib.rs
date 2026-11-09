//! The Rust plugin API (P.1, `docs/P.1.md`): the in-process form of `@opencode/plugin/tui`. Built-in
//! plugins and the LaTeX and Mermaid plugins register slots, keymap layers, routes, and code-block renderers
//! through [`Setup`]; the host mounts them through [`Registry`]. [`loader`] finds and loads external plugins
//! (P.4). A plugin of the one API (O-67, `opencode-plugin-abi`) becomes a [`Definition`] too, with [`From`].

mod activation;
pub mod loader;
pub mod node;
mod route;
pub mod slot;

use std::any::Any;
use std::cell::{Cell, RefCell};
use std::rc::{Rc, Weak};
use std::sync::Arc;

use activation::{Activation, Drawn};
pub use opencode_plugin_abi as abi;
use opencode_ui::dialog::{DialogKeymap, FocusId};
use opencode_ui::keymap::{Bind, KeymapLayer, Slash, TuiCommand};
use opencode_ui::markdown::CodeBlockRenderers;
use opencode_ui::theme::Theme;
use opentui::keymap::Disposer;
use opentui::prelude::*;
use opentui::widget::CodeBlock;

pub use slot::{Kind, Placement, SlotInput};

/// What a plugin is given besides its registrations (TS `Plugin.Context`). The TUI implements it for its
/// shared context, so a built-in also reaches the store, dialogs, and toasts through [`Setup::host`].
pub trait Host: 'static {
    /// What changed since the last sync.
    type Changes;
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
    /// Whether a change batch changed nothing, so external plugins' slot claims and routes need not draw again.
    fn unchanged(_changes: &Self::Changes) -> bool {
        false
    }

    // What external plugins reach across the component boundary (P.4). Built-ins use the host directly.

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
    /// Says that external plugin `id` failed: it did not load or set up (`id` is its target then), or it panicked
    /// while it ran, after its claims drew empty. Called outside every plugin callback.
    fn failed(&self, id: &str) {
        self.toast(
            &abi::Toast::new(abi::Variant::Error, "Run /plugins to view details.")
                .title(format!("Plugin failed: {id}")),
        );
    }
    /// Asks for the user's attention. Called outside every plugin callback.
    fn attention(&self, _attention: &abi::Attention) {}
    /// Calls `run` with each server event, after the host has applied it, until the disposer is dropped.
    fn on_event(&self, _run: Rc<dyn Fn(&abi::types::V2Event)>) -> Option<Disposer> {
        None
    }
    /// Mounts slot `path` with `input` into `parent`, for a claim's [`abi::Node::Slot`].
    fn slot(&self, _parent: &View, _path: &str, _input: &SlotInput) -> Option<SlotMount<Self>>
    where
        Self: Sized,
    {
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
    /// Shows plugin `id`'s `dialog` ([`abi::Host::dialog`]). Called outside every plugin callback.
    fn dialog(&self, _id: &str, _dialog: abi::Dialog) {}
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
    /// Sets `changed` to what `changes` changed. Reuse one `changed` across batches with [`node::refill`].
    fn changed(_changes: &Self::Changes, changed: &mut abi::Changed) {
        *changed = abi::Changed::everything();
    }
    /// Calls `push` with what changes outside change batches, the host's own state (`local`) and the terminal size
    /// (`size`), until the disposer is dropped.
    fn watch(&self, _push: Rc<dyn Fn(&abi::Changed)>) -> Option<Disposer> {
        None
    }
}

/// A mounted slot claim or plugin route: its root view, and a sync with each change batch. A plain
/// [`View`] never changes.
pub trait Slotted<H: Host> {
    fn root(&self) -> View;
    fn sync(&self, _host: &H, _changes: &H::Changes) {}
}

impl<H: Host> Slotted<H> for View {
    fn root(&self) -> View {
        self.clone()
    }
}

pub type SlotRender<H> = Rc<dyn Fn(&H, &SlotInput) -> Box<dyn Slotted<H>>>;
type Claim<H> = Box<dyn Slotted<H>>;
pub type RouteRender<H> = Rc<dyn Fn(&H) -> Box<dyn Slotted<H>>>;
type SetupFn<H> = Rc<dyn Fn(&mut Setup<'_, H>)>;
/// The current failure of an external plugin, if any.
pub type ErrorFn = Rc<dyn Fn() -> Option<String>>;
/// Renders a fenced code block in the theme, or returns `None` to keep the default code view.
pub type CodeBlockRender = Rc<dyn Fn(&CodeBlock<'_>, &Theme) -> Option<AnyWidget>>;

/// A plugin (TS `Plugin.define`): an ID and the setup that registers everything it contributes. Setup runs
/// on each activation; deactivation undoes every registration.
pub struct Definition<H: Host> {
    pub id: String,
    setup: SetupFn<H>,
    /// The `plugins` target or discovered path of an external plugin, and its failure.
    external: Option<(String, ErrorFn)>,
}

impl<H: Host> Clone for Definition<H> {
    fn clone(&self) -> Self {
        Self { id: self.id.clone(), setup: self.setup.clone(), external: self.external.clone() }
    }
}

impl<H: Host> Definition<H> {
    pub fn new(id: impl Into<String>, setup: impl Fn(&mut Setup<'_, H>) + 'static) -> Self {
        Self { id: id.into(), setup: Rc::new(setup), external: None }
    }

    /// Marks an external plugin loaded from `target`; `error` reports its failure while it is active.
    pub fn external(mut self, target: impl Into<String>, error: ErrorFn) -> Self {
        self.external = Some((target.into(), error));
        self
    }

    /// The target of an external plugin.
    pub fn target(&self) -> Option<&str> {
        self.external.as_ref().map(|(target, _)| target.as_str())
    }
}

/// A plugin of the one API, run in process: its closures get Rust values, with no JSON step. It may register code
/// fences, slot claims, commands, event handlers and dispose callbacks so far; the rest of its surface moves here with
/// the built-ins that need it.
impl<H: Host> From<abi::Plugin> for Definition<H> {
    fn from(plugin: abi::Plugin) -> Self {
        Definition::new(plugin.id, move |setup: &mut Setup<'_, H>| {
            let proxy = setup.host().app().proxy();
            let activation = Activation::new(setup.host(), Arc::new(activation::Wake::new(Some(proxy))));
            let mut api = abi::Setup::in_process(setup.id(), None);
            api.set_waker(activation.waker());
            if let Err(error) = (plugin.setup)(&mut api) {
                log::error!("plugin {} failed: {error}", setup.id());
                return;
            }
            let manifest = api.manifest();
            if manifest.routes.len() != manifest.render_routes.len() || !manifest.slots.iter().all(|claim| claim.render)
            {
                log::error!("plugin {}: 1.3 routes and slot claims do not run in process", setup.id());
            }
            let scope = Rc::new(Scope {
                host: Rc::downgrade(setup.host()),
                id: setup.id().to_owned(),
                keys: manifest.storage.clone(),
                activation: activation.clone(),
                replies: api.replies().to_vec(),
            });
            // Registered first, so it runs last: no reply reaches the plugin once it is disposed.
            let disposed = activation.clone();
            setup.on_dispose(move || disposed.dispose());
            for (language, render) in api.fences() {
                let (render, scope, fences) = (render.clone(), scope.clone(), node::Fences::default());
                let render: CodeBlockRender = Rc::new(move |block, theme| {
                    let host = scope.host.upgrade()?;
                    fences.render(block, theme, |fence| {
                        let mut out = abi::Fenced::Code;
                        host.read(&mut |read| out = render(&Scoped { read, host: &*host, scope: &scope }, &fence));
                        out
                    })
                });
                setup.registration.code_blocks.push((language.clone(), render));
            }
            for (claim, render) in api.renders() {
                let (render, scope) = (render.clone(), scope.clone());
                let render: node::SlotRender<H> = Rc::new(move |host: &H, input, changed| {
                    let mut out = abi::Render::Keep;
                    host.read(&mut |read| out = render(&Scoped { read, host, scope: &scope }, input, changed));
                    out
                });
                setup.claim(slot::placement(claim), render, &activation);
            }
            for (types, run) in api.events() {
                let (types, run, scope) = (types.to_vec(), run.clone(), scope.clone());
                let subscription = setup.host().on_event(Rc::new(move |event| {
                    if types.iter().any(|kind| kind == event.tag()) {
                        scope.run(|host| run(host, event));
                    }
                }));
                setup.registration.disposers.extend(subscription);
            }
            let commands: Vec<(abi::Scope, TuiCommand)> = api
                .commands()
                .map(|(command, run)| {
                    let (run, scope) = (run.clone(), scope.clone());
                    (command.scope.clone(), tui_command(command, move |input| scope.run(|host| run(host, input))))
                })
                .collect();
            let (global, scoped) = route::split(commands);
            if !global.is_empty() {
                setup.layer(KeymapLayer::global(global));
            }
            for (name, render) in api.routes() {
                let (render, scope) = (render.clone(), scope.clone());
                let render: node::SlotRender<H> = Rc::new(move |host: &H, _, changed| {
                    let mut out = abi::Render::Keep;
                    host.read(&mut |read| out = render(&Scoped { read, host, scope: &scope }, changed));
                    out
                });
                setup.view_route(name, render, route::commands(&scoped, name), &activation);
            }
            for run in api.take_disposers() {
                let (scope, mut run) = (scope.clone(), Some(run));
                setup.on_dispose(move || {
                    let Some(host) = scope.host.upgrade() else { return };
                    host.read(&mut |read| {
                        if let Some(run) = run.take() {
                            run(&Scoped { read, host: &*host, scope: &scope });
                        }
                    });
                });
            }
        })
    }
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

/// What an in-process plugin's reads and effects are scoped to: its host, its ID and declared storage keys, and its
/// activation.
struct Scope<H: Host> {
    host: Weak<H>,
    id: String,
    keys: Vec<String>,
    activation: Rc<Activation<H>>,
    replies: Vec<abi::ReplyFn>,
}

impl<H: Host> Scope<H> {
    /// The host's storage key of `key`, when the plugin declared it.
    fn stored(&self, key: &str) -> Option<String> {
        if self.keys.iter().any(|known| known == key) {
            return Some(format!("plugin.{}.{key}", self.id));
        }
        log::warn!("plugin {}: storage key {key} was not declared", self.id);
        None
    }

    /// Runs a handler of the plugin with the host, then invalidates its claims, whose state it may have changed.
    fn run(self: &Rc<Self>, handler: impl FnOnce(&dyn abi::Host)) {
        let Some(host) = self.host.upgrade() else { return };
        let mut handler = Some(handler);
        host.read(&mut |read| {
            if let Some(handler) = handler.take() {
                handler(&Scoped { read, host: &*host, scope: self });
            }
        });
        self.activation.invalidate();
    }
}

/// The host as an in-process plugin reads and calls it: the host's reads, its storage, and its effects, which wait
/// for the callback to return.
struct Scoped<'a, H: Host> {
    read: &'a dyn abi::Read,
    host: &'a H,
    scope: &'a Rc<Scope<H>>,
}

impl<H: Host> abi::Read for Scoped<'_, H> {
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
}

impl<H: Host> abi::Host for Scoped<'_, H> {
    fn storage_set(&self, key: &str, value: serde_json::Value) {
        let Some(stored) = self.scope.stored(key) else { return };
        // The host shows it to reads at once; the claims hear of it in queue order.
        match self.host.storage_write(&stored, &value.to_string()) {
            Ok(()) => self.defer(|host| host.storage_changed()),
            Err(error) => log::warn!("storage {stored}: {error}"),
        }
    }

    fn storage_merge(&self, key: &str, fields: serde_json::Map<String, serde_json::Value>) {
        let Some(stored) = self.scope.stored(key) else { return };
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
                        let Some(scope) = scope.upgrade().filter(|scope| !scope.activation.disposed()) else {
                            return;
                        };
                        let replies = scope.replies.clone();
                        scope.run(|host| replies.iter().for_each(|run| run(host, id, result.clone())));
                    });
                }),
            );
        });
        id
    }

    fn dialog(&self, dialog: abi::Dialog) {
        let id = self.scope.id.clone();
        self.defer(move |host| host.dialog(&id, dialog));
    }

    fn copy(&self, text: &str, then: Option<abi::Action>) {
        let text = text.to_owned();
        self.defer(move |host| copy(host, &text, then));
    }
}

/// Copies `text`, then runs `then` once it is copied.
pub(crate) fn copy<H: Host>(host: &H, text: &str, then: Option<abi::Action>) {
    if let (true, Some(abi::Action::Command { name, input })) = (host.copy(text), then) {
        host.dispatch(&name, input.as_deref());
    }
}

/// A fresh [`abi::RequestId`], unique in the process.
pub(crate) fn next_request() -> abi::RequestId {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    abi::RequestId(NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed))
}

impl<H: Host> Scoped<'_, H> {
    fn defer(&self, effect: impl FnOnce(&H) + 'static) {
        defer(&self.scope.host, effect);
    }
}

/// Queues `effect` on the host's one effect queue, which both paths share: it runs in order with every other plugin
/// effect, once the outermost plugin callback has returned and every UI and store borrow has ended.
pub(crate) fn defer<H: Host>(host: &Weak<H>, effect: impl FnOnce(&H) + 'static) {
    let Some(strong) = host.upgrade() else { return };
    let host = host.clone();
    strong.app().defer(move |_| {
        if let Some(host) = host.upgrade() {
            effect(&host);
        }
    });
}

/// What a plugin registers while it is active.
pub struct Setup<'a, H: Host> {
    host: &'a Rc<H>,
    id: &'a str,
    registration: Registration<H>,
}

impl<H: Host> Setup<'_, H> {
    /// The host; closures keep a [`std::rc::Weak`] of it.
    pub fn host(&self) -> &Rc<H> {
        self.host
    }

    pub fn id(&self) -> &str {
        self.id
    }

    /// The host storage key of this plugin's `key` (TS `storage.store(key)`).
    pub fn storage_key(&self, key: &str) -> String {
        format!("plugin.{}.{key}", self.id)
    }

    /// Claims a place in the slot tree (TS `ui.slot`).
    pub fn slot(&mut self, placement: Placement, render: impl Fn(&H, &SlotInput) -> Box<dyn Slotted<H>> + 'static) {
        self.registration.claims.push((placement, Rc::new(render)));
    }

    /// Claims a place in the slot tree with a render of the one API, on either path; `activation` renders its mounts
    /// again.
    pub(crate) fn claim(&mut self, placement: Placement, render: node::SlotRender<H>, activation: &Rc<Activation<H>>) {
        let owner = Rc::downgrade(self.host);
        let path = placement.target.clone();
        let activation = activation.clone();
        self.slot(placement, move |host, input| {
            let mount = node::Mount::new(host, owner.clone(), &path, input, render.clone());
            activation.track(Rc::downgrade(&mount) as Weak<dyn Drawn<H>>);
            Box::new(mount)
        });
    }

    /// Registers route `name` of the one API, on either path: `render` draws in [`route::View`], and `commands` run
    /// while it shows.
    pub(crate) fn view_route(
        &mut self,
        name: &str,
        render: node::SlotRender<H>,
        commands: Vec<TuiCommand>,
        activation: &Rc<Activation<H>>,
    ) {
        let (owner, activation) = (Rc::downgrade(self.host), activation.clone());
        self.route(name, move |host| {
            let view = route::View::new(host, owner.clone(), render.clone(), commands.clone());
            activation.track(Rc::downgrade(&view.mount) as Weak<dyn Drawn<H>>);
            Box::new(view)
        });
    }

    /// Registers a keymap layer: commands, their palette and slash entries, and keybinds (TS `keymap.layer`).
    pub fn layer(&mut self, layer: KeymapLayer<FocusId>) {
        match self.host.keymap().layer(layer) {
            Ok(disposer) => self.registration.disposers.push(disposer),
            Err(error) => log::error!("plugin {} keymap layer: {error}", self.id),
        }
    }

    /// Registers the route `Route::Plugin { id, name }` shows (TS `ui.router.register`).
    pub fn route(&mut self, name: impl Into<String>, render: impl Fn(&H) -> Box<dyn Slotted<H>> + 'static) {
        self.registration.routes.push((name.into(), Rc::new(render)));
    }

    /// Renders Markdown fences of `language` (TS `markdown.registerCodeBlockRenderer`).
    pub fn code_block(
        &mut self,
        language: impl Into<String>,
        render: impl Fn(&CodeBlock<'_>, &Theme) -> Option<AnyWidget> + 'static,
    ) {
        self.registration.code_blocks.push((language.into(), Rc::new(render)));
    }

    /// Runs `cleanup` when the plugin deactivates (the cleanup TS `setup` returns).
    pub fn on_dispose(&mut self, cleanup: impl FnOnce() + 'static) {
        self.registration.cleanups.push(Box::new(cleanup));
    }
}

struct Registration<H: Host> {
    claims: Vec<(Placement, SlotRender<H>)>,
    routes: Vec<(String, RouteRender<H>)>,
    code_blocks: Vec<(String, CodeBlockRender)>,
    disposers: Vec<Disposer>,
    cleanups: Vec<Box<dyn FnOnce()>>,
}

impl<H: Host> Default for Registration<H> {
    fn default() -> Self {
        Self {
            claims: Vec::new(),
            routes: Vec::new(),
            code_blocks: Vec::new(),
            disposers: Vec::new(),
            cleanups: Vec::new(),
        }
    }
}

impl<H: Host> Registration<H> {
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
pub const SKIPPED: &str = "TypeScript TUI plugins do not run in opencode-rs yet";

struct Plugin<H: Host> {
    definition: Definition<H>,
    source: Source,
    enabled: bool,
    /// The activation order and registrations while active.
    active: Option<(u64, Registration<H>)>,
}

/// The host's plugins in enable order, and the configured entries it did not load.
pub struct Registry<H: Host> {
    plugins: RefCell<Vec<Plugin<H>>>,
    /// Targets that are not loaded, with their status ([`Status::Skipped`] or [`Status::Failed`]).
    unloaded: RefCell<Vec<(String, Status)>>,
    /// The `plugins` targets, in order, which also enable and disable external plugins as they load.
    directives: Vec<String>,
    activations: Cell<u64>,
    /// The slot paths mounted now, which claims resolve against.
    live: Rc<slot::Live>,
}

impl<H: Host> Registry<H> {
    /// The built-ins, enabled unless a `cli.json` `plugins` entry disables them (`plugin/context.tsx:313-330`).
    /// Every entry that names no built-in is a TypeScript plugin; it is listed as skipped.
    pub fn new<'a>(builtins: Vec<Definition<H>>, targets: impl IntoIterator<Item = &'a str>) -> Self {
        let mut plugins: Vec<Plugin<H>> = builtins
            .into_iter()
            .map(|definition| Plugin { definition, source: Source::Builtin, enabled: true, active: None })
            .collect();
        let mut skipped = Vec::new();
        let directives: Vec<String> = targets.into_iter().map(str::to_owned).collect();
        for target in directives.iter().map(String::as_str) {
            if let Some(selector) = target.strip_prefix('-') {
                plugins
                    .iter_mut()
                    .filter(|plugin| matches(selector, &plugin.definition.id))
                    .for_each(|plugin| plugin.enabled = false);
                continue;
            }
            let mut selected = plugins.iter_mut().filter(|plugin| matches(target, &plugin.definition.id)).peekable();
            let named = selected.peek().is_some();
            selected.for_each(|plugin| plugin.enabled = true);
            if named || target == "*" || target.ends_with(".*") || target.starts_with("opencode.") {
                continue;
            }
            if !skipped.iter().any(|(known, _)| known == target) {
                skipped.push((target.to_owned(), Status::Skipped(SKIPPED.to_owned())));
            }
        }
        Self {
            plugins: RefCell::new(plugins),
            unloaded: RefCell::new(skipped),
            directives,
            activations: Cell::new(0),
            live: Rc::default(),
        }
    }

    /// Adds an enabled plugin after the others; [`Registry::activate`] starts it.
    pub fn add(&self, definition: Definition<H>) {
        self.plugins.borrow_mut().push(Plugin { definition, source: Source::Added, enabled: true, active: None });
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
    /// order holds across a reload. A replacement of an active plugin starts before the active one stops: when its
    /// setup fails, it is disposed, the active one keeps running, and the error is returned (TS `context.tsx`).
    pub fn load(&self, host: &Rc<H>, definition: Definition<H>) -> Option<String> {
        let target = definition.target()?.to_owned();
        self.set_unloaded(&target, None);
        // A `plugins` entry that names the plugin enables it; it is not a plugin of its own.
        self.unloaded
            .borrow_mut()
            .retain(|(known, status)| !(matches!(status, Status::Skipped(_)) && matches(known, &definition.id)));
        if self.with_target(&target, |plugin| plugin.active.is_some()) == Some(true) {
            let (order, registration) = self.setup(host, &definition);
            if let Some(error) = definition.external.as_ref().and_then(|(_, error)| error()) {
                registration.dispose();
                return Some(error);
            }
            let previous = self.with_target(&target, |plugin| {
                plugin.definition = definition;
                plugin.active.replace((order, registration))
            });
            if let Some(Some((_, registration))) = previous {
                registration.dispose();
            }
            return None;
        }
        let previous = {
            let mut plugins = self.plugins.borrow_mut();
            match plugins.iter_mut().find(|plugin| plugin.definition.target() == Some(target.as_str())) {
                Some(plugin) => {
                    plugin.definition = definition;
                    Some(plugin.active.take())
                }
                None => {
                    // Like TS, the directives after the plugin's own entry (all of them, for a discovered
                    // plugin) decide whether it starts enabled.
                    let after =
                        self.directives.iter().position(|directive| *directive == target).map_or(0, |index| index + 1);
                    let enabled = self.directives[after..].iter().fold(true, |enabled, directive| {
                        match directive.strip_prefix('-') {
                            Some(selector) if matches(selector, &definition.id) => false,
                            None if matches(directive, &definition.id) => true,
                            _ => enabled,
                        }
                    });
                    plugins.push(Plugin { definition, source: Source::External, enabled, active: None });
                    None
                }
            }
        };
        if let Some((_, registration)) = previous.flatten() {
            registration.dispose();
        }
        let started = self.with_target(&target, |plugin| plugin.enabled.then(|| plugin.definition.id.clone()));
        if let Some(Some(id)) = started {
            self.start(host, &id);
        }
        None
    }

    /// Whether `target` is a selector of a plugin, rather than a plugin to load.
    pub fn selects(&self, target: &str) -> bool {
        self.plugins.borrow().iter().any(|plugin| matches(target, &plugin.definition.id))
    }

    /// Whether a plugin other than the one loaded from `target` has ID `id`.
    pub fn id_taken(&self, id: &str, target: &str) -> bool {
        self.plugins
            .borrow()
            .iter()
            .any(|plugin| plugin.definition.id == id && plugin.definition.target() != Some(target))
    }

    /// Deactivates and removes the external plugin loaded from `target`.
    pub fn unload(&self, target: &str) {
        let removed = {
            let mut plugins = self.plugins.borrow_mut();
            let index = plugins.iter().position(|plugin| plugin.definition.target() == Some(target));
            index.map(|index| plugins.remove(index))
        };
        if let Some((_, registration)) = removed.and_then(|plugin| plugin.active) {
            registration.dispose();
        }
    }

    /// Activates every enabled plugin that is not active, in enable order.
    pub fn activate(&self, host: &Rc<H>) {
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

    /// Activates or deactivates plugin `id` (the plugin manager's toggle); returns whether it exists.
    pub fn set_active(&self, host: &Rc<H>, id: &str, active: bool) -> bool {
        if self.with_plugin(id, |_| ()).is_none() {
            return false;
        }
        if !active {
            let registration = self.with_plugin(id, |plugin| {
                plugin.enabled = false;
                plugin.active.take()
            });
            if let Some((_, registration)) = registration.flatten() {
                registration.dispose();
            }
            return true;
        }
        // Enabling a failed external plugin restarts it with a fresh setup.
        let failed = self.with_plugin(id, |plugin| {
            plugin.enabled = true;
            let failed = plugin.active.is_some()
                && plugin.definition.external.as_ref().is_some_and(|(_, error)| error().is_some());
            failed.then(|| plugin.active.take()).flatten()
        });
        if let Some((_, registration)) = failed.flatten() {
            registration.dispose();
        }
        self.start(host, id);
        true
    }

    /// Every plugin and skipped entry, for the plugin manager.
    pub fn entries(&self) -> Vec<Entry> {
        let plugins = self.plugins.borrow();
        let active = plugins.iter().map(|plugin| Entry {
            id: plugin.definition.id.clone(),
            target: plugin.definition.target().map(str::to_owned),
            source: plugin.source,
            status: match (&plugin.active, &plugin.definition.external) {
                (Some(_), Some((_, error))) => error().map_or(Status::Active, Status::Failed),
                (Some(_), None) => Status::Active,
                (None, _) => Status::Inactive,
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
        host: &H,
        parent: &View,
        path: &str,
        input: &SlotInput,
        content: impl FnOnce(&View),
    ) -> SlotMount<H> {
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

    /// The route plugin `id` registers as `name`, rendered.
    pub fn route(&self, host: &H, id: &str, name: &str) -> Option<Box<dyn Slotted<H>>> {
        let render = self.with_plugin(id, |plugin| {
            let (_, registration) = plugin.active.as_ref()?;
            registration.routes.iter().find(|(route, _)| route == name).map(|(_, render)| render.clone())
        })??;
        Some(render(host))
    }

    /// The code-block renderers of the active plugins, drawing in `theme`. At one language the last-enabled
    /// plugin wins.
    pub fn code_blocks(&self, theme: &Theme) -> CodeBlockRenderers {
        let mut renderers = CodeBlockRenderers::default();
        for (_, registration) in self.by_activation() {
            for (language, render) in &registration.code_blocks {
                let render = render.clone();
                let theme = theme.clone();
                renderers.register(language.clone(), Rc::new(move |block| render(block, &theme)));
            }
        }
        renderers
    }

    /// Runs `setup` for plugin `id` unless it is active.
    fn start(&self, host: &Rc<H>, id: &str) {
        let Some(Some(definition)) =
            self.with_plugin(id, |plugin| plugin.active.is_none().then(|| plugin.definition.clone()))
        else {
            return;
        };
        let active = self.setup(host, &definition);
        self.with_plugin(id, move |plugin| plugin.active = Some(active));
    }

    /// Runs the setup of `definition` and numbers the activation. Setup runs without the registry borrowed, so it
    /// may read the registry through the host.
    fn setup(&self, host: &Rc<H>, definition: &Definition<H>) -> (u64, Registration<H>) {
        let mut setup = Setup { host, id: &definition.id, registration: Registration::default() };
        (definition.setup)(&mut setup);
        let order = self.activations.get();
        self.activations.set(order + 1);
        (order, setup.registration)
    }

    fn with_target<T>(&self, target: &str, f: impl FnOnce(&mut Plugin<H>) -> T) -> Option<T> {
        let mut plugins = self.plugins.borrow_mut();
        plugins.iter_mut().find(|plugin| plugin.definition.target() == Some(target)).map(f)
    }

    fn with_plugin<T>(&self, id: &str, f: impl FnOnce(&mut Plugin<H>) -> T) -> Option<T> {
        let mut plugins = self.plugins.borrow_mut();
        plugins.iter_mut().find(|plugin| plugin.definition.id == id).map(f)
    }

    /// Every active claim in activation order, and its renders.
    fn claims(&self) -> (Vec<Placement>, Vec<SlotRender<H>>) {
        self.by_activation().into_iter().flat_map(|(_, registration)| registration.claims.clone()).unzip()
    }

    fn by_activation(&self) -> Vec<(u64, RegistrationView<H>)> {
        let plugins = self.plugins.borrow();
        let mut active: Vec<_> = plugins
            .iter()
            .filter_map(|plugin| {
                let (order, registration) = plugin.active.as_ref()?;
                Some((
                    *order,
                    RegistrationView {
                        claims: registration.claims.clone(),
                        code_blocks: registration.code_blocks.clone(),
                    },
                ))
            })
            .collect();
        active.sort_by_key(|(order, _)| *order);
        active
    }
}

/// The parts of a registration the registry hands out, cloned so no borrow outlives the call.
struct RegistrationView<H: Host> {
    claims: Vec<(Placement, SlotRender<H>)>,
    code_blocks: Vec<(String, CodeBlockRender)>,
}

/// A mounted slot's claims. The owner of the slot syncs it with each change batch.
pub struct SlotMount<H: Host> {
    claims: Vec<Box<dyn Slotted<H>>>,
    mounted: Option<slot::Mounted>,
    /// The claims appended to a slot that others may degrade onto, kept in step with the mounted slots.
    nested: Option<Rc<Nested<H>>>,
}

impl<H: Host> Default for SlotMount<H> {
    fn default() -> Self {
        Self { claims: Vec::new(), mounted: None, nested: None }
    }
}

impl<H: Host> SlotMount<H> {
    pub fn sync(&self, host: &H, changes: &H::Changes) {
        self.claims.iter().for_each(|claim| claim.sync(host, changes));
        if let Some(nested) = &self.nested {
            let busy = nested.busy.replace(true);
            nested.appended.borrow().iter().for_each(|(_, claim)| claim.sync(host, changes));
            nested.busy.set(busy);
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
struct Nested<H: Host> {
    parent: View,
    marker: View,
    path: String,
    live: Rc<slot::Live>,
    input: SlotInput,
    /// The claims and their renders as of the mount, which a change of plugins mounts again.
    claims: Rc<(Vec<Placement>, Vec<SlotRender<H>>)>,
    /// The mounted ones, by claim index.
    appended: RefCell<Vec<(usize, Claim<H>)>>,
    /// The [`slot::Live::version`] the appended claims follow.
    seen: Cell<u64>,
    /// A refresh or a sync of the appended claims runs; it settles them once it is done.
    busy: Cell<bool>,
}

impl<H: Host> Nested<H> {
    /// Mounts the claims appended here that are not, and drops the ones that are no longer, one at a time in claim
    /// order: a claim that mounts a slot inside this one takes the claims on that slot along before they show here.
    fn refresh(&self, host: &H) {
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
pub(crate) fn settle<H: Host>(host: &H, live: &slot::Live) {
    for _ in 0..=slot::PATHS.len() {
        let version = live.version();
        for follower in live.followers() {
            if let Ok(nested) = follower.downcast::<Nested<H>>() {
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

/// Whether a `plugins` selector names plugin `id`: itself, `*`, or a `prefix.*` it starts with.
pub fn matches(selector: &str, id: &str) -> bool {
    selector == "*"
        || selector == id
        || selector.strip_suffix('*').is_some_and(|prefix| prefix.ends_with('.') && id.starts_with(prefix))
}

#[cfg(test)]
mod tests;
